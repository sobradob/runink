# RunInk — The Editing Flow

This document describes, in detail:

1. **App context** — what RunInk is and the journey that leads a user into the editor.
2. **The editing flow** — every screen, state, control, and code path involved in turning a run into a finished poster.
3. **An editor-agent brief** — a complete, ready-to-hand-off "full path" for an agent tasked with improving the editing-flow UX.

---

## 1. App context — what RunInk is

RunInk turns a runner's GPS activities (from **Strava** or **Garmin**) into a stylised **map poster** that can be exported as a free digital image or ordered as a printed poster. It is a mobile-first React + TypeScript + Vite single-page app with an Express/Node backend.

### High-level architecture

| Layer | Where | Responsibility |
| --- | --- | --- |
| Client SPA | `src/` | Onboarding, activity browsing, the poster **editor**, checkout |
| Server | `server/` | Strava OAuth + sync, Garmin file loading, server-side poster render (Playwright), orders (Gelato/Printful), payments (Stripe), HD-export email delivery |
| Render-on-server surface | `src/features/poster/render/InternalRenderPage.tsx` | A pristine, app-shell-free page Playwright screenshots to produce device-independent exports/prints |

The client is organised by feature (`src/features/<feature>/{ui,services,hooks,infrastructure}`):

- `onboarding` — landing page + `ModeSelect`
- `data-import` — Strava/Garmin loaders, the `ActivityBrowser`
- `theme` — theme gallery/strip + per-route theme previews
- `poster` — **the editor** (this document's subject), the renderers, export logic
- `checkout` — order, gift, redeem, HD-export, success/status pages
- `map` — the MapLibre preview layer
- `diagnostics` / `legal` — overlays and static pages

### The journey into the editor (`src/App.tsx`)

`App.tsx` is a hand-rolled view router (a `View` union + `getInitialView()` reading `window.location`), not React Router for the main shell. The path to the editor:

1. **Landing** (`LandingPage`) — shown when not connected to Strava. Owns the "Connect with Strava" CTA.
2. **Mode gate** (`ModeSelect`) — once connected but before browsing, the user picks an **output mode**:
   - `single` → editor mode `individual` (one hero run)
   - `composite` → editor mode `compilation` (many runs overlaid)
   - The choice is stored via `saveOutputMode()` and is **switchable any time** afterwards. The gate is shown *during* the Strava load so the unavoidable wait is productive.
3. **Activity browser** (`ActivityBrowser`) — the user selects one run (`onSelectSingle`) or several (`onSelectMultiple`), which sets `view` to `individual`/`compilation` and mounts the editor.
4. **Editor** (`PosterEditor`) — the subject below.

Cross-cutting App-level concerns: a diagnostics overlay (logo long-press), an offline toast, gift context (`giftContext`), and a persistent **Switch** action (`switchMode`) that flips output mode and returns to the browser, preserving styling via the editor's carryover (see §2.7).

---

## 2. The editing flow in detail

Everything below lives under `src/features/poster/ui/` unless noted. The orchestrator is **`PosterEditor.tsx`**; it composes the live preview, the desktop settings sidebar, and the mobile bottom sheet, and owns all export/order wiring.

### 2.1 Entry & props

`PosterEditor` is mounted by `App.tsx` with either an `activity` (individual) or `activities[]` (compilation), the `mode`, the in-memory `stravaTracksMap`, an `onBack`, the `onSwitchMode`/`switchTargetLabel` for the Switch button, and an optional `giftContext` (gift redemption locks the poster size to the gifted tier).

The component **re-mounts whenever the selected activity set changes** (a deliberate design choice — see the one-shot `restored` initializer), so each poster gets a clean editor instance.

### 2.2 Initial state: draft restore → carryover → defaults

State is resolved on mount with a strict precedence so the user never sees a flash of defaults and never loses work:

1. **Persisted draft** (`readDraft`, `usePersistedDraft.ts`) — keyed by `draftKey(mode, ids)` (mode prefix + sorted activity IDs). If a draft exists for *this exact run set*, it wins entirely. Drafts are versioned and debounced (500 ms), with a synchronous `pagehide` flush so a backgrounded/killed mobile tab still saves. This is the "I customised for 10 minutes then switched apps" safety net.
2. **Cross-mode carryover** (`loadPosterStyle`, `outputMode.ts`) — consulted only when there is no draft. Carries the **style axis** across a Switch: `themeId`, `layers`, `dimensionsLabel`, `showStats`, `showCoordinates`, `showGradientFade`, `bearing`. Deliberately **not** carried: title, date subtitle, km markers, the run set — these are per-poster content (carrying a race title onto every later poster was a real bug).
3. **Defaults** — theme `noir`, `DEFAULT_PRESET` (Instagram 4:5 @ 150 DPI — the cheap, fast, share-first size), title derived from the run's `location`/`name`, subtitle from its date, all layers on.

A **gift size always overrides** any carried/default dimension (`presetForTier`).

The editable state is split across:
- `config: PosterConfig` (theme id, dimensions, title, subtitle, display toggles, padding, bearing, layers, custom markers)
- `theme: Theme` (derived from `config.themeId`; we persist the **id**, not the object, so a deploy that changes theme shapes can't leave stale colour data)
- `showKmMarkers` / `showStartFinish` (auto-marker toggles, individual mode only)

Two persistence effects run continuously: `usePersistDraft` (the per-run-set draft) and a `savePosterStyle` effect (the cross-mode carryover, style axis only).

### 2.3 The live preview (WYSIWYG)

The center of the editor is a single preview node (`previewContainerRef`) sized by the poster's aspect ratio, with `containerType: inline-size` set so the overlay text scales in **`cqw` units** (1cqw = 1% of poster width). This is the linchpin of fidelity: the same `StatsOverlay` renders identically in the on-screen preview, the client capture export, and the server Playwright render, regardless of pixel size or DPI.

It stacks two layers:

- **`MapPreview`** (`features/map/ui/MapPreview.tsx`) — a MapLibre GL map drawing the route(s), basemap layers (water/parks/buildings/roads/rail), markers, and bearing. Exposes the map instance via `onMapReady` so the editor can attach a click handler for marker placement and so the capture renderer can grab the GL canvas.
- **`StatsOverlay`** — the bottom title/subtitle/stats/coordinates block with a theme-coloured gradient fade. Individual mode shows distance/time/pace/elevation/HR; compilation mode shows run count + combined distance/time and a date range.

Every config change flows through `handleConfigChange` / `handleThemeChange` and re-renders the preview immediately — there is no separate "apply" step.

### 2.4 The settings surface — two responsive presentations

The same `SettingsPanel` content renders in two shells:

**Desktop — fixed right sidebar.** `SettingsPanel` with every section forced open (`md:block`); accordion toggles are `pointer-events-none` on desktop. Sections, in order: **Theme → Text → Size → Layers → Markers → Orientation → Display**, with Export/Order actions pinned at the bottom.

**Mobile — `MobileSettingsSheet` (bottom sheet).** A three-snap sheet (`collapsed` / `half` / `full`) modeled on iOS Maps / Apple Music:
- Drag handle + "Customize poster" button (opens straight to `full`).
- A persistent **guided-step rail** (`EditorSteps`) — see §2.5.
- A persistent **`ThemeStrip`** — the highest-impact edit is one tap away in every snap state.
- A persistent **action bar** (`SettingsActions`: Export + Order + size label).
- The scrollable full `SettingsPanel` (with `hideActions`/`hideTheme` since those are promoted into the sheet chrome).

Sheet mechanics worth noting: touch drag with a 40 px threshold steps between snaps; scrolling inside a `half` sheet auto-expands to `full` (one-shot, re-armed on leaving `half`); body scroll is locked while expanded; the collapsed footprint is reserved below the preview (`collapsedSheetHeight`, `mobileSheetMetrics.ts`, BOA-131) so the fixed sheet never overlaps the poster's bottom title/stats.

### 2.5 Guided-but-skippable steps (`EditorSteps.tsx`)

On mobile, a numbered rail presents the three highest-impact edits — **Theme → Text → Size** — as chips the user can tap in any order. Tapping a chip (`handleStep` in `PosterEditor`) expands the sheet (`expandSheetRef`) and, for Text/Size, scrolls the matching `SettingsPanel` section into view via an imperative `SettingsPanelControl.openAndScroll` (Theme is already always-visible via the strip, so it only expands). Visited chips get a check.

The design principle is **guide without gating**: Export is available the entire time, so a user can stop after picking a theme or jump straight to export. Each step fires `editor_step_opened` analytics.

### 2.6 The individual controls

- **Theme** — `ThemeGallery` (desktop grid) / `ThemeStrip` (mobile). Each chip renders the user's *actual route* on that theme via `RoutePreview` + `useRoutePreviewPoints`, so the choice is previewed in context, not abstract swatches. Themes come from `data/themes.json` via `themeRepository`.
- **Text** — title + subtitle free-text inputs.
- **Size** — `POSTER_PRESETS` as a button grid (`printable` print tiers + `digital-only` landscape/square/Instagram). Selecting a preset sets `config.dimensions`. When `dimensionsLocked` (gift), the size is shown read-only with "Size set by gift."
- **Layers** — five toggles (water, parks, buildings, roads, rail) editing `config.layers`.
- **Markers** — individual mode adds Start/Finish and Km toggles (auto-generated from the track by `generateKmMarkers`, which collapses coincident loop endpoints within 50 m into a single "Start / Finish"). All modes get a custom-icon picker: tap an icon → arm `placingIcon` → tap the map to drop a marker (handled by the map click effect in `PosterEditor`, with a crosshair cursor and a top-bar "tap map to place" banner + Cancel). Placed markers are listed with remove buttons.
- **Orientation** — a North-Up button + a −180…180° bearing slider editing `config.bearing`.
- **Display** — toggles for Show stats / Show coordinates / Gradient fade.

`allMarkers` = auto markers (Start/Finish + Km, filtered by the toggles) merged with the user's custom markers, recomputed via memo and fed to both the preview and the renderers.

### 2.7 Switching output mode

The Switch button (top bar + App header) calls `onSwitchMode` → App's `switchMode`, flipping `single`↔`composite` and returning to the browser. Because the editor wrote `savePosterStyle` on every style change, the next poster inherits theme/layers/size/orientation/display — but computes its own title and starts fresh on content specifics. This is the "keep everything possible across modes" behaviour.

### 2.8 Export — the free, instant path (`handleExport`)

This is the heart of the flow and the most heavily engineered part. Goal: a **free, near-instant, share-ready image** that looks exactly like the preview, on any device.

Sequence:
1. Track `export_clicked`; set `exporting`.
2. **Collapse the mobile sheet** and wait ~350 ms so the full poster is visible for capture.
3. Compute **right-sized dimensions** via `freeExportDimensions()` — keep aspect ratio but pick a DPI so the longest side lands near `SCREEN_EXPORT_MAX_PX` (1350), capped at `FREE_EXPORT_MAX_DPI` (150). Free exports are screen/social-destined, not print, so this keeps renders fast (~1–2 s) and eases iOS memory pressure.
4. **Render path cascade** (with per-stage timing via `createExportTimer`):
   - **Instant capture** (`INSTANT_EXPORT`, `capturePosterToBlob`) — grabs the on-screen preview directly (typically <1 s). Has hardened blank detection: if iOS hands back an evicted/blank WebGL frame it throws `MAP_BLANK`.
   - **Server render fallback** (`renderExportOnServer` → `InternalRenderPage` via Playwright) — device-independent; used when capture fails/blanks. Called directly so it doesn't depend on the `VITE_RENDER_ON_SERVER` client flag (the server has its own `ENABLE_SERVER_RENDER` gate and 503s if disabled).
   - **Client fallback chain** (`renderPoster()`): server → capture → legacy canvas (`renderPosterToBlob`), so an export is always produced, even offline.
5. **Watermark** every free blob (`applyWatermark`) and encode as **JPEG q0.9** (`DIGITAL_EXPORT_FORMAT` — far smaller than PNG for a photographic map).
6. `downloadBlob`, record timings (Mixpanel `export_completed` with `render_path`, device, output px, cold/warm; a stable `[export] timings` console line for the WebKit smoke test; an on-screen badge under `?debugTiming`).
7. Show **`ExportSuccessModal`** (the upsell).

### 2.9 Post-export upsell & paid paths

`ExportSuccessModal` offers two conversions:
- **Get it printed** → closes the modal and expands the sheet to the Order controls.
- **HD email delivery** → collects an email (+ marketing opt-in) and calls `requestHdExport` (300 DPI, watermarked, delivered after email confirmation).

The **Order** path is `OrderButton` (or `GiftOrderButton` when redeeming a gift). Paid prints always render at full print resolution — on the server (Playwright) when `RENDER_ON_SERVER`, else the canvas renderer at full DPI — and are never watermarked. To hide cold-start latency, reaching the editor prewarms the server render via `/api/render/health`.

### 2.10 Analytics touchpoints (the editor funnel)

`editor_opened` → `editor_step_opened` → `export_clicked` → (`instant_export_fallback` / `export_server_fallback` as needed) → `export_completed` → `export_upsell_shown` → `export_upsell_print_clicked` / `hd_export_requested`. Plus `output_mode_selected` / `output_mode_switched`. This funnel is the primary instrument for judging editing-flow UX changes.

### 2.11 Key files (quick map)

| File | Role |
| --- | --- |
| `PosterEditor.tsx` | Orchestrator: state, persistence, preview, export/order, marker placement |
| `SettingsPanel.tsx` | All control sections + `SettingsActions` + imperative `openAndScroll` |
| `MobileSettingsSheet.tsx` | Three-snap bottom sheet, drag/scroll mechanics, slots |
| `EditorSteps.tsx` | Guided-skippable Theme→Text→Size rail |
| `mobileSheetMetrics.ts` | Collapsed-height reservation constants |
| `StatsOverlay.tsx` | `cqw`-scaled title/stats overlay (fidelity across renders) |
| `MapPreview.tsx` (`features/map`) | MapLibre route/basemap/marker preview |
| `ThemeGallery.tsx` (`features/theme`) | Theme gallery + strip with per-route previews |
| `usePersistedDraft.ts` (`shared/hooks`) | Versioned, debounced draft persistence |
| `outputMode.ts` (`features/onboarding`) | Output mode + cross-mode style carryover |
| `ExportSuccessModal.tsx` | Post-export print/HD upsell |
| `infrastructure/renderer/*`, `exportTimer.ts` | Capture/canvas renderers, watermark, timing |
| `types/poster.ts` | `PosterConfig`, presets, markers, layers |

---

## 3. Editor-agent brief — the "full path" to improving the editing-flow UX

Hand this section to an agent (human or AI) whose job is to **improve the editing-flow UX**. It is the full path: context, where to look, constraints, candidate improvements, and how to validate.

### 3.1 Mission

Improve the experience of turning a selected run into a finished, exported (and ideally ordered) poster — measured by completion and conversion through the funnel in §2.10 — **without** regressing render fidelity, export reliability, or mobile performance.

### 3.2 Onboarding path for the agent (read in this order)

1. This document, end to end.
2. `src/App.tsx` — how the editor is reached and how Switch/gift/mode state is threaded.
3. `src/features/poster/ui/PosterEditor.tsx` — the orchestrator (state precedence, export cascade, marker placement).
4. `src/features/poster/ui/SettingsPanel.tsx`, `MobileSettingsSheet.tsx`, `EditorSteps.tsx` — the two responsive shells.
5. `src/types/poster.ts`, `src/features/onboarding/services/outputMode.ts`, `src/shared/hooks/usePersistedDraft.ts` — the data model and persistence rules.
6. `tasks/todo.md` and `tasks/lessons.md` — recent decisions and hard-won constraints (mobile black-export, DPI caps, sheet overlap fixes). **Respect these; several are scar tissue from production incidents.**

### 3.3 Hard constraints (do not break)

- **WYSIWYG fidelity.** Preview, capture export, and server render must stay identical. Anything affecting overlay sizing must stay in `cqw` against the `inline-size` container; never reintroduce fixed-px type in `StatsOverlay`.
- **Export reliability on mobile.** Preserve the capture → server → canvas cascade and the `MAP_BLANK` detection. iOS WebGL eviction produced black exports in the past.
- **Free vs paid separation.** Free = right-sized (≤150 DPI), JPEG, watermarked. Paid/HD = full DPI, PNG, unwatermarked. Keep `freeExportDimensions` the single source of truth for free output size.
- **Persistence semantics.** Draft (per run set) beats carryover (style axis only) beats defaults. Never carry per-poster content (title/subtitle/km markers) across modes or runs.
- **Guide without gating.** Export must remain reachable at every step; the steps rail is optional.
- **Don't overlap the poster** with the mobile sheet (keep `collapsedSheetHeight` reservation correct).
- **Keep the funnel instrumented.** Any new interaction should emit/extend the relevant Mixpanel events so the change is measurable.

### 3.4 Known friction / candidate improvements (starting backlog)

These are hypotheses, not commitments — validate before building:

1. **Undo/redo & reset.** There is no history stack and no "reset to defaults." Easy to make a change you can't cleanly revert (e.g. an accidental bearing drag or a removed marker).
2. **Marker editing depth.** Custom markers can be placed and removed but not **moved, relabeled, or restyled** after placement; there is no drag-to-reposition. Km/Start-Finish are toggle-only.
3. **Map framing controls.** `config.padding` exists in the model but has no UI; users can't pan/zoom-crop the route framing — only rotate (`bearing`). Auto-fit may crop poorly for some routes.
4. **Text affordances.** Title/subtitle are plain inputs with no font/size/alignment/color control and no character-limit feedback for overflow against the gradient block.
5. **Discoverability of advanced sections.** On mobile, Layers/Markers/Orientation/Display live below the fold of an expanded sheet; the steps rail only surfaces Theme/Text/Size. Consider progressive disclosure or a richer rail.
6. **Export feedback.** During the ~1–2 s export the only signal is the button label "Exporting…". Consider progress/skeleton and clearer success/error states (current failure path only fires an analytics event + console error).
7. **Switch clarity.** Switching mode silently returns to the browser; users may not understand styling carried over. A confirmation/toast could help.
8. **Compilation affordances.** Compilation mode lacks per-run controls (color/visibility/ordering) and start/finish/km markers entirely.
9. **Accessibility.** Audit keyboard navigation, focus management in the sheet/modal, ARIA on toggles/sliders, and color contrast of the dark UI.

### 3.5 Working agreement

- **Branch:** develop on the assigned feature branch; commit with clear messages; push to that branch only. Do **not** open a PR unless explicitly asked.
- **Scope discipline:** prefer small, measurable changes wired to the funnel over large refactors. The editor is performance- and fidelity-sensitive.
- **Validation before "done":**
  - `npm run build` (tsc + vite) and `npm run lint` clean on touched files.
  - Run the mobile flow smoke (`scripts/smoke-mode-flow.mjs`) and the export smoke (`scripts/smoke-export.ts`) — these gate the exact path you're changing.
  - For any render/export change, confirm a real export still produces a correct, non-blank, watermarked JPEG and that paid/HD output stays full-DPI PNG.
  - Eyeball on a real phone with `?debugTiming` to confirm export latency hasn't regressed.
- **When ambiguous, ask.** UX direction (e.g. how aggressive to be with guidance vs. freedom) is a product call; surface options rather than guessing.

---

*Last updated: 2026-06-23. Source of truth is the code under `src/features/poster/`; if this doc and the code disagree, the code wins — please update this doc.*
