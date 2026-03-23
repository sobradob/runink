export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface ActivitySummary {
  id: string;
  name: string;
  date: string; // ISO date
  timestamp: number; // epoch ms
  distance: number; // meters
  duration: number; // seconds
  movingDuration: number; // seconds
  avgSpeed: number; // m/s
  avgPace: number; // min/km
  avgHr: number | null;
  maxHr: number | null;
  elevationGain: number;
  elevationLoss: number;
  calories: number;
  location: string;
  sportType: string;
  startPoint: GeoPoint | null;
  endPoint: GeoPoint | null;
  bounds: {
    minLat: number;
    maxLat: number;
    minLng: number;
    maxLng: number;
  } | null;
  hasTrack: boolean;
  source?: 'garmin' | 'strava';
  stravaUrl?: string; // e.g. https://www.strava.com/activities/12345
}

export interface TrackData {
  id: string;
  coords: [number, number][]; // [lng, lat] pairs (GeoJSON order)
  elevations?: number[];
  heartRates?: number[];
  timestamps?: number[];
}

export interface ActivityIndex {
  generatedAt: string;
  totalActivities: number;
  activitiesWithTracks: number;
  activities: ActivitySummary[];
}
