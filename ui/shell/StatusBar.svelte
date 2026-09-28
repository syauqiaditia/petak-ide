<script lang="ts">
  import { diagnosticsStore } from '../features/editor/lsp/diagnostics.svelte';
  import { gitStore } from '../features/git/git.svelte.ts';

  let {
    branchName = '',
    statusText = 'Ready',
    isBench = false,
    fileType = 'Kotlin',
    cursorInfo = 'Ln 1, Col 1',
    onOpenProblems = () => {},
  } = $props<{
    branchName?: string | null;
    statusText?: string;
    isBench?: boolean;
    fileType?: string;
    cursorInfo?: string;
    onOpenProblems?: () => void;
  }>();

  let branch = $derived(gitStore.branch);
  let displayBranch = $derived(branch?.head || branchName || null);
  let ahead = $derived(branch?.upstream ? branch.ahead : 0);
  let behind = $derived(branch?.upstream ? branch.behind : 0);
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
