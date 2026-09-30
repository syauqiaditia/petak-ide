<script lang="ts">
  import { agentsStore } from './agents.svelte';
  import type { PermissionMode } from './types';

  let currentSlot = $derived(agentsStore.activeSlot);
  let slots = $derived(agentsStore.slots);

  function getStatusColor(status: any): string {
    const s = typeof status === 'string' ? status : 'failed';
    switch (s) {
      case 'ready':
        return '#7fc98f';
      case 'busy':
      case 'starting':
        return '#6ea8ff';
      case 'stopped':
      case 'crashed':
      case 'failed':
        return '#f07a74';
      case 'idle':
      default:
        return '#8b8f98';
    }
  }

  function handlePermissionChange(e: Event) {
    const select = e.target as HTMLSelectElement;
    if (!currentSlot) return;
    const mode = select.value as PermissionMode;
    agentsStore.setPermissionMode(currentSlot.id, mode);
  }
</script>

<div class="agent-tabs-container">
  <!-- Slot Tabs Row (36px) -->
  <div class="tabs-row">
    <div class="slots-list" role="tablist">
      {#each slots as slot (slot.id)}
        {@const isActive = slot.id === agentsStore.activeSlotId}
        {@const statusColor = getStatusColor(slot.status)}
        <button
          class="slot-tab-btn"
          class:active={isActive}
          role="tab"
          aria-selected={isActive}
          onclick={() => agentsStore.selectSlot(slot.id)}
          title="{slot.label} ({slot.kind}) - {typeof slot.status === 'string' ? slot.status : 'error'}"
        >
          <span class="status-dot" style:background={statusColor} class:pulse={slot.status === 'busy'}></span>
          <span class="slot-label">{slot.label}</span>
          {#if slot.kind === 'hermes'}
            <span class="kind-tag hermes">H</span>
          {:else if slot.kind === 'claude-code'}
            <span class="kind-tag claude">C</span>
          {:else}
            <span class="kind-tag custom">A</span>
          {/if}
        </button>
      {/each}

      {#if slots.length === 0}
        <div class="no-slots-tab">Belum ada agen</div>
      {/if}
    </div>

    <div class="tabs-actions">
      <button
        class="tab-action-btn"
        onclick={() => (agentsStore.isTeamEditorOpen = true)}
        title="Konfigurasi Tim Agen (.petak/team.json)"
        aria-label="Team Configuration"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="3"></circle>
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
        </svg>
      </button>
    </div>
  </div>

  <!-- Sub-header: Permission Mode + Discipline Toggles + Process RSS -->
  {#if currentSlot}
    {@const perm = (currentSlot.config?.permission || 'ask') as PermissionMode}
    <div class="slot-subbar">
      <!-- Permission Mode Selector -->
      <div class="perm-control">
        <span class="subbar-label">Izin:</span>
        <select
          class="perm-select"
          class:perm-read={perm === 'read'}
          class:perm-ask={perm === 'ask'}
          class:perm-auto={perm === 'auto'}
          class:perm-full={perm === 'full'}
          value={perm}
          onchange={handlePermissionChange}
          aria-label="Permission Mode"
        >
          <option value="read">Read-Only</option>
          <option value="ask">Ask Before Action</option>
          <option value="auto">Auto-Run Safe</option>
          <option value="full">FULL ACCESS ⚠️</option>
        </select>
      </div>

      <!-- Discipline Badges / Toggles -->
      <div class="discipline-group">
        <button
          class="discipline-badge"
          class:active={agentsStore.isPonytailActive}
          onclick={() => agentsStore.togglePonytail()}
          title="Toggle Ponytail: minimal diff, reuse existing code, no over-engineering"
        >
          PONYTAIL
        </button>

        <button
          class="discipline-badge"
          class:active={agentsStore.isCavemanActive}
          onclick={() => agentsStore.toggleCaveman()}
          title="Toggle Caveman: terse responses, eliminate filler prose"
        >
          CAVEMAN
        </button>
      </div>

      <!-- Process RSS / PID indicator -->
      <div class="rss-indicator" title="Active Process Info">
        {#if currentSlot.active_pid}
          <span class="pid-badge">PID {currentSlot.active_pid}</span>
        {:else}
          <span class="pid-badge idle">no-pid</span>
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .agent-tabs-container {
    display: flex;
    flex-direction: column;
    background: #111215;
    border-bottom: 1px solid #26282d;
    flex-shrink: 0;
  }

  .tabs-row {
    display: flex;
    height: 36px;
    align-items: center;
    border-bottom: 1px solid #1f2126;
  }

  .slots-list {
    display: flex;
    flex: 1;
    overflow-x: auto;
    scrollbar-width: none;
    height: 100%;
  }

  .slots-list::-webkit-scrollbar {
    display: none;
  }

  .slot-tab-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 12px;
    height: 100%;
    background: transparent;
    border: none;
    border-right: 1px solid #1c1d22;
    color: #8b949e;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    white-space: nowrap;
    transition: background 0.12s, color 0.12s;
  }

  .slot-tab-btn:hover {
    background: #16181d;
    color: #c9cdd4;
  }

  .slot-tab-btn.active {
    background: #1a1c22;
    color: #e6edf3;
    border-bottom: 2px solid #6ea8ff;
  }

  .status-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .status-dot.pulse {
    animation: pulse-dot 1.5s infinite;
  }

  @keyframes pulse-dot {
    0% { transform: scale(0.95); opacity: 0.8; }
    50% { transform: scale(1.3); opacity: 1; }
    100% { transform: scale(0.95); opacity: 0.8; }
  }

  .slot-label {
    max-width: 100px;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .kind-tag {
    font-size: 9px;
    font-weight: 700;
    padding: 1px 3px;
    border-radius: 3px;
  }

  .kind-tag.hermes {
    background: #2b223d;
    color: #b392f0;
  }

  .kind-tag.claude {
    background: #3b281c;
    color: #f08c5a;
  }

  .kind-tag.custom {
    background: #1c2b3d;
    color: #6ea8ff;
  }

  .no-slots-tab {
    padding: 0 12px;
    font-size: 11px;
    color: #6e7681;
    display: flex;
    align-items: center;
  }

  .tabs-actions {
    display: flex;
    align-items: center;
    padding: 0 6px;
  }

  .tab-action-btn {
    background: transparent;
    border: none;
    color: #8b949e;
    cursor: pointer;
    padding: 6px;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .tab-action-btn:hover {
    background: #1c1d22;
    color: #c9cdd4;
  }

  .slot-subbar {
    display: flex;
    align-items: center;
    padding: 4px 10px;
    gap: 8px;
    font-size: 11px;
    background: #131417;
  }

  .perm-control {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .subbar-label {
    color: #6e7681;
    font-size: 10px;
  }

  .perm-select {
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 10px;
    font-weight: 600;
    cursor: pointer;
    outline: none;
    border: 1px solid transparent;
  }

  .perm-read {
    background: #1a1b1f;
    color: #8b8f98;
    border-color: #2c2e34;
  }

  .perm-ask {
    background: #2e2717;
    color: #e8b45a;
    border-color: #4a3d22;
  }

  .perm-auto {
    background: #1c2b42;
    color: #6ea8ff;
    border-color: #2c3e60;
  }

  .perm-full {
    background: #3d1a1c;
    color: #f07a74;
    border-color: #d9534f;
    font-weight: 700;
  }

  .discipline-group {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .discipline-badge {
    font-size: 9px;
    font-weight: 700;
    padding: 2px 5px;
    border-radius: 3px;
    border: 1px solid #26282d;
    background: #1a1c22;
    color: #6e7681;
    cursor: pointer;
    transition: all 0.12s;
  }

  .discipline-badge:hover {
    border-color: #3b3f49;
    color: #c9cdd4;
  }

  .discipline-badge.active {
    background: #233428;
    border-color: #35573d;
    color: #7fc98f;
  }

  .rss-indicator {
    margin-left: auto;
    font-family: monospace;
    font-size: 10px;
  }

  .pid-badge {
    padding: 1px 4px;
    border-radius: 3px;
    background: #1c1e24;
    color: #79c0ff;
  }

  .pid-badge.idle {
    color: #6e7681;
  }
</style>
