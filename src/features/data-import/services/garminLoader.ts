import type { ActivityIndex, ActivitySummary, TrackData } from '@/types/activity';
import { distanceKm } from '@/shared/geo/bounds';

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

export interface RegionFilter {
  centerLat: number;
  centerLng: number;
  radiusKm: number;
  label: string;
}

export function filterActivities(
  activities: ActivitySummary[],
  filters: {
    location?: string;
    region?: RegionFilter;
    dateFrom?: string;
    dateTo?: string;
    minDistance?: number;
    maxDistance?: number;
    search?: string;
  }
): ActivitySummary[] {
  return activities.filter((a) => {
    // Region filter (radius-based) takes priority over location dropdown
    if (filters.region) {
      if (!a.startPoint) return false;
      const dist = distanceKm(
        filters.region.centerLat, filters.region.centerLng,
        a.startPoint.lat, a.startPoint.lng
      );
      if (dist > filters.region.radiusKm) return false;
    } else if (filters.location) {
      if (a.location !== filters.location) return false;
    }
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

/** Geocode a place name using Nominatim (free, no API key) */
export async function geocodePlace(query: string): Promise<{ lat: number; lng: number; name: string } | null> {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'RunInk/1.0' } });
    const results = await res.json();
    if (results.length === 0) return null;
    return {
      lat: parseFloat(results[0].lat),
      lng: parseFloat(results[0].lon),
      name: results[0].display_name.split(',')[0],
    };
  } catch {
    return null;
  }
}

/** Find common regions from activities by clustering start points */
export function suggestRegions(activities: ActivitySummary[]): { label: string; lat: number; lng: number; count: number }[] {
  // Group by location name, compute average center for each
  const groups = new Map<string, { lats: number[]; lngs: number[] }>();
  for (const a of activities) {
    if (!a.startPoint || !a.location) continue;
    const existing = groups.get(a.location);
    if (existing) {
      existing.lats.push(a.startPoint.lat);
      existing.lngs.push(a.startPoint.lng);
    } else {
      groups.set(a.location, { lats: [a.startPoint.lat], lngs: [a.startPoint.lng] });
    }
  }

  // Merge nearby location groups into regions
  const locations = Array.from(groups.entries()).map(([label, { lats, lngs }]) => ({
    label,
    lat: lats.reduce((s, v) => s + v, 0) / lats.length,
    lng: lngs.reduce((s, v) => s + v, 0) / lngs.length,
    count: lats.length,
  }));

  // Sort by count descending, merge locations within 25km of each other
  locations.sort((a, b) => b.count - a.count);
  const regions: typeof locations = [];

  for (const loc of locations) {
    const existing = regions.find((r) => distanceKm(r.lat, r.lng, loc.lat, loc.lng) < 25);
    if (existing) {
      // Merge into existing region
      const totalCount = existing.count + loc.count;
      existing.lat = (existing.lat * existing.count + loc.lat * loc.count) / totalCount;
      existing.lng = (existing.lng * existing.count + loc.lng * loc.count) / totalCount;
      existing.count = totalCount;
      // Keep the label of the biggest contributor
    } else {
      regions.push({ ...loc });
    }
  }

  return regions.sort((a, b) => b.count - a.count);
}
