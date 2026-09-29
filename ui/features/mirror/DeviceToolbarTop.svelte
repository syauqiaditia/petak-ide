<script lang="ts">
  import { mirrorStore } from './mirrorStore.svelte';

  let status = $derived(mirrorStore.status);
  let name = $derived(mirrorStore.deviceName || 'No Device');
</script>

<div class="device-toolbar-top">
  <div class="device-title-info">
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
      <rect x="7" y="3" width="10" height="18" rx="2"></rect>
      <path d="M11 18h2"></path>
    </svg>
    <span class="device-name-text" title={name}>{name}</span>

    {#if status === 'live'}
      <span class="device-badge-live" title="Full interactive control (touch, swipe, scroll, keyboard, navigation)">
        <span class="dot-live"></span>
        Interactive
      </span>
    {:else if status === 'view-only'}
      <span class="device-badge-viewonly" title="iOS screen mirroring (view only)">View only</span>
    {:else if status === 'connecting'}
      <span class="device-badge-connecting">
        <span class="dot-connecting"></span>
        CONNECTING...
      </span>
    {:else if status === 'disconnected'}
      <span class="device-badge-offline">
        <span class="dot-offline"></span>
        OFFLINE
      </span>
    {:else if status === 'error'}
      <span class="device-badge-error">
        <span class="dot-error"></span>
        ERROR
      </span>
    {/if}
  </div>

  <div class="toolbar-actions">
    <button
      class="tool-btn"
      title="Rotate Screen (0° ➔ 90°)"
      aria-label="Rotate screen"
      onclick={() => mirrorStore.rotate()}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
        <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"></path>
      </svg>
    </button>

    <button
      class="tool-btn"
      title="Take Screenshot (Save to disk & copy)"
      aria-label="Take screenshot"
      onclick={() => mirrorStore.takeScreenshot()}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
        <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path>
        <circle cx="12" cy="13" r="4"></circle>
      </svg>
    </button>

    <button
      class="tool-btn"
      title="Reconnect Mirror"
      aria-label="Reconnect mirror"
      onclick={() => mirrorStore.reconnect()}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
        <path d="M23 4v6h-6M1 20v-6h6"></path>
        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
      </svg>
    </button>

    <button
      class="tool-btn close-btn"
      title="Close Mirror Panel (⌘⇧D)"
      aria-label="Close mirror panel"
      onclick={() => mirrorStore.close()}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M18 6L6 18M6 6l12 12"></path>
      </svg>
    </button>
  </div>
</div>

<style>
  .device-toolbar-top {
    height: 40px;
    flex-shrink: 0;
    padding: 0 12px;
    background: #141518;
    border-bottom: 1px solid #26282d;
    display: flex;
    align-items: center;
    gap: 8px;
    user-select: none;
    -webkit-user-select: none;
  }
  .device-title-info {
    display: flex;
    align-items: center;
    gap: 7px;
    font-size: 12px;
    font-weight: 500;
    color: #e6e7ea;
    min-width: 0;
  }
  .device-name-text {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 140px;
  }
  .device-badge-live {
    font-size: 10px;
    font-weight: 600;
    color: #7fc98f;
    background: #16281e;
    border: 1px solid #20402b;
    padding: 1px 6px;
    border-radius: 4px;
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .dot-live {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: #7fc98f;
  }
  .device-badge-viewonly {
    font-size: 10px;
    font-weight: 600;
    color: #e8b45a;
    background: #2e2717;
    border: 1px solid #4a3d22;
    padding: 1px 6px;
    border-radius: 4px;
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }
  .device-badge-connecting {
    font-size: 10px;
    font-weight: 600;
    color: #e8b45a;
    background: #2e2717;
    border: 1px solid #4a3d22;
    padding: 1px 6px;
    border-radius: 4px;
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .dot-connecting {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: #e8b45a;
  }
  .device-badge-offline {
    font-size: 10px;
    font-weight: 600;
    color: #8b8f98;
    background: #1e2025;
    border: 1px solid #2c2e34;
    padding: 1px 6px;
    border-radius: 4px;
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .dot-offline {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: #8b8f98;
  }
  .device-badge-error {
    font-size: 10px;
    font-weight: 600;
    color: #f07a74;
    background: #2a1d1e;
    border: 1px solid #4a2225;
    padding: 1px 6px;
    border-radius: 4px;
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .dot-error {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: #f07a74;
  }
  .toolbar-actions {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-left: auto;
  }
  .tool-btn {
    width: 28px;
    height: 28px;
    border-radius: 6px;
    color: #8b8f98;
    background: transparent;
    border: none;
    cursor: pointer;
    display: grid;
    place-items: center;
    transition: background 0.1s, color 0.1s;
  }
  .tool-btn:hover {
    background: #23252b;
    color: #e6e7ea;
  }
  .close-btn:hover {
    background: #2a1d1e;
    color: #f07a74;
  }
</style>
