/**
 * End-to-end check of the progressive-load activities route with a stubbed
 * Strava API. Exercises: partial quick load → ?page=2 → ?page=3 (complete),
 * then asserts the server assembled all pages into its cache (next request
 * is a cache hit with the full list). Run: npx tsx scripts/check-activities-route.mts
 */
import express from 'express';
import cookieParser from 'cookie-parser';

// Stub Strava BEFORE the route module loads. Non-Strava URLs pass through.
const realFetch = globalThis.fetch;
function makeActivities(count: number, gpsCount: number, pageTag: string) {
  return Array.from({ length: count }, (_, i) => ({
    id: i,
    name: `${pageTag}-${i}`,
    type: i < gpsCount ? 'Run' : 'WeightTraining',
    sport_type: i < gpsCount ? 'Run' : 'WeightTraining',
    distance: 5000, moving_time: 1500, elapsed_time: 1600, total_elevation_gain: 10,
    start_date: '2026-06-01T08:00:00Z', start_date_local: '2026-06-01T09:00:00Z',
    timezone: 'Europe/Budapest', start_latlng: [47.5, 19.0], end_latlng: [47.5, 19.0],
    average_speed: 3.3, max_speed: 4.5,
    map: { id: `m${i}`, summary_polyline: '_p~iF~ps|U_ulLnnqC' },
  }));
}
// 3 pages: full raw page with only 129 GPS (the bug case), full page, short last page
const stravaPages = [
  makeActivities(200, 129, 'p1'),
  makeActivities(200, 150, 'p2'),
  makeActivities(80, 60, 'p3'),
];
let stravaCalls = 0;
globalThis.fetch = (async (input: any, init?: any) => {
  const url = String(input);
  if (url.includes('strava.com/api/v3/athlete/activities')) {
    stravaCalls++;
    const page = Number(new URL(url).searchParams.get('page'));
    return new Response(JSON.stringify(stravaPages[page - 1] ?? []), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  }
  return realFetch(input, init);
}) as typeof fetch;

const { activitiesRouter } = await import('../server/routes/activities.ts');
const { createSession } = await import('../server/lib/session.ts');

const sessionId = createSession({
  athleteId: 4242,
  athleteName: 'Check Runner',
  accessToken: 'stub-token',
  refreshToken: 'stub-refresh',
  expiresAt: Math.floor(Date.now() / 1000) + 3600, // valid — no token refresh call
});

const app = express();
app.use(cookieParser());
app.use('/api/strava', activitiesRouter);
const server = app.listen(0);
const port = (server.address() as { port: number }).port;

async function get(qs: string) {
  const res = await realFetch(`http://127.0.0.1:${port}/api/strava/activities${qs}`, {
    headers: { Cookie: `runink_session=${sessionId}` },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  return res.json();
}

function assert(cond: boolean, msg: string) {
  if (!cond) { console.error(`FAIL: ${msg}`); process.exit(1); }
  console.log(`ok: ${msg}`);
}

// 1. Quick load → page 1 only, partial
const quick = await get('?quick=true');
assert(quick.activities.length === 129, `quick returns 129 (got ${quick.activities.length})`);
assert(quick.partial === true, 'quick response is partial (raw page was full)');

// 2. Progressive pages
const p2 = await get('?page=2');
assert(p2.activities.length === 150 && p2.complete === false, `page 2 returns 150, incomplete (got ${p2.activities.length}, complete=${p2.complete})`);
const p3 = await get('?page=3');
assert(p3.activities.length === 60 && p3.complete === true, `page 3 returns 60, complete (got ${p3.activities.length}, complete=${p3.complete})`);

// 3. Cache was assembled from pending pages → next request is a cache hit
const callsBefore = stravaCalls;
const again = await get('?quick=true');
assert(again.activities.length === 339, `follow-up request serves assembled 339 (got ${again.activities.length})`);
assert(again.partial === false, 'assembled cache response is not partial');
assert(stravaCalls === callsBefore, `cache hit made no Strava calls (calls: ${stravaCalls - callsBefore})`);
assert(stravaCalls === 3, `exactly one Strava call per page overall (got ${stravaCalls})`);

// 4. Invalid page param rejected
const bad = await realFetch(`http://127.0.0.1:${port}/api/strava/activities?page=1`, {
  headers: { Cookie: `runink_session=${sessionId}` },
});
assert(bad.status === 400, `page=1 is rejected with 400 (got ${bad.status})`);

server.close();
console.log('\nAll activities-route checks passed.');
