import { useState, useCallback, useEffect } from 'react';
import type { ActivitySummary, TrackData } from '@/types/activity';
import type { Theme } from '@/types/theme';
import type { PosterConfig } from '@/types/poster';
import { POSTER_PRESETS } from '@/types/poster';
import { getThemeById, getDefaultTheme } from '@/features/theme/infrastructure/themeRepository';
import { useTrack, useTracks } from '@/features/data-import/hooks/useActivityData';
import { MapPreview } from '@/features/map/ui/MapPreview';
import { StatsOverlay } from './StatsOverlay';
import { SettingsPanel } from './SettingsPanel';
import { renderPosterToBlob, downloadBlob } from '../infrastructure/renderer';
import { formatDistance, formatDuration, formatPace, formatDate, formatElevation } from '@/shared/utils/format';

interface PosterEditorProps {
  activity?: ActivitySummary;
  activities?: ActivitySummary[];
  mode: 'individual' | 'compilation';
  onBack: () => void;
}

export function PosterEditor({ activity, activities, mode, onBack }: PosterEditorProps) {
  const [config, setConfig] = useState<PosterConfig>({
    mode,
    themeId: 'noir',
    dimensions: POSTER_PRESETS[0],
    title: mode === 'individual'
      ? (activity?.location ?? '')
      : (activities?.[0]?.location ?? ''),
    subtitle: mode === 'individual'
      ? formatDate(activity?.date ?? '')
      : '',
    showStats: true,
    showCoordinates: true,
    showGradientFade: true,
    padding: 0.15,
  });

  const [theme, setTheme] = useState<Theme>(getDefaultTheme());
  const [exporting, setExporting] = useState(false);

  // Load track data
  const { track: singleTrack } = useTrack(mode === 'individual' ? activity?.id ?? null : null);
  const { tracks: compilationTracks, loadTracks } = useTracks();

  // Load compilation tracks on mount
  useEffect(() => {
    if (mode === 'compilation' && activities) {
      loadTracks(activities.map((a) => a.id));
    }
  }, [mode, activities, loadTracks]);

  const tracks: TrackData[] = mode === 'individual'
    ? (singleTrack ? [singleTrack] : [])
    : compilationTracks;

  const handleConfigChange = useCallback((update: Partial<PosterConfig>) => {
    setConfig((prev) => ({ ...prev, ...update }));
  }, []);

  const handleThemeChange = useCallback((newTheme: Theme) => {
    setTheme(newTheme);
    setConfig((prev) => ({ ...prev, themeId: newTheme.id }));
  }, []);

  const handleExport = useCallback(async () => {
    if (tracks.length === 0) return;
    setExporting(true);

    try {
      const statsText: string[] = [];
      let coordinateText: string | undefined;

      if (mode === 'individual' && activity) {
        statsText.push(formatDistance(activity.distance));
        statsText.push(formatDuration(activity.movingDuration || activity.duration));
        statsText.push(formatPace(activity.avgPace));
        if (activity.elevationGain > 0) statsText.push(formatElevation(activity.elevationGain));
        if (activity.startPoint) {
          coordinateText = `${activity.startPoint.lat.toFixed(4)}°N, ${Math.abs(activity.startPoint.lng).toFixed(4)}°${activity.startPoint.lng >= 0 ? 'E' : 'W'}`;
        }
      } else if (activities) {
        const totalDist = activities.reduce((s, a) => s + a.distance, 0);
        const totalDur = activities.reduce((s, a) => s + (a.movingDuration || a.duration), 0);
        statsText.push(`${activities.length} runs`);
        statsText.push(formatDistance(totalDist));
        statsText.push(formatDuration(totalDur));
      }

      const blob = await renderPosterToBlob({
        theme,
        tracks,
        config,
        title: config.title,
        subtitle: config.subtitle,
        statsText,
        coordinateText,
      });

      const filename = `runink-${config.themeId}-${mode === 'individual' ? activity?.id : 'compilation'}.png`;
      downloadBlob(blob, filename);
    } catch (err) {
      console.error('Export failed:', err);
    } finally {
      setExporting(false);
    }
  }, [tracks, theme, config, mode, activity, activities]);

  // Aspect ratio for preview
  const aspectRatio = config.dimensions.widthMm / config.dimensions.heightMm;

  return (
    <div className="h-screen flex">
      {/* Main area */}
      <div className="flex-1 flex flex-col bg-[#0a0a0a]">
        {/* Top bar */}
        <div className="h-12 flex items-center px-4 border-b border-white/10">
          <button
            onClick={onBack}
            className="text-white/40 hover:text-white text-sm flex items-center gap-2 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Back to activities
          </button>

          <div className="ml-auto text-xs text-white/30">
            {mode === 'individual' ? activity?.name : `${activities?.length ?? 0} runs`}
          </div>
        </div>

        {/* Preview area */}
        <div className="flex-1 flex items-center justify-center p-8 overflow-hidden">
          <div
            className="relative shadow-2xl"
            style={{
              width: '100%',
              maxWidth: aspectRatio > 1 ? '80vh' : `${60 * aspectRatio}vh`,
              aspectRatio: String(aspectRatio),
              maxHeight: '80vh',
            }}
          >
            <MapPreview
              theme={theme}
              tracks={tracks}
              isCompilation={mode === 'compilation'}
              className="rounded-sm"
            />

            {/* Stats overlay */}
            <StatsOverlay
              activity={activity}
              activities={activities}
              theme={theme}
              title={config.title}
              subtitle={config.subtitle}
              showStats={config.showStats}
              showCoordinates={config.showCoordinates}
              mode={mode}
            />

            {/* Loading state */}
            {tracks.length === 0 && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                <div className="text-white/40 text-sm">Loading track data...</div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Settings sidebar */}
      <SettingsPanel
        config={config}
        theme={theme}
        onConfigChange={handleConfigChange}
        onThemeChange={handleThemeChange}
        onExport={handleExport}
        exporting={exporting}
      />
    </div>
  );
}
