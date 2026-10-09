/**
 * Pure logic for resizable bottom panel: clamping, maximizing, restoring (Feature B).
 */

export const MIN_BOTTOM_PANEL_HEIGHT = 140;
export const DEFAULT_BOTTOM_PANEL_HEIGHT = 260;

/**
 * Clamp bottom panel height:
 * - min: 140px
 * - max: 45% of window height (or 140px if window is smaller)
 */
export function clampBottomPanelHeight(height: number, windowHeight: number): number {
  const max = Math.max(MIN_BOTTOM_PANEL_HEIGHT, Math.floor(windowHeight * 0.45));
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
 * - If currently maximized (near 45% window height), restores to saved/default height.
 * - If not maximized, saves current height as restoredHeight and maximizes to 45% window height.
 */
export function toggleMaximizeBottomPanel(
  currentHeight: number,
  savedRestoredHeight: number | null | undefined,
  windowHeight: number
): { height: number; isMaximized: boolean; nextRestoredHeight: number } {
  const max = Math.max(MIN_BOTTOM_PANEL_HEIGHT, Math.floor(windowHeight * 0.45));
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
