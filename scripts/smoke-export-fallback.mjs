// Smoke test (BOA-129, iOS blank-export): when the map's WebGL frame
// serialises blank (the iOS context-eviction failure — live canvas samples
// fine but toDataURL returns a uniform/transparent frame), the free export
// must DETECT the blank snapshot and fall back to the device-independent
// server render, producing a poster WITH the map rather than overlays-only.
//
// Prereqs (two processes):
//   # render server on the dev proxy target port
//   NODE_ENV=development ENABLE_SMOKE_ENDPOINTS=true ENABLE_SERVER_RENDER=true \
//     PORT=3008 node --import tsx server/index.ts
//   # dev app in demo mode (vite proxies /api -> :3008)
//   VITE_USE_DEMO_DATA=true npx vite --port 5180 --strictPort
//
//   node scripts/smoke-export-fallback.mjs
import { chromium } from 'playwright';

const RENDER = 'http://127.0.0.1:3008';
const APP = 'http://localhost:5180';
const fail = (m) => { console.error('[smoke-export-fallback] FAIL:', m); process.exit(1); };

// Mint a server session so /api/render/export passes its auth gate.
const sess = await fetch(`${RENDER}/api/render/_smoke-session`, { method: 'POST' }).then(r => r.json()).catch(() => null);
if (!sess?.sessionId) fail('could not mint smoke session — is the render server up on :3008?');

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1100, height: 1400 }, acceptDownloads: true });
await ctx.addCookies([{ name: 'runink_session', value: sess.sessionId, domain: 'localhost', path: '/' }]);
const page = await ctx.newPage();

let blankDetected = false, serverStatus = 0;
page.on('console', (m) => { if (/snapshot is blank|MAP_BLANK/i.test(m.text())) blankDetected = true; });
page.on('response', (r) => { if (r.url().includes('/api/render/export')) serverStatus = r.status(); });

// Simulate iOS: the live WebGL canvas samples fine, but its serialised frame
// is a uniform solid fill (blank map).
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

await page.goto(APP, { waitUntil: 'networkidle' });
await page.waitForTimeout(900);
await page.getByText('Single run', { exact: false }).first().click();
await page.waitForTimeout(800);
await page.getByText('Los Angeles - Base', { exact: false }).first().click();
await page.waitForTimeout(4000);

const dlP = page.waitForEvent('download', { timeout: 90000 }).catch(() => null);
await page.getByText('EXPORT IMAGE (FREE)', { exact: false }).first().click();
const dl = await dlP;
await page.waitForTimeout(300);

let bytes = 0;
if (dl) { const s = await dl.createReadStream(); for await (const c of s) bytes += c.length; }
await browser.close();

if (!blankDetected) fail('blank snapshot was NOT detected (capture shipped a blank export)');
if (serverStatus !== 200) fail(`server render fallback did not return 200 (got ${serverStatus || 'no request'})`);
if (bytes < 100_000) fail(`fallback export suspiciously small (${bytes} bytes) — map may be missing`);
console.log(`[smoke-export-fallback] PASS (blank detected -> server render ${serverStatus}, ${bytes} bytes)`);
