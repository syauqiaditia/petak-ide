<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import { api } from '../../lib/api';
  import { runStore } from './runStore.svelte';
  import { toolchainStore } from '../toolchain/toolchainStore.svelte';
  import {
    validateIp,
    validatePort,
    validatePairingCode,
    resolveConnectPort,
    executePairAndConnect,
  } from './wifiPairingLogic';
  import {
    buildAdbQrPayload,
    generateAdbPairingCredentials,
    generateQrSvg,
  } from './qrcode';

  let {
    open = false,
    onClose,
  }: {
    open: boolean;
    onClose: () => void;
  } = $props();

  let activeTab = $state<'qr' | 'code' | 'instructions'>('qr');

  // Manual code state
  let ip = $state('');
  let pairingPort = $state('');
  let pairingCode = $state('');
  let connectPort = $state('');

  let status = $state<'idle' | 'pairing' | 'success' | 'error'>('idle');
  let errorMessage = $state<string | null>(null);

  let ipInputEl = $state<HTMLInputElement | null>(null);

  // QR code state
  let credentials = $state(generateAdbPairingCredentials());
  let qrSvg = $derived(
    generateQrSvg(buildAdbQrPayload(credentials.serviceName, credentials.password), {
      size: 220,
      margin: 2,
    })
  );
  let qrStatus = $state<'waiting' | 'pairing' | 'error'>('waiting');
  let qrStatusText = $state('Menunggu pemindaian dari kamera HP...');
  let pollInterval: ReturnType<typeof setInterval> | null = null;
  let isPolling = false;

  function stopPolling() {
    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
    isPolling = false;
  }

  function startPolling() {
    stopPolling();
    qrStatus = 'waiting';
    qrStatusText = 'Menunggu pemindaian dari kamera HP...';

    pollInterval = setInterval(async () => {
      if (isPolling || !open || activeTab !== 'qr') return;
      isPolling = true;
      try {
        const res = await api.adbFindPairingService(credentials.serviceName);
        if (res && Array.isArray(res) && res.length >= 2) {
          stopPolling();
          const [detectedIp, detectedPort] = res;
          qrStatus = 'pairing';
          qrStatusText = 'Perangkat terdeteksi! Memasangkan...';

          // 1. Panggil api.adbPair
          const pairRes = await api.adbPair(detectedIp, detectedPort, credentials.password);
          if (typeof pairRes === 'string' && /failed|error/i.test(pairRes)) {
            throw new Error(pairRes);
          }

          // 2. Panggil api.adbConnect
          const connectRes = await api.adbConnect(detectedIp, detectedPort);
          if (
            typeof connectRes === 'string' &&
            /failed|error/i.test(connectRes) &&
            !/already connected/i.test(connectRes)
          ) {
            throw new Error(connectRes);
          }

          // 3. Panggil runStore.refreshDevices()
          await runStore.refreshDevices();

          // 4. Toast sukses
          toolchainStore.showToast('Perangkat berhasil dipasangkan via QR Code!');

          // 5. Tutup modal otomatis
          onClose();
        }
      } catch (err: any) {
        stopPolling();
        qrStatus = 'error';
        const msg = err?.message || String(err) || 'Gagal memasangkan via QR Code';
        errorMessage = msg;
        qrStatusText = `Gagal: ${msg}`;
      } finally {
        isPolling = false;
      }
    }, 1500);
  }

  function refreshQr() {
    credentials = generateAdbPairingCredentials();
    errorMessage = null;
    startPolling();
  }

  $effect(() => {
    if (open) {
      status = 'idle';
      errorMessage = null;

      if (activeTab === 'qr') {
        startPolling();
      } else {
        stopPolling();
      }

      if (activeTab === 'code') {
        tick().then(() => {
          if (ipInputEl) {
            ipInputEl.focus();
          }
        });
      }
    } else {
      stopPolling();
    }

    return () => {
      stopPolling();
    };
  });

  onDestroy(() => {
    stopPolling();
  });

  let isIpValid = $derived(validateIp(ip));
  let isPairingPortValid = $derived(validatePort(pairingPort));
  let isPairingCodeValid = $derived(validatePairingCode(pairingCode));
  let isConnectPortValid = $derived(
    connectPort.trim() === '' || validatePort(connectPort)
  );

  let isValid = $derived(
    isIpValid && isPairingPortValid && isPairingCodeValid && isConnectPortValid
  );
  let canSubmit = $derived(isValid && status !== 'pairing');

  function handleKeyDown(e: KeyboardEvent) {
    if (!open) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'Enter') {
      if (activeTab === 'code' && canSubmit) {
        e.preventDefault();
        handlePair();
      }
    }
  }

  async function handlePair() {
    if (!canSubmit || status === 'pairing') return;

    status = 'pairing';
    errorMessage = null;

    const trimmedHost = ip.trim();
    const numPairingPort = Number(pairingPort.trim());
    const trimmedCode = pairingCode.trim();
    const effectiveConnectPort = resolveConnectPort(
      numPairingPort,
      connectPort.trim() ? connectPort.trim() : null
    );

    try {
      // 1. Panggil api.adbPair
      const pairRes = await api.adbPair(trimmedHost, numPairingPort, trimmedCode);
      if (typeof pairRes === 'string' && /failed|error/i.test(pairRes)) {
        throw new Error(pairRes);
      }

      // 2. Panggil api.adbConnect
      const connectRes = await api.adbConnect(trimmedHost, effectiveConnectPort);
      if (
        typeof connectRes === 'string' &&
        /failed|error/i.test(connectRes) &&
        !/already connected/i.test(connectRes)
      ) {
        throw new Error(connectRes);
      }

      // 3. Panggil runStore.refreshDevices()
      await runStore.refreshDevices();

      // 4. Toast sukses
      toolchainStore.showToast('Perangkat berhasil dipasangkan via Wi-Fi!');
      status = 'success';

      // 5. Tutup modal
      onClose();
    } catch (err: any) {
      const msg = err?.message || String(err) || 'Gagal memasangkan perangkat via Wi-Fi';
      status = 'error';
      errorMessage = msg;
      toolchainStore.showToast(`Gagal memasangkan perangkat: ${msg}`);
    }
  }
</script>

<svelte:window onkeydown={handleKeyDown} />

{#if open}
  <div class="modal-backdrop" onclick={onClose} role="presentation">
    <div
      class="modal-box"
      onclick={(e) => e.stopPropagation()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
      tabindex="-1"
    >
      <div class="modal-header">
        <div class="header-title-wrap">
          <span class="header-icon">📶</span>
          <span id="modal-title" class="modal-title">Pasangkan Perangkat via Wi-Fi</span>
        </div>
        <button class="modal-close-btn" onclick={onClose} title="Tutup (Esc)">✕</button>
      </div>

      <div class="modal-tabs">
        <button
          type="button"
          class="tab-btn"
          class:active={activeTab === 'qr'}
          onclick={() => (activeTab = 'qr')}
        >
          Pindai Kode QR
        </button>
        <button
          type="button"
          class="tab-btn"
          class:active={activeTab === 'code'}
          onclick={() => (activeTab = 'code')}
        >
          Kode Pemasangan (Manual)
        </button>
        <button
          type="button"
          class="tab-btn"
          class:active={activeTab === 'instructions'}
          onclick={() => (activeTab = 'instructions')}
        >
          Petunjuk Langkah
        </button>
      </div>

      <div class="modal-body">
        {#if errorMessage}
          <div class="error-banner" role="alert">
            <span class="error-icon">⚠</span>
            <span class="error-text">{errorMessage}</span>
          </div>
        {/if}

        {#if activeTab === 'qr'}
          <div class="qr-tab-content">
            <div class="qr-card">
              <div class="qr-svg-wrapper">
                {@html qrSvg}
              </div>
            </div>

            <div class="qr-meta-card">
              <div class="qr-meta-row">
                <span class="meta-label">Nama Layanan (mDNS):</span>
                <code class="meta-code">{credentials.serviceName}</code>
              </div>
              <div class="qr-status-indicator">
                {#if qrStatus === 'pairing'}
                  <span class="spinner"></span>
                {:else if qrStatus === 'waiting'}
                  <span class="pulse-dot"></span>
                {:else}
                  <span class="status-icon-err">⚠</span>
                {/if}
                <span class="status-label-text">{qrStatusText}</span>
              </div>
            </div>

            <div class="qr-actions-row">
              <button
                type="button"
                class="btn btn-secondary btn-sm"
                onclick={refreshQr}
                disabled={qrStatus === 'pairing'}
              >
                🔄 Refresh QR / Buat Ulang Kode QR
              </button>
            </div>

            <div class="qr-instruction-hint">
              Buka HP &rarr; Pengaturan &rarr; Pilihan Pengembang &rarr; Debugging Nirkabel &rarr; Pasangkan dengan kode QR
            </div>
          </div>
        {:else if activeTab === 'code'}
          <form onsubmit={(e) => { e.preventDefault(); handlePair(); }} class="form-content">
            <div class="form-group">
              <label for="wifi-ip" class="field-label">
                Alamat IP
                <span class="required">*</span>
              </label>
              <input
                id="wifi-ip"
                bind:this={ipInputEl}
                bind:value={ip}
                type="text"
                placeholder="misal: 192.168.1.50"
                class="input-field"
                class:invalid={ip.trim() !== '' && !isIpValid}
                disabled={status === 'pairing'}
                autocomplete="off"
                spellcheck="false"
              />
              {#if ip.trim() !== '' && !isIpValid}
                <span class="field-error">Format IP tidak valid (contoh: 192.168.1.50)</span>
              {/if}
            </div>

            <div class="form-row">
              <div class="form-group flex-1">
                <label for="wifi-pairing-port" class="field-label">
                  Port Pemasangan
                  <span class="required">*</span>
                </label>
                <input
                  id="wifi-pairing-port"
                  bind:value={pairingPort}
                  type="text"
                  placeholder="misal: 37123"
                  class="input-field"
                  class:invalid={pairingPort.trim() !== '' && !isPairingPortValid}
                  disabled={status === 'pairing'}
                  maxlength="5"
                  autocomplete="off"
                />
                {#if pairingPort.trim() !== '' && !isPairingPortValid}
                  <span class="field-error">Port 1 - 65535</span>
                {/if}
              </div>

              <div class="form-group flex-1">
                <label for="wifi-pairing-code" class="field-label">
                  Kode Pemasangan
                  <span class="required">*</span>
                </label>
                <input
                  id="wifi-pairing-code"
                  bind:value={pairingCode}
                  type="text"
                  placeholder="misal: 123456"
                  class="input-field code-input"
                  class:invalid={pairingCode.trim() !== '' && !isPairingCodeValid}
                  disabled={status === 'pairing'}
                  maxlength="6"
                  autocomplete="off"
                />
                {#if pairingCode.trim() !== '' && !isPairingCodeValid}
                  <span class="field-error">Harus 6 digit</span>
                {/if}
              </div>
            </div>

            <div class="form-group">
              <label for="wifi-connect-port" class="field-label">
                Port Koneksi (Connect Port)
                <span class="optional-label">(Opsional)</span>
              </label>
              <input
                id="wifi-connect-port"
                bind:value={connectPort}
                type="text"
                placeholder="Port dari layar Debugging Nirkabel (opsional)"
                class="input-field"
                class:invalid={connectPort.trim() !== '' && !isConnectPortValid}
                disabled={status === 'pairing'}
                maxlength="5"
                autocomplete="off"
              />
              <span class="field-hint">
                Di Android 11+, port koneksi bisa berbeda dari port kode pairing. Jika dikosongkan, Petak menggunakan port pairing.
              </span>
              {#if connectPort.trim() !== '' && !isConnectPortValid}
                <span class="field-error">Port koneksi harus angka 1 - 65535</span>
              {/if}
            </div>
          </form>
        {:else}
          <div class="instructions-wrap">
            <div class="instruction-intro">
              Pastikan HP Android dan komputer terhubung ke jaringan Wi-Fi lokal yang sama.
            </div>

            <div class="method-section">
              <div class="method-title">Metode 1: Pindai Kode QR (Direkomendasikan)</div>
              <ol class="steps-list">
                <li class="step-item">
                  <span class="step-number">1</span>
                  <div class="step-text">
                    Buka <strong>Pengaturan</strong> di HP Android &rarr; <strong>Pilihan Pengembang</strong> (Developer Options).
                  </div>
                </li>
                <li class="step-item">
                  <span class="step-number">2</span>
                  <div class="step-text">
                    Aktifkan <strong>Debugging Nirkabel</strong> (Wireless Debugging) dan pastikan HP satu jaringan Wi-Fi dengan komputer.
                  </div>
                </li>
                <li class="step-item">
                  <span class="step-number">3</span>
                  <div class="step-text">
                    Pilih <strong>"Pasangkan perangkat dengan kode QR"</strong> (Pair device with QR code).
                  </div>
                </li>
                <li class="step-item">
                  <span class="step-number">4</span>
                  <div class="step-text">
                    Arahkan kamera HP ke Kode QR di layar Petak. Perangkat akan terdeteksi dan tersambung otomatis.
                  </div>
                </li>
              </ol>
            </div>

            <div class="method-section">
              <div class="method-title">Metode 2: Kode Pemasangan 6-Digit (Manual)</div>
              <ol class="steps-list">
                <li class="step-item">
                  <span class="step-number">1</span>
                  <div class="step-text">
                    Di menu Debugging Nirkabel HP, pilih <strong>"Pasangkan perangkat dengan kode pemasangan"</strong> (Pair device with pairing code).
                  </div>
                </li>
                <li class="step-item">
                  <span class="step-number">2</span>
                  <div class="step-text">
                    Masukkan alamat IP, Port 5-digit, dan Kode Pemasangan 6-digit yang muncul di layar HP ke form ini.
                  </div>
                </li>
              </ol>
            </div>
          </div>
        {/if}
      </div>

      <div class="modal-footer">
        <button
          class="btn btn-secondary"
          onclick={onClose}
          disabled={status === 'pairing' || qrStatus === 'pairing'}
        >
          Batal
        </button>
        {#if activeTab === 'qr'}
          <button
            type="button"
            class="btn btn-secondary"
            onclick={refreshQr}
            disabled={qrStatus === 'pairing'}
          >
            Refresh QR
          </button>
        {:else if activeTab === 'code'}
          <button
            class="btn btn-primary"
            onclick={handlePair}
            disabled={!canSubmit}
          >
            {#if status === 'pairing'}
              <span class="spinner"></span>
              <span>Memasangkan…</span>
            {:else}
              <span>Pasangkan</span>
            {/if}
          </button>
        {:else}
          <button class="btn btn-primary" onclick={() => (activeTab = 'qr')}>
            Pindai Kode QR
          </button>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(15, 16, 19, 0.75);
    backdrop-filter: blur(3px);
    z-index: 1200;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .modal-box {
    width: 480px;
    max-width: 90vw;
    background: #18191d;
    border: 1px solid #26282e;
    border-radius: 10px;
    box-shadow: 0 20px 50px rgba(0, 0, 0, 0.65);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    color: #d8d9dc;
    font-family: 'Geist', system-ui, -apple-system, sans-serif;
  }

  .modal-header {
    height: 48px;
    padding: 0 16px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    border-bottom: 1px solid #26282e;
    background: #1c1d22;
  }

  .header-title-wrap {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .header-icon {
    font-size: 15px;
  }

  .modal-title {
    color: #e6efff;
    font-weight: 600;
    font-size: 13.5px;
    letter-spacing: 0.2px;
  }

  .modal-close-btn {
    color: #8b8f98;
    background: none;
    border: none;
    font-size: 14px;
    cursor: pointer;
    padding: 4px 8px;
    line-height: 1;
    border-radius: 4px;
    transition: background 0.15s, color 0.15s;
  }

  .modal-close-btn:hover {
    color: #e6e7ea;
    background: #26282e;
  }

  .modal-tabs {
    display: flex;
    background: #141518;
    border-bottom: 1px solid #26282e;
    padding: 4px 16px 0;
    gap: 8px;
  }

  .tab-btn {
    padding: 8px 12px;
    background: transparent;
    border: none;
    border-bottom: 2px solid transparent;
    color: #8b8f98;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s;
  }

  .tab-btn.active {
    color: #cfe0ff;
    border-bottom-color: #4370ba;
    font-weight: 600;
  }

  .tab-btn:hover:not(.active) {
    color: #d8d9dc;
  }

  .modal-body {
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 14px;
    font-size: 13px;
    background: #18191d;
  }

  .error-banner {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 10px 12px;
    background: rgba(220, 53, 69, 0.15);
    border: 1px solid #dc3545;
    border-radius: 6px;
    color: #ff8b94;
    font-size: 12px;
    line-height: 1.4;
  }

  .error-icon {
    font-weight: bold;
    flex-shrink: 0;
  }

  /* QR Code Tab Styles */
  .qr-tab-content {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
  }

  .qr-card {
    background: #ffffff;
    padding: 12px;
    border-radius: 8px;
    display: flex;
    justify-content: center;
    align-items: center;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
  }

  .qr-svg-wrapper {
    display: flex;
    justify-content: center;
    align-items: center;
    line-height: 0;
  }

  .qr-meta-card {
    width: 100%;
    background: #141518;
    border: 1px solid #26282e;
    border-radius: 6px;
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    box-sizing: border-box;
  }

  .qr-meta-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 11.5px;
  }

  .meta-label {
    color: #8b8f98;
  }

  .meta-code {
    color: #cfe0ff;
    font-family: 'JetBrains Mono', monospace;
    font-size: 11px;
    background: #1c1d22;
    padding: 2px 6px;
    border-radius: 4px;
    border: 1px solid #26282e;
  }

  .qr-status-indicator {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    color: #8ea8db;
  }

  .pulse-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #4370ba;
    box-shadow: 0 0 0 0 rgba(67, 112, 186, 0.7);
    animation: pulse 1.6s infinite;
    flex-shrink: 0;
  }

  @keyframes pulse {
    0% {
      transform: scale(0.95);
      box-shadow: 0 0 0 0 rgba(67, 112, 186, 0.7);
    }
    70% {
      transform: scale(1);
      box-shadow: 0 0 0 6px rgba(67, 112, 186, 0);
    }
    100% {
      transform: scale(0.95);
      box-shadow: 0 0 0 0 rgba(67, 112, 186, 0);
    }
  }

  .status-icon-err {
    color: #ff8b94;
    font-weight: bold;
    flex-shrink: 0;
  }

  .status-label-text {
    flex: 1;
    line-height: 1.3;
  }

  .qr-actions-row {
    display: flex;
    justify-content: center;
  }

  .btn-sm {
    height: 28px;
    padding: 0 10px;
    font-size: 11.5px;
  }

  .qr-instruction-hint {
    font-size: 11px;
    color: #727680;
    text-align: center;
    line-height: 1.4;
    max-width: 90%;
  }

  /* Manual Form Styles */
  .form-content {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .form-row {
    display: flex;
    gap: 12px;
  }

  .flex-1 {
    flex: 1;
  }

  .form-group {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }

  .field-label {
    font-size: 11.5px;
    font-weight: 500;
    color: #9da1ab;
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .required {
    color: #ff6b6b;
  }

  .optional-label {
    color: #6c707a;
    font-size: 11px;
    font-weight: normal;
  }

  .input-field {
    height: 32px;
    background: #121316;
    border: 1px solid #2c2e34;
    border-radius: 6px;
    padding: 0 10px;
    color: #d8d9dc;
    font-size: 12.5px;
    font-family: 'JetBrains Mono', monospace;
    outline: none;
    transition: border-color 0.15s, box-shadow 0.15s;
    box-sizing: border-box;
    width: 100%;
  }

  .input-field:focus {
    border-color: #4370ba;
    box-shadow: 0 0 0 1px #4370ba;
  }

  .input-field.invalid {
    border-color: #dc3545;
  }

  .input-field:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .code-input {
    letter-spacing: 2px;
    font-weight: 600;
  }

  .field-hint {
    font-size: 11px;
    color: #727680;
    line-height: 1.35;
  }

  .field-error {
    font-size: 11px;
    color: #ff8b94;
  }

  /* Step Instructions Styles */
  .instructions-wrap {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .instruction-intro {
    font-size: 12px;
    color: #8ea8db;
    background: #1e222d;
    padding: 8px 12px;
    border-radius: 6px;
    border: 1px solid #2a3449;
    line-height: 1.4;
  }

  .method-section {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .method-title {
    font-size: 12px;
    font-weight: 600;
    color: #cfe0ff;
  }

  .steps-list {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .step-item {
    display: flex;
    align-items: flex-start;
    gap: 10px;
  }

  .step-number {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: #252833;
    border: 1px solid #363b4a;
    color: #8ea8db;
    display: grid;
    place-items: center;
    font-size: 11px;
    font-weight: 600;
    flex-shrink: 0;
  }

  .step-text {
    font-size: 12px;
    color: #b9bcc4;
    line-height: 1.45;
  }

  .step-text strong {
    color: #e6efff;
  }

  .modal-footer {
    height: 50px;
    padding: 0 16px;
    background: #141518;
    border-top: 1px solid #26282e;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
  }

  .btn {
    height: 32px;
    padding: 0 14px;
    border-radius: 6px;
    font-size: 12px;
    cursor: pointer;
    font-weight: 500;
    border: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    transition: background 0.15s, opacity 0.15s;
  }

  .btn-secondary {
    background: #23252b;
    border: 1px solid #2c2e34;
    color: #b9bcc3;
  }

  .btn-secondary:hover:not(:disabled) {
    background: #2a2c32;
    color: #e6e7ea;
  }

  .btn-primary {
    background: #2a3e66;
    border: 1px solid #3d588f;
    color: #cfe0ff;
  }

  .btn-primary:hover:not(:disabled) {
    background: #354e80;
  }

  .btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .spinner {
    width: 12px;
    height: 12px;
    border: 2px solid rgba(255, 255, 255, 0.2);
    border-top-color: #ffffff;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
