import { useState } from 'react';
import { createDirectOrder } from '../services/checkoutApi';
import { FRAMED_TIER, getTier, PRINT_DIMENSIONS } from './tiers';
import { COMING_SOON, ComingSoonPopup } from './ComingSoon';
import { reportError } from '@/shared/diagnostics/errorReporter';
import { POSTER_PRESETS, type PosterConfig, type PosterDimensions } from '@/types/poster';

interface OrderButtonProps {
  posterConfig: PosterConfig;
  buildServerPayload: (dims: PosterDimensions) => unknown;
}

export function OrderButton({ posterConfig, buildServerPayload }: OrderButtonProps) {
  const [open, setOpen] = useState(false);
  const [framed, setFramed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showComingSoon, setShowComingSoon] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const DEFAULT_PRINT_TIER = 'a4-poster';
  const dimensions = posterConfig.dimensions;
  const onPrintableSize = dimensions?.category === 'printable' && !!dimensions?.tierId;
  const baseTierId = onPrintableSize ? dimensions.tierId! : DEFAULT_PRINT_TIER;
  const printSizeLabel = onPrintableSize ? dimensions.label : '30x40cm';
  const framedTierId = FRAMED_TIER[baseTierId];
  const canFrame = !!framedTierId;

  const activeTierId = framed && framedTierId ? framedTierId : baseTierId;
  const activeTier = activeTierId ? getTier(activeTierId) : undefined;

  // BOA-125 Phase 1: pay first, render async. No render step before payment —
  // the poster config is stored in the order row and the server renders it
  // after the Stripe webhook confirms payment.
  const handleOrder = async () => {
    if (!activeTierId) return;
    setLoading(true);
    setErrMsg(null);
    try {
      const printDims: PosterDimensions = POSTER_PRESETS.find(p => p.tierId === baseTierId)
        ?? { label: printSizeLabel, ...PRINT_DIMENSIONS[baseTierId], category: 'printable' as const, tierId: baseTierId };
      const serverPayload = buildServerPayload(printDims);
      const created = await createDirectOrder({
        tierId: activeTierId,
        posterConfig: serverPayload,
      });

      window.mixpanel?.track('checkout_redirected', {
        tier_id: activeTierId,
        theme_id: posterConfig?.themeId,
        skip_render: true,
      });
      window.location.href = created.checkoutUrl;
    } catch (e: unknown) {
      console.error('Order failed:', e);
      const msg = (e as Error)?.message || 'Unknown error';
      setErrMsg(msg);
      reportError(e, { source: 'order' });
      setLoading(false);
    }
  };

  if (!open) {
    return (
      <>
        <button
          onClick={() => {
            window.mixpanel?.track('order_started', {
              tier_id: baseTierId,
              theme_id: posterConfig?.themeId,
            });
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
        {printSizeLabel} matte poster
      </div>
      {!onPrintableSize && (
        <p className="text-[10px] text-white/30 -mt-0.5 mb-1">
          Printed at {printSizeLabel} — your layout is reframed to print proportions.
        </p>
      )}

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

      {!onPrintableSize && (
        <p className="text-[10px] text-white/30 -mt-0.5 mb-1">
          Your poster will be printed in high definition (300 DPI).
        </p>
      )}

      <button
        onClick={handleOrder}
        disabled={loading}
        className="w-full py-3 rounded-lg bg-white text-black font-medium text-sm tracking-wider uppercase hover:bg-white/90 disabled:opacity-50 transition-all"
      >
        {loading ? 'Redirecting to payment...' : 'Proceed to Payment'}
      </button>

      {errMsg && (
        <div
          role="alert"
          className="text-[11px] text-red-300/80 bg-red-900/15 border border-red-500/20 rounded-md px-3 py-2 leading-snug"
        >
          <div className="font-medium text-red-300">Something went wrong.</div>
          <div className="text-red-200/60 mt-0.5">{errMsg}</div>
        </div>
      )}

      <button
        onClick={() => {
          setErrMsg(null);
          setOpen(false);
          setFramed(false);
        }}
        disabled={loading}
        className="w-full py-1 text-xs text-white/30 hover:text-white/50 disabled:opacity-30"
      >
        Cancel
      </button>
    </div>
  );
}
