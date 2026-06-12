import { useMemo } from 'react';
import type { TrackData } from '@/types/activity';
import { boundsFromTracks } from '@/shared/geo/bounds';

/** Square viewBox; preserveAspectRatio letterboxes the route inside it. */
export const PREVIEW_VIEWBOX = 100;
const PAD = 16;
const MAX_TRACKS = 12;
const MAX_POINTS_PER_TRACK = 80;

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
    const scale = (PREVIEW_VIEWBOX - PAD * 2) / Math.max(w, h, 1e-9);
    const ox = (PREVIEW_VIEWBOX - w * scale) / 2;
    const oy = (PREVIEW_VIEWBOX - h * scale) / 2;

    return used.map((track) => {
      const step = Math.max(1, Math.ceil(track.coords.length / MAX_POINTS_PER_TRACK));
      const pts: string[] = [];
      const push = ([lng, lat]: [number, number]) => {
        const x = ox + (lng - bbox.minLng) * kx * scale;
        const y = PREVIEW_VIEWBOX - (oy + (lat - bbox.minLat) * scale);
        pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
      };
      for (let i = 0; i < track.coords.length - 1; i += step) push(track.coords[i]);
      push(track.coords[track.coords.length - 1]);
      return pts.join(' ');
    });
  }, [tracks]);
}
