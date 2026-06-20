import { toBlob } from 'html-to-image';
import type { Map as MaplibreMap } from 'maplibre-gl';
import type { PosterDimensions } from '@/types/poster';

function mmToPixels(mm: number, dpi: number): number {
  return Math.round((mm / 25.4) * dpi);
}

function perfNow(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

interface CaptureOptions {
  element: HTMLElement;
  map: MaplibreMap;
  dimensions: PosterDimensions;
  /** Optional sink for per-stage timings (ms). Wired to the ExportTimer so the
   *  capture stages show up alongside the server/watermark spans. */
  mark?: (name: string, ms: number) => void;
}

/**
 * True when the source holds no usable content: fully transparent, or (nearly)
 * a single flat colour across the WHOLE frame. A solid/near-solid fill is how a
 * broken WebGL readback manifests — iOS evicts WebGL contexts under memory
 * pressure and toDataURL then returns a VALID but blank PNG, which the old
 * `dataUrl === 'data:,'` check waved through. A real rendered map always has
 * contrast somewhere (route line, labels, basemap features).
 *
 * Detection: downscale the entire source to a small probe with nearest-neighbour
 * sampling (NOT smoothing — smoothing blends a thin route line into the basemap
 * and hides it), then measure the per-channel range across all sampled pixels.
 * A flat range on every channel ⇒ blank. This is strictly stronger than the old
 * "top-left 48×48 must be uniform" check, which missed the real iOS failure
 * mode: a partially-corrupt frame whose top-left corner happened to vary enough
 * to read as content while the map itself was gone.
 *
 * Errs toward "blank": a false positive only routes the export to the
 * (correct, fast) server render, whereas a false negative ships a blank poster.
 *
 * Accepts a live canvas OR a decoded snapshot <img>: the two can disagree on
 * iOS (the canvas samples fine, yet its toDataURL frame is blank), so we
 * check both — see capturePosterToBlob.
 */
function isSourceBlank(source: CanvasImageSource): boolean {
  const N = 96; // 96×96 = 9216 samples spread across the whole frame
  const probe = document.createElement('canvas');
  probe.width = N;
  probe.height = N;
  const ctx = probe.getContext('2d', { willReadFrequently: true });
  if (!ctx) return false; // can't tell — assume content is fine
  try {
    ctx.imageSmoothingEnabled = false; // nearest-neighbour preserves route/label pixels
    ctx.drawImage(source, 0, 0, N, N);
    const data = ctx.getImageData(0, 0, N, N).data;
    let rMin = 255, rMax = 0, gMin = 255, gMax = 0;
    let bMin = 255, bMax = 0, aMin = 255, aMax = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
      if (r < rMin) rMin = r; if (r > rMax) rMax = r;
      if (g < gMin) gMin = g; if (g > gMax) gMax = g;
      if (b < bMin) bMin = b; if (b > bMax) bMax = b;
      if (a < aMin) aMin = a; if (a > aMax) aMax = a;
    }
    const TOLERANCE = 6; // allow JPEG/compression noise on an otherwise flat fill
    return (
      rMax - rMin <= TOLERANCE &&
      gMax - gMin <= TOLERANCE &&
      bMax - bMin <= TOLERANCE &&
      aMax - aMin <= TOLERANCE
    );
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
  const { element, map, dimensions, mark } = opts;
  const since = (name: string, start: number) => mark?.(name, perfNow() - start);
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
  const tilesStart = perfNow();
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

  since('tiles_wait_ms', tilesStart);

  // Snapshot the WebGL canvas IMMEDIATELY while the buffer is guaranteed valid.
  // html-to-image calls canvas.toDataURL() later during DOM cloning, but by then
  // MapLibre may have cleared the WebGL buffer — causing a blank map in the export.
  const blankCheckStart = perfNow();
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

  since('blank_check_ms', blankCheckStart);

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
    const domStart = perfNow();
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

    since('capture_dom_ms', domStart);
    if (!blob) throw new Error('html-to-image returned null blob');
    return blob;
  } finally {
    // Restore the live canvas
    mapCanvas.style.display = '';
    img.remove();
  }
}
