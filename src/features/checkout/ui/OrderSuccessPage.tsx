import { useState, useEffect } from 'react';
import { getOrderDetails, type OrderInfo } from '../services/checkoutApi';
import { ShippingForm } from './ShippingForm';

interface OrderSuccessPageProps {
  orderId: string;
}

export function OrderSuccessPage({ orderId }: OrderSuccessPageProps) {
  const [order, setOrder] = useState<OrderInfo | null>(null);
  const [error, setError] = useState('');
  const [step, setStep] = useState<'loading' | 'shipping' | 'done'>('loading');
  const [renderReady, setRenderReady] = useState(false);

  // Poll for payment confirmation, then show shipping form
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      for (let i = 0; i < 20; i++) {
        try {
          const data = await getOrderDetails(orderId);
          if (cancelled) return;
          setOrder(data);
          if (data.pngUrl) setRenderReady(true);

          if (data.type === 'gift') {
            setStep(data.status === 'fulfilling' || data.status === 'pending-fulfillment' ? 'done' : 'shipping');
            return;
          }

          const paidStatuses = ['paid', 'rendered', 'fulfilling', 'pending-fulfillment'];
          if (paidStatuses.includes(data.status)) {
            setStep(data.status === 'fulfilling' || data.status === 'pending-fulfillment' ? 'done' : 'shipping');
            return;
          }
        } catch {
          if (cancelled) return;
        }
        await new Promise((r) => setTimeout(r, 2000));
      }
      if (!cancelled) setStep('shipping');
    };
    poll();
    return () => { cancelled = true; };
  }, [orderId]);

  // Once on the shipping step, keep polling for the render to finish (png_url)
  useEffect(() => {
    if (step !== 'shipping' || renderReady) return;
    let cancelled = false;
    const poll = async () => {
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 5000));
        if (cancelled) return;
        try {
          const data = await getOrderDetails(orderId);
          if (cancelled) return;
          setOrder(data);
          if (data.pngUrl) {
            setRenderReady(true);
            return;
          }
        } catch { /* ignore */ }
      }
    };
    poll();
    return () => { cancelled = true; };
  }, [orderId, step, renderReady]);

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        {step === 'loading' && (
          <div className="text-center">
            <div className="w-8 h-8 border-2 border-white/20 border-t-white rounded-full animate-spin mx-auto mb-4" />
            <h2
              className="text-xl tracking-[0.15em] uppercase mb-2"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              Confirming Order
            </h2>
            <p className="text-white/40 text-sm">Verifying your order...</p>
          </div>
        )}

        {step === 'shipping' && (
          <div>
            <div className="text-center mb-8">
              <div className="text-3xl mb-3">&#10003;</div>
              <h2
                className="text-xl tracking-[0.15em] uppercase mb-2"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                {order?.type === 'gift' ? 'Poster Ready' : 'Payment Confirmed'}
              </h2>
              <p className="text-white/40 text-sm">
                {order?.type === 'gift'
                  ? 'Your free poster is ready — now tell us where to ship it.'
                  : `Order ${orderId} — now tell us where to ship it.`}
              </p>
            </div>
            {renderReady && order?.pngUrl ? (
              <div className="mb-6 rounded-lg overflow-hidden border border-white/10">
                <img src={order.pngUrl} alt="Your poster" className="w-full" />
              </div>
            ) : order?.type !== 'gift' && (
              <div className="mb-6 p-4 rounded-lg border border-white/10 bg-white/5 text-center">
                <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin mx-auto mb-2" />
                <p className="text-white/50 text-xs">Preparing your print-quality poster (300 DPI)...</p>
                <p className="text-white/30 text-[10px] mt-1">You can add your shipping address while we render it.</p>
              </div>
            )}
            <ShippingForm
              orderId={orderId}
              onComplete={() => setStep('done')}
            />
          </div>
        )}

        {step === 'done' && (
          <div className="text-center">
            <div className="text-4xl mb-4">&#127881;</div>
            <h2
              className="text-2xl tracking-[0.15em] uppercase mb-3"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              Order Submitted
            </h2>
            <p className="text-white/40 text-sm mb-2 leading-relaxed">
              Your poster is being printed and will ship soon.
              You'll receive tracking information by email.
            </p>
            <p className="text-white/20 text-xs mb-6">
              Order ID: {orderId}
            </p>
            <a
              href="/"
              className="inline-block px-6 py-3 rounded-lg bg-white text-black font-medium text-sm tracking-wider uppercase"
            >
              Back to RunInk
            </a>
          </div>
        )}

        {error && (
          <div className="mt-4 text-red-400 text-sm text-center">{error}</div>
        )}
      </div>
    </div>
  );
}
