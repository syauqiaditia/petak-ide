<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { agentsStore } from './agents.svelte';
  import { formatUsageText } from './agentsLogic';
  import AgentTabs from './AgentTabs.svelte';
  import AgentChat from './AgentChat.svelte';
  import ProposedEdits from './ProposedEdits.svelte';
  import QuotaUsageView from './QuotaUsageView.svelte';
  import MemoryView from './MemoryView.svelte';
  import TeamEditor from './TeamEditor.svelte';
  import FixWithAgentModal from './FixWithAgentModal.svelte';

  let {
    onClose,
  } = $props<{
    onClose?: () => void;
  }>();

  let activeSubTab = $state<'chat' | 'diff' | 'quota' | 'memory'>('chat');
  let panelWidth = $state(390);
  let isResizing = $state(false);

  let proposals = $derived(agentsStore.activeProposals);
  let pendingProposalCount = $derived(proposals.length);
  let usage = $derived(agentsStore.activeUsage);
  let usageInfo = $derived(formatUsageText(usage));

  onMount(async () => {
    await agentsStore.init();
  });

  onDestroy(() => {
    agentsStore.destroy();
  });

  function startResize(e: MouseEvent) {
    isResizing = true;
    const startX = e.clientX;
    const startW = panelWidth;

    const onMouseMove = (ev: MouseEvent) => {
      if (!isResizing) return;
      const delta = startX - ev.clientX;
      panelWidth = Math.max(320, Math.min(500, startW + delta));
    };

    const onMouseUp = () => {
      isResizing = false;
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }
</script>

<div class="agents-panel-container" style:width="{panelWidth}px">
  <!-- Left resize handle -->
  <div class="resize-handle" onmousedown={startResize} role="separator" aria-label="Resize panel"></div>

  <!-- Panel Main Header -->
  <div class="panel-header">
    <div class="header-left">
      <span class="header-icon">✨</span>
      <span class="header-title">AI Agents</span>
    </div>

    <!-- Sub-tab switcher: Chat vs Proposed Edits vs Quota vs Memory -->
    <div class="subtabs-bar">
      <button
        class="subtab-btn"
        class:active={activeSubTab === 'chat'}
        onclick={() => (activeSubTab = 'chat')}
      >
        Chat
      </button>
      <button
        class="subtab-btn"
        class:active={activeSubTab === 'diff'}
        onclick={() => (activeSubTab = 'diff')}
      >
        Proposed Edits
        {#if pendingProposalCount > 0}
          <span class="proposals-count-pill">{pendingProposalCount}</span>
        {/if}
      </button>
      <button
        class="subtab-btn"
        class:active={activeSubTab === 'quota'}
        onclick={() => (activeSubTab = 'quota')}
      >
        Quota & Usage
      </button>
      <button
        class="subtab-btn"
        class:active={activeSubTab === 'memory'}
        onclick={() => (activeSubTab = 'memory')}
      >
        Memory
      </button>
    </div>

    <div class="header-actions">
      <button class="close-panel-btn" onclick={onClose} aria-label="Close Agents Panel" title="Tutup panel (⌘6)">
        ✕
      </button>
    </div>
  </div>

  {#if activeSubTab === 'chat' || activeSubTab === 'diff'}
    <!-- Slot Navigation Tabs & Discipline Toggles -->
    <AgentTabs />

    <!-- Honest Limitations Banner (Sticky) -->
    <div class="limitations-banner" role="note">
      <span class="banner-icon">ℹ️</span>
      <span class="banner-text">
        Catatan: Edit via tool internal agen tidak dapat dicegat. Petak otomatis membuat snapshot Local History sebelum sesi berjalan untuk rollback.
      </span>
    </div>
  {/if}

  <!-- Main View Area -->
  <div class="panel-view-area">
    {#if activeSubTab === 'chat'}
      <AgentChat />
    {:else if activeSubTab === 'diff'}
      <ProposedEdits />
    {:else if activeSubTab === 'quota'}
      <QuotaUsageView />
    {:else if activeSubTab === 'memory'}
      <MemoryView />
    {/if}
  </div>

  {#if activeSubTab === 'chat' || activeSubTab === 'diff'}
    <!-- Honest Usage Meter Footer (24px) -->
    <div class="usage-meter-footer">
      <span class="usage-text" class:unreported={!usageInfo.isReported}>
        {usageInfo.text}
      </span>
    </div>
  {/if}

  <!-- Full Access Warning Modal -->
  {#if agentsStore.isFullAccessWarningOpen}
    <div class="warning-backdrop" onclick={() => agentsStore.cancelFullAccess()} role="presentation">
      <div class="warning-modal" onclick={(e) => e.stopPropagation()} role="dialog" tabindex="-1">
        <div class="warning-header">
          <span class="warning-icon">⚠️</span>
          <span class="warning-title">Peringatan Akses Penuh (Full Access)</span>
        </div>
        <div class="warning-body">
          Mode ini mengizinkan agen mengeksekusi perintah terminal apa pun dan mengubah berkas secara otomatis tanpa persetujuan manual. Disarankan hanya untuk agen terpercaya dalam repositori git bersih.
        </div>
        <div class="warning-actions">
          <button class="warn-btn cancel" onclick={() => agentsStore.cancelFullAccess()}>
            Batal
          </button>
          <button class="warn-btn confirm-full" onclick={() => agentsStore.confirmFullAccess()}>
            Aktifkan Mode Full
          </button>
        </div>
      </div>
    </div>
  {/if}

  <!-- Modals -->
  {#if agentsStore.isTeamEditorOpen}
    <TeamEditor />
  {/if}

  {#if agentsStore.isFixWithAgentOpen}
    <FixWithAgentModal />
  {/if}
</div>

<style>
  .agents-panel-container {
    position: relative;
    display: flex;
    flex-direction: column;
    height: 100%;
    background: #141518;
    border-left: 1px solid #26282d;
    overflow: hidden;
    flex-shrink: 0;
  }

  .resize-handle {
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 4px;
    cursor: col-resize;
    z-index: 10;
  }

  .resize-handle:hover {
    background: #6ea8ff;
  }

  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    min-height: 38px;
    height: auto;
    padding: 4px 8px;
    background: #111215;
    border-bottom: 1px solid #1f2126;
    flex-shrink: 0;
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 12.5px;
    font-weight: 600;
    color: #e6edf3;
    flex-shrink: 0;
  }

  .header-icon {
    font-size: 13px;
  }

  .subtabs-bar {
    display: flex;
    background: #18191f;
    border: 1px solid #282a33;
    border-radius: 5px;
    padding: 2px;
    overflow-x: auto;
    scrollbar-width: none;
    max-width: 100%;
    gap: 2px;
  }

  .subtabs-bar::-webkit-scrollbar {
    display: none;
  }

  .subtab-btn {
    display: flex;
    align-items: center;
    gap: 3px;
    background: transparent;
    border: none;
    border-radius: 4px;
    padding: 2px 6px;
    font-size: 10.5px;
    font-weight: 500;
    color: #8b949e;
    cursor: pointer;
    white-space: nowrap;
    flex-shrink: 0;
    transition: all 0.12s;
  }

  .subtab-btn:hover {
    color: #c9cdd4;
  }

  .subtab-btn.active {
    background: #252833;
    color: #6ea8ff;
    font-weight: 600;
  }

  .proposals-count-pill {
    background: #1f304d;
    color: #79c0ff;
    font-size: 9px;
    font-weight: 700;
    padding: 1px 4px;
    border-radius: 8px;
  }

  .close-panel-btn {
    background: transparent;
    border: none;
    color: #8b949e;
    cursor: pointer;
    font-size: 13px;
    padding: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .close-panel-btn:hover {
    color: #e6edf3;
  }

  .limitations-banner {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    padding: 6px 10px;
    background: #232018;
    border-bottom: 1px solid #3d3420;
    color: #d4b36a;
    font-size: 10px;
    line-height: 1.35;
    flex-shrink: 0;
  }

  .banner-icon {
    font-size: 11px;
  }

  .panel-view-area {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }

  .usage-meter-footer {
    display: flex;
    align-items: center;
    height: 24px;
    padding: 0 10px;
    background: #111215;
    border-top: 1px solid #26282d;
    font-size: 10px;
    font-family: monospace;
    flex-shrink: 0;
  }

  .usage-text {
    color: #8b949e;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .usage-text.unreported {
    font-style: italic;
    color: #6e7681;
  }

  /* Full Access Confirmation Modal */
  .warning-backdrop {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 50;
    padding: 16px;
  }

  .warning-modal {
    background: #221617;
    border: 1px solid #6b282b;
    border-radius: 8px;
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.6);
  }

  .warning-header {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .warning-title {
    font-size: 12px;
    font-weight: 700;
    color: #f07a74;
  }

  .warning-body {
    font-size: 11px;
    color: #e6edf3;
    line-height: 1.4;
  }

  .warning-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 4px;
  }

  .warn-btn {
    padding: 4px 10px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    border: none;
  }

  .warn-btn.cancel {
    background: #1f2228;
    color: #c9cdd4;
  }

  .warn-btn.confirm-full {
    background: #8b2529;
    color: #fff;
    border: 1px solid #d9534f;
  }
</style>
