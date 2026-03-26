import { Router } from 'express';
import { createOrder, getOrder, updateOrder } from '../lib/db.js';
import { createOrderCheckoutSession, getTier } from '../lib/stripe.js';
import { createPrintOrder } from '../lib/gelato.js';
import { getUploadUrl, getPublicUrl, storeLocal, getLocalPath } from '../lib/storage.js';
import express from 'express';
import fs from 'fs';

export const ordersRouter = Router();

/** Create a new order (direct purchase) */
ordersRouter.post('/', async (req, res) => {
  const { tierId, posterConfig } = req.body;

  const tier = getTier(tierId);
  if (!tier) {
    return res.status(400).json({ error: 'Invalid tier' });
  }

  try {
    const order = createOrder({
      type: 'direct',
      tier: tierId,
      posterConfig: posterConfig ? JSON.stringify(posterConfig) : undefined,
    });

    // Create Stripe checkout
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const { sessionId, url } = await createOrderCheckoutSession({
      tierId,
      orderId: order.order_id,
      successUrl: `${baseUrl}/order/${order.order_id}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${baseUrl}/order/${order.order_id}`,
    });

    updateOrder(order.order_id, { stripe_session_id: sessionId } as any);

    res.json({ orderId: order.order_id, checkoutUrl: url });
  } catch (err: any) {
    console.error('Order creation failed:', err);
    res.status(500).json({ error: 'Failed to create order' });
  }
});

/** Create an order from a redeemed gift code (no payment needed) */
ordersRouter.post('/from-gift', (req, res) => {
  const { giftCode, posterConfig } = req.body;

  if (!giftCode) {
    return res.status(400).json({ error: 'Gift code required' });
  }

  try {
    const order = createOrder({
      type: 'gift',
      tier: req.body.tierId || 'a3-poster', // Default tier from gift
      giftCode,
      posterConfig: posterConfig ? JSON.stringify(posterConfig) : undefined,
    });

    res.json({ orderId: order.order_id });
  } catch (err: any) {
    console.error('Gift order creation failed:', err);
    res.status(500).json({ error: 'Failed to create order' });
  }
});

/** Get order status */
ordersRouter.get('/:id', (req, res) => {
  const order = getOrder(req.params.id);
  if (!order) {
    return res.status(404).json({ error: 'Order not found' });
  }

  res.json({
    orderId: order.order_id,
    type: order.type,
    tier: order.tier,
    status: order.status,
    pngUrl: order.png_url,
    gelatoOrderId: order.printful_order_id,
    posterConfig: order.poster_config ? JSON.parse(order.poster_config) : null,
    createdAt: order.created_at,
  });
});

/** Get a pre-signed upload URL for the poster PNG */
ordersRouter.post('/:id/upload-url', async (req, res) => {
  const order = getOrder(req.params.id);
  if (!order) {
    return res.status(404).json({ error: 'Order not found' });
  }

  const key = `posters/${order.order_id}.png`;

  try {
    const { url, method, local } = await getUploadUrl(key);
    res.json({ url, method, key, local });
  } catch (err: any) {
    console.error('Upload URL generation failed:', err);
    res.status(500).json({ error: 'Failed to generate upload URL' });
  }
});

/** Local file upload endpoint (dev fallback when R2 not configured) */
ordersRouter.put('/upload/*key', express.raw({ type: 'image/png', limit: '50mb' }), (req, res) => {
  const key = (req.params as any).key;
  const data = req.body as Buffer;

  if (!data || data.length === 0) {
    return res.status(400).json({ error: 'No file data' });
  }

  const url = storeLocal(key, data);
  res.json({ url });
});

/** Submit shipping address and trigger print fulfillment */
ordersRouter.post('/:id/ship', async (req, res) => {
  const order = getOrder(req.params.id);
  if (!order) {
    return res.status(404).json({ error: 'Order not found' });
  }

  // For direct orders, must be paid; for gift orders, gift code covers it
  if (order.type === 'direct' && order.status !== 'paid') {
    return res.status(400).json({ error: 'Order not yet paid' });
  }

  const { name, address1, address2, city, stateCode, countryCode, zip } = req.body;

  if (!name || !address1 || !city || !countryCode || !zip) {
    return res.status(400).json({ error: 'Missing required shipping fields' });
  }

  // Update shipping address
  updateOrder(order.order_id, {
    shipping_name: name,
    shipping_address_1: address1,
    shipping_address_2: address2,
    shipping_city: city,
    shipping_state: stateCode,
    shipping_country: countryCode,
    shipping_zip: zip,
  });

  // Get the poster PNG URL
  const pngUrl = order.png_url || getPublicUrl(`posters/${order.order_id}.png`);

  // Create Gelato print order
  if (process.env.GELATO_API_KEY) {
    try {
      const gelatoOrder = await createPrintOrder({
        externalId: order.order_id,
        tierId: order.tier,
        imageUrl: pngUrl,
        shipping: { name, address1, address2, city, stateCode, countryCode, zip },
      });

      updateOrder(order.order_id, {
        printful_order_id: gelatoOrder.id,
        status: 'fulfilling',
      });

      res.json({
        orderId: order.order_id,
        status: 'fulfilling',
        gelatoOrderId: gelatoOrder.id,
      });
    } catch (err: any) {
      console.error('Gelato order failed:', err);
      updateOrder(order.order_id, { status: 'fulfillment-error' });
      res.status(500).json({ error: 'Print fulfillment failed. We will process your order manually.' });
    }
  } else {
    // No Gelato configured — mark as pending manual fulfillment
    updateOrder(order.order_id, { status: 'pending-fulfillment' });
    res.json({
      orderId: order.order_id,
      status: 'pending-fulfillment',
      message: 'Order saved. Print fulfillment will be processed shortly.',
    });
  }
});
