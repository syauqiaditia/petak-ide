<script lang="ts">
  import { onMount } from 'svelte';
  import { gitStore } from './git.svelte';
  import { api } from '../../lib/api';
  import type { GitConflictFile } from '../../lib/api';
  import ThreeWayMergeModal from './ThreeWayMergeModal.svelte';

  let { onClose = () => {} } = $props<{
    onClose?: () => void;
  }>();

  let mergingFile = $state<GitConflictFile | null>(null);
  let conflictFiles = $derived(gitStore.conflicts);

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

  let headName = $derived(gitStore.currentBranch || gitStore.opState?.headName || 'current');
  let ontoName = $derived(gitStore.opState?.ontoName || 'target');

  onMount(async () => {
    await gitStore.loadConflicts();
    await gitStore.loadOpState();
  });

  async function handleAcceptYours(f: GitConflictFile) {
    if (!gitStore.root) return;
    try {
      await api.gitConflictWrite(gitStore.root, f.path, f.ours);
      await gitStore.stageFiles([f.path]);
      gitStore.showToast(`Diterima versi Yours untuk ${f.path}`, { type: 'success' });
      await gitStore.loadConflicts();
      await gitStore.loadOpState();
    } catch (e: any) {
      gitStore.showToast(`Gagal accept yours: ${e?.message || e}`, { type: 'error' });
    }
  }

  async function handleAcceptTheirs(f: GitConflictFile) {
    if (!gitStore.root) return;
    try {
      await api.gitConflictWrite(gitStore.root, f.path, f.theirs);
      await gitStore.stageFiles([f.path]);
      gitStore.showToast(`Diterima versi Theirs untuk ${f.path}`, { type: 'success' });
      await gitStore.loadConflicts();
      await gitStore.loadOpState();
    } catch (e: any) {
      gitStore.showToast(`Gagal accept theirs: ${e?.message || e}`, { type: 'error' });
    }
  }

  let isContinuing = $state(false);
  let isAborting = $state(false);

  async function handleContinue() {
    if (isContinuing) return;
    isContinuing = true;
    try {
      // 1. Pastikan semua file yang resolved sudah di-stage sebelum continue
      if (gitStore.root) {
        await api.gitStagePaths(gitStore.root, []).catch(() => {});
      }
      const res = await gitStore.opContinue();
      // 2. Jika rebase berhasil selesai sepenuhnya -> arahkan kembali ke tab log / commit
      if (res.ok) {
        gitStore.activeSubTab = 'log';
        if (onClose) onClose();
      } else {
        // Rebase berhenti di commit berikutnya (ada konflik baru pada commit selanjutnya)
        await gitStore.loadConflicts();
        await gitStore.loadOpState();
      }
    } catch {
      // handled inside gitStore
    } finally {
      isContinuing = false;
    }
  }

  async function handleAbort() {
    if (isAborting) return;
    if (!window.confirm(`Batalkan ${opName}? Seluruh perubahan rebase akan dikembalikan ke state awal.`)) {
      return;
    }
    isAborting = true;
    try {
      await gitStore.opAbort();
      gitStore.activeSubTab = 'commit';
      if (onClose) onClose();
    } catch {
      // handled inside gitStore
    } finally {
      isAborting = false;
    }
  }
</script>

<div class="conflicts-panel">
  <!-- Explanatory Header Banner (ala Android Studio Image 2) -->
  <div class="conflicts-header-card">
    <div class="header-icon-box">
      <span class="warning-triangle">⚠️</span>
    </div>
    <div class="header-text-block">
      <h3 class="header-main-title">Files Merged with Conflicts</h3>
      <p class="header-rebase-desc">
        Branch <code class="branch-pill">{headName}</code> being rebased onto <code class="branch-pill">{ontoName}</code>
        {#if gitStore.opState?.step}
          &bull; Step {gitStore.opState.step[0]}/{gitStore.opState.step[1]}
        {/if}
      </p>
      {#if gitStore.opState?.currentCommit}
        <p class="header-commit-halt">
          Rebase stopped at commit <code class="sha-pill">{gitStore.opState.currentCommit.slice(0, 8)}</code>
        </p>
      {/if}
    </div>

    <div class="header-top-actions">
      <button class="btn-abort-op" onclick={handleAbort} title="Batalkan operasi rebase">
        Abort {opName}
      </button>
    </div>
  </div>

  <!-- Conflicted Files Table (ala Android Studio Image 2) -->
  <div class="table-container">
    <div class="table-header-row">
      <div class="th col-file">File ({conflictFiles.length})</div>
      <div class="th col-side">Yours ({headName})</div>
      <div class="th col-side">Theirs ({ontoName})</div>
      <div class="th col-actions">Actions</div>
    </div>

    <div class="table-body">
      {#if conflictFiles.length === 0}
        <div class="all-resolved-state">
          <span class="big-check">✓</span>
          <h4>Semua konflik sudah terselesaikan!</h4>
          <p>Tekan tombol "Continue {opName}" di bawah untuk melanjutkan proses.</p>
        </div>
      {:else}
        {#each conflictFiles as f (f.path)}
          {@const isResolved = f.blocks.length === 0}
          <div class="table-row" class:resolved={isResolved}>
            <!-- File Path Column -->
            <div class="td col-file">
              <span class="file-icon">📄</span>
              <div class="file-name-meta">
                <span class="file-name" title={f.path}>{f.path}</span>
                {#if isResolved}
                  <span class="status-pill resolved">Resolved</span>
                {:else}
                  <span class="status-pill conflict">{f.blocks.length} conflict{f.blocks.length > 1 ? 's' : ''}</span>
                {/if}
              </div>
            </div>

            <!-- Yours Column -->
            <div class="td col-side">
              <span class="change-tag modified">Modified</span>
            </div>

            <!-- Theirs Column -->
            <div class="td col-side">
              <span class="change-tag modified">Modified</span>
            </div>

            <!-- Actions Column -->
            <div class="td col-actions">
              <button
                class="row-action-btn accept-yours"
                onclick={() => handleAcceptYours(f)}
                title="Terima seluruh perubahan dari sisi Yours"
              >
                Accept Yours
              </button>
              <button
                class="row-action-btn accept-theirs"
                onclick={() => handleAcceptTheirs(f)}
                title="Terima seluruh perubahan dari sisi Theirs"
              >
                Accept Theirs
              </button>
              <button
                class="row-action-btn merge-primary"
                onclick={() => (mergingFile = f)}
                title="Buka 3-Way Merge Tool untuk memilih manual baris per baris"
              >
                Merge…
              </button>
            </div>
          </div>
        {/each}
      {/if}
    </div>
  </div>

  <!-- Bottom Command Bar -->
  <div class="conflicts-bottom-bar">
    <div class="bottom-hints">
      {#if conflictFiles.length > 0}
        <span class="hint-warn">Pilih "Merge…" untuk memilah konflik per berkas dengan tool 3-way.</span>
      {:else}
        <span class="hint-clean">Semua berkas siap di-commit. Lanjutkan rebase sekarang.</span>
      {/if}
    </div>

    <div class="bottom-actions">
      <button class="btn-cancel" onclick={onClose}>
        Tutup
      </button>
      <button
        class="btn-continue"
        onclick={handleContinue}
        disabled={conflictFiles.length > 0 || isContinuing}
      >
        {#if isContinuing}
          ↻ Melanjutkan…
        {:else}
          Continue {opName}
        {/if}
      </button>
    </div>
  </div>
</div>

<!-- 3-Way Merge Tool Dialog (Fullscreen Modal) -->
{#if mergingFile}
  <ThreeWayMergeModal
    file={mergingFile}
    onClose={() => (mergingFile = null)}
    onResolved={() => {
      mergingFile = null;
      gitStore.loadConflicts();
      gitStore.loadOpState();
    }}
  />
{/if}

<style>
  .conflicts-panel {
    display: flex;
    flex-direction: column;
    flex: 1;
    height: 100%;
    min-height: 0;
    background: #131418;
    color: #d8d9dc;
    user-select: none;
    -webkit-user-select: none;
  }

  /* Explanatory Header Card */
  .conflicts-header-card {
    padding: 14px 18px;
    background: #181a20;
    border-bottom: 1px solid #252830;
    display: flex;
    align-items: flex-start;
    gap: 14px;
    flex-shrink: 0;
  }

  .header-icon-box {
    margin-top: 2px;
    font-size: 20px;
  }

  .header-text-block {
    flex: 1;
    min-width: 0;
  }

  .header-main-title {
    margin: 0 0 4px 0;
    font-size: 14px;
    font-weight: 700;
    color: #f1f5f9;
  }

  .header-rebase-desc {
    margin: 0 0 3px 0;
    font-size: 12px;
    color: #94a3b8;
  }

  .header-commit-halt {
    margin: 0;
    font-size: 11.5px;
    color: #cbd5e1;
  }

  .branch-pill {
    background: #1e293b;
    border: 1px solid #334155;
    color: #60a5fa;
    padding: 1px 6px;
    border-radius: 4px;
    font-family: 'JetBrains Mono', monospace;
    font-size: 11px;
    font-weight: 600;
  }

  .sha-pill {
    background: #27272a;
    color: #a1a1aa;
    padding: 1px 6px;
    border-radius: 4px;
    font-family: 'JetBrains Mono', monospace;
    font-size: 11px;
  }

  .header-top-actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .btn-abort-op {
    background: #2a1b1d;
    border: 1px solid #ef4444;
    color: #fca5a5;
    border-radius: 5px;
    padding: 5px 12px;
    font-size: 11.5px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .btn-abort-op:hover {
    background: #dc2626;
    color: #ffffff;
  }

  /* Table Container */
  .table-container {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: #111215;
    overflow-y: auto;
  }

  .table-header-row {
    height: 32px;
    background: #16181e;
    border-bottom: 1px solid #23262e;
    display: flex;
    align-items: center;
    padding: 0 16px;
    font-size: 11.5px;
    font-weight: 600;
    color: #94a3b8;
    flex-shrink: 0;
  }

  .th, .td {
    display: flex;
    align-items: center;
  }

  .col-file {
    flex: 2;
    min-width: 240px;
  }

  .col-side {
    flex: 1;
    min-width: 130px;
  }

  .col-actions {
    width: 280px;
    justify-content: flex-end;
    gap: 6px;
  }

  .table-body {
    flex: 1;
  }

  .table-row {
    display: flex;
    align-items: center;
    padding: 10px 16px;
    border-bottom: 1px solid #1c1f26;
    font-size: 12px;
    transition: background 0.1s ease;
  }

  .table-row:hover {
    background: #161920;
  }

  .file-icon {
    font-size: 14px;
    margin-right: 8px;
    flex-shrink: 0;
  }

  .file-name-meta {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .file-name {
    font-family: 'JetBrains Mono', monospace;
    font-size: 12px;
    color: #f1f5f9;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .status-pill {
    font-size: 10.5px;
    font-weight: 600;
    padding: 1px 6px;
    border-radius: 4px;
    white-space: nowrap;
  }

  .status-pill.conflict {
    background: #3b1d1f;
    color: #f87171;
    border: 1px solid #7f1d1d;
  }

  .status-pill.resolved {
    background: #132e22;
    color: #4ade80;
    border: 1px solid #14532d;
  }

  .change-tag.modified {
    font-size: 11px;
    color: #60a5fa;
    background: #1e293b;
    padding: 2px 7px;
    border-radius: 4px;
  }

  /* Action Buttons in Row */
  .row-action-btn {
    height: 26px;
    padding: 0 10px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    border: 1px solid transparent;
    transition: all 0.12s ease;
    white-space: nowrap;
  }

  .row-action-btn.accept-yours {
    background: #1e293b;
    border-color: #3b82f6;
    color: #93c5fd;
  }
  .row-action-btn.accept-yours:hover {
    background: #3b82f6;
    color: #ffffff;
  }

  .row-action-btn.accept-theirs {
    background: #2b2315;
    border-color: #f59e0b;
    color: #fde68a;
  }
  .row-action-btn.accept-theirs:hover {
    background: #f59e0b;
    color: #000000;
  }

  .row-action-btn.merge-primary {
    background: #2563eb;
    border-color: #3b82f6;
    color: #ffffff;
  }
  .row-action-btn.merge-primary:hover {
    background: #1d4ed8;
  }

  /* All Resolved Empty State */
  .all-resolved-state {
    padding: 48px 20px;
    text-align: center;
    color: #94a3b8;
  }

  .big-check {
    font-size: 40px;
    color: #4ade80;
    display: block;
    margin-bottom: 8px;
  }

  .all-resolved-state h4 {
    margin: 0 0 6px 0;
    font-size: 15px;
    color: #f1f5f9;
  }

  .all-resolved-state p {
    margin: 0;
    font-size: 12px;
  }

  /* Bottom Bar */
  .conflicts-bottom-bar {
    height: 48px;
    padding: 0 16px;
    background: #141518;
    border-top: 1px solid #23262e;
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-shrink: 0;
  }

  .hint-warn {
    font-size: 11.5px;
    color: #f87171;
  }
  .hint-clean {
    font-size: 11.5px;
    color: #4ade80;
  }

  .bottom-actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .btn-cancel {
    background: #1e2128;
    border: 1px solid #2e333d;
    color: #cbd5e1;
    border-radius: 6px;
    padding: 6px 14px;
    font-size: 12px;
    cursor: pointer;
  }

  .btn-cancel:hover {
    background: #2a2e38;
    color: #ffffff;
  }

  .btn-continue {
    background: #2563eb;
    border: 1px solid #3b82f6;
    color: #ffffff;
    border-radius: 6px;
    padding: 6px 18px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
  }

  .btn-continue:hover:not(:disabled) {
    background: #1d4ed8;
  }

  .btn-continue:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
</style>
