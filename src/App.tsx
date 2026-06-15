import { lazy, Suspense, useState } from 'react';
import type { ActivitySummary } from '@/types/activity';
import { useActivityIndex } from '@/features/data-import/hooks/useActivityData';
import { ActivityBrowser } from '@/features/data-import/ui/ActivityBrowser';
import { StravaConnectButton } from '@/features/data-import/ui/StravaConnectButton';
import { PosterEditor } from '@/features/poster/ui/PosterEditor';
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
        giftContext={giftContext}
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
              className="text-4xl tracking-[0.2em] uppercase mb-3 select-none"
              style={{ fontFamily: 'var(--font-display)' }}
              {...logoLongPress}
            >
              RunInk
            </h1>
            <p className="text-white/40 text-sm mb-8 leading-relaxed">
              Transform your running data into beautiful, printable map posters.
              Connect your Strava account to get started.
            </p>

            {/* Targeted recovery prompts. authIssue is set when the user
                connected without granting activity:read_all (the most common
                cause of the previously-cryptic "HTTP 500") or when Strava
                later revokes the session. Both render alongside the normal
                connect button — we want the user to act, not just read. */}
            {authIssue?.kind === 'missing_scope' && (
              <div
                role="alert"
                className="mb-6 text-left text-xs text-amber-200/90 bg-amber-900/15 border border-amber-500/30 rounded-md px-4 py-3 leading-relaxed"
              >
                <div className="font-medium text-amber-200 mb-1">Almost there</div>
                <div className="text-amber-100/80">
                  Strava sent us back without the "View data about your activities"
                  permission. Click Connect again and make sure that checkbox is
                  ticked — it's how we read your runs to make the poster.
                </div>
              </div>
            )}
            {authIssue?.kind === 'session_invalid' && (
              <div
                role="alert"
                className="mb-6 text-left text-xs text-red-200/90 bg-red-900/15 border border-red-500/30 rounded-md px-4 py-3 leading-relaxed"
              >
                <div className="font-medium text-red-200 mb-1">Your Strava session expired</div>
                <div className="text-red-100/80">
                  Reconnect Strava to pick up where you left off.
                </div>
              </div>
            )}

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

            <div className="mt-12 grid grid-cols-1 gap-4 md:grid-cols-3 md:gap-6 text-center">
              <div>
                <div className="text-lg mb-1" style={{ fontFamily: 'var(--font-display)' }}>INDIVIDUAL</div>
                <div className="text-xs text-white/30">Single run posters with stats, km markers, and theme</div>
              </div>
              <div>
                <div className="text-lg mb-1" style={{ fontFamily: 'var(--font-display)' }}>COMPILATION</div>
                <div className="text-xs text-white/30">All your runs in a city layered into one heat-map poster</div>
              </div>
              <div>
                <div className="text-lg mb-1" style={{ fontFamily: 'var(--font-display)' }}>10 THEMES</div>
                <div className="text-xs text-white/30">Noir, Midnight Blue, Japanese Ink, and 7 more</div>
              </div>
            </div>

            {/* Gift link */}
            <div className="mt-10 pt-6 border-t border-white/5 space-y-4">
              <a
                href="/gift"
                onClick={(e) => { e.preventDefault(); setView({ type: 'gift' }); }}
                className="text-sm text-white/30 hover:text-white/60 transition-colors"
              >
                🎁 Gift a poster to a runner
              </a>
              {/* Strava attribution */}
              <div className="flex justify-center">
                <a href="https://www.strava.com" target="_blank" rel="noopener noreferrer">
                  <img
                    src="/assets/strava/powered-by-strava-white.svg"
                    alt="Powered by Strava"
                    className="h-5 opacity-30 hover:opacity-50 transition-opacity"
                  />
                </a>
              </div>
              <div className="flex justify-center">
                <a
                  href="/privacy"
                  onClick={(e) => { e.preventDefault(); window.history.pushState({}, '', '/privacy'); setView({ type: 'privacy' }); }}
                  className="text-xs text-white/20 hover:text-white/40 transition-colors"
                >
                  Privacy Policy
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>
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
          <span className="text-xs text-white/30 hidden md:inline">Your runs, beautifully mapped</span>
        </div>
        <div className="ml-auto flex items-center gap-3">
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

        {index && !stravaLoading && (
          <ActivityBrowser
            activities={index.activities}
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
