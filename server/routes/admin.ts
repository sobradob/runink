import { Router } from 'express';
import { createGiftCode, createGiftCodeWithCode, getGiftCode, getOrder } from '../lib/db.js';
import { getTier } from '../lib/stripe.js';
import { sendGiftCode } from '../lib/email.js';
import { sql } from '../lib/db.js';

export const adminRouter = Router();

/**
 * Simple bearer-token auth for admin endpoints.
 * Set ADMIN_SECRET env var in production.
 */
adminRouter.use((req, res, next) => {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) {
    return res.status(503).json({ error: 'Admin endpoints not configured (ADMIN_SECRET not set)' });
  }

  const auth = req.headers.authorization;
  if (!auth || auth !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  next();
});

/** List all gift codes */
adminRouter.get('/gift-codes', async (_req, res) => {
  const codes = await sql`SELECT * FROM gift_codes ORDER BY created_at DESC LIMIT 50`;
  res.json({ codes });
});

/** Create a gift code manually (for customer rescue) */
adminRouter.post('/gift-codes', async (req, res) => {
  const { tier, purchaserEmail, recipientName, code } = req.body;

  if (!tier) {
    return res.status(400).json({ error: 'tier is required (e.g., a3-framed)' });
  }

  const tierInfo = getTier(tier);
  if (!tierInfo) {
    return res.status(400).json({ error: `Unknown tier: ${tier}` });
  }

  // If a specific code is requested (re-creating a lost code), check it doesn't exist
  if (code) {
    const existing = await getGiftCode(code);
    if (existing) {
      return res.status(409).json({ error: 'Gift code already exists', gift: existing });
    }

    const gift = await createGiftCodeWithCode({
      code,
      tier,
      purchaserEmail,
      recipientName,
    });
    return res.json({ gift, message: `Gift code ${code} created` });
  }

  // Otherwise create with auto-generated code
  const gift = await createGiftCode({
    tier,
    purchaserEmail,
    recipientName,
  });

  res.json({ gift, message: `Gift code ${gift.code} created` });
});

/** Resend a gift code email */
adminRouter.post('/gift-codes/:code/resend', async (req, res) => {
  const code = req.params.code.toUpperCase();
  const gift = await getGiftCode(code);

  if (!gift) {
    return res.status(404).json({ error: 'Gift code not found' });
  }

  const email = req.body.email || gift.purchaser_email;
  if (!email) {
    return res.status(400).json({ error: 'No email address — provide email in body or gift must have purchaser_email' });
  }

  const tier = getTier(gift.tier);
  const baseUrl = req.body.baseUrl || `${req.protocol}://${req.get('host')}`;

  const sent = await sendGiftCode({
    to: email,
    code: gift.code,
    tierName: tier?.name || gift.tier,
    recipientName: gift.recipient_name || undefined,
    redeemUrl: `${baseUrl}/redeem/${gift.code}`,
  });

  res.json({ sent, email, code: gift.code });
});

/** List all orders */
adminRouter.get('/orders', async (_req, res) => {
  const orders = await sql`SELECT * FROM orders ORDER BY created_at DESC LIMIT 50`;
  res.json({ orders });
});

/** Get a specific order */
adminRouter.get('/orders/:id', async (req, res) => {
  const order = await getOrder(req.params.id);
  if (!order) {
    return res.status(404).json({ error: 'Order not found' });
  }
  res.json({ order });
});
