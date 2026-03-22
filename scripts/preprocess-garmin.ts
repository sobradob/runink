/**
 * Garmin FIT Pre-processor for RunInk
 *
 * Extracts GPS tracks from Garmin FIT files and matches them to
 * summarized activity metadata. Outputs a lightweight JSON index
 * and individual track files for the web app.
 *
 * Usage: npx tsx scripts/preprocess-garmin.ts
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import yauzl from 'yauzl';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { Decoder, Stream } = require('@garmin/fitsdk');

// === Configuration ===

const GARMIN_BASE = '/Users/boazsobrado/Desktop/codes/data/monthly_reports/exports/garmin/af7c0966-9366-469a-8ea3-bed0e0dd7f98_1';
const FITNESS_DIR = path.join(GARMIN_BASE, 'DI_CONNECT/DI-Connect-Fitness');
const UPLOADS_DIR = path.join(GARMIN_BASE, 'DI_CONNECT/DI-Connect-Uploaded-Files');
const OUTPUT_DIR = path.resolve(__dirname, '../public/data');
const TRACKS_DIR = path.join(OUTPUT_DIR, 'tracks');

// Semicircles to degrees conversion
const SEMI_TO_DEG = 180 / Math.pow(2, 31);

// Timestamp matching tolerance (ms)
const TIMESTAMP_TOLERANCE = 120_000; // 2 minutes

interface RawActivity {
  activityId: number;
  name: string;
  sportType: string;
  beginTimestamp: number;
  startTimeGmt: number;
  duration: number;
  movingDuration?: number;
  distance: number;
  elevationGain: number;
  elevationLoss: number;
  avgSpeed: number;
  avgHr: number | null;
  maxHr: number | null;
  calories: number;
  startLatitude: number | null;
  startLongitude: number | null;
  endLatitude: number | null;
  endLongitude: number | null;
  locationName: string;
  minLatitude?: number;
  maxLatitude?: number;
  minLongitude?: number;
  maxLongitude?: number;
  steps?: number;
  avgRunCadence?: number;
  vO2MaxValue?: number;
}

interface ActivityOut {
  id: string;
  name: string;
  date: string;
  timestamp: number;
  distance: number;
  duration: number;
  movingDuration: number;
  avgSpeed: number;
  avgPace: number;
  avgHr: number | null;
  maxHr: number | null;
  elevationGain: number;
  elevationLoss: number;
  calories: number;
  location: string;
  sportType: string;
  startPoint: { lat: number; lng: number } | null;
  endPoint: { lat: number; lng: number } | null;
  bounds: { minLat: number; maxLat: number; minLng: number; maxLng: number } | null;
  hasTrack: boolean;
}

interface TrackOut {
  id: string;
  coords: [number, number][]; // [lng, lat]
  elevations?: number[];
  heartRates?: number[];
}

// === Load summarized activities ===

function loadSummarizedActivities(): RawActivity[] {
  const files = [
    'sobradob@gmail.com_0_summarizedActivities.json',
    'sobradob@gmail.com_1001_summarizedActivities.json',
  ];

  const allActivities: RawActivity[] = [];

  for (const file of files) {
    const filePath = path.join(FITNESS_DIR, file);
    if (!fs.existsSync(filePath)) {
      console.warn(`File not found: ${filePath}`);
      continue;
    }

    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    // Structure: [{summarizedActivitiesExport: [...]}]
    const activities = raw[0]?.summarizedActivitiesExport ?? [];
    allActivities.push(...activities);
  }

  return allActivities;
}

// === Parse FIT file from buffer ===

interface FitResult {
  sport: string;
  startTime: Date;
  coords: [number, number][];
  elevations: number[];
  heartRates: number[];
}

function parseFitBuffer(buffer: Buffer): FitResult | null {
  try {
    const stream = Stream.fromBuffer(buffer);
    const decoder = new Decoder(stream);

    if (!decoder.isFIT()) return null;

    const { messages } = decoder.read();

    // Get session info
    const session = messages.sessionMesgs?.[0];
    if (!session) return null;

    const sport = session.sport ?? 'unknown';
    const startTime = new Date(session.startTime ?? session.timestamp);

    // Extract GPS records
    const records = messages.recordMesgs ?? [];
    const coords: [number, number][] = [];
    const elevations: number[] = [];
    const heartRates: number[] = [];

    for (const rec of records) {
      if (rec.positionLat != null && rec.positionLong != null) {
        const lat = rec.positionLat * SEMI_TO_DEG;
        const lng = rec.positionLong * SEMI_TO_DEG;

        // Filter out obviously invalid coordinates
        if (Math.abs(lat) > 90 || Math.abs(lng) > 180) continue;
        if (lat === 0 && lng === 0) continue;

        coords.push([lng, lat]); // GeoJSON order
        if (rec.enhancedAltitude != null) elevations.push(rec.enhancedAltitude);
        if (rec.heartRate != null) heartRates.push(rec.heartRate);
      }
    }

    return { sport, startTime, coords, elevations, heartRates };
  } catch {
    return null;
  }
}

// === Extract and process FIT files from ZIPs ===

function extractFitFromZip(zipPath: string): Promise<Map<string, Buffer>> {
  return new Promise((resolve, reject) => {
    const buffers = new Map<string, Buffer>();

    yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
      if (err || !zipfile) return reject(err);

      zipfile.readEntry();

      zipfile.on('entry', (entry) => {
        if (!entry.fileName.endsWith('.fit')) {
          zipfile.readEntry();
          return;
        }

        zipfile.openReadStream(entry, (err2, readStream) => {
          if (err2 || !readStream) {
            zipfile.readEntry();
            return;
          }

          const chunks: Buffer[] = [];
          readStream.on('data', (chunk: Buffer) => chunks.push(chunk));
          readStream.on('end', () => {
            buffers.set(entry.fileName, Buffer.concat(chunks));
            zipfile.readEntry();
          });
        });
      });

      zipfile.on('end', () => resolve(buffers));
      zipfile.on('error', reject);
    });
  });
}

// === Match FIT to activity by timestamp ===

function findMatchingActivity(
  fitStartTime: Date,
  activities: RawActivity[],
  matched: Set<number>
): RawActivity | null {
  const fitTs = fitStartTime.getTime();
  let bestMatch: RawActivity | null = null;
  let bestDiff = Infinity;

  for (const act of activities) {
    if (matched.has(act.activityId)) continue;

    const actTs = act.beginTimestamp; // Already in ms
    const diff = Math.abs(fitTs - actTs);

    if (diff < bestDiff && diff < TIMESTAMP_TOLERANCE) {
      bestDiff = diff;
      bestMatch = act;
    }
  }

  return bestMatch;
}

// === Convert raw activity to output format ===

function convertActivity(raw: RawActivity, hasTrack: boolean): ActivityOut {
  const durationSec = (raw.duration ?? 0) / 1000;
  const movingDurSec = (raw.movingDuration ?? raw.duration ?? 0) / 1000;
  const distMeters = (raw.distance ?? 0) / 100; // Garmin stores in cm
  const distKm = distMeters / 1000;
  const movingMin = movingDurSec / 60;
  const avgPace = distKm > 0 ? movingMin / distKm : 0; // min/km
  const avgSpeedMps = distMeters / (movingDurSec || durationSec || 1);

  return {
    id: String(raw.activityId),
    name: raw.name ?? 'Untitled Run',
    date: new Date(raw.beginTimestamp).toISOString().split('T')[0],
    timestamp: raw.beginTimestamp,
    distance: distMeters,
    duration: durationSec,
    movingDuration: movingDurSec,
    avgSpeed: avgSpeedMps,
    avgPace,
    avgHr: raw.avgHr ?? null,
    maxHr: raw.maxHr ?? null,
    elevationGain: (raw.elevationGain ?? 0) / 100, // cm to m
    elevationLoss: (raw.elevationLoss ?? 0) / 100,
    calories: raw.calories ?? 0,
    location: raw.locationName ?? '',
    sportType: raw.sportType?.toLowerCase() ?? 'running',
    startPoint: raw.startLatitude != null ? { lat: raw.startLatitude, lng: raw.startLongitude! } : null,
    endPoint: raw.endLatitude != null ? { lat: raw.endLatitude, lng: raw.endLongitude! } : null,
    bounds: raw.minLatitude != null ? {
      minLat: raw.minLatitude,
      maxLat: raw.maxLatitude!,
      minLng: raw.minLongitude!,
      maxLng: raw.maxLongitude!,
    } : null,
    hasTrack,
  };
}

// === Main ===

async function main() {
  console.log('RunInk Pre-processor — Garmin FIT → JSON\n');

  // Create output dirs
  fs.mkdirSync(TRACKS_DIR, { recursive: true });

  // Load summarized activities
  console.log('Loading summarized activities...');
  const allActivities = loadSummarizedActivities();
  const runningActivities = allActivities.filter(
    (a) => a.sportType?.toUpperCase() === 'RUNNING'
  );
  console.log(`  Total: ${allActivities.length}, Running: ${runningActivities.length}`);

  // Process ZIP files
  const zipFiles = fs.readdirSync(UPLOADS_DIR)
    .filter((f) => f.endsWith('.zip'))
    .sort();

  console.log(`\nProcessing ${zipFiles.length} ZIP archives...`);

  const matched = new Set<number>();
  const trackMap = new Map<string, TrackOut>();
  let totalFit = 0;
  let totalParsed = 0;
  let totalMatched = 0;
  let runningFit = 0;

  for (const zipFile of zipFiles) {
    const zipPath = path.join(UPLOADS_DIR, zipFile);
    console.log(`\n  ${zipFile}:`);

    const fitBuffers = await extractFitFromZip(zipPath);
    console.log(`    Extracted ${fitBuffers.size} FIT files`);
    totalFit += fitBuffers.size;

    let zipMatched = 0;
    let zipRunning = 0;

    for (const [filename, buffer] of fitBuffers) {
      const result = parseFitBuffer(buffer);
      if (!result) continue;
      totalParsed++;

      // Only process running activities
      if (result.sport !== 'running') continue;
      runningFit++;
      zipRunning++;

      // Need GPS data
      if (result.coords.length < 5) continue;

      // Match to summarized activity
      const activity = findMatchingActivity(result.startTime, runningActivities, matched);

      if (activity) {
        matched.add(activity.activityId);
        totalMatched++;
        zipMatched++;

        const trackId = String(activity.activityId);
        trackMap.set(trackId, {
          id: trackId,
          coords: result.coords,
          elevations: result.elevations.length > 0 ? result.elevations : undefined,
          heartRates: result.heartRates.length > 0 ? result.heartRates : undefined,
        });
      }
    }

    console.log(`    Running FIT: ${zipRunning}, Matched: ${zipMatched}`);
  }

  console.log(`\n--- Summary ---`);
  console.log(`Total FIT files: ${totalFit}`);
  console.log(`Parsed successfully: ${totalParsed}`);
  console.log(`Running FIT files: ${runningFit}`);
  console.log(`Matched to activities: ${totalMatched}`);

  // Write individual track files
  console.log(`\nWriting ${trackMap.size} track files...`);
  for (const [id, track] of trackMap) {
    const trackPath = path.join(TRACKS_DIR, `${id}.json`);
    fs.writeFileSync(trackPath, JSON.stringify(track));
  }

  // Build activity index
  const activityIndex = runningActivities.map((raw) => {
    const hasTrack = trackMap.has(String(raw.activityId));
    return convertActivity(raw, hasTrack);
  });

  // Sort by date descending
  activityIndex.sort((a, b) => b.timestamp - a.timestamp);

  const index = {
    generatedAt: new Date().toISOString(),
    totalActivities: activityIndex.length,
    activitiesWithTracks: activityIndex.filter((a) => a.hasTrack).length,
    activities: activityIndex,
  };

  const indexPath = path.join(OUTPUT_DIR, 'index.json');
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));

  console.log(`\nWrote ${indexPath}`);
  console.log(`  Activities: ${index.totalActivities}`);
  console.log(`  With GPS tracks: ${index.activitiesWithTracks}`);
  console.log(`\nDone!`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
