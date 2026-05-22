/**
 * Tiny in-memory singleton that captures the most recent server render
 * requestId (and error correlation requestId) for the diagnostic
 * overlay. NOT persisted — a page reload wipes it. Not sent anywhere.
 *
 * Why a module-level singleton rather than a React context: the
 * diagnostic overlay is reachable from the root App.tsx, but render
 * calls happen deep inside PosterEditor and its descendants. A context
 * provider would force us to wrap a lot of unrelated code. A module
 * singleton is good enough for diagnostic telemetry — it's not
 * security-sensitive data.
 */

type Listener = () => void;

let lastRequestId: string | null = null;
const listeners = new Set<Listener>();

function emit(): void {
  for (const l of listeners) {
    try { l(); } catch { /* listener bugs don't break telemetry */ }
  }
}

/** Record a freshly-completed (or freshly-failed) render attempt. */
export function recordRenderRequestId(id: string | null | undefined): void {
  if (!id) return;
  lastRequestId = id;
  emit();
}

/** Peek without consuming — used by the overlay so reopening it shows the same value. */
export function peekLastRenderRequestId(): string | null {
  return lastRequestId;
}

/** Clear the stored id. Used by the overlay's "Reset" button. */
export function consumeLastRenderRequestId(): string | null {
  const id = lastRequestId;
  lastRequestId = null;
  emit();
  return id;
}

/** Subscribe to changes. Returns an unsubscribe function. */
export function subscribeRenderRequestId(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
