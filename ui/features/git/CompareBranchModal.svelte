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
    onclose = () => {},
  }: {
    root: string;
    baseBranch?: string;
    targetBranch: string;
    scopePath?: string;
    onclose: () => void;
  } = $props();

  let loading = $state(true);
  let errorMsg = $state<string | null>(null);
  let compareResult = $state<GitCompareResult | null>(null);
  let filterText = $state('');
  let selectedFileIndex = $state(0);

  let currentDiffFile = $state<GitDiffFile | null>(null);
  let loadingDiff = $state(false);

  let allFiles = $derived(compareResult?.files || []);
  let filteredFiles = $derived(
    allFiles.filter((f) => f.path.toLowerCase().includes(filterText.toLowerCase()))
  );
  let currentFile = $derived<GitCompareFile | null>(
    filteredFiles[selectedFileIndex] || null
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

  onMount(() => {
    loadCompareData();
  });

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      onclose();
    } else if (e.key === 'ArrowUp' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handlePrev();
    } else if (e.key === 'ArrowDown' && (e.metaKey || e.ctrlKey)) {
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
        <span class="compare-title">Compare with Branch</span>
        <span class="branch-pill base">{baseBranch}</span>
        <span class="vs-text">↔</span>
        <span class="branch-pill target">{targetBranch}</span>
        {#if scopePath}
          <span class="scope-pill" title="Scoped to path">📁 {scopePath}</span>
        {/if}
      </div>

      <button class="close-btn" onclick={onclose} title="Close (Esc)">✕</button>
    </div>

    <!-- Main Content: Left Files List, Right Diff -->
    <div class="compare-body">
      {#if loading}
        <div class="loading-state">
          <div class="spinner"></div>
          <span>Comparing branches…</span>
        </div>
      {:else if errorMsg}
        <div class="error-banner">{errorMsg}</div>
      {:else}
        <!-- Left Pane: Files List -->
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
    background: rgba(0, 0, 0, 0.7);
    display: grid;
    place-items: center;
    z-index: 1000;
  }
  .compare-modal {
    width: 90vw;
    max-width: 1200px;
    height: 85vh;
    background: #141518;
    border: 1px solid #2a2d36;
    border-radius: 10px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    box-shadow: 0 20px 50px rgba(0, 0, 0, 0.7);
  }
  .compare-header {
    height: 44px;
    padding: 0 16px;
    background: #191b20;
    border-bottom: 1px solid #242730;
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-shrink: 0;
  }
  .header-info {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
  }
  .compare-title {
    font-weight: 700;
    color: #e0e2e8;
    margin-right: 4px;
  }
  .branch-pill {
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 11px;
    font-family: monospace;
  }
  .branch-pill.base {
    background: #1d2535;
    color: #8bb2ff;
    border: 1px solid #2e3e5c;
  }
  .branch-pill.target {
    background: #252336;
    color: #bfa8ff;
    border: 1px solid #3c385c;
  }
  .scope-pill {
    background: #22252c;
    color: #9da1ab;
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 11px;
    border: 1px solid #2d313c;
  }
  .vs-text {
    color: #555966;
  }
  .close-btn {
    background: transparent;
    border: none;
    color: #8b8f98;
    font-size: 14px;
    cursor: pointer;
    padding: 4px 8px;
    border-radius: 4px;
  }
  .close-btn:hover {
    color: #ffffff;
    background: #262832;
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
    border: 3px solid #2d303a;
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
  .files-sidebar {
    width: 320px;
    border-right: 1px solid #242730;
    display: flex;
    flex-direction: column;
    background: #16171b;
    flex-shrink: 0;
  }
  .sidebar-header {
    padding: 10px 12px;
    border-bottom: 1px solid #22252d;
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
    background: #111215;
    border: 1px solid #24262e;
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
    border-bottom: 1px solid #1a1c22;
    transition: background 0.1s;
  }
  .file-item:hover {
    background: #1d1f25;
  }
  .file-item.selected {
    background: #232733;
    border-color: #2b3040;
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
    background: #121316;
  }
  .diff-pane-header {
    height: 38px;
    padding: 0 14px;
    border-bottom: 1px solid #22252d;
    background: #16171b;
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
    background: #2a2c35;
    color: #e8b45a;
    font-size: 10px;
    padding: 1px 5px;
    border-radius: 3px;
  }
  .nav-controls {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .nav-btn {
    background: #1e2026;
    border: 1px solid #2a2e38;
    color: #a8abb6;
    padding: 3px 8px;
    border-radius: 4px;
    font-size: 11px;
    cursor: pointer;
  }
  .nav-btn:hover:not(:disabled) {
    background: #262933;
    color: #ffffff;
  }
  .nav-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .file-index-indicator {
    font-size: 11px;
    color: #6a6f7c;
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
