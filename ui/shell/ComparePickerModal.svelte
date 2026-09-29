<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { api, type GitCommit } from '../lib/api';
  import { gitStore } from '../features/git/git.svelte.ts';
  import type { GitBranch } from '../features/git/types';

  let {
    fileName = '',
    relPath = '',
    folderPath = '',
    onclose,
    onselect,
  } = $props<{
    fileName: string;
    relPath: string;
    folderPath: string;
    onclose: () => void;
    onselect: (ref: string) => void;
  }>();

  let activeTab = $state<'branches' | 'revisions'>('branches');
  let filterText = $state('');
  let inputEl: HTMLInputElement;
  let selectedIndex = $state(0);
  let commits = $state<GitCommit[]>([]);
  let loadingCommits = $state(false);

  // Format relative time helper
  function formatRelativeTime(ts: number): string {
    const now = Math.floor(Date.now() / 1000);
    const diff = Math.max(0, now - ts);
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    const days = Math.floor(diff / 86400);
    if (days < 30) return `${days}d ago`;
    return new Date(ts * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  // Branches list from gitStore
  const allBranches = $derived<GitBranch[]>([
    ...(gitStore.branches?.local ?? []),
    ...(gitStore.branches?.remote ?? []),
  ]);

  const filteredBranches = $derived(
    allBranches.filter((b) => b.name.toLowerCase().includes(filterText.toLowerCase()))
  );

  const filteredCommits = $derived(
    commits.filter(
      (c) =>
        c.sha.toLowerCase().includes(filterText.toLowerCase()) ||
        c.subject.toLowerCase().includes(filterText.toLowerCase()) ||
        c.authorName.toLowerCase().includes(filterText.toLowerCase())
    )
  );

  const currentListLength = $derived(
    activeTab === 'branches' ? filteredBranches.length : filteredCommits.length
  );

  onMount(async () => {
    tick().then(() => inputEl?.focus());

    // Load path commits
    if (folderPath && relPath) {
      loadingCommits = true;
      try {
        commits = await api.gitPathHistory(folderPath, relPath, true, 50, 0);
      } catch (e) {
        console.error('Failed to load path history:', e);
      } finally {
        loadingCommits = false;
      }
    }
  });

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      onclose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (currentListLength > 0) {
        selectedIndex = (selectedIndex + 1) % currentListLength;
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (currentListLength > 0) {
        selectedIndex = (selectedIndex - 1 + currentListLength) % currentListLength;
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      confirmSelection();
    }
  }

  function confirmSelection() {
    if (activeTab === 'branches') {
      const b = filteredBranches[selectedIndex];
      if (b) {
        onselect(b.name);
        onclose();
      }
    } else {
      const c = filteredCommits[selectedIndex];
      if (c) {
        onselect(c.sha);
        onclose();
      }
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="modal-backdrop" onclick={onclose} role="presentation">
  <div class="modal-box" onclick={(e) => e.stopPropagation()} role="dialog">
    <div class="modal-header">
      <span class="modal-title">Compare '{fileName}' with…</span>
      <button class="modal-close-btn" onclick={onclose} title="Close (Esc)">✕</button>
    </div>

    <div class="modal-body">
      <div class="search-wrap">
        <span class="search-icon">🔍</span>
        <input
          bind:this={inputEl}
          bind:value={filterText}
          class="search-input"
          placeholder="Type branch name or commit hash…"
        />
      </div>

      <div class="tabs-nav">
        <button
          class="tab-btn"
          class:active={activeTab === 'branches'}
          onclick={() => {
            activeTab = 'branches';
            selectedIndex = 0;
          }}
        >
          Branches ({filteredBranches.length})
        </button>
        <button
          class="tab-btn"
          class:active={activeTab === 'revisions'}
          onclick={() => {
            activeTab = 'revisions';
            selectedIndex = 0;
          }}
        >
          Revisions / Commits ({filteredCommits.length})
        </button>
      </div>

      <div class="list-container">
        {#if activeTab === 'branches'}
          {#if filteredBranches.length === 0}
            <div class="empty-text">No branches match filter</div>
          {:else}
            {#each filteredBranches as b, idx}
              <button
                class="row-item"
                class:selected={selectedIndex === idx}
                onclick={() => {
                  selectedIndex = idx;
                  confirmSelection();
                }}
              >
                <span class="row-icon"></span>
                <span class="row-name">{b.name}</span>
                {#if b.upstream}
                  <span class="badge-upstream">{b.upstream}</span>
                {/if}
                {#if b.isCurrent}
                  <span class="badge-head">HEAD</span>
                {/if}
              </button>
            {/each}
          {/if}
        {:else}
          {#if loadingCommits}
            <div class="empty-text">Loading commits…</div>
          {:else if filteredCommits.length === 0}
            <div class="empty-text">No revisions match filter</div>
          {:else}
            {#each filteredCommits as c, idx}
              <button
                class="row-item"
                class:selected={selectedIndex === idx}
                onclick={() => {
                  selectedIndex = idx;
                  confirmSelection();
                }}
              >
                <span class="row-sha">{c.shortSha}</span>
                <span class="row-subject">{c.subject}</span>
                <span class="row-meta">
                  {c.authorName} · {formatRelativeTime(c.authorTime)}
                </span>
              </button>
            {/each}
          {/if}
        {/if}
      </div>
    </div>

    <div class="modal-footer">
      <button class="btn btn-secondary" onclick={onclose}>Cancel</button>
      <button
        class="btn btn-primary"
        onclick={confirmSelection}
        disabled={currentListLength === 0}
      >
        Compare
      </button>
    </div>
  </div>
</div>

<style>
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.65);
    backdrop-filter: blur(2px);
    z-index: 1100;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .modal-box {
    width: 560px;
    height: 480px;
    background: #1c1d22;
    border: 1px solid #34363d;
    border-radius: 10px;
    box-shadow: 0 20px 50px rgba(0, 0, 0, 0.6);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    color: #d8d9dc;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  }

  .modal-header {
    height: 46px;
    padding: 0 16px;
    display: flex;
    align-items: center;
    border-bottom: 1px solid #2a2c32;
    font-weight: 600;
    font-size: 13.5px;
    flex-shrink: 0;
  }

  .modal-title {
    color: #e6efff;
  }

  .modal-close-btn {
    margin-left: auto;
    color: #8b8f98;
    background: none;
    border: none;
    font-size: 14px;
    cursor: pointer;
    padding: 4px;
    line-height: 1;
    border-radius: 4px;
  }

  .modal-close-btn:hover {
    color: #d8d9dc;
    background: #26282d;
  }

  .modal-body {
    flex: 1;
    padding: 14px 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    overflow: hidden;
  }

  .search-wrap {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 32px;
    background: #141518;
    border: 1px solid #2c2e34;
    border-radius: 6px;
    padding: 0 10px;
    flex-shrink: 0;
  }

  .search-icon {
    font-size: 12px;
    opacity: 0.7;
  }

  .search-input {
    flex: 1;
    background: transparent;
    border: none;
    outline: none;
    color: #d8d9dc;
    font-size: 12.5px;
  }

  .tabs-nav {
    display: flex;
    gap: 8px;
    border-bottom: 1px solid #26282d;
    padding-bottom: 6px;
    flex-shrink: 0;
  }

  .tab-btn {
    background: transparent;
    border: none;
    color: #8b8f98;
    font-size: 12px;
    font-weight: 500;
    padding: 4px 8px;
    border-radius: 4px;
    cursor: pointer;
  }

  .tab-btn.active {
    background: #22242a;
    color: #6ea8ff;
  }

  .list-container {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 2px;
    background: #141518;
    border: 1px solid #26282d;
    border-radius: 6px;
    padding: 4px;
  }

  .row-item {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 30px;
    padding: 0 10px;
    border-radius: 4px;
    background: transparent;
    border: none;
    color: #d8d9dc;
    font-size: 12.5px;
    text-align: left;
    cursor: pointer;
    width: 100%;
    transition: background 0.1s;
  }

  .row-item:hover,
  .row-item.selected {
    background: #2a3a55;
    color: #e6efff;
  }

  .row-icon {
    color: #6ea8ff;
    font-size: 13px;
  }

  .row-name {
    font-weight: 500;
  }

  .row-sha {
    font-family: 'JetBrains Mono', monospace;
    font-size: 11.5px;
    color: #8b8f98;
    flex-shrink: 0;
  }

  .row-subject {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .row-meta {
    font-size: 11px;
    color: #8b8f98;
    margin-left: auto;
    flex-shrink: 0;
  }

  .badge-upstream {
    font-size: 10px;
    padding: 1px 5px;
    border-radius: 3px;
    background: #22242a;
    color: #8b8f98;
  }

  .badge-head {
    font-size: 10px;
    padding: 1px 5px;
    border-radius: 3px;
    background: #1f2a3d;
    color: #6ea8ff;
    font-weight: 600;
  }

  .empty-text {
    padding: 24px;
    text-align: center;
    color: #8b8f98;
    font-size: 12px;
  }

  .modal-footer {
    height: 50px;
    padding: 0 16px;
    background: #18191d;
    border-top: 1px solid #2a2c32;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    flex-shrink: 0;
  }

  .btn {
    height: 32px;
    padding: 0 14px;
    border-radius: 6px;
    font-size: 12.5px;
    cursor: pointer;
    font-weight: 500;
    border: none;
    transition: background 0.15s;
  }

  .btn-secondary {
    background: #23252b;
    border: 1px solid #2c2e34;
    color: #b9bcc3;
  }

  .btn-secondary:hover:not(:disabled) {
    background: #2a2c32;
    color: #e6e7ea;
  }

  .btn-primary {
    background: #2a4b8d;
    color: #e6efff;
  }

  .btn-primary:hover:not(:disabled) {
    background: #345ca8;
  }

  .btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
</style>
