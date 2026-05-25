/**
 * Server-side error reporting to Mixpanel.
 *
 * Mirrors `src/shared/diagnostics/errorReporter.ts` on the client.
 * Together they form a correlated stream: every error has a
 * `request_id` you can use to join the client and server sides of
 * the same failed request.
 *
 * Why not the official `mixpanel` npm package: it's ~14 KB and pulls
 * a couple of transitive deps for a single HTTP POST. Their /track/
 * endpoint is a base64-encoded JSON payload — three lines of fetch,
 * no new dependency.
 *
 * Why not push EVERY log.error into Mixpanel automatically: we want
 * Mixpanel to surface CUSTOMER-IMPACTING failures, not noisy logs.
 * Hook this explicitly into 5xx paths in render / orders / activities,
 * not into every transient retry log line.
 *
 * Design notes:
 *   - Fire-and-forget. Never await the HTTP call from a request
 *     handler; never let a failed Mixpanel call propagate back to
 *     the customer.
 *   - Best-effort. If the project token is missing or the network is
 *     down, log and move on. The DO logs are the source of truth.
 *   - Same event name `server_error` (vs the client's `client_error`)
 *     so dashboards stay unambiguous about which side an event came
 *     from. Join via request_id.
 */
import { log } from './logger.js';

// Mixpanel project tokens aren't secret — the client embeds the same
// token in index.html, served to every browser. Match it here so
// client and server events land in the same project. Override via env
// in case we want to send server errors to a separate project later.
const MIXPANEL_TOKEN = process.env.MIXPANEL_TOKEN ?? 'fe6cf93e1a47a3c9a8386edb57bf2968';
const MIXPANEL_TRACK_URL = 'https://api.mixpanel.com/track';

const MESSAGE_TRUNC = 500;
const STACK_TRUNC = 2000;

export interface ServerErrorContext {
  /** Where in the codebase the error originated. Keep narrow — these
   *  become Mixpanel properties. e.g. 'render.order', 'activities',
   *  'webhooks.stripe'. */
  scope: string;
  /** HTTP method + path of the request, when applicable. */
  method?: string;
  route?: string;
  /** Response status we returned to the client. */
  httpStatus?: number;
  /** Correlation ID — must match what we return to the client so
   *  the client's `client_error` event joins to this `server_error`
   *  event via request_id. */
  requestId?: string | null;
  /** How long the failing operation ran for, in ms. Helps spot
   *  "timed out at 45s" vs "rejected immediately". */
  durationMs?: number;
  /** Free-form extras. Use sparingly — high-cardinality props are
   *  pricey on Mixpanel and noisy in dashboards. */
  extra?: Record<string, string | number | boolean | null>;
}

function safeMessage(err: unknown): string {
  if (err instanceof Error) return (err.message || err.name).slice(0, MESSAGE_TRUNC);
  if (typeof err === 'string') return err.slice(0, MESSAGE_TRUNC);
  try { return JSON.stringify(err).slice(0, MESSAGE_TRUNC); } catch { return String(err).slice(0, MESSAGE_TRUNC); }
}

function safeStack(err: unknown): string {
  if (err instanceof Error && err.stack) return err.stack.slice(0, STACK_TRUNC);
  return '';
}

function errorName(err: unknown): string {
  if (err instanceof Error) return err.name || 'Error';
  return typeof err;
}

/**
 * Send a `server_error` event to Mixpanel. Fire-and-forget — the
 * returned promise resolves whether or not the upstream call
 * succeeded, and is mostly there for tests. Never await this in a
 * request handler.
 */
export function reportServerError(err: unknown, ctx: ServerErrorContext): void {
  // Build the event off the request thread, send it on the next tick
  // so the caller's `res.json(...)` is never blocked.
  setImmediate(() => {
    sendServerError(err, ctx).catch((reporterErr) => {
      // Never let a failed Mixpanel call surface as an unhandled
      // promise rejection — that would be caught by our process
      // listeners and create a feedback loop.
      try {
        log.warn('errorReporter: Mixpanel call failed', {
          scope: 'errorReporter',
          error: (reporterErr as Error)?.message,
        });
      } catch { /* ignore */ }
    });
  });
}

async function sendServerError(err: unknown, ctx: ServerErrorContext): Promise<void> {
  if (!MIXPANEL_TOKEN) return;

  const props: Record<string, unknown> = {
    token: MIXPANEL_TOKEN,
    // Standard fields — match the client's client_error schema so
    // cross-side dashboards align.
    error_name: errorName(err),
    error_message: safeMessage(err),
    error_scope: ctx.scope,
    request_id: ctx.requestId ?? null,
    http_status: ctx.httpStatus ?? null,
    duration_ms: ctx.durationMs ?? null,
    route: ctx.route ?? null,
    method: ctx.method ?? null,
    // Build / environment context — answers "which deploy was this on"
    env: process.env.NODE_ENV ?? 'unknown',
    node_version: process.version,
    // Diagnostic
    stack: safeStack(err),
  };

  if (ctx.extra) {
    for (const [k, v] of Object.entries(ctx.extra)) {
      if (k in props) continue; // protect standard fields
      props[k] = v;
    }
  }

  const event = {
    event: 'server_error',
    properties: props,
  };

  // Mixpanel /track/ accepts a base64-encoded JSON payload as a `data`
  // query parameter OR a JSON body POST. Body POST is simpler and
  // doesn't have URL-length concerns for long stacks.
  // 5s timeout — we don't want a slow Mixpanel call to pin a Node
  // event loop slot indefinitely.
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 5_000);
  try {
    const res = await fetch(MIXPANEL_TRACK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/plain' },
      body: JSON.stringify([event]),
      signal: ac.signal,
    });
    if (!res.ok) {
      log.warn('errorReporter: Mixpanel returned non-2xx', {
        scope: 'errorReporter',
        status: res.status,
      });
    }
  } finally {
    clearTimeout(timer);
  }
}
