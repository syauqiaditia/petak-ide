<script lang="ts">
  import { onMount } from 'svelte';
  import { settingsStore } from './settingsStore.svelte';
  import { editorSettings } from '../editor/editorSettings.svelte';
  import { getFormatOnSaveConfig, setFormatOnSave } from '../editor/formatLogic';
  import { toolchainStore } from '../toolchain/toolchainStore.svelte';
  import { api, type KotlinLsStatus, type KotlinLsProgress, type UnlistenFn } from '../../lib/api';
  import AccountsSettings from '../accounts/AccountsSettings.svelte';

  let {
    root = '',
    onclose = () => settingsStore.close(),
  }: {
    root?: string;
    onclose?: () => void;
  } = $props();

  let searchQuery = $state('');
  let formatOnSave = $state<Record<string, boolean>>({});

  // Toolchains config inputs
  let flutterSdk = $state(toolchainStore.config.flutterSdk || '');
  let androidSdk = $state(toolchainStore.config.androidSdk || '');
  let kotlinLs = $state(toolchainStore.config.kotlinLanguageServer || '');
  let saveFeedback = $state<string | null>(null);

  // Kotlin installer
  let kotlinStatus = $state<KotlinLsStatus | null>(null);
  let isInstallingKotlin = $state(false);
  let kotlinProgress = $state<KotlinLsProgress | null>(null);
  let kotlinInstallError = $state<string | null>(null);
  let unlistenProgress: UnlistenFn | null = null;

  let isId = $derived(settingsStore.language === 'id');

  let categories = $derived([
    { id: 'general', label: isId ? 'Umum' : 'General', icon: '⚙' },
    { id: 'editor', label: 'Editor', icon: '📝' },
    { id: 'toolchains', label: isId ? 'Toolchain & SDK' : 'Toolchains & SDK', icon: '🛠' },
    { id: 'git', label: 'Git', icon: '🔀' },
    { id: 'accounts', label: isId ? 'Akun' : 'Accounts', icon: '👤' },
    { id: 'agents', label: isId ? 'Agen AI' : 'Agents', icon: '🤖' },
    { id: 'devices', label: isId ? 'Perangkat' : 'Devices', icon: '📱' },
    { id: 'keymap', label: isId ? 'Pintasan Tombol' : 'Keymap', icon: '⌨' },
    { id: 'about', label: isId ? 'Tentang' : 'About', icon: 'ℹ' },
  ]);

  onMount(() => {
    formatOnSave = getFormatOnSaveConfig();
    loadKotlinStatus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onclose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      if (unlistenProgress) unlistenProgress();
    };
  });

  async function loadKotlinStatus() {
    try {
      kotlinStatus = await api.kotlinLsStatus();
    } catch {
      kotlinStatus = null;
    }
  }

  async function handleInstallKotlinLs() {
    if (isInstallingKotlin) return;
    isInstallingKotlin = true;
    kotlinInstallError = null;
    kotlinProgress = { stage: 'downloading', percent: 10, message: 'Menghubungkan ke GitHub releases…' };
    try {
      unlistenProgress = await api.onKotlinLsProgress((p) => {
        kotlinProgress = p;
      });
      await api.kotlinLsInstall();
      await toolchainStore.refresh(root);
      await loadKotlinStatus();
    } catch (err: any) {
      kotlinInstallError = err?.message || String(err);
    } finally {
      isInstallingKotlin = false;
      if (unlistenProgress) {
        unlistenProgress();
        unlistenProgress = null;
      }
    }
  }

  async function handleSaveToolchains() {
    await toolchainStore.saveConfig(
      {
        flutterSdk: flutterSdk.trim() || null,
        androidSdk: androidSdk.trim() || null,
        kotlinLanguageServer: kotlinLs.trim() || null,
      },
      root
    );
    saveFeedback = 'Toolchain settings saved successfully';
    setTimeout(() => {
      saveFeedback = null;
    }, 2500);
    await toolchainStore.refresh(root);
  }

  function handleFormatToggle(lang: string, enabled: boolean) {
    setFormatOnSave(lang, enabled);
    formatOnSave = { ...formatOnSave, [lang]: enabled };
  }

  let filteredCategories = $derived(
    searchQuery.trim()
      ? categories.filter((c) =>
          c.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
          c.id.toLowerCase().includes(searchQuery.toLowerCase())
        )
      : categories
  );
</script>

<div class="settings-backdrop" onclick={onclose} role="presentation">
  <div class="settings-modal" onclick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" tabindex="-1">
    <!-- Top Header -->
    <div class="settings-header">
      <div class="header-left">
        <span class="settings-title">{isId ? 'Pengaturan' : 'Settings'}</span>
      </div>
      <div class="header-search">
        <input
          type="text"
          class="search-input"
          placeholder={isId ? 'Cari pengaturan (Cmd-,)…' : 'Search settings (Cmd-,)…'}
          bind:value={searchQuery}
        />
      </div>
      <button class="close-btn" onclick={onclose} title={isId ? 'Tutup Pengaturan (Esc)' : 'Close Settings (Esc)'} aria-label="Close Settings">
        ✕
      </button>
    </div>

    <!-- Main Body: Sidebar + Content -->
    <div class="settings-body">
      <!-- Sidebar Categories -->
      <div class="settings-sidebar">
        {#each filteredCategories as cat}
          <button
            class="cat-btn"
            class:active={settingsStore.activeCategory === cat.id}
            onclick={() => (settingsStore.activeCategory = cat.id)}
          >
            <span class="cat-icon">{cat.icon}</span>
            <span class="cat-label">{cat.label}</span>
          </button>
        {/each}
      </div>

      <!-- Content Area -->
      <div class="settings-content">
        {#if settingsStore.activeCategory === 'general'}
          <div class="section-title">{isId ? 'Pengaturan Umum' : 'General Settings'}</div>
          <div class="setting-group">
            <label class="setting-row">
              <div class="setting-info">
                <span class="setting-name">{isId ? 'Tema Tampilan' : 'Theme'}</span>
                <span class="setting-desc">{isId ? 'Beralih antara tampilan gelap dan terang' : 'Switch between dark and light appearance'}</span>
              </div>
              <div class="theme-toggle-wrap">
                <button
                  class="pill-btn"
                  class:active={settingsStore.theme === 'dark'}
                  onclick={() => settingsStore.setTheme('dark')}
                >
                  Dark
                </button>
                <button
                  class="pill-btn"
                  class:active={settingsStore.theme === 'light'}
                  onclick={() => settingsStore.setTheme('light')}
                >
                  Light
                </button>
              </div>
            </label>

            <label class="setting-row">
              <div class="setting-info">
                <span class="setting-name">{isId ? 'Buka proyek terakhir otomatis saat mulai' : 'Reopen last project on launch'}</span>
                <span class="setting-desc">{isId ? 'Otomatis membuka workspace sebelumnya saat Petak dibuka (default: Nonaktif, tampilkan Dashboard)' : 'Automatically open the previous workspace when launching Petak (default: OFF, shows Dashboard)'}</span>
              </div>
              <input
                type="checkbox"
                class="toggle-checkbox"
                checked={settingsStore.reopenLastProjectOnLaunch}
                onchange={(e) => settingsStore.setReopenLastProjectOnLaunch((e.target as HTMLInputElement).checked)}
              />
            </label>

            <div class="setting-row">
              <div class="setting-info">
                <span class="setting-name">{isId ? 'Bahasa Antarmuka' : 'Interface Language'}</span>
                <span class="setting-desc">{isId ? 'Bahasa pilihan untuk tampilan antarmuka dan notifikasi' : 'Preferred language for toasts and tooltips'}</span>
              </div>
              <select
                class="setting-select"
                value={settingsStore.language}
                onchange={(e) => settingsStore.setLanguage((e.target as HTMLSelectElement).value as 'id' | 'en')}
              >
                <option value="id">Bahasa Indonesia (Default)</option>
                <option value="en">English</option>
              </select>
            </div>
          </div>

        {:else if settingsStore.activeCategory === 'editor'}
          <div class="section-title">{isId ? 'Pengaturan Editor' : 'Editor Settings'}</div>
          <div class="setting-group">
            <label class="setting-row">
              <div class="setting-info">
                <span class="setting-name">{isId ? 'AI Ghost Text (Saran Inline)' : 'AI Ghost Text (Inline Completions)'}</span>
                <span class="setting-desc">{isId ? 'Tampilkan saran abu-abu di depan kursor (Tab untuk menerima, Esc untuk menutup)' : 'Show gray suggestion ahead of cursor (Tab to accept, Esc to dismiss)'}</span>
              </div>
              <input
                type="checkbox"
                class="toggle-checkbox"
                checked={editorSettings.ghostText}
                onchange={() => editorSettings.toggleGhostText()}
              />
            </label>

            <label class="setting-row">
              <div class="setting-info">
                <span class="setting-name">{isId ? 'Pelipatan Kode (Code Folding)' : 'Code Folding'}</span>
                <span class="setting-desc">{isId ? 'Tampilkan indikator pelipatan di gutter dan aktifkan pintasan Cmd-Alt-minus/plus' : 'Display fold indicators in gutter and enable Cmd-Alt-minus/plus collapse'}</span>
              </div>
              <input
                type="checkbox"
                class="toggle-checkbox"
                checked={editorSettings.codeFolding}
                onchange={(e) => editorSettings.setCodeFolding((e.target as HTMLInputElement).checked)}
              />
            </label>

            <label class="setting-row">
              <div class="setting-info">
                <span class="setting-name">{isId ? 'Mode Vim' : 'Vim Mode'}</span>
                <span class="setting-desc">{isId ? 'Aktifkan navigasi dan modal keybindings standar Vim di dalam CodeMirror' : 'Enable standard modal Vim keybindings inside CodeMirror'}</span>
              </div>
              <input
                type="checkbox"
                class="toggle-checkbox"
                checked={editorSettings.vimMode}
                onchange={(e) => editorSettings.setVimMode((e.target as HTMLInputElement).checked)}
              />
            </label>

            <div class="section-subtitle">{isId ? 'Format Saat Menyimpan (Format On Save)' : 'Format On Save'}</div>
            <div class="format-lang-grid">
              {#each ['dart', 'kotlin', 'swift'] as lang}
                <label class="format-lang-row">
                  <input
                    type="checkbox"
                    checked={formatOnSave[lang] ?? true}
                    onchange={(e) => handleFormatToggle(lang, (e.target as HTMLInputElement).checked)}
                  />
                  <span class="lang-tag">{lang.toUpperCase()}</span>
                  <span class="lang-tool">({lang === 'dart' ? 'dart format' : lang === 'kotlin' ? 'ktlint / kls' : 'swift-format'})</span>
                </label>
              {/each}
            </div>
          </div>

        {:else if settingsStore.activeCategory === 'toolchains'}
          <div class="section-title">{isId ? 'Konfigurasi Toolchain & SDK' : 'Toolchains & SDK Configuration'}</div>
          <div class="setting-group">
            <div class="field-item">
              <label for="tc-flutter">{isId ? 'Jalur Flutter SDK' : 'Flutter SDK Path'}</label>
              <input
                id="tc-flutter"
                type="text"
                class="text-input"
                placeholder="/usr/local/bin/flutter or ~/development/flutter"
                bind:value={flutterSdk}
              />
            </div>

            <div class="field-item">
              <label for="tc-android">{isId ? 'Jalur Android SDK / ANDROID_HOME' : 'Android SDK / ANDROID_HOME'}</label>
              <input
                id="tc-android"
                type="text"
                class="text-input"
                placeholder="/mnt/storage/caches/android-sdk-uqi or ~/Library/Android/sdk"
                bind:value={androidSdk}
              />
            </div>

            <div class="field-item">
              <label for="tc-kotlin">{isId ? 'Binary Kotlin Language Server' : 'Kotlin Language Server Binary'}</label>
              <input
                id="tc-kotlin"
                type="text"
                class="text-input"
                placeholder="/mnt/storage/uqi-cache/lsp/server/bin/kotlin-language-server"
                bind:value={kotlinLs}
              />
            </div>

            <div class="actions-row">
              <button class="btn-primary" onclick={handleSaveToolchains}>
                {isId ? 'Simpan & Deteksi Ulang' : 'Save & Re-detect'}
              </button>
              <button class="btn-secondary" onclick={handleInstallKotlinLs} disabled={isInstallingKotlin}>
                {isInstallingKotlin ? (isId ? 'Memasang Kotlin LS…' : 'Installing Kotlin LS…') : (isId ? 'Pasang Kotlin Language Server' : 'Install Kotlin Language Server')}
              </button>
            </div>

            {#if saveFeedback}
              <div class="feedback-msg success">{saveFeedback}</div>
            {/if}
            {#if isInstallingKotlin && kotlinProgress}
              <div class="progress-box">
                <div class="progress-bar">
                  <div class="progress-fill" style:width="{kotlinProgress.percent ?? 50}%"></div>
                </div>
                <span>{kotlinProgress.message}</span>
              </div>
            {/if}
            {#if kotlinInstallError}
              <div class="feedback-msg error">Error: {kotlinInstallError}</div>
            {/if}
          </div>

        {:else if settingsStore.activeCategory === 'accounts'}
          <div class="section-title">{isId ? 'Akun & Integrasi' : 'Accounts & Integrations'}</div>
          <AccountsSettings />

        {:else if settingsStore.activeCategory === 'git'}
          <div class="section-title">{isId ? 'Preferensi Git' : 'Git Preferences'}</div>
          <div class="setting-group">
            <div class="setting-info">
              <span class="setting-name">In-Memory Local Commit Checkboxes</span>
              <span class="setting-desc">State preserved per repository in RAM without slow Git restore/add cycles (&lt;16ms)</span>
            </div>
            <div class="field-item">
              <label>Default Commit Branch</label>
              <input type="text" class="text-input" value="feat/phase4-run" readonly />
            </div>
          </div>

        {:else if settingsStore.activeCategory === 'agents'}
          <div class="section-title">AI Agents & Discipline</div>
          <div class="setting-group">
            <div class="agent-tag-box">
              <span class="badge">Ponytail</span>
              <p>Forces the laziest working solution, smallest diff, reuse stdlib/installed dependencies first.</p>
            </div>
            <div class="agent-tag-box">
              <span class="badge">Caveman</span>
              <p>Terse communication, direct output, no conversational fluff.</p>
            </div>
          </div>

        {:else if settingsStore.activeCategory === 'devices'}
          <div class="section-title">Connected Devices & Mirroring</div>
          <div class="setting-group">
            <p class="setting-desc">
              Mirroring requires USB connection for physical iPhones and Android devices with USB debugging.
            </p>
          </div>

        {:else if settingsStore.activeCategory === 'keymap'}
          <div class="section-title">Keymap Reference</div>
          <div class="keymap-list">
            <div class="keymap-row"><span class="shortcut">Shift Shift</span><span>Search Everywhere (Files, Symbols, Actions)</span></div>
            <div class="keymap-row"><span class="shortcut">⌘F / ⌘R</span><span>Find and Replace in current file</span></div>
            <div class="keymap-row"><span class="shortcut">⌥⌘- / ⌥⌘+</span><span>Fold / Unfold code block</span></div>
            <div class="keymap-row"><span class="shortcut">⌥⇧⌘- / ⌥⇧⌘+</span><span>Fold All / Unfold All</span></div>
            <div class="keymap-row"><span class="shortcut">⌘,</span><span>Open Settings</span></div>
            <div class="keymap-row"><span class="shortcut">⇧⌘D</span><span>Toggle Device Mirror</span></div>
            <div class="keymap-row"><span class="shortcut">⌘5</span><span>GitLab Merge Requests</span></div>
            <div class="keymap-row"><span class="shortcut">⌘6</span><span>AI Agents Panel</span></div>
          </div>

        {:else if settingsStore.activeCategory === 'about'}
          <div class="section-title">About Petak</div>
          <div class="setting-group">
            <p><strong>Petak Flutter & Mobile IDE</strong></p>
            <p class="setting-desc">Version 0.1.0 (Batch 6) — High performance, memory budget &lt;150MB idle.</p>
            <p class="setting-desc">Designed for Bank Jatim JConnect and enterprise Flutter/Android development.</p>
          </div>
        {/if}
      </div>
    </div>
  </div>
</div>

<style>
  .settings-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.65);
    backdrop-filter: blur(2px);
    display: grid;
    place-items: center;
    z-index: 1000;
  }
  .settings-modal {
    width: 820px;
    height: 600px;
    background: #18191c;
    border: 1px solid #2a2d34;
    border-radius: 12px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    box-shadow: 0 16px 40px rgba(0, 0, 0, 0.5);
  }
  .settings-header {
    height: 48px;
    background: #1f2126;
    border-bottom: 1px solid #2c2f37;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 16px;
    gap: 16px;
  }
  .settings-title {
    font-size: 15px;
    font-weight: 600;
    color: #e6e7ea;
  }
  .search-input {
    width: 320px;
    height: 28px;
    background: #121316;
    border: 1px solid #2e313b;
    border-radius: 6px;
    padding: 0 10px;
    color: #f0f0f0;
    font-size: 12px;
    outline: none;
  }
  .search-input:focus {
    border-color: #6ea8ff;
  }
  .close-btn {
    background: transparent;
    border: none;
    color: #8b8f98;
    font-size: 14px;
    cursor: pointer;
    padding: 4px 8px;
    border-radius: 4px;
  }
  .close-btn:hover {
    color: #ffffff;
    background: #2a2d35;
  }
  .settings-body {
    display: flex;
    flex: 1;
    overflow: hidden;
  }
  .settings-sidebar {
    width: 200px;
    background: #1a1b20;
    border-right: 1px solid #282a32;
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    overflow-y: auto;
  }
  .cat-btn {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border-radius: 6px;
    background: transparent;
    border: none;
    color: #a0a4ae;
    font-size: 13px;
    cursor: pointer;
    text-align: left;
    transition: background 0.12s, color 0.12s;
  }
  .cat-btn:hover {
    background: #24262d;
    color: #e6e7ea;
  }
  .cat-btn.active {
    background: #2b303c;
    color: #6ea8ff;
    font-weight: 500;
  }
  .settings-content {
    flex: 1;
    padding: 24px;
    overflow-y: auto;
    background: #18191c;
    color: #d8d9dc;
  }
  .section-title {
    font-size: 16px;
    font-weight: 600;
    color: #ffffff;
    margin-bottom: 16px;
    padding-bottom: 8px;
    border-bottom: 1px solid #282a32;
  }
  .section-subtitle {
    font-size: 13px;
    font-weight: 600;
    color: #c0c4ce;
    margin: 16px 0 8px 0;
  }
  .setting-group {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .setting-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 10px 0;
    border-bottom: 1px solid #22242a;
  }
  .setting-info {
    display: flex;
    flex-direction: column;
    gap: 4px;
    max-width: 440px;
  }
  .setting-name {
    font-size: 13px;
    font-weight: 500;
    color: #e6e7ea;
  }
  .setting-desc {
    font-size: 12px;
    color: #838792;
    line-height: 16px;
  }
  .pill-btn {
    padding: 4px 12px;
    background: #23252b;
    border: 1px solid #30333d;
    color: #c0c4ce;
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
  }
  .pill-btn.active {
    background: #39527e;
    color: #ffffff;
    border-color: #5c84c7;
  }
  .toggle-checkbox {
    width: 18px;
    height: 18px;
    accent-color: #6ea8ff;
    cursor: pointer;
  }
  .setting-select, .text-input {
    background: #141518;
    border: 1px solid #2f323c;
    border-radius: 6px;
    padding: 6px 10px;
    color: #ffffff;
    font-size: 12px;
    outline: none;
    width: 100%;
  }
  .field-item {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .field-item label {
    font-size: 12px;
    color: #a8abb5;
  }
  .actions-row {
    display: flex;
    gap: 10px;
    margin-top: 8px;
  }
  .btn-primary {
    background: #2b5597;
    border: 1px solid #4175c5;
    color: #ffffff;
    padding: 6px 14px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 12px;
  }
  .btn-primary:hover {
    background: #3364b1;
  }
  .btn-secondary {
    background: #22242a;
    border: 1px solid #323540;
    color: #d0d2d8;
    padding: 6px 14px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 12px;
  }
  .feedback-msg {
    padding: 8px 12px;
    border-radius: 6px;
    font-size: 12px;
  }
  .feedback-msg.success {
    background: #193822;
    color: #7fc98f;
  }
  .feedback-msg.error {
    background: #401d1d;
    color: #f07a74;
  }
  .format-lang-grid {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .format-lang-row {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
  }
  .lang-tag {
    font-weight: 600;
    color: #6ea8ff;
  }
  .lang-tool {
    color: #7a7e88;
  }
  .keymap-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .keymap-row {
    display: flex;
    justify-content: space-between;
    padding: 6px 0;
    border-bottom: 1px solid #202227;
    font-size: 12px;
  }
  .shortcut {
    font-family: monospace;
    background: #23252c;
    padding: 2px 6px;
    border-radius: 4px;
    color: #e0e2e8;
  }
  .agent-tag-box {
    background: #1f2127;
    padding: 12px;
    border-radius: 8px;
    border: 1px solid #2a2d36;
  }
  .badge {
    background: #3a2e58;
    color: #c9b4f5;
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 600;
  }
  .progress-box {
    margin-top: 8px;
    font-size: 12px;
    color: #9aa0ac;
  }
  .progress-bar {
    height: 6px;
    background: #22242b;
    border-radius: 3px;
    overflow: hidden;
    margin-bottom: 4px;
  }
  .progress-fill {
    height: 100%;
    background: #6ea8ff;
    transition: width 0.2s ease;
  }
</style>
