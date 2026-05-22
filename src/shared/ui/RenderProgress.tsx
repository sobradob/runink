/**
 * RenderProgress — visible feedback during the 2–7 s server-side render.
 *
 * Why this exists: the order button used to show static text "Rendering
 * poster..." for the entire wait, which on mobile feels indistinguishable
 * from a frozen tab. This component animates a progress bar against an
 * estimated render time and shows a live elapsed counter so the user can
 * see SOMETHING is happening. If we overshoot the estimate, the bar tops
 * out at 95% and the copy nudges that it's "almost there" — never falsely
 * claims to be done.
 */
import { useEffect, useState } from 'react';

interface RenderProgressProps {
  /** Show or hide. When false, the timer resets so a retry starts fresh. */
  active: boolean;
  /** Rough expected duration in ms. Bar reaches 90% at this point. */
  estimatedMs?: number;
}

export function RenderProgress({ active, estimatedMs = 5000 }: RenderProgressProps) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!active) {
      setElapsed(0);
      return;
    }
    const started = Date.now();
    // 100ms tick is smooth enough for the bar without burning the CPU.
    const id = window.setInterval(() => setElapsed(Date.now() - started), 100);
    return () => clearInterval(id);
  }, [active]);

  if (!active) return null;

  // Logistic-ish curve: fast progress at first (rewards short renders),
  // approaches but never reaches 95% — we only jump to 100% when the
  // caller switches `active` to false (i.e. the render returned).
  const pct = Math.min(95, 100 * (1 - Math.exp(-elapsed / (estimatedMs * 0.6))));
  const seconds = (elapsed / 1000).toFixed(1);
  const slow = elapsed > estimatedMs * 1.5;

  return (
    <div className="space-y-1.5">
      <div className="h-1 w-full bg-white/10 rounded-full overflow-hidden">
        <div
          className="h-full bg-white/70 transition-[width] duration-200 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex items-center justify-between text-[10px] text-white/40 font-mono tracking-wider">
        <span>{slow ? 'Almost there...' : 'Rendering at print resolution'}</span>
        <span>{seconds}s</span>
      </div>
    </div>
  );
}
