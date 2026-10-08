import { EditorView } from '@codemirror/view';
import { api, type LspLocation, type LspLocationLink } from '../../../lib/api.ts';
import { tabsManager } from '../tabs.svelte.ts';

export function uriToPath(uri: string): string {
  if (!uri.startsWith('file://')) {
    return uri;
  }
  let path = uri.slice(7);
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

export function isLspSupported(path: string): boolean {
  return /\.(dart|kt|kts|swift)$/.test(path);
}

export function offsetToLspPos(doc: any, offset: number) {
  const clamped = Math.max(0, Math.min(offset, doc.length));
  const line = doc.lineAt(clamped);
  return {
    line: line.number - 1,
    character: clamped - line.from,
  };
}

export interface UsageItem {
  path: string;
  name: string;
  line: number; // 1-based
  col: number; // 1-based
  text: string; // single-line snippet/preview
  previewLines?: string[]; // 2-3 lines of code preview for public symbols
}

export type NavDecision =
  | { type: 'jump-to-def'; targetPath: string; line: number; col: number }
  | { type: 'jump-to-usage'; targetPath: string; line: number; col: number }
  | { type: 'show-unused-tooltip'; message: string; symbol: string }
  | { type: 'show-usages-dropdown'; symbol: string; isPrivate: boolean; items: UsageItem[] };

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

class NavPopupStore {
  isOpen = $state<boolean>(false);
  kind = $state<'tooltip' | 'dropdown'>('tooltip');
  x = $state<number>(0);
  y = $state<number>(0);
  symbol = $state<string>('');
  isPrivate = $state<boolean>(false);
  message = $state<string>('');
  items = $state<UsageItem[]>([]);
  private timeoutId: any = null;

  showTooltip(symbol: string, message: string, x: number, y: number) {
    if (this.timeoutId) clearTimeout(this.timeoutId);
    this.symbol = symbol;
    this.message = message;
    this.kind = 'tooltip';
    this.x = x;
    this.y = y;
    this.items = [];
    this.isOpen = true;

    this.timeoutId = setTimeout(() => {
      this.close();
    }, 2500);
  }

  showDropdown(symbol: string, isPrivate: boolean, items: UsageItem[], x: number, y: number) {
    if (this.timeoutId) clearTimeout(this.timeoutId);
    this.symbol = symbol;
    this.isPrivate = isPrivate;
    this.items = items;
    this.kind = 'dropdown';
    this.x = x;
    this.y = y;
    this.isOpen = true;
  }

  close() {
    if (this.timeoutId) clearTimeout(this.timeoutId);
    this.isOpen = false;
    this.items = [];
  }
}

export const navPopupStore = new NavPopupStore();

export function isDeclarationSite(
  currentPath: string,
  currentLine: number,
  defUri: string,
  defLine: number
): boolean {
  if (!defUri) return true;
  const defPath = uriToPath(defUri);
  return defPath === currentPath && defLine === currentLine;
}

export function isSymbolPrivate(symbolName: string): boolean {
  if (!symbolName) return false;
  // Dart, Python, and private identifiers start with '_' or '#'
  if (symbolName.startsWith('_') || symbolName.startsWith('#')) return true;
  return false;
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

export function resolveNavAction(params: {
  isDeclaration: boolean;
  defPath?: string;
  defLine?: number;
  defCol?: number;
  usages: UsageItem[];
  symbolName: string;
}): NavDecision {
  if (!params.isDeclaration && params.defPath && params.defLine !== undefined) {
    return {
      type: 'jump-to-def',
      targetPath: params.defPath,
      line: params.defLine,
      col: params.defCol ?? 1,
    };
  }

  const count = params.usages.length;
  if (count === 0) {
    return {
      type: 'show-unused-tooltip',
      symbol: params.symbolName,
      message: 'tidak terpakai (0 usages)',
    };
  }

  if (count === 1) {
    return {
      type: 'jump-to-usage',
      targetPath: params.usages[0].path,
      line: params.usages[0].line,
      col: params.usages[0].col,
    };
  }

  const isPriv = isSymbolPrivate(params.symbolName);
  return {
    type: 'show-usages-dropdown',
    symbol: params.symbolName,
    isPrivate: isPriv,
    items: params.usages,
  };
}

/**
 * Jump to definition of the symbol at cursor / click position.
 */
export async function goToDefinition(
  view: EditorView,
  path: string,
  pos?: number,
  gotoLineFn?: (line: number, col: number, options?: { center?: boolean }) => void
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
        const link = first as LspLocationLink;
        targetUri = link.targetUri;
        targetLine = (link.targetSelectionRange?.start?.line ?? link.targetRange.start.line) + 1;
        targetCol =
          (link.targetSelectionRange?.start?.character ?? link.targetRange.start.character) + 1;
      } else if ('uri' in first) {
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

    // Scroll to position in center
    if (gotoLineFn) {
      setTimeout(() => {
        gotoLineFn(targetLine, targetCol, { center: true });
      }, 50);
    }

    return true;
  } catch (e) {
    console.error('LSP definition error:', e);
    return false;
  }
}

/**
 * Smart Cmd+Click navigation:
 * - Call site: jumps to definition and centers the line.
 * - Declaration site:
 *   - 0 usages: shows "tidak terpakai" tooltip.
 *   - 1 usage: directly jumps to the usage (centered).
 *   - >1 usages: shows dropdown (compact list if private, 2-3 lines preview if public).
 */
export async function handleSmartNav(
  view: EditorView,
  path: string,
  pos: number,
  coords: { x: number; y: number },
  gotoLineFn?: (line: number, col: number, options?: { center?: boolean }) => void
): Promise<boolean> {
  if (!isLspSupported(path)) return false;

  const doc = view.state.doc;
  const lspPos = offsetToLspPos(doc, pos);
  const currentLine = lspPos.line + 1;
  const currentCol = lspPos.character + 1;

  const word = view.state.wordAt(pos);
  const symbolName = word ? doc.sliceString(word.from, word.to) : '';
  if (!symbolName) return false;

  try {
    let defUri = '';
    let defLine = currentLine;
    let defCol = currentCol;

    const defRes = await api.lsp.definition(path, lspPos.line, lspPos.character);
    if (defRes) {
      if (Array.isArray(defRes) && defRes.length > 0) {
        const first = defRes[0] as any;
        if ('targetUri' in first) {
          const link = first as LspLocationLink;
          defUri = link.targetUri;
          defLine = (link.targetSelectionRange?.start?.line ?? link.targetRange.start.line) + 1;
          defCol = (link.targetSelectionRange?.start?.character ?? link.targetRange.start.character) + 1;
        } else if ('uri' in first) {
          const loc = first as LspLocation;
          defUri = loc.uri;
          defLine = loc.range.start.line + 1;
          defCol = loc.range.start.character + 1;
        }
      } else if (typeof defRes === 'object' && 'uri' in (defRes as any)) {
        const loc = defRes as LspLocation;
        defUri = loc.uri;
        defLine = loc.range.start.line + 1;
        defCol = loc.range.start.character + 1;
      }
    }

    const isDecl = isDeclarationSite(path, currentLine, defUri, defLine);

    if (!isDecl && defUri) {
      // Call site -> jump to definition and center line
      const targetPath = uriToPath(defUri);
      const existing = tabsManager.tabs.find((t) => t.path === targetPath);
      if (existing) {
        tabsManager.setActive(targetPath);
      } else {
        const content = await api.readFile(targetPath);
        const fileName = targetPath.split('/').pop() || 'file';
        tabsManager.openTab(targetPath, fileName, content);
      }
      if (gotoLineFn) {
        setTimeout(() => {
          gotoLineFn(defLine, defCol, { center: true });
        }, 50);
      }
      return true;
    }

    // Declaration site -> find usages
    const references = await api.lsp.references(path, lspPos.line, lspPos.character);
    const usages: UsageItem[] = [];

    if (references && Array.isArray(references)) {
      for (const loc of references) {
        const itemPath = uriToPath(loc.uri);
        const lineNum = loc.range.start.line + 1;
        const colNum = loc.range.start.character + 1;

        // Exclude the declaration itself
        if (itemPath === path && lineNum === currentLine) {
          continue;
        }

        const fileName = itemPath.split('/').pop() || 'file';
        let preview = '';
        const previewLines: string[] = [];

        if (itemPath === path) {
          const l = Math.max(1, Math.min(lineNum, doc.lines));
          preview = doc.line(l).text.trim();
          // Extract 2-3 preview lines around target
          const startL = Math.max(1, lineNum - 1);
          const endL = Math.min(doc.lines, lineNum + 1);
          for (let ln = startL; ln <= endL; ln++) {
            previewLines.push(doc.line(ln).text);
          }
        } else {
          const tab = tabsManager.tabs.find((t) => t.path === itemPath);
          if (tab?.state) {
            const l = Math.max(1, Math.min(lineNum, tab.state.doc.lines));
            preview = tab.state.doc.line(l).text.trim();
            const startL = Math.max(1, lineNum - 1);
            const endL = Math.min(tab.state.doc.lines, lineNum + 1);
            for (let ln = startL; ln <= endL; ln++) {
              previewLines.push(tab.state.doc.line(ln).text);
            }
          } else {
            preview = `${fileName}:${lineNum}`;
            previewLines.push(preview);
          }
        }

        usages.push({
          path: itemPath,
          name: fileName,
          line: lineNum,
          col: colNum,
          text: preview,
          previewLines,
        });
      }
    }

    const decision = resolveNavAction({
      isDeclaration: true,
      usages,
      symbolName,
    });

    if (decision.type === 'show-unused-tooltip') {
      navPopupStore.showTooltip(symbolName, decision.message, coords.x, coords.y);
      return true;
    }

    if (decision.type === 'jump-to-usage') {
      const u = usages[0];
      const existing = tabsManager.tabs.find((t) => t.path === u.path);
      if (existing) {
        tabsManager.setActive(u.path);
      } else {
        const content = await api.readFile(u.path);
        tabsManager.openTab(u.path, u.name, content);
      }
      if (gotoLineFn) {
        setTimeout(() => {
          gotoLineFn(u.line, u.col, { center: true });
        }, 50);
      }
      return true;
    }

    if (decision.type === 'show-usages-dropdown') {
      navPopupStore.showDropdown(symbolName, decision.isPrivate, decision.items, coords.x, coords.y);
      return true;
    }

    return true;
  } catch (err) {
    console.error('Smart nav error:', err);
    return false;
  }
}

/**
 * CodeMirror 6 extension handling Cmd-Click (or Ctrl-Click) smart navigation.
 */
export function createLspNavExtension(
  getPath: () => string | null,
  gotoLineFn?: (line: number, col: number, options?: { center?: boolean }) => void
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
          handleSmartNav(view, path, pos, { x: e.clientX, y: e.clientY }, gotoLineFn);
          return true;
        }
      }
      return false;
    },
  });
}
