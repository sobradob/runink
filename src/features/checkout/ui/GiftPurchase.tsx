import { useState, useEffect } from 'react';
import { fetchGiftTiers, purchaseGift, type GiftTierInfo } from '../services/checkoutApi';

export function GiftPurchase() {
  const [tiers, setTiers] = useState<GiftTierInfo[]>([]);
  const [selectedTier, setSelectedTier] = useState<string>('');
  const [recipientName, setRecipientName] = useState('');
  const [purchaserEmail, setPurchaserEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchGiftTiers()
      .then((t) => { setTiers(t); if (t.length > 0) setSelectedTier(t[1]?.id || t[0].id); })
      .catch(() => setError('Failed to load gift options'));
  }, []);

  const handlePurchase = async () => {
    if (!selectedTier) return;
    setLoading(true);
    setError('');
    try {
      const { url } = await purchaseGift({ tierId: selectedTier, purchaserEmail, recipientName });
      window.location.href = url;
    } catch (e: any) {
      setError(e.message);
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex flex-col">
      {/* Header */}
      <header className="h-14 flex items-center px-6 border-b border-white/10">
        <a href="/" className="flex items-center gap-3">
          <h1 className="text-lg tracking-[0.15em] uppercase" style={{ fontFamily: 'var(--font-display)' }}>
            RunInk
          </h1>
        </a>
      </header>

      <div className="flex-1 flex items-center justify-center p-8">
        <div className="max-w-2xl w-full">
          {/* Hero */}
          <div className="text-center mb-10">
            <h2
              className="text-3xl tracking-[0.15em] uppercase mb-3"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              Gift a Run Poster
            </h2>
            <p className="text-white/40 text-sm leading-relaxed max-w-md mx-auto">
              Give a runner a beautiful map poster of their favourite run. They'll connect their Strava,
              design their perfect poster, and receive a high-quality print — for free.
            </p>
          </div>

          {/* Tier selection */}
          <div className="grid grid-cols-2 gap-3 mb-8">
            {tiers.map((tier) => (
              <button
                key={tier.id}
                onClick={() => setSelectedTier(tier.id)}
                className={`p-4 rounded-xl border text-left transition-all ${
                  selectedTier === tier.id
                    ? 'border-white/40 bg-white/5'
                    : 'border-white/10 hover:border-white/20'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-white">{tier.name}</span>
                  <span className="text-lg font-medium text-white">
                    ${(tier.priceCents / 100).toFixed(0)}
                  </span>
                </div>
                <div className="text-xs text-white/40">{tier.description}</div>
                {tier.framed && (
                  <div className="mt-2 text-xs text-white/30 bg-white/5 inline-block px-2 py-0.5 rounded">
                    Includes frame
                  </div>
                )}
              </button>
            ))}
          </div>

          {/* Form */}
          <div className="space-y-3 mb-6">
            <input
              type="text"
              placeholder="Recipient's name (optional)"
              value={recipientName}
              onChange={(e) => setRecipientName(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-white/30"
            />
            <input
              type="email"
              placeholder="Your email (for receipt)"
              value={purchaserEmail}
              onChange={(e) => setPurchaserEmail(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-white/30"
            />
          </div>

          {error && (
            <div className="text-red-400 text-sm mb-4 text-center">{error}</div>
          )}

          {/* Purchase button */}
          <button
            onClick={handlePurchase}
            disabled={loading || !selectedTier}
            className="w-full py-4 rounded-xl bg-white text-black font-medium text-sm tracking-wider uppercase hover:bg-white/90 disabled:opacity-50 transition-all"
          >
            {loading ? 'Redirecting to checkout...' : 'Purchase Gift'}
          </button>

          <div className="text-center mt-4 text-xs text-white/20">
            Secure payment via Stripe. The recipient will receive a unique code to redeem their poster.
          </div>
        </div>
      </div>
    </div>
  );
}
