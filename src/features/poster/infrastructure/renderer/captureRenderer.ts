import { toBlob } from 'html-to-image';
import type maplibregl from 'maplibre-gl';
import type { PosterDimensions } from '@/types/poster';
import type { BBox } from '@/shared/geo/bounds';
import { bboxToMaplibre } from '@/shared/geo/bounds';

function mmToPixels(mm: number, dpi: number): number {
  return Math.round((mm / 25.4) * dpi);
}

interface CaptureOptions {
  element: HTMLElement;
  map: maplibregl.Map;
  dimensions: PosterDimensions;
  bounds: BBox;
  padding: number;
  bearing: number;
}

/**
 * Captures the live preview DOM at print resolution, producing a WYSIWYG export.
 *
 * Strategy:
 * 1. Temporarily resize the preview container to target print pixels
 * 2. Re-fit map bounds at the new resolution so the route fills the frame
 * 3. Let MapLibre re-render tiles at that resolution
 * 4. Capture the DOM (map canvas + HTML overlays) via html-to-image
 * 5. Restore the container to its original size and re-fit bounds
 */
export async function capturePosterToBlob(opts: CaptureOptions): Promise<Blob> {
  const { element, map, dimensions, bounds, padding, bearing } = opts;
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

  // Record original size before resizing so we can scale the HTML overlay
  const originalWidth = element.offsetWidth;
  const overlay = element.querySelector('[data-stats-overlay]') as HTMLElement | null;

  try {
    // Resize to print dimensions
    element.style.width = `${renderWidth}px`;
    element.style.height = `${renderHeight}px`;
    element.style.maxWidth = 'none';
    element.style.maxHeight = 'none';
    element.style.aspectRatio = 'auto';
    element.style.overflow = 'hidden';

    // Scale the StatsOverlay so text/padding match the larger canvas
    const overlayScale = renderWidth / originalWidth;
    if (overlay) {
      overlay.style.transform = `scale(${overlayScale})`;
      overlay.style.transformOrigin = 'bottom left';
      overlay.style.width = `${originalWidth}px`;
      overlay.style.right = 'auto';
    }

    // Let MapLibre adapt to new size and re-fit the route into the larger canvas
    map.resize();
    map.fitBounds(bboxToMaplibre(bounds, padding), {
      animate: false,
      bearing,
    });

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

    // Restore overlay scaling
    if (overlay) {
      overlay.style.transform = '';
      overlay.style.transformOrigin = '';
      overlay.style.width = '';
      overlay.style.right = '';
    }

    // Let MapLibre adapt back and restore the route framing for the preview
    map.resize();
    map.fitBounds(bboxToMaplibre(bounds, padding), {
      animate: false,
      bearing,
    });
  }
}
