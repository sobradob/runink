/** Composite a watermark onto a rendered poster blob.
 *
 *  Applied only to free PNG exports — paid prints are rendered clean on the
 *  server. The mark is a subtle diagonal tile (survives cropping) plus a
 *  clearer corner credit. Drawn in both light and dark passes so it reads on
 *  any theme background.
 */

const MARK_TEXT = 'runink.app';
const CORNER_TEXT = 'made with runink.app';

function loadImage(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('WATERMARK_DECODE_FAILED'));
    };
    img.src = url;
  });
}

/** Encoding for the watermarked output. Digital exports use JPEG (q0.9) — far
 *  smaller and faster to load/share than PNG for a photographic map poster, and
 *  the single chokepoint every free-export render path flows through. Defaults
 *  to PNG so existing callers are unaffected. */
export interface WatermarkFormat {
  type?: 'image/png' | 'image/jpeg' | 'image/webp';
  /** 0–1, applies to lossy types only. */
  quality?: number;
}

export async function applyWatermark(blob: Blob, format: WatermarkFormat = {}): Promise<Blob> {
  const type = format.type ?? 'image/png';
  const img = await loadImage(blob);
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) return blob;
  // JPEG has no alpha — composite onto an opaque base so any transparent edge
  // becomes white rather than black. Posters are opaque, but this is cheap
  // insurance against a stray transparent pixel from the source render.
  if (type === 'image/jpeg') {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.drawImage(img, 0, 0);

  const base = Math.min(canvas.width, canvas.height);

  // Diagonal tiled marks across the whole image
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
      ctx.fillText(MARK_TEXT, x + tileFont * 0.05, y + tileFont * 0.05);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
      ctx.fillText(MARK_TEXT, x, y);
    }
  }
  ctx.restore();

  // Corner credit, bottom-right
  const cornerFont = Math.max(16, Math.round(base * 0.024));
  const pad = cornerFont;
  ctx.font = `600 ${cornerFont}px "Space Grotesk", sans-serif`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
  ctx.fillText(CORNER_TEXT, canvas.width - pad + cornerFont * 0.07, canvas.height - pad + cornerFont * 0.07);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
  ctx.fillText(CORNER_TEXT, canvas.width - pad, canvas.height - pad);

  const result = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, type, format.quality),
  );
  return result ?? blob;
}
