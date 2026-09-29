/**
 * Simple, zero-dependency windowing / virtual list calculation.
 * Computes visible range, heights, and offsets for long lists.
 */

export interface WindowingParams {
  totalItems: number;
  itemHeight: number;
  scrollTop: number;
  viewportHeight: number;
  buffer?: number;
}

export interface WindowingResult {
  startIndex: number;
  endIndex: number;
  visibleCount: number;
  totalHeight: number;
  offsetY: number;
  visibleIndices: number[];
}

export function computeWindowing(params: WindowingParams): WindowingResult {
  const { totalItems, itemHeight, scrollTop, viewportHeight, buffer = 5 } = params;

  if (totalItems <= 0 || itemHeight <= 0) {
    return {
      startIndex: 0,
      endIndex: 0,
      visibleCount: 0,
      totalHeight: 0,
      offsetY: 0,
      visibleIndices: [],
    };
  }

  const safeScrollTop = Math.max(0, scrollTop);
  const safeViewport = Math.max(itemHeight, viewportHeight);

  const rawStart = Math.floor(safeScrollTop / itemHeight);
  const startIndex = Math.max(0, rawStart - buffer);

  const rawEnd = Math.ceil((safeScrollTop + safeViewport) / itemHeight);
  const endIndex = Math.min(totalItems, rawEnd + buffer);

  const visibleIndices: number[] = [];
  for (let i = startIndex; i < endIndex; i++) {
    visibleIndices.push(i);
  }

  return {
    startIndex,
    endIndex,
    visibleCount: visibleIndices.length,
    totalHeight: totalItems * itemHeight,
    offsetY: startIndex * itemHeight,
    visibleIndices,
  };
}
