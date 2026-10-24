<script lang="ts">
  import { onMount } from 'svelte';
  import { api, type GitCompareResult, type GitCompareFile } from '../../lib/api';
  import type { GitDiffFile } from './types';
  import DiffView from './DiffView.svelte';

  let {
    root = '',
    baseBranch = 'HEAD',
    targetBranch = '',
    scopePath = '',
    title = '',
    onclose = () => {},
  }: {
    root: string;
    baseBranch?: string;
    targetBranch: string;
    scopePath?: string;
    title?: string;
    onclose: () => void;
  } = $props();

  let loading = $state(true);
  let errorMsg = $state<string | null>(null);
  let compareResult = $state<GitCompareResult | null>(null);
  let filterText = $state('');
  let selectedFileIndex = $state(0);

  let currentDiffFile = $state<GitDiffFile | null>(null);
  let loadingDiff = $state(false);

  // Switcher tabs ala Android Studio: 'commits' vs 'files'
  let activeMainTab = $state<'commits' | 'files'>('commits');
  // Sub-toggle in Commits tab: 'incoming' vs 'outgoing'
  let activeCommitTab = $state<'incoming' | 'outgoing'>('incoming');

  let allFiles = $derived(compareResult?.files || []);
  let incomingCommits = $derived(compareResult?.incomingCommits || []);
  let outgoingCommits = $derived(compareResult?.outgoingCommits || []);
  let totalCommitsCount = $derived(incomingCommits.length + outgoingCommits.length);

  let filteredFiles = $derived(
    allFiles.filter((f) => f.path.toLowerCase().includes(filterText.toLowerCase()))
  );
  let currentFile = $derived<GitCompareFile | null>(
    filteredFiles[selectedFileIndex] || null
  );

  let displayedCommits = $derived(
    activeCommitTab === 'incoming' ? incomingCommits : outgoingCommits
  );

  async function loadCompareData() {
    if (!root || !targetBranch) return;
    loading = true;
    errorMsg = null;
    try {
      const res = await api.gitCompareBranch(root, baseBranch, targetBranch, scopePath || undefined);
      compareResult = res;
      selectedFileIndex = 0;
      if (res.files.length > 0) {
        await loadDiffForFile(res.files[0]);
      }
    } catch (e: any) {
      errorMsg = `Failed to compare branches: ${e?.message || e}`;
    } finally {
      loading = false;
    }
  }

  async function loadDiffForFile(file: GitCompareFile) {
    if (!root || !file) return;
    loadingDiff = true;
    try {
      const diffs = await api.gitDiffBranch(root, file.path, targetBranch, baseBranch);
      currentDiffFile = diffs && diffs.length > 0 ? diffs[0] : null;
    } catch {
      currentDiffFile = null;
    } finally {
      loadingDiff = false;
    }
  }

  function handleSelectFile(idx: number) {
    selectedFileIndex = idx;
    const file = filteredFiles[idx];
    if (file) {
      loadDiffForFile(file);
    }
  }

  function handlePrev() {
    if (filteredFiles.length === 0) return;
    const nextIdx = (selectedFileIndex - 1 + filteredFiles.length) % filteredFiles.length;
    handleSelectFile(nextIdx);
  }

  function handleNext() {
    if (filteredFiles.length === 0) return;
    const nextIdx = (selectedFileIndex + 1) % filteredFiles.length;
    handleSelectFile(nextIdx);
  }

  function getStatusColor(status: string): string {
    switch (status) {
      case 'A':
        return '#7fc98f';
      case 'M':
        return '#6ea8ff';
      case 'D':
        return '#f07a74';
      case 'R':
        return '#e8b45a';
      default:
        return '#8b8f98';
    }
  }

  function formatCommitDate(timestamp: number): string {
    if (!timestamp) return '';
    const d = new Date(timestamp * 1000);
    const pad = (n: number) => String(n).padStart(2, '0');
    const year = d.getFullYear();
    const month = pad(d.getMonth() + 1);
    const day = pad(d.getDate());
    const hours = pad(d.getHours());
    const mins = pad(d.getMinutes());
    return `${year}-${month}-${day} ${hours}:${mins}`;
  }

  onMount(() => {
    loadCompareData();
  });

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      onclose();
    } else if (activeMainTab === 'files' && e.key === 'ArrowUp' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handlePrev();
    } else if (activeMainTab === 'files' && e.key === 'ArrowDown' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleNext();
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="compare-modal-backdrop" onclick={onclose} role="presentation">
  <div class="compare-modal" onclick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" tabindex="-1">
    <!-- Top Header -->
    <div class="compare-header">
      <div class="header-info">
        <span class="compare-title">{title || 'Compare with Branch'}</span>
        <span class="branch-pill base" title="Base (Current) Branch">{baseBranch}</span>
        <span class="vs-text">↔</span>
        <span class="branch-pill target" title="Target Branch">{targetBranch}</span>
        {#if scopePath}
          <span class="scope-pill" title="Scoped to path">📁 {scopePath}</span>
        {/if}

        <div class="header-badges">
          <span class="badge-tag incoming" title="Incoming commits (+ahead in target)">
            ↓ {incomingCommits.length} Incoming
          </span>
          <span class="badge-tag outgoing" title="Outgoing commits (+ahead in base)">
            ↑ {outgoingCommits.length} Outgoing
          </span>
          <span class="badge-tag files-tag" title="Changed files">
            {allFiles.length} Files
          </span>
        </div>
      </div>

      <!-- Main Tabs Switcher ala Android Studio -->
      <div class="main-tabs">
        <button
          class="tab-btn"
          class:active={activeMainTab === 'commits'}
          onclick={() => (activeMainTab = 'commits')}
        >
          Commits ({totalCommitsCount})
        </button>
        <button
          class="tab-btn"
          class:active={activeMainTab === 'files'}
          onclick={() => (activeMainTab = 'files')}
        >
          Files ({allFiles.length})
        </button>
      </div>

      <button class="close-btn" onclick={onclose} title="Close (Esc)">✕</button>
    </div>

    <!-- Main Content Body -->
    <div class="compare-body">
      {#if loading}
        <div class="loading-state">
          <div class="spinner"></div>
          <span>Comparing branches…</span>
        </div>
      {:else if errorMsg}
        <div class="error-banner">{errorMsg}</div>
      {:else if activeMainTab === 'commits'}
        <!-- Commits View ala Android Studio -->
        <div class="commits-view">
          <div class="commits-toolbar">
            <div class="segmented-control">
              <button
                class="seg-btn"
                class:active={activeCommitTab === 'incoming'}
                onclick={() => (activeCommitTab = 'incoming')}
              >
                ↓ Incoming ({incomingCommits.length})
              </button>
              <button
                class="seg-btn"
                class:active={activeCommitTab === 'outgoing'}
                onclick={() => (activeCommitTab = 'outgoing')}
              >
                ↑ Outgoing ({outgoingCommits.length})
              </button>
            </div>
            <div class="commits-scope-desc">
              {#if activeCommitTab === 'incoming'}
                <span>Commits in <code>{targetBranch}</code> not in <code>{baseBranch}</code></span>
              {:else}
                <span>Commits in <code>{baseBranch}</code> not in <code>{targetBranch}</code></span>
              {/if}
            </div>
          </div>

          <div class="commits-list">
            {#if displayedCommits.length === 0}
              <div class="empty-commits">
                {activeCommitTab === 'incoming' ? 'No incoming commits' : 'No outgoing commits'}
              </div>
            {:else}
              {#each displayedCommits as commit (commit.sha)}
                <div class="commit-row">
                  <span class="commit-sha" title={commit.sha}>{commit.shortSha || commit.sha.slice(0, 7)}</span>
                  <span class="commit-subject" title={commit.subject}>{commit.subject}</span>
                  <span class="commit-author" title={commit.authorEmail}>{commit.authorName}</span>
                  <span class="commit-time">{formatCommitDate(commit.authorTime)}</span>
                </div>
              {/each}
            {/if}
          </div>
        </div>
      {:else}
        <!-- Files View: Left Files List, Right Diff -->
        <div class="files-sidebar">
          <div class="sidebar-header">
            <div class="summary-line">
              <span class="count-badge">{filteredFiles.length} files changed</span>
              {#if compareResult}
                <span class="diff-stats">
                  <span class="added">+{compareResult.totalAdded}</span>
                  <span class="removed">−{compareResult.totalRemoved}</span>
                </span>
              {/if}
            </div>

            <input
              type="text"
              class="filter-input"
              placeholder="Filter changed files…"
              bind:value={filterText}
            />
          </div>

          <div class="file-list">
            {#if filteredFiles.length === 0}
              <div class="empty-list">No matching changed files</div>
            {:else}
              {#each filteredFiles as f, idx (f.path)}
                {@const isSelected = idx === selectedFileIndex}
                <div
                  class="file-item"
                  class:selected={isSelected}
                  onclick={() => handleSelectFile(idx)}
                  role="button"
                  tabindex="0"
                  onkeydown={(e) => {
                    if (e.key === 'Enter') handleSelectFile(idx);
                  }}
                >
                  <span class="status-letter" style:color={getStatusColor(f.status)}>
                    {f.status}
                  </span>
                  <span class="file-path" title={f.path}>{f.path}</span>
                  <div class="item-stats">
                    {#if f.added > 0}
                      <span class="add-num">+{f.added}</span>
                    {/if}
                    {#if f.removed > 0}
                      <span class="rem-num">−{f.removed}</span>
                    {/if}
                  </div>
                </div>
              {/each}
            {/if}
          </div>
        </div>

        <!-- Right Pane: Diff View -->
        <div class="diff-pane">
          <div class="diff-pane-header">
            <div class="file-title-wrap">
              <span class="active-file-name">
                {currentFile ? currentFile.path : 'Select a file'}
              </span>
              {#if currentFile?.binary}
                <span class="binary-tag">Binary</span>
              {/if}
            </div>

            <div class="nav-controls">
              <button
                class="nav-btn"
                onclick={handlePrev}
                disabled={filteredFiles.length <= 1}
                title="Previous file (⌘↑)"
              >
                ◀ Prev
              </button>
              <span class="file-index-indicator">
                {filteredFiles.length > 0 ? `${selectedFileIndex + 1} of ${filteredFiles.length}` : '0 of 0'}
              </span>
              <button
                class="nav-btn"
                onclick={handleNext}
                disabled={filteredFiles.length <= 1}
                title="Next file (⌘↓)"
              >
                Next ▶
              </button>
            </div>
          </div>

          <div class="diff-viewport">
            {#if loadingDiff}
              <div class="loading-diff">Loading diff…</div>
            {:else if currentFile?.binary}
              <div class="binary-msg">Binary file changed. Diff preview not available.</div>
            {:else if currentDiffFile}
              <DiffView diffFile={currentDiffFile} filePath={currentFile?.path || ''} />
            {:else}
              <div class="empty-diff">No differences found for this file.</div>
            {/if}
          </div>
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  .compare-modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.65);
    display: grid;
    place-items: center;
    z-index: 1000;
  }
  .compare-modal {
    width: 90vw;
    max-width: 1200px;
    height: 85vh;
    background: var(--p-bg-elevated, #35373c);
    border: 1px solid var(--border-default, #393b40);
    border-radius: 10px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    box-shadow: 0 20px 50px rgba(0, 0, 0, 0.5);
  }
  .compare-header {
    height: 44px;
    padding: 0 16px;
    background: var(--p-bg-surface, #26282b);
    border-bottom: 1px solid var(--border-default, #393b40);
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-shrink: 0;
    gap: 12px;
  }
  .header-info {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    overflow: hidden;
  }
  .compare-title {
    font-weight: 700;
    color: #e0e2e8;
    margin-right: 4px;
    white-space: nowrap;
  }
  .branch-pill {
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 11px;
    font-family: monospace;
    white-space: nowrap;
  }
  .branch-pill.base {
    background: var(--p-bg-workspace, #2b2d30);
    color: #8bb2ff;
    border: 1px solid var(--border-default, #393b40);
  }
  .branch-pill.target {
    background: var(--p-bg-workspace, #2b2d30);
    color: #bfa8ff;
    border: 1px solid var(--border-default, #393b40);
  }
  .scope-pill {
    background: var(--p-bg-workspace, #2b2d30);
    color: #9da1ab;
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 11px;
    border: 1px solid var(--border-default, #393b40);
    white-space: nowrap;
  }
  .vs-text {
    color: #8b8f98;
  }
  .header-badges {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-left: 8px;
  }
  .badge-tag {
    font-size: 10.5px;
    font-weight: 600;
    padding: 2px 6px;
    border-radius: 4px;
    white-space: nowrap;
  }
  .badge-tag.incoming {
    background: rgba(127, 201, 143, 0.15);
    color: #7fc98f;
    border: 1px solid rgba(127, 201, 143, 0.3);
  }
  .badge-tag.outgoing {
    background: rgba(110, 168, 255, 0.15);
    color: #6ea8ff;
    border: 1px solid rgba(110, 168, 255, 0.3);
  }
  .badge-tag.files-tag {
    background: var(--p-bg-workspace, #2b2d30);
    color: #a8abb6;
    border: 1px solid var(--border-default, #393b40);
  }
  .main-tabs {
    display: flex;
    align-items: center;
    background: var(--p-bg-workspace, #2b2d30);
    border: 1px solid var(--border-default, #393b40);
    border-radius: 6px;
    padding: 2px;
    gap: 2px;
    flex-shrink: 0;
  }
  .tab-btn {
    background: transparent;
    border: none;
    border-radius: 4px;
    padding: 3px 10px;
    font-size: 11.5px;
    font-weight: 500;
    color: #8b8f98;
    cursor: pointer;
    transition: all 0.12s;
  }
  .tab-btn:hover {
    color: #e0e2e8;
    background: var(--p-bg-hover, #323539);
  }
  .tab-btn.active {
    background: var(--p-bg-elevated, #35373c);
    color: #e0e2e8;
    font-weight: 600;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
  }
  .close-btn {
    background: transparent;
    border: none;
    color: #8b8f98;
    font-size: 14px;
    cursor: pointer;
    padding: 4px 8px;
    border-radius: 4px;
    flex-shrink: 0;
  }
  .close-btn:hover {
    color: #ffffff;
    background: var(--p-bg-hover, #323539);
  }
  .compare-body {
    flex: 1;
    display: flex;
    min-height: 0;
    overflow: hidden;
  }
  .loading-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    width: 100%;
    gap: 12px;
    color: #8b8f98;
    font-size: 13px;
  }
  .spinner {
    width: 24px;
    height: 24px;
    border: 3px solid var(--border-default, #393b40);
    border-top-color: #6ea8ff;
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
  .error-banner {
    padding: 20px;
    color: #f07a74;
    font-size: 13px;
    text-align: center;
    width: 100%;
  }

  /* Commits Tab Styles ala Android Studio */
  .commits-view {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    background: var(--p-bg-workspace, #2b2d30);
  }
  .commits-toolbar {
    height: 42px;
    padding: 0 16px;
    background: var(--p-bg-surface, #26282b);
    border-bottom: 1px solid var(--border-default, #393b40);
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-shrink: 0;
  }
  .segmented-control {
    display: flex;
    background: var(--p-bg-workspace, #2b2d30);
    border: 1px solid var(--border-default, #393b40);
    border-radius: 5px;
    padding: 2px;
    gap: 2px;
  }
  .seg-btn {
    background: transparent;
    border: none;
    border-radius: 3px;
    padding: 3px 10px;
    font-size: 11px;
    font-weight: 500;
    color: #8b8f98;
    cursor: pointer;
    transition: all 0.1s;
  }
  .seg-btn:hover {
    color: #e0e2e8;
  }
  .seg-btn.active {
    background: var(--p-bg-elevated, #35373c);
    color: #e0e2e8;
    font-weight: 600;
  }
  .commits-scope-desc {
    font-size: 11px;
    color: #8b8f98;
  }
  .commits-scope-desc code {
    font-family: monospace;
    color: #c8cbd4;
    background: var(--p-bg-workspace, #2b2d30);
    padding: 1px 4px;
    border-radius: 3px;
    border: 1px solid var(--border-default, #393b40);
  }
  .commits-list {
    flex: 1;
    overflow-y: auto;
  }
  .commit-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 16px;
    border-bottom: 1px solid var(--border-default, #393b40);
    font-size: 12px;
    transition: background 0.1s;
  }
  .commit-row:hover {
    background: var(--p-bg-hover, #323539);
  }
  .commit-sha {
    font-family: monospace;
    font-size: 11px;
    color: #6ea8ff;
    width: 65px;
    flex-shrink: 0;
  }
  .commit-subject {
    flex: 1;
    color: #e0e2e8;
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .commit-author {
    color: #8b8f98;
    font-size: 11px;
    max-width: 160px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex-shrink: 0;
  }
  .commit-time {
    color: #6a6f7c;
    font-size: 11px;
    font-family: monospace;
    width: 120px;
    text-align: right;
    flex-shrink: 0;
  }
  .empty-commits {
    padding: 60px 20px;
    text-align: center;
    font-size: 12px;
    color: #656976;
  }

  /* Files Tab Styles */
  .files-sidebar {
    width: 320px;
    border-right: 1px solid var(--border-default, #393b40);
    display: flex;
    flex-direction: column;
    background: var(--p-bg-surface, #26282b);
    flex-shrink: 0;
  }
  .sidebar-header {
    padding: 10px 12px;
    border-bottom: 1px solid var(--border-default, #393b40);
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .summary-line {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 11px;
  }
  .count-badge {
    font-weight: 600;
    color: #8b8f98;
  }
  .diff-stats {
    display: flex;
    gap: 6px;
    font-family: monospace;
    font-weight: 600;
  }
  .diff-stats .added {
    color: #7fc98f;
  }
  .diff-stats .removed {
    color: #f07a74;
  }
  .filter-input {
    background: var(--p-bg-workspace, #2b2d30);
    border: 1px solid var(--border-default, #393b40);
    border-radius: 4px;
    padding: 5px 8px;
    font-size: 11px;
    color: #e0e2e8;
    outline: none;
  }
  .filter-input:focus {
    border-color: #569aff;
  }
  .file-list {
    flex: 1;
    overflow-y: auto;
  }
  .empty-list {
    padding: 20px 12px;
    text-align: center;
    font-size: 11px;
    color: #585c67;
  }
  .file-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    font-size: 11.5px;
    cursor: pointer;
    border-bottom: 1px solid var(--border-default, #393b40);
    transition: background 0.1s;
  }
  .file-item:hover {
    background: var(--p-bg-hover, #323539);
  }
  .file-item.selected {
    background: var(--p-bg-workspace, #2b2d30);
    border-color: var(--border-default, #393b40);
  }
  .status-letter {
    font-weight: 700;
    font-family: monospace;
    width: 12px;
    text-align: center;
  }
  .file-path {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: #c8cbd4;
  }
  .item-stats {
    display: flex;
    gap: 4px;
    font-size: 10px;
    font-family: monospace;
  }
  .add-num {
    color: #7fc98f;
  }
  .rem-num {
    color: #f07a74;
  }
  .diff-pane {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    background: var(--p-bg-workspace, #2b2d30);
  }
  .diff-pane-header {
    height: 38px;
    padding: 0 14px;
    border-bottom: 1px solid var(--border-default, #393b40);
    background: var(--p-bg-surface, #26282b);
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-shrink: 0;
  }
  .file-title-wrap {
    display: flex;
    align-items: center;
    gap: 8px;
    overflow: hidden;
  }
  .active-file-name {
    font-size: 12px;
    font-family: monospace;
    color: #e0e2e8;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .binary-tag {
    background: var(--p-bg-elevated, #35373c);
    color: #e8b45a;
    font-size: 10px;
    padding: 1px 5px;
    border-radius: 3px;
    border: 1px solid var(--border-default, #393b40);
  }
  .nav-controls {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .nav-btn {
    background: var(--p-bg-workspace, #2b2d30);
    border: 1px solid var(--border-default, #393b40);
    color: #a8abb6;
    padding: 3px 8px;
    border-radius: 4px;
    font-size: 11px;
    cursor: pointer;
  }
  .nav-btn:hover:not(:disabled) {
    background: var(--p-bg-hover, #323539);
    color: #ffffff;
  }
  .nav-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .file-index-indicator {
    font-size: 11px;
    color: #8b8f98;
  }
  .diff-viewport {
    flex: 1;
    overflow: auto;
    position: relative;
  }
  .loading-diff, .binary-msg, .empty-diff {
    padding: 40px;
    text-align: center;
    font-size: 12px;
    color: #656976;
  }
</style>
