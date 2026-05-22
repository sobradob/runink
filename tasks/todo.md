# RunInk — TODO

## Bugs

- [x] **PNG export doesn't match preview** — Fixed: use pixelRatio scaling instead of container resize
- [x] **Strava OAuth redirects to `ondigitalocean.app` instead of `runink.app`** — Fixed: component-level env var on DO was overriding the correct app-level value. Deleted the component-level var.

## UX Improvements

- [ ] **Unify size selector and print tier selector**
  - Currently two separate size pickers: one in the editor (30x40cm, 40x60cm, etc.) and one in the checkout (Small Poster, Large Poster, etc.)
  - Confusing UX — selecting a print tier should auto-set the poster dimensions, or the editor size should determine which tiers are available
  - Consider: remove the size picker from the editor when ordering a print, and let the tier selection drive dimensions

- [ ] **Improve checkout process with poster preview**
  - Show a preview of the poster in the Order Print modal before payment
  - Currently the user clicks "Order Print", selects a tier, and immediately goes to Stripe — no visual confirmation of what they're buying
  - Consider rendering a thumbnail preview in the tier selection modal

## Infrastructure

- [ ] **Place a real low-tier test order to verify server-render → Gelato** (2026-05-22: server-render flags flipped to ON in production; needs human-card test order to confirm end-to-end. Then visually compare PNG to preview.)
- [ ] **After ~1 week of clean server-rendered orders**: delete `src/features/poster/infrastructure/renderer/index.ts` (legacy canvas renderer) and the `renderPoster` legacy props on OrderButton/GiftOrderButton. submitPoster becomes the only path.
- [ ] End-to-end test of full purchase flow (Stripe test mode → shipping → Gelato)
- [ ] Verify domain on Resend, switch `EMAIL_FROM` to `orders@runink.app`
- [ ] Gelato webhook integration (auto-update order status on print/ship/deliver)

## QA / observability (set up before customer volume grows)

- [ ] Add `/api/render/health` to external uptime monitoring (1-min interval, page on failure)
- [ ] Add a Docker render smoke job to `.github/workflows/build.yml` (build image, run container, POST fixed payload to `/api/render/_smoke`, assert PNG returned, gated on `ENABLE_SMOKE_ENDPOINTS=true` in CI only)
- [ ] Add a visual regression check: screenshot fixed-payload render, diff against committed golden PNG with `pixelmatch` at 1% threshold
- [ ] Bundle web fonts and serve via `@font-face` with `font-display: block` so the mobile preview matches the Linux Chromium print
- [ ] Add Sentry (or equivalent) on both client and server — capture `render.failed` events with `requestId`
- [ ] Build an admin "re-render this order" button so support requests don't require a deploy
- [ ] Add a long-press debug overlay on the logo: user agent, devicePixelRatio, viewport, MapLibre version, last render request ID, build SHA

## Completed

- [x] Upload URL routing fix
- [x] Express 5 wildcard param fix
- [x] Store `png_url` in DB after upload
- [x] Poster dimension presets match Gelato sizes
- [x] Order flow renders at print-correct dimensions
- [x] Public URL strategy for Gelato access
- [x] Email sending via Resend
- [x] Renamed `printful_order_id` → `gelato_order_id`
- [x] Updated privacy policy
- [x] Poster preview on success page (post-payment)
- [x] Cloudflare R2 configured and tested
- [x] Stripe webhook configured
- [x] Resend API key configured
- [x] Deployed to DigitalOcean
- [x] Coming Soon gate on Order Print button
- [x] Coming Soon gate on Gift Purchase page
- [x] Fixed DO deploy branch (was `strava-only`, changed to `main`)
- [x] No-cache headers on index.html to prevent stale deploys
- [x] Extracted shared `ComingSoon.tsx` (COMING_SOON flag + popup component)
