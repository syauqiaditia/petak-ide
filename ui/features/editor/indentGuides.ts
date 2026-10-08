import { StateField } from '@codemirror/state';
import { EditorView, Decoration, type DecorationSet } from '@codemirror/view';

/**
 * Calculates indentation level of a line text given tabSize (default 2).
 */
export function calculateIndentLevel(lineText: string, tabSize: number = 2): number {
  if (!lineText) return 0;
  let cols = 0;
  for (let i = 0; i < lineText.length; i++) {
    const ch = lineText[i];
    if (ch === ' ') {
      cols += 1;
    } else if (ch === '\t') {
      cols += tabSize;
    } else {
      break;
    }
  }
  return Math.floor(cols / tabSize);
}

export interface MatchingBracketResult {
  openPos: number;
  closePos: number;
  openLine: number;
  closeLine: number;
  indentCol: number;
}

/**
 * Finds the enclosing matching bracket pair around the cursor position.
 * Supports { }, ( ), and [ ].
 */
export function findMatchingBrackets(
  docText: string,
  cursorPos: number
): MatchingBracketResult | null {
  if (!docText || cursorPos < 0 || cursorPos > docText.length) return null;

  const pairs: Record<string, string> = { '{': '}', '(': ')', '[': ']' };
  const revPairs: Record<string, string> = { '}': '{', ')': '(', ']': '[' };

  // Scan backwards from cursorPos to find opening bracket
  let openPos = -1;
  let targetClose = '';

  for (let i = Math.min(cursorPos, docText.length - 1); i >= 0; i--) {
    const ch = docText[i];
    if (pairs[ch]) {
      // Found potential opening bracket, check if cursor is before matching close
      openPos = i;
      targetClose = pairs[ch];
      break;
    }
  }

  if (openPos === -1 || !targetClose) return null;

  // Scan forward from openPos to find matching close bracket
  const targetOpen = docText[openPos];
  let depth = 0;
  let closePos = -1;

  for (let j = openPos; j < docText.length; j++) {
    const ch = docText[j];
    if (ch === targetOpen) {
      depth++;
    } else if (ch === targetClose) {
      depth--;
      if (depth === 0) {
        closePos = j;
        break;
      }
    }
  }

  if (closePos === -1 || closePos < cursorPos) return null;

  // Calculate line numbers
  const linesBeforeOpen = docText.slice(0, openPos).split('\n');
  const openLine = linesBeforeOpen.length;
  const linesBeforeClose = docText.slice(0, closePos).split('\n');
  const closeLine = linesBeforeClose.length;

  if (closeLine <= openLine) {
    // Single-line bracket pair doesn't need vertical connecting line
    return null;
  }

  const openLineText = linesBeforeOpen[linesBeforeOpen.length - 1];
  const indentCol = openLineText.length;

  return {
    openPos,
    closePos,
    openLine,
    closeLine,
    indentCol,
  };
}

// -------------------------------------------------------------
// Indent Guides CodeMirror Extension
// -------------------------------------------------------------

export const indentGuidesField = StateField.define<DecorationSet>({
  create(state) {
    return buildIndentGuideDecorations(state.doc);
  },
  update(decorations, tr) {
    if (tr.docChanged) {
      return buildIndentGuideDecorations(tr.state.doc);
    }
    return decorations;
  },
  provide: (f) => EditorView.decorations.from(f),
});

function buildIndentGuideDecorations(doc: any): DecorationSet {
  const decos: any[] = [];
  const linesCount = doc.lines;
  for (let i = 1; i <= linesCount; i++) {
    const line = doc.line(i);
    const level = calculateIndentLevel(line.text, 2);
    if (level > 0 && line.text.trim().length > 0) {
      decos.push(
        Decoration.line({
          class: `cm-indent-guide cm-indent-level-${Math.min(level, 8)}`,
        }).range(line.from)
      );
    }
  }
  return Decoration.set(decos, true);
}

// -------------------------------------------------------------
// Bracket Matching Lines Extension
// -------------------------------------------------------------

export const bracketMatchingLinesField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(decorations, tr) {
    const head = tr.state.selection.main.head;
    const doc = tr.state.doc;
    const docText = doc.toString();

    const match = findMatchingBrackets(docText, head);
    if (!match) return Decoration.none;

    const decos: any[] = [];
    for (let ln = match.openLine + 1; ln < match.closeLine; ln++) {
      if (ln <= doc.lines) {
        const lineObj = doc.line(ln);
        decos.push(
          Decoration.line({
            class: 'cm-bracket-matching-guide',
          }).range(lineObj.from)
        );
      }
    }

    return Decoration.set(decos, true);
  },
  provide: (f) => EditorView.decorations.from(f),
});

export function createIndentGuidesExtension() {
  return [indentGuidesField, bracketMatchingLinesField];
}
