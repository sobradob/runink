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
 * True when the source holds no usable content: fully transparent, or every
 * sampled pixel (nearly) identical. A solid single colour is how a broken
 * WebGL readback manifests — iOS Safari evicts WebGL contexts under memory
 * pressure and toDataURL then returns a VALID but all-blank PNG, which the
 * old `dataUrl === 'data:,'` check waved through. A real rendered map always
 * has contrast (route line vs background), even with all layers toggled off.
 *
 * Accepts a live canvas OR a decoded snapshot <img>: the two can disagree on
 * iOS (the canvas samples fine, yet its toDataURL frame is blank), so we
 * check both — see capturePosterToBlob.
 */
function isSourceBlank(source: CanvasImageSource): boolean {
  const SAMPLE = 48;
  const probe = document.createElement('canvas');
  probe.width = SAMPLE;
  probe.height = SAMPLE;
  const ctx = probe.getContext('2d', { willReadFrequently: true });
  if (!ctx) return false; // can't tell — assume content is fine
  try {
    ctx.drawImage(source, 0, 0, SAMPLE, SAMPLE);
    const data = ctx.getImageData(0, 0, SAMPLE, SAMPLE).data;
    const [r0, g0, b0, a0] = data;
    const TOLERANCE = 4;
    for (let i = 0; i < data.length; i += 4) {
      if (
        Math.abs(data[i] - r0) > TOLERANCE ||
        Math.abs(data[i + 1] - g0) > TOLERANCE ||
        Math.abs(data[i + 2] - b0) > TOLERANCE ||
        Math.abs(data[i + 3] - a0) > TOLERANCE
      ) {
        return false; // found variation — real content
      }
    }
    return true;
  } catch {
    return false; // sampling failed — don't block the export on the probe
  }
}

/** Decode a data URL into an <img> so we can inspect the bytes that actually
 *  got serialised (not the live WebGL canvas). Rejects if decoding fails. */
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('snapshot decode failed'));
    img.src = src;
  });
}

/**
 * Captures the live preview DOM at print resolution, producing a WYSIWYG export.
 *
 * Strategy: capture the preview as-is (tiles already loaded at preview resolution)
 * using html-to-image's pixelRatio to scale up to print dimensions. This avoids
 * resizing the container and needing to re-load tiles at a higher zoom level.
 *
 * Critical: html-to-image serializes WebGL canvases via canvas.toDataURL(), but
 * the WebGL buffer can be cleared between our idle check and the actual serialization.
 * To prevent blank map exports, we pre-snapshot the MapLibre canvas to a static <img>
 * before html-to-image runs.
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
  const sideScale = Math.min(1, maxSide / maxTarget);

  // iOS Safari caps 2D canvas area at ~16.7M pixels (268MB / 16 bytes per RGBA).
  // html-to-image's output canvas = (width × pixelRatio) × (height × pixelRatio).
  // Exceeding the area limit makes toBlob silently return a blank/corrupt PNG —
  // preview looks fine but the downloaded file fails to render. We cap below the
  // threshold to stay safe across iOS, older Android, and low-memory devices.
  // The side-length cap alone is insufficient: on modern iPhones MAX_TEXTURE_SIZE
  // is 16384, so a 50×70cm @ 300 DPI (5906×8268 = 48.8M px) would slip through.
  const MAX_CANVAS_AREA = 16_000_000;
  const targetArea = targetWidth * targetHeight;
  const areaScale = targetArea > MAX_CANVAS_AREA
    ? Math.sqrt(MAX_CANVAS_AREA / targetArea)
    : 1;

  const cappedScale = Math.min(1, sideScale, areaScale);
  const outputWidth = Math.round(targetWidth * cappedScale);

  if (cappedScale < 1) {
    console.info(
      `[capture] Downscaling export: ${targetWidth}×${targetHeight} → ` +
      `${outputWidth}×${Math.round(targetHeight * cappedScale)} ` +
      `(scale=${cappedScale.toFixed(3)}, reason=${areaScale < sideScale ? 'area' : 'side'})`
    );
  }

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

  // Snapshot the WebGL canvas IMMEDIATELY while the buffer is guaranteed valid.
  // html-to-image calls canvas.toDataURL() later during DOM cloning, but by then
  // MapLibre may have cleared the WebGL buffer — causing a blank map in the export.
  const mapCanvas = map.getCanvas();

  if (isSourceBlank(mapCanvas)) {
    console.warn('[capture] Map canvas reads as uniform/blank — falling back');
    throw new Error('MAP_BLANK');
  }

  const dataUrl = mapCanvas.toDataURL('image/png');

  if (!dataUrl || dataUrl === 'data:,') {
    console.warn('[capture] Map canvas snapshot is blank — falling back');
    throw new Error('MAP_BLANK');
  }

  // Re-check the SERIALISED snapshot, not just the live canvas. On iOS the
  // live WebGL canvas can sample fine above yet toDataURL() returns a blank
  // frame (the drawing buffer is evicted under memory pressure despite
  // preserveDrawingBuffer) — that produced exported posters with no map,
  // only the HTML overlays. Decoding the snapshot and re-running the
  // uniform-pixel test catches it so the caller can fall back to the
  // device-independent server render.
  const img = await loadImage(dataUrl);
  if (isSourceBlank(img)) {
    console.warn('[capture] Serialised map snapshot is blank — falling back');
    throw new Error('MAP_BLANK');
  }

  // Swap the live WebGL canvas with the (validated) static image so
  // html-to-image serializes a stable bitmap instead of a volatile WebGL
  // context.
  // Match the CSS dimensions of the canvas (not pixel dimensions — pixelRatio handles upscaling)
  img.style.width = mapCanvas.style.width || `${mapCanvas.clientWidth}px`;
  img.style.height = mapCanvas.style.height || `${mapCanvas.clientHeight}px`;
  img.style.position = 'absolute';
  img.style.top = '0';
  img.style.left = '0';

  const canvasContainer = mapCanvas.parentElement!;
  mapCanvas.style.display = 'none';
  canvasContainer.appendChild(img);

  try {
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
  } finally {
    // Restore the live canvas
    mapCanvas.style.display = '';
    img.remove();
  }
}
