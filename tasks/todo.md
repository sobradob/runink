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

- [ ] Add `/api/render/health` to external uptime monitoring (1-min interval, page on failure). Endpoint is now caching-friendly: cached for 60 s, invalidates if browser disconnects.
- [x] **CI smoke render workflow** — `.github/workflows/smoke-render.yml`: builds Docker image, boots against ephemeral Postgres, runs `scripts/smoke-render.ts` inside the container, asserts >50 KB PNG. Path-filtered so docs-only PRs don't burn 5-min Docker builds.
- [ ] Add a visual regression check: screenshot fixed-payload render, diff against committed golden PNG with `pixelmatch` at 1% threshold. Extend the smoke-render workflow with an additional assertion.
- [x] **Web fonts served via `@font-face` with `font-display: block`** — already bundled via `@fontsource/*`, declaration in `src/styles/index.css`. Combined with `document.fonts.ready` await in InternalRenderPage so prints never capture fallback glyphs.
- [x] **Client-side error reporting via Mixpanel** — `src/shared/diagnostics/errorReporter.ts` ships every error as a `client_error` event with build SHA, requestId, viewport, UA. Hooked into AppErrorBoundary, window error + unhandledrejection handlers, RenderError catches, StravaLoaderError catches. See `tasks/lessons.md` for the event schema.
- [x] **Server-side error reporting via Mixpanel** — `server/lib/error-reporter.ts` ships every server failure as a `server_error` event. Hooked into render route 500s/503s, activities route Strava failures (including 403 missing-scope and 401 session-invalid), an Express last-resort error handler in server/index.ts, and process-level uncaughtException + unhandledRejection. Same `request_id` as the client event — join in Mixpanel to see both sides of a failed request.
- [ ] **(Future)** Add Sentry on top of Mixpanel when volume justifies it — Mixpanel is fine for low volume but lacks stack grouping, source maps, and issue-workflow features. Don't migrate; layer.
- [ ] Build an admin "re-render this order" endpoint. Needs `poster_config` JSON to be persisted on the order row (already is) PLUS the resolved GPS tracks (not yet — would need to refetch from Strava at re-render time).
- [x] **Long-press diagnostic overlay** — `DiagnosticOverlay` on the RunInk logo (600 ms). Build SHA inlined into bundle via vite `define`, last render requestId via `shared/diagnostics/renderTelemetry` singleton, tap-to-copy report.

## Resilience improvements shipped 2026-05-22 session

- [x] **Server-render path live** — Playwright in Docker, 2 GB instance, both flags on in production. /api/render/health green.
- [x] **Render submit retries** — 3 attempts with exponential backoff on 503/network errors; AbortController per attempt; RenderError carries requestId + retryable flag.
- [x] **Order UI error surface** — retry button, requestId for support correlation, draft preserved on transient failure.
- [x] **Root AppErrorBoundary** — React crashes land on a recovery screen with reload + copy-stack instead of a blank dark void.
- [x] **localStorage draft persistence** — PosterEditor state survives refresh/tab-kill, keyed by mode + activity-set, versioned envelope, flushed on pagehide.
- [x] **Offline toast** — non-modal indicator on `navigator.onLine` flip.
- [x] **Render progress bar** — logistic curve + live elapsed timer during 2–7 s server render; replaces static text.
- [x] **Code-split non-editor routes** — Gift/Redeem/Success/Status/Privacy/InternalRender are React.lazy chunks. Initial bundle 1.34 MB → 1.31 MB; unvisited routes are zero-byte.
- [x] **Cheap /api/render/health** — 60 s cache + isConnected check. Sub-ms in between real verifications.

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
