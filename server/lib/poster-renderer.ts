/**
 * Server-side poster renderer.
 *
 * Launches a headless Chromium via Playwright, navigates to the app's
 * `/internal/render-poster/:token` route (which mounts the SAME React
 * preview components the user customised with), waits for the map to finish
 * loading, and screenshots the poster element.
 *
 * This replaces the client-side canvas renderer (which had drifted from
 * the preview DOM and produced visibly different prints). The render
 * environment is fixed (Linux Chromium + bundled fonts), so every order
 * produces identical output regardless of the customer's device.
 *
 * Token flow: the client POSTs its payload to /api/render/order/:id, the
 * server stores it under a short-lived UUID, and the internal React route
 * fetches it by token. Tokens are single-use and expire after 60s.
 */
import { chromium, type Browser } from 'playwright';
import { randomUUID } from 'crypto';
import { log } from './logger.js';

export interface RenderPayload {
  /** Serialised Theme — colours, fonts, etc. */
  theme: unknown;
  /** Serialised PosterConfig — dimensions, markers, layers, padding, bearing. */
  config: unknown;
  /** TrackData[] — GPS polylines to draw. */
  tracks: unknown[];
  title: string;
  subtitle: string;
  statsText: string[];
  coordinateText?: string;
}

interface PendingPayload {
  payload: RenderPayload;
  expiresAt: number;
}

const TOKEN_TTL_MS = 60_000;
const RENDER_TIMEOUT_MS = 45_000;
/** Max concurrent renders. Each render holds a Chromium context (~80-150 MB).
 *  On the 2 GB DO instance, 2 is the safe cap before we risk OOM. */
const MAX_CONCURRENT_RENDERS = 2;
/** How long a queued render waits for a slot before failing with a 503. */
const QUEUE_TIMEOUT_MS = 30_000;

const tokens = new Map<string, PendingPayload>();

function mmToPx(mm: number, dpi: number): number {
  return Math.round((mm / 25.4) * dpi);
}

/** Garbage collect any expired tokens — cheap, called on every store/consume. */
function gcTokens(): void {
  const now = Date.now();
  for (const [token, entry] of tokens) {
    if (entry.expiresAt < now) tokens.delete(token);
  }
}

/** Store a payload and return an opaque single-use token. */
export function storePayload(payload: RenderPayload): string {
  gcTokens();
  const token = randomUUID();
  tokens.set(token, { payload, expiresAt: Date.now() + TOKEN_TTL_MS });
  return token;
}

/** Consume a token. Returns the payload or null if the token is unknown
 *  or expired. Tokens are single-use: a second consume returns null. */
export function consumePayload(token: string): RenderPayload | null {
  gcTokens();
  const entry = tokens.get(token);
  if (!entry) return null;
  tokens.delete(token);
  return entry.payload;
}

// Browser pool — a single warm Chromium reused across requests. Order volume
// is low (<10/week), so one instance is plenty. Re-launches on disconnect.
let browserPromise: Promise<Browser> | null = null;

async function getBrowser(): Promise<Browser> {
  if (browserPromise) {
    const b = await browserPromise;
    if (b.isConnected()) return b;
    browserPromise = null; // forget the dead browser
  }
  browserPromise = chromium.launch({
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage', // /dev/shm is often tiny in containers
    ],
  });
  const b = await browserPromise;
  b.on('disconnected', () => {
    if (browserPromise) browserPromise = null;
  });
  return b;
}

// ─────────────────────────────────────────────────────────────────────────────
// Concurrency semaphore — caps in-flight renders so a burst can't OOM the box.
// FIFO queue of pending acquirers; each acquire either takes a slot or waits
// up to QUEUE_TIMEOUT_MS before rejecting with a typed error.
// ─────────────────────────────────────────────────────────────────────────────

export class RenderBusyError extends Error {
  readonly code = 'RENDER_BUSY';
  constructor() {
    super('Render queue full');
    this.name = 'RenderBusyError';
  }
}

let inflight = 0;
const waiters: Array<{ resolve: () => void; reject: (e: Error) => void; timer: NodeJS.Timeout }> = [];

function acquireSlot(): Promise<void> {
  if (inflight < MAX_CONCURRENT_RENDERS) {
    inflight++;
    return Promise.resolve();
  }
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      const idx = waiters.findIndex((w) => w.resolve === resolve);
      if (idx >= 0) waiters.splice(idx, 1);
      reject(new RenderBusyError());
    }, QUEUE_TIMEOUT_MS);
    waiters.push({ resolve, reject, timer });
  });
}

function releaseSlot(): void {
  const next = waiters.shift();
  if (next) {
    clearTimeout(next.timer);
    // inflight count stays the same — we hand the slot to the next waiter.
    next.resolve();
  } else {
    inflight = Math.max(0, inflight - 1);
  }
}

export interface RenderOptions {
  widthMm: number;
  heightMm: number;
  dpi: number;
  /** Base URL of the server rendering is happening on — usually http://localhost:$PORT
   *  because Playwright hits the same server via loopback. */
  internalBaseUrl: string;
  /** Correlation ID propagated through logs. */
  requestId?: string;
}

/**
 * Render the poster to a PNG buffer at the requested print dimensions.
 * Throws RenderBusyError if the queue is saturated, or a generic Error if
 * the internal page doesn't signal ready within the timeout.
 */
export async function renderPoster(
  payload: RenderPayload,
  opts: RenderOptions,
): Promise<Buffer> {
  const requestId = opts.requestId;
  await acquireSlot();

  const token = storePayload(payload);
  const url = `${opts.internalBaseUrl}/internal/render-poster/${token}`;

  const viewportWidth = mmToPx(opts.widthMm, opts.dpi);
  const viewportHeight = mmToPx(opts.heightMm, opts.dpi);

  const started = Date.now();
  try {
    const browser = await getBrowser();
    const context = await browser.newContext({
      viewport: { width: viewportWidth, height: viewportHeight },
      deviceScaleFactor: 1, // already rendering at print-pixel viewport size
    });

    try {
      const page = await context.newPage();
      page.on('pageerror', (err) =>
        log.error('Internal page error', { scope: 'render', requestId, error: err.message }),
      );
      page.on('console', (msg) => {
        if (msg.type() === 'error') {
          log.warn('Internal page console.error', { scope: 'render', requestId, text: msg.text() });
        }
      });

      await page.goto(url, { waitUntil: 'load', timeout: RENDER_TIMEOUT_MS });

      // The internal page sets window.__POSTER_READY__ = true once MapLibre
      // fires 'idle' AND the stats overlay has mounted. We poll for that flag
      // before screenshotting — otherwise we race the tile loader.
      await page.waitForFunction('window.__POSTER_READY__ === true', null, {
        timeout: RENDER_TIMEOUT_MS,
      });

      // Screenshot only the poster root, not the whole page, so stray router
      // chrome or dev overlays can't leak into the output.
      const el = page.locator('[data-poster-root]');
      const buf = await el.screenshot({ type: 'png', animations: 'disabled' });

      log.info('Rendered poster', {
        scope: 'render',
        requestId,
        outcome: 'ok',
        durationMs: Date.now() - started,
        widthPx: viewportWidth,
        heightPx: viewportHeight,
        bufferBytes: buf.length,
      });
      return buf;
    } finally {
      await context.close();
    }
  } catch (err) {
    log.error('Render failed', {
      scope: 'render',
      requestId,
      outcome: 'error',
      durationMs: Date.now() - started,
      error: (err as Error).message,
    });
    throw err;
  } finally {
    releaseSlot();
  }
}

/** Graceful shutdown — called from server shutdown handler. */
export async function closeBrowser(): Promise<void> {
  if (!browserPromise) return;
  const b = await browserPromise.catch(() => null);
  browserPromise = null;
  if (b) await b.close().catch(() => {});
}

/**
 * Boot-time validation that Chromium can launch in this environment.
 * Called from server startup so a misconfigured container fails loud at boot
 * rather than at first customer render. Does NOT render a real poster —
 * just opens a blank page, confirms the browser is responsive, closes it.
 *
 * Returns true on success, throws on failure (server should exit).
 */
export async function verifyChromium(): Promise<true> {
  const started = Date.now();
  try {
    const browser = await getBrowser();
    const context = await browser.newContext({ viewport: { width: 100, height: 100 } });
    try {
      const page = await context.newPage();
      await page.setContent('<html><body>ok</body></html>', { waitUntil: 'load' });
      await page.screenshot({ type: 'png' });
    } finally {
      await context.close();
    }
    log.info('Chromium boot check ok', {
      scope: 'render.boot',
      outcome: 'ok',
      durationMs: Date.now() - started,
    });
    return true;
  } catch (err) {
    log.error('Chromium boot check failed', {
      scope: 'render.boot',
      outcome: 'error',
      durationMs: Date.now() - started,
      error: (err as Error).message,
    });
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Lightweight health probe — for uptime monitors hitting on a 1–5 min
// cadence we don't want to launch a fresh Chromium context every call.
// Instead, cache the last successful verifyChromium result for 60 s and
// otherwise just check the browser process is still connected.
// ─────────────────────────────────────────────────────────────────────────────

const HEALTH_CACHE_MS = 60_000;
let lastHealthCheck = 0;
let lastHealthOk = false;

/**
 * Cheap health probe suitable for high-cadence uptime monitoring.
 *
 * Behaviour:
 *   - Returns true if a full verifyChromium succeeded within the last 60 s
 *     AND the browser is still connected.
 *   - Otherwise, runs a full verifyChromium and caches the result.
 *
 * On a 1-min uptime probe this means we do the expensive check once a
 * minute and serve a sub-millisecond response in between. If the browser
 * disconnects (OOM, crash) the `isConnected` flip causes the next call
 * to refresh — we never serve a stale "ok" against a dead Chromium.
 */
export async function healthCheck(): Promise<{ ok: boolean; cached: boolean; durationMs: number }> {
  const now = Date.now();
  const started = now;
  const browser = browserPromise ? await browserPromise.catch(() => null) : null;
  const connected = browser?.isConnected() === true;

  if (lastHealthOk && connected && (now - lastHealthCheck) < HEALTH_CACHE_MS) {
    return { ok: true, cached: true, durationMs: Date.now() - started };
  }

  try {
    await verifyChromium();
    lastHealthCheck = Date.now();
    lastHealthOk = true;
    return { ok: true, cached: false, durationMs: Date.now() - started };
  } catch {
    lastHealthOk = false;
    lastHealthCheck = Date.now();
    return { ok: false, cached: false, durationMs: Date.now() - started };
  }
}
