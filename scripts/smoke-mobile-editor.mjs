// One-off visual/geometry verification for BOA-130 + BOA-131 on a mobile viewport.
//   VITE_USE_DEMO_DATA=true npx vite build --outDir dist-demo
//   node scripts/verify-mobile-editor.mjs
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
await new Promise((r) => server.listen(4188, r));

const browser = await chromium.launch();
// iPhone 16 Pro logical viewport (matches the ticket screenshots' device)
const page = await browser.newPage({ viewport: { width: 402, height: 874 }, deviceScaleFactor: 3 });
page.on('pageerror', (e) => console.error('PAGE ERROR:', e.message));

await page.goto('http://127.0.0.1:4188/', { waitUntil: 'networkidle' });
await page.waitForTimeout(800);

// BOA-130: loading overlay should be present right after the editor mounts.
await page.getByText('Single run', { exact: false }).first().click();
await page.waitForTimeout(300);
await page.getByText('Los Angeles - Base', { exact: false }).first().click();
// grab the overlay quickly before tiles settle
let sawOverlay = false;
for (let i = 0; i < 20; i++) {
  if (await page.locator('text=Loading map…').count()) { sawOverlay = true; break; }
  await page.waitForTimeout(50);
}

await page.waitForTimeout(4500); // let map settle

// BOA-130: overlay should be gone once loaded.
const overlayGone = (await page.locator('text=Loading map…').count()) === 0;

// BOA-131: poster preview must sit fully above the collapsed settings sheet.
const poster = await page.locator('.shadow-2xl').first().boundingBox();
const sheet = await page.locator('.fixed.bottom-0').first().boundingBox();
const posterBottom = poster ? poster.y + poster.height : null;
const sheetTop = sheet ? sheet.y : null;
const clears = posterBottom != null && sheetTop != null && posterBottom <= sheetTop + 1;

await page.screenshot({ path: '/tmp/verify-mobile-editor.png' });
await browser.close();
server.close();

console.log(JSON.stringify({ sawOverlay, overlayGone, posterBottom, sheetTop, clears }, null, 2));
const fails = [];
if (!sawOverlay) fails.push('BOA-130: loading overlay never appeared');
if (!overlayGone) fails.push('BOA-130: loading overlay stuck after load');
if (!clears) fails.push(`BOA-131: poster bottom (${posterBottom}) overlaps sheet top (${sheetTop})`);
if (fails.length) { console.error('FAIL:\n  ' + fails.join('\n  ')); process.exit(1); }
console.log('PASS — poster clears sheet; loading overlay shows then clears');
