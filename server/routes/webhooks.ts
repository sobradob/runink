import { Router } from 'express';
import express from 'express';
import { constructWebhookEvent, getTier } from '../lib/stripe.js';
import { createGiftCode, getGiftCode } from '../lib/db.js';
import { updateOrder, getOrder } from '../lib/db.js';
import { sendOrderConfirmation, sendGiftCode } from '../lib/email.js';

export const webhooksRouter = Router();

/**
 * Stripe webhook handler.
 * IMPORTANT: Must use raw body parser for signature verification.
 */
webhooksRouter.post(
  '/stripe',
  express.raw({ type: 'application/json' }),
  (req, res) => {
    const signature = req.headers['stripe-signature'] as string;

    if (!signature) {
      return res.status(400).json({ error: 'Missing stripe-signature header' });
    }

    let event;
    try {
      event = constructWebhookEvent(req.body, signature);
    } catch (err: any) {
      console.error('Webhook signature verification failed:', err.message);
      return res.status(400).json({ error: 'Invalid signature' });
    }

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as any;
        const metadata = session.metadata || {};

        if (metadata.type === 'gift') {
          // Gift code purchase completed — generate the code
          const gift = createGiftCode({
            tier: metadata.tier_id,
            purchaserEmail: session.customer_email || session.customer_details?.email,
            recipientName: metadata.recipient_name,
            stripeSessionId: session.id,
            stripePaymentIntent: session.payment_intent,
          });

          console.log(`Gift code created: ${gift.code} (tier: ${gift.tier})`);

          // Send gift code email to purchaser
          const purchaserEmail = session.customer_email || session.customer_details?.email;
          if (purchaserEmail) {
            const tier = getTier(gift.tier);
            const baseUrl = `${req.protocol}://${req.get('host')}`;
            sendGiftCode({
              to: purchaserEmail,
              code: gift.code,
              tierName: tier?.name || gift.tier,
              recipientName: metadata.recipient_name,
              redeemUrl: `${baseUrl}/redeem/${gift.code}`,
            }).catch(() => {}); // fire-and-forget
          }
        }

        if (metadata.type === 'order') {
          // Direct order payment completed
          updateOrder(metadata.order_id, {
            status: 'paid',
            stripe_payment_intent: session.payment_intent,
          });

          console.log(`Order paid: ${metadata.order_id}`);

          // Send order confirmation email
          const customerEmail = session.customer_email || session.customer_details?.email;
          if (customerEmail) {
            const order = getOrder(metadata.order_id);
            const tier = order ? getTier(order.tier) : null;
            sendOrderConfirmation({
              to: customerEmail,
              orderId: metadata.order_id,
              tierName: tier?.name || order?.tier || 'Poster',
              amount: `$${((session.amount_total || 0) / 100).toFixed(2)}`,
            }).catch(() => {}); // fire-and-forget
          }
        }

        break;
      }

      case 'checkout.session.expired': {
        const session = event.data.object as any;
        const metadata = session.metadata || {};

        if (metadata.type === 'order' && metadata.order_id) {
          updateOrder(metadata.order_id, { status: 'payment-expired' });
        }
        break;
      }

      default:
        // Unhandled event type
        break;
    }

    res.json({ received: true });
  }
);
