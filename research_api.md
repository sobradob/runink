# RunInk — Print-on-Demand & Payments Research

*Last updated: March 2026*

---

## Executive Summary

RunInk needs three external services to commercialize: a **payment processor** (Stripe), a **print-on-demand provider** (Printful or Gelato), and **file storage** (Cloudflare R2 or AWS S3). This document compares the options and recommends a stack.

**Recommended stack**: Stripe Checkout + Gelato + Cloudflare R2

---

## 1. Print-on-Demand: Printful vs Gelato

### Overview

Both Printful and Gelato are print-on-demand services with APIs that let you submit poster orders programmatically. You upload an image, specify a product and shipping address, and they print and ship it directly to the customer.

### Comparison Table

| Feature | Printful | Gelato |
|---------|----------|--------|
| **Base poster price** | ~$16.49 | ~$10–25 (varies by region) |
| **Framed poster** | From $10.49 + $4.50/additional | Similar range, varies by partner |
| **Production locations** | Centralized (US, Latvia, Mexico, Spain) | 140+ partners in 32+ countries |
| **Global coverage** | Ships internationally from hubs | 200+ countries, 95% printed locally |
| **Domestic shipping (US)** | $3.99 first item | $4–10 via local hub |
| **International shipping** | Cross-border, 5–20 business days | Local production, 2–6 days |
| **API complexity** | Simple REST, well-documented | More endpoints, more flexible |
| **File formats** | PNG, JPEG | PNG, JPEG, SVG, PDF |
| **Required DPI** | 300 (min 75) | 300 (min 150) |
| **Max file size** | 200 MB | Not explicitly stated |
| **Subscription** | $24.99/mo (modest discounts) | $23.99/mo (up to 35% off + free shipping to US/UK/EU) |
| **API docs** | [developers.printful.com](https://developers.printful.com/docs/) | [dashboard.gelato.com/docs](https://dashboard.gelato.com/docs/) |

### Printful: Strengths & Weaknesses

**Strengths:**
- Simpler API integration — fewer moving parts
- Consistent print quality from owned facilities
- Good for US/Canada-focused businesses
- Rich colour reproduction noted by users
- API v2 (beta) simplifies order creation

**Weaknesses:**
- Higher base prices than Gelato
- Cross-border shipping is slow and expensive
- Limited production locations means longer delivery for international orders
- Subscription discounts are modest

**API flow:**
```
POST /orders
{
  "recipient": { name, address1, city, country_code, zip },
  "items": [{
    "variant_id": 10163,
    "files": [{ "type": "default", "url": "https://..." }]
  }]
}
```

### Gelato: Strengths & Weaknesses

**Strengths:**
- Lower base costs ($10–25 vs $16.49)
- Local production in 32+ countries — faster delivery, lower shipping
- 95% of orders printed within the recipient's country
- Gelato+ subscription includes free shipping to US/UK/EU
- Better margins at scale (35% discount year one)
- Lower carbon footprint (no cross-border shipping)

**Weaknesses:**
- More complex API with product UID system
- Quality can vary between production partners
- Need to use Products Search API to find correct product UIDs
- Less established developer community

**API flow:**
```
POST https://order.gelatoapis.com/v4/orders
Headers: X-API-KEY: <key>, Content-Type: application/json
{
  "orderReferenceId": "ORD-12345",
  "customerReferenceId": "customer-1",
  "shippingAddress": { firstName, lastName, addressLine1, city, country, postCode },
  "items": [{
    "itemReferenceId": "item-1",
    "productUid": "flat_product_pf_300x400-mm_pt_200-gsm-uncoated_...",
    "files": [{ "type": "default", "url": "https://..." }],
    "quantity": 1
  }]
}
```

### Recommendation: Gelato

For RunInk's global audience (runners are everywhere), Gelato's local production network is the clear winner:

- **Faster delivery**: 2–4 days domestic vs 5–20 days cross-border
- **Cheaper shipping**: Local production eliminates international freight
- **Better margins**: Lower base price + subscription discounts
- **Scalability**: 140+ production partners handle volume spikes

**Start with Printful** (already integrated) for initial testing, then **migrate to Gelato** for production deployment. The swap only requires replacing one server file (`server/lib/printful.ts`).

---

## 2. Payment Processing: Stripe

### Why Stripe

Stripe is the industry standard for one-time online payments. It handles payment forms, card processing, international currencies, and tax calculation — all via API.

### Checkout Sessions (Recommended)

For RunInk's use case (one-time poster purchases), **Stripe Checkout Sessions** is the right pattern:

- Stripe hosts the entire payment form — no PCI compliance burden
- Supports 40+ payment methods (cards, Apple Pay, Google Pay, etc.)
- Handles currency conversion, tax calculation, and receipts
- Simple redirect-based flow: create session -> redirect user -> handle webhook

**Flow:**
```
1. Backend: POST /v1/checkout/sessions -> returns URL
2. Frontend: redirect to Stripe-hosted checkout page
3. User pays -> Stripe redirects to success URL
4. Stripe fires webhook -> backend creates gift code or marks order as paid
```

**vs Payment Intents:** Payment Intents give more UI control but require handling payment forms, validation, and error states yourself. Not worth the complexity for RunInk.

### Gift Codes via Stripe

Two approaches for gift vouchers:

**Option A: Stripe Promotion Codes (built-in)**
- Create a Coupon (defines the discount)
- Create a Promotion Code (customer-facing code linked to coupon)
- Enable `allow_promotion_codes=true` in Checkout Sessions
- Stripe handles validation and application automatically

**Option B: Custom gift code system (our approach)**
- We manage gift codes in our own database
- Buyer pays via Stripe Checkout -> webhook generates code
- Recipient redeems code on our site -> no Stripe interaction needed
- More flexible: codes aren't tied to Stripe's coupon model

We've implemented **Option B** because it gives us full control over the redemption flow (recipient connects Strava, designs poster, enters shipping — all before the "payment" step, which is pre-paid).

### Pricing for RunInk

Stripe takes 2.9% + $0.30 per transaction.

| Tier | Sell Price | Stripe Fee | Print Cost (est.) | Net Margin |
|------|-----------|------------|-------------------|------------|
| A4 Poster | $25 | $1.03 | $8 + $4 shipping | ~$12 |
| A3 Poster | $35 | $1.32 | $12 + $4 shipping | ~$18 |
| A3 Framed | $55 | $1.90 | $25 + $6 shipping | ~$22 |
| A2 Framed | $75 | $2.48 | $35 + $6 shipping | ~$32 |

### Setup Needed

1. Create a Stripe account at [stripe.com](https://stripe.com)
2. Get API keys from Dashboard -> Developers -> API keys
3. Set up webhook endpoint for `checkout.session.completed` events
4. Add to `.env`:
   ```
   STRIPE_SECRET_KEY=sk_test_...
   STRIPE_WEBHOOK_SECRET=whsec_...
   ```
5. For production: switch from `sk_test_` to `sk_live_` keys

---

## 3. File Storage: Cloudflare R2

### Why R2

Poster PNGs need to be stored somewhere accessible via URL so the print provider can download them. Options:

| Feature | Cloudflare R2 | AWS S3 |
|---------|--------------|--------|
| **Egress fees** | Free | $0.09/GB |
| **Storage** | $0.015/GB/mo | $0.023/GB/mo |
| **S3 compatible** | Yes | Yes (native) |
| **Free tier** | 10 GB storage, 10M reads/mo | 5 GB for 12 months |

**R2 wins** on cost — zero egress fees means the print provider downloading large PNGs costs nothing.

### Setup

1. Cloudflare account -> R2 -> Create bucket (`runink-posters`)
2. Create API token with R2 read/write permissions
3. Add to `.env`:
   ```
   R2_ACCOUNT_ID=<your-account-id>
   R2_ACCESS_KEY_ID=<token-id>
   R2_SECRET_ACCESS_KEY=<token-secret>
   R2_BUCKET=runink-posters
   R2_PUBLIC_URL=https://posters.runink.com
   ```

### Development Fallback

The current implementation falls back to local file storage (`data/uploads/`) when R2 credentials aren't configured. This works perfectly for development and testing.

---

## 4. Implementation Status

| Component | Status | Notes |
|-----------|--------|-------|
| Stripe Checkout Sessions | Built | `server/lib/stripe.ts` — lazy-init, works without API key |
| Stripe Webhooks | Built | `server/routes/webhooks.ts` — handles payment confirmation |
| Printful Client | Built | `server/lib/printful.ts` — order creation, status check |
| Gelato Client | Not yet | Swap for Printful when ready for production |
| Gift Code System | Built | `server/lib/db.ts` — SQLite, generate/validate/redeem |
| Order Management | Built | `server/routes/orders.ts` — create, upload PNG, ship |
| File Upload (R2/local) | Built | `server/lib/storage.ts` — pre-signed URLs, local fallback |
| Gift Purchase UI | Built | `src/features/checkout/ui/GiftPurchase.tsx` |
| Redemption UI | Built | `src/features/checkout/ui/RedeemPage.tsx` |
| Order Print Button | Built | `src/features/checkout/ui/OrderButton.tsx` |
| Shipping Form | Built | `src/features/checkout/ui/ShippingForm.tsx` |

---

## 5. Key API Documentation Links

**Printful:**
- [API Documentation](https://developers.printful.com/docs/)
- [File Format & DPI Guide](https://www.printful.com/blog/everything-you-need-to-know-to-prepare-the-perfect-printfile)
- [Shipping Pricing](https://www.printful.com/shipping)

**Gelato:**
- [API Documentation](https://dashboard.gelato.com/docs/get-started/)
- [Create Order Endpoint](https://dashboard.gelato.com/docs/orders/v3/create/)
- [Product Search API](https://dashboard.gelato.com/docs/products/product/search/)
- [Global Shipping Coverage](https://www.gelato.com/shipping-and-delivery)

**Stripe:**
- [Checkout Sessions API](https://docs.stripe.com/api/checkout/sessions)
- [Promotion Codes API](https://docs.stripe.com/api/promotion_codes)
- [Webhooks](https://docs.stripe.com/webhooks)

**Cloudflare R2:**
- [R2 Documentation](https://developers.cloudflare.com/r2/)
- [S3 API Compatibility](https://developers.cloudflare.com/r2/api/s3/)
