// Generate the landing page's prominent example images in colourful themes (so
// the hero + "two ways" cards aren't all black-and-white Noir). The 10-theme
// showcase strip stays separate (see gen-landing-themes.mjs).
//
//   hero.png             — London composite, Coral theme (the dense wow heat-map)
//   example-single.png   — 102 km single run, Japanese Ink theme
//   example-composite.png— Budapest composite, Midnight Blue theme
//
// Captured at deviceScaleFactor 2 — these are large/focal, unlike the small strip
// thumbnails. Requires the demo dataset baked into dist-demo (see gen-landing-themes).
//
// Usage: VITE_USE_DEMO_DATA=true npx vite build --outDir dist-demo
//        node scripts/gen-landing-examples.mjs
import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFile, mkdir } from 'fs/promises';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';
import path from 'path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist-demo');
const outDir = path.join(root, 'public/assets/landing');
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
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(await readFile(path.join(dist, 'index.html')));
  }
});
await new Promise((r) => server.listen(4186, r));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1366, height: 1024 }, deviceScaleFactor: 2 });
page.on('pageerror', (e) => console.error('PAGE ERROR:', e.message));

const poster = () => page.locator('div.shadow-2xl').first();

async function applyThemeAndShoot(themeName, file) {
  await page.locator(`[aria-label="Theme: ${themeName}"]`).first().click();
  // setStyle = full async style reload (tiles + custom layers re-added); wait it out.
  await page.waitForTimeout(7000);
  await poster().screenshot({ path: path.join(outDir, file) });
  console.log('wrote', file);
}

// Build a composite for the region whose suggestion button matches `regionRe`,
// at a 40 km radius, titled `title`, and leave the editor open on the poster.
async function setupComposite(regionRe, title) {
  await page.goto('http://127.0.0.1:4186/');
  await page.waitForSelector('text=What do you want to make?', { timeout: 30000 });
  await page.click('button:has-text("Composite")');
  await page.waitForSelector('text=in this composite', { timeout: 30000 });
  await page.getByRole('button', { name: regionRe }).first().click();
  await page.waitForTimeout(300);
  await page.locator('input[type=range]').first().fill('40');
  await page.waitForTimeout(300);
  await page.locator('button:has-text("Create composite")').first().click();
  await page.waitForTimeout(400);
  const compileAnyway = page.locator('button:has-text("Compile anyway")');
  if (await compileAnyway.count() > 0) await compileAnyway.first().click();
  await page.waitForSelector('[aria-label^="Theme:"]', { timeout: 30000 });
  await page.locator('input[placeholder^="Title"] >> visible=true').first().fill(title);
  await poster().waitFor({ timeout: 15000 });
  await page.waitForTimeout(9000); // initial tiles + route layer settle
}

try {
  // ---- Single run: Japanese Ink ----
  await page.goto('http://127.0.0.1:4186/');
  await page.waitForSelector('text=What do you want to make?', { timeout: 30000 });
  await page.click('button:has-text("Single run")');
  await page.waitForSelector('text=Suggested', { timeout: 30000 });
  await page.click('button:has-text("Hammersmith and Fulham Running")');
  await page.waitForSelector('[aria-label^="Theme:"]', { timeout: 30000 });
  await poster().waitFor({ timeout: 15000 });
  await page.waitForTimeout(9000); // initial tiles + route settle
  await applyThemeAndShoot('Japanese Ink', 'example-single.png');

  // ---- Hero composite: London (the densest cluster ~700 runs), Coral ----
  // The London boroughs merge under one region whose biggest contributor is Haringey.
  await setupComposite(/Haringey/, 'London');
  await applyThemeAndShoot('Coral', 'hero.png');

  // ---- Example-card composite: Budapest (~194 runs), Midnight Blue ----
  // A different city from the hero so we don't show the same heat-map twice.
  await setupComposite(/Budapest/, 'Budapest');
  await applyThemeAndShoot('Midnight Blue', 'example-composite.png');
} catch (e) {
  const debug = path.join(tmpdir(), 'landing-examples-debug.png');
  await page.screenshot({ path: debug, fullPage: true });
  console.error(`SETUP FAILED — wrote ${debug}`);
  throw e;
}

await browser.close();
server.close();
console.log('DONE');
