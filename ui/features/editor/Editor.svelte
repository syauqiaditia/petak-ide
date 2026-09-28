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
  } from '@codemirror/view';
  import { EditorState, StateEffect, StateField } from '@codemirror/state';
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
  import { createLspHoverExtension } from './lsp/hover';
  import { createLspNavExtension, goToDefinition, findUsages } from './lsp/nav';
  import { renameStore, triggerRename, executeRename } from './lsp/rename';
  import { formatDocument } from './lsp/format';
  import { triggerCodeActions, queueLightbulbCheck } from './lsp/codeAction';
  import CodeActionPopup from './lsp/CodeActionPopup.svelte';
  import { applyWorkspaceEdit } from './lsp/applyEdit';

  let {
    onReady,
    onCursorChange,
    onStatusChange,
    onOpenUsages,
  } = $props<{
    onReady?: (view: EditorView) => void;
    onCursorChange?: (cursorText: string) => void;
    onStatusChange?: (statusText: string) => void;
    onOpenUsages?: () => void;
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

  function createEditorState(content: string, filename: string): EditorState {
    return EditorState.create({
      doc: content,
      extensions: [
        vim(),
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
    const currentText = view.state.doc.toString();
    try {
      await api.saveFile(active.path, currentText);
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

  export async function handleFormat() {
    if (!view || !currentSwappedPath) return;
    await formatDocument(view, currentSwappedPath, onStatusChange);
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
    } else if ((e.metaKey || e.ctrlKey) && e.altKey && !e.shiftKey && (e.key.toLowerCase() === 'l' || e.code === 'KeyL')) {
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
  <div class="tabs-bar">
    {#each tabsManager.tabs as tab (tab.path)}
      {@const isActive = tab.path === tabsManager.activePath}
      <div
        class="tab"
        class:active={isActive}
        class:dirty={tab.dirty}
        onclick={() => tabsManager.setActive(tab.path)}
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
  <div class="editor-container" bind:this={container} class:hidden={tabsManager.tabs.length === 0}></div>

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
</div>

<style>
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
