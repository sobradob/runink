import { useState, useEffect } from 'react';
import { createDirectOrder, getUploadUrl, uploadPosterPng } from '../services/checkoutApi';
import { GIFT_TIERS_CLIENT, PRINT_DIMENSIONS } from './tiers';
import type { PosterDimensions } from '@/types/poster';

/** Flip to false to re-enable the full order/payment flow */
const COMING_SOON = true;

interface OrderButtonProps {
  posterConfig: any;
  renderPoster?: (printDimensions?: PosterDimensions) => Promise<Blob>;
  onOrderCreated?: (orderId: string) => void;
}

function ComingSoonPopup({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    window.mixpanel?.track('coming_soon_popup_shown');
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-[#1a1a1a] border border-white/10 rounded-xl p-8 max-w-sm w-full mx-4 text-center">
        <div
          className="text-xl tracking-[0.2em] uppercase mb-3"
          style={{ fontFamily: 'var(--font-display)', color: 'white' }}
        >
          Coming Soon
        </div>
        <p className="text-white/60 text-sm leading-relaxed mb-6">
          We're putting the finishing touches on high-quality poster printing.
          Print ordering will be available shortly — stay tuned!
        </p>
        <button
          onClick={onClose}
          className="w-full py-3 rounded-lg bg-white/10 border border-white/20 text-white font-medium text-sm tracking-wider uppercase hover:bg-white/15 transition-all"
        >
          Got it
        </button>
      </div>
    </div>
  );
}

export function OrderButton({ posterConfig, renderPoster, onOrderCreated }: OrderButtonProps) {
  const [open, setOpen] = useState(false);
  const [selectedTier, setSelectedTier] = useState('a3-poster');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [showComingSoon, setShowComingSoon] = useState(false);

  const handleOrder = async () => {
    setLoading(true);
    try {
      // Step 1: Create order to get an order ID
      setStatus('Creating order...');
      const { orderId, checkoutUrl } = await createDirectOrder({
        tierId: selectedTier,
        posterConfig,
      });
      onOrderCreated?.(orderId);

      // Step 2: Render and upload poster PNG at the correct print dimensions
      if (renderPoster) {
        setStatus('Rendering poster...');
        const printDims = PRINT_DIMENSIONS[selectedTier];
        const blob = await renderPoster(printDims ? { ...printDims, label: selectedTier } : undefined);

        setStatus('Uploading artwork...');
        const { url, method, local } = await getUploadUrl(orderId);
        await uploadPosterPng(url, method, blob, orderId, local);
      }

      // Step 3: Redirect to Stripe checkout
      setStatus('Redirecting to payment...');
      window.location.href = checkoutUrl;
    } catch (e: any) {
      console.error('Order failed:', e);
      setStatus(`Error: ${e.message || 'Unknown error'}`);
      setLoading(false);
    }
  };

  if (!open) {
    return (
      <>
        <button
          onClick={() => {
            if (COMING_SOON) {
              setShowComingSoon(true);
            } else {
              setOpen(true);
            }
          }}
          className="w-full py-3 rounded-lg bg-white/10 border border-white/20 text-white font-medium text-sm tracking-wider uppercase hover:bg-white/15 transition-all"
        >
          Order Print
        </button>
        {showComingSoon && <ComingSoonPopup onClose={() => setShowComingSoon(false)} />}
      </>
    );
  }

  return (
    <div className="space-y-2">
      <div className="text-xs text-white/40 mb-2">Select print size:</div>
      {GIFT_TIERS_CLIENT.map((tier) => (
        <button
          key={tier.id}
          onClick={() => setSelectedTier(tier.id)}
          className={`w-full p-2 rounded-lg border text-left text-xs transition-all ${
            selectedTier === tier.id
              ? 'border-white/40 bg-white/10 text-white'
              : 'border-white/10 text-white/40 hover:text-white/60'
          }`}
        >
          <div className="flex justify-between">
            <span>{tier.name}</span>
            <span>${(tier.priceCents / 100).toFixed(0)}</span>
          </div>
          <div className="text-[10px] opacity-60 mt-0.5">{tier.description}</div>
        </button>
      ))}

      <button
        onClick={handleOrder}
        disabled={loading}
        className="w-full py-3 rounded-lg bg-white text-black font-medium text-sm tracking-wider uppercase hover:bg-white/90 disabled:opacity-50 transition-all"
      >
        {loading ? status || 'Processing...' : 'Proceed to Payment'}
      </button>
      <button
        onClick={() => setOpen(false)}
        disabled={loading}
        className="w-full py-1 text-xs text-white/30 hover:text-white/50 disabled:opacity-30"
      >
        Cancel
      </button>
    </div>
  );
}
