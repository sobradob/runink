# RunInk — TODO

## Bugs (branch: stripe-printer-integration)

- [x] **Upload URL routing mismatch** — `storage.ts` returned `/api/upload/...` but route was at `/api/orders/upload/...`. Fixed.
- [x] **Express 5 wildcard param is array** — `*key` param comes back as `string[]`, not `string`. Fixed with `Array.isArray` check.
- [ ] **PNG export horizontal lines + UI mismatch** — Partially addressed:
  - Added dynamic WebGL max texture size detection (no more hardcoded 4096)
  - Added `fadeDuration: 0` and `transition.duration: 0` to prevent half-loaded tiles
  - Added double-idle wait for more reliable tile rendering
  - **Needs real-world testing** to confirm banding is resolved

## Completed

- [x] Upload URL routing fix (local dev path mismatch)
- [x] Store `png_url` in DB after upload (both local and R2)
- [x] Poster dimension presets now match Gelato product sizes (30x40, 40x60, 50x70)
- [x] Order flow renders at print-correct dimensions (not editor preview dimensions)
- [x] Public URL strategy for Gelato access (`PUBLIC_URL` env or request-based base URL)
- [x] Email sending via Resend (order confirmation, gift code delivery, shipping confirmation)
- [x] Renamed `printful_order_id` → `gelato_order_id` (with migration for existing DBs)
- [x] Updated privacy policy: Printful → Gelato, AWS S3 → Cloudflare R2

## Still needed before production

- [ ] Configure `STRIPE_WEBHOOK_SECRET` + register webhook URL in Stripe dashboard
- [ ] Set up Cloudflare R2 bucket with public access for poster PNGs
- [ ] Set `RESEND_API_KEY` and `EMAIL_FROM` env vars for email sending
- [ ] Set `PUBLIC_URL` env var to production domain (for Gelato image access)
- [ ] End-to-end test of full purchase flow (Stripe test mode → shipping → Gelato)
- [ ] Gelato webhook integration (auto-update order status on print/ship/deliver)
- [ ] Shipping rate display in ShippingForm
