// Shared collapsed-height metric for the mobile settings sheet.
//
// Kept in a plain module (not the component file) so both MobileSettingsSheet
// and PosterEditor can import it without tripping react-refresh's
// "only-export-components" rule. The editor uses collapsedSheetHeight() to
// reserve space below the poster so the fixed bottom sheet never overlaps it
// (BOA-131).
//
// The collapsed sheet shows the drag handle + the Export/Order action bar. The
// category deck (tabs) and its active panel live in the expandable area, so
// they don't add to the collapsed footprint.

export const COLLAPSED_HEIGHT = 188; // px — drag handle + Export + Order + caption

/** Collapsed footprint of the sheet. */
export function collapsedSheetHeight(): number {
  return COLLAPSED_HEIGHT;
}
