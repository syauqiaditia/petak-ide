import { Prec } from '@codemirror/state';
import {
  keymap,
  EditorView,
  type KeyBinding,
} from '@codemirror/view';
import {
  acceptCompletion,
  closeCompletion,
  startCompletion,
  hasNextSnippetField,
  nextSnippetField,
  hasPrevSnippetField,
  prevSnippetField,
} from '@codemirror/autocomplete';
import { indentMore, indentLess } from '@codemirror/commands';
import { getCM } from '@replit/codemirror-vim';
import { acceptGhostText, dismissGhostText } from './ghostText.ts';
import { acceptGhostDiff, dismissGhostDiff } from './ghostDiff.ts';

/**
 * Returns true if Vim mode is active AND NOT in insert mode (i.e. normal or visual mode).
 */
export function isVimInNormalOrVisualMode(view: EditorView): boolean {
  try {
    const cm = getCM(view);
    if (!cm || !cm.state?.vim) return false;
    return !cm.state.vim.insertMode;
  } catch {
    return false;
  }
}

/**
 * Line comment toggle for any selection or line.
 * Inserts or removes `// ` at the line indent level without relying on language facets.
 */
export function toggleCommentForView(view: EditorView): boolean {
  if (view.state.readOnly) return false;
  const { state } = view;
  const doc = state.doc;
  const sel = state.selection.main;

  const startLine = doc.lineAt(sel.from);
  const endLine = doc.lineAt(sel.to);

  const lines: { number: number; from: number; to: number; text: string }[] = [];
  for (let n = startLine.number; n <= endLine.number; n++) {
    lines.push(doc.line(n));
  }

  const commentToken = '//';
  const nonEmptyLines = lines.filter((l) => l.text.trim().length > 0);
  if (nonEmptyLines.length === 0) {
    view.dispatch({
      changes: { from: sel.from, to: sel.to, insert: `${commentToken} ` },
    });
    return true;
  }

  const allCommented = nonEmptyLines.every((l) => {
    const trimmed = l.text.trimStart();
    return trimmed.startsWith(commentToken);
  });

  const changes: { from: number; to: number; insert: string }[] = [];

  if (allCommented) {
    for (const l of nonEmptyLines) {
      const match = l.text.match(/^(\s*)(\/\/ ?)/);
      if (match) {
        const indent = match[1];
        const commentPrefix = match[2];
        const commentStart = l.from + indent.length;
        const commentEnd = commentStart + commentPrefix.length;
        changes.push({ from: commentStart, to: commentEnd, insert: '' });
      }
    }
  } else {
    let minIndent = Infinity;
    for (const l of nonEmptyLines) {
      const match = l.text.match(/^\s*/);
      const indentLen = match ? match[0].length : 0;
      if (indentLen < minIndent) minIndent = indentLen;
    }
    if (minIndent === Infinity) minIndent = 0;

    for (const l of lines) {
      if (l.text.trim().length === 0) continue;
      const insertPos = l.from + Math.min(minIndent, l.text.length);
      changes.push({ from: insertPos, to: insertPos, insert: `${commentToken} ` });
    }
  }

  view.dispatch({ changes });
  return true;
}

/**
 * Handle indenting inside editor when Tab is pressed without completion/snippet.
 */
function handleTabIndent(view: EditorView): boolean {
  if (view.state.readOnly) return true;

  const { state } = view;
  const hasSelection = state.selection.ranges.some((r) => !r.empty);
  if (hasSelection) {
    indentMore(view);
    return true;
  }

  const line = state.doc.lineAt(state.selection.main.head);
  const colInLine = state.selection.main.head - line.from;
  const firstNonWs = line.text.search(/\S/);

  if (firstNonWs === -1 || colInLine <= firstNonWs) {
    indentMore(view);
  } else {
    // Insert 2 spaces (standard indentation)
    view.dispatch(state.replaceSelection('  '));
  }
  return true;
}

/**
 * Petak high-priority editor keymap.
 * - Tab: accept completion if popup is open; else next snippet field if inside snippet;
 *   in Vim normal mode falls through to Vim; else indents and prevents default so focus never leaves editor.
 * - Shift-Tab: previous snippet field if inside snippet; in Vim normal mode falls through; else dedents.
 * - Enter: accept completion if popup is open (JetBrains style); else falls through.
 * - Escape: closes completion popup if open; else falls through (allows Vim insert mode to exit to normal mode).
 * - Ctrl-Space: trigger autocompletion.
 */
export function createEditorKeyBindings(): KeyBinding[] {
  return [
    {
      key: 'Tab',
      run: (view: EditorView) => {
        if (view.composing) return false;

        // 1. Accept completion if popup is open
        if (acceptCompletion(view)) {
          return true;
        }

        // 2. Accept inline ghost diff if present
        if (acceptGhostDiff(view)) {
          return true;
        }

        // 3. Accept inline ghost text if present
        if (acceptGhostText(view)) {
          return true;
        }

        // 3. Advance to next snippet tabstop if active
        if (hasNextSnippetField(view.state)) {
          if (nextSnippetField(view)) {
            return true;
          }
        }

        // 4. In Vim normal/visual mode, let Vim handle Tab (jumplist)
        if (isVimInNormalOrVisualMode(view)) {
          return false;
        }

        // 5. In insert mode or standard editor: indent
        handleTabIndent(view);
        // ALWAYS return true to prevent browser default focus movement
        return true;
      },
    },
    {
      key: 'Shift-Tab',
      run: (view: EditorView) => {
        if (view.composing) return false;

        // 1. Move to previous snippet tabstop if active
        if (hasPrevSnippetField(view.state)) {
          if (prevSnippetField(view)) {
            return true;
          }
        }

        // 2. In Vim normal/visual mode, let Vim handle Shift-Tab
        if (isVimInNormalOrVisualMode(view)) {
          return false;
        }

        // 3. In insert mode or standard editor: dedent
        indentLess(view);
        // ALWAYS return true to prevent browser default focus movement
        return true;
      },
    },
    {
      key: 'Enter',
      run: (view: EditorView) => {
        if (view.composing) return false;

        // Accept completion if popup is open (JetBrains style)
        if (acceptCompletion(view)) {
          return true;
        }
        // Fall through so newline or Vim normal mode Enter executes
        return false;
      },
    },
    {
      key: 'Escape',
      run: (view: EditorView) => {
        // 1. Close completion popup if open
        if (closeCompletion(view)) {
          return true;
        }
        // 2. Dismiss inline ghost diff if active
        if (dismissGhostDiff(view)) {
          return true;
        }
        // 3. Dismiss inline ghost-text if active
        if (dismissGhostText(view)) {
          return true;
        }
        // Fall through so Vim exits insert mode to normal mode or clears selection
        return false;
      },
    },
    {
      key: 'Mod-/',
      run: (view: EditorView) => toggleCommentForView(view),
    },
    {
      key: 'Ctrl-Space',
      run: startCompletion,
    },
    {
      key: 'Alt-/',
      run: startCompletion,
    },
  ];
}

/**
 * Creates high-precedence keymap extension for Petak editor.
 */
export function createEditorKeymapExtension() {
  return Prec.highest(keymap.of(createEditorKeyBindings()));
}
