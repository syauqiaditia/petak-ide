import {
  codeFolding,
  foldGutter,
  foldService,
  foldCode,
  unfoldCode,
  foldAll,
  unfoldAll,
  foldEffect,
  unfoldEffect,
  foldedRanges,
} from '@codemirror/language';
import { EditorState, StateEffect } from '@codemirror/state';
import { EditorView, keymap, type KeyBinding } from '@codemirror/view';

/**
 * In-memory session store for folded ranges per file path.
 */
const sessionFoldMap = new Map<string, number[]>();

export function saveFileFoldState(filePath: string, state: EditorState) {
  if (!filePath) return;
  const set = foldedRanges(state);
  const ranges: number[] = [];
  const iter = set.iter();
  while (iter.value !== null) {
    ranges.push(iter.from, iter.to);
    iter.next();
  }
  sessionFoldMap.set(filePath, ranges);
}

export function restoreFileFoldState(filePath: string, view: EditorView) {
  if (!filePath) return;
  const ranges = sessionFoldMap.get(filePath);
  if (!ranges || ranges.length === 0) return;
  const effects: StateEffect<any>[] = [];
  for (let i = 0; i < ranges.length; i += 2) {
    effects.push(foldEffect.of({ from: ranges[i], to: ranges[i + 1] }));
  }
  if (effects.length > 0) {
    view.dispatch({ effects });
  }
}

/**
 * Fast indent-and-delimiter folding service for Dart, Kotlin, Swift, JSON, YAML, MD.
 * Zero lag during typing: O(lines) local scan, no complex AST overhead.
 */
export const petakFoldService = foldService.of((state: EditorState, lineStart: number, lineEnd: number) => {
  const doc = state.doc;
  const line = doc.lineAt(lineStart);
  const text = line.text;
  const trimmed = text.trim();

  if (trimmed.length === 0) return null;

  // 1. Bracket/Brace-based folding: { [ (
  const lastOpenBrace = text.lastIndexOf('{');
  const lastOpenBracket = text.lastIndexOf('[');
  const lastOpenParen = text.lastIndexOf('(');
  const openIdx = Math.max(lastOpenBrace, lastOpenBracket, lastOpenParen);

  if (openIdx !== -1) {
    const char = text[openIdx];
    const closeChar = char === '{' ? '}' : char === '[' ? ']' : ')';

    // Check if closed on same line
    if (!text.slice(openIdx + 1).includes(closeChar)) {
      let depth = 1;
      let targetPos = -1;
      for (let l = line.number + 1; l <= doc.lines; l++) {
        const lText = doc.line(l).text;
        for (let c = 0; c < lText.length; c++) {
          if (lText[c] === char) depth++;
          else if (lText[c] === closeChar) {
            depth--;
            if (depth === 0) {
              targetPos = doc.line(l).from + c;
              break;
            }
          }
        }
        if (depth === 0) break;
      }
      if (targetPos > line.from + openIdx + 1) {
        return {
          from: line.from + openIdx + 1,
          to: targetPos,
        };
      }
    }
  }

  // 2. Markdown heading folding (# Heading 1 .. next #)
  if (trimmed.startsWith('#')) {
    const match = trimmed.match(/^(#+)\s/);
    if (match) {
      const level = match[1].length;
      let endPos = doc.length;
      for (let l = line.number + 1; l <= doc.lines; l++) {
        const nextLine = doc.line(l);
        const nextTrimmed = nextLine.text.trim();
        const nextMatch = nextTrimmed.match(/^(#+)\s/);
        if (nextMatch && nextMatch[1].length <= level) {
          endPos = nextLine.from - 1;
          break;
        }
      }
      if (endPos > line.to) {
        return { from: line.to, to: endPos };
      }
    }
  }

  // 3. Indent-based folding (YAML, Python, multiline lists)
  const lineIndent = getIndentLevel(text);
  if (lineIndent !== null) {
    let endPos = -1;
    for (let l = line.number + 1; l <= doc.lines; l++) {
      const nextLine = doc.line(l);
      const nextTrimmed = nextLine.text.trim();
      if (nextTrimmed.length === 0) continue; // skip blank lines
      const nextIndent = getIndentLevel(nextLine.text);
      if (nextIndent !== null && nextIndent <= lineIndent) {
        break;
      }
      endPos = nextLine.to;
    }
    if (endPos > line.to) {
      return { from: line.to, to: endPos };
    }
  }

  return null;
});

function getIndentLevel(text: string): number | null {
  let indent = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === ' ') indent += 1;
    else if (text[i] === '\t') indent += 2;
    else return indent;
  }
  return null;
}

/**
 * Keybindings for code folding:
 * Cmd-Alt-- / Ctrl-Alt-- : Collapse block
 * Cmd-Alt-+ / Ctrl-Alt-+ : Expand block
 * Cmd-Alt-Shift-- : Collapse all
 * Cmd-Alt-Shift-+ : Expand all
 */
export const foldKeybindings: KeyBinding[] = [
  { key: 'Mod-Alt--', run: foldCode },
  { key: 'Mod-Alt-Minus', run: foldCode },
  { key: 'Mod-Alt-=', run: unfoldCode },
  { key: 'Mod-Alt-+', run: unfoldCode },
  { key: 'Mod-Alt-Shift--', run: foldAll },
  { key: 'Mod-Alt-Shift-Minus', run: foldAll },
  { key: 'Mod-Alt-Shift-=', run: unfoldAll },
  { key: 'Mod-Alt-Shift-+', run: unfoldAll },
];

export function createCodeFoldingExtension() {
  return [
    codeFolding({
      placeholderText: '{…}',
    }),
    foldGutter({
      openText: '▾',
      closedText: '▸',
    }),
    EditorView.theme({
      '.cm-foldPlaceholder': {
        background: '#2a2d32',
        border: '1px solid #3c3c3c',
        color: '#8b8f98',
        borderRadius: '3px',
        padding: '0 4px',
      },
    }),
    petakFoldService,
    keymap.of(foldKeybindings),
  ];
}
