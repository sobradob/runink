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
import { LOCAL_DIR } from './lib/storage.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = parseInt(process.env.PORT || process.env.SERVER_PORT || '8080', 10);
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const DIST_DIR = path.resolve(__dirname, '../dist');

// Trust reverse proxy (DigitalOcean App Platform, nginx, etc.)
// Required for correct req.protocol (https) and req.ip behind a proxy
app.set('trust proxy', true);

// Webhooks need raw body — must be before express.json()
app.use('/api/webhooks', webhooksRouter);

app.use(cookieParser());
app.use(express.json({ limit: '1mb' }));

// Mount API routes
app.use('/auth', authRouter);
app.use('/api/strava', activitiesRouter);
app.use('/api/gift', giftRouter);
app.use('/api/orders', ordersRouter);
app.use('/api/admin', adminRouter);

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
  };
  console.log('Config check:', JSON.stringify(checks));
  if (checks.EMAIL_FROM.includes('resend.dev')) {
    console.warn('WARNING: EMAIL_FROM uses resend.dev test domain — emails to external addresses will fail silently');
  }
  if (!checks.RESEND_API_KEY) {
    console.warn('WARNING: RESEND_API_KEY not set — all emails will be skipped');
  }
});
