# Lessons Learned

## 2026-06-18: In a git worktree, Edit the worktree path — not the bare repo root (BOA-119)
**Failure mode:** Working on branch `claude/sad-satoshi-a8cbe3` in a worktree under
`.../runink/.claude/worktrees/sad-satoshi-a8cbe3/`, I passed Read/Edit/Write
`file_path`s as `/.../runink/src/...` (the *main* checkout) instead of
`/.../runink/.claude/worktrees/<wt>/src/...`. All edits landed in the main working
tree (on an unrelated branch); the worktree's tracked files stayed unchanged.
**Detection:** `git diff --stat` in the worktree was empty after "finishing"; the
dev server (launched with cwd=worktree) served the OLD code, so verification
passed *despite* the fix not being present.
**Prevention:**
- Derive the absolute base once (`git rev-parse --show-toplevel`) and prefix every
  Edit/Write/Read `file_path` with it. Never hand-type the non-worktree root.
- Before declaring done, run `git status`/`git diff --stat` in the worktree and
  confirm the intended files actually show as modified there.

## 2026-06-18: A passing verification proves nothing unless it reproduces the bug (BOA-119)
**Failure mode:** First verification of the composite default-title fix passed —
but on a fresh browser with empty localStorage, the *old* code also computes a
sensible title (the bug needs a pre-existing carryover). And the basemap-race fix
"passed" only because slow navigation let the old async resolve win the race. The
test was green against unfixed code.
**Prevention:** For a regression fix, the verification must first *reproduce* the
failure, then show it gone. Here: seed `localStorage` `runink:posterStyle:v1` with
the stale title; assert the new poster ignores it. For the tile race: assert ZERO
requests to the empty bare-pattern `/planet/{z}/{x}/{y}.pbf` and ZERO 200/0-byte
tiles — don't just check "a basemap appeared."

## 2026-06-17: Demo-data poster generators need `public/data/` (gitignored)
**Context:** The Playwright generators (`scripts/gen-mode-examples.mjs`, `gen-landing-themes.mjs`) drive the app in `VITE_USE_DEMO_DATA=true` mode, which fetches the demo dataset from `/data/index.json` + `/data/tracks/`. That dir (`public/data/`) is **gitignored**, so it's absent in fresh worktrees.

**Failure mode:** generator times out waiting for an editor selector; the real cause is "Failed to load data — Unexpected token '<' … is not valid JSON" — the static server's catch-all returned `index.html` for the missing data file, and `res.json()` choked.

**Prevention:**
- Before running any demo-mode generator in a worktree, symlink the data from a checkout that has it: `ln -s /path/to/runink/public/data public/data` (gitignored, safe), then rebuild `dist-demo`.
- When a Playwright setup step times out on a selector, screenshot the page first (`page.screenshot` in a try/catch) — the on-screen error message is the fastest path to root cause.
- The preview MCP server can fail with `EPERM: uv_cwd` in sandboxed worktrees; fall back to serving the built `dist/` and screenshotting via Playwright.

## 2026-05-22: Mixpanel `client_error` event schema
**Context:** Errors flow through `src/shared/diagnostics/errorReporter.ts`'s `reportError(err, ctx)` and land in Mixpanel as `client_error` events. Use this schema when building Mixpanel dashboards or funnels — don't reverse-engineer it from the code.

**Property reference:**
| Property | Type | Notes |
|---|---|---|
| `error_name` | string | e.g. `RenderError`, `StravaLoaderError`, `TypeError` |
| `error_message` | string | Truncated to 500 chars |
| `error_source` | enum | `boundary` (React crash) / `unhandled_promise` / `window_error` / `render` / `strava` / `order` / `other` |
| `error_code` | string \| null | Typed code where present (e.g. `STRAVA_MISSING_SCOPE`) |
| `http_status` | number \| null | The server status when applicable |
| `request_id` | string \| null | Server-side correlation — grep DO logs for this |
| `retryable` | boolean \| null | Only meaningful on `error_source=render` |
| `build_sha` | string | Inlined at vite build time |
| `build_time` | string | Inlined at vite build time |
| `env` | string | `dev` / `prod` |
| `url` | string | pathname + search |
| `viewport` | string | `WxH@dpr` |
| `user_agent` | string | Full UA |
| `online` | bool | `navigator.onLine` at capture |
| `stack` | string | Truncated to 1500 chars |

**Useful funnels to build:**
- "Hit error → reconnected → succeeded" (does the amber Strava banner work?)
- "Hit render error → retried → succeeded" (is auto-retry sufficient, or do users have to manually retry?)
- "Hit error" segmented by `build_sha` (did the last deploy introduce a regression?)
- "Hit error" segmented by `user_agent` substring "iPhone" vs "Android" vs desktop (which platform is brittlest?)

**Dedup behaviour:** Identical errors (same source + name + message + first stack line) within 30 s are suppressed locally. The first occurrence IS sent; later ones increment an in-memory counter that nothing currently reads. If you need accurate "fired N times" counts during a burst, query Mixpanel's event count directly — don't rely on a per-event counter property.

## 2026-05-22: Mixpanel `server_error` event schema (server-side companion)
**Context:** Server-side errors flow through `server/lib/error-reporter.ts`'s `reportServerError(err, ctx)` and land in Mixpanel as `server_error` events. Different event name from the client (`client_error`) so dashboards stay unambiguous; **join on `request_id`** to see both sides of the same failed request.

**Property reference:**
| Property | Type | Notes |
|---|---|---|
| `error_name` | string | e.g. `StravaApiError`, `RenderBusyError`, `TypeError` |
| `error_message` | string | Truncated to 500 chars |
| `error_scope` | string | Where in the code, e.g. `render.order`, `activities`, `express.error_handler`, `process.uncaughtException` |
| `request_id` | string \| null | Same ID returned to the client — grep DO logs OR join to `client_error` events in Mixpanel |
| `http_status` | number \| null | Status code we returned to the client |
| `route` | string \| null | Express route pattern, e.g. `/api/render/order/:orderId` |
| `method` | string \| null | HTTP method |
| `duration_ms` | number \| null | How long the failed operation took |
| `env` | string | `production` / `development` |
| `node_version` | string | e.g. `v20.18.0` |
| `stack` | string | Truncated to 2000 chars |

**Coverage:**
- Explicit calls at 5xx paths in `routes/render.ts` (render failures) and `routes/activities.ts` (Strava failures, including the missing-scope 403)
- Express last-resort error handler in `server/index.ts` — catches anything that threw without a try/catch
- `process.on('uncaughtException')` and `process.on('unhandledRejection')` — catches anything that escaped Express entirely

**Useful joined funnels:**
- "Render failed end-to-end" — count distinct `request_id` where BOTH `client_error{source=render}` AND `server_error{scope=render.order}` fired. If only server fires, the client retried successfully on attempt 2/3. If only client fires, network died before the request landed.
- "Strava is having a bad day" — count `server_error{error_scope=activities}` by hour, broken down by `error_name`. A spike with `error_name=StravaApiError` and no change to our deploy = problem at Strava's end.
- "Uncaught server bug" — `server_error{error_scope IN ('express.error_handler', 'process.uncaughtException', 'process.unhandledRejection')}`. Anything here is by definition a latent bug that escaped every guard — page yourself on it.

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

## 2026-06-11: BUILD_TIME env vars need explicit ARG declarations in Dockerfile builds
**Failure mode:** Switching from buildpack to Dockerfile deployment (2026-05-22) silently disabled `VITE_RENDER_ON_SERVER`. DO passes BUILD_TIME env vars to Docker builds as build args, but build args are invisible unless the Dockerfile declares a matching `ARG`. Vite folded the undefined flag to `false` and dead-code-eliminated the entire client-side server-render path. Paid orders silently reverted to the legacy client renderer for ~3 weeks; the mobile black-export fix shipped 2026-06-11 was inert on arrival.
**Detection:** Mobile export still black after deploy. Mixpanel `export_completed.render_path` said `capture`; production logs had zero `render.export` entries; DO app spec showed the var correctly set. Definitive proof: `grep -c "render/export" <prod bundle>` → 0 (dead-code-eliminated) vs 1 in a local build with the flag set.
**Prevention:**
- Every `VITE_*` BUILD_TIME var in the DO spec needs `ARG X` + `ENV X=$X` in the Dockerfile before `npm run build`.
- The env-var *spec* being right proves nothing about the *bundle*. Verify behaviorally: grep the built bundle for a marker string that only survives DCE when the flag is on. CI now asserts this (`smoke-render.yml` "Assert client bundle has the server-render path").
- Flag-gated client features deserve a telemetry property (like `render_path`) from day one — it's what made this diagnosable in one query.
