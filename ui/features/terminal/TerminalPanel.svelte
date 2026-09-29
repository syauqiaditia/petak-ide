<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { api, type UnlistenFn } from '../../lib/api';
  import { Terminal } from '@xterm/xterm';
  import { FitAddon } from '@xterm/addon-fit';
  import '@xterm/xterm/css/xterm.css';
  import ProblemsPanel from '../problems/ProblemsPanel.svelte';
  import { diagnosticsStore } from '../editor/lsp/diagnostics.svelte';
  import { usagesStore } from '../editor/lsp/nav.svelte';
  import RunPanel from '../run/RunPanel.svelte';
  import BuildPanel from '../run/BuildPanel.svelte';
  import LogcatPanel from '../run/LogcatPanel.svelte';
  import { runStore } from '../run/runStore.svelte';
  import { logcatStore } from '../run/logcatStore.svelte';

  let {
    folderPath = '',
    onClose = () => {},
    onSelectProblem = (_path: string, _line: number, _col: number) => {},
  } = $props<{
    folderPath?: string;
    onClose?: () => void;
    onSelectProblem?: (path: string, line: number, col: number) => void;
  }>();

  interface TabItem {
    id: number;
    name: string;
    term: Terminal;
    fitAddon: FitAddon;
    container: HTMLDivElement;
  }

  let tabs = $state<TabItem[]>([]);
  let activeTabId = $state<number | null>(null);
  let activeSection = $state<'run' | 'build' | 'logcat' | 'problems' | 'usages' | 'terminal'>(
    typeof window !== 'undefined' && window.location.search.includes('tab=run')
      ? 'run'
      : typeof window !== 'undefined' && window.location.search.includes('tab=build')
      ? 'build'
      : typeof window !== 'undefined' && window.location.search.includes('tab=logcat')
      ? 'logcat'
      : 'terminal'
  );

  let bodyElement: HTMLDivElement;
  let unlistenOutput: UnlistenFn | null = null;
  let unlistenExit: UnlistenFn | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let tabCounter = 1;

  export async function createNewTab(customName?: string): Promise<number> {
    if (!bodyElement) return -1;

    const container = document.createElement('div');
    container.className = 'terminal-instance';
    container.style.width = '100%';
    container.style.height = '100%';
    container.style.display = 'block';
    bodyElement.appendChild(container);

    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: 'bar',
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: 13,
      lineHeight: 1.2,
      theme: {
        background: '#141518',
        foreground: '#d8d9dc',
        cursor: '#6ea8ff',
        selectionBackground: '#1f2a3d',
        black: '#141518',
        red: '#f07a74',
        green: '#7fc98f',
        yellow: '#e8b45a',
        blue: '#6ea8ff',
        magenta: '#c77dbb',
        cyan: '#56a8f5',
        white: '#d8d9dc',
        brightBlack: '#5b5f68',
        brightRed: '#f07a74',
        brightGreen: '#7fc98f',
        brightYellow: '#e8b45a',
        brightBlue: '#9cc3ff',
        brightMagenta: '#c77dbb',
        brightCyan: '#6ea8ff',
        brightWhite: '#ffffff',
      },
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(container);
    fitAddon.fit();

    const cols = term.cols || 80;
    const rows = term.rows || 24;

    const id = await api.termOpen(folderPath || null, cols, rows);

    term.onData((data) => {
      api.termWrite(id, data);
    });

    term.onResize(({ cols: c, rows: r }) => {
      api.termResize(id, c, r);
    });

    const name = customName || `Terminal ${tabCounter++}`;
    const newTab: TabItem = {
      id,
      name,
      term,
      fitAddon,
      container,
    };

    // Hide other tabs
    for (const t of tabs) {
      t.container.style.display = 'none';
    }

    tabs = [...tabs, newTab];
    activeTabId = id;

    setTimeout(() => {
      try {
        fitAddon.fit();
        api.termResize(id, term.cols, term.rows);
        term.focus();
      } catch (_) {}
    }, 50);

    return id;
  }

  export function setActiveTab(id: number) {
    activeTabId = id;
    for (const t of tabs) {
      if (t.id === id) {
        t.container.style.display = 'block';
        setTimeout(() => {
          try {
            t.fitAddon.fit();
            api.termResize(t.id, t.term.cols, t.term.rows);
            t.term.focus();
          } catch (_) {}
        }, 10);
      } else {
        t.container.style.display = 'none';
      }
    }
  }

  export function closeTab(id: number) {
    const idx = tabs.findIndex((t) => t.id === id);
    if (idx === -1) return;

    const [removed] = tabs.splice(idx, 1);
    tabs = [...tabs];

    try {
      api.termClose(id);
    } catch (_) {}

    try {
      removed.term.dispose();
      removed.container.remove();
    } catch (_) {}

    if (activeTabId === id) {
      if (tabs.length > 0) {
        const nextIdx = Math.min(idx, tabs.length - 1);
        setActiveTab(tabs[nextIdx].id);
      } else {
        activeTabId = null;
        onClose();
      }
    }
  }

  export function writeToActive(data: string) {
    const active = tabs.find((t) => t.id === activeTabId);
    if (active) {
      api.termWrite(active.id, data);
    }
  }

  export function getActiveColsRows(): { cols: number; rows: number } | null {
    const active = tabs.find((t) => t.id === activeTabId);
    if (active) {
      return { cols: active.term.cols, rows: active.term.rows };
    }
    return null;
  }

  export function getTabsCount(): number {
    return tabs.length;
  }

  export function getTabs(): { id: number; name: string }[] {
    return tabs.map((t) => ({ id: t.id, name: t.name }));
  }

  export function openRun() {
    activeSection = 'run';
  }

  export function openBuild() {
    activeSection = 'build';
  }

  export function openLogcat() {
    activeSection = 'logcat';
  }

  export function openProblems() {
    activeSection = 'problems';
  }

  export function openUsages() {
    activeSection = 'usages';
  }

  export function openTerminal() {
    activeSection = 'terminal';
    setTimeout(() => {
      const active = tabs.find((t) => t.id === activeTabId);
      if (active) {
        try {
          active.fitAddon.fit();
          api.termResize(active.id, active.term.cols, active.term.rows);
          active.term.focus();
        } catch (_) {}
      }
    }, 10);
  }

  export function getActiveSection(): 'problems' | 'terminal' | 'run' | 'build' | 'logcat' | 'usages' {
    return activeSection;
  }

  onMount(async () => {
    unlistenOutput = await api.onTermOutput((payload) => {
      const target = tabs.find((t) => t.id === payload.id);
      if (target) {
        target.term.write(payload.data);
      }
    });

    unlistenExit = await api.onTermExit((payload) => {
      const target = tabs.find((t) => t.id === payload.id);
      if (target) {
        target.term.writeln('\r\n\x1b[90m[Process completed]\x1b[0m');
      }
    });

    resizeObserver = new ResizeObserver(() => {
      const active = tabs.find((t) => t.id === activeTabId);
      if (active) {
        try {
          active.fitAddon.fit();
          api.termResize(active.id, active.term.cols, active.term.rows);
        } catch (_) {}
      }
    });

    if (bodyElement) {
      resizeObserver.observe(bodyElement);
    }

    await createNewTab();
  });

  onDestroy(() => {
    if (resizeObserver) {
      resizeObserver.disconnect();
      resizeObserver = null;
    }
    if (unlistenOutput) {
      unlistenOutput();
      unlistenOutput = null;
    }
    if (unlistenExit) {
      unlistenExit();
      unlistenExit = null;
    }
    for (const t of tabs) {
      try {
        api.termClose(t.id);
        t.term.dispose();
        t.container.remove();
      } catch (_) {}
    }
    tabs = [];
  });
</script>

<div class="terminal-panel">
  <div class="panel-header">
    <div class="tabs-list">
      <!-- Run Tab -->
      <div
        class="panel-tab run-tab"
        class:active={activeSection === 'run'}
        onclick={() => (activeSection = 'run')}
        role="button"
        tabindex="0"
        onkeydown={(e) => { if (e.key === 'Enter') activeSection = 'run'; }}
      >
        <span class="tab-label">Run</span>
        {#if runStore.state === 'running' || runStore.state === 'reloading' || runStore.state === 'building'}
          <span class="tab-badge run-dot" style:background={runStore.state === 'running' ? '#7fc98f' : '#e8b45a'}></span>
        {/if}
      </div>

      <!-- Build Tab -->
      <div
        class="panel-tab build-tab"
        class:active={activeSection === 'build'}
        onclick={() => (activeSection = 'build')}
        role="button"
        tabindex="0"
        onkeydown={(e) => { if (e.key === 'Enter') activeSection = 'build'; }}
      >
        <span class="tab-label">Build</span>
        {#if runStore.buildErrors.length > 0}
          <span class="tab-badge is-error">{runStore.buildErrors.length}</span>
        {/if}
      </div>

      <!-- Logcat Tab -->
      <div
        class="panel-tab logcat-tab"
        class:active={activeSection === 'logcat'}
        onclick={() => (activeSection = 'logcat')}
        role="button"
        tabindex="0"
        onkeydown={(e) => { if (e.key === 'Enter') activeSection = 'logcat'; }}
      >
        <span class="tab-label">Logcat</span>
        {#if logcatStore.isPaused}
          <span class="tab-badge is-warning">pause</span>
        {:else if logcatStore.filteredLines.length > 0}
          <span class="tab-badge logcat-badge">{logcatStore.filteredLines.length > 999 ? '999+' : logcatStore.filteredLines.length}</span>
        {/if}
      </div>

      <div
        class="panel-tab problems-tab"
        class:active={activeSection === 'problems'}
        onclick={() => (activeSection = 'problems')}
        role="button"
        tabindex="0"
        onkeydown={(e) => { if (e.key === 'Enter') activeSection = 'problems'; }}
      >
        <span class="tab-label">Problems</span>
        {#if diagnosticsStore.totalCount > 0}
          <span
            class="tab-badge"
            class:is-error={diagnosticsStore.totalErrors > 0}
            class:is-warning={diagnosticsStore.totalErrors === 0 && diagnosticsStore.totalWarnings > 0}
          >
            {diagnosticsStore.totalCount}
          </span>
        {/if}
      </div>

      {#if usagesStore.items.length > 0 || usagesStore.isOpen}
        <div
          class="panel-tab usages-tab"
          class:active={activeSection === 'usages'}
          onclick={() => (activeSection = 'usages')}
          role="button"
          tabindex="0"
          onkeydown={(e) => { if (e.key === 'Enter') activeSection = 'usages'; }}
        >
          <span class="tab-label">Usages</span>
          <span class="tab-badge usages-badge">
            {usagesStore.items.length}
          </span>
        </div>
      {/if}

      <div class="tab-divider"></div>

      {#each tabs as tab (tab.id)}
        <div
          class="terminal-tab"
          class:active={activeSection === 'terminal' && tab.id === activeTabId}
          onclick={() => {
            activeSection = 'terminal';
            setActiveTab(tab.id);
          }}
          role="button"
          tabindex="0"
          onkeydown={(e) => {
            if (e.key === 'Enter') {
              activeSection = 'terminal';
              setActiveTab(tab.id);
            }
          }}
        >
          <span class="tab-label">{tab.name}</span>
          <button
            class="tab-close-btn"
            title="Close tab"
            aria-label="Close tab"
            onclick={(e) => {
              e.stopPropagation();
              closeTab(tab.id);
            }}
          >
            ×
          </button>
        </div>
      {/each}

      <button
        class="add-tab-btn"
        onclick={() => {
          activeSection = 'terminal';
          createNewTab();
        }}
        title="New Terminal Tab"
        aria-label="New Terminal Tab"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
          <path d="M12 5v14M5 12h14"></path>
        </svg>
      </button>
    </div>

    <div class="header-actions">
      <button
        class="close-panel-btn"
        onclick={onClose}
        title="Close Panel (Ctrl-` or Cmd-J)"
        aria-label="Close Panel"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <path d="M18 6L6 18M6 6l12 12"></path>
        </svg>
      </button>
    </div>
  </div>

  {#if activeSection === 'run'}
    <div class="panel-body run-body">
      <RunPanel />
    </div>
  {/if}

  {#if activeSection === 'build'}
    <div class="panel-body build-body">
      <BuildPanel onSelectFile={onSelectProblem} />
    </div>
  {/if}

  {#if activeSection === 'logcat'}
    <div class="panel-body logcat-body">
      <LogcatPanel onOpenFile={(file, line, col) => onSelectProblem(file, line, col || 1)} />
    </div>
  {/if}

  <div
    class="panel-body terminal-body"
    bind:this={bodyElement}
    style:display={activeSection === 'terminal' ? 'block' : 'none'}
  ></div>

  {#if activeSection === 'problems'}
    <div class="panel-body problems-body">
      <ProblemsPanel {onSelectProblem} />
    </div>
  {/if}

  {#if activeSection === 'usages'}
    <div class="panel-body usages-body">
      <div class="usages-panel">
        <div class="usages-header">
          <span>Usages of <strong class="symbol-name">{usagesStore.symbol}</strong> ({usagesStore.items.length} found)</span>
        </div>
        {#if usagesStore.items.length === 0}
          <div class="usages-empty">No usages found</div>
        {:else}
          <div class="usages-list">
            {#each usagesStore.items as item}
              <div
                class="usage-row"
                onclick={() => onSelectProblem(item.path, item.line, item.col)}
                role="button"
                tabindex="0"
                onkeydown={(e) => { if (e.key === 'Enter') onSelectProblem(item.path, item.line, item.col); }}
              >
                <span class="usage-file">{item.name}</span>
                <span class="usage-pos">:{item.line}:{item.col}</span>
                <span class="usage-text">{item.text}</span>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .terminal-panel {
    height: 232px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    background: #141518;
    border-top: 1px solid #26282d;
    user-select: none;
    -webkit-user-select: none;
    z-index: 5;
  }

  .panel-header {
    height: 34px;
    flex-shrink: 0;
    display: flex;
    align-items: stretch;
    justify-content: space-between;
    padding: 0 8px 0 10px;
    border-bottom: 1px solid #222428;
    background: #111215;
  }

  .tabs-list {
    display: flex;
    align-items: stretch;
    gap: 2px;
    overflow-x: auto;
  }

  .panel-tab {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 12px;
    font-size: 12px;
    color: #8b8f98;
    cursor: pointer;
    background: transparent;
    border-bottom: 2px solid transparent;
    transition: color 0.1s;
    user-select: none;
  }

  .panel-tab:hover {
    color: #d8d9dc;
  }

  .panel-tab.active {
    color: #e6e7ea;
    border-bottom: 2px solid #6ea8ff;
    background: #141518;
  }

  .tab-badge {
    font-size: 10px;
    font-weight: 600;
    padding: 1px 6px;
    border-radius: 9px;
    background: #23252b;
    color: #8b8f98;
  }

  .tab-badge.is-error {
    background: #381e1e;
    color: #f07a74;
  }

  .tab-badge.is-warning {
    background: #332814;
    color: #e8b45a;
  }

  .tab-divider {
    width: 1px;
    height: 16px;
    background: #26282d;
    align-self: center;
    margin: 0 4px;
  }

  .problems-body,
  .run-body,
  .build-body,
  .logcat-body {
    padding: 0;
    flex: 1;
    min-height: 0;
    display: flex;
    overflow: hidden;
  }

  .logcat-badge {
    background: #23344d !important;
    color: #6ea8ff !important;
  }

  .run-dot {
    width: 6px;
    height: 6px;
    border-radius: 3px;
    padding: 0;
    display: inline-block;
  }

  .terminal-tab {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 12px;
    font-size: 12px;
    color: #8b8f98;
    cursor: pointer;
    background: transparent;
    border-bottom: 2px solid transparent;
    transition: color 0.1s;
  }

  .terminal-tab:hover {
    color: #d8d9dc;
  }

  .terminal-tab.active {
    color: #e6e7ea;
    border-bottom: 2px solid #6ea8ff;
    background: #141518;
  }

  .tab-label {
    font-size: 12px;
  }

  .tab-close-btn {
    width: 16px;
    height: 16px;
    border-radius: 3px;
    display: grid;
    place-items: center;
    font-size: 14px;
    line-height: 1;
    color: #8b8f98;
    background: transparent;
    border: none;
    padding: 0;
    cursor: pointer;
    opacity: 0.7;
  }

  .tab-close-btn:hover {
    opacity: 1;
    background: #23252b;
    color: #f07a74;
  }

  .add-tab-btn {
    width: 28px;
    height: 28px;
    align-self: center;
    border-radius: 6px;
    display: grid;
    place-items: center;
    color: #8b8f98;
    background: transparent;
    border: none;
    cursor: pointer;
    margin-left: 4px;
  }

  .add-tab-btn:hover {
    color: #d8d9dc;
    background: #1f2a3d;
  }

  .header-actions {
    display: flex;
    align-items: center;
  }

  .close-panel-btn {
    width: 24px;
    height: 24px;
    border-radius: 5px;
    display: grid;
    place-items: center;
    color: #8b8f98;
    background: transparent;
    border: none;
    cursor: pointer;
  }

  .close-panel-btn:hover {
    color: #d8d9dc;
    background: #23252b;
  }

  .panel-body {
    flex: 1;
    min-height: 0;
    position: relative;
    background: #141518;
    overflow: hidden;
    padding: 4px 6px 4px 10px;
    user-select: text;
    -webkit-user-select: text;
  }

  :global(.terminal-instance) {
    width: 100%;
    height: 100%;
  }

  :global(.terminal-instance .xterm) {
    padding: 2px 0;
    height: 100%;
  }

  :global(.terminal-instance .xterm-viewport) {
    background-color: #141518 !important;
  }

  .usages-panel {
    height: 100%;
    display: flex;
    flex-direction: column;
    background: #141518;
    color: #d8d9dc;
    font-family: 'JetBrains Mono', monospace;
    font-size: 12px;
  }

  .usages-header {
    padding: 6px 10px;
    border-bottom: 1px solid #222428;
    font-size: 11px;
    color: #8b8f98;
  }

  .symbol-name {
    color: #6ea8ff;
  }

  .usages-empty {
    padding: 16px;
    color: #5b5f68;
    font-style: italic;
  }

  .usages-list {
    flex: 1;
    overflow-y: auto;
    padding: 4px 0;
  }

  .usage-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 10px;
    cursor: pointer;
    border-radius: 4px;
    font-size: 12px;
    line-height: 1.4;
  }

  .usage-row:hover {
    background: #1e2025;
  }

  .usage-file {
    color: #6ea8ff;
    font-weight: 500;
  }

  .usage-pos {
    color: #8b8f98;
    font-size: 11px;
  }

  .usage-text {
    color: #bcbec4;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    margin-left: 6px;
  }

  .usages-badge {
    background: #2b3b55 !important;
    color: #9cc3ff !important;
  }
</style>
