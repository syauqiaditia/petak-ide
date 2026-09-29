<script lang="ts">
  import { onMount } from 'svelte';
  import { api, type LocalHistoryEntry } from '../lib/api';
  import DiffView from '../features/git/DiffView.svelte';
  import { createDiffFileFromTexts } from './diffUtils';
  import type { GitDiffFile } from '../features/git/types';

  let {
    folderPath = '',
    relPath = '',
    absPath = '',
    isDir = false,
    onclose,
    onrevert,
  } = $props<{
    folderPath: string;
    relPath: string;
    absPath: string;
    isDir?: boolean;
    onclose: () => void;
    onrevert?: (revertedPath: string) => void;
  }>();

  let entries = $state<LocalHistoryEntry[]>([]);
  let loading = $state(true);
  let filterText = $state('');
  let selectedIdx = $state(0);
  let snapshotContent = $state<string>('');
  let currentContent = $state<string>('');
  let diffFile = $state<GitDiffFile | null>(null);
  let showDeleted = $state(false);

  // Label input modal
  let labelModalOpen = $state(false);
  let labelInput = $state('');
  let isSavingLabel = $state(false);
  let isReverting = $state(false);

  const fileName = $derived(relPath.split('/').filter(Boolean).pop() || relPath);

  function formatTime(tsMs: number): string {
    const d = new Date(tsMs);
    const h = String(d.getHours()).padStart(2, '0');
    const m = String(d.getMinutes()).padStart(2, '0');
    return `${h}:${m}`;
  }

  function getBadgeLabel(entry: LocalHistoryEntry): { label: string; color: string } {
    if (entry.label) {
      return { label: `🏷 ${entry.label}`, color: '#e8b45a' };
    }
    switch (entry.kind) {
      case 'save':
      case 'user_save':
        return { label: 'User Save', color: '#6ea8ff' };
      case 'external':
      case 'external_change':
        return { label: 'External Change', color: '#8b8f98' };
      case 'before_rollback':
        return { label: 'Before Rollback', color: '#f0a6a2' };
      default:
        return { label: entry.kind || 'Snapshot', color: '#7fc98f' };
    }
  }

  const filteredEntries = $derived(
    entries.filter((e) => {
      const q = filterText.toLowerCase();
      if (!q) return true;
      if (e.label?.toLowerCase().includes(q)) return true;
      if (e.kind?.toLowerCase().includes(q)) return true;
      if (e.id.toLowerCase().includes(q)) return true;
      return false;
    })
  );

  const selectedEntry = $derived(filteredEntries[selectedIdx] ?? null);

  async function loadHistory() {
    loading = true;
    try {
      entries = await api.lhList(folderPath, relPath);
      if (!isDir && absPath) {
        try {
          currentContent = await api.readFile(absPath);
        } catch (e) {
          currentContent = '';
        }
      }
      if (entries.length > 0) {
        selectedIdx = 0;
        await loadSnapshot(entries[0]);
      }
    } catch (e) {
      console.error('Failed to load local history:', e);
    } finally {
      loading = false;
    }
  }

  async function loadSnapshot(entry: LocalHistoryEntry) {
    if (!entry) return;
    try {
      snapshotContent = await api.lhRead(folderPath, entry.id);
      if (!isDir) {
        diffFile = createDiffFileFromTexts(
          `Local History (${formatTime(entry.ts_ms)})`,
          `Current (${fileName})`,
          snapshotContent,
          currentContent
        );
      }
    } catch (e) {
      console.error('Failed to read snapshot blob:', e);
    }
  }

  $effect(() => {
    if (selectedEntry) {
      loadSnapshot(selectedEntry);
    }
  });

  onMount(() => {
    loadHistory();
  });

  async function handlePutLabel() {
    if (!selectedEntry || !labelInput.trim()) return;
    isSavingLabel = true;
    try {
      await api.lhLabel(folderPath, selectedEntry.path || relPath, labelInput.trim());
      labelModalOpen = false;
      labelInput = '';
      await loadHistory();
    } catch (e) {
      console.error('Failed to put label:', e);
    } finally {
      isSavingLabel = false;
    }
  }

  async function handleRevert() {
    if (!selectedEntry) return;
    const ok = window.confirm(`Revert ${fileName} to snapshot from ${formatTime(selectedEntry.ts_ms)}?`);
    if (!ok) return;

    isReverting = true;
    try {
      await api.lhRevert(folderPath, selectedEntry.id);
      onrevert?.(absPath);
      onclose();
    } catch (e) {
      console.error('Failed to revert:', e);
      alert('Failed to revert: ' + String(e));
    } finally {
      isReverting = false;
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (labelModalOpen) {
        labelModalOpen = false;
      } else {
        onclose();
      }
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="modal-backdrop" onclick={onclose} role="presentation">
  <div class="modal-box" onclick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" tabindex="-1">
    <!-- Header -->
    <div class="modal-header">
      <span class="modal-title">Local History — {fileName}</span>
      <span class="modal-path">{relPath}</span>
      <button class="modal-close-btn" onclick={onclose} title="Close (Esc)">✕</button>
    </div>

    <!-- Body (2 columns) -->
    <div class="modal-body-split">
      <!-- Left Column: History list (320px) -->
      <div class="history-sidebar">
        <div class="search-box">
          <input
            bind:value={filterText}
            class="filter-input"
            placeholder="Filter history…"
          />
        </div>

        {#if loading}
          <div class="empty-state">Loading history…</div>
        {:else if filteredEntries.length === 0}
          <div class="empty-state">No local history recorded yet</div>
        {:else}
          <div class="entry-list">
            {#each filteredEntries as entry, idx}
              {@const badge = getBadgeLabel(entry)}
              {@const isSelected = selectedIdx === idx}
              <button
                class="entry-item"
                class:selected={isSelected}
                onclick={() => (selectedIdx = idx)}
              >
                <div class="entry-row-top">
                  <span class="entry-time">{formatTime(entry.ts_ms)}</span>
                  <span class="entry-badge" style="color: {badge.color};">
                    {badge.label}
                  </span>
                </div>
                <div class="entry-id">
                  {entry.id.slice(0, 8)}
                </div>
              </button>
            {/each}
          </div>
        {/if}
      </div>

      <!-- Right Column: DiffView (or folder list) -->
      <div class="diff-container">
        {#if isDir}
          <div class="dir-history-view">
            <div class="dir-header">
              <span>Directory Snapshot</span>
              <label class="toggle-deleted">
                <input type="checkbox" bind:checked={showDeleted} />
                <span>Show deleted files</span>
              </label>
            </div>
            <div class="dir-content">
              <pre class="dir-pre">{snapshotContent || '(Directory snapshot contents)'}</pre>
            </div>
          </div>
        {:else if diffFile}
          <DiffView {diffFile} filePath={relPath} />
        {:else}
          <div class="empty-diff">Select a snapshot to preview diff</div>
        {/if}
      </div>
    </div>

    <!-- Footer -->
    <div class="modal-footer">
      <button
        class="btn btn-secondary"
        onclick={() => (labelModalOpen = true)}
        disabled={!selectedEntry}
      >
        🏷 Put Label…
      </button>

      <div class="footer-spacer">
        {#if selectedEntry}
          <span class="snapshot-info">
            Snapshot: {selectedEntry.id.slice(0, 10)} · {formatTime(selectedEntry.ts_ms)}
          </span>
        {/if}
      </div>

      <button
        class="btn btn-revert"
        onclick={handleRevert}
        disabled={!selectedEntry || isReverting}
      >
        {isReverting ? 'Reverting…' : 'Revert'}
      </button>
      <button class="btn btn-secondary" onclick={onclose}>Close</button>
    </div>
  </div>

  <!-- Put Label Dialog Sub-modal -->
  {#if labelModalOpen}
    <div class="label-submodal-backdrop" onclick={() => (labelModalOpen = false)} role="presentation">
      <div class="label-submodal" onclick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" tabindex="-1">
        <div class="submodal-title">Put Label on Snapshot</div>
        <input
          bind:value={labelInput}
          class="submodal-input"
          placeholder="e.g. before refactoring auth"
          autofocus
          onkeydown={(e) => {
            if (e.key === 'Enter') handlePutLabel();
            if (e.key === 'Escape') labelModalOpen = false;
          }}
        />
        <div class="submodal-footer">
          <button class="btn btn-secondary" onclick={() => (labelModalOpen = false)}>Cancel</button>
          <button class="btn btn-primary" onclick={handlePutLabel} disabled={isSavingLabel || !labelInput.trim()}>
            {isSavingLabel ? 'Saving…' : 'Save Label'}
          </button>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.7);
    backdrop-filter: blur(2px);
    z-index: 1100;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .modal-box {
    width: 960px;
    height: 620px;
    background: #1c1d22;
    border: 1px solid #34363d;
    border-radius: 10px;
    box-shadow: 0 24px 60px rgba(0, 0, 0, 0.7);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    color: #d8d9dc;
    font-family: 'Geist', system-ui, -apple-system, sans-serif;
  }

  .modal-header {
    height: 48px;
    padding: 0 16px;
    display: flex;
    align-items: center;
    gap: 12px;
    border-bottom: 1px solid #2a2c32;
    flex-shrink: 0;
  }

  .modal-title {
    font-size: 14px;
    font-weight: 600;
    color: #e6efff;
  }

  .modal-path {
    font-size: 12px;
    color: #8b8f98;
    font-family: 'JetBrains Mono', monospace;
  }

  .modal-close-btn {
    margin-left: auto;
    color: #8b8f98;
    background: none;
    border: none;
    font-size: 14px;
    cursor: pointer;
    padding: 4px;
    border-radius: 4px;
  }

  .modal-close-btn:hover {
    color: #d8d9dc;
    background: #26282d;
  }

  .modal-body-split {
    flex: 1;
    display: flex;
    overflow: hidden;
  }

  .history-sidebar {
    width: 320px;
    border-right: 1px solid #2a2c32;
    background: #16171a;
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
  }

  .search-box {
    padding: 10px;
    border-bottom: 1px solid #26282d;
  }

  .filter-input {
    width: 100%;
    height: 28px;
    background: #141518;
    border: 1px solid #2c2e34;
    border-radius: 5px;
    padding: 0 8px;
    color: #d8d9dc;
    font-size: 12px;
    outline: none;
    box-sizing: border-box;
  }

  .entry-list {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    padding: 4px;
    gap: 2px;
  }

  .entry-item {
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: 8px 10px;
    border-radius: 6px;
    background: transparent;
    border: none;
    color: #d8d9dc;
    cursor: pointer;
    text-align: left;
    transition: background 0.1s;
    width: 100%;
  }

  .entry-item:hover {
    background: #1f2025;
  }

  .entry-item.selected {
    background: #232d3f;
    border: 1px solid #354766;
  }

  .entry-row-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
  }

  .entry-time {
    font-size: 12.5px;
    font-weight: 600;
    color: #e6efff;
  }

  .entry-badge {
    font-size: 11px;
    font-weight: 500;
  }

  .entry-id {
    font-size: 10.5px;
    font-family: 'JetBrains Mono', monospace;
    color: #8b8f98;
  }

  .diff-container {
    flex: 1;
    overflow: hidden;
    background: #1a1b1f;
    display: flex;
    flex-direction: column;
  }

  .empty-diff,
  .empty-state {
    padding: 32px;
    text-align: center;
    color: #8b8f98;
    font-size: 12.5px;
  }

  .dir-history-view {
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    height: 100%;
  }

  .dir-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    color: #8b8f98;
    font-size: 12px;
  }

  .toggle-deleted {
    display: flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
  }

  .dir-content {
    flex: 1;
    background: #141518;
    border: 1px solid #26282d;
    border-radius: 6px;
    padding: 12px;
    overflow-y: auto;
  }

  .dir-pre {
    font-family: 'JetBrains Mono', monospace;
    font-size: 12px;
    color: #d8d9dc;
    margin: 0;
  }

  .modal-footer {
    height: 52px;
    padding: 0 16px;
    background: #18191d;
    border-top: 1px solid #2a2c32;
    display: flex;
    align-items: center;
    gap: 10px;
    flex-shrink: 0;
  }

  .footer-spacer {
    flex: 1;
  }

  .snapshot-info {
    font-size: 11.5px;
    color: #8b8f98;
    font-family: 'JetBrains Mono', monospace;
  }

  .btn {
    height: 30px;
    padding: 0 12px;
    border-radius: 5px;
    font-size: 12px;
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

  .btn-revert {
    background: #2a3a55;
    color: #cfe0ff;
  }

  .btn-revert:hover:not(:disabled) {
    background: #354a6e;
  }

  .btn-primary {
    background: #2a3a55;
    color: #cfe0ff;
  }

  .btn-primary:hover:not(:disabled) {
    background: #354a6e;
  }

  .btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  /* Submodal for Label */
  .label-submodal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.5);
    z-index: 1200;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .label-submodal {
    width: 380px;
    background: #22242a;
    border: 1px solid #34363d;
    border-radius: 8px;
    padding: 16px;
    box-shadow: 0 16px 40px rgba(0,0,0,0.6);
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .submodal-title {
    font-size: 13px;
    font-weight: 600;
    color: #e6efff;
  }

  .submodal-input {
    width: 100%;
    height: 30px;
    background: #141518;
    border: 1px solid #2c2e34;
    border-radius: 5px;
    padding: 0 8px;
    color: #d8d9dc;
    font-size: 12.5px;
    outline: none;
    box-sizing: border-box;
  }

  .submodal-input:focus {
    border-color: #6ea8ff;
  }

  .submodal-footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
</style>
