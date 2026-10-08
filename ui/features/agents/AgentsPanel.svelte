<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { agentsStore } from './agents.svelte';
  import {
    formatUsageText,
    ALL_PRESET_MODELS,
    getModelDisplayName,
    formatEngineName,
    getRoleScopeBadge,
    inferRoleFromSlot,
    getRoleScopeDescription,
  } from './agentsLogic';
  import AgentChat from './AgentChat.svelte';
  import ProposedEdits from './ProposedEdits.svelte';
  import QuotaUsageView from './QuotaUsageView.svelte';
  import MemoryView from './MemoryView.svelte';
  import WorktreeLanes from './WorktreeLanes.svelte';
  import TeamEditor from './TeamEditor.svelte';
  import FixWithAgentModal from './FixWithAgentModal.svelte';
  import { settingsStore } from '../settings/settingsStore.svelte';

  let {
    onClose,
  } = $props<{
    onClose?: () => void;
  }>();

  // Subtabs: 'chat' | 'diff' | 'quota' | 'memory' (legacy contract)
  let activeSubTab = $state<'chat' | 'lanes' | 'diff' | 'quota' | 'memory'>('chat');
  const SAVED_PANEL_WIDTH_KEY = 'petak_agent_panel_width';
  let panelWidth = $state(
    typeof localStorage !== 'undefined' && localStorage.getItem(SAVED_PANEL_WIDTH_KEY)
      ? Math.max(340, Math.min(850, Number(localStorage.getItem(SAVED_PANEL_WIDTH_KEY)) || 460))
      : 460
  );
  let isResizing = $state(false);
  let isMoreMenuOpen = $state(false);

  let proposals = $derived(agentsStore.activeProposals);
  let pendingProposalCount = $derived(proposals.length);
  let pendingHunkCount = $derived(
    proposals.reduce((sum, p) => sum + (p.hunks ? p.hunks.length : 1), 0)
  );
  let usage = $derived(agentsStore.activeUsage);
  let usageInfo = $derived(formatUsageText(usage));

  interface HermesBotProfile {
    id: string;
    name: string;
    label: string;
    icon: string;
    role: string;
    defaultModel: string;
  }

  const HERMES_PROFILES: HermesBotProfile[] = [
    { id: 'default', name: 'default', label: '🤖 Petak Agent', icon: '🤖', role: 'Asisten Utama (Coding & Project)', defaultModel: 'ag/gemini-3.8-flash-high' },
    { id: 'manager', name: 'manager', label: '👑 Manager', icon: '👑', role: 'Planner & Task Orchestrator', defaultModel: 'ag/gemini-3.8-flash-high' },
    { id: 'techlead', name: 'techlead', label: '🧠 Techlead', icon: '🧠', role: 'System Architect & Core Modules', defaultModel: 'ag/gemini-3.8-flash-high' },
    { id: 'senior', name: 'senior', label: '⚡ Senior', icon: '⚡', role: 'Fullstack Flutter & Rust Implementer', defaultModel: 'ag/gemini-3.8-flash-high' },
    { id: 'senior2', name: 'senior2', label: '⚡ Senior2', icon: '⚡', role: 'Toolchains, Language Servers & Integrations', defaultModel: 'ag/gemini-3.8-flash-high' },
    { id: 'reviewer', name: 'reviewer', label: '🔍 Reviewer', icon: '🔍', role: 'QA, Code Reviewer & Security Auditing', defaultModel: 'ag/gemini-3.8-flash-high' },
    { id: 'designer', name: 'designer', label: '🎨 Designer', icon: '🎨', role: 'UI/UX Design System & Prototypes', defaultModel: 'ag/gemini-3.8-flash-high' },
  ];

  let activeSlot = $derived(agentsStore.activeSlot);

  let activeProfileId = $derived.by(() => {
    if (!activeSlot) return 'default';
    const prof = (activeSlot.config?.hermesProfile || activeSlot.label || '').toLowerCase();
    const match = HERMES_PROFILES.find((p) => prof.includes(p.id) || p.id === prof);
    return match ? match.id : 'default';
  });

  let activeSlotRole = $derived.by(() => {
    if (activeSlot?.config?.role) return activeSlot.config.role;
    if (activeSlot?.config) return inferRoleFromSlot(activeSlot.config);
    return activeProfileId;
  });

  let currentModelName = $derived(
    activeSlot?.config?.model ||
    HERMES_PROFILES.find((p) => p.id === activeProfileId)?.defaultModel ||
    'ag/gemini-3.8-flash-high'
  );

  function getModelInfo(modelName?: string | null): { name: string; type: 'claude' | 'gemini' | 'ollama' | 'other' } {
    const m = (modelName || '').toLowerCase();
    if (m.includes('claude')) return { name: 'Claude', type: 'claude' };
    if (m.includes('gemini')) return { name: 'Gemini', type: 'gemini' };
    if (m.includes('ollama') || m.includes('qwen') || m.includes('deepseek') || m.includes('local')) {
      return { name: 'Ollama', type: 'ollama' };
    }
    return { name: modelName || 'AI', type: 'other' };
  }

  let modelInfo = $derived(getModelInfo(currentModelName));

  function getProfileStatus(id: string): 'ready' | 'busy' | 'idle' {
    const matchingSlot = agentsStore.slots.find(
      (s) => (s.config?.hermesProfile === id) || s.label.toLowerCase().includes(id) || s.id === id
    );
    if (matchingSlot) {
      if (matchingSlot.status === 'busy') return 'busy';
      if (matchingSlot.status === 'ready') return 'ready';
      return 'ready';
    }
    if (id === 'senior') return 'busy';
    return 'ready';
  }

  function handleProfileSelect(e: Event) {
    const select = e.target as HTMLSelectElement;
    const targetId = select.value;
    const matchingSlot = agentsStore.slots.find(
      (s) => (s.config?.hermesProfile === targetId) || s.label.toLowerCase().includes(targetId) || s.id === targetId
    );
    if (matchingSlot) {
      agentsStore.selectSlot(matchingSlot.id);
    } else {
      const profile = HERMES_PROFILES.find((p) => p.id === targetId);
      if (profile) {
        agentsStore.selectSlot(profile.id);
      }
    }
  }

  function handleModelChange(e: Event) {
    const select = e.target as HTMLSelectElement;
    const newModelId = select.value;
    const targetSlotId = activeSlot?.id || 'default';
    agentsStore.updateSlotModel(targetSlotId, newModelId);
  }

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
      const maxW = typeof window !== 'undefined' ? Math.min(850, Math.floor(window.innerWidth * 0.65)) : 800;
      panelWidth = Math.max(340, Math.min(maxW, startW + delta));
    };

    const onMouseUp = () => {
      isResizing = false;
      if (typeof localStorage !== 'undefined') {
        try {
          localStorage.setItem(SAVED_PANEL_WIDTH_KEY, String(panelWidth));
        } catch (_) {}
      }
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

  <!-- Clean Responsive 2-Row Header (Linear / Raycast Style) -->
  <div class="agent-unified-header panel-header">
    <!-- Baris 1: Top Navigation & Primary Actions -->
    <div class="header-primary-row">
      <div class="primary-left header-left">
        <!-- Hermes Bot Profiles Dropdown Selector -->
        <div class="bot-selector-wrap">
          <select
            class="bot-select-dropdown"
            value={activeProfileId}
            onchange={handleProfileSelect}
            aria-label="Hermes Bot Profile Selector"
          >
            {#each HERMES_PROFILES as p}
              {@const pStatus = getProfileStatus(p.id)}
              <option value={p.id}>
                {p.label} ({p.role}) · {pStatus === 'busy' ? '⚡ Busy' : '● Ready'}
              </option>
            {/each}
          </select>
          <span
            class="runtime-status-dot"
            class:busy={getProfileStatus(activeProfileId) === 'busy'}
            class:ready={getProfileStatus(activeProfileId) === 'ready'}
            title="Runtime: {getProfileStatus(activeProfileId)}"
          ></span>
        </div>

        <!-- + New Chat & History Sessions Action Buttons -->
        <div class="session-actions-group">
          <button
            type="button"
            class="panel-icon-btn new-chat-btn"
            onclick={() => agentsStore.newSession()}
            title="Mulai percakapan baru (+ New Chat)"
            aria-label="New Chat"
          >
            <span class="btn-icon">+</span>
            <span class="btn-text">New</span>
          </button>

          <button
            type="button"
            class="panel-icon-btn history-btn"
            class:active={agentsStore.isHistoryOpen}
            onclick={() => agentsStore.toggleHistory()}
            title="Lihat riwayat percakapan sebelumnya"
            aria-label="History Sessions"
          >
            ⏱️
            {#if agentsStore.savedSessions.length > 0}
              <span class="history-count">{agentsStore.savedSessions.length}</span>
            {/if}
          </button>
        </div>
      </div>

      <div class="primary-right agent-header-actions">
        <!-- Back to Chat when on secondary views -->
        {#if activeSubTab !== 'chat'}
          <button
            class="subtab-btn back-chat"
            onclick={() => (activeSubTab = 'chat')}
            title="Kembali ke Chat"
          >
            ← Chat
          </button>
        {/if}

        <!-- Concise Subtabs: Chat, Lanes & Diff (with hunk count badge) -->
        <div class="agent-subtab-group">
          <button
            class="subtab-btn"
            class:active={activeSubTab === 'chat'}
            onclick={() => (activeSubTab = 'chat')}
          >
            Chat
          </button>
          <button
            class="subtab-btn lanes"
            class:active={activeSubTab === 'lanes'}
            onclick={() => (activeSubTab = 'lanes')}
            title="Lanes Cockpit"
          >
            ⚡ Lanes
          </button>
          {#if pendingHunkCount > 0 || pendingProposalCount > 0 || activeSubTab === 'diff'}
            <button
              class="subtab-btn diff"
              class:active={activeSubTab === 'diff'}
              onclick={() => (activeSubTab = 'diff')}
              title="Proposed Edits"
            >
              Diff
              {#if pendingHunkCount > 0}
                <span class="diff-badge">{pendingHunkCount}</span>
              {:else if pendingProposalCount > 0}
                <span class="diff-badge">{pendingProposalCount}</span>
              {/if}
            </button>
          {/if}
        </div>

        <!-- Action group kanan: ⋯ More menu (Quota, Memory, Settings) dan ✕ Close button -->
        <div class="header-action-group">
          <!-- More Menu Dropdown: Quota, Memory, Settings -->
          <div class="more-menu-wrap">
            <button
              class="header-action-btn more-btn"
              class:active={isMoreMenuOpen || activeSubTab === 'quota' || activeSubTab === 'memory'}
              onclick={() => (isMoreMenuOpen = !isMoreMenuOpen)}
              title="Menu Lainnya (Quota, Memory, Settings)"
              aria-label="More Options"
            >
              ⋯
            </button>

            {#if isMoreMenuOpen}
              <div class="more-menu-backdrop" onclick={() => (isMoreMenuOpen = false)} role="presentation"></div>
              <div class="more-menu-dropdown" role="menu" onclick={() => (isMoreMenuOpen = false)}>
                <button
                  class="more-menu-item"
                  class:active={activeSubTab === 'quota'}
                  onclick={() => (activeSubTab = 'quota')}
                  role="menuitem"
                  title="Quota & Usage"
                >
                  <span class="item-icon">📊</span>
                  <span>Quota & Usage</span>
                </button>
                <button
                  class="more-menu-item"
                  class:active={activeSubTab === 'memory'}
                  onclick={() => (activeSubTab = 'memory')}
                  role="menuitem"
                  title="Memory"
                >
                  <span class="item-icon">📓</span>
                  <span>Memory</span>
                </button>
                <div class="more-menu-divider"></div>
                <button
                  class="more-menu-item"
                  onclick={() => settingsStore.open('agents')}
                  role="menuitem"
                >
                  <span class="item-icon">⚙️</span>
                  <span>Pengaturan AI Agents</span>
                </button>
              </div>
            {/if}
          </div>

          <!-- Close Panel Button -->
          <button class="close-panel-btn" onclick={onClose} aria-label="Close Agents Panel" title="Tutup panel (⌘6)">
            ✕
          </button>
        </div>
      </div>
    </div>

    <!-- Baris 2: Context & Runtime Metadata Bar -->
    <div class="header-meta-row">
      <!-- Engine Badge -->
      <div
        class="dynamic-engine-badge"
        title="Engine: {formatEngineName(activeSlot?.config?.engine || activeSlot?.kind)}"
      >
        <span class="engine-pill-text">{formatEngineName(activeSlot?.config?.engine || activeSlot?.kind)}</span>
      </div>

      <!-- Dynamic Active Model Dropdown Selector (Interactive in-chat model switch) -->
      <div
        class="dynamic-model-badge interactive"
        class:claude={modelInfo.type === 'claude'}
        class:gemini={modelInfo.type === 'gemini'}
        class:ollama={modelInfo.type === 'ollama'}
        title="Klik untuk ganti model AI saat chat ({currentModelName})"
      >
        {#if modelInfo.type === 'claude'}
          <svg class="model-icon" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2L14.4 9.6L22 12L14.4 14.4L12 22L9.6 14.4L2 12L9.6 9.6L12 2Z" />
          </svg>
          <span class="model-name">Claude</span>
        {:else if modelInfo.type === 'gemini'}
          <svg class="model-icon" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2C12 7.52 7.52 12 2 12C7.52 12 12 16.48 12 22C12 16.48 16.48 12 22 12C16.48 12 12 7.52 12 2Z" />
          </svg>
          <span class="model-name">Gemini</span>
        {:else if modelInfo.type === 'ollama'}
          <svg class="model-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect width="18" height="12" x="3" y="6" rx="2" />
            <circle cx="9" cy="12" r="1" />
            <circle cx="15" cy="12" r="1" />
            <path d="M12 2v4" />
          </svg>
          <span class="model-name">Ollama</span>
        {:else}
          <span class="model-name">{modelInfo.name}</span>
        {/if}
        <select
          class="model-select-overlay"
          value={currentModelName}
          onchange={handleModelChange}
          aria-label="Pilih Model AI Saat Chat"
        >
          {#each ALL_PRESET_MODELS as m}
            <option value={m.id}>
              {m.name} ({m.id})
            </option>
          {/each}
        </select>
        <span class="dropdown-chevron">▾</span>
      </div>

      <!-- Tool Scoping Protection Indicator -->
      <div
        class="tool-scoping-badge"
        title="Least-privilege gateway aktif: {getRoleScopeBadge(activeSlotRole)}. {getRoleScopeDescription(activeSlotRole)}"
      >
        <span class="tool-scoping-text">🛡️ Tool Scoping: Active</span>
      </div>
    </div>
  </div>

  <!-- Main View Area (Full vertical space, no cramped tier stacked headers) -->
  <div class="panel-view-area">
    {#if agentsStore.isHistoryOpen}
      <div class="sessions-dropdown-backdrop" onclick={() => agentsStore.toggleHistory()} role="presentation">
        <div class="sessions-dropdown" onclick={(e) => e.stopPropagation()} role="dialog" aria-label="Riwayat Percakapan">
          <div class="sessions-header">
            <span class="sessions-title">Riwayat Percakapan ({agentsStore.savedSessions.length})</span>
            {#if agentsStore.savedSessions.length > 0}
              <button class="clear-all-sessions-btn" onclick={() => agentsStore.clearAllSessions()}>Hapus Semua</button>
            {/if}
          </div>
          <div class="sessions-list">
            {#if agentsStore.savedSessions.length === 0}
              <div class="empty-sessions">Belum ada riwayat percakapan yang tersimpan.</div>
            {:else}
              {#each agentsStore.savedSessions as sess (sess.id)}
                <div class="session-row" onclick={() => agentsStore.loadSession(sess)} role="button" tabindex="0">
                  <div class="session-info">
                    <div class="session-snippet">{sess.title}</div>
                    <div class="session-meta-line">
                      <span class="session-date">{new Date(sess.createdAt).toLocaleDateString()} {new Date(sess.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      <span class="session-msg-badge">{sess.messageCount} pesan</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    class="delete-session-btn"
                    onclick={(e) => { e.stopPropagation(); agentsStore.deleteSession(sess.id); }}
                    title="Hapus sesi ini"
                  >
                    🗑️
                  </button>
                </div>
              {/each}
            {/if}
          </div>
        </div>
      </div>
    {/if}

    {#if activeSubTab === 'chat'}
      <AgentChat />
    {:else if activeSubTab === 'lanes'}
      <WorktreeLanes />
    {:else if activeSubTab === 'diff'}
      <ProposedEdits />
    {:else if activeSubTab === 'quota'}
      <QuotaUsageView />
    {:else if activeSubTab === 'memory'}
      <MemoryView />
    {/if}
  </div>

  {#if activeSubTab === 'chat' || activeSubTab === 'diff' || activeSubTab === 'lanes'}
    <!-- Honest Usage Meter Footer (24px) -->
    <div class="usage-meter-footer">
      <div class="footer-agent-badges">
        <span class="footer-engine-badge">{formatEngineName(activeSlot?.config?.engine || activeSlot?.kind)}</span>
        <span class="footer-model-badge">{currentModelName}</span>
        <span class="footer-scoping-badge" title={getRoleScopeDescription(activeSlotRole)}>{getRoleScopeBadge(activeSlotRole)}</span>
      </div>
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
    border-left: 1px solid rgba(255, 255, 255, 0.06);
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

  /* Clean Responsive 2-Row Header (Linear / Raycast Style) */
  .agent-unified-header,
  .panel-header {
    display: flex;
    flex-direction: column;
    background: #121317;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    flex-shrink: 0;
    box-sizing: border-box;
    width: 100%;
  }

  /* Baris 1: Top Navigation & Primary Actions */
  .header-primary-row {
    height: 38px;
    min-height: 38px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    padding: 0 8px;
    box-sizing: border-box;
    width: 100%;
  }

  .primary-left,
  .header-left {
    display: flex;
    align-items: center;
    gap: 5px;
    min-width: 0;
    flex: 1 1 auto;
    overflow: hidden;
  }

  .primary-right,
  .agent-header-actions {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
  }

  .header-action-group {
    display: flex;
    align-items: center;
    gap: 2px;
    flex-shrink: 0;
  }

  /* Baris 2: Context & Runtime Metadata Bar */
  .header-meta-row {
    height: 28px;
    min-height: 28px;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 8px;
    background: rgba(0, 0, 0, 0.2);
    border-top: 1px solid rgba(255, 255, 255, 0.03);
    box-sizing: border-box;
    width: 100%;
    overflow-x: auto;
    scrollbar-width: none;
    -ms-overflow-style: none;
  }

  .header-meta-row::-webkit-scrollbar {
    display: none;
  }

  /* Hermes Bot Dropdown Selector */
  .bot-selector-wrap {
    position: relative;
    display: flex;
    align-items: center;
    min-width: 0;
    flex-shrink: 1;
    max-width: 130px;
  }

  .bot-select-dropdown {
    background: #181920;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 4px;
    color: #f1f2f4;
    font-size: 11px;
    font-weight: 600;
    padding: 3px 18px 3px 6px;
    width: 100%;
    max-width: 130px;
    outline: none;
    cursor: pointer;
    text-overflow: ellipsis;
    white-space: nowrap;
    overflow: hidden;
    transition: all 0.12s ease;
  }

  .bot-select-dropdown:hover {
    border-color: rgba(255, 255, 255, 0.16);
    background: #1f2129;
  }

  .runtime-status-dot {
    position: absolute;
    right: 6px;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    pointer-events: none;
    background: #10b981;
  }

  .runtime-status-dot.busy {
    background: #3b82f6;
    box-shadow: 0 0 6px #3b82f6;
    animation: dotPulse 1.2s infinite;
  }

  .runtime-status-dot.ready {
    background: #10b981;
  }

  @keyframes dotPulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.5; transform: scale(0.85); }
  }

  /* Dynamic Engine Badge */
  .dynamic-engine-badge {
    display: inline-flex;
    align-items: center;
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 10px;
    font-weight: 600;
    border: 1px solid rgba(59, 130, 246, 0.25);
    background: rgba(59, 130, 246, 0.08);
    color: #60a5fa;
    flex-shrink: 0;
    white-space: nowrap;
  }

  .engine-pill-text {
    line-height: 1;
    white-space: nowrap;
  }

  /* Dynamic Active Model Badge */
  .dynamic-model-badge {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 3px;
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 10px;
    font-weight: 600;
    border: 1px solid rgba(255, 255, 255, 0.08);
    background: rgba(255, 255, 255, 0.04);
    color: #9da1ad;
    flex-shrink: 0;
    white-space: nowrap;
  }

  .dynamic-model-badge.interactive {
    cursor: pointer;
    padding-right: 12px;
    transition: all 0.12s;
  }

  .dynamic-model-badge.interactive:hover {
    border-color: rgba(255, 255, 255, 0.2);
    background: rgba(255, 255, 255, 0.08);
  }

  .model-select-overlay {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    opacity: 0;
    cursor: pointer;
  }

  .dropdown-chevron {
    font-size: 8px;
    margin-left: 2px;
    opacity: 0.6;
  }

  /* Tool Scoping Status Indicator */
  .tool-scoping-badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 10px;
    font-weight: 600;
    border: 1px solid rgba(16, 185, 129, 0.3);
    background: rgba(16, 185, 129, 0.08);
    color: #34d399;
    flex-shrink: 0;
    cursor: default;
    white-space: nowrap;
  }

  .tool-scoping-text {
    line-height: 1;
    white-space: nowrap;
  }

  .footer-scoping-badge {
    font-size: 9px;
    color: #34d399;
    background: rgba(16, 185, 129, 0.08);
    border: 1px solid rgba(16, 185, 129, 0.25);
    padding: 1px 5px;
    border-radius: 3px;
    white-space: nowrap;
  }

  .session-actions-group {
    display: flex;
    align-items: center;
    gap: 3px;
    flex-shrink: 0;
  }

  .panel-icon-btn {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    height: 22px;
    padding: 0 5px;
    background: #181920;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 4px;
    color: #c9cdd4;
    font-size: 10.5px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.1s;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .panel-icon-btn:hover {
    background: #23252e;
    color: #f1f2f4;
    border-color: rgba(255, 255, 255, 0.18);
  }

  .panel-icon-btn.new-chat-btn {
    color: #60a5fa;
    border-color: rgba(59, 130, 246, 0.3);
    background: rgba(59, 130, 246, 0.08);
  }

  .panel-icon-btn.new-chat-btn:hover {
    background: rgba(59, 130, 246, 0.18);
    color: #93c5fd;
  }

  .panel-icon-btn.history-btn.active {
    background: #2a2d38;
    color: #f59e0b;
    border-color: rgba(245, 158, 11, 0.4);
  }

  .history-count {
    font-size: 8.5px;
    background: #334155;
    color: #f1f5f9;
    border-radius: 6px;
    padding: 0 3px;
    font-weight: 700;
  }

  .sessions-dropdown-backdrop {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    z-index: 50;
    display: flex;
    flex-direction: column;
  }

  .sessions-dropdown {
    background: #181920;
    border-bottom: 1px solid rgba(255, 255, 255, 0.12);
    box-shadow: 0 12px 28px rgba(0, 0, 0, 0.6);
    max-height: 280px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .sessions-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 10px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    background: #14151a;
  }

  .sessions-title {
    font-size: 10.5px;
    font-weight: 700;
    color: #94a3b8;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .clear-all-sessions-btn {
    background: transparent;
    border: none;
    color: #ef4444;
    font-size: 10px;
    cursor: pointer;
    padding: 2px 4px;
  }

  .clear-all-sessions-btn:hover {
    text-decoration: underline;
  }

  .sessions-list {
    overflow-y: auto;
    padding: 4px 6px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .empty-sessions {
    padding: 18px 12px;
    text-align: center;
    color: #64748b;
    font-size: 11px;
    font-style: italic;
  }

  .session-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 5px 7px;
    background: #121318;
    border: 1px solid rgba(255, 255, 255, 0.05);
    border-radius: 4px;
    cursor: pointer;
    transition: all 0.1s;
  }

  .session-row:hover {
    background: #1e2029;
    border-color: rgba(59, 130, 246, 0.3);
  }

  .session-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    flex: 1;
  }

  .session-snippet {
    font-size: 11px;
    color: #e2e8f0;
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .session-meta-line {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 9.5px;
    color: #64748b;
  }

  .session-msg-badge {
    background: rgba(255, 255, 255, 0.06);
    padding: 1px 3px;
    border-radius: 3px;
  }

  .delete-session-btn {
    background: transparent;
    border: none;
    color: #64748b;
    cursor: pointer;
    padding: 3px;
    border-radius: 3px;
    opacity: 0.6;
    transition: opacity 0.1s;
  }

  .delete-session-btn:hover {
    opacity: 1;
    background: rgba(239, 68, 68, 0.15);
  }

  .dynamic-model-badge.claude {
    color: #f59e0b;
    border-color: rgba(245, 158, 11, 0.3);
    background: rgba(245, 158, 11, 0.1);
  }

  .dynamic-model-badge.gemini {
    color: #10b981;
    border-color: rgba(16, 185, 129, 0.3);
    background: rgba(16, 185, 129, 0.1);
  }

  .dynamic-model-badge.ollama {
    color: #06b6d4;
    border-color: rgba(6, 182, 212, 0.3);
    background: rgba(6, 182, 212, 0.1);
  }

  .model-icon {
    width: 10px;
    height: 10px;
    flex-shrink: 0;
  }

  .agent-header-actions {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
  }

  /* Subtabs Group */
  .agent-subtab-group {
    display: flex;
    background: #18191f;
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 4px;
    padding: 2px;
    gap: 1px;
  }

  .subtab-btn {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    background: transparent;
    border: none;
    border-radius: 3px;
    padding: 2px 6px;
    font-size: 11px;
    font-weight: 500;
    color: #8b949e;
    cursor: pointer;
    white-space: nowrap;
    transition: all 0.12s;
  }

  .subtab-btn:hover {
    color: #e6edf3;
  }

  .subtab-btn.active {
    background: #22242c;
    color: #f1f2f4;
    font-weight: 600;
  }

  .diff-badge {
    background: #f59e0b;
    color: #000;
    font-size: 9px;
    font-weight: 700;
    padding: 1px 4px;
    border-radius: 8px;
    margin-left: 2px;
  }

  .subtab-btn.back-chat {
    color: #60a5fa;
    background: rgba(59, 130, 246, 0.1);
    border: 1px solid rgba(59, 130, 246, 0.25);
    font-weight: 600;
  }

  .subtab-btn.back-chat:hover {
    background: rgba(59, 130, 246, 0.2);
    color: #93c5fd;
  }

  /* More Menu Dropdown */
  .more-menu-wrap {
    position: relative;
    display: inline-flex;
    align-items: center;
  }

  .header-action-btn.more-btn {
    font-size: 14px;
    line-height: 1;
    font-weight: 700;
    padding: 2px 6px;
    color: #8b949e;
  }

  .header-action-btn.more-btn:hover,
  .header-action-btn.more-btn.active {
    color: #f1f2f4;
    background: rgba(255, 255, 255, 0.08);
  }

  .more-menu-backdrop {
    position: fixed;
    inset: 0;
    z-index: 99;
  }

  .more-menu-dropdown {
    position: absolute;
    top: calc(100% + 4px);
    right: 0;
    min-width: 190px;
    background: #181920;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 6px;
    box-shadow: 0 10px 28px rgba(0, 0, 0, 0.6);
    padding: 4px;
    z-index: 100;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .more-menu-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    background: transparent;
    border: none;
    border-radius: 4px;
    color: #c9cdd4;
    font-size: 11.5px;
    cursor: pointer;
    text-align: left;
    transition: all 0.1s;
    width: 100%;
    box-sizing: border-box;
  }

  .more-menu-item:hover {
    background: #23252e;
    color: #f1f2f4;
  }

  .more-menu-item.active {
    background: rgba(59, 130, 246, 0.15);
    color: #60a5fa;
    font-weight: 600;
  }

  .more-menu-item .item-icon {
    font-size: 12px;
  }

  .more-menu-divider {
    height: 1px;
    background: rgba(255, 255, 255, 0.06);
    margin: 3px 0;
  }

  .header-action-btn,
  .close-panel-btn {
    background: transparent;
    border: none;
    color: #8b949e;
    cursor: pointer;
    font-size: 12px;
    padding: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
  }

  .header-action-btn:hover,
  .close-panel-btn:hover {
    color: #ffffff;
    background: rgba(255, 255, 255, 0.06);
  }

  .panel-view-area {
    position: relative;
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }

  .usage-meter-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 24px;
    padding: 0 10px;
    background: #111215;
    border-top: 1px solid rgba(255, 255, 255, 0.06);
    font-size: 10px;
    font-family: monospace;
    flex-shrink: 0;
  }

  .footer-agent-badges {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-right: 8px;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .footer-engine-badge {
    color: #60a5fa;
    font-weight: 600;
  }

  .footer-model-badge {
    color: #a1a1aa;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .usage-text {
    color: #8b949e;
    min-width: 0;
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
    gap: 8px;
    font-size: 13px;
    font-weight: 600;
    color: #ff7b72;
  }

  .warning-body {
    font-size: 11px;
    color: #c9d1d9;
    line-height: 1.4;
  }

  .warning-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 4px;
  }

  .warn-btn {
    border: none;
    border-radius: 4px;
    padding: 5px 10px;
    font-size: 11px;
    font-weight: 500;
    cursor: pointer;
  }

  .warn-btn.cancel {
    background: #30363d;
    color: #c9d1d9;
  }

  .warn-btn.confirm-full {
    background: #da3633;
    color: #ffffff;
  }
</style>
