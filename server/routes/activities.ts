import { Router } from 'express';
import { getSession, updateSession } from '../lib/session.js';
import { fetchAllGpsActivities, getValidAccessToken, StravaApiError } from '../lib/strava-client.js';
import type { StravaActivity } from '../lib/strava-client.js';
import { stravaToActivitySummary, stravaToTrackData } from '../lib/transform.js';
import type { ActivitySummary, TrackData } from '../lib/transform.js';
import { reportServerError } from '../lib/error-reporter.js';

export const activitiesRouter = Router();

const COOKIE_NAME = 'runink_session';

// Cache: athleteId -> { activities, tracks, fetchedAt }
const cache = new Map<number, {
  activities: ActivitySummary[];
  tracks: Record<string, TrackData>;
  fetchedAt: number;
}>();

const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

// Progressive load assembly: the client fetches page 1 via ?quick=true, then
// pages 2+ via ?page=N. Each page is parked here per athlete; when the last
// page arrives (complete=true) and pages 1..N are all present, the assembled
// list is promoted to the real cache. Each Strava page is fetched exactly
// once — no second full fetch just to warm the cache.
interface PendingPage {
  activities: ActivitySummary[];
  tracks: Record<string, TrackData>;
}
const pendingPages = new Map<number, {
  pages: Map<number, PendingPage>;
  startedAt: number;
}>();
const PENDING_TTL = 15 * 60 * 1000;

/** Begin a new assembly with page 1 (from a partial quick load). Replaces any
 *  previous in-flight assembly for this athlete — e.g. a second tab. */
function startPendingAssembly(athleteId: number, firstPage: PendingPage) {
  pendingPages.set(athleteId, { pages: new Map([[1, firstPage]]), startedAt: Date.now() });
}

/** Park page N; on the final page, promote pages 1..N to the cache if the set
 *  is gapless. A gap (server restart, expired assembly) just means we skip
 *  caching — the client already holds the data it fetched. */
/** Strava payload → RunInk summaries + tracks, sorted by date descending. */
function transformActivities(stravaActivities: StravaActivity[]): PendingPage {
  const activities: ActivitySummary[] = [];
  const tracks: Record<string, TrackData> = {};
  for (const raw of stravaActivities) {
    activities.push(stravaToActivitySummary(raw));
    const track = stravaToTrackData(raw);
    if (track) {
      tracks[track.id] = track;
    }
  }
  activities.sort((a, b) => b.timestamp - a.timestamp);
  return { activities, tracks };
}

function recordPendingPage(athleteId: number, page: number, data: PendingPage, complete: boolean) {
  const entry = pendingPages.get(athleteId);
  if (!entry || Date.now() - entry.startedAt > PENDING_TTL) {
    pendingPages.delete(athleteId);
    return;
  }
  entry.pages.set(page, data);
  if (!complete) return;

  pendingPages.delete(athleteId);
  const activities: ActivitySummary[] = [];
  const tracks: Record<string, TrackData> = {};
  for (let p = 1; p <= page; p++) {
    const pageData = entry.pages.get(p);
    if (!pageData) {
      console.warn(`Pending assembly for athlete ${athleteId} missing page ${p}/${page}, not caching`);
      return;
    }
    activities.push(...pageData.activities);
    Object.assign(tracks, pageData.tracks);
  }
  activities.sort((a, b) => b.timestamp - a.timestamp);
  cache.set(athleteId, { activities, tracks, fetchedAt: Date.now() });
  console.log(`Assembled ${activities.length} activities from ${page} pages into cache for athlete ${athleteId}`);
}

// Get all Strava running activities
activitiesRouter.get('/activities', async (req, res) => {
  const sessionId = req.cookies?.[COOKIE_NAME];
  if (!sessionId) {
    return res.status(401).json({ error: 'Not connected to Strava' });
  }

  const session = getSession(sessionId);
  if (!session) {
    return res.status(401).json({ error: 'Session expired' });
  }

  try {
    // Check cache
    const cached = cache.get(session.athleteId);
    const forceRefresh = req.query.refresh === 'true';
    const quick = req.query.quick === 'true';
    // Progressive loader: pages 2+ of a client-driven pagination loop.
    // Page 1 is always the ?quick=true request.
    const pageParam = typeof req.query.page === 'string' ? Number(req.query.page) : undefined;
    if (pageParam !== undefined && (!Number.isInteger(pageParam) || pageParam < 2 || pageParam > 1000)) {
      return res.status(400).json({ error: 'Invalid page parameter' });
    }

    // If we have a fresh full cache, serve it regardless of quick — no need to
    // re-fetch just to return partial data. (Page requests skip this: they only
    // happen mid-loop, after a partial quick response.)
    if (pageParam === undefined && cached && !forceRefresh && Date.now() - cached.fetchedAt < CACHE_TTL) {
      console.log(`Serving ${cached.activities.length} activities from cache (quick=${quick})`);
      return res.json({ ...cached, partial: false });
    }

    // Refresh token if needed
    const validToken = await getValidAccessToken(session);
    if (validToken.accessToken !== session.accessToken) {
      updateSession(sessionId, {
        accessToken: validToken.accessToken,
        refreshToken: validToken.refreshToken,
        expiresAt: validToken.expiresAt,
      });
    }

    // Progressive loader page: fetch exactly one Strava page, park it in the
    // pending assembly, and return it. The client appends and keeps looping
    // until complete=true.
    if (pageParam !== undefined) {
      const { activities: stravaActivities, complete } = await fetchAllGpsActivities(
        validToken.accessToken,
        { startPage: pageParam, maxPages: pageParam },
      );
      const { activities, tracks } = transformActivities(stravaActivities);
      recordPendingPage(session.athleteId, pageParam, { activities, tracks }, complete);
      console.log(`Returning page ${pageParam}: ${activities.length} activities (complete=${complete})`);
      return res.json({ activities, tracks, fetchedAt: Date.now(), partial: !complete, page: pageParam, complete });
    }

    // Quick mode: fetch only the first page (up to 200 most recent GPS activities).
    // This gives mobile users something to interact with in ~3-5s, avoiding the
    // 20s+ blocking request that iOS Safari tends to drop on flaky networks.
    // The client follows up by looping ?page=2,3,... until complete.
    const maxPages = quick ? 1 : Infinity;
    console.log(`Fetching activities from Strava (quick=${quick})...`);
    const { activities: stravaActivities, complete } = await fetchAllGpsActivities(validToken.accessToken, { maxPages });
    console.log(`Fetched ${stravaActivities.length} GPS activities (complete=${complete})`);

    const { activities, tracks } = transformActivities(stravaActivities);

    // Only cache the complete result — partial responses would poison the cache
    // and cause later full requests to return stale-incomplete data. `complete`
    // is judged on Strava's RAW page size, never the GPS-filtered count: a full
    // page of 200 with 129 GPS runs is NOT the last page (real user hit this —
    // partial=false meant the client never fetched the rest). A rate-limited
    // (429) full fetch is also incomplete and must not be cached.
    const isPartial = !complete;
    if (!isPartial) {
      cache.set(session.athleteId, { activities, tracks, fetchedAt: Date.now() });
    } else if (quick) {
      // Partial quick response = page 1 of a progressive load; anchor the
      // pending assembly so pages 2+ can complete it into the cache.
      startPendingAssembly(session.athleteId, { activities, tracks });
    }

    console.log(`Returning ${activities.length} activities, ${Object.keys(tracks).length} with tracks (partial=${isPartial})`);
    res.json({ activities, tracks, fetchedAt: Date.now(), partial: isPartial });
  } catch (err: unknown) {
    // Strava returned a non-2xx — surface the specific cause so the
    // client can show the right recovery UI instead of a generic 500.
    if (err instanceof StravaApiError) {
      console.error(`Strava API failure: ${err.status} ${err.body.slice(0, 200)}`);
      if (err.isMissingScope()) {
        // Track scope failures explicitly — this is a fixable UX issue
        // (the connect-with-checkbox loop). Mixpanel can show "X users
        // hit this today" before they DM you.
        reportServerError(err, {
          scope: 'activities',
          method: 'GET',
          route: '/api/strava/activities',
          httpStatus: 403,
          extra: { code: 'STRAVA_MISSING_SCOPE', strava_status: err.status },
        });
        // The token doesn't carry activity:read_all. The user needs to
        // reconnect with the checkbox enabled. 403 + a typed code lets
        // the client show a "please reconnect" prompt instead of a
        // bare error.
        return res.status(403).json({
          error: 'Strava authorization is missing the "view activities" permission',
          code: 'STRAVA_MISSING_SCOPE',
        });
      }
      if (err.status === 401) {
        reportServerError(err, {
          scope: 'activities',
          method: 'GET',
          route: '/api/strava/activities',
          httpStatus: 401,
          extra: { code: 'STRAVA_SESSION_INVALID', strava_status: err.status },
        });
        // Token rejected for some other reason (revoked, app
        // restricted). Treat as logged-out — the session is no longer
        // useful, force a reconnect.
        return res.status(401).json({
          error: 'Strava session is no longer valid',
          code: 'STRAVA_SESSION_INVALID',
        });
      }
      // Other Strava failure (5xx, rate limit, etc.) — track separately
      // so we can see "Strava had a bad hour" without it being conflated
      // with our own bugs.
      reportServerError(err, {
        scope: 'activities',
        method: 'GET',
        route: '/api/strava/activities',
        httpStatus: 500,
        extra: { strava_status: err.status },
      });
    } else {
      // Non-Strava error (DB, JSON parse, transform crash). This is
      // the most useful category for Mixpanel — it's what surfaces
      // bugs in OUR code, not in Strava's responses.
      reportServerError(err, {
        scope: 'activities',
        method: 'GET',
        route: '/api/strava/activities',
        httpStatus: 500,
      });
    }
    console.error('Failed to fetch Strava activities:', (err as Error)?.message);
    res.status(500).json({ error: 'Failed to fetch activities from Strava' });
  }
});
