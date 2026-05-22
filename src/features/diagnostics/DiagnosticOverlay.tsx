/**
 * Diagnostic overlay — long-press the logo to open. Shows:
 *   - which deploy the user is looking at (build SHA + time)
 *   - device info (user agent, viewport, devicePixelRatio)
 *   - the last server requestId from a render attempt (if any)
 *   - storage state (gift cookie, Strava session present)
 *   - a tap-to-copy report so the user can paste it into a support DM
 *
 * Why this exists: when a customer says "the poster on my phone looks
 * wrong," the single most expensive thing we can ask them to do is
 * reproduce it on a different device. Instead, the overlay gives them
 * a one-tap copy of everything we'd otherwise have to extract over
 * three back-and-forth messages.
 *
 * The overlay does NOT phone home. Everything is read locally. The
 * one-tap copy puts a plaintext blob on the system clipboard. Privacy
 * win for the user, debugging win for us.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  consumeLastRenderRequestId,
  peekLastRenderRequestId,
  subscribeRenderRequestId,
} from '@/shared/diagnostics/renderTelemetry';

interface DiagnosticOverlayProps {
  open: boolean;
  onClose: () => void;
}

function readGiftContext(): string | null {
  const m = document.cookie.match(/runink_gift=([^;]+)/);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}

function readSessionCookie(): boolean {
  return /(?:^|;\s*)runink_session=/.test(document.cookie);
}

function gather(): Record<string, string> {
  const { innerWidth, innerHeight, devicePixelRatio } = window;
  const lastRid = peekLastRenderRequestId();
  return {
    'Build':       `${__BUILD_SHA__} (${__BUILD_TIME__})`,
    'URL':         window.location.href,
    'User agent':  navigator.userAgent,
    'Viewport':    `${innerWidth} × ${innerHeight} @ ${devicePixelRatio}x`,
    'Language':    navigator.language,
    'Online':      navigator.onLine ? 'yes' : 'no',
    'Strava':      readSessionCookie() ? 'connected' : 'not connected',
    'Gift code':   readGiftContext() ?? '(none)',
    'Last render': lastRid ?? '(none yet this session)',
    'Local time':  new Date().toISOString(),
  };
}

export function DiagnosticOverlay({ open, onClose }: DiagnosticOverlayProps) {
  // Re-render when a new render request lands so the overlay stays current
  // if the user opens it before submitting an order.
  const [, force] = useState(0);
  useEffect(() => subscribeRenderRequestId(() => force((n) => n + 1)), []);

  const info = useMemo(() => (open ? gather() : null), [open]);
  const [copied, setCopied] = useState(false);

  if (!open || !info) return null;

  const report = Object.entries(info).map(([k, v]) => `${k}: ${v}`).join('\n');

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(`RunInk diagnostics\n${'-'.repeat(20)}\n${report}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Older Safari rejects clipboard.writeText off the user gesture
      // path. Falls through silently — the report is still visible
      // on-screen for the user to read aloud / screenshot.
      setCopied(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Diagnostic information"
      className="fixed inset-0 z-[9999] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-[#0d0d0d] border border-white/10 rounded-lg p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm tracking-widest uppercase text-white/70">Diagnostics</h2>
          <button
            onClick={onClose}
            className="text-xs text-white/40 hover:text-white px-2 py-1"
            aria-label="Close diagnostics"
          >
            Close ✕
          </button>
        </div>

        <pre className="text-[11px] leading-relaxed font-mono text-white/70 whitespace-pre-wrap break-all max-h-[60vh] overflow-auto">
{Object.entries(info).map(([k, v]) => (
  <span key={k}>
    <span className="text-white/40">{k.padEnd(12, ' ')}</span>
    <span className="text-white/85">{v}</span>{'\n'}
  </span>
))}
        </pre>

        <div className="flex gap-2 mt-3">
          <button
            onClick={handleCopy}
            className="flex-1 py-2 rounded-md bg-white/10 hover:bg-white/15 text-xs tracking-wider uppercase text-white"
          >
            {copied ? 'Copied!' : 'Copy report'}
          </button>
          <button
            onClick={() => {
              consumeLastRenderRequestId(); // clear the stale request id
              force((n) => n + 1);
            }}
            className="px-3 py-2 rounded-md border border-white/10 hover:bg-white/5 text-xs text-white/40"
            title="Clear the last render request id"
          >
            Reset
          </button>
        </div>

        <p className="text-[10px] text-white/30 mt-3">
          Long-press the RunInk logo to open this panel. The report stays on
          your device — nothing is sent. Paste it into a support message if
          something looks wrong.
        </p>
      </div>
    </div>
  );
}

/**
 * useLongPress — minimal long-press detector that works on touch and
 * mouse. 600 ms threshold is the standard "feels long enough not to be
 * a stray tap" duration. Movement greater than ~10px cancels (so a
 * scroll gesture doesn't accidentally pop the overlay).
 */
export function useLongPress(onLongPress: () => void, ms = 600) {
  return useMemo(() => {
    let timer: number | null = null;
    let startX = 0;
    let startY = 0;
    const clear = () => { if (timer != null) { clearTimeout(timer); timer = null; } };
    const point = (e: React.TouchEvent | React.MouseEvent) => {
      if ('touches' in e && e.touches[0]) return { x: e.touches[0].clientX, y: e.touches[0].clientY };
      if ('clientX' in e) return { x: e.clientX, y: e.clientY };
      return { x: 0, y: 0 };
    };
    return {
      onTouchStart: (e: React.TouchEvent) => {
        const p = point(e); startX = p.x; startY = p.y;
        clear();
        timer = window.setTimeout(onLongPress, ms);
      },
      onTouchMove: (e: React.TouchEvent) => {
        const p = point(e);
        if (Math.abs(p.x - startX) > 10 || Math.abs(p.y - startY) > 10) clear();
      },
      onTouchEnd: clear,
      onTouchCancel: clear,
      onMouseDown: (e: React.MouseEvent) => {
        const p = point(e); startX = p.x; startY = p.y;
        clear();
        timer = window.setTimeout(onLongPress, ms);
      },
      onMouseMove: (e: React.MouseEvent) => {
        if (timer == null) return;
        const p = point(e);
        if (Math.abs(p.x - startX) > 10 || Math.abs(p.y - startY) > 10) clear();
      },
      onMouseUp: clear,
      onMouseLeave: clear,
    };
  }, [onLongPress, ms]);
}
