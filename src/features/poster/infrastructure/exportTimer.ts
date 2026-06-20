/**
 * Lightweight, zero-dependency timing for the export pipeline.
 *
 * Why this exists: free/preview exports take one of several paths (instant
 * client capture, device-independent server render, legacy canvas) and the
 * paths have very different latencies — and on iOS the "instant" capture can
 * silently produce a blank map and fall back. We need per-stage speeds, the
 * winning path, and the device, both in production (Mixpanel) and in tests
 * (the WebKit smoke reads the console line), so routing decisions are made on
 * data rather than guesses. See PosterEditor.handleExport.
 */

function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

export type ExportDeviceKind = 'ios' | 'android' | 'desktop';

export interface ExportDeviceInfo {
  /** Coarse engine bucket — the only dimension we segment latency/failure on. */
  device: ExportDeviceKind;
  /** `${innerWidth}x${innerHeight}` — handy for spotting the small-viewport cases. */
  viewport: string;
  /** Full UA — for console/debug only; not sent to analytics. */
  ua: string;
}

/** Detect the rendering engine bucket. iPadOS 13+ reports a desktop-Mac UA, so
 *  we treat a touch-capable "Macintosh" as iOS — it has the same WebGL
 *  buffer-readback limits as iPhone/iPad. */
export function detectExportDevice(): ExportDeviceInfo {
  const ua =
    typeof navigator !== 'undefined' && typeof navigator.userAgent === 'string'
      ? navigator.userAgent
      : '';
  const touchMac =
    /Macintosh/.test(ua) &&
    typeof document !== 'undefined' &&
    'ontouchend' in document;
  const ios = /iPad|iPhone|iPod/.test(ua) || touchMac;
  const android = /Android/.test(ua);
  const device: ExportDeviceKind = ios ? 'ios' : android ? 'android' : 'desktop';
  const viewport =
    typeof window !== 'undefined' ? `${window.innerWidth}x${window.innerHeight}` : 'unknown';
  return { device, viewport, ua };
}

/** Flat map of span name → milliseconds, plus `total_ms`. Spread straight into
 *  the `export_completed` Mixpanel event and logged for the smoke test. */
export type ExportTimings = Record<string, number>;

export interface ExportTimer {
  /** Start a named span. Call the returned stop fn to record its elapsed ms.
   *  Safe to call the stop fn on both success and failure paths — recording how
   *  long a stage took *before it failed* is exactly what we want to see. */
  span(name: string): () => number;
  /** Record an externally-measured span (e.g. from inside captureRenderer). */
  record(name: string, ms: number): void;
  /** Finalize: returns all recorded spans plus `total_ms` since creation. */
  finish(): ExportTimings;
}

export function createExportTimer(): ExportTimer {
  const t0 = nowMs();
  const spans: ExportTimings = {};
  const record = (name: string, ms: number) => {
    spans[name] = Math.round(ms);
  };
  return {
    span(name: string) {
      const start = nowMs();
      return () => {
        const ms = nowMs() - start;
        record(name, ms);
        return Math.round(ms);
      };
    },
    record,
    finish() {
      return { ...spans, total_ms: Math.round(nowMs() - t0) };
    },
  };
}
