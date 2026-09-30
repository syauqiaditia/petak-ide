/**
 * Pure logic for resizable bottom panel: clamping, maximizing, restoring (Feature B).
 */

export const MIN_BOTTOM_PANEL_HEIGHT = 120;
export const DEFAULT_BOTTOM_PANEL_HEIGHT = 232;

/**
 * Clamp bottom panel height:
 * - min: 120px
 * - max: 80% of window height (or 120px if window is smaller)
 */
export function clampBottomPanelHeight(height: number, windowHeight: number): number {
  const max = Math.max(MIN_BOTTOM_PANEL_HEIGHT, Math.floor(windowHeight * 0.8));
  if (isNaN(height) || height < MIN_BOTTOM_PANEL_HEIGHT) {
    return MIN_BOTTOM_PANEL_HEIGHT;
  }
  if (height > max) {
    return max;
  }
  return Math.round(height);
}

/**
 * Toggle maximize / restore on double-click:
 * - If currently maximized (near 80% window height), restores to saved/default height.
 * - If not maximized, saves current height as restoredHeight and maximizes to 80% window height.
 */
export function toggleMaximizeBottomPanel(
  currentHeight: number,
  savedRestoredHeight: number | null | undefined,
  windowHeight: number
): { height: number; isMaximized: boolean; nextRestoredHeight: number } {
  const max = Math.max(MIN_BOTTOM_PANEL_HEIGHT, Math.floor(windowHeight * 0.8));
  const isCurrentlyMaximized = currentHeight >= max - 5;

  if (isCurrentlyMaximized) {
    // Restore
    const fallback = savedRestoredHeight && savedRestoredHeight < max - 5
      ? savedRestoredHeight
      : DEFAULT_BOTTOM_PANEL_HEIGHT;
    const restored = clampBottomPanelHeight(fallback, windowHeight);
    return {
      height: restored,
      isMaximized: false,
      nextRestoredHeight: restored,
    };
  } else {
    // Maximize
    return {
      height: max,
      isMaximized: true,
      nextRestoredHeight: clampBottomPanelHeight(currentHeight, windowHeight),
    };
  }
}
