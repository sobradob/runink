export interface GiftTierInfo {
  id: string;
  name: string;
  description: string;
  priceCents: number;
  framed: boolean;
}

export async function fetchGiftTiers(): Promise<GiftTierInfo[]> {
  const res = await fetch('/api/gift/tiers');
  const data = await res.json();
  return data.tiers;
}

export async function purchaseGift(params: {
  tierId: string;
  purchaserEmail?: string;
  recipientName?: string;
}): Promise<{ url: string }> {
  const res = await fetch('/api/gift/purchase', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error('Failed to create checkout');
  return res.json();
}

export interface GiftCodeInfo {
  code: string;
  tier: string;
  tierName: string;
  tierDescription: string;
  recipientName: string | null;
  status: string;
}

export async function validateGiftCode(code: string): Promise<GiftCodeInfo> {
  const res = await fetch(`/api/gift/${code}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Invalid code' }));
    throw new Error(err.error);
  }
  return res.json();
}

export async function redeemGiftCode(code: string): Promise<{ tier: string }> {
  const res = await fetch(`/api/gift/${code}/redeem`, { method: 'POST' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Redemption failed' }));
    throw new Error(err.error);
  }
  return res.json();
}

export interface OrderInfo {
  orderId: string;
  type: string;
  tier: string;
  status: string;
  pngUrl: string | null;
  gelatoOrderId: string | null;
  posterConfig: any;
  createdAt: string;
}

export async function getOrderDetails(orderId: string): Promise<OrderInfo> {
  const res = await fetch(`/api/orders/${orderId}`);
  if (!res.ok) throw new Error('Order not found');
  return res.json();
}

export async function createDirectOrder(params: {
  tierId: string;
  posterConfig?: any;
}): Promise<{ orderId: string; checkoutUrl: string }> {
  const res = await fetch('/api/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error('Failed to create order');
  return res.json();
}

export async function createGiftOrder(params: {
  giftCode: string;
  tierId: string;
}): Promise<{ orderId: string }> {
  const res = await fetch('/api/orders/from-gift', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error('Failed to create order');
  return res.json();
}

export async function getUploadUrl(orderId: string): Promise<{ url: string; method: string; key: string; local: boolean }> {
  const res = await fetch(`/api/orders/${orderId}/upload-url`, { method: 'POST' });
  if (!res.ok) throw new Error('Failed to get upload URL');
  return res.json();
}

export async function uploadPosterPng(uploadUrl: string, method: string, blob: Blob): Promise<void> {
  const res = await fetch(uploadUrl, {
    method,
    headers: { 'Content-Type': 'image/png' },
    body: blob,
  });
  if (!res.ok) throw new Error('Failed to upload poster');
}

export async function submitShipping(orderId: string, address: {
  name: string;
  address1: string;
  address2?: string;
  city: string;
  stateCode?: string;
  countryCode: string;
  zip: string;
}): Promise<{ status: string }> {
  const res = await fetch(`/api/orders/${orderId}/ship`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(address),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Shipping failed' }));
    throw new Error(err.error);
  }
  return res.json();
}
