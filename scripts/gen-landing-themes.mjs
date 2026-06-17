// Generate the landing-page theme-showcase thumbnails: the same single run
// (the 102.5 km "Hammersmith and Fulham Running") rendered across every theme
// in src/data/themes.json. One PNG per theme → public/assets/landing/themes/{id}.png.
//
// Kept separate from gen-mode-examples.mjs on purpose: this drives the live
// editor's theme chips and switches styles repeatedly, so it must not risk the
// already-committed single.png / composite.png examples. Captured at
// deviceScaleFactor 1 because the thumbnails render small in a scrolling strip —
// keeps the landing page light (mobile users pay every byte on first paint).
//
// Requires the demo dataset at public/data/ (gitignored — index.json + tracks/).
// In a fresh worktree, symlink it from a checkout that has it before building:
//   ln -s /path/to/runink/public/data public/data
//
// Usage: VITE_USE_DEMO_DATA=true npx vite build --outDir dist-demo
//        node scripts/gen-landing-themes.mjs
import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFile, mkdir } from 'fs/promises';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';
import path from 'path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist-demo');
const outDir = path.join(root, 'public/assets/landing/themes');
await mkdir(outDir, { recursive: true });

const themes = JSON.parse(await readFile(path.join(root, 'src/data/themes.json'), 'utf8'));

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
await new Promise((r) => server.listen(4183, r));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1366, height: 1024 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.error('PAGE ERROR:', e.message));

// Open the single-run editor on the longest demo run (same path as gen-mode-examples).
try {
  await page.goto('http://127.0.0.1:4183/');
  await page.waitForSelector('text=What do you want to make?', { timeout: 30000 });
  await page.click('button:has-text("Single run")');
  await page.waitForSelector('text=Suggested', { timeout: 30000 });
  await page.click('button:has-text("Hammersmith and Fulham Running")');
  await page.waitForSelector('[aria-label^="Theme:"]', { timeout: 30000 });
} catch (e) {
  const debug = path.join(tmpdir(), 'landing-themes-debug.png');
  await page.screenshot({ path: debug, fullPage: true });
  console.error(`SETUP FAILED — wrote ${debug}`);
  throw e;
}

const poster = page.locator('div.shadow-2xl').first();
await poster.waitFor({ timeout: 15000 });
// Initial map tiles + route layer settle.
await page.waitForTimeout(9000);

for (const theme of themes) {
  const chip = page.locator(`[aria-label="Theme: ${theme.name}"]`).first();
  await chip.click();
  // setStyle triggers a full async style reload (tiles + custom layers re-added);
  // give it generous time so the screenshot isn't a half-recolored frame.
  await page.waitForTimeout(7000);
  await poster.screenshot({ path: path.join(outDir, `${theme.id}.png`) });
  console.log('wrote', `${theme.id}.png`);
}

await browser.close();
server.close();
console.log('DONE');
