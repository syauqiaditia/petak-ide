<script lang="ts">
  import { onMount } from 'svelte';
  import { runStore } from './runStore.svelte';
  import {
    groupDevices,
    getDeviceStatusLabel,
    getDeviceTooltip,
    type PickerDeviceItem,
  } from './deviceLogic';
  import { popupStore } from '../../shell/popupStore.svelte';

  let open = $derived(popupStore.isOpen('device'));
  let isRefreshing = $state(false);

  async function handleRefreshDevices(e: MouseEvent) {
    e.stopPropagation();
    if (isRefreshing) return;
    isRefreshing = true;
    try {
      await runStore.refreshDevices();
    } finally {
      isRefreshing = false;
    }
  }

  onMount(() => {
    if (typeof window !== 'undefined' && window.location.search.includes('picker-open')) {
      popupStore.open('device');
    }
  });

  let { onOpenDevicesPanel } = $props<{
    onOpenDevicesPanel?: () => void;
  }>();

  function toggleOpen(e: MouseEvent) {
    e.stopPropagation();
    popupStore.toggle('device');
  }

  function handleSelect(id: string) {
    runStore.selectDevice(id);
    popupStore.close('device');
  }

  function handleWindowClick() {
    if (open) popupStore.close('device');
  }

  let grouped = $derived(
    groupDevices(runStore.snapshot, runStore.devices, runStore.avds)
  );

  let pickerItems = $derived(grouped.pickerItems);
  let emulatorItems = $derived(pickerItems.filter((i) => i.group === 'Emulator'));
  let simulatorItems = $derived(pickerItems.filter((i) => i.group === 'Simulator'));
  let physicalItems = $derived(pickerItems.filter((i) => i.group === 'Physical'));
  let connectedPhysical = $derived(physicalItems.filter((i) => i.connection === 'connected'));
  let pairedPhysical = $derived(physicalItems.filter((i) => i.connection === 'paired'));
  let desktopAndWebItems = $derived(pickerItems.filter((i) => i.group === 'Desktop' || i.group === 'Web'));

  let activeItem = $derived(
    runStore.selectedDeviceId
      ? pickerItems.find((p) => p.id === runStore.selectedDeviceId && p.state === 'online' && p.connection === 'connected') || null
      : null
  );

  function formatDeviceLabel(name: string, sdk?: string): string {
    if (sdk) {
      return `${name} · API ${sdk}`;
    }
    return name;
  }
</script>

<svelte:window onclick={handleWindowClick} />

<div class="device-picker">
  <button
    class="trigger-btn"
    onclick={toggleOpen}
    title={activeItem ? `Device: ${formatDeviceLabel(activeItem.name, activeItem.sdk)} (${activeItem.state})` : 'No device connected'}
  >
    <svg class="device-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <rect x="7" y="3" width="10" height="18" rx="2"></rect>
      <path d="M11 18h2"></path>
    </svg>

    {#if activeItem}
      <span class="device-name">{formatDeviceLabel(activeItem.name, activeItem.sdk)}</span>
      <span class="status-dot online"></span>
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
      {#if pickerItems.length === 0}
        <div class="menu-empty">No device connected</div>
      {:else}
        <!-- Android Emulators Group -->
        {#if emulatorItems.length > 0}
          <div class="menu-header">EMULATORS (ANDROID)</div>
          {#each emulatorItems as item}
            {@const isSelected = activeItem?.id === item.id}
            <button
              class="menu-item"
              class:selected={isSelected}
              onclick={() => handleSelect(item.id)}
            >
              <span class="status-dot online"></span>
              <div class="item-text">
                <span class="item-title">{formatDeviceLabel(item.name, item.sdk)}</span>
                <span class="item-desc">Android Emulator · {item.id}</span>
              </div>
              {#if isSelected}
                <svg class="check-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6ea8ff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M5 12l5 5 9-10"></path>
                </svg>
              {/if}
            </button>
          {/each}
        {/if}

        <!-- iOS Simulators Group -->
        {#if simulatorItems.length > 0}
          <div class="menu-header" class:mt={emulatorItems.length > 0}>SIMULATORS (IOS)</div>
          {#each simulatorItems as item}
            {@const isSelected = activeItem?.id === item.id}
            <button
              class="menu-item"
              class:selected={isSelected}
              onclick={() => handleSelect(item.id)}
            >
              <span class="status-dot online"></span>
              <div class="item-text">
                <span class="item-title">{item.name}</span>
                <span class="item-desc">iOS Simulator · {item.id}</span>
              </div>
              {#if isSelected}
                <svg class="check-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6ea8ff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M5 12l5 5 9-10"></path>
                </svg>
              {/if}
            </button>
          {/each}
        {/if}

        <!-- Physical Devices (Connected) -->
        {#if connectedPhysical.length > 0}
          <div class="menu-header" class:mt={emulatorItems.length > 0 || simulatorItems.length > 0}>PHYSICAL DEVICES</div>
          {#each connectedPhysical as item}
            {@const isSelected = activeItem?.id === item.id}
            {@const statusLabel = getDeviceStatusLabel(item)}
            {@const tooltip = getDeviceTooltip(item)}
            <button
              class="menu-item"
              class:selected={isSelected}
              onclick={() => handleSelect(item.id)}
              title={tooltip}
            >
              <span class="status-dot online"></span>
              <div class="item-text">
                <span class="item-title">{formatDeviceLabel(item.name, item.sdk)}</span>
                <span class="item-desc">
                  {item.platform === 'ios' ? 'iPhone' : 'Android'} Physical · {statusLabel} · {item.id}
                </span>
              </div>
              {#if isSelected}
                <svg class="check-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6ea8ff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M5 12l5 5 9-10"></path>
                </svg>
              {/if}
            </button>
          {/each}
        {/if}

        <!-- Desktop & Web Group -->
        {#if desktopAndWebItems.length > 0}
          <div class="menu-header" class:mt={emulatorItems.length > 0 || simulatorItems.length > 0 || connectedPhysical.length > 0}>DESKTOP & WEB</div>
          {#each desktopAndWebItems as item}
            {@const isSelected = activeItem?.id === item.id}
            <button
              class="menu-item"
              class:selected={isSelected}
              onclick={() => handleSelect(item.id)}
            >
              <span class="status-dot online"></span>
              <div class="item-text">
                <span class="item-title">{item.name}</span>
                <span class="item-desc">{item.group} · {item.id}</span>
              </div>
              {#if isSelected}
                <svg class="check-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6ea8ff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M5 12l5 5 9-10"></path>
                </svg>
              {/if}
            </button>
          {/each}
        {/if}

        <!-- Paired but Not Connected / Locked Devices -->
        {#if pairedPhysical.length > 0}
          <div class="menu-header mt not-connected">NOT CONNECTED</div>
          {#each pairedPhysical as item}
            {@const statusLabel = getDeviceStatusLabel(item)}
            {@const tooltip = getDeviceTooltip(item)}
            {@const isLocked = item.connState === 'locked'}
            <div
              class="menu-item paired"
              class:locked={isLocked}
              title={tooltip}
              role="button"
              tabindex="-1"
            >
              <span class="status-dot" class:paired={!isLocked} class:locked={isLocked}></span>
              <div class="item-text">
                <span class="item-title">{formatDeviceLabel(item.name, item.sdk)}</span>
                <span class="item-desc">
                  {item.platform === 'ios' ? 'iPhone' : 'Android'} · {statusLabel}
                </span>
              </div>
              <span class="paired-tag" class:locked-tag={isLocked}>{isLocked ? 'Locked' : 'Paired'}</span>
            </div>
          {/each}
        {/if}
      {/if}

      <div class="divider"></div>
      <div class="menu-footer-actions">
        <button
          class="menu-action-btn refresh-btn"
          onclick={handleRefreshDevices}
          disabled={isRefreshing}
          title="Refresh devices (panggil devices_refresh)"
        >
          <svg class:spin={isRefreshing} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"></path>
          </svg>
          {isRefreshing ? 'Refreshing…' : 'Refresh Devices'}
        </button>

        {#if onOpenDevicesPanel}
          <button
            class="menu-action-btn"
            onclick={() => {
              popupStore.close('device');
              onOpenDevicesPanel();
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
              <rect x="7" y="3" width="10" height="18" rx="2"></rect>
              <path d="M11 18h2"></path>
            </svg>
            Manage Devices & Emulators…
          </button>
        {/if}
      </div>
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
    font-weight: 400;
  }
  .status-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .status-dot.online {
    background: #7fc98f;
  }
  .status-dot.paired {
    background: #8b8f98;
  }
  .status-dot.locked {
    background: #e8b45a;
  }
  .dropdown-menu {
    position: absolute;
    top: calc(100% + 4px);
    right: 0;
    width: 290px;
    background: #1e2025;
    border: 1px solid #34363d;
    border-radius: 8px;
    box-shadow: 0 10px 28px rgba(0, 0, 0, 0.45);
    padding: 6px 0;
    z-index: 1000;
    max-height: 420px;
    overflow-y: auto;
  }
  .menu-header {
    font-size: 10.5px;
    font-weight: 600;
    color: #727680;
    padding: 6px 12px 3px;
    letter-spacing: 0.5px;
  }
  .menu-header.mt {
    margin-top: 6px;
    border-top: 1px solid #282a30;
    padding-top: 8px;
  }
  .menu-header.not-connected {
    color: #8b8f98;
  }
  .menu-empty {
    padding: 12px 16px;
    font-size: 12.5px;
    color: #8b8f98;
    text-align: center;
  }
  .menu-item {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 7px 12px;
    background: transparent;
    border: none;
    cursor: pointer;
    text-align: left;
    transition: background 0.12s;
  }
  .menu-item:hover {
    background: #26282f;
  }
  .menu-item.selected {
    background: #253347;
  }
  .menu-item.paired {
    opacity: 0.65;
    cursor: not-allowed;
  }
  .menu-item.paired:hover {
    background: transparent;
  }
  .paired-tag {
    font-size: 10px;
    color: #8b8f98;
    background: #282a30;
    padding: 1px 6px;
    border-radius: 4px;
    flex-shrink: 0;
  }
  .locked-tag {
    color: #e8b45a;
    background: #322818;
  }
  .spin {
    animation: spin 1s linear infinite;
  }
  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
  .item-text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .item-title {
    font-size: 12.5px;
    color: #e6e7ea;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .item-desc {
    font-size: 10.5px;
    color: #8b8f98;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .check-icon {
    flex-shrink: 0;
  }
  .divider {
    height: 1px;
    background: #282a30;
    margin: 6px 0;
  }
  .menu-action-btn {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 12px;
    background: transparent;
    border: none;
    color: #9aa0a6;
    font-size: 12px;
    cursor: pointer;
    text-align: left;
    transition: background 0.12s, color 0.12s;
  }
  .menu-action-btn:hover {
    background: #26282f;
    color: #e6e7ea;
  }
</style>
