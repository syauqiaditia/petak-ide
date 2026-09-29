import type { GitDiffFile, GitHunk, GitDiffLine } from '../features/git/types';

/**
 * Creates a GitDiffFile structure by comparing two text strings line by line.
 * Uses LCS on lines to generate hunks.
 */
export function createDiffFileFromTexts(
  oldPath: string,
  newPath: string,
  oldText: string,
  newText: string
): GitDiffFile {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');

  const hunks = computeHunks(oldLines, newLines);

  return {
    oldPath,
    newPath,
    status: 'modified',
    binary: false,
    hunks,
  };
}

function computeHunks(oldLines: string[], newLines: string[]): GitHunk[] {
  const n = oldLines.length;
  const m = newLines.length;

  if (n === 0 && m === 0) return [];

  // If one is empty
  if (n === 0) {
    return [
      {
        oldStart: 1,
        oldLines: 0,
        newStart: 1,
        newLines: m,
        header: `@@ -0,0 +1,${m} @@`,
        lines: newLines.map((t, idx) => ({ kind: 'add', text: t, newNo: idx + 1 })),
      },
    ];
  }

  if (m === 0) {
    return [
      {
        oldStart: 1,
        oldLines: n,
        newStart: 1,
        newLines: 0,
        header: `@@ -1,${n} +0,0 @@`,
        lines: oldLines.map((t, idx) => ({ kind: 'del', text: t, oldNo: idx + 1 })),
      },
    ];
  }

  // Quick equality check
  if (n === m && oldLines.every((l, idx) => l === newLines[idx])) {
    return [
      {
        oldStart: 1,
        oldLines: n,
        newStart: 1,
        newLines: m,
        header: `@@ -1,${n} +1,${m} @@`,
        lines: oldLines.map((t, idx) => ({ kind: 'context', text: t, oldNo: idx + 1, newNo: idx + 1 })),
      },
    ];
  }

  // DP matrix for LCS (capped to reasonable size to protect performance)
  const maxLines = 1000;
  if (n > maxLines || m > maxLines) {
    // Fallback: whole file hunk
    const diffLines: GitDiffLine[] = [
      ...oldLines.map((t, idx) => ({ kind: 'del' as const, text: t, oldNo: idx + 1 })),
      ...newLines.map((t, idx) => ({ kind: 'add' as const, text: t, newNo: idx + 1 })),
    ];
    return [
      {
        oldStart: 1,
        oldLines: n,
        newStart: 1,
        newLines: m,
        header: `@@ -1,${n} +1,${m} @@`,
        lines: diffLines,
      },
    ];
  }

  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) {
      if (oldLines[i] === newLines[j]) {
        dp[i + 1][j + 1] = dp[i][j] + 1;
      } else {
        dp[i + 1][j + 1] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  // Backtrack to assemble diff lines
  let i = n;
  let j = m;
  const rawDiff: GitDiffLine[] = [];

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      rawDiff.push({
        kind: 'context',
        text: oldLines[i - 1],
        oldNo: i,
        newNo: j,
      });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      rawDiff.push({
        kind: 'add',
        text: newLines[j - 1],
        newNo: j,
      });
      j--;
    } else if (i > 0) {
      rawDiff.push({
        kind: 'del',
        text: oldLines[i - 1],
        oldNo: i,
      });
      i--;
    }
  }

  rawDiff.reverse();

  return [
    {
      oldStart: 1,
      oldLines: n,
      newStart: 1,
      newLines: m,
      header: `@@ -1,${n} +1,${m} @@`,
      lines: rawDiff,
    },
  ];
}
