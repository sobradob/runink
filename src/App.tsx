import { lazy, Suspense, useCallback, useState } from 'react';
import type { ActivitySummary } from '@/types/activity';
import { useActivityIndex } from '@/features/data-import/hooks/useActivityData';
import { ActivityBrowser } from '@/features/data-import/ui/ActivityBrowser';
import { StravaConnectButton } from '@/features/data-import/ui/StravaConnectButton';
import { PosterEditor } from '@/features/poster/ui/PosterEditor';
import { ModeSelect } from '@/features/onboarding/ui/ModeSelect';
import { LandingPage } from '@/features/onboarding/ui/landing/LandingPage';
import {
  loadOutputMode,
  saveOutputMode,
  type OutputMode,
} from '@/features/onboarding/services/outputMode';
import { DiagnosticOverlay, useLongPress } from '@/features/diagnostics/DiagnosticOverlay';
import { OfflineToast } from '@/features/diagnostics/OfflineToast';
import { getGiftContext, persistGiftContext, type GiftContext } from '@/features/checkout/services/checkoutApi';

// Lazy-loaded routes — these are visited by a small fraction of users
// each session, and pulling them into the initial bundle adds bytes
// every mobile user pays on first paint. Each lazy() call becomes its
// own JS chunk that Vite emits at build time; the route only loads
// when the user actually navigates to it. Suspense boundary below
// shows a tiny spinner during the ~100 ms chunk fetch.
const GiftPurchase = lazy(() => import('@/features/checkout/ui/GiftPurchase').then(m => ({ default: m.GiftPurchase })));
const RedeemPage = lazy(() => import('@/features/checkout/ui/RedeemPage').then(m => ({ default: m.RedeemPage })));
const PrivacyPolicy = lazy(() => import('@/features/legal/PrivacyPolicy').then(m => ({ default: m.PrivacyPolicy })));
const OrderSuccessPage = lazy(() => import('@/features/checkout/ui/OrderSuccessPage').then(m => ({ default: m.OrderSuccessPage })));
const OrderStatusPage = lazy(() => import('@/features/checkout/ui/OrderStatusPage').then(m => ({ default: m.OrderStatusPage })));
const InternalRenderPage = lazy(() => import('@/features/poster/render/InternalRenderPage').then(m => ({ default: m.InternalRenderPage })));

// Minimal fallback for lazy routes. Matches the app's existing loading
// idiom so it doesn't look out of place during the brief chunk fetch.
function RouteFallback() {
  return (
    <div className="min-h-dvh bg-[#0a0a0a] flex items-center justify-center">
      <div className="w-6 h-6 border-2 border-white/15 border-t-white/60 rounded-full animate-spin" />
    </div>
  );
}

/** Internal render surface for server-side Playwright poster capture.
 *  Checked before the main app boots so we bypass Strava auth, the activity
 *  index, and all other app shell concerns — the page needs to mount nothing
 *  but `<MapPreview>` + `<StatsOverlay>` so the screenshot matches the preview. */
const INTERNAL_RENDER_PREFIX = '/internal/render-poster/';
function getInternalRenderToken(): string | null {
  const path = window.location.pathname;
  if (!path.startsWith(INTERNAL_RENDER_PREFIX)) return null;
  const token = path.slice(INTERNAL_RENDER_PREFIX.length);
  return /^[0-9a-f-]{36}$/i.test(token) ? token : null;
}

type View =
  | { type: 'browse' }
  | { type: 'individual'; activity: ActivitySummary }
  | { type: 'compilation'; activities: ActivitySummary[] }
  | { type: 'gift' }
  | { type: 'redeem'; code: string; tier?: string }
  | { type: 'gift-success' }
  | { type: 'privacy' }
  | { type: 'order-success'; orderId: string }
  | { type: 'order-status'; orderId: string };

function getInitialView(): View {
  const path = window.location.pathname;
  const params = new URLSearchParams(window.location.search);

  if (path === '/privacy') return { type: 'privacy' };
  if (path === '/gift') return { type: 'gift' };
  const orderSuccessMatch = path.match(/^\/order\/([^/]+)\/success$/);
  if (orderSuccessMatch) return { type: 'order-success', orderId: orderSuccessMatch[1] };
  const orderStatusMatch = path.match(/^\/order\/([^/]+)$/);
  if (orderStatusMatch) return { type: 'order-status', orderId: orderStatusMatch[1] };
  if (path.startsWith('/redeem/')) {
    const code = path.split('/redeem/')[1];
    return { type: 'redeem', code };
  }
  if (path === '/gift/success') return { type: 'gift-success' };

  return { type: 'browse' };
}

export default function App() {
  // Diagnostics state is at the App level so the overlay is reachable from
  // every view (browse, editor, redeem, success, etc.) without threading
  // a context through. Long-press handler is created once and shared.
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const logoLongPress = useLongPress(() => setDiagnosticsOpen(true));

  // Playwright-driven render route — short-circuits the main shell so the
  // screenshot is a pristine poster and not a half-rendered app. Wrapped
  // in Suspense because InternalRenderPage is a lazy chunk; Playwright's
  // `await page.waitForFunction('window.__POSTER_READY__')` already gates
  // the screenshot, so the chunk fetch delay (~100 ms) is hidden inside
  // the existing wait — no new race.
  const internalToken = getInternalRenderToken();
  if (internalToken) {
    return (
      <Suspense fallback={<RouteFallback />}>
        <InternalRenderPage token={internalToken} />
      </Suspense>
    );
  }

  return (
    <>
      <Suspense fallback={<RouteFallback />}>
        <MainApp logoLongPress={logoLongPress} />
      </Suspense>
      <DiagnosticOverlay open={diagnosticsOpen} onClose={() => setDiagnosticsOpen(false)} />
      <OfflineToast />
    </>
  );
}

interface MainAppProps {
  /** Spread onto a logo element to make long-press open the diagnostic overlay. */
  logoLongPress: ReturnType<typeof useLongPress>;
}

function MainApp({ logoLongPress }: MainAppProps) {
  const {
    index, loading, error, authIssue,
    stravaAuth, stravaLoading, stravaTracksMap, syncingMore,
    connectStrava, disconnectStrava, refreshStrava,
  } = useActivityIndex();

  const [view, setView] = useState<View>(getInitialView);
  const [giftContext, setGiftContext] = useState<GiftContext | null>(() => getGiftContext());

  // The output the user is building. Null until they pick on the ModeSelect
  // screen (shown during the Strava load). Starts null every session so the
  // choice screen fills the unavoidable load wait — but the previous choice is
  // pre-highlighted via loadOutputMode().
  const [outputMode, setOutputMode] = useState<OutputMode | null>(null);

  const chooseMode = useCallback((mode: OutputMode) => {
    setOutputMode(mode);
    saveOutputMode(mode);
    window.mixpanel?.track('output_mode_selected', { mode });
  }, []);

  // Persistent Switch action — available on every connected surface. Toggles
  // the output mode and returns to the browser so the user can pick run(s) for
  // the new mode; cross-mode styling is preserved by the editor's carryover.
  const switchMode = useCallback(() => {
    setOutputMode((prev) => {
      const next: OutputMode = prev === 'single' ? 'composite' : 'single';
      saveOutputMode(next);
      window.mixpanel?.track('output_mode_switched', { to: next });
      return next;
    });
    setView({ type: 'browse' });
  }, []);

  // Privacy policy page
  if (view.type === 'privacy') {
    return <PrivacyPolicy />;
  }

  // Order success page (post-Stripe payment)
  if (view.type === 'order-success') {
    return <OrderSuccessPage orderId={view.orderId} />;
  }

  // Order status/tracking page
  if (view.type === 'order-status') {
    return <OrderStatusPage orderId={view.orderId} />;
  }

  // Gift purchase page
  if (view.type === 'gift') {
    return <GiftPurchase />;
  }

  // Gift success page
  if (view.type === 'gift-success') {
    const sessionId = new URLSearchParams(window.location.search).get('session_id');
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <div className="text-center max-w-md px-8">
          <div className="text-4xl mb-4">🎉</div>
          <h2 className="text-2xl tracking-[0.15em] uppercase mb-3" style={{ fontFamily: 'var(--font-display)' }}>
            Gift Purchased!
          </h2>
          <p className="text-white/40 text-sm mb-6 leading-relaxed">
            Your gift code has been generated. Check your email for the code and a shareable link
            to send to the recipient.
          </p>
          <a
            href="/"
            className="inline-block px-6 py-3 rounded-lg bg-white text-black font-medium text-sm tracking-wider uppercase"
          >
            Back to RunInk
          </a>
        </div>
      </div>
    );
  }

  // Gift redemption page
  if (view.type === 'redeem') {
    return (
      <RedeemPage
        code={view.code}
        onRedeemed={(tier, giftCode) => {
          const ctx: GiftContext = { giftCode, tier };
          persistGiftContext(ctx);
          setGiftContext(ctx);
          window.history.pushState({}, '', '/');
          setView({ type: 'browse' });
        }}
      />
    );
  }

  // Poster editor views
  if (view.type === 'individual') {
    return (
      <PosterEditor
        activity={view.activity}
        mode="individual"
        stravaTracksMap={stravaTracksMap}
        onBack={() => setView({ type: 'browse' })}
        onSwitchMode={switchMode}
        switchTargetLabel="composite"
        giftContext={giftContext}
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
        onSwitchMode={switchMode}
        switchTargetLabel="single"
        giftContext={giftContext}
      />
    );
  }

  // Onboarding: not connected to Strava — the public, scrollable landing page
  // (clarity / example maps / themes / pricing / social proof) lives in
  // LandingPage. It owns the connect CTA + auth-recovery alerts so this branch
  // just wires App state and navigation into it.
  if (!loading && !stravaAuth.connected) {
    return (
      <LandingPage
        stravaAuth={stravaAuth}
        stravaLoading={stravaLoading}
        onConnect={connectStrava}
        onDisconnect={disconnectStrava}
        onRefresh={refreshStrava}
        authIssue={authIssue}
        error={error}
        logoLongPress={logoLongPress}
        onGift={() => setView({ type: 'gift' })}
        onPrivacy={() => {
          window.history.pushState({}, '', '/privacy');
          setView({ type: 'privacy' });
        }}
      />
    );
  }

  // Output-mode gate: once connected, the user picks single vs composite on the
  // ModeSelect screen before browsing. Shown during the Strava load so the wait
  // is productive. Gated on `connected` so an unauthenticated first paint never
  // flashes this before the connect screen.
  if (stravaAuth.connected && outputMode === null) {
    return (
      <ModeSelect
        current={loadOutputMode()}
        loading={loading || stravaLoading}
        loadedCount={index?.totalActivities ?? 0}
        onSelect={chooseMode}
      />
    );
  }

  // Main app: activity browser
  return (
    <div className="h-dvh flex flex-col">
      <header className="h-14 flex items-center px-4 md:px-6 border-b border-white/10 flex-shrink-0">
        <div className="flex items-center gap-3">
          <h1
            className="text-lg tracking-[0.15em] uppercase select-none"
            style={{ fontFamily: 'var(--font-display)' }}
            {...logoLongPress}
          >
            RunInk
          </h1>
          <span className="text-xs text-white/30 hidden md:inline">
            {outputMode === 'composite' ? 'Composite — many runs in one' : 'Single run poster'}
          </span>
        </div>
        <div className="ml-auto flex items-center gap-3">
          {outputMode && (
            <button
              onClick={switchMode}
              className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-full border border-white/15 text-white/60 hover:text-white hover:border-white/30 transition-colors"
              title={`Switch to ${outputMode === 'single' ? 'composite' : 'single'} mode`}
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 7h12m0 0l-4-4m4 4l-4 4M16 17H4m0 0l4 4m-4-4l4-4" />
              </svg>
              <span className="hidden sm:inline">Switch to {outputMode === 'single' ? 'composite' : 'single'}</span>
              <span className="sm:hidden">Switch</span>
            </button>
          )}
          <a
            href="/privacy"
            onClick={(e) => { e.preventDefault(); window.history.pushState({}, '', '/privacy'); setView({ type: 'privacy' }); }}
            className="text-xs text-white/30 hover:text-white/50 hidden md:inline"
          >
            Privacy
          </a>
          <a
            href="/gift"
            onClick={(e) => { e.preventDefault(); setView({ type: 'gift' }); }}
            className="text-xs text-white/30 hover:text-white/50 hidden md:inline"
          >
            🎁 Gift
          </a>
          <StravaConnectButton
            auth={stravaAuth}
            loading={stravaLoading}
            onConnect={connectStrava}
            onDisconnect={disconnectStrava}
            onRefresh={refreshStrava}
          />
        </div>
      </header>

      <main className="relative flex-1 overflow-hidden">
        {/* Background sync indicator: the quick first page is on screen but
            older activities are still streaming in. Floating pill so the
            browser layout doesn't shift when it appears/disappears. */}
        {syncingMore && !stravaLoading && (
          <div className="pointer-events-none absolute bottom-4 left-1/2 z-20 -translate-x-1/2">
            <div className="flex items-center gap-2 rounded-full border border-white/10 bg-[#0a0a0a]/90 px-4 py-2 text-xs text-white/60 shadow-lg">
              <div className="h-3 w-3 animate-spin rounded-full border border-white/20 border-t-white/70" />
              Syncing your runs from Strava… {index?.totalActivities ?? 0} so far
            </div>
          </div>
        )}
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

        {/* Empty state: Strava is connected and we finished loading, but the
            account has no GPS-bearing activities to show (e.g. only treadmill
            workouts, gym sessions, or manually-entered runs without GPS — see
            the GPS_ACTIVITY_TYPES filter in server/lib/strava-client.ts).
            Without this branch the <main> renders nothing and the user sees a
            bare black screen with no explanation. Gated on !syncingMore so the
            background-sync pill owns the "still arriving" case. */}
        {!loading && !stravaLoading && !error && !index && !syncingMore && stravaAuth.connected && (
          <div className="h-full flex items-center justify-center">
            <div className="text-center max-w-md px-8">
              <div className="text-lg text-white/70 mb-3" style={{ fontFamily: 'var(--font-display)' }}>
                No GPS runs found
              </div>
              <p className="text-white/40 text-sm mb-6 leading-relaxed">
                You're connected to Strava, but we couldn't find any activities with
                GPS data to map. RunInk needs runs, rides, walks or hikes recorded
                with GPS — treadmill workouts, gym sessions and manually-added
                activities won't appear here.
              </p>
              <button
                onClick={refreshStrava}
                className="text-sm px-4 py-2 rounded-lg bg-white/5 text-white/60 hover:text-white/90 hover:bg-white/10 transition-colors"
              >
                ↻ Refresh from Strava
              </button>
            </div>
          </div>
        )}

        {index && !stravaLoading && outputMode && (
          <ActivityBrowser
            activities={index.activities}
            outputMode={outputMode}
            syncingMore={syncingMore}
            loadedCount={index.totalActivities}
            onSelectSingle={(activity) => {
              window.mixpanel?.track('activity_selected', { mode: 'individual', activity_count: 1 });
              setView({ type: 'individual', activity });
            }}
            onSelectMultiple={(activities) => {
              window.mixpanel?.track('activity_selected', { mode: 'compilation', activity_count: activities.length });
              setView({ type: 'compilation', activities });
            }}
          />
        )}
      </main>
    </div>
  );
}
