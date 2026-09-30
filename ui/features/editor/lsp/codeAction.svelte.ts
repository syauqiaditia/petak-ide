import type { EditorView } from '@codemirror/view';
import {
  api,
  type LspCodeAction,
  type LspRange,
  type LspDiagnostic,
  type LspWorkspaceEdit,
} from '../../../lib/api';
import { offsetToLspPos, lspPosToOffset } from './pos';
import { diagnosticsStore, type FileDiagnostic } from './diagnostics.svelte';
import { applyWorkspaceEdit } from './applyEdit';
import { isLspSupported } from './sync';

export interface CodeActionItem extends LspCodeAction {
  category: 'quickfix' | 'refactor' | 'source' | 'other';
}

class CodeActionState {
  active = $state(false);
  actions = $state<CodeActionItem[]>([]);
  selectedIndex = $state(0);
  coords = $state<{ left: number; top: number }>({ left: 0, top: 0 });
  path = $state<string | null>(null);

  // Lightbulb indicator
  lightbulbVisible = $state(false);
  lightbulbCoords = $state<{ left: number; top: number }>({ left: 0, top: 0 });
  lightbulbActionsCount = $state(0);

  reset() {
    this.active = false;
    this.actions = [];
    this.selectedIndex = 0;
    this.path = null;
  }

  hideLightbulb() {
    this.lightbulbVisible = false;
  }
}

export const codeActionState = new CodeActionState();

/**
 * Determine category of a code action for grouping/sorting.
 */
function categorizeAction(action: LspCodeAction): 'quickfix' | 'refactor' | 'source' | 'other' {
  const kind = action.kind || '';
  if (kind.startsWith('quickfix') || (action.diagnostics && action.diagnostics.length > 0)) {
    return 'quickfix';
  }
  if (kind.startsWith('refactor')) {
    return 'refactor';
  }
  if (kind.startsWith('source')) {
    return 'source';
  }
  return 'other';
}

/**
 * Fetch code actions for a given editor position/selection.
 */
export async function getCodeActionsForCursor(
  view: EditorView,
  filePath: string
): Promise<CodeActionItem[]> {
  if (!isLspSupported(filePath)) return [];

  const doc = view.state.doc;
  const sel = view.state.selection.main;
  const startPos = offsetToLspPos(doc, sel.from);
  const endPos = offsetToLspPos(doc, sel.to);
  const range: LspRange = { start: startPos, end: endPos };

  // Find diagnostics that overlap current selection/cursor
  const fileDiags = diagnosticsStore.getForFile(filePath);
  const overlapping = fileDiags.filter((d) => d.from <= sel.to && d.to >= sel.from);

  const lspDiags: LspDiagnostic[] = overlapping.map((d) => ({
    range: {
      start: { line: d.line - 1, character: d.col - 1 },
      end: { line: d.endLine - 1, character: d.endCol - 1 },
    },
    severity:
      d.severity === 'error'
        ? 1
        : d.severity === 'warning'
        ? 2
        : d.severity === 'info'
        ? 3
        : 4,
    message: d.message,
    source: d.source,
    code: d.code,
  }));

  try {
    const rawActions = await api.lsp.codeActions(filePath, range, lspDiags);
    if (!rawActions || !Array.isArray(rawActions)) return [];

    const items: CodeActionItem[] = rawActions.map((a: any) => ({
      ...a,
      category: categorizeAction(a),
    }));

    // Sort: quickfix first, then refactor, then source, then other
    const order: Record<string, number> = {
      quickfix: 0,
      refactor: 1,
      source: 2,
      other: 3,
    };

    items.sort((a, b) => {
      const catDiff = order[a.category] - order[b.category];
      if (catDiff !== 0) return catDiff;
      if (a.isPreferred && !b.isPreferred) return -1;
      if (!a.isPreferred && b.isPreferred) return 1;
      return a.title.localeCompare(b.title);
    });

    return items;
  } catch (err) {
    console.error('Failed to get code actions:', err);
    return [];
  }
}

/**
 * Trigger Alt-Enter: request code actions and show floating popup list.
 */
export async function triggerCodeActions(
  view: EditorView,
  filePath: string
): Promise<void> {
  const actions = await getCodeActionsForCursor(view, filePath);
  if (!actions || actions.length === 0) {
    codeActionState.reset();
    return;
  }

  // Calculate coordinates at cursor
  const head = view.state.selection.main.head;
  const coords = view.coordsAtPos(head);
  const editorRect = view.dom.getBoundingClientRect();

  let left = coords ? coords.left : editorRect.left + 50;
  let top = coords ? coords.bottom + 8 : editorRect.top + 50;

  // Keep within window bounds
  if (left + 380 > window.innerWidth) {
    left = window.innerWidth - 390;
  }
  if (top + 300 > window.innerHeight) {
    top = coords ? coords.top - 280 : top - 280;
  }

  codeActionState.actions = actions;
  codeActionState.selectedIndex = 0;
  codeActionState.coords = { left, top };
  codeActionState.path = filePath;
  codeActionState.active = true;
  codeActionState.hideLightbulb();
}

/**
 * Apply a selected CodeAction.
 */
export async function applyCodeAction(
  action: LspCodeAction,
  view: EditorView,
  filePath: string
): Promise<boolean> {
  try {
    let editToApply: LspWorkspaceEdit | undefined = action.edit;
    let commandToExec = action.command;

    // If neither edit nor command is present, try resolving the code action
    if (!editToApply && !commandToExec) {
      try {
        const resolved = await api.lsp.codeActionResolve(filePath, action);
        if (resolved) {
          editToApply = resolved.edit;
          commandToExec = resolved.command;
        }
      } catch (resErr) {
        console.warn('codeActionResolve failed, falling back:', resErr);
      }
    }

    let appliedAny = false;

    // Apply workspace edit if present
    if (editToApply) {
      await applyWorkspaceEdit(editToApply, view);
      appliedAny = true;
    }

    // Execute command if present
    if (commandToExec) {
      await api.lsp.executeCommand(
        filePath,
        commandToExec.command,
        commandToExec.arguments
      );
      appliedAny = true;
    }

    codeActionState.reset();
    view.focus();
    return appliedAny;
  } catch (err) {
    console.error('Failed to apply code action:', err);
    codeActionState.reset();
    view.focus();
    return false;
  }
}

/**
 * Populate quick-fix buttons inside a diagnostic lint popup.
 */
export async function populateQuickFixSlot(
  diag: FileDiagnostic,
  container: HTMLElement,
  getView: () => EditorView | null
): Promise<void> {
  container.innerHTML = '';
  if (!isLspSupported(diag.path)) return;

  const range: LspRange = {
    start: { line: diag.line - 1, character: diag.col - 1 },
    end: { line: diag.endLine - 1, character: diag.endCol - 1 },
  };

  const lspDiag: LspDiagnostic = {
    range,
    severity:
      diag.severity === 'error'
        ? 1
        : diag.severity === 'warning'
        ? 2
        : diag.severity === 'info'
        ? 3
        : 4,
    message: diag.message,
    source: diag.source,
    code: diag.code,
  };

  try {
    const rawActions = await api.lsp.codeActions(diag.path, range, [lspDiag]);
    if (!rawActions || rawActions.length === 0) return;

    // Take top 2 quick-fix actions
    const quickFixes = rawActions
      .filter((a: any) => {
        const kind = a.kind || '';
        return kind.startsWith('quickfix') || !kind.startsWith('refactor');
      })
      .slice(0, 2);

    for (const action of quickFixes) {
      const btn = document.createElement('button');
      btn.style.cssText =
        'height: 26px; padding: 0 10px; border-radius: 6px; background: #2a3a55; color: #cfe0ff; border: 1px solid #3d4f70; font-family: "Geist", sans-serif; font-size: 12px; cursor: pointer; display: flex; align-items: center; gap: 5px; white-space: nowrap;';
      btn.textContent = action.title;
      btn.title = action.title;

      btn.addEventListener('mouseenter', () => {
        btn.style.background = '#354b6e';
      });
      btn.addEventListener('mouseleave', () => {
        btn.style.background = '#2a3a55';
      });

      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        e.preventDefault();
        const view = getView();
        if (view) {
          await applyCodeAction(action, view, diag.path);
        }
      });

      container.appendChild(btn);
    }
  } catch (err) {
    console.error('Failed to populate quick fixes for popup:', err);
  }
}

let lightbulbTimeout: any = null;

/**
 * Lazy lightbulb check on cursor idle (300ms).
 */
export function queueLightbulbCheck(
  view: EditorView,
  filePath: string
): void {
  if (lightbulbTimeout) {
    clearTimeout(lightbulbTimeout);
  }

  codeActionState.hideLightbulb();

  lightbulbTimeout = setTimeout(async () => {
    if (!codeActionState.active && isLspSupported(filePath)) {
      const actions = await getCodeActionsForCursor(view, filePath);
      if (actions.length > 0) {
        const head = view.state.selection.main.head;
        const coords = view.coordsAtPos(head);
        if (coords) {
          const placeBelow = coords.bottom + 28 <= window.innerHeight;
          codeActionState.lightbulbCoords = {
            left: coords.left,
            top: placeBelow ? coords.bottom + 6 : coords.top - 26,
          };
          codeActionState.lightbulbActionsCount = actions.length;
          codeActionState.lightbulbVisible = true;
          codeActionState.path = filePath;
        }
      }
    }
  }, 300);
}
