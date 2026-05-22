import { useState } from 'react';
import type { ActivitySummary } from '@/types/activity';
import { useActivityIndex } from '@/features/data-import/hooks/useActivityData';
import { ActivityBrowser } from '@/features/data-import/ui/ActivityBrowser';
import { StravaConnectButton } from '@/features/data-import/ui/StravaConnectButton';
import { PosterEditor } from '@/features/poster/ui/PosterEditor';
import { GiftPurchase } from '@/features/checkout/ui/GiftPurchase';
import { RedeemPage } from '@/features/checkout/ui/RedeemPage';
import { PrivacyPolicy } from '@/features/legal/PrivacyPolicy';
import { OrderSuccessPage } from '@/features/checkout/ui/OrderSuccessPage';
import { OrderStatusPage } from '@/features/checkout/ui/OrderStatusPage';
import { InternalRenderPage } from '@/features/poster/render/InternalRenderPage';
import { DiagnosticOverlay, useLongPress } from '@/features/diagnostics/DiagnosticOverlay';
import { OfflineToast } from '@/features/diagnostics/OfflineToast';
import { getGiftContext, persistGiftContext, type GiftContext } from '@/features/checkout/services/checkoutApi';

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
  // screenshot is a pristine poster and not a half-rendered app.
  const internalToken = getInternalRenderToken();
  if (internalToken) {
    return <InternalRenderPage token={internalToken} />;
  }

  return (
    <>
      <MainApp logoLongPress={logoLongPress} />
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
    index, loading, error,
    stravaAuth, stravaLoading, stravaTracksMap,
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
