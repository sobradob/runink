# BOA-85 + BOA-86 — Mobile-first flow & editor redesign

Status: PLAN (post product-architect interview, 2026-06-14)
Tickets: [BOA-85 editing flow](https://linear.app/boaz-personal/issue/BOA-85) · [BOA-86 output-type selection](https://linear.app/boaz-personal/issue/BOA-86)
Ship: one cohesive redesign, 85+86 together. Solo dev, ~13 users/30d → judgment-driven.

---

## 1. Problem Statement

New users who connect Strava get lost in three concrete moments:
1. **They don't know what's possible** — no mental model of what poster the app produces.
2. **The activity list is a wall** — hundreds of activities, no starting point, analysis paralysis.
3. **The editor overwhelms** — too many controls (themes/layers/markers/dims/title/stats) with no priority.

The unavoidable Strava load wait is currently dead time. We can convert it into the moment we teach "what's possible" and let the user choose an output direction.

## 2. Target Users

- **Primary surface: mobile.** Assume most users are on a phone; mobile is the design priority, desktop adapts up.
- **New, unfamiliar user**: just connected Strava, doesn't know the app can overlay runs or how much is editable.
- We do **not** yet know whether most first posters are single vs composite → the entry flow must not hard-assume a default, but switching must be cheap.

## 3. Core Requirements (MoSCoW)

### Must
- **Mode-selection screen during load** (BOA-86): two clearly-sold options — **Composite** (many runs overlaid) and **Single** (one hero run) — shown while activities stream in. Sold with **example poster imagery**.
- **No "not sure" option.** Replace with a **persistent "Switch" affordance** on every screen + reassurance copy ("You can change this anytime").
- **Switch preserves everything possible**: theme, title/text, size carry over; only mode-meaningless settings (radius, multi-select set) silently drop. No destructive warning unless real work is lost.
- **Composite = filter-driven, auto-include**: place + radius + date range auto-includes every matching run; manual add/remove refines.
- **Composite live fill-in**: runs appear as background sync streams pages, with a clear "still loading N more runs" indicator on the composite itself.
- **Single mode hero-run surfacing**: top candidates by **longest distance** + **Strava race flag** (when present).
- **Single mode filters**: search by name, date range, distance band, activity type.
- **Editor = always-guided-but-always-skippable steps** (BOA-85): Theme → Text → Size, with jump-to-export available at any point. **Theme/color leads.**
- Mobile-first layouts throughout.

### Should
- Example posters **generated from bundled demo data**, pre-rendered to static assets for the mode screen.
- Switch affordance consistent in placement across mode screen, browser, and editor.

### Could
- Smart composite default (auto-propose most-frequent city) as a later enhancement.
- Live previews of the user's own data on the mode screen after enough has loaded (curated-first is the v1).

### Won't (this work)
- No pricing/paywall changes — **leave monetization exactly as-is**. Activation = reaching any export (watermarked OR paid).
- No "not sure" third path.
- No webhooks / server-side persistence (privacy stance unchanged).

## 4. Technical Architecture (high level)

Existing building blocks to reuse (do NOT rebuild):
- `mode: 'individual' | 'compilation'` already exists end-to-end.
- `ActivityBrowser` already has location/radius/date/type filters + multi-select.
- Progressive loader: `useActivityData.ts` (quick first page + background page sync, `syncingMore`).
- Mobile bottom sheet: `MobileSettingsSheet.tsx` (snap states), `ThemeStrip.tsx`.
- Demo data: `public/data/index.json` + `tracks/`, gated by `VITE_USE_DEMO_DATA`.

New / changed:
1. **Flow/routing** (`src/App.tsx`): insert a `ModeSelect` view between "connected/loading" and the browser. New view state machine: `loading+modeselect → browser(mode) → editor(mode)`, with a global `mode` + `switchMode()` that preserves shared draft fields.
2. **ModeSelect screen** (new `src/features/onboarding/ui/ModeSelect.tsx`): two cards with pre-rendered example posters, reassurance copy, renders immediately (not gated on load), wired to the existing load progress (`stravaLoading`/`syncingMore`).
3. **Composite UX**: make `ActivityBrowser` composite path filter-driven by default (auto-include matches of place+radius+date) rather than manual multi-select first; surface live "N more loading" from `syncingMore`/page progress.
4. **Single UX**: add hero-run ranking (sort/sectioned "Suggested" group) + distance-band filter; keep search/date/type.
5. **Hero-run / race signal (backend, 3 files)**:
   - `server/lib/strava-client.ts`: add `workout_type?: number` to `StravaActivity`.
   - `server/lib/transform.ts`: map `workoutType` (race = `workout_type === 1` for runs).
   - `src/types/activity.ts`: add `workoutType?: number` (or `isRace?: boolean`) to `ActivitySummary`.
6. **Editor steps** (BOA-85): restructure the mobile editor into skippable guided steps Theme→Text→Size over the existing controls; theme strip leads; persistent Switch + Export. Reuse `MobileSettingsSheet`/`ThemeStrip`/`SettingsPanel` internals — reorganize, don't rewrite renderers.
7. **Example assets**: offline script renders 2 sample posters (1 composite, 1 single) from demo data → committed static images used by `ModeSelect`.
8. **Analytics**: add Mixpanel events for mode_selected, mode_switched, step_completed, export (activation). Reuse existing `window.mixpanel` pattern.

## 5. Key Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Composite looks broken while pages still stream in | Live fill-in + explicit "loading N more runs" indicator on the composite; never imply it's final. |
| `workout_type` absent/unreliable on many activities | Treat race as a *bonus* signal; **longest distance** is the reliable primary ranker. Degrade gracefully when flag missing. |
| Guided steps annoy returning users | Always skippable + jump-to-export anytime; steps are a spine, not a gate. |
| "One cohesive redesign" = large blast radius for a solo dev | Build behind the existing view-state machine; keep renderers/filters intact; land in vertical slices (below) even though shipped together. |
| Mode screen examples slow/ugly if rendered live | Pre-render from demo data to static assets; no live render dependency on the screen. |
| Switch losing user work | Preserve all shared fields; only drop mode-meaningless settings; warn only on real loss. |

## 6. MVP Scope (what ships)

The cohesive release = all "Must" items. Internally sequence as vertical slices so each is verifiable:
- **Slice A** — Mode-select screen + Switch plumbing + state-preserving `switchMode()` (no new filters yet).
- **Slice B** — Single mode: hero-run surfacing (distance + race) + distance-band filter. Includes the 3-file backend `workout_type` change.
- **Slice C** — Composite mode: filter-driven auto-include + live fill-in indicator.
- **Slice D** — Editor guided-skippable steps (Theme→Text→Size), theme-led.
- **Slice E** — Example assets from demo data + analytics events.

## 7. Success Metrics

- **Primary: activation** = % of Strava-connected users who reach *any* export (watermarked or paid).
- Secondary (diagnostic, low-N so qualitative): mode_selected rate, mode_switched rate, step drop-off in editor, time-to-first-export.
- Guardrail: order/conversion rate must not drop (pricing unchanged).

## 8. Open Questions

- Exact distance-band buckets for single filter (e.g. <5k / 5–10k / 10–21k / 21k+?) — decide during Slice B.
- Switch affordance exact placement/label on each surface — decide during Slice A with a quick mock.
- Whether the mode screen ever swaps curated → user-data previews (deferred to "Could").

## 9. Recommended Next Steps

1. Confirm this plan (then `/clear` the interview context).
2. Start **Slice A** behind the existing routing; mock the ModeSelect + Switch on mobile first.
3. Land the 3-file `workout_type` backend change early (unblocks Slice B).
4. Verify each slice on mobile viewport via the preview tools before stacking the next.
