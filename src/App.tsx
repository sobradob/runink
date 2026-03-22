import { useState } from 'react';
import type { ActivitySummary } from '@/types/activity';
import { useActivityIndex } from '@/features/data-import/hooks/useActivityData';
import { ActivityBrowser } from '@/features/data-import/ui/ActivityBrowser';
import { PosterEditor } from '@/features/poster/ui/PosterEditor';

type View =
  | { type: 'browse' }
  | { type: 'individual'; activity: ActivitySummary }
  | { type: 'compilation'; activities: ActivitySummary[] };

export default function App() {
  const { index, loading, error } = useActivityIndex();
  const [view, setView] = useState<View>({ type: 'browse' });

  if (view.type === 'individual') {
    return (
      <PosterEditor
        activity={view.activity}
        mode="individual"
        onBack={() => setView({ type: 'browse' })}
      />
    );
  }

  if (view.type === 'compilation') {
    return (
      <PosterEditor
        activities={view.activities}
        mode="compilation"
        onBack={() => setView({ type: 'browse' })}
      />
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
      </header>

      {/* Content */}
      <main className="flex-1 overflow-hidden">
        {loading && (
          <div className="h-full flex items-center justify-center">
            <div className="text-center">
              <div className="w-8 h-8 border-2 border-white/20 border-t-white rounded-full animate-spin mx-auto mb-4" />
              <div className="text-sm text-white/40">Loading activities...</div>
            </div>
          </div>
        )}

        {error && (
          <div className="h-full flex items-center justify-center">
            <div className="text-center max-w-md px-4">
              <div className="text-red-400 mb-2 text-lg">Failed to load data</div>
              <div className="text-white/40 text-sm mb-4">{error}</div>
              <div className="text-white/20 text-xs">
                Make sure you've run the preprocessing script:
                <code className="block mt-2 bg-white/5 px-3 py-2 rounded text-white/50">
                  npx tsx scripts/preprocess-garmin.ts
                </code>
              </div>
            </div>
          </div>
        )}

        {index && (
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
