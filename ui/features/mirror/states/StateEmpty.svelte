<script lang="ts">
  import { runStore } from '../../run/runStore.svelte';
  import { mirrorStore } from '../mirrorStore.svelte';

  let { onSelectDevice }: { onSelectDevice?: () => void } = $props();

  async function handleSelect() {
    if (onSelectDevice) {
      onSelectDevice();
    } else {
      // Pick first available device if any
      const dev = runStore.devices.find((d) => d.state === 'online') || runStore.devices[0];
      if (dev) {
        runStore.selectedDeviceId = dev.id;
        await mirrorStore.start(dev.id);
      }
    }
  }

  async function handleLaunchAvd() {
    if (runStore.avds.length > 0) {
      await runStore.startEmulator(runStore.avds[0].name);
    } else {
      await runStore.refreshAvds();
    }
  }
</script>

<div class="empty-state-box">
  <div class="empty-icon-wrap">
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
      <rect x="7" y="2" width="10" height="20" rx="2.5"></rect>
      <path d="M11 18h2"></path>
    </svg>
  </div>

  <div class="empty-title">No Device Selected</div>
  <div class="empty-desc">
    Connect an Android device via USB with USB debugging enabled, or start a local emulator.
  </div>

  <div class="empty-actions">
    <button class="btn-primary" onclick={handleSelect} aria-label="Select Device">
      Select Device
    </button>
    <button class="btn-secondary" onclick={handleLaunchAvd} aria-label="Launch AVD">
      Launch AVD
    </button>
  </div>
</div>

<style>
  .empty-state-box {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    max-width: 260px;
    gap: 12px;
  }
  .empty-icon-wrap {
    width: 52px;
    height: 52px;
    border-radius: 12px;
    background: #1f2a3d;
    border: 1px solid #2a3d5e;
    display: grid;
    place-items: center;
    color: #6ea8ff;
  }
  .empty-title {
    font-size: 14px;
    font-weight: 600;
    color: #e6e7ea;
  }
  .empty-desc {
    font-size: 12px;
    color: #8b8f98;
    line-height: 18px;
  }
  .empty-actions {
    display: flex;
    gap: 8px;
    margin-top: 4px;
  }
  .btn-primary {
    height: 32px;
    padding: 0 14px;
    border-radius: 6px;
    background: #6ea8ff;
    color: #0e1a2e;
    font-weight: 600;
    font-size: 12px;
    border: none;
    cursor: pointer;
    transition: opacity 0.15s;
  }
  .btn-primary:hover {
    opacity: 0.9;
  }
  .btn-secondary {
    height: 32px;
    padding: 0 14px;
    border-radius: 6px;
    background: #23252b;
    color: #d8d9dc;
    border: 1px solid #2c2e34;
    font-size: 12px;
    cursor: pointer;
    transition: background 0.15s;
  }
  .btn-secondary:hover {
    background: #2c2e35;
  }
</style>
