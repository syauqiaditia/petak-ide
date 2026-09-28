<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import {
    EditorView,
    lineNumbers,
    highlightActiveLine,
    highlightActiveLineGutter,
    drawSelection,
    keymap,
  } from '@codemirror/view';
  import { EditorState } from '@codemirror/state';
  import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
  import { vim } from '@replit/codemirror-vim';
  import { filenameFacet, treeSitterPlugin, highlightTheme } from './ts/highlight';
  import { tabsManager, type TabItem } from './tabs.svelte';
  import { api } from '../../lib/api';

  let {
    onReady,
    onCursorChange,
    onStatusChange,
  } = $props<{
    onReady?: (view: EditorView) => void;
    onCursorChange?: (cursorText: string) => void;
    onStatusChange?: (statusText: string) => void;
  }>();

  let container: HTMLDivElement;
  let view: EditorView | null = null;
  let currentSwappedPath: string | null = null;

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
    },
    { dark: true }
  );

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
          }
        }),
      ],
    });
  }

  export function getEditorView(): EditorView | null {
    return view;
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
    });
    view.focus();
  }

  export async function handleSave() {
    const active = tabsManager.activeTab;
    if (!active || !view) return;
    const currentText = view.state.doc.toString();
    try {
      await api.saveFile(active.path, currentText);
      tabsManager.markSaved(active.path, currentText);
      onStatusChange?.(`Saved ${active.name}`);
    } catch (e) {
      console.error('Failed to save file:', active.path, e);
      onStatusChange?.(`Error saving ${active.name}`);
    }
  }

  export function handleCloseActiveTab() {
    const active = tabsManager.activeTab;
    if (!active) return;
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

  function onKeydown(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      e.stopPropagation();
      handleSave();
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'w') {
      e.preventDefault();
      e.stopPropagation();
      handleCloseActiveTab();
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
    }

    view = new EditorView({
      state: initialState,
      parent: container,
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
</style>
