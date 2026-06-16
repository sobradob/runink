import type { OutputMode } from '../services/outputMode';

interface ModeSelectProps {
  /** Pre-highlight the mode the user picked last time, if any. */
  current: OutputMode | null;
  onSelect: (mode: OutputMode) => void;
  /** True while the Strava activities are still streaming in. */
  loading: boolean;
  /** Live count of activities loaded so far (shown while loading). */
  loadedCount: number;
}

/** Real example posters rendered from the demo dataset (see
 *  scripts/gen-mode-examples.mjs) so the cards show genuine output — a single
 *  102 km run and a London composite — instead of abstract art. */
const SINGLE_EXAMPLE = '/assets/examples/single.png';
const COMPOSITE_EXAMPLE = '/assets/examples/composite.png';

export function ModeSelect({ current, onSelect, loading, loadedCount }: ModeSelectProps) {
  return (
    <div className="min-h-dvh bg-[#0a0a0a] flex flex-col">
      <div className="flex-1 flex flex-col justify-center px-5 py-10 max-w-3xl mx-auto w-full">
        <header className="text-center mb-8">
          <h1
            className="text-2xl md:text-3xl tracking-[0.18em] uppercase mb-3"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            What do you want to make?
          </h1>
          <p className="text-white/40 text-sm leading-relaxed max-w-md mx-auto">
            Pick a starting point — you can switch anytime while you design.
          </p>
        </header>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <ModeCard
            label="Single run"
            description="One run, mapped on its own — with stats, distance markers and a clean route."
            image={SINGLE_EXAMPLE}
            imageAlt="Example poster of a single 102 km run"
            selected={current === 'single'}
            onClick={() => onSelect('single')}
          />

          <ModeCard
            label="Composite"
            description="Many runs in a place, layered into one heat-map-style art piece."
            image={COMPOSITE_EXAMPLE}
            imageAlt="Example poster of a London composite of hundreds of runs"
            selected={current === 'composite'}
            onClick={() => onSelect('composite')}
          />
        </div>

        <div className="mt-8 flex items-center justify-center gap-2 text-xs text-white/30 min-h-[20px]">
          {loading ? (
            <>
              <span className="h-3 w-3 animate-spin rounded-full border border-white/20 border-t-white/60" />
              Loading your runs from Strava… {loadedCount > 0 ? `${loadedCount} so far` : ''}
            </>
          ) : (
            <span>You can always change this later with the Switch button.</span>
          )}
        </div>
      </div>
    </div>
  );
}

function ModeCard({
  label,
  description,
  image,
  imageAlt,
  selected,
  onClick,
}: {
  label: string;
  description: string;
  image: string;
  imageAlt: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={selected}
      className={`group text-left rounded-2xl overflow-hidden border-2 transition-all ${
        selected
          ? 'border-white ring-1 ring-white/30'
          : 'border-white/10 hover:border-white/30 active:border-white/40'
      }`}
    >
      <div className="px-4 py-3 border-b border-white/10">
        <div className="text-base font-medium tracking-wide text-white">{label}</div>
      </div>
      <div className="aspect-[4/5] w-full overflow-hidden bg-black">
        <img
          src={image}
          alt={imageAlt}
          loading="eager"
          className="block w-full h-full object-cover"
        />
      </div>
      <div className="p-4">
        <p className="text-xs text-white/40 leading-relaxed">{description}</p>
      </div>
    </button>
  );
}
