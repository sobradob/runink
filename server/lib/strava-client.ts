/**
 * Strava API client — ported from the working Python implementation at
 * /codes/legacy/michal_run_project/backend/app/services/strava.py
 */

const STRAVA_AUTH_URL = 'https://www.strava.com/oauth/authorize';
const STRAVA_TOKEN_URL = 'https://www.strava.com/oauth/token';
const STRAVA_API_BASE = 'https://www.strava.com/api/v3';

const clientId = process.env.STRAVA_CLIENT_ID!;
const clientSecret = process.env.STRAVA_CLIENT_SECRET!;
const redirectUri = process.env.STRAVA_REDIRECT_URI!;

export function getAuthorizationUrl(): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'read,activity:read_all',
    approval_prompt: 'auto',
  });
  return `${STRAVA_AUTH_URL}?${params}`;
}

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  athlete: {
    id: number;
    firstname: string;
    lastname: string;
    profile: string;
  };
}

export async function exchangeCodeForToken(code: string): Promise<TokenResponse> {
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

  return res.json();
}

export async function refreshAccessToken(refreshToken: string): Promise<{
  access_token: string;
  refresh_token: string;
  expires_at: number;
}> {
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
  location_city?: string | null;
  location_state?: string | null;
  location_country?: string;
  map: {
    id: string;
    summary_polyline: string | null;
    polyline?: string | null;
  };
}

/**
 * Fetch all running activities from Strava, paginating through all results.
 * Returns activities with their summary_polyline for GPS track rendering.
 */
export async function fetchAllRunActivities(accessToken: string): Promise<StravaActivity[]> {
  const allActivities: StravaActivity[] = [];
  let page = 1;
  const perPage = 200; // Max allowed by Strava

  while (true) {
    const url = `${STRAVA_API_BASE}/athlete/activities?page=${page}&per_page=${perPage}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!res.ok) {
      if (res.status === 429) {
        // Rate limited — return what we have
        console.warn('Strava rate limit hit, returning partial results');
        break;
      }
      throw new Error(`Strava API error: ${res.status}`);
    }

    const activities: StravaActivity[] = await res.json();
    if (activities.length === 0) break;

    // Filter to running activities only
    const runs = activities.filter(
      (a) => a.type === 'Run' || a.sport_type === 'Run'
    );
    allActivities.push(...runs);

    console.log(`  Strava page ${page}: ${activities.length} activities, ${runs.length} runs`);

    if (activities.length < perPage) break; // Last page
    page++;
  }

  return allActivities;
}
