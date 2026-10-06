<script lang="ts">
  import { panelStore } from './panelStore.svelte';
  import MemoryView from '../features/agents/MemoryView.svelte';

  let {
    AgentsPanelComponent,
    DeviceMirrorPanelComponent,
    DevicesPanelComponent,
    onOpenLogcat,
  } = $props<{
    AgentsPanelComponent?: any;
    DeviceMirrorPanelComponent?: any;
    DevicesPanelComponent?: any;
    onOpenLogcat?: () => Promise<void> | void;
  }>();
</script>

<div class="right-panel-dock">
  {#if panelStore.activeRightPanel === 'agent'}
    {#if AgentsPanelComponent}
      <AgentsPanelComponent onClose={() => panelStore.closeRightPanel()} />
    {:else}
      <div class="agent-panel-slot">
        <div class="agent-toolbar-top">
          <span class="agent-title">AI Agents</span>
          <button class="agent-close-btn" onclick={() => panelStore.closeRightPanel()}>✕</button>
        </div>
      </div>
    {/if}
  {:else if panelStore.activeRightPanel === 'memory'}
    <div class="right-memory-dock" style="width: 480px; display: flex; flex-direction: column; height: 100%; border-left: 1px solid #26282d; background: #121317; z-index: 5;">
      <div style="height: 38px; display: flex; align-items: center; justify-content: space-between; padding: 0 12px; border-bottom: 1px solid #26282d; background: #16171b;">
        <div style="font-weight: 600; font-size: 12.5px; color: #d8d9dc; display: flex; align-items: center; gap: 6px;">
          <span>📓 Project Memory (Obsidian Vault)</span>
        </div>
        <button class="agent-close-btn" onclick={() => panelStore.closeRightPanel()} title="Tutup Panel Memory">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"></path></svg>
        </button>
      </div>
      <div style="flex: 1; overflow: hidden; display: flex; flex-direction: column;">
        <MemoryView />
      </div>
    </div>
  {:else if panelStore.activeRightPanel === 'mirror' && DeviceMirrorPanelComponent}
    <DeviceMirrorPanelComponent
      onSelectDevice={() => panelStore.openRightPanel('devices')}
      onOpenLogcat={onOpenLogcat}
      onClose={() => panelStore.closeRightPanel()}
    />
  {:else if panelStore.activeRightPanel === 'devices' && DevicesPanelComponent}
    <div class="right-devices-panel">
      <DevicesPanelComponent onClose={() => panelStore.closeRightPanel()} />
    </div>
  {/if}
</div>

<style>
  .right-panel-dock {
    display: flex;
    height: 100%;
    min-height: 0;
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
</style>
