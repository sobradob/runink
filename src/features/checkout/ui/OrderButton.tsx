import { useState } from 'react';
import { createDirectOrder, getUploadUrl, uploadPosterPng } from '../services/checkoutApi';
import { FRAMED_TIER, getTier, PRINT_DIMENSIONS } from './tiers';
import { COMING_SOON, ComingSoonPopup } from './ComingSoon';
import type { PosterDimensions } from '@/types/poster';

interface OrderButtonProps {
  posterConfig: any;
  /** Legacy client-side render path — renders a blob that OrderButton then
   *  uploads to R2. Still used as the fallback when `submitPoster` is not
   *  provided. */
  renderPoster?: (printDimensions?: PosterDimensions) => Promise<Blob>;
  /** Preferred path (post server-side render migration): a single async
   *  call that takes ownership of rendering AND uploading. Hides the
   *  local-vs-server dispatch from this button. When provided, this
   *  replaces the `renderPoster` → `getUploadUrl` → `uploadPosterPng`
   *  three-step dance. */
  submitPoster?: (orderId: string, printDimensions?: PosterDimensions) => Promise<void>;
  onOrderCreated?: (orderId: string) => void;
}

export function OrderButton({ posterConfig, renderPoster, submitPoster, onOrderCreated }: OrderButtonProps) {
  const [open, setOpen] = useState(false);
  const [framed, setFramed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [showComingSoon, setShowComingSoon] = useState(false);

  const dimensions: PosterDimensions | undefined = posterConfig?.dimensions;
  const baseTierId = dimensions?.tierId;
  const isPrintable = dimensions?.category === 'printable' && !!baseTierId;
  const framedTierId = baseTierId ? FRAMED_TIER[baseTierId] : undefined;
  const canFrame = !!framedTierId;

  const activeTierId = framed && framedTierId ? framedTierId : baseTierId;
  const activeTier = activeTierId ? getTier(activeTierId) : undefined;

  const handleOrder = async () => {
    if (!activeTierId) return;
    setLoading(true);
    try {
      setStatus('Creating order...');
      const { orderId, checkoutUrl } = await createDirectOrder({
        tierId: activeTierId,
        posterConfig,
      });
      onOrderCreated?.(orderId);

      const printDims = PRINT_DIMENSIONS[activeTierId];
      const fullPrintDims: PosterDimensions | undefined = printDims
        ? { ...printDims, label: activeTierId, category: 'printable', tierId: activeTierId }
        : undefined;

      if (submitPoster) {
        // New path: PosterEditor owns render+upload (local or server-side).
        setStatus('Rendering poster...');
        await submitPoster(orderId, fullPrintDims);
      } else if (renderPoster) {
        // Legacy client-side flow — retained as fallback.
        setStatus('Rendering poster...');
        const blob = await renderPoster(fullPrintDims);

        setStatus('Uploading artwork...');
        const { url, method, local } = await getUploadUrl(orderId);
        await uploadPosterPng(url, method, blob, orderId, local);
      }

      setStatus('Redirecting to payment...');
      window.location.href = checkoutUrl;
    } catch (e: any) {
      console.error('Order failed:', e);
      setStatus(`Error: ${e.message || 'Unknown error'}`);
      setLoading(false);
    }
  };

  // Non-printable size — show message
  if (!isPrintable) {
    return (
      <div className="text-center space-y-1.5">
        <button
          disabled
          className="w-full py-3 rounded-lg bg-white/5 border border-white/10 text-white/30 font-medium text-sm tracking-wider uppercase cursor-not-allowed"
        >
          Order Print
        </button>
        <p className="text-[10px] text-white/30">
          This size is digital-only. Switch to a printable size to order a print.
        </p>
      </div>
    );
  }

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
      {/* Size confirmation */}
      <div className="text-xs text-white/40 mb-1">
        {dimensions?.label} matte poster
      </div>

      {/* Framing toggle (if available for this size) */}
      {canFrame && (
        <div className="flex gap-1.5">
          <button
            onClick={() => setFramed(false)}
            className={`flex-1 text-xs py-2.5 md:py-2 rounded-lg border transition-all ${
              !framed
                ? 'border-white/40 bg-white/10 text-white'
                : 'border-white/10 text-white/40 hover:text-white/60'
            }`}
          >
            Unframed
          </button>
          <button
            onClick={() => setFramed(true)}
            className={`flex-1 text-xs py-2.5 md:py-2 rounded-lg border transition-all ${
              framed
                ? 'border-white/40 bg-white/10 text-white'
                : 'border-white/10 text-white/40 hover:text-white/60'
            }`}
          >
            Black frame
          </button>
        </div>
      )}

      {/* Price and proceed */}
      {activeTier && (
        <div className="text-center text-sm text-white/60 py-1">
          ${(activeTier.priceCents / 100).toFixed(0)} — {activeTier.description}
        </div>
      )}

      <button
        onClick={handleOrder}
        disabled={loading}
        className="w-full py-3 rounded-lg bg-white text-black font-medium text-sm tracking-wider uppercase hover:bg-white/90 disabled:opacity-50 transition-all"
      >
        {loading ? status || 'Processing...' : 'Proceed to Payment'}
      </button>
      <button
        onClick={() => { setOpen(false); setFramed(false); }}
        disabled={loading}
        className="w-full py-1 text-xs text-white/30 hover:text-white/50 disabled:opacity-30"
      >
        Cancel
      </button>
    </div>
  );
}
