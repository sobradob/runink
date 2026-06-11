/**
 * Shared synthetic poster payload for the render smoke tests
 * (smoke-render.ts and smoke-export.ts).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const themesPath = path.resolve(__dirname, '../src/data/themes.json');
const themes = JSON.parse(fs.readFileSync(themesPath, 'utf8'));
const noir = themes[0];

// Hand-crafted GPS track around Tower Bridge, London.
const sampleTrack = {
  id: 'smoke-1',
  coords: [
    [-0.0758, 51.5055],
    [-0.0759, 51.5058],
    [-0.0762, 51.5061],
    [-0.0765, 51.5063],
    [-0.0769, 51.5065],
    [-0.0774, 51.5065],
    [-0.0779, 51.5064],
    [-0.0782, 51.5062],
    [-0.0785, 51.5059],
    [-0.0786, 51.5055],
    [-0.0783, 51.5051],
    [-0.0778, 51.5049],
    [-0.0772, 51.5048],
    [-0.0765, 51.5049],
    [-0.0760, 51.5051],
    [-0.0758, 51.5055],
  ],
};

const sampleActivity = {
  id: 'smoke-1',
  name: 'Smoke Test Run',
  date: '2026-04-20T10:00:00Z',
  timestamp: Date.parse('2026-04-20T10:00:00Z'),
  location: 'London, UK',
  distance: 4200,
  duration: 1260,
  movingDuration: 1260,
  avgPace: 300,
  elevationGain: 15,
  hasTrack: true,
  sportType: 'Run',
  startPoint: { lat: 51.5055, lng: -0.0758 },
  bounds: { minLat: 51.5048, maxLat: 51.5065, minLng: -0.0786, maxLng: -0.0758 },
};

export const smokePayload = {
  theme: noir,
  config: {
    mode: 'individual',
    themeId: 'noir',
    dimensions: { label: '30x40cm', widthMm: 300, heightMm: 400, dpi: 150, category: 'printable', tierId: 'a4-poster' },
    title: 'Smoke Test',
    subtitle: 'London, UK',
    showStats: true,
    showCoordinates: true,
    showGradientFade: true,
    padding: 0.15,
    bearing: 0,
    layers: { water: true, parks: true, buildings: true, roads: true, rail: true },
    markers: [],
  },
  tracks: [sampleTrack],
  mode: 'individual',
  activity: sampleActivity,
  title: 'Smoke Test',
  subtitle: 'London, UK',
  showStats: true,
  showCoordinates: true,
  // Legacy fields the server-side RenderPayload contract still carries
  statsText: ['4.2 km', '21:00', '5:00/km'],
  coordinateText: '51.5055°N, 0.0758°W',
};

export const smokeDimensions = { widthMm: 300, heightMm: 400, dpi: 150 };
