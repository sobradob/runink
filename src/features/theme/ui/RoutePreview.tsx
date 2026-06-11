import { useId, useMemo } from 'react';
import type { TrackData } from '@/types/activity';
import type { Theme } from '@/types/theme';
import { boundsFromTracks } from '@/shared/geo/bounds';

/** Square viewBox; preserveAspectRatio letterboxes the route inside it. */
const VIEW = 100;
const PAD = 16;
const MAX_TRACKS = 12;
const MAX_POINTS_PER_TRACK = 80;

/** Decorative S-curve shown while tracks are still loading. */
const PLACEHOLDER_PATH = 'M 18 72 C 34 26, 58 86, 84 34';

/** Project + downsample tracks into SVG polyline point strings fitted to the
 *  preview viewBox. Geometry is theme-independent, so compute it once and
 *  share it across every theme chip. */
export function useRoutePreviewPoints(tracks: TrackData[]): string[] {
  return useMemo(() => {
    const used = tracks.filter((t) => t.coords.length > 1).slice(0, MAX_TRACKS);
    if (used.length === 0) return [];

    const bbox = boundsFromTracks(used);
    // Equirectangular projection with latitude correction — plenty for a
    // chip-sized preview of a single run or a city-scale compilation.
    const kx = Math.cos(((bbox.minLat + bbox.maxLat) / 2) * (Math.PI / 180));
    const w = (bbox.maxLng - bbox.minLng) * kx;
    const h = bbox.maxLat - bbox.minLat;
    const scale = (VIEW - PAD * 2) / Math.max(w, h, 1e-9);
    const ox = (VIEW - w * scale) / 2;
    const oy = (VIEW - h * scale) / 2;

    return used.map((track) => {
      const step = Math.max(1, Math.ceil(track.coords.length / MAX_POINTS_PER_TRACK));
      const pts: string[] = [];
      const push = ([lng, lat]: [number, number]) => {
        const x = ox + (lng - bbox.minLng) * kx * scale;
        const y = VIEW - (oy + (lat - bbox.minLat) * scale);
        pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
      };
      for (let i = 0; i < track.coords.length - 1; i += step) push(track.coords[i]);
      push(track.coords[track.coords.length - 1]);
      return pts.join(' ');
    });
  }, [tracks]);
}

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
