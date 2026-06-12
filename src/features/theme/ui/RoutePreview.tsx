import { useId } from 'react';
import type { Theme } from '@/types/theme';
import { PREVIEW_VIEWBOX as VIEW } from './routePreviewGeometry';

/** Decorative S-curve shown while tracks are still loading. */
const PLACEHOLDER_PATH = 'M 18 72 C 34 26, 58 86, 84 34';

interface RoutePreviewProps {
  theme: Theme;
  /** From useRoutePreviewPoints — empty array falls back to a placeholder curve */
  points: string[];
  isCompilation?: boolean;
  className?: string;
}

/** Mini poster: the user's actual route drawn on a theme's colors — land
 *  background fading into the stats-block background, glow + core strokes
 *  matching the real run-path layers. */
export function RoutePreview({ theme, points, isCompilation, className }: RoutePreviewProps) {
  const gradientId = useId();
  const core = isCompilation ? theme.runPath.compilation : theme.runPath.core;
  const coreWidth = isCompilation ? 1.4 : 2.4;
  const glowWidth = isCompilation ? 4 : 7;
  const stroke = {
    fill: 'none',
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };

  return (
    <svg
      viewBox={`0 0 ${VIEW} ${VIEW}`}
      className={className}
      preserveAspectRatio="xMidYMid slice"
      role="img"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="55%" stopColor={theme.colors.background} stopOpacity="0" />
          <stop offset="100%" stopColor={theme.colors.background} stopOpacity="0.9" />
        </linearGradient>
      </defs>
      <rect width={VIEW} height={VIEW} fill={theme.colors.land} />
      {points.length === 0 ? (
        <>
          <path d={PLACEHOLDER_PATH} {...stroke} stroke={theme.runPath.glow} strokeWidth={glowWidth} opacity={0.35} />
          <path d={PLACEHOLDER_PATH} {...stroke} stroke={theme.runPath.core} strokeWidth={coreWidth} opacity={0.9} />
        </>
      ) : (
        <>
          {points.map((p, i) => (
            <polyline key={`g${i}`} points={p} {...stroke} stroke={theme.runPath.glow} strokeWidth={glowWidth} opacity={isCompilation ? 0.18 : 0.35} />
          ))}
          {points.map((p, i) => (
            <polyline key={`c${i}`} points={p} {...stroke} stroke={core} strokeWidth={coreWidth} opacity={isCompilation ? 0.6 : 0.9} />
          ))}
        </>
      )}
      <rect width={VIEW} height={VIEW} fill={`url(#${gradientId})`} />
    </svg>
  );
}
