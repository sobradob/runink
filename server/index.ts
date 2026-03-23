import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import { authRouter } from './routes/auth.js';
import { activitiesRouter } from './routes/activities.js';
import { giftRouter } from './routes/gift.js';
import { ordersRouter } from './routes/orders.js';
import { webhooksRouter } from './routes/webhooks.js';
import { LOCAL_DIR } from './lib/storage.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = parseInt(process.env.SERVER_PORT || '3009', 10);

// Webhooks need raw body — must be before express.json()
app.use('/api/webhooks', webhooksRouter);

app.use(cookieParser());
app.use(express.json({ limit: '1mb' }));

// Mount routes
app.use('/auth', authRouter);
app.use('/api/strava', activitiesRouter);
app.use('/api/gift', giftRouter);
app.use('/api/orders', ordersRouter);

// Serve locally uploaded files (dev fallback)
app.use('/uploads', express.static(LOCAL_DIR));

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`RunInk API server running on http://localhost:${PORT}`);
  console.log(`Strava OAuth redirect: ${process.env.STRAVA_REDIRECT_URI}`);
});
