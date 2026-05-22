/**
 * usePersistedDraft — small localStorage-backed setter wrapper for the
 * PosterEditor's customization state.
 *
 * Why: on mobile, tabs get killed by the OS aggressively (memory
 * pressure, backgrounding for too long). A user who customised a
 * poster for 10 minutes and then switched apps shouldn't return to a
 * blank slate. Persisting the draft to localStorage and restoring it
 * on mount fixes the most common form of lost-work complaint.
 *
 * Design:
 *   - Keyed by a stable identifier (e.g., the activity ID set). Means
 *     opening a different activity doesn't restore the wrong draft.
 *   - Versioned. If we change the PosterConfig shape, bump VERSION and
 *     old drafts are silently dropped instead of corrupting the React
 *     state with mismatched fields.
 *   - Debounced. Writing on every keystroke would hammer localStorage
 *     and block the main thread during typing.
 *   - Safe-by-default. localStorage write failures (quota, private
 *     mode in older Safari, embedded WebView quirks) are caught — we
 *     log once and continue. The app should never crash because the
 *     persistence layer failed.
 */
import { useEffect, useRef } from 'react';

const VERSION = 1;
const WRITE_DEBOUNCE_MS = 500;

interface Envelope<T> {
  v: number;
  ts: number;
  data: T;
}

let warnedQuota = false;

function safeRead<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const env = JSON.parse(raw) as Envelope<T>;
    if (!env || env.v !== VERSION) return null;
    return env.data;
  } catch {
    return null;
  }
}

function safeWrite<T>(key: string, data: T): void {
  try {
    const env: Envelope<T> = { v: VERSION, ts: Date.now(), data };
    localStorage.setItem(key, JSON.stringify(env));
  } catch (err) {
    // Most common cause: storage quota exceeded (mobile Safari ~5MB).
    // Also fires in privacy-mode WebViews. Drop the persistence rather
    // than crashing the editor; the user just loses the refresh
    // safety net, not the current session.
    if (!warnedQuota) {
      warnedQuota = true;
      console.warn('[draft] localStorage write failed — drafts will not persist', err);
    }
  }
}

function safeRemove(key: string): void {
  try { localStorage.removeItem(key); } catch { /* ignore */ }
}

/**
 * Read a previously-saved draft synchronously. Use in lazy useState
 * initialiser so the React render uses the persisted value on first
 * paint — no flash of the default state.
 */
export function readDraft<T>(key: string): T | null {
  if (typeof localStorage === 'undefined') return null;
  return safeRead<T>(key);
}

/**
 * Subscribe to changes in `value` and persist them under `key`, with a
 * 500 ms debounce so rapid edits (typing in a title field) don't
 * hammer the storage.
 */
export function usePersistDraft<T>(key: string, value: T, enabled = true): void {
  const timerRef = useRef<number | null>(null);
  useEffect(() => {
    if (!enabled || typeof localStorage === 'undefined') return;
    if (timerRef.current != null) clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      safeWrite(key, value);
    }, WRITE_DEBOUNCE_MS);
    return () => {
      if (timerRef.current != null) clearTimeout(timerRef.current);
    };
  }, [key, value, enabled]);

  // Flush immediately on tab hide — pagehide fires reliably on mobile
  // (even when the OS kills the tab without firing unload).
  useEffect(() => {
    if (!enabled) return;
    const flush = () => safeWrite(key, value);
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  }, [key, value, enabled]);
}

/** Explicitly drop a draft — e.g. after a successful order submit. */
export function clearDraft(key: string): void {
  if (typeof localStorage === 'undefined') return;
  safeRemove(key);
}

/**
 * Derive a stable key for the editor draft. Activity IDs are sorted
 * so that {a,b} and {b,a} share the same draft. The 'mode' prefix
 * ensures an individual draft never collides with a compilation
 * draft on the same activity.
 */
export function draftKey(mode: 'individual' | 'compilation', ids: string[]): string {
  const sorted = [...ids].sort().join(',');
  return `runink:draft:${mode}:${sorted}`;
}
