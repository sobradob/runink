import type { Theme } from '@/types/theme';
import type { StyleSpecification } from 'maplibre-gl';

// Cache the resolved tile URL from the TileJSON endpoint
let resolvedTileUrl: string | null = null;

async function resolveTileUrl(): Promise<string> {
  if (resolvedTileUrl) return resolvedTileUrl;
  try {
    const res = await fetch('https://tiles.openfreemap.org/planet');
    const json = await res.json();
    resolvedTileUrl = json.tiles[0];
  } catch {
    // Fallback to direct pattern
    resolvedTileUrl = 'https://tiles.openfreemap.org/planet/{z}/{x}/{y}.pbf';
  }
  return resolvedTileUrl!;
}

// Pre-resolve on module load
resolveTileUrl();

export function buildMapStyle(theme: Theme): StyleSpecification {
  const c = theme.colors;

  // Use resolved URL or fallback
  const tileUrl = resolvedTileUrl || 'https://tiles.openfreemap.org/planet/{z}/{x}/{y}.pbf';

  return {
    version: 8,
    name: `runink-${theme.id}`,
    sources: {
      openmaptiles: {
        type: 'vector',
        tiles: [tileUrl],
        maxzoom: 14,
      },
    },
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    layers: [
      // Background
      {
        id: 'background',
        type: 'background',
        paint: { 'background-color': c.land },
      },
      // Water
      {
        id: 'water',
        type: 'fill',
        source: 'openmaptiles',
        'source-layer': 'water',
        paint: { 'fill-color': c.water },
      },
      // Parks / landuse
      {
        id: 'landuse-park',
        type: 'fill',
        source: 'openmaptiles',
        'source-layer': 'landuse',
        filter: ['in', 'class', 'park', 'garden', 'cemetery', 'grass'],
        paint: { 'fill-color': c.parks },
      },
      // Landcover (forest, etc)
      {
        id: 'landcover',
        type: 'fill',
        source: 'openmaptiles',
        'source-layer': 'landcover',
        filter: ['in', 'class', 'wood', 'grass'],
        paint: { 'fill-color': c.parks, 'fill-opacity': 0.5 },
      },
      // Buildings
      {
        id: 'buildings',
        type: 'fill',
        source: 'openmaptiles',
        'source-layer': 'building',
        paint: { 'fill-color': c.buildings, 'fill-opacity': 0.8 },
      },
      // Rail
      {
        id: 'rail',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'transportation',
        filter: ['==', 'class', 'rail'],
        paint: {
          'line-color': c.rail,
          'line-width': 0.8,
          'line-dasharray': [4, 4],
        },
      },
      // Roads - tertiary
      {
        id: 'roads-tertiary',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'transportation',
        filter: ['in', 'class', 'minor', 'service', 'track', 'path'],
        paint: {
          'line-color': c.roads.tertiary,
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.3, 14, 1],
        },
        layout: { 'line-cap': 'round', 'line-join': 'round' },
      },
      // Roads - secondary
      {
        id: 'roads-secondary',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'transportation',
        filter: ['in', 'class', 'secondary', 'tertiary'],
        paint: {
          'line-color': c.roads.secondary,
          'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.5, 14, 2],
        },
        layout: { 'line-cap': 'round', 'line-join': 'round' },
      },
      // Roads - primary
      {
        id: 'roads-primary',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'transportation',
        filter: ['in', 'class', 'primary', 'trunk', 'motorway'],
        paint: {
          'line-color': c.roads.primary,
          'line-width': ['interpolate', ['linear'], ['zoom'], 6, 0.5, 14, 3],
        },
        layout: { 'line-cap': 'round', 'line-join': 'round' },
      },
      // Waterway lines
      {
        id: 'waterway',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'waterway',
        paint: {
          'line-color': c.water,
          'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.5, 14, 2],
        },
      },
    ],
  };
}
