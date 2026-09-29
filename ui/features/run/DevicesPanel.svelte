<script lang="ts">
  import { runStore } from './runStore.svelte';
  import { groupDevices, type SnapshotEmulator, type SnapshotPhysical } from './deviceLogic';

  let grouped = $derived(
    groupDevices(runStore.snapshot, runStore.devices, runStore.avds)
  );

  let androidEmulators = $derived(grouped.androidEmulators);
  let iosSimulators = $derived(grouped.iosSimulators);
  let physicalDevices = $derived(grouped.physicalDevices);

  function isEmuSelected(emu: SnapshotEmulator): boolean {
    return (
      runStore.selectedDeviceId === emu.id ||
      (emu.deviceId !== null && runStore.selectedDeviceId === emu.deviceId)
    );
  }

  function isPhysSelected(phys: SnapshotPhysical): boolean {
    return runStore.selectedDeviceId === phys.id;
  }
</script>

<div class="devices-panel">
  <div class="header">
    <span class="header-title">DEVICES & EMULATORS</span>
    <button class="refresh-btn" onclick={() => runStore.refreshDevices()} title="Refresh devices and emulators">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5"></path>
      </svg>
    </button>
  </div>

  <div class="content-scroll">
    <!-- ANDROID EMULATORS (AVD) -->
    <div class="section-title">
      ANDROID EMULATORS ({androidEmulators.length})
    </div>

    {#if androidEmulators.length === 0}
      <div class="empty-state">
        <span>No Android AVD found</span>
        <span class="subtext">Create an AVD via Android Studio or avdmanager.</span>
      </div>
    {:else}
      <div class="device-group">
        {#each androidEmulators as emu}
          {@const isRunning = emu.state === 'running'}
          {@const isBooting = emu.state === 'booting'}
          {@const isSelected = isEmuSelected(emu)}
          <div
            class="device-card"
            class:selected={isSelected}
            onclick={() => {
              if (isRunning && emu.deviceId) {
                runStore.selectDevice(emu.deviceId);
              }
            }}
            role="button"
            tabindex="0"
            onkeydown={(e) => {
              if (e.key === 'Enter' && isRunning && emu.deviceId) {
                runStore.selectDevice(emu.deviceId);
              }
            }}
          >
            <div class="device-header">
              <span class="status-dot" class:online={isRunning} class:booting={isBooting}></span>
              <span class="device-name" title={emu.name}>{emu.name}</span>
              {#if isSelected && isRunning}
                <span class="active-badge">Active</span>
              {/if}
            </div>

            <div class="device-meta">
              <span class="state-label" class:online={isRunning}>{emu.state}</span>
              {#if emu.deviceId}
                <span>•</span>
                <span class="mono-id">{emu.deviceId}</span>
              {/if}
            </div>

            <div class="action-btn-row">
              {#if isRunning}
                <button
                  class="action-btn stop"
                  onclick={(e) => {
                    e.stopPropagation();
                    runStore.avdStop(emu.name);
                  }}
                  title="Stop AVD (kill emulator)"
                >
                  <span class="btn-icon">■</span>
                  Stop
                </button>
              {:else}
                <button
                  class="action-btn start"
                  disabled={isBooting}
                  onclick={(e) => {
                    e.stopPropagation();
                    runStore.avdStart(emu.name, false);
                  }}
                  title="Start Android Emulator"
                >
                  <span class="btn-icon">▶</span>
                  {isBooting ? 'Booting…' : 'Start'}
                </button>

                <button
                  class="action-btn cold"
                  disabled={isBooting}
                  onclick={(e) => {
                    e.stopPropagation();
                    runStore.avdStart(emu.name, true);
                  }}
                  title="Cold boot without snapshot"
                >
                  Cold Boot
                </button>
              {/if}
            </div>
          </div>
        {/each}
      </div>
    {/if}

    <!-- IOS SIMULATORS -->
    <div class="section-title mt">
      IOS SIMULATORS ({iosSimulators.length})
    </div>

    {#if iosSimulators.length === 0}
      <div class="empty-state">
        <span>No iOS Simulator found</span>
        <span class="subtext">Available on macOS with Xcode installed.</span>
      </div>
    {:else}
      <div class="device-group">
        {#each iosSimulators as sim}
          {@const isRunning = sim.state === 'running'}
          {@const isBooting = sim.state === 'booting'}
          {@const isSelected = isEmuSelected(sim)}
          <div
            class="device-card"
            class:selected={isSelected}
            onclick={() => {
              if (isRunning) runStore.selectDevice(sim.deviceId || sim.id);
            }}
            role="button"
            tabindex="0"
            onkeydown={(e) => {
              if (e.key === 'Enter' && isRunning) runStore.selectDevice(sim.deviceId || sim.id);
            }}
          >
            <div class="device-header">
              <span class="status-dot" class:online={isRunning} class:booting={isBooting}></span>
              <span class="device-name" title={sim.name}>{sim.name}</span>
              {#if isSelected && isRunning}
                <span class="active-badge">Active</span>
              {/if}
            </div>

            <div class="device-meta">
              <span class="state-label" class:online={isRunning}>{sim.state}</span>
              <span>•</span>
              <span class="mono-id" title={sim.id}>{sim.id.slice(0, 8)}…</span>
            </div>

            <div class="action-btn-row">
              {#if isRunning}
                <button
                  class="action-btn stop"
                  onclick={(e) => {
                    e.stopPropagation();
                    runStore.simShutdown(sim.id);
                  }}
                  title="Shutdown iOS Simulator"
                >
                  <span class="btn-icon">■</span>
                  Shutdown
                </button>
              {:else}
                <button
                  class="action-btn start"
                  disabled={isBooting}
                  onclick={(e) => {
                    e.stopPropagation();
                    runStore.simBoot(sim.id);
                  }}
                  title="Boot iOS Simulator"
                >
                  <span class="btn-icon">▶</span>
                  {isBooting ? 'Booting…' : 'Boot'}
                </button>
              {/if}
            </div>
          </div>
        {/each}
      </div>
    {/if}

    <!-- PHYSICAL DEVICES -->
    <div class="section-title mt">
      PHYSICAL DEVICES ({physicalDevices.length})
    </div>

    {#if physicalDevices.length === 0}
      <div class="empty-state">
        <span>No physical device connected</span>
        <span class="subtext">Connect phone via USB or Wi-Fi with debugging enabled.</span>
      </div>
    {:else}
      <div class="device-group">
        {#each physicalDevices as phys}
          {@const isSelected = isPhysSelected(phys)}
          {@const isOnline = phys.state !== 'offline'}
          <div
            class="device-card"
            class:selected={isSelected}
            onclick={() => isOnline && runStore.selectDevice(phys.id)}
            role="button"
            tabindex="0"
            onkeydown={(e) => { if (e.key === 'Enter' && isOnline) runStore.selectDevice(phys.id); }}
          >
            <div class="device-header">
              <span class="status-dot" class:online={isOnline}></span>
              <span class="device-name" title={phys.name}>{phys.name}</span>
              {#if isSelected}
                <span class="active-badge">Active</span>
              {/if}
            </div>

            <div class="device-meta">
              <span>{phys.platform === 'ios' ? 'iOS' : 'Android'}</span>
              <span>•</span>
              <span>{phys.transport.toUpperCase()}</span>
              <span>•</span>
              <span class="mono-id">{phys.id}</span>
            </div>
          </div>
        {/each}
      </div>
    {/if}

    <!-- Gradle Daemon status -->
    <div class="section-title mt">DAEMON STATUS</div>
    <div class="daemon-card">
      <div class="daemon-info">
        <span class="status-dot" class:online={runStore.gradleDaemon}></span>
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
    width: 260px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    background: #141518;
    border-right: 1px solid #26282d;
    height: 100%;
    overflow: hidden;
    user-select: none;
    -webkit-user-select: none;
  }
  .header {
    height: 36px;
    padding: 0 12px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    border-bottom: 1px solid #26282d;
    background: #18191d;
    flex-shrink: 0;
  }
  .header-title {
    font-size: 11px;
    font-weight: 600;
    color: #8b8f98;
    letter-spacing: 0.5px;
  }
  .refresh-btn {
    width: 24px;
    height: 24px;
    display: grid;
    place-items: center;
    background: transparent;
    border: none;
    color: #8b8f98;
    cursor: pointer;
    border-radius: 4px;
    transition: background 0.15s, color 0.15s;
  }
  .refresh-btn:hover {
    background: #23252b;
    color: #e6e7ea;
  }
  .content-scroll {
    flex: 1;
    overflow-y: auto;
    padding: 10px 10px 20px;
  }
  .section-title {
    font-size: 10px;
    font-weight: 600;
    color: #6e727a;
    letter-spacing: 0.5px;
    margin: 6px 4px 6px;
  }
  .section-title.mt {
    margin-top: 14px;
  }
  .empty-state {
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: 10px 10px;
    background: #191a1f;
    border: 1px dashed #2c2e35;
    border-radius: 6px;
    font-size: 11.5px;
    color: #8b8f98;
  }
  .empty-state .subtext {
    font-size: 10.5px;
    color: #656972;
  }
  .device-group {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .device-card {
    background: #1a1c21;
    border: 1px solid #272a31;
    border-radius: 6px;
    padding: 8px 10px;
    display: flex;
    flex-direction: column;
    gap: 5px;
    cursor: pointer;
    transition: border-color 0.15s, background 0.15s;
  }
  .device-card:hover {
    background: #202228;
    border-color: #343842;
  }
  .device-card.selected {
    border-color: #3b5a82;
    background: #1e2533;
  }
  .device-header {
    display: flex;
    align-items: center;
    gap: 7px;
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
  .status-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #656972;
    flex-shrink: 0;
  }
  .status-dot.online {
    background: #7fc98f;
  }
  .status-dot.booting {
    background: #e8b45a;
  }
  .active-badge {
    font-size: 9.5px;
    font-weight: 600;
    padding: 1px 5px;
    border-radius: 3px;
    background: #294366;
    color: #8ec3ff;
    flex-shrink: 0;
  }
  .device-meta {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 10.5px;
    color: #8b8f98;
  }
  .state-label {
    text-transform: capitalize;
  }
  .state-label.online {
    color: #7fc98f;
  }
  .mono-id {
    font-family: 'JetBrains Mono', monospace;
    font-size: 10px;
  }
  .action-btn-row {
    display: flex;
    gap: 6px;
    margin-top: 3px;
  }
  .action-btn {
    height: 24px;
    padding: 0 8px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 500;
    border: none;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    transition: opacity 0.12s, background 0.12s;
  }
  .action-btn.start {
    background: #25402c;
    color: #85d898;
    border: 1px solid #32583c;
  }
  .action-btn.start:hover:not(:disabled) {
    background: #2d4f36;
  }
  .action-btn.cold {
    background: #262932;
    color: #a0a4ae;
    border: 1px solid #333640;
  }
  .action-btn.cold:hover:not(:disabled) {
    background: #2e323d;
    color: #e6e7ea;
  }
  .action-btn.stop {
    background: #3d2325;
    color: #f0837f;
    border: 1px solid #542b2d;
  }
  .action-btn.stop:hover {
    background: #4a282a;
  }
  .action-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .btn-icon {
    font-size: 9px;
  }
  .daemon-card {
    background: #1a1c21;
    border: 1px solid #272a31;
    border-radius: 6px;
    padding: 8px 10px;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .daemon-info {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    color: #c9cbd0;
  }
  .daemon-label {
    color: #8b8f98;
  }
  .daemon-val {
    font-weight: 500;
  }
  .stop-daemon-btn {
    height: 22px;
    padding: 0 8px;
    font-size: 10.5px;
    background: #30333b;
    color: #e6e7ea;
    border: none;
    border-radius: 4px;
    cursor: pointer;
  }
  .stop-daemon-btn:hover {
    background: #3b3f49;
  }
</style>
