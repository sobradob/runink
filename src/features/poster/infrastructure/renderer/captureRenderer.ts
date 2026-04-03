import { toBlob } from 'html-to-image';
import type maplibregl from 'maplibre-gl';
import type { PosterDimensions } from '@/types/poster';

function mmToPixels(mm: number, dpi: number): number {
  return Math.round((mm / 25.4) * dpi);
}

/**
 * Captures the live preview DOM at print resolution, producing a WYSIWYG export.
 *
 * Strategy:
 * 1. Temporarily resize the preview container to target print pixels
 * 2. Let MapLibre re-render tiles at that resolution
 * 3. Capture the DOM (map canvas + HTML overlays) via html-to-image
 * 4. Restore the container to its original size
 */
export async function capturePosterToBlob(
  element: HTMLElement,
  map: maplibregl.Map,
  dimensions: PosterDimensions
): Promise<Blob> {
  const targetWidth = mmToPixels(dimensions.widthMm, dimensions.dpi);
  const targetHeight = mmToPixels(dimensions.heightMm, dimensions.dpi);

  // Detect max WebGL texture size; scale down if needed
  let maxSide = 4096;
  try {
    const gl = document.createElement('canvas').getContext('webgl');
    if (gl) maxSide = gl.getParameter(gl.MAX_TEXTURE_SIZE) || 4096;
  } catch { /* use default */ }

  const scale = Math.min(1, maxSide / Math.max(targetWidth, targetHeight));
  const renderWidth = Math.round(targetWidth * scale);
  const renderHeight = Math.round(targetHeight * scale);

  // Save original styles
  const origWidth = element.style.width;
  const origHeight = element.style.height;
  const origMaxWidth = element.style.maxWidth;
  const origMaxHeight = element.style.maxHeight;
  const origAspectRatio = element.style.aspectRatio;
  const origOverflow = element.style.overflow;

  try {
    // Resize to print dimensions
    element.style.width = `${renderWidth}px`;
    element.style.height = `${renderHeight}px`;
    element.style.maxWidth = 'none';
    element.style.maxHeight = 'none';
    element.style.aspectRatio = 'auto';
    element.style.overflow = 'hidden';

    // Let MapLibre adapt to new size
    map.resize();

    // Wait for all tiles to load at the new resolution
    await new Promise<void>((resolve) => {
      const tryResolve = () => {
        if (map.loaded() && map.areTilesLoaded()) {
          // Double-idle: trigger repaint and wait one more cycle
          map.triggerRepaint();
          map.once('idle', () => resolve());
        } else {
          map.once('idle', tryResolve);
        }
      };

      if (map.loaded() && map.areTilesLoaded()) {
        map.triggerRepaint();
        map.once('idle', () => resolve());
      } else {
        map.once('idle', tryResolve);
      }
    });

    // Small delay to ensure all CSS/fonts have rendered
    await new Promise((r) => setTimeout(r, 100));

    // Capture the DOM
    const blob = await toBlob(element, {
      width: renderWidth,
      height: renderHeight,
      pixelRatio: 1,
      cacheBust: true,
      // Exclude elements that shouldn't appear in the export
      filter: (node: HTMLElement) => {
        // Remove any interactive controls that might be overlaid
        if (node.dataset?.exportHide === 'true') return false;
        return true;
      },
    });

    if (!blob) throw new Error('html-to-image returned null blob');
    return blob;
  } finally {
    // Restore original styles
    element.style.width = origWidth;
    element.style.height = origHeight;
    element.style.maxWidth = origMaxWidth;
    element.style.maxHeight = origMaxHeight;
    element.style.aspectRatio = origAspectRatio;
    element.style.overflow = origOverflow;

    // Let MapLibre adapt back
    map.resize();
  }
}
