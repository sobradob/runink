# Preview ↔ Render fidelity analysis (mobile-focused)

**Goal:** explain *why* the editor preview (especially on phones) looks different from
the final rendered output, rank the biggest divergences, and define a repeatable
local test to measure them. No Strava needed — use demo data.

---

## TL;DR

The architecture is *intended* to be WYSIWYG: the live editor preview and the
server render mount the **same** React components (`MapPreview` + `StatsOverlay`)
with the **same** payload (`buildServerPayload`). For one whole class of elements it
works — for two others it provably does not.

| Element | Unit used | Scales with poster size? | Preview vs render |
|---|---|---|---|
| Title / subtitle / stats / coords | `cqw` (% of container width) | ✅ yes | **Matches** |
| Route line (core + glow) | fixed MapLibre px (2.5 / 8) | ❌ no | **Diverges — thicker in preview** |
| Markers: emoji / dot / label | fixed CSS px (20 / 10 / 9-10) | ❌ no | **Diverges — bigger in preview** |
| Basemap roads | zoom-interpolated px | partially (via zoom) | **Diverges — busier/wider in render** |
| Emoji glyph style | system emoji font | n/a | **Diverges — Apple (iPhone) vs Noto (Linux render)** |

The root cause is a **viewport-width mismatch**: the editor map is ~340–380 px wide
on a phone; the server render lays out at 150 DPI, i.e. **1080 px** wide (Instagram
default) up to **1772 px** wide (30×40 cm print). Anything sized in fixed pixels keeps
its absolute size while the poster around it grows 3–5×, so it shrinks *relative to the
poster*. Text was already fixed for this (it moved to `cqw`); the route line and the
markers were not. **Mobile is the worst case** because the preview map is the smallest
there, so the fixed-px elements look their largest relative to the poster.

---

## The mechanism, with numbers

`server/lib/poster-renderer.ts`: `LAYOUT_DPI = 150`; CSS viewport width =
`mmToPx(widthMm, 150)`. `mmToPx(mm,dpi) = (mm/25.4)*dpi`.

- **Instagram (183×229 mm, default):** layout width = `(183/25.4)*150 ≈ 1080 px`
- **30×40 cm print:** layout width = `(300/25.4)*150 ≈ 1772 px` (300-DPI output via
  `deviceScaleFactor = 2`, but the *layout* stays 1772 px — see napkin note)

Mobile editor preview map width ≈ **360 px** (portrait poster: container maxWidth =
`60 * aspectRatio` vh, ~48vh on an iPhone; `PosterEditor.tsx:486`).

Route core line is `'line-width': 2.5` fixed (`runPathLayer.ts:53`):

| | mobile preview (360px) | IG render (1080px) | 30×40 render (1772px) |
|---|---|---|---|
| core line as % of poster width | 0.69 % | 0.23 % (**3× thinner**) | 0.14 % (**5× thinner**) |
| glow (8px) | 2.2 % | 0.74 % | 0.45 % |
| start/finish emoji (20px) | **5.6 %** | 1.9 % | 1.1 % |
| marker label (10px) | 2.8 % | 0.93 % | 0.56 % |

So on a phone the runner sees a **bold, dominant route line** and **chunky markers**;
the print comes back with a **thin, delicate line** and **tiny markers/labels**. That
is exactly the reported "line thickness" gap, and it is worst on mobile.

Compounding it: the route line width is **fixed** (not zoom-interpolated), but the
**basemap roads ARE zoom-interpolated** (`maplibreStyle.ts:89,102,115`). Fitting the
same geographic bounds into a wider render viewport makes MapLibre pick a **higher
zoom**, which (a) widens basemap roads toward their interpolation cap and (b) reveals
more roads/detail. Net effect: in the render the **basemap gets busier and heavier
while the route line gets thinner** — the figure/ground relationship the user tuned in
the editor inverts.

---

## Ranked list of the biggest differences

1. **Route line thickness (highest impact).** Fixed 2.5/8 px → 3–5× thinner relative
   to the poster in the render than in the mobile preview. `runPathLayer.ts:38,53,75,81`.
2. **Marker emoji / dot / label size.** Fixed 20/10/9-10 px → ~5× bigger in mobile
   preview than in print. Markers that look right in the editor become specks in the
   print. `MapPreview.tsx:302,309,323`.
3. **Emoji glyph style.** Preview on iPhone uses Apple emoji; server render is Linux
   Chromium (Playwright jammy image, `Dockerfile:13`) → Noto Color Emoji *if installed*,
   tofu/monochrome if not. 🏁❤️⭐ look materially different even in the best case. **Verify
   the font is present in the image** (see test plan step 6).
4. **Basemap density / road weight.** Higher render zoom → busier, heavier basemap vs
   the sparser mobile preview. Zoom-interpolated roads, `maplibreStyle.ts:89,102,115`.
5. **Marker-label vs stats-label inconsistency.** Stats labels are `cqw` (stay ~3% of
   poster); marker labels are fixed px (collapse to ~0.5%). In the render the two label
   systems no longer look like the same family.
6. **(Lower) Font flash / metrics.** Custom fonts (Bebas Neue, Space Grotesk) are the
   same and the render waits on `document.fonts.ready` (`InternalRenderPage`), so these
   should match — confirm, don't assume.

What already matches (don't touch): all `StatsOverlay` text, framing/zoom-to-fit
(geographic `fitBounds` padding 0.15, viewport-independent), theme colors, gradient.

---

## Test plan — measure the gap locally (no Strava)

### Mobile emulation: recommendation
Use **Playwright device emulation**, not manual Chrome resizing. It's what the existing
smoke scripts already do, it's scriptable/repeatable, and — critically — it sets
`deviceScaleFactor`, `isMobile`, `hasTouch` and the real CSS viewport, which manual
window-resizing does not. Reference configs already in the repo:
- iPhone 12/13: `{ width: 390, height: 844, deviceScaleFactor: 2 }` (`smoke-theme-strip.mjs`)
- iPhone 16 Pro: `{ width: 402, height: 874, deviceScaleFactor: 3 }` (`smoke-mobile-editor.mjs`)

Keep a **real iPhone** in the loop for *one* thing only: confirming emoji glyph style
and font rendering, which headless Linux Chromium cannot reproduce.

### Steps
1. **Build demo app:** `VITE_USE_DEMO_DATA=true npx vite build --outDir dist-demo`
   (1,253 GPS tracks available offline; default single = 102 km Hammersmith run).
2. **Boot render server:** `NODE_ENV=development ENABLE_SMOKE_ENDPOINTS=true ENABLE_SERVER_RENDER=true PORT=8099 node --import tsx server/index.ts`
3. **New harness `scripts/compare-preview-render.mjs`** that, for each test case:
   a. Drives the demo editor at an iPhone viewport (390×844 / 402×874), sets the config
      (theme, size, markers, toggles), screenshots `[data-poster-root]` → *preview PNG*.
   b. Builds the identical payload, POSTs to `/api/render/_smoke` (or `/seed` +
      `/internal/render-poster/:token`) → *render PNG*.
   c. Normalizes both to the same width (e.g. 800 px), overlays + runs `pixelmatch`
      → diff PNG + % difference, broken down (whole-poster, route-only, marker-only).
4. **Test matrix** (iterate the real registries):
   - **Themes ×10:** `src/data/themes.json` (noir, midnight-blue, japanese-ink,
     blueprint, coral, sage, neon, copper, arctic, terracotta).
   - **Sizes:** Instagram (default, dpi 150) + 30×40 + 50×70 (dpi 300) — the DPI/viewport
     axis is where line/marker divergence is largest.
   - **Markers:** none / dots only / each emoji (🏠📍❤️⭐🏁⬤) / km markers / start+finish.
   - **Toggles:** stats on/off, coordinates on/off, each layer on/off, compilation mode
     (line widths change to 1.5/6).
   - **Devices:** iPhone 390×844 @2 and 402×874 @3, plus one desktop 1366×1024 baseline.
5. **Output:** a contact-sheet HTML (preview | render | diff, side by side per case)
   + a CSV of diff-% so the worst offenders rank themselves. Put artifacts in
   `/tmp/preview-render/` and a summary table in this file's Results section.
6. **Emoji-font check:** `docker run --rm <image> fc-list | grep -i emoji` (and a
   render of all 6 emoji markers) to confirm Noto Color Emoji is present and what 🏁
   actually looks like server-side vs on the phone.

### Reuse
- `scripts/smoke-fixture.ts` — payload shape + `smokeDimensions`/`SMOKE_DPI` overrides.
- `scripts/smoke-render.ts` — server render call (PNG out).
- `scripts/smoke-theme-strip.mjs` / `smoke-mobile-editor.mjs` — mobile editor driving
  (ModeSelect → browse → editor) + the `:visible` selector caveat (napkin).
- No diff lib exists yet → add `pixelmatch` + `pngjs` (dev-only) or `sharp`.

---

## Candidate mitigations (for later — analysis first)

Cheapest → most involved. None required yet; listed so the analysis points somewhere.

- **A. Scale line + markers by render width (the real fix).** Express route
  `line-width` and marker sizes as a function of the map's pixel width relative to the
  ~400px reference (the same trick `cqw` does for text). A shared
  `scaleForWidth(px) = base * (mapWidthPx / 400)` used by both `MapPreview` and
  `InternalRenderPage` makes the line and markers proportional → preview = render.
  This is the single change that closes #1, #2 and #5.
- **B. Render markers/labels in `cqw` like the stats overlay** instead of MapLibre HTML
  markers in fixed px (or keep MapLibre positioning but size the inner elements off the
  container width). Closes the marker-label family inconsistency (#5).
- **C. Guarantee + match the emoji font** (#3): install `fonts-noto-color-emoji` in the
  image if missing; accept that iPhone-Apple vs Noto will still differ → consider
  shipping our own SVG marker icons instead of system emoji so *every* surface is
  identical (closes #3 permanently).
- **D. Communicate, don't fix (fallback).** If we choose not to change rendering: show
  a true-to-scale preview note, or render the editor preview at a fixed reference width
  and letterbox it, so what the user sees is the render's proportions. Lowest effort,
  but leaves the editor feeling "off."

---

## Results — MEASURED (harness run 2026-06-27)

Harness: `scripts/compare-preview-render.mjs`. Method: seed one payload (real demo
activity — LA Base, 7.85 km loop), screenshot the same `InternalRenderPage` at a phone
width (360px) vs the real 150-DPI layout widths (1081px IG, 1772px print). Artifacts in
`/tmp/preview-render/` (`contact.html`, `measurements.csv`, per-theme PNGs).

### B) Element size as % of poster width (the core evidence)

| Element | preview @360 | render @1081 (IG) | render @1772 (print) | verdict |
|---|---|---|---|---|
| Title (cqw) | 6.00% | 6.00% | 6.00% | **matches** ✅ |
| Subtitle (cqw) | 3.50% | 3.50% | 3.50% | **matches** ✅ |
| Stat value (cqw) | 3.00% | 3.00% | 3.00% | **matches** ✅ |
| Marker emoji (fixed px) | **5.56%** | 1.85% | 1.13% | **3.0×–4.9× smaller in render** ❌ |
| Marker label (fixed px) | **2.78%** | 0.93% | 0.56% | **3.0×–5.0× smaller in render** ❌ |
| Marker stack height | **11.67%** | 3.89% | 2.37% | a marker eats 11.7% of poster width in the phone preview, ~2.4% in print ❌ |

### C) Route-ink coverage (basemap off, noir white line)

| | preview @360 | render @1081 | render @1772 |
|---|---|---|---|
| route-ink (% of poster area) | 1.916% | 0.818% | 0.624% |
| line thickness vs preview | 1.0× | **2.3× thinner** | **3.1× thinner** |

### A) Visual contact sheet (10 themes, IG size, full features)

Whole-poster pixel-diff 3.9%–7.6% across all 10 themes — but the *visible* story (see
`contact.html`) is consistent: the render has a **thinner route line**, **tiny markers**,
and a **much busier basemap** (more buildings/roads appear at the higher render zoom)
than the phone preview, while all text holds its proportion. noir is the clearest example.

### Conclusion
Findings #1, #2, #4, #5 from the analysis are **confirmed quantitatively**. Text (#6
class) is genuinely WYSIWYG. The fix that closes the gap is mitigation **A**: scale route
`line-width` and marker/label sizes by the map's pixel width relative to the ~400px
reference (the same normalization `cqw` already does for text). Emoji glyph-style (#3)
still needs the real-iPhone check + Docker `fc-list` (not covered by this Linux-only run).

## FIX APPLIED (mitigation A) — 2026-06-27

Scaled all fixed-px run-path + marker sizes by `posterScale(map) = mapWidthPx / 400`
(the same 400px reference `cqw` uses for text), computed inside `MapPreview` from its own
container width — so the editor preview (~360px) and the render (1081/1772px) each scale
correctly with no call-site coordination, because both mount the same `MapPreview`.

- `runPathLayer.ts`: added `POSTER_REFERENCE_WIDTH` + `posterScale()`; `addRunPathLayers`
  and `updateRunPathColors` now multiply line-width (+ blur) by the scale. `updateRunPathColors`
  is now the single source of truth for color/opacity/width/blur (re-callable on resize).
- `MapPreview.tsx`: `syncHtmlMarkers` scales emoji/dot/border/label/shadows by the scale;
  added a debounced `ResizeObserver` re-style so switching poster size in the editor
  rescales the line + markers (the render always mounts fresh, so it's correct already).

**Verified (re-ran harness after `npm run build`):**

| metric | before (preview/IG/print) | after |
|---|---|---|
| marker emoji % of width | 5.56 / 1.85 / 1.13 | **5.00 / 5.00 / 5.00** ✅ |
| marker label % of width | 2.78 / 0.93 / 0.56 | **2.50 / 2.50 / 2.50** ✅ |
| route-ink coverage % | 1.92 / 0.82 / 0.62 | **1.75 / 1.84 / 1.84** ✅ |
| line thickness ratio | 1.0× / 2.3× / 3.1× | **1.0× / 0.9× / 0.9×** ✅ |
| contact-sheet pixel-diff | 4–8% | **2–6%** (residual = basemap density, #4) |

Also: `npm run build` green (tsc+vite); real render pipeline `scripts/smoke-render.ts`
(CI smoke) produces a valid 217 KB PNG; no new lint errors (baseline already red).

**Still open (out of scope of this fix):** #3 emoji glyph style (Apple vs Noto — needs
real-iPhone + Docker `fc-list` check) and #4 basemap density/zoom difference (render fits
at a higher zoom → busier basemap; a separate, harder change).

### Harness bugs found & fixed while running
- Payload tokens are **single-use** (consumed on first `/api/render/payload/:token`
  fetch). First run reused one token for both captures → the second got `payload 404`
  (black error page). Fixed: seed a fresh token per capture. (Sections B/C already did.)
