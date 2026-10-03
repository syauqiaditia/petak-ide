<script lang="ts">
  import { onMount } from 'svelte';
  import { runStore } from './runStore.svelte';
  import { mirrorStore } from '../mirror/mirrorStore.svelte';
  import { toolchainStore } from '../toolchain/toolchainStore.svelte';
  import { api, type EmulatorStatusEvent } from '../../lib/api';
  import { groupDevices, type SnapshotEmulator, type SnapshotPhysical } from './deviceLogic';
  import PairDeviceModal from './PairDeviceModal.svelte';
  import {
    ANDROID_EMULATOR_SVG,
    IOS_SIMULATOR_SVG,
    DEVICE_USB_SVG,
    DEVICE_WIFI_SVG,
  } from '../../icons';

  let showPairModal = $state(false);

  let grouped = $derived(
    groupDevices(runStore.snapshot, runStore.devices, runStore.avds)
  );

  let androidEmulators = $derived(grouped.androidEmulators);
  let iosSimulators = $derived(grouped.iosSimulators);
  let physicalDevices = $derived(grouped.physicalDevices);

  let isRefreshing = $state(false);
  let liveStatus = $state<Record<string, { state: 'stopped' | 'booting' | 'running' | 'failed'; error?: string }>>({});

  let { onClose } = $props<{
    onClose?: () => void;
  }>();

  onMount(() => {
    let unlisten: any = null;
    api.onEmulatorStatus((event: EmulatorStatusEvent) => {
      liveStatus[event.id] = { state: event.state, error: event.error };
      if (event.state === 'running') {
        runStore.refreshDevices().then(() => {
          let serial = event.serial;
          if (!serial) {
            const lowerAvd = event.id.toLowerCase();
            const matched = runStore.devices.find(
              (d) =>
                d.online &&
                (d.name?.toLowerCase().includes(lowerAvd) ||
                  lowerAvd.includes(d.name?.toLowerCase()) ||
                  d.id === event.id)
            ) || (runStore.snapshot?.emulators?.find(
              (e) => (e.name === event.id || e.id === event.id) && e.deviceId
            ) as any);
            if (matched) {
              serial = matched.deviceId || matched.id;
            } else {
              const anyEmu = runStore.devices.find((d) => d.online && d.id.startsWith('emulator-'));
              if (anyEmu) serial = anyEmu.id;
            }
          }
          const target = serial || event.id;
          runStore.selectDevice(target);
          mirrorStore.open(target);
        });
      } else if (event.state === 'failed' && event.error) {
        toolchainStore.showToast(`Emulator "${event.id}" failed: ${event.error.slice(0, 120)}`);
      }
    }).then((u) => { unlisten = u; }).catch(() => {});

    return () => {
      if (unlisten) unlisten();
    };
  });

  async function handleRefresh() {
    if (isRefreshing) return;
    isRefreshing = true;
    try {
      await runStore.refreshDevices();
    } finally {
      isRefreshing = false;
    }
  }

  function getEmuState(emu: SnapshotEmulator): 'stopped' | 'booting' | 'running' | 'failed' {
    if (runStore.emulatorStatuses[emu.name]) return runStore.emulatorStatuses[emu.name].state;
    if (emu.deviceId && runStore.emulatorStatuses[emu.deviceId]) return runStore.emulatorStatuses[emu.deviceId].state;
    if (liveStatus[emu.name]) return liveStatus[emu.name].state;
    if (emu.deviceId && liveStatus[emu.deviceId]) return liveStatus[emu.deviceId].state;
    return emu.state;
  }

  function getEmuError(emu: SnapshotEmulator): string | undefined {
    return runStore.emulatorStatuses[emu.name]?.error || (emu.deviceId ? runStore.emulatorStatuses[emu.deviceId]?.error : undefined) || liveStatus[emu.name]?.error || (emu.deviceId ? liveStatus[emu.deviceId]?.error : undefined);
  }

  function getSimState(sim: SnapshotEmulator): 'stopped' | 'booting' | 'running' | 'failed' {
    if (runStore.emulatorStatuses[sim.id]) return runStore.emulatorStatuses[sim.id].state;
    if (liveStatus[sim.id]) return liveStatus[sim.id].state;
    return sim.state;
  }

  function getSimError(sim: SnapshotEmulator): string | undefined {
    return runStore.emulatorStatuses[sim.id]?.error || liveStatus[sim.id]?.error;
  }

  function isEmuSelected(emu: SnapshotEmulator): boolean {
    return (
      runStore.selectedDeviceId === emu.id ||
      (emu.deviceId !== null && runStore.selectedDeviceId === emu.deviceId)
    );
  }

  function isPhysSelected(phys: SnapshotPhysical): boolean {
    return runStore.selectedDeviceId === phys.id;
  }

  async function handleAvdWipe(name: string) {
    const ok = window.confirm(`Wipe data for Android AVD "${name}"? All userdata will be erased.`);
    if (ok) {
      try {
        await api.avdWipe(name);
        toolchainStore.showToast(`AVD "${name}" data wiped.`);
      } catch (e: any) {
        toolchainStore.showToast(`Failed to wipe AVD "${name}": ${e?.message || e}`);
      }
    }
  }

  async function handleAvdDelete(name: string) {
    const ok = window.confirm(`Delete Android AVD "${name}"? This action cannot be undone.`);
    if (ok) {
      try {
        await api.avdDelete(name);
        await runStore.refreshDevices();
        toolchainStore.showToast(`AVD "${name}" deleted.`);
      } catch (e: any) {
        toolchainStore.showToast(`Failed to delete AVD "${name}": ${e?.message || e}`);
      }
    }
  }

  async function handleOpenSimApp() {
    try {
      await api.simOpenApp();
    } catch (e: any) {
      toolchainStore.showToast(`Failed to open Simulator app: ${e?.message || e}`);
    }
  }
</script>

<div class="devices-panel">
  <div class="header">
    <span class="header-title">DEVICES & EMULATORS</span>
    <div class="header-actions">
      <button
        class="pair-wifi-header-btn"
        onclick={() => (showPairModal = true)}
        title="Pasangkan Perangkat via Wi-Fi"
        aria-label="Pasangkan Perangkat via Wi-Fi"
      >
        + Wi-Fi
      </button>
      <button
        class="refresh-btn"
        class:spinning={isRefreshing}
        disabled={isRefreshing}
        onclick={handleRefresh}
        title="Refresh devices and emulators"
        aria-label="Refresh devices and emulators"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5"></path>
        </svg>
      </button>
      {#if onClose}
        <button class="close-btn" onclick={onClose} title="Close Devices Panel" aria-label="Close Devices Panel">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      {/if}
    </div>
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
          {@const emuState = getEmuState(emu)}
          {@const isRunning = emuState === 'running'}
          {@const isBooting = emuState === 'booting'}
          {@const isFailed = emuState === 'failed'}
          {@const isSelected = isEmuSelected(emu)}
          {@const emuErr = getEmuError(emu)}
          <div
            class="device-card"
            class:selected={isSelected}
            class:failed={isFailed}
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
              <span class="device-type-svg">{@html ANDROID_EMULATOR_SVG}</span>
              <span class="status-dot" class:online={isRunning} class:booting={isBooting} class:failed={isFailed}></span>
              <span class="device-name" title={emu.name}>{emu.name}</span>
              {#if isSelected && isRunning}
                <span class="active-badge">Active</span>
              {/if}
            </div>

            <div class="device-meta">
              <span class="state-label" class:online={isRunning} class:booting={isBooting} class:failed={isFailed}>
                {isBooting ? 'Booting…' : emuState}
              </span>
              {#if emu.deviceId}
                <span>•</span>
                <span class="mono-id">{emu.deviceId}</span>
              {/if}
            </div>

            {#if emuErr}
              <div class="card-err-box" title={emuErr}>
                <code>{emuErr}</code>
              </div>
            {/if}

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

                <button
                  class="action-btn wipe"
                  disabled={isBooting}
                  onclick={(e) => {
                    e.stopPropagation();
                    handleAvdWipe(emu.name);
                  }}
                  title="Wipe emulator user data"
                >
                  Wipe
                </button>

                <button
                  class="action-btn del"
                  disabled={isBooting}
                  onclick={(e) => {
                    e.stopPropagation();
                    handleAvdDelete(emu.name);
                  }}
                  title="Delete this AVD"
                >
                  ✕
                </button>
              {/if}
            </div>
          </div>
        {/each}
      </div>
    {/if}

    <!-- IOS SIMULATORS -->
    <div class="section-title mt section-split">
      <span>IOS SIMULATORS ({iosSimulators.length})</span>
      <button class="open-sim-app-btn" onclick={handleOpenSimApp} title="Open Simulator application">
        Open Simulator app
      </button>
    </div>

    {#if iosSimulators.length === 0}
      <div class="empty-state">
        <span>No iOS Simulator found</span>
        <span class="subtext">Available on macOS with Xcode installed.</span>
      </div>
    {:else}
      <div class="device-group">
        {#each iosSimulators as sim}
          {@const simState = getSimState(sim)}
          {@const isRunning = simState === 'running'}
          {@const isBooting = simState === 'booting'}
          {@const isFailed = simState === 'failed'}
          {@const isSelected = isEmuSelected(sim)}
          {@const simErr = getSimError(sim)}
          <div
            class="device-card"
            class:selected={isSelected}
            class:failed={isFailed}
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
              <span class="device-type-svg">{@html IOS_SIMULATOR_SVG}</span>
              <span class="status-dot" class:online={isRunning} class:booting={isBooting} class:failed={isFailed}></span>
              <span class="device-name" title={sim.name}>{sim.name}</span>
              {#if isSelected && isRunning}
                <span class="active-badge">Active</span>
              {/if}
            </div>

            <div class="device-meta">
              <span class="state-label" class:online={isRunning} class:failed={isFailed}>{simState}</span>
              <span>•</span>
              <span class="mono-id" title={sim.id}>{sim.id.slice(0, 8)}…</span>
            </div>

            {#if simErr}
              <div class="card-err-box" title={simErr}>
                <code>{simErr}</code>
              </div>
            {/if}

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
    <div class="section-title mt section-title-row">
      <span>PHYSICAL DEVICES ({physicalDevices.length})</span>
      <button
        class="section-pair-btn"
        onclick={() => (showPairModal = true)}
        title="Pasangkan Perangkat via Wi-Fi"
      >
        + Pasangkan via Wi-Fi
      </button>
    </div>

    {#if physicalDevices.length === 0}
      <div class="empty-state">
        <span>No physical device connected</span>
        <span class="subtext">Connect phone via USB or Wi-Fi with debugging enabled.</span>
        <button
          class="empty-pair-btn"
          onclick={() => (showPairModal = true)}
        >
          + Pasangkan via Wi-Fi
        </button>
      </div>
    {:else}
      <div class="device-group">
        {#each physicalDevices as phys}
          {@const isSelected = isPhysSelected(phys)}
          {@const isConnected = phys.connection === 'connected'}
          {@const isPaired = phys.connection === 'paired'}
          {@const isOffline = !isConnected && !isPaired}
          <div
            class="device-card"
            class:selected={isSelected}
            class:paired={isPaired}
            class:offline={isOffline}
            onclick={() => isConnected && runStore.selectDevice(phys.id)}
            role="button"
            tabindex="0"
            onkeydown={(e) => { if (e.key === 'Enter' && isConnected) runStore.selectDevice(phys.id); }}
          >
            <div class="device-header">
              <span class="device-type-svg">
                {#if phys.transport === 'wifi' || phys.connection === 'wifi'}
                  {@html DEVICE_WIFI_SVG}
                {:else}
                  {@html DEVICE_USB_SVG}
                {/if}
              </span>
              <span class="status-dot" class:online={isConnected} class:booting={isPaired}></span>
              <span class="device-name" title={phys.name}>{phys.name}</span>
              {#if isSelected && isConnected}
                <span class="active-badge">Active</span>
              {:else if isPaired}
                <span class="paired-chip">Paired</span>
              {:else if isOffline}
                <span class="offline-chip">Offline</span>
              {/if}
            </div>

            <div class="device-meta">
              <span>{phys.platform === 'ios' ? 'iOS' : 'Android'}</span>
              <span>•</span>
              <span>{phys.transport ? phys.transport.toUpperCase() : 'USB'}</span>
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

<PairDeviceModal open={showPairModal} onClose={() => (showPairModal = false)} />

<style>
  .devices-panel {
    width: 270px;
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
  .header-actions {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .pair-wifi-header-btn {
    height: 22px;
    padding: 0 7px;
    font-size: 10px;
    font-weight: 500;
    background: #202430;
    color: #8ea8db;
    border: 1px solid #2e384c;
    border-radius: 4px;
    cursor: pointer;
    transition: all 0.15s;
    white-space: nowrap;
  }
  .pair-wifi-header-btn:hover {
    background: #28334a;
    color: #cfe0ff;
    border-color: #405273;
  }
  .close-btn {
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
  .close-btn:hover {
    background: #23252b;
    color: #e6e7ea;
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
  .refresh-btn:hover:not(:disabled) {
    background: #23252b;
    color: #e6e7ea;
  }
  .refresh-btn.spinning svg {
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
  .content-scroll {
    flex: 1;
    overflow-y: auto;
    padding: 10px 10px 20px;
  }
  .section-title {
    font-size: 10px;
    font-weight: 600;
    color: #727680;
    letter-spacing: 0.5px;
    margin-bottom: 8px;
    padding: 0 2px;
  }
  .section-title.mt {
    margin-top: 14px;
  }
  .section-title-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .section-pair-btn {
    background: transparent;
    border: 1px solid #2e384c;
    color: #8ea8db;
    font-size: 9.5px;
    padding: 1px 6px;
    border-radius: 3px;
    cursor: pointer;
    transition: all 0.12s;
  }
  .section-pair-btn:hover {
    color: #cfe0ff;
    background: #202430;
    border-color: #405273;
  }
  .empty-pair-btn {
    margin-top: 6px;
    background: #202430;
    border: 1px solid #2e384c;
    color: #8ea8db;
    font-size: 10.5px;
    padding: 4px 8px;
    border-radius: 4px;
    cursor: pointer;
    align-self: flex-start;
    transition: all 0.15s;
  }
  .empty-pair-btn:hover {
    background: #28334a;
    color: #cfe0ff;
  }
  .section-split {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .open-sim-app-btn {
    background: transparent;
    border: 1px solid #34363d;
    color: #9aa0a6;
    font-size: 9.5px;
    padding: 1px 6px;
    border-radius: 3px;
    cursor: pointer;
    transition: all 0.12s;
  }
  .open-sim-app-btn:hover {
    color: #e6e7ea;
    background: #23252b;
    border-color: #4a4d56;
  }
  .empty-state {
    padding: 12px;
    background: #18191d;
    border: 1px dashed #282a30;
    border-radius: 6px;
    display: flex;
    flex-direction: column;
    gap: 3px;
    font-size: 11.5px;
    color: #8b8f98;
  }
  .empty-state .subtext {
    font-size: 10px;
    color: #636773;
  }
  .device-group {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .device-card {
    background: #18191d;
    border: 1px solid #282a30;
    border-radius: 6px;
    padding: 8px 10px;
    display: flex;
    flex-direction: column;
    gap: 5px;
    cursor: pointer;
    transition: border-color 0.15s, background 0.15s;
  }
  .device-card:hover {
    background: #1c1d22;
    border-color: #383a42;
  }
  .device-card.selected {
    border-color: #3b5998;
    background: #181d28;
  }
  .device-card.failed {
    border-color: #55272a;
    background: #201516;
  }
  .device-card.paired {
    opacity: 0.8;
  }
  .device-card.offline {
    opacity: 0.6;
  }
  .device-header {
    display: flex;
    align-items: center;
    gap: 7px;
  }
  .device-type-svg {
    display: flex;
    align-items: center;
    width: 14px;
    height: 14px;
    color: #8b8f98;
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
  .status-dot.failed {
    background: #f07a74;
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
  .paired-chip {
    font-size: 9.5px;
    color: #8b8f98;
    background: #26282f;
    padding: 1px 5px;
    border-radius: 3px;
    flex-shrink: 0;
  }
  .offline-chip {
    font-size: 9.5px;
    color: #656972;
    background: #1e2025;
    padding: 1px 5px;
    border-radius: 3px;
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
  .state-label.failed {
    color: #f07a74;
  }
  .mono-id {
    font-family: 'JetBrains Mono', monospace;
    font-size: 10px;
  }
  .card-err-box {
    background: #2a1517;
    border: 1px solid #4a2225;
    border-radius: 4px;
    padding: 4px 6px;
    font-size: 10px;
    color: #fca5a5;
    line-height: 1.35;
    max-height: 48px;
    overflow: hidden;
    word-break: break-all;
  }
  .action-btn-row {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 3px;
  }
  .action-btn {
    height: 23px;
    padding: 0 7px;
    border-radius: 4px;
    font-size: 10.5px;
    font-weight: 500;
    border: none;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 3px;
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
  .action-btn.wipe {
    background: #33281d;
    color: #e8b45a;
    border: 1px solid #4d3a24;
  }
  .action-btn.wipe:hover:not(:disabled) {
    background: #443425;
  }
  .action-btn.del {
    background: #331f21;
    color: #f07a74;
    border: 1px solid #4d2629;
    padding: 0 6px;
  }
  .action-btn.del:hover:not(:disabled) {
    background: #442629;
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
