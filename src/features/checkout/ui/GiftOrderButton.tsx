import { useState } from 'react';
import { createGiftOrder, getUploadUrl, uploadPosterPng, clearGiftContext } from '../services/checkoutApi';
import { GIFT_TIERS_CLIENT, PRINT_DIMENSIONS } from './tiers';
import type { PosterDimensions } from '@/types/poster';

interface GiftOrderButtonProps {
  giftCode: string;
  tierId: string;
  posterConfig: any;
  renderPoster?: (printDimensions?: PosterDimensions) => Promise<Blob>;
}

export function GiftOrderButton({ giftCode, tierId, posterConfig, renderPoster }: GiftOrderButtonProps) {
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  const tier = GIFT_TIERS_CLIENT.find((t) => t.id === tierId);

  const handleClaim = async () => {
    setLoading(true);
    setError('');
    try {
      // Step 1: Create order from gift code
      setStatus('Creating order...');
      const { orderId } = await createGiftOrder({ giftCode, tierId });

      // Step 2: Render poster at print dimensions
      if (renderPoster) {
        setStatus('Rendering poster...');
        const printDims = PRINT_DIMENSIONS[tierId];
        const blob = await renderPoster(printDims ? { ...printDims, label: tierId } : undefined);

        // Step 3: Upload poster PNG
        setStatus('Uploading artwork...');
        const { url, method, local } = await getUploadUrl(orderId);
        await uploadPosterPng(url, method, blob, orderId, local);
      }

      // Step 4: Clear gift cookie and redirect to success page
      clearGiftContext();
      setStatus('Redirecting...');
      window.location.href = `/order/${orderId}/success`;
    } catch (e: any) {
      console.error('Gift order failed:', e);
      setError(e.message || 'Failed to create order');
      setLoading(false);
    }
  };

  return (
    <div className="space-y-2">
      {tier && (
        <div className="p-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5 text-center">
          <div className="text-xs text-emerald-400/70 uppercase tracking-wider mb-1">Gift — Free Print</div>
          <div className="text-sm text-white font-medium">{tier.name}</div>
          <div className="text-[10px] text-white/40 mt-0.5">{tier.description}</div>
        </div>
      )}

      <button
        onClick={handleClaim}
        disabled={loading}
        className="w-full py-3 rounded-lg bg-emerald-600 text-white font-medium text-sm tracking-wider uppercase hover:bg-emerald-500 disabled:opacity-50 transition-all"
      >
        {loading ? status || 'Processing...' : 'Claim Free Print'}
      </button>

      {error && (
        <div className="text-red-400 text-xs text-center">{error}</div>
      )}
    </div>
  );
}
