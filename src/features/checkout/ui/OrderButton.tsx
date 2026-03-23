import { useState } from 'react';
import { createDirectOrder, type GiftTierInfo } from '../services/checkoutApi';
import { GIFT_TIERS_CLIENT } from './tiers';

interface OrderButtonProps {
  posterConfig: any;
  onOrderCreated?: (orderId: string) => void;
}

export function OrderButton({ posterConfig, onOrderCreated }: OrderButtonProps) {
  const [open, setOpen] = useState(false);
  const [selectedTier, setSelectedTier] = useState('a3-poster');
  const [loading, setLoading] = useState(false);

  const handleOrder = async () => {
    setLoading(true);
    try {
      const { orderId, checkoutUrl } = await createDirectOrder({
        tierId: selectedTier,
        posterConfig,
      });
      onOrderCreated?.(orderId);
      window.location.href = checkoutUrl;
    } catch (e) {
      console.error('Order failed:', e);
      setLoading(false);
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full py-3 rounded-lg bg-white/10 border border-white/20 text-white font-medium text-sm tracking-wider uppercase hover:bg-white/15 transition-all"
      >
        Order Print
      </button>
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
        {loading ? 'Creating order...' : 'Proceed to Payment'}
      </button>
      <button
        onClick={() => setOpen(false)}
        className="w-full py-1 text-xs text-white/30 hover:text-white/50"
      >
        Cancel
      </button>
    </div>
  );
}
