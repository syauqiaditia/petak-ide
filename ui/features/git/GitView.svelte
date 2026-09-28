<script lang="ts">
  import { onMount } from 'svelte';
  import { gitStore } from './git.svelte';
  import CommitPanel from './CommitPanel.svelte';
  import DiffView from './DiffView.svelte';
  import BranchPanel from './BranchPanel.svelte';
  import LogView from './LogView.svelte';
  import CommitDetail from './CommitDetail.svelte';

  let { folderPath = '' } = $props<{ folderPath?: string }>();

  let activeSubTab = $state<'commit' | 'log'>(
    typeof window !== 'undefined' && (window.location.search.includes('log') || window.location.search.includes('sub=log'))
      ? 'log'
      : 'commit'
  );

  $effect(() => {
    if (folderPath && folderPath !== gitStore.root) {
      gitStore.refresh(folderPath);
    }
  });

  onMount(() => {
    if (folderPath) {
      gitStore.refresh(folderPath);
    }
  });

  let totalChanges = $derived(
    gitStore.changesEntries.length +
    gitStore.stagedEntries.length +
    gitStore.untrackedEntries.length
  );
</script>

<div class="git-view">
  <!-- Git Top Bar (Sub-tabs) -->
  <div class="git-top-bar">
    <div class="tabs-group">
      <button
        class="tab-btn"
        class:active={activeSubTab === 'commit'}
        onclick={() => (activeSubTab = 'commit')}
      >
        Commit
        {#if totalChanges > 0}
          <span class="count-badge">{totalChanges}</span>
        {/if}
      </button>

      <button
        class="tab-btn"
        class:active={activeSubTab === 'log'}
        onclick={() => (activeSubTab = 'log')}
      >
        Log
      </button>
    </div>

    <div class="spacer"></div>

    <button
      class="refresh-btn"
      onclick={() => gitStore.refresh(folderPath)}
      title="Refresh Git status"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 2v6h-6"></path>
        <path d="M3 12a9 9 0 0 1 15-6.7L21 8"></path>
        <path d="M3 22v-6h6"></path>
        <path d="M21 12a9 9 0 0 1-15 6.7L3 16"></path>
      </svg>
      <span>Refresh</span>
    </button>
  </div>

  <!-- Git View Body -->
  <div class="git-view-body">
    {#if activeSubTab === 'commit'}
      <div class="commit-layout">
        <CommitPanel />
        <DiffView />
      </div>
    {:else}
      <div class="log-layout">
        <BranchPanel onSelectTab={(t) => (activeSubTab = t)} />
        <LogView />
        <CommitDetail />
      </div>
    {/if}
  </div>

  <!-- Commit File Diff Modal / Overlay -->
  {#if gitStore.commitDiffOpen && gitStore.commitDiffFile}
    <div
      class="commit-diff-modal-backdrop"
      onclick={() => gitStore.closeCommitDiff()}
      onkeydown={(e) => e.key === 'Escape' && gitStore.closeCommitDiff()}
      role="button"
      tabindex="0"
    >
      <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
      <div
        class="commit-diff-modal"
        onclick={(e) => e.stopPropagation()}
        onkeydown={(e) => e.stopPropagation()}
        role="dialog"
        tabindex="-1"
      >
        <div class="modal-header">
          <div class="modal-title">
            <span class="mono sha">{gitStore.selectedCommitSha?.slice(0, 7)}</span>
            <span class="modal-path">{gitStore.commitDiffPath}</span>
          </div>
          <button
            class="modal-close-btn"
            onclick={() => gitStore.closeCommitDiff()}
            title="Close diff view"
          >
            ✕
          </button>
        </div>
        <div class="modal-body">
          <DiffView
            diffFile={gitStore.commitDiffFile}
            sourceKind="commit"
            filePath={gitStore.commitDiffPath}
          />
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .git-view {
    flex: 1;
    display: flex;
    flex-direction: column;
    height: 100%;
    min-width: 0;
    background: #16171a;
    overflow: hidden;
  }

  .git-top-bar {
    height: 36px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 14px;
    background: #111215;
    border-bottom: 1px solid #26282d;
    user-select: none;
    -webkit-user-select: none;
  }

  .tabs-group {
    display: flex;
    gap: 4px;
  }

  .tab-btn {
    height: 28px;
    padding: 0 12px;
    border-radius: 6px;
    font-size: 12.5px;
    color: #8b8f98;
    background: transparent;
    display: flex;
    align-items: center;
    gap: 6px;
    transition: all 0.15s;
    cursor: pointer;
  }

  .tab-btn:hover {
    color: #d8d9dc;
    background: #1a1b1f;
  }

  .tab-btn.active {
    background: #23252b;
    color: #e6e7ea;
    font-weight: 500;
  }

  .count-badge {
    font-size: 11px;
    font-weight: 600;
    color: #6ea8ff;
    background: #1f2a3d;
    padding: 1px 6px;
    border-radius: 10px;
  }

  .spacer {
    flex-grow: 1;
  }

  .refresh-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 26px;
    padding: 0 10px;
    font-size: 12px;
    color: #8b8f98;
    border: 1px solid #2c2e34;
    border-radius: 6px;
    transition: all 0.1s;
    cursor: pointer;
  }

  .refresh-btn:hover {
    color: #d8d9dc;
    background: #1a1b1f;
  }

  .git-view-body {
    flex: 1;
    display: flex;
    min-height: 0;
    overflow: hidden;
  }

  .commit-layout {
    flex: 1;
    display: flex;
    min-height: 0;
    overflow: hidden;
  }

  .log-layout {
    flex: 1;
    display: flex;
    min-height: 0;
    overflow: hidden;
    width: 100%;
    height: 100%;
  }

  .commit-diff-modal-backdrop {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.6);
    z-index: 1000;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    backdrop-filter: blur(2px);
  }

  .commit-diff-modal {
    width: 90vw;
    max-width: 1200px;
    height: 85vh;
    background: #141518;
    border: 1px solid #34363d;
    border-radius: 10px;
    box-shadow: 0 20px 50px rgba(0, 0, 0, 0.7);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .modal-header {
    height: 44px;
    padding: 0 16px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: #111215;
    border-bottom: 1px solid #26282d;
    flex-shrink: 0;
  }

  .modal-title {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 13px;
  }

  .modal-title .sha {
    color: #9cc3ff;
    font-size: 12px;
  }

  .modal-path {
    color: #e6e7ea;
    font-weight: 500;
  }

  .modal-close-btn {
    width: 28px;
    height: 28px;
    display: grid;
    place-items: center;
    border-radius: 6px;
    border: none;
    background: transparent;
    color: #8b8f98;
    font-size: 14px;
    cursor: pointer;
  }

  .modal-close-btn:hover {
    background: #23252b;
    color: #ffffff;
  }

  .modal-body {
    flex: 1;
    min-height: 0;
    overflow: hidden;
    display: flex;
  }

  .mono {
    font-family: 'JetBrains Mono', ui-monospace, monospace;
  }
</style>
