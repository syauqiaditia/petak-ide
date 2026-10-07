import {
  type Extension,
  StateField,
  StateEffect,
  type EditorState,
} from '@codemirror/state';
import {
  EditorView,
  Decoration,
  type DecorationSet,
  WidgetType,
} from '@codemirror/view';

export interface GhostDiffHunk {
  original: string;
  replacement: string;
  fromLine: number;
  toLine?: number;
  fromPos?: number;
  toPos?: number;
}

export const setGhostDiffEffect = StateEffect.define<GhostDiffHunk | null>();
export const clearGhostDiffEffect = StateEffect.define<void>();

export class GhostDiffWidget extends WidgetType {
  readonly hunk: GhostDiffHunk;

  constructor(hunk: GhostDiffHunk) {
    super();
    this.hunk = hunk;
  }

  eq(other: GhostDiffWidget): boolean {
    return (
      other.hunk.original === this.hunk.original &&
      other.hunk.replacement === this.hunk.replacement &&
      other.hunk.fromLine === this.hunk.fromLine &&
      other.hunk.toLine === this.hunk.toLine &&
      other.hunk.fromPos === this.hunk.fromPos &&
      other.hunk.toPos === this.hunk.toPos
    );
  }

  toDOM(view: EditorView): HTMLElement {
    if (typeof document === 'undefined') {
      return {} as HTMLElement;
    }

    const container = document.createElement('div');
    container.className = 'cm-ghost-diff-widget cm-ghost-diff-container';

    // Added hunk preview
    const additionEl = document.createElement('div');
    additionEl.className = 'cm-ghost-diff-addition';
    additionEl.textContent = this.hunk.replacement;
    container.appendChild(additionEl);

    // Action bar with pills
    const actionsEl = document.createElement('div');
    actionsEl.className = 'cm-ghost-diff-actions';

    const acceptBtn = document.createElement('button');
    acceptBtn.type = 'button';
    acceptBtn.className = 'cm-ghost-diff-pill cm-ghost-diff-pill-accept';
    acceptBtn.textContent = '✓ Terima (Tab)';
    acceptBtn.title = 'Terapkan perubahan ke dokumen editor (Tab)';
    acceptBtn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      acceptGhostDiff(view);
    };

    const rejectBtn = document.createElement('button');
    rejectBtn.type = 'button';
    rejectBtn.className = 'cm-ghost-diff-pill cm-ghost-diff-pill-reject';
    rejectBtn.textContent = '✕ Tolak (Esc)';
    rejectBtn.title = 'Batalkan perubahan tanpa mengubah dokumen (Esc)';
    rejectBtn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      dismissGhostDiff(view);
    };

    actionsEl.appendChild(acceptBtn);
    actionsEl.appendChild(rejectBtn);
    container.appendChild(actionsEl);

    return container;
  }
}

export const ghostDiffStateField = StateField.define<GhostDiffHunk | null>({
  create() {
    return null;
  },
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setGhostDiffEffect)) {
        return effect.value;
      }
      if (effect.is(clearGhostDiffEffect)) {
        return null;
      }
    }
    // If doc changed without explicit setGhostDiffEffect, clear active ghost diff
    if (tr.docChanged) {
      return null;
    }
    return value;
  },
});

export const ghostDiffDecorationField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(decorations, tr) {
    const hunk = tr.state.field(ghostDiffStateField, false);
    if (!hunk) {
      return Decoration.none;
    }

    const doc = tr.state.doc;
    const docLen = doc.length;
    const lineNum = Math.max(1, Math.min(hunk.fromLine, Math.max(1, doc.lines)));
    const line = doc.line(lineNum);

    const fromPos = hunk.fromPos !== undefined ? Math.min(hunk.fromPos, docLen) : line.from;
    const toPos =
      hunk.toPos !== undefined
        ? Math.min(hunk.toPos, docLen)
        : hunk.original
        ? Math.min(doc.line(Math.min(doc.lines, lineNum + hunk.original.split('\n').length - 1)).to, docLen)
        : fromPos;

    const ranges = [];

    // Deleted lines/hunks decoration (.cm-ghost-diff-deletion)
    if (fromPos < toPos) {
      ranges.push(
        Decoration.mark({
          class: 'cm-ghost-diff-deletion',
        }).range(fromPos, toPos)
      );
    }

    // Added lines/hunks decoration (.cm-ghost-diff-addition widget block)
    ranges.push(
      Decoration.widget({
        widget: new GhostDiffWidget(hunk),
        block: true,
        side: 1,
      }).range(toPos)
    );

    ranges.sort((a, b) => a.from - b.from);
    return Decoration.set(ranges, true);
  },
  provide: (f) => EditorView.decorations.from(f),
});

export const ghostDiffTheme = EditorView.theme({
  '.cm-ghost-diff-deletion': {
    backgroundColor: 'rgba(239, 68, 68, 0.2) !important',
    textDecoration: 'line-through !important',
    color: '#f87171 !important',
    borderRadius: '2px !important',
  },
  '.cm-ghost-diff-container': {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    margin: '4px 0',
    padding: '8px 10px',
    backgroundColor: '#1b1d22',
    border: '1px solid #2e323b',
    borderRadius: '6px',
    fontSize: '12px',
    fontFamily: "'JetBrains Mono', monospace",
    boxShadow: '0 4px 14px rgba(0, 0, 0, 0.35)',
  },
  '.cm-ghost-diff-addition': {
    backgroundColor: 'rgba(34, 197, 94, 0.15)',
    color: '#4ade80',
    padding: '6px 8px',
    borderRadius: '4px',
    whiteSpace: 'pre-wrap',
    borderLeft: '3px solid #22c55e',
    lineHeight: '1.45',
  },
  '.cm-ghost-diff-actions': {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginTop: '2px',
  },
  '.cm-ghost-diff-pill': {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    padding: '3px 9px',
    borderRadius: '4px',
    fontSize: '11px',
    cursor: 'pointer',
    border: '1px solid transparent',
    fontWeight: '500',
    transition: 'all 0.15s ease',
  },
  '.cm-ghost-diff-pill-accept': {
    backgroundColor: 'rgba(34, 197, 94, 0.2)',
    color: '#86efac',
    borderColor: 'rgba(34, 197, 94, 0.4)',
  },
  '.cm-ghost-diff-pill-accept:hover': {
    backgroundColor: 'rgba(34, 197, 94, 0.3)',
    borderColor: 'rgba(34, 197, 94, 0.6)',
  },
  '.cm-ghost-diff-pill-reject': {
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
    color: '#fca5a5',
    borderColor: 'rgba(239, 68, 68, 0.4)',
  },
  '.cm-ghost-diff-pill-reject:hover': {
    backgroundColor: 'rgba(239, 68, 68, 0.3)',
    borderColor: 'rgba(239, 68, 68, 0.6)',
  },
});

export function getActiveGhostDiff(state: EditorState): GhostDiffHunk | null {
  try {
    return state.field(ghostDiffStateField, false) || null;
  } catch {
    return null;
  }
}

export function showGhostDiff(
  view: EditorView,
  original: string,
  replacement: string,
  fromLine: number
): void {
  const doc = view.state.doc;
  const lineNum = Math.max(1, Math.min(fromLine, Math.max(1, doc.lines)));
  const line = doc.line(lineNum);
  const fromPos = line.from;

  let toLine = lineNum;
  let toPos = line.to;

  if (original) {
    const origLines = original.split('\n');
    toLine = Math.min(doc.lines, lineNum + origLines.length - 1);
    toPos = doc.line(toLine).to;
  } else {
    toPos = fromPos;
  }

  const hunk: GhostDiffHunk = {
    original,
    replacement,
    fromLine: lineNum,
    toLine,
    fromPos,
    toPos,
  };

  view.dispatch({
    effects: [setGhostDiffEffect.of(hunk)],
  });
}

export function clearGhostDiff(view: EditorView): void {
  view.dispatch({
    effects: [clearGhostDiffEffect.of()],
  });
}

export function acceptGhostDiff(view: EditorView): boolean {
  const hunk = getActiveGhostDiff(view.state);
  if (!hunk) {
    return false;
  }

  const doc = view.state.doc;
  const docLen = doc.length;
  const from = Math.min(
    hunk.fromPos !== undefined ? hunk.fromPos : doc.line(Math.max(1, Math.min(hunk.fromLine, Math.max(1, doc.lines)))).from,
    docLen
  );
  const to = Math.min(
    hunk.toPos !== undefined ? hunk.toPos : from,
    docLen
  );

  view.dispatch({
    changes: { from, to, insert: hunk.replacement },
    selection: { anchor: from + hunk.replacement.length, head: from + hunk.replacement.length },
    effects: [clearGhostDiffEffect.of()],
  });
  return true;
}

export function dismissGhostDiff(view: EditorView): boolean {
  const hunk = getActiveGhostDiff(view.state);
  if (!hunk) {
    return false;
  }

  view.dispatch({
    effects: [clearGhostDiffEffect.of()],
  });
  return true;
}

export function ghostDiffExtension(): Extension {
  return [
    ghostDiffStateField,
    ghostDiffDecorationField,
    ghostDiffTheme,
  ];
}

export const createGhostDiffExtension = ghostDiffExtension;
