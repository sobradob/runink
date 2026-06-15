import type { ActivitySummary } from '@/types/activity';

/** Strava `workout_type` codes that mean "race". 1 = run race, 11 = ride race.
 *  Many activities have no workout_type at all (null/undefined) — those are
 *  simply "not known to be a race", never surfaced on the race signal alone. */
const RACE_WORKOUT_TYPES = new Set([1, 11]);

/** A run/ride the athlete flagged as a race in Strava. Bonus hero signal —
 *  reliable when present, absent on most activities, so never the only ranker. */
export function isRace(activity: ActivitySummary): boolean {
  return activity.workoutType != null && RACE_WORKOUT_TYPES.has(activity.workoutType);
}

/**
 * Surface the runs most worth turning into a poster. Two signals the interview
 * settled on: longest distance (always reliable) and the Strava race flag
 * (a bonus when present). Races float to the top; within each group the
 * longest win. Only GPS-bearing activities can become posters.
 */
export function rankHeroRuns(activities: ActivitySummary[], limit = 4): ActivitySummary[] {
  return activities
    .filter((a) => a.hasTrack)
    .slice() // don't mutate caller's array
    .sort((a, b) => {
      const raceDelta = Number(isRace(b)) - Number(isRace(a));
      if (raceDelta !== 0) return raceDelta;
      return b.distance - a.distance;
    })
    .slice(0, limit);
}

export interface DistanceBand {
  id: string;
  label: string;
  /** inclusive lower bound, meters */
  minM: number;
  /** exclusive upper bound, meters (Infinity for open-ended) */
  maxM: number;
}

/** Distance buckets for the single-run filter. Boundaries chosen around
 *  familiar race distances so "marathons / long runs worth a poster" is a
 *  one-tap filter. */
export const DISTANCE_BANDS: DistanceBand[] = [
  { id: 'under5', label: 'Under 5K', minM: 0, maxM: 5000 },
  { id: '5to10', label: '5–10K', minM: 5000, maxM: 10000 },
  { id: '10to21', label: '10–21K', minM: 10000, maxM: 21097 },
  { id: '21plus', label: 'Half+ (21K+)', minM: 21097, maxM: Infinity },
];

export function matchesDistanceBand(activity: ActivitySummary, bandId: string | null): boolean {
  if (!bandId) return true;
  const band = DISTANCE_BANDS.find((b) => b.id === bandId);
  if (!band) return true;
  return activity.distance >= band.minM && activity.distance < band.maxM;
}
