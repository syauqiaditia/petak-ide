<script lang="ts">
  import { mirrorStore } from '../mirrorStore.svelte';

  let reason = $derived(mirrorStore.disconnectReason || 'USB connection was lost or emulator exited.');
</script>

<div class="disconnected-banner" role="alert">
  <div class="disconnected-header">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
      <line x1="12" y1="9" x2="12" y2="13"></line>
      <line x1="12" y1="17" x2="12.01" y2="17"></line>
    </svg>
    <span class="disconnected-title">Device Disconnected</span>
  </div>
  <div class="disconnected-desc">
    {reason} Re-plug device to resume stream.
  </div>
  <div class="disconnected-actions">
    <button class="btn-warning" onclick={() => mirrorStore.reconnect()} aria-label="Reconnect">
      Reconnect
    </button>
    <button class="btn-subtle" onclick={() => mirrorStore.close()} aria-label="Dismiss">
      Dismiss
    </button>
  </div>
</div>

<style>
  .disconnected-banner {
    position: absolute;
    top: 12px;
    left: 12px;
    right: 12px;
    padding: 12px 14px;
    background: #2e2717;
    border: 1px solid #4a3d22;
    border-radius: 8px;
    color: #e8b45a;
    font-size: 12px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    z-index: 30;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
  }
  .disconnected-header {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .disconnected-title {
    font-weight: 600;
    font-size: 13px;
  }
  .disconnected-desc {
    color: #d4a753;
    line-height: 16px;
  }
  .disconnected-actions {
    display: flex;
    gap: 8px;
    margin-top: 6px;
  }
  .btn-warning {
    height: 28px;
    padding: 0 12px;
    border-radius: 6px;
    background: #e8b45a;
    color: #1a1406;
    font-weight: 600;
    font-size: 11px;
    border: none;
    cursor: pointer;
    transition: opacity 0.15s;
  }
  .btn-warning:hover {
    opacity: 0.9;
  }
  .btn-subtle {
    height: 28px;
    padding: 0 10px;
    border-radius: 6px;
    background: rgba(0, 0, 0, 0.25);
    color: #e8b45a;
    border: 1px solid #4a3d22;
    font-size: 11px;
    cursor: pointer;
    transition: background 0.15s;
  }
  .btn-subtle:hover {
    background: rgba(0, 0, 0, 0.4);
  }
</style>
