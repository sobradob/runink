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

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      // Poll for order status to become 'paid' (webhook may take a moment)
      for (let i = 0; i < 20; i++) {
        try {
          const data = await getOrderDetails(orderId);
          if (cancelled) return;
          setOrder(data);
          if (data.status === 'paid' || data.status === 'fulfilling' || data.status === 'pending-fulfillment') {
            setStep(data.status === 'fulfilling' || data.status === 'pending-fulfillment' ? 'done' : 'shipping');
            return;
          }
        } catch {
          if (cancelled) return;
        }
        await new Promise((r) => setTimeout(r, 2000));
      }
      if (!cancelled) {
        // After polling, show shipping form anyway — webhook might be slow
        setStep('shipping');
      }
    };
    poll();
    return () => { cancelled = true; };
  }, [orderId]);

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
              Confirming Payment
            </h2>
            <p className="text-white/40 text-sm">Verifying your payment with Stripe...</p>
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
                Payment Confirmed
              </h2>
              <p className="text-white/40 text-sm">
                Order {orderId} — now tell us where to ship it.
              </p>
            </div>
            {order?.pngUrl && (
              <div className="mb-6 rounded-lg overflow-hidden border border-white/10">
                <img src={order.pngUrl} alt="Your poster" className="w-full" />
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
