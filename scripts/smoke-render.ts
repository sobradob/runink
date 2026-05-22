/**
 * Smoke test for the server-side poster renderer.
 *
 * Exercises the full Playwright pipeline end-to-end: POSTs a synthetic
 * payload to a dev-only endpoint which runs `renderPoster` in the server
 * process (so the in-memory token store is shared) and streams back the PNG.
 *
 * Prerequisites: the dev server must be running locally with NODE_ENV!=production
 * AND ENABLE_SMOKE_ENDPOINTS=true (belt-and-braces — both gates must pass).
 *
 *   # terminal 1
 *   NODE_ENV=development ENABLE_SMOKE_ENDPOINTS=true PORT=8099 node --import tsx server/index.ts
 *
 *   # terminal 2
 *   npx tsx scripts/smoke-render.ts
 *
 * Writes `smoke-render.png` at repo root on success.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const themesPath = path.resolve(__dirname, '../src/data/themes.json');
const themes = JSON.parse(fs.readFileSync(themesPath, 'utf8'));
const noir = themes[0];

// Hand-crafted GPS track around Tower Bridge, London.
const sampleTrack = {
  id: 'smoke-1',
  coords: [
    [-0.0758, 51.5055],
    [-0.0759, 51.5058],
    [-0.0762, 51.5061],
    [-0.0765, 51.5063],
    [-0.0769, 51.5065],
    [-0.0774, 51.5065],
    [-0.0779, 51.5064],
    [-0.0782, 51.5062],
    [-0.0785, 51.5059],
    [-0.0786, 51.5055],
    [-0.0783, 51.5051],
    [-0.0778, 51.5049],
    [-0.0772, 51.5048],
    [-0.0765, 51.5049],
    [-0.0760, 51.5051],
    [-0.0758, 51.5055],
  ],
};

const sampleActivity = {
  id: 'smoke-1',
  name: 'Smoke Test Run',
  date: '2026-04-20T10:00:00Z',
  timestamp: Date.parse('2026-04-20T10:00:00Z'),
  location: 'London, UK',
  distance: 4200,
  duration: 1260,
  movingDuration: 1260,
  avgPace: 300,
  elevationGain: 15,
  hasTrack: true,
  sportType: 'Run',
  startPoint: { lat: 51.5055, lng: -0.0758 },
  bounds: { minLat: 51.5048, maxLat: 51.5065, minLng: -0.0786, maxLng: -0.0758 },
};

const payload = {
  theme: noir,
  config: {
    mode: 'individual',
    themeId: 'noir',
    dimensions: { label: '30x40cm', widthMm: 300, heightMm: 400, dpi: 150, category: 'printable', tierId: 'a4-poster' },
    title: 'Smoke Test',
    subtitle: 'London, UK',
    showStats: true,
    showCoordinates: true,
    showGradientFade: true,
    padding: 0.15,
    bearing: 0,
    layers: { water: true, parks: true, buildings: true, roads: true, rail: true },
    markers: [],
  },
  tracks: [sampleTrack],
  mode: 'individual',
  activity: sampleActivity,
  title: 'Smoke Test',
  subtitle: 'London, UK',
  showStats: true,
  showCoordinates: true,
  // Legacy fields the server-side RenderPayload contract still carries
  statsText: ['4.2 km', '21:00', '5:00/km'],
  coordinateText: '51.5055°N, 0.0758°W',
};

const port = parseInt(process.env.PORT || '8099', 10);
const url = `http://127.0.0.1:${port}/api/render/_smoke`;

async function main() {
  console.log(`[smoke] POST ${url}`);
  const started = Date.now();
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      payload,
      dimensions: { widthMm: 300, heightMm: 400, dpi: 150 },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 400)}`);
  }

  const buf = Buffer.from(await res.arrayBuffer());
  const out = path.resolve(__dirname, '../smoke-render.png');
  fs.writeFileSync(out, buf);
  console.log(`[smoke] Wrote ${out} (${buf.length} bytes) in ${Date.now() - started}ms`);
}

main().catch((err) => {
  console.error('[smoke] FAIL:', err.message);
  process.exit(1);
});
