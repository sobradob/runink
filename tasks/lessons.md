# Lessons Learned

## 2026-05-22: Strava OAuth approval_prompt=auto is a foot-gun for required scopes
**Failure mode:** First real customer connected Strava, name showed in header, then every activities fetch returned 500 (server got 401 from Strava). Strava had issued a token without `activity:read_all` because the user unchecked the "View data about your activities" box on the consent screen. With `approval_prompt=auto` the user can never re-grant — Strava silently reissues the prior narrower scope on every subsequent connect.
**Detection:** Production logs showed `Strava API error: 401` ~80 ms after every fetch. The fast turnaround (not a timeout) plus the user being freshly-connected pointed at scope rather than expiry. Confirmed by reading Strava's docs about `approval_prompt`.
**Prevention:**
1. Use `approval_prompt=force` for any scope you actually require — never trust that previous authorizations cover what you need now.
2. Log the granted `scope` field from the token exchange response.
3. Assert required scopes at the auth callback; redirect to a `?strava=missing_scope` error route instead of writing a useless session.
4. When Strava returns non-2xx, log the response body — Strava's error body says exactly what's missing (e.g. `"field":"activity:read_permission","code":"missing"`).
5. Return a typed `code` (e.g. `STRAVA_MISSING_SCOPE`) from the API so the UI can render a targeted recovery prompt, not "HTTP 500".

## 2026-05-22: Three things must be true before a server-side render screenshots
**Context:** The server-side Playwright render shipped in this session signaled `__POSTER_READY__` after MapLibre double-idle, but the screenshot could still race with the web-font swap and capture fallback glyphs. The problem manifests subtly — text is the *right shape* but not the *right font*, easy to miss until print.
**Prevention:** Before letting Playwright screenshot, await ALL of:
1. `map.once('idle')` twice (tile composite + no pending repaint)
2. `await document.fonts.ready` (font swap settled)
3. one `requestAnimationFrame` (StatsOverlay composited)
Set `font-display: block` on every `@font-face` so layout uses invisible glyphs until the font lands, preventing fallback-glyph FOUT on slow networks.

## 2026-05-22: Retry on the client, idempotency on the server
**Context:** A render submit that fails on a transient 503 (queue busy) used to throw, leaving the user stranded after the order was already created. Naïve retry would double-create orders if the failure happened before render.
**Prevention:** Make the *first* mutation (createDirectOrder) idempotent at the client by stashing the orderId in a ref. Subsequent retries reuse the same id so the server sees one order. The server endpoint should also be idempotent at the storage layer — `orders/${orderId}/poster.png` is a stable key so re-rendering overwrites. AbortController on the client gives a clean cancel path for unmount/navigate-away.

## 2026-05-22: Cross-device render parity comes from one renderer, not careful coding
**Failure mode:** A client-side Canvas-2D re-implementation (`renderPosterToBlob`) of the React/MapLibre preview drifted from the preview over time — different fonts, line caps, gradient opacities. Compounded by iOS Safari's 16M-px canvas cap. Paying customers received prints that didn't match what they customised.
**Detection:** User-visible — mobile orders looked different from desktop orders, and prints looked different from previews.
**Prevention:** Don't try to keep two renderers in sync. Use the SAME components for preview and for the output by rendering server-side in a fixed Linux Chromium (Playwright). The render environment is the only thing that needs to be consistent; WYSIWYG becomes a property of the architecture instead of careful coding. A 2 GB instance is the floor for headless Chromium (0.5 GB OOMs).

## 2026-05-22: `VITE_*` env vars are build-time, not runtime
**Failure mode:** Easy to assume DO env var flips activate immediately. Vite bakes `VITE_*` vars into the JS bundle at `vite build`, so any flag with that prefix requires a redeploy to take effect.
**Prevention:** Decouple client-side and server-side flags. Use `VITE_RENDER_ON_SERVER` (build-time, in the bundle) AND a separate runtime `ENABLE_SERVER_RENDER` (server-side, runtime check). Both must be true. Stale clients can't accidentally invoke an unprepared server; a runtime flag flip on the server still requires a client rebuild to actually route customer traffic.

## 2026-03-24: DigitalOcean DNS CNAME hostnames
**Failure mode:** SES DKIM verification failed because CNAME records had doubled domain suffix.
**Detection:** `dig` queries returned empty for DKIM records.
**Prevention:** When adding CNAME records in DigitalOcean DNS, strip the parent domain from the hostname — DigitalOcean appends it automatically. E.g., enter `foo._domainkey` not `foo._domainkey.runink.app`.

## 2026-03-24: Privacy policy for API access programs
**Context:** Garmin Connect Developer Program requires privacy policy, homepage, and admin email to share the same parent domain. The policy must be externally accessible and linked from the homepage.
**Key requirements:**
- Personalized email (firstname@domain), not generic (info@, support@)
- Privacy policy must describe how API data is used
- Domain must be owned by the requesting company
- All three (email, homepage, policy) must share parent domain

## 2026-03-24: AWS SES for custom domain email
**Setup:** Can reuse existing SES SMTP credentials for new domains. Just add the domain as a verified identity in SES, add DKIM CNAME records to DNS, then configure Gmail "Send mail as" with the same SMTP server/credentials.

## 2026-04-05: Deploy branch mismatch — always verify what branch production is tracking
**Failure mode:** Code changes were on `main` but DO App Platform was deploying from `strava-only` branch. The Coming Soon gate existed in source but never reached production.
**Detection:** User reported the gate wasn't working on production. Source code looked correct. Checked DO app spec and found `branch: strava-only`.
**Prevention:**
- After changing deployment branches, verify the app spec matches. Check the DO dashboard or app spec YAML.
- When gating features, verify the gate works on production after deploy — not just locally.
- Also: set `Cache-Control: no-cache` on `index.html` so stale HTML doesn't keep serving old JS bundles even after a successful deploy.

## 2026-04-08: DigitalOcean component-level env vars override app-level
**Failure mode:** `STRAVA_REDIRECT_URI` was correct at the app level (`runink.app`) but a stale component-level variable with `ondigitalocean.app` was overriding it. Runtime saw the wrong value.
**Detection:** Added startup logging that prints the env var value in production. Compared runtime log output to dashboard setting.
**Prevention:** When debugging env var issues on DigitalOcean, always check **both** app-level and component-level variables. The DO dashboard says "A component variable with the same key will override an app-level value." Also: always log critical env vars at startup, even in production.

## 2026-04-16: `tsc --noEmit` doesn't catch all errors `tsc -b` does
**Failure mode:** Pushed 4 commits after running `npx tsc --noEmit` (which passed). DO production build failed because `tsc -b && vite build` caught a missing required field that `--noEmit` didn't flag.
**Detection:** DO dashboard showed two consecutive "Build failed" messages for commits d467b65 and 3aa1731.
**Prevention:** Before pushing, run `npm run build` — not just the typecheck. The production build uses project references (`-b`) with stricter incremental resolution. CI now runs `npm run build` on every push and PR (`.github/workflows/build.yml`), so this failure mode is caught before it reaches production.

## 2026-04-16: Verify deploy status after pushing to main
**Failure mode:** Pushed 4 commits and considered the work "done." DO build failed silently — the broken deploy sat for ~14 hours until the user happened to check the DO dashboard.
**Detection:** User noticed "Build failed" notifications in DO dashboard the next day.
**Prevention:**
- CI workflow (`.github/workflows/build.yml`) catches build failures before DO even tries.
- After any push to main, check deploy status within a few minutes. Either via DO dashboard or `doctl apps list-deployments <app-id>`.
- Don't declare work "shipped" until a successful production deploy is confirmed.
