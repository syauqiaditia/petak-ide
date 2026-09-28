import { EditorView } from '@codemirror/view';
import { api, type LspLocation, type LspLocationLink } from '../../../lib/api';
import { tabsManager } from '../tabs.svelte';
import { uriToPath } from './applyEdit';
import { offsetToLspPos } from './pos';
import { isLspSupported } from './sync';

export interface UsageItem {
  path: string;
  name: string;
  line: number; // 1-based
  col: number; // 1-based
  text: string; // snippet/preview
}

class UsagesStore {
  symbol = $state<string>('');
  items = $state<UsageItem[]>([]);
  isOpen = $state<boolean>(false);

  setUsages(symbol: string, items: UsageItem[]) {
    this.symbol = symbol;
    this.items = items;
    this.isOpen = true;
  }

  clear() {
    this.symbol = '';
    this.items = [];
    this.isOpen = false;
  }
}

export const usagesStore = new UsagesStore();

/**
 * Jump to definition of the symbol at cursor / click position.
 */
export async function goToDefinition(
  view: EditorView,
  path: string,
  pos?: number,
  gotoLineFn?: (line: number, col: number) => void
): Promise<boolean> {
  if (!isLspSupported(path)) return false;

  const targetOffset = pos !== undefined ? pos : view.state.selection.main.head;
  const doc = view.state.doc;
  const lspPos = offsetToLspPos(doc, targetOffset);

  try {
    const res = await api.lsp.definition(path, lspPos.line, lspPos.character);
    if (!res) return false;

    let targetUri = '';
    let targetLine = 1;
    let targetCol = 1;

    if (Array.isArray(res)) {
      if (res.length === 0) return false;
      const first = res[0] as any;
      if ('targetUri' in first) {
        // LocationLink
        const link = first as LspLocationLink;
        targetUri = link.targetUri;
        targetLine = (link.targetSelectionRange?.start?.line ?? link.targetRange.start.line) + 1;
        targetCol =
          (link.targetSelectionRange?.start?.character ?? link.targetRange.start.character) + 1;
      } else if ('uri' in first) {
        // Location
        const loc = first as LspLocation;
        targetUri = loc.uri;
        targetLine = loc.range.start.line + 1;
        targetCol = loc.range.start.character + 1;
      }
    } else if (typeof res === 'object') {
      const loc = res as LspLocation;
      targetUri = loc.uri;
      targetLine = loc.range.start.line + 1;
      targetCol = loc.range.start.character + 1;
    }

    if (!targetUri) return false;

    const targetPath = uriToPath(targetUri);

    // Open target file in tab if not already open
    const existing = tabsManager.tabs.find((t) => t.path === targetPath);
    if (existing) {
      tabsManager.setActive(targetPath);
    } else {
      try {
        const content = await api.readFile(targetPath);
        const fileName = targetPath.split('/').pop() || 'file';
        tabsManager.openTab(targetPath, fileName, content);
      } catch (err) {
        console.error('Failed to open definition file:', targetPath, err);
        return false;
      }
    }

    // Scroll to position
    if (gotoLineFn) {
      setTimeout(() => {
        gotoLineFn(targetLine, targetCol);
      }, 50);
    }

    return true;
  } catch (e) {
    console.error('LSP definition error:', e);
    return false;
  }
}

/**
 * Find references / usages of the symbol at cursor and populate usagesStore.
 */
export async function findUsages(
  view: EditorView,
  path: string,
  onOpenPanel?: () => void
): Promise<boolean> {
  if (!isLspSupported(path)) return false;

  const pos = view.state.selection.main.head;
  const doc = view.state.doc;
  const lspPos = offsetToLspPos(doc, pos);

  const word = view.state.wordAt(pos);
  const symbolName = word ? doc.sliceString(word.from, word.to) : 'symbol';

  try {
    const locations = await api.lsp.references(path, lspPos.line, lspPos.character);
    if (!locations || locations.length === 0) {
      usagesStore.setUsages(symbolName, []);
      onOpenPanel?.();
      return true;
    }

    const items: UsageItem[] = [];

    for (const loc of locations) {
      const itemPath = uriToPath(loc.uri);
      const fileName = itemPath.split('/').pop() || 'file';
      const lineNum = loc.range.start.line + 1;
      const colNum = loc.range.start.character + 1;

      let preview = '';
      if (itemPath === path) {
        // Current doc line preview
        const l = Math.max(1, Math.min(lineNum, doc.lines));
        preview = doc.line(l).text.trim();
      } else {
        const tab = tabsManager.tabs.find((t) => t.path === itemPath);
        if (tab?.state) {
          const l = Math.max(1, Math.min(lineNum, tab.state.doc.lines));
          preview = tab.state.doc.line(l).text.trim();
        } else {
          preview = `${fileName}:${lineNum}`;
        }
      }

      items.push({
        path: itemPath,
        name: fileName,
        line: lineNum,
        col: colNum,
        text: preview,
      });
    }

    usagesStore.setUsages(symbolName, items);
    onOpenPanel?.();
    return true;
  } catch (e) {
    console.error('LSP references error:', e);
    return false;
  }
}

/**
 * CodeMirror 6 extension handling Cmd-Click (or Ctrl-Click) navigation to definition.
 */
export function createLspNavExtension(
  getPath: () => string | null,
  gotoLineFn?: (line: number, col: number) => void
) {
  return EditorView.domEventHandlers({
    mousedown(e: MouseEvent, view: EditorView) {
      if ((e.metaKey || e.ctrlKey) && e.button === 0) {
        const path = getPath();
        if (!path || !isLspSupported(path)) return false;

        const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
        if (pos !== null) {
          e.preventDefault();
          e.stopPropagation();
          goToDefinition(view, path, pos, gotoLineFn);
          return true;
        }
      }
      return false;
    },
  });
}
