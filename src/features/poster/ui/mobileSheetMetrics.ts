// Shared collapsed-height metrics for the mobile settings sheet.
//
// Kept in a plain module (not the component file) so both MobileSettingsSheet
// and PosterEditor can import them without tripping react-refresh's
// "only-export-components" rule. The editor uses collapsedSheetHeight() to
// reserve space below the poster so the fixed bottom sheet never overlaps it
// (BOA-131).

export const COLLAPSED_HEIGHT = 165; // px — fits drag handle + Customize button + Export + Order buttons
export const THEME_STRIP_HEIGHT = 64; // px — extra collapsed height when a theme strip is present
export const STEPS_RAIL_HEIGHT = 44; // px — extra collapsed height when a guided-step rail is present

/** Total collapsed footprint of the sheet given which optional slots are present. */
export function collapsedSheetHeight({ themeStrip = false, stepsRail = false } = {}): number {
  return COLLAPSED_HEIGHT + (themeStrip ? THEME_STRIP_HEIGHT : 0) + (stepsRail ? STEPS_RAIL_HEIGHT : 0);
}
