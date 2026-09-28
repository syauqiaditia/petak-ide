import type { EditorView } from '@codemirror/view';
import { api, type LspWorkspaceEdit, type LspTextEdit } from '../../../lib/api';
import { tabsManager } from '../tabs.svelte';
import { lspPosToOffset } from './pos';

/**
 * Convert a file:// URI to a local file system path.
 */
export function uriToPath(uri: string): string {
  if (!uri.startsWith('file://')) {
    return uri;
  }
  let path = uri.slice(7);
  // On Unix, file:///path becomes /path
  try {
    path = decodeURIComponent(path);
  } catch (_) {}
  return path;
}

/**
 * Process snippet syntax (e.g. ${1:widget}, $1, ${0}) from LSP edit.
 * Returns cleanText without snippet markup, plus the offset and length of the first placeholder.
 */
export function processSnippet(text: string): {
  cleanText: string;
  placeholderOffset: number | null;
  placeholderLen: number | null;
} {
  if (!text || !text.includes('$')) {
    return { cleanText: text, placeholderOffset: null, placeholderLen: null };
  }

  const snippetRegex = /\$\{([0-9]+)(?::([^}]*))?\}|\$([0-9]+)/g;
  let match: RegExpExecArray | null;
  let cleanText = '';
  let lastIndex = 0;
  let targetPlaceholder: { offset: number; len: number } | null = null;

  while ((match = snippetRegex.exec(text)) !== null) {
    const rawMatch = match[0];
    const matchIndex = match.index;
    const num = parseInt(match[1] || match[3] || '0', 10);
    const content = match[2] !== undefined ? match[2] : '';

    cleanText += text.slice(lastIndex, matchIndex);
    const offsetInClean = cleanText.length;
    cleanText += content;

    if (num === 1 || (targetPlaceholder === null && num === 0)) {
      targetPlaceholder = {
        offset: offsetInClean,
        len: content.length,
      };
    }

    lastIndex = matchIndex + rawMatch.length;
  }

  cleanText += text.slice(lastIndex);

  return {
    cleanText,
    placeholderOffset: targetPlaceholder ? targetPlaceholder.offset : null,
    placeholderLen: targetPlaceholder ? targetPlaceholder.len : null,
  };
}

/**
 * Apply a single file's TextEdits to a CodeMirror 6 EditorView via a transaction.
 * Preserves undo history and positions.
 */
export function applyTextEditsToView(view: EditorView, edits: LspTextEdit[]): boolean {
  if (!edits || edits.length === 0) return false;

  const doc = view.state.doc;
  let targetSelection: { anchor: number; head: number } | null = null;

  const changes = edits.map((e) => {
    const from = lspPosToOffset(doc, e.range.start);
    const to = lspPosToOffset(doc, e.range.end);
    const { cleanText, placeholderOffset, placeholderLen } = processSnippet(e.newText);
    if (placeholderOffset !== null && !targetSelection) {
      const selFrom = from + placeholderOffset;
      const selTo = selFrom + (placeholderLen ?? 0);
      targetSelection = { anchor: selFrom, head: selTo };
    }
    return { from, to, insert: cleanText };
  });

  // Sort ascending by 'from' for CodeMirror 6 ChangeSpec array
  changes.sort((a, b) => a.from - b.from || a.to - b.to);

  // Check for overlap before dispatching
  for (let i = 0; i < changes.length - 1; i++) {
    if (changes[i].to > changes[i + 1].from) {
      console.warn('Overlapping edits detected in applyTextEditsToView, applying in reverse order');
      // Apply in reverse order sequentially
      view.dispatch(
        ...changes
          .slice()
          .reverse()
          .map((c) => ({ changes: c }))
      );
      if (targetSelection) {
        view.dispatch({ selection: targetSelection, scrollIntoView: true });
      }
      return true;
    }
  }

  const sel = targetSelection as { anchor: number; head: number } | null;
  view.dispatch({
    changes,
    selection: sel ? { anchor: sel.anchor, head: sel.head } : undefined,
    scrollIntoView: true,
  });
  return true;
}

/**
 * Apply a multi-file WorkspaceEdit from LSP (e.g. rename, code action, format).
 * Files open in tabs are modified via CodeMirror transaction (undo works).
 * Files not currently open in tabs are written directly to disk via petak-core edit.
 */
export async function applyWorkspaceEdit(
  edit: LspWorkspaceEdit,
  activeView?: EditorView | null
): Promise<{ modifiedFiles: string[]; totalEdits: number }> {
  const fileEditsMap = new Map<string, LspTextEdit[]>();

  // 1. Collect from `changes` ({ [uri]: TextEdit[] })
  if (edit.changes) {
    for (const [uri, edits] of Object.entries(edit.changes)) {
      const path = uriToPath(uri);
      const existing = fileEditsMap.get(path) || [];
      fileEditsMap.set(path, existing.concat(edits));
    }
  }

  // 2. Collect from `documentChanges`
  if (edit.documentChanges && Array.isArray(edit.documentChanges)) {
    for (const docChange of edit.documentChanges) {
      if (docChange.textDocument && Array.isArray(docChange.edits)) {
        const path = uriToPath(docChange.textDocument.uri);
        const existing = fileEditsMap.get(path) || [];
        fileEditsMap.set(path, existing.concat(docChange.edits));
      }
    }
  }

  const modifiedFiles: string[] = [];
  let totalEdits = 0;

  for (const [filePath, edits] of fileEditsMap.entries()) {
    if (edits.length === 0) continue;
    totalEdits += edits.length;
    modifiedFiles.push(filePath);

    const openTab = tabsManager.tabs.find((t) => t.path === filePath);

    if (openTab) {
      // Tab is currently open in editor
      if (tabsManager.activePath === filePath && activeView) {
        applyTextEditsToView(activeView, edits);
        openTab.savedContent = activeView.state.doc.toString();
        tabsManager.markDirty(filePath, true);
      } else if (openTab.state) {
        // Background tab with EditorState
        const doc = openTab.state.doc;
        const changes = edits.map((e) => ({
          from: lspPosToOffset(doc, e.range.start),
          to: lspPosToOffset(doc, e.range.end),
          insert: processSnippet(e.newText).cleanText,
        }));
        changes.sort((a, b) => a.from - b.from || a.to - b.to);
        const tr = openTab.state.update({ changes });
        openTab.state = tr.state;
        openTab.savedContent = tr.state.doc.toString();
        tabsManager.markDirty(filePath, true);
      }
    } else {
      // File is not open in any tab -> apply to disk via Tauri command
      const diskEdits = edits.map((e) => ({
        start_line: e.range.start.line,
        start_character: e.range.start.character,
        end_line: e.range.end.line,
        end_character: e.range.end.character,
        new_text: processSnippet(e.newText).cleanText,
      }));
      await api.lsp.applyWorkspaceEditDisk(filePath, diskEdits);
    }
  }

  return { modifiedFiles, totalEdits };
}
