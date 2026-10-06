<script lang="ts">
  import { onMount } from 'svelte';
  import { gitStore } from './git.svelte';
  import { api } from '../../lib/api';
  import type { GitConflictFile, GitConflictBlock } from '../../lib/api';

  let {
    file,
    onClose = () => {},
    onResolved = () => {},
  } = $props<{
    file: GitConflictFile;
    onClose?: () => void;
    onResolved?: () => void;
  }>();

  let editableContent = $state(file.merged);
  let isSaving = $state(false);

  // Compute remaining conflict blocks from current editableContent
  let conflictBlocks = $derived.by<GitConflictBlock[]>(() => {
    const lines = editableContent.split('\n');
    const blocks: GitConflictBlock[] = [];
    let state = 'normal';
    let startLine = 0;
    let ours: string[] = [];
    let theirs: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (state === 'normal') {
        if (line.startsWith('<<<<<<<')) {
          state = 'ours';
          startLine = i;
          ours = [];
          theirs = [];
        }
      } else if (state === 'ours') {
        if (line.startsWith('=======')) {
          state = 'theirs';
        } else if (line.startsWith('|||||||')) {
          // base section in diff3, skip
        } else {
          ours.push(line);
        }
      } else if (state === 'theirs') {
        if (line.startsWith('>>>>>>>')) {
          blocks.push({
            startLine,
            endLine: i,
            ours,
            theirs,
            base: null,
          });
          state = 'normal';
        } else {
          theirs.push(line);
        }
      }
    }
    return blocks;
  });

  let remainingCount = $derived(conflictBlocks.length);

  // Split lines for 3 columns
  let oursLines = $derived(file.ours ? file.ours.split('\n') : []);
  let theirsLines = $derived(file.theirs ? file.theirs.split('\n') : []);
  let resultLines = $derived(editableContent ? editableContent.split('\n') : []);

  let oursLabel = $derived(gitStore.currentBranch || 'Yours');
  let theirsLabel = $derived(gitStore.opState?.ontoName || 'Theirs');

  async function resolveBlock(blockIndex: number, choice: 'ours' | 'theirs') {
    try {
      const res = await api.gitResolveBlock(editableContent, blockIndex, choice);
      editableContent = res;
    } catch (e: any) {
      gitStore.showToast(`Gagal resolve blok: ${e?.message || e}`, { type: 'error' });
    }
  }

  async function handleAcceptAllOurs() {
    let content = editableContent;
    while (true) {
      const bCount = content.split('\n').filter((l: string) => l.startsWith('<<<<<<<')).length;
      if (bCount === 0) break;
      content = await api.gitResolveBlock(content, 0, 'ours');
    }
    editableContent = content;
  }

  async function handleAcceptAllTheirs() {
    let content = editableContent;
    while (true) {
      const bCount = content.split('\n').filter((l: string) => l.startsWith('<<<<<<<')).length;
      if (bCount === 0) break;
      content = await api.gitResolveBlock(content, 0, 'theirs');
    }
    editableContent = content;
  }

  async function handleApply() {
    if (isSaving) return;
    if (remainingCount > 0) {
      if (!window.confirm(`Masih ada ${remainingCount} konflik yang belum diselesaikan. Tetap simpan?`)) {
        return;
      }
    }
    isSaving = true;
    try {
      await api.gitConflictWrite(gitStore.root, file.path, editableContent);
      await gitStore.stageFiles([file.path]);
      gitStore.showToast(`${file.path} berhasil diselesaikan dan di-stage!`, { type: 'success' });
      await gitStore.loadConflicts();
      await gitStore.loadOpState();
      onResolved();
      onClose();
    } catch (e: any) {
      gitStore.showToast(`Gagal menyimpan file: ${e?.message || e}`, { type: 'error' });
    } finally {
      isSaving = false;
    }
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      onClose();
    }
  }
</script>

<svelte:window onkeydown={handleKeyDown} />

<div class="merge-modal-backdrop" role="dialog" aria-modal="true" tabindex="-1">
  <div class="merge-modal-window">
    <!-- Top Bar -->
    <div class="merge-top-bar">
      <div class="top-file-info">
        <span class="file-icon">📄</span>
        <span class="file-path-title" title={file.path}>{file.path}</span>
        <span class="conflict-badge" class:resolved={remainingCount === 0}>
          {remainingCount === 0 ? 'Semua konflik terselesaikan ✓' : `${remainingCount} konflik tersisa`}
        </span>
      </div>

      <div class="top-actions">
        <button class="btn-top-close" onclick={onClose} title="Tutup">✕</button>
      </div>
    </div>

    <!-- 3-Way Panes Header -->
    <div class="panes-header-bar">
      <div class="pane-header left">
        <span class="tag yours">Yours</span>
        <span class="branch-name">{oursLabel}</span>
      </div>
      <div class="pane-header center">
        <span class="tag result">Result</span>
        <span class="branch-name">Pratinjau / Hasil Akhir</span>
      </div>
      <div class="pane-header right">
        <span class="tag theirs">Theirs</span>
        <span class="branch-name">{theirsLabel}</span>
      </div>
    </div>

    <!-- 3-Way Editor Body -->
    <div class="panes-content-area">
      <!-- Left Column: Yours -->
      <div class="merge-column col-yours">
        <div class="code-viewport mono">
          {#each oursLines as line, idx}
            <div class="code-row">
              <span class="line-num">{idx + 1}</span>
              <span class="line-code">{line || ' '}</span>
            </div>
          {/each}
        </div>
      </div>

      <!-- Gutter 1: Yours -> Result Actions (>>) -->
      <div class="merge-gutter">
        {#each conflictBlocks as block, bIdx}
          <button
            class="gutter-arrow-btn to-right"
            onclick={() => resolveBlock(bIdx, 'ours')}
            title="Terapkan perubahan Yours ini ke Result (>>)"
          >
            &gt;&gt;
          </button>
        {/each}
      </div>

      <!-- Center Column: Result (Editable) -->
      <div class="merge-column col-result">
        <textarea
          class="result-editor mono"
          bind:value={editableContent}
          spellcheck="false"
        ></textarea>
      </div>

      <!-- Gutter 2: Result <- Theirs Actions (<<) -->
      <div class="merge-gutter">
        {#each conflictBlocks as block, bIdx}
          <button
            class="gutter-arrow-btn to-left"
            onclick={() => resolveBlock(bIdx, 'theirs')}
            title="Terapkan perubahan Theirs ini ke Result (<<)"
          >
            &lt;&lt;
          </button>
        {/each}
      </div>

      <!-- Right Column: Theirs -->
      <div class="merge-column col-theirs">
        <div class="code-viewport mono">
          {#each theirsLines as line, idx}
            <div class="code-row">
              <span class="line-num">{idx + 1}</span>
              <span class="line-code">{line || ' '}</span>
            </div>
          {/each}
        </div>
      </div>
    </div>

    <!-- Bottom Action Bar (ala Android Studio) -->
    <div class="merge-bottom-bar">
      <div class="bottom-stats">
        {#if remainingCount > 0}
          <span class="stat-pill warn">⚠️ {remainingCount} blok konflik perlu diselesaikan</span>
        {:else}
          <span class="stat-pill clean">✓ Bersih, siap disimpan ke disk</span>
        {/if}
      </div>

      <div class="bottom-buttons">
        <button class="btn-subtle" onclick={handleAcceptAllOurs} title="Ambil semua perubahan dari sisi Yours">
          Accept Left ({oursLabel})
        </button>
        <button class="btn-subtle" onclick={handleAcceptAllTheirs} title="Ambil semua perubahan dari sisi Theirs">
          Accept Right ({theirsLabel})
        </button>
        <button class="btn-secondary" onclick={onClose} disabled={isSaving}>
          Batal
        </button>
        <button
          class="btn-primary-apply"
          onclick={handleApply}
          disabled={isSaving}
        >
          {#if isSaving}
            <span class="spin">↻</span>
            <span>Menyimpan…</span>
          {:else}
            <span>Apply</span>
          {/if}
        </button>
      </div>
    </div>
  </div>
</div>

<style>
  .merge-modal-backdrop {
    position: fixed;
    inset: 0;
    z-index: 100000;
    background: rgba(10, 11, 14, 0.78);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 18px;
    user-select: none;
    -webkit-user-select: none;
    animation: fadeIn 0.15s ease-out;
  }

  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  .merge-modal-window {
    width: 100%;
    height: 100%;
    max-width: 1400px;
    max-height: 900px;
    background: #14161a;
    border: 1px solid #2a2e37;
    border-radius: 10px;
    box-shadow: 0 24px 60px rgba(0, 0, 0, 0.7);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  /* Top Bar */
  .merge-top-bar {
    height: 40px;
    padding: 0 16px;
    background: #111215;
    border-bottom: 1px solid #23262e;
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-shrink: 0;
  }

  .top-file-info {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .file-icon {
    font-size: 14px;
  }

  .file-path-title {
    font-family: 'JetBrains Mono', monospace;
    font-size: 12.5px;
    font-weight: 600;
    color: #e2e8f0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 600px;
  }

  .conflict-badge {
    font-size: 11px;
    font-weight: 600;
    padding: 2px 8px;
    border-radius: 10px;
    background: #3b1d1f;
    color: #f87171;
    border: 1px solid #7f1d1d;
  }

  .conflict-badge.resolved {
    background: #132e22;
    color: #4ade80;
    border-color: #14532d;
  }

  .btn-top-close {
    background: none;
    border: none;
    color: #8b8f98;
    cursor: pointer;
    font-size: 15px;
    padding: 4px;
  }

  .btn-top-close:hover {
    color: #ffffff;
  }

  /* Panes Header */
  .panes-header-bar {
    height: 32px;
    display: flex;
    background: #16181e;
    border-bottom: 1px solid #23262e;
    flex-shrink: 0;
  }

  .pane-header {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 14px;
    font-size: 11.5px;
  }

  .pane-header.left { border-right: 1px solid #23262e; }
  .pane-header.center {
    border-right: 1px solid #23262e;
    background: #13151a;
  }

  .tag {
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    padding: 1px 6px;
    border-radius: 4px;
  }

  .tag.yours { background: #1e293b; color: #60a5fa; }
  .tag.result { background: #1f2a24; color: #34d399; }
  .tag.theirs { background: #2d2417; color: #fbbf24; }

  .branch-name {
    color: #94a3b8;
    font-family: 'JetBrains Mono', monospace;
    font-size: 11px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Panes Body */
  .panes-content-area {
    flex: 1;
    display: flex;
    min-height: 0;
    background: #0f1115;
  }

  .merge-column {
    flex: 1;
    min-width: 0;
    height: 100%;
    overflow: auto;
    position: relative;
  }

  .col-yours { background: #101216; }
  .col-result { background: #0c0e12; }
  .col-theirs { background: #101216; }

  .code-viewport {
    padding: 8px 0;
    font-size: 12px;
    line-height: 20px;
  }

  .code-row {
    display: flex;
    padding: 0 10px;
    white-space: pre;
  }

  .code-row:hover {
    background: #181b22;
  }

  .line-num {
    width: 40px;
    color: #475569;
    font-size: 11px;
    user-select: none;
    text-align: right;
    padding-right: 12px;
    flex-shrink: 0;
  }

  .line-code {
    flex: 1;
    color: #cbd5e1;
  }

  /* Result Editor */
  .result-editor {
    width: 100%;
    height: 100%;
    background: transparent;
    border: none;
    outline: none;
    resize: none;
    padding: 8px 12px;
    font-size: 12px;
    line-height: 20px;
    color: #f1f5f9;
    white-space: pre;
    tab-size: 2;
  }

  /* Gutters */
  .merge-gutter {
    width: 38px;
    background: #13151a;
    border-left: 1px solid #1f2229;
    border-right: 1px solid #1f2229;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 8px 0;
    gap: 8px;
    flex-shrink: 0;
  }

  .gutter-arrow-btn {
    width: 28px;
    height: 22px;
    background: #1e293b;
    border: 1px solid #3b82f6;
    border-radius: 4px;
    color: #60a5fa;
    font-size: 10.5px;
    font-weight: 700;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.12s ease;
  }

  .gutter-arrow-btn:hover {
    background: #3b82f6;
    color: #ffffff;
    transform: scale(1.08);
  }

  .gutter-arrow-btn.to-left {
    border-color: #f59e0b;
    color: #fbbf24;
    background: #2c2214;
  }

  .gutter-arrow-btn.to-left:hover {
    background: #f59e0b;
    color: #ffffff;
  }

  /* Bottom Bar */
  .merge-bottom-bar {
    height: 48px;
    padding: 0 16px;
    background: #111215;
    border-top: 1px solid #23262e;
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-shrink: 0;
  }

  .stat-pill {
    font-size: 11.5px;
    font-weight: 500;
  }
  .stat-pill.warn { color: #f87171; }
  .stat-pill.clean { color: #4ade80; }

  .bottom-buttons {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .btn-subtle {
    background: #181b22;
    border: 1px solid #2a2e38;
    color: #94a3b8;
    border-radius: 6px;
    padding: 5px 12px;
    font-size: 11.5px;
    cursor: pointer;
    transition: all 0.12s ease;
  }

  .btn-subtle:hover {
    background: #232732;
    color: #e2e8f0;
  }

  .btn-secondary {
    background: #1e2128;
    border: 1px solid #2e333d;
    color: #cbd5e1;
    border-radius: 6px;
    padding: 5px 14px;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
  }

  .btn-secondary:hover:not(:disabled) {
    background: #2a2e38;
    color: #ffffff;
  }

  .btn-primary-apply {
    background: #2563eb;
    border: 1px solid #3b82f6;
    color: #ffffff;
    border-radius: 6px;
    padding: 5px 18px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 6px;
    transition: all 0.12s ease;
  }

  .btn-primary-apply:hover:not(:disabled) {
    background: #1d4ed8;
  }

  .btn-primary-apply:disabled,
  .btn-secondary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .spin {
    display: inline-block;
    animation: spin 1s infinite linear;
  }
  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
</style>
