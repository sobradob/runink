/**
 * Build a compact offline city index for BOA-118 quick filters.
 *
 * Input: GeoNames `cities15000.txt` (all cities with population > 15,000).
 * Obtain it with:
 *   curl -sSL https://download.geonames.org/export/dump/cities15000.zip -o cities15000.zip
 *   unzip cities15000.zip
 *
 * Output: `public/geo/cities.json` — served at `/geo/cities.json` and
 * lazy-loaded client-side to resolve run clusters to a nearest city name with
 * NO external geocoding API (Nominatim forbids grid reverse-geocoding).
 * (Committed static asset — NOT under the gitignored `public/data/`.)
 *
 * Run: npx tsx scripts/build-cities.ts [path/to/cities15000.txt]
 *
 * Source data © GeoNames, licensed CC BY 4.0 (https://www.geonames.org/).
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

// GeoNames tab-separated columns (0-based).
const COL = { name: 1, lat: 4, lng: 5, featureClass: 6, country: 8, population: 14 } as const;

const inPath = resolve(process.argv[2] ?? 'cities15000.txt');
const outPath = resolve('public/geo/cities.json');

const raw = readFileSync(inPath, 'utf8');
const rows: [string, number, number, number, string][] = [];

for (const line of raw.split('\n')) {
  if (!line) continue;
  const f = line.split('\t');
  if (f[COL.featureClass] !== 'P') continue; // populated places only
  const name = f[COL.name];
  const lat = Number(f[COL.lat]);
  const lng = Number(f[COL.lng]);
  const pop = Number(f[COL.population]) || 0;
  const cc = f[COL.country] || '';
  if (!name || Number.isNaN(lat) || Number.isNaN(lng)) continue;
  // 3 decimals ≈ 110m — far finer than city granularity needs, keeps bytes down.
  rows.push([name, Math.round(lat * 1000) / 1000, Math.round(lng * 1000) / 1000, pop, cc]);
}

// Population desc: lets the runtime nearest-city scan prefer the bigger metro
// (suburbs merge into the city) and short-circuit sensibly.
rows.sort((a, b) => b[3] - a[3]);

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(rows));

const bytes = Buffer.byteLength(JSON.stringify(rows));
console.log(`Wrote ${rows.length} cities → ${outPath} (${(bytes / 1024 / 1024).toFixed(2)} MB)`);
