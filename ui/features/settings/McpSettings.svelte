<script lang="ts">
  import { onMount } from 'svelte';
  import {
    mcpStore,
    MCP_PRESETS,
    formatMcpTestResult,
    parseArgsString,
    formatArgsString,
    parseEnvEntries,
    buildEnvRecord,
    type McpPreset,
  } from './mcpStore.svelte';
  import type { McpServerConfig } from '../../lib/api';

  let { root = '' }: { root?: string } = $props();

  let isModalOpen = $state(false);
  let modalMode = $state<'add' | 'edit'>('add');
  let originalServerName = $state('');

  // Form fields
  let formName = $state('');
  let formCommand = $state('');
  let formArgs = $state('');
  let formEnvRows = $state<Array<{ key: string; value: string }>>([]);
  let formAutoApprove = $state('');
  let formDisabled = $state(false);
  let formError = $state<string | null>(null);

  // Delete confirmation
  let deleteConfirmServerName = $state<string | null>(null);

  onMount(async () => {
    await mcpStore.loadConfig(root);
  });

  function openAddModal(preset?: McpPreset) {
    modalMode = 'add';
    originalServerName = '';
    formError = null;

    if (preset) {
      applyPreset(preset);
    } else {
      const defaultPreset = MCP_PRESETS[0];
      applyPreset(defaultPreset);
    }

    isModalOpen = true;
  }

  function applyPreset(preset: McpPreset) {
    formName = preset.id === 'custom' ? '' : preset.id;
    formCommand = preset.config.command;
    formArgs = formatArgsString(preset.config.args);
    formEnvRows = parseEnvEntries(preset.config.env);
    formAutoApprove = (preset.config.autoApprove || []).join(', ');
    formDisabled = false;
  }

  function handlePresetSelect(e: Event) {
    const val = (e.target as HTMLSelectElement).value;
    const preset = MCP_PRESETS.find((p) => p.id === val);
    if (preset) {
      applyPreset(preset);
    }
  }

  function openEditModal(name: string, config: McpServerConfig) {
    modalMode = 'edit';
    originalServerName = name;
    formError = null;

    formName = name;
    formCommand = config.command || '';
    formArgs = formatArgsString(config.args);
    formEnvRows = parseEnvEntries(config.env);
    formAutoApprove = (config.autoApprove || []).join(', ');
    formDisabled = config.disabled ?? false;

    isModalOpen = true;
  }

  function closeModal() {
    isModalOpen = false;
    formError = null;
  }

  function addEnvRow() {
    formEnvRows = [...formEnvRows, { key: '', value: '' }];
  }

  function removeEnvRow(index: number) {
    formEnvRows = formEnvRows.filter((_, i) => i !== index);
  }

  async function handleSaveForm() {
    const trimmedName = formName.trim();
    const trimmedCommand = formCommand.trim();

    if (!trimmedName) {
      formError = 'Nama server tidak boleh kosong.';
      return;
    }
    if (!trimmedCommand) {
      formError = 'Command executable tidak boleh kosong.';
      return;
    }

    // Name conflict check on add or rename
    if (
      (modalMode === 'add' || trimmedName !== originalServerName) &&
      mcpStore.config.mcpServers?.[trimmedName]
    ) {
      formError = `Server dengan nama "${trimmedName}" sudah ada.`;
      return;
    }

    const serverConfig: McpServerConfig = {
      command: trimmedCommand,
      args: parseArgsString(formArgs),
      env: buildEnvRecord(formEnvRows),
      disabled: formDisabled,
      autoApprove: formAutoApprove
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    };

    try {
      if (modalMode === 'edit' && originalServerName !== trimmedName) {
        await mcpStore.removeServer(originalServerName, root);
      }
      await mcpStore.addOrUpdateServer(trimmedName, serverConfig, root);
      closeModal();
    } catch (err: any) {
      formError = err?.message || 'Gagal menyimpan konfigurasi server MCP.';
    }
  }

  async function handleDelete(name: string) {
    try {
      await mcpStore.removeServer(name, root);
      deleteConfirmServerName = null;
    } catch (err) {
      console.error('Failed to remove server:', err);
    }
  }

  async function handleTest(name: string) {
    await mcpStore.testServer(name);
  }

  const serverEntries = $derived(Object.entries(mcpStore.config.mcpServers || {}));
</script>

<div class="mcp-settings">
  <div class="mcp-header">
    <div>
      <h2 class="settings-section-title">Model Context Protocol (MCP)</h2>
      <p class="setting-hint">
        Konfigurasi server MCP stdio di <code>.petak/mcp.json</code>. Server aktif diteruskan langsung ke runtime AI Agent untuk kemampuan eksekusi tools tambahan.
      </p>
    </div>
    <div class="header-actions">
      <button class="btn-primary" onclick={() => openAddModal()}>
        <span class="btn-icon">+</span> Tambah Server
      </button>
    </div>
  </div>

  <!-- Quick Presets Bar -->
  <div class="presets-quick-bar">
    <span class="quick-presets-label">Preset Cepat:</span>
    {#each MCP_PRESETS.filter((p) => p.id !== 'custom') as preset}
      <button class="preset-chip-btn" onclick={() => openAddModal(preset)} title={preset.description}>
        {preset.name}
      </button>
    {/each}
  </div>

  <!-- Server List -->
  {#if serverEntries.length === 0}
    <div class="empty-mcp-state">
      <div class="empty-icon">🔌</div>
      <div class="empty-title">Belum ada server MCP terdaftar</div>
      <div class="empty-desc">
        Server MCP memungkinkan agen membaca berkas lokal, basis data SQLite, memori jangka panjang, atau repositori GitLab secara terstruktur.
      </div>
      <div class="empty-presets">
        {#each MCP_PRESETS.filter((p) => p.id !== 'custom') as preset}
          <button class="btn-secondary" onclick={() => openAddModal(preset)}>
            + Gunakan {preset.name}
          </button>
        {/each}
      </div>
    </div>
  {:else}
    <div class="mcp-cards-grid">
      {#each serverEntries as [name, srv]}
        {@const isTesting = mcpStore.isTesting[name] ?? false}
        {@const testRes = mcpStore.testResults[name]}
        {@const formattedRes = formatMcpTestResult(testRes)}
        {@const envCount = Object.keys(srv.env || {}).length}
        {@const autoApproveList = srv.autoApprove || []}

        <div class="mcp-card" class:disabled={srv.disabled}>
          <div class="mcp-card-header">
            <div class="name-status-group">
              <span class="server-name">{name}</span>
              {#if srv.disabled}
                <span class="badge badge-dimmed">Nonaktif</span>
              {:else}
                <span class="badge badge-active">● Aktif</span>
              {/if}
            </div>

            <div class="card-toggle-wrap">
              <label class="switch" title={srv.disabled ? 'Aktifkan server ini' : 'Nonaktifkan server ini'}>
                <input
                  type="checkbox"
                  checked={!srv.disabled}
                  onchange={() => mcpStore.toggleServer(name, root)}
                />
                <span class="slider round"></span>
              </label>
            </div>
          </div>

          <!-- Command Display -->
          <div class="mcp-card-command">
            <code class="cmd-text">{srv.command} {formatArgsString(srv.args)}</code>
          </div>

          <!-- Badges Metadata -->
          <div class="mcp-card-meta">
            {#if envCount > 0}
              <span class="meta-badge" title="Variabel environment">
                🔐 {envCount} env {envCount === 1 ? 'var' : 'vars'}
              </span>
            {/if}
            {#if autoApproveList.length > 0}
              <span class="meta-badge badge-approve" title="Tools yang di-auto-approve tanpa prompt">
                ⚡ Auto: {autoApproveList.join(', ')}
              </span>
            {/if}
          </div>

          <!-- Test Result Banner (if tested) -->
          {#if formattedRes.status !== 'idle'}
            <div class="test-result-bar" class:test-ok={formattedRes.status === 'ok'} class:test-err={formattedRes.status === 'error'}>
              {#if formattedRes.status === 'ok'}
                <span>✓ {formattedRes.label}</span>
              {:else}
                <span>✕ {formattedRes.label}</span>
              {/if}
            </div>
          {/if}

          <!-- Footer Actions -->
          <div class="mcp-card-footer">
            <div class="footer-left">
              <button
                class="btn-test"
                disabled={isTesting}
                onclick={() => handleTest(name)}
                title="Jalankan tes koneksi stdio subprocess"
              >
                {#if isTesting}
                  <span class="spinner"></span> Menguji…
                {:else}
                  ▶ Test
                {/if}
              </button>
            </div>

            <div class="footer-right">
              <button class="btn-ghost" onclick={() => openEditModal(name, srv)}>
                Edit
              </button>
              <button class="btn-ghost danger" onclick={() => (deleteConfirmServerName = name)}>
                Hapus
              </button>
            </div>
          </div>

          <!-- Delete Confirmation Box -->
          {#if deleteConfirmServerName === name}
            <div class="delete-confirm-box">
              <span>Hapus server <strong>{name}</strong>?</span>
              <div class="delete-btns">
                <button class="btn-danger-sm" onclick={() => handleDelete(name)}>Hapus</button>
                <button class="btn-ghost-sm" onclick={() => (deleteConfirmServerName = null)}>Batal</button>
              </div>
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>

<!-- Modal Form: Tambah / Edit Server MCP -->
{#if isModalOpen}
  <div class="modal-backdrop" onclick={closeModal} role="presentation">
    <div class="modal-dialog" onclick={(e) => e.stopPropagation()} role="dialog" tabindex="-1">
      <div class="modal-header">
        <h3 class="modal-title">
          {modalMode === 'add' ? 'Tambah Server MCP' : `Edit Server "${originalServerName}"`}
        </h3>
        <button class="close-btn" onclick={closeModal} aria-label="Close">✕</button>
      </div>

      <div class="modal-body">
        {#if formError}
          <div class="form-error-banner">
            <span>⚠ {formError}</span>
          </div>
        {/if}

        <!-- Quick Template Selector inside form -->
        {#if modalMode === 'add'}
          <div class="form-group">
            <label for="mcp-preset-select" class="form-label">Gunakan Template / Preset:</label>
            <select id="mcp-preset-select" class="form-select" onchange={handlePresetSelect}>
              {#each MCP_PRESETS as preset}
                <option value={preset.id}>{preset.name} — {preset.description}</option>
              {/each}
            </select>
          </div>
        {/if}

        <!-- Server Name -->
        <div class="form-group">
          <label for="mcp-name" class="form-label">Nama Server (Identifier):</label>
          <input
            id="mcp-name"
            type="text"
            class="form-input"
            placeholder="misal: filesystem, memory, sqlite"
            bind:value={formName}
          />
        </div>

        <!-- Command -->
        <div class="form-group">
          <label for="mcp-command" class="form-label">Command Executable:</label>
          <input
            id="mcp-command"
            type="text"
            class="form-input"
            placeholder="misal: npx, uvx, node, python3"
            bind:value={formCommand}
          />
        </div>

        <!-- Args -->
        <div class="form-group">
          <label for="mcp-args" class="form-label">Arguments (Spasi atau Tanda Petik):</label>
          <input
            id="mcp-args"
            type="text"
            class="form-input"
            placeholder="misal: -y @modelcontextprotocol/server-filesystem ."
            bind:value={formArgs}
          />
          <span class="field-hint">Argumen diteruskan ke proses stdio saat di-spawn oleh Petak Agent.</span>
        </div>

        <!-- Env Variables -->
        <div class="form-group">
          <div class="env-header-row">
            <span class="form-label">Environment Variables:</span>
            <button type="button" class="btn-link" onclick={addEnvRow}>+ Tambah Baris</button>
          </div>

          {#if formEnvRows.length === 0}
            <div class="empty-env-hint">Tidak ada environment variable khusus.</div>
          {:else}
            <div class="env-rows-container">
              {#each formEnvRows as row, i}
                <div class="env-row">
                  <input
                    type="text"
                    class="form-input env-key"
                    placeholder="KEY (e.g. GITLAB_TOKEN)"
                    bind:value={row.key}
                  />
                  <span class="env-eq">=</span>
                  <input
                    type="text"
                    class="form-input env-val"
                    placeholder="VALUE"
                    bind:value={row.value}
                  />
                  <button
                    type="button"
                    class="btn-row-delete"
                    onclick={() => removeEnvRow(i)}
                    title="Hapus baris"
                  >
                    ✕
                  </button>
                </div>
              {/each}
            </div>
          {/if}
        </div>

        <!-- Auto Approve Tools -->
        <div class="form-group">
          <label for="mcp-auto-approve" class="form-label">Auto-Approve Tools (Opsional):</label>
          <input
            id="mcp-auto-approve"
            type="text"
            class="form-input"
            placeholder="misal: read_file, list_directory (dipisah koma)"
            bind:value={formAutoApprove}
          />
          <span class="field-hint">Nama tools MCP yang dapat dieksekusi otomatis tanpa konfirmasi pengguna.</span>
        </div>

        <!-- Toggle Disabled -->
        <div class="form-group form-checkbox-group">
          <label class="checkbox-label">
            <input type="checkbox" bind:checked={formDisabled} />
            <span>Nonaktifkan server ini untuk sementara</span>
          </label>
        </div>
      </div>

      <div class="modal-footer">
        <button class="btn-secondary" onclick={closeModal}>Batal</button>
        <button class="btn-primary" onclick={handleSaveForm}>
          {modalMode === 'add' ? 'Simpan Server' : 'Perbarui Server'}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .mcp-settings {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .mcp-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
  }

  .settings-section-title {
    font-size: 16px;
    font-weight: 600;
    color: #f1f2f4;
    margin: 0;
  }

  .setting-hint {
    font-size: 12px;
    color: #8b949e;
    margin: 4px 0 0;
    line-height: 1.4;
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
  }

  .btn-primary {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: #2f81f7;
    color: #ffffff;
    border: none;
    border-radius: 6px;
    padding: 6px 12px;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .btn-primary:hover {
    background: #388bfd;
  }

  .btn-secondary {
    background: #21262d;
    border: 1px solid rgba(255, 255, 255, 0.12);
    color: #c9d1d9;
    border-radius: 6px;
    padding: 6px 12px;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .btn-secondary:hover {
    background: #30363d;
    color: #ffffff;
  }

  .btn-icon {
    font-size: 14px;
    font-weight: bold;
  }

  /* Quick Presets Bar */
  .presets-quick-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    background: #15161b;
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 8px;
    flex-wrap: wrap;
  }

  .quick-presets-label {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    color: #8b949e;
    letter-spacing: 0.5px;
  }

  .preset-chip-btn {
    background: #1c1e24;
    border: 1px solid rgba(255, 255, 255, 0.08);
    color: #c9d1d9;
    border-radius: 4px;
    padding: 3px 8px;
    font-size: 12px;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .preset-chip-btn:hover {
    background: #2f81f7;
    color: #ffffff;
    border-color: #2f81f7;
  }

  /* Empty state */
  .empty-mcp-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    padding: 36px 20px;
    background: #15161b;
    border: 1px dashed rgba(255, 255, 255, 0.12);
    border-radius: 8px;
    gap: 10px;
  }

  .empty-icon {
    font-size: 32px;
  }

  .empty-title {
    font-size: 15px;
    font-weight: 600;
    color: #f1f2f4;
  }

  .empty-desc {
    font-size: 12px;
    color: #8b949e;
    max-width: 480px;
    line-height: 1.5;
  }

  .empty-presets {
    display: flex;
    gap: 8px;
    margin-top: 10px;
    flex-wrap: wrap;
    justify-content: center;
  }

  /* Cards Grid */
  .mcp-cards-grid {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .mcp-card {
    background: #15161b;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 8px;
    padding: 12px 16px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    transition: border-color 0.15s ease;
  }

  .mcp-card:hover {
    border-color: rgba(255, 255, 255, 0.16);
  }

  .mcp-card.disabled {
    opacity: 0.7;
    border-style: dashed;
  }

  .mcp-card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .name-status-group {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .server-name {
    font-size: 14px;
    font-weight: 600;
    color: #f1f2f4;
  }

  .badge {
    font-size: 11px;
    padding: 2px 7px;
    border-radius: 4px;
    font-weight: 500;
  }

  .badge-active {
    background: rgba(46, 160, 67, 0.15);
    color: #3fb950;
    border: 1px solid rgba(46, 160, 67, 0.3);
  }

  .badge-dimmed {
    background: rgba(139, 148, 158, 0.15);
    color: #8b949e;
    border: 1px solid rgba(139, 148, 158, 0.3);
  }

  /* Switch Toggle */
  .switch {
    position: relative;
    display: inline-block;
    width: 34px;
    height: 18px;
  }

  .switch input {
    opacity: 0;
    width: 0;
    height: 0;
  }

  .slider {
    position: absolute;
    cursor: pointer;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background-color: #30363d;
    transition: 0.2s;
  }

  .slider:before {
    position: absolute;
    content: "";
    height: 14px;
    width: 14px;
    left: 2px;
    bottom: 2px;
    background-color: white;
    transition: 0.2s;
  }

  input:checked + .slider {
    background-color: #2ea043;
  }

  input:checked + .slider:before {
    transform: translateX(16px);
  }

  .slider.round {
    border-radius: 18px;
  }

  .slider.round:before {
    border-radius: 50%;
  }

  /* Command display */
  .mcp-card-command {
    background: #0f1013;
    padding: 6px 10px;
    border-radius: 6px;
    border: 1px solid rgba(255, 255, 255, 0.04);
    overflow-x: auto;
  }

  .cmd-text {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 12px;
    color: #79c0ff;
    white-space: pre;
  }

  /* Metadata badges */
  .mcp-card-meta {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .meta-badge {
    font-size: 11px;
    padding: 2px 6px;
    background: #1c1e24;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 4px;
    color: #8b949e;
  }

  .badge-approve {
    color: #d2a8ff;
    border-color: rgba(210, 168, 255, 0.2);
    background: rgba(210, 168, 255, 0.08);
  }

  /* Test Result Bar */
  .test-result-bar {
    font-size: 11px;
    padding: 4px 8px;
    border-radius: 4px;
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .test-ok {
    background: rgba(46, 160, 67, 0.12);
    color: #3fb950;
    border: 1px solid rgba(46, 160, 67, 0.25);
  }

  .test-err {
    background: rgba(248, 81, 73, 0.12);
    color: #f85149;
    border: 1px solid rgba(248, 81, 73, 0.25);
  }

  /* Footer */
  .mcp-card-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 2px;
    padding-top: 8px;
    border-top: 1px solid rgba(255, 255, 255, 0.05);
  }

  .footer-left, .footer-right {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .btn-test {
    background: #21262d;
    border: 1px solid rgba(255, 255, 255, 0.1);
    color: #c9d1d9;
    border-radius: 4px;
    padding: 4px 10px;
    font-size: 12px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    transition: background 0.15s ease;
  }

  .btn-test:hover:not(:disabled) {
    background: #30363d;
    color: #ffffff;
  }

  .btn-ghost {
    background: transparent;
    border: none;
    color: #8b949e;
    font-size: 12px;
    cursor: pointer;
    padding: 4px 6px;
    border-radius: 4px;
    transition: color 0.15s ease;
  }

  .btn-ghost:hover {
    color: #c9d1d9;
    background: rgba(255, 255, 255, 0.04);
  }

  .btn-ghost.danger:hover {
    color: #f85149;
    background: rgba(248, 81, 73, 0.1);
  }

  .delete-confirm-box {
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: rgba(248, 81, 73, 0.1);
    border: 1px solid rgba(248, 81, 73, 0.3);
    padding: 6px 12px;
    border-radius: 6px;
    font-size: 12px;
    color: #f85149;
  }

  .delete-btns {
    display: flex;
    gap: 6px;
  }

  .btn-danger-sm {
    background: #da3633;
    border: none;
    color: #ffffff;
    border-radius: 4px;
    padding: 2px 8px;
    font-size: 11px;
    cursor: pointer;
  }

  .btn-ghost-sm {
    background: transparent;
    border: 1px solid rgba(255, 255, 255, 0.1);
    color: #c9d1d9;
    border-radius: 4px;
    padding: 2px 8px;
    font-size: 11px;
    cursor: pointer;
  }

  /* Modal Form */
  .modal-backdrop {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.65);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 9999;
    backdrop-filter: blur(2px);
  }

  .modal-dialog {
    background: #1c1e24;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 10px;
    width: 520px;
    max-width: 90vw;
    max-height: 85vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.6);
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 18px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  }

  .modal-title {
    font-size: 15px;
    font-weight: 600;
    color: #f1f2f4;
    margin: 0;
  }

  .close-btn {
    background: transparent;
    border: none;
    color: #8b949e;
    font-size: 16px;
    cursor: pointer;
  }

  .close-btn:hover {
    color: #f1f2f4;
  }

  .modal-body {
    padding: 16px 18px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .form-error-banner {
    background: rgba(248, 81, 73, 0.12);
    border: 1px solid rgba(248, 81, 73, 0.3);
    color: #f85149;
    padding: 8px 12px;
    border-radius: 6px;
    font-size: 12px;
  }

  .form-group {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .form-label {
    font-size: 12px;
    font-weight: 500;
    color: #c9d1d9;
  }

  .form-input, .form-select {
    background: #15161b;
    border: 1px solid rgba(255, 255, 255, 0.12);
    color: #f1f2f4;
    border-radius: 6px;
    padding: 7px 10px;
    font-size: 13px;
    outline: none;
  }

  .form-input:focus, .form-select:focus {
    border-color: #2f81f7;
  }

  .field-hint {
    font-size: 11px;
    color: #8b949e;
    line-height: 1.3;
  }

  .env-header-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .btn-link {
    background: transparent;
    border: none;
    color: #2f81f7;
    font-size: 12px;
    cursor: pointer;
    padding: 0;
  }

  .btn-link:hover {
    text-decoration: underline;
  }

  .empty-env-hint {
    font-size: 12px;
    color: #6e7681;
    font-style: italic;
  }

  .env-rows-container {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .env-row {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .env-key {
    flex: 1;
    font-family: monospace;
    font-size: 12px;
  }

  .env-eq {
    color: #8b949e;
    font-weight: bold;
  }

  .env-val {
    flex: 1.5;
    font-family: monospace;
    font-size: 12px;
  }

  .btn-row-delete {
    background: transparent;
    border: none;
    color: #8b949e;
    cursor: pointer;
    font-size: 14px;
    padding: 4px;
  }

  .btn-row-delete:hover {
    color: #f85149;
  }

  .form-checkbox-group {
    margin-top: 4px;
  }

  .checkbox-label {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    color: #c9d1d9;
    cursor: pointer;
  }

  .modal-footer {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    padding: 12px 18px;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
  }

  .spinner {
    display: inline-block;
    width: 10px;
    height: 10px;
    border: 2px solid rgba(255, 255, 255, 0.3);
    border-radius: 50%;
    border-top-color: #ffffff;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
