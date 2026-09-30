<script lang="ts">
  import { onMount } from 'svelte';
  import { mirrorStore } from '../mirrorStore.svelte';
  import { api, type MirrorPermissionStatus } from '../../../lib/api';

  let { onOpenLogcat }: { onOpenLogcat?: () => void } = $props();

  let message = $derived(
    mirrorStore.errorMessage || 'Mirror service terminated during connection.'
  );

  let permStatus = $state<MirrorPermissionStatus | null>(null);

  onMount(async () => {
    try {
      permStatus = await api.mirrorPermissionStatus(mirrorStore.deviceId);
    } catch {
      permStatus = null;
    }
  });

  let isScreenRecordingError = $derived(
    /screen\s*recording|screen\s*capture|kTCCServiceScreenCapture|tcc|permission|denied|authorized/i.test(message) ||
    (mirrorStore.isViewOnly && !message.toLowerCase().includes('scrcpy')) ||
    (permStatus !== null && (!permStatus.granted || permStatus.restartNeeded))
  );

  let isIphonePhysical = $derived(
    permStatus?.kind === 'physical' ||
    (mirrorStore.selectedDevice?.kind === 'physical' && mirrorStore.selectedDevice?.platform === 'ios') ||
    mirrorStore.deviceId.toLowerCase().includes('iphone')
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
    {#if isIphonePhysical}
      <!-- iPhone Fisik via USB (Bug 8) -->
      <div class="permission-guide physical">
        <p class="guide-intro">
          iPhone Fisik via USB (View-Only):
        </p>
        <ol class="guide-steps">
          <li>Pastikan iPhone terhubung ke Mac dengan <strong>kabel USB</strong></li>
          <li>Pastikan layar iPhone <strong>tidak terkunci (unlocked)</strong></li>
          <li>Ketuk <strong>Trust This Computer</strong> pada layar iPhone dan masukkan PIN jika diminta</li>
          <li>Aktifkan izin <strong>Screen Recording</strong> jika macOS memintanya</li>
        </ol>
      </div>
    {:else if permStatus?.restartNeeded}
      <!-- Perlu Restart Petak (Bug 8) -->
      <div class="permission-guide warning">
        <p class="guide-intro">
          Izin Screen Recording telah aktif di macOS!
        </p>
        <p class="guide-subtext">
          Aplikasi <strong>Petak perlu di-restart</strong> agar sistem macOS memuat izin baru tersebut.
        </p>
      </div>
    {:else}
      <!-- iOS Simulator Display (Bug 8: hanya untuk simulator) -->
      <div class="permission-guide">
        <p class="guide-intro">
          macOS memerlukan izin Screen Recording untuk mirroring iOS Simulator:
        </p>
        <ol class="guide-steps">
          <li>Buka <strong>System Settings</strong> → <strong>Privacy & Security</strong></li>
          <li>Pilih <strong>Screen & System Audio Recording</strong></li>
          <li>Aktifkan <strong>Petak</strong> pada daftar aplikasi</li>
          <li>Kembali ke sini dan klik <strong>Retry Handshake</strong></li>
        </ol>
      </div>
    {/if}
  {:else}
    <div class="error-desc-summary">
      scrcpy server handshake failed. Please ensure USB debugging is authorized on your Android device.
    </div>

    <div class="error-desc-code">
      <code>{message}</code>
    </div>
  {/if}

  <div class="error-actions">
    {#if isScreenRecordingError}
      <button class="btn-primary" onclick={() => api.openScreenRecordingSettings()} aria-label="Open System Settings">
        Open System Settings
      </button>
      {#if permStatus?.restartNeeded}
        <button class="btn-warning" onclick={() => window.location.reload()} aria-label="Restart Petak">
          Restart Petak
        </button>
      {/if}
    {/if}
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
    max-width: 340px;
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
    width: 100%;
    box-sizing: border-box;
  }
  .permission-guide.warning {
    background: #282012;
    border-color: #553e18;
  }
  .guide-intro {
    margin: 0 0 6px 0;
    color: #f5c4c1;
    font-weight: 500;
  }
  .guide-subtext {
    margin: 0;
    color: #e8b45a;
    font-size: 11px;
    line-height: 1.4;
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
    flex-wrap: wrap;
    justify-content: center;
    gap: 8px;
    margin-top: 4px;
  }
  .btn-primary {
    height: 32px;
    padding: 0 12px;
    border-radius: 6px;
    background: #3b5998;
    color: #ffffff;
    font-weight: 500;
    font-size: 11.5px;
    border: none;
    cursor: pointer;
    transition: background 0.15s;
  }
  .btn-primary:hover {
    background: #4a6eb5;
  }
  .btn-warning {
    height: 32px;
    padding: 0 12px;
    border-radius: 6px;
    background: #e8b45a;
    color: #1e1400;
    font-weight: 600;
    font-size: 11.5px;
    border: none;
    cursor: pointer;
    transition: opacity 0.15s;
  }
  .btn-warning:hover {
    opacity: 0.9;
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
