/**
 * Async HD export endpoint — accepts email + render payload, sends a
 * verification email with a magic link. Clicking the link triggers the
 * 300 DPI render and redirects to the download/polling page.
 */
import { Router } from 'express';
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';
import { createExport, updateExport, getExport, getExportByToken } from '../lib/db.js';
import { renderPoster, type RenderPayload } from '../lib/poster-renderer.js';
import { storeBuffer, getPublicUrl } from '../lib/storage.js';
import { sendExportVerification, sendExportReady } from '../lib/email.js';
import { log, newRequestId } from '../lib/logger.js';

export const exportAsyncRouter = Router();

const exportLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many export requests, please try again later' },
});

exportAsyncRouter.post('/', exportLimiter, async (req, res) => {
  const requestId = newRequestId();

  const { email, payload, marketingOptIn } = req.body as {
    email?: string;
    payload?: unknown;
    marketingOptIn?: boolean;
  };

  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return res.status(400).json({ error: 'Valid email required', requestId });
  }
  if (!payload || typeof payload !== 'object') {
    return res.status(400).json({ error: 'Missing render payload', requestId });
  }

  const stored = payload as {
    config?: { dimensions?: { widthMm: number; heightMm: number; dpi: number } };
    theme?: unknown;
    tracks?: unknown[];
    title?: string;
    subtitle?: string;
    [key: string]: unknown;
  };
  const dims = stored.config?.dimensions;
  if (!dims?.widthMm || !dims?.heightMm || !dims?.dpi) {
    return res.status(400).json({ error: 'Missing dimensions in payload', requestId });
  }

  try {
    const verifyToken = crypto.randomUUID();
    const exp = await createExport({
      email,
      posterConfig: JSON.stringify(payload),
      verifyToken,
      marketingOptIn: !!marketingOptIn,
    });

    log.info('HD export created (pending verification)', {
      scope: 'export.async',
      requestId,
      exportId: exp.export_id,
      email: email.replace(/(.{2}).*(@.*)/, '$1***$2'),
      marketingOptIn: !!marketingOptIn,
    });

    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const verifyUrl = `${baseUrl}/api/export/verify/${verifyToken}`;

    sendExportVerification({ to: email, exportId: exp.export_id, verifyUrl })
      .catch(err => log.error('Verification email failed', {
        scope: 'export.async',
        requestId,
        exportId: exp.export_id,
        error: (err as Error).message,
      }));

    res.status(202).json({ exportId: exp.export_id, requestId });
  } catch (err) {
    log.error('HD export creation failed', {
      scope: 'export.async',
      requestId,
      error: (err as Error).message,
    });
    res.status(500).json({ error: 'Failed to queue export', requestId });
  }
});

/** Magic link: verify email and trigger render */
exportAsyncRouter.get('/verify/:token', async (req, res) => {
  const exp = await getExportByToken(req.params.token);
  if (!exp) {
    return res.redirect('/?error=invalid_link');
  }

  if (new Date(exp.expires_at) < new Date()) {
    return res.redirect('/?error=link_expired');
  }

  // Already verified — just redirect to the download page
  if (exp.status !== 'pending') {
    return res.redirect(`/export/${exp.export_id}`);
  }

  const requestId = newRequestId();
  log.info('HD export verified', {
    scope: 'export.async',
    requestId,
    exportId: exp.export_id,
    email: exp.email.replace(/(.{2}).*(@.*)/, '$1***$2'),
  });

  // Kick off the render
  const port = process.env.PORT || process.env.SERVER_PORT || '8080';
  const internalBaseUrl = `http://localhost:${port}`;
  const baseUrl = `${req.protocol}://${req.get('host')}`;

  const stored = JSON.parse(exp.poster_config || '{}');
  const dims = stored.config?.dimensions;
  if (dims?.widthMm && dims?.heightMm && dims?.dpi) {
    renderHdExport(exp.export_id, stored, dims, internalBaseUrl, baseUrl, requestId)
      .catch(err => log.error('HD export render failed', {
        scope: 'export.async',
        requestId,
        exportId: exp.export_id,
        error: (err as Error).message,
      }));
  } else {
    await updateExport(exp.export_id, { status: 'failed' });
  }

  res.redirect(`/export/${exp.export_id}`);
});

/** Get export status (used by download page) */
exportAsyncRouter.get('/:id', async (req, res) => {
  const exp = await getExport(req.params.id);
  if (!exp) {
    return res.status(404).json({ error: 'Export not found' });
  }

  res.json({
    exportId: exp.export_id,
    status: exp.status,
    pngUrl: exp.png_url,
    expiresAt: exp.expires_at,
  });
});

async function renderHdExport(
  exportId: string,
  stored: Record<string, unknown>,
  dims: { widthMm: number; heightMm: number; dpi: number },
  internalBaseUrl: string,
  baseUrl: string,
  requestId: string,
): Promise<void> {
  const started = Date.now();
  try {
    await updateExport(exportId, { status: 'rendering' });

    const renderPayload: RenderPayload = {
      theme: stored.theme,
      config: stored.config,
      tracks: (stored.tracks as unknown[]) ?? [],
      title: (stored.title as string) ?? '',
      subtitle: (stored.subtitle as string) ?? '',
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

    const key = `exports/${exportId}/poster.png`;
    await storeBuffer(key, buf, 'image/png');

    const publicUrl = getPublicUrl(key, baseUrl);
    await updateExport(exportId, {
      png_url: publicUrl,
      status: 'ready',
      rendered_at: new Date().toISOString(),
    });

    // Email the download link
    const exp = await getExport(exportId);
    if (exp?.email) {
      const downloadUrl = `${baseUrl}/export/${exportId}`;
      sendExportReady({
        to: exp.email,
        exportId,
        downloadUrl,
      }).catch(err => log.error('Export-ready email failed', {
        scope: 'export.async',
        exportId,
        error: (err as Error).message,
      }));
    }

    log.info('HD export completed', {
      scope: 'export.async',
      requestId,
      exportId,
      outcome: 'ok',
      durationMs: Date.now() - started,
      bufferBytes: buf.length,
    });
  } catch (err) {
    await updateExport(exportId, { status: 'failed' }).catch(() => {});
    log.error('HD export render failed', {
      scope: 'export.async',
      requestId,
      exportId,
      outcome: 'error',
      durationMs: Date.now() - started,
      error: (err as Error).message,
    });
  }
}
