<script lang="ts">
  import { runStore } from './runStore.svelte';
  import type { Device } from '../../lib/api';

  let open = $state(false);

  let { onOpenDevicesPanel } = $props<{
    onOpenDevicesPanel?: () => void;
  }>();

  function toggleOpen(e: MouseEvent) {
    e.stopPropagation();
    open = !open;
  }

  function handleSelect(id: string) {
    runStore.selectDevice(id);
    open = false;
  }

  function handleWindowClick() {
    if (open) open = false;
  }

  function getDotColor(device: Device): string {
    switch (device.state) {
      case 'online':
        return '#7fc98f'; // success green
      case 'booting':
        return '#e8b45a'; // warning yellow
      case 'offline':
      case 'unauthorized':
      default:
        return '#8b8f98'; // muted gray
    }
  }

  function formatDeviceLabel(device: Device): string {
    if (device.sdk) {
      return `${device.name} · API ${device.sdk}`;
    }
    return device.name;
  }
</script>

<svelte:window onclick={handleWindowClick} />

<div class="device-picker">
  <button
    class="trigger-btn"
    onclick={toggleOpen}
    title={runStore.selectedDevice ? `Device: ${formatDeviceLabel(runStore.selectedDevice)} (${runStore.selectedDevice.state})` : 'No device connected'}
  >
    <svg class="device-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <rect x="7" y="3" width="10" height="18" rx="2"></rect>
      <path d="M11 18h2"></path>
    </svg>

    {#if runStore.selectedDevice}
      <span class="device-name">{formatDeviceLabel(runStore.selectedDevice)}</span>
      <span class="status-dot" style:background={getDotColor(runStore.selectedDevice)}></span>
    {:else}
      <span class="device-name empty">No device</span>
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
      <div class="menu-header">CONNECTED DEVICES</div>
      {#if runStore.devices.length === 0}
        <div class="menu-empty">No device connected</div>
      {:else}
        {#each runStore.devices as device}
          {@const isSelected = runStore.selectedDevice?.id === device.id}
          <button
            class="menu-item"
            class:selected={isSelected}
            onclick={() => handleSelect(device.id)}
          >
            <span class="status-dot" style:background={getDotColor(device)}></span>
            <div class="item-text">
              <span class="item-title">{formatDeviceLabel(device)}</span>
              <span class="item-desc">{device.kind} · {device.platform} · {device.state}</span>
            </div>
            {#if isSelected}
              <svg class="check-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6ea8ff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M5 12l5 5 9-10"></path>
              </svg>
            {/if}
          </button>
        {/each}
      {/if}

      {#if runStore.avds.length > 0}
        <div class="divider"></div>
        <div class="menu-header">AVAILABLE EMULATORS</div>
        {#each runStore.avds as avd}
          <div class="avd-row">
            <span class="avd-name">{avd.name}</span>
            <button
              class="avd-start-btn"
              onclick={() => {
                runStore.startEmulator(avd.name);
                open = false;
              }}
            >
              Start
            </button>
          </div>
        {/each}
      {/if}

      {#if onOpenDevicesPanel}
        <div class="divider"></div>
        <button
          class="menu-action-btn"
          onclick={() => {
            open = false;
            onOpenDevicesPanel?.();
          }}
        >
          Manage Devices & Emulators...
        </button>
      {/if}
    </div>
  {/if}
</div>

<style>
  .device-picker {
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
  .device-icon {
    color: #b9bcc3;
    flex-shrink: 0;
  }
  .device-name {
    font-size: 13px;
    font-weight: 500;
    color: #e6e7ea;
    white-space: nowrap;
    max-width: 140px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .device-name.empty {
    color: #8b8f98;
  }
  .status-dot {
    width: 7px;
    height: 7px;
    border-radius: 4px;
    flex-shrink: 0;
  }
  .dropdown-menu {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    min-width: 250px;
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
  .divider {
    height: 1px;
    background: #26282d;
    margin: 4px 0;
  }
  .avd-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 5px 8px;
    border-radius: 6px;
    font-size: 12px;
  }
  .avd-row:hover {
    background: #23252b;
  }
  .avd-name {
    color: #d8d9dc;
    font-family: 'JetBrains Mono', monospace;
    font-size: 11px;
  }
  .avd-start-btn {
    padding: 2px 8px;
    border-radius: 4px;
    background: #1f3325;
    color: #7fc98f;
    border: 1px solid #284431;
    font-size: 11px;
    cursor: pointer;
    transition: background 0.15s;
  }
  .avd-start-btn:hover {
    background: #284431;
  }
  .menu-action-btn {
    padding: 6px 8px;
    border-radius: 6px;
    background: transparent;
    border: none;
    color: #6ea8ff;
    font-size: 11px;
    text-align: left;
    cursor: pointer;
  }
  .menu-action-btn:hover {
    background: #1f2a3d;
  }
</style>
