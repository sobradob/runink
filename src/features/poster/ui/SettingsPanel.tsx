import { useState, useRef, useEffect, useCallback } from 'react';
import type { Theme } from '@/types/theme';
import type { TrackData } from '@/types/activity';
import type { PosterConfig, LayerVisibility, MarkerIcon } from '@/types/poster';
import { POSTER_PRESETS, MARKER_ICONS } from '@/types/poster';
import { ThemeGallery } from '@/features/theme/ui/ThemeGallery';

/** Imperative handle exposed to the editor so the guided-step rail can jump to
 *  (open + scroll to) a settings section on mobile. */
export interface SettingsPanelControl {
  openAndScroll: (title: string) => void;
}

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
  /** When true, hides the Theme section (the mobile sheet shows a persistent theme strip instead) */
  hideTheme?: boolean;
  /** Imperative control for the guided-step rail (mobile). */
  controlRef?: React.MutableRefObject<SettingsPanelControl | null>;
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
  hideTheme,
  controlRef,
}: SettingsPanelProps) {
  const updateLayer = (key: keyof LayerVisibility, value: boolean) => {
    onConfigChange({ layers: { ...config.layers, [key]: value } });
  };

  const customMarkers = config.markers.filter((m) => m.type === 'custom');

  // Controlled accordion (mobile only — desktop forces every section open via
  // `md:block`). The guided priority sections start open so the user lands on
  // the highest-impact controls without hunting. Theme is omitted here because
  // the mobile sheet shows a persistent theme strip instead.
  const [openSections, setOpenSections] = useState<Set<string>>(
    () => new Set(['Theme', 'Text', 'Size']),
  );
  const sectionEls = useRef<Record<string, HTMLDivElement | null>>({});

  const toggleSection = (title: string) =>
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(title)) next.delete(title);
      else next.add(title);
      return next;
    });

  const openAndScroll = useCallback((title: string) => {
    setOpenSections((prev) => new Set(prev).add(title));
    // Defer so the section is rendered-open before we scroll to it.
    requestAnimationFrame(() => {
      sectionEls.current[title]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, []);

  useEffect(() => {
    if (!controlRef) return;
    controlRef.current = { openAndScroll };
    return () => { controlRef.current = null; };
  }, [controlRef, openAndScroll]);

  return (
    <div className="w-full md:w-72 bg-[#111] md:border-l border-white/10 overflow-y-auto flex flex-col">
      {/* Header — desktop only, mobile uses sheet handle */}
      <div className="hidden md:block p-4 border-b border-white/10">
        <h2 className="text-sm font-medium text-white/80 tracking-wider uppercase">Settings</h2>
      </div>

      {/* Theme */}
      {!hideTheme && (
        <Section title="Theme" open={openSections.has('Theme')} onToggle={toggleSection} registerEl={(el) => (sectionEls.current['Theme'] = el)}>
          <ThemeGallery
            selectedId={config.themeId}
            onSelect={onThemeChange}
            tracks={tracks}
            isCompilation={mode === 'compilation'}
          />
        </Section>
      )}

      {/* Text — priority step 2 */}
      <Section title="Text" open={openSections.has('Text')} onToggle={toggleSection} registerEl={(el) => (sectionEls.current['Text'] = el)}>
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
      <Section title="Size" open={openSections.has('Size')} onToggle={toggleSection} registerEl={(el) => (sectionEls.current['Size'] = el)}>
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
      <Section title="Layers" open={openSections.has('Layers')} onToggle={toggleSection} registerEl={(el) => (sectionEls.current['Layers'] = el)}>
        <Toggle label="Water" checked={config.layers.water} onChange={(v) => updateLayer('water', v)} />
        <Toggle label="Parks & green" checked={config.layers.parks} onChange={(v) => updateLayer('parks', v)} />
        <Toggle label="Buildings" checked={config.layers.buildings} onChange={(v) => updateLayer('buildings', v)} />
        <Toggle label="Roads" checked={config.layers.roads} onChange={(v) => updateLayer('roads', v)} />
        <Toggle label="Rail" checked={config.layers.rail} onChange={(v) => updateLayer('rail', v)} />
      </Section>

      {/* Markers */}
      <Section title="Markers" open={openSections.has('Markers')} onToggle={toggleSection} registerEl={(el) => (sectionEls.current['Markers'] = el)}>
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
      <Section title="Orientation" open={openSections.has('Orientation')} onToggle={toggleSection} registerEl={(el) => (sectionEls.current['Orientation'] = el)}>
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
      <Section title="Display" open={openSections.has('Display')} onToggle={toggleSection} registerEl={(el) => (sectionEls.current['Display'] = el)}>
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
  open,
  onToggle,
  registerEl,
}: {
  title: string;
  children: React.ReactNode;
  open: boolean;
  onToggle: (title: string) => void;
  registerEl?: (el: HTMLDivElement | null) => void;
}) {
  return (
    <div className="border-b border-white/10" ref={registerEl}>
      {/* Collapsible header on mobile, static on desktop */}
      <button
        onClick={() => onToggle(title)}
        className="w-full p-4 flex items-center justify-between md:pointer-events-none"
      >
        <h3 className="text-xs font-medium text-white/40 tracking-wider uppercase">{title}</h3>
        <svg
          className={`w-3.5 h-3.5 text-white/20 transition-transform md:hidden ${open ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      <div className={`px-4 pb-4 ${open ? 'block' : 'hidden'} md:block`}>
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
