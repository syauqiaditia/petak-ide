<script lang="ts">
  import { runStore } from './runStore.svelte';
  import type { Device } from '../../lib/api';

  function getDotColor(device: Device): string {
    switch (device.state) {
      case 'online':
        return '#7fc98f';
      case 'booting':
        return '#e8b45a';
      case 'offline':
      case 'unauthorized':
      default:
        return '#8b8f98';
    }
  }

  function isAvdRunning(avdName: string): boolean {
    const normAvd = avdName.replace(/_/g, ' ').toLowerCase();
    return runStore.devices.some((d) => {
      const normDev = d.name.toLowerCase();
      const normId = d.id.toLowerCase();
      return (
        normDev.includes(normAvd) ||
        normAvd.includes(normDev) ||
        normId.includes(avdName.toLowerCase())
      );
    });
  }
</script>

<div class="devices-panel">
  <div class="header">
    <span class="header-title">DEVICES & EMULATORS</span>
    <button class="refresh-btn" onclick={() => runStore.refreshDevices()} title="Refresh devices and AVDs">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5"></path>
      </svg>
    </button>
  </div>

  <div class="content-scroll">
    <!-- Connected Devices Section -->
    <div class="section-title">
      CONNECTED DEVICES ({runStore.devices.length})
    </div>

    {#if runStore.devices.length === 0}
      <div class="empty-state">
        <span>No device connected</span>
        <span class="subtext">Connect via USB or start an emulator below.</span>
      </div>
    {:else}
      <div class="device-list">
        {#each runStore.devices as device}
          {@const isSelected = runStore.selectedDeviceId === device.id}
          <div
            class="device-card"
            class:selected={isSelected}
            onclick={() => runStore.selectDevice(device.id)}
            role="button"
            tabindex="0"
            onkeydown={(e) => { if (e.key === 'Enter') runStore.selectDevice(device.id); }}
          >
            <div class="device-header">
              <span class="status-dot" style:background={getDotColor(device)}></span>
              <span class="device-name">
                {device.name}{device.sdk ? ` · API ${device.sdk}` : ''}
              </span>
              {#if isSelected}
                <span class="active-badge">Active</span>
              {/if}
            </div>
            <div class="device-meta">
              <span>{device.platform}</span>
              <span>•</span>
              <span>{device.kind}</span>
              <span>•</span>
              <span class="mono-id">{device.id}</span>
            </div>
          </div>
        {/each}
      </div>
    {/if}

    <!-- Emulators / AVD Section -->
    <div class="section-title">
      VIRTUAL DEVICES (AVD) ({runStore.avds.length})
    </div>

    {#if runStore.avdsLoading}
      <div class="loading-state">Loading AVDs...</div>
    {:else if runStore.avds.length === 0}
      <div class="empty-state">
        <span>No AVD found</span>
        <span class="subtext">Create an AVD via Android Studio or avdmanager.</span>
      </div>
    {:else}
      <div class="avd-list">
        {#each runStore.avds as avd}
          {@const running = isAvdRunning(avd.name)}
          <div class="avd-card">
            <div class="avd-info">
              <span class="avd-name">{avd.name}</span>
              <span class="avd-status" class:running>{running ? 'Online' : 'Stopped'}</span>
            </div>
            <button
              class="avd-action-btn"
              class:running
              disabled={running}
              onclick={() => runStore.startEmulator(avd.name)}
            >
              {#if running}
                Running
              {:else}
                <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M7 5l12 7-12 7z"></path>
                </svg>
                Start
              {/if}
            </button>
          </div>
        {/each}
      </div>
    {/if}

    <!-- Gradle Daemon status -->
    <div class="section-title">DAEMON STATUS</div>
    <div class="daemon-card">
      <div class="daemon-info">
        <span class="status-dot" style:background={runStore.gradleDaemon ? '#7fc98f' : '#8b8f98'}></span>
        <span class="daemon-label">Gradle Daemon:</span>
        <span class="daemon-val">{runStore.gradleDaemon ? 'Active' : 'Inactive'}</span>
      </div>
      {#if runStore.gradleDaemon}
        <button class="stop-daemon-btn" onclick={() => runStore.stopGradle()}>
          Stop
        </button>
      {/if}
    </div>
  </div>
</div>

<style>
  .devices-panel {
    width: 250px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    background: #141518;
    border-right: 1px solid #26282d;
    user-select: none;
    -webkit-user-select: none;
    overflow: hidden;
  }
  .header {
    height: 36px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 14px;
    border-bottom: 1px solid #1c1d22;
  }
  .header-title {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.8px;
    color: #8b8f98;
  }
  .refresh-btn {
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    border-radius: 4px;
    background: transparent;
    border: none;
    color: #8b8f98;
    cursor: pointer;
    transition: all 0.15s;
  }
  .refresh-btn:hover {
    color: #d8d9dc;
    background: #23252b;
  }
  .content-scroll {
    flex: 1;
    overflow-y: auto;
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .section-title {
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.5px;
    color: #666a73;
    padding-top: 4px;
  }
  .empty-state {
    padding: 12px;
    background: #17181c;
    border: 1px dashed #26282d;
    border-radius: 7px;
    font-size: 12px;
    color: #8b8f98;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .loading-state {
    padding: 12px;
    font-size: 12px;
    color: #8b8f98;
  }
  .subtext {
    font-size: 11px;
    color: #5b5f68;
    line-height: 15px;
  }
  .device-list, .avd-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .device-card {
    padding: 8px 10px;
    background: #17181c;
    border: 1px solid #26282d;
    border-radius: 7px;
    cursor: pointer;
    transition: all 0.15s;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .device-card:hover {
    background: #1c1e23;
    border-color: #33363e;
  }
  .device-card.selected {
    background: #192334;
    border-color: #34507b;
  }
  .device-header {
    display: flex;
    align-items: center;
    gap: 7px;
  }
  .status-dot {
    width: 6px;
    height: 6px;
    border-radius: 3px;
    flex-shrink: 0;
  }
  .device-name {
    font-size: 12px;
    font-weight: 500;
    color: #e6e7ea;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1;
  }
  .active-badge {
    font-size: 9px;
    font-weight: 600;
    color: #6ea8ff;
    background: #1f2a3d;
    padding: 1px 5px;
    border-radius: 3px;
  }
  .device-meta {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 10px;
    color: #8b8f98;
  }
  .mono-id {
    font-family: 'JetBrains Mono', monospace;
    font-size: 10px;
    color: #7a7e85;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .avd-card {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 10px;
    background: #17181c;
    border: 1px solid #26282d;
    border-radius: 7px;
  }
  .avd-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .avd-name {
    font-size: 12px;
    font-weight: 500;
    color: #d8d9dc;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .avd-status {
    font-size: 10px;
    color: #8b8f98;
  }
  .avd-status.running {
    color: #7fc98f;
  }
  .avd-action-btn {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 4px 8px;
    border-radius: 5px;
    font-size: 11px;
    font-weight: 500;
    background: #1f3325;
    color: #7fc98f;
    border: 1px solid #284431;
    cursor: pointer;
    transition: all 0.15s;
  }
  .avd-action-btn:hover:not(:disabled) {
    background: #284431;
  }
  .avd-action-btn:disabled {
    background: #1a1b1f;
    color: #666a73;
    border-color: #26282d;
    cursor: default;
  }
  .daemon-card {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 10px;
    background: #17181c;
    border: 1px solid #26282d;
    border-radius: 7px;
  }
  .daemon-info {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
  }
  .daemon-label {
    color: #8b8f98;
  }
  .daemon-val {
    color: #d8d9dc;
    font-weight: 500;
  }
  .stop-daemon-btn {
    padding: 2px 7px;
    border-radius: 4px;
    font-size: 10px;
    color: #f07a74;
    background: #2a1d1e;
    border: 1px solid #4a2629;
    cursor: pointer;
  }
  .stop-daemon-btn:hover {
    background: #4a2629;
  }
</style>
