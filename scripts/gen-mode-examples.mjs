// Generate the ModeSelect example posters from the bundled demo data:
//  - single:    the 102.5 km "Hammersmith and Fulham Running" (longest run)
//  - composite: a London composite (all runs within radius of the London region)
// Captures the editor's poster preview element to public/assets/examples/*.png.
// Usage: VITE_USE_DEMO_DATA=true npx vite build --outDir dist-demo
//        node scripts/gen-mode-examples.mjs
import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFile, mkdir } from 'fs/promises';
import { fileURLToPath } from 'url';
import path from 'path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist-demo');
const outDir = path.join(root, 'public/assets/examples');
await mkdir(outDir, { recursive: true });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png' };

const server = createServer(async (req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = path.join(dist, urlPath);
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' });
    res.end(data);
  } catch {
    const html = await readFile(path.join(dist, 'index.html'));
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(html);
  }
});
await new Promise((r) => server.listen(4182, r));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1366, height: 1024 }, deviceScaleFactor: 2 });
page.on('pageerror', (e) => console.error('PAGE ERROR:', e.message));

async function shootPoster(name) {
  // The poster preview is the shadowed, aspect-ratio'd container in PosterEditor.
  await page.waitForSelector('[aria-label^="Theme:"]', { timeout: 15000 });
  const poster = page.locator('div.shadow-2xl').first();
  await poster.waitFor({ timeout: 15000 });
  // Let map tiles + the route layer settle (no __POSTER_READY__ on the live editor).
  await page.waitForTimeout(8000);
  await poster.screenshot({ path: path.join(outDir, name) });
  console.log('wrote', name);
}

// ---- Single: longest run ----
await page.goto('http://127.0.0.1:4182/');
await page.waitForSelector('text=What do you want to make?', { timeout: 15000 });
await page.click('button:has-text("Single run")');
await page.waitForSelector('text=Suggested', { timeout: 15000 });
await page.click('button:has-text("Hammersmith and Fulham Running")');
await shootPoster('single.png');

// ---- Composite: London ----
await page.goto('http://127.0.0.1:4182/');
await page.waitForSelector('text=What do you want to make?', { timeout: 15000 });
await page.click('button:has-text("Composite")');
await page.waitForSelector('text=in this composite', { timeout: 15000 });
// Pick the London region (boroughs merge into one suggested region) + wide radius.
await page.getByRole('button', { name: /Haringey/ }).first().click();
await page.waitForTimeout(300);
const radius = page.locator('input[type=range]').first();
await radius.fill('40');
await page.waitForTimeout(300);
const cta = page.locator('button:has-text("Create composite")').first();
await cta.click();
await page.waitForTimeout(400);
const compileAnyway = page.locator('button:has-text("Compile anyway")');
if (await compileAnyway.count() > 0) await compileAnyway.first().click();
// Use a clean "London" title for the example rather than the first run's borough.
await page.waitForSelector('[aria-label^="Theme:"]', { timeout: 15000 });
await page.locator('input[placeholder^="Title"] >> visible=true').first().fill('London');
await shootPoster('composite.png');

await browser.close();
server.close();
console.log('DONE');
