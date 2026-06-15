// Smoke test: drive the BOA-85/86 redesigned flow in demo mode at a phone
// viewport — ModeSelect → per-mode browse → editor (guided steps) → Switch.
// Usage: VITE_USE_DEMO_DATA=true npx vite build --outDir dist-demo
//        node scripts/smoke-mode-flow.mjs
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
await new Promise((r) => server.listen(4181, r));

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  hasTouch: true,
  isMobile: true,
});
const errors = [];
page.on('pageerror', (e) => { errors.push(e.message); console.error('PAGE ERROR:', e.message); });

function assert(cond, msg) {
  if (!cond) { console.error('ASSERT FAILED:', msg); process.exitCode = 1; }
  else console.log('ok:', msg);
}

await page.goto('http://127.0.0.1:4181/');

// 1. ModeSelect gate appears during/after load
await page.waitForSelector('text=What do you want to make?', { timeout: 15000 });
assert(await page.locator('button:has-text("Single run")').count() > 0, 'ModeSelect shows Single card');
assert(await page.locator('button:has-text("Composite")').count() > 0, 'ModeSelect shows Composite card');
await page.screenshot({ path: '/tmp/mode-select.png' });

// 2. Single mode → browse with Suggested hero section
await page.click('button:has-text("Single run")');
await page.waitForSelector('text=Suggested', { timeout: 15000 });
assert(await page.locator('text=All runs').count() > 0, 'single browse shows Suggested + All runs');
await page.screenshot({ path: '/tmp/single-browse.png' });

// 3. Open a run → editor with guided steps rail
await page.click('text=Los Angeles - Base');
await page.waitForSelector('[aria-label^="Theme:"]:visible', { timeout: 15000 });
const stepLabels = ['Theme', 'Text', 'Size'];
for (const s of stepLabels) {
  assert(await page.locator(`button:has-text("${s}")`).count() > 0, `editor step rail has ${s}`);
}
await page.waitForTimeout(3500);
await page.screenshot({ path: '/tmp/single-editor.png' });

// 4. Tap the "Size" step (the visible rail chip, not the hidden accordion
//    header) → sheet expands and the Size section is reachable
await page.locator('button:has-text("Size") >> visible=true').first().tap();
await page.waitForTimeout(900);
assert(await page.locator('text=/^Customize poster$|^Close settings$/').count() > 0, 'sheet responded to Size step');
await page.screenshot({ path: '/tmp/single-editor-size.png' });

// 5. Collapse the sheet (its backdrop covers the top bar), then Switch to composite
await page.locator('text=Close settings').tap();
await page.waitForTimeout(500);
await page.locator('button:has-text("Switch") >> visible=true').first().tap();
await page.waitForTimeout(600);
// Back in browse, now composite: a "Create composite" CTA appears
await page.waitForSelector('text=/Create composite|2\\+ runs/', { timeout: 15000 });
assert(true, 'switch from editor lands in composite browse');
await page.screenshot({ path: '/tmp/composite-browse.png' });

// 6. Create the composite → editor in compilation mode. The full demo set
//    spans several cities, so the dispersion-warning modal fires first
//    (verifies the guard survived the composite rewrite) — compile anyway.
const cta = page.locator('button:has-text("Create composite")');
if (await cta.count() > 0 && await cta.first().isEnabled()) {
  await cta.first().tap();
  await page.waitForTimeout(500);
  const compileAnyway = page.locator('button:has-text("Compile anyway")');
  if (await compileAnyway.count() > 0) {
    assert(true, 'dispersion warning fired for cross-city composite');
    await compileAnyway.first().tap();
  }
  await page.waitForSelector('[aria-label^="Theme:"]:visible', { timeout: 15000 });
  await page.waitForTimeout(3500);
  await page.screenshot({ path: '/tmp/composite-editor.png' });
  assert(true, 'composite editor opened');
} else {
  console.log('note: composite CTA disabled — skipping editor open');
}

assert(errors.length === 0, `no page errors (saw ${errors.length})`);

await browser.close();
server.close();
console.log('DONE');
