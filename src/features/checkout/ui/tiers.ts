/** Client-side tier definitions (mirrors server GIFT_TIERS for offline display) */
export const GIFT_TIERS_CLIENT = [
  { id: 'a4-poster', name: 'Small Poster', description: '30x40cm / 12x18" matte print', priceCents: 2500, framed: false },
  { id: 'a3-poster', name: 'Large Poster', description: '40x60cm / 18x24" matte print', priceCents: 3500, framed: false },
  { id: 'a3-framed', name: 'Large Framed', description: '40x60cm / 18x24" black frame', priceCents: 5500, framed: true },
  { id: 'a2-poster', name: 'XL Poster', description: '50x70cm / 24x36" matte print', priceCents: 4500, framed: false },
  { id: 'a2-framed', name: 'XL Framed', description: '50x70cm / 24x36" black frame', priceCents: 7500, framed: true },
];

/** Framed variant tier ID for a given base tier. */
export const FRAMED_TIER: Record<string, string> = {
  'a3-poster': 'a3-framed',
  'a2-poster': 'a2-framed',
};

/** Look up a tier by ID */
export function getTier(id: string) {
  return GIFT_TIERS_CLIENT.find((t) => t.id === id);
}

/**
 * Gelato print dimensions per tier (metric).
 * These are the actual product sizes — the poster PNG must match these exactly.
 */
export const PRINT_DIMENSIONS: Record<string, { widthMm: number; heightMm: number; dpi: number }> = {
  'a4-poster': { widthMm: 300, heightMm: 400, dpi: 300 },
  'a3-poster': { widthMm: 400, heightMm: 600, dpi: 300 },
  'a3-framed': { widthMm: 400, heightMm: 600, dpi: 300 },
  'a2-poster': { widthMm: 500, heightMm: 700, dpi: 300 },
  'a2-framed': { widthMm: 500, heightMm: 700, dpi: 300 },
};
