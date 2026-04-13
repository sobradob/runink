import { Router } from 'express';
import express from 'express';
import { constructWebhookEvent, getTier } from '../lib/stripe.js';
import { createGiftCode, getGiftCode } from '../lib/db.js';
import { updateOrder, getOrder } from '../lib/db.js';
import { sendOrderConfirmation, sendGiftCode, sendOwnerPurchaseNotification } from '../lib/email.js';

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
        const customerEmail = session.customer_email || session.customer_details?.email;
        const amount = `$${((session.amount_total || 0) / 100).toFixed(2)}`;

        if (metadata.type === 'gift') {
          try {
            // Gift code purchase completed — generate the code
            const gift = createGiftCode({
              tier: metadata.tier_id,
              purchaserEmail: customerEmail,
              recipientName: metadata.recipient_name,
              stripeSessionId: session.id,
              stripePaymentIntent: session.payment_intent,
            });

            console.log(`Gift code created: ${gift.code} (tier: ${gift.tier})`);

            const tier = getTier(gift.tier);
            const tierName = tier?.name || gift.tier;

            // Send gift code email to purchaser
            if (customerEmail) {
              const baseUrl = `${req.protocol}://${req.get('host')}`;
              sendGiftCode({
                to: customerEmail,
                code: gift.code,
                tierName,
                recipientName: metadata.recipient_name,
                redeemUrl: `${baseUrl}/redeem/${gift.code}`,
              }).catch(err => console.error('[webhook] Gift code email error:', err));
            }

            // Separate owner notification (won't fail with customer email)
            sendOwnerPurchaseNotification({
              type: 'gift',
              customerEmail: customerEmail || 'unknown',
              tierName,
              amount,
              giftCode: gift.code,
            }).catch(err => console.error('[webhook] Owner notification error:', err));
          } catch (err) {
            console.error('[webhook] Gift code creation failed:', err);
          }
        }

        if (metadata.type === 'order') {
          try {
            // Direct order payment completed
            updateOrder(metadata.order_id, {
              status: 'paid',
              stripe_payment_intent: session.payment_intent,
            });

            console.log(`Order paid: ${metadata.order_id}`);

            const order = getOrder(metadata.order_id);
            const tier = order ? getTier(order.tier) : null;
            const tierName = tier?.name || order?.tier || 'Poster';

            // Send order confirmation email
            if (customerEmail) {
              sendOrderConfirmation({
                to: customerEmail,
                orderId: metadata.order_id,
                tierName,
                amount,
              }).catch(err => console.error('[webhook] Order confirmation email error:', err));
            }

            // Separate owner notification
            sendOwnerPurchaseNotification({
              type: 'order',
              customerEmail: customerEmail || 'unknown',
              tierName,
              amount,
            }).catch(err => console.error('[webhook] Owner notification error:', err));
          } catch (err) {
            console.error('[webhook] Order update failed:', err);
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
