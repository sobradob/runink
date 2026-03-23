import type { Theme } from '@/types/theme';
import type { PosterConfig, LayerVisibility, MarkerIcon } from '@/types/poster';
import { POSTER_PRESETS, MARKER_ICONS } from '@/types/poster';
import { ThemeGallery } from '@/features/theme/ui/ThemeGallery';

interface SettingsPanelProps {
  config: PosterConfig;
  theme: Theme;
  mode: 'individual' | 'compilation';
  showKmMarkers: boolean;
  showStartFinish: boolean;
  placingIcon: MarkerIcon | null;
  onShowKmMarkersChange: (v: boolean) => void;
  onShowStartFinishChange: (v: boolean) => void;
  onPlaceIcon: (icon: MarkerIcon | null) => void;
  onRemoveMarker: (id: string) => void;
  onConfigChange: (update: Partial<PosterConfig>) => void;
  onThemeChange: (theme: Theme) => void;
  onExport: () => void;
  exporting: boolean;
}

export function SettingsPanel({
  config,
  theme,
  mode,
  showKmMarkers,
  showStartFinish,
  placingIcon,
  onShowKmMarkersChange,
  onShowStartFinishChange,
  onPlaceIcon,
  onRemoveMarker,
  onConfigChange,
  onThemeChange,
  onExport,
  exporting,
}: SettingsPanelProps) {
  const updateLayer = (key: keyof LayerVisibility, value: boolean) => {
    onConfigChange({ layers: { ...config.layers, [key]: value } });
  };

  const customMarkers = config.markers.filter((m) => m.type === 'custom');

  return (
    <div className="w-72 bg-[#111] border-l border-white/10 overflow-y-auto flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-white/10">
        <h2 className="text-sm font-medium text-white/80 tracking-wider uppercase">Settings</h2>
      </div>

      {/* Theme */}
      <Section title="Theme">
        <ThemeGallery selectedId={config.themeId} onSelect={onThemeChange} />
      </Section>

      {/* Layers */}
      <Section title="Layers">
        <Toggle label="Water" checked={config.layers.water} onChange={(v) => updateLayer('water', v)} />
        <Toggle label="Parks & green" checked={config.layers.parks} onChange={(v) => updateLayer('parks', v)} />
        <Toggle label="Buildings" checked={config.layers.buildings} onChange={(v) => updateLayer('buildings', v)} />
        <Toggle label="Roads" checked={config.layers.roads} onChange={(v) => updateLayer('roads', v)} />
        <Toggle label="Rail" checked={config.layers.rail} onChange={(v) => updateLayer('rail', v)} />
      </Section>

      {/* Markers */}
      <Section title="Markers">
        {/* Auto markers (individual mode) */}
        {mode === 'individual' && (
          <div className="mb-3 space-y-1">
            <Toggle label="Start / Finish" checked={showStartFinish} onChange={onShowStartFinishChange} />
            <Toggle label="Km markers" checked={showKmMarkers} onChange={onShowKmMarkersChange} />
          </div>
        )}

        {/* Icon picker for custom markers */}
        <div className="mb-2">
          <div className="text-xs text-white/30 mb-2">Click an icon, then click on the map to place it</div>
          <div className="grid grid-cols-3 gap-1.5">
            {MARKER_ICONS.map((icon) => (
              <button
                key={icon.id}
                onClick={() => onPlaceIcon(placingIcon === icon.id ? null : icon.id)}
                className={`flex flex-col items-center gap-1 py-2 rounded-lg border transition-all ${
                  placingIcon === icon.id
                    ? 'border-yellow-400/60 bg-yellow-400/10 text-white'
                    : 'border-white/10 text-white/40 hover:text-white/60 hover:border-white/20'
                }`}
              >
                <span className="text-lg">{icon.emoji}</span>
                <span className="text-[10px]">{icon.label}</span>
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
                    className="text-xs text-white/20 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    ✕
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </Section>

      {/* Dimensions */}
      <Section title="Size">
        <div className="grid grid-cols-2 gap-1.5">
          {POSTER_PRESETS.map((preset) => (
            <button
              key={preset.label}
              onClick={() => onConfigChange({ dimensions: preset })}
              className={`text-xs px-2 py-1.5 rounded border transition-all ${
                config.dimensions.label === preset.label
                  ? 'border-white/40 bg-white/10 text-white'
                  : 'border-white/10 text-white/40 hover:text-white/60'
              }`}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </Section>

      {/* Map orientation */}
      <Section title="Orientation">
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

      {/* Text */}
      <Section title="Text">
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

      {/* Display options */}
      <Section title="Display">
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

      {/* Export button */}
      <div className="p-4 mt-auto border-t border-white/10">
        <button
          onClick={onExport}
          disabled={exporting}
          className="w-full py-3 rounded-lg bg-white text-black font-medium text-sm tracking-wider uppercase hover:bg-white/90 disabled:opacity-50 transition-all"
        >
          {exporting ? 'Exporting...' : 'Export PNG'}
        </button>
        <div className="text-xs text-white/30 text-center mt-2">
          {config.dimensions.label} @ {config.dimensions.dpi} DPI
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="p-4 border-b border-white/10">
      <h3 className="text-xs font-medium text-white/40 tracking-wider uppercase mb-3">{title}</h3>
      {children}
    </div>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between py-1 cursor-pointer group">
      <span className="text-sm text-white/60 group-hover:text-white/80">{label}</span>
      <button
        onClick={() => onChange(!checked)}
        className={`w-8 h-4 rounded-full transition-colors relative ${
          checked ? 'bg-white/40' : 'bg-white/10'
        }`}
      >
        <div
          className={`w-3 h-3 rounded-full bg-white absolute top-0.5 transition-transform ${
            checked ? 'translate-x-4' : 'translate-x-0.5'
          }`}
        />
      </button>
    </label>
  );
}
