import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import type { ActivitySummary, TrackData } from '@/types/activity';
import type { Theme } from '@/types/theme';
import type { PosterConfig, PosterDimensions, MapMarker, MarkerIcon } from '@/types/poster';
import { POSTER_PRESETS, DEFAULT_PRESET, DEFAULT_LAYERS } from '@/types/poster';
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
import { getDefaultTheme, getThemeById } from '@/features/theme/infrastructure/themeRepository';

import { useTrack, useTracks } from '@/features/data-import/hooks/useActivityData';
import { MapPreview } from '@/features/map/ui/MapPreview';
import { StatsOverlay } from './StatsOverlay';
import { SettingsPanel, SettingsActions, type SettingsPanelControl } from './SettingsPanel';
import { MobileSettingsSheet } from './MobileSettingsSheet';
import { EditorSteps, type EditorStep } from './EditorSteps';
import { loadPosterStyle, savePosterStyle } from '@/features/onboarding/services/outputMode';
import { renderPosterToBlob, downloadBlob } from '../infrastructure/renderer';
import { capturePosterToBlob } from '../infrastructure/renderer/captureRenderer';
import { applyWatermark } from '../infrastructure/renderer/watermark';
import { ThemeStrip } from '@/features/theme/ui/ThemeGallery';

/** Flip to false to fall back to the old Canvas-based renderer */
const USE_CAPTURE_RENDERER = true;

/** Free exports render server-side at this DPI ceiling. Print DPI (300) makes
 *  the render viewport ~16.7M px, which software WebGL on the 1-vCPU box
 *  cannot rasterize inside the 45 s server timeout (2026-06-12: every free
 *  export timed out, even single tracks). 150 DPI is the configuration the
 *  smoke tests have always proven (renders in 2-7 s) and is plenty for a
 *  shared image. Paid prints keep full DPI via the order route. */
const FREE_EXPORT_MAX_DPI = 150;

/** Free/digital exports encode as JPEG — far smaller and faster to load and
 *  share than PNG for a photographic map poster (a ~1080×1350 JPEG is a few
 *  hundred KB vs several MB as PNG). Paid prints stay PNG (rendered clean on
 *  the server, never watermarked). q0.9 is visually lossless for this content. */
const DIGITAL_EXPORT_FORMAT = { type: 'image/jpeg', quality: 0.9 } as const;
const DIGITAL_EXPORT_EXT = 'jpg';

/** First export of this page-load — the one most likely to hit a cold render
 *  path (Chromium/tiles/fonts fetched fresh). Module-level so it spans editor
 *  re-mounts within a session but resets on a full reload. Sent with
 *  export_completed so cold-vs-warm latency is measurable in Mixpanel. */
let sessionHasExported = false;

/** mm → device pixels at a given DPI. Mirrors the server renderer's formula;
 *  used only to label the output size on the export_completed event. */
function mmToPx(mm: number, dpi: number): number {
  return Math.round((mm / 25.4) * dpi);
}

/** When true (set VITE_RENDER_ON_SERVER=true), paid-print orders use the
 *  server-side Playwright renderer instead of rendering in the browser.
 *  Guarantees WYSIWYG fidelity and full print DPI on every device. See
 *  server/lib/poster-renderer.ts. Default: off, so rollout is gated. */
const RENDER_ON_SERVER = import.meta.env.VITE_RENDER_ON_SERVER === 'true';
import { OrderButton } from '@/features/checkout/ui/OrderButton';
import { GiftOrderButton } from '@/features/checkout/ui/GiftOrderButton';
import {
  getUploadUrl,
  renderExportOnServer,
  renderPosterOnServer,
  uploadPosterPng,
  type GiftContext,
} from '@/features/checkout/services/checkoutApi';
import { formatDistance, formatDuration, formatPace, formatDate, formatElevation } from '@/shared/utils/format';
import { clearDraft, draftKey, readDraft, usePersistDraft } from '@/shared/hooks/usePersistedDraft';

interface PersistedDraft {
  config: PosterConfig;
  themeId: string;
  showKmMarkers: boolean;
  showStartFinish: boolean;
}

interface PosterEditorProps {
  activity?: ActivitySummary;
  activities?: ActivitySummary[];
  mode: 'individual' | 'compilation';
  stravaTracksMap?: Record<string, TrackData>;
  onBack: () => void;
  /** Switch to the other output mode (preserves styling via carryover). */
  onSwitchMode?: () => void;
  /** Label of the mode the Switch button moves to (e.g. "composite"). */
  switchTargetLabel?: string;
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

export function PosterEditor({ activity, activities, mode, stravaTracksMap, onBack, onSwitchMode, switchTargetLabel, giftContext }: PosterEditorProps) {
  // Stable draft key derived from mode + activity-id-set. Different
  // activities get different drafts; reopening the same set restores
  // edit state across refresh/tab-kill.
  const persistenceKey = useMemo(() => {
    const ids = mode === 'individual'
      ? (activity?.id ? [activity.id] : [])
      : (activities?.map((a) => a.id) ?? []);
    return draftKey(mode, ids);
  }, [mode, activity?.id, activities]);

  // Read once on mount (lazy initialiser) so the first render already
  // reflects the persisted state — no flash of defaults.
  const restored = useMemo<PersistedDraft | null>(
    () => readDraft<PersistedDraft>(persistenceKey),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [], // intentionally one-shot: switching activities should re-mount this component
  );

  // Cross-mode styling carried over from the previous mode via the Switch
  // button. Only consulted when there's no activity-specific restored draft —
  // a saved draft for this exact run-set always wins. Gift size still overrides
  // any carried dimension. This is how "keep everything possible" works when
  // switching: theme, layers, size, title, display toggles and orientation
  // follow the user across modes.
  const carryover = useMemo(() => (restored ? null : loadPosterStyle()), [restored]);

  const [config, setConfig] = useState<PosterConfig>(() => restored?.config ?? {
    mode,
    themeId: carryover?.themeId ?? 'noir',
    dimensions: giftContext
      ? presetForTier(giftContext.tier)
      : (carryover
          ? (POSTER_PRESETS.find((p) => p.label === carryover.dimensionsLabel) ?? DEFAULT_PRESET)
          : DEFAULT_PRESET),
    // Title is per-poster content, not carried style — always compute the
    // default from this poster's own runs (a restored draft keeps its own
    // title via restored.config above). See PosterStyleCarryover.
    title: mode === 'individual'
      ? (activity?.location || activity?.name || '')
      : (activities?.[0]?.location || ''),
    subtitle: mode === 'individual'
      ? formatDate(activity?.date ?? '')
      : '',
    showStats: carryover?.showStats ?? true,
    showCoordinates: carryover?.showCoordinates ?? true,
    showGradientFade: carryover?.showGradientFade ?? true,
    padding: 0.15,
    bearing: carryover?.bearing ?? 0,
    layers: carryover?.layers ? { ...carryover.layers } : { ...DEFAULT_LAYERS },
    markers: [],
  });

  // Theme is derived from themeId — we persist the id, not the whole
  // theme object (which could change shape on a deploy and leave stale
  // colour data on disk). On mount, if the restored draft pointed at a
  // theme that no longer exists, getThemeById falls back to the default.
  const [theme, setTheme] = useState<Theme>(() =>
    restored?.themeId
      ? getThemeById(restored.themeId)
      : (carryover?.themeId ? getThemeById(carryover.themeId) : getDefaultTheme()),
  );
  const [exporting, setExporting] = useState(false);
  const [showKmMarkers, setShowKmMarkers] = useState<boolean>(restored?.showKmMarkers ?? false);
  const [showStartFinish, setShowStartFinish] = useState<boolean>(restored?.showStartFinish ?? true);

  // Persist the editable subset to localStorage with a 500ms debounce
  // (see usePersistDraft for details). On pagehide — the mobile-killable
  // moment — a final synchronous flush runs from inside the hook.
  usePersistDraft<PersistedDraft>(
    persistenceKey,
    { config, themeId: theme.id, showKmMarkers, showStartFinish },
  );

  // Persist the cross-mode style carryover so a later Switch inherits this
  // look. Style axis only (see PosterStyleCarryover) — never the date subtitle
  // or km markers, which are single-run specifics.
  useEffect(() => {
    savePosterStyle({
      themeId: theme.id,
      layers: config.layers,
      dimensionsLabel: config.dimensions.label,
      showStats: config.showStats,
      showCoordinates: config.showCoordinates,
      showGradientFade: config.showGradientFade,
      bearing: config.bearing,
    });
  }, [theme.id, config.layers, config.dimensions.label, config.showStats, config.showCoordinates, config.showGradientFade, config.bearing]);

  // One per editor session — the component re-mounts when the user picks a
  // different activity set, so this fires once per poster being edited.
  useEffect(() => {
    window.mixpanel?.track('editor_opened', { mode, theme_id: config.themeId });

    // Prewarm the server render path the moment the user reaches the editor,
    // so the first export doesn't pay the cold-start penalty (Chromium launch /
    // a scaled-to-zero container waking up). Fire-and-forget — /health runs a
    // tiny Chromium check that warms the browser pool; failures are harmless
    // (the export paths fall back client-side anyway). See BOA-120.
    if (RENDER_ON_SERVER) {
      fetch('/api/render/health', { method: 'GET' }).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Marker placement state
  const [placingIcon, setPlacingIcon] = useState<MarkerIcon | null>(null);
  const mapInstanceRef = useRef<maplibregl.Map | null>(null);
  const previewContainerRef = useRef<HTMLDivElement>(null);
  const collapseSheetRef = useRef<(() => void) | null>(null);
  const expandSheetRef = useRef<(() => void) | null>(null);
  const settingsControlRef = useRef<SettingsPanelControl | null>(null);

  // Guided-step rail: expand the sheet and jump to the tapped section. Theme is
  // already always-visible via the strip, so it only needs the sheet expanded.
  const handleStep = useCallback((step: EditorStep) => {
    window.mixpanel?.track('editor_step_opened', { step, mode });
    expandSheetRef.current?.();
    if (step !== 'Theme') {
      settingsControlRef.current?.openAndScroll(step);
    }
  }, [mode]);

  // Load track data (Strava tracks are in-memory, Garmin tracks fetched from files)
  const { track: singleTrack } = useTrack(mode === 'individual' ? activity?.id ?? null : null, stravaTracksMap);
  const { tracks: compilationTracks, loadTracks } = useTracks(stravaTracksMap);

  useEffect(() => {
    if (mode === 'compilation' && activities) {
      loadTracks(activities.map((a) => a.id));
    }
  }, [mode, activities, loadTracks]);

  // Stable identity matters: theme chip geometry and marker generation are
  // memoized on `tracks`, so don't rebuild the array on every render.
  const tracks: TrackData[] = useMemo(
    () => (mode === 'individual' ? (singleTrack ? [singleTrack] : []) : compilationTracks),
    [mode, singleTrack, compilationTracks],
  );

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

  /** Payload for the server-side Playwright renderer — mirrors the preview's
   *  own component inputs so the internal render page can mount identical
   *  components. Shared by the paid-order and free-export server paths. */
  const buildServerPayload = useCallback((dims: PosterDimensions) => {
    const opts = buildRenderOptions();
    return {
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
  }, [buildRenderOptions, config.showStats, config.showCoordinates, mode, activity, activities]);

  /** Which renderer produced the last free export — sent with the
   *  export_completed event so the rollout is verifiable in Mixpanel. */
  const lastRenderPathRef = useRef<'server' | 'capture' | 'canvas'>('canvas');

  /** Render poster to PNG blob — used by both export and order flow.
   *  When printDimensions is provided (ordering), always use the canvas renderer for
   *  full-resolution output. Free exports prefer the server-side Playwright
   *  renderer (device-independent — mobile WebGL/canvas limits produced black
   *  exports), then fall back to the client capture renderer, then to the
   *  legacy canvas renderer, so exports still work offline. */
  const renderPoster = useCallback(async (printDimensions?: PosterDimensions): Promise<Blob> => {
    // For paid prints: always use canvas renderer at full resolution
    if (printDimensions) {
      const opts = buildRenderOptions();
      opts.config = { ...opts.config, dimensions: printDimensions };
      return renderPosterToBlob(opts);
    }

    // Free exports, first choice: server-side Playwright render.
    if (RENDER_ON_SERVER) {
      try {
        const dims = {
          ...config.dimensions,
          dpi: Math.min(config.dimensions.dpi, FREE_EXPORT_MAX_DPI),
        };
        const blob = await renderExportOnServer(buildServerPayload(dims), {
          widthMm: dims.widthMm,
          heightMm: dims.heightMm,
          dpi: dims.dpi,
        });
        lastRenderPathRef.current = 'server';
        return await applyWatermark(blob, DIGITAL_EXPORT_FORMAT);
      } catch (e) {
        // Server unreachable, busy, or rate-limited — client paths below
        // still produce a usable (preview-resolution) export. Breadcrumb to
        // Mixpanel so silent fallbacks are visible in the funnel.
        console.warn('[render] Server export failed, falling back to client capture:', e);
        window.mixpanel?.track('export_server_fallback', {
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    // Second choice: capture renderer (fast, WYSIWYG from preview)
    if (USE_CAPTURE_RENDERER && previewContainerRef.current && mapInstanceRef.current) {
      try {
        const blob = await capturePosterToBlob({
          element: previewContainerRef.current,
          map: mapInstanceRef.current,
          dimensions: config.dimensions,
        });
        lastRenderPathRef.current = 'capture';
        return await applyWatermark(blob, DIGITAL_EXPORT_FORMAT);
      } catch (e) {
        if (e instanceof Error && e.message === 'MAP_BLANK') {
          console.warn('[render] Capture renderer detected blank map, using canvas fallback');
        } else {
          throw e;
        }
      }
    }
    // Last resort: legacy canvas renderer
    lastRenderPathRef.current = 'canvas';
    return applyWatermark(await renderPosterToBlob(buildRenderOptions()), DIGITAL_EXPORT_FORMAT);
  }, [buildRenderOptions, buildServerPayload, config.dimensions]);

  /** Render + upload for the paid-order flow. Dispatches to either the
   *  server-side Playwright renderer or the legacy client-render-then-upload
   *  path based on the VITE_RENDER_ON_SERVER flag. OrderButton and
   *  GiftOrderButton both call this once per order. */
  const submitPoster = useCallback(async (
    orderId: string,
    printDimensions?: PosterDimensions,
  ): Promise<void> => {
    if (RENDER_ON_SERVER) {
      const dims = printDimensions ?? config.dimensions;
      await renderPosterOnServer(orderId, buildServerPayload(dims), {
        widthMm: dims.widthMm,
        heightMm: dims.heightMm,
        dpi: dims.dpi,
        tierId: dims.tierId,
      });
      // Order successfully submitted — the user is about to leave for
      // Stripe and won't be back to this editor for this poster. Clear
      // the draft so it doesn't shadow the user's NEXT customization.
      clearDraft(persistenceKey);
      return;
    }

    // Legacy client-side flow — render in browser, then upload to R2.
    const blob = await renderPoster(printDimensions);
    const { url, method, local } = await getUploadUrl(orderId);
    await uploadPosterPng(url, method, blob, orderId, local);
    clearDraft(persistenceKey);
  }, [buildServerPayload, config.dimensions, renderPoster, persistenceKey]);

  const handleExport = useCallback(async () => {
    if (tracks.length === 0) return;
    window.mixpanel?.track('export_clicked', { mode, theme_id: config.themeId });
    setExporting(true);

    const isFirstExport = !sessionHasExported;
    const startedAt = performance.now();
    try {
      // Collapse mobile sheet so the map is fully visible for capture
      collapseSheetRef.current?.();
      await new Promise((r) => setTimeout(r, 350));

      const blob = await renderPoster();
      const filename = `runink-${config.themeId}-${mode === 'individual' ? activity?.id : 'compilation'}.${DIGITAL_EXPORT_EXT}`;
      downloadBlob(blob, filename);
      sessionHasExported = true;
      // render_ms is the full client-perceived export time (incl. the 350 ms
      // sheet-collapse wait + any server round trip). first_export flags the
      // render most likely to hit a cold path, so cold-vs-warm latency by size
      // is queryable in Mixpanel rather than guessed. See BOA-120.
      window.mixpanel?.track('export_completed', {
        mode,
        theme_id: config.themeId,
        render_path: lastRenderPathRef.current,
        size: config.dimensions.label,
        output_px: `${mmToPx(config.dimensions.widthMm, Math.min(config.dimensions.dpi, FREE_EXPORT_MAX_DPI))}x${mmToPx(config.dimensions.heightMm, Math.min(config.dimensions.dpi, FREE_EXPORT_MAX_DPI))}`,
        format: DIGITAL_EXPORT_FORMAT.type,
        render_ms: Math.round(performance.now() - startedAt),
        first_export: isFirstExport,
        file_bytes: blob.size,
      });
    } catch (err) {
      console.error('Export failed:', err);
      window.mixpanel?.track('export_failed', { mode, theme_id: config.themeId });
    } finally {
      setExporting(false);
    }
  }, [tracks, config, mode, activity, renderPoster]);

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
    mode,
    tracks,
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

          <div className="ml-auto flex items-center gap-3 min-w-0">
            <span className="text-xs text-white/30 truncate hidden sm:inline max-w-[30vw]">
              {mode === 'individual' ? activity?.name : `${activities?.length ?? 0} runs`}
            </span>
            {onSwitchMode && (
              <button
                onClick={onSwitchMode}
                className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-full border border-white/15 text-white/60 hover:text-white hover:border-white/30 transition-colors flex-shrink-0"
                title={`Switch to ${switchTargetLabel ?? 'the other mode'}`}
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 7h12m0 0l-4-4m4 4l-4 4M16 17H4m0 0l4 4m-4-4l4-4" />
                </svg>
                <span className="hidden sm:inline">Switch to {switchTargetLabel ?? 'other'}</span>
                <span className="sm:hidden">Switch</span>
              </button>
            )}
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
              // Query container for the StatsOverlay's cqw type sizing, so the
              // preview text scales with the poster width exactly as the export
              // does (the server render page sets the same on [data-poster-root]).
              containerType: 'inline-size',
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
          expandRef={expandSheetRef}
          stepsRail={<EditorSteps onStep={handleStep} />}
          themeStrip={
            <ThemeStrip
              selectedId={config.themeId}
              onSelect={handleThemeChange}
              tracks={tracks}
              isCompilation={mode === 'compilation'}
            />
          }
          actionButtons={
            <SettingsActions
              onExport={handleExport}
              exporting={exporting}
              orderButtonSlot={orderButtonSlot}
              dimensions={config.dimensions}
            />
          }
        >
          <SettingsPanel {...settingsPanelProps} hideActions hideTheme controlRef={settingsControlRef} />
        </MobileSettingsSheet>
      </div>
    </div>
  );
}
