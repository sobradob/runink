import type { ActivitySummary } from '@/types/activity';
import type { Theme } from '@/types/theme';
import { formatDistance, formatDuration, formatPace, formatDate, formatElevation, formatHR } from '@/shared/utils/format';

// Type sizes and spacing are expressed in `cqw` (container-query width units,
// 1cqw = 1% of the poster container's width) instead of fixed pixels. This is
// what makes the on-screen editor preview, the server-side Playwright export,
// and the client capture render the text at the SAME proportion regardless of
// canvas size or DPI — the old fixed px (text-2xl etc.) looked large in the
// ~400px preview but shrank to nothing in a ~1800px export.
//
// These resolve against the nearest ancestor with `container-type: inline-size`
// (PosterEditor's preview wrapper and InternalRenderPage's [data-poster-root]).
//
// Reference width ~400px: e.g. the title was 24px (text-2xl), 24 / 400 = 6cqw.
const TYPE = {
  title: '6cqw',      // was text-2xl (24px)
  subtitle: '3.5cqw', // was text-sm (14px)
  statValue: '3.5cqw',// was text-sm (14px)
  statLabel: '3cqw',  // was text-xs (12px)
  coords: '3cqw',     // was text-xs (12px)
} as const;

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
          className="tracking-[0.2em] uppercase mb-[1cqw]"
          style={{ color: textColor, fontFamily: 'var(--font-display)', fontSize: TYPE.title }}
        >
          {title || activity.location}
        </div>

        {/* Subtitle */}
        <div
          className="tracking-[0.15em] uppercase mb-[4cqw]"
          style={{ color: secondaryColor, fontFamily: 'var(--font-body)', fontSize: TYPE.subtitle }}
        >
          {subtitle || formatDate(activity.date)}
        </div>

        {/* Stats row */}
        {showStats && (
          <div className="flex flex-wrap gap-x-[6cqw] gap-y-[2cqw]" style={{ color: secondaryColor }}>
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
            className="mt-[3cqw] tracking-[0.1em]"
            style={{ color: secondaryColor, fontFamily: 'var(--font-body)', fontSize: TYPE.coords }}
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
          className="tracking-[0.2em] uppercase mb-[1cqw]"
          style={{ color: textColor, fontFamily: 'var(--font-display)', fontSize: TYPE.title }}
        >
          {title || `${activities[0].location}`}
        </div>

        <div
          className="tracking-[0.15em] uppercase mb-[4cqw]"
          style={{ color: secondaryColor, fontFamily: 'var(--font-body)', fontSize: TYPE.subtitle }}
        >
          {subtitle || dateRange}
        </div>

        {showStats && (
          <div className="flex gap-[6cqw]" style={{ color: secondaryColor }}>
            <StatItem label="Runs" value={String(activities.length)} color={textColor} />
            <StatItem label="Combined Distance" value={formatDistance(totalDistance)} color={textColor} />
            <StatItem label="Combined Time" value={formatDuration(totalDuration)} color={textColor} />
          </div>
        )}
      </div>
    );
  }

  return null;
}

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

function StatItem({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div>
      <div className="uppercase tracking-wider opacity-60" style={{ fontSize: TYPE.statLabel }}>{label}</div>
      <div className="font-medium" style={{ color, fontSize: TYPE.statValue }}>{value}</div>
    </div>
  );
}
