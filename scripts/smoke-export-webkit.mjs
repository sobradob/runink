// Smoke test (mobile export, WebKit engine): exercises the free/preview export
// on Playwright's WebKit — the same engine iOS Safari/Chrome use — at an iPhone
// viewport, and asserts the OUTPUT ACTUALLY CONTAINS A MAP, not just that a file
// downloaded. The old byte-size check (>100 KB) passes a blank-map-with-overlays
// export, which is exactly the bug users kept hitting; here we decode the
// downloaded image and measure pixel contrast.
//
// Two scenarios:
//   1. healthy  — normal export; capture path should produce a map-bearing image
//   2. evicted  — simulate the iOS blank-readback (toDataURL → uniform fill);
//                 hardened blank detection must fire and fall back to the server
//                 render, which still produces a map-bearing image.
//
// Prereqs (two processes) — identical to smoke-export-fallback:
//   NODE_ENV=development ENABLE_SMOKE_ENDPOINTS=true ENABLE_SERVER_RENDER=true \
//     PORT=3008 node --import tsx server/index.ts
//   VITE_USE_DEMO_DATA=true npx vite --port 5180 --strictPort
//
//   npx playwright install webkit   # one-time
//   node scripts/smoke-export-webkit.mjs
import { webkit, devices } from 'playwright';

const RENDER = 'http://127.0.0.1:3008';
const APP = 'http://localhost:5180';
// Real iPhone descriptor: iOS Safari UA + touch + deviceScaleFactor — the
// closest headless approximation of the device this bug occurs on, and it makes
// detectExportDevice() resolve to 'ios' so the iOS telemetry path is exercised.
const IPHONE = devices['iPhone 14'];
const CONTENT_RANGE_MIN = 24; // a real map's per-channel pixel range far exceeds this; a blank fill is ~0

const fail = (m) => { console.error('[smoke-export-webkit] FAIL:', m); process.exit(1); };

// Decode a downloaded image (JPEG/PNG) and return the largest per-channel range
// across a downscaled probe — the inverse of captureRenderer's isSourceBlank.
// A blank/flat export ⇒ ~0; a real map ⇒ tens-to-hundreds. Reuses the browser's
// image decoder so we don't pull in a Node image dependency.
async function imageContentRange(page, buffer, mime) {
  const b64 = buffer.toString('base64');
  return page.evaluate(async ({ b64, mime }) => {
    const img = new Image();
    await new Promise((res, rej) => {
      img.onload = res; img.onerror = () => rej(new Error('decode failed'));
      img.src = `data:${mime};base64,${b64}`;
    });
    const N = 96;
    const c = document.createElement('canvas');
    c.width = N; c.height = N;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.imageSmoothingEnabled = false;
    x.drawImage(img, 0, 0, N, N);
    const d = x.getImageData(0, 0, N, N).data;
    let rMin = 255, rMax = 0, gMin = 255, gMax = 0, bMin = 255, bMax = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] < rMin) rMin = d[i]; if (d[i] > rMax) rMax = d[i];
      if (d[i + 1] < gMin) gMin = d[i + 1]; if (d[i + 1] > gMax) gMax = d[i + 1];
      if (d[i + 2] < bMin) bMin = d[i + 2]; if (d[i + 2] > bMax) bMax = d[i + 2];
    }
    return Math.max(rMax - rMin, gMax - gMin, bMax - bMin);
  }, { b64, mime });
}

async function runExport(browser, { evictWebGL }) {
  const ctx = await browser.newContext({ ...IPHONE, acceptDownloads: true });
  await ctx.addCookies([{ name: 'runink_session', value: globalThis.__sess, domain: 'localhost', path: '/' }]);
  const page = await ctx.newPage();

  let blankDetected = false, serverStatus = 0, timings = null;
  const consoleErrors = [];
  page.on('console', (m) => {
    const t = m.text();
    if (/snapshot is blank|MAP_BLANK|reads as uniform/i.test(t)) blankDetected = true;
    if (m.type() === 'error') consoleErrors.push(t);
    const tm = t.match(/\[export\] timings (\{.*\})/);
    if (tm) { try { timings = JSON.parse(tm[1]); } catch { /* ignore */ } }
  });
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
  page.on('response', (r) => { if (r.url().includes('/api/render/export')) serverStatus = r.status(); });

  if (evictWebGL) {
    // Simulate iOS context eviction: live canvas samples fine, serialised frame
    // is a uniform fill.
    await page.addInitScript(() => {
      const orig = HTMLCanvasElement.prototype.toDataURL;
      HTMLCanvasElement.prototype.toDataURL = function (...a) {
        if (this.classList?.contains('maplibregl-canvas')) {
          const c = document.createElement('canvas');
          c.width = this.width || 1; c.height = this.height || 1;
          const x = c.getContext('2d');
          x.fillStyle = '#0a0a0a'; x.fillRect(0, 0, c.width, c.height);
          return orig.call(c, 'image/png');
        }
        return orig.apply(this, a);
      };
    });
  }

  // On any failure, dump enough state to diagnose from CI artifacts/logs
  // instead of re-running blind.
  const scenario = evictWebGL ? 'evicted' : 'healthy';
  async function diagnose(stage, err) {
    try { await page.screenshot({ path: `webkit-fail-${scenario}.png`, fullPage: true }); } catch { /* */ }
    let visible = '';
    try {
      visible = await page.evaluate(() =>
        Array.from(document.querySelectorAll('button, h1, h2, h3'))
          .map((e) => (e.textContent || '').trim()).filter(Boolean).slice(0, 40).join(' | '));
    } catch { /* */ }
    console.error(`[smoke-export-webkit] ${scenario} FAILED at ${stage}: ${err?.message || err}`);
    console.error(`[smoke-export-webkit] visible controls: ${visible}`);
    if (consoleErrors.length) console.error(`[smoke-export-webkit] page errors: ${consoleErrors.join(' || ')}`);
  }

  await page.goto(APP, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  try {
    await page.getByText('Single run', { exact: false }).first().click({ timeout: 15000 });
    await page.waitForTimeout(800);
    await page.getByText('Los Angeles - Base', { exact: false }).first().click({ timeout: 20000 });
    await page.waitForTimeout(4000);
  } catch (e) {
    await diagnose('run-selection', e);
    throw e;
  }

  const dlP = page.waitForEvent('download', { timeout: 90000 }).catch(() => null);
  // The desktop sidebar (hidden via `md:`) and the mobile bottom sheet both
  // render an export button; `:visible` picks the one actually on screen for
  // this viewport rather than the first in DOM order (the hidden desktop one).
  await page.locator('button:has-text("Export Image (Free)"):visible').first().click();
  const dl = await dlP;
  await page.waitForTimeout(300);

  let buf = Buffer.alloc(0);
  if (dl) {
    const chunks = [];
    const s = await dl.createReadStream();
    for await (const c of s) chunks.push(c);
    buf = Buffer.concat(chunks);
  }
  const mime = (dl?.suggestedFilename() || '').endsWith('.jpg') ? 'image/jpeg' : 'image/png';
  const range = buf.length ? await imageContentRange(page, buf, mime) : 0;
  await ctx.close();
  return { bytes: buf.length, range, blankDetected, serverStatus, timings, mime };
}

const healthyOnly = process.env.SMOKE_WEBKIT_HEALTHY_ONLY === '1';
const sess = await fetch(`${RENDER}/api/render/_smoke-session`, { method: 'POST' })
  .then((r) => r.json()).catch(() => null);
if (!sess?.sessionId && !healthyOnly) fail('could not mint smoke session — is the render server up on :3008?');
globalThis.__sess = sess?.sessionId ?? 'no-session';

const browser = await webkit.launch();
try {
  // Scenario 1: healthy export — must contain a map.
  const healthy = await runExport(browser, { evictWebGL: false });
  console.log('[smoke-export-webkit] healthy:', JSON.stringify(healthy.timings), `range=${healthy.range}`);
  if (healthy.bytes < 50_000) fail(`healthy export too small (${healthy.bytes} bytes)`);
  if (healthy.range < CONTENT_RANGE_MIN) {
    fail(`healthy export looks BLANK (pixel range ${healthy.range} < ${CONTENT_RANGE_MIN}) — map missing`);
  }
  if (!healthy.timings || typeof healthy.timings.total_ms !== 'number') {
    fail('no [export] timings line emitted — ExportTimer not wired');
  }

  // Scenario 2 needs the DB-backed render server for the fallback. Skip it when
  // only the client capture path is under test (no server running locally).
  if (process.env.SMOKE_WEBKIT_HEALTHY_ONLY === '1') {
    console.log('[smoke-export-webkit] PASS (healthy only; server fallback skipped)');
    await browser.close();
    process.exit(0);
  }

  // Scenario 2: simulated iOS eviction — blank must be detected, server fallback
  // must run, and the resulting image must STILL contain a map.
  const evicted = await runExport(browser, { evictWebGL: true });
  console.log('[smoke-export-webkit] evicted:', JSON.stringify(evicted.timings), `range=${evicted.range}`);
  if (!evicted.blankDetected) fail('blank readback was NOT detected under WebKit (would ship a blank export)');
  if (evicted.serverStatus !== 200) fail(`server fallback did not return 200 (got ${evicted.serverStatus || 'no request'})`);
  if (evicted.range < CONTENT_RANGE_MIN) {
    fail(`fallback export looks BLANK (pixel range ${evicted.range} < ${CONTENT_RANGE_MIN}) — map missing`);
  }
  if (!evicted.timings || typeof evicted.timings.server_ms !== 'number') {
    fail('fallback timings missing server_ms — ExportTimer did not record the server span');
  }

  console.log(
    `[smoke-export-webkit] PASS (healthy range=${healthy.range} ${healthy.bytes}B; ` +
    `evicted blank->server ${evicted.serverStatus} range=${evicted.range} server_ms=${evicted.timings.server_ms})`,
  );
} finally {
  await browser.close();
}
