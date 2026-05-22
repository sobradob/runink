/**
 * Debug inspection: launch a browser, navigate to the smoke render page,
 * dump the resulting DOM tree so we can diagnose layout issues.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';
import { storePayload } from '../server/lib/poster-renderer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Store the payload via the server's in-process store by fetch call — we
// need a token the server recognises. This script uses the /_smoke endpoint
// differently: it POSTs a payload and reads back diagnostic info.

const port = parseInt(process.env.PORT || '8099', 10);

async function main() {
  // Seed a payload into the server by hitting /_smoke-seed (we'll add one).
  const seedRes = await fetch(`http://127.0.0.1:${port}/api/render/_smoke-seed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      // Minimal payload — just enough to mount the InternalRenderPage.
      theme: JSON.parse(fs.readFileSync(path.resolve(__dirname, '../src/data/themes.json'), 'utf8'))[0],
      config: {
        mode: 'individual',
        themeId: 'noir',
        dimensions: { label: '30x40', widthMm: 300, heightMm: 400, dpi: 150, category: 'printable', tierId: 'a4-poster' },
        title: 'Debug',
        subtitle: 'London',
        showStats: true,
        showCoordinates: true,
        showGradientFade: true,
        padding: 0.15,
        bearing: 0,
        layers: { water: true, parks: true, buildings: true, roads: true, rail: true },
        markers: [],
      },
      tracks: [{ id: 'd', coords: [[-0.0758, 51.5055], [-0.0760, 51.5060], [-0.0755, 51.5060]] }],
      mode: 'individual',
      activity: {
        id: 'd',
        name: 'Debug',
        date: '2026-04-20T10:00:00Z',
        timestamp: 0,
        location: 'London',
        distance: 1000,
        duration: 300,
        movingDuration: 300,
        avgPace: 300,
        elevationGain: 10,
        hasTrack: true,
        sportType: 'Run',
        startPoint: { lat: 51.5055, lng: -0.0758 },
        bounds: { minLat: 51.5055, maxLat: 51.5060, minLng: -0.0760, maxLng: -0.0755 },
      },
      title: 'Debug',
      subtitle: 'London',
      showStats: true,
      showCoordinates: true,
    }),
  });

  if (!seedRes.ok) throw new Error(`seed ${seedRes.status}: ${await seedRes.text()}`);
  const { token } = await seedRes.json();
  console.log('[inspect] seeded token:', token);

  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1772, height: 2362 },
    deviceScaleFactor: 1,
  });
  const page = await ctx.newPage();
  page.on('console', (msg) => console.log('[page]', msg.type(), msg.text()));
  const noMap = process.argv.includes('--no-map');
  const q = noMap ? '?no-map=1' : '';
  await page.goto(`http://127.0.0.1:${port}/internal/render-poster/${token}${q}`, { waitUntil: 'load' });
  await page.waitForFunction('window.__POSTER_READY__ === true', null, { timeout: 30_000 }).catch(() => {});

  const bodyHtml = await page.evaluate(() => document.body.outerHTML);
  console.log('[inspect] BODY HTML length:', bodyHtml.length);
  fs.writeFileSync(path.resolve(__dirname, '../smoke-inspect.html'), bodyHtml);

  // Count of StatsOverlay elements
  const count = await page.evaluate(() => document.querySelectorAll('[data-stats-overlay]').length);
  console.log('[inspect] StatsOverlay count:', count);

  // Bounding boxes of all stats overlays
  const boxes = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-stats-overlay]')).map((el) => {
      const r = (el as HTMLElement).getBoundingClientRect();
      return { top: r.top, left: r.left, width: r.width, height: r.height, bottom: r.bottom };
    }),
  );
  console.log('[inspect] StatsOverlay bounding boxes:', boxes);

  await page.screenshot({ path: path.resolve(__dirname, '../smoke-inspect.png'), fullPage: false });
  console.log('[inspect] Wrote smoke-inspect.html + smoke-inspect.png');
  await browser.close();
}

main().catch((err) => {
  console.error('[inspect] FAIL:', err);
  process.exit(1);
});

// Suppress unused-import lint
void storePayload;
