<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { listen, type UnlistenFn } from '@tauri-apps/api/event';
  import { runStore } from '../features/run/runStore.svelte';
  import { mirrorStore } from '../features/mirror/mirrorStore.svelte';
  import { gitStore } from '../features/git/git.svelte';
  import { panelStore } from './panelStore.svelte';
  import { popupStore } from './popupStore.svelte';
  import { settingsStore } from '../features/settings/settingsStore.svelte';
  import { getRunVisualAttrs } from '../features/run/runStateMachine';
  import { api, type RecentProject } from '../lib/api';
  import { isTitleBarInteractive } from './titleBarLogic';
  import RunConfigPicker from '../features/run/RunConfigPicker.svelte';
  import DevicePicker from '../features/run/DevicePicker.svelte';
  import RunConfigDialog from '../features/run/RunConfigDialog.svelte';

  let isRunConfigModalOpen = $state(false);
  let unlistenMenuAction: UnlistenFn | null = null;

  onMount(async () => {
    try {
      unlistenMenuAction = await listen<string | { action?: string; id?: string }>('menu-action', (event) => {
        const action = typeof event.payload === 'string'
          ? event.payload
          : event.payload?.action || event.payload?.id;

        if (!action) return;

        switch (action) {
          case 'open_folder':
          case 'open-folder':
            onPickFolder?.();
            break;
          case 'save_file':
          case 'save-file':
          case 'save':
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', metaKey: true, bubbles: true }));
            break;
          case 'hot_reload':
          case 'hot-reload':
            runStore.reload(false);
            break;
          case 'hot_restart':
          case 'hot-restart':
            runStore.reload(true);
            break;
          case 'stop_run':
          case 'stop-run':
          case 'stop':
            runStore.stopRun();
            break;
          case 'start_debugging':
          case 'start-debugging':
          case 'debug':
            handleDebugClick();
            break;
          case 'run':
          case 'run_no_debug':
          case 'run-no-debug':
            handleRunClick();
            break;
          case 'search_everywhere':
          case 'search-everywhere':
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift', bubbles: true }));
            window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Shift', bubbles: true }));
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift', bubbles: true }));
            window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Shift', bubbles: true }));
            break;
          case 'toggle_agents':
          case 'toggle-agents':
            panelStore.toggleRightPanel('agent');
            break;
          case 'toggle_mirror':
          case 'toggle-mirror':
            mirrorStore.toggle();
            break;
          case 'settings':
          case 'open_settings':
          case 'open-settings':
            settingsStore.open();
            break;
        }
      });
    } catch {
      // In web or test environment where Tauri event listener is not available
    }
  });

  onDestroy(() => {
    if (unlistenMenuAction) {
      unlistenMenuAction();
      unlistenMenuAction = null;
    }
  });

  let branchPopupOpen = $derived(popupStore.isOpen('branch'));
  let branchSearch = $state('');

  let projectPopupOpen = $derived(popupStore.isOpen('project'));
  let recentProjects = $state<RecentProject[]>([]);

  function toggleProjectPopup(e: MouseEvent) {
    e.stopPropagation();
    popupStore.toggle('project');
    if (popupStore.isOpen('project')) {
      loadRecentProjects();
    }
  }

  function toggleBranchPopup(e: MouseEvent) {
    e.stopPropagation();
    popupStore.toggle('branch');
  }

  $effect(() => {
    if (projectPopupOpen && recentProjects.length === 0) {
      loadRecentProjects();
    }
  });

  async function loadRecentProjects() {
    try {
      recentProjects = await api.recentProjectsList();
    } catch {
      recentProjects = [];
    }
  }

  async function handleRemoveRecent(e: MouseEvent, path: string) {
    e.stopPropagation();
    try {
      await api.recentProjectsRemove(path);
      recentProjects = recentProjects.filter((p) => p.path !== path);
    } catch {
      // ignore
    }
  }

  function handleSelectProject(p: RecentProject) {
    if (!p.exists) {
      const ok = window.confirm(`Folder "${p.path}" does not exist. Remove from recent projects?`);
      if (ok) {
        api.recentProjectsRemove(p.path);
        recentProjects = recentProjects.filter((x) => x.path !== p.path);
      }
      return;
    }
    popupStore.close('project');
    onSelectProject?.(p.path);
  }

  let allBranches = $derived([
    ...(gitStore.branches?.local ?? []),
    ...(gitStore.branches?.remote ?? []).map((r) => ({
      name: r.name,
      isCurrent: false,
      ahead: 0,
      behind: 0,
      upstream: null,
      sha: r.sha,
    })),
  ]);

  let filteredBranches = $derived(
    allBranches.filter((b) => b.name.toLowerCase().includes(branchSearch.toLowerCase()))
  );

  async function handleSelectBranch(bName: string) {
    popupStore.close('branch');
    await gitStore.branchCheckout(bName, true);
  }

  let {
    projectName = 'petak',
    branchName = '',
    showDashboard = false,
    onPickFolder,
    onSelectProject,
    onOpenDevicesPanel,
    onStartRun,
    onOpenDashboard,
  } = $props<{
    projectName?: string;
    branchName?: string | null;
    showDashboard?: boolean;
    onPickFolder?: () => void;
    onSelectProject?: (path: string) => void;
    onOpenDevicesPanel?: () => void;
    onStartRun?: () => void;
    onOpenDashboard?: () => void;
  }>();

  let isRunning = $derived(
    runStore.state === 'running' ||
    runStore.state === 'reloading' ||
    runStore.state === 'building' ||
    runStore.state === 'installing'
  );

  let hasConfig = $derived(runStore.selectedConfig !== null);
  let hasDevice = $derived(runStore.selectedDevice !== null);
  let isDeviceOnline = $derived(
    runStore.selectedDevice?.state === 'online' &&
    (runStore.selectedDevice?.connection === undefined || runStore.selectedDevice?.connection === 'connected')
  );
  let isDevicePaired = $derived(runStore.selectedDevice?.connection === 'paired');
  let isGradle = $derived(runStore.selectedConfig?.kind === 'gradle');

  let runAttrs = $derived(getRunVisualAttrs(runStore.uiState, isDeviceOnline, hasConfig));

  let runDisabled = $derived(runAttrs.runDisabled || isDevicePaired);
  let runTooltip = $derived(
    isDevicePaired
      ? 'Device belum terhubung (status: Paired). Hubungkan via kabel USB atau aktifkan koneksi jaringan.'
      : runStore.uiState === 'starting'
      ? 'Starting app…'
      : runStore.uiState === 'running'
      ? 'App running'
      : runStore.uiState === 'error'
      ? 'Run failed — click to retry'
      : !hasConfig
      ? 'Pilih run config terlebih dahulu'
      : !hasDevice || !isDeviceOnline
      ? 'Pilih device yang online terlebih dahulu (tidak ada device online)'
      : `Run ${runStore.selectedConfig?.name} on ${runStore.selectedDevice?.name}`
  );

  let syncDisabled = $derived(!isGradle || isRunning || runStore.isSyncing);
  let syncTooltip = $derived(
    !isGradle
      ? 'Sync hanya untuk Gradle project'
      : isRunning
      ? 'Tidak bisa sync saat app berjalan'
      : runStore.isSyncing
      ? 'Sedang sync Gradle...'
      : `Sync Gradle (${runStore.selectedConfig?.name})`
  );

  let debugTooltip = $derived(
    runStore.devtoolsUri
      ? 'Buka Flutter DevTools di browser'
      : 'Breakpoint debugger belum tersedia (runs with DevTools)'
  );

  async function handleRunClick() {
    if (runDisabled) return;
    onStartRun?.();
    await runStore.startRun();
  }

  async function handleDebugClick() {
    if (runStore.devtoolsUri) {
      await runStore.openDevTools();
    } else if (!isRunning && !runDisabled) {
      onStartRun?.();
      await runStore.startRun();
    }
  }
</script>

<svelte:window
  onclick={() => {
    popupStore.closeAll();
  }}
  onkeydown={(e) => {
    if (e.key === 'Escape') {
      popupStore.handleEscape();
    }
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'e' || e.key === 'E')) {
      e.preventDefault();
      isRunConfigModalOpen = !isRunConfigModalOpen;
    }
  }}
/>

<!-- Cockpit TitleBar (38px) -->
<div
  class="titlebar"
  id="ide-titlebar"
  data-tauri-drag-region
  ondblclick={(e) => {
    if (!isTitleBarInteractive(e.target as HTMLElement)) {
      api.windowToggleMaximize();
    }
  }}
  onmousedown={(e) => {
    if (e.button === 0 && !isTitleBarInteractive(e.target as HTMLElement)) {
      api.windowStartDragging();
    }
  }}
>
  <!-- macOS window control spacer -->
  <div class="traffic-lights-spacer" data-tauri-drag-region></div>

  <!-- Brand logo & name -->
  <div
    class="brand"
    onclick={() => onOpenDashboard?.()}
    role="button"
    tabindex="0"
    title="Dashboard (File > Dashboard)"
    onkeydown={(e) => { if (e.key === 'Enter') onOpenDashboard?.(); }}
  >
    <div class="brand-icon">
      <div class="grid-cell"></div>
      <div class="grid-cell dim"></div>
      <div class="grid-cell dim"></div>
      <div class="grid-cell"></div>
    </div>
    <span class="brand-text">Petak</span>
    <span class="brand-version-badge">v0.8.0</span>
  </div>

  {#if showDashboard}
    <div class="spacer" data-tauri-drag-region></div>
    {#if projectName && projectName !== 'petak' && projectName !== 'Petak'}
      <button class="back-to-editor-btn" onclick={() => onOpenDashboard?.()} title="Kembali ke Workspace">
        <span>← Kembali ke Editor ({projectName})</span>
      </button>
    {/if}
    <div class="avatar" title="User: UQi">U</div>
  {:else}
  <div class="divider"></div>

  <!-- Project selector with Recent Projects dropdown (B4 + F1) -->
  <div class="project-wrap">
    <button
      class="project-btn"
      onclick={(e) => {
        toggleProjectPopup(e);
      }}
      title="Click to view recent projects or open folder"
    >
      <span>{projectName}</span>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8b8f98" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M6 9l6 6 6-6"></path>
      </svg>
    </button>

    {#if projectPopupOpen}
      <div
        class="project-popup-menu"
        role="menu"
        tabindex="-1"
        onclick={(e) => e.stopPropagation()}
        onkeydown={(e) => e.stopPropagation()}
      >
        <div class="project-popup-header">RECENT PROJECTS</div>
        <div class="project-popup-list">
          {#if recentProjects.length === 0}
            <div class="project-popup-empty">No recent projects</div>
          {:else}
            {#each recentProjects as p}
              <div
                class="project-popup-item"
                class:missing={!p.exists}
                onclick={() => handleSelectProject(p)}
                role="button"
                tabindex="0"
                onkeydown={(e) => { if (e.key === 'Enter') handleSelectProject(p); }}
              >
                <div class="project-item-info">
                  <span class="project-item-name">{p.name}</span>
                  <span class="project-item-path" title={p.path}>{p.path}</span>
                </div>
                {#if !p.exists}
                  <span class="missing-tag">Missing</span>
                {/if}
                <button
                  class="project-item-del-btn"
                  title="Remove from recents"
                  onclick={(e) => handleRemoveRecent(e, p.path)}
                >
                  ✕
                </button>
              </div>
            {/each}
          {/if}
        </div>
        <div class="project-popup-footer">
          <button
            class="project-open-folder-btn"
            onclick={() => {
              popupStore.close('project');
              onPickFolder?.();
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
              <path d="M3 5h7l2 2h9v12H3z"></path>
            </svg>
            Open Folder…
          </button>
        </div>
      </div>
    {/if}
  </div>

  <!-- Branch switcher with popup -->
  {#if branchName}
    <div class="branch-wrap">
      <button
        class="branch-btn"
        onclick={toggleBranchPopup}
        title="Git Branch: {branchName} (Click to switch branch)"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="6" cy="5" r="2"></circle>
          <circle cx="6" cy="19" r="2"></circle>
          <circle cx="18" cy="7" r="2"></circle>
          <path d="M6 7v10M18 9c0 5-6 4-12 8"></path>
        </svg>
        <span class="branch-label">{branchName}</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#8b8f98" stroke-width="2">
          <path d="M6 9l6 6 6-6"></path>
        </svg>
      </button>

      {#if branchPopupOpen}
        <div
          class="branch-popup-menu"
          role="menu"
          tabindex="-1"
          onclick={(e) => e.stopPropagation()}
          onkeydown={(e) => e.stopPropagation()}
        >
          <div class="branch-popup-search">
            <input
              type="text"
              class="branch-popup-input"
              placeholder="Search branch…"
              bind:value={branchSearch}
            />
          </div>
          <div class="branch-popup-list">
            {#if filteredBranches.length === 0}
              <div class="branch-popup-empty">No branches found</div>
            {:else}
              {#each filteredBranches as b}
                {@const isCurrent = b.name === branchName || b.isCurrent}
                <button
                  class="branch-popup-item"
                  class:current={isCurrent}
                  onclick={() => handleSelectBranch(b.name)}
                >
                  <span class="branch-item-name" class:bold={isCurrent}>{b.name}</span>
                  {#if isCurrent}
                    <span class="branch-current-tag">HEAD</span>
                  {/if}
                </button>
              {/each}
            {/if}
          </div>
        </div>
      {/if}
    </div>
  {/if}

  <div class="spacer" data-tauri-drag-region></div>

  <!-- Unified Cockpit Controls (Center) -->
  <div class="cockpit-center run-config-group">
    <RunConfigPicker onOpenEditConfigs={() => (isRunConfigModalOpen = true)} />
    <button
      class="config-gear-btn cockpit-btn"
      onclick={() => (isRunConfigModalOpen = true)}
      title="Edit Run Configurations… (⌘⇧E)"
      aria-label="Edit Run Configurations"
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="3"></circle>
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
      </svg>
    </button>
    <div class="cockpit-sep group-divider"></div>
    <DevicePicker {onOpenDevicesPanel} />
    <div class="cockpit-sep group-divider"></div>

    <!-- Sync Gradle button -->
    {#if isGradle}
      <button
        class="action-btn cockpit-btn"
        class:spinning={runStore.isSyncing}
        aria-label="Sync Gradle"
        title={syncTooltip}
        disabled={syncDisabled}
        onclick={() => runStore.syncGradle()}
      >
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5"></path>
        </svg>
      </button>
    {/if}

    <!-- Run button -->
    <button
      class="action-btn run-btn cockpit-btn run"
      class:starting={runStore.uiState === 'starting'}
      class:error={runStore.uiState === 'error'}
      class:idle={runStore.uiState === 'idle'}
      style:background={runAttrs.buttonBg}
      style:color={runAttrs.buttonColor}
      aria-label="Run"
      title={runTooltip}
      disabled={runDisabled}
      onclick={handleRunClick}
    >
      {#if runAttrs.icon === 'spinner'}
        <svg class="spinning-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <circle cx="12" cy="12" r="10" stroke-opacity="0.25"></circle>
          <path d="M12 2a10 10 0 0 1 10 10" stroke-linecap="round"></path>
        </svg>
      {:else if runAttrs.icon === 'retry'}
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"></path>
        </svg>
      {:else}
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <polygon points="5 3 19 12 5 21 5 3"></polygon>
        </svg>
      {/if}
    </button>

    <!-- Debug / DevTools button -->
    <button
      class="action-btn debug-btn cockpit-btn debug"
      class:has-devtools={!!runStore.devtoolsUri}
      aria-label="Debug"
      title={debugTooltip}
      disabled={runAttrs.debugDisabled}
      onclick={handleDebugClick}
    >
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <rect x="8" y="7" width="8" height="12" rx="4"></rect>
        <path d="M12 7V4M4 13h4M16 13h4M5 8l3 2M19 8l-3 2M5 18l3-2M19 18l-3-2"></path>
      </svg>
    </button>

    <!-- Hot Reload ⚡ -->
    <button
      class="action-btn reload-btn cockpit-btn reload"
      aria-label="Hot Reload"
      title="Hot Reload (r)"
      disabled={!isRunning || runStore.isReloading}
      onclick={() => runStore.reload(false)}
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
      </svg>
    </button>

    <!-- Hot Restart ⟳ -->
    <button
      class="action-btn restart-btn cockpit-btn restart"
      aria-label="Hot Restart"
      title="Hot Restart (R)"
      disabled={!isRunning || runStore.isReloading}
      onclick={() => runStore.reload(true)}
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="23 4 23 10 17 10"></polyline>
        <polyline points="1 20 1 14 7 14"></polyline>
        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
      </svg>
    </button>

    <!-- Stop button -->
    <button
      class="action-btn stop-btn cockpit-btn stop"
      aria-label="Stop"
      title={!runAttrs.stopDisabled ? `Stop (${runStore.selectedConfig?.name || 'app'})` : 'App tidak sedang berjalan'}
      disabled={runAttrs.stopDisabled}
      onclick={() => runStore.stopRun()}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
        <rect x="5" y="5" width="14" height="14" rx="2"></rect>
      </svg>
    </button>
  </div>

  <div class="spacer" data-tauri-drag-region></div>

  <!-- Right Cockpit Controls -->
  <div class="cockpit-right">
    <!-- Search Everywhere (⇧⇧) -->
    <button
      class="search-btn search-everywhere-btn"
      title="Search everywhere (Shift Shift)"
      onclick={() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift', bubbles: true }));
        window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Shift', bubbles: true }));
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift', bubbles: true }));
        window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Shift', bubbles: true }));
      }}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
        <circle cx="11" cy="11" r="6"></circle>
        <path d="M20 20l-4.5-4.5"></path>
      </svg>
      <span>Search everywhere</span>
      <span class="search-shortcut">⇧⇧</span>
    </button>

    <!-- Toggle Settings (⌘,) -->
    <button
      class="titlebar-action-btn settings-toggle-btn"
      class:active={settingsStore.isOpen}
      aria-label="Settings"
      title="Settings (⌘,)"
      onclick={() => settingsStore.open()}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
        <circle cx="12" cy="12" r="3"></circle>
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
      </svg>
      <span>Settings</span>
      <span class="action-shortcut">⌘,</span>
    </button>

    <!-- User Avatar -->
    <div class="avatar" title="User: UQi">U</div>
  </div>
  {/if}
</div>

<RunConfigDialog
  open={isRunConfigModalOpen}
  root={runStore.root}
  onClose={() => (isRunConfigModalOpen = false)}
/>

<style>
  .cockpit-sep {
    width: 1px;
    height: 16px;
    background: var(--border-subtle, rgba(255, 255, 255, 0.08));
    margin: 0 2px;
  }
  .cockpit-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 6px;
  }
  .cockpit-center {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .titlebar {
    height: 38px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 12px 0 12px;
    background: var(--p-bg-surface, #121317);
    border-bottom: 1px solid var(--border-default, #1e2027);
    user-select: none;
    -webkit-user-select: none;
  }
  .traffic-lights-spacer {
    width: 80px;
    height: 100%;
    flex-shrink: 0;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .brand-icon {
    width: 20px;
    height: 20px;
    border-radius: 5px;
    background: #6ea8ff;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 2px;
    padding: 4px;
    box-sizing: border-box;
  }
  .grid-cell {
    background: #111215;
    border-radius: 1px;
  }
  .grid-cell.dim {
    opacity: 0.4;
  }
  .brand-text {
    font-weight: 600;
    letter-spacing: 0.2px;
    color: #e6e7ea;
  }
  .brand-version-badge {
    font-size: 11px;
    color: #8b8f98;
    background: #1a1b1f;
    padding: 1px 7px;
    border-radius: 10px;
    font-weight: 500;
  }
  .back-to-editor-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 28px;
    padding: 0 12px;
    border-radius: 6px;
    background: #1c1d22;
    border: 1px solid #26282d;
    color: #6ea8ff;
    font-size: 12px;
    cursor: pointer;
    transition: all 0.15s;
  }
  .back-to-editor-btn:hover {
    background: #23252b;
    border-color: #3574f0;
    color: #8bb8ff;
  }
  .config-gear-btn {
    width: 28px;
    height: 28px;
    border-radius: 4px;
    display: grid;
    place-items: center;
    background: transparent;
    border: none;
    color: #8b8f98;
    cursor: pointer;
    transition: all 0.12s;
  }
  .config-gear-btn:hover {
    background: #23252b;
    color: #ffffff;
  }
  .divider {
    width: 1px;
    height: 18px;
    background: #2c2e34;
  }
  .project-wrap {
    position: relative;
    display: inline-block;
  }
  .project-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 30px;
    padding: 0 10px;
    border-radius: 7px;
    font-weight: 500;
    color: #d8d9dc;
    transition: background 0.15s;
    background: transparent;
    border: none;
    cursor: pointer;
    max-width: 160px;
  }
  .project-btn span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    display: inline-block;
    max-width: 130px;
  }
  .project-btn:hover {
    background: #1e2025;
  }
  .project-popup-menu {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    width: 320px;
    background: #1e2025;
    border: 1px solid #34363d;
    border-radius: 8px;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.55);
    z-index: 1000;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
  .project-popup-header {
    padding: 8px 12px;
    font-size: 10.5px;
    font-weight: 600;
    color: #8b8f98;
    background: #18191e;
    border-bottom: 1px solid #282a31;
    letter-spacing: 0.6px;
  }
  .project-popup-list {
    max-height: 280px;
    overflow-y: auto;
    padding: 4px 0;
  }
  .project-popup-empty {
    padding: 12px 14px;
    font-size: 12px;
    color: #656972;
    text-align: center;
  }
  .project-popup-item {
    display: flex;
    align-items: center;
    padding: 6px 12px;
    cursor: pointer;
    transition: background 0.1s;
    gap: 8px;
  }
  .project-popup-item:hover {
    background: #252830;
  }
  .project-popup-item.missing {
    opacity: 0.6;
  }
  .project-item-info {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .project-item-name {
    font-size: 12.5px;
    font-weight: 500;
    color: #e6e7ea;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .project-item-path {
    font-size: 10.5px;
    color: #8b8f98;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .missing-tag {
    font-size: 9.5px;
    padding: 1px 5px;
    border-radius: 3px;
    background: #422525;
    color: #f07a74;
    flex-shrink: 0;
  }
  .project-item-del-btn {
    width: 20px;
    height: 20px;
    display: grid;
    place-items: center;
    border-radius: 4px;
    border: none;
    background: transparent;
    color: #6e727a;
    cursor: pointer;
    font-size: 11px;
    opacity: 0;
    transition: opacity 0.15s, background 0.15s, color 0.15s;
    flex-shrink: 0;
  }
  .project-popup-item:hover .project-item-del-btn {
    opacity: 1;
  }
  .project-item-del-btn:hover {
    background: #362224;
    color: #f07a74;
  }
  .project-popup-footer {
    border-top: 1px solid #282a31;
    padding: 6px;
    background: #17181c;
  }
  .project-open-folder-btn {
    width: 100%;
    height: 28px;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 10px;
    border-radius: 5px;
    border: none;
    background: transparent;
    color: #6ea8ff;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s;
  }
  .project-open-folder-btn:hover {
    background: #202735;
  }
  .spinning-icon {
    animation: spin 1s linear infinite;
  }
  .branch-wrap {
    position: relative;
    display: inline-block;
  }
  .branch-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 30px;
    padding: 0 10px;
    border-radius: 7px;
    color: #b9bcc3;
    transition: background 0.15s;
    background: transparent;
    border: none;
    cursor: pointer;
  }
  .branch-btn:hover {
    background: #1e2025;
    color: #e6e7ea;
  }
  .branch-label {
    max-width: 160px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .branch-popup-menu {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    width: 280px;
    background: #1e2025;
    border: 1px solid #34363d;
    border-radius: 8px;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
    z-index: 1000;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
  .branch-popup-search {
    padding: 8px 10px;
    border-bottom: 1px solid #282a31;
    background: #18191e;
  }
  .branch-popup-input {
    width: 100%;
    height: 26px;
    background: #121316;
    border: 1px solid #2e3037;
    border-radius: 5px;
    padding: 0 8px;
    color: #e6e7ea;
    font-size: 12px;
    outline: none;
    box-sizing: border-box;
  }
  .branch-popup-input:focus {
    border-color: #569aff;
  }
  .branch-popup-list {
    max-height: 280px;
    overflow-y: auto;
    padding: 4px 0;
  }
  .branch-popup-empty {
    padding: 12px;
    text-align: center;
    font-size: 12px;
    color: #8b8f98;
  }
  .branch-popup-item {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 12px;
    background: transparent;
    border: none;
    cursor: pointer;
    text-align: left;
    transition: background 0.12s;
  }
  .branch-popup-item:hover {
    background: #252830;
  }
  .branch-popup-item.current {
    background: #23344a;
  }
  .branch-item-name {
    font-size: 12.5px;
    color: #d8d9dc;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .branch-item-name.bold {
    font-weight: 600;
    color: #ffffff;
  }
  .branch-current-tag {
    font-size: 9.5px;
    font-weight: 600;
    padding: 1px 4px;
    border-radius: 3px;
    background: #2d4c72;
    color: #9eccff;
  }
  .spacer {
    flex-grow: 1;
    height: 100%;
  }
  .run-config-group {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 2px 4px;
    border: 1px solid #2c2e34;
    border-radius: 8px;
    background: #17181c;
  }
  .group-divider {
    width: 1px;
    height: 18px;
    background: #2c2e34;
  }
  .action-btn {
    width: 32px;
    height: 32px;
    border-radius: 8px;
    display: grid;
    place-items: center;
    color: #b9bcc3;
    background: transparent;
    border: none;
    cursor: pointer;
    transition: background 0.15s;
  }
  .action-btn:hover {
    background: #23252b;
  }
  .action-btn:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }
  .action-btn:disabled:hover {
    background: transparent;
  }
  .run-btn {
    background: #1f3325;
    color: #7fc98f;
  }
  .run-btn:hover {
    background: #284431;
  }
  .run-btn:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }
  .run-btn:disabled:hover {
    background: #1f3325;
  }
  .reload-btn {
    background: #1f3325;
    color: #7fc98f;
  }
  .reload-btn:hover {
    background: #284431;
  }
  .restart-btn {
    background: #1a2936;
    color: #6ea8ff;
  }
  .restart-btn:hover {
    background: #22374c;
  }
  .debug-btn.has-devtools {
    color: #6ea8ff;
    background: #192334;
  }
  .stop-btn {
    color: #f07a74;
  }
  .stop-btn:hover {
    background: #2a1d1e;
  }
  .stop-btn:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }
  .stop-btn:disabled:hover {
    background: transparent;
  }
  .cockpit-right {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .titlebar-action-btn {
    display: flex;
    align-items: center;
    gap: 5px;
    height: 30px;
    padding: 0 9px;
    border-radius: 7px;
    font-size: 11.5px;
    font-weight: 500;
    color: #8b8f98;
    background: transparent;
    border: 1px solid transparent;
    cursor: pointer;
    transition: all 0.12s ease;
  }
  @media (max-width: 1200px) {
    .titlebar-action-btn span {
      display: none;
    }
    .titlebar-action-btn {
      padding: 0 7px;
    }
    .search-btn span:first-of-type {
      display: none;
    }
    .search-btn {
      width: auto;
      min-width: 60px;
      padding: 0 8px;
    }
  }
  .titlebar-action-btn:hover {
    color: #d8d9dc;
    background: #1e2025;
  }
  .titlebar-action-btn.active {
    background: #1f2a3d;
    border-color: #2a3d5e;
    color: #6ea8ff;
  }
  .titlebar-action-btn:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }
  .action-shortcut {
    font-size: 10px;
    font-family: 'JetBrains Mono', monospace;
    opacity: 0.65;
  }
  .spinning svg {
    animation: spin 1s linear infinite;
  }
  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
  .search-btn {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 30px;
    padding: 0 12px;
    border-radius: 7px;
    border: 1px solid #2c2e34;
    color: #8b8f98;
    width: 190px;
    background: #16171a;
    cursor: pointer;
  }
  .search-shortcut {
    margin-left: auto;
    font-size: 11px;
    color: #666a73;
  }
  .avatar {
    width: 28px;
    height: 28px;
    border-radius: 14px;
    background: #2a3a55;
    color: #9cc3ff;
    display: grid;
    place-items: center;
    font-size: 11px;
    font-weight: 600;
  }
</style>
