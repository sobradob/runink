/**
 * Regression check for fetchAllGpsActivities `complete` flag.
 * Simulates a Strava account with 3 pages: 200 raw (129 GPS), 200 raw (150 GPS), 80 raw (60 GPS).
 */
import { fetchAllGpsActivities } from '../server/lib/strava-client.ts';

function makeActivities(count: number, gpsCount: number, pageTag: string) {
  return Array.from({ length: count }, (_, i) => ({
    id: i,
    name: `${pageTag}-${i}`,
    type: i < gpsCount ? 'Run' : 'WeightTraining',
    sport_type: i < gpsCount ? 'Run' : 'WeightTraining',
    map: { id: 'x', summary_polyline: 'abc' },
  }));
}

const pages = [
  makeActivities(200, 129, 'p1'), // full raw page, only 129 GPS — THE bug case
  makeActivities(200, 150, 'p2'),
  makeActivities(80, 60, 'p3'),   // short page = last
];

let rateLimitFrom: number | null = null;

(globalThis as any).fetch = async (url: string) => {
  const page = Number(new URL(url).searchParams.get('page'));
  if (rateLimitFrom !== null && page >= rateLimitFrom) {
    return { ok: false, status: 429, text: async () => 'rate limited' };
  }
  const body = pages[page - 1] ?? [];
  return { ok: true, status: 200, json: async () => body };
};

function assert(cond: boolean, msg: string) {
  if (!cond) { console.error(`FAIL: ${msg}`); process.exit(1); }
  console.log(`ok: ${msg}`);
}

// Case 1: quick mode (maxPages=1) on a full raw page → must be INCOMPLETE
let r = await fetchAllGpsActivities('tok', { maxPages: 1 });
assert(r.activities.length === 129, `quick returns 129 GPS activities (got ${r.activities.length})`);
assert(r.complete === false, 'quick load of a full raw page reports complete=false (the original bug)');

// Case 2: full fetch → all pages, COMPLETE
r = await fetchAllGpsActivities('tok');
assert(r.activities.length === 129 + 150 + 60, `full fetch returns 339 (got ${r.activities.length})`);
assert(r.complete === true, 'full fetch reports complete=true');

// Case 3: full fetch rate-limited on page 2 → partial, INCOMPLETE
rateLimitFrom = 2;
r = await fetchAllGpsActivities('tok');
assert(r.activities.length === 129, `rate-limited fetch returns page 1 only (got ${r.activities.length})`);
assert(r.complete === false, 'rate-limited fetch reports complete=false (must not be cached)');

// Case 4: single-page fetch (progressive loader) — middle page → INCOMPLETE
rateLimitFrom = null;
r = await fetchAllGpsActivities('tok', { startPage: 2, maxPages: 2 });
assert(r.activities.length === 150, `single-page fetch of page 2 returns 150 (got ${r.activities.length})`);
assert(r.complete === false, 'single-page fetch of a full middle page reports complete=false');

// Case 5: single-page fetch of the last (short) page → COMPLETE
r = await fetchAllGpsActivities('tok', { startPage: 3, maxPages: 3 });
assert(r.activities.length === 60, `single-page fetch of page 3 returns 60 (got ${r.activities.length})`);
assert(r.complete === true, 'single-page fetch of a short page reports complete=true');

// Case 6: single-page fetch rate-limited with nothing accumulated → THROWS
// (empty-but-incomplete would make the client loop spin on 429s)
rateLimitFrom = 2;
let threw = false;
try {
  await fetchAllGpsActivities('tok', { startPage: 2, maxPages: 2 });
} catch (e: any) {
  threw = e?.name === 'StravaApiError' && e?.status === 429;
}
assert(threw, 'rate-limited single-page fetch throws StravaApiError(429) instead of returning empty-incomplete');

// Case 7: quick mode where page 1 IS the last page (short raw page) → COMPLETE
rateLimitFrom = null;
pages.length = 0;
pages.push(makeActivities(80, 60, 'only'));
r = await fetchAllGpsActivities('tok', { maxPages: 1 });
assert(r.complete === true, 'quick load of a short raw page reports complete=true (no pointless refetch)');

console.log('\nAll pagination checks passed.');
