import type { Theme } from '@/types/theme';
import type { TrackData } from '@/types/activity';
import { getAllThemes } from '../infrastructure/themeRepository';
import { RoutePreview, useRoutePreviewPoints } from './RoutePreview';

interface ThemeGalleryProps {
  selectedId: string;
  onSelect: (theme: Theme) => void;
  /** When provided, each chip previews the user's actual route on that theme */
  tracks?: TrackData[];
  isCompilation?: boolean;
}

export function ThemeGallery({ selectedId, onSelect, tracks, isCompilation }: ThemeGalleryProps) {
  const themes = getAllThemes();
  const points = useRoutePreviewPoints(tracks ?? []);

  return (
    <div className="flex gap-2 overflow-x-auto pb-2 snap-x snap-mandatory md:grid md:grid-cols-2 md:overflow-visible md:pb-0">
      {themes.map((theme) => (
        <button
          key={theme.id}
          onClick={() => onSelect(theme)}
          aria-label={`Theme: ${theme.name}`}
          aria-pressed={selectedId === theme.id}
          className={`snap-start flex-shrink-0 w-28 md:w-auto relative rounded-lg overflow-hidden border-2 transition-all ${
            selectedId === theme.id
              ? 'border-white ring-1 ring-white/30'
              : 'border-transparent hover:border-white/20'
          }`}
        >
          <RoutePreview
            theme={theme}
            points={points}
            isCompilation={isCompilation}
            className="block h-20 md:h-16 w-full"
          />
          <div
            className="px-2 py-1.5 text-left"
            style={{ backgroundColor: theme.colors.background }}
          >
            <div
              className="text-xs font-medium truncate"
              style={{ color: theme.colors.text }}
            >
              {theme.name}
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}

/** Compact horizontal theme switcher — lives in the mobile sheet so the
 *  highest-impact edit is one tap away in every sheet state. */
export function ThemeStrip({ selectedId, onSelect, tracks, isCompilation }: ThemeGalleryProps) {
  const themes = getAllThemes();
  const points = useRoutePreviewPoints(tracks ?? []);

  return (
    <div className="flex gap-2 overflow-x-auto px-4 pb-1" style={{ scrollbarWidth: 'none' }}>
      {themes.map((theme) => (
        <button
          key={theme.id}
          onClick={() => onSelect(theme)}
          aria-label={`Theme: ${theme.name}`}
          aria-pressed={selectedId === theme.id}
          className={`flex-shrink-0 rounded-lg overflow-hidden border-2 transition-all ${
            selectedId === theme.id
              ? 'border-white ring-1 ring-white/30'
              : 'border-white/10'
          }`}
        >
          <RoutePreview
            theme={theme}
            points={points}
            isCompilation={isCompilation}
            className="block w-12 h-12"
          />
        </button>
      ))}
    </div>
  );
}
