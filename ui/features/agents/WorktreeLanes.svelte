<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '../../lib/api';
  import { agentsStore } from './agents.svelte';
  import { tabsManager } from '../editor/tabs.svelte';
  import type { WorktreeInfo, SelfHealStatus } from './types';
  import {
    formatWorktreeRuntime,
    resolveWorktreeBotInfo,
    aggregateWorktreeStats,
    resolveSelfHealChip,
  } from './agentsLogic';

  let worktrees = $state<WorktreeInfo[]>([]);
  let selfHealStatuses = $state<Record<string, SelfHealStatus>>({});
  let isLoading = $state(false);
  let error = $state<string | null>(null);
  let now = $state(Date.now());
  let selectedDiff = $state<{ taskId: string; branch: string; diffText: string } | null>(null);
  let isDiffLoading = $state(false);
  let isNewLaneModalOpen = $state(false);
  let newTaskId = $state('');
  let newBranch = $state('');
  let newBaseBranch = $state('main');
  let isSubmitting = $state(false);
  let actionFeedback = $state<string | null>(null);

  let stats = $derived(aggregateWorktreeStats(worktrees));

  async function loadSelfHealStatuses() {
    for (const wt of worktrees) {
      try {
        const st = await api.agentGetSelfHealStatus(wt.task_id);
        selfHealStatuses[wt.task_id] = st;
      } catch {
        // ignore
      }
    }
  }

  async function loadWorktrees() {
    isLoading = true;
    error = null;
    try {
      const res = await api.agentWorktreeList();
      worktrees = Array.isArray(res) ? res : [];
      await loadSelfHealStatuses();
    } catch (e: any) {
      error = e?.message || 'Gagal memuat daftar worktree lanes';
    } finally {
      isLoading = false;
    }
  }

  onMount(() => {
    loadWorktrees();
    const timer = setInterval(() => {
      now = Date.now();
    }, 1000);
    return () => clearInterval(timer);
  });

  async function handleInspectDiff(wt: WorktreeInfo) {
    isDiffLoading = true;
    try {
      const diffText = await api.agentWorktreeDiff(wt.task_id);
      selectedDiff = {
        taskId: wt.task_id,
        branch: wt.branch,
        diffText: diffText || '(Tidak ada perubahan / diff bersih)',
      };
    } catch (e: any) {
      actionFeedback = `Gagal mengambil diff: ${e?.message || e}`;
    } finally {
      isDiffLoading = false;
    }
  }

  function handleOpenInEditor(wt: WorktreeInfo) {
    const filename = `${wt.task_id}.md`;
    tabsManager.openTab(
      `${wt.path}/${filename}`,
      filename,
      `# Worktree ${wt.branch}\nPath: ${wt.path}\nBase: ${wt.base_branch}\nSHA: ${wt.head_sha}\nDirty: ${wt.is_dirty}\n`
    );
    actionFeedback = `Membuka worktree ${wt.branch} di editor`;
    setTimeout(() => {
      actionFeedback = null;
    }, 3000);
  }

  async function handleCancelReclaim(wt: WorktreeInfo) {
    const ok = window.confirm(
      `Interupsi agen & reclaim worktree untuk task ${wt.task_id} (${wt.branch})?`
    );
    if (!ok) return;

    try {
      await api.agentWorktreeRemove(wt.task_id, false);
      actionFeedback = `Worktree ${wt.branch} berhasil di-reclaim`;
      await loadWorktrees();
    } catch (e: any) {
      actionFeedback = `Gagal mereclaim worktree: ${e?.message || e}`;
    }
    setTimeout(() => {
      actionFeedback = null;
    }, 4000);
  }

  async function handleCreateLane(e: Event) {
    e.preventDefault();
    if (!newTaskId.trim()) return;
    const task = newTaskId.trim();
    const branchName = newBranch.trim() || `wt/${task}`;
    const base = newBaseBranch.trim() || 'main';

    isSubmitting = true;
    try {
      await api.agentWorktreeCreate(task, branchName, base);
      isNewLaneModalOpen = false;
      newTaskId = '';
      newBranch = '';
      newBaseBranch = 'main';
      actionFeedback = `Worktree lane ${branchName} berhasil dibuat`;
      await loadWorktrees();
    } catch (e: any) {
      error = `Gagal membuat lane: ${e?.message || e}`;
    } finally {
      isSubmitting = false;
    }
    setTimeout(() => {
      actionFeedback = null;
    }, 4000);
  }

  function getMiniEvents(wt: WorktreeInfo): string[] {
    const timeStr = new Date(wt.created_at).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
    const events: string[] = [
      `[${timeStr}] Init worktree ${wt.branch}`,
      `[${timeStr}] Tracking base ${wt.base_branch} @ ${wt.head_sha.substring(0, 7)}`,
    ];
    if (wt.is_dirty) {
      events.push(`[Live] ● File changes detected in worktree`);
      events.push(`[Run] Agent aktif mengeksekusi patch & testing`);
    } else {
      events.push(`[Ready] Working tree clean & synchronized`);
    }
    return events;
  }
</script>

<div class="worktree-lanes-root">
  <!-- Cockpit Toolbar -->
  <div class="cockpit-toolbar">
    <div class="toolbar-left">
      <div class="cockpit-title-wrap">
        <span class="cockpit-icon">⚡</span>
        <h3 class="cockpit-title">Worktree Lane Cockpit</h3>
        <span class="orca-badge">Orca-Style</span>
      </div>

      <div class="cockpit-metrics">
        <span class="metric-pill total" title="Total active worktrees">
          🏢 {stats.total} Active
        </span>
        <span class="metric-pill running" title="Running lanes">
          ⚡ {stats.running} Running
        </span>
        <span class="metric-pill dirty" class:has-dirty={stats.dirty > 0} title="Modified worktrees">
          ● {stats.dirty} Modified
        </span>
      </div>
    </div>

    <div class="toolbar-right">
      {#if actionFeedback}
        <span class="feedback-toast">{actionFeedback}</span>
      {/if}
      <button
        type="button"
        class="toolbar-btn refresh-btn"
        onclick={loadWorktrees}
        disabled={isLoading}
        title="Segarkan status worktrees"
      >
        <span class:spinning={isLoading}>🔄</span>
        <span>Segarkan</span>
      </button>
      <button
        type="button"
        class="toolbar-btn new-lane-btn"
        onclick={() => (isNewLaneModalOpen = true)}
        title="Buat worktree lane baru"
      >
        <span>+ New Lane</span>
      </button>
    </div>
  </div>

  {#if error}
    <div class="cockpit-error-banner">
      <span>⚠️ {error}</span>
      <button type="button" class="dismiss-btn" onclick={() => (error = null)}>✕</button>
    </div>
  {/if}

  <!-- Lanes Container (Orca-Style Horizontal Scroll) -->
  <div class="lanes-viewport">
    {#if isLoading && worktrees.length === 0}
      <div class="lanes-loading">
        <span class="spinner">⏳</span>
        <span>Memuat Worktree Lanes...</span>
      </div>
    {:else if worktrees.length === 0}
      <div class="lanes-empty">
        <span class="empty-icon">📂</span>
        <h4>Belum ada Worktree Lane aktif</h4>
        <p>Mulai slot agen baru atau buat worktree terisolasi untuk memulai paralelisme.</p>
        <button
          type="button"
          class="empty-add-btn"
          onclick={() => (isNewLaneModalOpen = true)}
        >
          + Buat Lane Baru
        </button>
      </div>
    {:else}
      <div class="lanes-track">
        {#each worktrees as wt (wt.task_id)}
          {@const bot = resolveWorktreeBotInfo(wt, agentsStore.slots)}
          {@const runtime = formatWorktreeRuntime(wt.created_at, now)}
          {@const events = getMiniEvents(wt)}
          {@const healChip = resolveSelfHealChip(selfHealStatuses[wt.task_id])}

          <div class="lane-column" class:is-running={bot.status === 'RUNNING'}>
            <!-- Header Lane: Bot Avatar, Title, Status Badge, Live Runtime -->
            <div class="lane-header">
              <div class="bot-profile">
                <span class="bot-avatar">{bot.avatar}</span>
                <div class="bot-info-text">
                  <span class="bot-title">{bot.title}</span>
                  <span class="bot-role-tag">{bot.role}</span>
                </div>
              </div>

              <div class="header-status-wrap">
                <span class="status-badge status-{bot.status.toLowerCase()}">
                  <span class="status-pulse-dot"></span>
                  {bot.status}
                </span>
                <span class="runtime-counter" title="Live runtime counter">
                  ⏱️ {runtime}
                </span>
              </div>
            </div>

            <!-- Branch Info -->
            <div class="lane-branch-card">
              <div class="branch-row">
                <span class="branch-chip" title="Git Branch: {wt.branch}">
                  🌿 {wt.branch}
                </span>
                <span class="dirty-indicator" class:modified={wt.is_dirty}>
                  {wt.is_dirty ? '● modified' : '● clean'}
                </span>
              </div>

              <!-- Self-Heal Status Chip -->
              <div class="self-heal-row">
                <span
                  class="self-heal-chip {healChip.cssClass}"
                  title="Status Self-Healing: {healChip.label}"
                >
                  <span class="heal-icon">{healChip.icon}</span>
                  <span class="heal-label">{healChip.label}</span>
                </span>
              </div>

              <div class="branch-meta-row">
                <span class="meta-item base-branch" title="Base branch">
                  ↳ base: <strong>{wt.base_branch}</strong>
                </span>
                <span class="meta-item head-sha" title="Head commit SHA">
                  sha: <code>{wt.head_sha.substring(0, 7)}</code>
                </span>
              </div>

              <div class="path-row" title={wt.path}>
                <span class="path-label">📂</span>
                <span class="path-text">{wt.path}</span>
              </div>
            </div>

            <!-- Mini Activity Feed / Stream (Ring buffer log preview) -->
            <div class="activity-feed-box">
              <div class="feed-header">
                <span class="feed-title">Mini Activity Feed</span>
                <span class="live-dot">LIVE</span>
              </div>
              <div class="feed-stream">
                {#each events as evt}
                  <div class="feed-line">{evt}</div>
                {/each}
              </div>
            </div>

            <!-- Quick Actions per Lane -->
            <div class="lane-actions-row">
              <button
                type="button"
                class="action-btn diff-btn"
                onclick={() => handleInspectDiff(wt)}
                disabled={isDiffLoading}
                title="Inspect Diff worktree"
              >
                <span>🔍</span>
                <span>Inspect Diff</span>
              </button>

              <button
                type="button"
                class="action-btn editor-btn"
                onclick={() => handleOpenInEditor(wt)}
                title="Buka worktree di tab editor"
              >
                <span>📂</span>
                <span>Open in Editor</span>
              </button>

              <button
                type="button"
                class="action-btn cancel-btn"
                onclick={() => handleCancelReclaim(wt)}
                title="Cancel / Reclaim worktree ini"
              >
                <span>🛑</span>
                <span>Cancel / Reclaim</span>
              </button>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>

<!-- Modal: Inspect Diff Preview -->
{#if selectedDiff}
  <div
    class="modal-backdrop"
    onclick={() => (selectedDiff = null)}
    role="presentation"
  >
    <div
      class="modal-window diff-modal-window"
      onclick={(e) => e.stopPropagation()}
      role="dialog"
      aria-modal="true"
      tabindex="-1"
    >
      <div class="modal-header">
        <div class="modal-title-wrap">
          <span class="modal-icon">🔍</span>
          <div class="modal-title-text">
            <h4>Worktree Diff Preview</h4>
            <span class="modal-subtitle">
              Task: <code>{selectedDiff.taskId}</code> · Branch: <code>{selectedDiff.branch}</code>
            </span>
          </div>
        </div>
        <button
          type="button"
          class="modal-close-btn"
          onclick={() => (selectedDiff = null)}
          aria-label="Tutup Diff"
        >
          ✕
        </button>
      </div>

      <div class="modal-body diff-modal-body">
        <pre class="diff-pre-container"><code>{selectedDiff.diffText}</code></pre>
      </div>

      <div class="modal-footer">
        <span class="diff-hint">Menampilkan diff terisolasi dari branch worktree.</span>
        <button
          type="button"
          class="modal-btn secondary"
          onclick={() => (selectedDiff = null)}
        >
          Tutup
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- Modal: New Worktree Lane Form -->
{#if isNewLaneModalOpen}
  <div
    class="modal-backdrop"
    onclick={() => (isNewLaneModalOpen = false)}
    role="presentation"
  >
    <div
      class="modal-window new-lane-modal-window"
      onclick={(e) => e.stopPropagation()}
      role="dialog"
      aria-modal="true"
      tabindex="-1"
    >
      <form onsubmit={handleCreateLane}>
        <div class="modal-header">
          <div class="modal-title-wrap">
            <span class="modal-icon">⚡</span>
            <h4>Tambah Worktree Lane Baru</h4>
          </div>
          <button
            type="button"
            class="modal-close-btn"
            onclick={() => (isNewLaneModalOpen = false)}
            aria-label="Tutup Dialog"
          >
            ✕
          </button>
        </div>

        <div class="modal-body form-body">
          <div class="form-group">
            <label for="wt-task-id">Task ID <span class="req">*</span></label>
            <input
              id="wt-task-id"
              type="text"
              placeholder="e.g. t_41ab160d"
              bind:value={newTaskId}
              required
            />
            <span class="input-hint">ID task kanban yang diasosiasikan dengan worktree ini.</span>
          </div>

          <div class="form-group">
            <label for="wt-branch">Branch Name</label>
            <input
              id="wt-branch"
              type="text"
              placeholder="e.g. wt/t_41ab160d (otomatis jika kosong)"
              bind:value={newBranch}
            />
          </div>

          <div class="form-group">
            <label for="wt-base-branch">Base Branch</label>
            <input
              id="wt-base-branch"
              type="text"
              placeholder="main"
              bind:value={newBaseBranch}
            />
          </div>
        </div>

        <div class="modal-footer">
          <button
            type="button"
            class="modal-btn secondary"
            onclick={() => (isNewLaneModalOpen = false)}
          >
            Batal
          </button>
          <button
            type="submit"
            class="modal-btn primary"
            disabled={isSubmitting || !newTaskId.trim()}
          >
            {isSubmitting ? 'Membuat...' : '+ Buat Lane'}
          </button>
        </div>
      </form>
    </div>
  </div>
{/if}

<style>
  .worktree-lanes-root {
    display: flex;
    flex-direction: column;
    height: 100%;
    width: 100%;
    background: #181a1f;
    color: #abb2bf;
    overflow: hidden;
    user-select: none;
  }

  /* Cockpit Toolbar */
  .cockpit-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 14px;
    background: #1e2227;
    border-bottom: 1px solid #282c34;
    flex-shrink: 0;
    gap: 12px;
  }

  .toolbar-left {
    display: flex;
    align-items: center;
    gap: 14px;
    flex-wrap: wrap;
  }

  .cockpit-title-wrap {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .cockpit-icon {
    font-size: 15px;
    color: #61afef;
  }

  .cockpit-title {
    margin: 0;
    font-size: 13px;
    font-weight: 600;
    color: #d7dae0;
    letter-spacing: 0.3px;
  }

  .orca-badge {
    font-size: 10px;
    padding: 1px 5px;
    border-radius: 4px;
    background: rgba(97, 175, 239, 0.15);
    color: #61afef;
    border: 1px solid rgba(97, 175, 239, 0.3);
    font-weight: 500;
  }

  .cockpit-metrics {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .metric-pill {
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 12px;
    background: #23272e;
    color: #8b92a0;
    border: 1px solid #2c313a;
    font-weight: 500;
  }

  .metric-pill.running {
    background: rgba(97, 175, 239, 0.12);
    color: #61afef;
    border-color: rgba(97, 175, 239, 0.3);
  }

  .metric-pill.dirty.has-dirty {
    background: rgba(229, 192, 123, 0.15);
    color: #e5c07b;
    border-color: rgba(229, 192, 123, 0.35);
  }

  .toolbar-right {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .feedback-toast {
    font-size: 11px;
    color: #98c379;
    background: rgba(152, 195, 121, 0.12);
    padding: 3px 8px;
    border-radius: 4px;
    border: 1px solid rgba(152, 195, 121, 0.25);
  }

  .toolbar-btn {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 4px 10px;
    font-size: 11px;
    font-weight: 500;
    border-radius: 5px;
    cursor: pointer;
    transition: all 0.12s ease;
    border: 1px solid #3e4451;
    background: #282c34;
    color: #abb2bf;
  }

  .toolbar-btn:hover:not(:disabled) {
    background: #323842;
    color: #d7dae0;
  }

  .toolbar-btn.new-lane-btn {
    background: #2c3e50;
    color: #61afef;
    border-color: #3b536b;
  }

  .toolbar-btn.new-lane-btn:hover {
    background: #34495e;
    color: #98c379;
    border-color: #4a6984;
  }

  .spinning {
    display: inline-block;
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  .cockpit-error-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 14px;
    background: rgba(224, 108, 117, 0.15);
    border-bottom: 1px solid rgba(224, 108, 117, 0.3);
    color: #e06c75;
    font-size: 11px;
  }

  .dismiss-btn {
    background: none;
    border: none;
    color: #e06c75;
    cursor: pointer;
    font-size: 12px;
  }

  /* Viewport and Horizontal Lanes Track */
  .lanes-viewport {
    flex: 1;
    overflow-x: auto;
    overflow-y: hidden;
    padding: 14px;
  }

  .lanes-loading,
  .lanes-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: #5c6370;
    gap: 10px;
  }

  .empty-icon {
    font-size: 36px;
    opacity: 0.6;
  }

  .lanes-empty h4 {
    margin: 0;
    font-size: 14px;
    color: #abb2bf;
  }

  .lanes-empty p {
    margin: 0;
    font-size: 12px;
    max-width: 320px;
    text-align: center;
  }

  .empty-add-btn {
    margin-top: 8px;
    padding: 6px 14px;
    border-radius: 5px;
    background: #61afef;
    color: #1e2227;
    font-weight: 600;
    font-size: 12px;
    border: none;
    cursor: pointer;
  }

  .lanes-track {
    display: flex;
    flex-direction: row;
    align-items: stretch;
    gap: 14px;
    height: 100%;
    min-width: min-content;
  }

  /* Lane Column Card (Orca style) */
  .lane-column {
    width: 340px;
    flex-shrink: 0;
    background: #21252b;
    border: 1px solid #282c34;
    border-radius: 8px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
    transition: border-color 0.15s ease, box-shadow 0.15s ease;
  }

  .lane-column:hover {
    border-color: #3e4451;
  }

  .lane-column.is-running {
    border-color: rgba(97, 175, 239, 0.45);
    box-shadow: 0 4px 14px rgba(97, 175, 239, 0.1);
  }

  /* Lane Header */
  .lane-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-bottom: 8px;
    border-bottom: 1px solid #282c34;
  }

  .bot-profile {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .bot-avatar {
    font-size: 18px;
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #181a1f;
    border-radius: 6px;
    border: 1px solid #2c313a;
  }

  .bot-info-text {
    display: flex;
    flex-direction: column;
  }

  .bot-title {
    font-size: 12px;
    font-weight: 600;
    color: #e5e5e5;
  }

  .bot-role-tag {
    font-size: 10px;
    color: #5c6370;
  }

  .header-status-wrap {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 4px;
  }

  .status-badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 10px;
    font-weight: 700;
    padding: 2px 6px;
    border-radius: 10px;
    letter-spacing: 0.4px;
  }

  .status-pulse-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: currentColor;
  }

  .status-badge.status-running {
    background: rgba(97, 175, 239, 0.2);
    color: #61afef;
    border: 1px solid rgba(97, 175, 239, 0.4);
  }

  .status-badge.status-running .status-pulse-dot {
    animation: pulse 1.4s infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.4; transform: scale(0.8); }
  }

  .status-badge.status-ready {
    background: rgba(152, 195, 121, 0.18);
    color: #98c379;
    border: 1px solid rgba(152, 195, 121, 0.35);
  }

  .status-badge.status-blocked {
    background: rgba(224, 108, 117, 0.18);
    color: #e06c75;
    border: 1px solid rgba(224, 108, 117, 0.35);
  }

  .status-badge.status-done {
    background: rgba(198, 120, 221, 0.18);
    color: #c678dd;
    border: 1px solid rgba(198, 120, 221, 0.35);
  }

  .runtime-counter {
    font-size: 10px;
    color: #828997;
    font-family: monospace;
  }

  /* Branch Info Card */
  .lane-branch-card {
    background: #181a1f;
    border: 1px solid #282c34;
    border-radius: 6px;
    padding: 8px 10px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .branch-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
  }

  .branch-chip {
    font-size: 11px;
    font-weight: 600;
    color: #61afef;
    font-family: monospace;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .dirty-indicator {
    font-size: 10px;
    font-weight: 500;
    color: #98c379;
  }

  .dirty-indicator.modified {
    color: #e5c07b;
  }

  .self-heal-row {
    display: flex;
    align-items: center;
    margin-top: 1px;
  }

  .self-heal-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 7px;
    border-radius: 4px;
    font-size: 10px;
    font-family: 'JetBrains Mono', monospace;
    font-weight: 500;
    border: 1px solid rgba(255, 255, 255, 0.08);
    background: rgba(255, 255, 255, 0.04);
    color: #abb2bf;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .self-heal-chip .heal-icon {
    font-size: 11px;
  }

  .self-heal-chip.self-heal-hot-reloading {
    border-color: rgba(234, 179, 8, 0.35);
    background: rgba(234, 179, 8, 0.1);
    color: #e5c07b;
  }

  .self-heal-chip.self-heal-testing {
    border-color: rgba(97, 175, 239, 0.35);
    background: rgba(97, 175, 239, 0.1);
    color: #61afef;
  }

  .self-heal-chip.self-heal-passed {
    border-color: rgba(152, 195, 121, 0.35);
    background: rgba(152, 195, 121, 0.1);
    color: #98c379;
  }

  .self-heal-chip.self-heal-failed {
    border-color: rgba(224, 108, 117, 0.35);
    background: rgba(224, 108, 117, 0.1);
    color: #e06c75;
  }

  .self-heal-chip.self-heal-paused {
    border-color: rgba(239, 68, 68, 0.35);
    background: rgba(239, 68, 68, 0.1);
    color: #f87171;
  }

  .branch-meta-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 10px;
    color: #828997;
  }

  .meta-item code {
    font-family: monospace;
    color: #d19a66;
    background: #21252b;
    padding: 1px 3px;
    border-radius: 3px;
  }

  .path-row {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 10px;
    color: #5c6370;
    overflow: hidden;
  }

  .path-text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    direction: rtl;
    text-align: left;
  }

  /* Activity Feed Box */
  .activity-feed-box {
    background: #1b1e23;
    border: 1px solid #252931;
    border-radius: 6px;
    padding: 8px 10px;
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 90px;
    overflow: hidden;
  }

  .feed-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 6px;
  }

  .feed-title {
    font-size: 10px;
    font-weight: 600;
    color: #8b92a0;
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }

  .live-dot {
    font-size: 9px;
    font-weight: 700;
    color: #98c379;
    letter-spacing: 0.5px;
  }

  .feed-stream {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-family: monospace;
    font-size: 10px;
    color: #abb2bf;
    line-height: 14px;
    overflow-y: auto;
  }

  .feed-line {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    color: #828997;
  }

  .feed-line:last-child {
    color: #d7dae0;
  }

  /* Lane Actions */
  .lane-actions-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
    padding-top: 4px;
  }

  .action-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    font-size: 11px;
    font-weight: 500;
    padding: 6px 8px;
    border-radius: 5px;
    border: 1px solid #2c313a;
    background: #181a1f;
    color: #abb2bf;
    cursor: pointer;
    transition: all 0.12s ease;
  }

  .action-btn:hover {
    background: #282c34;
    color: #d7dae0;
    border-color: #3e4451;
  }

  .action-btn.cancel-btn {
    grid-column: span 2;
    color: #e06c75;
    background: rgba(224, 108, 117, 0.08);
    border-color: rgba(224, 108, 117, 0.2);
  }

  .action-btn.cancel-btn:hover {
    background: rgba(224, 108, 117, 0.18);
    border-color: rgba(224, 108, 117, 0.4);
    color: #ff8089;
  }

  /* Modal Windows */
  .modal-backdrop {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.65);
    backdrop-filter: blur(2px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }

  .modal-window {
    background: #21252b;
    border: 1px solid #3e4451;
    border-radius: 8px;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
    display: flex;
    flex-direction: column;
    max-width: 90vw;
    color: #abb2bf;
  }

  .diff-modal-window {
    width: 680px;
    max-height: 80vh;
  }

  .new-lane-modal-window {
    width: 440px;
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    border-bottom: 1px solid #282c34;
  }

  .modal-title-wrap {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .modal-icon {
    font-size: 16px;
  }

  .modal-title-text h4 {
    margin: 0;
    font-size: 13px;
    color: #e5e5e5;
  }

  .modal-subtitle {
    font-size: 10px;
    color: #828997;
  }

  .modal-close-btn {
    background: none;
    border: none;
    color: #828997;
    font-size: 14px;
    cursor: pointer;
  }

  .modal-close-btn:hover {
    color: #e5e5e5;
  }

  .modal-body {
    padding: 16px;
    overflow-y: auto;
  }

  .diff-modal-body {
    background: #181a1f;
    padding: 12px;
  }

  .diff-pre-container {
    margin: 0;
    font-family: monospace;
    font-size: 11px;
    line-height: 16px;
    color: #abb2bf;
    white-space: pre-wrap;
    word-break: break-all;
  }

  .modal-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 16px;
    border-top: 1px solid #282c34;
    background: #1b1e23;
  }

  .diff-hint {
    font-size: 11px;
    color: #5c6370;
  }

  .modal-btn {
    padding: 6px 14px;
    border-radius: 5px;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    border: 1px solid #3e4451;
  }

  .modal-btn.secondary {
    background: #282c34;
    color: #abb2bf;
  }

  .modal-btn.secondary:hover {
    background: #323842;
  }

  .modal-btn.primary {
    background: #61afef;
    color: #1e2227;
    border-color: #61afef;
    font-weight: 600;
  }

  .modal-btn.primary:hover:not(:disabled) {
    background: #73b8f1;
  }

  .form-body {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .form-group {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .form-group label {
    font-size: 11px;
    font-weight: 600;
    color: #d7dae0;
  }

  .form-group input {
    padding: 7px 10px;
    background: #181a1f;
    border: 1px solid #3e4451;
    border-radius: 5px;
    color: #d7dae0;
    font-size: 12px;
  }

  .form-group input:focus {
    outline: none;
    border-color: #61afef;
  }

  .input-hint {
    font-size: 10px;
    color: #5c6370;
  }

  .req {
    color: #e06c75;
  }
</style>
