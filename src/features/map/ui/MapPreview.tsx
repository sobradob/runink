import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import type { Theme } from '@/types/theme';
import type { TrackData } from '@/types/activity';
import type { LayerVisibility, MapMarker } from '@/types/poster';
import { buildMapStyle } from '../infrastructure/maplibreStyle';
import { addRunPathLayers, updateRunPaths, updateRunPathColors } from '../infrastructure/runPathLayer';
import { boundsFromTracks, bboxToMaplibre } from '@/shared/geo/bounds';

const LAYER_GROUPS: Record<keyof LayerVisibility, string[]> = {
  water: ['water', 'waterway'],
  parks: ['landuse-park', 'landcover'],
  buildings: ['buildings'],
  roads: ['roads-primary', 'roads-secondary', 'roads-tertiary'],
  rail: ['rail'],
};

// Icon emoji lookup
const ICON_EMOJI: Record<string, string> = {
  home: '🏠', pin: '📍', heart: '❤️', star: '⭐', flag: '🏁', circle: '⬤',
};

interface MapPreviewProps {
  theme: Theme;
  tracks: TrackData[];
  isCompilation: boolean;
  bearing: number;
  layers: LayerVisibility;
  markers: MapMarker[];
  className?: string;
  onMapReady?: (map: maplibregl.Map) => void;
}

export function MapPreview({ theme, tracks, isCompilation, bearing, layers, markers, className, onMapReady }: MapPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const readyRef = useRef(false);
  // Track the actual track IDs to detect real changes vs reference changes
  const trackIdsRef = useRef<string>('');
  // Store HTML markers for cleanup
  const htmlMarkersRef = useRef<maplibregl.Marker[]>([]);

  // Refs for latest props
  const tracksRef = useRef(tracks);
  const themeRef = useRef(theme);
  const compilationRef = useRef(isCompilation);
  const bearingRef = useRef(bearing);
  const layersRef = useRef(layers);
  const markersRef = useRef(markers);
  const onMapReadyRef = useRef(onMapReady);
  tracksRef.current = tracks;
  themeRef.current = theme;
  compilationRef.current = isCompilation;
  bearingRef.current = bearing;
  layersRef.current = layers;
  markersRef.current = markers;
  onMapReadyRef.current = onMapReady;

  // Initialize map
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const timer = setTimeout(() => {
      if (!containerRef.current) return;

      const map = new maplibregl.Map({
        container: containerRef.current,
        style: buildMapStyle(themeRef.current),
        center: [-0.1276, 51.5074],
        zoom: 12,
        bearing: bearingRef.current,
        preserveDrawingBuffer: true,
        attributionControl: false,
        fadeDuration: 0,
      });

      mapRef.current = map;

      const ro = new ResizeObserver(() => map.resize());
      ro.observe(containerRef.current);

      map.on('load', () => {
        readyRef.current = true;
        map.resize();

        addRunPathLayers(map, themeRef.current);
        updateRunPathColors(map, themeRef.current, compilationRef.current);
        applyLayerVisibility(map, layersRef.current);
        syncHtmlMarkers(map, markersRef.current, themeRef.current, htmlMarkersRef);

        const currentTracks = tracksRef.current;
        if (currentTracks.length > 0) {
          updateRunPaths(map, currentTracks);
          trackIdsRef.current = currentTracks.map(t => t.id).join(',');
          const bbox = boundsFromTracks(currentTracks);
          map.fitBounds(bboxToMaplibre(bbox, 0.15), {
            animate: false,
            bearing: bearingRef.current,
          });
        }

        // Notify parent
        onMapReadyRef.current?.(map);

        // Force repaint
        map.triggerRepaint();
        requestAnimationFrame(() => { map.resize(); map.triggerRepaint(); });
        setTimeout(() => { map.resize(); map.triggerRepaint(); }, 200);
      });

      (el as any).__ro = ro;
    }, 100);

    return () => {
      clearTimeout(timer);
      readyRef.current = false;
      // Clean up HTML markers
      htmlMarkersRef.current.forEach(m => m.remove());
      htmlMarkersRef.current = [];
      if (containerRef.current && (containerRef.current as any).__ro) {
        (containerRef.current as any).__ro.disconnect();
      }
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  // Update style when theme changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;

    // setStyle triggers an async reload — re-add our layers once it's done.
    // MapLibre v5 fires 'style.load' but it can be unreliable, so we also
    // listen for 'idle' as a fallback and use a flag to run only once.
    let applied = false;
    const reapply = () => {
      if (applied) return;
      applied = true;
      addRunPathLayers(map, theme);
      updateRunPaths(map, tracksRef.current);
      updateRunPathColors(map, theme, compilationRef.current);
      applyLayerVisibility(map, layersRef.current);
      syncHtmlMarkers(map, markersRef.current, theme, htmlMarkersRef);
    };

    map.setStyle(buildMapStyle(theme));
    map.once('style.load', reapply);
    // Fallback: if style.load doesn't fire within 2s, force reapply on idle
    const fallback = setTimeout(() => {
      if (!applied) map.once('idle', reapply);
    }, 2000);

    return () => clearTimeout(fallback);
  }, [theme.id]);

  // Update tracks — only fitBounds when tracks actually change
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;

    addRunPathLayers(map, themeRef.current);
    updateRunPaths(map, tracks);
    updateRunPathColors(map, themeRef.current, isCompilation);

    // Only fit bounds if the actual track set changed (not just reference)
    const newTrackIds = tracks.map(t => t.id).join(',');
    if (tracks.length > 0 && newTrackIds !== trackIdsRef.current) {
      trackIdsRef.current = newTrackIds;
      const bbox = boundsFromTracks(tracks);
      map.fitBounds(bboxToMaplibre(bbox, 0.15), {
        animate: true,
        duration: 800,
        bearing: bearingRef.current,
      });
    }
  }, [tracks]);

  // Update bearing
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    map.rotateTo(bearing, { animate: true, duration: 300 });
  }, [bearing]);

  // Update compilation mode colors
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    updateRunPathColors(map, theme, isCompilation);
  }, [isCompilation, theme.id]);

  // Update layer visibility
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    applyLayerVisibility(map, layers);
  }, [layers]);

  // Update markers (HTML markers — no fitBounds, no map reset)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    syncHtmlMarkers(map, markers, themeRef.current, htmlMarkersRef);
  }, [markers]);

  return (
    <div
      ref={containerRef}
      className={`w-full h-full ${className ?? ''}`}
      style={{ minHeight: 300 }}
    />
  );
}

// === Layer visibility ===

function applyLayerVisibility(map: maplibregl.Map, layers: LayerVisibility) {
  for (const [group, layerIds] of Object.entries(LAYER_GROUPS)) {
    const visible = layers[group as keyof LayerVisibility];
    for (const id of layerIds) {
      if (map.getLayer(id)) {
        map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
      }
    }
  }
}

// === HTML Markers (icons + labels, positioned via MapLibre) ===

function syncHtmlMarkers(
  map: maplibregl.Map,
  markers: MapMarker[],
  theme: Theme,
  htmlMarkersRef: React.MutableRefObject<maplibregl.Marker[]>
) {
  // Remove old markers
  htmlMarkersRef.current.forEach(m => m.remove());
  htmlMarkersRef.current = [];

  for (const m of markers) {
    const el = document.createElement('div');
    el.style.display = 'flex';
    el.style.flexDirection = 'column';
    el.style.alignItems = 'center';
    el.style.pointerEvents = 'none';

    // Icon or dot
    const hasIcon = m.icon && m.icon !== 'none' && ICON_EMOJI[m.icon];
    if (hasIcon) {
      const iconEl = document.createElement('div');
      iconEl.textContent = ICON_EMOJI[m.icon!];
      iconEl.style.fontSize = m.type === 'km' ? '12px' : '20px';
      iconEl.style.filter = 'drop-shadow(0 1px 3px rgba(0,0,0,0.8))';
      iconEl.style.lineHeight = '1';
      el.appendChild(iconEl);
    } else {
      // Dot marker
      const dot = document.createElement('div');
      const size = m.type === 'km' ? 8 : 10;
      dot.style.width = `${size}px`;
      dot.style.height = `${size}px`;
      dot.style.borderRadius = '50%';
      dot.style.backgroundColor = theme.runPath.core;
      dot.style.border = `2px solid ${theme.colors.background}`;
      dot.style.boxShadow = `0 0 6px ${theme.runPath.glow}60`;
      el.appendChild(dot);
    }

    // Label
    if (m.label) {
      const labelEl = document.createElement('div');
      labelEl.textContent = m.label;
      labelEl.style.fontSize = m.type === 'km' ? '9px' : '10px';
      labelEl.style.color = theme.colors.text;
      labelEl.style.textShadow = `0 1px 3px ${theme.colors.background}, 0 0 6px ${theme.colors.background}`;
      labelEl.style.marginTop = '2px';
      labelEl.style.fontFamily = 'var(--font-body)';
      labelEl.style.fontWeight = '500';
      labelEl.style.letterSpacing = '0.05em';
      labelEl.style.whiteSpace = 'nowrap';
      el.appendChild(labelEl);
    }

    const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
      .setLngLat([m.lng, m.lat])
      .addTo(map);

    htmlMarkersRef.current.push(marker);
  }
}
