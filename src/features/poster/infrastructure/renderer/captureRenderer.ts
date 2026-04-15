import { toBlob } from 'html-to-image';
import type { Map as MaplibreMap } from 'maplibre-gl';
import type { PosterDimensions } from '@/types/poster';

function mmToPixels(mm: number, dpi: number): number {
  return Math.round((mm / 25.4) * dpi);
}

interface CaptureOptions {
  element: HTMLElement;
  map: MaplibreMap;
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
  const { element, map, dimensions } = opts;
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

  // Compute pixelRatio to scale the preview up to print resolution
  const previewWidth = element.offsetWidth;
  const pixelRatio = outputWidth / previewWidth;

  // Wait for map tiles to be fully loaded (proven double-idle pattern)
  await Promise.race([
    new Promise<void>((resolve) => {
      const done = () => {
        map.triggerRepaint();
        map.once('idle', () => resolve());
      };
      if (map.loaded() && map.areTilesLoaded()) {
        done();
      } else {
        map.once('idle', done);
      }
    }),
    // Safety timeout — don't hang forever if tiles never load
    new Promise<void>((resolve) => setTimeout(resolve, 10_000)),
  ]);

  // Sanity check: verify the map canvas isn't blank
  try {
    const mapCanvas = map.getCanvas();
    const gl = mapCanvas.getContext('webgl2') || mapCanvas.getContext('webgl');
    if (gl) {
      const pixel = new Uint8Array(4);
      // Sample a pixel near the center of the canvas
      gl.readPixels(
        Math.floor(mapCanvas.width / 2),
        Math.floor(mapCanvas.height / 2),
        1, 1,
        gl.RGBA, gl.UNSIGNED_BYTE, pixel,
      );
      if (pixel[0] === 0 && pixel[1] === 0 && pixel[2] === 0 && pixel[3] === 0) {
        console.warn('[capture] Map canvas center pixel is blank — falling back');
        throw new Error('MAP_BLANK');
      }
    }
  } catch (e: any) {
    if (e.message === 'MAP_BLANK') throw e;
    // WebGL read failed — continue anyway, might still work
    console.warn('[capture] Could not verify map canvas:', e.message);
  }

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
