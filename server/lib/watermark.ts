/**
 * Server-side watermark for the free HD-email export.
 *
 * The free HD-email PNG must stay visibly watermarked so it can't substitute
 * for the paid print. Paid prints render clean — renderOrderPosterAsync and
 * /api/render/order never enable this — so keeping the watermark a single
 * opt-in step (RenderOptions.watermark, applied here) is the chokepoint that
 * guarantees paid output is never touched.
 *
 * Compositing reuses the Playwright page that already rendered the poster: we
 * draw the same diagonal tile + corner credit as the client canvas watermark
 * (src/features/poster/infrastructure/renderer/watermark.ts) onto an offscreen
 * canvas built from the screenshot buffer, then read it back as PNG. This adds
 * no native image dependency (sharp / node-canvas) and no second Chromium
 * context — it runs inside the render slot already held, so it stays within the
 * concurrency cap. Keep the drawing numbers in sync with watermark.ts so the
 * emailed poster matches the visual intent of the client mark.
 */
import type { Page } from 'playwright';

const MARK_TEXT = 'runink.app';
const CORNER_TEXT = 'made with runink.app';

/**
 * Composite the runink watermark onto a rendered poster PNG and return the new
 * PNG buffer. The mark is sized relative to the ACTUAL output pixels, so it
 * scales correctly with whatever dimensions the HD-email cap produced
 * (~3000 px / 200 DPI via hdExportDimensions).
 *
 * @param page  An open Playwright page (the poster render page is reused).
 * @param png   The clean poster screenshot.
 */
export async function watermarkPng(page: Page, png: Buffer): Promise<Buffer> {
  const dataUrl = `data:image/png;base64,${png.toString('base64')}`;

  const outB64 = await page.evaluate(
    async ({ src, mark, corner }) => {
      const img = new Image();
      img.src = src;
      await img.decode();

      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('WATERMARK_NO_2D_CONTEXT');
      ctx.drawImage(img, 0, 0);

      const base = Math.min(canvas.width, canvas.height);

      // Diagonal tiled marks across the whole image — faint, drawn in both a
      // dark and a light pass so they read on any theme background, and tiled
      // so they survive cropping.
      const tileFont = Math.max(14, Math.round(base * 0.025));
      ctx.save();
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate(-Math.PI / 6);
      ctx.font = `600 ${tileFont}px "Space Grotesk", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const stepX = tileFont * 14;
      const stepY = tileFont * 7;
      const span = Math.hypot(canvas.width, canvas.height);
      let row = 0;
      for (let y = -span / 2; y <= span / 2; y += stepY, row++) {
        const offset = row % 2 === 0 ? 0 : stepX / 2;
        for (let x = -span / 2 - offset; x <= span / 2; x += stepX) {
          ctx.fillStyle = 'rgba(0, 0, 0, 0.035)';
          ctx.fillText(mark, x + tileFont * 0.05, y + tileFont * 0.05);
          ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
          ctx.fillText(mark, x, y);
        }
      }
      ctx.restore();

      // Clearer corner credit, bottom-right.
      const cornerFont = Math.max(16, Math.round(base * 0.024));
      const pad = cornerFont;
      ctx.font = `600 ${cornerFont}px "Space Grotesk", sans-serif`;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'bottom';
      ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
      ctx.fillText(corner, canvas.width - pad + cornerFont * 0.07, canvas.height - pad + cornerFont * 0.07);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
      ctx.fillText(corner, canvas.width - pad, canvas.height - pad);

      // toDataURL → strip the "data:image/png;base64," prefix; the Node side
      // rebuilds the Buffer. (Canvas has no direct buffer bridge to Node.)
      return canvas.toDataURL('image/png').split(',')[1];
    },
    { src: dataUrl, mark: MARK_TEXT, corner: CORNER_TEXT },
  );

  return Buffer.from(outB64, 'base64');
}
