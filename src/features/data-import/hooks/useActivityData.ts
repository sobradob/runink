import { useState, useEffect, useCallback, useRef } from 'react';
import type { ActivityIndex, ActivitySummary, TrackData } from '@/types/activity';
import {
  checkStravaAuth,
  loadStravaActivities,
  initiateStravaAuth,
  disconnectStrava,
  StravaLoaderError,
  type StravaAuthStatus,
} from '../services/stravaLoader';
import { loadActivityIndex, loadTrack as loadDemoTrack } from '../services/garminLoader';
import { reportError } from '@/shared/diagnostics/errorReporter';

const USE_DEMO_DATA = import.meta.env.VITE_USE_DEMO_DATA === 'true';

/** Distinct authorization issues the UI can recover from with a targeted prompt. */
export type StravaAuthIssue =
  | { kind: 'missing_scope' }
  | { kind: 'session_invalid' };

/**
 * Main hook — Strava data source, with optional demo mode via VITE_USE_DEMO_DATA=true.
 */
export function useActivityIndex() {
  const [activities, setActivities] = useState<ActivitySummary[]>([]);
  const [tracksMap, setTracksMap] = useState<Record<string, TrackData>>({});
  const [stravaAuth, setStravaAuth] = useState<StravaAuthStatus>({ connected: false });
  const [loading, setLoading] = useState(true);
  const [stravaLoading, setStravaLoading] = useState(false);
  // True while the background full fetch runs after a partial quick load —
  // the UI is usable but older activities are still arriving.
  const [syncingMore, setSyncingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Authorization-specific issue surfaced to the UI for targeted recovery
  // prompts (e.g. "you need to tick the activities checkbox"). Separate
  // from `error` so the onboarding view can render a different message
  // and CTA without parsing strings.
  const [authIssue, setAuthIssue] = useState<StravaAuthIssue | null>(() => {
    // Carry over `?strava=missing_scope` set by the OAuth callback when
    // the user authorized without granting activity:read_all.
    const params = new URLSearchParams(window.location.search);
    if (params.get('strava') === 'missing_scope') return { kind: 'missing_scope' };
    return null;
  });

  // The OAuth callback redirects to `/?strava=connected` on success — the
  // only signal that this page load is a fresh post-authorization landing
  // rather than a returning session.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('strava') === 'connected') {
      window.mixpanel?.track('strava_connected');
    }
  }, []);

  useEffect(() => {
    const abortController = new AbortController();

    const init = async () => {
      try {
        if (USE_DEMO_DATA) {
          // Load sample data from /public/data/ — no Strava auth needed
          setStravaAuth({ connected: true, athleteName: 'Demo User' } as StravaAuthStatus);
          const index = await loadActivityIndex();
          setActivities(index.activities);
          setLoading(false);
          return;
        }

        const auth = await checkStravaAuth();
        setStravaAuth(auth);

        if (auth.connected) {
          setStravaLoading(true);
          try {
            // Progressive load: first page (≤200 most recent) returns in ~3-5s so
            // the UI is interactive quickly — critical on mobile where iOS tends
            // to drop fetches that block for 20s+. Full list streams in behind it.
            const quick = await loadStravaActivities({ quick: true, signal: abortController.signal });
            if (abortController.signal.aborted) return;
            setActivities(quick.activities);
            setTracksMap(quick.tracks);
            setLoading(false); // UI usable now — error/full-loading states handle the rest

            if (quick.partial) {
              // Background full fetch — don't block the UI. Errors here are soft:
              // the user still has the first 200 activities to work with.
              setSyncingMore(true);
              loadStravaActivities({ signal: abortController.signal })
                .then((full) => {
                  if (abortController.signal.aborted) return;
                  setActivities(full.activities);
                  setTracksMap(full.tracks);
                })
                .catch((e) => {
                  if (abortController.signal.aborted) return;
                  console.warn('[strava] Background full-load failed, keeping quick results:', e.message);
                })
                .finally(() => {
                  if (abortController.signal.aborted) return;
                  setSyncingMore(false);
                });
            }
          } catch (e: unknown) {
            if (abortController.signal.aborted) return;
            // Surface auth-specific failures as a separate `authIssue`
            // so the onboarding view can show a targeted prompt
            // ("re-authorize and tick the activities checkbox") instead
            // of a bare error string.
            if (e instanceof StravaLoaderError) {
              if (e.isMissingScope()) {
                setAuthIssue({ kind: 'missing_scope' });
                // Clear the auth so the onboarding view (which renders
                // the StravaConnectButton) is shown — there's nothing
                // else the user can do without reconnecting.
                setStravaAuth({ connected: false });
              } else if (e.isSessionInvalid()) {
                setAuthIssue({ kind: 'session_invalid' });
                setStravaAuth({ connected: false });
              } else {
                setError('Failed to load Strava activities: ' + e.message);
              }
              reportError(e, {
                source: 'strava',
                status: e.status,
                code: e.code,
              });
            } else {
              setError('Failed to load Strava activities: ' + (e as Error)?.message);
              reportError(e, { source: 'strava' });
            }
          } finally {
            setStravaLoading(false);
          }
        }
      } catch (e: any) {
        if (abortController.signal.aborted) return;
        setError(e.message);
      } finally {
        if (!abortController.signal.aborted) setLoading(false);
      }
    };
    init();

    return () => abortController.abort();
  }, []);

  const index: ActivityIndex | null = activities.length > 0 ? {
    generatedAt: new Date().toISOString(),
    totalActivities: activities.length,
    activitiesWithTracks: activities.filter((a) => a.hasTrack).length,
    activities: activities.sort((a, b) => b.timestamp - a.timestamp),
  } : null;

  const connectStrava = useCallback(() => {
    window.mixpanel?.track('strava_connect_clicked');
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
    authIssue,
    stravaAuth,
    stravaLoading,
    syncingMore,
    stravaTracksMap: tracksMap,
    connectStrava,
    disconnectStrava: disconnectStravaHandler,
    refreshStrava,
  };
}

/**
 * Load a single track from the Strava in-memory cache, falling back to demo data files.
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
      return;
    }

    if (USE_DEMO_DATA) {
      setLoading(true);
      loadDemoTrack(activityId)
        .then(setTrack)
        .catch(() => setTrack(null))
        .finally(() => setLoading(false));
      return;
    }

    setTrack(null);
  }, [activityId]);

  return { track, loading, error: null };
}

/**
 * Load multiple tracks from the Strava in-memory cache, falling back to demo data files.
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

    if (results.length === 0 && USE_DEMO_DATA) {
      const { loadTracks: loadDemoTracks } = await import('../services/garminLoader');
      const demoTracks = await loadDemoTracks(ids);
      setTracks(demoTracks);
    } else {
      setTracks(results);
    }
    setLoading(false);
  }, []);

  return { tracks, loading, loadTracks: load };
}
