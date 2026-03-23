import maplibregl from 'maplibre-gl';
import type { Theme } from '@/types/theme';
import type { TrackData } from '@/types/activity';
import type { PosterConfig } from '@/types/poster';
import { buildMapStyle } from '@/features/map/infrastructure/maplibreStyle';
import { addRunPathLayers, updateRunPaths, updateRunPathColors } from '@/features/map/infrastructure/runPathLayer';
import { boundsFromTracks, bboxToMaplibre } from '@/shared/geo/bounds';

interface RenderOptions {
  theme: Theme;
  tracks: TrackData[];
  config: PosterConfig;
  title: string;
  subtitle: string;
  statsText: string[];
  coordinateText?: string;
}

function mmToPixels(mm: number, dpi: number): number {
  return Math.round((mm / 25.4) * dpi);
}

export async function renderPosterToBlob(options: RenderOptions): Promise<Blob> {
  const { theme, tracks, config } = options;
  const width = mmToPixels(config.dimensions.widthMm, config.dimensions.dpi);
  const height = mmToPixels(config.dimensions.heightMm, config.dimensions.dpi);

  // Cap at reasonable resolution to avoid WebGL texture limits
  const maxSide = 4096;
  const scale = Math.min(1, maxSide / Math.max(width, height));
  const renderWidth = Math.round(width * scale);
  const renderHeight = Math.round(height * scale);

  // Create offscreen container
  const container = document.createElement('div');
  container.style.width = `${renderWidth}px`;
  container.style.height = `${renderHeight}px`;
  container.style.position = 'fixed';
  container.style.left = '-9999px';
  container.style.top = '-9999px';
  document.body.appendChild(container);

  try {
    // Render map
    const map = new maplibregl.Map({
      container,
      style: buildMapStyle(theme),
      attributionControl: false,
      interactive: false,
      canvasContextAttributes: { preserveDrawingBuffer: true },
    });

    await new Promise<void>((resolve) => {
      map.on('load', () => {
        addRunPathLayers(map, theme);
        updateRunPaths(map, tracks);
        updateRunPathColors(map, theme, config.mode === 'compilation');

        // Apply layer visibility
        const layerGroups: Record<string, string[]> = {
          water: ['water', 'waterway'],
          parks: ['landuse-park', 'landcover'],
          buildings: ['buildings'],
          roads: ['roads-primary', 'roads-secondary', 'roads-tertiary'],
          rail: ['rail'],
        };
        if (config.layers) {
          for (const [group, layerIds] of Object.entries(layerGroups)) {
            const visible = config.layers[group as keyof typeof config.layers];
            for (const id of layerIds) {
              if (map.getLayer(id)) {
                map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
              }
            }
          }
        }

        // Add markers
        if (config.markers && config.markers.length > 0) {
          map.addSource('markers', {
            type: 'geojson',
            data: {
              type: 'FeatureCollection',
              features: config.markers.map((m) => ({
                type: 'Feature' as const,
                properties: { label: m.label, type: m.type },
                geometry: { type: 'Point' as const, coordinates: [m.lng, m.lat] },
              })),
            },
          });
          map.addLayer({
            id: 'marker-circles',
            type: 'circle',
            source: 'markers',
            paint: {
              'circle-radius': ['match', ['get', 'type'], 'start', 5, 'finish', 5, 'km', 3, 4],
              'circle-color': theme.runPath.core,
              'circle-stroke-color': theme.colors.background,
              'circle-stroke-width': 2,
            },
          });
          map.addLayer({
            id: 'marker-labels',
            type: 'symbol',
            source: 'markers',
            layout: {
              'text-field': ['get', 'label'],
              'text-size': 11,
              'text-offset': [0, 1.5],
              'text-anchor': 'top',
              'text-font': ['Open Sans Regular'],
              'text-allow-overlap': true,
            },
            paint: {
              'text-color': theme.colors.text,
              'text-halo-color': theme.colors.background,
              'text-halo-width': 1.5,
            },
          });
        }

        if (tracks.length > 0) {
          const bbox = boundsFromTracks(tracks);
          map.fitBounds(bboxToMaplibre(bbox, config.padding), {
            animate: false,
            bearing: config.bearing,
          });
        }

        // Wait for tiles
        map.once('idle', () => resolve());
      });
    });

    // Capture map canvas
    const mapCanvas = map.getCanvas();

    // Composite onto final canvas
    const canvas = document.createElement('canvas');
    canvas.width = renderWidth;
    canvas.height = renderHeight;
    const ctx = canvas.getContext('2d')!;

    // Draw map
    ctx.drawImage(mapCanvas, 0, 0, renderWidth, renderHeight);

    // Gradient fade at bottom
    if (config.showGradientFade) {
      const fadeHeight = renderHeight * 0.3;
      const gradient = ctx.createLinearGradient(0, renderHeight - fadeHeight, 0, renderHeight);
      gradient.addColorStop(0, 'transparent');
      gradient.addColorStop(0.5, `${theme.colors.background}aa`);
      gradient.addColorStop(1, `${theme.colors.background}ee`);
      ctx.fillStyle = gradient;
      ctx.fillRect(0, renderHeight - fadeHeight, renderWidth, fadeHeight);

      // Top fade (subtle)
      const topGradient = ctx.createLinearGradient(0, 0, 0, renderHeight * 0.1);
      topGradient.addColorStop(0, `${theme.colors.background}66`);
      topGradient.addColorStop(1, 'transparent');
      ctx.fillStyle = topGradient;
      ctx.fillRect(0, 0, renderWidth, renderHeight * 0.1);
    }

    // Draw title text
    const fontSize = Math.round(renderWidth * 0.04);
    const padding = Math.round(renderWidth * 0.05);

    ctx.textBaseline = 'bottom';

    // Title
    ctx.font = `${fontSize}px "Bebas Neue", sans-serif`;
    ctx.fillStyle = theme.colors.text;
    ctx.letterSpacing = '0.15em';
    ctx.fillText(
      (options.title || '').toUpperCase(),
      padding,
      renderHeight - padding - fontSize * 1.5
    );

    // Subtitle
    const subFontSize = Math.round(fontSize * 0.45);
    ctx.font = `${subFontSize}px "Space Grotesk", sans-serif`;
    ctx.fillStyle = theme.colors.textSecondary;
    ctx.letterSpacing = '0.1em';
    ctx.fillText(
      (options.subtitle || '').toUpperCase(),
      padding,
      renderHeight - padding - fontSize * 0.5
    );

    // Stats row
    if (config.showStats && options.statsText.length > 0) {
      const statFontSize = Math.round(fontSize * 0.3);
      ctx.font = `${statFontSize}px "Space Grotesk", sans-serif`;
      ctx.fillStyle = theme.colors.textSecondary;
      ctx.letterSpacing = '0.05em';
      const statsStr = options.statsText.join('  ·  ');
      ctx.fillText(statsStr, padding, renderHeight - padding);
    }

    // Coordinates
    if (config.showCoordinates && options.coordinateText) {
      const coordFontSize = Math.round(fontSize * 0.2);
      ctx.font = `${coordFontSize}px "Space Grotesk", sans-serif`;
      ctx.fillStyle = theme.colors.textSecondary + '80';
      ctx.textAlign = 'right';
      ctx.fillText(options.coordinateText, renderWidth - padding, renderHeight - padding);
      ctx.textAlign = 'left';
    }

    // Cleanup map
    map.remove();

    // Convert to blob
    return new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob);
          else reject(new Error('Failed to create PNG blob'));
        },
        'image/png'
      );
    });
  } finally {
    document.body.removeChild(container);
  }
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
