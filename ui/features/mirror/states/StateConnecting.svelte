<script lang="ts">
  import { mirrorStore } from '../mirrorStore.svelte';

  let serial = $derived(mirrorStore.serial || mirrorStore.deviceName);
</script>

<div class="connecting-box">
  <div class="spinner-ring" role="progressbar" aria-label="Connecting to device"></div>
  <div class="connecting-title">Starting scrcpy Server…</div>
  <div class="connecting-desc">
    Pushing server v4.1 to {serial}, forwarding adb tunnel, and awaiting H.264 stream.
  </div>
  <button class="btn-secondary" onclick={() => mirrorStore.close()} aria-label="Cancel Connection">
    Cancel
  </button>
</div>

<style>
  .connecting-box {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    max-width: 270px;
    gap: 12px;
  }
  .spinner-ring {
    width: 36px;
    height: 36px;
    border: 3px solid #26282d;
    border-top-color: #6ea8ff;
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  .connecting-title {
    font-size: 14px;
    font-weight: 600;
    color: #e6e7ea;
  }
  .connecting-desc {
    font-size: 12px;
    color: #8b8f98;
    line-height: 18px;
  }
  .btn-secondary {
    height: 32px;
    padding: 0 16px;
    border-radius: 6px;
    background: #23252b;
    color: #d8d9dc;
    border: 1px solid #2c2e34;
    font-size: 12px;
    cursor: pointer;
    margin-top: 4px;
    transition: background 0.15s;
  }
  .btn-secondary:hover {
    background: #2c2e35;
  }
</style>
