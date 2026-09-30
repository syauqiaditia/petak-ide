<script lang="ts">
  import { runStore } from '../features/run/runStore.svelte';
  import { mirrorStore } from '../features/mirror/mirrorStore.svelte';
  import { gitStore } from '../features/git/git.svelte';
  import { panelStore } from './panelStore.svelte';
  import { popupStore } from './popupStore.svelte';
  import { getRunVisualAttrs } from '../features/run/runStateMachine';
  import { api, type RecentProject } from '../lib/api';
  import RunConfigPicker from '../features/run/RunConfigPicker.svelte';
  import DevicePicker from '../features/run/DevicePicker.svelte';

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
    onPickFolder,
    onSelectProject,
    onOpenDevicesPanel,
    onStartRun,
  } = $props<{
    projectName?: string;
    branchName?: string | null;
    onPickFolder?: () => void;
    onSelectProject?: (path: string) => void;
    onOpenDevicesPanel?: () => void;
    onStartRun?: () => void;
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
  onclick={() => popupStore.closeAll()}
  onkeydown={(e) => {
    if (e.key === 'Escape') popupStore.handleEscape();
  }}
/>

<div class="titlebar" data-tauri-drag-region>
  <!-- macOS window control spacer -->
  <div class="traffic-lights-spacer" data-tauri-drag-region></div>

  <!-- Brand logo & name -->
  <div class="brand">
    <div class="brand-icon">
      <div class="grid-cell"></div>
      <div class="grid-cell dim"></div>
      <div class="grid-cell dim"></div>
      <div class="grid-cell"></div>
    </div>
    <span class="brand-text">Petak</span>
  </div>

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

  <!-- Run config & Device selector group -->
  <div class="run-config-group">
    <RunConfigPicker />
    <div class="group-divider"></div>
    <DevicePicker {onOpenDevicesPanel} />
  </div>

  <!-- Sync Gradle button -->
  <button
    class="action-btn"
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

  <!-- Run / Reload controls (B3 Run State Machine) -->
  {#if runAttrs.showHotReload}
    <!-- When running: show Hot Reload + Hot Restart -->
    <button
      class="action-btn reload-btn"
      aria-label="Hot Reload"
      title="Hot Reload (r)"
      disabled={runStore.isReloading}
      onclick={() => runStore.reload(false)}
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
      </svg>
    </button>

    <button
      class="action-btn restart-btn"
      aria-label="Hot Restart"
      title="Hot Restart (R)"
      disabled={runStore.isReloading}
      onclick={() => runStore.reload(true)}
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"></path>
      </svg>
    </button>
  {:else}
    <!-- When idle / starting / error: show Run button with state machine colors & spinner -->
    <button
      class="action-btn run-btn"
      class:starting={runStore.uiState === 'starting'}
      class:error={runStore.uiState === 'error'}
      class:idle={runStore.uiState === 'idle'}
      style:background={runAttrs.buttonBg}
      style:color={runAttrs.buttonColor}
      aria-label="Run"
      title={runTooltip}
      disabled={runAttrs.runDisabled}
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
          <path d="M7 5l12 7-12 7z"></path>
        </svg>
      {/if}
    </button>
  {/if}

  <!-- Debug / DevTools button -->
  <button
    class="action-btn debug-btn"
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

  <!-- Stop button -->
  <button
    class="action-btn stop-btn"
    aria-label="Stop"
    title={!runAttrs.stopDisabled ? `Stop (${runStore.selectedConfig?.name || 'app'})` : 'App tidak sedang berjalan'}
    disabled={runAttrs.stopDisabled}
    onclick={() => runStore.stopRun()}
  >
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <rect x="5" y="5" width="14" height="14" rx="2"></rect>
    </svg>
  </button>

  <div class="divider"></div>

  <!-- Device Mirror Toggle Button (B1) -->
  <button
    class="mirror-toggle-btn"
    class:active={panelStore.isRightOpen('mirror')}
    aria-label="Toggle Device Mirror"
    title={isDevicePaired ? 'Device belum terhubung (status: Paired)' : 'Toggle Device Mirror (⌘⇧D)'}
    disabled={isDevicePaired}
    onclick={() => mirrorStore.toggle()}
  >
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
      <rect x="5" y="2" width="14" height="20" rx="3"></rect>
      <path d="M10 18h4"></path>
    </svg>
    <span>Mirror</span>
  </button>

  <!-- Manage Devices & Emulators Button (Bug 6) -->
  <button
    class="devices-toggle-btn"
    class:active={panelStore.isRightOpen('devices')}
    aria-label="Manage Devices & Emulators"
    title="Manage Devices & Emulators"
    onclick={() => panelStore.toggleRightPanel('devices')}
  >
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
      <rect x="7" y="3" width="10" height="18" rx="2"></rect>
      <path d="M11 18h2"></path>
    </svg>
    <span>Devices</span>
  </button>

  <div class="spacer" data-tauri-drag-region></div>

  <!-- Search -->
  <button class="search-btn">
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
      <circle cx="11" cy="11" r="6"></circle>
      <path d="M20 20l-4.5-4.5"></path>
    </svg>
    <span>Search everywhere</span>
    <span class="search-shortcut">⇧⇧</span>
  </button>

  <!-- User Avatar -->
  <div class="avatar" title="User: UQi">U</div>
</div>

<style>
  .titlebar {
    height: 46px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 12px 0 12px;
    background: #111215;
    border-bottom: 1px solid #26282d;
    user-select: none;
    -webkit-user-select: none;
  }
  .traffic-lights-spacer {
    width: 68px;
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
  .mirror-toggle-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 30px;
    padding: 0 9px;
    border-radius: 7px;
    font-size: 11px;
    font-weight: 500;
    color: #8b8f98;
    background: transparent;
    border: 1px solid transparent;
    cursor: pointer;
    transition: all 0.15s;
  }
  .mirror-toggle-btn:hover {
    color: #d8d9dc;
    background: #1e2025;
  }
  .mirror-toggle-btn.active {
    background: #1f2a3d;
    border-color: #2a3d5e;
    color: #6ea8ff;
  }
  .devices-toggle-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 30px;
    padding: 0 9px;
    border-radius: 7px;
    font-size: 11px;
    font-weight: 500;
    color: #8b8f98;
    background: transparent;
    border: 1px solid transparent;
    cursor: pointer;
    transition: all 0.15s;
  }
  .devices-toggle-btn:hover {
    color: #d8d9dc;
    background: #1e2025;
  }
  .devices-toggle-btn.active {
    background: #1f2a3d;
    border-color: #2a3d5e;
    color: #6ea8ff;
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
