import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import type { ActivitySummary, TrackData } from '@/types/activity';
import type { Theme } from '@/types/theme';
import type { PosterConfig, PosterDimensions, MapMarker, MarkerIcon } from '@/types/poster';
import { POSTER_PRESETS, DEFAULT_LAYERS } from '@/types/poster';
import { PRINT_DIMENSIONS } from '@/features/checkout/ui/tiers';

/** Map a gift tier ID to the matching POSTER_PRESETS entry */
function presetForTier(tierId: string): typeof POSTER_PRESETS[number] {
  const dims = PRINT_DIMENSIONS[tierId];
  if (dims) {
    const match = POSTER_PRESETS.find(
      (p) => p.widthMm === dims.widthMm && p.heightMm === dims.heightMm,
    );
    if (match) return match;
  }
  return POSTER_PRESETS[0];
}
import { getDefaultTheme } from '@/features/theme/infrastructure/themeRepository';

import { useTrack, useTracks } from '@/features/data-import/hooks/useActivityData';
import { MapPreview } from '@/features/map/ui/MapPreview';
import { StatsOverlay } from './StatsOverlay';
import { SettingsPanel, SettingsActions } from './SettingsPanel';
import { MobileSettingsSheet } from './MobileSettingsSheet';
import { renderPosterToBlob, downloadBlob } from '../infrastructure/renderer';
import { capturePosterToBlob } from '../infrastructure/renderer/captureRenderer';

/** Flip to false to fall back to the old Canvas-based renderer */
const USE_CAPTURE_RENDERER = true;

/** When true (set VITE_RENDER_ON_SERVER=true), paid-print orders use the
 *  server-side Playwright renderer instead of rendering in the browser.
 *  Guarantees WYSIWYG fidelity and full print DPI on every device. See
 *  server/lib/poster-renderer.ts. Default: off, so rollout is gated. */
const RENDER_ON_SERVER = import.meta.env.VITE_RENDER_ON_SERVER === 'true';
import { OrderButton } from '@/features/checkout/ui/OrderButton';
import { GiftOrderButton } from '@/features/checkout/ui/GiftOrderButton';
import {
  getUploadUrl,
  renderPosterOnServer,
  uploadPosterPng,
  type GiftContext,
} from '@/features/checkout/services/checkoutApi';
import { formatDistance, formatDuration, formatPace, formatDate, formatElevation } from '@/shared/utils/format';

interface PosterEditorProps {
  activity?: ActivitySummary;
  activities?: ActivitySummary[];
  mode: 'individual' | 'compilation';
  stravaTracksMap?: Record<string, TrackData>;
  onBack: () => void;
  giftContext?: GiftContext | null;
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

export function PosterEditor({ activity, activities, mode, stravaTracksMap, onBack, giftContext }: PosterEditorProps) {
  const [config, setConfig] = useState<PosterConfig>({
    mode,
    themeId: 'noir',
    dimensions: giftContext ? presetForTier(giftContext.tier) : POSTER_PRESETS[0],
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
  const previewContainerRef = useRef<HTMLDivElement>(null);
  const collapseSheetRef = useRef<(() => void) | null>(null);

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
   *  When printDimensions is provided (ordering), always use the canvas renderer for
   *  full-resolution output. The capture renderer is only used for free PNG exports
   *  where speed matters and preview-quality is acceptable. */
  const renderPoster = useCallback(async (printDimensions?: PosterDimensions): Promise<Blob> => {
    // For paid prints: always use canvas renderer at full resolution
    if (printDimensions) {
      const opts = buildRenderOptions();
      opts.config = { ...opts.config, dimensions: printDimensions };
      return renderPosterToBlob(opts);
    }

    // For free exports: use capture renderer (fast, WYSIWYG from preview)
    if (USE_CAPTURE_RENDERER && previewContainerRef.current && mapInstanceRef.current) {
      try {
        return await capturePosterToBlob({
          element: previewContainerRef.current,
          map: mapInstanceRef.current,
          dimensions: config.dimensions,
        });
      } catch (e: any) {
        if (e.message === 'MAP_BLANK') {
          console.warn('[render] Capture renderer detected blank map, using canvas fallback');
        } else {
          throw e;
        }
      }
    }
    // Fallback to canvas renderer
    return renderPosterToBlob(buildRenderOptions());
  }, [buildRenderOptions, config.dimensions]);

  /** Render + upload for the paid-order flow. Dispatches to either the
   *  server-side Playwright renderer or the legacy client-render-then-upload
   *  path based on the VITE_RENDER_ON_SERVER flag. OrderButton and
   *  GiftOrderButton both call this once per order. */
  const submitPoster = useCallback(async (
    orderId: string,
    printDimensions?: PosterDimensions,
  ): Promise<void> => {
    if (RENDER_ON_SERVER) {
      const opts = buildRenderOptions();
      const dims = printDimensions ?? config.dimensions;
      // Payload mirrors the preview's own component inputs so the internal
      // render page can mount identical components.
      const payload = {
        theme: opts.theme,
        config: { ...opts.config, dimensions: dims },
        tracks: opts.tracks,
        mode,
        activity,
        activities,
        title: opts.title,
        subtitle: opts.subtitle,
        showStats: config.showStats,
        showCoordinates: config.showCoordinates,
      };
      await renderPosterOnServer(orderId, payload, {
        widthMm: dims.widthMm,
        heightMm: dims.heightMm,
        dpi: dims.dpi,
        tierId: dims.tierId,
      });
      return;
    }

    // Legacy client-side flow — render in browser, then upload to R2.
    const blob = await renderPoster(printDimensions);
    const { url, method, local } = await getUploadUrl(orderId);
    await uploadPosterPng(url, method, blob, orderId, local);
  }, [buildRenderOptions, config.dimensions, config.showStats, config.showCoordinates, mode, activity, activities, renderPoster]);

  const handleExport = useCallback(async () => {
    if (tracks.length === 0) return;
    setExporting(true);

    try {
      // Collapse mobile sheet so the map is fully visible for capture
      collapseSheetRef.current?.();
      await new Promise((r) => setTimeout(r, 350));

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

  const orderButtonSlot = giftContext ? (
    <GiftOrderButton
      giftCode={giftContext.giftCode}
      tierId={giftContext.tier}
      posterConfig={{
        ...config,
        activityId: activity?.id,
        activityIds: activities?.map(a => a.id),
      }}
      renderPoster={renderPoster}
      submitPoster={submitPoster}
    />
  ) : (
    <OrderButton
      posterConfig={{
        ...config,
        activityId: activity?.id,
        activityIds: activities?.map(a => a.id),
      }}
      renderPoster={renderPoster}
      submitPoster={submitPoster}
    />
  );

  const settingsPanelProps = {
    config,
    theme,
    mode,
    showKmMarkers,
    showStartFinish,
    placingIcon,
    dimensionsLocked: !!giftContext,
    onShowKmMarkersChange: setShowKmMarkers,
    onShowStartFinishChange: setShowStartFinish,
    onPlaceIcon: setPlacingIcon,
    onRemoveMarker: handleRemoveMarker,
    onConfigChange: handleConfigChange,
    onThemeChange: handleThemeChange,
    onExport: handleExport,
    exporting,
    orderButtonSlot,
  } as const;

  return (
    <div className="h-dvh flex flex-col md:flex-row">
      {/* Main area */}
      <div className="flex-1 flex flex-col bg-[#0a0a0a] min-h-0">
        {/* Top bar */}
        <div className="h-12 flex items-center px-4 border-b border-white/10 flex-shrink-0">
          <button
            onClick={onBack}
            className="text-white/40 hover:text-white text-sm flex items-center gap-2 transition-colors"
          >
            <svg className="w-5 h-5 md:w-4 md:h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            <span className="hidden md:inline">Back to activities</span>
          </button>

          {/* Placing mode banner */}
          {placingIcon && (
            <div className="mx-auto flex items-center gap-2 text-sm text-yellow-400 animate-pulse">
              <span className="hidden md:inline">Click on the map to place marker</span>
              <span className="md:hidden text-xs">Tap map to place</span>
              <button
                onClick={() => setPlacingIcon(null)}
                className="text-xs px-2 py-0.5 rounded bg-white/10 text-white/60 hover:text-white"
              >
                Cancel
              </button>
            </div>
          )}

          <div className="ml-auto text-xs text-white/30 truncate max-w-[40%]">
            {mode === 'individual' ? activity?.name : `${activities?.length ?? 0} runs`}
          </div>
        </div>

        {/* Preview area */}
        <div className="flex-1 flex items-start md:items-center justify-center p-2 md:p-8 overflow-hidden">
          <div
            ref={previewContainerRef}
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

      {/* Desktop: Settings sidebar */}
      <div className="hidden md:block">
        <SettingsPanel {...settingsPanelProps} />
      </div>

      {/* Mobile: Bottom sheet with settings */}
      <div className="md:hidden">
        <MobileSettingsSheet
          collapseRef={collapseSheetRef}
          actionButtons={
            <SettingsActions
              onExport={handleExport}
              exporting={exporting}
              orderButtonSlot={orderButtonSlot}
              dimensions={config.dimensions}
            />
          }
        >
          <SettingsPanel {...settingsPanelProps} hideActions />
        </MobileSettingsSheet>
      </div>
    </div>
  );
}
