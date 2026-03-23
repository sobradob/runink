import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import { authRouter } from './routes/auth.js';
import { activitiesRouter } from './routes/activities.js';

const app = express();
const PORT = parseInt(process.env.SERVER_PORT || '3009', 10);

app.use(cookieParser());
app.use(express.json());

// Mount routes
app.use('/auth', authRouter);
app.use('/api/strava', activitiesRouter);

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`RunInk API server running on http://localhost:${PORT}`);
  console.log(`Strava OAuth redirect: ${process.env.STRAVA_REDIRECT_URI}`);
});
