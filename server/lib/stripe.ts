import Stripe from 'stripe';

// Lazy-init Stripe so the server can start without a key configured
let _stripe: Stripe | null = null;
function getStripe(): Stripe {
  if (!_stripe) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error('STRIPE_SECRET_KEY not configured. Set it in .env to enable payments.');
    _stripe = new Stripe(key);
  }
  return _stripe;
}

export interface GiftTier {
  id: string;
  name: string;
  description: string;
  sizeMm: { width: number; height: number };
  framed: boolean;
  priceId: string; // Stripe Price ID
  priceCents: number; // Display price in cents
}

// Tiers are configured here and prices are created in Stripe dashboard
export const GIFT_TIERS: GiftTier[] = [
  {
    id: 'a4-poster',
    name: 'A4 Poster',
    description: '21×30cm matte poster print',
    sizeMm: { width: 210, height: 297 },
    framed: false,
    priceId: process.env.STRIPE_PRICE_A4 || '',
    priceCents: 2500,
  },
  {
    id: 'a3-poster',
    name: 'A3 Poster',
    description: '30×42cm matte poster print',
    sizeMm: { width: 297, height: 420 },
    framed: false,
    priceId: process.env.STRIPE_PRICE_A3 || '',
    priceCents: 3500,
  },
  {
    id: 'a3-framed',
    name: 'A3 Framed',
    description: '30×42cm poster in black frame',
    sizeMm: { width: 297, height: 420 },
    framed: true,
    priceId: process.env.STRIPE_PRICE_A3_FRAMED || '',
    priceCents: 5500,
  },
  {
    id: 'a2-framed',
    name: 'A2 Framed',
    description: '42×59cm poster in black frame',
    sizeMm: { width: 420, height: 594 },
    framed: true,
    priceId: process.env.STRIPE_PRICE_A2_FRAMED || '',
    priceCents: 7500,
  },
];

export function getTier(tierId: string): GiftTier | undefined {
  return GIFT_TIERS.find((t) => t.id === tierId);
}

/**
 * Create a Stripe Checkout Session for a gift code purchase.
 */
export async function createGiftCheckoutSession(params: {
  tierId: string;
  purchaserEmail?: string;
  recipientName?: string;
  successUrl: string;
  cancelUrl: string;
}): Promise<{ sessionId: string; url: string }> {
  const tier = getTier(params.tierId);
  if (!tier) throw new Error(`Unknown tier: ${params.tierId}`);

  // If no Stripe price ID configured, create a one-time price
  const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = tier.priceId
    ? [{ price: tier.priceId, quantity: 1 }]
    : [{
        price_data: {
          currency: 'usd',
          unit_amount: tier.priceCents,
          product_data: {
            name: `RunInk Gift — ${tier.name}`,
            description: tier.description,
          },
        },
        quantity: 1,
      }];

  const session = await getStripe().checkout.sessions.create({
    mode: 'payment',
    line_items: lineItems,
    customer_email: params.purchaserEmail,
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
    metadata: {
      type: 'gift',
      tier_id: params.tierId,
      recipient_name: params.recipientName || '',
    },
  });

  return { sessionId: session.id, url: session.url! };
}

/**
 * Create a Stripe Checkout Session for a direct print order.
 */
export async function createOrderCheckoutSession(params: {
  tierId: string;
  orderId: string;
  successUrl: string;
  cancelUrl: string;
}): Promise<{ sessionId: string; url: string }> {
  const tier = getTier(params.tierId);
  if (!tier) throw new Error(`Unknown tier: ${params.tierId}`);

  const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = tier.priceId
    ? [{ price: tier.priceId, quantity: 1 }]
    : [{
        price_data: {
          currency: 'usd',
          unit_amount: tier.priceCents,
          product_data: {
            name: `RunInk Print — ${tier.name}`,
            description: tier.description,
          },
        },
        quantity: 1,
      }];

  const session = await getStripe().checkout.sessions.create({
    mode: 'payment',
    line_items: lineItems,
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
    metadata: {
      type: 'order',
      tier_id: params.tierId,
      order_id: params.orderId,
    },
  });

  return { sessionId: session.id, url: session.url! };
}

/**
 * Verify and parse a Stripe webhook event.
 */
export function constructWebhookEvent(payload: string | Buffer, signature: string): Stripe.Event {
  const secret = process.env.STRIPE_WEBHOOK_SECRET || '';
  return getStripe().webhooks.constructEvent(payload, signature, secret);
}

export { getStripe };
