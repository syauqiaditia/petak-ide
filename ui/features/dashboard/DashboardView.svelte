<script lang="ts">
  import { onMount } from 'svelte';
  import { api, type RecentProject, type Device } from '../../lib/api';
  import { toolchainStore } from '../toolchain/toolchainStore.svelte';
  import { runStore } from '../run/runStore.svelte';
  import { settingsStore } from '../settings/settingsStore.svelte';

  let {
    onOpenFolder = () => {},
    onSelectProject = () => {},
    onOpenSettings = () => settingsStore.open(),
  }: {
    onOpenFolder?: () => void;
    onSelectProject?: (path: string) => void;
    onOpenSettings?: () => void;
  } = $props();

  let recentList = $state<RecentProject[]>([]);
  let searchQuery = $state('');
  let pinnedPaths = $state<Set<string>>(new Set());

  onMount(async () => {
    try {
      recentList = await api.recentProjectsList();
    } catch {
      recentList = [];
    }

    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem('petak.dashboard.pinned');
      if (saved) {
        try {
          pinnedPaths = new Set(JSON.parse(saved));
        } catch {}
      }
    }
  });

  function togglePin(e: MouseEvent, path: string) {
    e.stopPropagation();
    const next = new Set(pinnedPaths);
    if (next.has(path)) {
      next.delete(path);
    } else {
      next.add(path);
    }
    pinnedPaths = next;
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('petak.dashboard.pinned', JSON.stringify(Array.from(next)));
    }
  }

  async function handleRemoveProject(e: MouseEvent, path: string) {
    e.stopPropagation();
    try {
      await api.recentProjectsRemove(path);
      recentList = recentList.filter((p) => p.path !== path);
    } catch {}
  }

  function formatRelativeTime(ts: number): string {
    const now = Math.floor(Date.now() / 1000);
    const diff = Math.max(0, now - ts);
    if (diff < 60) return 'Just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    const days = Math.floor(diff / 86400);
    if (days < 30) return `${days}d ago`;
    return new Date(ts * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  function getProjectIcon(name: string, path: string): string {
    const lower = (name + path).toLowerCase();
    if (lower.includes('flutter') || lower.includes('jatim') || lower.includes('app')) return '💙';
    if (lower.includes('android')) return '🤖';
    if (lower.includes('ios')) return '🍎';
    return '📦';
  }

  let filteredProjects = $derived.by(() => {
    let list = recentList;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter((p) => p.name.toLowerCase().includes(q) || p.path.toLowerCase().includes(q));
    }
    // Sort pinned to top
    return [...list].sort((a, b) => {
      const aPinned = pinnedPaths.has(a.path);
      const bPinned = pinnedPaths.has(b.path);
      if (aPinned && !bPinned) return -1;
      if (!aPinned && bPinned) return 1;
      return b.lastOpened - a.lastOpened;
    });
  });

  let toolchainSummary = $derived.by(() => {
    const tc = toolchainStore.toolchain;
    const flutterOk = !!tc?.flutter;
    const dartOk = !!tc?.dart;
    const androidOk = !!tc?.adb;
    const javaOk = !!tc?.java;
    const kotlinOk = !!tc?.kotlinLs;
    return {
      flutterOk,
      dartOk,
      androidOk,
      javaOk,
      kotlinOk,
      allGood: flutterOk && dartOk && androidOk && javaOk,
    };
  });
</script>

<div class="dashboard-container">
  <!-- Main Centered Content (Max-width 920px) -->
  <div class="dashboard-card-wrap">
    <!-- Header -->
    <div class="dashboard-header">
      <div class="logo-row">
        <div class="petak-logo">
          <div class="cell"></div>
          <div class="cell dim"></div>
          <div class="cell dim"></div>
          <div class="cell"></div>
        </div>
        <div class="header-titles">
          <h1 class="welcome-title">Welcome to Petak</h1>
          <p class="welcome-sub">Fast, lightweight native Flutter & mobile engineering IDE</p>
        </div>
      </div>
    </div>

    <!-- Quick Action Row -->
    <div class="action-tiles">
      <button class="tile primary" onclick={onOpenFolder}>
        <div class="tile-icon">📂</div>
        <div class="tile-text">
          <span class="tile-title">Open Folder</span>
          <span class="tile-desc">Open an existing Flutter or Android repository</span>
        </div>
      </button>

      <button class="tile" onclick={() => alert('Clone repository: Please run git clone or open local clone directory.')}>
        <div class="tile-icon">📥</div>
        <div class="tile-text">
          <span class="tile-title">Clone Repository</span>
          <span class="tile-desc">Clone from GitLab / GitHub via URL or SSH</span>
        </div>
      </button>

      <button class="tile" onclick={() => alert('New Flutter project: Run `flutter create <app>` in terminal or choose Open Folder.')}>
        <div class="tile-icon">⚡</div>
        <div class="tile-text">
          <span class="tile-title">New Project</span>
          <span class="tile-desc">Create a fresh Flutter or multi-platform app</span>
        </div>
      </button>
    </div>

    <!-- Main Content Columns: Recents on Left, Status on Right -->
    <div class="dashboard-grid">
      <!-- Left Column: Recent Projects -->
      <div class="recents-section">
        <div class="section-bar">
          <span class="section-title">RECENT PROJECTS</span>
          <div class="search-wrap">
            <input
              type="text"
              class="project-search-input"
              placeholder="Filter recent projects…"
              bind:value={searchQuery}
            />
          </div>
        </div>

        <div class="projects-list">
          {#if filteredProjects.length === 0}
            <div class="empty-projects">
              {#if searchQuery}
                <span>No projects match "{searchQuery}"</span>
              {:else}
                <span>No recent workspaces found. Click Open Folder to begin!</span>
              {/if}
            </div>
          {:else}
            {#each filteredProjects as proj (proj.path)}
              {@const isPinned = pinnedPaths.has(proj.path)}
              {@const icon = getProjectIcon(proj.name, proj.path)}
              <div
                class="project-card"
                class:missing={!proj.exists}
                onclick={() => onSelectProject(proj.path)}
                role="button"
                tabindex="0"
                onkeydown={(e) => { if (e.key === 'Enter') onSelectProject(proj.path); }}
              >
                <div class="card-icon">{icon}</div>
                <div class="card-body">
                  <div class="card-top-row">
                    <span class="project-name">{proj.name}</span>
                    {#if isPinned}
                      <span class="pinned-tag">📌</span>
                    {/if}
                    {#if !proj.exists}
                      <span class="missing-tag">not found</span>
                    {/if}
                  </div>
                  <div class="project-path" title={proj.path}>{proj.path}</div>
                  <div class="card-meta-row">
                    {#if proj.lastBranch}
                      <span class="branch-pill">🌿 {proj.lastBranch}</span>
                    {/if}
                    <span class="time-pill">{formatRelativeTime(proj.lastOpened)}</span>
                  </div>
                </div>

                <div class="card-actions" onclick={(e) => e.stopPropagation()}>
                  <button
                    class="action-icon-btn pin"
                    class:pinned={isPinned}
                    onclick={(e) => togglePin(e, proj.path)}
                    title={isPinned ? 'Unpin project' : 'Pin to top'}
                  >
                    📌
                  </button>
                  <button
                    class="action-icon-btn del"
                    onclick={(e) => handleRemoveProject(e, proj.path)}
                    title="Remove from recents"
                  >
                    ✕
                  </button>
                </div>
              </div>
            {/each}
          {/if}
        </div>
      </div>

      <!-- Right Column: Status & Devices -->
      <div class="side-section">
        <!-- Toolchain Status Card -->
        <div class="info-card">
          <div class="card-header-row">
            <span class="card-header-title">TOOLCHAINS & SDKs</span>
            <button class="mini-settings-btn" onclick={onOpenSettings}>Configure</button>
          </div>
          <div class="status-items">
            <div class="status-item">
              <span class="status-dot" class:ok={toolchainSummary.flutterOk}></span>
              <span class="status-lbl">Flutter SDK:</span>
              <span class="status-val">{toolchainSummary.flutterOk ? 'Available' : 'Missing'}</span>
            </div>
            <div class="status-item">
              <span class="status-dot" class:ok={toolchainSummary.dartOk}></span>
              <span class="status-lbl">Dart Engine:</span>
              <span class="status-val">{toolchainSummary.dartOk ? 'Ready' : 'Not configured'}</span>
            </div>
            <div class="status-item">
              <span class="status-dot" class:ok={toolchainSummary.androidOk}></span>
              <span class="status-lbl">Android ADB:</span>
              <span class="status-val">{toolchainSummary.androidOk ? 'Connected' : 'Missing'}</span>
            </div>
            <div class="status-item">
              <span class="status-dot" class:ok={toolchainSummary.javaOk}></span>
              <span class="status-lbl">Java JDK:</span>
              <span class="status-val">{toolchainSummary.javaOk ? 'Detected' : 'Missing'}</span>
            </div>
            <div class="status-item">
              <span class="status-dot" class:ok={toolchainSummary.kotlinOk}></span>
              <span class="status-lbl">Kotlin LS:</span>
              <span class="status-val">{toolchainSummary.kotlinOk ? 'Configured' : 'Optional (Install in Settings)'}</span>
            </div>
          </div>
        </div>

        <!-- Connected Devices Card -->
        <div class="info-card">
          <div class="card-header-row">
            <span class="card-header-title">DEVICES & TARGETS</span>
            <span class="device-count">{runStore.devices.length}</span>
          </div>
          <div class="devices-mini-list">
            {#if runStore.devices.length === 0}
              <div class="mini-empty">No device connected. Start an AVD or plug in a phone.</div>
            {:else}
              {#each runStore.devices as d}
                <div class="mini-device-row">
                  <span class="device-icon">{d.platform === 'android' ? '🤖' : d.platform === 'ios' ? '🍎' : '💻'}</span>
                  <span class="device-name">{d.name}</span>
                  <span class="device-state" class:online={d.state === 'online'}>{d.state}</span>
                </div>
              {/each}
            {/if}
          </div>
        </div>

        <!-- Quick Links Card -->
        <div class="links-footer">
          <button class="footer-link" onclick={onOpenSettings}>⚙ Settings (⌘,)</button>
          <span class="sep">•</span>
          <span class="memory-tag">RAM &lt; 150MB</span>
        </div>
      </div>
    </div>
  </div>
</div>

<style>
  .dashboard-container {
    width: 100%;
    height: 100%;
    background: #101114;
    color: #e6e7ea;
    overflow-y: auto;
    display: flex;
    justify-content: center;
    padding: 32px 16px;
  }
  .dashboard-card-wrap {
    width: 100%;
    max-width: 960px;
    display: flex;
    flex-direction: column;
    gap: 24px;
  }
  .dashboard-header {
    padding-bottom: 8px;
  }
  .logo-row {
    display: flex;
    align-items: center;
    gap: 16px;
  }
  .petak-logo {
    width: 44px;
    height: 44px;
    display: grid;
    grid-template-columns: 1fr 1fr;
    grid-template-rows: 1fr 1fr;
    gap: 4px;
    background: #18191d;
    padding: 6px;
    border-radius: 10px;
    border: 1px solid #282a32;
  }
  .petak-logo .cell {
    background: #6ea8ff;
    border-radius: 2px;
  }
  .petak-logo .cell.dim {
    background: #2a3754;
  }
  .welcome-title {
    font-size: 22px;
    font-weight: 700;
    color: #ffffff;
    margin: 0;
  }
  .welcome-sub {
    font-size: 13px;
    color: #8b8f98;
    margin: 4px 0 0 0;
  }
  .action-tiles {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 12px;
  }
  .tile {
    background: #16171b;
    border: 1px solid #23252c;
    border-radius: 10px;
    padding: 16px;
    display: flex;
    align-items: flex-start;
    gap: 12px;
    cursor: pointer;
    text-align: left;
    transition: all 0.18s ease;
  }
  .tile:hover {
    background: #1d1f25;
    border-color: #353844;
    transform: translateY(-1px);
  }
  .tile.primary {
    background: #172133;
    border-color: #274068;
  }
  .tile.primary:hover {
    background: #1d2b45;
    border-color: #3b609c;
  }
  .tile-icon {
    font-size: 20px;
  }
  .tile-title {
    font-size: 13px;
    font-weight: 600;
    color: #ffffff;
    display: block;
  }
  .tile-desc {
    font-size: 11px;
    color: #888d98;
    margin-top: 4px;
    display: block;
    line-height: 15px;
  }
  .dashboard-grid {
    display: grid;
    grid-template-columns: 1fr 300px;
    gap: 20px;
  }
  .recents-section {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .section-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .section-title {
    font-size: 11px;
    font-weight: 700;
    color: #727682;
    letter-spacing: 0.05em;
  }
  .project-search-input {
    width: 220px;
    height: 28px;
    background: #16171b;
    border: 1px solid #262830;
    border-radius: 6px;
    padding: 0 10px;
    color: #f0f0f0;
    font-size: 12px;
    outline: none;
  }
  .project-search-input:focus {
    border-color: #6ea8ff;
  }
  .projects-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .project-card {
    background: #16171b;
    border: 1px solid #23252c;
    border-radius: 8px;
    padding: 12px 14px;
    display: flex;
    align-items: center;
    gap: 12px;
    cursor: pointer;
    transition: all 0.15s ease;
  }
  .project-card:hover {
    background: #1c1e24;
    border-color: #353945;
  }
  .project-card.missing {
    opacity: 0.65;
  }
  .card-icon {
    font-size: 20px;
  }
  .card-body {
    flex: 1;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .card-top-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .project-name {
    font-size: 13px;
    font-weight: 600;
    color: #e6e7ea;
  }
  .pinned-tag {
    font-size: 10px;
  }
  .missing-tag {
    background: #3c1e1e;
    color: #f07a74;
    font-size: 10px;
    padding: 1px 4px;
    border-radius: 3px;
  }
  .project-path {
    font-family: monospace;
    font-size: 11px;
    color: #7b808e;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .card-meta-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 2px;
  }
  .branch-pill {
    background: #1e222a;
    color: #9cb2d8;
    padding: 1px 6px;
    border-radius: 4px;
    font-size: 10px;
  }
  .time-pill {
    color: #5d616c;
    font-size: 10px;
  }
  .card-actions {
    display: flex;
    gap: 4px;
    opacity: 0.6;
    transition: opacity 0.15s;
  }
  .project-card:hover .card-actions {
    opacity: 1;
  }
  .action-icon-btn {
    background: transparent;
    border: none;
    color: #8b8f98;
    cursor: pointer;
    padding: 4px;
    border-radius: 4px;
    font-size: 11px;
  }
  .action-icon-btn:hover {
    background: #282a32;
    color: #ffffff;
  }
  .empty-projects {
    padding: 32px;
    text-align: center;
    color: #6a6e78;
    font-size: 12px;
    background: #141518;
    border: 1px dashed #22242a;
    border-radius: 8px;
  }
  .side-section {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .info-card {
    background: #16171b;
    border: 1px solid #23252c;
    border-radius: 8px;
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .card-header-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .card-header-title {
    font-size: 11px;
    font-weight: 700;
    color: #727682;
    letter-spacing: 0.04em;
  }
  .mini-settings-btn {
    background: transparent;
    border: none;
    color: #6ea8ff;
    font-size: 11px;
    cursor: pointer;
  }
  .mini-settings-btn:hover {
    text-decoration: underline;
  }
  .status-items {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .status-item {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
  }
  .status-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #8b8f98;
  }
  .status-dot.ok {
    background: #7fc98f;
  }
  .status-lbl {
    color: #8b8f98;
    width: 80px;
  }
  .status-val {
    color: #d0d2d8;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .device-count {
    background: #242730;
    color: #8b8f98;
    padding: 1px 6px;
    border-radius: 8px;
    font-size: 10px;
  }
  .devices-mini-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .mini-device-row {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
  }
  .device-name {
    flex: 1;
    color: #d0d2d8;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .device-state {
    color: #6a6e78;
    font-size: 10px;
  }
  .device-state.online {
    color: #7fc98f;
  }
  .mini-empty {
    font-size: 11px;
    color: #666a74;
    font-style: italic;
  }
  .links-footer {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    font-size: 11px;
    color: #555964;
    margin-top: 8px;
  }
  .footer-link {
    background: transparent;
    border: none;
    color: #8b8f98;
    cursor: pointer;
    font-size: 11px;
  }
  .footer-link:hover {
    color: #d0d2d8;
  }
  .sep {
    color: #33363f;
  }
  .memory-tag {
    color: #6ea8ff;
    font-family: monospace;
  }
</style>
