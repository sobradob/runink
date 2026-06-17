# RunInk — TODO

## Done: BOA-116 homepage revamp (2026-06-17)
Plan: tasks/boa-116-plan.md. Mobile-first scrollable LandingPage — hero example map,
10-theme showcase (new scripts/gen-landing-themes.mjs → public/assets/landing/themes/),
pricing ($25–$75 from tiers.ts), 2 placeholder testimonials (Kidwell, Groot). Build green;
verified via Playwright screenshots (preview MCP blocked by EPERM in this env).

## In progress: BOA-85 + BOA-86 mobile-first redesign (2026-06-14)

Plan: tasks/boa-85-86-plan.md. Cohesive redesign — mode-select during load + per-mode browse + guided editor.

### Slice B — backend hero signal (unblocks single mode)
- [x] strava-client: add `workout_type?` to StravaActivity
- [x] transform: map `workoutType` onto server ActivitySummary
- [x] types/activity: add `workoutType?` to ActivitySummary
- [x] heroRuns service: `isRace()` + `rankHeroRuns()` (longest + race) + DISTANCE_BANDS

### Slice A — mode select + switch plumbing
- [x] outputMode service: type + localStorage persist + shared poster-style carryover
- [x] ModeSelect screen (mobile-first, two cards, example previews, reassurance)
- [x] App.tsx: modeselect gate during load (gated on connected); browse per mode; persistent Switch

### Slice C — per-mode browse
- [x] ActivityBrowser mode-aware: composite = filter-driven auto-include + live "more loading"
- [x] Single = hero "Suggested" grid + distance-band pills (keep search/date/type)

### Slice D — guided editor (BOA-85)
- [x] Guided-skippable steps Theme→Text→Size on mobile (EditorSteps rail); theme leads; export always available
- [x] Persistent Switch button in editor top bar + cross-mode style carryover

### Slice E — assets + analytics
- [x] ModeSelect example visuals — REAL renders from demo data (single 102k Hammersmith,
      London composite) via scripts/gen-mode-examples.mjs → public/assets/examples/{single,composite}.png
- [x] Analytics: output_mode_selected / output_mode_switched / editor_step_opened

### Verify
- [x] tsc clean; vite build clean; eslint touched = only 2 pre-existing baseline (App.tsx)
- [x] mobile smoke (scripts/smoke-mode-flow.mjs): ModeSelect → single browse (Suggested) →
      editor (steps rail) → Size step expands → Switch → composite browse (auto-include) →
      dispersion warning → composite editor. 0 page errors. Screenshots in /tmp/*.png
- [x] fixed old scripts/smoke-theme-strip.mjs to click through the ModeSelect gate

### Results (2026-06-14)
Shipped the cohesive redesign. New files: src/features/onboarding/{services/outputMode.ts,
ui/ModeSelect.tsx}, src/features/data-import/services/heroRuns.ts,
src/features/poster/ui/EditorSteps.tsx, scripts/smoke-mode-flow.mjs. Changed: App.tsx
(mode gate + Switch), ActivityBrowser (mode-aware rewrite), SettingsPanel (controllable
accordion + reorder Theme/Text/Size first), MobileSettingsSheet (stepsRail + expandRef),
PosterEditor (Switch + steps + carryover), server transform/strava-client + types/activity
(workoutType). Pricing untouched. Switch preserves theme/layers/size/title/display/bearing
via runink:posterStyle:v1; subtitle/km-markers intentionally not carried.

Working notes: mode at App level `outputMode: 'single'|'composite'`, starts null each
session so the choice fills the load wait (prev choice pre-highlighted). workout_type run
race=1, ride=11. Demo data spans the globe → composite always trips the dispersion warning.

---

## In progress: 300 DPI order renders time out on prod (2026-06-12)

Goal: paid print orders request 300 DPI via POST /api/render/order/:orderId; on the
1-vCPU/2GB DO box, SwiftShader WebGL at 3543×4724 px never reaches MapLibre idle
inside RENDER_TIMEOUT_MS=45s. Free exports were capped to 150 DPI as a workaround
(commit 0757d03) but the order path is still a landmine. Acceptance: a 300 DPI
30×40cm order render completes reliably under production CPU constraints, CI proves
it, and print quality is not silently degraded without a deliberate decision.

Key discovery: MapPreview doesn't set maxCanvasSize → MapLibre default 4096×4096
already clamps the WebGL canvas (~3072×4096 at "300 DPI") and CSS-upscales. The map
was never truly 300 DPI; only the DOM overlay (text/stats) benefits from the big
viewport.

- [x] Make RENDER_TIMEOUT_MS env-configurable (needed for measurement AND option c)
- [x] smoke-render.ts: accept SMOKE_DPI / SMOKE_WIDTH_MM / SMOKE_HEIGHT_MM / SMOKE_DSF
- [x] Measure in runink:flagtest Docker, --cpus=1 --memory=2g, server/+scripts/ mounted:
      - 30×40cm 150 DPI dsf1:  9.5 s  (baseline, matches CI behavior)
      - 30×40cm 300 DPI dsf1: 49.5 s  (completes! just over the 45 s budget locally;
        DO shared vCPU is slower → prod timeout confirmed as slowness, not hang)
      - 30×40cm 300 DPI dsf2: 23.5 s  (2.1× faster, output still 3544×4724)
- [x] MEASUREMENT VERDICT → option (a) deviceScaleFactor = dpi/150, PLUS raised
      timeouts. Decisive extra finding: dsf1 at 300 DPI lays out fixed-px overlay
      text in a 3543-px CSS viewport → stats text is an illegible micro-sliver
      (saw it in the PNG). dsf2 reproduces the proven 150 DPI layout (1772×2362
      CSS) exactly, at full print resolution — faster AND fixes WYSIWYG drift.
- [x] Measure worst case (all at --cpus=1 local; DO will be slower):
      - 50×70cm 300 DPI dsf2:   81 s (output 5906×8268 ✓)
      - 50×70cm 300 DPI dsf3.5: 50 s (CSS viewport ≈ 30×40 layout) → ~50 s of the
        a2 cost is output-pixel raster/PNG-encode, irreducible by dsf. a2 (and
        maybe a3) orders will exceed the ~100 s edge cap on DO even after this
        fix → needs async render-job + poll flow (logged as follow-up).
- [x] Implement: auto dsf = dpi/LAYOUT_DPI(150) in renderPoster (override stays
      for smokes); server default timeout 45 s → 120 s, env-overridable; client
      per-attempt timeout 60 s → 90 s (just under edge cap; aborting earlier
      than the server finishes wastes the render and burns a 2nd queue slot)
- [x] CI: 300 DPI smoke step + output-dimension assertion in smoke-render.yml
- [x] Verify: tsc ✓, lint touched files ✓ (3 pre-existing checkoutApi anys
      confirmed via stash); restarted CPU-limited container with auto-dsf code:
      150 DPI → dsf=1, 1772×2362, byte-identical PNG to pre-change (167369 B);
      300 DPI → dsf=2 auto, 3544×4724, 30 s cold (was 49.5 s + broken layout)

### Results (2026-06-12)

Changed (uncommitted, on fix/activity-ingestion-pagination):
- server/lib/poster-renderer.ts — auto deviceScaleFactor = dpi/150 (LAYOUT_DPI),
  RenderOptions.deviceScaleFactor override for smokes, RENDER_TIMEOUT_MS env-
  overridable with default 45 s → 120 s
- src/features/checkout/services/checkoutApi.ts — client per-attempt render
  timeout 60 s → 90 s
- scripts/smoke-render.ts — SMOKE_DPI/SMOKE_WIDTH_MM/SMOKE_HEIGHT_MM/SMOKE_DSF
- server/routes/render.ts — _smoke passes deviceScaleFactor through
- .github/workflows/smoke-render.yml — 300 DPI render step + PNG-dimension
  assertion (~3543×4724), both PNGs uploaded as artifacts

How verified: CPU-limited (--cpus=1 --memory=2g) runink:flagtest container with
live server/ mounted; measured before/after; 150 DPI output byte-identical;
300 DPI now full print px with the proven layout. tsc -b clean; eslint clean
modulo pre-existing baseline.

Follow-up (logged, not done): a2/a3 50×70 / 40×60 prints have ~50 s of
irreducible output-raster/encode cost at 1 CPU (81 s total for a2) → likely
exceed the ~100 s DO edge cap → need async render-job + poll. Also the editor
preview's CSS size differs from the 150 DPI layout viewport, so preview vs
print text proportions still drift — pre-existing, product call.
- Constraint noted: DO App Platform edge (Cloudflare-fronted) caps held-open
  requests ~100 s → client per-attempt timeout should stay just under that;
  if real DO renders exceed ~90 s the fix needs an async job + poll flow instead.
- Caveat to record: local arm64 M-series core ≫ DO shared vCPU; treat local --cpus=1
  timings as optimistic lower bounds, use ratios (300/150) not absolutes.

## In progress: progressive activity loading with live count (2026-06-11)

Goal: after the quick first page, the rest of the runs stream in page-by-page so the
activity list grows visibly and the sync pill shows a live count, instead of one
silent 10-30s background request that lands all at once. Acceptance: one Strava API
call per page total (no double-fetching), the server cache still ends up populated
with the complete list, rate-limit on a single-page fetch can't infinite-loop the
client, and `refresh=true` still does a full re-fetch.

Design: client drives pagination. Server accepts `?page=N` (N≥2) returning one
transformed page + `complete` flag judged on raw page size. Server assembles pages
into a per-athlete `pending` map (quick request seeds page 1) and promotes to the
real cache only when all pages 1..N arrived. Client loops pages until `complete`,
appending and re-rendering after each page; pill shows running count.

- [x] strava-client: add `startPage` option (single-page fetch = startPage=maxPages=N);
      429 with nothing accumulated throws instead of returning empty-incomplete
- [x] activities route: `?page=N` branch + pending-pages assembly → cache on completion;
      extract shared transform helper
- [x] stravaLoader: `page` option + `complete`/`page` in response type
- [x] useActivityData: replace single background full fetch with page loop (client-side
      page cap as infinite-loop guard); append + update state per page
- [x] App: pill shows live count ("Syncing… N runs so far")
- [x] Verify: tsc -b, lint touched files, extend scripts/check-strava-pagination.mts
      (single-page fetch, 429-throw case)

### Results (2026-06-11)

- Verified: `tsc -b` + `vite build` clean; eslint on touched files = same 5 pre-existing
  baseline errors (confirmed via git stash diff); `scripts/check-strava-pagination.mts`
  (7 cases) and NEW `scripts/check-activities-route.mts` (full route flow with stubbed
  Strava: quick → page 2 → page 3 → assembled-cache hit, exactly 1 Strava call/page,
  page=1 rejected 400) all pass.
- NOT implemented (needs a product decision): Strava webhooks + DB persistence for
  instant repeat loads — the privacy policy explicitly promises activity data is only
  cached in memory, never persisted. Changing that = privacy policy update + first
  database in the stack.

## Done: activity ingestion — partial-load bug + onboarding UX (2026-06-11)

Goal: connecting Strava loaded only the first 129 runs; full list appeared only after
manual refresh. Acceptance: quick first-page load stays fast, but the background full
fetch always fires when more pages exist, the cache is never poisoned with partial
data, and the UI tells the user the rest of their runs are still syncing.

Root cause: `isPartial` in server/routes/activities.ts compares the GPS-FILTERED count
(129) against the page size (200). A full raw page of 200 with <200 GPS activities is
misclassified as "last page" → `partial: false` → client skips the background full
fetch AND the partial result is cached as complete for 10 min. Bonus bug in the same
family: a rate-limited (429) full fetch also gets cached as complete.

- [x] Locate root cause (server/lib/strava-client.ts + server/routes/activities.ts)
- [x] strava-client: `fetchAllGpsActivities` returns `{ activities, complete }` based on
      raw page exhaustion (empty page or raw count < per_page), not filtered count
- [x] activities route: `isPartial = !complete`; only cache complete results
- [x] Client: expose `syncingMore` from useActivityIndex while the background full
      fetch is in flight; show a subtle "syncing the rest of your runs" pill in App
- [x] Verify: tsc -b, lint touched files, scripted pagination check with stubbed fetch

### Results (2026-06-11, branch fix/activity-ingestion-pagination)

- `fetchAllGpsActivities` now returns `{ activities, complete }`; `complete` is true only
  when Strava's raw page came back empty or short (< per_page). maxPages cutoff and 429
  rate-limit both leave it false.
- Route: `isPartial = !complete`; partial results (quick first page OR rate-limited full
  fetch) are returned but never cached — fixes both the skipped background fetch and the
  10-min poisoned cache.
- Client: `syncingMore` flag + floating pill ("Syncing the rest of your runs from
  Strava…") over the activity browser while the background full fetch runs.
- Verified: `tsc -b` clean; eslint on touched files shows only pre-existing baseline
  errors; `npx tsx scripts/check-strava-pagination.mts` (stubbed-fetch regression check,
  4 cases incl. the original 200-raw/129-GPS page) passes. Browser preview not run —
  preview MCP can't spawn processes in this env (see napkin) and repro needs a Strava
  account with >200 activities.

## Done: mobile black-export fix (2026-06-10)

Goal: free PNG exports on mobile come out black (map missing, stats sliver at bottom).
Root cause: capture renderer's blank-detection misses valid-but-black snapshots (iOS WebGL
context eviction); legacy canvas fallback lacks the iOS 16M-px area cap and renders an
offscreen MapLibre at full print resolution. Acceptance: free exports render via the
server Playwright path (device-independent), black snapshots are detected client-side,
and no client fallback can create an oversized canvas.

- [x] Diagnose root cause (see .claude/napkin.md)
- [x] Server: add `POST /api/render/export` — renders payload, streams PNG back (no order/R2)
- [x] Client API: `renderExportOnServer()` sharing retry/timeout machinery with paid path
- [x] PosterEditor: free export tries server first → capture → legacy canvas; watermark all
- [x] captureRenderer: pixel-sample snapshot for uniform/black instead of only `data:,`
- [x] Legacy renderer: add MAX_CANVAS_AREA (16M px) cap mirroring captureRenderer
- [x] Verify: tsc -b, vite build, lint touched files, local smoke render of export endpoint

### Results (2026-06-10)

- `POST /api/render/export` (server/routes/render.ts): session-gated, rate-limited
  (30/15min/IP), same validation as the order route (extracted into
  `validateRenderBody()`), streams PNG with `X-Render-Request-Id` header.
- `renderExportOnServer()` (checkoutApi.ts): retry loop extracted into
  `fetchRenderWithRetry()` shared with `renderPosterOnServer` (behavior unchanged).
- PosterEditor free-export chain: server → capture → legacy canvas; watermark applied
  to whichever blob wins; `export_completed` now carries `render_path` for Mixpanel
  rollout verification; payload building extracted into `buildServerPayload()` shared
  with the paid path.
- captureRenderer: `isCanvasBlank()` downsamples the map canvas to 48×48 and throws
  MAP_BLANK when every pixel is (near-)identical — catches iOS context-eviction black.
- Legacy renderer: 16M-px area cap added (note: also caps flag-off paid prints; a
  downscaled print beats a black one, and prod uses server render anyway).
- New `scripts/smoke-export.ts` + shared `scripts/smoke-fixture.ts`; dev-only
  `/_smoke-session` endpoint mints a fake session; CI workflow now runs the export
  smoke too.
- Verified: `tsc -b` clean; `vite build` clean (1.32 MB, no regression); eslint on
  touched files shows only pre-existing baseline issues; `smoke-render.ts` and
  `smoke-export.ts` both pass locally (byte-identical 165 KB PNG, export in 1.8 s);
  export PNG visually correct (route + styled stats); watermark smoke passes;
  endpoint 401s without session.
- Deployed 2026-06-11: commits 3ad2d13 + 5eea189 pushed, CI smoke (incl. new export
  smoke) green, DO deployment 42becd8d ACTIVE. Prod verified: /api/render/health 200,
  /api/render/export 401s without session (route live + flag on).
- REMAINING: on-device confirmation from a real phone — export a poster and check
  `export_completed.render_path === 'server'` in Mixpanel (project 4005642).

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
