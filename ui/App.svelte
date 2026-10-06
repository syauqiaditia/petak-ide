<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { api, type Entry, type UnlistenFn } from './lib/api';
  import TitleBar from './shell/TitleBar.svelte';
  import Rail from './shell/Rail.svelte';
  import FileTree from './shell/FileTree.svelte';
  import StatusBar from './shell/StatusBar.svelte';
  import GitCheckoutProgressOverlay from './shell/GitCheckoutProgressOverlay.svelte';
  import Editor from './features/editor/Editor.svelte';
  import { tabsManager } from './features/editor/tabs.svelte';
  import { isImageFile } from './features/editor/imageUtils';
  import { diagnosticsStore } from './features/editor/lsp/diagnostics.svelte';
  import type { EditorView } from '@codemirror/view';
  import { preloadAllLanguages, treeSitterPlugin } from './features/editor/ts/highlight';
  import { registerKeymap, showIntentions, type SearchMode } from './features/search/keymap';
  import { applyWorkspaceEdit } from './features/editor/lsp/applyEdit';
  import { gitStore } from './features/git/git.svelte.ts';
  import { runStore } from './features/run/runStore.svelte';
  import { mirrorStore } from './features/mirror/mirrorStore.svelte';
  import { panelStore } from './shell/panelStore.svelte';
  import { executeProjectSwitchReset } from './shell/projectResetLogic';
  import { getSnippetCompletionsForLanguage } from './features/editor/snippets';
  import { toolchainStore } from './features/toolchain/toolchainStore.svelte';
  import { settingsStore } from './features/settings/settingsStore.svelte';
  import SettingsModal from './features/settings/SettingsModal.svelte';
  import RebaseBranchModal from './features/git/RebaseBranchModal.svelte';
  import CommitPanel from './features/git/CommitPanel.svelte';
  import DashboardView from './features/dashboard/DashboardView.svelte';
  import RightDock from './shell/RightDock.svelte';
  import { handlePreviewQueryParams } from './shell/previewUrlHandler';
  import { buildStaticActions } from './shell/staticActions';
  import RightRail from './shell/RightRail.svelte';
  import MemoryView from './features/agents/MemoryView.svelte';
  import { runBenchmark as runBenchmarkExt, runAutomatedTestMode } from './features/benchmarks/benchRunner';

  let GitViewComponent = $state<any>(null);
  let MrViewComponent = $state<any>(null);
  let DevicesPanelComponent = $state<any>(null);
  let DeviceMirrorPanelComponent = $state<any>(null);
  let AgentsPanelComponent = $state<any>(null);
  let TestsPanelComponent = $state<any>(null);

  let isAgentPanelOpen = $derived(panelStore.activeRightPanel === 'agent');

  function toggleAgentsPanel() {
    panelStore.toggleRightPanel('agent');
  }

  function toggleMemoryPanel() {
    panelStore.toggleRightPanel('memory');
  }

  function toggleMirrorPanel() {
    mirrorStore.toggle();
  }

  function toggleDevicesPanel() {
    panelStore.toggleRightPanel('devices');
  }

  $effect(() => {
    if (gitStore.activeSubTab === 'conflict' && activeRailTab !== 'git') {
      activeRailTab = 'git';
    }
    if (activeRailTab === 'git' && !GitViewComponent) {
      import('./features/git/GitView.svelte').then((m) => (GitViewComponent = m.default));
    }
    if (activeRailTab === 'mr' && !MrViewComponent) {
      import('./features/mr/MrView.svelte').then((m) => (MrViewComponent = m.default));
    }
    if (activeRailTab === 'tests' && !TestsPanelComponent) {
      import('./features/tests/TestsPanel.svelte').then((m) => (TestsPanelComponent = m.default));
    }
    if (activeRailTab === 'settings') {
      openToolchains();
    }
    if (panelStore.activeRightPanel === 'devices' && !DevicesPanelComponent) {
      import('./features/run/DevicesPanel.svelte').then((m) => (DevicesPanelComponent = m.default));
    }
    if (panelStore.activeRightPanel === 'mirror' && !DeviceMirrorPanelComponent) {
      import('./features/mirror/DeviceMirrorPanel.svelte').then((m) => (DeviceMirrorPanelComponent = m.default));
    }
    if (isAgentPanelOpen && !AgentsPanelComponent) {
      import('./features/agents/AgentsPanel.svelte').then((m) => (AgentsPanelComponent = m.default));
    }
  });

  let currentFolderPath = $state('');
  let isDashboardOpen = $state(false);
  let showDashboard = $derived(!currentFolderPath || isDashboardOpen);
  let rootEntries = $state<Entry[]>([]);
  let recentFolders = $state<string[]>([]);
  let statusText = $state('Ready');
  let statusKind = $state<'normal' | 'error' | 'warning'>('normal');
  let branchName = $state<string | null>(null);
  let isBench = $state(false);
  let cursorInfo = $state('Ln 1, Col 1');
  let isPreview = $state(
    typeof window !== 'undefined' &&
    (window.location.search.includes('preview') || !!(window as any).__PETAK_PREVIEW__)
  );
  let activeRailTab = $state(
    typeof window !== 'undefined' && (window.location.search.includes('git') || window.location.search.includes('tab=git'))
      ? 'git'
      : typeof window !== 'undefined' && (window.location.search.includes('devices') || window.location.search.includes('tab=devices'))
      ? 'devices'
      : 'project'
  );

  let editorComponent = $state<any>(null);
  let fileTreeComponent = $state<any>(null);
  let unlistenFs: UnlistenFn | null = null;
  let indexDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  let paletteOpen = $state(false);
  let paletteMode = $state<SearchMode>('files');
  let paletteInitialQuery = $state('');
  let PaletteComponent = $state<any>(null);
  let unregisterKeymap: (() => void) | null = null;

  let terminalOpen = $state(false);
  let TerminalPanelComponent = $state<any>(null);
  let terminalComponent = $state<any>(null);

  async function toggleTerminal() {
    if (!terminalOpen) {
      if (!TerminalPanelComponent) {
        const mod = await import('./features/terminal/TerminalPanel.svelte');
        TerminalPanelComponent = mod.default;
      }
      terminalOpen = true;
    } else {
      terminalOpen = false;
    }
  }

  async function openRun() {
    if (!TerminalPanelComponent) {
      const mod = await import('./features/terminal/TerminalPanel.svelte');
      TerminalPanelComponent = mod.default;
    }
    terminalOpen = true;
    setTimeout(() => {
      terminalComponent?.openRun?.();
    }, 20);

    // Auto-show device mirror on run to mobile target if setting enabled
    if (mirrorStore.autoShowOnRun) {
      const dev = runStore.selectedDevice;
      if (dev && (dev.platform === 'android' || dev.platform === 'ios')) {
        mirrorStore.open(dev.id);
      }
    }
  }

  async function openBuild() {
    if (!TerminalPanelComponent) {
      const mod = await import('./features/terminal/TerminalPanel.svelte');
      TerminalPanelComponent = mod.default;
    }
    terminalOpen = true;
    setTimeout(() => {
      terminalComponent?.openBuild?.();
    }, 20);
  }

  async function openLogcat() {
    if (!TerminalPanelComponent) {
      const mod = await import('./features/terminal/TerminalPanel.svelte');
      TerminalPanelComponent = mod.default;
    }
    terminalOpen = true;
    setTimeout(() => {
      terminalComponent?.openLogcat?.();
    }, 20);
  }

  async function openProblems() {
    if (!TerminalPanelComponent) {
      const mod = await import('./features/terminal/TerminalPanel.svelte');
      TerminalPanelComponent = mod.default;
    }
    terminalOpen = true;
    setTimeout(() => {
      terminalComponent?.openProblems?.();
    }, 20);
  }

  async function openUsages() {
    if (!TerminalPanelComponent) {
      const mod = await import('./features/terminal/TerminalPanel.svelte');
      TerminalPanelComponent = mod.default;
    }
    terminalOpen = true;
    setTimeout(() => {
      terminalComponent?.openUsages?.();
    }, 20);
  }

  async function openToolchains() {
    if (!TerminalPanelComponent) {
      const mod = await import('./features/terminal/TerminalPanel.svelte');
      TerminalPanelComponent = mod.default;
    }
    terminalOpen = true;
    setTimeout(() => {
      terminalComponent?.openToolchains?.();
    }, 20);
  }

  async function openGit() {
    if (terminalOpen && terminalComponent?.getActiveSection?.() === 'git') {
      terminalOpen = false;
      return;
    }
    if (!TerminalPanelComponent) {
      const mod = await import('./features/terminal/TerminalPanel.svelte');
      TerminalPanelComponent = mod.default;
    }
    terminalOpen = true;
    setTimeout(() => {
      terminalComponent?.openGit?.();
    }, 20);
  }

  $effect(() => {
    if (toolchainStore.settingsModalOpen) {
      toolchainStore.settingsModalOpen = false;
      openToolchains();
    }
  });

  async function handleTabSave(path: string, _content: string) {
    if (runStore.hotReloadOnSave && runStore.state === 'running' && runStore.runId !== null) {
      await runStore.reload(false);
    }
  }

  async function openPalette(mode: SearchMode, initialQuery: string = '') {
    if (!PaletteComponent) {
      const mod = await import('./features/search/Palette.svelte');
      PaletteComponent = mod.default;
    }
    paletteMode = mode;
    paletteInitialQuery = initialQuery;
    paletteOpen = true;
  }

  function closePalette() {
    paletteOpen = false;
    editorComponent?.focus();
  }

  async function handleOpenTerminal(cwd?: string) {
    if (!TerminalPanelComponent) {
      const mod = await import('./features/terminal/TerminalPanel.svelte');
      TerminalPanelComponent = mod.default;
    }
    terminalOpen = true;
    setTimeout(() => {
      terminalComponent?.createNewTab(undefined, cwd);
    }, 50);
  }

  function handleOpenSearch(mode: any, initialQuery: string = '', scope?: string) {
    openPalette(mode, initialQuery);
  }

  function handleOpenGitLog(path?: string) {
    activeRailTab = 'git';
    gitStore.activeSubTab = 'log';
    if (path) {
      gitStore.setLogFilter({ path });
    }
  }

  function handleOpenCommitPanel(path?: string) {
    activeRailTab = 'commit';
    if (path) {
      gitStore.selectFile(path, 'worktree');
    }
  }

  async function handleOpenFile(filePath: string, line?: number, col?: number) {
    try {
      const existing = tabsManager.tabs.find((t) => t.path === filePath);
      const filename = filePath.split('/').filter(Boolean).pop() || '';
      if (!existing) {
        const text = isImageFile(filePath) ? '' : await api.readFile(filePath);
        tabsManager.openTab(filePath, filename, text);
      } else {
        tabsManager.setActive(filePath);
      }
      statusText = `Opened ${filename}`;
      if (line !== undefined) {
        setTimeout(() => {
          editorComponent?.gotoLine(line, col || 1);
        }, 50);
      } else {
        editorComponent?.focus();
      }
    } catch (e) {
      console.error('Failed to open file:', filePath, e);
      statusText = `Failed to open ${filePath}`;
    }
  }

  let staticActions = (
    buildStaticActions({
      handlePickFolder,
      editorComponent,
      openPalette,
      toggleTerminal,
      openProblems,
    })
  );

  function triggerIndexRebuild(rootPath: string) {
    if (!rootPath) return;
    if (indexDebounceTimer) {
      clearTimeout(indexDebounceTimer);
    }
    indexDebounceTimer = setTimeout(() => {
      api.indexBuild(rootPath).catch((e) => console.warn('indexBuild rebuild error:', e));
    }, 500);
  }

  let activeFilename = $derived(tabsManager.activeTab?.name || '');
  let activeFilePath = $derived(tabsManager.activeTab?.path || '');

  let fileType = $derived(
    activeFilename.endsWith('.kt') || activeFilename.endsWith('.kts') ? 'Kotlin' :
    activeFilename.endsWith('.dart') ? 'Dart' :
    activeFilename.endsWith('.swift') ? 'Swift' :
    activeFilename.endsWith('.toml') ? 'TOML' :
    activeFilename.endsWith('.json') ? 'JSON' :
    activeFilename.endsWith('.rs') ? 'Rust' :
    activeFilename.endsWith('.svelte') ? 'Svelte' :
    activeFilename.endsWith('.ts') ? 'TypeScript' :
    activeFilename.endsWith('.md') ? 'Markdown' :
    activeFilename ? 'Plain Text' : 'Empty'
  );

  let isEditorReady = $state(false);
  let lastBgInitFolder: string | null = null;
  let watchedRoot: string | null = null;

  function initBackgroundServices(folderPath: string) {
    if (!folderPath || lastBgInitFolder === folderPath) return;
    lastBgInitFolder = folderPath;
    api.indexBuild(folderPath).catch((e) => console.warn('indexBuild error:', e));
    gitStore.refresh(folderPath).catch((e) => console.warn('gitStore refresh error:', e));
    runStore.init(folderPath).catch((e) => console.warn('runStore init error:', e));
  }

  async function openFolder(folderPath: string) {
    try {
      if (currentFolderPath && currentFolderPath !== folderPath) {
        const resetResult = await executeProjectSwitchReset({
          tabsManager,
          diagnosticsStore,
          runStore,
          gitStore,
          mirrorStore,
          onSaveDirtyTab: async (tab) => {
            return window.confirm(`File "${tab.name}" has unsaved changes. Discard changes and switch project?`);
          },
        });
        if (resetResult.cancelled) {
          return;
        }
      }

      const list = await api.listDir(folderPath);
      currentFolderPath = folderPath;
      rootEntries = list;
      recentFolders = await api.addRecentFolder(folderPath);
      api.recentProjectsAdd(folderPath).catch(() => {});
      api.lspRestart(folderPath).catch(() => {});
      api.suggestIndexBuild(folderPath).catch(() => {});
      if (watchedRoot !== folderPath) {
        await api.watchRoot(folderPath);
        watchedRoot = folderPath;
      }
      api.gitBranch(folderPath).then((b) => (branchName = b)).catch((e) => console.warn('gitBranch error:', e));
      if (isEditorReady) {
        initBackgroundServices(folderPath);
      }
      statusText = `Opened ${folderPath.split('/').filter(Boolean).pop()}`;
      statusKind = 'normal';
    } catch (e: any) {
      console.error('Failed to open folder:', folderPath, e);
      const errMsg = e?.message || (typeof e === 'string' ? e : '');
      const folderName = folderPath.split('/').filter(Boolean).pop() || folderPath;
      statusText = errMsg ? `Failed to open folder ${folderName}: ${errMsg}` : `Failed to open folder: ${folderName}`;
      statusKind = 'error';
      throw e;
    }
  }

  async function handlePickFolder() {
    try {
      const folder = await api.pickFolder();
      if (folder) {
        await openFolder(folder);
      }
    } catch (e) {
      console.error('Failed to pick folder:', e);
    }
  }

  async function handleSelectFile(entry: Entry) {
    try {
      const existing = tabsManager.tabs.find((t) => t.path === entry.path);
      if (existing) {
        tabsManager.setActive(entry.path);
        return;
      }
      const text = isImageFile(entry.path) ? '' : await api.readFile(entry.path);
      tabsManager.openTab(entry.path, entry.name, text);
      statusText = `Opened ${entry.name}`;
    } catch (e) {
      console.error('Failed to read file:', entry.path, e);
      statusText = `Failed to open ${entry.name}`;
    }
  }

  let externalChangeTimer: any = null;
  let batchedExternalPaths = new Set<string>();

  function queueExternalChange(paths: string[]) {
    for (const p of paths) batchedExternalPaths.add(p);
    if (externalChangeTimer) clearTimeout(externalChangeTimer);
    externalChangeTimer = setTimeout(() => {
      const allPaths = Array.from(batchedExternalPaths);
      batchedExternalPaths.clear();
      handleExternalChange(allPaths);
    }, 200);
  }

  async function handleExternalChange(paths: string[]) {
    // 1. Check open tabs
    for (const tab of tabsManager.tabs) {
      if (paths.includes(tab.path)) {
        try {
          const diskContent = await api.readFile(tab.path);
          // Ignore event from our own save (disk content matches what we saved)
          if (diskContent === tab.savedContent) {
            continue;
          }

          if (!tab.dirty) {
            // Reload silently
            tab.savedContent = diskContent;
            if (tab.path === tabsManager.activePath) {
              const view = editorComponent?.getEditorView();
              if (view) {
                const curSel = view.state.selection;
                const maxLen = diskContent.length;
                const newAnchor = Math.min(curSel.main.anchor, maxLen);
                const newHead = Math.min(curSel.main.head, maxLen);
                view.dispatch({
                  changes: { from: 0, to: view.state.doc.length, insert: diskContent },
                  selection: { anchor: newAnchor, head: newHead },
                });
                tab.state = view.state;
              }
            } else {
              tab.state = undefined;
            }
            statusText = `Reloaded ${tab.name} from disk`;
            await api.benchLog(`CHECK2_EXTERNAL_RELOAD_VERIFIED: ${tab.name}`);
          } else {
            // Dirty tab -> show conflict bar
            tab.externalConflict = true;
            tab.pendingDiskContent = diskContent;
            statusText = `File ${tab.name} modified on disk (conflict)`;
          }
        } catch (e) {
          console.error('Failed to handle external change for:', tab.path, e);
        }
      }
    }

    // 2. Refresh file tree expanded folders
    if (fileTreeComponent) {
      await fileTreeComponent.refreshExpandedFolders(paths);
    }

    // 3. Refresh root directory if affected
    if (
      currentFolderPath &&
      paths.some((p) => p === currentFolderPath || p.startsWith(currentFolderPath + '/'))
    ) {
      try {
        rootEntries = await api.listDir(currentFolderPath);
      } catch (_) {}
    }

    // 4. Debounced index rebuild
    if (currentFolderPath) {
      triggerIndexRebuild(currentFolderPath);
    }

    // 5. Debounced git store refresh
    gitStore.handleFsChanged(paths);
  }

  async function runBenchmark(view: EditorView) {
    await runBenchmarkExt(view, (s: string) => (statusText = s));
  }

  async function onEditorReady(view: EditorView) {
    console.log('[PETAK] Editor ready.');
    isEditorReady = true;
    try {
      await api.markReady(Date.now());
    } catch (e) {
      console.warn('api.markReady error:', e);
    }

    const initBackground = () => {
      const target = currentFolderPath || (recentFolders && recentFolders[0]);
      if (target) {
        initBackgroundServices(target);
      } else {
        runStore.init('/workspace').catch((e) => console.warn('runStore init error:', e));
      }
    };

    if (typeof (window as any).requestIdleCallback === 'function') {
      (window as any).requestIdleCallback(initBackground, { timeout: 1000 });
    } else {
      setTimeout(initBackground, 60);
    }

    try {
      const bench = await api.benchMode();
      isBench = bench;
      if (bench) {
        setTimeout(() => runBenchmark(view), 200);
      }
    } catch (e) {
      console.warn('api.benchMode error:', e);
    }
  }

  onMount(async () => {
    // 0. Initialize toolchain store for real LSP status & configs
    toolchainStore.init(currentFolderPath).catch(() => {});

    if (!currentFolderPath) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          api.markReady(Date.now()).catch(() => {});
        });
      });
    }

    // 1. Listen for filesystem events
    try {
      unlistenFs = await api.onFsChanged((payload) => {
        queueExternalChange(payload.paths);
      });
    } catch (e) {
      console.warn('Failed to listen to fs-changed:', e);
    }

    // 2. Load recent folders (never auto-open on launch; always show Xcode-style Starting Point first)
    setTimeout(async () => {
      try {
        const recents = await api.recentFolders();
        recentFolders = recents;
      } catch (e) {
        console.warn('Failed to load recent folders:', e);
      }
    }, 20);

    // 3. Register global keymap
    unregisterKeymap = registerKeymap({
      openPalette: (mode) => openPalette(mode),
      closePalette: () => closePalette(),
      isPaletteOpen: () => paletteOpen,
      showIntentions: () => {
        showIntentions();
        statusText = 'Alt-Enter / Quick Actions (Phase 2)';
      },
      toggleTerminal: () => toggleTerminal(),
      onTreeNew: () => {
        const el = document.querySelector('.file-tree') as HTMLElement;
        el?.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', metaKey: true }));
      },
      onTreeRename: () => {
        const el = document.querySelector('.file-tree') as HTMLElement;
        el?.dispatchEvent(new KeyboardEvent('keydown', { key: 'F6', shiftKey: true }));
      },
      onTreeDelete: () => {
        const el = document.querySelector('.file-tree') as HTMLElement;
        el?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', metaKey: true }));
      },
      onTreeCopyPath: () => {
        const el = document.querySelector('.file-tree') as HTMLElement;
        el?.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', shiftKey: true, metaKey: true }));
      },
      onTreeReveal: () => {
        const el = document.querySelector('.file-tree') as HTMLElement;
        el?.dispatchEvent(new KeyboardEvent('keydown', { key: 'F1', altKey: true }));
      },
    });

    // 4. Automated test if testMode is set
    try {
      const tm = await api.testMode();
      if (tm) {
        setTimeout(() => {
          runAutomatedTestMode(tm, {
            view: editorComponent?.getEditorView(),
            currentFolderPath,
            tabsManager,
            fileTreeComponent,
            editorComponent,
            terminalComponent,
            paletteOpen,
            paletteMode,
            statusText,
            openFolder,
            handleOpenFile,
            handleSelectFile,
            openPalette,
            closePalette,
            toggleTerminal,
            openProblems,
            setStatusText: (t: string) => (statusText = t),
            setActiveRailTab: (tab: any) => (activeRailTab = tab),
            terminalOpen,
          });
        }, 400);
      }
      if (tm === 'P3' || tm === 'p3') {
      } else if (tm) {
      }
    } catch (e) {
      console.warn('api.testMode error:', e);
    }

    // 5. Handle preview query params
    setTimeout(() => {
      handlePreviewQueryParams({
        openRun,
        openBuild,
        openLogcat,
        setActiveRailTab: (tab) => (activeRailTab = tab),
        setBranchName: (name) => (branchName = name),
      });
    }, 50);

    // Global keyboard shortcut for Mirror (Cmd-Shift-D / Ctrl-Shift-D) & Agents (Cmd-6)
    const handleKeydownMirror = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === ',') {
        e.preventDefault();
        settingsStore.open();
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'D' || e.key === 'd')) {
        e.preventDefault();
        mirrorStore.toggle();
      }
      if (e.key === 'Escape' && mirrorStore.isOpen && !paletteOpen && !settingsStore.isOpen) {
        mirrorStore.close();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === '4') {
        e.preventDefault();
        activeRailTab = 'tests';
      }
      if ((e.metaKey || e.ctrlKey) && e.key === '6') {
        e.preventDefault();
        toggleAgentsPanel();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === '9') {
        e.preventDefault();
        openGit();
      }
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K') && !e.shiftKey) {
        e.preventDefault();
        if (activeRailTab === 'commit') {
          activeRailTab = 'project';
        } else {
          activeRailTab = 'commit';
        }
      }
    };
    window.addEventListener('keydown', handleKeydownMirror);
    window.addEventListener('beforeunload', () => mirrorStore.stop());
  });

  onDestroy(() => {
    mirrorStore.stop();
    runStore.destroy();
    if (unregisterKeymap) {
      unregisterKeymap();
      unregisterKeymap = null;
    }
    if (indexDebounceTimer) {
      clearTimeout(indexDebounceTimer);
      indexDebounceTimer = null;
    }
    if (unlistenFs) {
      unlistenFs();
      unlistenFs = null;
    }
  });
</script>

<div class="app-layout">
  <GitCheckoutProgressOverlay />
  <TitleBar
    projectName={currentFolderPath ? currentFolderPath.split('/').filter(Boolean).pop() || 'Petak' : 'Petak'}
    branchName={gitStore.currentBranch || branchName}
    {showDashboard}
    onPickFolder={handlePickFolder}
    onSelectProject={openFolder}
    onOpenDashboard={() => (isDashboardOpen = !isDashboardOpen)}
    onOpenDevicesPanel={() => panelStore.openRightPanel('devices')}
    onStartRun={openRun}
  />

  <div class="main-body">
    <!-- Top Workspace Area (Horizontal: Rail + LeftToolWindow + Editor + RightDock + RightRail) -->
    <div class="top-workspace-area">
      {#if currentFolderPath}
        {#if !showDashboard}
          <Rail
            bind:activeTab={activeRailTab}
            onToggleAgents={toggleAgentsPanel}
            isAgentsOpen={isAgentPanelOpen}
            onOpenTerminal={handleOpenTerminal}
            onOpenRun={openRun}
            onOpenLogcat={openLogcat}
            onOpenProblems={openProblems}
            onToggleDevices={() => panelStore.toggleRightPanel('devices')}
            onToggleMirror={() => mirrorStore.toggle()}
            onSelectRailTab={(t) => (activeRailTab = t)}
            onToggleProjectTree={() => fileTreeComponent?.toggleCollapse()}
          />
        {/if}
      {/if}
      <div class="center-area">
        {#if showDashboard}
          <DashboardView
            onOpenFolder={handlePickFolder}
            onSelectProject={async (path) => {
              isDashboardOpen = false;
              await openFolder(path);
            }}
            onOpenSettings={() => settingsStore.open()}
          />
        {:else}
          <div class="workspace-area" class:hidden-view={activeRailTab !== 'project' && activeRailTab !== 'commit'}>
            {#if activeRailTab === 'project'}
              <FileTree
                bind:this={fileTreeComponent}
                {rootEntries}
                folderPath={currentFolderPath}
                {activeFilePath}
                {recentFolders}
                onPickFolder={handlePickFolder}
                onSelectFile={handleSelectFile}
                onOpenRecent={openFolder}
                onOpenTerminal={handleOpenTerminal}
                onOpenSearch={handleOpenSearch}
                onOpenGitLog={handleOpenGitLog}
                onOpenCommitPanel={handleOpenCommitPanel}
                onToggleAnnotate={() => editorComponent?.toggleAnnotate()}
              />
            {:else if activeRailTab === 'commit'}
              <CommitPanel
                folderPath={currentFolderPath}
              />
            {/if}
            <Editor
              bind:this={editorComponent}
              folderPath={currentFolderPath}
              onReady={onEditorReady}
              onCursorChange={(c) => (cursorInfo = c)}
              onStatusChange={(s) => (statusText = s)}
              onOpenUsages={openUsages}
              onTabSave={handleTabSave}
              onSelectInTree={(p) => fileTreeComponent?.selectOpenedFile(p)}
              onOpenTerminal={handleOpenTerminal}
              onOpenSearch={handleOpenSearch}
              onOpenGitLog={handleOpenGitLog}
              onOpenCommitPanel={handleOpenCommitPanel}
            />
          </div>

          {#if activeRailTab === 'git' && GitViewComponent}
            <GitViewComponent folderPath={currentFolderPath} />
          {/if}

          {#if activeRailTab === 'mr' && MrViewComponent}
            <MrViewComponent folderPath={currentFolderPath} />
          {/if}

          {#if activeRailTab === 'tests' && TestsPanelComponent}
            <TestsPanelComponent folderPath={currentFolderPath} />
          {/if}
        {/if}
      </div>

      <!-- Right Tool Window Dock (Mutual Exclusivity: Agent OR Memory OR Mirror OR Devices) -->
      {#if !showDashboard && panelStore.activeRightPanel}
        <RightDock
          {AgentsPanelComponent}
          {DeviceMirrorPanelComponent}
          {DevicesPanelComponent}
          onOpenLogcat={openLogcat}
        />
      {/if}

      <!-- Right Activity Rail (seperti di kiri tapi di kanan) -->
      {#if !showDashboard}
        <RightRail
          activeRight={panelStore.activeRightPanel}
          onToggleAgent={toggleAgentsPanel}
          onToggleMemory={toggleMemoryPanel}
          onToggleMirror={toggleMirrorPanel}
          onToggleDevices={toggleDevicesPanel}
        />
      {/if}
    </div>

    <!-- Bottom Dock (Melebar PENUH 100% dari ujung kiri ke kanan, di bawah container atas) -->
    {#if !showDashboard && terminalOpen && TerminalPanelComponent}
      <div class="bottom-dock-container">
        <TerminalPanelComponent
          bind:this={terminalComponent}
          folderPath={currentFolderPath}
          onClose={() => (terminalOpen = false)}
          onSelectProblem={(path, line, col) => handleOpenFile(path, line, col)}
        />
      </div>
    {/if}
  </div>

  {#if !showDashboard}
    <StatusBar
      {branchName}
      {statusText}
      {statusKind}
      {isBench}
      {fileType}
      {cursorInfo}
      onOpenProblems={openProblems}
      onOpenToolchains={openToolchains}
    />
  {/if}

  {#if isPreview}
    <div class="preview-badge">PREVIEW — BUKAN APP (DUMMY DATA)</div>
  {/if}

  {#if paletteOpen && PaletteComponent}
    <PaletteComponent
      mode={paletteMode}
      initialQuery={paletteInitialQuery}
      folderPath={currentFolderPath}
      recentFiles={tabsManager.recentFiles}
      actions={staticActions}
      onClose={closePalette}
      onOpenFile={handleOpenFile}
    />
  {/if}

  {#if settingsStore.isOpen}
    <SettingsModal
      root={currentFolderPath}
      onclose={() => settingsStore.close()}
    />
  {/if}

  {#if gitStore.isRebaseModalOpen}
    <RebaseBranchModal onClose={() => gitStore.closeRebaseModal()} />
  {/if}
</div>

<style>
  .app-layout {
    width: 100vw;
    height: 100vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: #16171a;
  }
  .main-body {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
    overflow: hidden;
  }
  .top-workspace-area {
    flex: 1;
    display: flex;
    flex-direction: row;
    min-height: 0;
    min-width: 0;
    overflow: hidden;
  }
  .center-area {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }
  .workspace-area {
    flex: 1;
    display: flex;
    min-height: 0;
    min-width: 0;
    overflow: hidden;
  }
  .bottom-dock-container {
    width: 100%;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    z-index: 10;
  }
  .hidden-view {
    display: none !important;
  }
  .agent-panel-slot {
    width: 390px;
    flex-shrink: 0;
    background: #141518;
    border-left: 1px solid #26282d;
    display: flex;
    flex-direction: column;
    position: relative;
    user-select: none;
    -webkit-user-select: none;
    overflow: hidden;
    z-index: 4;
  }
  .agent-toolbar-top {
    height: 40px;
    flex-shrink: 0;
    padding: 0 12px;
    background: #141518;
    border-bottom: 1px solid #26282d;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .agent-title {
    font-weight: 600;
    color: #e8b45a;
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
  }
  .agent-badge {
    font-size: 11px;
    color: #e8b45a;
    background: #2e2717;
    border: 1px solid #4a3d22;
    padding: 1px 6px;
    border-radius: 4px;
    font-weight: 500;
  }
  .agent-close-btn {
    width: 28px;
    height: 28px;
    border-radius: 6px;
    color: #8b8f98;
    background: transparent;
    border: none;
    cursor: pointer;
    display: grid;
    place-items: center;
    margin-left: auto;
    transition: background 0.1s, color 0.1s;
  }
  .agent-close-btn:hover {
    background: #23252b;
    color: #e6e7ea;
  }
  .agent-body-content {
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    font-size: 12px;
    color: #8b8f98;
  }
  .agent-status-text {
    color: #d8d9dc;
    line-height: 18px;
  }
  .preview-badge {
    position: fixed;
    bottom: 32px;
    left: 60px;
    background: rgba(232, 180, 90, 0.15);
    border: 1px solid #e8b45a;
    color: #e8b45a;
    font-size: 10px;
    font-weight: 600;
    padding: 2px 8px;
    border-radius: 4px;
    letter-spacing: 0.5px;
    pointer-events: none;
    z-index: 9999;
  }
</style>
