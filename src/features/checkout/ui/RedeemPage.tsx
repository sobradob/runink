import { useState, useEffect } from 'react';
import { validateGiftCode, redeemGiftCode, type GiftCodeInfo } from '../services/checkoutApi';

interface RedeemPageProps {
  code: string;
  onRedeemed: (tier: string, giftCode: string) => void;
}

export function RedeemPage({ code, onRedeemed }: RedeemPageProps) {
  const [gift, setGift] = useState<GiftCodeInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [redeeming, setRedeeming] = useState(false);

  useEffect(() => {
    validateGiftCode(code)
      .then(setGift)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [code]);

  const handleRedeem = async () => {
    setRedeeming(true);
    setError('');
    try {
      const { tier } = await redeemGiftCode(code);
      onRedeemed(tier, code);
    } catch (e: any) {
      setError(e.message);
      setRedeeming(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex flex-col">
      <header className="h-14 flex items-center px-6 border-b border-white/10">
        <a href="/" className="flex items-center gap-3">
          <h1 className="text-lg tracking-[0.15em] uppercase" style={{ fontFamily: 'var(--font-display)' }}>
            RunInk
          </h1>
        </a>
      </header>

      <div className="flex-1 flex items-center justify-center p-8">
        <div className="max-w-md w-full text-center">
          {loading && (
            <div>
              <div className="w-8 h-8 border-2 border-white/20 border-t-white rounded-full animate-spin mx-auto mb-4" />
              <div className="text-sm text-white/40">Validating gift code...</div>
            </div>
          )}

          {error && (
            <div>
              <div className="text-red-400 text-lg mb-2">Invalid Gift Code</div>
              <div className="text-white/40 text-sm mb-6">{error}</div>
              <a href="/" className="text-sm text-white/40 hover:text-white underline">
                Go to RunInk
              </a>
            </div>
          )}

          {gift && (
            <div>
              <div className="text-3xl mb-2">🎁</div>
              <h2
                className="text-2xl tracking-[0.15em] uppercase mb-2"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                You've Got a Gift!
              </h2>

              {gift.recipientName && (
                <p className="text-white/50 text-sm mb-4">
                  For {gift.recipientName}
                </p>
              )}

              <div className="bg-white/5 border border-white/10 rounded-xl p-6 mb-6">
                <div className="text-lg font-medium text-white mb-1">{gift.tierName}</div>
                <div className="text-sm text-white/40">{gift.tierDescription}</div>
                <div className="mt-3 text-xs text-white/20 font-mono">{gift.code}</div>
              </div>

              <p className="text-white/40 text-sm mb-6 leading-relaxed">
                Connect your Strava account, pick your favourite run, design your poster — and we'll
                print and ship it to you, completely free.
              </p>

              <button
                onClick={handleRedeem}
                disabled={redeeming}
                className="w-full py-4 rounded-xl bg-white text-black font-medium text-sm tracking-wider uppercase hover:bg-white/90 disabled:opacity-50 transition-all"
              >
                {redeeming ? 'Redeeming...' : 'Start Designing My Poster'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
