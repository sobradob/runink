# BOA-125: Export model — free = email-only, paid = current path

**Status:** Build ticket (revised direction)
**Date:** 2026-06-18 (REVISED 2026-06-27)
**Absorbs:** BOA-123

---

## ⚠ PROD GATE — emails only work for everyone once Resend domain is verified

Free export is email-only, so email deliverability IS the feature. `EMAIL_FROM` is already
`hello@runink.app` in the DO app spec — but Resend blocks sends from a custom domain to anyone
except the account owner (sobradob@gmail.com) until the **domain is verified** in Resend. That is
the *only* reason non-owner emails fail. No code change needed. One-time steps:

1. Resend → Domains → Add `runink.app` (or `mail.runink.app` — subdomain is cleaner for reputation).
2. Add the DNS records Resend lists (MX, DKIM TXT, SPF TXT, optional DMARC) where runink.app DNS
   lives. The DO app spec has `zone: runink.app`, so DNS is on **DigitalOcean** (Networking →
   Domains → runink.app) unless nameservers point elsewhere (Cloudflare). Verify which.
3. Click Verify in Resend (green = sends to any address allowed).
4. Ensure `EMAIL_FROM` matches the verified domain. Bare `runink.app` → `hello@runink.app` is fine;
   `mail.runink.app` → set `EMAIL_FROM=RunInk <hello@mail.runink.app>` in DO env.
5. Confirm the LIVE DO app actually has `RESEND_API_KEY` + `EMAIL_FROM` set (the .do/*.yaml is a
   backup snapshot, not proof). Startup logs a `WARNING: EMAIL_FROM uses resend.dev test domain`
   line (server/index.ts:179) if it's wrong — its absence means it's correct.

Test: send to a non-Gmail address you control; Resend dashboard shows delivered vs bounced/blocked.

---

## ⮕ REVISED PLAN (2026-06-27) — READ THIS FIRST

The instant/client-capture free tier is being **removed**. It has proven too fragile on-device
(recurring iOS blank-map exports, 4 fix attempts) and the on-screen capture parameters can't be
made reliable across devices. We're trading instant gratification for reliability + lead capture.

### Two tiers, not three

| Tier | What | How | Watermark | Delivery |
|------|------|-----|-----------|----------|
| **Free** | Hi-def digital | Server render (300 DPI), email-gated | Yes | Email only, with marketing opt-in |
| **Paid** | Print poster | Current order flow (Stripe-first, async render after webhook) | None | Gelato fulfilment |

### What changes

**Free export becomes email-only.** Clicking "Export" opens the email-collection modal directly
(email + marketing opt-in). No instant download, no on-device capture. The existing HD-email
pipeline (already shipped 2026-06-19) does the rest: verification email → magic link → 300 DPI
server render → "ready" email → download page. **Decision (2026-06-27): keep double opt-in
verification as-is** — it's already built, protects the 300 DPI render queue from typos/abuse,
and keeps the marketing list clean.

**Paid export is unchanged.** The current "Order Print" path works (createDirectOrder → Stripe →
webhook → async 300 DPI render → ship). Do not touch it.

### Why this is mostly subtraction

The HD-email path already exists end-to-end (see §2 below — `export-async.ts`, `exports` table,
`ExportSuccessModal`, `sendExportVerification`/`sendExportReady`, `ExportDownloadPage`). The work
is removing the instant path and re-pointing the Export button, NOT building new infrastructure.

### Work items

Implemented on branch `boa-125-free-export-email-only` (2026-06-27):

- [x] **Remove instant capture path** — deleted `INSTANT_EXPORT`/`USE_CAPTURE_RENDERER` flags,
      `freeExportDimensions`, the JPEG/DPI/screen-px constants, `sessionHasExported`, `mmToPx`,
      `lastRenderPathRef`, the `renderPoster()` fallback chain, the `lastTimings` debug badge, and
      the whole capture branch in `handleExport()` in `PosterEditor.tsx`.
- [x] **Re-point the Export button** — `handleExport()` now just tracks `export_clicked` /
      `export_modal_shown` and opens `ExportSuccessModal` directly. No render, no download. The
      modal wires to `requestHdExport(email, marketingOptIn)` → `/api/export` (unchanged).
- [x] **Retire client capture renderer** — `git rm`'d `captureRenderer.ts` and `exportTimer.ts`
      (only PosterEditor + the WebKit smoke used them). This deletes the iOS blank-export root cause.
- [x] **Retire the sync free-render client path** — removed `renderExportOnServer()` from
      `checkoutApi.ts`. The server `/api/render/export` endpoint is left dormant (server-side,
      env-gated, harmless; physical removal belongs with the BOA-73 renderer cleanup).
- [x] **Copy/UX pass on the modal** — `ExportSuccessModal` reframed email-first ("Email me my
      poster" + email/opt-in as the primary action); print order is now a secondary outlined CTA.
- [x] **Analytics** — dropped `export_completed` / `instant_export_fallback` /
      `export_server_fallback` / `instant_export`. Kept `export_clicked` → added
      `export_modal_shown` → `hd_export_requested` (modal) → server-side `hd_export_*`.
- [x] **Removed obsolete CI** — `scripts/smoke-export-webkit.mjs` + `.github/workflows/smoke-webkit.yml`
      guarded the deleted capture path. Server render (the email path's engine) is still covered by
      `smoke-render.yml`.
- [x] **Verify (local, headless)** — drove the real dev server with Playwright: Export → email
      modal appears (email input + opt-in primary, print secondary), and **no file download fires**.
      tsc + production build clean; no new lint errors.
- [ ] **Verify on a real iPhone** — the device the instant path failed on: Export → email modal →
      confirm email → receive HD poster → download. Gate merge on this. (Note: prod emails still
      need the Resend custom-domain swap to deliver to non-account addresses.)

### Risk
Low. Removes the fragile path; the replacement is already in production. Main risk is UX copy
(modal must read as the primary action, not an upsell) and confirming nothing else depends on
`captureRenderer`.

---

## Original scoping spike (2026-06-18) — superseded above, kept for reference

**Phase 0 status (instant export):** shipped then being REMOVED per revised plan above.

---

## 1. Current export flow, end-to-end

### Free export (the "Export" button in PosterEditor) — CURRENT (post-BOA-120)
```
User clicks "Export"
  → PosterEditor.handleExport()                     [PosterEditor.tsx:512]
  → setExporting(true), collapse mobile sheet, wait 350ms

  PRIMARY PATH (INSTANT_EXPORT=true, shipped):
  → capturePosterToBlob({ element, map, dimensions }) [captureRenderer.ts]
      - Captures the on-screen preview DOM + WebGL canvas directly
      - Typically <1s — no server round-trip
  → applyWatermark(blob, DIGITAL_EXPORT_FORMAT)      [watermark.ts:38]
  → downloadBlob() — browser file-save dialog         ~500ms total

  FALLBACK (capture fails → full renderPoster() chain):
  → renderPoster() — three-tier fallback:             [PosterEditor.tsx:426]
      1. Server-side Playwright (POST /api/render/export)
         - 150 DPI cap (FREE_EXPORT_MAX_DPI)          [PosterEditor.tsx:49]
         - 2-7s warm, 5-15s+ cold
      2. Client capture renderer (retry)
      3. Legacy canvas renderer
  → applyWatermark(blob, DIGITAL_EXPORT_FORMAT)
      - Diagonal "runink.app" tiles (3.5-5% opacity)
      - Corner "made with runink.app" (35-75% opacity)
      - Encodes to JPEG q0.9 (~300KB)                 [PosterEditor.tsx:55]
  → downloadBlob()
  → track export_completed with render_path, size, render_ms, instant_export
```

### Paid order (the "Order Print" button)
```
User clicks "Order Print"
  → OrderButton.handleOrder()                         [OrderButton.tsx:70]
  → createDirectOrder(tierId, posterConfig)            POST /api/orders
      → Returns orderId + Stripe checkoutUrl
  → submitPoster(orderId, printDimensions)             [PosterEditor.tsx:480]
      → renderPosterOnServer(orderId, payload, dims)   POST /api/render/order/:orderId
         - Full 300 DPI, 400×600mm A3 = ~4724×7087px
         - Same Playwright pipeline, stores PNG to R2
         - Sets order.png_url in DB
      → 23-45s on 1-vCPU (software WebGL at 300 DPI)
  → window.location.href = checkoutUrl (Stripe)
  → Stripe webhook: checkout.session.completed         [webhooks.ts]
      → order.status = 'paid', send confirmation email
  → User returns to /order/:orderId/success
      → Polls for status='paid' (up to 40s)
      → Shipping form → POST /api/orders/:id/ship
      → Creates Gelato print order, status='fulfilling'
```

### Where the 3-minute hang happens

The **paid order flow** is the bottleneck. The sequence is:
1. `createDirectOrder` — fast (DB + Stripe session creation, <1s)
2. **`submitPoster` — THIS IS THE BLOCKER** — server-side Playwright render at 300 DPI
   - Cold start: Chromium launch + tile cache miss + large viewport = 45-90s+
   - Queue contention: max 2 concurrent renders, 30s queue timeout → 503
   - The client's `fetchRenderWithRetry` retries 3× with 90s timeout each attempt
   - Total worst case: 3 × 90s = **4.5 minutes** of user staring at "Rendering poster..."
3. Stripe redirect — after render completes, user leaves the page

The free export is much faster (150 DPI, ~2-7s) but still blocks the UI.

---

## 2. Where two-tier delivery slots in

### Tier 1: Instant preview download (safe to build now)

**What it is:** When the user clicks "Export", instead of waiting for a server render, immediately offer the on-screen preview as a downloadable file. The preview is already rendered in the browser (MapLibre + overlay) — we just need to capture it and hand it over.

**Where it fits in code:**

| What | Where | Change |
|------|-------|--------|
| Capture the visible preview | `capturePosterToBlob()` in [captureRenderer.ts](src/features/poster/infrastructure/renderer/captureRenderer.ts) | Already exists — this is fallback #2 in the current `renderPoster()` |
| Skip server round-trip for instant | `handleExport()` in [PosterEditor.tsx:506](src/features/poster/ui/PosterEditor.tsx:506) | New: call `capturePosterToBlob()` directly for the instant artifact, then kick off server render async |
| Watermark the instant file | `applyWatermark()` in [watermark.ts:38](src/features/poster/infrastructure/renderer/watermark.ts:38) | Already works on any blob |
| Download trigger | `downloadBlob()` in [renderer/index.ts](src/features/poster/infrastructure/renderer/index.ts) | No change |

**Resolution/quality:**
- Instant: whatever is on screen — typically 1081×1352px (Instagram preset at 150 DPI) or the user's selected size at screen resolution. JPEG q0.9. Watermarked.
- The capture renderer already exists and handles map canvas + overlay compositing.

**Implementation sketch (behind a flag):**
```
// PosterEditor.tsx handleExport()
const instantBlob = await capturePosterToBlob({ element, map, dimensions });
const watermarked = await applyWatermark(instantBlob, DIGITAL_EXPORT_FORMAT);
downloadBlob(watermarked, filename);  // <-- user has file within ~500ms

// Optionally: kick off server render for higher quality
// (Phase 2 — see email delivery below)
```

**Risk:** Low. The capture renderer already exists as fallback #2. The only new thing is making it the primary path instead of the server render. The server path becomes async follow-up rather than blocking.

### Tier 2: Delayed high-def via email (needs commercial decision)

**What it is:** After the instant download, trigger a server-side render at higher quality (150 DPI clean PNG, or the user's selected print size). When it finishes, email the user a download link.

**Where it fits in code:**

| What | Where | Change |
|------|-------|--------|
| Trigger async render | New endpoint or fire-and-forget from `handleExport()` | POST /api/render/export-async — same Playwright pipeline, stores result in R2 instead of streaming back |
| Store rendered PNG | `storeBuffer()` in [storage.ts](server/lib/storage.ts) | Already works — currently stores to `orders/{orderId}/poster.png` |
| Email delivery | `email.ts` in [server/lib/email.ts](server/lib/email.ts) | New function: `sendExportReady()` — Resend already wired up |
| Download page | New route `/export/:token` | Signed/expiring URL to R2 object, or a simple page with download link |
| Email collection | New UI in PosterEditor or post-export modal | Collects email before (or after) instant download |

**New server endpoint sketch:**
```
POST /api/render/export-async
  Body: { payload, dimensions, email, instantExportId? }
  → Validate, store payload token
  → Return 202 Accepted { exportId }
  → Background: renderPoster() → storeBuffer(`exports/{exportId}/poster.png`)
  → On completion: sendExportReady({ to: email, downloadUrl })
```

**Infrastructure that already exists:**
- Resend email client (`server/lib/email.ts`) — production-ready, 5 email templates already shipping
- R2 storage (`server/lib/storage.ts`) — presigned URLs, public URL generation
- Playwright render pipeline (`server/lib/poster-renderer.ts`) — concurrency semaphore, retry, health check
- Mixpanel tracking — request_id correlation between client/server

**Infrastructure that needs building:**
- Async render trigger (the current pipeline is synchronous — waits for PNG, then responds)
- Email collection UX (modal/form)
- Export download page (simple — serve R2 URL)
- Export tracking DB table or extend existing orders table

---

## 3. Reconciling BOA-125 and BOA-123

**BOA-123** ("scope email delivery of exports as lead capture + upsell") is a strict subset of BOA-125. Recommend:

- **Absorb BOA-123 into BOA-125** as the "email delivery" workstream
- BOA-123's "lead capture" angle = collecting email at export time
- BOA-125 is the parent that also covers instant download + monetization model

No duplicate email plumbing — one `sendExportReady()` function, one export-async endpoint. The "upsell" from BOA-123 becomes the CTA in the export-ready email ("Love your poster? Get it printed → [Order Print]").

---

## 4. Three-tier product model (DECIDED)

Priority order by value to the business:

| # | Artifact | Resolution | Watermark | Format | Cost | Delivery | Purpose |
|---|----------|-----------|-----------|--------|------|----------|---------|
| 1 | **Paid print poster** | 300 DPI at Gelato size | None | PNG | $25-75 | Gelato fulfilment | Revenue |
| 2 | **Hi-def digital** | 300 DPI at user's selected size | Yes (watermarked) | PNG | Free | Email delivery (lead magnet) | Email capture + upsell |
| 3 | **Instant preview** | Screen-res (~1081×1352px) | Yes (watermarked) | JPEG q0.9 | Free | Immediate browser download | Instant gratification |

### Decisions locked (2026-06-18)

- **Hi-def digital is free** — lead magnet to capture email, upsell to print in the email
- **Hi-def digital is watermarked** — same watermark as instant preview; the print poster is the clean, premium artifact
- **Hi-def digital renders at 300 DPI** — async/emailed so no UI blocking; gives the user a genuinely high-quality file (the watermark + physical print differentiate the paid tier)
- **Instant download has no gate** — anyone can export instantly without providing email
- **Post-download upsell** — after instant download, prompt user to: (a) order a print, and (b) get HD version via email
- **Paid order flow restructured** — skip the render-before-payment blocker. User sees the editor preview ("what you see is what you get, printed in higher definition"), pays via Stripe, render happens async after payment. No more 3-minute spinner before checkout.

---

## 5. Implementation plan — phased (by business value)

### Phase 0: Instant preview download — DONE ✓
**Status:** Prototype on current branch. `INSTANT_EXPORT = true` in PosterEditor.tsx.

- `handleExport()` now calls `capturePosterToBlob()` directly — typically <1s
- Falls back to full `renderPoster()` chain on capture failure
- Tracks `instant_export: true` and `instant_export_fallback` in Mixpanel
- Watermarks + JPEG q0.9 applied to the instant artifact

### Phase 1: Paid order — skip render, pay first, render async (HIGHEST VALUE)
**Scope:** Eliminate the 1-4 minute render-before-payment blocker. The user already sees
their poster in the editor preview. Show them "Your poster will be printed in high
definition (300 DPI)" → take payment via Stripe → render async after payment succeeds.

**Current flow (broken):**
```
User clicks "Order Print"
  → createDirectOrder() — fast
  → submitPoster() — BLOCKS 1-4 MINUTES (300 DPI server render)
  → redirect to Stripe — user may have already abandoned
```

**New flow:**
```
User clicks "Order Print"
  → createDirectOrder() — fast
  → redirect to Stripe IMMEDIATELY (no render)
  → Stripe webhook: checkout.session.completed
      → trigger async 300 DPI render in background
      → store PNG to R2, set order.png_url
  → User returns to /order/:orderId/success
      → show "Your poster is being prepared in print quality..."
      → shipping form (can fill while render runs)
  → POST /api/orders/:id/ship waits for render if still in progress
      → then submits to Gelato as before
```

**Files to change:**
- **`src/features/checkout/ui/OrderButton.tsx`** — remove `submitPoster()` / `renderPoster()` calls; redirect to Stripe immediately after `createDirectOrder()`
- **`src/features/poster/ui/PosterEditor.tsx`** — `submitPoster` prop no longer needed by OrderButton
- **`server/routes/webhooks.ts`** — on `checkout.session.completed`, trigger async render (fire-and-forget, using existing `renderPoster()` pipeline)
- **`server/routes/orders.ts`** — `/ship` endpoint checks `order.png_url` exists before Gelato submission; if render still in progress, poll/wait briefly or return "rendering" status
- **`src/features/checkout/ui/OrderSuccessPage.tsx`** — show render progress ("Preparing your print-quality poster..."), poll for png_url alongside payment status
- **`src/features/checkout/services/checkoutApi.ts`** — remove `renderPosterOnServer` from order flow; add `getOrderRenderStatus()` polling helper

**Key design question:** The poster config (theme, tracks, dimensions) needs to survive
from the editor to the async render. Options:
- **A) Store poster config in the order row at creation time** (already done — `poster_config` column exists in orders table). The webhook render reads it back. ← PREFERRED
- **B) Store a render payload token with TTL** — fragile, token expires if user is slow at checkout

**Edge cases:**
- Render fails after payment → retry automatically; if still fails, email user + admin, manual resolution. User already paid, so this is a support case, not a lost sale.
- User finishes shipping form before render completes → queue the Gelato submission, execute when png_url appears.

**Effort:** ~1 day
**Risk:** Medium — restructures the critical revenue path. But simpler than current flow (removes the render-before-payment step entirely). Needs thorough testing.

### Phase 2: Post-export upsell modal + HD email delivery (LEAD CAPTURE)
**Scope:** After the instant download, show a modal that:
1. Upsells to print order ("Get this printed on your wall — from $25")
2. Offers HD version via email ("Want the high-definition version? Enter your email")

Then: collect email → async 300 DPI render (watermarked) → email download link.

**Files:**
- **New:** `src/features/poster/ui/ExportSuccessModal.tsx` — post-export modal with print CTA + email input
- **New:** `server/routes/export-async.ts` — `POST /api/render/export-async` endpoint (accepts email + payload, returns 202, renders async, emails link on completion)
- **Extend:** `server/lib/email.ts` — add `sendExportReady()` with download link + print upsell CTA
- **New:** `src/pages/ExportDownloadPage.tsx` — simple page that serves the R2 download link (watermarked hi-def PNG)
- **Extend:** `server/lib/db.ts` — `exports` table (export_id, email, status, png_url, poster_config, created_at, expires_at)
- **Extend:** `src/features/poster/ui/PosterEditor.tsx` — show ExportSuccessModal after instant download completes

**Effort:** ~1-2 days
**Risk:** Medium — new DB table, new email template, new page route. But all infrastructure (Resend, R2, Playwright) already exists.

### Phase 3: Funnel instrumentation (woven into Phases 1-2)

| Event | When | Properties |
|-------|------|------------|
| `instant_export_downloaded` | User downloads instant preview | size, theme_id, render_ms |
| `export_upsell_shown` | Post-download modal appears | size, theme_id |
| `export_upsell_print_clicked` | User clicks "Order Print" in modal | size, theme_id |
| `hd_export_requested` | User submits email for HD version | size, theme_id, email_domain |
| `hd_export_completed` | Server render finishes + email sent | export_id, render_ms, file_bytes |
| `hd_export_email_clicked` | User clicks download link in email | export_id, time_since_sent |
| `hd_to_print_upsell_clicked` | User clicks "Order Print" in email | export_id, tier_id |
| `order_skip_render` | Paid order redirects to Stripe without render | tier_id, theme_id |
| `order_async_render_completed` | Post-payment render finishes | order_id, render_ms |
| `order_async_render_failed` | Post-payment render fails | order_id, error |

**Effort:** ~half day woven into Phases 1-2

---

## 6. Key files reference

| File | Role |
|------|------|
| [`src/features/poster/ui/PosterEditor.tsx`](src/features/poster/ui/PosterEditor.tsx) | Editor UI, export trigger, 3-tier render fallback |
| [`src/features/poster/infrastructure/renderer/watermark.ts`](src/features/poster/infrastructure/renderer/watermark.ts) | Watermark compositing (diagonal + corner) |
| [`src/features/poster/infrastructure/renderer/captureRenderer.ts`](src/features/poster/infrastructure/renderer/captureRenderer.ts) | Client-side screenshot of preview container |
| [`src/features/poster/infrastructure/renderer/index.ts`](src/features/poster/infrastructure/renderer/index.ts) | Canvas renderer + downloadBlob utility |
| [`src/features/checkout/ui/OrderButton.tsx`](src/features/checkout/ui/OrderButton.tsx) | Order creation + render + Stripe redirect |
| [`src/features/checkout/ui/tiers.ts`](src/features/checkout/ui/tiers.ts) | Tier definitions, print dimensions, prices |
| [`src/features/checkout/services/checkoutApi.ts`](src/features/checkout/services/checkoutApi.ts) | API client: order creation, render dispatch, upload, retry |
| [`src/types/poster.ts`](src/types/poster.ts) | PosterDimensions, POSTER_PRESETS, DEFAULT_PRESET |
| [`server/routes/render.ts`](server/routes/render.ts) | Server render endpoints (order + export) |
| [`server/lib/poster-renderer.ts`](server/lib/poster-renderer.ts) | Chromium pool, Playwright render, concurrency semaphore |
| [`server/lib/email.ts`](server/lib/email.ts) | Resend email client (5 existing templates) |
| [`server/lib/storage.ts`](server/lib/storage.ts) | R2/local storage, presigned URLs |
| [`server/lib/db.ts`](server/lib/db.ts) | SQLite/Postgres, orders + gift_codes tables |
| [`server/routes/orders.ts`](server/routes/orders.ts) | Order CRUD, Gelato submission |
| [`server/routes/webhooks.ts`](server/routes/webhooks.ts) | Stripe webhook handler |

---

## 7. Linear ticket reconciliation (as of 2026-06-18)

| Ticket | Title | Status | Relationship to BOA-125 |
|--------|-------|--------|------------------------|
| **BOA-125** | Two-tier export spike | Backlog | This ticket — umbrella for all export delivery |
| **BOA-123** | Email delivery spike | Backlog | **Absorb into BOA-125** — its "email delivery" and "lead capture" scope is a strict subset |
| **BOA-120** | Speed up export (IG default + cold start) | Backlog (code merged) | Phase 0 dependency — shipped. Close in Linear. |
| **BOA-122** | Post-export loading + completion state | Backlog | Subsumed by Phase 1 ExportSuccessModal — the "now what" dead time becomes a success modal with email prompt |
| **BOA-121** | Watermark rework | Done | Prerequisite — shipped. Watermark is now subtle enough for the instant tier. |
| **BOA-84** | Comprehensive export testing | Backlog | Independent — run after Phase 1 ships. Validates end-to-end across devices. |
| **BOA-70** | Async render for 300 DPI timeouts | Done (partial) | A4 fixed via dsf trick. **A2/A3 still need async render** — this is Phase 3. Reopen or create child ticket. |
| **BOA-73** | Remove legacy canvas renderer | Backlog (low) | Cleanup — gate on 1 clean week of server renders. Independent of BOA-125. |

**Proposed ticket structure:**
- BOA-125 (parent) — three-tier export umbrella
  - BOA-123 → close as duplicate / absorbed
  - BOA-122 → close as duplicate / absorbed into Phase 2
  - Phase 1: "Paid order — skip render, pay first, render async" (HIGHEST PRIORITY)
  - Phase 2: "Post-export upsell modal + HD email delivery"
  - Phase 3: "Funnel instrumentation" (woven into 1-2)

---

## 8. Decisions log + remaining questions

### Decided (2026-06-18)
- ✅ Three tiers: paid print > hi-def email (lead magnet) > instant preview
- ✅ Hi-def digital = free, watermarked, 300 DPI, emailed
- ✅ Instant download = no gate, free for everyone
- ✅ Post-download = upsell to both print order AND hi-def email
- ✅ Paid order flow = skip render before payment, render async after Stripe webhook
- ✅ User sees editor preview + "printed in higher definition" messaging

### Remaining questions
1. **Export download link expiry?** → How long should the R2 link stay valid? 7 days? 30 days? Forever?
2. **Order flow: what if async render fails after payment?** → Auto-retry + email user? Manual support case?
3. **Gelato submission timing** → Should `/ship` block until render is done, or decouple? User can fill address while render runs, but Gelato needs the PNG URL.
4. **GDPR/consent** → Email for export delivery is transactional (no consent needed). Marketing opt-in needs separate checkbox.
