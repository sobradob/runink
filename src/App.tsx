import { useState } from 'react';
import type { ActivitySummary } from '@/types/activity';
import { useActivityIndex } from '@/features/data-import/hooks/useActivityData';
import { ActivityBrowser } from '@/features/data-import/ui/ActivityBrowser';
import { StravaConnectButton } from '@/features/data-import/ui/StravaConnectButton';
import { PosterEditor } from '@/features/poster/ui/PosterEditor';

type View =
  | { type: 'browse' }
  | { type: 'individual'; activity: ActivitySummary }
  | { type: 'compilation'; activities: ActivitySummary[] };

export default function App() {
  const {
    index, loading, error,
    stravaAuth, stravaLoading, stravaTracksMap,
    connectStrava, disconnectStrava, refreshStrava,
  } = useActivityIndex();

  const [view, setView] = useState<View>({ type: 'browse' });

  if (view.type === 'individual') {
    return (
      <PosterEditor
        activity={view.activity}
        mode="individual"
        stravaTracksMap={stravaTracksMap}
        onBack={() => setView({ type: 'browse' })}
      />
    );
  }

  if (view.type === 'compilation') {
    return (
      <PosterEditor
        activities={view.activities}
        mode="compilation"
        stravaTracksMap={stravaTracksMap}
        onBack={() => setView({ type: 'browse' })}
      />
    );
  }

  // Onboarding: not connected to Strava
  if (!loading && !stravaAuth.connected) {
    return (
      <div className="h-screen flex flex-col bg-[#0a0a0a]">
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center max-w-lg px-8">
            <h1
              className="text-4xl tracking-[0.2em] uppercase mb-3"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              RunInk
            </h1>
            <p className="text-white/40 text-sm mb-8 leading-relaxed">
              Transform your running data into beautiful, printable map posters.
              Connect your Strava account to get started.
            </p>

            <StravaConnectButton
              auth={stravaAuth}
              loading={stravaLoading}
              onConnect={connectStrava}
              onDisconnect={disconnectStrava}
              onRefresh={refreshStrava}
            />

            {error && (
              <div className="mt-6 text-red-400/60 text-xs">{error}</div>
            )}

            <div className="mt-12 grid grid-cols-3 gap-6 text-center">
              <div>
                <div className="text-lg mb-1" style={{ fontFamily: 'var(--font-display)' }}>
                  INDIVIDUAL
                </div>
                <div className="text-xs text-white/30">
                  Single run posters with stats, km markers, and theme
                </div>
              </div>
              <div>
                <div className="text-lg mb-1" style={{ fontFamily: 'var(--font-display)' }}>
                  COMPILATION
                </div>
                <div className="text-xs text-white/30">
                  All your runs in a city layered into one heat-map poster
                </div>
              </div>
              <div>
                <div className="text-lg mb-1" style={{ fontFamily: 'var(--font-display)' }}>
                  10 THEMES
                </div>
                <div className="text-xs text-white/30">
                  Noir, Midnight Blue, Japanese Ink, and 7 more
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col">
      {/* Header */}
      <header className="h-14 flex items-center px-6 border-b border-white/10 flex-shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-lg tracking-[0.15em] uppercase" style={{ fontFamily: 'var(--font-display)' }}>
            RunInk
          </h1>
          <span className="text-xs text-white/30">Your runs, beautifully mapped</span>
        </div>
        <div className="ml-auto">
          <StravaConnectButton
            auth={stravaAuth}
            loading={stravaLoading}
            onConnect={connectStrava}
            onDisconnect={disconnectStrava}
            onRefresh={refreshStrava}
          />
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 overflow-hidden">
        {(loading || stravaLoading) && (
          <div className="h-full flex items-center justify-center">
            <div className="text-center">
              <div className="w-8 h-8 border-2 border-white/20 border-t-white rounded-full animate-spin mx-auto mb-4" />
              <div className="text-sm text-white/40">
                {stravaLoading ? 'Loading your Strava runs...' : 'Loading...'}
              </div>
            </div>
          </div>
        )}

        {error && !index && !loading && (
          <div className="h-full flex items-center justify-center">
            <div className="text-center max-w-md px-4">
              <div className="text-red-400 mb-2 text-lg">Failed to load data</div>
              <div className="text-white/40 text-sm mb-4">{error}</div>
            </div>
          </div>
        )}

        {index && !stravaLoading && (
          <ActivityBrowser
            activities={index.activities}
            onSelectSingle={(activity) => setView({ type: 'individual', activity })}
            onSelectMultiple={(activities) => setView({ type: 'compilation', activities })}
          />
        )}
      </main>
    </div>
  );
}
