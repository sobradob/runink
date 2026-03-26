import { useState, useEffect } from 'react';
import { getOrderDetails, type OrderInfo } from '../services/checkoutApi';

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  pending: { label: 'Awaiting Payment', color: 'text-yellow-400' },
  paid: { label: 'Paid — Awaiting Shipping Info', color: 'text-blue-400' },
  fulfilling: { label: 'Printing & Shipping', color: 'text-green-400' },
  'pending-fulfillment': { label: 'Processing', color: 'text-blue-400' },
  'fulfillment-error': { label: 'Issue — We\'re on it', color: 'text-red-400' },
  'payment-expired': { label: 'Payment Expired', color: 'text-red-400/60' },
};

interface OrderStatusPageProps {
  orderId: string;
}

export function OrderStatusPage({ orderId }: OrderStatusPageProps) {
  const [order, setOrder] = useState<OrderInfo | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    getOrderDetails(orderId)
      .then(setOrder)
      .catch(() => setError('Order not found'));
  }, [orderId]);

  if (error) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <div className="text-center">
          <div className="text-red-400 mb-4">{error}</div>
          <a href="/" className="text-white/40 text-sm hover:text-white/60">Back to RunInk</a>
        </div>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-white/20 border-t-white rounded-full animate-spin" />
      </div>
    );
  }

  const statusInfo = STATUS_LABELS[order.status] || { label: order.status, color: 'text-white/40' };

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center px-4">
      <div className="w-full max-w-md text-center">
        <h2
          className="text-2xl tracking-[0.15em] uppercase mb-6"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Order Status
        </h2>

        <div className="bg-white/5 rounded-xl p-6 space-y-4 text-left">
          <div className="flex justify-between text-sm">
            <span className="text-white/40">Order ID</span>
            <span className="text-white/80 font-mono text-xs">{order.orderId}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-white/40">Product</span>
            <span className="text-white/80">{order.tier}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-white/40">Status</span>
            <span className={`font-medium ${statusInfo.color}`}>{statusInfo.label}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-white/40">Created</span>
            <span className="text-white/60">{new Date(order.createdAt).toLocaleDateString()}</span>
          </div>
          {order.gelatoOrderId && (
            <div className="flex justify-between text-sm">
              <span className="text-white/40">Print Order</span>
              <span className="text-white/60 font-mono text-xs">{order.gelatoOrderId}</span>
            </div>
          )}
        </div>

        <a
          href="/"
          className="inline-block mt-8 px-6 py-3 rounded-lg bg-white/10 border border-white/20 text-white font-medium text-sm tracking-wider uppercase hover:bg-white/15 transition-all"
        >
          Back to RunInk
        </a>
      </div>
    </div>
  );
}
