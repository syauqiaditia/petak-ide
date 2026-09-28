import { EditorView } from '@codemirror/view';
import { api } from '../../../lib/api';
import { applyTextEditsToView } from './applyEdit';
import { isLspSupported } from './sync';

/**
 * Format the current document via LSP and apply TextEdits to the active view.
 */
export async function formatDocument(
  view: EditorView,
  path: string,
  onStatusChange?: (msg: string) => void
): Promise<boolean> {
  if (!isLspSupported(path)) {
    onStatusChange?.('Formatting not supported for this file type');
    return false;
  }

  try {
    const edits = await api.lsp.format(path);
    if (!edits || edits.length === 0) {
      onStatusChange?.('Document already formatted');
      return true;
    }

    const applied = applyTextEditsToView(view, edits);
    if (applied) {
      onStatusChange?.(`Formatted document (${edits.length} edit${edits.length > 1 ? 's' : ''})`);
      return true;
    }
    return false;
  } catch (e) {
    console.error('LSP formatting error:', e);
    onStatusChange?.(`Formatting failed: ${e}`);
    return false;
  }
}
