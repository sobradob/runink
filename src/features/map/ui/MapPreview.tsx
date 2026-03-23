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
  bearing: number;
  className?: string;
}

export function MapPreview({ theme, tracks, isCompilation, bearing, className }: MapPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const readyRef = useRef(false);
  const tracksRef = useRef(tracks);
  const themeRef = useRef(theme);
  const compilationRef = useRef(isCompilation);
  const bearingRef = useRef(bearing);
  tracksRef.current = tracks;
  themeRef.current = theme;
  compilationRef.current = isCompilation;
  bearingRef.current = bearing;

  // Initialize map once, after layout
  useEffect(() => {
    if (!containerRef.current) return;

    const rafId = requestAnimationFrame(() => {
      if (!containerRef.current) return;

      const map = new maplibregl.Map({
        container: containerRef.current,
        style: buildMapStyle(themeRef.current),
        center: [-0.1276, 51.5074],
        zoom: 12,
        bearing: bearingRef.current,
        preserveDrawingBuffer: true,
        attributionControl: false,
      });

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
          map.fitBounds(bboxToMaplibre(bbox, 0.15), {
            animate: false,
            bearing: bearingRef.current,
          });
        }
      });

      mapRef.current = map;
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

  return (
    <div
      ref={containerRef}
      className={`w-full h-full ${className ?? ''}`}
      style={{ minHeight: 400 }}
    />
  );
}
