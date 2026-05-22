import { useCallback, useEffect, useRef, useState } from 'react';
import type { Map as MaplibreMap } from 'maplibre-gl';
import type { ActivitySummary, TrackData } from '@/types/activity';
import type { Theme } from '@/types/theme';
import type { PosterConfig } from '@/types/poster';
import { MapPreview } from '@/features/map/ui/MapPreview';
import { StatsOverlay } from '@/features/poster/ui/StatsOverlay';

/**
 * Headless render surface — the route Playwright visits from inside the
 * server container. Mounts the SAME `<MapPreview>` + `<StatsOverlay>`
 * components the preview uses, fills the viewport exactly, and signals
 * readiness via `window.__POSTER_READY__` once MapLibre reports idle.
 *
 * Keep this page dead simple — no app shell, no fonts loader, no
 * analytics, no auth checks. The payload carries everything.
 */

interface RenderPayload {
  theme: Theme;
  config: PosterConfig;
  tracks: TrackData[];
  mode: 'individual' | 'compilation';
  activity?: ActivitySummary;
  activities?: ActivitySummary[];
  title: string;
  subtitle: string;
  showStats: boolean;
  showCoordinates: boolean;
}

declare global {
  interface Window {
    __POSTER_READY__?: boolean;
    __POSTER_ERROR__?: string;
  }
}

export function InternalRenderPage({ token }: { token: string }) {
  const [payload, setPayload] = useState<RenderPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const readyCheckedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/render/payload/${token}`, { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) throw new Error(`payload ${res.status}`);
        return res.json() as Promise<RenderPayload>;
      })
      .then((data) => {
        if (cancelled) return;
        setPayload(data);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        const msg = err.message || 'failed to load payload';
        setError(msg);
        // Expose the error so Playwright can surface it in logs.
        window.__POSTER_ERROR__ = msg;
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const handleMapReady = useCallback((map: MaplibreMap) => {
    // Double-idle pattern: first idle means the map responded to our tracks
    // fitBounds, second idle means all tiles composited and no late repaint
    // is pending. Set the ready flag only after the second idle fires.
    const finish = () => {
      if (readyCheckedRef.current) return;
      readyCheckedRef.current = true;
      // Small rAF buffer so the StatsOverlay has painted too.
      requestAnimationFrame(() => {
        window.__POSTER_READY__ = true;
      });
    };
    const waitIdle = () => {
      map.triggerRepaint();
      map.once('idle', () => {
        map.triggerRepaint();
        map.once('idle', finish);
      });
    };
    if (map.loaded() && map.areTilesLoaded()) {
      waitIdle();
    } else {
      map.once('idle', waitIdle);
    }
  }, []);

  if (error) {
    return (
      <div style={{ padding: 16, color: '#f00', fontFamily: 'monospace' }}>
        Render payload error: {error}
      </div>
    );
  }

  if (!payload) {
    return <div style={{ padding: 16, color: '#666' }}>Loading payload…</div>;
  }

  const { theme, config, tracks, mode, activity, activities, title, subtitle, showStats, showCoordinates } = payload;

  return (
    <div
      data-poster-root
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        // Fill the Playwright viewport exactly — the viewport IS the print
        // canvas (see server/lib/poster-renderer.ts: widthMm × dpi → px).
        width: '100vw',
        height: '100vh',
        overflow: 'hidden',
        background: theme.colors.background,
      }}
    >
      <MapPreview
        theme={theme}
        tracks={tracks}
        isCompilation={mode === 'compilation'}
        bearing={config.bearing}
        layers={config.layers}
        markers={config.markers}
        onMapReady={handleMapReady}
      />

      <StatsOverlay
        activity={activity}
        activities={activities}
        theme={theme}
        title={title}
        subtitle={subtitle}
        showStats={showStats}
        showCoordinates={showCoordinates}
        mode={mode}
      />
    </div>
  );
}
