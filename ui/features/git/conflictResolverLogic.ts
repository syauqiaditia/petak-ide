import {
  EditorView,
  lineNumbers,
  highlightActiveLine,
  drawSelection,
  keymap,
} from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { darculaTheme } from '../editor/themeDarcula.ts';

export interface MergeHunk {
  id: number;
  kind: 'clean' | 'conflict';
  isIdentical: boolean;
  cleanLines: string[];
  oursLines: string[];
  theirsLines: string[];
  baseLines: string[];
  acceptedSides: {
    ours: boolean;
    theirs: boolean;
  };
  customEdit?: string | null;
}

export type HunkResolutionSide = 'ours' | 'theirs' | 'both' | 'none';

export function checkIsIdentical(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export function parseMergedIntoHunks(
  mergedText: string,
  _baseText?: string | null
): MergeHunk[] {
  const isCrlf = mergedText.includes('\r\n');
  const lines = isCrlf ? mergedText.split('\r\n') : mergedText.split('\n');
  const result: MergeHunk[] = [];
  let currentClean: string[] = [];
  let state: 'clean' | 'ours' | 'base' | 'theirs' = 'clean';
  let oursLines: string[] = [];
  let theirsLines: string[] = [];
  let baseLines: string[] = [];
  let hunkId = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (state === 'clean') {
      if (line.startsWith('<<<<<<<')) {
        if (currentClean.length > 0) {
          result.push({
            id: hunkId++,
            kind: 'clean',
            isIdentical: false,
            cleanLines: currentClean,
            oursLines: [],
            theirsLines: [],
            baseLines: [],
            acceptedSides: { ours: false, theirs: false },
            customEdit: null,
          });
          currentClean = [];
        }
        state = 'ours';
        oursLines = [];
        theirsLines = [];
        baseLines = [];
      } else {
        currentClean.push(line);
      }
    } else if (state === 'ours') {
      if (line.startsWith('=======')) {
        state = 'theirs';
      } else if (line.startsWith('|||||||')) {
        state = 'base';
      } else {
        oursLines.push(line);
      }
    } else if (state === 'base') {
      if (line.startsWith('=======')) {
        state = 'theirs';
      } else {
        baseLines.push(line);
      }
    } else if (state === 'theirs') {
      if (line.startsWith('>>>>>>>')) {
        const isIdentical = checkIsIdentical(oursLines, theirsLines);
        result.push({
          id: hunkId++,
          kind: 'conflict',
          isIdentical,
          cleanLines: [],
          oursLines: [...oursLines],
          theirsLines: [...theirsLines],
          baseLines: [...baseLines],
          acceptedSides: {
            ours: isIdentical,
            theirs: false,
          },
          customEdit: null,
        });
        state = 'clean';
      } else {
        theirsLines.push(line);
      }
    }
  }

  if (currentClean.length > 0) {
    result.push({
      id: hunkId++,
      kind: 'clean',
      isIdentical: false,
      cleanLines: currentClean,
      oursLines: [],
      theirsLines: [],
      baseLines: [],
      acceptedSides: { ours: false, theirs: false },
      customEdit: null,
    });
  }

  return result;
}

export function cloneHunks(source: MergeHunk[]): MergeHunk[] {
  return source.map((h) => ({
    ...h,
    cleanLines: [...h.cleanLines],
    oursLines: [...h.oursLines],
    theirsLines: [...h.theirsLines],
    baseLines: [...h.baseLines],
    acceptedSides: { ...h.acceptedSides },
    customEdit: h.customEdit,
  }));
}

export function getResultLines(hunk: MergeHunk): string[] {
  if (hunk.kind === 'clean') return hunk.cleanLines;
  if (hunk.customEdit !== null && hunk.customEdit !== undefined) {
    return hunk.customEdit.split('\n');
  }
  if (hunk.isIdentical) {
    return hunk.oursLines;
  }
  const lines: string[] = [];
  if (hunk.acceptedSides.ours) {
    lines.push(...hunk.oursLines);
  }
  if (hunk.acceptedSides.theirs) {
    lines.push(...hunk.theirsLines);
  }
  return lines;
}

export function computeMergedText(hunks: MergeHunk[]): string {
  return hunks.flatMap((h) => getResultLines(h)).join('\n');
}

export function resolveHunkSide(
  hunks: MergeHunk[],
  hunkId: number,
  side: HunkResolutionSide
): MergeHunk[] {
  const next = cloneHunks(hunks);
  const target = next.find((h) => h.id === hunkId);
  if (!target || target.kind !== 'conflict') return next;
  target.customEdit = null;

  if (side === 'ours') {
    target.acceptedSides.ours = !target.acceptedSides.ours;
  } else if (side === 'theirs') {
    target.acceptedSides.theirs = !target.acceptedSides.theirs;
  } else if (side === 'both') {
    target.acceptedSides.ours = true;
    target.acceptedSides.theirs = true;
  } else if (side === 'none') {
    target.acceptedSides.ours = false;
    target.acceptedSides.theirs = false;
  }

  return next;
}

export function acceptAllSide(
  hunks: MergeHunk[],
  side: 'ours' | 'theirs'
): MergeHunk[] {
  const next = cloneHunks(hunks);
  for (const h of next) {
    if (h.kind === 'conflict' && !h.isIdentical) {
      h.customEdit = null;
      if (side === 'ours') {
        h.acceptedSides.ours = true;
        h.acceptedSides.theirs = false;
      } else {
        h.acceptedSides.theirs = true;
        h.acceptedSides.ours = false;
      }
    }
  }
  return next;
}

export function applyAllIdentical(hunks: MergeHunk[]): MergeHunk[] {
  const next = cloneHunks(hunks);
  for (const h of next) {
    if (h.kind === 'conflict' && h.isIdentical) {
      h.acceptedSides.ours = true;
      h.acceptedSides.theirs = false;
    }
  }
  return next;
}

export function autoResolveTrivialBlocks(hunks: MergeHunk[]): {
  hunks: MergeHunk[];
  resolvedCount: number;
} {
  const next = cloneHunks(hunks);
  let resolvedCount = 0;

  for (const h of next) {
    if (h.kind !== 'conflict') continue;

    // Already marked identical
    if (h.isIdentical) {
      if (!h.acceptedSides.ours && !h.acceptedSides.theirs) {
        h.acceptedSides.ours = true;
        h.acceptedSides.theirs = false;
        resolvedCount++;
      }
      continue;
    }

    // Skip if user already selected a choice
    if (h.acceptedSides.ours || h.acceptedSides.theirs || h.customEdit !== null) {
      continue;
    }

    // Case 1: Identical lines between ours and theirs
    if (checkIsIdentical(h.oursLines, h.theirsLines)) {
      h.isIdentical = true;
      h.acceptedSides.ours = true;
      h.acceptedSides.theirs = false;
      h.customEdit = null;
      resolvedCount++;
      continue;
    }

    // Case 2: One side matches base ancestor
    if (h.baseLines.length > 0) {
      const oursMatchesBase = checkIsIdentical(h.oursLines, h.baseLines);
      const theirsMatchesBase = checkIsIdentical(h.theirsLines, h.baseLines);

      if (oursMatchesBase && !theirsMatchesBase) {
        // Ours unchanged compared to base -> take Theirs
        h.acceptedSides.ours = false;
        h.acceptedSides.theirs = true;
        h.customEdit = null;
        resolvedCount++;
        continue;
      }

      if (theirsMatchesBase && !oursMatchesBase) {
        // Theirs unchanged compared to base -> take Ours
        h.acceptedSides.ours = true;
        h.acceptedSides.theirs = false;
        h.customEdit = null;
        resolvedCount++;
        continue;
      }
    }

    // Case 3: Non-overlapping / one side is empty with empty base
    if (h.baseLines.length === 0) {
      if (h.oursLines.length === 0 && h.theirsLines.length > 0) {
        h.acceptedSides.theirs = true;
        h.acceptedSides.ours = false;
        h.customEdit = null;
        resolvedCount++;
        continue;
      }
      if (h.theirsLines.length === 0 && h.oursLines.length > 0) {
        h.acceptedSides.ours = true;
        h.acceptedSides.theirs = false;
        h.customEdit = null;
        resolvedCount++;
        continue;
      }
    }
  }

  return { hunks: next, resolvedCount };
}

export interface ScrollPanelElements {
  left: HTMLElement | null;
  center: HTMLElement | null;
  right: HTMLElement | null;
}

export interface SyncScrollCoordinator {
  sync: (source: 'left' | 'center' | 'right') => void;
  isSyncing: () => boolean;
  reset: () => void;
}

export function createSyncScrollCoordinator(
  getPanels: () => ScrollPanelElements
): SyncScrollCoordinator {
  let isSyncingScroll = false;

  function sync(source: 'left' | 'center' | 'right') {
    if (isSyncingScroll) return;
    isSyncingScroll = true;

    try {
      const panels = getPanels();
      const from = panels[source];
      if (!from) {
        isSyncingScroll = false;
        return;
      }

      const fromMax = from.scrollHeight - from.clientHeight;
      const ratio = fromMax > 0 ? from.scrollTop / fromMax : 0;

      for (const key of ['left', 'center', 'right'] as const) {
        if (key !== source) {
          const to = panels[key];
          if (to) {
            const toMax = to.scrollHeight - to.clientHeight;
            if (toMax > 0 && fromMax > 0) {
              to.scrollTop = Math.round(ratio * toMax);
            } else {
              to.scrollTop = from.scrollTop;
            }
          }
        }
      }
    } finally {
      if (typeof requestAnimationFrame !== 'undefined') {
        requestAnimationFrame(() => {
          isSyncingScroll = false;
        });
      } else {
        setTimeout(() => {
          isSyncingScroll = false;
        }, 0);
      }
    }
  }

  return {
    sync,
    isSyncing: () => isSyncingScroll,
    reset: () => {
      isSyncingScroll = false;
    },
  };
}

export interface ConflictEditorOptions {
  onDocChange?: (newDoc: string) => void;
  onScroll?: () => void;
}

export function getConflictEditorExtensions(options?: ConflictEditorOptions) {
  const extensions = [
    lineNumbers(),
    highlightActiveLine(),
    history(),
    drawSelection(),
    keymap.of([...defaultKeymap, ...historyKeymap]),
    darculaTheme,
    EditorView.theme({
      '&': {
        height: '100%',
        backgroundColor: 'var(--p-bg-workspace, #2b2d30)',
      },
      '.cm-scroller': {
        overflow: 'auto',
      },
    }),
  ];

  if (options?.onDocChange) {
    extensions.push(
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          options.onDocChange!(update.state.doc.toString());
        }
      })
    );
  }

  return extensions;
}

export function createConflictResultEditor(
  container: HTMLElement,
  initialContent: string,
  options?: ConflictEditorOptions
): EditorView {
  const extensions = getConflictEditorExtensions(options);
  const state = EditorState.create({
    doc: initialContent,
    extensions,
  });

  if (typeof document === 'undefined') {
    // Headless / Node testing environment: return functional mock EditorView
    let currentState = state;
    const mockView = {
      state: currentState,
      scrollDOM: {
        scrollTop: 0,
        scrollHeight: 1000,
        clientHeight: 300,
        addEventListener: (_type: string, fn: any) => {
          if (_type === 'scroll' && options?.onScroll) {
            // attach
          }
        },
      } as any,
      dispatch: (tr: any) => {
        if (typeof tr === 'function') tr = tr(currentState);
        if (tr && tr.state) {
          currentState = tr.state;
        } else if (tr) {
          const update = currentState.update(tr);
          currentState = update.state;
          if (options?.onDocChange && update.docChanged) {
            options.onDocChange(currentState.doc.toString());
          }
        }
        (mockView as any).state = currentState;
      },
      destroy: () => {},
    } as unknown as EditorView;
    return mockView;
  }

  const view = new EditorView({
    state,
    parent: container,
  });

  if (options?.onScroll) {
    view.scrollDOM.addEventListener('scroll', options.onScroll);
  }

  return view;
}
