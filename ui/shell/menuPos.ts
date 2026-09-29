export interface Point {
  x: number;
  y: number;
}

export interface Dimensions {
  w: number;
  h: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Calculates optimal position for a context menu popup, avoiding cursor overlap
 * and flipping on screen boundaries.
 *
 * Spec:
 * - Default offset: mouseX + 2, mouseY + 2
 * - Horizontal flipping: if targetX + menu.w > viewport.w - 8 => mouseX - menu.w - 2 (clamped to >= 8)
 * - Vertical flipping: if targetY + menu.h > viewport.h - 8 => mouseY - menu.h - 2 (clamped to >= 8)
 */
export function placeMenu(
  click: Point,
  menu: Dimensions,
  viewport: Dimensions
): Point {
  const targetX = click.x + 2;
  const targetY = click.y + 2;

  let finalX = targetX;
  if (targetX + menu.w > viewport.w - 8) {
    finalX = click.x - menu.w - 2;
  }
  if (finalX < 8) {
    finalX = 8;
  }

  let finalY = targetY;
  if (targetY + menu.h > viewport.h - 8) {
    finalY = click.y - menu.h - 2;
  }
  if (finalY < 8) {
    finalY = 8;
  }

  return { x: Math.round(finalX), y: Math.round(finalY) };
}

/**
 * Calculates position for cascading submenus.
 *
 * Spec:
 * - Default direction: right of parent menu (parentRect.x + parentRect.w - 4, itemTop - 4)
 * - Horizontal overflow: flip to left (parentRect.x - subMenu.w + 4)
 * - Vertical overflow: clamp to viewport bottom - 8
 */
export function placeSubmenu(
  parentRect: Rect,
  itemTop: number,
  subMenu: Dimensions,
  viewport: Dimensions
): Point {
  let subX = parentRect.x + parentRect.w - 4;
  let subY = itemTop - 4;

  // Horizontal overflow: flip to left side of parent menu
  if (subX + subMenu.w > viewport.w - 8) {
    subX = parentRect.x - subMenu.w + 4;
  }
  if (subX < 8) {
    subX = 8;
  }

  // Vertical overflow: shift up so bottom aligns or fits
  if (subY + subMenu.h > viewport.h - 8) {
    subY = Math.max(8, viewport.h - subMenu.h - 8);
  }
  if (subY < 8) {
    subY = 8;
  }

  return { x: Math.round(subX), y: Math.round(subY) };
}

/**
 * Calculates estimated height for context submenu based on its items:
 * 26px per item + 9px per separator + 12px padding (6px top + 6px bottom).
 */
export function calculateSubmenuHeight(items?: { separator?: boolean }[]): number {
  if (!items || items.length === 0) return 12;
  let h = 12;
  for (const item of items) {
    h += item.separator ? 9 : 26;
  }
  return h;
}
