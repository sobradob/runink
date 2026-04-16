/**
 * Gelato API client for creating poster print orders.
 *
 * API docs: https://dashboard.gelato.com/docs/orders/v4/create/
 * Auth: X-API-KEY header
 *
 * Gelato uses region-specific product UIDs:
 *  - US/CA: inch sizes + lb-based paper
 *  - Rest of world: mm sizes + gsm-based paper
 */

const GELATO_ORDER_API = 'https://order.gelatoapis.com/v4/orders';
const GELATO_PRODUCT_API = 'https://product.gelatoapis.com/v3';

function apiKey(): string {
  const key = process.env.GELATO_API_KEY;
  if (!key) throw new Error('GELATO_API_KEY not configured');
  return key;
}

function headers(): Record<string, string> {
  return {
    'X-API-KEY': apiKey(),
    'Content-Type': 'application/json',
  };
}

// Countries that use inch/lb products (US-based production)
const INCH_COUNTRIES = new Set(['US', 'CA', 'PR']);

// Product UID mappings per tier, split by region
const PRODUCT_UIDS: Record<string, { inch: string; metric: string }> = {
  'a4-poster': {
    inch: 'flat_product_pf_12x18-inch_pt_80-lb-cover-uncoated_cl_4-0_ct_none_prt_none_sft_none_set_none_ver',
    metric: 'flat_product_pf_300x400-mm_pt_200-gsm-uncoated_cl_4-0_ct_none_prt_none_sft_none_set_none_ver',
  },
  'a3-poster': {
    inch: 'flat_product_pf_18x24-inch_pt_80-lb-cover-uncoated_cl_4-0_ct_none_prt_none_sft_none_set_none_ver',
    metric: 'flat_product_pf_400x600-mm_pt_200-gsm-uncoated_cl_4-0_ct_none_prt_none_sft_none_set_none_ver',
  },
  'a3-framed': {
    inch: 'frame_and_poster_product_frs_18x24-inch_frc_black_frm_aluminum_frp_w10xt22-mm_gt_plexiglass__pf_18x24-inch_pt_80-lb-cover-uncoated_cl_4-0_ct_none_prt_none_ver',
    metric: 'frame_and_poster_product_frs_400x600-mm_frc_black_frm_aluminum_frp_w10xt22-mm_gt_plexiglass__pf_400x600-mm_pt_200-gsm-uncoated_cl_4-0_ct_none_prt_none_ver',
  },
  'a2-poster': {
    inch: 'flat_product_pf_24x36-inch_pt_80-lb-cover-uncoated_cl_4-0_ct_none_prt_none_sft_none_set_none_ver',
    metric: 'flat_product_pf_500x700-mm_pt_200-gsm-uncoated_cl_4-0_ct_none_prt_none_sft_none_set_none_ver',
  },
  'a2-framed': {
    inch: 'frame_and_poster_product_frs_24x36-inch_frc_black_frm_aluminum_frp_w10xt22-mm_gt_plexiglass__pf_24x36-inch_pt_80-lb-cover-uncoated_cl_4-0_ct_none_prt_none_ver',
    metric: 'frame_and_poster_product_frs_500x700-mm_frc_black_frm_aluminum_frp_w10xt22-mm_gt_plexiglass__pf_500x700-mm_pt_200-gsm-uncoated_cl_4-0_ct_none_prt_none_ver',
  },
};

function getProductUid(tierId: string, countryCode: string): string {
  const mapping = PRODUCT_UIDS[tierId];
  if (!mapping) throw new Error(`No Gelato product for tier: ${tierId}`);
  return INCH_COUNTRIES.has(countryCode.toUpperCase()) ? mapping.inch : mapping.metric;
}

export interface ShippingAddress {
  name: string;
  address1: string;
  address2?: string;
  city: string;
  stateCode?: string;
  countryCode: string;
  zip: string;
  email?: string;
  phone?: string;
}

export interface GelatoOrderResult {
  id: string;
  orderReferenceId: string;
  status: string;
}

/**
 * Create a print order on Gelato.
 */
export async function createPrintOrder(params: {
  externalId: string;
  tierId: string;
  imageUrl: string;
  shipping: ShippingAddress;
}): Promise<GelatoOrderResult> {
  const productUid = getProductUid(params.tierId, params.shipping.countryCode);

  // Split name into first/last for Gelato's address format
  const nameParts = params.shipping.name.trim().split(/\s+/);
  const firstName = nameParts[0] || '';
  const lastName = nameParts.slice(1).join(' ') || firstName;

  const body = {
    orderType: 'order',
    orderReferenceId: params.externalId,
    customerReferenceId: params.externalId,
    currency: 'USD',
    items: [
      {
        itemReferenceId: `${params.externalId}-poster`,
        productUid,
        files: [
          {
            type: 'default',
            url: params.imageUrl,
          },
        ],
        quantity: 1,
      },
    ],
    shippingAddress: {
      firstName,
      lastName,
      addressLine1: params.shipping.address1,
      addressLine2: params.shipping.address2 || '',
      city: params.shipping.city,
      state: params.shipping.stateCode || '',
      country: params.shipping.countryCode,
      postCode: params.shipping.zip,
      email: params.shipping.email || '',
      phone: params.shipping.phone || '',
    },
  };

  const res = await fetch(GELATO_ORDER_API, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gelato order failed (${res.status}): ${err}`);
  }

  const data = await res.json();

  return {
    id: data.id,
    orderReferenceId: data.orderReferenceId,
    status: data.orderType || 'created',
  };
}

/**
 * Get order status from Gelato.
 */
export async function getOrderStatus(orderId: string): Promise<{ status: string; tracking?: string }> {
  const res = await fetch(`${GELATO_ORDER_API}/${orderId}`, {
    headers: headers(),
  });

  if (!res.ok) throw new Error(`Gelato status check failed: ${res.status}`);

  const data = await res.json();

  // Gelato order statuses: created, passed, in_production, shipped, delivered, cancelled, failed
  const shipment = data.shipments?.[0];

  return {
    status: data.fulfillmentStatus || data.orderType || 'unknown',
    tracking: shipment?.trackingCode,
  };
}

/**
 * Get shipping estimate for an order.
 * Gelato doesn't have a standalone shipping rates endpoint like Printful.
 * Use the quote endpoint instead.
 */
export async function getShippingEstimate(params: {
  tierId: string;
  countryCode: string;
}): Promise<{ estimatedDays: string }> {
  // Gelato prints locally in 32+ countries, so delivery is typically 2-6 business days
  const isLocal = !INCH_COUNTRIES.has(params.countryCode) || params.countryCode === 'US';
  return {
    estimatedDays: isLocal ? '3-6 business days' : '5-10 business days',
  };
}
