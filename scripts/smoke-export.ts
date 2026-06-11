/**
 * Smoke test for the free-export render endpoint (`POST /api/render/export`).
 *
 * Mints a fake Strava session via the dev-only `/_smoke-session` endpoint,
 * then POSTs the shared synthetic payload to the real export route — the same
 * code path production free exports take — and asserts a non-trivial PNG
 * streams back.
 *
 * Prerequisites: the dev server must be running locally with NODE_ENV!=production
 * AND ENABLE_SMOKE_ENDPOINTS=true AND ENABLE_SERVER_RENDER=true.
 *
 *   # terminal 1
 *   NODE_ENV=development ENABLE_SMOKE_ENDPOINTS=true ENABLE_SERVER_RENDER=true PORT=8099 node --import tsx server/index.ts
 *
 *   # terminal 2
 *   npx tsx scripts/smoke-export.ts
 *
 * Writes `smoke-export.png` at repo root on success.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { smokePayload, smokeDimensions } from './smoke-fixture.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const port = parseInt(process.env.PORT || '8099', 10);
const base = `http://127.0.0.1:${port}`;

async function main() {
  // 1. Mint a fake session (dev-only endpoint)
  const sessRes = await fetch(`${base}/api/render/_smoke-session`, { method: 'POST' });
  if (!sessRes.ok) throw new Error(`_smoke-session HTTP ${sessRes.status}`);
  const { sessionId } = await sessRes.json() as { sessionId: string };
  console.log(`[smoke-export] Minted session ${sessionId.slice(0, 8)}…`);

  // 2. Hit the real export route with the session cookie
  const url = `${base}/api/render/export`;
  console.log(`[smoke-export] POST ${url}`);
  const started = Date.now();
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `runink_session=${sessionId}`,
    },
    body: JSON.stringify({ payload: smokePayload, dimensions: smokeDimensions }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 400)}`);
  }
  if (res.headers.get('content-type') !== 'image/png') {
    throw new Error(`Expected image/png, got ${res.headers.get('content-type')}`);
  }

  const buf = Buffer.from(await res.arrayBuffer());
  // >50 KB rules out a silent blank render (same threshold as smoke-render)
  if (buf.length < 50_000) {
    throw new Error(`PNG suspiciously small: ${buf.length} bytes`);
  }
  const out = path.resolve(__dirname, '../smoke-export.png');
  fs.writeFileSync(out, buf);
  console.log(
    `[smoke-export] Wrote ${out} (${buf.length} bytes, requestId ${res.headers.get('x-render-request-id')}) in ${Date.now() - started}ms`
  );
}

main().catch((err) => {
  console.error('[smoke-export] FAIL:', err.message);
  process.exit(1);
});
