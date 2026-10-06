<script lang="ts">
  import { onMount } from 'svelte';
  import { diagnosticsStore } from '../features/editor/lsp/diagnostics.svelte';
  import { gitStore } from '../features/git/git.svelte.ts';
  import { runStore } from '../features/run/runStore.svelte';
  import { mirrorStore } from '../features/mirror/mirrorStore.svelte';
  import { toolchainStore } from '../features/toolchain/toolchainStore.svelte';
  import { formatAppState } from '../features/run/logic';
  import { api } from '../lib/api';
  import { editorSettings } from '../features/editor/editorSettings.svelte';
  import { settingsStore } from '../features/settings/settingsStore.svelte';
  import { calcPatDaysLeft, patNeedsWarning, formatPatIndicator } from '../features/accounts/accountsExpiryLogic';
  import { updateStore } from '../features/updater/updateStore.svelte';

  let {
    branchName = '',
    statusText = 'Ready',
    statusKind = undefined,
    isBench = false,
    fileType = 'Kotlin',
    cursorInfo = 'Ln 1, Col 1',
    onOpenProblems = () => {},
    onOpenToolchains = () => {},
  } = $props<{
    branchName?: string | null;
    statusText?: string;
    statusKind?: 'normal' | 'error' | 'warning';
    isBench?: boolean;
    fileType?: string;
    cursorInfo?: string;
    onOpenProblems?: () => void;
    onOpenToolchains?: () => void;
  }>();

  let branch = $derived(gitStore.branch);
  let displayBranch = $derived(branch?.head || branchName || null);
  let ahead = $derived(branch?.upstream ? branch.ahead : 0);
  let behind = $derived(branch?.upstream ? branch.behind : 0);
  let lspSummary = $derived(toolchainStore.currentLspSummary);

  let resolvedStatusKind = $derived(
    statusKind ||
    (statusText.toLowerCase().includes('failed') || statusText.toLowerCase().includes('error')
      ? 'error'
      : statusText.toLowerCase().includes('warn')
      ? 'warning'
      : 'normal')
  );

  let statusColor = $derived(
    resolvedStatusKind === 'error'
      ? '#f07a74'
      : resolvedStatusKind === 'warning'
      ? '#e8b45a'
      : '#7fc98f'
  );

  let isInstallingKls = $state(false);
  let klsProgressText = $state('');

  // GitLab PAT expiry indicator
  let gitlabUser = $state<string | null>(null);
  let gitlabHasToken = $state(false);
  let patDaysLeft = $state<number | null>(null);
  let patExpired = $state(false);

  onMount(async () => {
    try {
      const info = await api.accountsGet();
      gitlabHasToken = !!info.hasToken;
      if (info.hasToken) {
        try {
          const testResult = await api.accountsTest();
          if (testResult.ok && testResult.user) {
            gitlabUser = testResult.user;
          }
        } catch { /* token test failed, still show configured */ }
      }
    } catch { /* ignore */ }
  });

  async function handleInstallKls() {
    if (isInstallingKls) return;
    isInstallingKls = true;
    klsProgressText = 'Downloading…';
    let unlisten: any = null;
    try {
      unlisten = await api.onKlsInstallProgress((p) => {
        klsProgressText = p.message || `${p.stage}…`;
      });
      await api.klsInstall();
      klsProgressText = 'Restarting LSP…';
      await toolchainStore.refresh();
      await api.lspRestart();
      toolchainStore.showToast('Kotlin Language Server installed and ready!');
    } catch (err: any) {
      toolchainStore.showToast(`Failed to install Kotlin LS: ${err?.message || err}`);
    } finally {
      isInstallingKls = false;
      klsProgressText = '';
      if (unlisten) unlisten();
    }
  }
</script>

<div class="status-bar">
  {#if displayBranch}
    <span class="branch-tag">
      {displayBranch}
      {#if ahead > 0}
        <span class="ahead-tag">↑{ahead}</span>
      {/if}
      {#if behind > 0}
        <span class="behind-tag">↓{behind}</span>
      {/if}
    </span>
  {/if}

  <span class="status-indicator" style:color={statusColor}>
    <span class="dot" style:background={statusColor}></span>
    {statusText}
  </span>

  <span
    class="lsp-indicator"
    class:is-ready={lspSummary.state === 'ready'}
    class:is-starting={lspSummary.state === 'starting'}
    class:is-failed={lspSummary.state === 'failed'}
    onclick={() => onOpenToolchains?.()}
    role="button"
    tabindex="0"
    title={lspSummary.details || lspSummary.label}
    onkeydown={(e) => { if (e.key === 'Enter') onOpenToolchains?.(); }}
  >
    <span
      class="dot"
      style:background={lspSummary.state === 'ready'
        ? '#7fc98f'
        : lspSummary.state === 'starting'
        ? '#e8b45a'
        : lspSummary.state === 'failed'
        ? '#f07a74'
        : '#8b8f98'}
    ></span>
    {lspSummary.label}
  </span>

  {#if lspSummary.state === 'failed' && (lspSummary.label.includes('Kotlin') || fileType === 'Kotlin')}
    <button
      class="install-kls-btn"
      disabled={isInstallingKls}
      onclick={handleInstallKls}
      title="Install Kotlin Language Server (RAM ~600-900MB, lazy)"
    >
      {#if isInstallingKls}
        <span class="kls-spinner"></span>
        <span>{klsProgressText || 'Installing…'}</span>
      {:else}
        <span>Install Kotlin Language Server</span>
      {/if}
    </button>
  {/if}

  {#if runStore.state !== 'stopped'}
    {@const stateInfo = formatAppState(runStore.state)}
    <span class="run-status-indicator" style:color={stateInfo.color}>
      <span class="dot" style:background={stateInfo.dotColor}></span>
      {stateInfo.label}
      {#if runStore.lastReloadMs !== null}
        <span class="ms-tag">⚡ {runStore.lastReloadMs}ms</span>
      {/if}
    </span>
  {/if}

  {#if runStore.gradleDaemon}
    <span class="gradle-tag">
      <span class="dot gradle-dot"></span>
      Gradle daemon
      <button class="stop-daemon-btn" onclick={() => runStore.stopGradle()} title="Stop Gradle Daemon">
        Stop
      </button>
    </span>
  {/if}

  {#if runStore.selectedDevice}
    <span class="device-tag">{runStore.selectedDevice.name} connected</span>
  {:else}
    <span class="device-tag no-device">No device</span>
  {/if}

  {#if mirrorStore.isOpen}
    {#if mirrorStore.status === 'live'}
      <span class="mirror-status-tag live">
        <span class="dot mirror-dot-live"></span>
        {mirrorStore.deviceName} mirror live ({mirrorStore.fps > 0 ? `${mirrorStore.fps} fps` : 'Idle'}{mirrorStore.latencyMs !== null && mirrorStore.fps > 0 ? ` · ${mirrorStore.latencyMs}ms` : ''})
      </span>
    {:else if mirrorStore.status === 'view-only'}
      <span class="mirror-status-tag viewonly">
        <span class="dot mirror-dot-viewonly"></span>
        {mirrorStore.deviceName} mirror view-only
      </span>
    {:else if mirrorStore.status === 'connecting'}
      <span class="mirror-status-tag connecting">
        <span class="dot mirror-dot-connecting"></span>
        {mirrorStore.deviceName} mirror connecting…
      </span>
    {/if}
  {/if}

  {#if diagnosticsStore.totalCount > 0}
    <div
      class="problems-badge-group"
      onclick={() => onOpenProblems?.()}
      role="button"
      tabindex="0"
      onkeydown={(e) => { if (e.key === 'Enter') onOpenProblems?.(); }}
    >
      {#if diagnosticsStore.totalErrors > 0}
        <span class="status-errors" title="{diagnosticsStore.totalErrors} errors">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="8" x2="12" y2="12"></line>
            <line x1="12" y1="16" x2="12.01" y2="16"></line>
          </svg>
          {diagnosticsStore.totalErrors}
        </span>
      {/if}
      {#if diagnosticsStore.totalWarnings > 0}
        <span class="status-warnings" title="{diagnosticsStore.totalWarnings} warnings">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
            <path d="M12 3l10 18H2z"></path>
            <line x1="12" y1="10" x2="12" y2="15"></line>
            <line x1="12" y1="18" x2="12.01" y2="18"></line>
          </svg>
          {diagnosticsStore.totalWarnings}
        </span>
      {/if}
    </div>
  {/if}
  {#if isBench}
    <span class="bench-badge">⚡ BENCH RUNNING</span>
  {/if}

  {#if gitlabHasToken}
    <span
      class="gitlab-indicator"
      class:gitlab-warning={patNeedsWarning(patDaysLeft, patExpired)}
      onclick={() => settingsStore.open('accounts')}
      role="button"
      tabindex="0"
      onkeydown={(e) => { if (e.key === 'Enter') settingsStore.open('accounts'); }}
      title={gitlabUser ? `GitLab: @${gitlabUser}` : 'GitLab account configured'}
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M22.65 14.39L12 22.13 1.35 14.39a.84.84 0 0 1-.3-.94l1.22-3.78 2.44-7.51A.42.42 0 0 1 4.82 2a.43.43 0 0 1 .58 0 .42.42 0 0 1 .11.18l2.44 7.49h8.1l2.44-7.51A.42.42 0 0 1 18.6 2a.43.43 0 0 1 .58 0 .42.42 0 0 1 .11.18l2.44 7.51L23 13.45a.84.84 0 0 1-.35.94z"></path>
      </svg>
      {#if patNeedsWarning(patDaysLeft, patExpired)}
        <span>{formatPatIndicator(patDaysLeft, patExpired)}</span>
      {:else if gitlabUser}
        <span>@{gitlabUser}</span>
      {:else}
        <span>GitLab</span>
      {/if}
    </span>
  {/if}

  {#if updateStore.updateAvailable}
    <button
      class="update-status-btn"
      class:updating={updateStore.isUpdating}
      onclick={() => updateStore.applyUpdate()}
      title="Versi {updateStore.latestVersion} tersedia! Klik untuk update & restart"
      disabled={updateStore.isUpdating}
    >
      <span>✨ {updateStore.isUpdating ? 'Updating…' : `Update v${updateStore.latestVersion}`}</span>
    </button>
  {/if}

  <div class="spacer"></div>

  <span>{cursorInfo}</span>
  <span>UTF-8</span>
  {#if editorSettings.vimMode}
    <span class="vim-tag">VIM</span>
  {/if}
  <span>{fileType}</span>

  {#if toolchainStore.toast}
    <div class="lsp-floating-toast" role="alert">
      <span class="toast-msg">{toolchainStore.toast.message}</span>
      {#if toolchainStore.toast.actionText && toolchainStore.toast.onAction}
        <button class="toast-btn" onclick={toolchainStore.toast.onAction}>
          {toolchainStore.toast.actionText}
        </button>
      {/if}
      <button class="toast-close" onclick={() => toolchainStore.clearToast()}>✕</button>
    </div>
  {/if}
</div>

<style>
  .status-bar {
    height: 26px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 0 14px;
    background: #111215;
    border-top: 1px solid #26282d;
    font-size: 12px;
    color: #8b8f98;
    user-select: none;
    -webkit-user-select: none;
  }
  .branch-tag {
    color: #b9bcc3;
    display: flex;
    align-items: center;
    gap: 3px;
  }
  .ahead-tag {
    color: #7fc98f;
    font-size: 11px;
    font-weight: 500;
  }
  .behind-tag {
    color: #e8b45a;
    font-size: 11px;
    font-weight: 500;
  }
  .status-indicator {
    display: flex;
    align-items: center;
    gap: 6px;
    color: #7fc98f;
  }
  .lsp-indicator {
    display: flex;
    align-items: center;
    gap: 6px;
    color: #8b8f98;
    cursor: pointer;
    padding: 2px 6px;
    border-radius: 4px;
    transition: background 0.15s;
  }
  .lsp-indicator:hover {
    background: #1e2025;
    color: #d8d9dc;
  }
  .lsp-indicator.is-ready {
    color: #7fc98f;
  }
  .lsp-indicator.is-starting {
    color: #e8b45a;
  }
  .lsp-indicator.is-failed {
    color: #f07a74;
    background: #2a191a;
  }
  .install-kls-btn {
    height: 20px;
    padding: 0 8px;
    background: #3b2022;
    border: 1px solid #6b3337;
    border-radius: 4px;
    color: #fca5a5;
    font-size: 11px;
    font-weight: 500;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    transition: all 0.15s;
  }
  .install-kls-btn:hover:not(:disabled) {
    background: #4a282b;
    border-color: #8c4247;
    color: #fff;
  }
  .install-kls-btn:disabled {
    opacity: 0.7;
    cursor: wait;
  }
  .kls-spinner {
    width: 9px;
    height: 9px;
    border: 1.5px solid rgba(252, 165, 165, 0.3);
    border-top-color: #fca5a5;
    border-radius: 50%;
    animation: kls-spin 0.8s linear infinite;
  }
  @keyframes kls-spin {
    to { transform: rotate(360deg); }
  }
  .lsp-floating-toast {
    position: fixed;
    bottom: 34px;
    right: 18px;
    background: #201718;
    border: 1px solid #5a2729;
    border-radius: 6px;
    padding: 8px 12px;
    color: #f0a6a2;
    font-size: 12px;
    display: flex;
    align-items: center;
    gap: 10px;
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.4);
    z-index: 9999;
  }
  .lsp-floating-toast .toast-msg {
    max-width: 380px;
  }
  .lsp-floating-toast .toast-btn {
    padding: 2px 8px;
    border-radius: 4px;
    background: #461f22;
    border: 1px solid #732a2e;
    color: #ffffff;
    font-size: 11px;
    cursor: pointer;
  }
  .lsp-floating-toast .toast-btn:hover {
    background: #5a262a;
  }
  .lsp-floating-toast .toast-close {
    background: transparent;
    border: none;
    color: #9c6c6e;
    cursor: pointer;
    font-size: 12px;
    padding: 0 4px;
  }
  .run-status-indicator {
    display: flex;
    align-items: center;
    gap: 6px;
    font-weight: 500;
  }
  .ms-tag {
    font-size: 11px;
    color: #e8b45a;
    background: #2e2717;
    padding: 0 5px;
    border-radius: 3px;
  }
  .gradle-tag {
    display: flex;
    align-items: center;
    gap: 6px;
    color: #7fc98f;
  }
  .gradle-dot {
    background: #7fc98f;
  }
  .stop-daemon-btn {
    padding: 1px 5px;
    border-radius: 3px;
    font-size: 10px;
    color: #f07a74;
    background: #2a1d1e;
    border: 1px solid #4a2629;
    cursor: pointer;
  }
  .stop-daemon-btn:hover {
    background: #4a2629;
  }
  .device-tag {
    color: #8b8f98;
  }
  .device-tag.no-device {
    color: #5b5f68;
  }
  .mirror-status-tag {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    font-weight: 500;
  }
  .mirror-status-tag.live {
    color: #6ea8ff;
  }
  .mirror-status-tag.viewonly,
  .mirror-status-tag.connecting {
    color: #e8b45a;
  }
  .mirror-dot-live {
    background: #6ea8ff;
  }
  .mirror-dot-viewonly,
  .mirror-dot-connecting {
    background: #e8b45a;
  }
  .problems-badge-group {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 11px;
    font-weight: 500;
    cursor: pointer;
    user-select: none;
    padding: 2px 4px;
    border-radius: 4px;
    transition: background 0.1s;
  }
  .problems-badge-group:hover {
    background: #1f2127;
  }
  .status-errors {
    display: flex;
    align-items: center;
    gap: 4px;
    color: #f07a74;
  }
  .status-warnings {
    display: flex;
    align-items: center;
    gap: 4px;
    color: #e8b45a;
  }
  .dot {
    width: 6px;
    height: 6px;
    border-radius: 3px;
    background: #7fc98f;
  }
  .bench-badge {
    background: #3a2e1a;
    color: #e8b45a;
    padding: 1px 6px;
    border-radius: 4px;
    font-size: 10px;
    font-weight: 600;
  }
  .spacer {
    flex-grow: 1;
  }
  .vim-tag {
    background: #23252b;
    color: #9cc3ff;
    padding: 1px 5px;
    border-radius: 3px;
    font-size: 10px;
    font-weight: 600;
  }
  .gitlab-indicator {
    display: flex;
    align-items: center;
    gap: 5px;
    color: #8b8f98;
    cursor: pointer;
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 11px;
    transition: background 0.15s;
  }
  .gitlab-indicator:hover {
    background: #1e2025;
    color: #d8d9dc;
  }
  .gitlab-indicator.gitlab-warning {
    color: #e8b45a;
    background: #2e2717;
  }
  .gitlab-indicator.gitlab-warning:hover {
    background: #3a3019;
    color: #f5c76a;
  }
  .update-status-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 18px;
    padding: 0 8px;
    border-radius: 9px;
    background: rgba(34, 197, 94, 0.16);
    border: 1px solid rgba(52, 211, 153, 0.45);
    color: #6ee7b7;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
    margin-left: 6px;
  }
  .update-status-btn:hover:not(:disabled) {
    background: rgba(34, 197, 94, 0.35);
    color: #ffffff;
  }
  .update-status-btn.updating {
    opacity: 0.7;
    cursor: wait;
  }
</style>
