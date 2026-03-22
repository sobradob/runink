import type { TrackData, ActivitySummary } from '@/types/activity';
import type { LngLatBoundsLike } from 'maplibre-gl';

export interface BBox {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
}

export function boundsFromCoords(coords: [number, number][]): BBox {
  let minLng = Infinity, minLat = Infinity;
  let maxLng = -Infinity, maxLat = -Infinity;

  for (const [lng, lat] of coords) {
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }

  return { minLng, minLat, maxLng, maxLat };
}

export function boundsFromTracks(tracks: TrackData[]): BBox {
  const allCoords = tracks.flatMap((t) => t.coords);
  return boundsFromCoords(allCoords);
}

export function boundsFromActivities(activities: ActivitySummary[]): BBox | null {
  const withBounds = activities.filter((a) => a.bounds);
  if (withBounds.length === 0) return null;

  let minLng = Infinity, minLat = Infinity;
  let maxLng = -Infinity, maxLat = -Infinity;

  for (const a of withBounds) {
    const b = a.bounds!;
    if (b.minLng < minLng) minLng = b.minLng;
    if (b.maxLng > maxLng) maxLng = b.maxLng;
    if (b.minLat < minLat) minLat = b.minLat;
    if (b.maxLat > maxLat) maxLat = b.maxLat;
  }

  return { minLng, minLat, maxLng, maxLat };
}

export function bboxToMaplibre(bbox: BBox, padding = 0.1): LngLatBoundsLike {
  const lngPad = (bbox.maxLng - bbox.minLng) * padding;
  const latPad = (bbox.maxLat - bbox.minLat) * padding;

  return [
    [bbox.minLng - lngPad, bbox.minLat - latPad],
    [bbox.maxLng + lngPad, bbox.maxLat + latPad],
  ];
}

export function centerOfBBox(bbox: BBox): [number, number] {
  return [
    (bbox.minLng + bbox.maxLng) / 2,
    (bbox.minLat + bbox.maxLat) / 2,
  ];
}
