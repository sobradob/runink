import { useState, useEffect, useCallback, useRef } from 'react';
import type { ActivityIndex, ActivitySummary, TrackData } from '@/types/activity';
import {
  checkStravaAuth,
  loadStravaActivities,
  initiateStravaAuth,
  disconnectStrava,
  type StravaAuthStatus,
} from '../services/stravaLoader';

/**
 * Main hook — Strava-only data source.
 */
export function useActivityIndex() {
  const [activities, setActivities] = useState<ActivitySummary[]>([]);
  const [tracksMap, setTracksMap] = useState<Record<string, TrackData>>({});
  const [stravaAuth, setStravaAuth] = useState<StravaAuthStatus>({ connected: false });
  const [loading, setLoading] = useState(true);
  const [stravaLoading, setStravaLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const init = async () => {
      try {
        const auth = await checkStravaAuth();
        setStravaAuth(auth);

        if (auth.connected) {
          setStravaLoading(true);
          try {
            const strava = await loadStravaActivities();
            setActivities(strava.activities);
            setTracksMap(strava.tracks);
          } catch (e: any) {
            setError('Failed to load Strava activities: ' + e.message);
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

  const index: ActivityIndex | null = activities.length > 0 ? {
    generatedAt: new Date().toISOString(),
    totalActivities: activities.length,
    activitiesWithTracks: activities.filter((a) => a.hasTrack).length,
    activities: activities.sort((a, b) => b.timestamp - a.timestamp),
  } : null;

  const connectStrava = useCallback(() => {
    initiateStravaAuth();
  }, []);

  const disconnectStravaHandler = useCallback(async () => {
    await disconnectStrava();
    setStravaAuth({ connected: false });
    setActivities([]);
    setTracksMap({});
  }, []);

  const refreshStrava = useCallback(async () => {
    if (!stravaAuth.connected) return;
    setStravaLoading(true);
    try {
      const strava = await loadStravaActivities(true);
      setActivities(strava.activities);
      setTracksMap(strava.tracks);
    } finally {
      setStravaLoading(false);
    }
  }, [stravaAuth.connected]);

  return {
    index: loading ? null : index,
    loading,
    error,
    stravaAuth,
    stravaLoading,
    stravaTracksMap: tracksMap,
    connectStrava,
    disconnectStrava: disconnectStravaHandler,
    refreshStrava,
  };
}

/**
 * Load a single track from the Strava in-memory cache.
 */
export function useTrack(activityId: string | null, stravaTracksMap?: Record<string, TrackData>) {
  const [track, setTrack] = useState<TrackData | null>(null);
  const [loading, setLoading] = useState(false);
  const stravaMapRef = useRef(stravaTracksMap);
  stravaMapRef.current = stravaTracksMap;

  useEffect(() => {
    if (!activityId) {
      setTrack(null);
      return;
    }

    const cached = stravaMapRef.current?.[activityId];
    if (cached) {
      setTrack(cached);
    } else {
      setTrack(null);
    }
  }, [activityId]);

  return { track, loading, error: null };
}

/**
 * Load multiple tracks from the Strava in-memory cache.
 */
export function useTracks(stravaTracksMap?: Record<string, TrackData>) {
  const [tracks, setTracks] = useState<TrackData[]>([]);
  const [loading, setLoading] = useState(false);
  const stravaMapRef = useRef(stravaTracksMap);
  stravaMapRef.current = stravaTracksMap;

  const load = useCallback(async (ids: string[]) => {
    setLoading(true);
    const results: TrackData[] = [];
    for (const id of ids) {
      const cached = stravaMapRef.current?.[id];
      if (cached) results.push(cached);
    }
    setTracks(results);
    setLoading(false);
  }, []);

  return { tracks, loading, loadTracks: load };
}
