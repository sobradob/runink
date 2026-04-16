import type { Theme } from '@/types/theme';
import { getAllThemes } from '../infrastructure/themeRepository';

interface ThemeGalleryProps {
  selectedId: string;
  onSelect: (theme: Theme) => void;
}

export function ThemeGallery({ selectedId, onSelect }: ThemeGalleryProps) {
  const themes = getAllThemes();

  return (
    <div className="flex gap-2 overflow-x-auto pb-2 snap-x snap-mandatory md:grid md:grid-cols-2 md:overflow-visible md:pb-0">
      {themes.map((theme) => (
        <button
          key={theme.id}
          onClick={() => onSelect(theme)}
          className={`snap-start flex-shrink-0 w-28 md:w-auto relative rounded-lg overflow-hidden border-2 transition-all ${
            selectedId === theme.id
              ? 'border-white ring-1 ring-white/30'
              : 'border-transparent hover:border-white/20'
          }`}
        >
          {/* Mini preview swatch */}
          <div
            className="h-20 md:h-16 relative"
            style={{ backgroundColor: theme.colors.land }}
          >
            {/* Water stripe */}
            <div
              className="absolute bottom-0 left-0 right-0 h-4"
              style={{ backgroundColor: theme.colors.water }}
            />
            {/* Road lines */}
            <div
              className="absolute top-3 left-2 right-2 h-px"
              style={{ backgroundColor: theme.colors.roads.primary }}
            />
            <div
              className="absolute top-6 left-4 right-4 h-px"
              style={{ backgroundColor: theme.colors.roads.secondary }}
            />
            {/* Run path preview */}
            <div
              className="absolute top-4 left-3 right-3 h-0.5 rounded-full"
              style={{
                backgroundColor: theme.runPath.core,
                boxShadow: `0 0 6px 2px ${theme.runPath.glow}40`,
              }}
            />
          </div>
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
