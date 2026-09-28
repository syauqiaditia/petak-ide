<script lang="ts">
  import { onMount } from 'svelte';
  import { gitStore } from './git.svelte.ts';
  import CommitPanel from './CommitPanel.svelte';
  import DiffView from './DiffView.svelte';

  let { folderPath = '' } = $props<{ folderPath?: string }>();

  let activeSubTab = $state<'commit' | 'log'>('commit');

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
      <div class="log-placeholder">
        <div class="placeholder-icon">
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#6ea8ff" stroke-width="1.8" stroke-linecap="round">
            <circle cx="6" cy="5" r="2"></circle>
            <circle cx="6" cy="19" r="2"></circle>
            <circle cx="18" cy="7" r="2"></circle>
            <path d="M6 7v10M18 9c0 5-6 4-12 8"></path>
          </svg>
        </div>
        <div class="placeholder-title">Git Log & Graph</div>
        <div class="placeholder-desc">Log view akan hadir di P3.6</div>
      </div>
    {/if}
  </div>
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

  .log-placeholder {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    color: #8b8f98;
  }

  .placeholder-icon {
    width: 64px;
    height: 64px;
    border-radius: 32px;
    background: #1f2a3d;
    display: grid;
    place-items: center;
  }

  .placeholder-title {
    font-size: 16px;
    font-weight: 600;
    color: #d8d9dc;
  }

  .placeholder-desc {
    font-size: 13px;
    color: #8b8f98;
  }
</style>
