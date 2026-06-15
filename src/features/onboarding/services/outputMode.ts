import type { LayerVisibility } from '@/types/poster';

/**
 * The output the user is building, chosen on the ModeSelect screen during the
 * Strava load and switchable at any time afterwards.
 *
 *  - 'single'    → one hero run mapped on its own  (editor mode 'individual')
 *  - 'composite' → many runs overlaid into one art piece (editor mode 'compilation')
 *
 * Kept distinct from the editor's `'individual' | 'compilation'` vocabulary so
 * the user-facing flow and the renderer can evolve independently.
 */
export type OutputMode = 'single' | 'composite';

export function outputModeToEditorMode(mode: OutputMode): 'individual' | 'compilation' {
  return mode === 'single' ? 'individual' : 'compilation';
}

const MODE_KEY = 'runink:outputMode:v1';
const STYLE_KEY = 'runink:posterStyle:v1';

/** Last mode the user chose — used to pre-highlight on the ModeSelect screen
 *  so a returning visitor sees their previous choice already selected. */
export function loadOutputMode(): OutputMode | null {
  try {
    const v = localStorage.getItem(MODE_KEY);
    return v === 'single' || v === 'composite' ? v : null;
  } catch {
    return null;
  }
}

export function saveOutputMode(mode: OutputMode): void {
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch {
    /* private mode / quota — non-fatal, the choice just won't persist */
  }
}

/**
 * Cross-mode poster styling that survives a Switch. Deliberately the *style*
 * axis only — theme, layers, size, orientation, display toggles, and the
 * title (a place name is meaningful in either mode). Mode-specific content
 * (the date subtitle, km markers, the selected run set) is intentionally NOT
 * carried, so switching keeps "everything possible" without bleeding a single
 * run's specifics onto a composite or vice-versa.
 */
export interface PosterStyleCarryover {
  themeId: string;
  layers: LayerVisibility;
  /** Resolved back to a POSTER_PRESETS entry by label on apply. */
  dimensionsLabel: string;
  title: string;
  showStats: boolean;
  showCoordinates: boolean;
  showGradientFade: boolean;
  bearing: number;
}

export function loadPosterStyle(): PosterStyleCarryover | null {
  try {
    const raw = localStorage.getItem(STYLE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // Minimal shape guard — a stale/garbage blob should fall back to defaults,
    // never crash the editor on mount.
    if (parsed && typeof parsed.themeId === 'string' && parsed.layers) {
      return parsed as PosterStyleCarryover;
    }
    return null;
  } catch {
    return null;
  }
}

export function savePosterStyle(style: PosterStyleCarryover): void {
  try {
    localStorage.setItem(STYLE_KEY, JSON.stringify(style));
  } catch {
    /* non-fatal */
  }
}
