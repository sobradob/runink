/**
 * Server-side poster rendering endpoints.
 *
 * `POST /api/render/order/:orderId` — render the poster for an existing order,
 *   upload the PNG to R2, attach png_url to the order, return the public URL.
 *
 * `GET  /api/render/payload/:token`  — internal use only: called by the
 *   Playwright-driven browser from inside the container. Returns the payload
 *   stored against the given token. Single-use.
 *
 * `GET  /api/render/health`          — boot/uptime check: performs a tiny
 *   Chromium render and returns 200/503. Safe to expose publicly.
 *
 * Tokens are opaque UUIDv4s, 60s TTL, stored in memory (single-instance
 * deploy — if we ever scale horizontally, move to Redis). Unguessability is
 * the only defense for the payload endpoint; render endpoint additionally
 * requires a valid session cookie.
 */
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { getSession } from '../lib/session.js';
import { getOrder, updateOrder } from '../lib/db.js';
import { storeBuffer, getPublicUrl } from '../lib/storage.js';
import {
  renderPoster,
  consumePayload,
  storePayload,
  healthCheck,
  RenderBusyError,
  type RenderPayload,
} from '../lib/poster-renderer.js';
import { log, newRequestId } from '../lib/logger.js';
import { reportServerError } from '../lib/error-reporter.js';

export const renderRouter = Router();

const COOKIE_NAME = 'runink_session';

// Server-side feature flag — decoupled from the client `VITE_RENDER_ON_SERVER`
// flag so a stale client cannot accidentally invoke an unprepared server.
// Both must be 'true' for the server-render path to be reachable end-to-end.
const SERVER_RENDER_ENABLED = process.env.ENABLE_SERVER_RENDER === 'true';

// Belt-and-braces gate on dev-only smoke endpoints. NODE_ENV alone is not
// enough — accidental misconfiguration in DO could leave it unset/'development'.
const SMOKE_ENDPOINTS_ENABLED =
  process.env.NODE_ENV !== 'production' &&
  process.env.ENABLE_SMOKE_ENDPOINTS === 'true';

/** Max JSON payload bytes after parse. Tracks count is also capped at 500;
 *  this cap catches deeply-nested theme/config blobs that would slip past. */
const MAX_PAYLOAD_BYTES = 5_000_000;

// Rate limit — rendering is expensive (Chromium launch, tile fetch). Cap
// per-IP to deter abuse; legitimate order flows hit this once per purchase.
const renderLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many render requests, please slow down' },
});

// Free exports are more frequent than orders (users iterate on themes), but
// each render still ties up a Chromium context for 2-7 s. 30/15 min per IP
// covers an enthusiastic editing session; the client falls back to local
// capture rendering when limited.
const exportLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many export requests, please slow down' },
});

type RenderDimensions = { widthMm: number; heightMm: number; dpi: number; tierId?: string };

/** Shared body validation for the order and export render routes. Returns the
 *  parsed payload/dimensions, or the HTTP error to send. */
function validateRenderBody(body: unknown):
  | { ok: true; payload: RenderPayload; dimensions: RenderDimensions; serialisedBytes: number }
  | { ok: false; status: number; error: string; serialisedBytes?: number } {
  const { payload, dimensions } = (body ?? {}) as {
    payload?: RenderPayload;
    dimensions?: RenderDimensions;
  };

  if (!payload || !dimensions) {
    return { ok: false, status: 400, error: 'Missing payload or dimensions' };
  }
  if (
    typeof dimensions.widthMm !== 'number' ||
    typeof dimensions.heightMm !== 'number' ||
    typeof dimensions.dpi !== 'number' ||
    dimensions.widthMm < 50 || dimensions.heightMm < 50 ||
    dimensions.widthMm > 1500 || dimensions.heightMm > 1500 ||
    dimensions.dpi < 72 || dimensions.dpi > 600
  ) {
    return { ok: false, status: 400, error: 'Invalid dimensions' };
  }

  // Belt-and-braces size limits — payload lives in memory for 60s and is
  // walked by the Playwright browser. A run-away payload would OOM the box.
  if (!Array.isArray(payload.tracks) || payload.tracks.length > 500) {
    return { ok: false, status: 413, error: 'Too many tracks' };
  }
  // Catch deeply-nested theme/config blobs that slip past the tracks check.
  // JSON.stringify is the most accurate measure of the in-memory + serialised
  // payload footprint; the 8 MB body-parser limit is a coarser pre-filter.
  const serialisedBytes = Buffer.byteLength(JSON.stringify(payload), 'utf8');
  if (serialisedBytes > MAX_PAYLOAD_BYTES) {
    return { ok: false, status: 413, error: 'Payload too large', serialisedBytes };
  }

  return { ok: true, payload, dimensions, serialisedBytes };
}

// Separate, higher-throughput limiter for the loopback payload endpoint.
// Only the internal Chromium hits this in practice, but the token is the only
// guard — a brute-forcer who can spam endpoints could try to land within a
// 60 s TTL window. 60/min/IP is plenty for legitimate use.
const payloadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many payload requests' },
});

/**
 * Internal payload fetch — no auth because the token IS the capability.
 * The route is only reachable via the internal Playwright browser hitting
 * loopback; the app's React code receives its token via URL param. Tokens
 * are consumed on read.
 *
 * NOTE: Served with Cache-Control: no-store so intermediate proxies never
 * cache the payload.
 */
renderRouter.get('/payload/:token', payloadLimiter, (req, res) => {
  const token = req.params.token;
  if (!/^[0-9a-f-]{36}$/i.test(token)) {
    return res.status(400).json({ error: 'Invalid token' });
  }
  const payload = consumePayload(token);
  if (!payload) {
    return res.status(404).json({ error: 'Token not found or expired' });
  }
  res.setHeader('Cache-Control', 'no-store');
  res.json(payload);
});

/**
 * Public health endpoint. Performs a tiny Chromium render (1 char into a
 * blank page) and returns 200 if it worked, 503 if not. Used by uptime
 * monitors and the post-deploy smoke check.
 *
 * Not gated by SERVER_RENDER_ENABLED — we want to know Chromium is alive
 * even when the customer-facing flag is off, so we can flip the flag with
 * confidence later.
 */
renderRouter.get('/health', async (_req, res) => {
  // Uses the cached healthCheck (60 s freshness) so a 1-min uptime probe
  // doesn't launch a fresh Chromium context every call. The cache is
  // invalidated automatically if browser.isConnected() flips false, so
  // we never serve a stale "ok" against a dead Chromium.
  const result = await healthCheck();
  res.status(result.ok ? 200 : 503).json(result);
});

if (SMOKE_ENDPOINTS_ENABLED) {
  // Dev helper: mint a fake Strava session so smoke scripts can exercise
  // session-gated routes (e.g. /export) end-to-end without OAuth.
  renderRouter.post('/_smoke-session', async (req, res) => {
    const { createSession } = await import('../lib/session.js');
    const sessionId = createSession({
      accessToken: 'smoke-token',
      refreshToken: 'smoke-refresh',
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
      athleteId: 0,
      athleteName: 'Smoke Test',
    });
    res.json({ sessionId });
  });

  // Dev helper: seed a payload, get a token back. Useful for Playwright
  // inspection scripts that want to navigate to the internal page directly.
  renderRouter.post('/_smoke-seed', (req, res) => {
    const payload = req.body as RenderPayload;
    if (!payload) return res.status(400).json({ error: 'Missing payload' });
    const token = storePayload(payload);
    res.json({ token });
  });

  renderRouter.post('/_smoke', async (req, res) => {
    const { payload, dimensions } = req.body as {
      payload?: RenderPayload;
      dimensions?: { widthMm: number; heightMm: number; dpi: number };
    };
    if (!payload || !dimensions) {
      return res.status(400).json({ error: 'Missing payload or dimensions' });
    }
    try {
      const port = parseInt(process.env.PORT || process.env.SERVER_PORT || '8080', 10);
      const internalBaseUrl = `http://127.0.0.1:${port}`;
      const buf = await renderPoster(payload, { ...dimensions, internalBaseUrl });
      res.setHeader('Content-Type', 'image/png');
      res.send(buf);
    } catch (err) {
      log.error('Smoke render failed', {
        scope: 'render.smoke',
        outcome: 'error',
        error: (err as Error).message,
      });
      res.status(500).json({ error: (err as Error).message || 'Smoke render failed' });
    }
  });
}

renderRouter.post('/order/:orderId', renderLimiter, async (req, res) => {
  const requestId = newRequestId();
  const { orderId } = req.params;

  if (!SERVER_RENDER_ENABLED) {
    log.warn('Render request rejected — server flag off', {
      scope: 'render.order',
      requestId,
      orderId,
      outcome: 'rejected',
    });
    return res.status(503).json({
      error: 'Server rendering is not enabled on this deployment',
      requestId,
    });
  }

  const sessionId = req.cookies?.[COOKIE_NAME];
  if (!sessionId) {
    return res.status(401).json({ error: 'Not connected to Strava', requestId });
  }
  const session = getSession(sessionId);
  if (!session) {
    return res.status(401).json({ error: 'Session expired', requestId });
  }

  const order = await getOrder(orderId);
  if (!order) {
    return res.status(404).json({ error: 'Order not found', requestId });
  }

  const validated = validateRenderBody(req.body);
  if (!validated.ok) {
    if (validated.error === 'Payload too large') {
      log.warn('Payload rejected — too large', {
        scope: 'render.order',
        requestId,
        orderId,
        outcome: 'rejected',
        payloadBytes: validated.serialisedBytes,
      });
    }
    return res.status(validated.status).json({ error: validated.error, requestId });
  }
  const { payload, dimensions, serialisedBytes } = validated;

  log.info('Render started', {
    scope: 'render.order',
    requestId,
    orderId,
    payloadBytes: serialisedBytes,
    trackCount: payload.tracks.length,
    widthMm: dimensions.widthMm,
    heightMm: dimensions.heightMm,
    dpi: dimensions.dpi,
  });

  const renderStarted = Date.now();
  try {
    const port = parseInt(process.env.PORT || process.env.SERVER_PORT || '8080', 10);
    const internalBaseUrl = `http://127.0.0.1:${port}`;

    const buf = await renderPoster(payload, {
      widthMm: dimensions.widthMm,
      heightMm: dimensions.heightMm,
      dpi: dimensions.dpi,
      internalBaseUrl,
      requestId,
    });

    // Store under a stable key per order — re-renders overwrite. The Stripe
    // webhook reads png_url from the orders row to hand off to Gelato, so we
    // need the URL set before the user finishes checkout.
    const key = `orders/${orderId}/poster.png`;
    await storeBuffer(key, buf, 'image/png');

    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const publicUrl = getPublicUrl(key, baseUrl);
    await updateOrder(orderId, { png_url: publicUrl });

    log.info('Render completed', {
      scope: 'render.order',
      requestId,
      orderId,
      outcome: 'ok',
      bufferBytes: buf.length,
      pngUrl: publicUrl,
    });
    res.json({ imageUrl: publicUrl, requestId });
  } catch (err) {
    const durationMs = Date.now() - renderStarted;
    if (err instanceof RenderBusyError) {
      log.warn('Render queue full', {
        scope: 'render.order',
        requestId,
        orderId,
        outcome: 'rejected',
      });
      // Queue saturation is a capacity signal, not a code bug — but
      // worth tracking so we can see "we hit the cap N times today"
      // in Mixpanel without grepping logs.
      reportServerError(err, {
        scope: 'render.order',
        method: 'POST',
        route: '/api/render/order/:orderId',
        httpStatus: 503,
        requestId,
        durationMs,
        extra: { order_id: orderId, reason: 'queue_full' },
      });
      return res.status(503).json({ error: 'Server busy, please retry in a moment', requestId });
    }
    log.error('Render failed', {
      scope: 'render.order',
      requestId,
      orderId,
      outcome: 'error',
      error: (err as Error).message,
    });
    // Real render failure — the client's `client_error { error_source:
    // 'render', request_id }` event will land in Mixpanel at the same
    // time; joining on request_id gives you a complete picture of
    // what happened on both sides.
    reportServerError(err, {
      scope: 'render.order',
      method: 'POST',
      route: '/api/render/order/:orderId',
      httpStatus: 500,
      requestId,
      durationMs,
      extra: {
        order_id: orderId,
        width_mm: dimensions.widthMm,
        height_mm: dimensions.heightMm,
        dpi: dimensions.dpi,
        track_count: payload.tracks.length,
      },
    });
    res.status(500).json({ error: 'Failed to render poster', requestId });
  }
});

/**
 * Free-export render — same Playwright pipeline as paid orders, but the PNG
 * streams straight back to the browser instead of landing in R2 against an
 * order row. Exists because client-side capture is unreliable on mobile
 * (iOS WebGL context eviction + canvas size limits produced black exports);
 * the server render is device-independent by construction.
 *
 * The client falls back to local capture rendering on any failure here, so
 * errors are cheap — but still reported for visibility.
 */
renderRouter.post('/export', exportLimiter, async (req, res) => {
  const requestId = newRequestId();

  if (!SERVER_RENDER_ENABLED) {
    return res.status(503).json({
      error: 'Server rendering is not enabled on this deployment',
      requestId,
    });
  }

  const sessionId = req.cookies?.[COOKIE_NAME];
  if (!sessionId || !getSession(sessionId)) {
    return res.status(401).json({ error: 'Not connected to Strava', requestId });
  }

  const validated = validateRenderBody(req.body);
  if (!validated.ok) {
    if (validated.error === 'Payload too large') {
      log.warn('Payload rejected — too large', {
        scope: 'render.export',
        requestId,
        outcome: 'rejected',
        payloadBytes: validated.serialisedBytes,
      });
    }
    return res.status(validated.status).json({ error: validated.error, requestId });
  }
  const { payload, dimensions, serialisedBytes } = validated;

  log.info('Export render started', {
    scope: 'render.export',
    requestId,
    payloadBytes: serialisedBytes,
    trackCount: payload.tracks.length,
    widthMm: dimensions.widthMm,
    heightMm: dimensions.heightMm,
    dpi: dimensions.dpi,
  });

  const renderStarted = Date.now();
  try {
    const port = parseInt(process.env.PORT || process.env.SERVER_PORT || '8080', 10);
    const internalBaseUrl = `http://127.0.0.1:${port}`;

    const buf = await renderPoster(payload, {
      widthMm: dimensions.widthMm,
      heightMm: dimensions.heightMm,
      dpi: dimensions.dpi,
      internalBaseUrl,
      requestId,
    });

    log.info('Export render completed', {
      scope: 'render.export',
      requestId,
      outcome: 'ok',
      bufferBytes: buf.length,
      durationMs: Date.now() - renderStarted,
    });
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Render-Request-Id', requestId);
    res.send(buf);
  } catch (err) {
    const durationMs = Date.now() - renderStarted;
    if (err instanceof RenderBusyError) {
      log.warn('Export render queue full', {
        scope: 'render.export',
        requestId,
        outcome: 'rejected',
      });
      reportServerError(err, {
        scope: 'render.export',
        method: 'POST',
        route: '/api/render/export',
        httpStatus: 503,
        requestId,
        durationMs,
        extra: { reason: 'queue_full' },
      });
      return res.status(503).json({ error: 'Server busy, please retry in a moment', requestId });
    }
    log.error('Export render failed', {
      scope: 'render.export',
      requestId,
      outcome: 'error',
      error: (err as Error).message,
    });
    reportServerError(err, {
      scope: 'render.export',
      method: 'POST',
      route: '/api/render/export',
      httpStatus: 500,
      requestId,
      durationMs,
      extra: {
        width_mm: dimensions.widthMm,
        height_mm: dimensions.heightMm,
        dpi: dimensions.dpi,
        track_count: payload.tracks.length,
      },
    });
    res.status(500).json({ error: 'Failed to render poster', requestId });
  }
});
