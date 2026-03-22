/** Format meters as km with 1 decimal */
export function formatDistance(meters: number): string {
  const km = meters / 1000;
  if (km >= 100) return `${Math.round(km)} km`;
  return `${km.toFixed(1)} km`;
}

/** Format seconds as H:MM:SS or M:SS */
export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);

  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** Format pace as M:SS /km */
export function formatPace(minPerKm: number): string {
  if (!minPerKm || !isFinite(minPerKm)) return '--:--';
  const m = Math.floor(minPerKm);
  const s = Math.round((minPerKm - m) * 60);
  return `${m}:${s.toString().padStart(2, '0')} /km`;
}

/** Format date as "12 Mar 2025" */
export function formatDate(isoDate: string): string {
  const d = new Date(isoDate);
  return d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/** Format elevation as "+123m" */
export function formatElevation(meters: number): string {
  return `+${Math.round(meters)}m`;
}

/** Format heart rate as "152 bpm" */
export function formatHR(hr: number | null): string {
  if (!hr) return '--';
  return `${Math.round(hr)} bpm`;
}
