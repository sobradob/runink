import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import type { ActivitySummary, TrackData } from '@/types/activity';
import type { Theme } from '@/types/theme';
import type { PosterConfig, PosterDimensions, MapMarker, MarkerIcon } from '@/types/poster';
import { POSTER_PRESETS, DEFAULT_LAYERS } from '@/types/poster';
import { getDefaultTheme } from '@/features/theme/infrastructure/themeRepository';
import { useTrack, useTracks } from '@/features/data-import/hooks/useActivityData';
import { MapPreview } from '@/features/map/ui/MapPreview';
import { StatsOverlay } from './StatsOverlay';
import { SettingsPanel } from './SettingsPanel';
import { renderPosterToBlob, downloadBlob } from '../infrastructure/renderer';
import { OrderButton } from '@/features/checkout/ui/OrderButton';
import { formatDistance, formatDuration, formatPace, formatDate, formatElevation } from '@/shared/utils/format';

interface PosterEditorProps {
  activity?: ActivitySummary;
  activities?: ActivitySummary[];
  mode: 'individual' | 'compilation';
  stravaTracksMap?: Record<string, TrackData>;
  onBack: () => void;
}

/** Generate km markers along a track */
function generateKmMarkers(track: TrackData): MapMarker[] {
  const markers: MapMarker[] = [];
  if (track.coords.length < 2) return markers;

  const [startLng, startLat] = track.coords[0];
  markers.push({ id: 'start', lat: startLat, lng: startLng, label: 'Start', type: 'start' });

  const [endLng, endLat] = track.coords[track.coords.length - 1];
  markers.push({ id: 'finish', lat: endLat, lng: endLng, label: 'Finish', type: 'finish' });

  let totalDist = 0;
  let nextKm = 1;
  for (let i = 1; i < track.coords.length; i++) {
    const [lng1, lat1] = track.coords[i - 1];
    const [lng2, lat2] = track.coords[i];
    const segDist = haversineM(lat1, lng1, lat2, lng2);
    totalDist += segDist;

    while (totalDist >= nextKm * 1000) {
      const overshoot = totalDist - nextKm * 1000;
      const frac = 1 - overshoot / segDist;
      const mLat = lat1 + (lat2 - lat1) * frac;
      const mLng = lng1 + (lng2 - lng1) * frac;
      markers.push({ id: `km-${nextKm}`, lat: mLat, lng: mLng, label: `${nextKm}`, type: 'km' });
      nextKm++;
    }
  }

  return markers;
}

function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function PosterEditor({ activity, activities, mode, stravaTracksMap, onBack }: PosterEditorProps) {
  const [config, setConfig] = useState<PosterConfig>({
    mode,
    themeId: 'noir',
    dimensions: POSTER_PRESETS[0],
    title: mode === 'individual'
      ? (activity?.location || activity?.name || '')
      : (activities?.[0]?.location || ''),
    subtitle: mode === 'individual'
      ? formatDate(activity?.date ?? '')
      : '',
    showStats: true,
    showCoordinates: true,
    showGradientFade: true,
    padding: 0.15,
    bearing: 0,
    layers: { ...DEFAULT_LAYERS },
    markers: [],
  });

  const [theme, setTheme] = useState<Theme>(getDefaultTheme());
  const [exporting, setExporting] = useState(false);
  const [showKmMarkers, setShowKmMarkers] = useState(false);
  const [showStartFinish, setShowStartFinish] = useState(true);

  // Marker placement state
  const [placingIcon, setPlacingIcon] = useState<MarkerIcon | null>(null);
  const mapInstanceRef = useRef<maplibregl.Map | null>(null);

  // Load track data (Strava tracks are in-memory, Garmin tracks fetched from files)
  const { track: singleTrack } = useTrack(mode === 'individual' ? activity?.id ?? null : null, stravaTracksMap);
  const { tracks: compilationTracks, loadTracks } = useTracks(stravaTracksMap);

  useEffect(() => {
    if (mode === 'compilation' && activities) {
      loadTracks(activities.map((a) => a.id));
    }
  }, [mode, activities, loadTracks]);

  const tracks: TrackData[] = mode === 'individual'
    ? (singleTrack ? [singleTrack] : [])
    : compilationTracks;

  // Auto-generate markers from tracks
  const autoMarkers = useMemo(() => {
    if (mode === 'compilation' || tracks.length === 0) return [];
    const track = tracks[0];
    const all = generateKmMarkers(track);
    const result: MapMarker[] = [];
    if (showStartFinish) {
      result.push(...all.filter((m) => m.type === 'start' || m.type === 'finish'));
    }
    if (showKmMarkers) {
      result.push(...all.filter((m) => m.type === 'km'));
    }
    return result;
  }, [tracks, mode, showKmMarkers, showStartFinish]);

  const allMarkers = useMemo(() => {
    return [...autoMarkers, ...config.markers];
  }, [autoMarkers, config.markers]);

  const handleConfigChange = useCallback((update: Partial<PosterConfig>) => {
    setConfig((prev) => ({ ...prev, ...update }));
  }, []);

  const handleThemeChange = useCallback((newTheme: Theme) => {
    setTheme(newTheme);
    setConfig((prev) => ({ ...prev, themeId: newTheme.id }));
  }, []);

  // Handle map click for placing markers
  const handleMapReady = useCallback((map: maplibregl.Map) => {
    mapInstanceRef.current = map;
  }, []);

  // Set up click handler when placing mode is active
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    if (!placingIcon) {
      map.getCanvas().style.cursor = '';
      return;
    }

    map.getCanvas().style.cursor = 'crosshair';

    const onClick = (e: maplibregl.MapMouseEvent) => {
      const { lng, lat } = e.lngLat;
      const newMarker: MapMarker = {
        id: `custom-${Date.now()}`,
        lat,
        lng,
        label: '',
        type: 'custom',
        icon: placingIcon,
      };
      setConfig((prev) => ({
        ...prev,
        markers: [...prev.markers, newMarker],
      }));
      setPlacingIcon(null);
      map.getCanvas().style.cursor = '';
    };

    map.once('click', onClick);
    return () => {
      map.off('click', onClick);
      map.getCanvas().style.cursor = '';
    };
  }, [placingIcon]);

  const handleRemoveMarker = useCallback((markerId: string) => {
    setConfig((prev) => ({
      ...prev,
      markers: prev.markers.filter((m) => m.id !== markerId),
    }));
  }, []);

  const buildRenderOptions = useCallback(() => {
    const statsText: string[] = [];
    let coordinateText: string | undefined;

    if (mode === 'individual' && activity) {
      statsText.push(formatDistance(activity.distance));
      statsText.push(formatDuration(activity.movingDuration || activity.duration));
      statsText.push(formatPace(activity.avgPace));
      if (activity.elevationGain > 0) statsText.push(formatElevation(activity.elevationGain));
      if (activity.startPoint) {
        coordinateText = `${activity.startPoint.lat.toFixed(4)}°N, ${Math.abs(activity.startPoint.lng).toFixed(4)}°${activity.startPoint.lng >= 0 ? 'E' : 'W'}`;
      }
    } else if (activities) {
      const totalDist = activities.reduce((s, a) => s + a.distance, 0);
      const totalDur = activities.reduce((s, a) => s + (a.movingDuration || a.duration), 0);
      statsText.push(`${activities.length} runs`);
      statsText.push(formatDistance(totalDist));
      statsText.push(formatDuration(totalDur));
    }

    return {
      theme,
      tracks,
      config: { ...config, markers: allMarkers },
      title: config.title,
      subtitle: config.subtitle,
      statsText,
      coordinateText,
    };
  }, [theme, tracks, config, allMarkers, mode, activity, activities]);

  /** Render poster to PNG blob — used by both export and order flow.
   *  When printDimensions is provided (ordering), renders at those dimensions instead of editor config. */
  const renderPoster = useCallback(async (printDimensions?: PosterDimensions): Promise<Blob> => {
    const opts = buildRenderOptions();
    if (printDimensions) {
      opts.config = { ...opts.config, dimensions: printDimensions };
    }
    return renderPosterToBlob(opts);
  }, [buildRenderOptions]);

  const handleExport = useCallback(async () => {
    if (tracks.length === 0) return;
    setExporting(true);

    try {
      const blob = await renderPoster();
      const filename = `runink-${config.themeId}-${mode === 'individual' ? activity?.id : 'compilation'}.png`;
      downloadBlob(blob, filename);
    } catch (err) {
      console.error('Export failed:', err);
    } finally {
      setExporting(false);
    }
  }, [tracks, theme, config, allMarkers, mode, activity, activities]);

  const aspectRatio = config.dimensions.widthMm / config.dimensions.heightMm;

  return (
    <div className="h-screen flex">
      {/* Main area */}
      <div className="flex-1 flex flex-col bg-[#0a0a0a]">
        {/* Top bar */}
        <div className="h-12 flex items-center px-4 border-b border-white/10">
          <button
            onClick={onBack}
            className="text-white/40 hover:text-white text-sm flex items-center gap-2 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Back to activities
          </button>

          {/* Placing mode banner */}
          {placingIcon && (
            <div className="mx-auto flex items-center gap-2 text-sm text-yellow-400 animate-pulse">
              <span>Click on the map to place marker</span>
              <button
                onClick={() => setPlacingIcon(null)}
                className="text-xs px-2 py-0.5 rounded bg-white/10 text-white/60 hover:text-white"
              >
                Cancel
              </button>
            </div>
          )}

          <div className="ml-auto text-xs text-white/30">
            {mode === 'individual' ? activity?.name : `${activities?.length ?? 0} runs`}
          </div>
        </div>

        {/* Preview area */}
        <div className="flex-1 flex items-center justify-center p-8 overflow-hidden">
          <div
            className="relative shadow-2xl"
            style={{
              width: '100%',
              maxWidth: aspectRatio > 1 ? '80vh' : `${60 * aspectRatio}vh`,
              aspectRatio: String(aspectRatio),
              maxHeight: '80vh',
            }}
          >
            <MapPreview
              theme={theme}
              tracks={tracks}
              isCompilation={mode === 'compilation'}
              bearing={config.bearing}
              layers={config.layers}
              markers={allMarkers}
              className="rounded-sm"
              onMapReady={handleMapReady}
            />

            <StatsOverlay
              activity={activity}
              activities={activities}
              theme={theme}
              title={config.title}
              subtitle={config.subtitle}
              showStats={config.showStats}
              showCoordinates={config.showCoordinates}
              mode={mode}
            />

            {tracks.length === 0 && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                <div className="text-white/40 text-sm">Loading track data...</div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Settings sidebar */}
      <SettingsPanel
        config={config}
        theme={theme}
        mode={mode}
        showKmMarkers={showKmMarkers}
        showStartFinish={showStartFinish}
        placingIcon={placingIcon}
        onShowKmMarkersChange={setShowKmMarkers}
        onShowStartFinishChange={setShowStartFinish}
        onPlaceIcon={setPlacingIcon}
        onRemoveMarker={handleRemoveMarker}
        onConfigChange={handleConfigChange}
        onThemeChange={handleThemeChange}
        onExport={handleExport}
        exporting={exporting}
        orderButtonSlot={<OrderButton
          posterConfig={{
            ...config,
            activityId: activity?.id,
            activityIds: activities?.map(a => a.id),
          }}
          renderPoster={renderPoster}
        />}
      />
    </div>
  );
}
