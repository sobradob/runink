import { useState, useEffect, useCallback, useRef } from 'react';
import type { ActivityIndex, ActivitySummary, TrackData } from '@/types/activity';
import { loadActivityIndex, loadTrack, loadTracks } from '../services/garminLoader';
import {
  checkStravaAuth,
  loadStravaActivities,
  initiateStravaAuth,
  disconnectStrava,
  type StravaAuthStatus,
} from '../services/stravaLoader';

/**
 * Main hook that loads activities from all sources (Garmin + Strava).
 */
export function useActivityIndex() {
  const [garminIndex, setGarminIndex] = useState<ActivityIndex | null>(null);
  const [stravaActivities, setStravaActivities] = useState<ActivitySummary[]>([]);
  const [stravaTracksMap, setStravaTracksMap] = useState<Record<string, TrackData>>({});
  const [stravaAuth, setStravaAuth] = useState<StravaAuthStatus>({ connected: false });
  const [loading, setLoading] = useState(true);
  const [stravaLoading, setStravaLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load Garmin data + check Strava auth on mount
  useEffect(() => {
    const init = async () => {
      try {
        const [garmin, auth] = await Promise.all([
          loadActivityIndex().catch(() => null),
          checkStravaAuth(),
        ]);

        if (garmin) setGarminIndex(garmin);
        setStravaAuth(auth);

        // Auto-load Strava activities if connected
        if (auth.connected) {
          setStravaLoading(true);
          try {
            const strava = await loadStravaActivities();
            setStravaActivities(strava.activities);
            setStravaTracksMap(strava.tracks);
          } catch {
            // Strava load failed — still show Garmin data
          } finally {
            setStravaLoading(false);
          }
        }
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    };
    init();
  }, []);

  // Merge activities from all sources
  const allActivities: ActivitySummary[] = [];
  if (garminIndex) {
    allActivities.push(...garminIndex.activities.map((a) => ({ ...a, source: 'garmin' as const })));
  }
  allActivities.push(...stravaActivities);

  // Deduplicate: if same date + distance within 5%, keep Garmin (higher fidelity)
  const deduped = deduplicateActivities(allActivities);
  deduped.sort((a, b) => b.timestamp - a.timestamp);

  const mergedIndex: ActivityIndex = {
    generatedAt: new Date().toISOString(),
    totalActivities: deduped.length,
    activitiesWithTracks: deduped.filter((a) => a.hasTrack).length,
    activities: deduped,
  };

  const connectStrava = useCallback(() => {
    initiateStravaAuth();
  }, []);

  const disconnectStravaHandler = useCallback(async () => {
    await disconnectStrava();
    setStravaAuth({ connected: false });
    setStravaActivities([]);
    setStravaTracksMap({});
  }, []);

  const refreshStrava = useCallback(async () => {
    if (!stravaAuth.connected) return;
    setStravaLoading(true);
    try {
      const strava = await loadStravaActivities(true);
      setStravaActivities(strava.activities);
      setStravaTracksMap(strava.tracks);
    } finally {
      setStravaLoading(false);
    }
  }, [stravaAuth.connected]);

  return {
    index: loading ? null : mergedIndex,
    loading,
    error,
    stravaAuth,
    stravaLoading,
    stravaTracksMap,
    connectStrava,
    disconnectStrava: disconnectStravaHandler,
    refreshStrava,
  };
}

/**
 * Load a single track — checks Strava cache first, then falls back to Garmin files.
 */
export function useTrack(activityId: string | null, stravaTracksMap?: Record<string, TrackData>) {
  const [track, setTrack] = useState<TrackData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stravaMapRef = useRef(stravaTracksMap);
  stravaMapRef.current = stravaTracksMap;

  useEffect(() => {
    if (!activityId) {
      setTrack(null);
      return;
    }

    // Check Strava cache first
    if (activityId.startsWith('strava_') && stravaMapRef.current?.[activityId]) {
      setTrack(stravaMapRef.current[activityId]);
      return;
    }

    // Fall back to Garmin file fetch
    setLoading(true);
    setError(null);
    loadTrack(activityId)
      .then(setTrack)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [activityId]);

  return { track, loading, error };
}

export function useTracks(stravaTracksMap?: Record<string, TrackData>) {
  const [tracks, setTracks] = useState<TrackData[]>([]);
  const [loading, setLoading] = useState(false);
  const stravaMapRef = useRef(stravaTracksMap);
  stravaMapRef.current = stravaTracksMap;

  const load = useCallback(async (ids: string[]) => {
    setLoading(true);

    const results: TrackData[] = [];

    // Split into Strava (in-memory) and Garmin (file fetch) IDs
    const garminIds: string[] = [];
    for (const id of ids) {
      if (id.startsWith('strava_') && stravaMapRef.current?.[id]) {
        results.push(stravaMapRef.current[id]);
      } else {
        garminIds.push(id);
      }
    }

    // Fetch Garmin tracks
    if (garminIds.length > 0) {
      const garminTracks = await loadTracks(garminIds);
      results.push(...garminTracks);
    }

    setTracks(results);
    setLoading(false);
  }, []);

  return { tracks, loading, loadTracks: load };
}

// === Helpers ===

function deduplicateActivities(activities: ActivitySummary[]): ActivitySummary[] {
  const seen = new Map<string, ActivitySummary>();

  for (const a of activities) {
    // Generate a dedup key: date + rough distance bucket
    const distBucket = Math.round(a.distance / 100); // 100m buckets
    const key = `${a.date}_${distBucket}`;

    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, a);
    } else {
      // Prefer Garmin (higher track fidelity) over Strava
      if (a.source === 'garmin') {
        seen.set(key, a);
      }
    }
  }

  return Array.from(seen.values());
}
