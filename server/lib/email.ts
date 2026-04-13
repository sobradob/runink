/**
 * Email sending via Resend.
 * Requires RESEND_API_KEY env var.
 * Set EMAIL_FROM to customize sender (default: onboarding@resend.dev for testing).
 */

import { Resend } from 'resend';

let resend: Resend | null = null;

function getClient(): Resend | null {
  if (!process.env.RESEND_API_KEY) return null;
  if (!resend) resend = new Resend(process.env.RESEND_API_KEY);
  return resend;
}

const FROM = () => process.env.EMAIL_FROM || 'RunInk <onboarding@resend.dev>';
const NOTIFY = () => process.env.NOTIFY_EMAIL || '';

export async function sendOrderConfirmation(params: {
  to: string;
  orderId: string;
  tierName: string;
  amount: string;
}): Promise<boolean> {
  const client = getClient();
  if (!client) {
    console.log(`[email] Would send order confirmation to ${params.to} (RESEND_API_KEY not set)`);
    return false;
  }

  try {
    const { data, error } = await client.emails.send({
      from: FROM(),
      to: params.to,
      ...(NOTIFY() && { bcc: NOTIFY() }),
      subject: `Your RunInk order ${params.orderId} is confirmed`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h1 style="color: #1a1a1a;">Order Confirmed</h1>
          <p>Thanks for your order! Here are the details:</p>
          <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
            <tr><td style="padding: 8px 0; color: #666;">Order ID</td><td style="padding: 8px 0; font-weight: bold;">${params.orderId}</td></tr>
            <tr><td style="padding: 8px 0; color: #666;">Product</td><td style="padding: 8px 0;">${params.tierName}</td></tr>
            <tr><td style="padding: 8px 0; color: #666;">Amount</td><td style="padding: 8px 0;">${params.amount}</td></tr>
          </table>
          <p>We'll start printing your poster once you provide your shipping address.</p>
          <p style="margin-top: 30px; color: #999; font-size: 12px;">RunInk — Your runs, beautifully printed.</p>
        </div>
      `,
    });
    if (error) {
      console.error('[email] Order confirmation failed:', error);
      return false;
    }
    console.log(`[email] Order confirmation sent to ${params.to}, id: ${data.id}`);
    return true;
  } catch (err) {
    console.error('[email] Failed to send order confirmation:', err);
    return false;
  }
}

export async function sendGiftCode(params: {
  to: string;
  code: string;
  tierName: string;
  recipientName?: string;
  redeemUrl: string;
}): Promise<boolean> {
  const client = getClient();
  if (!client) {
    console.log(`[email] Would send gift code ${params.code} to ${params.to} (RESEND_API_KEY not set)`);
    return false;
  }

  try {
    const recipientLine = params.recipientName
      ? `for <strong>${params.recipientName}</strong>`
      : '';

    const { data, error } = await client.emails.send({
      from: FROM(),
      to: params.to,
      ...(NOTIFY() && { bcc: NOTIFY() }),
      subject: 'Your RunInk Gift Code',
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h1 style="color: #1a1a1a;">RunInk Gift Code</h1>
          <p>You've purchased a RunInk poster gift ${recipientLine}!</p>
          <div style="background: #f5f5f5; padding: 24px; border-radius: 8px; text-align: center; margin: 24px 0;">
            <div style="font-size: 32px; font-weight: bold; letter-spacing: 4px; color: #1a1a1a;">${params.code}</div>
            <div style="margin-top: 8px; color: #666;">${params.tierName}</div>
          </div>
          <p>Share this code or use the link below to redeem:</p>
          <p><a href="${params.redeemUrl}" style="color: #2563eb;">${params.redeemUrl}</a></p>
          <p style="color: #666; font-size: 14px;">This code is valid for one year from purchase.</p>
          <p style="margin-top: 30px; color: #999; font-size: 12px;">RunInk — Your runs, beautifully printed.</p>
        </div>
      `,
    });
    if (error) {
      console.error('[email] Gift code email failed:', error);
      return false;
    }
    console.log(`[email] Gift code sent to ${params.to}, id: ${data.id}`);
    return true;
  } catch (err) {
    console.error('[email] Failed to send gift code:', err);
    return false;
  }
}

export async function sendShippingConfirmation(params: {
  to: string;
  orderId: string;
  estimatedDelivery: string;
}): Promise<boolean> {
  const client = getClient();
  if (!client) {
    console.log(`[email] Would send shipping confirmation to ${params.to} (RESEND_API_KEY not set)`);
    return false;
  }

  try {
    const { data, error } = await client.emails.send({
      from: FROM(),
      to: params.to,
      ...(NOTIFY() && { bcc: NOTIFY() }),
      subject: `Your RunInk poster is being printed! (${params.orderId})`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h1 style="color: #1a1a1a;">Your Poster is Being Printed</h1>
          <p>Great news! Your poster (${params.orderId}) has been sent to our print partner and is now being produced.</p>
          <p><strong>Estimated delivery:</strong> ${params.estimatedDelivery}</p>
          <p>We'll send you tracking information once your poster ships.</p>
          <p style="margin-top: 30px; color: #999; font-size: 12px;">RunInk — Your runs, beautifully printed.</p>
        </div>
      `,
    });
    if (error) {
      console.error('[email] Shipping confirmation failed:', error);
      return false;
    }
    console.log(`[email] Shipping confirmation sent to ${params.to}, id: ${data.id}`);
    return true;
  } catch (err) {
    console.error('[email] Failed to send shipping confirmation:', err);
    return false;
  }
}

/**
 * Send a purchase notification to the site owner (NOTIFY_EMAIL).
 * This is a separate API call from customer emails so it can't fail alongside them.
 */
export async function sendOwnerPurchaseNotification(params: {
  type: 'gift' | 'order';
  customerEmail: string;
  tierName: string;
  amount?: string;
  giftCode?: string;
}): Promise<boolean> {
  const notifyEmail = NOTIFY();
  if (!notifyEmail) {
    console.log('[email] No NOTIFY_EMAIL configured, skipping owner notification');
    return false;
  }

  const client = getClient();
  if (!client) {
    console.warn('[email] RESEND_API_KEY not set — owner notification skipped');
    return false;
  }

  const lines = [
    `<strong>Type:</strong> ${params.type}`,
    `<strong>Customer:</strong> ${params.customerEmail}`,
    `<strong>Product:</strong> ${params.tierName}`,
  ];
  if (params.amount) lines.push(`<strong>Amount:</strong> ${params.amount}`);
  if (params.giftCode) lines.push(`<strong>Gift Code:</strong> ${params.giftCode}`);
  lines.push(`<strong>Time:</strong> ${new Date().toISOString()}`);

  try {
    const { data, error } = await client.emails.send({
      from: FROM(),
      to: notifyEmail,
      subject: `New RunInk ${params.type === 'gift' ? 'gift' : 'order'} purchase — ${params.tierName}`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px;">
          <h2>New Purchase</h2>
          <p>${lines.join('<br/>')}</p>
        </div>
      `,
    });
    if (error) {
      console.error('[email] Owner notification failed:', error);
      return false;
    }
    console.log(`[email] Owner notification sent, id: ${data.id}`);
    return true;
  } catch (err) {
    console.error('[email] Owner notification error:', err);
    return false;
  }
}
