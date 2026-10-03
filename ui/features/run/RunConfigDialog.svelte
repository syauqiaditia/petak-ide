<script lang="ts">
  import { onMount } from 'svelte';
  import { api, type RunConfig, type RunConfigFile } from '../../lib/api';
  import { runStore } from './runStore.svelte';
  import { TOOLCHAIN_FLUTTER_SVG, TOOLCHAIN_ANDROID_SVG } from '../../icons';

  let {
    open = false,
    root = '',
    onClose = () => {},
  }: {
    open?: boolean;
    root?: string;
    onClose?: () => void;
  } = $props();

  let workspaceRoot = $derived(root || runStore.root || '');

  let localConfigs = $state<RunConfig[]>([]);
  let selectedConfigName = $state<string>('');
  let activeRunnerConfigName = $state<string>('');

  let entrypointExists = $state<boolean | null>(null);
  let isCheckingEntrypoint = $state<boolean>(false);
  let checkTimer: ReturnType<typeof setTimeout> | null = null;
  let saveStatus = $state<string | null>(null);

  let suggestedEntrypoints = $state<string[]>([
    'lib/main.dart',
    'lib/main_dev.dart',
    'lib/main_prod.dart',
    'lib/main_staging.dart',
  ]);

  $effect(() => {
    if (open && workspaceRoot) {
      api
        .findFiles('main', 20)
        .then((matches) => {
          const dartFiles = matches
            .map((m) => m.path)
            .filter((p) => p.endsWith('.dart') && (p.startsWith('lib/') || p.includes('main')));
          const set = new Set([...suggestedEntrypoints, ...dartFiles]);
          suggestedEntrypoints = Array.from(set);
        })
        .catch(() => {});
    }
  });

  $effect(() => {
    if (open) {
      // Clone from runStore
      const currentConfigs = runStore.configs;
      if (currentConfigs && currentConfigs.length > 0) {
        localConfigs = JSON.parse(JSON.stringify(currentConfigs));
      } else {
        localConfigs = [
          {
            name: 'dev',
            kind: 'flutter',
            target: 'lib/main.dart',
            flavor: 'dev',
            additionalArgs: '',
            dartDefines: ['ENV=dev'],
          },
        ];
      }
      activeRunnerConfigName = runStore.selectedConfigName || localConfigs[0]?.name || 'dev';
      selectedConfigName = activeRunnerConfigName || localConfigs[0]?.name || 'dev';
      saveStatus = null;
    }
  });

  let currentSelectedConfig = $derived<RunConfig | null>(
    localConfigs.find((c) => c.name === selectedConfigName) ?? localConfigs[0] ?? null
  );

  let flutterConfigs = $derived(localConfigs.filter((c) => c.kind === 'flutter'));
  let gradleConfigs = $derived(localConfigs.filter((c) => c.kind === 'gradle'));

  // Live entrypoint existence check
  $effect(() => {
    const cfg = currentSelectedConfig;
    const currentRoot = workspaceRoot;
    if (!cfg || cfg.kind !== 'flutter' || !cfg.target?.trim() || !currentRoot) {
      entrypointExists = null;
      return;
    }

    const targetPath = cfg.target.trim();
    if (checkTimer) clearTimeout(checkTimer);
    checkTimer = setTimeout(async () => {
      isCheckingEntrypoint = true;
      try {
        const fullPath = targetPath.startsWith('/') ? targetPath : `${currentRoot}/${targetPath}`;
        await api.readFile(fullPath);
        entrypointExists = true;
      } catch {
        entrypointExists = false;
      } finally {
        isCheckingEntrypoint = false;
      }
    }, 200);
  });

  function handleSelectConfig(cfg: RunConfig) {
    selectedConfigName = cfg.name;
  }

  function handleAddConfig(kind: 'flutter' | 'gradle') {
    const baseName = kind === 'flutter' ? 'flutter_run' : 'gradle_task';
    let counter = 1;
    let name = `${baseName}_${counter}`;
    while (localConfigs.some((c) => c.name === name)) {
      counter++;
      name = `${baseName}_${counter}`;
    }

    const newCfg: RunConfig =
      kind === 'flutter'
        ? {
            name,
            kind: 'flutter',
            target: 'lib/main.dart',
            flavor: '',
            additionalArgs: '',
            dartDefines: [],
          }
        : {
            name,
            kind: 'gradle',
            module: 'app',
            variant: 'assembleDebug',
            additionalArgs: '',
          };

    localConfigs = [...localConfigs, newCfg];
    selectedConfigName = name;
  }

  function handleRemoveConfig() {
    if (localConfigs.length <= 1) {
      window.alert('Minimal satu konfigurasi run harus tersedia.');
      return;
    }
    const removedName = selectedConfigName;
    const currentIndex = localConfigs.findIndex((c) => c.name === removedName);
    const nextConfig = localConfigs[currentIndex + 1] ?? localConfigs[currentIndex - 1] ?? null;
    localConfigs = localConfigs.filter((c) => c.name !== removedName);
    if (nextConfig) {
      selectedConfigName = nextConfig.name;
    } else if (localConfigs.length > 0) {
      selectedConfigName = localConfigs[0].name;
    }
    if (activeRunnerConfigName === removedName) {
      activeRunnerConfigName = selectedConfigName;
    }
  }

  function handleDuplicateConfig() {
    if (!currentSelectedConfig) return;
    const original = currentSelectedConfig;
    let copyName = `${original.name}_copy`;
    let counter = 1;
    while (localConfigs.some((c) => c.name === copyName)) {
      counter++;
      copyName = `${original.name}_copy${counter}`;
    }

    const duplicate: RunConfig = {
      ...JSON.parse(JSON.stringify(original)),
      name: copyName,
    };

    localConfigs = [...localConfigs, duplicate];
    selectedConfigName = copyName;
  }

  async function persistConfigs(setActive: boolean = false): Promise<boolean> {
    if (!workspaceRoot) return false;

    // Validate names are non-empty and unique
    const names = new Set<string>();
    for (const c of localConfigs) {
      const trimmed = c.name.trim();
      if (!trimmed) {
        window.alert('Nama konfigurasi tidak boleh kosong.');
        return false;
      }
      if (names.has(trimmed)) {
        window.alert(`Nama konfigurasi '${trimmed}' duplikat. Setiap nama harus unik.`);
        return false;
      }
      names.add(trimmed);
      c.name = trimmed;
    }

    const targetActive = setActive && currentSelectedConfig
      ? currentSelectedConfig.name
      : activeRunnerConfigName || localConfigs[0]?.name || '';

    const payload: RunConfigFile = {
      selected: targetActive,
      configs: localConfigs,
    };

    try {
      await api.runConfigsSave(workspaceRoot, payload);
      await runStore.saveConfigs(payload);
      activeRunnerConfigName = targetActive;
      saveStatus = '✓ Diterapkan';
      setTimeout(() => (saveStatus = null), 3000);
      return true;
    } catch (e: any) {
      window.alert(`Gagal menyimpan konfigurasi: ${e?.message || e}`);
      return false;
    }
  }

  async function handleApply() {
    await persistConfigs(false);
  }

  async function handleOk() {
    const success = await persistConfigs(true);
    if (success) {
      onClose();
    }
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      onClose();
    } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      handleOk();
    }
  }
</script>

<svelte:window onkeydown={handleKeyDown} />

{#if open}
  <div class="dialog-backdrop" onclick={onClose} role="presentation">
    <div
      class="dialog-box"
      onclick={(e) => e.stopPropagation()}
      role="dialog"
      aria-modal="true"
      tabindex="-1"
    >
      <!-- Dialog Header -->
      <div class="dialog-header">
        <div class="header-title">
          <span class="gear-icon">⚙️</span>
          <span>Run/Debug Configurations</span>
        </div>
        <button class="btn-close" onclick={onClose} aria-label="Tutup dialog">✕</button>
      </div>

      <!-- Dialog Body: 2 Columns -->
      <div class="dialog-body">
        <!-- Left Column: Master Tree / List -->
        <div class="left-pane">
          <!-- Top Toolbar -->
          <div class="pane-toolbar">
            <div class="btn-group">
              <button
                class="tb-btn"
                title="Tambah Konfigurasi Flutter"
                onclick={() => handleAddConfig('flutter')}
              >
                +
              </button>
              <button
                class="tb-btn"
                title="Hapus Konfigurasi Terpilih"
                onclick={handleRemoveConfig}
              >
                −
              </button>
              <button
                class="tb-btn"
                title="Duplikasi Konfigurasi (Copy)"
                onclick={handleDuplicateConfig}
              >
                📋
              </button>
            </div>
            <span class="configs-count">{localConfigs.length} total</span>
          </div>

          <!-- Grouped Configurations List -->
          <div class="configs-list">
            <!-- Flutter Group -->
            <div class="group-header">
              <span class="group-icon">{@html TOOLCHAIN_FLUTTER_SVG}</span>
              <span class="group-label">Flutter</span>
              <span class="group-badge">{flutterConfigs.length}</span>
            </div>
            {#each flutterConfigs as cfg}
              {@const isSelected = currentSelectedConfig?.name === cfg.name}
              {@const isRunnerActive = activeRunnerConfigName === cfg.name}
              <div
                class="config-item"
                class:selected={isSelected}
                onclick={() => handleSelectConfig(cfg)}
                role="button"
                tabindex="0"
                onkeydown={(e) => { if (e.key === 'Enter') handleSelectConfig(cfg); }}
              >
                <span class="active-dot" class:active={isRunnerActive} title={isRunnerActive ? 'Aktif di Runner' : 'Klik untuk jadikan aktif'}></span>
                <div class="item-text">
                  <span class="item-name">{cfg.name}</span>
                  {#if cfg.target}
                    <span class="item-sub">{cfg.target.split('/').pop()}</span>
                  {/if}
                </div>
              </div>
            {/each}

            <!-- Gradle Group -->
            {#if gradleConfigs.length > 0}
              <div class="group-header mt">
                <span class="group-icon">{@html TOOLCHAIN_ANDROID_SVG}</span>
                <span class="group-label">Gradle / Android</span>
                <span class="group-badge">{gradleConfigs.length}</span>
              </div>
              {#each gradleConfigs as cfg}
                {@const isSelected = currentSelectedConfig?.name === cfg.name}
                {@const isRunnerActive = activeRunnerConfigName === cfg.name}
                <div
                  class="config-item"
                  class:selected={isSelected}
                  onclick={() => handleSelectConfig(cfg)}
                  role="button"
                  tabindex="0"
                  onkeydown={(e) => { if (e.key === 'Enter') handleSelectConfig(cfg); }}
                >
                  <span class="active-dot" class:active={isRunnerActive} title={isRunnerActive ? 'Aktif di Runner' : 'Klik untuk jadikan aktif'}></span>
                  <div class="item-text">
                    <span class="item-name">{cfg.name}</span>
                    {#if cfg.variant || cfg.module}
                      <span class="item-sub">{cfg.module || ''}:{cfg.variant || ''}</span>
                    {/if}
                  </div>
                </div>
              {/each}
            {/if}
          </div>
        </div>

        <!-- Right Column: Detail Form Editor -->
        <div class="right-pane">
          {#if currentSelectedConfig}
            <div class="form-container">
              <!-- Name Field -->
              <div class="form-row">
                <label for="cfg-name" class="form-label">Name</label>
                <input
                  id="cfg-name"
                  type="text"
                  class="form-input"
                  value={currentSelectedConfig.name}
                  oninput={(e) => {
                    const newName = (e.target as HTMLInputElement).value;
                    if (currentSelectedConfig) {
                      currentSelectedConfig.name = newName;
                      selectedConfigName = newName;
                    }
                  }}
                  placeholder="e.g. dev, prod, main_uat"
                />
              </div>

              {#if currentSelectedConfig.kind === 'flutter'}
                <!-- Dart Entrypoint Target -->
                <div class="form-row">
                  <label for="cfg-target" class="form-label">Dart Entrypoint Target</label>
                  <div class="input-with-button">
                    <input
                      id="cfg-target"
                      type="text"
                      list="entrypoint-suggestions"
                      class="form-input mono"
                      bind:value={currentSelectedConfig.target}
                      placeholder="lib/main.dart"
                    />
                    <datalist id="entrypoint-suggestions">
                      {#each suggestedEntrypoints as ep}
                        <option value={ep}></option>
                      {/each}
                    </datalist>
                    <button
                      class="browse-btn"
                      type="button"
                      title="Pilih file entrypoint di workspace"
                      onclick={async () => {
                        const p = window.prompt('Masukkan path file entrypoint (relatif dari workspace):', currentSelectedConfig?.target || 'lib/main.dart');
                        if (p && currentSelectedConfig) {
                          currentSelectedConfig.target = p.trim();
                        }
                      }}
                    >
                      📂 Browse…
                    </button>
                  </div>
                  {#if isCheckingEntrypoint}
                    <div class="validation-note checking">Memeriksa keberadaan file…</div>
                  {:else if entrypointExists === true}
                    <div class="validation-note valid">✓ File ditemukan di workspace</div>
                  {:else if entrypointExists === false}
                    <div class="validation-note missing">⚠ File tidak ditemukan pada direktori proyek</div>
                  {/if}
                </div>

                <!-- Additional Run Arguments -->
                <div class="form-row">
                  <label for="cfg-args" class="form-label">Additional Run Arguments</label>
                  <input
                    id="cfg-args"
                    type="text"
                    class="form-input mono"
                    bind:value={currentSelectedConfig.additionalArgs}
                    placeholder="--flavor dev --dart-define=ENV=dev"
                  />
                  <span class="field-hint">Argumen CLI tambahan yang diteruskan ke <code>flutter run</code>.</span>
                </div>

                <!-- Build Flavor -->
                <div class="form-row">
                  <label for="cfg-flavor" class="form-label">Build Flavor (Opsional)</label>
                  <input
                    id="cfg-flavor"
                    type="text"
                    class="form-input"
                    bind:value={currentSelectedConfig.flavor}
                    placeholder="dev, prod, staging"
                  />
                </div>
              {:else}
                <!-- Gradle Variant / Task -->
                <div class="form-row">
                  <label for="cfg-module" class="form-label">Gradle Module</label>
                  <input
                    id="cfg-module"
                    type="text"
                    class="form-input mono"
                    bind:value={currentSelectedConfig.module}
                    placeholder="app"
                  />
                </div>

                <div class="form-row">
                  <label for="cfg-variant" class="form-label">Build Task / Variant</label>
                  <input
                    id="cfg-variant"
                    type="text"
                    class="form-input mono"
                    bind:value={currentSelectedConfig.variant}
                    placeholder="assembleDebug"
                  />
                </div>
              {/if}
            </div>
          {:else}
            <div class="empty-state">Pilih konfigurasi dari daftar di sebelah kiri.</div>
          {/if}
        </div>
      </div>

      <!-- Dialog Footer -->
      <div class="dialog-footer">
        <div class="footer-left">
          <span class="file-icon">💾</span>
          <span class="file-notice">Disimpan di .petak/run.json</span>
          {#if saveStatus}
            <span class="save-status">{saveStatus}</span>
          {/if}
        </div>

        <div class="footer-right">
          <button class="btn-secondary" onclick={onClose}>Batal</button>
          <button class="btn-secondary" onclick={handleApply}>Terapkan</button>
          <button class="btn-primary" onclick={handleOk}>OK</button>
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  .dialog-backdrop {
    position: fixed;
    inset: 0;
    z-index: 1000;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.65);
    backdrop-filter: blur(4px);
  }

  .dialog-box {
    width: 820px;
    max-width: 95vw;
    height: 540px;
    max-height: 90vh;
    display: flex;
    flex-direction: column;
    background: #1c1d22;
    border: 1px solid #26282d;
    border-radius: 12px;
    box-shadow: 0 16px 40px rgba(0, 0, 0, 0.5);
    overflow: hidden;
    user-select: none;
    -webkit-user-select: none;
    font-family: 'Geist', system-ui, -apple-system, sans-serif;
  }

  .dialog-header {
    height: 44px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 16px;
    background: #16171a;
    border-bottom: 1px solid #26282d;
  }

  .header-title {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 14px;
    font-weight: 600;
    color: #e6e7ea;
  }

  .btn-close {
    width: 26px;
    height: 26px;
    border-radius: 4px;
    display: grid;
    place-items: center;
    color: #8b8f98;
    background: transparent;
    border: none;
    cursor: pointer;
    font-size: 14px;
  }

  .btn-close:hover {
    background: #26282d;
    color: #ffffff;
  }

  .dialog-body {
    flex: 1;
    display: flex;
    min-height: 0;
  }

  /* Left Column */
  .left-pane {
    width: 260px;
    display: flex;
    flex-direction: column;
    border-right: 1px solid #26282d;
    background: #141518;
  }

  .pane-toolbar {
    height: 36px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 10px;
    border-bottom: 1px solid #26282d;
    background: #18191d;
  }

  .btn-group {
    display: flex;
    gap: 4px;
  }

  .tb-btn {
    width: 24px;
    height: 24px;
    border-radius: 4px;
    display: grid;
    place-items: center;
    background: #202227;
    border: 1px solid #2c2e34;
    color: #b9bcc3;
    font-size: 13px;
    cursor: pointer;
    transition: all 0.1s;
  }

  .tb-btn:hover {
    background: #2a2c33;
    color: #ffffff;
    border-color: #3e414a;
  }

  .configs-count {
    font-size: 11px;
    color: #787c86;
  }

  .configs-list {
    flex: 1;
    overflow-y: auto;
    padding: 6px 0;
  }

  .group-header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px 4px 12px;
    font-size: 11px;
    font-weight: 600;
    color: #787c86;
    letter-spacing: 0.3px;
  }

  .group-header.mt {
    margin-top: 8px;
    border-top: 1px solid #202227;
    padding-top: 8px;
  }

  .group-icon {
    display: flex;
    align-items: center;
    width: 14px;
    height: 14px;
    color: #8b8f98;
  }

  .group-label {
    flex: 1;
  }

  .group-badge {
    font-size: 10px;
    background: #202227;
    color: #8b8f98;
    padding: 1px 5px;
    border-radius: 10px;
  }

  .config-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    cursor: pointer;
    transition: background 0.1s;
  }

  .config-item:hover {
    background: #1c1d22;
  }

  .config-item.selected {
    background: #1e2433;
    border-left: 3px solid #3574f0;
  }

  .active-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #3e414a;
    flex-shrink: 0;
  }

  .active-dot.active {
    background: #7fc98f;
    box-shadow: 0 0 6px rgba(127, 201, 143, 0.6);
  }

  .item-text {
    display: flex;
    flex-direction: column;
    min-width: 0;
    overflow: hidden;
  }

  .item-name {
    font-size: 12.5px;
    color: #d8d9dc;
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .config-item.selected .item-name {
    color: #ffffff;
    font-weight: 600;
  }

  .item-sub {
    font-size: 10.5px;
    color: #787c86;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Right Column: Form Editor */
  .right-pane {
    flex: 1;
    overflow-y: auto;
    padding: 20px 24px;
    background: #18191d;
  }

  .form-container {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .form-row {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .form-label {
    font-size: 12px;
    font-weight: 600;
    color: #b9bcc3;
  }

  .form-input {
    height: 32px;
    padding: 0 10px;
    border-radius: 6px;
    background: #141518;
    border: 1px solid #2c2e34;
    color: #e6e7ea;
    font-size: 12.5px;
    font-family: inherit;
    outline: none;
    transition: border-color 0.15s;
  }

  .form-input:focus {
    border-color: #3574f0;
    box-shadow: 0 0 0 1px #3574f0;
  }

  .form-input.mono {
    font-family: 'JetBrains Mono', monospace;
    font-size: 12px;
  }

  .input-with-button {
    display: flex;
    gap: 8px;
  }

  .input-with-button .form-input {
    flex: 1;
  }

  .browse-btn {
    height: 32px;
    padding: 0 12px;
    border-radius: 6px;
    background: #202227;
    border: 1px solid #2c2e34;
    color: #d8d9dc;
    font-size: 12px;
    cursor: pointer;
    white-space: nowrap;
    transition: all 0.1s;
  }

  .browse-btn:hover {
    background: #282a32;
    border-color: #3e414a;
  }

  .validation-note {
    font-size: 11px;
    margin-top: 2px;
  }

  .validation-note.valid {
    color: #7fc98f;
  }

  .validation-note.missing {
    color: #f07a74;
  }

  .validation-note.checking {
    color: #e8b45a;
  }

  .field-hint {
    font-size: 11px;
    color: #787c86;
  }

  .field-hint code {
    background: #202227;
    padding: 1px 4px;
    border-radius: 3px;
    font-family: 'JetBrains Mono', monospace;
  }

  .empty-state {
    display: grid;
    place-items: center;
    height: 200px;
    color: #787c86;
    font-size: 13px;
  }

  /* Footer */
  .dialog-footer {
    height: 48px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 16px;
    background: #141518;
    border-top: 1px solid #26282d;
  }

  .footer-left {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 11.5px;
    color: #787c86;
  }

  .file-icon {
    font-size: 13px;
  }

  .save-status {
    color: #7fc98f;
    font-weight: 500;
  }

  .footer-right {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .btn-secondary {
    height: 30px;
    padding: 0 14px;
    border-radius: 6px;
    background: #202227;
    border: 1px solid #2c2e34;
    color: #d8d9dc;
    font-size: 12.5px;
    cursor: pointer;
    transition: all 0.1s;
  }

  .btn-secondary:hover {
    background: #282a32;
    color: #ffffff;
  }

  .btn-primary {
    height: 30px;
    padding: 0 16px;
    border-radius: 6px;
    background: #3574f0;
    border: 1px solid #3574f0;
    color: #ffffff;
    font-size: 12.5px;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s;
  }

  .btn-primary:hover {
    background: #4884f8;
  }
</style>
