<script lang="ts">
  import { onMount } from 'svelte';
  import { gitStore } from './git.svelte';
  import { api } from '../../lib/api';
  import type { GitConflictFile, GitConflictChoice } from '../../lib/api';

  let { onClose } = $props<{
    onClose?: () => void;
  }>();

  let selectedFileIdx = $state<number>(0);
  let currentBlockIdx = $state<number>(0);

  let conflictFiles = $derived(gitStore.conflicts);
  let currentFile = $derived<GitConflictFile | null>(
    conflictFiles[selectedFileIdx] ?? null
  );

  let currentBlock = $derived(
    currentFile && currentFile.blocks.length > 0
      ? currentFile.blocks[currentBlockIdx] ?? currentFile.blocks[0]
      : null
  );

  let editableContent = $state<string>('');

  $effect(() => {
    if (currentFile) {
      editableContent = currentFile.merged;
      currentBlockIdx = 0;
    }
  });

  onMount(async () => {
    await gitStore.loadConflicts();
  });

  function selectFile(idx: number) {
    selectedFileIdx = idx;
    currentBlockIdx = 0;
    if (conflictFiles[idx]) {
      editableContent = conflictFiles[idx].merged;
    }
  }

  async function handleResolveChoice(choice: GitConflictChoice) {
    if (!currentFile || currentFile.blocks.length === 0) return;
    try {
      const resolved = await api.gitResolveBlock(
        editableContent,
        currentBlockIdx,
        choice
      );
      editableContent = resolved;

      // Move to next block if available
      if (currentBlockIdx < currentFile.blocks.length - 1) {
        currentBlockIdx++;
      }
    } catch (e: any) {
      gitStore.showToast(`Gagal resolve block: ${e}`, { type: 'error' });
    }
  }

  async function handleMarkResolved() {
    if (!currentFile) return;
    try {
      await api.gitConflictWrite(gitStore.root, currentFile.path, editableContent);
      await gitStore.stageFiles([currentFile.path]);
      gitStore.showToast(`${currentFile.path} ditandai resolved`, { type: 'success' });
      await gitStore.loadConflicts();
      await gitStore.loadOpState();
    } catch (e: any) {
      gitStore.showToast(`Error saving resolved file: ${e}`, { type: 'error' });
    }
  }

  async function handleContinue() {
    try {
      await gitStore.opContinue();
      if (onClose) onClose();
    } catch (e: any) {
      // handled
    }
  }

  async function handleAbort() {
    try {
      await gitStore.opAbort();
      if (onClose) onClose();
    } catch (e: any) {
      // handled
    }
  }

  function handlePrevBlock() {
    if (currentBlockIdx > 0) currentBlockIdx--;
  }

  function handleNextBlock() {
    if (currentFile && currentBlockIdx < currentFile.blocks.length - 1) {
      currentBlockIdx++;
    }
  }

  let opName = $derived(
    gitStore.opState?.kind === 'rebase'
      ? 'rebase'
      : gitStore.opState?.kind === 'merge'
      ? 'merge'
      : gitStore.opState?.kind === 'cherryPick'
      ? 'cherry-pick'
      : gitStore.opState?.kind === 'revert'
      ? 'revert'
      : 'operasi'
  );

  let totalConflicts = $derived(
    conflictFiles.reduce((acc, f) => acc + (f.blocks.length || 1), 0)
  );
</script>

<div class="conflict-view">
  <!-- Top Bar matching Conflict.html -->
  <div class="conflict-top-bar">
    <span class="brand-title">Conflict Resolver</span>
    <span class="divider">|</span>
    <span class="op-status">
      {#if gitStore.opState?.kind === 'merge'}
        merging <strong>{gitStore.opState.headName || 'upstream'}</strong> → {gitStore.branch?.head || 'current'}
      {:else if gitStore.opState?.kind === 'rebase'}
        rebasing {gitStore.branch?.head || 'current'} onto {gitStore.opState.ontoName || 'target'}
      {:else}
        resolving {opName} conflicts
      {/if}
    </span>

    <div class="spacer"></div>

    <button class="top-btn abort" onclick={handleAbort}>
      Abort {opName}
    </button>

    <button
      class="top-btn continue"
      onclick={handleContinue}
      disabled={conflictFiles.length > 0 && conflictFiles.some((f) => f.blocks.length > 0)}
    >
      Continue {opName}
      {#if conflictFiles.length > 0}
        ({conflictFiles.length} files left)
      {/if}
    </button>

    {#if onClose}
      <button class="top-btn close" onclick={onClose} title="Close Conflict View">
        ✕
      </button>
    {/if}
  </div>

  <div class="conflict-body">
    <!-- Left Files Sidebar (240px) -->
    <div class="conflict-sidebar">
      <div class="sidebar-header">
        CONFLICTS · {conflictFiles.length} FILES
      </div>

      <div class="files-list">
        {#if conflictFiles.length === 0}
          <div class="empty-files">Semua konflik telah terselesaikan! ✓</div>
        {:else}
          {#each conflictFiles as f, idx}
            {@const isSelected = selectedFileIdx === idx}
            {@const hasBlocks = f.blocks.length > 0}
            <button
              class="file-item"
              class:selected={isSelected}
              onclick={() => selectFile(idx)}
            >
              <span class="file-name" title={f.path}>{f.path.split('/').pop()}</span>
              {#if hasBlocks}
                <span class="conflict-count">{f.blocks.length} conflict{f.blocks.length > 1 ? 's' : ''}</span>
              {:else}
                <span class="resolved-badge">resolved</span>
              {/if}
            </button>
          {/each}
        {/if}
      </div>

      <!-- Legend -->
      <div class="legend-box">
        <div class="legend-row">
          <span class="dot yours"></span>
          <span>Yours · {gitStore.branch?.head || 'HEAD'}</span>
        </div>
        <div class="legend-row">
          <span class="dot theirs"></span>
          <span>Theirs · {gitStore.opState?.ontoName || 'incoming'}</span>
        </div>
        <div class="legend-row">
          <span class="dot suggested"></span>
          <span>Suggested (Fase 5)</span>
        </div>
      </div>

      {#if gitStore.toast?.backupRef}
        <div class="backup-note">
          Backup ref dibuat: <span class="mono">{gitStore.toast.backupRef}</span>
        </div>
      {/if}
    </div>

    <!-- Main Editor Area -->
    <div class="editor-main">
      {#if !currentFile}
        <div class="empty-editor">
          Tidak ada file berkonflik. Klik "Continue {opName}" untuk menyelesaikan.
        </div>
      {:else}
        <!-- Action Toolbar -->
        <div class="conflict-toolbar">
          <span class="current-file-name">{currentFile.path}</span>
          {#if currentFile.blocks.length > 0}
            <span class="block-info">
              conflict {currentBlockIdx + 1}/{currentFile.blocks.length}
              {#if currentBlock}
                · baris {currentBlock.startLine}
              {/if}
            </span>
          {/if}

          <div class="spacer"></div>

          <button
            class="action-btn yours"
            onclick={() => handleResolveChoice('ours')}
            disabled={!currentBlock}
          >
            Accept yours
          </button>

          <button
            class="action-btn theirs"
            onclick={() => handleResolveChoice('theirs')}
            disabled={!currentBlock}
          >
            Accept theirs
          </button>

          <button
            class="action-btn both"
            onclick={() => handleResolveChoice('both')}
            disabled={!currentBlock}
          >
            Both
          </button>

          <button
            class="action-btn nav"
            onclick={handlePrevBlock}
            disabled={currentBlockIdx <= 0}
            title="Previous conflict block"
          >
            ↑
          </button>
          <button
            class="action-btn nav"
            onclick={handleNextBlock}
            disabled={!currentFile || currentBlockIdx >= currentFile.blocks.length - 1}
            title="Next conflict block"
          >
            ↓
          </button>

          <button class="action-btn mark-resolved" onclick={handleMarkResolved}>
            Mark resolved
          </button>
        </div>

        <!-- 3 Columns Layout: Yours | Result | Theirs -->
        <div class="three-columns">
          <!-- Column 1: Yours -->
          <div class="column col-yours">
            <div class="column-header yours-header">
              <span class="dot yours"></span>
              <span class="col-title">Yours</span>
              <span class="col-sub">{gitStore.branch?.head || 'feature'}</span>
            </div>
            <div class="code-view mono">
              {#if currentBlock}
                {#each currentBlock.ours as line, lIdx}
                  <div class="code-line hl-yours">
                    <span class="line-num">{currentBlock.startLine + lIdx}</span>
                    <span class="line-text">{line}</span>
                  </div>
                {/each}
              {:else}
                <div class="empty-block-hint">Pilih blok konflik untuk melihat perbandingan</div>
              {/if}
            </div>
          </div>

          <!-- Column 2: Result (Editable) -->
          <div class="column col-result">
            <div class="column-header result-header">
              <span class="dot result"></span>
              <span class="col-title">Result</span>
              <span class="col-sub">editable preview</span>
            </div>

            <textarea
              class="result-textarea mono"
              bind:value={editableContent}
              placeholder="Hasil resolusi konflik..."
            ></textarea>

            <!-- Suggested Resolution Card (Fase 5 Placeholder Disabled) -->
            <div class="suggestion-card">
              <div class="suggestion-title">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2z"/>
                </svg>
                <span>Suggested resolution</span>
                <span class="phase-tag">Fase 5</span>
              </div>
              <p class="suggestion-desc">
                AI automated resolution akan hadir di Fase 5 (Agent integration).
              </p>
              <div class="suggestion-actions">
                <button class="sug-btn" disabled>Apply suggestion</button>
                <button class="sug-btn secondary" disabled>Explain</button>
              </div>
            </div>
          </div>

          <!-- Column 3: Theirs -->
          <div class="column col-theirs">
            <div class="column-header theirs-header">
              <span class="dot theirs"></span>
              <span class="col-title">Theirs</span>
              <span class="col-sub">{gitStore.opState?.ontoName || 'incoming'}</span>
            </div>
            <div class="code-view mono">
              {#if currentBlock}
                {#each currentBlock.theirs as line, lIdx}
                  <div class="code-line hl-theirs">
                    <span class="line-num">{currentBlock.startLine + lIdx}</span>
                    <span class="line-text">{line}</span>
                  </div>
                {/each}
              {:else}
                <div class="empty-block-hint">Pilih blok konflik untuk melihat perbandingan</div>
              {/if}
            </div>
          </div>
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  .conflict-view {
    flex: 1;
    display: flex;
    flex-direction: column;
    height: 100%;
    min-width: 0;
    background: #16171a;
    color: #d8d9dc;
    font-family: 'Geist', system-ui, sans-serif;
    font-size: 13px;
    overflow: hidden;
  }

  .conflict-top-bar {
    height: 46px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 0 16px;
    background: #111215;
    border-bottom: 1px solid #26282d;
    user-select: none;
  }

  .brand-title {
    font-weight: 600;
  }

  .divider {
    color: #2c2e34;
  }

  .op-status {
    color: #b9bcc3;
    font-size: 13px;
  }

  .spacer {
    flex-grow: 1;
  }

  .top-btn {
    height: 30px;
    padding: 0 12px;
    border-radius: 7px;
    font-size: 12.5px;
    cursor: pointer;
    border: none;
    transition: all 0.15s;
  }

  .top-btn.abort {
    background: transparent;
    border: 1px solid #2c2e34;
    color: #b9bcc3;
  }

  .top-btn.abort:hover {
    background: #23252b;
    color: #ffffff;
  }

  .top-btn.continue {
    background: #2a3a55;
    color: #cfe0ff;
    font-weight: 500;
  }

  .top-btn.continue:hover:not(:disabled) {
    background: #364b6e;
  }

  .top-btn.continue:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .top-btn.close {
    background: transparent;
    color: #8b8f98;
    width: 28px;
    padding: 0;
    display: grid;
    place-items: center;
  }

  .conflict-body {
    flex-grow: 1;
    display: flex;
    min-height: 0;
  }

  .conflict-sidebar {
    width: 240px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    background: #141518;
    border-right: 1px solid #26282d;
    overflow-y: auto;
  }

  .sidebar-header {
    height: 40px;
    display: flex;
    align-items: center;
    padding: 0 14px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.8px;
    color: #8b8f98;
    border-bottom: 1px solid #222428;
  }

  .files-list {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow-y: auto;
  }

  .file-item {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 30px;
    padding: 0 14px;
    background: transparent;
    border: none;
    color: #d8d9dc;
    text-align: left;
    cursor: pointer;
    font-size: 12.5px;
    transition: background 0.1s;
  }

  .file-item:hover {
    background: #1a1c22;
  }

  .file-item.selected {
    background: #1f2a3d;
    color: #cfe0ff;
    font-weight: 500;
  }

  .file-name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .conflict-count {
    font-size: 11px;
    color: #f07a74;
  }

  .resolved-badge {
    font-size: 11px;
    color: #7fc98f;
  }

  .legend-box {
    margin: 14px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    font-size: 12px;
    color: #8b8f98;
  }

  .legend-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .dot {
    width: 8px;
    height: 8px;
    border-radius: 2px;
  }

  .dot.yours { background: #6ea8ff; }
  .dot.theirs { background: #7fc98f; }
  .dot.suggested { background: #e8b45a; }
  .dot.result { background: #e8b45a; }

  .backup-note {
    margin: 0 14px 14px;
    padding: 10px 12px;
    border-radius: 9px;
    background: #1a1b1f;
    border: 1px solid #2a2c32;
    font-size: 11.5px;
    line-height: 18px;
    color: #b9bcc3;
  }

  .editor-main {
    flex-grow: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    background: #1a1b1f;
  }

  .conflict-toolbar {
    height: 40px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 14px;
    background: #141518;
    border-bottom: 1px solid #26282d;
  }

  .current-file-name {
    font-weight: 500;
    font-size: 13px;
  }

  .block-info {
    color: #8b8f98;
    font-size: 12px;
  }

  .action-btn {
    height: 28px;
    padding: 0 10px;
    border-radius: 6px;
    border: 1px solid #2c2e34;
    color: #b9bcc3;
    font-size: 12px;
    cursor: pointer;
    background: transparent;
    transition: all 0.15s;
  }

  .action-btn:hover:not(:disabled) {
    background: #23252b;
    color: #ffffff;
    border-color: #3e4149;
  }

  .action-btn:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }

  .action-btn.yours:hover:not(:disabled) {
    background: #1f2a3d;
    color: #6ea8ff;
    border-color: #3a4f75;
  }

  .action-btn.theirs:hover:not(:disabled) {
    background: #1a2a20;
    color: #7fc98f;
    border-color: #2e4d35;
  }

  .action-btn.mark-resolved {
    background: #232d3d;
    color: #cfe0ff;
    border-color: #3a4f75;
    font-weight: 500;
  }

  .three-columns {
    flex-grow: 1;
    display: flex;
    min-height: 0;
  }

  .column {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    border-right: 1px solid #26282d;
  }

  .column:last-child {
    border-right: none;
  }

  .col-result {
    flex: 1.25;
    background: #18191c;
  }

  .column-header {
    height: 34px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 14px;
    background: #141518;
    border-bottom: 1px solid #26282d;
    font-size: 12px;
  }

  .col-title {
    font-weight: 500;
    color: #e6e7ea;
  }

  .col-sub {
    color: #8b8f98;
    font-size: 11.5px;
  }

  .code-view {
    flex: 1;
    overflow-y: auto;
    padding: 8px 0;
    font-size: 12.5px;
    line-height: 22px;
  }

  .code-line {
    display: flex;
    align-items: center;
    white-space: pre;
    height: 22px;
  }

  .code-line.hl-yours {
    background: #1a2233;
    box-shadow: inset 3px 0 #6ea8ff;
  }

  .code-line.hl-theirs {
    background: #1a2a20;
    box-shadow: inset 3px 0 #7fc98f;
  }

  .line-num {
    display: inline-block;
    width: 44px;
    flex-shrink: 0;
    text-align: right;
    padding-right: 14px;
    color: #5b5f68;
    user-select: none;
  }

  .line-text {
    flex: 1;
    padding-right: 8px;
  }

  .result-textarea {
    flex: 1;
    width: 100%;
    box-sizing: border-box;
    padding: 12px;
    background: #16171a;
    border: none;
    color: #d8d9dc;
    font-size: 12.5px;
    line-height: 22px;
    resize: none;
    outline: none;
  }

  .suggestion-card {
    margin: 8px 12px 12px;
    padding: 10px 12px;
    border: 1px solid #4a3d22;
    background: #1f1b12;
    border-radius: 9px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .suggestion-title {
    display: flex;
    align-items: center;
    gap: 6px;
    color: #f0cf8e;
    font-weight: 500;
    font-size: 12px;
  }

  .phase-tag {
    margin-left: auto;
    font-size: 10px;
    padding: 1px 5px;
    border-radius: 4px;
    background: #2e2717;
    color: #e8b45a;
    border: 1px solid #4a3d22;
  }

  .suggestion-desc {
    font-size: 11.5px;
    line-height: 16px;
    color: #c9c1ad;
    margin: 0;
  }

  .suggestion-actions {
    display: flex;
    gap: 6px;
    margin-top: 4px;
  }

  .sug-btn {
    height: 26px;
    padding: 0 10px;
    border-radius: 5px;
    font-size: 11.5px;
    border: 1px solid #4a3d22;
    background: #2e2717;
    color: #f0cf8e;
    opacity: 0.45;
    cursor: not-allowed;
  }

  .empty-editor, .empty-files, .empty-block-hint {
    padding: 32px;
    text-align: center;
    color: #8b8f98;
    font-size: 13px;
  }

  .mono {
    font-family: 'JetBrains Mono', monospace;
  }
</style>
