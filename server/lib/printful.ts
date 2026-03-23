/**
 * Printful API client for creating poster print orders.
 *
 * API docs: https://developers.printful.com/docs
 * Auth: Bearer token (API key from Printful dashboard)
 */

const PRINTFUL_API = 'https://api.printful.com';

function headers(): Record<string, string> {
  const key = process.env.PRINTFUL_API_KEY;
  if (!key) throw new Error('PRINTFUL_API_KEY not configured');
  return {
    'Authorization': `Bearer ${key}`,
    'Content-Type': 'application/json',
  };
}

// Printful product IDs for posters (Enhanced Matte Paper Poster)
// These map to our tier IDs
const PRINTFUL_VARIANTS: Record<string, number> = {
  // Enhanced Matte Paper Poster — various sizes
  // These are placeholder variant IDs — need to be looked up from Printful catalog
  'a4-poster': 10163,   // ~8.3x11.7" (closest to A4)
  'a3-poster': 10164,   // ~11.7x16.5" (closest to A3)
  'a3-framed': 15068,   // Framed poster ~12x18"
  'a2-framed': 15069,   // Framed poster ~18x24"
};

export interface ShippingAddress {
  name: string;
  address1: string;
  address2?: string;
  city: string;
  stateCode?: string;
  countryCode: string;
  zip: string;
}

export interface PrintfulOrderResult {
  id: number;
  externalId: string;
  status: string;
  shippingService: string;
  estimatedDelivery?: string;
}

/**
 * Create a print order on Printful.
 */
export async function createPrintOrder(params: {
  externalId: string;
  tierId: string;
  imageUrl: string;
  shipping: ShippingAddress;
}): Promise<PrintfulOrderResult> {
  const variantId = PRINTFUL_VARIANTS[params.tierId];
  if (!variantId) throw new Error(`No Printful variant for tier: ${params.tierId}`);

  const body = {
    external_id: params.externalId,
    recipient: {
      name: params.shipping.name,
      address1: params.shipping.address1,
      address2: params.shipping.address2 || '',
      city: params.shipping.city,
      state_code: params.shipping.stateCode || '',
      country_code: params.shipping.countryCode,
      zip: params.shipping.zip,
    },
    items: [
      {
        variant_id: variantId,
        quantity: 1,
        files: [
          {
            type: 'default',
            url: params.imageUrl,
          },
        ],
      },
    ],
  };

  const res = await fetch(`${PRINTFUL_API}/orders`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Printful order failed (${res.status}): ${err}`);
  }

  const data = await res.json();
  const order = data.result;

  return {
    id: order.id,
    externalId: order.external_id,
    status: order.status,
    shippingService: order.shipping_service_name || 'Standard',
  };
}

/**
 * Get order status from Printful.
 */
export async function getOrderStatus(orderId: number): Promise<{ status: string; tracking?: string }> {
  const res = await fetch(`${PRINTFUL_API}/orders/${orderId}`, {
    headers: headers(),
  });

  if (!res.ok) throw new Error(`Printful status check failed: ${res.status}`);

  const data = await res.json();
  const order = data.result;

  return {
    status: order.status,
    tracking: order.shipments?.[0]?.tracking_number,
  };
}

/**
 * Get shipping rates for an order (for displaying estimated cost).
 */
export async function getShippingRates(params: {
  tierId: string;
  countryCode: string;
  stateCode?: string;
  zip?: string;
}): Promise<{ standard: number; express?: number }> {
  const variantId = PRINTFUL_VARIANTS[params.tierId];
  if (!variantId) return { standard: 0 };

  const body = {
    recipient: {
      country_code: params.countryCode,
      state_code: params.stateCode || '',
      zip: params.zip || '',
    },
    items: [{ variant_id: variantId, quantity: 1 }],
  };

  const res = await fetch(`${PRINTFUL_API}/shipping/rates`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
  });

  if (!res.ok) return { standard: 500 }; // Fallback $5

  const data = await res.json();
  const rates = data.result || [];

  const standard = rates.find((r: any) => r.id === 'STANDARD');
  const express = rates.find((r: any) => r.id === 'EXPRESS');

  return {
    standard: standard ? Math.round(parseFloat(standard.rate) * 100) : 500,
    express: express ? Math.round(parseFloat(express.rate) * 100) : undefined,
  };
}
