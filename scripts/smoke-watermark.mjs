// Smoke test: render a fake poster on a canvas, run applyWatermark over it,
// and screenshot the result so the mark can be inspected visually.
// Usage: node scripts/smoke-watermark.mjs  → writes /tmp/smoke-watermark.png
import { chromium } from 'playwright';
import { build } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bundlePath = '/tmp/runink-watermark-bundle.js';
await build({
  entryPoints: [path.join(root, 'src/features/poster/infrastructure/renderer/watermark.ts')],
  bundle: true,
  format: 'iife',
  globalName: 'wm',
  outfile: bundlePath,
});

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 800, height: 1000 } });
await page.setContent('<body style="margin:0"></body>');
await page.addScriptTag({ path: bundlePath });

const stats = await page.evaluate(async () => {
  // Fake poster: dark map-ish background, a route line, title text
  const c = document.createElement('canvas');
  c.width = 800;
  c.height = 1000;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#10151c';
  ctx.fillRect(0, 0, 800, 1000);
  ctx.strokeStyle = '#ff4d3d';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(120, 700);
  ctx.bezierCurveTo(250, 300, 550, 850, 680, 380);
  ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.font = '700 48px sans-serif';
  ctx.fillText('LONDON', 60, 880);

  const original = await new Promise((r) => c.toBlob(r, 'image/png'));
  const marked = await wm.applyWatermark(original);

  const img = document.createElement('img');
  img.src = URL.createObjectURL(marked);
  await new Promise((r) => (img.onload = r));
  document.body.appendChild(img);
  return {
    originalBytes: original.size,
    markedBytes: marked.size,
    width: img.naturalWidth,
    height: img.naturalHeight,
  };
});

console.log(JSON.stringify(stats));
await page.screenshot({ path: '/tmp/smoke-watermark.png' });
await browser.close();
