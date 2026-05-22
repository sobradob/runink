import { useEffect, useRef, useState } from 'react';
import { createDirectOrder, getUploadUrl, uploadPosterPng, RenderError } from '../services/checkoutApi';
import { FRAMED_TIER, getTier, PRINT_DIMENSIONS } from './tiers';
import { COMING_SOON, ComingSoonPopup } from './ComingSoon';
import { RenderProgress } from '@/shared/ui/RenderProgress';
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

  // Error surface: a retryable error keeps the order around (orderId stays in
  // outstandingOrderIdRef) so a retry only re-runs the render+upload step
  // instead of double-creating the order. Non-retryable errors clear the
  // outstanding order — the user will start over from scratch.
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [errRequestId, setErrRequestId] = useState<string | null>(null);
  const [errRetryable, setErrRetryable] = useState(false);
  const outstandingOrderIdRef = useRef<string | null>(null);
  const outstandingCheckoutUrlRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Cancel any in-flight render request if the component unmounts (user
  // navigates away mid-submit). The server keeps rendering but the client
  // stops caring — the order's png_url will still be set when it finishes.
  useEffect(() => () => abortRef.current?.abort(), []);

  const dimensions: PosterDimensions | undefined = posterConfig?.dimensions;
  const baseTierId = dimensions?.tierId;
  const isPrintable = dimensions?.category === 'printable' && !!baseTierId;
  const framedTierId = baseTierId ? FRAMED_TIER[baseTierId] : undefined;
  const canFrame = !!framedTierId;

  const activeTierId = framed && framedTierId ? framedTierId : baseTierId;
  const activeTier = activeTierId ? getTier(activeTierId) : undefined;

  const clearError = () => {
    setErrMsg(null);
    setErrRequestId(null);
    setErrRetryable(false);
  };

  const handleOrder = async () => {
    if (!activeTierId) return;
    setLoading(true);
    clearError();
    abortRef.current = new AbortController();
    try {
      // Skip createDirectOrder when retrying a render that already produced
      // an orderId — re-creating would charge the customer's Stripe context
      // (idempotent on backend but produces duplicate rows here).
      let orderId = outstandingOrderIdRef.current;
      let checkoutUrl = outstandingCheckoutUrlRef.current;
      if (!orderId || !checkoutUrl) {
        setStatus('Creating order...');
        const created = await createDirectOrder({
          tierId: activeTierId,
          posterConfig,
        });
        orderId = created.orderId;
        checkoutUrl = created.checkoutUrl;
        outstandingOrderIdRef.current = orderId;
        outstandingCheckoutUrlRef.current = checkoutUrl;
        onOrderCreated?.(orderId);
      }

      const printDims = PRINT_DIMENSIONS[activeTierId];
      const fullPrintDims: PosterDimensions | undefined = printDims
        ? { ...printDims, label: activeTierId, category: 'printable', tierId: activeTierId }
        : undefined;

      if (submitPoster) {
        // New path: PosterEditor owns render+upload (local or server-side).
        // Server-side renders typically take 2-7s; the client shows a
        // "Rendering poster…" state for the whole window.
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

      // Render+upload succeeded — clear the in-flight order so back-button
      // doesn't accidentally re-enter the retry path.
      outstandingOrderIdRef.current = null;
      outstandingCheckoutUrlRef.current = null;

      setStatus('Redirecting to payment...');
      window.location.href = checkoutUrl;
    } catch (e: unknown) {
      console.error('Order failed:', e);
      if (e instanceof RenderError) {
        // Render error from the server path. Already through 3 attempts —
        // if `retryable` is still true, the queue was busy the whole time
        // and a manual retry might catch a window.
        setErrMsg(e.message || 'Server render failed');
        setErrRequestId(e.requestId ?? null);
        setErrRetryable(e.retryable);
      } else {
        const msg = (e as Error)?.message || 'Unknown error';
        setErrMsg(msg);
        setErrRequestId(null);
        // Order-creation errors and legacy client-render errors get a
        // manual retry button — failing now means we haven't taken payment.
        setErrRetryable(true);
      }
      setStatus('');
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
        {loading
          ? status || 'Processing...'
          : errMsg && errRetryable
            ? 'Retry'
            : 'Proceed to Payment'}
      </button>

      <RenderProgress active={loading && status === 'Rendering poster...'} />

      {errMsg && (
        <div
          role="alert"
          className="text-[11px] text-red-300/80 bg-red-900/15 border border-red-500/20 rounded-md px-3 py-2 leading-snug"
        >
          <div className="font-medium text-red-300">
            {errRetryable ? 'Hit a snag — tap retry above.' : 'Order failed.'}
          </div>
          <div className="text-red-200/60 mt-0.5">{errMsg}</div>
          {errRequestId && (
            <div className="text-red-200/40 mt-1 font-mono text-[10px] tracking-tight">
              Ref: {errRequestId}
            </div>
          )}
        </div>
      )}

      <button
        onClick={() => {
          abortRef.current?.abort();
          // If we never reached render successfully, drop the outstanding
          // order — it'll be garbage-collected on the server when the
          // Stripe session expires.
          outstandingOrderIdRef.current = null;
          outstandingCheckoutUrlRef.current = null;
          clearError();
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
