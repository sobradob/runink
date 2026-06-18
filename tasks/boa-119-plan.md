# BOA-119 — Composite default placeholder text + preview basemap missing

## Findings (root causes — NOT the BOA-116 regression the ticket guessed)
BOA-116 touched only App.tsx + landing files; it never touched the map or poster
code. Both bugs are pre-existing latent issues the ticket mis-attributed.

### Bug 1 — stale default title ("TRIPLE TRAIL 25K - 3RD PLACE")
- The string is NOT a literal anywhere in the repo. It is the user's own
  previously-typed title, persisted to localStorage `runink:posterStyle:v1`.
- `PosterEditor` reads `carryover?.title` (outputMode.ts `PosterStyleCarryover`)
  as the default for every NEW poster. A custom title from one poster leaks into
  every later composite of unrelated runs.
- Fix: stop carrying `title` in the cross-mode carryover. Title is per-poster
  content, not reusable style (the carryover already excludes other content like
  subtitle/markers). New posters compute their default from their own content
  (`activities[0].location` / `activity.location`); drafts (`restored.config`)
  still keep their own title.

### Bug 2 — basemap missing in preview, present in export
- `maplibreStyle.ts` resolves the OpenFreeMap tile URL via a hand-rolled async
  `resolveTileUrl()` with a sync fallback `.../planet/{z}/{x}/{y}.pbf`.
- That bare fallback returns HTTP 200 but **0 bytes** at real zooms (only the
  versioned `.../planet/<date>_pt/{z}/{x}/{y}.pbf` has data). When `buildMapStyle`
  loses the race against resolution it emits the empty fallback → basemap blank,
  only the route line on the background colour.
- Export wins the race (InternalRenderPage fetches its payload first, giving
  resolution time); preview/thumbnails lose it.
- Fix: let MapLibre resolve the TileJSON natively via `url:` on the vector
  source. Removes the race AND the broken fallback; pure/sync `buildMapStyle`.

## Tasks
- [x] Locate root causes
- [x] outputMode.ts: drop `title` from carryover
- [x] PosterEditor.tsx: stop reading/writing carryover title
- [x] maplibreStyle.ts: native TileJSON `url` resolution
- [x] Verify: typecheck/build/lint
- [x] Verify: run app, reproduce both bugs, confirm fixed

## Results — what changed
- `maplibreStyle.ts`: vector source now `url: <TileJSON>` (MapLibre resolves the
  versioned tile template itself). Deleted `resolveTileUrl()` + module side-effect
  + the empty bare-pattern fallback. `buildMapStyle` is now pure/sync, race-free.
- `outputMode.ts`: removed `title` from `PosterStyleCarryover` (+ doc).
- `PosterEditor.tsx`: title default always computed from the poster's own runs;
  `savePosterStyle` no longer writes/depends on `config.title`.

## Verification story
Headless Playwright drove the real composite editor against a worktree dev server
(`VITE_USE_DEMO_DATA=true`), actively reproducing both bugs:
- Bug 1: seeded a stale carryover `{title:"TRIPLE TRAIL 25K - 3RD PLACE"}` into
  `localStorage` before load, created a NEW composite → default title was the
  computed `"Southwark"`, NOT the seeded value. (Old code surfaced the seed.)
- Bug 2: live preview issued 4 tile requests — all versioned + non-empty, ZERO
  empty tiles, ZERO bare-pattern `/planet/{z}/{x}/{y}.pbf` requests. Screenshot
  shows the basemap road network behind the route.
- `tsc -b` clean · `eslint` clean · `vite build` succeeds (only pre-existing
  chunk-size warning).

## Note on the ticket's hypothesis
BOA-116 touched only App.tsx + landing files — it never touched map/poster code.
Both bugs are pre-existing latent issues (a tile-resolution race with a broken
fallback; an over-broad style carryover), not BOA-116 regressions.
