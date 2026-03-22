export type PosterMode = 'individual' | 'compilation';

export interface PosterDimensions {
  label: string;
  widthMm: number;
  heightMm: number;
  dpi: number;
}

export const POSTER_PRESETS: PosterDimensions[] = [
  { label: 'A4 Portrait', widthMm: 210, heightMm: 297, dpi: 300 },
  { label: 'A3 Portrait', widthMm: 297, heightMm: 420, dpi: 300 },
  { label: 'A4 Landscape', widthMm: 297, heightMm: 210, dpi: 300 },
  { label: 'A3 Landscape', widthMm: 420, heightMm: 297, dpi: 300 },
  { label: 'Square 30cm', widthMm: 300, heightMm: 300, dpi: 300 },
  { label: 'Square 40cm', widthMm: 400, heightMm: 400, dpi: 300 },
  { label: 'Instagram', widthMm: 108, heightMm: 108, dpi: 300 },
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
}

export interface ExportOptions {
  format: 'png';
  quality: number; // 0-1
}
