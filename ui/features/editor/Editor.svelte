<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import {
    EditorView,
    lineNumbers,
    highlightActiveLine,
    highlightActiveLineGutter,
    drawSelection,
    keymap,
    Decoration,
    type DecorationSet,
    gutter,
    GutterMarker,
  } from '@codemirror/view';
  import { EditorState, StateEffect, StateField, Compartment } from '@codemirror/state';
  import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
  import { vim } from '@replit/codemirror-vim';
  import { filenameFacet, treeSitterPlugin, highlightTheme } from './ts/highlight';
  import { tabsManager, type TabItem } from './tabs.svelte';
  import { api, type UnlistenFn } from '../../lib/api';
  import { lintGutter } from '@codemirror/lint';
  import { lintTheme } from './lsp/theme';
  import { createLspSyncExtension, onTabOpen, onTabSave, onTabClose } from './lsp/sync';
  import {
    diagnosticsStore,
    applyStoredDiagnosticsToView,
    handleIncomingDiagnostics,
    setDiagnosticsEditorView,
  } from './lsp/diagnostics.svelte';
  import { createLspAutocompleteExtension } from './lsp/completion';
  import { createEditorKeymapExtension } from './keymap';
  import { createGhostTextExtension, clearGhostTextEffect } from './ghostText';
  import { editorSettings } from './editorSettings.svelte';
  import { createLspHoverExtension } from './lsp/hover';
  import { createLspNavExtension, goToDefinition, findUsages } from './lsp/nav.svelte';
  import { renameStore, triggerRename, executeRename } from './lsp/rename.svelte';
  import { formatDocument } from './lsp/format';
  import {
    formatDocumentOrSelection,
    isFormatOnSaveEnabled,
    detectLanguage,
  } from './formatLogic';
  import { popupStore } from '../../shell/popupStore.svelte';
  import { triggerCodeActions, queueLightbulbCheck } from './lsp/codeAction.svelte';
  import CodeActionPopup from './lsp/CodeActionPopup.svelte';
  import { applyWorkspaceEdit } from './lsp/applyEdit';
  import ContextMenu, { type MenuItem } from '../../shell/ContextMenu.svelte';
  import ComparePickerModal from '../../shell/ComparePickerModal.svelte';
  import LocalHistoryModal from '../../shell/LocalHistoryModal.svelte';
  import DiffModal from '../../shell/DiffModal.svelte';
  import {
    formatCopyPath,
    canCopyPackageImport,
    getRelativePath,
    canCloseOthers,
    canCloseToRight,
  } from '../../shell/contextMenuLogic';
  import { createDiffFileFromTexts } from '../../shell/diffUtils';
  import { gitStore } from '../git/git.svelte.ts';
  import type { GitDiffFile, GitBlameLine } from '../git/types';

  let {
    folderPath = '',
    onReady,
    onCursorChange,
    onStatusChange,
    onOpenUsages,
    onTabSave: onTabSaveProp,
    onSelectInTree,
    onOpenTerminal,
    onOpenSearch,
    onOpenGitLog,
    onOpenCommitPanel,
  } = $props<{
    folderPath?: string;
    onReady?: (view: EditorView) => void;
    onCursorChange?: (cursorText: string) => void;
    onStatusChange?: (statusText: string) => void;
    onOpenUsages?: () => void;
    onTabSave?: (path: string, content: string) => void;
    onSelectInTree?: (path: string) => void;
    onOpenTerminal?: (cwd?: string) => void;
    onOpenSearch?: (mode: string, initialQuery?: string, scope?: string) => void;
    onOpenGitLog?: (pathOrSha?: string) => void;
    onOpenCommitPanel?: (path?: string) => void;
  }>();

  let container: HTMLDivElement;
  let view: EditorView | null = null;
  let currentSwappedPath: string | null = null;
  let unlistenDiagnostics: UnlistenFn | null = null;
  let unlistenApplyEdit: UnlistenFn | null = null;

  const petakTheme = EditorView.theme(
    {
      '&': {
        color: '#bcbec4',
        backgroundColor: '#1a1b1f',
        height: '100%',
        fontSize: '13px',
        fontFamily: "'JetBrains Mono', monospace",
      },
      '.cm-scroller': {
        overflow: 'auto',
        fontFamily: "'JetBrains Mono', monospace",
        lineHeight: '22px',
      },
      '.cm-content': {
        caretColor: '#6ea8ff',
        padding: '6px 0',
      },
      '&.cm-focused .cm-cursor': {
        borderLeftColor: '#6ea8ff',
        borderLeftWidth: '2px',
      },
      '&.cm-focused .cm-selectionBackground, ::selection': {
        backgroundColor: '#1f2a3d',
      },
      '.cm-gutters': {
        backgroundColor: '#1a1b1f',
        color: '#5b5f68',
        borderRight: '1px solid #26282d',
        paddingRight: '8px',
      },
      '.cm-gutterElement': {
        paddingLeft: '12px',
      },
      '.cm-activeLine': {
        backgroundColor: '#23252b44',
      },
      '.cm-activeLineGutter': {
        backgroundColor: '#23252b44',
        color: '#b9bcc3',
      },
      '.cm-vim-panel': {
        backgroundColor: '#141518',
        color: '#d8d9dc',
        padding: '2px 8px',
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: '12px',
        borderTop: '1px solid #26282d',
      },
      '.cm-vim-panel input': {
        color: '#d8d9dc',
        backgroundColor: 'transparent',
      },
      '.cm-flash-line': {
        backgroundColor: '#2b3b55 !important',
      },
      '.cm-ghost-text': {
        color: '#7d808a !important',
        opacity: '0.65',
        fontStyle: 'normal',
      },
    },
    { dark: true }
  );

  export const setFlashLine = StateEffect.define<number | null>();

  export const flashLineField = StateField.define<DecorationSet>({
    create() {
      return Decoration.none;
    },
    update(deco, tr) {
      for (const e of tr.effects) {
        if (e.is(setFlashLine)) {
          if (e.value === null) {
            return Decoration.none;
          }
          const lineNum = Math.max(1, Math.min(e.value, tr.state.doc.lines));
          const line = tr.state.doc.line(lineNum);
          return Decoration.set([
            Decoration.line({ attributes: { class: 'cm-flash-line' } }).range(line.from),
          ]);
        }
      }
      return deco.map(tr.changes);
    },
    provide: (f) => EditorView.decorations.from(f),
  });

  let currentCursorLine = $state(1);
  let annotateActive = $state(false);
  let blameMenuVisible = $state(false);
  let blameMenuPos = $state({ x: 0, y: 0 });
  let blameMenuItems = $state<MenuItem[]>([]);
  const blameCompartment = new Compartment();

  let tabContextMenuVisible = $state(false);
  let tabContextMenuPos = $state({ x: 0, y: 0 });
  let tabContextMenuItems = $state<MenuItem[]>([]);
  let tabContextMenuTitle = $state('');

  let comparePickerOpen = $state(false);
  let compareTargetFile = $state<{ name: string; rel: string } | null>(null);

  let localHistoryOpen = $state(false);
  let localHistoryTarget = $state<{ rel: string; abs: string; isDir: boolean } | null>(null);

  let diffModalOpen = $state(false);
  let modalDiffFile = $state<GitDiffFile | null>(null);
  let modalDiffTitle = $state('');

  function formatBlameTime(unix: number): string {
    const now = Math.floor(Date.now() / 1000);
    const diff = Math.max(0, now - unix);
    if (diff < 3600) return `${Math.floor(diff / 60)}m`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
    const days = Math.floor(diff / 86400);
    if (days < 30) return `${days}d`;
    const d = new Date(unix * 1000);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  class BlameMarker extends GutterMarker {
    text: string;
    tooltip: string;
    sha: string;

    constructor(text: string, tooltip: string, sha: string) {
      super();
      this.text = text;
      this.tooltip = tooltip;
      this.sha = sha;
    }

    toDOM() {
      const el = document.createElement('div');
      el.className = 'cm-blame-cell';
      el.textContent = this.text;
      el.title = this.tooltip;

      el.onclick = (e) => {
        e.stopPropagation();
        if (this.sha) {
          onOpenGitLog?.(this.sha);
        }
      };

      el.oncontextmenu = (e) => {
        e.preventDefault();
        e.stopPropagation();
        blameMenuItems = [
          {
            label: 'Copy Revision Number',
            action: () => {
              if (this.sha) navigator.clipboard.writeText(this.sha);
            },
          },
          {
            label: 'Show Commit in Git Log',
            action: () => {
              if (this.sha) onOpenGitLog?.(this.sha);
            },
          },
          { separator: true },
          {
            label: 'Close Annotations',
            action: () => {
              toggleAnnotate();
            },
          },
        ];
        blameMenuPos = { x: e.clientX, y: e.clientY };
        blameMenuVisible = true;
      };

      return el;
    }
  }

  function makeBlameGutter(map: Map<number, GitBlameLine>) {
    return gutter({
      class: 'cm-blame-gutter',
      lineMarker(view, line) {
        const b = map.get(line.number);
        if (!b) {
          return new BlameMarker('...', '', '');
        }
        const shortSha = b.sha ? b.sha.slice(0, 7) : '';
        const author = b.author || 'Unknown';
        const timeStr = b.timeUnix ? formatBlameTime(b.timeUnix) : '';
        const text = `${author} · ${timeStr}`;
        const tooltip = `${shortSha} — ${author} (${b.timeUnix ? new Date(b.timeUnix * 1000).toLocaleString() : ''}): ${b.summary}`;
        return new BlameMarker(text, tooltip, b.sha);
      },
      initialSpacer() {
        return new BlameMarker('Author · 99d', '', '');
      },
    });
  }

  export async function toggleAnnotate() {
    if (annotateActive) {
      annotateActive = false;
      view?.dispatch({
        effects: blameCompartment.reconfigure([]),
      });
    } else {
      const active = tabsManager.activeTab;
      if (!active || !folderPath) return;
      const rel = getRelativePath(active.path, folderPath);
      try {
        const lines = await api.gitBlame(folderPath, rel);
        const map = new Map<number, GitBlameLine>();
        for (const l of lines) {
          map.set(l.line, l);
        }
        annotateActive = true;
        view?.dispatch({
          effects: blameCompartment.reconfigure(makeBlameGutter(map)),
        });
      } catch (e) {
        console.warn('Failed to fetch blame:', e);
        alert('Blame unavailable for untracked file or directory.');
      }
    }
  }

  function handleTabContextMenu(e: MouseEvent, tab: TabItem, idx: number) {
    e.preventDefault();
    e.stopPropagation();

    const isRepo = !!(gitStore.status && !gitStore.error);
    const rel = getRelativePath(tab.path, folderPath);
    const totalTabs = tabsManager.tabs.length;
    const canOthers = canCloseOthers(totalTabs);
    const canRight = canCloseToRight(idx, totalTabs);

    tabContextMenuTitle = tab.name;
    const items: MenuItem[] = [
      {
        label: 'Close',
        shortcut: '⌘W',
        action: () => {
          onTabClose(tab.path);
          tabsManager.closeTab(tab.path);
        },
      },
      {
        label: 'Close Others',
        disabled: !canOthers,
        action: () => {
          tabsManager.closeOthers(tab.path);
        },
      },
      {
        label: 'Close All',
        action: () => {
          tabsManager.closeAll();
        },
      },
      {
        label: 'Close to the Right',
        disabled: !canRight,
        action: () => {
          tabsManager.closeToRight(tab.path);
        },
      },
      { separator: true },
      {
        label: 'Copy Path/Reference',
        items: [
          {
            label: 'Absolute Path',
            shortcut: '⌥⇧⌘C',
            action: () => navigator.clipboard.writeText(formatCopyPath('absolute', tab.path, folderPath)),
          },
          {
            label: 'Path from Content Root',
            action: () => navigator.clipboard.writeText(formatCopyPath('relative', tab.path, folderPath)),
          },
          {
            label: 'File Name',
            action: () => navigator.clipboard.writeText(formatCopyPath('name', tab.path, folderPath)),
          },
          {
            label: 'File Name without Extension',
            action: () => navigator.clipboard.writeText(formatCopyPath('stem', tab.path, folderPath)),
          },
          {
            label: 'Path with Line Number',
            action: () => navigator.clipboard.writeText(formatCopyPath('line', tab.path, folderPath, currentCursorLine)),
          },
          ...(canCopyPackageImport(rel)
            ? [
                {
                  label: "Copy as 'package:' Import",
                  action: () => navigator.clipboard.writeText(formatCopyPath('package', tab.path, folderPath)),
                },
              ]
            : []),
        ],
      },
      {
        label: 'Reveal in Finder',
        shortcut: '⌥F1',
        action: () => api.osReveal(tab.path),
      },
      {
        label: 'Select in Project Tree',
        action: () => onSelectInTree?.(tab.path),
      },
    ];

    if (isRepo) {
      items.push({ separator: true });
      items.push({
        label: 'Git',
        icon: 'git',
        items: [
          {
            label: 'Show Diff',
            shortcut: '⌘D',
            icon: 'diff',
            action: async () => {
              const diffs = await api.gitDiffPath(folderPath, rel, 'head').catch(() => []);
              if (diffs && diffs.length > 0) {
                modalDiffFile = diffs[0];
                modalDiffTitle = `Git Diff (HEAD): ${tab.name}`;
                diffModalOpen = true;
              } else {
                alert('No uncommitted changes in this file.');
              }
            },
          },
          {
            label: 'Compare with Branch…',
            action: () => {
              compareTargetFile = { name: tab.name, rel };
              comparePickerOpen = true;
            },
          },
          {
            label: 'Show History',
            action: () => onOpenGitLog?.(rel),
          },
          {
            label: 'Annotate / Blame',
            action: () => toggleAnnotate(),
          },
        ],
      });
    }

    items.push({
      label: 'Local History',
      icon: 'clock',
      items: [
        {
          label: 'Show History',
          action: () => {
            localHistoryTarget = { rel, abs: tab.path, isDir: false };
            localHistoryOpen = true;
          },
        },
        {
          label: 'Put Label…',
          action: () => {
            localHistoryTarget = { rel, abs: tab.path, isDir: false };
            localHistoryOpen = true;
          },
        },
      ],
    });

    tabContextMenuItems = items;
    tabContextMenuPos = { x: e.clientX, y: e.clientY };
    tabContextMenuVisible = true;
  }

  function createEditorState(content: string, filename: string): EditorState {
    return EditorState.create({
      doc: content,
      extensions: [
        createEditorKeymapExtension(),
        EditorState.allowMultipleSelections.of(true),
        vim(),
        blameCompartment.of([]),
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightActiveLine(),
        drawSelection(),
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        petakTheme,
        highlightTheme,
        filenameFacet.of(filename),
        treeSitterPlugin,
        flashLineField,
        lintGutter(),
        lintTheme,
        createLspSyncExtension(() => currentSwappedPath),
        createLspAutocompleteExtension(() => currentSwappedPath),
        createLspHoverExtension(() => currentSwappedPath),
        createLspNavExtension(() => currentSwappedPath, gotoLine),
        createGhostTextExtension({
          getPath: () => currentSwappedPath,
          isEnabled: () => editorSettings.ghostText,
        }),
        EditorView.updateListener.of((update) => {
          const active = tabsManager.activeTab;
          if (active) {
            active.state = update.state;
            if (update.docChanged) {
              const currentText = update.state.doc.toString();
              const isDirty = currentText !== active.savedContent;
              tabsManager.markDirty(active.path, isDirty);
            }
          }
          if (update.selectionSet || update.docChanged) {
            const head = update.state.selection.main.head;
            const line = update.state.doc.lineAt(head);
            currentCursorLine = line.number;
            onCursorChange?.(`Ln ${line.number}, Col ${head - line.from + 1}`);
            if (view && currentSwappedPath) {
              queueLightbulbCheck(view, currentSwappedPath);
            }
          }
        }),
      ],
    });
  }

  export function getEditorView(): EditorView | null {
    return view;
  }

  export function focus() {
    view?.focus();
  }

  export function gotoLine(line: number, col: number = 1) {
    if (!view) return;
    const doc = view.state.doc;
    const lineNum = Math.max(1, Math.min(line, doc.lines));
    const lineObj = doc.line(lineNum);
    const targetCol = Math.max(1, Math.min(col, lineObj.length + 1));
    const pos = lineObj.from + targetCol - 1;
    view.dispatch({
      selection: { anchor: pos, head: pos },
      scrollIntoView: true,
      effects: [setFlashLine.of(lineNum)],
    });
    view.focus();
    setTimeout(() => {
      view?.dispatch({
        effects: [setFlashLine.of(null)],
      });
    }, 1200);
  }

  export async function handleSave() {
    const active = tabsManager.activeTab;
    if (!active || !view) return;
    const lang = detectLanguage(active.path);
    if (isFormatOnSaveEnabled(lang)) {
      await formatDocumentOrSelection(view, active.path, undefined, onStatusChange);
    }
    const currentText = view.state.doc.toString();
    try {
      await api.saveFile(active.path, currentText);
      api.suggestIndexUpdate(active.path).catch(() => {});
      tabsManager.markSaved(active.path, currentText);
      onTabSave(active.path, currentText);
      onStatusChange?.(`Saved ${active.name}`);
    } catch (e) {
      console.error('Failed to save file:', active.path, e);
      onStatusChange?.(`Error saving ${active.name}`);
    }
  }

  export function handleCloseActiveTab() {
    const active = tabsManager.activeTab;
    if (!active) return;
    onTabClose(active.path);
    tabsManager.closeTab(active.path);
  }

  async function handleReloadFromDisk() {
    const active = tabsManager.activeTab;
    if (!active || !view) return;
    try {
      const diskContent = active.pendingDiskContent ?? (await api.readFile(active.path));
      active.savedContent = diskContent;
      active.dirty = false;
      active.externalConflict = false;
      active.pendingDiskContent = undefined;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: diskContent },
      });
      active.state = view.state;
      onStatusChange?.(`Reloaded ${active.name} from disk`);
    } catch (e) {
      console.error('Failed to reload file from disk:', e);
    }
  }

  function handleKeepMine() {
    const active = tabsManager.activeTab;
    if (!active) return;
    active.externalConflict = false;
    active.pendingDiskContent = undefined;
    onStatusChange?.(`Kept local changes for ${active.name}`);
  }

  function selectOnMount(node: HTMLInputElement) {
    node.focus();
    node.select();
  }

  export async function handleGoToDefinition() {
    if (!view || !currentSwappedPath) return;
    await goToDefinition(view, currentSwappedPath, undefined, gotoLine);
  }

  export async function handleFindUsages() {
    if (!view || !currentSwappedPath) return;
    await findUsages(view, currentSwappedPath, onOpenUsages);
  }

  export async function handleRename() {
    if (!view || !currentSwappedPath) return;
    await triggerRename(view, currentSwappedPath);
  }

  export async function handleFormat(range?: { startLine: number; endLine: number }) {
    if (!view || !currentSwappedPath) return;
    let effectiveRange = range;
    if (!effectiveRange) {
      const selection = view.state.selection.main;
      if (!selection.empty) {
        const startLine = view.state.doc.lineAt(selection.from).number;
        const endLine = view.state.doc.lineAt(selection.to).number;
        effectiveRange = { startLine, endLine };
      }
    }
    await formatDocumentOrSelection(view, currentSwappedPath, effectiveRange, onStatusChange);
  }

  let editorContextMenuVisible = $state(false);
  let editorContextMenuPos = $state({ x: 0, y: 0 });
  let editorContextMenuItems = $state<any[]>([]);

  function handleEditorContextMenu(e: MouseEvent) {
    if (!view || !currentSwappedPath) return;
    e.preventDefault();
    e.stopPropagation();

    popupStore.closeAll();
    const selection = view.state.selection.main;
    const hasSelection = !selection.empty;

    editorContextMenuItems = [
      {
        label: 'Format Document',
        shortcut: '⌥⌘L',
        action: () => handleFormat(),
      },
      ...(hasSelection
        ? [
            {
              label: 'Format Selection',
              action: () => {
                const startLine = view.state.doc.lineAt(selection.from).number;
                const endLine = view.state.doc.lineAt(selection.to).number;
                handleFormat({ startLine, endLine });
              },
            },
          ]
        : []),
      { separator: true },
      {
        label: 'Go to Definition',
        shortcut: '⌘B / F12',
        action: () => handleGoToDefinition(),
      },
      {
        label: 'Find Usages',
        shortcut: '⌥F7',
        action: () => handleFindUsages(),
      },
      {
        label: 'Rename Symbol',
        shortcut: '⇧F6',
        action: () => handleRename(),
      },
      { separator: true },
      {
        label: 'Save',
        shortcut: '⌘S',
        action: () => handleSave(),
      },
    ];

    editorContextMenuPos = { x: e.clientX, y: e.clientY };
    editorContextMenuVisible = true;
    popupStore.open('contextMenu');
  }

  function onKeydown(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      e.stopPropagation();
      handleSave();
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'w') {
      e.preventDefault();
      e.stopPropagation();
      handleCloseActiveTab();
    } else if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'b') {
      e.preventDefault();
      e.stopPropagation();
      handleGoToDefinition();
    } else if (e.altKey && !e.metaKey && !e.ctrlKey && !e.shiftKey && (e.key === 'F7' || e.code === 'F7')) {
      e.preventDefault();
      e.stopPropagation();
      handleFindUsages();
    } else if (e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey && (e.key === 'F6' || e.code === 'F6')) {
      e.preventDefault();
      e.stopPropagation();
      handleRename();
    } else if (
      (e.metaKey || e.ctrlKey) &&
      ((e.altKey && !e.shiftKey && (e.key.toLowerCase() === 'l' || e.code === 'KeyL')) ||
       (e.shiftKey && !e.altKey && (e.key.toLowerCase() === 'i' || e.code === 'KeyI')))
    ) {
      e.preventDefault();
      e.stopPropagation();
      handleFormat();
    } else if (e.altKey && !e.metaKey && !e.ctrlKey && !e.shiftKey && (e.key === 'Enter' || e.code === 'Enter')) {
      e.preventDefault();
      e.stopPropagation();
      if (view && currentSwappedPath) {
        triggerCodeActions(view, currentSwappedPath);
      }
    }
  }

  onMount(() => {
    window.addEventListener('keydown', onKeydown, true);

    const active = tabsManager.activeTab;
    const initialState = active
      ? createEditorState(active.savedContent, active.name)
      : createEditorState('', 'Untitled');

    if (active) {
      active.state = initialState;
      currentSwappedPath = active.path;
      onTabOpen(active.path, active.savedContent);
    }

    view = new EditorView({
      state: initialState,
      parent: container,
    });

    if (typeof window !== 'undefined') {
      (window as any).__PETAK_EDITOR_VIEW__ = view;
    }

    if (active) {
      applyStoredDiagnosticsToView(view, active.path);
    }

    setDiagnosticsEditorView(() => view);

    api.onLspDiagnostics((payload) => {
      handleIncomingDiagnostics(
        payload,
        view,
        currentSwappedPath,
        (p) => {
          const tab = tabsManager.tabs.find((t) => t.path === p);
          return tab?.state?.doc ?? null;
        }
      );
    }).then((unlisten) => {
      unlistenDiagnostics = unlisten;
    });

    api.onLspApplyEdit(async (payload) => {
      try {
        await applyWorkspaceEdit(payload.edit, view);
        await api.lsp.applyEditResult(payload.id, true);
      } catch (err) {
        console.error('Failed to apply workspace/applyEdit:', err);
        await api.lsp.applyEditResult(payload.id, false);
      }
    }).then((unlisten) => {
      unlistenApplyEdit = unlisten;
    });

    view.focus();

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (view && onReady) {
          onReady(view);
        }
      });
    });
  });

  onDestroy(() => {
    window.removeEventListener('keydown', onKeydown, true);
    if (unlistenDiagnostics) {
      unlistenDiagnostics();
      unlistenDiagnostics = null;
    }
    if (unlistenApplyEdit) {
      unlistenApplyEdit();
      unlistenApplyEdit = null;
    }
    if (view) {
      view.destroy();
      view = null;
    }
  });

  // Watch for ghost text setting changes and clear active ghost text when disabled
  $effect(() => {
    if (!editorSettings.ghostText && view) {
      view.dispatch({ effects: [clearGhostTextEffect.of()] });
    }
  });

  // Watch for active tab changes and swap EditorState
  $effect(() => {
    const active = tabsManager.activeTab;
    const activePath = active ? active.path : null;

    if (activePath !== currentSwappedPath && view) {
      if (currentSwappedPath) {
        const prevTab = tabsManager.tabs.find((t) => t.path === currentSwappedPath);
        if (prevTab && view) {
          prevTab.state = view.state;
        }
      }

      currentSwappedPath = activePath;

      if (active) {
        if (!active.state) {
          active.state = createEditorState(active.savedContent, active.name);
        }
        view.setState(active.state);
        view.focus();

        onTabOpen(active.path, active.savedContent);
        applyStoredDiagnosticsToView(view, active.path);

        if (annotateActive && folderPath) {
          const rel = getRelativePath(active.path, folderPath);
          api
            .gitBlame(folderPath, rel)
            .then((lines) => {
              const map = new Map<number, GitBlameLine>();
              for (const l of lines) map.set(l.line, l);
              view?.dispatch({
                effects: blameCompartment.reconfigure(makeBlameGutter(map)),
              });
            })
            .catch(() => {
              view?.dispatch({
                effects: blameCompartment.reconfigure([]),
              });
            });
        }

        const head = active.state.selection.main.head;
        const line = active.state.doc.lineAt(head);
        onCursorChange?.(`Ln ${line.number}, Col ${head - line.from + 1}`);
      } else {
        // No active tab
        const emptyState = createEditorState('', 'Untitled');
        view.setState(emptyState);
        onCursorChange?.('Ln 1, Col 1');
      }
    }
  });
</script>

<div class="editor-wrapper">
  <!-- Tab bar (36px) -->
  <div class="tabs-bar" oncontextmenu={(e) => { e.preventDefault(); e.stopPropagation(); }}>
    {#each tabsManager.tabs as tab, idx (tab.path)}
      {@const isActive = tab.path === tabsManager.activePath}
      <div
        class="tab"
        class:active={isActive}
        class:dirty={tab.dirty}
        onclick={() => tabsManager.setActive(tab.path)}
        oncontextmenu={(e) => handleTabContextMenu(e, tab, idx)}
        role="button"
        tabindex="0"
        onkeydown={(e) => {
          if (e.key === 'Enter') tabsManager.setActive(tab.path);
        }}
      >
        <span class="tab-title">{tab.name}</span>
        <button
          class="tab-close-btn"
          onclick={(e) => {
            e.stopPropagation();
            onTabClose(tab.path);
            tabsManager.closeTab(tab.path);
          }}
          title="Close tab"
        >
          {#if tab.dirty}
            <span class="tab-dot"></span>
          {/if}
          <span class="tab-x">×</span>
        </button>
      </div>
    {/each}
  </div>

  <!-- Breadcrumbs (28px) -->
  <div class="breadcrumbs">
    {#if tabsManager.activeTab}
      <span>{tabsManager.activeTab.path}</span>
    {:else}
      <span>No file open</span>
    {/if}
  </div>

  <!-- External conflict bar if file changed on disk while dirty -->
  {#if tabsManager.activeTab?.externalConflict}
    <div class="conflict-bar">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#e8b45a" stroke-width="2" stroke-linecap="round">
        <circle cx="12" cy="12" r="10"></circle>
        <line x1="12" y1="8" x2="12" y2="12"></line>
        <line x1="12" y1="16" x2="12.01" y2="16"></line>
      </svg>
      <span>File berubah di disk — </span>
      <button class="conflict-btn" onclick={handleReloadFromDisk}>Reload</button>
      <span class="conflict-sep">/</span>
      <button class="conflict-btn" onclick={handleKeepMine}>Keep mine</button>
    </div>
  {/if}

  <!-- Editor container -->
  <div
    class="editor-container"
    bind:this={container}
    oncontextmenu={handleEditorContextMenu}
    class:hidden={tabsManager.tabs.length === 0}
  ></div>

  {#if renameStore.visible}
    <div
      class="rename-popover"
      style:left="{renameStore.x}px"
      style:top="{renameStore.y}px"
    >
      <div class="rename-title">Rename symbol</div>
      <input
        class="rename-input"
        type="text"
        bind:value={renameStore.newName}
        use:selectOnMount
        onkeydown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            executeRename(view, onStatusChange);
          } else if (e.key === 'Escape') {
            e.preventDefault();
            renameStore.hide();
            view?.focus();
          }
        }}
      />
      <div class="rename-hints">
        <span><kbd>Enter</kbd> Rename</span>
        <span><kbd>Esc</kbd> Cancel</span>
      </div>
    </div>
  {/if}

  <CodeActionPopup getView={() => view} />

  {#if tabsManager.tabs.length === 0}
    <div class="empty-editor-overlay">
      <div class="empty-editor-box">
        <span class="empty-editor-title">No file open</span>
        <span class="empty-editor-sub">Select a file from the project tree to start editing</span>
        <div class="shortcut-hints">
          <span class="shortcut"><kbd>⌘S</kbd> Save</span>
          <span class="shortcut"><kbd>⌘W</kbd> Close Tab</span>
        </div>
      </div>
    </div>
  {/if}

  {#if tabContextMenuVisible}
    <ContextMenu
      x={tabContextMenuPos.x}
      y={tabContextMenuPos.y}
      title={tabContextMenuTitle}
      items={tabContextMenuItems}
      onclose={() => (tabContextMenuVisible = false)}
    />
  {/if}

  {#if blameMenuVisible}
    <ContextMenu
      x={blameMenuPos.x}
      y={blameMenuPos.y}
      items={blameMenuItems}
      onclose={() => (blameMenuVisible = false)}
    />
  {/if}

  {#if editorContextMenuVisible && popupStore.isOpen('contextMenu')}
    <ContextMenu
      x={editorContextMenuPos.x}
      y={editorContextMenuPos.y}
      items={editorContextMenuItems}
      onclose={() => {
        editorContextMenuVisible = false;
        popupStore.close('contextMenu');
      }}
    />
  {/if}

  {#if comparePickerOpen && compareTargetFile}
    <ComparePickerModal
      fileName={compareTargetFile.name}
      relPath={compareTargetFile.rel}
      {folderPath}
      onclose={() => (comparePickerOpen = false)}
      onselect={async (ref) => {
        try {
          const diffs = await api.gitDiffPath(folderPath, compareTargetFile!.rel, ref);
          if (diffs && diffs.length > 0) {
            modalDiffFile = diffs[0];
          } else {
            const fileRef = await api.gitFileAtRef(folderPath, ref, compareTargetFile!.rel);
            const currentText = await api.readFile(`${folderPath}/${compareTargetFile!.rel}`).catch(() => '');
            modalDiffFile = createDiffFileFromTexts(
              `${ref}:${compareTargetFile!.rel}`,
              compareTargetFile!.rel,
              fileRef || '',
              currentText
            );
          }
          modalDiffTitle = `Compare: ${compareTargetFile!.name} vs ${ref}`;
          diffModalOpen = true;
        } catch (err: any) {
          alert('Failed to compare: ' + (err?.message || String(err)));
        }
      }}
    />
  {/if}

  {#if localHistoryOpen && localHistoryTarget}
    <LocalHistoryModal
      {folderPath}
      relPath={localHistoryTarget.rel}
      absPath={localHistoryTarget.abs}
      isDir={localHistoryTarget.isDir}
      onclose={() => (localHistoryOpen = false)}
      onrevert={async (revPath) => {
        const content = await api.readFile(revPath).catch(() => '');
        tabsManager.markSaved(revPath, content);
        if (view && currentSwappedPath === revPath) {
          view.dispatch({
            changes: { from: 0, to: view.state.doc.length, insert: content },
          });
        }
      }}
    />
  {/if}

  {#if diffModalOpen}
    <DiffModal
      diffFile={modalDiffFile}
      title={modalDiffTitle}
      onclose={() => (diffModalOpen = false)}
    />
  {/if}
</div>

<style>
  :global(.cm-blame-gutter) {
    background-color: #17181c !important;
    border-right: 1px solid #26282d !important;
    color: #8b8f98 !important;
  }
  :global(.cm-blame-cell) {
    width: 110px;
    height: 22px;
    line-height: 22px;
    font-size: 11px;
    font-family: 'Geist', system-ui, -apple-system, sans-serif;
    color: #8b8f98;
    padding: 0 6px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    box-sizing: border-box;
    cursor: pointer;
  }
  :global(.cm-blame-cell:hover) {
    color: #d8d9dc;
    background-color: #1f2228;
  }
  .editor-wrapper {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    background: #1a1b1f;
    position: relative;
    overflow: hidden;
  }
  .tabs-bar {
    height: 36px;
    flex-shrink: 0;
    display: flex;
    align-items: stretch;
    background: #141518;
    border-bottom: 1px solid #26282d;
    overflow-x: auto;
    overflow-y: hidden;
  }
  .tabs-bar::-webkit-scrollbar {
    display: none;
  }
  .tab {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 12px;
    background: #141518;
    color: #8b8f98;
    border-top: 2px solid transparent;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    user-select: none;
    transition: background 0.1s, color 0.1s;
    border-right: 1px solid #1c1d22;
    white-space: nowrap;
  }
  .tab:hover {
    background: #1c1d22;
    color: #d8d9dc;
  }
  .tab.active {
    background: #23252b;
    border-top: 2px solid #6ea8ff;
    color: #e6e7ea;
  }
  .tab-title {
    pointer-events: none;
  }
  .tab-close-btn {
    width: 16px;
    height: 16px;
    border-radius: 3px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    cursor: pointer;
    padding: 0;
    color: #8b8f98;
  }
  .tab-close-btn:hover {
    background: #363942;
    color: #fff;
  }
  .tab-dot {
    width: 6px;
    height: 6px;
    border-radius: 3px;
    background: #6ea8ff;
    display: inline-block;
  }
  .tab-x {
    display: none;
    font-size: 14px;
    line-height: 1;
  }
  .tab.dirty .tab-dot {
    display: inline-block;
  }
  .tab.dirty:hover .tab-dot {
    display: none;
  }
  .tab.dirty:hover .tab-x {
    display: inline-block;
  }
  .tab:not(.dirty) .tab-x {
    display: none;
  }
  .tab:not(.dirty):hover .tab-x {
    display: inline-block;
  }
  .breadcrumbs {
    height: 28px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 16px;
    font-size: 12px;
    color: #8b8f98;
    border-bottom: 1px solid #202227;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .conflict-bar {
    height: 28px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 16px;
    background: #2a2215;
    border-bottom: 1px solid #4a3818;
    color: #e8b45a;
    font-size: 12px;
  }
  .conflict-btn {
    background: none;
    border: none;
    color: #6ea8ff;
    cursor: pointer;
    font-size: 12px;
    font-weight: 500;
    text-decoration: underline;
    padding: 0 2px;
  }
  .conflict-btn:hover {
    color: #9cc3ff;
  }
  .conflict-sep {
    color: #8b8f98;
  }
  .editor-container {
    flex: 1;
    min-height: 0;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
  .editor-container.hidden {
    display: none;
  }
  :global(.editor-container .cm-editor) {
    height: 100%;
    outline: none;
  }
  .empty-editor-overlay {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .empty-editor-box {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    color: #8b8f98;
  }
  .empty-editor-title {
    font-size: 15px;
    font-weight: 500;
    color: #d8d9dc;
  }
  .empty-editor-sub {
    font-size: 12px;
    color: #8b8f98;
  }
  .shortcut-hints {
    margin-top: 14px;
    display: flex;
    gap: 16px;
    font-size: 12px;
    color: #5b5f68;
  }
  .shortcut kbd {
    background: #23252b;
    border: 1px solid #34363d;
    border-radius: 4px;
    padding: 2px 5px;
    color: #b9bcc3;
    font-family: inherit;
    font-size: 11px;
  }
  .rename-popover {
    position: absolute;
    z-index: 250;
    background: #22242a;
    border: 1px solid #34363d;
    border-radius: 6px;
    padding: 8px 10px;
    box-shadow: 0 10px 24px rgba(0, 0, 0, 0.5);
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 240px;
    font-family: 'JetBrains Mono', monospace;
  }
  .rename-title {
    font-size: 11px;
    color: #8b8f98;
    font-weight: 500;
  }
  .rename-input {
    background: #141518;
    border: 1px solid #6ea8ff;
    border-radius: 4px;
    color: #e6efff;
    padding: 4px 8px;
    font-family: 'JetBrains Mono', monospace;
    font-size: 12px;
    outline: none;
  }
  .rename-hints {
    display: flex;
    gap: 12px;
    font-size: 10px;
    color: #8b8f98;
  }
  .rename-hints kbd {
    background: #16171a;
    border: 1px solid #2c2e34;
    padding: 1px 4px;
    border-radius: 3px;
    color: #b9bcc3;
  }
</style>
