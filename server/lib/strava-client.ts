/**
 * Strava API client — ported from the working Python implementation at
 * /codes/legacy/michal_run_project/backend/app/services/strava.py
 */

const STRAVA_AUTH_URL = 'https://www.strava.com/oauth/authorize';
const STRAVA_TOKEN_URL = 'https://www.strava.com/oauth/token';
const STRAVA_API_BASE = 'https://www.strava.com/api/v3';

// Read env vars lazily to ensure they're available after DigitalOcean injects them
const env = () => ({
  clientId: process.env.STRAVA_CLIENT_ID!,
  clientSecret: process.env.STRAVA_CLIENT_SECRET!,
  redirectUri: process.env.STRAVA_REDIRECT_URI!,
});

export function getAuthorizationUrl(): string {
  const { clientId, redirectUri } = env();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    // Both scopes are required for the app to function:
    //   - `read`               profile basics so we can show the athlete name
    //   - `activity:read_all`  GPS-bearing private+public activities — without
    //                          this, /athlete/activities returns 401 on every
    //                          call (real customer hit this 2026-05-22).
    scope: 'read,activity:read_all',
    // `force` (not `auto`) so Strava ALWAYS shows the consent screen with the
    // "View data about your activities" checkbox visible. With `auto`, a user
    // who previously authorized with a narrower scope (or unchecked the
    // activities box) gets a silently-narrower token and 401s forever after.
    approval_prompt: 'force',
  });
  return `${STRAVA_AUTH_URL}?${params}`;
}

/**
 * Required Strava scopes for the app to function. Token responses that
 * don't include `activity:read_all` cannot fetch activities and need
 * the user to re-authorize with the box checked.
 */
const REQUIRED_SCOPES = ['activity:read_all'] as const;

export class StravaInsufficientScopeError extends Error {
  readonly grantedScope: string;
  readonly missing: string[];
  constructor(grantedScope: string, missing: string[]) {
    super(`Strava authorization is missing required scopes: ${missing.join(', ')} (got: "${grantedScope || '(empty)'}").`);
    this.name = 'StravaInsufficientScopeError';
    this.grantedScope = grantedScope;
    this.missing = missing;
  }
}

/** Typed wrapper for non-2xx responses from Strava. Carries the body so
 *  the activities route can distinguish "missing scope" (recoverable by
 *  reconnecting) from other failures (token expired, app restricted). */
export class StravaApiError extends Error {
  readonly status: number;
  readonly body: string;
  constructor(status: number, body: string) {
    super(`Strava API error: ${status}`);
    this.name = 'StravaApiError';
    this.status = status;
    this.body = body;
  }
  /** True iff Strava's 401 body explicitly mentions a missing scope. */
  isMissingScope(): boolean {
    if (this.status !== 401) return false;
    return /activity:read|missing/i.test(this.body);
  }
}

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  /** Comma-separated list of granted scopes. Strava's docs are inconsistent
   *  but in practice the token endpoint returns this on the response body. */
  scope?: string;
  athlete: {
    id: number;
    firstname: string;
    lastname: string;
    profile: string;
  };
}

/** Throws StravaInsufficientScopeError if any REQUIRED_SCOPES are absent. */
export function assertScopeOk(grantedScope: string | undefined): void {
  const granted = new Set(
    (grantedScope ?? '')
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter(Boolean),
  );
  const missing = REQUIRED_SCOPES.filter((s) => !granted.has(s));
  if (missing.length > 0) {
    throw new StravaInsufficientScopeError(grantedScope ?? '', missing);
  }
}

export async function exchangeCodeForToken(code: string): Promise<TokenResponse> {
  const { clientId, clientSecret } = env();
  const res = await fetch(STRAVA_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: 'authorization_code',
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Strava token exchange failed: ${res.status} ${text}`);
  }

  const data = await res.json() as TokenResponse;
  // Log the scope so when a customer reports a 401, we can confirm
  // whether the issue was a partial-scope authorization vs something
  // else (revoked token, Strava app status, etc).
  console.log(`Strava token issued for athlete ${data.athlete.id}, scope="${data.scope ?? '(not in response)'}"`);
  return data;
}

export async function refreshAccessToken(refreshToken: string): Promise<{
  access_token: string;
  refresh_token: string;
  expires_at: number;
}> {
  const { clientId, clientSecret } = env();
  const res = await fetch(STRAVA_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  if (!res.ok) {
    throw new Error(`Strava token refresh failed: ${res.status}`);
  }

  return res.json();
}

export async function getValidAccessToken(session: {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}): Promise<{ accessToken: string; refreshToken: string; expiresAt: number }> {
  const now = Math.floor(Date.now() / 1000);

  if (session.expiresAt > now + 60) {
    // Token still valid (with 60s buffer)
    return session;
  }

  // Refresh the token
  const refreshed = await refreshAccessToken(session.refreshToken);
  return {
    accessToken: refreshed.access_token,
    refreshToken: refreshed.refresh_token,
    expiresAt: refreshed.expires_at,
  };
}

export interface StravaActivity {
  id: number;
  name: string;
  type: string;
  sport_type: string;
  distance: number; // meters
  moving_time: number; // seconds
  elapsed_time: number; // seconds
  total_elevation_gain: number;
  start_date: string; // ISO
  start_date_local: string; // ISO
  timezone: string;
  start_latlng: [number, number] | null; // [lat, lng]
  end_latlng: [number, number] | null;
  average_speed: number; // m/s
  max_speed: number;
  average_heartrate?: number;
  max_heartrate?: number;
  average_cadence?: number;
  calories?: number;
  /** Strava's run/ride sub-type. For runs: 0 default, 1 race, 2 long run, 3 workout.
   *  For rides: 10 default, 11 race, 12 workout. Absent on many activities. */
  workout_type?: number | null;
  location_city?: string | null;
  location_state?: string | null;
  location_country?: string;
  map: {
    id: string;
    summary_polyline: string | null;
    polyline?: string | null;
  };
}

// Activity types that produce meaningful GPS tracks for poster rendering
const GPS_ACTIVITY_TYPES = new Set([
  'Run', 'VirtualRun', 'TrailRun',
  'Walk', 'Hike',
  'Ride', 'VirtualRide', 'MountainBikeRide', 'GravelRide', 'EBikeRide',
]);

export interface GpsActivitiesResult {
  activities: StravaActivity[];
  /** True iff we saw Strava's last page (raw page came back short or empty).
   *  False when we stopped early — maxPages reached or rate-limited — meaning
   *  more activities exist upstream. Must be judged on the RAW page size:
   *  the GPS-filtered count is almost always < per_page even on full pages. */
  complete: boolean;
}

/**
 * Fetch GPS-based activities from Strava, paginating until exhausted or maxPages
 * reached. Pass maxPages=1 for a fast first-page load (up to 200 most recent);
 * pass startPage=maxPages=N to fetch exactly one page (the client-driven
 * progressive loader does this for pages 2+).
 * Returns activities with their summary_polyline for GPS track rendering.
 */
export async function fetchAllGpsActivities(
  accessToken: string,
  options: { maxPages?: number; startPage?: number } = {}
): Promise<GpsActivitiesResult> {
  const { maxPages = Infinity, startPage = 1 } = options;
  const allActivities: StravaActivity[] = [];
  let page = startPage;
  const perPage = 200; // Max allowed by Strava
  let complete = false;

  while (page <= maxPages) {
    const url = `${STRAVA_API_BASE}/athlete/activities?page=${page}&per_page=${perPage}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!res.ok) {
      if (res.status === 429 && allActivities.length > 0) {
        // Rate limited mid-pagination — return what we have, marked incomplete.
        // With nothing accumulated we throw instead (fall through below): an
        // empty-but-incomplete result would make the progressive loader treat
        // a rate-limited page as "keep going" and spin on 429s.
        console.warn('Strava rate limit hit, returning partial results');
        break;
      }
      // Capture the response body so customer-visible 401/403s are
      // diagnosable from the logs. Strava's typical 401 body looks
      // like {"message":"Authorization Error","errors":[{"resource":"AccessToken","field":"activity:read_permission","code":"missing"}]}
      // which tells us at a glance whether the cause is missing scope
      // vs an actually-expired token vs a revoked app.
      const body = await res.text().catch(() => '(no body)');
      console.error(`Strava API ${res.status} on ${url}: ${body.slice(0, 400)}`);
      throw new StravaApiError(res.status, body);
    }

    const activities: StravaActivity[] = await res.json();
    if (activities.length === 0) {
      complete = true;
      break;
    }

    // Filter to GPS-based activity types
    const gpsActivities = activities.filter(
      (a) => GPS_ACTIVITY_TYPES.has(a.type) || GPS_ACTIVITY_TYPES.has(a.sport_type)
    );
    allActivities.push(...gpsActivities);

    console.log(`  Strava page ${page}: ${activities.length} total, ${gpsActivities.length} GPS activities`);

    if (activities.length < perPage) {
      complete = true; // Last page
      break;
    }
    page++;
  }

  return { activities: allActivities, complete };
}
