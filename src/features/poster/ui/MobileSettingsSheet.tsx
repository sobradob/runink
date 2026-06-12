import { useState, useRef, useCallback, useEffect, type ReactNode } from 'react';

type SheetSnap = 'collapsed' | 'half' | 'full';

const COLLAPSED_HEIGHT = 165; // px — fits drag handle + Customize button + Export + Order buttons
const THEME_STRIP_HEIGHT = 64; // px — extra collapsed height when a theme strip is present
const DRAG_THRESHOLD = 40;

interface MobileSettingsSheetProps {
  children: ReactNode;
  /** Slot for Export/Order buttons — always visible in collapsed bar */
  actionButtons: ReactNode;
  /** Slot for the always-visible theme switcher strip, above the action buttons */
  themeStrip?: ReactNode;
  /** Imperative collapse ref */
  collapseRef?: React.MutableRefObject<(() => void) | null>;
}

function snapToHeight(snap: SheetSnap, collapsedHeight: number): string {
  switch (snap) {
    case 'collapsed': return `${collapsedHeight}px`;
    case 'half': return '50dvh';
    case 'full': return '90dvh';
  }
}

export function MobileSettingsSheet({ children, actionButtons, themeStrip, collapseRef }: MobileSettingsSheetProps) {
  const [snap, setSnap] = useState<SheetSnap>('collapsed');
  const [dragDelta, setDragDelta] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const startY = useRef(0);
  const startSnap = useRef<SheetSnap>('collapsed');
  // One-shot flag: scroll-to-expand only fires once per half-snap so the user
  // can still scroll freely inside the sheet once it reaches full.
  const scrollExpandArmed = useRef(true);

  const collapse = useCallback(() => setSnap('collapsed'), []);

  // Expose collapse to parent for export flow
  useEffect(() => {
    if (!collapseRef) return;
    collapseRef.current = collapse;
    return () => {
      collapseRef.current = null;
    };
  }, [collapseRef, collapse]);

  const isExpanded = snap !== 'collapsed';

  // Body scroll lock while the sheet is expanded. Prevents the preview/page
  // below from scrolling when the user is interacting with settings.
  useEffect(() => {
    if (!isExpanded) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [isExpanded]);

  // Re-arm scroll-to-expand whenever the sheet leaves 'half' so a later
  // drag-down + scroll cycle can expand it again.
  useEffect(() => {
    if (snap !== 'half') scrollExpandArmed.current = true;
  }, [snap]);

  const onSettingsScroll = (e: React.UIEvent<HTMLDivElement>) => {
    // Auto-expand to full when the user starts scrolling inside a half-height
    // sheet — matches the iOS Maps / Apple Music sheet behaviour.
    if (snap === 'half' && scrollExpandArmed.current && e.currentTarget.scrollTop > 4) {
      scrollExpandArmed.current = false;
      setSnap('full');
    }
  };

  const onTouchStart = (e: React.TouchEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('input, select, textarea, button, a, [role="button"]')) return;
    startY.current = e.touches[0].clientY;
    startSnap.current = snap;
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

    const current = startSnap.current;
    if (dy > 0) {
      // Dragging down — collapse one level
      setSnap(current === 'full' ? 'half' : 'collapsed');
    } else {
      // Dragging up — expand one level
      setSnap(current === 'collapsed' ? 'half' : 'full');
    }
  };

  // Compute the CSS height, applying drag offset
  const collapsedHeight = COLLAPSED_HEIGHT + (themeStrip ? THEME_STRIP_HEIGHT : 0);
  const baseHeight = snapToHeight(snap, collapsedHeight);
  const heightStyle = isDragging && dragDelta !== 0
    ? `calc(${baseHeight} - ${dragDelta}px)`
    : baseHeight;

  return (
    <>
      {/* Backdrop — only when expanded */}
      {isExpanded && (
        <div
          className="fixed inset-0 z-40 bg-black/40"
          onClick={collapse}
        />
      )}

      {/* Sheet — pinned to bottom, height changes between snaps */}
      <div
        className="fixed inset-x-0 bottom-0 z-50 flex flex-col bg-[#111] rounded-t-2xl border-t border-white/10"
        style={{
          height: heightStyle,
          maxHeight: '90dvh',
          minHeight: `${collapsedHeight}px`,
          transition: isDragging ? 'none' : 'height 300ms cubic-bezier(0.32, 0.72, 0, 1)',
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        {/* Drag handle + Customize button — opens straight to full so the
            user doesn't have to drag up again to see most of the settings. */}
        <button
          onClick={() => setSnap(isExpanded ? 'collapsed' : 'full')}
          className="flex flex-col items-center pt-3 pb-2 flex-shrink-0 w-full"
        >
          <div className="w-10 h-1 rounded-full bg-white/30 mb-2" />
          <div className="flex items-center gap-1.5 text-xs text-white/50">
            <svg className={`w-3.5 h-3.5 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
            </svg>
            {isExpanded ? 'Close settings' : 'Customize poster'}
          </div>
        </button>

        {/* Theme strip — always visible in every snap state so the
            highest-impact edit never needs the sheet opened */}
        {themeStrip && (
          <div className="flex-shrink-0 pb-2">
            {themeStrip}
          </div>
        )}

        {/* Collapsed bar — always visible action buttons (scrollable when order flow expands) */}
        <div className="px-4 pb-3 flex-shrink-0 overflow-y-auto max-h-[40dvh]">
          {actionButtons}
        </div>

        {/* Scrollable settings content — hidden when collapsed */}
        <div
          className="flex-1 overflow-y-auto overscroll-contain min-h-0"
          onScroll={onSettingsScroll}
          style={{
            opacity: isExpanded ? 1 : 0,
            pointerEvents: isExpanded ? 'auto' : 'none',
            transition: 'opacity 200ms',
          }}
        >
          {children}
        </div>
      </div>
    </>
  );
}
