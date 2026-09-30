<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '../../lib/api';
  import { AccountsManager } from './accountsLogic';

  const manager = new AccountsManager();

  let url = $state('');
  let token = $state('');
  let hasToken = $state(false);
  let statusMsg = $state<string | null>(null);
  let statusKind = $state<'idle' | 'success' | 'error' | 'testing'>('idle');

  onMount(async () => {
    await manager.load(api);
    url = manager.url;
    hasToken = manager.hasToken;
  });

  async function handleTest() {
    manager.url = url;
    manager.inputToken = token;
    statusKind = 'testing';
    statusMsg = 'Menguji koneksi…';
    await manager.test(api);
    statusKind = manager.statusKind;
    statusMsg = manager.statusMessage;
  }

  async function handleSave() {
    manager.url = url;
    manager.inputToken = token;
    const ok = await manager.save(api);
    statusKind = manager.statusKind;
    statusMsg = manager.statusMessage;
    if (ok) {
      token = ''; // Clear password field immediately after save
      hasToken = true;
    }
  }

  async function handleClear() {
    await manager.clear(api);
    url = '';
    token = '';
    hasToken = false;
    statusKind = 'idle';
    statusMsg = manager.statusMessage;
  }
</script>

<div class="accounts-settings">
  <div class="card-title">GITLAB ACCOUNT (KEYCHAIN)</div>
  <div class="card-desc">
    Konfigurasi akun GitLab untuk melihat MR, komentar, dan review. Token PAT disimpan aman di macOS Keychain.
  </div>

  <div class="field-group">
    <label for="gl-url">GitLab Instance URL</label>
    <input
      id="gl-url"
      type="url"
      placeholder="https://gitlab.example.com"
      bind:value={url}
    />
  </div>

  <div class="field-group">
    <label for="gl-token">
      Personal Access Token (PAT)
      {#if hasToken}
        <span class="has-token-badge">✓ Tersimpan di Keychain</span>
      {/if}
    </label>
    <input
      id="gl-token"
      type="password"
      placeholder={hasToken ? '•••••••••••••••• (masukkan baru untuk mengganti)' : 'glpat-xxxxxxxxxxxxxxxxxxxx'}
      bind:value={token}
      autocomplete="off"
    />
    <span class="field-help">Scope minimum: <code>read_api</code> (baca MR) atau <code>api</code> (approve/merge).</span>
  </div>

  {#if statusMsg}
    <div
      class="status-msg"
      class:error={statusKind === 'error'}
      class:success={statusKind === 'success'}
      class:testing={statusKind === 'testing'}
    >
      {statusMsg}
    </div>
  {/if}

  <div class="account-actions">
    <button class="btn-test" onclick={handleTest} disabled={statusKind === 'testing'}>
      {statusKind === 'testing' ? 'Testing…' : 'Test Koneksi'}
    </button>
    <button class="btn-save" onclick={handleSave} disabled={statusKind === 'testing'}>
      Simpan ke Keychain
    </button>
    {#if hasToken || url}
      <button class="btn-clear" onclick={handleClear} disabled={statusKind === 'testing'}>
        Hapus Akun
      </button>
    {/if}
  </div>
</div>

<style>
  .accounts-settings {
    margin-top: 20px;
    padding-top: 16px;
    border-top: 1px solid #26282d;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .card-title {
    font-size: 11px;
    font-weight: 700;
    color: #8b8f98;
    letter-spacing: 0.5px;
  }
  .card-desc {
    font-size: 12px;
    color: #8b8f98;
    line-height: 1.4;
  }
  .field-group {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .field-group label {
    font-size: 12px;
    color: #d8d9dc;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .has-token-badge {
    font-size: 11px;
    color: #7fc98f;
    font-weight: 500;
  }
  .field-group input {
    height: 30px;
    padding: 0 10px;
    background: #141518;
    border: 1px solid #26282d;
    border-radius: 4px;
    color: #d8d9dc;
    font-size: 12px;
    font-family: inherit;
    outline: none;
    transition: border-color 0.15s;
  }
  .field-group input:focus {
    border-color: #6ea8ff;
  }
  .field-help {
    font-size: 11px;
    color: #727680;
  }
  .field-help code {
    background: #1e2025;
    padding: 1px 4px;
    border-radius: 3px;
    color: #9cc3ff;
  }
  .status-msg {
    padding: 6px 10px;
    border-radius: 4px;
    font-size: 11.5px;
    background: #1e2025;
    color: #d8d9dc;
  }
  .status-msg.success {
    background: #1b2e22;
    color: #7fc98f;
    border: 1px solid #285437;
  }
  .status-msg.error {
    background: #331d1d;
    color: #f07a74;
    border: 1px solid #572929;
  }
  .status-msg.testing {
    background: #252e3d;
    color: #6ea8ff;
    border: 1px solid #364966;
  }
  .account-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 4px;
  }
  button {
    height: 28px;
    padding: 0 12px;
    border-radius: 4px;
    font-size: 12px;
    cursor: pointer;
    font-weight: 500;
    transition: opacity 0.15s, background 0.15s;
  }
  button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .btn-test {
    background: #1f2a3d;
    border: 1px solid #364966;
    color: #9cc3ff;
  }
  .btn-test:hover:not(:disabled) {
    background: #273752;
  }
  .btn-save {
    background: #2c4d36;
    border: 1px solid #3d6b4b;
    color: #bbf7d0;
  }
  .btn-save:hover:not(:disabled) {
    background: #375f43;
  }
  .btn-clear {
    background: transparent;
    border: 1px solid #3c4048;
    color: #8b8f98;
  }
  .btn-clear:hover:not(:disabled) {
    border-color: #f07a74;
    color: #f07a74;
  }
</style>
