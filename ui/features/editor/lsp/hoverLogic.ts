/**
 * Pure calculation logic for LSP hover tooltip positioning and bounding.
 */

export interface AdaptiveHoverOptions {
  viewportWidth?: number;
  viewportHeight?: number;
  rightDockLeft?: number | null;
  bottomDockTop?: number | null;
  padding?: number;
}

export interface AdaptiveHoverCoords {
  above: boolean;
  translateX: number;
  maxWidth: number;
  spaceAbove: number;
  spaceBelow: number;
  spaceLeft: number;
  spaceRight: number;
  shiftLeft: boolean;
  effectiveRight: number;
  effectiveLeft: number;
  effectiveBottom: number;
  effectiveTop: number;
}

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

/**
 * Pure calculation for adaptive quad-direction bounding (top, bottom, left, right).
 * Dynamically avoids clipping against right dock, bottom dock, top editor bar, and left gutter.
 */
export function computeAdaptiveHoverCoords(
  arg1: any,
  arg2?: any,
  arg3?: any,
  arg4?: any
): AdaptiveHoverCoords {
  let visualPos: { top: number; bottom: number; left?: number; right?: number } | null = null;
  let editorRect: { top: number; bottom: number; left?: number; right: number; width?: number };
  let tooltipDimensions: { width?: number; height?: number; left?: number; right?: number } | null = null;
  let options: AdaptiveHoverOptions = {};

  if (arg1 && typeof arg1 === 'object' && 'editorRect' in arg1) {
    visualPos = arg1.visualPos ?? null;
    editorRect = arg1.editorRect;
    tooltipDimensions = arg1.tooltipDimensions ?? arg1.tooltipRect ?? null;
    options = arg1.options ?? arg1;
  } else {
    visualPos = arg1;
    editorRect = arg2;
    tooltipDimensions = arg3 ?? null;
    options = arg4 ?? {};
  }

  const viewportWidth = options.viewportWidth ?? 1200;
  const viewportHeight = options.viewportHeight ?? 800;
  const pad = options.padding ?? 12;

  const editorLeft = typeof editorRect?.left === 'number' ? editorRect.left : 0;
  const editorRight = editorRect?.right ?? viewportWidth;
  const editorWidth =
    typeof editorRect?.width === 'number' ? editorRect.width : Math.max(0, editorRight - editorLeft);

  const effectiveRight =
    typeof options.rightDockLeft === 'number' && options.rightDockLeft > 0
      ? Math.min(options.rightDockLeft, viewportWidth, editorRight)
      : Math.min(viewportWidth, editorRight);

  const effectiveLeft = Math.max(0, editorLeft);

  const effectiveBottom =
    typeof options.bottomDockTop === 'number' && options.bottomDockTop > 0
      ? Math.min(options.bottomDockTop, viewportHeight, editorRect?.bottom ?? viewportHeight)
      : Math.min(viewportHeight, editorRect?.bottom ?? viewportHeight);

  const effectiveTop = Math.max(0, editorRect?.top ?? 0);

  if (!visualPos) {
    const maxWidth = computeTooltipMaxWidth(editorWidth, undefined, effectiveRight);
    return {
      above: false,
      translateX: 0,
      maxWidth: Math.round(maxWidth),
      spaceAbove: 0,
      spaceBelow: 0,
      spaceLeft: 0,
      spaceRight: 0,
      shiftLeft: false,
      effectiveRight,
      effectiveLeft,
      effectiveBottom,
      effectiveTop,
    };
  }

  // 1. Vertical Quad-Direction (Above vs Below)
  const spaceBelow = Math.max(0, effectiveBottom - visualPos.bottom);
  const spaceAbove = Math.max(0, visualPos.top - effectiveTop);

  let above = false;
  if (spaceBelow < 260) {
    // If space above is >= 100 or greater than space below, flip above
    if (spaceAbove >= 100 || spaceAbove > spaceBelow) {
      above = true;
    } else {
      above = false;
    }
  } else {
    above = false;
  }

  // Top clamp rule: if cursor is near top edge (< 100px above), stay below
  if (spaceAbove < 100 && spaceBelow >= spaceAbove) {
    above = false;
  }

  // 2. Horizontal Quad-Direction (Left vs Right)
  const visualLeft =
    typeof visualPos.left === 'number' ? visualPos.left : (tooltipDimensions?.left ?? effectiveLeft);
  const spaceRight = Math.max(0, effectiveRight - visualLeft);
  const spaceLeft = Math.max(0, visualLeft - effectiveLeft);

  const maxWidth = computeTooltipMaxWidth(editorWidth, visualLeft, effectiveRight);

  const tooltipWidth = tooltipDimensions?.width ?? Math.min(maxWidth, 360);
  const currentLeft =
    typeof tooltipDimensions?.left === 'number' ? tooltipDimensions.left : visualLeft;
  const currentRight =
    typeof tooltipDimensions?.right === 'number'
      ? tooltipDimensions.right
      : currentLeft + tooltipWidth;

  let translateX = 0;
  let shiftLeft = false;

  // Right boundary shift
  if (currentRight > effectiveRight - pad) {
    const overflowRight = currentRight - (effectiveRight - pad);
    translateX = -overflowRight;
    shiftLeft = true;

    // Left boundary clamp
    if (currentLeft + translateX < effectiveLeft + pad) {
      translateX = effectiveLeft + pad - currentLeft;
    }
  } else if (currentLeft < effectiveLeft + pad) {
    // Left boundary clamp
    translateX = effectiveLeft + pad - currentLeft;
  }

  return {
    above,
    translateX: Math.round(translateX),
    maxWidth: Math.round(maxWidth),
    spaceAbove,
    spaceBelow,
    spaceLeft,
    spaceRight,
    shiftLeft,
    effectiveRight,
    effectiveLeft,
    effectiveBottom,
    effectiveTop,
  };
}
