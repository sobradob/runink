import { toBlob } from 'html-to-image';
import type { PosterDimensions } from '@/types/poster';

function mmToPixels(mm: number, dpi: number): number {
  return Math.round((mm / 25.4) * dpi);
}

interface CaptureOptions {
  element: HTMLElement;
  map: unknown; // kept for API compat, unused
  dimensions: PosterDimensions;
}

/**
 * Captures the live preview DOM at print resolution, producing a WYSIWYG export.
 *
 * Strategy: capture the preview as-is (tiles already loaded at preview resolution)
 * using html-to-image's pixelRatio to scale up to print dimensions. This avoids
 * resizing the container and needing to re-load tiles at a higher zoom level.
 */
export async function capturePosterToBlob(opts: CaptureOptions): Promise<Blob> {
  const { element, dimensions } = opts;
  const targetWidth = mmToPixels(dimensions.widthMm, dimensions.dpi);
  const targetHeight = mmToPixels(dimensions.heightMm, dimensions.dpi);

  // Detect max WebGL texture size; scale down if needed
  let maxSide = 4096;
  try {
    const gl = document.createElement('canvas').getContext('webgl');
    if (gl) maxSide = gl.getParameter(gl.MAX_TEXTURE_SIZE) || 4096;
  } catch { /* use default */ }

  const maxTarget = Math.max(targetWidth, targetHeight);
  const cappedScale = Math.min(1, maxSide / maxTarget);
  const outputWidth = Math.round(targetWidth * cappedScale);
  const outputHeight = Math.round(targetHeight * cappedScale);

  // Compute pixelRatio to scale the preview up to print resolution
  const previewWidth = element.offsetWidth;
  const pixelRatio = outputWidth / previewWidth;

  // Small delay to ensure map is fully rendered
  await new Promise((r) => setTimeout(r, 200));

  // Capture the DOM at high resolution using pixelRatio
  const blob = await toBlob(element, {
    width: previewWidth,
    height: element.offsetHeight,
    pixelRatio,
    cacheBust: true,
    filter: (node: HTMLElement) => {
      if (node.dataset?.exportHide === 'true') return false;
      return true;
    },
  });

  if (!blob) throw new Error('html-to-image returned null blob');
  return blob;
}
