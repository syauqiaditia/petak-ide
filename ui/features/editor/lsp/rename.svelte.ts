import { EditorView } from '@codemirror/view';
import { api, type LspRange } from '../../../lib/api';
import { applyWorkspaceEdit } from './applyEdit';
import { offsetToLspPos, lspPosToOffset } from './pos';
import { isLspSupported } from './sync';

class RenameStore {
  visible = $state<boolean>(false);
  oldName = $state<string>('');
  newName = $state<string>('');
  path = $state<string>('');
  line = $state<number>(0);
  character = $state<number>(0);
  x = $state<number>(0);
  y = $state<number>(0);
  statusMessage = $state<string>('');

  show(params: {
    oldName: string;
    path: string;
    line: number;
    character: number;
    x: number;
    y: number;
  }) {
    this.oldName = params.oldName;
    this.newName = params.oldName;
    this.path = params.path;
    this.line = params.line;
    this.character = params.character;
    this.x = params.x;
    this.y = params.y;
    this.visible = true;
    this.statusMessage = '';
  }

  hide() {
    this.visible = false;
    this.oldName = '';
    this.newName = '';
    this.path = '';
    this.statusMessage = '';
  }
}

export const renameStore = new RenameStore();

/**
 * Initiate rename flow for symbol at cursor.
 */
export async function triggerRename(
  view: EditorView,
  path: string
): Promise<boolean> {
  if (!isLspSupported(path)) return false;

  const pos = view.state.selection.main.head;
  const doc = view.state.doc;
  const lspPos = offsetToLspPos(doc, pos);

  let initialName = '';

  try {
    const prepareRes = await api.lsp.prepareRename(path, lspPos.line, lspPos.character);
    if (prepareRes) {
      if ('placeholder' in prepareRes && typeof (prepareRes as any).placeholder === 'string') {
        initialName = (prepareRes as any).placeholder;
      } else if ('start' in prepareRes) {
        const range = prepareRes as LspRange;
        const from = lspPosToOffset(doc, range.start);
        const to = lspPosToOffset(doc, range.end);
        initialName = doc.sliceString(from, to);
      } else if ((prepareRes as any).range) {
        const range = (prepareRes as any).range as LspRange;
        const from = lspPosToOffset(doc, range.start);
        const to = lspPosToOffset(doc, range.end);
        initialName = doc.sliceString(from, to);
      }
    }
  } catch (_) {}

  if (!initialName) {
    const word = view.state.wordAt(pos);
    if (word) {
      initialName = doc.sliceString(word.from, word.to);
    }
  }

  if (!initialName.trim()) {
    return false;
  }

  const coords = view.coordsAtPos(pos);
  const x = coords ? Math.max(10, coords.left) : 100;
  const y = coords ? coords.bottom + 6 : 100;

  renameStore.show({
    oldName: initialName,
    path,
    line: lspPos.line,
    character: lspPos.character,
    x,
    y,
  });

  return true;
}

/**
 * Execute rename with the new symbol name.
 */
export async function executeRename(
  view: EditorView | null,
  onStatusChange?: (msg: string) => void
): Promise<boolean> {
  if (!renameStore.visible || !renameStore.newName.trim()) {
    renameStore.hide();
    return false;
  }

  const { path, line, character, oldName, newName } = renameStore;
  renameStore.hide();

  if (newName === oldName) {
    return false;
  }

  try {
    const edit = await api.lsp.rename(path, line, character, newName);
    if (!edit) {
      onStatusChange?.(`Could not rename '${oldName}'`);
      return false;
    }

    const { modifiedFiles, totalEdits } = await applyWorkspaceEdit(edit, view);
    const msg = `Renamed '${oldName}' to '${newName}' in ${totalEdits} place(s) across ${modifiedFiles.length} file(s)`;
    onStatusChange?.(msg);
    return true;
  } catch (e) {
    console.error('LSP rename error:', e);
    onStatusChange?.(`Rename failed: ${e}`);
    return false;
  }
}
