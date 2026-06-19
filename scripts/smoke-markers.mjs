// Smoke test (BOA-129): Start/Finish marker deconfliction.
//
// A loop run starts and finishes at ~the same coordinate; rendered as two
// separate markers the labels overprint into unreadable garbled text. The
// editor must collapse coincident endpoints into a single "Start / Finish"
// marker, while genuine point-to-point runs keep distinct Start and Finish
// markers.
//
// Usage: VITE_USE_DEMO_DATA=true npx vite build --outDir dist-demo
//        node scripts/smoke-markers.mjs
import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import path from 'path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist-demo');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png' };

const server = createServer(async (req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  try {
    const data = await readFile(path.join(dist, urlPath));
    res.writeHead(200, { 'content-type': MIME[path.extname(urlPath)] ?? 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(await readFile(path.join(dist, 'index.html')));
  }
});
await new Promise((r) => server.listen(4181, r));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 1400 } });
page.on('pageerror', (e) => console.error('PAGE ERROR:', e.message));

const fails = [];

/** Open a Budapest single run by its visible "<km> km" + date text, then
 *  return the rendered MapLibre HTML marker labels. */
async function markerLabelsFor(km, dateText) {
  await page.goto('http://127.0.0.1:4181/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  await page.getByText('Single run', { exact: false }).first().click();
  await page.waitForTimeout(1000);
  // City quick-filter chip is labelled "Budapest (<count>)" — match it
  // specifically so we don't grab a "Budapest Running" run card by mistake.
  await page.getByRole('button', { name: /Budapest \(\d+\)/ }).first().click();
  const card = page.locator('button, [class*="cursor-pointer"]')
    .filter({ hasText: 'Budapest Running' }).filter({ hasText: km }).filter({ hasText: dateText })
    .first();
  await card.waitFor({ state: 'visible', timeout: 15000 });
  await card.click();
  await page.waitForTimeout(4500);
  return page.$$eval('.maplibregl-marker', els =>
    els.map(e => (e.textContent || '').trim()).filter(Boolean));
}

// 1. Loop run (15.1 km, closure ~10 m) → single combined marker.
const loop = await markerLabelsFor('15.1 km', 'Dec 2022');
console.log('loop run markers:', JSON.stringify(loop));
if (!(loop.length === 1 && loop[0] === 'Start / Finish')) {
  fails.push(`loop run expected ["Start / Finish"], got ${JSON.stringify(loop)}`);
}

// 2. Point-to-point run (21.1 km, closure ~151 m) → distinct markers.
const p2p = await markerLabelsFor('21.1 km', 'Dec 2022');
console.log('point-to-point run markers:', JSON.stringify(p2p));
if (!(p2p.includes('Start') && p2p.includes('Finish') && !p2p.includes('Start / Finish'))) {
  fails.push(`point-to-point run expected separate Start & Finish, got ${JSON.stringify(p2p)}`);
}

await browser.close();
server.close();

if (fails.length) {
  console.error('[smoke-markers] FAIL:\n  ' + fails.join('\n  '));
  process.exit(1);
}
console.log('[smoke-markers] PASS');
