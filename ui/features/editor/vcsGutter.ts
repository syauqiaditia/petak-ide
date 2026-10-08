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
  if (oldLines.length === 1 && oldLines[0] === '') {
    for (let i = 1; i <= newLines.length; i++) {
      result.set(i, 'added');
    }
    return result;
  }

  const oldSet = new Set(oldLines);

  for (let i = 0; i < newLines.length; i++) {
    const lineNum = i + 1;
    if (i < oldLines.length) {
      if (newLines[i] !== oldLines[i]) {
        if (!oldSet.has(newLines[i])) {
          result.set(lineNum, i >= oldLines.length ? 'added' : 'modified');
        } else {
          result.set(lineNum, 'modified');
        }
      }
    } else {
      result.set(lineNum, 'added');
    }
  }

  // If newLines is shorter than oldLines, mark deletion on the boundary line
  if (newLines.length < oldLines.length) {
    const boundaryLine = Math.max(1, newLines.length);
    if (!result.has(boundaryLine)) {
      result.set(boundaryLine, 'deleted');
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
    if (line.text.trim().length === 0) return Decoration.none;
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
