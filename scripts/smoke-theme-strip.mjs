// Smoke test: drive the demo-mode build at a phone viewport, open the editor,
// and screenshot the mobile theme strip + a theme switch.
// Usage: VITE_USE_DEMO_DATA=true npx vite build --outDir dist-demo
//        node scripts/smoke-theme-strip.mjs
import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import path from 'path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist-demo');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png' };

// Static server with SPA fallback
const server = createServer(async (req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file = path.join(dist, urlPath);
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
await new Promise((r) => server.listen(4179, r));

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  hasTouch: true,
  isMobile: true,
});
page.on('pageerror', (e) => console.error('PAGE ERROR:', e.message));

await page.goto('http://127.0.0.1:4179/');
// Demo mode: activity browser should render with sample activities
await page.waitForSelector('text=Los Angeles - Base', { timeout: 15000 });
await page.click('text=Los Angeles - Base');

// Editor: wait for the theme strip chips (the desktop gallery is CSS-hidden
// at this viewport, so filter to visible buttons)
await page.waitForSelector('[aria-label^="Theme:"]:visible', { timeout: 15000 });
await page.waitForTimeout(4500); // let map tiles + track render settle
await page.screenshot({ path: '/tmp/theme-strip-collapsed.png' });

// Tap a different theme chip and confirm the map restyles
const chips = page.locator('[aria-label^="Theme:"]:visible');
const count = await chips.count();
console.log('theme chips visible:', count);
await chips.nth(5).tap();
await page.waitForTimeout(3500);
await page.screenshot({ path: '/tmp/theme-strip-switched.png' });

// Expand the sheet: Theme section should be gone (strip replaces it)
await page.tap('text=Customize poster');
await page.waitForTimeout(800);
const themeSectionCount = await page.locator('text=/^Theme$/').count();
console.log('Theme accordion sections in expanded sheet (want 0):', themeSectionCount);
await page.screenshot({ path: '/tmp/theme-strip-expanded.png' });

await browser.close();
server.close();
