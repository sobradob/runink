/**
 * Centralised client-side error reporting.
 *
 * All client errors — React crashes from AppErrorBoundary, unhandled
 * promise rejections, window 'error' events, and explicitly caught
 * typed errors (RenderError, StravaLoaderError, …) — flow through
 * `reportError()`. It maps to a consistent Mixpanel event schema with
 * enough context (build SHA, requestId, viewport, user agent) that
 * the next Quelentin-class bug shows up in a Mixpanel funnel BEFORE
 * a customer DMs you.
 *
 * Why Mixpanel rather than a dedicated tracker like Sentry: Mixpanel
 * is already initialised in index.html, already disclosed in the
 * privacy policy, and the volume of errors is low enough that we
 * don't need stack-grouping / source maps / issue-workflow features
 * just yet. The trade-off is we lose those features — when we
 * outgrow Mixpanel-for-errors, layer Sentry on top.
 *
 * Design choices:
 *   - Best-effort. Mixpanel may be blocked (ad blocker, privacy
 *     mode, network failure). Errors here MUST NOT crash the app or
 *     mask the original error.
 *   - Deduped. A bug that fires 100x in a render loop would otherwise
 *     spam Mixpanel and obscure the real signal. Identical errors
 *     within 30s are suppressed; we still increment a count.
 *   - Schema-first. The event shape is documented in tasks/lessons.md
 *     so dashboards built today survive future code changes.
 */

/** Allowed sources — keeps the event property bounded so Mixpanel dashboards stay sane. */
export type ErrorSource =
  | 'boundary'            // React error boundary caught a render crash
  | 'unhandled_promise'   // window.onunhandledrejection
  | 'window_error'        // window.onerror (sync throws outside React)
  | 'render'              // server-side poster render failed (RenderError)
  | 'strava'              // Strava data load / auth failed (StravaLoaderError)
  | 'order'               // checkout / order submission failed (generic)
  | 'other';              // anything else explicitly reported

interface ReportContext {
  source: ErrorSource;
  /** Extra correlation hints. Stay narrow — these become Mixpanel
   *  properties and bloating them makes dashboards harder. */
  requestId?: string | null;
  status?: number | null;
  code?: string | null;
  retryable?: boolean;
  /** Free-form extras. Use sparingly — high-cardinality props are
   *  pricey on Mixpanel and noisy in dashboards. */
  extra?: Record<string, string | number | boolean | null>;
}

const DEDUP_WINDOW_MS = 30_000;
const STACK_TRUNC = 1500;
const MESSAGE_TRUNC = 500;
const recent = new Map<string, { count: number; firstAt: number }>();

let warned = false;

function safeStack(err: unknown): string {
  if (err instanceof Error && err.stack) return err.stack.slice(0, STACK_TRUNC);
  return '';
}

function safeMessage(err: unknown): string {
  if (err instanceof Error) return (err.message || err.name).slice(0, MESSAGE_TRUNC);
  if (typeof err === 'string') return err.slice(0, MESSAGE_TRUNC);
  try { return JSON.stringify(err).slice(0, MESSAGE_TRUNC); } catch { return String(err).slice(0, MESSAGE_TRUNC); }
}

function errorName(err: unknown): string {
  if (err instanceof Error) return err.name || 'Error';
  return typeof err;
}

/** Stable-ish identity for dedup. First stack line is usually enough
 *  to distinguish "same bug" from "different bug" without becoming
 *  so brittle that minor variations split into separate buckets. */
function dedupKey(err: unknown, source: ErrorSource): string {
  const stack = safeStack(err);
  const firstStackLine = stack.split('\n').slice(0, 2).join('|');
  return `${source}::${errorName(err)}::${safeMessage(err)}::${firstStackLine}`;
}

function viewport(): string {
  if (typeof window === 'undefined') return '?';
  const { innerWidth, innerHeight, devicePixelRatio } = window;
  return `${innerWidth}x${innerHeight}@${devicePixelRatio}`;
}

/**
 * Send the error to Mixpanel. No-op if Mixpanel isn't loaded.
 *
 * Returns true if reported, false if suppressed (dedup or no Mixpanel).
 * Callers don't need to check — the return is for tests.
 */
export function reportError(err: unknown, ctx: ReportContext): boolean {
  try {
    const mp = typeof window !== 'undefined' ? window.mixpanel : undefined;
    if (!mp || typeof mp.track !== 'function') {
      // Best-effort; log so DevTools shows what we WOULD have sent.
      if (!warned && typeof console !== 'undefined') {
        warned = true;
        console.info('[errorReporter] Mixpanel not available — errors will only log to console');
      }
      console.error(`[${ctx.source}]`, err);
      return false;
    }

    // Dedup within the window. Increment count so we can still see
    // "this fired 47 times" by querying Mixpanel for the first event.
    const key = dedupKey(err, ctx.source);
    const now = Date.now();
    const prior = recent.get(key);
    if (prior && (now - prior.firstAt) < DEDUP_WINDOW_MS) {
      prior.count++;
      return false;
    }
    recent.set(key, { count: 1, firstAt: now });
    // Garbage-collect old entries occasionally so the map doesn't grow forever.
    if (recent.size > 100) {
      for (const [k, v] of recent) {
        if (now - v.firstAt > DEDUP_WINDOW_MS * 2) recent.delete(k);
      }
    }

    const props: Record<string, unknown> = {
      // Standard, dashboard-friendly fields
      error_name: errorName(err),
      error_message: safeMessage(err),
      error_source: ctx.source,
      // Correlation IDs — request_id matches server logs grep-ably
      request_id: ctx.requestId ?? null,
      http_status: ctx.status ?? null,
      error_code: ctx.code ?? null,
      retryable: ctx.retryable ?? null,
      // Build identity — answers "which deploy is the user on"
      build_sha: typeof __BUILD_SHA__ !== 'undefined' ? __BUILD_SHA__ : 'unknown',
      build_time: typeof __BUILD_TIME__ !== 'undefined' ? __BUILD_TIME__ : 'unknown',
      env: import.meta.env.DEV ? 'dev' : 'prod',
      // Device context
      url: typeof window !== 'undefined' ? window.location.pathname + window.location.search : '',
      viewport: viewport(),
      user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
      online: typeof navigator !== 'undefined' ? navigator.onLine : null,
      // Diagnostic stack — truncated, first 1500 chars covers most useful frames
      stack: safeStack(err),
    };

    // Spread any caller-supplied extras LAST so they can't accidentally
    // clobber the standard fields — but warn in console if they tried.
    if (ctx.extra) {
      for (const [k, v] of Object.entries(ctx.extra)) {
        if (k in props) {
          console.warn(`[errorReporter] context.extra.${k} overrides a standard field — ignored`);
          continue;
        }
        props[k] = v;
      }
    }

    mp.track('client_error', props);
    // Also always echo to console so DevTools shows it locally —
    // Mixpanel's network call is fire-and-forget.
    console.error(`[${ctx.source}] reported:`, err);
    return true;
  } catch (reporterErr) {
    // Never let the reporter itself crash the caller. The original
    // error is more important than our telemetry.
    try { console.error('[errorReporter] failed to report:', reporterErr); } catch { /* ignore */ }
    return false;
  }
}

/**
 * Install browser-level handlers for errors that escape every other
 * net (uncaught synchronous throws, unhandled promise rejections).
 * Call once at app boot from main.tsx.
 */
export function installGlobalErrorHandlers(): void {
  if (typeof window === 'undefined') return;
  window.addEventListener('error', (evt) => {
    // `evt.error` is the actual Error; `evt.message`/filename are
    // fallbacks for very old browsers. Prefer the Error when present.
    reportError(evt.error ?? new Error(evt.message || 'window error'), {
      source: 'window_error',
      extra: {
        filename: evt.filename ?? '',
        lineno: evt.lineno ?? 0,
        colno: evt.colno ?? 0,
      },
    });
  });
  window.addEventListener('unhandledrejection', (evt) => {
    // PromiseRejectionEvent.reason can be anything; reportError handles it.
    reportError(evt.reason, { source: 'unhandled_promise' });
  });
}
