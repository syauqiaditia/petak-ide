import type { GitDiffLine, GitHunk, GitDiffFile } from './types.ts';
import { computeWordDiff, type WordToken } from './wordDiff.ts';

export type SbsCellKind = 'context' | 'del' | 'add' | 'filler';

export interface SbsCell {
  kind: SbsCellKind;
  lineNo?: number | null;
  text?: string;
  tokens?: WordToken[];
}

export interface SbsRow {
  left: SbsCell;
  right: SbsCell;
}

export interface SbsHunk {
  header: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  rows: SbsRow[];
}

/**
 * Transforms a single diff hunk into side-by-side rows with pairing of deletions/additions,
 * filler rows for mismatched lengths, and word-level diff highlights.
 */
export function hunkToSbs(hunk: GitHunk): SbsHunk {
  const rows: SbsRow[] = [];
  let delBuffer: GitDiffLine[] = [];
  let addBuffer: GitDiffLine[] = [];

  function flushChangeBuffer() {
    if (delBuffer.length === 0 && addBuffer.length === 0) return;
    const count = Math.max(delBuffer.length, addBuffer.length);
    for (let k = 0; k < count; k++) {
      const delLine = delBuffer[k];
      const addLine = addBuffer[k];

      let left: SbsCell;
      let right: SbsCell;

      if (delLine && addLine) {
        // Paired del and add -> compute word diff!
        const { oldTokens, newTokens } = computeWordDiff(delLine.text, addLine.text);
        left = {
          kind: 'del',
          lineNo: delLine.oldNo,
          text: delLine.text,
          tokens: oldTokens,
        };
        right = {
          kind: 'add',
          lineNo: addLine.newNo,
          text: addLine.text,
          tokens: newTokens,
        };
      } else if (delLine) {
        left = {
          kind: 'del',
          lineNo: delLine.oldNo,
          text: delLine.text,
          tokens: [{ text: delLine.text, changed: false }],
        };
        right = { kind: 'filler' };
      } else if (addLine) {
        left = { kind: 'filler' };
        right = {
          kind: 'add',
          lineNo: addLine.newNo,
          text: addLine.text,
          tokens: [{ text: addLine.text, changed: false }],
        };
      } else {
        left = { kind: 'filler' };
        right = { kind: 'filler' };
      }

      rows.push({ left, right });
    }
    delBuffer = [];
    addBuffer = [];
  }

  for (const line of hunk.lines) {
    if (line.kind === 'noNewline') {
      continue;
    }
    if (line.kind === 'del') {
      delBuffer.push(line);
    } else if (line.kind === 'add') {
      addBuffer.push(line);
    } else if (line.kind === 'context') {
      flushChangeBuffer();
      rows.push({
        left: {
          kind: 'context',
          lineNo: line.oldNo,
          text: line.text,
          tokens: [{ text: line.text, changed: false }],
        },
        right: {
          kind: 'context',
          lineNo: line.newNo,
          text: line.text,
          tokens: [{ text: line.text, changed: false }],
        },
      });
    }
  }

  flushChangeBuffer();

  return {
    header: hunk.header,
    oldStart: hunk.oldStart,
    oldLines: hunk.oldLines,
    newStart: hunk.newStart,
    newLines: hunk.newLines,
    rows,
  };
}

/**
 * Transforms an entire DiffFile into an array of SbsHunk.
 */
export function diffFileToSbs(diffFile: GitDiffFile): SbsHunk[] {
  return diffFile.hunks.map(hunkToSbs);
}
