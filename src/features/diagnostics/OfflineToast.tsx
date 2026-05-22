/**
 * OfflineToast — non-modal indicator that surfaces when the device
 * drops its network connection. Auto-dismisses when connectivity
 * returns.
 *
 * Why mount this once at the root: the offline state is a global
 * concern (every fetch will fail), and the user benefits from a
 * consistent, persistent indicator rather than each call site
 * reinventing its own error UI for the same root cause.
 *
 * Limitations:
 *   - navigator.onLine is a hint, not a guarantee. The OS may report
 *     "online" while the cellular link is captive-portal'd or the
 *     route is dropping packets. We accept that — the toast is a
 *     belt for the obvious case (airplane mode, no signal). Actual
 *     fetch failures are handled at the call sites.
 *   - 'offline'/'online' events are debounced by the OS already, so
 *     a flapping connection doesn't spam the UI.
 */
import { useEffect, useState } from 'react';

export function OfflineToast() {
  const [online, setOnline] = useState<boolean>(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );

  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);

  if (online) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed top-3 left-1/2 -translate-x-1/2 z-[9000] max-w-[90vw] px-4 py-2 rounded-full bg-amber-900/85 border border-amber-500/40 text-amber-100 text-xs font-medium shadow-lg backdrop-blur-sm flex items-center gap-2"
    >
      <span
        aria-hidden
        className="inline-block w-1.5 h-1.5 rounded-full bg-amber-300 animate-pulse"
      />
      You're offline — actions may fail until the connection returns.
    </div>
  );
}
