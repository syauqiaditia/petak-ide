<script lang="ts">
  import { diagnosticsStore } from '../features/editor/lsp/diagnostics.svelte';
  import { gitStore } from '../features/git/git.svelte.ts';
  import { runStore } from '../features/run/runStore.svelte';
  import { mirrorStore } from '../features/mirror/mirrorStore.svelte';
  import { toolchainStore } from '../features/toolchain/toolchainStore.svelte';
  import { formatAppState } from '../features/run/logic';

  let {
    branchName = '',
    statusText = 'Ready',
    isBench = false,
    fileType = 'Kotlin',
    cursorInfo = 'Ln 1, Col 1',
    onOpenProblems = () => {},
    onOpenToolchains = () => {},
  } = $props<{
    branchName?: string | null;
    statusText?: string;
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

  <span class="status-indicator">
    <span class="dot"></span>
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
        {mirrorStore.deviceName} mirror live ({mirrorStore.fps} fps{mirrorStore.latencyMs !== null ? ` · ${mirrorStore.latencyMs}ms` : ''})
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

  <div class="spacer"></div>

  <span>{cursorInfo}</span>
  <span>UTF-8</span>
  <span class="vim-tag">VIM</span>
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
</style>
