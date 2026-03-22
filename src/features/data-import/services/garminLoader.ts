import type { ActivityIndex, ActivitySummary, TrackData } from '@/types/activity';

const DATA_BASE = '/data';

let cachedIndex: ActivityIndex | null = null;

export async function loadActivityIndex(): Promise<ActivityIndex> {
  if (cachedIndex) return cachedIndex;

  const res = await fetch(`${DATA_BASE}/index.json`);
  if (!res.ok) throw new Error(`Failed to load activity index: ${res.status}`);
  cachedIndex = await res.json();
  return cachedIndex!;
}

export async function loadTrack(activityId: string): Promise<TrackData> {
  const res = await fetch(`${DATA_BASE}/tracks/${activityId}.json`);
  if (!res.ok) throw new Error(`Failed to load track ${activityId}: ${res.status}`);
  return res.json();
}

export async function loadTracks(activityIds: string[]): Promise<TrackData[]> {
  const results = await Promise.allSettled(activityIds.map(loadTrack));
  return results
    .filter((r): r is PromiseFulfilledResult<TrackData> => r.status === 'fulfilled')
    .map((r) => r.value);
}

export function getUniqueLocations(activities: ActivitySummary[]): string[] {
  const locs = new Set(activities.map((a) => a.location).filter(Boolean));
  return Array.from(locs).sort();
}

export function filterActivities(
  activities: ActivitySummary[],
  filters: {
    location?: string;
    dateFrom?: string;
    dateTo?: string;
    minDistance?: number;
    maxDistance?: number;
    search?: string;
  }
): ActivitySummary[] {
  return activities.filter((a) => {
    if (filters.location && a.location !== filters.location) return false;
    if (filters.dateFrom && a.date < filters.dateFrom) return false;
    if (filters.dateTo && a.date > filters.dateTo) return false;
    if (filters.minDistance && a.distance < filters.minDistance * 1000) return false;
    if (filters.maxDistance && a.distance > filters.maxDistance * 1000) return false;
    if (filters.search) {
      const s = filters.search.toLowerCase();
      if (!a.name.toLowerCase().includes(s) && !a.location.toLowerCase().includes(s)) return false;
    }
    return true;
  });
}
