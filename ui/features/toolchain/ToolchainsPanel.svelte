<script lang="ts">
  import { onMount } from 'svelte';
  import { toolchainStore, type LspState } from './toolchainStore.svelte';
  import { api, type KotlinLsStatus, type KotlinLsProgress, type UnlistenFn } from '../../lib/api';
  import { editorSettings } from '../editor/editorSettings.svelte';

  let {
    root = '',
    onOpenSettings = () => {},
  } = $props<{
    root?: string;
    onOpenSettings?: () => void;
  }>();

  let showConfigEditor = $state(
    typeof window !== 'undefined' &&
    (window.location.search.includes('settings') || window.location.search.includes('b3-ghost-settings'))
  );
  let flutterSdkInput = $state('');
  let androidSdkInput = $state('');
  let kotlinLsInput = $state('');
  let saveFeedback = $state<string | null>(null);

  // Kotlin LS Installer state
  let kotlinStatus = $state<KotlinLsStatus | null>(null);
  let isInstallingKotlin = $state(false);
  let kotlinProgress = $state<KotlinLsProgress | null>(null);
  let kotlinInstallError = $state<string | null>(null);
  let unlistenProgress: UnlistenFn | null = null;

  let isJavaMissing = $derived(
    !toolchainStore.toolchain?.java && kotlinStatus !== null && !kotlinStatus.javaOk
  );

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

  onMount(() => {
    loadKotlinStatus();
    return () => {
      if (unlistenProgress) unlistenProgress();
    };
  });

  $effect(() => {
    flutterSdkInput = toolchainStore.config.flutterSdk || '';
    androidSdkInput = toolchainStore.config.androidSdk || '';
    kotlinLsInput = toolchainStore.config.kotlinLanguageServer || '';
  });

  async function handleSaveConfig() {
    await toolchainStore.saveConfig(
      {
        flutterSdk: flutterSdkInput.trim() || null,
        androidSdk: androidSdkInput.trim() || null,
        kotlinLanguageServer: kotlinLsInput.trim() || null,
      },
      root
    );
    saveFeedback = 'Saved settings successfully';
    setTimeout(() => {
      saveFeedback = null;
    }, 3000);
  }

  function getLspDotColor(state: string): string {
    switch (state) {
      case 'ready':
        return '#7fc98f';
      case 'starting':
        return '#e8b45a';
      case 'failed':
      case 'crashed':
        return '#f07a74';
      default:
        return '#8b8f98';
    }
  }

  let effectivePathParts = $derived.by(() => {
    const raw = toolchainStore.toolchain?.effectivePath || '';
    return raw.split(':').filter(Boolean);
  });
</script>

<div class="toolchains-panel">
  <div class="panel-header">
    <div class="title-group">
      <span class="panel-title">TOOLCHAINS & SDKS</span>
      {#if toolchainStore.loading}
        <span class="loading-tag">Detecting…</span>
      {/if}
    </div>
    <div class="header-actions">
      <button
        class="action-btn"
        onclick={() => (showConfigEditor = !showConfigEditor)}
        title="Settings & Overrides"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="3"></circle>
          <path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2"></path>
        </svg>
        {showConfigEditor ? 'Hide Settings' : 'Settings'}
      </button>
      <button
        class="refresh-btn"
        onclick={() => toolchainStore.refresh(root)}
        title="Refresh toolchain detection"
        disabled={toolchainStore.loading}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5"></path>
        </svg>
      </button>
    </div>
  </div>

  <div class="panel-content">
    <!-- Config Overrides Editor -->
    {#if showConfigEditor}
      <div class="settings-card">
        <div class="card-title">SDK PATH OVERRIDES (~/Library/Application Support/Petak/config.json)</div>
        <div class="field-group">
          <label for="tc-flutter">Flutter SDK Path</label>
          <input
            id="tc-flutter"
            type="text"
            placeholder="/Users/uqi/SDK/flutter_3.35.7"
            bind:value={flutterSdkInput}
          />
        </div>
        <div class="field-group">
          <label for="tc-android">Android SDK Path</label>
          <input
            id="tc-android"
            type="text"
            placeholder="/Users/uqi/Library/Android/sdk"
            bind:value={androidSdkInput}
          />
        </div>
        <div class="field-group">
          <label for="tc-kotlin">Kotlin Language Server Binary</label>
          <input
            id="tc-kotlin"
            type="text"
            placeholder="/opt/homebrew/bin/kotlin-language-server"
            bind:value={kotlinLsInput}
          />
        </div>

        <div class="card-title" style="margin-top: 16px;">EDITOR SETTINGS</div>
        <div class="setting-row">
          <label class="toggle-setting" for="toggle-ghost-text">
            <input
              id="toggle-ghost-text"
              type="checkbox"
              checked={editorSettings.ghostText}
              onchange={(e) => editorSettings.setGhostText((e.currentTarget as HTMLInputElement).checked)}
            />
            <div class="setting-text">
              <span class="setting-label">Enable Inline Ghost-Text Suggestions (editor.ghostText)</span>
              <span class="setting-subtext">Shows gray inline completions from local frequency index. Press Tab to accept, Esc to dismiss.</span>
            </div>
          </label>
        </div>

        <div class="settings-footer">
          {#if saveFeedback}
            <span class="feedback-text">{saveFeedback}</span>
          {/if}
          <button class="save-btn" onclick={handleSaveConfig}>Save & Re-detect</button>
        </div>
      </div>
    {/if}

    <!-- Language Server Status Section -->
    <div class="section-title">LANGUAGE SERVERS (LSP)</div>
    <div class="lsp-grid">
      {#each ['dart', 'kotlin', 'swift'] as lang}
        {@const stateInfo = toolchainStore.lspStates[lang]}
        {@const state = stateInfo?.state || 'stopped'}
        <div class="lsp-card" class:is-failed={state === 'failed' || state === 'crashed'}>
          <div class="lsp-header">
            <span class="status-dot" style:background={getLspDotColor(state)}></span>
            <span class="lang-name">{lang.toUpperCase()}</span>
            <span class="state-badge" class:failed={state === 'failed' || state === 'crashed'}>
              {state}
            </span>
          </div>
          {#if stateInfo?.reason}
            <div class="lsp-reason">{stateInfo.reason}</div>
          {/if}
          {#if state === 'failed' || state === 'crashed'}
            <div class="card-action">
              <button class="small-btn" onclick={() => (showConfigEditor = true)}>
                Open Settings
              </button>
            </div>
          {/if}
        </div>
      {/each}
    </div>

    <!-- Detected Tools Section -->
    <div class="section-title">DETECTED DEVELOPER TOOLS</div>
    <div class="tools-list">
      <!-- Flutter -->
      <div class="tool-row">
        <div class="tool-name">Flutter</div>
        <div class="tool-value">
          {#if toolchainStore.toolchain?.flutter}
            <span class="tool-path">{toolchainStore.toolchain.flutter.path}</span>
            {#if toolchainStore.toolchain.flutter.version}
              <span class="version-tag">v{toolchainStore.toolchain.flutter.version}</span>
            {/if}
          {:else}
            <span class="not-found">Not detected</span>
          {/if}
        </div>
      </div>

      <!-- Dart -->
      <div class="tool-row">
        <div class="tool-name">Dart</div>
        <div class="tool-value">
          {#if toolchainStore.toolchain?.dart}
            <span class="tool-path">{toolchainStore.toolchain.dart.path}</span>
            {#if toolchainStore.toolchain.dart.version}
              <span class="version-tag">v{toolchainStore.toolchain.dart.version}</span>
            {/if}
          {:else}
            <span class="not-found">Not detected</span>
          {/if}
        </div>
      </div>

      <!-- Android SDK -->
      <div class="tool-row">
        <div class="tool-name">Android SDK</div>
        <div class="tool-value">
          {#if toolchainStore.toolchain?.androidHome}
            <span class="tool-path">{toolchainStore.toolchain.androidHome}</span>
          {:else}
            <span class="not-found">Not detected</span>
          {/if}
        </div>
      </div>

      <!-- ADB -->
      <div class="tool-row">
        <div class="tool-name">ADB</div>
        <div class="tool-value">
          {#if toolchainStore.toolchain?.adb}
            <span class="tool-path">{toolchainStore.toolchain.adb.path}</span>
            {#if toolchainStore.toolchain.adb.version}
              <span class="version-tag">{toolchainStore.toolchain.adb.version}</span>
            {/if}
          {:else}
            <span class="not-found">Not detected</span>
          {/if}
        </div>
      </div>

      <!-- Emulator -->
      <div class="tool-row">
        <div class="tool-name">Emulator</div>
        <div class="tool-value">
          {#if toolchainStore.toolchain?.emulator}
            <span class="tool-path">{toolchainStore.toolchain.emulator.path}</span>
            {#if toolchainStore.toolchain.emulator.version}
              <span class="version-tag">{toolchainStore.toolchain.emulator.version}</span>
            {/if}
          {:else}
            <span class="not-found">Not detected</span>
          {/if}
        </div>
      </div>

      <!-- Kotlin Language Server -->
      <div class="tool-row" class:has-actions={true}>
        <div class="tool-name">Kotlin LS</div>
        <div class="tool-value">
          {#if toolchainStore.toolchain?.kotlinLs}
            <span class="tool-path">{toolchainStore.toolchain.kotlinLs.path}</span>
            {#if toolchainStore.toolchain.kotlinLs.version}
              <span class="version-tag">{toolchainStore.toolchain.kotlinLs.version}</span>
            {/if}
          {:else}
            <span class="not-found">Not detected</span>
            <button
              class="install-ls-btn"
              disabled={isInstallingKotlin || isJavaMissing}
              onclick={handleInstallKotlinLs}
              title={isJavaMissing ? 'JDK diperlukan sebelum memasang Kotlin LS' : 'Unduh & pasang kotlin-language-server'}
            >
              {#if isInstallingKotlin}
                Memasang…
              {:else}
                Install Kotlin Language Server
              {/if}
            </button>
          {/if}
        </div>
      </div>

      {#if isInstallingKotlin && kotlinProgress}
        <div class="install-progress-card">
          <div class="progress-bar-wrap">
            <div class="progress-bar-fill" style:width="{kotlinProgress.percent ?? 50}%"></div>
          </div>
          <span class="progress-msg">{kotlinProgress.message}</span>
        </div>
      {/if}

      {#if kotlinInstallError}
        <div class="install-error-card">
          <span>Gagal memasang Kotlin LS: {kotlinInstallError}</span>
        </div>
      {/if}

      {#if isJavaMissing && !toolchainStore.toolchain?.kotlinLs}
        <div class="jdk-missing-warning">
          <span class="warn-icon">⚠</span>
          <div class="warn-body">
            <strong>JDK (Java) tidak terdeteksi di PATH</strong>
            <p>Kotlin Language Server membutuhkan JDK (Java 17+). Silakan pasang OpenJDK atau JDK Android Studio terlebih dahulu.</p>
          </div>
        </div>
      {/if}

      <!-- SourceKit-LSP -->
      <div class="tool-row">
        <div class="tool-name">SourceKit (Swift)</div>
        <div class="tool-value">
          {#if toolchainStore.toolchain?.sourcekit}
            <span class="tool-path">{toolchainStore.toolchain.sourcekit.path}</span>
            {#if toolchainStore.toolchain.sourcekit.version}
              <span class="version-tag">{toolchainStore.toolchain.sourcekit.version}</span>
            {/if}
          {:else}
            <span class="not-found">Not detected</span>
          {/if}
        </div>
      </div>

      <!-- Java -->
      <div class="tool-row">
        <div class="tool-name">Java</div>
        <div class="tool-value">
          {#if toolchainStore.toolchain?.java}
            <span class="tool-path">{toolchainStore.toolchain.java.path}</span>
            {#if toolchainStore.toolchain.java.version}
              <span class="version-tag">{toolchainStore.toolchain.java.version}</span>
            {/if}
          {:else}
            <span class="not-found">Not detected</span>
          {/if}
        </div>
      </div>
    </div>

    <!-- Effective PATH Section -->
    <div class="section-title">EFFECTIVE RESOLVED PATH ({effectivePathParts.length} directories)</div>
    <div class="path-container">
      {#each effectivePathParts as entry, idx}
        <div class="path-entry">
          <span class="path-idx">{idx + 1}</span>
          <span class="path-str">{entry}</span>
        </div>
      {/each}
    </div>
  </div>
</div>

<style>
  .toolchains-panel {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    background: #141518;
    color: #d8d9dc;
    font-family: 'JetBrains Mono', monospace;
    font-size: 12px;
    overflow: hidden;
  }
  .panel-header {
    height: 38px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 16px;
    background: #111215;
    border-bottom: 1px solid #23252b;
  }
  .title-group {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .panel-title {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.6px;
    color: #8b8f98;
  }
  .loading-tag {
    font-size: 11px;
    color: #e8b45a;
  }
  .header-actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .action-btn {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 4px 10px;
    border-radius: 4px;
    background: #1e2025;
    border: 1px solid #2e313a;
    color: #b9bcc3;
    font-size: 11px;
    cursor: pointer;
    transition: all 0.15s;
  }
  .action-btn:hover {
    background: #282a32;
    color: #ffffff;
  }
  .refresh-btn {
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    border-radius: 4px;
    background: transparent;
    border: none;
    color: #8b8f98;
    cursor: pointer;
    transition: all 0.15s;
  }
  .refresh-btn:hover {
    color: #d8d9dc;
    background: #23252b;
  }
  .panel-content {
    flex: 1;
    overflow-y: auto;
    padding: 14px 18px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .section-title {
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.5px;
    color: #666a73;
  }
  .settings-card {
    background: #1a1b20;
    border: 1px solid #2b2e37;
    border-radius: 6px;
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .card-title {
    font-size: 11px;
    font-weight: 600;
    color: #6ea8ff;
  }
  .field-group {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .field-group label {
    font-size: 11px;
    color: #8b8f98;
  }
  .field-group input {
    background: #121316;
    border: 1px solid #2a2c35;
    border-radius: 4px;
    padding: 5px 8px;
    color: #e6e7ea;
    font-family: inherit;
    font-size: 12px;
  }
  .field-group input:focus {
    outline: none;
    border-color: #6ea8ff;
  }
  .settings-footer {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 12px;
    padding-top: 4px;
  }
  .feedback-text {
    color: #7fc98f;
    font-size: 11px;
  }
  .save-btn {
    padding: 4px 12px;
    background: #2e4468;
    color: #bcd4ff;
    border: 1px solid #436195;
    border-radius: 4px;
    font-size: 11px;
    cursor: pointer;
    transition: background 0.15s;
  }
  .save-btn:hover {
    background: #395582;
  }
  .setting-row {
    margin-bottom: 12px;
  }
  .toggle-setting {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    cursor: pointer;
    user-select: none;
  }
  .toggle-setting input[type="checkbox"] {
    margin-top: 3px;
    accent-color: #56a8f5;
    cursor: pointer;
    width: 15px;
    height: 15px;
  }
  .setting-text {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .setting-label {
    font-size: 12px;
    font-weight: 500;
    color: #e6e7ea;
  }
  .setting-subtext {
    font-size: 11px;
    color: #8b8f98;
    line-height: 1.4;
  }
  .lsp-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    gap: 10px;
  }
  .lsp-card {
    background: #18191e;
    border: 1px solid #262830;
    border-radius: 6px;
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .lsp-card.is-failed {
    border-color: #5c2c2a;
    background: #1e1516;
  }
  .lsp-header {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .status-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
  }
  .lang-name {
    font-weight: 600;
    font-size: 11px;
    color: #d8d9dc;
  }
  .state-badge {
    margin-left: auto;
    font-size: 10px;
    padding: 1px 6px;
    border-radius: 3px;
    background: #23252d;
    color: #8b8f98;
    text-transform: capitalize;
  }
  .state-badge.failed {
    background: #441e20;
    color: #f07a74;
  }
  .lsp-reason {
    font-size: 11px;
    color: #f07a74;
    line-height: 1.3;
  }
  .card-action {
    display: flex;
    justify-content: flex-end;
    padding-top: 4px;
  }
  .small-btn {
    font-size: 10px;
    padding: 2px 8px;
    background: #2a2c35;
    border: 1px solid #3d404c;
    border-radius: 3px;
    color: #d8d9dc;
    cursor: pointer;
  }
  .small-btn:hover {
    background: #363944;
  }
  .tools-list {
    display: flex;
    flex-direction: column;
    background: #18191e;
    border: 1px solid #262830;
    border-radius: 6px;
    overflow: hidden;
  }
  .tool-row {
    display: flex;
    align-items: center;
    padding: 8px 12px;
    border-bottom: 1px solid #202228;
    gap: 14px;
  }
  .tool-row:last-child {
    border-bottom: none;
  }
  .tool-name {
    width: 140px;
    flex-shrink: 0;
    font-weight: 500;
    color: #9da1ab;
  }
  .tool-value {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 8px;
    overflow: hidden;
  }
  .tool-path {
    color: #d8d9dc;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .version-tag {
    font-size: 11px;
    padding: 1px 5px;
    border-radius: 3px;
    background: #222631;
    color: #6ea8ff;
    flex-shrink: 0;
  }
  .not-found {
    color: #666a73;
    font-style: italic;
  }
  .install-ls-btn {
    height: 24px;
    padding: 0 10px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 500;
    background: #1f3650;
    color: #8bbdff;
    border: 1px solid #2d4c72;
    cursor: pointer;
    transition: background 0.15s;
    margin-left: auto;
    flex-shrink: 0;
  }
  .install-ls-btn:hover:not(:disabled) {
    background: #274567;
  }
  .install-ls-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .install-progress-card {
    margin: 4px 0 8px;
    padding: 8px 12px;
    background: #151821;
    border: 1px solid #273043;
    border-radius: 6px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .progress-bar-wrap {
    height: 4px;
    background: #20242f;
    border-radius: 2px;
    overflow: hidden;
  }
  .progress-bar-fill {
    height: 100%;
    background: #569aff;
    transition: width 0.3s ease;
  }
  .progress-msg {
    font-size: 11px;
    color: #9cb1d1;
  }
  .install-error-card {
    margin: 4px 0 8px;
    padding: 8px 12px;
    background: #2a1617;
    border: 1px solid #482326;
    border-radius: 6px;
    font-size: 11.5px;
    color: #f0837f;
  }
  .jdk-missing-warning {
    margin: 4px 0 8px;
    padding: 8px 12px;
    background: #282012;
    border: 1px solid #4a381b;
    border-radius: 6px;
    display: flex;
    gap: 10px;
    align-items: flex-start;
  }
  .warn-icon {
    color: #f2ad49;
    font-size: 14px;
    line-height: 1;
  }
  .warn-body {
    display: flex;
    flex-direction: column;
    gap: 3px;
    font-size: 11.5px;
    color: #e5cfac;
  }
  .warn-body strong {
    color: #ffda99;
  }
  .warn-body p {
    margin: 0;
    font-size: 11px;
    color: #c9b493;
    line-height: 1.4;
  }
  .path-container {
    display: flex;
    flex-direction: column;
    background: #101114;
    border: 1px solid #202228;
    border-radius: 6px;
    padding: 8px 12px;
    max-height: 200px;
    overflow-y: auto;
    gap: 4px;
  }
  .path-entry {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 11px;
  }
  .path-idx {
    width: 24px;
    color: #555963;
    text-align: right;
    user-select: none;
  }
  .path-str {
    color: #a8abb4;
    word-break: break-all;
  }
</style>
