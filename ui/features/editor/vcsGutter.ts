import { StateEffect, StateField } from '@codemirror/state';
import {
  EditorView,
  gutter,
  GutterMarker,
  Decoration,
  type DecorationSet,
  WidgetType,
} from '@codemirror/view';
import type { GitBlameLine } from '../../lib/api';

export type VcsChangeKind = 'added' | 'modified' | 'deleted';

/**
 * Computes line-by-line VCS status (added, modified, deleted) by comparing original vs current text.
 * Uses a line-based LCS algorithm with common prefix/suffix optimization.
 */
export function computeVcsLineChanges(
  originalText: string,
  currentText: string
): Map<number, VcsChangeKind> {
  const result = new Map<number, VcsChangeKind>();
  if (originalText === currentText) return result;

  const oldLines = originalText.split('\n');
  const newLines = currentText.split('\n');

  // If original was completely empty
  if (originalText === '' || (oldLines.length === 1 && oldLines[0] === '')) {
    for (let i = 1; i <= newLines.length; i++) {
      result.set(i, 'added');
    }
    return result;
  }

  // If new text is completely empty
  if (currentText === '' || (newLines.length === 1 && newLines[0] === '')) {
    result.set(1, 'deleted');
    return result;
  }

  // 1. Trim common prefix
  let prefixLen = 0;
  const maxPrefix = Math.min(oldLines.length, newLines.length);
  while (prefixLen < maxPrefix && oldLines[prefixLen] === newLines[prefixLen]) {
    prefixLen++;
  }

  // 2. Trim common suffix
  let suffixLen = 0;
  const maxSuffix = Math.min(oldLines.length - prefixLen, newLines.length - prefixLen);
  while (
    suffixLen < maxSuffix &&
    oldLines[oldLines.length - 1 - suffixLen] === newLines[newLines.length - 1 - suffixLen]
  ) {
    suffixLen++;
  }

  const midOld = oldLines.slice(prefixLen, oldLines.length - suffixLen);
  const midNew = newLines.slice(prefixLen, newLines.length - suffixLen);

  if (midOld.length === 0 && midNew.length === 0) {
    return result;
  }

  // Fallback for massive diffs (> 2000 lines in middle) to prevent DP table blowup
  if (midOld.length > 2000 || midNew.length > 2000 || midOld.length * midNew.length > 4_000_000) {
    const minLen = Math.min(midOld.length, midNew.length);
    for (let i = 0; i < minLen; i++) {
      result.set(prefixLen + i + 1, 'modified');
    }
    for (let i = minLen; i < midNew.length; i++) {
      result.set(prefixLen + i + 1, 'added');
    }
    if (midNew.length < midOld.length) {
      const boundaryLine = Math.max(1, Math.min(newLines.length, prefixLen + midNew.length + 1));
      if (!result.has(boundaryLine)) {
        result.set(boundaryLine, 'deleted');
      }
    }
    return result;
  }

  // 3. Compute LCS DP table
  const M = midOld.length;
  const N = midNew.length;
  const dp = new Int32Array((M + 1) * (N + 1));

  for (let i = 0; i < M; i++) {
    const rowOffset = (i + 1) * (N + 1);
    const prevRowOffset = i * (N + 1);
    const oldLine = midOld[i];
    for (let j = 0; j < N; j++) {
      if (oldLine === midNew[j]) {
        dp[rowOffset + j + 1] = dp[prevRowOffset + j] + 1;
      } else {
        const up = dp[prevRowOffset + j + 1];
        const left = dp[rowOffset + j];
        dp[rowOffset + j + 1] = up > left ? up : left;
      }
    }
  }

  // 4. Backtrack to find diff operations
  type DiffOp = { type: 'keep' | 'del' | 'add'; oldLineNum: number; newLineNum: number };
  const ops: DiffOp[] = [];
  let i = M;
  let j = N;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && midOld[i - 1] === midNew[j - 1]) {
      ops.push({ type: 'keep', oldLineNum: prefixLen + i, newLineNum: prefixLen + j });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i * (N + 1) + (j - 1)] >= dp[(i - 1) * (N + 1) + j])) {
      ops.push({ type: 'add', oldLineNum: prefixLen + i, newLineNum: prefixLen + j });
      j--;
    } else {
      ops.push({ type: 'del', oldLineNum: prefixLen + i, newLineNum: prefixLen + j + 1 });
      i--;
    }
  }
  ops.reverse();

  // 5. Group into change hunks
  let k = 0;
  while (k < ops.length) {
    if (ops[k].type === 'keep') {
      k++;
      continue;
    }

    let delCount = 0;
    const addedLines: number[] = [];
    const hunkStartNewLine = ops[k].newLineNum;

    while (k < ops.length && ops[k].type !== 'keep') {
      if (ops[k].type === 'del') {
        delCount++;
      } else if (ops[k].type === 'add') {
        addedLines.push(ops[k].newLineNum);
      }
      k++;
    }

    const addCount = addedLines.length;

    if (delCount === 0 && addCount > 0) {
      // Pure addition
      for (const lineNum of addedLines) {
        result.set(lineNum, 'added');
      }
    } else if (delCount > 0 && addCount > 0) {
      // Replacement (both deleted and added lines in this hunk)
      const paired = Math.min(delCount, addCount);
      for (let p = 0; p < paired; p++) {
        result.set(addedLines[p], 'modified');
      }
      for (let p = paired; p < addCount; p++) {
        result.set(addedLines[p], 'added');
      }
    } else if (delCount > 0 && addCount === 0) {
      // Pure deletion
      const boundaryLine = Math.max(1, Math.min(newLines.length, hunkStartNewLine));
      if (!result.has(boundaryLine)) {
        result.set(boundaryLine, 'deleted');
      }
    }
  }

  return result;
}

/**
 * Formats inline blame text: "Author, time ago • summary"
 */
export function formatBlameInline(
  author?: string,
  timeUnix?: number,
  summary?: string
): string {
  const who = author || 'Unknown';
  let when = '';
  if (timeUnix) {
    const now = Math.floor(Date.now() / 1000);
    const diff = Math.max(0, now - timeUnix);
    if (diff < 60) when = 'just now';
    else if (diff < 3600) when = `${Math.floor(diff / 60)}m ago`;
    else if (diff < 86400) when = `${Math.floor(diff / 3600)}h ago`;
    else when = `${Math.floor(diff / 86400)}d ago`;
  }
  const timePart = when ? `, ${when}` : '';
  const sumPart = summary ? ` • ${summary}` : '';
  return `${who}${timePart}${sumPart}`;
}

// -------------------------------------------------------------
// VCS Gutter Marker & Extension
// -------------------------------------------------------------

class VcsGutterMarker extends GutterMarker {
  kind: VcsChangeKind;

  constructor(kind: VcsChangeKind) {
    super();
    this.kind = kind;
  }

  eq(other: GutterMarker) {
    return other instanceof VcsGutterMarker && other.kind === this.kind;
  }

  toDOM() {
    const el = document.createElement('div');
    el.className = `cm-vcs-marker cm-vcs-${this.kind}`;
    el.title = `Git ${this.kind}`;
    return el;
  }
}

export const setVcsChangesEffect = StateEffect.define<Map<number, VcsChangeKind>>();

export const vcsChangesStateField = StateField.define<Map<number, VcsChangeKind>>({
  create() {
    return new Map();
  },
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setVcsChangesEffect)) {
        return effect.value;
      }
    }
    return value;
  },
});

export const vcsGutterTheme = EditorView.theme({
  '.cm-vcs-gutter': {
    width: '5px !important',
    minWidth: '5px !important',
    backgroundColor: 'transparent !important',
    marginRight: '2px !important',
  },
  '.cm-vcs-gutter .cm-gutterElement': {
    padding: '0 !important',
    margin: '0 !important',
    width: '5px !important',
    display: 'flex !important',
    alignItems: 'stretch !important',
    justifyContent: 'center !important',
    position: 'relative !important',
  },
  '.cm-vcs-marker': {
    position: 'absolute !important',
    top: '0 !important',
    bottom: '0 !important',
    left: '1px !important',
    width: '3.5px !important',
    borderRadius: '1.5px !important',
  },
  '.cm-vcs-added': {
    backgroundColor: '#4ade80 !important',
  },
  '.cm-vcs-modified': {
    backgroundColor: '#3882f6 !important',
  },
  '.cm-vcs-deleted': {
    backgroundColor: '#f07a74 !important',
  },
});

export function createVcsGutterExtension() {
  return [
    vcsChangesStateField,
    gutter({
      class: 'cm-vcs-gutter',
      lineMarker(view, line) {
        const map = view.state.field(vcsChangesStateField, false);
        if (!map) return null;
        const lineObj = view.state.doc.lineAt(line.from);
        const change = map.get(lineObj.number);
        if (!change) return null;
        return new VcsGutterMarker(change);
      },
    }),
    vcsGutterTheme,
  ];
}

// -------------------------------------------------------------
// Inline Git Blame Extension (Active Cursor Line)
// -------------------------------------------------------------

class InlineBlameWidget extends WidgetType {
  text: string;

  constructor(text: string) {
    super();
    this.text = text;
  }

  toDOM() {
    const span = document.createElement('span');
    span.className = 'cm-inline-blame';
    span.textContent = `  ${this.text}`;
    return span;
  }
}

export const setBlameLinesEffect = StateEffect.define<Map<number, GitBlameLine>>();

export const blameDataField = StateField.define<Map<number, GitBlameLine>>({
  create() {
    return new Map();
  },
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setBlameLinesEffect)) {
        return effect.value;
      }
    }
    return value;
  },
});

export const inlineBlameField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(decorations, tr) {
    const blameMap = tr.state.field(blameDataField, false);
    if (!blameMap || blameMap.size === 0) return Decoration.none;

    const head = tr.state.selection.main.head;
    const doc = tr.state.doc;
    if (doc.length === 0) return Decoration.none;

    const line = doc.lineAt(head);
    // Never show blame on empty lines or when cursor is at the end of the line (prevents cursor displacement)
    if (line.text.trim().length === 0 || head === line.to) return Decoration.none;
    const b = blameMap.get(line.number);
    if (b && b.author) {
      const text = formatBlameInline(b.author, b.timeUnix, b.summary);
      return Decoration.set([
        Decoration.widget({
          widget: new InlineBlameWidget(text),
          side: 1,
        }).range(line.to),
      ]);
    }

    return Decoration.none;
  },
  provide: (f) => EditorView.decorations.from(f),
});

export function createInlineBlameExtension() {
  return [blameDataField, inlineBlameField];
}
