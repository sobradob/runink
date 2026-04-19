import { Router } from 'express';
import { getSession, updateSession } from '../lib/session.js';
import { fetchAllGpsActivities, getValidAccessToken } from '../lib/strava-client.js';
import { stravaToActivitySummary, stravaToTrackData } from '../lib/transform.js';
import type { ActivitySummary, TrackData } from '../lib/transform.js';

export const activitiesRouter = Router();

const COOKIE_NAME = 'runink_session';

// Cache: athleteId -> { activities, tracks, fetchedAt }
const cache = new Map<number, {
  activities: ActivitySummary[];
  tracks: Record<string, TrackData>;
  fetchedAt: number;
}>();

const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

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

    // If we have a fresh full cache, serve it regardless of quick — no need to
    // re-fetch just to return partial data.
    if (cached && !forceRefresh && Date.now() - cached.fetchedAt < CACHE_TTL) {
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

    // Quick mode: fetch only the first page (up to 200 most recent GPS activities).
    // This gives mobile users something to interact with in ~3-5s, avoiding the
    // 20s+ blocking request that iOS Safari tends to drop on flaky networks.
    // The client follows up with a full request in the background.
    const maxPages = quick ? 1 : Infinity;
    console.log(`Fetching activities from Strava (quick=${quick})...`);
    const stravaActivities = await fetchAllGpsActivities(validToken.accessToken, { maxPages });
    console.log(`Fetched ${stravaActivities.length} GPS activities`);

    // Transform to RunInk format
    const activities: ActivitySummary[] = [];
    const tracks: Record<string, TrackData> = {};

    for (const raw of stravaActivities) {
      const summary = stravaToActivitySummary(raw);
      activities.push(summary);

      const track = stravaToTrackData(raw);
      if (track) {
        tracks[track.id] = track;
      }
    }

    // Sort by date descending
    activities.sort((a, b) => b.timestamp - a.timestamp);

    // Only cache the full result — partial quick responses would poison the cache
    // and cause later full requests to return stale-incomplete data.
    const isPartial = quick && stravaActivities.length >= 200;
    if (!isPartial) {
      cache.set(session.athleteId, { activities, tracks, fetchedAt: Date.now() });
    }

    console.log(`Returning ${activities.length} activities, ${Object.keys(tracks).length} with tracks (partial=${isPartial})`);
    res.json({ activities, tracks, fetchedAt: Date.now(), partial: isPartial });
  } catch (err: any) {
    console.error('Failed to fetch Strava activities:', err.message);
    res.status(500).json({ error: 'Failed to fetch activities from Strava' });
  }
});
