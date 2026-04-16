export type PosterMode = 'individual' | 'compilation';

export type SizeCategory = 'printable' | 'digital-only';

export interface PosterDimensions {
  label: string;
  widthMm: number;
  heightMm: number;
  dpi: number;
  category: SizeCategory;
  /** Maps to a Gelato print tier (e.g. 'a4-poster'). Undefined for digital-only. */
  tierId?: string;
  /** True if a framed variant exists for this size. */
  frameable?: boolean;
}

export const POSTER_PRESETS: PosterDimensions[] = [
  // Print sizes — match Gelato product dimensions exactly
  { label: '30x40cm', widthMm: 300, heightMm: 400, dpi: 300, category: 'printable', tierId: 'a4-poster' },
  { label: '40x60cm', widthMm: 400, heightMm: 600, dpi: 300, category: 'printable', tierId: 'a3-poster', frameable: true },
  { label: '50x70cm', widthMm: 500, heightMm: 700, dpi: 300, category: 'printable', tierId: 'a2-poster', frameable: true },
  // Landscape variants (digital export only — no Gelato product)
  { label: '40x30cm', widthMm: 400, heightMm: 300, dpi: 300, category: 'digital-only' },
  { label: '60x40cm', widthMm: 600, heightMm: 400, dpi: 300, category: 'digital-only' },
  // Square (digital export only — Gelato product deactivated)
  { label: 'Square 40cm', widthMm: 400, heightMm: 400, dpi: 300, category: 'digital-only' },
  // Digital only
  { label: 'Instagram', widthMm: 108, heightMm: 108, dpi: 300, category: 'digital-only' },
];

export interface PosterConfig {
  mode: PosterMode;
  themeId: string;
  dimensions: PosterDimensions;
  title: string;
  subtitle: string;
  showStats: boolean;
  showCoordinates: boolean;
  showGradientFade: boolean;
  padding: number; // 0-1, fraction of map area for route padding
  bearing: number; // degrees, 0 = north up
  layers: LayerVisibility;
  markers: MapMarker[];
}

export interface LayerVisibility {
  water: boolean;
  parks: boolean;
  buildings: boolean;
  roads: boolean;
  rail: boolean;
}

export type MarkerIcon = 'home' | 'pin' | 'heart' | 'star' | 'flag' | 'circle' | 'none';

export interface MapMarker {
  id: string;
  lat: number;
  lng: number;
  label: string;
  type: 'start' | 'finish' | 'km' | 'custom';
  icon?: MarkerIcon;
}

export const MARKER_ICONS: { id: MarkerIcon; label: string; emoji: string }[] = [
  { id: 'home', label: 'Home', emoji: '🏠' },
  { id: 'pin', label: 'Pin', emoji: '📍' },
  { id: 'heart', label: 'Heart', emoji: '❤️' },
  { id: 'star', label: 'Star', emoji: '⭐' },
  { id: 'flag', label: 'Flag', emoji: '🏁' },
  { id: 'circle', label: 'Circle', emoji: '⬤' },
];

export const DEFAULT_LAYERS: LayerVisibility = {
  water: true,
  parks: true,
  buildings: true,
  roads: true,
  rail: true,
};

export interface ExportOptions {
  format: 'png';
  quality: number; // 0-1
}
