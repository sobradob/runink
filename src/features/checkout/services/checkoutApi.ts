export interface GiftTierInfo {
  id: string;
  name: string;
  description: string;
  priceCents: number;
  framed: boolean;
}

export async function fetchGiftTiers(): Promise<GiftTierInfo[]> {
  const res = await fetch('/api/gift/tiers');
  const data = await res.json();
  return data.tiers;
}

export async function purchaseGift(params: {
  tierId: string;
  purchaserEmail?: string;
  recipientName?: string;
}): Promise<{ url: string }> {
  const res = await fetch('/api/gift/purchase', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error('Failed to create checkout');
  return res.json();
}

export interface GiftCodeInfo {
  code: string;
  tier: string;
  tierName: string;
  tierDescription: string;
  recipientName: string | null;
  status: string;
}

export async function validateGiftCode(code: string): Promise<GiftCodeInfo> {
  const res = await fetch(`/api/gift/${code}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Invalid code' }));
    throw new Error(err.error);
  }
  return res.json();
}

export async function redeemGiftCode(code: string): Promise<{ tier: string }> {
  const res = await fetch(`/api/gift/${code}/redeem`, { method: 'POST' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Redemption failed' }));
    throw new Error(err.error);
  }
  return res.json();
}

export interface OrderInfo {
  orderId: string;
  type: string;
  tier: string;
  status: string;
  pngUrl: string | null;
  gelatoOrderId: string | null;
  posterConfig: any;
  createdAt: string;
}

export async function getOrderDetails(orderId: string): Promise<OrderInfo> {
  const res = await fetch(`/api/orders/${orderId}`);
  if (!res.ok) throw new Error('Order not found');
  return res.json();
}

export async function createDirectOrder(params: {
  tierId: string;
  posterConfig?: any;
}): Promise<{ orderId: string; checkoutUrl: string }> {
  const res = await fetch('/api/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error('Failed to create order');
  return res.json();
}

export async function createGiftOrder(params: {
  giftCode: string;
  tierId: string;
  email?: string;
  posterConfig?: any;
}): Promise<{ orderId: string }> {
  const res = await fetch('/api/orders/from-gift', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error('Failed to create order');
  return res.json();
}

export async function getUploadUrl(orderId: string): Promise<{ url: string; method: string; key: string; local: boolean }> {
  const res = await fetch(`/api/orders/${orderId}/upload-url`, { method: 'POST' });
  if (!res.ok) throw new Error('Failed to get upload URL');
  return res.json();
}

export async function uploadPosterPng(uploadUrl: string, method: string, blob: Blob, orderId: string, isLocal: boolean): Promise<void> {
  const res = await fetch(uploadUrl, {
    method,
    headers: { 'Content-Type': 'image/png' },
    body: blob,
  });
  if (!res.ok) throw new Error('Failed to upload poster');

  // For R2 uploads, confirm the upload so the backend stores the png_url
  if (!isLocal) {
    const confirmRes = await fetch(`/api/orders/${orderId}/confirm-upload`, { method: 'POST' });
    if (!confirmRes.ok) throw new Error('Failed to confirm upload');
  }
}

import { recordRenderRequestId } from '@/shared/diagnostics/renderTelemetry';

/**
 * Error thrown by renderPosterOnServer. Carries the server's requestId
 * (when available) so user-facing error UI can show it for support
 * correlation, and a `retryable` flag so callers can decide whether to
 * surface a retry button vs a hard failure.
 */
export class RenderError extends Error {
  readonly requestId: string | null;
  readonly status: number | null;
  readonly retryable: boolean;
  constructor(message: string, opts: { requestId?: string | null; status?: number | null; retryable?: boolean } = {}) {
    super(message);
    this.name = 'RenderError';
    this.requestId = opts.requestId ?? null;
    this.status = opts.status ?? null;
    this.retryable = opts.retryable ?? false;
  }
}

/** Wait `ms` milliseconds, but bail early if the signal aborts. */
function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new DOMException('Aborted', 'AbortError'));
    }, { once: true });
  });
}

/**
 * Server-side render path: POST the full poster payload, server runs
 * Playwright + Chromium to produce the PNG, uploads it to R2, and attaches
 * the URL to the order row. The old flow (renderPoster → getUploadUrl →
 * uploadPosterPng) is still available as a fallback.
 *
 * Resilience:
 *   - 503 RENDER_BUSY (queue full) auto-retries with exponential backoff,
 *     since the server's queue may free up within a few seconds.
 *   - Network errors auto-retry — flaky mobile signal is the common case.
 *   - 4xx (except 408/429) does NOT retry — those are payload/auth errors
 *     that won't fix themselves.
 *   - Client-side timeout of 60 s per attempt via AbortController; the
 *     server's own timeout is 45 s so we add a buffer for the network leg.
 *   - Errors carry the server requestId so support can grep production
 *     logs for the exact attempt.
 */
const RENDER_TIMEOUT_MS = 60_000;
const RENDER_MAX_ATTEMPTS = 3;
const RENDER_RETRY_BASE_MS = 1500;

async function fetchRenderWithRetry(
  url: string,
  body: unknown,
  callerSignal?: AbortSignal,
): Promise<Response> {
  let lastErr: RenderError | null = null;
  for (let attempt = 1; attempt <= RENDER_MAX_ATTEMPTS; attempt++) {
    if (callerSignal?.aborted) {
      throw new RenderError('Cancelled', { retryable: false });
    }
    // Per-attempt timeout. Linked to the caller's abort signal so a user
    // who navigates away cancels the in-flight request cleanly.
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), RENDER_TIMEOUT_MS);
    const onCallerAbort = () => ac.abort();
    callerSignal?.addEventListener('abort', onCallerAbort, { once: true });

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: ac.signal,
      });
      if (res.ok) {
        return res;
      }
      const errBody = await res.json().catch(() => ({} as { error?: string; requestId?: string }));
      const requestId = errBody.requestId ?? null;
      recordRenderRequestId(requestId);
      const retryable = res.status === 503 || res.status === 429 || res.status === 408;
      lastErr = new RenderError(errBody.error || `Render failed (HTTP ${res.status})`, {
        requestId, status: res.status, retryable,
      });
      if (!retryable) throw lastErr;
    } catch (e) {
      // Cleanup timer/listener regardless of which branch we exited via.
      if ((e as DOMException)?.name === 'AbortError') {
        // Caller aborted vs our own timeout — both surface as AbortError;
        // distinguish via callerSignal.
        if (callerSignal?.aborted) {
          throw new RenderError('Cancelled', { retryable: false });
        }
        lastErr = new RenderError('Render timed out', { retryable: true });
      } else if (e instanceof RenderError) {
        if (!e.retryable) throw e;
        lastErr = e;
      } else {
        // Network error (DNS, TCP reset, offline, etc.) — retry.
        lastErr = new RenderError((e as Error)?.message || 'Network error', { retryable: true });
      }
    } finally {
      clearTimeout(timer);
      callerSignal?.removeEventListener('abort', onCallerAbort);
    }

    // Don't sleep after the last attempt — caller wants the failure now.
    if (attempt < RENDER_MAX_ATTEMPTS) {
      const backoff = RENDER_RETRY_BASE_MS * attempt; // 1.5s, 3s
      try { await delay(backoff, callerSignal); } catch { /* aborted */ }
    }
  }
  throw lastErr ?? new RenderError('Render failed after retries', { retryable: false });
}

export async function renderPosterOnServer(
  orderId: string,
  payload: unknown,
  dimensions: { widthMm: number; heightMm: number; dpi: number; tierId?: string },
  callerSignal?: AbortSignal,
): Promise<{ imageUrl: string; requestId?: string }> {
  const res = await fetchRenderWithRetry(
    `/api/render/order/${orderId}`,
    { payload, dimensions },
    callerSignal,
  );
  const body = await res.json() as { imageUrl: string; requestId?: string };
  recordRenderRequestId(body.requestId);
  return body;
}

/**
 * Free-export render path: same payload and retry semantics as
 * renderPosterOnServer, but the server streams the PNG straight back instead
 * of attaching it to an order. Callers should fall back to client-side
 * rendering when this throws — the export must still succeed offline.
 */
export async function renderExportOnServer(
  payload: unknown,
  dimensions: { widthMm: number; heightMm: number; dpi: number },
  callerSignal?: AbortSignal,
): Promise<Blob> {
  const res = await fetchRenderWithRetry('/api/render/export', { payload, dimensions }, callerSignal);
  recordRenderRequestId(res.headers.get('X-Render-Request-Id'));
  return res.blob();
}

// === Gift context persistence (cookie + URL param fallback) ===

export interface GiftContext {
  giftCode: string;
  tier: string;
}

const GIFT_COOKIE = 'runink_gift';

export function persistGiftContext(ctx: GiftContext): void {
  document.cookie = `${GIFT_COOKIE}=${encodeURIComponent(JSON.stringify(ctx))}; path=/; max-age=86400; SameSite=Lax`;
}

export function clearGiftContext(): void {
  document.cookie = `${GIFT_COOKIE}=; path=/; max-age=0`;
}

export function getGiftContext(): GiftContext | null {
  // 1. Check URL params (redeem redirect fallback)
  const params = new URLSearchParams(window.location.search);
  const redeemed = params.get('redeemed');
  const tier = params.get('tier');
  if (redeemed && tier) {
    const ctx: GiftContext = { giftCode: redeemed, tier };
    persistGiftContext(ctx);
    return ctx;
  }

  // 2. Check cookie
  const match = document.cookie.match(new RegExp(`${GIFT_COOKIE}=([^;]+)`));
  if (match) {
    try {
      return JSON.parse(decodeURIComponent(match[1]));
    } catch { return null; }
  }

  return null;
}

export async function submitShipping(orderId: string, address: {
  name: string;
  email?: string;
  phone?: string;
  address1: string;
  address2?: string;
  city: string;
  stateCode?: string;
  countryCode: string;
  zip: string;
}): Promise<{ status: string }> {
  const res = await fetch(`/api/orders/${orderId}/ship`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(address),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Shipping failed' }));
    throw new Error(err.error);
  }
  return res.json();
}
