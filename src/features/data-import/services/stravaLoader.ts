import type { ActivitySummary, TrackData } from '@/types/activity';

export interface StravaAuthStatus {
  connected: boolean;
  athlete?: { name: string; id: number };
}

export async function checkStravaAuth(): Promise<StravaAuthStatus> {
  try {
    const res = await fetch('/auth/strava/status');
    if (!res.ok) return { connected: false };
    return res.json();
  } catch {
    return { connected: false };
  }
}

export function initiateStravaAuth() {
  window.location.href = '/auth/strava';
}

export async function disconnectStrava(): Promise<void> {
  await fetch('/auth/strava/disconnect', { method: 'POST' });
}

export interface StravaActivitiesResponse {
  activities: ActivitySummary[];
  tracks: Record<string, TrackData>;
}

export async function loadStravaActivities(refresh = false): Promise<StravaActivitiesResponse> {
  const url = `/api/strava/activities${refresh ? '?refresh=true' : ''}`;
  const res = await fetch(url);

  if (!res.ok) {
    if (res.status === 401) throw new Error('Not connected to Strava');
    throw new Error(`Failed to load Strava activities: ${res.status}`);
  }

  return res.json();
}
