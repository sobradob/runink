import { useEffect } from 'react';

interface RegionSuggestion {
  label: string;
  lat: number;
  lng: number;
  count: number;
}

interface DispersedCompileModalProps {
  open: boolean;
  runCount: number;
  diagonalKm: number;
  regions: RegionSuggestion[];
  onClose: () => void;
  onPickRegion: (region: RegionSuggestion) => void;
  onCompileAnyway: () => void;
  /** Called when the user wants to open the region filter UI. */
  onOpenRegionFilter: () => void;
}

/**
 * Surfaces when a user tries to "Compile all" across runs that span a large
 * geographic area (>300 km diagonal). Without this warning the compiled
 * poster zooms out to fit the whole bbox and every track becomes invisible.
 */
export function DispersedCompileModal({
  open,
  runCount,
  diagonalKm,
  regions,
  onClose,
  onPickRegion,
  onCompileAnyway,
  onOpenRegionFilter,
}: DispersedCompileModalProps) {
  // Close on Esc
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Lock background scroll while the modal is open — prevents the activity
  // list scrolling under the dialog on mobile.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;

  const regionCount = regions.length;
  // Render a coarse "X,XXX km" — the exact figure isn't meaningful, the scale is.
  const roughKm = diagonalKm >= 1000
    ? `${Math.round(diagonalKm / 100) * 100}`
    : `${Math.round(diagonalKm / 10) * 10}`;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="dispersed-title"
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70"
        onClick={onClose}
      />

      {/* Dialog */}
      <div className="relative w-full max-w-md bg-[#111] border border-white/10 rounded-2xl p-5 md:p-6 shadow-xl">
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute top-3 right-3 w-8 h-8 flex items-center justify-center rounded-full text-white/40 hover:text-white hover:bg-white/10"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        <h2 id="dispersed-title" className="text-lg font-semibold text-white pr-8">
          These runs are far apart
        </h2>
        <p className="mt-2 text-sm text-white/60 leading-relaxed">
          Your {runCount} runs span about {roughKm} km
          {regionCount > 1 ? ` across ${regionCount} regions` : ''}.
          The compiled map will zoom out to fit them all, which can make individual routes hard to see.
        </p>

        {regions.length > 0 && (
          <div className="mt-4">
            <div className="text-xs text-white/40 mb-2">
              Tap a region to compile just those runs:
            </div>
            <div className="flex flex-wrap gap-1.5">
              {regions.slice(0, 6).map((r) => (
                <button
                  key={r.label}
                  onClick={() => onPickRegion(r)}
                  className="text-xs px-2.5 py-1.5 rounded-full border border-white/15 text-white/80 hover:text-white hover:border-white/40 hover:bg-white/5 transition-colors"
                >
                  {r.label} <span className="text-white/40">({r.count})</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="mt-5 flex flex-col-reverse md:flex-row gap-2 md:justify-end">
          <button
            onClick={onCompileAnyway}
            className="text-sm px-4 py-2.5 md:py-2 rounded-lg text-white/60 hover:text-white hover:bg-white/5 transition-colors"
          >
            Compile anyway
          </button>
          <button
            onClick={onOpenRegionFilter}
            className="text-sm px-4 py-2.5 md:py-2 rounded-lg bg-white text-black font-medium hover:bg-white/90 transition-colors"
          >
            Pick a region
          </button>
        </div>
      </div>
    </div>
  );
}
