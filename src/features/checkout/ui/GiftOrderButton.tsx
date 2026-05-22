import { useState } from 'react';
import { createGiftOrder, getUploadUrl, uploadPosterPng, clearGiftContext } from '../services/checkoutApi';
import { GIFT_TIERS_CLIENT, PRINT_DIMENSIONS } from './tiers';
import type { PosterDimensions } from '@/types/poster';

interface GiftOrderButtonProps {
  giftCode: string;
  tierId: string;
  posterConfig: any;
  /** Legacy client-side render — retained as fallback. */
  renderPoster?: (printDimensions?: PosterDimensions) => Promise<Blob>;
  /** Preferred: PosterEditor-provided single-call submit (dispatches to
   *  server-side render when the flag is on). See OrderButton for details. */
  submitPoster?: (orderId: string, printDimensions?: PosterDimensions) => Promise<void>;
}

export function GiftOrderButton({ giftCode, tierId, posterConfig, renderPoster, submitPoster }: GiftOrderButtonProps) {
  const [showEmail, setShowEmail] = useState(false);
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  const tier = GIFT_TIERS_CLIENT.find((t) => t.id === tierId);

  const handleClaim = async () => {
    if (!email) {
      setError('Please enter your email address');
      return;
    }

    setLoading(true);
    setError('');
    try {
      // Step 1: Create order from gift code
      setStatus('Creating order...');
      const { orderId } = await createGiftOrder({ giftCode, tierId, email, posterConfig });

      // Step 2+3: Render + upload. Prefer the combined submitPoster path
      // (which dispatches to server-side Playwright render behind a flag)
      // and fall back to the legacy client-side flow otherwise.
      const printDims = PRINT_DIMENSIONS[tierId];
      const fullPrintDims: PosterDimensions | undefined = printDims
        ? { ...printDims, label: tierId, category: 'printable', tierId }
        : undefined;

      if (submitPoster) {
        setStatus('Rendering poster...');
        await submitPoster(orderId, fullPrintDims);
      } else if (renderPoster) {
        setStatus('Rendering poster...');
        const blob = await renderPoster(fullPrintDims);

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

      {!showEmail ? (
        <button
          onClick={() => setShowEmail(true)}
          className="w-full py-3 rounded-lg bg-emerald-600 text-white font-medium text-sm tracking-wider uppercase hover:bg-emerald-500 transition-all"
        >
          Claim Free Print
        </button>
      ) : (
        <>
          <input
            type="email"
            placeholder="Your email address *"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={loading}
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-white/30"
            autoFocus
          />
          <p className="text-[10px] text-white/30">We'll send you a confirmation with a link to add your shipping address.</p>
          <button
            onClick={handleClaim}
            disabled={loading || !email}
            className="w-full py-3 rounded-lg bg-emerald-600 text-white font-medium text-sm tracking-wider uppercase hover:bg-emerald-500 disabled:opacity-50 transition-all"
          >
            {loading ? status || 'Processing...' : 'Confirm & Create Poster'}
          </button>
          {!loading && (
            <button
              onClick={() => setShowEmail(false)}
              className="w-full py-1 text-xs text-white/30 hover:text-white/50"
            >
              Cancel
            </button>
          )}
        </>
      )}

      {error && (
        <div className="text-red-400 text-xs text-center">{error}</div>
      )}
    </div>
  );
}
