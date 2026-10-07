/**
 * Pure calculation logic for LSP hover tooltip positioning and bounding.
 */

/**
 * Determines whether the hover tooltip should flip above the cursor.
 * If the remaining vertical space between cursor/token bottom and the bottom dock/viewport is < 260px,
 * force above: true so the tooltip is never clipped by the bottom dock or window boundary.
 */
export function shouldPlaceHoverAbove(
  visualPos: { top: number; bottom: number } | null,
  editorRect: { top: number; bottom: number; right: number },
  viewportHeight: number = 800,
  bottomDockTop?: number | null
): boolean {
  if (!visualPos) return false;

  const effectiveBottom =
    typeof bottomDockTop === 'number' && bottomDockTop > 0
      ? Math.min(bottomDockTop, viewportHeight, editorRect.bottom)
      : Math.min(viewportHeight, editorRect.bottom);

  const remainingBottomSpace = effectiveBottom - visualPos.bottom;

  // If remaining vertical space to bottom dock/viewport is < 260px, force above: true
  if (remainingBottomSpace < 260) {
    const spaceAbove = visualPos.top - Math.max(0, editorRect.top);
    // Only keep below if space above is severely constrained (< 100px) and less than remaining space below
    if (spaceAbove < 100 && spaceAbove < remainingBottomSpace) {
      return false;
    }
    return true;
  }

  // If plenty of bottom space, can place below
  return false;
}

/**
 * Computes the constrained maxWidth for the hover tooltip relative to editor boundaries.
 */
export function computeTooltipMaxWidth(
  editorWidth: number,
  visualLeft?: number,
  editorRight?: number,
  maxCap: number = 560
): number {
  let allowed = Math.min(maxCap, Math.max(260, editorWidth - 24));
  if (typeof visualLeft === 'number' && typeof editorRight === 'number') {
    const spaceToRight = editorRight - visualLeft - 16;
    if (spaceToRight > 0 && spaceToRight < allowed) {
      allowed = Math.max(260, spaceToRight);
    }
  }
  return allowed;
}
