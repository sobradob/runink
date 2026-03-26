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
  const {
    index, loading, error,
    stravaAuth, stravaLoading, stravaTracksMap,
    connectStrava, disconnectStrava, refreshStrava,
  } = useActivityIndex();

  const [view, setView] = useState<View>(getInitialView);

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
          // After redeeming, go to the main app where they'll connect Strava and design
          window.history.pushState({}, '', `/?redeemed=${giftCode}&tier=${tier}`);
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
    <div className="h-screen flex flex-col">
      <header className="h-14 flex items-center px-6 border-b border-white/10 flex-shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-lg tracking-[0.15em] uppercase" style={{ fontFamily: 'var(--font-display)' }}>
            RunInk
          </h1>
          <span className="text-xs text-white/30">Your runs, beautifully mapped</span>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <a
            href="/privacy"
            onClick={(e) => { e.preventDefault(); window.history.pushState({}, '', '/privacy'); setView({ type: 'privacy' }); }}
            className="text-xs text-white/30 hover:text-white/50"
          >
            Privacy
          </a>
          <a
            href="/gift"
            onClick={(e) => { e.preventDefault(); setView({ type: 'gift' }); }}
            className="text-xs text-white/30 hover:text-white/50"
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
