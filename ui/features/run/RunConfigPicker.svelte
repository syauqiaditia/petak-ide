<script lang="ts">
  import { runStore } from './runStore.svelte';
  import { popupStore } from '../../shell/popupStore.svelte';

  let open = $derived(popupStore.isOpen('runner'));

  function toggleOpen(e: MouseEvent) {
    e.stopPropagation();
    popupStore.toggle('runner');
  }

  function handleSelect(name: string) {
    runStore.selectConfig(name);
    popupStore.close('runner');
  }

  function handleWindowClick() {
    if (open) popupStore.close('runner');
  }
</script>

<svelte:window onclick={handleWindowClick} />

<div class="config-picker">
  <button
    class="trigger-btn"
    onclick={toggleOpen}
    title={runStore.selectedConfig ? `Run config: ${runStore.selectedConfig.name} (${runStore.selectedConfig.kind})` : 'No run configuration'}
  >
    {#if runStore.selectedConfig}
      {@const kind = runStore.selectedConfig.kind}
      <span class="badge" class:badge-and={kind === 'gradle'} class:badge-flt={kind === 'flutter'}>
        {kind === 'gradle' ? 'AND' : 'FLT'}
      </span>
      <span class="config-name">{runStore.selectedConfig.name}</span>
    {:else}
      <span class="badge badge-none">NONE</span>
      <span class="config-name empty">No config</span>
    {/if}
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8b8f98" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M6 9l6 6 6-6"></path>
    </svg>
  </button>

  {#if open}
    <div
      class="dropdown-menu"
      role="menu"
      tabindex="-1"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => e.stopPropagation()}
    >
      <div class="menu-header">RUN CONFIGURATIONS</div>
      {#if runStore.configs.length === 0}
        <div class="menu-empty">No configurations found</div>
      {:else}
        {#each runStore.configs as config}
          {@const isSelected = runStore.selectedConfig?.name === config.name}
          <button
            class="menu-item"
            class:selected={isSelected}
            onclick={() => handleSelect(config.name)}
          >
            <span class="badge" class:badge-and={config.kind === 'gradle'} class:badge-flt={config.kind === 'flutter'}>
              {config.kind === 'gradle' ? 'AND' : 'FLT'}
            </span>
            <div class="item-text">
              <span class="item-title">{config.name}</span>
              {#if config.target || config.flavor || config.variant}
                <span class="item-desc">{config.target || config.flavor || config.variant}</span>
              {/if}
            </div>
            {#if isSelected}
              <svg class="check-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6ea8ff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M5 12l5 5 9-10"></path>
              </svg>
            {/if}
          </button>
        {/each}
      {/if}
    </div>
  {/if}
</div>

<style>
  .config-picker {
    position: relative;
    display: inline-block;
  }
  .trigger-btn {
    display: flex;
    align-items: center;
    gap: 7px;
    height: 30px;
    padding: 0 8px 0 6px;
    border-radius: 6px;
    background: transparent;
    border: none;
    cursor: pointer;
    font-size: 13px;
    color: #d8d9dc;
    transition: background 0.15s;
  }
  .trigger-btn:hover {
    background: #23252b;
  }
  .badge {
    font-size: 10px;
    font-weight: 600;
    color: #101114;
    border-radius: 4px;
    padding: 1px 5px;
    letter-spacing: 0.3px;
  }
  .badge-and {
    background: #7fc98f;
  }
  .badge-flt {
    background: #6ea8ff;
  }
  .badge-none {
    background: #3a3d45;
    color: #8b8f98;
  }
  .config-name {
    font-size: 13px;
    font-weight: 500;
    color: #e6e7ea;
    white-space: nowrap;
  }
  .config-name.empty {
    color: #8b8f98;
  }
  .dropdown-menu {
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    min-width: 220px;
    background: #1a1b1f;
    border: 1px solid #2c2e34;
    border-radius: 8px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
    z-index: 100;
    padding: 6px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .menu-header {
    font-size: 10px;
    font-weight: 600;
    color: #8b8f98;
    padding: 6px 8px 4px 8px;
    letter-spacing: 0.5px;
  }
  .menu-empty {
    font-size: 12px;
    color: #8b8f98;
    padding: 8px;
    text-align: center;
  }
  .menu-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    border-radius: 6px;
    background: transparent;
    border: none;
    color: #d8d9dc;
    cursor: pointer;
    text-align: left;
    transition: background 0.1s;
    width: 100%;
    box-sizing: border-box;
  }
  .menu-item:hover {
    background: #23252b;
  }
  .menu-item.selected {
    background: #1f2a3d;
  }
  .item-text {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .item-title {
    font-size: 12px;
    font-weight: 500;
    color: #e6e7ea;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .item-desc {
    font-size: 11px;
    color: #8b8f98;
  }
  .check-icon {
    margin-left: auto;
    flex-shrink: 0;
  }
</style>
