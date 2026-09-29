<script lang="ts">
  import { mirrorStore } from '../mirrorStore.svelte';

  let { onOpenLogcat }: { onOpenLogcat?: () => void } = $props();

  let message = $derived(
    mirrorStore.errorMessage || 'Mirror service terminated during connection.'
  );

  let isScreenRecordingError = $derived(
    /screen\s*recording|screen\s*capture|kTCCServiceScreenCapture|tcc|permission|denied|authorized/i.test(message) ||
    (mirrorStore.isViewOnly && !message.toLowerCase().includes('scrcpy'))
  );
</script>

<div class="error-box" role="alert">
  <div class="error-title">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
      <circle cx="12" cy="12" r="10"></circle>
      <line x1="15" y1="9" x2="9" y2="15"></line>
      <line x1="9" y1="9" x2="15" y2="15"></line>
    </svg>
    <span>{isScreenRecordingError ? 'Screen Recording Permission' : 'Mirror Connection Failed'}</span>
  </div>

  {#if isScreenRecordingError}
    <div class="permission-guide">
      <p class="guide-intro">
        macOS requires Screen Recording permission to mirror the iOS Simulator display:
      </p>
      <ol class="guide-steps">
        <li>Open <strong>System Settings</strong> → <strong>Privacy & Security</strong></li>
        <li>Select <strong>Screen & System Audio Recording</strong></li>
        <li>Enable <strong>Petak</strong> in the application list</li>
        <li>Return here and click <strong>Retry Handshake</strong></li>
      </ol>
    </div>
  {:else}
    <div class="error-desc-summary">
      scrcpy server handshake failed. Please ensure USB debugging is authorized on your Android device.
    </div>

    <div class="error-desc-code">
      <code>{message}</code>
    </div>
  {/if}

  <div class="error-actions">
    <button class="btn-danger" onclick={() => mirrorStore.reconnect()} aria-label="Retry Handshake">
      Retry Handshake
    </button>
    {#if onOpenLogcat && !isScreenRecordingError}
      <button class="btn-secondary" onclick={onOpenLogcat} aria-label="View Logcat">
        View Logcat
      </button>
    {/if}
  </div>
</div>

<style>
  .error-box {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    max-width: 320px;
    gap: 12px;
    padding: 18px;
    background: #2a1d1e;
    border: 1px solid #4a2225;
    border-radius: 10px;
  }
  .error-title {
    font-size: 13px;
    font-weight: 600;
    color: #f07a74;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .permission-guide {
    text-align: left;
    background: #1e1415;
    border: 1px solid #3c1e20;
    border-radius: 6px;
    padding: 10px 12px;
    font-size: 11.5px;
    line-height: 1.45;
    color: #d8d9dc;
  }
  .guide-intro {
    margin: 0 0 6px 0;
    color: #f5c4c1;
    font-weight: 500;
  }
  .guide-steps {
    margin: 0;
    padding-left: 18px;
    color: #c9cbd0;
  }
  .guide-steps li {
    margin-bottom: 4px;
  }
  .guide-steps strong {
    color: #ffffff;
  }
  .error-desc-summary {
    font-size: 12px;
    color: #e6e7ea;
    line-height: 17px;
  }
  .error-desc-code {
    font-size: 11px;
    color: #c9cbd0;
    line-height: 16px;
    font-family: 'JetBrains Mono', monospace;
    background: #1b1314;
    padding: 6px 8px;
    border-radius: 4px;
    text-align: left;
    width: 100%;
    word-break: break-all;
    max-height: 90px;
    overflow-y: auto;
  }
  .error-actions {
    display: flex;
    gap: 8px;
    margin-top: 4px;
  }
  .btn-danger {
    height: 32px;
    padding: 0 14px;
    border-radius: 6px;
    background: #f07a74;
    color: #1e0e0e;
    font-weight: 600;
    font-size: 12px;
    border: none;
    cursor: pointer;
    transition: opacity 0.15s;
  }
  .btn-danger:hover {
    opacity: 0.9;
  }
  .btn-secondary {
    height: 32px;
    padding: 0 12px;
    border-radius: 6px;
    background: #34363d;
    color: #e6e7ea;
    font-size: 12px;
    border: none;
    cursor: pointer;
    transition: background 0.15s;
  }
  .btn-secondary:hover {
    background: #40434b;
  }
</style>
