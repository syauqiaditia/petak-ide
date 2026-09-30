<script lang="ts">
  import { onMount } from 'svelte';
  import { toolchainStore, type LspState } from './toolchainStore.svelte';
  import { api, type KotlinLsStatus } from '../../lib/api';
  import { settingsStore } from '../settings/settingsStore.svelte';

  let {
    root = '',
    onOpenSettings = () => settingsStore.open('toolchains'),
  }: {
    root?: string;
    onOpenSettings?: () => void;
  } = $props();

  let kotlinStatus = $state<KotlinLsStatus | null>(null);
  let klsLogPath = $state<string | null>(null);

  let dartState = $derived(toolchainStore.lspStates['dart']);
  let kotlinState = $derived(toolchainStore.lspStates['kotlin']);
  let isIndexing = $derived(
    (kotlinState as any)?.state === 'indexing' ||
      Boolean(kotlinState?.reason && kotlinState.reason.toLowerCase().includes('indexing'))
  );
  let swiftState = $derived(toolchainStore.lspStates['swift']);

  onMount(async () => {
    try {
      kotlinStatus = await api.kotlinLsStatus();
    } catch {
      kotlinStatus = null;
    }
  });

  async function handleShowKlsLog() {
    try {
      const p = await api.lspKotlinLogPath();
      klsLogPath = p;
      toolchainStore.showToast(`KLS log location: ${p}`);
    } catch (e: any) {
      toolchainStore.showToast(`Failed to resolve KLS log: ${e?.message || e}`);
    }
  }

  function getLspBadgeColor(state: LspState | 'indexing'): string {
    switch (state) {
      case 'ready':
        return '#7fc98f';
      case 'starting':
      case 'indexing':
        return '#e8b45a';
      case 'failed':
      case 'crashed':
        return '#f07a74';
      default:
        return '#8b8f98';
    }
  }

  function getLspBadgeLabel(state: LspState | 'indexing'): string {
    switch (state) {
      case 'ready':
        return 'Ready';
      case 'starting':
        return 'Starting…';
      case 'indexing':
        return 'Indexing…';
      case 'failed':
        return 'Failed';
      case 'crashed':
        return 'Crashed';
      case 'stopping':
        return 'Stopping';
      case 'stopped':
        return 'Stopped';
      default:
        return 'Inactive';
    }
  }
</script>

<div class="toolchains-panel">
  <!-- Top Bar with Status and Open Settings Action -->
  <div class="panel-header">
    <div class="header-left">
      <span class="header-title">TOOLCHAINS & LANGUAGE SERVERS</span>
      <span class="header-sub">Runtime status of mobile dev tools</span>
    </div>
    <div class="header-actions">
      <button class="btn-open-settings" onclick={onOpenSettings} title="Open full Settings dialog (Cmd-,)">
        <span class="gear-icon">⚙</span>
        Open Settings
      </button>
    </div>
  </div>

  <div class="panel-content">
    <!-- LSP Services Status Grid -->
    <div class="section-title">ACTIVE LANGUAGE SERVERS</div>
    <div class="lsp-grid">
      <!-- Dart LSP -->
      <div class="lsp-card">
        <div class="card-header">
          <span class="card-title">Dart Analysis Server</span>
          <span
            class="status-badge"
            style:background="{getLspBadgeColor(dartState?.state || 'stopped')}22"
            style:color={getLspBadgeColor(dartState?.state || 'stopped')}
          >
            {getLspBadgeLabel(dartState?.state || 'stopped')}
          </span>
        </div>
        <div class="card-detail">
          {#if toolchainStore.toolchain?.dart}
            <span class="detail-path">{toolchainStore.toolchain.dart.path}</span>
          {:else}
            <span class="detail-muted">Using bundled Dart analysis engine</span>
          {/if}
        </div>
      </div>

      <!-- Kotlin LSP -->
      <div class="lsp-card">
        <div class="card-header">
          <div class="card-title-wrap">
            <span class="card-title">Kotlin Language Server</span>
            {#if isIndexing}
              <span class="indexing-spinner"></span>
            {/if}
          </div>
          <span
            class="status-badge"
            style:background="{getLspBadgeColor(isIndexing ? 'indexing' : (kotlinState?.state || 'stopped'))}22"
            style:color={getLspBadgeColor(isIndexing ? 'indexing' : (kotlinState?.state || 'stopped'))}
          >
            {isIndexing ? 'Indexing…' : getLspBadgeLabel(kotlinState?.state || 'stopped')}
          </span>
        </div>
        <div class="card-detail">
          {#if isIndexing}
            <span class="detail-indexing">Indexing project (Gradle import, bisa beberapa menit)…</span>
          {:else if kotlinState?.reason}
            <span class="detail-reason">{kotlinState.reason}</span>
          {:else if toolchainStore.toolchain?.kotlinLs}
            <span class="detail-path">{toolchainStore.toolchain.kotlinLs.path}</span>
          {:else}
            <span class="detail-muted">KLS binary not configured</span>
          {/if}
        </div>
        <div class="card-footer">
          <button class="btn-sub" onclick={handleShowKlsLog} title="Show path to kotlin-ls.log">
            Show KLS log
          </button>
          <button class="btn-sub" onclick={onOpenSettings} title="Configure JDK & KLS path">
            Configure
          </button>
        </div>
      </div>

      <!-- Swift LSP -->
      <div class="lsp-card">
        <div class="card-header">
          <span class="card-title">SourceKit-LSP (Swift)</span>
          <span
            class="status-badge"
            style:background="{getLspBadgeColor(swiftState?.state || 'stopped')}22"
            style:color={getLspBadgeColor(swiftState?.state || 'stopped')}
          >
            {getLspBadgeLabel(swiftState?.state || 'stopped')}
          </span>
        </div>
        <div class="card-detail">
          {#if toolchainStore.toolchain?.swift}
            <span class="detail-path">{toolchainStore.toolchain.swift.path}</span>
          {:else}
            <span class="detail-muted">Available on macOS with Xcode Command Line Tools</span>
          {/if}
        </div>
      </div>
    </div>

    <!-- Detected Developer Tools -->
    <div class="section-title mt">DETECTED DEVELOPER TOOLS</div>
    <div class="tools-table">
      <div class="tool-row">
        <span class="tool-name">Flutter</span>
        <span class="tool-info">
          {#if toolchainStore.toolchain?.flutter}
            <span class="path">{toolchainStore.toolchain.flutter.path}</span>
            <span class="tag">v{toolchainStore.toolchain.flutter.version}</span>
          {:else}
            <span class="missing">Not detected (Click Open Settings to specify)</span>
          {/if}
        </span>
      </div>

      <div class="tool-row">
        <span class="tool-name">Dart</span>
        <span class="tool-info">
          {#if toolchainStore.toolchain?.dart}
            <span class="path">{toolchainStore.toolchain.dart.path}</span>
            <span class="tag">v{toolchainStore.toolchain.dart.version}</span>
          {:else}
            <span class="missing">Not detected</span>
          {/if}
        </span>
      </div>

      <div class="tool-row">
        <span class="tool-name">Android SDK / ADB</span>
        <span class="tool-info">
          {#if toolchainStore.toolchain?.adb}
            <span class="path">{toolchainStore.toolchain.adb.path}</span>
            <span class="tag">ADB ready</span>
          {:else}
            <span class="missing">Not detected</span>
          {/if}
        </span>
      </div>

      <div class="tool-row">
        <span class="tool-name">Java JDK</span>
        <span class="tool-info">
          {#if toolchainStore.toolchain?.java}
            <span class="path">{toolchainStore.toolchain.java.path}</span>
            <span class="tag">v{toolchainStore.toolchain.java.version}</span>
          {:else}
            <span class="missing">Not detected</span>
          {/if}
        </span>
      </div>
    </div>

    <!-- Quick Link Banner to Settings -->
    <div class="settings-banner">
      <div class="banner-text">
        <span>Need to configure paths, accounts, format on save, or AI agents?</span>
      </div>
      <button class="btn-primary" onclick={onOpenSettings}>
        Open Settings Dialog (⌘,)
      </button>
    </div>
  </div>
</div>

<style>
  .toolchains-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: #121316;
    color: #e6e7ea;
    overflow-y: auto;
  }
  .panel-header {
    height: 44px;
    padding: 0 16px;
    border-bottom: 1px solid #22242a;
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: #17181c;
    flex-shrink: 0;
  }
  .header-title {
    font-size: 11px;
    font-weight: 700;
    color: #8b8f98;
    letter-spacing: 0.05em;
  }
  .header-sub {
    font-size: 11px;
    color: #555861;
    margin-left: 8px;
  }
  .btn-open-settings {
    display: flex;
    align-items: center;
    gap: 6px;
    background: #23252c;
    border: 1px solid #2e313b;
    border-radius: 6px;
    padding: 4px 10px;
    color: #d0d2d8;
    font-size: 12px;
    cursor: pointer;
    transition: all 0.15s;
  }
  .btn-open-settings:hover {
    background: #2d313b;
    color: #ffffff;
    border-color: #434857;
  }
  .panel-content {
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .section-title {
    font-size: 11px;
    font-weight: 700;
    color: #727680;
    letter-spacing: 0.04em;
  }
  .section-title.mt {
    margin-top: 8px;
  }
  .lsp-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    gap: 12px;
  }
  .lsp-card {
    background: #18191d;
    border: 1px solid #25272e;
    border-radius: 8px;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .card-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .card-title-wrap {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .card-title {
    font-size: 12px;
    font-weight: 600;
    color: #e0e2e8;
  }
  .status-badge {
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 4px;
    font-weight: 600;
  }
  .indexing-spinner {
    width: 12px;
    height: 12px;
    border: 2px solid #333640;
    border-top-color: #e8b45a;
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
  .card-detail {
    font-size: 11px;
    color: #8b8f98;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .detail-path {
    font-family: monospace;
    color: #9ab3d6;
  }
  .detail-indexing {
    color: #e8b45a;
    font-style: italic;
  }
  .detail-reason {
    color: #f07a74;
  }
  .detail-muted {
    color: #5d616c;
  }
  .card-footer {
    display: flex;
    gap: 8px;
    margin-top: 4px;
  }
  .btn-sub {
    background: #202228;
    border: 1px solid #2d3039;
    color: #a8abb5;
    padding: 3px 8px;
    border-radius: 4px;
    font-size: 11px;
    cursor: pointer;
  }
  .btn-sub:hover {
    background: #282b33;
    color: #ffffff;
  }
  .tools-table {
    background: #18191d;
    border: 1px solid #25272e;
    border-radius: 8px;
    display: flex;
    flex-direction: column;
  }
  .tool-row {
    display: flex;
    align-items: center;
    padding: 8px 12px;
    border-bottom: 1px solid #202227;
    font-size: 12px;
  }
  .tool-row:last-child {
    border-bottom: none;
  }
  .tool-name {
    width: 160px;
    font-weight: 600;
    color: #d0d2d8;
  }
  .tool-info {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 1;
    overflow: hidden;
  }
  .tool-info .path {
    font-family: monospace;
    font-size: 11px;
    color: #888d99;
  }
  .tool-info .tag {
    background: #22252c;
    color: #7fc98f;
    padding: 1px 6px;
    border-radius: 4px;
    font-size: 10px;
  }
  .tool-info .missing {
    color: #727682;
    font-style: italic;
  }
  .settings-banner {
    background: #1c2230;
    border: 1px solid #2c3850;
    border-radius: 8px;
    padding: 12px 16px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 8px;
  }
  .banner-text {
    font-size: 12px;
    color: #9cb2d8;
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
    background: #3464b0;
  }
</style>
