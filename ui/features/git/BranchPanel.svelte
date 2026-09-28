<script lang="ts">
  import { gitStore } from './git.svelte';
  import type { LocalBranch, RemoteBranch, TagRef } from './types';

  let { onSelectTab } = $props<{
    onSelectTab?: (tab: 'commit' | 'log') => void;
  }>();

  let branchList = $derived(gitStore.branches);
  let localBranches = $derived(branchList?.local ?? []);
  let remoteBranches = $derived(branchList?.remote ?? []);
  let tags = $derived(branchList?.tags ?? []);

  let activeBranchFilter = $derived(gitStore.logFilter.branches?.[0] ?? null);

  let totalChanges = $derived(
    gitStore.changesEntries.length +
    gitStore.stagedEntries.length +
    gitStore.untrackedEntries.length
  );

  function filterByBranch(name: string) {
    if (activeBranchFilter === name) {
      gitStore.setLogFilter({ branches: [] });
    } else {
      gitStore.setLogFilter({ branches: [name] });
    }
  }

  function filterByTag(name: string) {
    if (activeBranchFilter === name) {
      gitStore.setLogFilter({ branches: [] });
    } else {
      gitStore.setLogFilter({ branches: [name] });
    }
  }
</script>

<div class="branch-panel">
  <!-- Sub-tab switcher matching Git.html -->
  <div class="panel-tabs">
    <button
      class="panel-tab active"
      onclick={() => onSelectTab?.('log')}
    >
      Log
    </button>
    <button
      class="panel-tab"
      onclick={() => onSelectTab?.('commit')}
    >
      Commit
      {#if totalChanges > 0}
        <span class="commit-count">{totalChanges}</span>
      {/if}
    </button>
    <button class="panel-tab muted" disabled>
      Stash
    </button>
  </div>

  <div class="branch-tree">
    <!-- LOCAL -->
    <div class="section-header">LOCAL</div>
    {#if localBranches.length === 0}
      <div class="empty-item">No local branches</div>
    {:else}
      {#each localBranches as b}
        <button
          class="branch-item"
          class:current={b.isCurrent}
          class:filtered={activeBranchFilter === b.name}
          onclick={() => filterByBranch(b.name)}
          title="{b.name}{b.upstream ? ` -> ${b.upstream}` : ''}"
        >
          {#if b.isCurrent}
            <span class="star">★</span>
          {/if}
          <span class="name">{b.name}</span>
          {#if b.ahead > 0}
            <span class="ahead">↑{b.ahead}</span>
          {/if}
          {#if b.behind > 0}
            <span class="behind">↓{b.behind}</span>
          {/if}
        </button>
      {/each}
    {/if}

    <!-- REMOTE -->
    <div class="section-header mt">REMOTE · origin</div>
    {#if remoteBranches.length === 0}
      <div class="empty-item">No remote branches</div>
    {:else}
      {#each remoteBranches as b}
        <button
          class="branch-item"
          class:filtered={activeBranchFilter === b.name}
          onclick={() => filterByBranch(b.name)}
          title={b.name}
        >
          <span class="name">{b.name.replace(/^origin\//, '')}</span>
        </button>
      {/each}
    {/if}

    <!-- TAGS -->
    <div class="section-header mt">TAGS</div>
    {#if tags.length === 0}
      <div class="empty-item">No tags</div>
    {:else}
      {#each tags as t}
        <button
          class="branch-item"
          class:filtered={activeBranchFilter === t.name}
          onclick={() => filterByTag(t.name)}
          title={t.name}
        >
          <span class="name">{t.name}</span>
        </button>
      {/each}
    {/if}
  </div>
</div>

<style>
  .branch-panel {
    width: 240px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    background: #141518;
    border-right: 1px solid #26282d;
    line-height: 28px;
    user-select: none;
    height: 100%;
    overflow: hidden;
  }

  .panel-tabs {
    height: 40px;
    display: flex;
    align-items: center;
    padding: 0 14px;
    gap: 8px;
    border-bottom: 1px solid #222428;
    flex-shrink: 0;
  }

  .panel-tab {
    height: 28px;
    padding: 0 10px;
    border-radius: 6px;
    border: none;
    background: transparent;
    color: #8b8f98;
    font-size: 13px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  .panel-tab:hover:not(:disabled) {
    color: #d8d9dc;
    background: #1d1f24;
  }

  .panel-tab.active {
    background: #23252b;
    color: #e6e7ea;
    font-weight: 500;
  }

  .panel-tab.muted {
    cursor: default;
    opacity: 0.6;
  }

  .commit-count {
    color: #9cc3ff;
    font-size: 12px;
    font-weight: 600;
  }

  .branch-tree {
    flex: 1;
    overflow-y: auto;
    padding: 8px 0;
    display: flex;
    flex-direction: column;
  }

  .section-header {
    padding-left: 14px;
    color: #8b8f98;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.8px;
    line-height: 24px;
  }

  .section-header.mt {
    margin-top: 10px;
  }

  .branch-item {
    display: flex;
    align-items: center;
    height: 28px;
    padding: 0 14px 0 22px;
    background: transparent;
    border: none;
    color: #d8d9dc;
    font-size: 13px;
    text-align: left;
    cursor: pointer;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    gap: 6px;
  }

  .branch-item:hover {
    background: #1a1c22;
  }

  .branch-item.current {
    color: #cfe0ff;
    font-weight: 500;
  }

  .branch-item.filtered {
    background: #1f2a3d;
    color: #cfe0ff;
  }

  .star {
    color: #f0cf8e;
    font-size: 13px;
  }

  .name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .ahead {
    color: #7fc98f;
    font-size: 12px;
    font-weight: 500;
  }

  .behind {
    color: #f0a6a2;
    font-size: 12px;
    font-weight: 500;
  }

  .empty-item {
    padding-left: 22px;
    color: #656973;
    font-size: 12px;
    font-style: italic;
  }
</style>
