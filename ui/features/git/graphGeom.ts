import type { GitEdge, GitGraphRow } from './types';

export const ROW_HEIGHT = 30;
export const LANE_WIDTH = 16;
export const LANE_OFFSET = 18;

export const PALETTE = [
  '#6ea8ff', // Accent blue
  '#7fc98f', // Green
  '#e8b45a', // Amber / yellow
  '#f0a6a2', // Red / coral
  '#c084fc', // Purple
  '#38bdf8', // Sky blue
  '#fb923c', // Orange
  '#f472b6', // Pink
];

export function laneX(lane: number): number {
  return LANE_OFFSET + lane * LANE_WIDTH;
}

export function getColor(colorIndex: number): string {
  if (PALETTE.length === 0) return '#6ea8ff';
  const idx = ((colorIndex % PALETTE.length) + PALETTE.length) % PALETTE.length;
  return PALETTE[idx];
}

export function straightPath(x: number, y1: number, y2: number): string {
  return `M ${x} ${y1} V ${y2}`;
}

export function branchOutPath(x1: number, y1: number, x2: number, y2: number): string {
  const cy = y1 + (y2 - y1) / 2;
  return `M ${x1} ${y1} C ${x1} ${cy} ${x2} ${cy} ${x2} ${y2}`;
}

export function mergeInPath(x1: number, y1: number, x2: number, y2: number): string {
  const cy = y1 + (y2 - y1) / 2;
  return `M ${x1} ${y1} C ${x1} ${cy} ${x2} ${cy} ${x2} ${y2}`;
}

export interface PathItem {
  d: string;
  color: string;
  kind: 'straight' | 'branchOut' | 'mergeIn';
}

export interface NodeItem {
  cx: number;
  cy: number;
  r: number;
  color: string;
  hollow: boolean;
}

/**
 * Checks if the previous row has an edge terminating at lane at the row boundary (y=30).
 */
export function hasIncomingEdgeFromAbove(prevRow: GitGraphRow | null | undefined, targetLane: number): boolean {
  if (!prevRow || !prevRow.edges) return false;
  return prevRow.edges.some(
    (e) => (e.kind === 'straight' || e.kind === 'branchOut') && e.to === targetLane
  );
}

/**
 * Computes all SVG path items for a single graph row cell.
 */
export function computeRowPaths(
  row: GitGraphRow,
  prevRow?: GitGraphRow | null
): PathItem[] {
  const paths: PathItem[] = [];
  const commitLane = row.lane;
  const commitX = laneX(commitLane);

  const hasUpper = hasIncomingEdgeFromAbove(prevRow, commitLane);
  const outgoingCommitStraight = row.edges?.find(
    (e) => e.kind === 'straight' && e.from === commitLane && e.to === commitLane
  );

  // 1. Commit lane vertical path
  if (hasUpper && outgoingCommitStraight) {
    // Continuous straight line through node: 0 -> 30
    paths.push({
      d: straightPath(commitX, 0, 30),
      color: getColor(outgoingCommitStraight.color),
      kind: 'straight',
    });
  } else if (hasUpper && !outgoingCommitStraight) {
    // Root commit with parent above: 0 -> 15 (stops at node)
    paths.push({
      d: straightPath(commitX, 0, 15),
      color: getColor(row.color),
      kind: 'straight',
    });
  } else if (!hasUpper && outgoingCommitStraight) {
    // Top commit: starts at node (15 -> 30)
    paths.push({
      d: straightPath(commitX, 15, 30),
      color: getColor(outgoingCommitStraight.color),
      kind: 'straight',
    });
  }

  // 2. Other edges
  if (row.edges) {
    for (const edge of row.edges) {
      if (edge.kind === 'straight') {
        if (edge.from !== commitLane) {
          // Pass-through lane: full height 0 -> 30
          const x = laneX(edge.from);
          paths.push({
            d: straightPath(x, 0, 30),
            color: getColor(edge.color),
            kind: 'straight',
          });
        }
      } else if (edge.kind === 'branchOut') {
        // Curve from node (15) to bottom (30) of target lane
        const x1 = laneX(edge.from);
        const x2 = laneX(edge.to);
        paths.push({
          d: branchOutPath(x1, 15, x2, 30),
          color: getColor(edge.color),
          kind: 'branchOut',
        });
      } else if (edge.kind === 'mergeIn') {
        // Curve from top (0) of from-lane to node (15) of target lane
        const x1 = laneX(edge.from);
        const x2 = laneX(edge.to);
        paths.push({
          d: mergeInPath(x1, 0, x2, 15),
          color: getColor(edge.color),
          kind: 'mergeIn',
        });
      }
    }
  }

  return paths;
}

export function computeNode(row: GitGraphRow, isHead = false): NodeItem {
  return {
    cx: laneX(row.lane),
    cy: 15,
    r: isHead ? 5 : 4,
    color: getColor(row.color),
    hollow: isHead,
  };
}

export function maxLaneInRow(row: GitGraphRow): number {
  let max = row.lane;
  if (row.edges) {
    for (const e of row.edges) {
      if (e.from > max) max = e.from;
      if (e.to > max) max = e.to;
    }
  }
  return max;
}
