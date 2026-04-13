import { Router } from 'express';
import { getGiftCode, redeemGiftCode } from '../lib/db.js';
import { createGiftCheckoutSession, GIFT_TIERS, getTier } from '../lib/stripe.js';

export const giftRouter = Router();

/** Get available gift tiers */
giftRouter.get('/tiers', (_req, res) => {
  const tiers = GIFT_TIERS.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    priceCents: t.priceCents,
    framed: t.framed,
  }));
  res.json({ tiers });
});

/** Create a Stripe checkout session for a gift purchase */
giftRouter.post('/purchase', async (req, res) => {
  const { tierId, purchaserEmail, recipientName } = req.body;

  const tier = getTier(tierId);
  if (!tier) {
    return res.status(400).json({ error: 'Invalid tier' });
  }

  try {
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const { sessionId, url } = await createGiftCheckoutSession({
      tierId,
      purchaserEmail,
      recipientName,
      successUrl: `${baseUrl}/gift/success?session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${baseUrl}/gift`,
    });

    res.json({ sessionId, url });
  } catch (err: any) {
    console.error('Gift checkout failed:', err);
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

/** Validate a gift code */
giftRouter.get('/:code', async (req, res) => {
  const code = req.params.code.toUpperCase();
  const gift = await getGiftCode(code);

  if (!gift) {
    return res.status(404).json({ error: 'Gift code not found' });
  }

  if (gift.status === 'redeemed') {
    return res.status(410).json({ error: 'This gift code has already been redeemed' });
  }

  if (gift.status === 'expired') {
    return res.status(410).json({ error: 'This gift code has expired' });
  }

  const tier = getTier(gift.tier);

  res.json({
    code: gift.code,
    tier: gift.tier,
    tierName: tier?.name || gift.tier,
    tierDescription: tier?.description || '',
    recipientName: gift.recipient_name,
    status: gift.status,
    createdAt: gift.created_at,
  });
});

/** Redeem a gift code */
giftRouter.post('/:code/redeem', async (req, res) => {
  const code = req.params.code.toUpperCase();
  const gift = await getGiftCode(code);

  if (!gift) {
    return res.status(404).json({ error: 'Gift code not found' });
  }

  if (gift.status !== 'active') {
    return res.status(410).json({ error: `Gift code is ${gift.status}` });
  }

  const success = await redeemGiftCode(code);
  if (!success) {
    return res.status(500).json({ error: 'Failed to redeem gift code' });
  }

  res.json({ ok: true, tier: gift.tier });
});
