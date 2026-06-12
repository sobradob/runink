import type { ActivitySummary, TrackData } from '@/types/activity';

export interface StravaAuthStatus {
  connected: boolean;
  athlete?: { name: string; id: number };
}

export async function checkStravaAuth(): Promise<StravaAuthStatus> {
  try {
    const res = await fetch('/auth/strava/status');
    if (!res.ok) return { connected: false };
    return res.json();
  } catch {
    return { connected: false };
  }
}

export function initiateStravaAuth() {
  window.location.href = '/auth/strava';
}

export async function disconnectStrava(): Promise<void> {
  await fetch('/auth/strava/disconnect', { method: 'POST' });
}

export interface StravaActivitiesResponse {
  activities: ActivitySummary[];
  tracks: Record<string, TrackData>;
  /** True when the server returned only part of the history — more activities are coming. */
  partial?: boolean;
  /** Echoed page number for single-page (progressive) requests. */
  page?: number;
  /** Single-page requests: true when this was Strava's last page. */
  complete?: boolean;
}

export interface LoadOptions {
  /** Force refresh the server-side cache. */
  refresh?: boolean;
  /** Ask the server for the first page only (fast path for mobile cold-start). */
  quick?: boolean;
  /** Fetch exactly one Strava page (2+) — the progressive loader's follow-up
   *  to a partial quick load. Mutually exclusive with quick/refresh. */
  page?: number;
  /** AbortSignal to cancel the request (e.g., component unmount). */
  signal?: AbortSignal;
}

/**
 * Fetch that retries transient network failures (iOS Safari's "Load failed"
 * TypeError, 5xx responses). Auth errors (401) and other 4xx fail fast.
 * Each attempt gets its own 45s abort timeout so a hung socket can't stall
 * the whole retry budget.
 */
async function fetchWithRetry(
  url: string,
  { retries = 2, baseDelayMs = 1000, externalSignal }: {
    retries?: number;
    baseDelayMs?: number;
    externalSignal?: AbortSignal;
  } = {},
): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const attemptController = new AbortController();
    const timeoutId = setTimeout(() => attemptController.abort(), 45_000);
    // Forward caller aborts to the per-attempt controller
    const onExternalAbort = () => attemptController.abort();
    externalSignal?.addEventListener('abort', onExternalAbort, { once: true });

    try {
      const res = await fetch(url, { signal: attemptController.signal });

      // 4xx (except 408/429) are not retryable — the request itself is wrong.
      if (!res.ok && res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
        return res;
      }
      // 2xx or 3xx: success
      if (res.ok) return res;
      // 5xx, 408, 429: fall through to retry
      lastError = new Error(`HTTP ${res.status}`);
    } catch (err: any) {
      // AbortError from the caller's signal shouldn't be retried
      if (externalSignal?.aborted) throw err;
      lastError = err instanceof Error ? err : new Error(String(err));
    } finally {
      clearTimeout(timeoutId);
      externalSignal?.removeEventListener('abort', onExternalAbort);
    }

    if (attempt < retries) {
      // Exponential backoff: 1s, 3s
      const delay = baseDelayMs * Math.pow(3, attempt);
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  throw lastError ?? new Error('Request failed');
}

/**
 * Typed error for Strava-specific failure modes the UI needs to react to
 * (rather than showing a generic "HTTP 500" message). `code` mirrors the
 * server's `code` field — see server/routes/activities.ts.
 */
export class StravaLoaderError extends Error {
  readonly code: string | null;
  readonly status: number;
  constructor(message: string, status: number, code: string | null) {
    super(message);
    this.name = 'StravaLoaderError';
    this.status = status;
    this.code = code;
  }
  /** True iff the user's token doesn't carry activity:read_all — recoverable by reconnecting with the box ticked. */
  isMissingScope(): boolean {
    return this.code === 'STRAVA_MISSING_SCOPE';
  }
  /** True iff the Strava session has been revoked or otherwise invalidated. */
  isSessionInvalid(): boolean {
    return this.code === 'STRAVA_SESSION_INVALID' || this.status === 401;
  }
}

export async function loadStravaActivities(
  optionsOrRefresh: LoadOptions | boolean = {},
): Promise<StravaActivitiesResponse> {
  // Back-compat: the old signature was loadStravaActivities(refresh?: boolean)
  const options: LoadOptions = typeof optionsOrRefresh === 'boolean'
    ? { refresh: optionsOrRefresh }
    : optionsOrRefresh;

  const params = new URLSearchParams();
  if (options.refresh) params.set('refresh', 'true');
  if (options.quick) params.set('quick', 'true');
  if (options.page !== undefined) params.set('page', String(options.page));
  const url = `/api/strava/activities${params.size ? `?${params}` : ''}`;

  const res = await fetchWithRetry(url, { externalSignal: options.signal });

  if (!res.ok) {
    // Try to parse the typed error envelope from the server. The activities
    // route returns 403 + { code: 'STRAVA_MISSING_SCOPE' } when the user
    // authorized without the activities checkbox — the UI uses that to
    // show a targeted reconnect prompt instead of a generic error.
    const body = await res.json().catch(() => ({}));
    const code = typeof body?.code === 'string' ? body.code : null;
    const message = typeof body?.error === 'string'
      ? body.error
      : res.status === 401
        ? 'Not connected to Strava'
        : `Failed to load Strava activities: ${res.status}`;
    throw new StravaLoaderError(message, res.status, code);
  }

  return res.json();
}
