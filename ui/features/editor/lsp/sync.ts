import type { Extension } from '@codemirror/state';
import type { Text, ChangeSet } from '@codemirror/state';
import { EditorView, type ViewUpdate } from '@codemirror/view';
import { api, type LspChange } from '../../../lib/api';
import { offsetToLspPos } from './pos';

export function isLspSupported(path: string): boolean {
  return /\.(dart|kt|kts|swift)$/.test(path);
}

interface TrackedDoc {
  version: number;
  debounceTimer: ReturnType<typeof setTimeout> | null;
  accumulatedChanges: ChangeSet | null;
  baseDoc: Text | null;
}

const trackedDocs = new Map<string, TrackedDoc>();

export function onTabOpen(path: string, text: string) {
  if (!isLspSupported(path)) return;
  if (!trackedDocs.has(path)) {
    trackedDocs.set(path, {
      version: 1,
      debounceTimer: null,
      accumulatedChanges: null,
      baseDoc: null,
    });
    api.lsp.didOpen(path, text).catch((err) => {
      console.error('LSP didOpen error:', path, err);
    });
  }
}

export function onTabSave(path: string, text: string) {
  if (!isLspSupported(path)) return;
  flushPending(path);
  api.lsp.didSave(path, text).catch((err) => {
    console.error('LSP didSave error:', path, err);
  });
}

export function onTabClose(path: string) {
  if (!isLspSupported(path)) return;
  flushPending(path);
  trackedDocs.delete(path);
  api.lsp.didClose(path).catch((err) => {
    console.error('LSP didClose error:', path, err);
  });
}

export function flushPending(path: string) {
  const tracked = trackedDocs.get(path);
  if (!tracked) return;

  if (tracked.debounceTimer) {
    clearTimeout(tracked.debounceTimer);
    tracked.debounceTimer = null;
  }

  if (!tracked.accumulatedChanges || !tracked.baseDoc) return;

  const baseDoc = tracked.baseDoc;
  const changes: LspChange[] = [];

  tracked.accumulatedChanges.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    const start = offsetToLspPos(baseDoc, fromA);
    const end = offsetToLspPos(baseDoc, toA);
    changes.push({
      range: { start, end },
      text: inserted.toString(),
    });
  });

  tracked.accumulatedChanges = null;
  tracked.baseDoc = null;

  if (changes.length > 0) {
    tracked.version++;
    api.lsp.didChange(path, tracked.version, changes).catch((err) => {
      console.error('LSP didChange error:', path, err);
    });
  }
}

/**
 * CodeMirror 6 extension that listens to document updates, accumulates changes,
 * debounces ~15ms, and sends incremental didChange notifications to the LSP server.
 */
export function createLspSyncExtension(getPath: () => string | null): Extension {
  return EditorView.updateListener.of((update: ViewUpdate) => {
    if (!update.docChanged) return;
    const path = getPath();
    if (!path || !isLspSupported(path)) return;

    let tracked = trackedDocs.get(path);
    if (!tracked) {
      tracked = {
        version: 1,
        debounceTimer: null,
        accumulatedChanges: null,
        baseDoc: null,
      };
      trackedDocs.set(path, tracked);
    }

    if (!tracked.baseDoc) {
      tracked.baseDoc = update.startState.doc;
      tracked.accumulatedChanges = update.changes;
    } else if (tracked.accumulatedChanges) {
      tracked.accumulatedChanges = tracked.accumulatedChanges.compose(update.changes);
    }

    if (tracked.debounceTimer) {
      clearTimeout(tracked.debounceTimer);
    }

    tracked.debounceTimer = setTimeout(() => {
      flushPending(path);
    }, 15);
  });
}
