import type { StravaActivity } from './strava-client.js';
import { decodePolyline } from './polyline.js';

// These types mirror src/types/activity.ts but defined here for the server
export interface ActivitySummary {
  id: string;
  name: string;
  date: string;
  timestamp: number;
  distance: number;
  duration: number;
  movingDuration: number;
  avgSpeed: number;
  avgPace: number;
  avgHr: number | null;
  maxHr: number | null;
  elevationGain: number;
  elevationLoss: number;
  calories: number;
  location: string;
  sportType: string;
  startPoint: { lat: number; lng: number } | null;
  endPoint: { lat: number; lng: number } | null;
  bounds: { minLat: number; maxLat: number; minLng: number; maxLng: number } | null;
  hasTrack: boolean;
  source: 'strava';
}

export interface TrackData {
  id: string;
  coords: [number, number][]; // [lng, lat]
}

export function stravaToActivitySummary(raw: StravaActivity): ActivitySummary {
  const distKm = raw.distance / 1000;
  const movingMin = raw.moving_time / 60;
  const avgPace = distKm > 0 ? movingMin / distKm : 0;

  const hasPolyline = !!raw.map?.summary_polyline;
  let bounds = null;

  if (hasPolyline) {
    const coords = decodePolyline(raw.map.summary_polyline!);
    if (coords.length > 0) {
      let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
      for (const [lng, lat] of coords) {
        if (lng < minLng) minLng = lng;
        if (lng > maxLng) maxLng = lng;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
      }
      bounds = { minLat, maxLat, minLng, maxLng };
    }
  }

  // Build location string from Strava's city/state/country fields
  const location = raw.location_city
    || raw.location_state
    || raw.location_country
    || '';

  return {
    id: `strava_${raw.id}`,
    name: raw.name,
    date: raw.start_date_local?.split('T')[0] ?? raw.start_date.split('T')[0],
    timestamp: new Date(raw.start_date).getTime(),
    distance: raw.distance,
    duration: raw.elapsed_time,
    movingDuration: raw.moving_time,
    avgSpeed: raw.average_speed,
    avgPace,
    avgHr: raw.average_heartrate ?? null,
    maxHr: raw.max_heartrate ?? null,
    elevationGain: raw.total_elevation_gain,
    elevationLoss: 0,
    calories: raw.calories ?? 0,
    location,
    sportType: 'running',
    startPoint: raw.start_latlng ? { lat: raw.start_latlng[0], lng: raw.start_latlng[1] } : null,
    endPoint: raw.end_latlng ? { lat: raw.end_latlng[0], lng: raw.end_latlng[1] } : null,
    bounds,
    hasTrack: hasPolyline,
    source: 'strava',
  };
}

export function stravaToTrackData(raw: StravaActivity): TrackData | null {
  if (!raw.map?.summary_polyline) return null;

  const coords = decodePolyline(raw.map.summary_polyline);
  if (coords.length < 2) return null;

  return {
    id: `strava_${raw.id}`,
    coords,
  };
}
