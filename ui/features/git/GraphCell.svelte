<script lang="ts">
  import type { GitGraphRow } from './types';
  import {
    computeRowPaths,
    computeNode,
    maxLaneInRow,
    laneX,
  } from './graphGeom';

  let {
    row,
    prevRow = null,
    isHead = false,
    minWidth = 56,
  } = $props<{
    row: GitGraphRow;
    prevRow?: GitGraphRow | null;
    isHead?: boolean;
    minWidth?: number;
  }>();

  let paths = $derived(computeRowPaths(row, prevRow));
  let node = $derived(computeNode(row, isHead));
  let maxLane = $derived(maxLaneInRow(row));
  let cellWidth = $derived(Math.max(minWidth, laneX(maxLane) + 16));
</script>

<svg
  class="graph-cell-svg"
  width={cellWidth}
  height="30"
  viewBox="0 0 {cellWidth} 30"
  fill="none"
>
  {#each paths as p}
    <path
      d={p.d}
      stroke={p.color}
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  {/each}

  <circle
    cx={node.cx}
    cy={node.cy}
    r={node.r}
    fill={node.hollow ? '#1a1b1f' : node.color}
    stroke={node.color}
    stroke-width="2"
  />
</svg>

<style>
  .graph-cell-svg {
    display: block;
    flex-shrink: 0;
  }
</style>
