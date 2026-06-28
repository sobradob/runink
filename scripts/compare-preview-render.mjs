/**
 * Preview ↔ Render fidelity harness (analysis tool, not CI).
 *
 * Measures WHY the mobile editor preview diverges from the final render.
 *
 * Method: the editor preview and the server render mount the SAME
 * components (MapPreview + StatsOverlay) in a `container-type: inline-size`
 * box. The only thing that differs between "phone preview" and "print
 * render" is the box's PIXEL WIDTH (≈360px on a phone vs 1081px for an
 * Instagram export vs 1772px for a 30×40 layout @150 DPI). So we seed ONE
 * payload and screenshot the SAME InternalRenderPage at each width — that
 * isolates viewport width as the single variable and faithfully reproduces
 * the preview's proportions (it is literally the same React tree).
 *
 * Outputs to /tmp/preview-render/:
 *   - contact.html      side-by-side preview | render | pixel-diff per theme
 *   - measurements.csv  element size as % of poster width at each width
 *   - *.png             the raw captures + diffs
 *
 * Prereqs:
 *   1. dist build present (server serves /internal/render-poster from it)
 *   2. server up:  NODE_ENV=development ENABLE_SMOKE_ENDPOINTS=true \
 *                  ENABLE_SERVER_RENDER=true PORT=8099 node --import tsx server/index.ts
 *   3. run:        node scripts/compare-preview-render.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = parseInt(process.env.PORT || '8099', 10);
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = '/tmp/preview-render';
fs.mkdirSync(OUT, { recursive: true });

const themes = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/data/themes.json'), 'utf8'));

// --- Real demo activity: Los Angeles Base, 7.85km loop, 2576 pts ---
const ACT_ID = '22027846134';
const idx = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data/index.json'), 'utf8'));
const idxArr = Array.isArray(idx) ? idx : idx.activities || [];
const actMeta = idxArr.find((a) => a.id === ACT_ID);
const trackRaw = JSON.parse(fs.readFileSync(path.join(ROOT, `public/data/tracks/${ACT_ID}.json`), 'utf8'));
const coords = trackRaw.coords || trackRaw; // [lng,lat][]
const start = coords[0];
const end = coords[coords.length - 1];

const activity = {
  id: ACT_ID,
  name: actMeta.name,
  date: actMeta.date,
  timestamp: actMeta.timestamp,
  location: actMeta.location,
  distance: actMeta.distance,
  duration: actMeta.duration,
  movingDuration: actMeta.movingDuration,
  avgPace: actMeta.avgPace,
  avgHr: actMeta.avgHr,
  elevationGain: actMeta.elevationGain,
  hasTrack: true,
  sportType: actMeta.sportType,
  startPoint: actMeta.startPoint,
  bounds: actMeta.bounds,
};

const allLayersOn = { water: true, parks: true, buildings: true, roads: true, rail: true };
const allLayersOff = { water: false, parks: false, buildings: false, roads: false, rail: false };

// Instagram default (183×229 @150) and 30×40 print (@150 layout) dimensions
const DIMS_IG = { label: 'Instagram', widthMm: 183, heightMm: 229, dpi: 150, category: 'digital-only' };
const DIMS_PRINT = { label: '30x40cm', widthMm: 300, heightMm: 400, dpi: 300, category: 'printable', tierId: 'a4-poster' };

function mmToPx(mm, dpi) { return Math.round((mm / 25.4) * dpi); }
// The render LAYOUT width is computed at 150 DPI regardless of print DPI
// (poster-renderer.ts LAYOUT_DPI=150; higher DPI rides on deviceScaleFactor).
function layoutWidth(dims) { return mmToPx(dims.widthMm, 150); }

function buildPayload({ theme, dims, markers = [], showStats = true, showCoordinates = true, layers = allLayersOn }) {
  return {
    theme,
    config: {
      mode: 'individual',
      themeId: theme.id,
      dimensions: dims,
      title: '',
      subtitle: '',
      showStats,
      showCoordinates,
      showGradientFade: true,
      padding: 0.15,
      bearing: 0,
      layers,
      markers,
    },
    tracks: [{ id: ACT_ID, coords }],
    mode: 'individual',
    activity,
    title: '',
    subtitle: '',
    showStats,
    showCoordinates,
  };
}

const flagMarkers = [
  { id: 'start', lat: start[1], lng: start[0], label: 'Start', type: 'start', icon: 'flag' },
  { id: 'finish', lat: end[1], lng: end[0], label: 'Finish', type: 'finish', icon: 'flag' },
];

async function seed(payload) {
  const res = await fetch(`${BASE}/api/render/_smoke-seed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`seed ${res.status}: ${await res.text()}`);
  return (await res.json()).token;
}

// Capture the internal render page at a given CSS width, return PNG path +
// structural measurements (element computed sizes as % of poster width).
async function capture(browser, token, { width, dsf, label, aspect }) {
  const height = Math.round(width / aspect);
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dsf });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/internal/render-poster/${token}`, { waitUntil: 'load' });
  // Wait for the poster-ready signal, but proceed after a cap so a missing
  // tile network doesn't stall the whole run.
  await page.waitForFunction('window.__POSTER_READY__ === true', null, { timeout: 25_000 }).catch(() => {});
  await page.waitForTimeout(600);

  const measures = await page.evaluate(() => {
    const root = document.querySelector('[data-poster-root]');
    const pw = root ? root.clientWidth : 0;
    const fs = (el) => (el ? parseFloat(getComputedStyle(el).fontSize) : null);
    const overlay = document.querySelector('[data-stats-overlay]');
    const titleEl = overlay?.children?.[0] || null;
    const subEl = overlay?.children?.[1] || null;
    const statVal = overlay?.querySelector('.flex div div'); // StatItem value
    // Marker elements (MapLibre HTML markers): measure emoji + label font px
    const markerEls = Array.from(document.querySelectorAll('.maplibregl-marker'));
    let emojiPx = null, labelPx = null, markerH = null;
    if (markerEls.length) {
      const m = markerEls[0];
      const divs = m.querySelectorAll('div');
      // first inner div = icon/emoji, last = label (if present)
      emojiPx = divs[0] ? parseFloat(getComputedStyle(divs[0]).fontSize) : null;
      labelPx = divs.length > 1 ? parseFloat(getComputedStyle(divs[divs.length - 1]).fontSize) : null;
      markerH = m.getBoundingClientRect().height;
    }
    return {
      posterWidth: pw,
      titlePx: fs(titleEl),
      subtitlePx: fs(subEl),
      statPx: fs(statVal),
      emojiPx,
      labelPx,
      markerH,
    };
  });

  const pngPath = path.join(OUT, `${label}.png`);
  const rootEl = await page.$('[data-poster-root]');
  await (rootEl || page).screenshot({ path: pngPath });
  await ctx.close();
  return { pngPath, measures };
}

// Route-ink coverage: fraction of poster pixels matching runPath.core color
// (basemap layers OFF so the only ink is the route line). Computed in a
// throwaway page via canvas getImageData.
async function routeCoverage(browser, pngPath, coreHex) {
  const buf = fs.readFileSync(pngPath).toString('base64');
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const cov = await page.evaluate(
    async ([b64, hex]) => {
      const img = new Image();
      await new Promise((r) => { img.onload = r; img.src = 'data:image/png;base64,' + b64; });
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      const g = c.getContext('2d');
      g.drawImage(img, 0, 0);
      const { data } = g.getImageData(0, 0, c.width, c.height);
      const tr = parseInt(hex.slice(1, 3), 16), tg = parseInt(hex.slice(3, 5), 16), tb = parseInt(hex.slice(5, 7), 16);
      let hit = 0;
      const total = c.width * c.height;
      for (let i = 0; i < data.length; i += 4) {
        if (Math.abs(data[i] - tr) < 40 && Math.abs(data[i + 1] - tg) < 40 && Math.abs(data[i + 2] - tb) < 40) hit++;
      }
      return { coveragePct: (hit / total) * 100, w: c.width, h: c.height };
    },
    [buf, coreHex],
  );
  await ctx.close();
  return cov;
}

// Pixel diff two PNGs normalized to a common width; returns diff PNG path + %.
async function pixelDiff(browser, aPath, bPath, outPath, normW = 600) {
  const a = fs.readFileSync(aPath).toString('base64');
  const b = fs.readFileSync(bPath).toString('base64');
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const res = await page.evaluate(
    async ([ab, bb, nw]) => {
      const load = (s) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = 'data:image/png;base64,' + s; });
      const ia = await load(ab), ib = await load(bb);
      const h = Math.round(nw * (ia.height / ia.width));
      const draw = (img) => { const c = document.createElement('canvas'); c.width = nw; c.height = h; c.getContext('2d').drawImage(img, 0, 0, nw, h); return c.getContext('2d').getImageData(0, 0, nw, h); };
      const da = draw(ia).data, db = draw(ib).data;
      const out = document.createElement('canvas'); out.width = nw; out.height = h;
      const og = out.getContext('2d'); const od = og.createImageData(nw, h);
      let diff = 0;
      for (let i = 0; i < da.length; i += 4) {
        const d = Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]);
        if (d > 60) { od.data[i] = 255; od.data[i + 1] = 0; od.data[i + 2] = 0; od.data[i + 3] = 255; diff++; }
        else { od.data[i] = da[i]; od.data[i + 1] = da[i + 1]; od.data[i + 2] = da[i + 2]; od.data[i + 3] = 70; }
      }
      og.putImageData(od, 0, 0);
      return { png: out.toDataURL('image/png'), diffPct: (diff / (nw * h)) * 100 };
    },
    [a, b, normW],
  );
  fs.writeFileSync(outPath, Buffer.from(res.png.split(',')[1], 'base64'));
  await ctx.close();
  return res.diffPct;
}

async function main() {
  const browser = await chromium.launch();
  const PREVIEW_W = 360;            // mobile editor poster width
  const igW = layoutWidth(DIMS_IG); // 1081
  const printW = layoutWidth(DIMS_PRINT); // 1772
  const igAspect = DIMS_IG.widthMm / DIMS_IG.heightMm;
  const printAspect = DIMS_PRINT.widthMm / DIMS_PRINT.heightMm;

  const csv = [['theme', 'measure', 'preview@360', `render@${igW}`, `render@${printW}`, 'unit'].join(',')];
  const contact = [];

  console.log('== A) Visual contact sheet: 10 themes, IG size, full features ==');
  for (const theme of themes) {
    // NB: payload tokens are single-use (consumed on first fetch), so seed a
    // fresh token for each capture.
    const prev = await capture(browser, await seed(buildPayload({ theme, dims: DIMS_IG, markers: flagMarkers })), { width: PREVIEW_W, dsf: 2, label: `${theme.id}_preview`, aspect: igAspect });
    const rend = await capture(browser, await seed(buildPayload({ theme, dims: DIMS_IG, markers: flagMarkers })), { width: igW, dsf: 1, label: `${theme.id}_render`, aspect: igAspect });
    const diffPath = path.join(OUT, `${theme.id}_diff.png`);
    const diffPct = await pixelDiff(browser, prev.pngPath, rend.pngPath, diffPath);
    contact.push({ theme: theme.id, name: theme.name, diffPct });
    console.log(`  ${theme.id.padEnd(14)} pixel-diff ${diffPct.toFixed(1)}%`);
  }

  console.log('\n== B) Structural sizing: element px ÷ poster width, at 3 widths ==');
  const repTheme = themes[0]; // noir
  const widths = [
    { width: PREVIEW_W, dsf: 2, aspect: igAspect, key: 'p' },
    { width: igW, dsf: 1, aspect: igAspect, key: 'ig' },
    { width: printW, dsf: 1, aspect: printAspect, key: 'pr' },
  ];
  const m = {};
  for (const w of widths) {
    const token = await seed(buildPayload({ theme: repTheme, dims: w.key === 'pr' ? DIMS_PRINT : DIMS_IG, markers: flagMarkers }));
    const c = await capture(browser, token, { ...w, label: `measure_${w.key}` });
    m[w.key] = c.measures;
  }
  const pctOf = (px, pw) => (px == null || !pw ? null : ((px / pw) * 100));
  const rows = [
    ['title (cqw)', 'titlePx'],
    ['subtitle (cqw)', 'subtitlePx'],
    ['stat value (cqw)', 'statPx'],
    ['marker emoji (px)', 'emojiPx'],
    ['marker label (px)', 'labelPx'],
    ['marker stack height (px)', 'markerH'],
  ];
  console.log(`  poster width px:    ${m.p.posterWidth}  ${m.ig.posterWidth}  ${m.pr.posterWidth}`);
  for (const [name, key] of rows) {
    const p = pctOf(m.p[key], m.p.posterWidth);
    const ig = pctOf(m.ig[key], m.ig.posterWidth);
    const pr = pctOf(m.pr[key], m.pr.posterWidth);
    const fmt = (v) => (v == null ? '  n/a' : v.toFixed(2) + '%');
    console.log(`  ${name.padEnd(26)} ${fmt(p)}  ${fmt(ig)}  ${fmt(pr)}`);
    csv.push([repTheme.id, name, fmt(p), fmt(ig), fmt(pr), '%of-poster-width'].join(','));
  }

  console.log('\n== C) Route-ink coverage (basemap OFF), noir white line ==');
  const covRow = {};
  for (const w of widths) {
    const token = await seed(buildPayload({
      theme: repTheme, dims: w.key === 'pr' ? DIMS_PRINT : DIMS_IG,
      markers: [], showStats: false, showCoordinates: false, layers: allLayersOff,
    }));
    const c = await capture(browser, token, { ...w, label: `route_${w.key}` });
    const cov = await routeCoverage(browser, c.pngPath, repTheme.runPath.core);
    covRow[w.key] = cov.coveragePct;
    console.log(`  width ${String(w.width).padEnd(5)} route-ink ${cov.coveragePct.toFixed(3)}%  (${cov.w}×${cov.h})`);
  }
  const ratioIg = covRow.p / covRow.ig;
  const ratioPr = covRow.p / covRow.pr;
  console.log(`  → line is ${ratioIg.toFixed(1)}× thicker (vs IG) / ${ratioPr.toFixed(1)}× thicker (vs print) relative to poster in mobile preview`);
  csv.push([repTheme.id, 'route-ink coverage', covRow.p.toFixed(3) + '%', covRow.ig.toFixed(3) + '%', covRow.pr.toFixed(3) + '%', '%of-poster-area'].join(','));
  csv.push([repTheme.id, 'line thickness ratio (preview÷render)', '1.0×', ratioIg.toFixed(1) + '×', ratioPr.toFixed(1) + '×', 'relative'].join(','));

  // --- write artifacts ---
  fs.writeFileSync(path.join(OUT, 'measurements.csv'), csv.join('\n'));

  const cards = contact.map(({ theme, name, diffPct }) => `
    <div class="card">
      <h3>${name} <span>(pixel-diff ${diffPct.toFixed(1)}%)</span></h3>
      <div class="row">
        <figure><img src="${theme}_preview.png"><figcaption>mobile preview (360px)</figcaption></figure>
        <figure><img src="${theme}_render.png"><figcaption>render (${igW}px → 150 DPI)</figcaption></figure>
        <figure><img src="${theme}_diff.png"><figcaption>diff (red = changed)</figcaption></figure>
      </div>
    </div>`).join('\n');
  fs.writeFileSync(path.join(OUT, 'contact.html'), `<!doctype html><meta charset=utf8>
    <title>Preview ↔ Render</title>
    <style>body{background:#111;color:#eee;font:14px system-ui;margin:24px}
    .card{margin-bottom:32px;border-bottom:1px solid #333;padding-bottom:16px}
    h3 span{color:#888;font-weight:400;font-size:12px}
    .row{display:flex;gap:16px}figure{margin:0}
    img{height:340px;background:#000;border:1px solid #333}
    figcaption{color:#999;font-size:12px;margin-top:4px}</style>
    <h1>Preview ↔ Render fidelity — Instagram size, full features</h1>
    <p>Same payload &amp; same components; only the viewport width differs (360px phone vs ${igW}px render).</p>
    ${cards}`);

  await browser.close();
  console.log(`\nArtifacts → ${OUT}/contact.html  +  measurements.csv`);
}

main().catch((e) => { console.error('FAIL', e); process.exit(1); });
