import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { authRouter } from './routes/auth.js';
import { activitiesRouter } from './routes/activities.js';
import { giftRouter } from './routes/gift.js';
import { ordersRouter } from './routes/orders.js';
import { webhooksRouter } from './routes/webhooks.js';
import { adminRouter } from './routes/admin.js';
import { renderRouter } from './routes/render.js';
import { exportAsyncRouter } from './routes/export-async.js';
import { initDb } from './lib/db.js';
import { LOCAL_DIR } from './lib/storage.js';
import { closeBrowser, verifyChromium } from './lib/poster-renderer.js';
import { log, newRequestId } from './lib/logger.js';
import { reportServerError } from './lib/error-reporter.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = parseInt(process.env.PORT || process.env.SERVER_PORT || '8080', 10);
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const DIST_DIR = path.resolve(__dirname, '../dist');

// Trust reverse proxy (DigitalOcean App Platform, nginx, etc.)
// Required for correct req.protocol (https) and req.ip behind a proxy.
// Value is the number of proxy hops to trust — DO App Platform adds exactly
// one (its load balancer). Using `true` (permissive) would let clients spoof
// X-Forwarded-For and bypass express-rate-limit's IP-based limiting
// (ERR_ERL_PERMISSIVE_TRUST_PROXY).
app.set('trust proxy', 1);

// Webhooks need raw body — must be before express.json()
app.use('/api/webhooks', webhooksRouter);

app.use(cookieParser());
// Render route accepts the full poster payload (tracks + theme + config).
// Compilations with many runs can exceed the default 1MB body limit, so
// this path-scoped parser (registered BEFORE the global one) handles it.
app.use('/api/render', express.json({ limit: '8mb' }));
app.use(express.json({ limit: '1mb' }));

// Mount API routes
app.use('/auth', authRouter);
app.use('/api/strava', activitiesRouter);
app.use('/api/gift', giftRouter);
app.use('/api/orders', ordersRouter);
app.use('/api/admin', adminRouter);
app.use('/api/render', renderRouter);
app.use('/api/export', express.json({ limit: '8mb' }));
app.use('/api/export', exportAsyncRouter);

// Serve locally uploaded files (dev fallback)
app.use('/uploads', express.static(LOCAL_DIR));

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// Production: serve built frontend as static files
if (IS_PRODUCTION || fs.existsSync(DIST_DIR)) {
  // Serve static assets with cache headers
  app.use(express.static(DIST_DIR, {
    maxAge: IS_PRODUCTION ? '1y' : 0,
    index: false, // Don't auto-serve index.html for /
  }));

  // SPA fallback: all non-API routes serve index.html
  // No-cache on HTML so browsers always fetch the latest after a deploy
  // (hashed JS/CSS bundles are already cache-busted by Vite)
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api/') || req.path.startsWith('/auth/') || req.path.startsWith('/uploads/')) {
      return next();
    }
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.sendFile(path.join(DIST_DIR, 'index.html'));
  });

  console.log(`Serving frontend from ${DIST_DIR}`);
}

// Last-resort Express error handler — catches anything a route handler
// threw without its own try/catch (Express 5 auto-forwards async
// rejections here). Without this, an uncaught throw in a handler logs
// to stderr and the client request times out silently. With it: we
// return a structured 500 with a requestId, log the stack, and emit a
// Mixpanel `server_error` event so the same invisible bug shows up in
// dashboards instead of only being discoverable by grepping logs.
//
// Must be registered AFTER all routes including the SPA fallback. The
// 4-arg signature is how Express identifies this as an error handler
// rather than regular middleware.
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (res.headersSent) {
    // Headers already gone out — we can't change the response, just
    // make sure the failure still surfaces in Mixpanel.
    reportServerError(err, {
      scope: 'express.error_handler',
      method: req.method,
      route: req.originalUrl,
      httpStatus: res.statusCode,
      extra: { headers_sent: true },
    });
    return next(err);
  }
  const requestId = newRequestId();
  log.error('Uncaught route error', {
    scope: 'express.error_handler',
    requestId,
    method: req.method,
    path: req.originalUrl,
    error: err.message,
    stack: err.stack,
  });
  reportServerError(err, {
    scope: 'express.error_handler',
    method: req.method,
    route: req.originalUrl,
    httpStatus: 500,
    requestId,
  });
  res.status(500).json({ error: 'Internal server error', requestId });
});

// Initialize database tables before accepting requests
initDb().catch(err => {
  console.error('FATAL: Database initialization failed:', err);
  process.exit(1);
});

// Process-level safety net for errors that escape every Express handler:
//   - uncaughtException: synchronous throw from a callback (rare in async
//     code, common from third-party libs)
//   - unhandledRejection: a Promise rejected with no .catch attached
// Without these, Node 22's default behaviour is to crash the process on
// uncaughtException and (since Node 15) on unhandledRejection too. DO
// will restart us, but the failure mode would be invisible — no
// customer-impact signal in Mixpanel. We log + report, then let DO's
// supervisor handle the restart if appropriate.
process.on('uncaughtException', (err) => {
  log.error('uncaughtException', { scope: 'process', error: err.message, stack: err.stack });
  reportServerError(err, { scope: 'process.uncaughtException' });
});
process.on('unhandledRejection', (reason) => {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  log.error('unhandledRejection', { scope: 'process', error: err.message, stack: err.stack });
  reportServerError(err, { scope: 'process.unhandledRejection' });
});

// Close the Playwright browser pool cleanly on shutdown so Chromium doesn't
// linger as a zombie on the deploy host.
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    closeBrowser().finally(() => process.exit(0));
  });
}

app.listen(PORT, () => {
  console.log(`RunInk server running on http://localhost:${PORT}`);
  console.log(`Strava OAuth redirect: ${process.env.STRAVA_REDIRECT_URI}`);

  // Health checks — surface misconfiguration early
  const checks = {
    STRIPE_WEBHOOK_SECRET: !!process.env.STRIPE_WEBHOOK_SECRET,
    RESEND_API_KEY: !!process.env.RESEND_API_KEY,
    GELATO_API_KEY: !!process.env.GELATO_API_KEY,
    EMAIL_FROM: process.env.EMAIL_FROM || '(not set)',
    NOTIFY_EMAIL: process.env.NOTIFY_EMAIL || '(not set)',
    ADMIN_SECRET: !!process.env.ADMIN_SECRET,
    DATABASE_URL: !!process.env.DATABASE_URL,
    ENABLE_SERVER_RENDER: process.env.ENABLE_SERVER_RENDER === 'true',
    ENABLE_SMOKE_ENDPOINTS: process.env.ENABLE_SMOKE_ENDPOINTS === 'true',
  };
  console.log('Config check:', JSON.stringify(checks));
  if (checks.EMAIL_FROM.includes('resend.dev')) {
    console.warn('WARNING: EMAIL_FROM uses resend.dev test domain — emails to external addresses will fail silently');
  }
  if (!checks.RESEND_API_KEY) {
    console.warn('WARNING: RESEND_API_KEY not set — all emails will be skipped');
  }

  // Boot-time Chromium validation. Fire-and-forget — we don't want to delay
  // /api/health responses, but we DO want a loud failure in the logs (and an
  // unhealthy /api/render/health) if Chromium can't launch.
  // Skipped in non-production unless the server-render path is explicitly
  // enabled, to keep `tsx watch` reloads fast for non-render development.
  if (checks.ENABLE_SERVER_RENDER || IS_PRODUCTION) {
    verifyChromium().catch((err) => {
      log.error('Chromium failed to launch at boot — render endpoint will return 503', {
        scope: 'render.boot',
        outcome: 'error',
        error: err.message,
      });
    });
  }
});
