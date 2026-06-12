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
 *
 * Dimension overrides (print-DPI regression checks; defaults = smokeDimensions):
 *   SMOKE_DPI=300 SMOKE_WIDTH_MM=300 SMOKE_HEIGHT_MM=400 SMOKE_DSF=2 npx tsx scripts/smoke-render.ts
 * High-DPI renders are CPU-bound in software WebGL — pair with a raised
 * RENDER_TIMEOUT_MS on the server when measuring.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { smokePayload as payload, smokeDimensions } from './smoke-fixture.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const port = parseInt(process.env.PORT || '8099', 10);
const url = `http://127.0.0.1:${port}/api/render/_smoke`;

function envNum(name: string): number | undefined {
  const n = parseFloat(process.env[name] || '');
  return Number.isFinite(n) ? n : undefined;
}

const dimensions = {
  widthMm: envNum('SMOKE_WIDTH_MM') ?? smokeDimensions.widthMm,
  heightMm: envNum('SMOKE_HEIGHT_MM') ?? smokeDimensions.heightMm,
  dpi: envNum('SMOKE_DPI') ?? smokeDimensions.dpi,
  ...(envNum('SMOKE_DSF') ? { deviceScaleFactor: envNum('SMOKE_DSF') } : {}),
};

async function main() {
  console.log(`[smoke] POST ${url} dimensions=${JSON.stringify(dimensions)}`);
  const started = Date.now();
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      payload,
      dimensions,
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
