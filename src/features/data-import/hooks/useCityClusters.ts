import { useEffect, useMemo, useRef, useState } from 'react';
import type { ActivitySummary } from '@/types/activity';
import { computeCityClusters } from '../services/cityClusters';
import type { CityCluster } from '../services/cityClusters';

/** Settle delay so we don't re-cluster on every page while Strava streams in. */
const DEBOUNCE_MS = 600;

export interface UseCityClusters {
  clusters: CityCluster[];
  /** activityId → resolved city. */
  cityByActivityId: Record<string, string>;
  loading: boolean;
}

/**
 * Derive city-level run clusters from already-synced activities (BOA-118).
 *
 * Recomputes as more activities stream in. Reverse-geocoding is cached, so each
 * pass only pays network cost for genuinely new geohash cells.
 */
export function useCityClusters(activities: ActivitySummary[]): UseCityClusters {
  const [clusters, setClusters] = useState<CityCluster[]>([]);
  const [cityByActivityId, setCityByActivityId] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  // Only the count of geocodable runs drives recompute — re-clustering on every
  // referential change to `activities` would thrash during streaming.
  const geoCount = useMemo(
    () => activities.reduce((n, a) => n + (a.hasTrack && a.startPoint ? 1 : 0), 0),
    [activities],
  );
  const activitiesRef = useRef(activities);
  // Keep the ref current without re-running the clustering effect below; this
  // effect is declared first, so it commits before clustering reads the ref.
  useEffect(() => { activitiesRef.current = activities; });

  useEffect(() => {
    if (geoCount < 1) return;

    const controller = new AbortController();
    let cancelled = false;
    const timer = setTimeout(() => {
      setLoading(true);
      computeCityClusters(activitiesRef.current, { signal: controller.signal })
        .then((result) => {
          if (cancelled) return;
          setClusters(result.clusters);
          setCityByActivityId(result.cityByActivityId);
        })
        .catch(() => { /* aborted or network — keep last good result */ })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [geoCount]);

  return { clusters, cityByActivityId, loading };
}
