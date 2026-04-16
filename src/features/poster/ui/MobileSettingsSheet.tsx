import { useState, useRef, useCallback, type ReactNode } from 'react';

type SheetSnap = 'collapsed' | 'half' | 'full';

const COLLAPSED_HEIGHT = 165; // px — fits drag handle + Customize button + Export + Order buttons
const DRAG_THRESHOLD = 40;

interface MobileSettingsSheetProps {
  children: ReactNode;
  /** Slot for Export/Order buttons — always visible in collapsed bar */
  actionButtons: ReactNode;
  /** Imperative collapse ref */
  collapseRef?: React.MutableRefObject<(() => void) | null>;
}

function snapToHeight(snap: SheetSnap): string {
  switch (snap) {
    case 'collapsed': return `${COLLAPSED_HEIGHT}px`;
    case 'half': return '50dvh';
    case 'full': return '90dvh';
  }
}

export function MobileSettingsSheet({ children, actionButtons, collapseRef }: MobileSettingsSheetProps) {
  const [snap, setSnap] = useState<SheetSnap>('collapsed');
  const [dragDelta, setDragDelta] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const startY = useRef(0);
  const startSnap = useRef<SheetSnap>('collapsed');

  const collapse = useCallback(() => setSnap('collapsed'), []);

  // Expose collapse to parent for export flow
  if (collapseRef) collapseRef.current = collapse;

  const isExpanded = snap !== 'collapsed';

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
  const baseHeight = snapToHeight(snap);
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
          minHeight: `${COLLAPSED_HEIGHT}px`,
          transition: isDragging ? 'none' : 'height 300ms cubic-bezier(0.32, 0.72, 0, 1)',
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        {/* Drag handle + Customize button */}
        <button
          onClick={() => setSnap(isExpanded ? 'collapsed' : 'half')}
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

        {/* Collapsed bar — always visible action buttons (scrollable when order flow expands) */}
        <div className="px-4 pb-3 flex-shrink-0 overflow-y-auto max-h-[40dvh]">
          {actionButtons}
        </div>

        {/* Scrollable settings content — hidden when collapsed */}
        <div
          className="flex-1 overflow-y-auto overscroll-contain min-h-0"
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
