import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import type { Theme } from '@/types/theme';
import type { TrackData } from '@/types/activity';
import { buildMapStyle } from '../infrastructure/maplibreStyle';
import { addRunPathLayers, updateRunPaths, updateRunPathColors } from '../infrastructure/runPathLayer';
import { boundsFromTracks, bboxToMaplibre } from '@/shared/geo/bounds';

interface MapPreviewProps {
  theme: Theme;
  tracks: TrackData[];
  isCompilation: boolean;
  className?: string;
}

export function MapPreview({ theme, tracks, isCompilation, className }: MapPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const readyRef = useRef(false);
  const tracksRef = useRef(tracks);
  const themeRef = useRef(theme);
  const compilationRef = useRef(isCompilation);
  tracksRef.current = tracks;
  themeRef.current = theme;
  compilationRef.current = isCompilation;

  // Initialize map once, after layout
  useEffect(() => {
    if (!containerRef.current) return;

    // Wait a frame so the container has its layout dimensions
    const rafId = requestAnimationFrame(() => {
      if (!containerRef.current) return;

      const map = new maplibregl.Map({
        container: containerRef.current,
        style: buildMapStyle(themeRef.current),
        center: [-0.1276, 51.5074],
        zoom: 12,
        preserveDrawingBuffer: true,
        attributionControl: false,
      });

      // Resize observer to handle container dimension changes
      const ro = new ResizeObserver(() => {
        map.resize();
      });
      ro.observe(containerRef.current);

      map.on('load', () => {
        readyRef.current = true;
        addRunPathLayers(map, themeRef.current);
        updateRunPathColors(map, themeRef.current, compilationRef.current);

        const currentTracks = tracksRef.current;
        if (currentTracks.length > 0) {
          updateRunPaths(map, currentTracks);
          const bbox = boundsFromTracks(currentTracks);
          map.fitBounds(bboxToMaplibre(bbox, 0.15), { animate: false });
        }
      });

      mapRef.current = map;

      // Cleanup
      const container = containerRef.current;
      return () => {
        ro.disconnect();
      };
    });

    return () => {
      cancelAnimationFrame(rafId);
      readyRef.current = false;
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

    map.setStyle(buildMapStyle(theme));
    map.once('style.load', () => {
      addRunPathLayers(map, theme);
      updateRunPaths(map, tracksRef.current);
      updateRunPathColors(map, theme, compilationRef.current);
    });
  }, [theme.id]);

  // Update tracks when they change
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;

    addRunPathLayers(map, themeRef.current);
    updateRunPaths(map, tracks);
    updateRunPathColors(map, themeRef.current, isCompilation);

    if (tracks.length > 0) {
      const bbox = boundsFromTracks(tracks);
      map.fitBounds(bboxToMaplibre(bbox, 0.15), { animate: true, duration: 800 });
    }
  }, [tracks]);

  // Update compilation mode colors
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    updateRunPathColors(map, theme, isCompilation);
  }, [isCompilation, theme.id]);

  return (
    <div
      ref={containerRef}
      className={`w-full h-full ${className ?? ''}`}
      style={{ minHeight: 400 }}
    />
  );
}
