import { useState, useEffect, useCallback } from 'react';
import type { ActivityIndex, ActivitySummary, TrackData } from '@/types/activity';
import { loadActivityIndex, loadTrack, loadTracks } from '../services/garminLoader';

export function useActivityIndex() {
  const [index, setIndex] = useState<ActivityIndex | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadActivityIndex()
      .then(setIndex)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return { index, loading, error };
}

export function useTrack(activityId: string | null) {
  const [track, setTrack] = useState<TrackData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!activityId) {
      setTrack(null);
      return;
    }

    setLoading(true);
    setError(null);
    loadTrack(activityId)
      .then(setTrack)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [activityId]);

  return { track, loading, error };
}

export function useTracks() {
  const [tracks, setTracks] = useState<TrackData[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (ids: string[]) => {
    setLoading(true);
    const result = await loadTracks(ids);
    setTracks(result);
    setLoading(false);
  }, []);

  return { tracks, loading, loadTracks: load };
}
