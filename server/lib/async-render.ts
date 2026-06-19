/**
 * Async poster rendering — kicked off by the Stripe webhook after payment.
 *
 * Reads the full render payload from the order's poster_config column,
 * renders at print resolution via the Playwright pipeline, stores the PNG
 * in R2, and updates the order with the public URL.
 */
import { renderPoster, type RenderPayload } from './poster-renderer.js';
import { storeBuffer, getPublicUrl } from './storage.js';
import { updateOrder, type Order } from './db.js';
import { log, newRequestId } from './logger.js';

interface StoredPayload {
  theme: unknown;
  config: {
    dimensions?: { widthMm: number; heightMm: number; dpi: number };
    [key: string]: unknown;
  };
  tracks: unknown[];
  title: string;
  subtitle: string;
  showStats?: boolean;
  showCoordinates?: boolean;
  [key: string]: unknown;
}

export async function renderOrderPosterAsync(
  order: Order,
  internalBaseUrl: string,
): Promise<void> {
  const requestId = newRequestId();
  const orderId = order.order_id;

  log.info('Async render started', {
    scope: 'render.async',
    requestId,
    orderId,
    tier: order.tier,
  });

  const started = Date.now();
  try {
    if (!order.poster_config) {
      throw new Error('No poster_config on order');
    }

    const stored: StoredPayload = JSON.parse(order.poster_config);
    const dims = stored.config?.dimensions;
    if (!dims?.widthMm || !dims?.heightMm || !dims?.dpi) {
      throw new Error('Missing dimensions in poster_config');
    }

    // The stored payload is the full buildServerPayload() output from the
    // client — it includes theme, config, tracks, mode, activity, activities,
    // title, subtitle, showStats, showCoordinates. The InternalRenderPage
    // consumes all of these. Cast to RenderPayload (which uses `unknown` for
    // the rich fields) so renderPoster accepts it; the extra fields survive
    // the token round-trip as plain JSON.
    const renderPayload: RenderPayload = {
      theme: stored.theme,
      config: stored.config,
      tracks: stored.tracks ?? [],
      title: stored.title ?? '',
      subtitle: stored.subtitle ?? '',
      statsText: [],
      ...(stored.mode !== undefined && { mode: stored.mode }),
      ...(stored.activity !== undefined && { activity: stored.activity }),
      ...(stored.activities !== undefined && { activities: stored.activities }),
      ...(stored.showStats !== undefined && { showStats: stored.showStats }),
      ...(stored.showCoordinates !== undefined && { showCoordinates: stored.showCoordinates }),
    } as RenderPayload;

    const buf = await renderPoster(renderPayload, {
      widthMm: dims.widthMm,
      heightMm: dims.heightMm,
      dpi: dims.dpi,
      internalBaseUrl,
      requestId,
    });

    const key = `orders/${orderId}/poster.png`;
    await storeBuffer(key, buf, 'image/png');

    const publicUrl = getPublicUrl(key);
    await updateOrder(orderId, { png_url: publicUrl, status: 'rendered' });

    log.info('Async render completed', {
      scope: 'render.async',
      requestId,
      orderId,
      outcome: 'ok',
      durationMs: Date.now() - started,
      bufferBytes: buf.length,
      pngUrl: publicUrl,
    });
  } catch (err) {
    log.error('Async render failed', {
      scope: 'render.async',
      requestId,
      orderId,
      outcome: 'error',
      durationMs: Date.now() - started,
      error: (err as Error).message,
    });
    // Don't throw — the webhook must still return 200 to Stripe. The order
    // stays in 'paid' status without a png_url; the shipping endpoint will
    // surface the issue when the user tries to submit their address.
  }
}
