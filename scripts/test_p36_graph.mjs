import assert from 'node:assert';
import {
  laneX,
  getColor,
  straightPath,
  branchOutPath,
  mergeInPath,
  computeRowPaths,
  computeNode,
  maxLaneInRow,
  ROW_HEIGHT,
  LANE_OFFSET,
  LANE_WIDTH,
  PALETTE,
} from '../ui/features/git/graphGeom.ts';

console.log('Running test_p36_graph.mjs...');

// 1. Geometry constants & laneX positioning
{
  assert.strictEqual(ROW_HEIGHT, 30);
  assert.strictEqual(LANE_OFFSET, 18);
  assert.strictEqual(LANE_WIDTH, 16);

  assert.strictEqual(laneX(0), 18);
  assert.strictEqual(laneX(1), 34);
  assert.strictEqual(laneX(2), 50);
  assert.strictEqual(laneX(3), 66);
}

// 2. Color palette & modular cycling
{
  assert.strictEqual(getColor(0), '#6ea8ff');
  assert.strictEqual(getColor(1), '#7fc98f');
  assert.strictEqual(getColor(2), '#e8b45a');
  assert.strictEqual(getColor(3), '#f0a6a2');
  // Modulo wrap-around
  assert.strictEqual(getColor(PALETTE.length), '#6ea8ff');
  assert.strictEqual(getColor(PALETTE.length + 1), '#7fc98f');
}

// 3. Path generators
{
  const straight = straightPath(18, 0, 30);
  assert.strictEqual(straight, 'M 18 0 V 30');

  const branchOut = branchOutPath(18, 15, 34, 30);
  assert.strictEqual(branchOut, 'M 18 15 C 18 22.5 34 22.5 34 30');

  const mergeIn = mergeInPath(34, 0, 18, 15);
  assert.strictEqual(mergeIn, 'M 34 0 C 34 7.5 18 7.5 18 15');
}

// 4. Linear sequence (C3 -> C2 -> C1 root)
{
  // C3 (top, no upper)
  const row0 = {
    lane: 0,
    color: 0,
    edges: [{ from: 0, to: 0, kind: 'straight', color: 0 }],
  };
  const paths0 = computeRowPaths(row0, null);
  assert.strictEqual(paths0.length, 1);
  assert.strictEqual(paths0[0].d, 'M 18 15 V 30');
  assert.strictEqual(paths0[0].kind, 'straight');

  // C2 (has upper from row0, has outgoing to C1)
  const row1 = {
    lane: 0,
    color: 0,
    edges: [{ from: 0, to: 0, kind: 'straight', color: 0 }],
  };
  const paths1 = computeRowPaths(row1, row0);
  assert.strictEqual(paths1.length, 1);
  assert.strictEqual(paths1[0].d, 'M 18 0 V 30'); // Continuous straight through node

  // C1 (root, has upper, no outgoing)
  const row2 = {
    lane: 0,
    color: 0,
    edges: [],
  };
  const paths2 = computeRowPaths(row2, row1);
  assert.strictEqual(paths2.length, 1);
  assert.strictEqual(paths2[0].d, 'M 18 0 V 15'); // Stops at node
}

// 5. Branch and merge scenario
{
  // Row 0: Commit M in lane 0, branches out to lane 1
  const rowM = {
    lane: 0,
    color: 0,
    edges: [
      { from: 0, to: 0, kind: 'straight', color: 0 },
      { from: 0, to: 1, kind: 'branchOut', color: 1 },
    ],
  };
  const pathsM = computeRowPaths(rowM, null);
  assert.strictEqual(pathsM.length, 2);
  assert.strictEqual(pathsM[0].d, 'M 18 15 V 30');
  assert.strictEqual(pathsM[1].d, 'M 18 15 C 18 22.5 34 22.5 34 30');
  assert.strictEqual(pathsM[1].kind, 'branchOut');

  // Row 1: Commit C1 in lane 0, lane 1 is pass-through
  const rowC1 = {
    lane: 0,
    color: 0,
    edges: [
      { from: 0, to: 0, kind: 'straight', color: 0 },
      { from: 1, to: 1, kind: 'straight', color: 1 },
    ],
  };
  const pathsC1 = computeRowPaths(rowC1, rowM);
  assert.strictEqual(pathsC1.length, 2);
  // Lane 0 continuous
  assert.strictEqual(pathsC1[0].d, 'M 18 0 V 30');
  // Lane 1 pass-through
  assert.strictEqual(pathsC1[1].d, 'M 34 0 V 30');
  assert.strictEqual(pathsC1[1].color, getColor(1));

  // Row 2: Commit B1 in lane 1, lane 0 is pass-through
  const rowB1 = {
    lane: 1,
    color: 1,
    edges: [
      { from: 0, to: 0, kind: 'straight', color: 0 },
      { from: 1, to: 1, kind: 'straight', color: 1 },
    ],
  };
  const pathsB1 = computeRowPaths(rowB1, rowC1);
  assert.strictEqual(pathsB1.length, 2);
  assert.strictEqual(pathsB1[0].d, 'M 34 0 V 30'); // Lane 1 commit continuous
  assert.strictEqual(pathsB1[1].d, 'M 18 0 V 30'); // Lane 0 pass-through

  // Row 3: Commit C0 in lane 0, lane 1 merges into lane 0 (MergeIn)
  const rowC0 = {
    lane: 0,
    color: 0,
    edges: [
      { from: 0, to: 0, kind: 'straight', color: 0 },
      { from: 1, to: 0, kind: 'mergeIn', color: 1 },
    ],
  };
  const pathsC0 = computeRowPaths(rowC0, rowB1);
  assert.strictEqual(pathsC0.length, 2);
  assert.strictEqual(pathsC0[0].d, 'M 18 0 V 30'); // Lane 0 continuous
  assert.strictEqual(pathsC0[1].d, 'M 34 0 C 34 7.5 18 7.5 18 15'); // Lane 1 curves in
  assert.strictEqual(pathsC0[1].kind, 'mergeIn');
}

// 6. Octopus merge (3 parents: lane 0 straight, branches out to lane 1 & lane 2)
{
  const rowOcto = {
    lane: 0,
    color: 0,
    edges: [
      { from: 0, to: 0, kind: 'straight', color: 0 },
      { from: 0, to: 1, kind: 'branchOut', color: 1 },
      { from: 0, to: 2, kind: 'branchOut', color: 2 },
    ],
  };
  const pathsOcto = computeRowPaths(rowOcto, null);
  assert.strictEqual(pathsOcto.length, 3);
  assert.strictEqual(pathsOcto[0].d, 'M 18 15 V 30');
  assert.strictEqual(pathsOcto[1].d, 'M 18 15 C 18 22.5 34 22.5 34 30');
  assert.strictEqual(pathsOcto[2].d, 'M 18 15 C 18 22.5 50 22.5 50 30');

  assert.strictEqual(maxLaneInRow(rowOcto), 2);

  // Octopus incoming merge: 2 lanes (lane 1 & lane 2) merge into lane 0
  const rowOctoMerge = {
    lane: 0,
    color: 0,
    edges: [
      { from: 0, to: 0, kind: 'straight', color: 0 },
      { from: 1, to: 0, kind: 'mergeIn', color: 1 },
      { from: 2, to: 0, kind: 'mergeIn', color: 2 },
    ],
  };
  const pathsOctoMerge = computeRowPaths(rowOctoMerge, rowOcto);
  assert.strictEqual(pathsOctoMerge.length, 3);
  assert.strictEqual(pathsOctoMerge[0].d, 'M 18 0 V 30');
  assert.strictEqual(pathsOctoMerge[1].d, 'M 34 0 C 34 7.5 18 7.5 18 15');
  assert.strictEqual(pathsOctoMerge[2].d, 'M 50 0 C 50 7.5 18 7.5 18 15');
}

// 7. Node computation
{
  const nodeHead = computeNode({ lane: 0, color: 0, edges: [] }, true);
  assert.strictEqual(nodeHead.cx, 18);
  assert.strictEqual(nodeHead.cy, 15);
  assert.strictEqual(nodeHead.r, 5);
  assert.strictEqual(nodeHead.hollow, true);

  const nodeNormal = computeNode({ lane: 2, color: 2, edges: [] }, false);
  assert.strictEqual(nodeNormal.cx, 50);
  assert.strictEqual(nodeNormal.cy, 15);
  assert.strictEqual(nodeNormal.r, 4);
  assert.strictEqual(nodeNormal.hollow, false);
}

console.log('All graphGeom tests passed successfully! ✓');
