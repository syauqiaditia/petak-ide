import type { EditorView } from '@codemirror/view';
import type { VcsHunk } from './vcsGutter';

/**
 * Reverts an editor hunk to its original state from Git HEAD.
 */
export function rollbackHunk(view: EditorView, hunk: VcsHunk) {
  const doc = view.state.doc;
  const docLines = doc.lines;

  if (hunk.kind === 'added') {
    const startLine = Math.min(Math.max(1, hunk.startNewLine), docLines);
    const endLine = Math.min(Math.max(startLine, hunk.endNewLine), docLines);
    let fromPos: number;
    let toPos: number;

    if (endLine < docLines) {
      fromPos = doc.line(startLine).from;
      toPos = doc.line(endLine + 1).from;
    } else if (startLine > 1) {
      fromPos = doc.line(startLine - 1).to;
      toPos = doc.line(endLine).to;
    } else {
      fromPos = 0;
      toPos = doc.length;
    }

    view.dispatch({
      changes: { from: fromPos, to: toPos, insert: '' },
      selection: { anchor: fromPos },
    });
  } else if (hunk.kind === 'modified') {
    const startLine = Math.min(Math.max(1, hunk.startNewLine), docLines);
    const endLine = Math.min(Math.max(startLine, hunk.endNewLine), docLines);
    const fromPos = doc.line(startLine).from;
    const toPos = doc.line(endLine).to;

    view.dispatch({
      changes: { from: fromPos, to: toPos, insert: hunk.origCode },
      selection: { anchor: fromPos + hunk.origCode.length },
    });
  } else if (hunk.kind === 'deleted') {
    const targetLine = Math.min(Math.max(1, hunk.startNewLine), docLines);
    const fromPos = doc.line(targetLine).from;

    view.dispatch({
      changes: { from: fromPos, insert: hunk.origCode + '\n' },
      selection: { anchor: fromPos + hunk.origCode.length },
    });
  }
}

export class VcsTrackerStore {
  isOpen = $state(false);
  activeHunk = $state<VcsHunk | null>(null);
  allHunks = $state<VcsHunk[]>([]);
  coords = $state<{ left: number; top: number }>({ left: 0, top: 0 });
  filePath = $state<string | null>(null);
  currentLine = $state<number>(1);

  openForLine(lineNum: number, view: EditorView, hunks: VcsHunk[], filePath?: string) {
    if (!hunks || hunks.length === 0) {
      this.close();
      return;
    }

    // Find hunk that matches this line
    const match =
      hunks.find((h) => {
        if (h.kind === 'deleted') {
          return Math.abs(h.startNewLine - lineNum) <= 1;
        }
        return lineNum >= h.startNewLine && lineNum <= h.endNewLine;
      }) || hunks.find((h) => Math.abs(h.startNewLine - lineNum) <= 1);

    if (!match) {
      this.close();
      return;
    }

    this.openForHunk(match, view, hunks, filePath);
  }

  openForHunk(hunk: VcsHunk, view: EditorView, hunks: VcsHunk[], filePath?: string) {
    this.activeHunk = hunk;
    this.allHunks = hunks;
    this.filePath = filePath || null;
    this.currentLine = hunk.startNewLine;

    try {
      const lineObj = view.state.doc.line(Math.min(hunk.startNewLine, view.state.doc.lines));
      const coords = view.coordsAtPos(lineObj.from);
      const editorRect = view.dom.getBoundingClientRect();

      let left = coords ? coords.left : editorRect.left + 50;
      let top = coords ? coords.bottom + 6 : editorRect.top + 50;

      // Keep within viewport boundaries
      if (left + 460 > window.innerWidth) {
        left = Math.max(20, window.innerWidth - 480);
      }
      if (top + 260 > window.innerHeight && coords) {
        top = Math.max(10, coords.top - 240);
      }

      this.coords = { left, top };
      this.isOpen = true;
    } catch {
      this.coords = { left: 80, top: 120 };
      this.isOpen = true;
    }
  }

  close() {
    this.isOpen = false;
    this.activeHunk = null;
  }

  prevHunk(view: EditorView) {
    if (!this.activeHunk || this.allHunks.length === 0) return;
    const curIdx = this.allHunks.findIndex((h) => h.id === this.activeHunk?.id);
    if (curIdx > 0) {
      const prev = this.allHunks[curIdx - 1];
      this.gotoHunk(prev, view);
    }
  }

  nextHunk(view: EditorView) {
    if (!this.activeHunk || this.allHunks.length === 0) return;
    const curIdx = this.allHunks.findIndex((h) => h.id === this.activeHunk?.id);
    if (curIdx >= 0 && curIdx < this.allHunks.length - 1) {
      const next = this.allHunks[curIdx + 1];
      this.gotoHunk(next, view);
    }
  }

  private gotoHunk(hunk: VcsHunk, view: EditorView) {
    const lineObj = view.state.doc.line(Math.min(hunk.startNewLine, view.state.doc.lines));
    view.dispatch({
      selection: { anchor: lineObj.from },
      scrollIntoView: true,
    });
    requestAnimationFrame(() => {
      this.openForHunk(hunk, view, this.allHunks, this.filePath || undefined);
    });
  }

  rollback(view: EditorView) {
    if (!this.activeHunk) return;
    rollbackHunk(view, this.activeHunk);
    this.close();
    view.focus();
  }
}

export const vcsTrackerStore = new VcsTrackerStore();
