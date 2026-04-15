import type { ActivitySummary } from '@/types/activity';
import type { Theme } from '@/types/theme';
import { formatDistance, formatDuration, formatPace, formatDate, formatElevation, formatHR } from '@/shared/utils/format';

interface StatsOverlayProps {
  activity?: ActivitySummary;
  activities?: ActivitySummary[];
  theme: Theme;
  title: string;
  subtitle: string;
  showStats: boolean;
  showCoordinates: boolean;
  mode: 'individual' | 'compilation';
}

export function StatsOverlay({
  activity,
  activities,
  theme,
  title,
  subtitle,
  showStats,
  showCoordinates,
  mode,
}: StatsOverlayProps) {
  const textColor = theme.colors.text;
  const secondaryColor = theme.colors.textSecondary;

  if (mode === 'individual' && activity) {
    return (
      <div
        data-stats-overlay
        className="absolute bottom-0 left-0 right-0 p-[4%] pointer-events-none"
        style={{
          background: `linear-gradient(transparent, ${theme.colors.background}cc, ${theme.colors.background})`,
        }}
      >
        {/* Title */}
        <div
          className="text-2xl tracking-[0.2em] uppercase mb-1"
          style={{ color: textColor, fontFamily: 'var(--font-display)' }}
        >
          {title || activity.location}
        </div>

        {/* Subtitle */}
        <div
          className="text-sm tracking-[0.15em] uppercase mb-4"
          style={{ color: secondaryColor, fontFamily: 'var(--font-body)' }}
        >
          {subtitle || formatDate(activity.date)}
        </div>

        {/* Stats row */}
        {showStats && (
          <div className="flex flex-wrap gap-x-6 gap-y-2" style={{ color: secondaryColor }}>
            <StatItem label="Distance" value={formatDistance(activity.distance)} color={textColor} />
            <StatItem label="Time" value={formatDuration(activity.movingDuration || activity.duration)} color={textColor} />
            <StatItem label="Pace" value={formatPace(activity.avgPace)} color={textColor} />
            {activity.elevationGain > 0 && (
              <StatItem label="Elevation" value={formatElevation(activity.elevationGain)} color={textColor} />
            )}
            {activity.avgHr && (
              <StatItem label="Avg HR" value={formatHR(activity.avgHr)} color={textColor} />
            )}
          </div>
        )}

        {/* Coordinates */}
        {showCoordinates && activity.startPoint && (
          <div
            className="mt-3 text-xs tracking-[0.1em]"
            style={{ color: secondaryColor, fontFamily: 'var(--font-body)' }}
          >
            {activity.startPoint.lat.toFixed(4)}°N, {Math.abs(activity.startPoint.lng).toFixed(4)}°
            {activity.startPoint.lng >= 0 ? 'E' : 'W'}
          </div>
        )}
      </div>
    );
  }

  // Compilation mode
  if (mode === 'compilation' && activities && activities.length > 0) {
    const totalDistance = activities.reduce((sum, a) => sum + a.distance, 0);
    const totalDuration = activities.reduce((sum, a) => sum + (a.movingDuration || a.duration), 0);
    const dateRange = `${formatDate(activities[activities.length - 1].date)} — ${formatDate(activities[0].date)}`;

    return (
      <div
        data-stats-overlay
        className="absolute bottom-0 left-0 right-0 p-[4%] pointer-events-none"
        style={{
          background: `linear-gradient(transparent, ${theme.colors.background}cc, ${theme.colors.background})`,
        }}
      >
        <div
          className="text-2xl tracking-[0.2em] uppercase mb-1"
          style={{ color: textColor, fontFamily: 'var(--font-display)' }}
        >
          {title || `${activities[0].location}`}
        </div>

        <div
          className="text-sm tracking-[0.15em] uppercase mb-4"
          style={{ color: secondaryColor, fontFamily: 'var(--font-body)' }}
        >
          {subtitle || dateRange}
        </div>

        {showStats && (
          <div className="flex gap-6" style={{ color: secondaryColor }}>
            <StatItem label="Runs" value={String(activities.length)} color={textColor} />
            <StatItem label="Total Distance" value={formatDistance(totalDistance)} color={textColor} />
            <StatItem label="Total Time" value={formatDuration(totalDuration)} color={textColor} />
          </div>
        )}
      </div>
    );
  }

  return null;
}

function StatItem({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wider opacity-60">{label}</div>
      <div className="text-sm font-medium" style={{ color }}>{value}</div>
    </div>
  );
}
