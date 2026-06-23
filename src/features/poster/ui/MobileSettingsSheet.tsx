import { useState, useRef, useCallback, useEffect, useLayoutEffect, type ReactNode } from 'react';
import { collapsedSheetHeight } from './mobileSheetMetrics';

const DRAG_THRESHOLD = 40;
/** Open sheet never exceeds this fraction of the viewport — tall panels scroll. */
const MAX_OPEN_FRACTION = 0.9;

interface MobileSettingsSheetProps {
  /** Scrollable settings — the category deck + its active panel. Hidden when collapsed. */
  children: ReactNode;
  /** Slot for Export/Order buttons — always visible, pinned to the bottom. */
  actionButtons: ReactNode;
  /** Imperative collapse ref */
  collapseRef?: React.MutableRefObject<(() => void) | null>;
  /** Imperative expand ref (used when a deck tab is tapped) */
  expandRef?: React.MutableRefObject<(() => void) | null>;
}

export function MobileSettingsSheet({ children, actionButtons, collapseRef, expandRef }: MobileSettingsSheetProps) {
  const [open, setOpen] = useState(false);
  // Natural height of the full sheet content (handle + active panel + actions),
  // measured live so the open sheet hugs its content instead of snapping to a
  // fixed height and leaving a gap above the pinned action bar.
  const [contentHeight, setContentHeight] = useState(0);
  const [dragDelta, setDragDelta] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const startY = useRef(0);

  const handleRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);

  const collapsedHeight = collapsedSheetHeight();

  const collapse = useCallback(() => setOpen(false), []);
  const expand = useCallback(() => setOpen(true), []);

  // Expose collapse to parent for export flow
  useEffect(() => {
    if (!collapseRef) return;
    collapseRef.current = collapse;
    return () => { collapseRef.current = null; };
  }, [collapseRef, collapse]);

  // Expose expand so tapping a category deck tab opens the panel.
  useEffect(() => {
    if (!expandRef) return;
    expandRef.current = expand;
    return () => { expandRef.current = null; };
  }, [expandRef, expand]);

  // Measure natural content height. panelRef wraps the settings inside a
  // scroll container, so its offsetHeight is the *natural* (uncapped) height
  // even while collapsed — meaning the open height is known before the user
  // ever expands, and a tab switch (which changes the panel's height) re-fits
  // the sheet via the ResizeObserver.
  useLayoutEffect(() => {
    const measure = () => {
      const h = (handleRef.current?.offsetHeight ?? 0)
        + (panelRef.current?.offsetHeight ?? 0)
        + (actionsRef.current?.offsetHeight ?? 0);
      setContentHeight(h);
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (panelRef.current) ro.observe(panelRef.current);
    if (actionsRef.current) ro.observe(actionsRef.current);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  // Body scroll lock while the sheet is open. Prevents the preview/page below
  // from scrolling when the user is interacting with settings.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  const onTouchStart = (e: React.TouchEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('input, select, textarea, button, a, [role="button"]')) return;
    startY.current = e.touches[0].clientY;
    setIsDragging(true);
  };

  const onTouchMove = (e: React.TouchEvent) => {
    if (!isDragging) return;
    // Positive delta = dragging down = shrinking sheet
    setDragDelta(e.touches[0].clientY - startY.current);
  };

  const onTouchEnd = () => {
    if (!isDragging) return;
    setIsDragging(false);
    const dy = dragDelta;
    setDragDelta(0);
    if (Math.abs(dy) < DRAG_THRESHOLD) return;
    setOpen(dy < 0); // drag up opens, drag down collapses
  };

  const maxOpenPx = typeof window !== 'undefined' ? window.innerHeight * MAX_OPEN_FRACTION : 9999;
  const openPx = Math.min(Math.max(contentHeight, collapsedHeight), maxOpenPx);
  const basePx = open ? openPx : collapsedHeight;
  const heightPx = isDragging && dragDelta !== 0
    ? Math.max(collapsedHeight, basePx - dragDelta)
    : basePx;

  return (
    <>
      {/* Backdrop — only when open */}
      {open && (
        <div className="fixed inset-0 z-40 bg-black/40" onClick={collapse} />
      )}

      {/* Sheet — pinned to bottom, height hugs content (capped) when open */}
      <div
        className="fixed inset-x-0 bottom-0 z-50 flex flex-col bg-[#111] rounded-t-2xl border-t border-white/10"
        style={{
          height: `${heightPx}px`,
          maxHeight: `${MAX_OPEN_FRACTION * 100}dvh`,
          minHeight: `${collapsedHeight}px`,
          transition: isDragging ? 'none' : 'height 300ms cubic-bezier(0.32, 0.72, 0, 1)',
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        {/* Drag handle + Customize button */}
        <button
          ref={handleRef}
          onClick={() => setOpen(!open)}
          className="flex flex-col items-center pt-3 pb-2 flex-shrink-0 w-full"
        >
          <div className="w-10 h-1 rounded-full bg-white/30 mb-2" />
          <div className="flex items-center gap-1.5 text-xs text-white/50">
            <svg className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
            </svg>
            {open ? 'Close settings' : 'Customize poster'}
          </div>
        </button>

        {/* Scrollable settings — the category deck + active panel. Hidden when
            collapsed; takes the flexible space above the pinned action bar. */}
        <div
          className="flex-1 overflow-y-auto overscroll-contain min-h-0"
          style={{
            opacity: open ? 1 : 0,
            pointerEvents: open ? 'auto' : 'none',
            transition: 'opacity 200ms',
          }}
        >
          <div ref={panelRef}>{children}</div>
        </div>

        {/* Action bar — Export/Order, always visible, pinned to the bottom
            (matches the redesign: tabs → panel → export). Scrolls internally
            when the order flow expands. */}
        <div ref={actionsRef} className="px-4 pt-3 pb-3 flex-shrink-0 border-t border-white/10 overflow-y-auto max-h-[50dvh]">
          {actionButtons}
        </div>
      </div>
    </>
  );
}
