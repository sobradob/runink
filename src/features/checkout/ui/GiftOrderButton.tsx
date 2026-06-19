import { useRef, useState } from 'react';
import { createGiftOrder, clearGiftContext } from '../services/checkoutApi';
import { GIFT_TIERS_CLIENT } from './tiers';
import { reportError } from '@/shared/diagnostics/errorReporter';

interface GiftOrderButtonProps {
  giftCode: string;
  tierId: string;
  posterConfig: any;
}

export function GiftOrderButton({ giftCode, tierId, posterConfig }: GiftOrderButtonProps) {
  const [showEmail, setShowEmail] = useState(false);
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const outstandingOrderIdRef = useRef<string | null>(null);

  const tier = GIFT_TIERS_CLIENT.find((t) => t.id === tierId);

  // BOA-125 Phase 1: create order, skip render, redirect to success page.
  // Server renders async when the order is submitted for shipping.
  const handleClaim = async () => {
    if (!email) {
      setErrMsg('Please enter your email address');
      return;
    }

    setLoading(true);
    setErrMsg(null);
    try {
      let orderId = outstandingOrderIdRef.current;
      if (!orderId) {
        const created = await createGiftOrder({ giftCode, tierId, email, posterConfig });
        orderId = created.orderId;
        outstandingOrderIdRef.current = orderId;
      }

      clearGiftContext();
      window.location.href = `/order/${orderId}/success`;
    } catch (e: unknown) {
      console.error('Gift order failed:', e);
      setErrMsg((e as Error)?.message || 'Failed to create order');
      reportError(e, { source: 'order', extra: { flow: 'gift' } });
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
          <p className="text-[10px] text-white/30">Your poster will be printed in high definition (300 DPI).</p>
          <button
            onClick={handleClaim}
            disabled={loading || !email}
            className="w-full py-3 rounded-lg bg-emerald-600 text-white font-medium text-sm tracking-wider uppercase hover:bg-emerald-500 disabled:opacity-50 transition-all"
          >
            {loading ? 'Redirecting...' : 'Confirm & Create Poster'}
          </button>
          {!loading && (
            <button
              onClick={() => {
                outstandingOrderIdRef.current = null;
                setErrMsg(null);
                setShowEmail(false);
              }}
              className="w-full py-1 text-xs text-white/30 hover:text-white/50"
            >
              Cancel
            </button>
          )}
        </>
      )}

      {errMsg && (
        <div
          role="alert"
          className="text-[11px] text-red-300/80 bg-red-900/15 border border-red-500/20 rounded-md px-3 py-2 leading-snug"
        >
          <div className="font-medium text-red-300">Something went wrong.</div>
          <div className="text-red-200/60 mt-0.5">{errMsg}</div>
        </div>
      )}
    </div>
  );
}
