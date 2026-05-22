import { Router } from 'express';
import {
  getAuthorizationUrl,
  exchangeCodeForToken,
  assertScopeOk,
  StravaInsufficientScopeError,
} from '../lib/strava-client.js';
import { createSession, getSession, deleteSession } from '../lib/session.js';

export const authRouter = Router();

const COOKIE_NAME = 'runink_session';
const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  path: '/',
  maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
};

// Redirect to Strava OAuth
authRouter.get('/strava', (_req, res) => {
  const url = getAuthorizationUrl();
  console.log(`Strava auth URL: ${url}`);
  res.redirect(url);
});

// OAuth callback from Strava
authRouter.get('/strava/callback', async (req, res) => {
  const { code, error } = req.query;

  if (error || !code) {
    console.error('Strava OAuth error:', error);
    return res.redirect('/?strava=error');
  }

  try {
    const tokenData = await exchangeCodeForToken(code as string);

    // Reject the auth right here if the user didn't grant
    // activity:read_all (e.g. unchecked the "view your activities" box
    // on Strava's consent screen). Without this scope, every later
    // /athlete/activities call 401s and the user sees "HTTP 500" with
    // no recovery path. We surface a clean error code in the redirect
    // query so the frontend can show a targeted "please re-authorize
    // and tick the activities checkbox" message.
    try {
      assertScopeOk(tokenData.scope);
    } catch (scopeErr) {
      if (scopeErr instanceof StravaInsufficientScopeError) {
        console.warn(`Strava connect rejected — insufficient scope for athlete ${tokenData.athlete.id}: granted="${scopeErr.grantedScope}"`);
        return res.redirect('/?strava=missing_scope');
      }
      throw scopeErr;
    }

    const sessionId = createSession({
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresAt: tokenData.expires_at,
      athleteId: tokenData.athlete.id,
      athleteName: `${tokenData.athlete.firstname} ${tokenData.athlete.lastname}`.trim(),
    });

    res.cookie(COOKIE_NAME, sessionId, COOKIE_OPTIONS);
    console.log(`Strava connected: ${tokenData.athlete.firstname} ${tokenData.athlete.lastname}`);

    // Redirect back to the frontend
    res.redirect('/?strava=connected');
  } catch (err) {
    console.error('Strava token exchange failed:', err);
    res.redirect('/?strava=error');
  }
});

// Check auth status
authRouter.get('/strava/status', (req, res) => {
  const sessionId = req.cookies?.[COOKIE_NAME];
  if (!sessionId) {
    return res.json({ connected: false });
  }

  const session = getSession(sessionId);
  if (!session) {
    return res.json({ connected: false });
  }

  res.json({
    connected: true,
    athlete: {
      name: session.athleteName,
      id: session.athleteId,
    },
  });
});

// Disconnect Strava
authRouter.post('/strava/disconnect', (req, res) => {
  const sessionId = req.cookies?.[COOKIE_NAME];
  if (sessionId) {
    deleteSession(sessionId);
  }
  res.clearCookie(COOKIE_NAME);
  res.json({ ok: true });
});
