import { useState, type ReactNode } from 'react';
import type { Theme } from '@/types/theme';
import type { TrackData } from '@/types/activity';
import type { PosterConfig, LayerVisibility, MarkerIcon } from '@/types/poster';
import { POSTER_PRESETS, MARKER_ICONS } from '@/types/poster';
import { ThemeGallery } from '@/features/theme/ui/ThemeGallery';

/** Mobile "category deck" (RunInk Editor Redesign · A). The mobile sheet shows
 *  one category at a time via a horizontal tab strip instead of stacking every
 *  section into one squashed accordion. `id` must match the Section `title` it
 *  reveals. Theme leads the deck (highest-impact edit). Desktop ignores the
 *  deck and stacks all sections. */
const DECK_ICON_PROPS = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  className: 'w-[18px] h-[18px]',
};

const DECK_CATEGORIES: { id: string; label: string; icon: ReactNode }[] = [
  { id: 'Theme', label: 'Theme', icon: <svg {...DECK_ICON_PROPS}><circle cx="12" cy="12" r="9" /><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" /></svg> },
  { id: 'Text', label: 'Text', icon: <svg {...DECK_ICON_PROPS}><path d="M5 7V5h14v2M12 5v14M9 19h6" /></svg> },
  { id: 'Size', label: 'Size', icon: <svg {...DECK_ICON_PROPS}><path d="M9 3H5v4M15 3h4v4M9 21H5v-4M15 21h4v-4" /></svg> },
  { id: 'Layers', label: 'Layers', icon: <svg {...DECK_ICON_PROPS}><path d="M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5" /></svg> },
  { id: 'Markers', label: 'Markers', icon: <svg {...DECK_ICON_PROPS}><path d="M12 21s-7-6.5-7-11a7 7 0 1 1 14 0c0 4.5-7 11-7 11z" /><circle cx="12" cy="10" r="2.3" /></svg> },
  { id: 'Orientation', label: 'Map', icon: <svg {...DECK_ICON_PROPS}><circle cx="12" cy="12" r="9" /><path d="M15.5 8.5l-2 5-5 2 2-5 5-2z" /></svg> },
  { id: 'Display', label: 'Display', icon: <svg {...DECK_ICON_PROPS}><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="2.6" /></svg> },
];

interface SettingsPanelProps {
  config: PosterConfig;
  mode: 'individual' | 'compilation';
  /** Route data for theme chip previews */
  tracks?: TrackData[];
  showKmMarkers: boolean;
  showStartFinish: boolean;
  placingIcon: MarkerIcon | null;
  dimensionsLocked?: boolean;
  onShowKmMarkersChange: (v: boolean) => void;
  onShowStartFinishChange: (v: boolean) => void;
  onPlaceIcon: (icon: MarkerIcon | null) => void;
  onRemoveMarker: (id: string) => void;
  onConfigChange: (update: Partial<PosterConfig>) => void;
  onThemeChange: (theme: Theme) => void;
  onExport: () => void;
  exporting: boolean;
  orderButtonSlot?: React.ReactNode;
  /** When true, hides the bottom action buttons (they render in the mobile sheet bar instead) */
  hideActions?: boolean;
}

/** Extracted action buttons — reused in desktop sidebar and mobile sheet collapsed bar */
export function SettingsActions({
  onExport, exporting, orderButtonSlot, dimensions,
}: {
  onExport: () => void;
  exporting: boolean;
  orderButtonSlot?: React.ReactNode;
  dimensions: { label: string; dpi: number };
}) {
  return (
    <div className="space-y-2">
      <button
        onClick={onExport}
        disabled={exporting}
        className="w-full py-3 rounded-lg bg-white text-black font-medium text-sm tracking-wider uppercase hover:bg-white/90 disabled:opacity-50 transition-all"
      >
        {exporting ? 'Exporting...' : 'Export Image (Free)'}
      </button>
      {orderButtonSlot}
      <div className="text-xs text-white/30 text-center mt-1">
        {dimensions.label} @ {dimensions.dpi} DPI
      </div>
    </div>
  );
}

export function SettingsPanel({
  config,
  mode,
  tracks,
  showKmMarkers,
  showStartFinish,
  placingIcon,
  dimensionsLocked,
  onShowKmMarkersChange,
  onShowStartFinishChange,
  onPlaceIcon,
  onRemoveMarker,
  onConfigChange,
  onThemeChange,
  onExport,
  exporting,
  orderButtonSlot,
  hideActions,
}: SettingsPanelProps) {
  const updateLayer = (key: keyof LayerVisibility, value: boolean) => {
    onConfigChange({ layers: { ...config.layers, [key]: value } });
  };

  const customMarkers = config.markers.filter((m) => m.type === 'custom');

  // Category deck (mobile only — desktop forces every section visible via
  // `md:block`). One active category at a time, selected from the tab strip, so
  // each gets the full panel instead of a squashed accordion slice. Theme leads
  // the deck, so the sheet opens on the highest-impact edit.
  const [activeCategory, setActiveCategory] = useState<string>('Theme');

  return (
    <div className="w-full md:w-72 bg-[#111] md:border-l border-white/10 overflow-y-auto flex flex-col">
      {/* Header — desktop only, mobile uses sheet handle */}
      <div className="hidden md:block p-4 border-b border-white/10">
        <h2 className="text-sm font-medium text-white/80 tracking-wider uppercase">Settings</h2>
      </div>

      {/* Category deck — mobile only. Horizontal tab strip; the active tab
          reveals exactly one section below (see DECK_CATEGORIES). */}
      <div
        className="md:hidden sticky top-0 z-10 flex gap-2 overflow-x-auto px-3 pt-3 pb-2 bg-[#111] border-b border-white/10"
        style={{ scrollbarWidth: 'none' }}
      >
        {DECK_CATEGORIES.map((cat) => {
          const isActive = activeCategory === cat.id;
          return (
            <button
              key={cat.id}
              onClick={() => setActiveCategory(cat.id)}
              aria-pressed={isActive}
              className={`flex-none flex flex-col items-center gap-1.5 px-4 py-2 rounded-xl border transition-colors ${
                isActive
                  ? 'bg-white border-white text-black'
                  : 'bg-white/[0.04] border-transparent text-white/55 hover:text-white/80'
              }`}
            >
              {cat.icon}
              <span className="text-[11px] font-medium leading-none">{cat.label}</span>
            </button>
          );
        })}
      </div>

      {/* Theme — leads the deck on mobile; stacked first on desktop */}
      <Section title="Theme" active={activeCategory === 'Theme'}>
        <ThemeGallery
          selectedId={config.themeId}
          onSelect={onThemeChange}
          tracks={tracks}
          isCompilation={mode === 'compilation'}
        />
      </Section>

      {/* Text — priority step 2 */}
      <Section title="Text" active={activeCategory === 'Text'}>
        <input
          type="text"
          placeholder="Title (e.g. London)"
          value={config.title}
          onChange={(e) => onConfigChange({ title: e.target.value })}
          className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-white/30 mb-2"
        />
        <input
          type="text"
          placeholder="Subtitle (e.g. 12 Mar 2025)"
          value={config.subtitle}
          onChange={(e) => onConfigChange({ subtitle: e.target.value })}
          className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-white/30"
        />
      </Section>

      {/* Dimensions — priority step 3 */}
      <Section title="Size" active={activeCategory === 'Size'}>
        {dimensionsLocked ? (
          <div>
            <div className="text-xs px-2 py-1.5 rounded border border-white/40 bg-white/10 text-white text-center">
              {config.dimensions.label}
            </div>
            <p className="text-[10px] text-white/30 mt-1.5 text-center">Size set by gift</p>
          </div>
        ) : (
          <div className="grid grid-cols-3 md:grid-cols-2 gap-1.5">
            {POSTER_PRESETS
              .filter((p) => !dimensionsLocked || p.category === 'printable')
              .map((preset) => (
              <button
                key={preset.label}
                onClick={() => onConfigChange({ dimensions: preset })}
                className={`text-xs px-2 py-2.5 md:py-1.5 rounded border transition-all relative ${
                  config.dimensions.label === preset.label
                    ? 'border-white/40 bg-white/10 text-white'
                    : 'border-white/10 text-white/40 hover:text-white/60'
                }`}
              >
                {preset.label}
                {preset.category === 'digital-only' && (
                  <span className="block text-[8px] opacity-40 mt-0.5">Digital only</span>
                )}
              </button>
            ))}
          </div>
        )}
      </Section>

      {/* Layers */}
      <Section title="Layers" active={activeCategory === 'Layers'}>
        <Toggle label="Water" checked={config.layers.water} onChange={(v) => updateLayer('water', v)} />
        <Toggle label="Parks & green" checked={config.layers.parks} onChange={(v) => updateLayer('parks', v)} />
        <Toggle label="Buildings" checked={config.layers.buildings} onChange={(v) => updateLayer('buildings', v)} />
        <Toggle label="Roads" checked={config.layers.roads} onChange={(v) => updateLayer('roads', v)} />
        <Toggle label="Rail" checked={config.layers.rail} onChange={(v) => updateLayer('rail', v)} />
      </Section>

      {/* Markers */}
      <Section title="Markers" active={activeCategory === 'Markers'}>
        {/* Auto markers (individual mode) */}
        {mode === 'individual' && (
          <div className="mb-3 space-y-1">
            <Toggle label="Start / Finish" checked={showStartFinish} onChange={onShowStartFinishChange} />
            <Toggle label="Km markers" checked={showKmMarkers} onChange={onShowKmMarkersChange} />
          </div>
        )}

        {/* Icon picker for custom markers */}
        <div className="mb-2">
          <div className="text-xs text-white/30 mb-2">Tap an icon, then tap on the map to place it</div>
          <div className="grid grid-cols-6 md:grid-cols-3 gap-2 md:gap-1.5">
            {MARKER_ICONS.map((icon) => (
              <button
                key={icon.id}
                onClick={() => onPlaceIcon(placingIcon === icon.id ? null : icon.id)}
                className={`flex flex-col items-center gap-1 py-3 md:py-2 rounded-lg border transition-all ${
                  placingIcon === icon.id
                    ? 'border-yellow-400/60 bg-yellow-400/10 text-white'
                    : 'border-white/10 text-white/40 hover:text-white/60 hover:border-white/20'
                }`}
              >
                <span className="text-xl md:text-lg">{icon.emoji}</span>
                <span className="text-[10px] hidden md:block">{icon.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Placed custom markers list */}
        {customMarkers.length > 0 && (
          <div className="space-y-1 mt-2 pt-2 border-t border-white/5">
            <div className="text-xs text-white/30 mb-1">Placed markers</div>
            {customMarkers.map((m) => {
              const iconInfo = MARKER_ICONS.find((i) => i.id === m.icon);
              return (
                <div key={m.id} className="flex items-center justify-between py-1 group">
                  <span className="text-sm text-white/50">
                    {iconInfo?.emoji || '●'} {m.label || iconInfo?.label || 'Marker'}
                  </span>
                  <button
                    onClick={() => onRemoveMarker(m.id)}
                    className="text-xs text-white/20 hover:text-red-400 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity"
                  >
                    ✕
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </Section>

      {/* Map orientation */}
      <Section title="Orientation" active={activeCategory === 'Orientation'}>
        <div className="flex items-center gap-2 mb-2">
          <button
            onClick={() => onConfigChange({ bearing: 0 })}
            className={`text-xs px-2 py-1 rounded border transition-all ${
              config.bearing === 0
                ? 'border-white/40 bg-white/10 text-white'
                : 'border-white/10 text-white/40 hover:text-white/60'
            }`}
          >
            North Up
          </button>
          <span className="text-xs text-white/30 ml-auto">{Math.round(config.bearing)}°</span>
        </div>
        <input
          type="range"
          min={-180}
          max={180}
          step={1}
          value={config.bearing}
          onChange={(e) => onConfigChange({ bearing: Number(e.target.value) })}
          className="w-full accent-white"
        />
      </Section>

      {/* Display options */}
      <Section title="Display" active={activeCategory === 'Display'}>
        <Toggle
          label="Show stats"
          checked={config.showStats}
          onChange={(v) => onConfigChange({ showStats: v })}
        />
        <Toggle
          label="Show coordinates"
          checked={config.showCoordinates}
          onChange={(v) => onConfigChange({ showCoordinates: v })}
        />
        <Toggle
          label="Gradient fade"
          checked={config.showGradientFade}
          onChange={(v) => onConfigChange({ showGradientFade: v })}
        />
      </Section>

      {/* Export & Order buttons — desktop sidebar only (mobile uses sheet bar) */}
      {!hideActions && (
        <div className="p-4 mt-auto border-t border-white/10">
          <SettingsActions
            onExport={onExport}
            exporting={exporting}
            orderButtonSlot={orderButtonSlot}
            dimensions={config.dimensions}
          />
        </div>
      )}
    </div>
  );
}

function Section({
  title,
  children,
  active,
}: {
  title: string;
  children: React.ReactNode;
  /** Mobile: whether this category's deck tab is selected. Desktop ignores it
   *  (`md:block` shows every section stacked). */
  active: boolean;
}) {
  return (
    <div className={`border-b border-white/10 ${active ? 'block' : 'hidden'} md:block`}>
      {/* Section label — desktop only; on mobile the deck tab names the category. */}
      <div className="hidden md:block p-4 pb-0">
        <h3 className="text-xs font-medium text-white/40 tracking-wider uppercase">{title}</h3>
      </div>
      <div className="px-4 pt-4 pb-5 md:pt-3 md:pb-4">
        {children}
      </div>
    </div>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between min-h-[44px] md:min-h-0 py-2.5 md:py-1 cursor-pointer group">
      <span className="text-sm text-white/60 group-hover:text-white/80">{label}</span>
      <button
        onClick={() => onChange(!checked)}
        className={`w-10 h-6 md:w-8 md:h-4 rounded-full transition-colors relative flex-shrink-0 ${
          checked ? 'bg-white/40' : 'bg-white/10'
        }`}
      >
        <div
          className={`w-5 h-5 md:w-3 md:h-3 rounded-full bg-white absolute top-0.5 transition-transform ${
            checked ? 'translate-x-[18px] md:translate-x-4' : 'translate-x-0.5'
          }`}
        />
      </button>
    </label>
  );
}
