import type { Map as MaplibreMap, GeoJSONSource } from 'maplibre-gl';
import type { Theme } from '@/types/theme';
import type { TrackData } from '@/types/activity';

const SOURCE_ID = 'run-tracks';
const GLOW_LAYER_ID = 'run-tracks-glow';
const CORE_LAYER_ID = 'run-tracks-core';

// Route line widths (and the marker sizes in MapPreview) are fixed pixel values
// tuned against a ~400px-wide poster. Without scaling they stay constant while
// the poster grows from the ~360px mobile preview to the ~1080–1772px render
// layout, so the line looks bold in the editor but renders 2–3× thinner. We
// scale every fixed-px size by (mapWidthPx / 400) — the SAME reference the
// StatsOverlay text uses via cqw — so the line keeps a constant proportion of
// the poster across preview and export. See tasks/preview-vs-render-analysis.md.
export const POSTER_REFERENCE_WIDTH = 400;

/** Scale factor for fixed-px sizes, from the map container's current width. */
export function posterScale(map: MaplibreMap): number {
  const w = map.getContainer()?.clientWidth || POSTER_REFERENCE_WIDTH;
  return Math.max(0.5, w / POSTER_REFERENCE_WIDTH);
}

function tracksToGeoJSON(tracks: TrackData[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: tracks.map((track) => ({
      type: 'Feature',
      properties: { id: track.id },
      geometry: {
        type: 'LineString',
        coordinates: track.coords,
      },
    })),
  };
}

export function addRunPathLayers(map: MaplibreMap, theme: Theme) {
  if (!map.getSource(SOURCE_ID)) {
    map.addSource(SOURCE_ID, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });
  }

  const s = posterScale(map);

  if (!map.getLayer(GLOW_LAYER_ID)) {
    map.addLayer({
      id: GLOW_LAYER_ID,
      type: 'line',
      source: SOURCE_ID,
      paint: {
        'line-color': theme.runPath.glow,
        'line-width': 8 * s,
        'line-opacity': 0.3,
        'line-blur': 6 * s,
      },
      layout: { 'line-cap': 'round', 'line-join': 'round' },
    });
  }

  if (!map.getLayer(CORE_LAYER_ID)) {
    map.addLayer({
      id: CORE_LAYER_ID,
      type: 'line',
      source: SOURCE_ID,
      paint: {
        'line-color': theme.runPath.core,
        'line-width': 2.5 * s,
        'line-opacity': 0.9,
      },
      layout: { 'line-cap': 'round', 'line-join': 'round' },
    });
  }
}

export function updateRunPaths(map: MaplibreMap, tracks: TrackData[]) {
  const source = map.getSource(SOURCE_ID);
  if (source && 'setData' in source) {
    (source as GeoJSONSource).setData(tracksToGeoJSON(tracks));
  }
}

// Single source of truth for run-path paint: color, opacity, width AND blur,
// all scaled by the map's current width. Safe to re-call on container resize.
export function updateRunPathColors(map: MaplibreMap, theme: Theme, isCompilation: boolean) {
  const pathColor = isCompilation ? theme.runPath.compilation : theme.runPath.core;
  const glowColor = theme.runPath.glow;
  const s = posterScale(map);

  if (map.getLayer(GLOW_LAYER_ID)) {
    map.setPaintProperty(GLOW_LAYER_ID, 'line-color', glowColor);
    map.setPaintProperty(GLOW_LAYER_ID, 'line-opacity', isCompilation ? 0.15 : 0.3);
    map.setPaintProperty(GLOW_LAYER_ID, 'line-width', (isCompilation ? 6 : 8) * s);
    map.setPaintProperty(GLOW_LAYER_ID, 'line-blur', 6 * s);
  }

  if (map.getLayer(CORE_LAYER_ID)) {
    map.setPaintProperty(CORE_LAYER_ID, 'line-color', pathColor);
    map.setPaintProperty(CORE_LAYER_ID, 'line-opacity', isCompilation ? 0.5 : 0.9);
    map.setPaintProperty(CORE_LAYER_ID, 'line-width', (isCompilation ? 1.5 : 2.5) * s);
  }
}

export function removeRunPathLayers(map: MaplibreMap) {
  if (map.getLayer(CORE_LAYER_ID)) map.removeLayer(CORE_LAYER_ID);
  if (map.getLayer(GLOW_LAYER_ID)) map.removeLayer(GLOW_LAYER_ID);
  if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
}
