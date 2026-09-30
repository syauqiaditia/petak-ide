<script lang="ts">
  import type { MergeRequest, TokenScopeMode } from './types';
  import { evaluateMrMergeStatus, SCOPE_DISABLED_TOOLTIP, validateMergeSha } from './mrLogic';

  let {
    mrDetail,
    tokenScope = 'none',
    isMerging = false,
    onApprove,
    onUnapprove,
    onExecuteMerge,
  } = $props<{
    mrDetail: MergeRequest;
    tokenScope: TokenScopeMode;
    isMerging?: boolean;
    onApprove?: () => Promise<void>;
    onUnapprove?: () => Promise<void>;
    onExecuteMerge?: (params: {
      sha: string;
      squash: boolean;
      shouldRemoveSourceBranch: boolean;
    }) => Promise<void>;
  }>();

  let squash = $state(true);
  let removeSourceBranch = $state(true);
  let showConfirmModal = $state(false);
  let confirmError = $state<string | null>(null);

  let evaluation = $derived(evaluateMrMergeStatus(mrDetail));
  let canWrite = $derived(tokenScope === 'full');
  let isMerged = $derived(mrDetail.state === 'merged');
  let isClosed = $derived(mrDetail.state === 'closed');

  async function handleOpenConfirm() {
    if (!canWrite || !evaluation.mergeable) return;
    confirmError = null;
    showConfirmModal = true;
  }

  async function handleConfirmMerge() {
    confirmError = null;
    const validation = validateMergeSha(mrDetail.sha, mrDetail.sha);
    if (!validation.valid) {
      confirmError = validation.error || 'Validasi SHA gagal';
      return;
    }

    try {
      if (onExecuteMerge) {
        await onExecuteMerge({
          sha: mrDetail.sha,
          squash,
          shouldRemoveSourceBranch: removeSourceBranch,
        });
      }
      showConfirmModal = false;
    } catch (e: any) {
      confirmError = e?.message || String(e);
    }
  }
</script>

<div class="mr-merge-bar">
  <div class="left-controls">
    {#if !isMerged && !isClosed}
      <label class="checkbox-label" title="Gabungkan semua commit menjadi satu saat merge">
        <input type="checkbox" bind:checked={squash} disabled={!canWrite} />
        <span>Squash commits</span>
      </label>
      <label class="checkbox-label" title="Hapus branch sumber setelah merge berhasil">
        <input type="checkbox" bind:checked={removeSourceBranch} disabled={!canWrite} />
        <span>Hapus branch sumber</span>
      </label>
    {/if}
  </div>

  <div class="right-controls">
    <div class="status-indicator" class:ready={evaluation.mergeable} class:blocked={!evaluation.mergeable}>
      <span class="status-dot"></span>
      <span class="status-text">{evaluation.reason}</span>
    </div>

    {#if !isMerged && !isClosed}
      <div class="action-buttons">
        <button
          class="btn-secondary"
          disabled={!canWrite}
          title={!canWrite ? SCOPE_DISABLED_TOOLTIP : 'Setujui MR ini'}
          onclick={() => onApprove?.()}
        >
          Approve
        </button>

        {#if evaluation.canMwps}
          <button
            class="btn-mwps"
            disabled={!canWrite}
            title={!canWrite ? SCOPE_DISABLED_TOOLTIP : 'Merge otomatis begitu pipeline CI selesai dan sukses'}
            onclick={handleOpenConfirm}
          >
            Merge Saat Pipeline Sukses
          </button>
        {:else}
          <button
            class="btn-merge"
            disabled={!canWrite || !evaluation.mergeable || isMerging}
            title={!canWrite ? SCOPE_DISABLED_TOOLTIP : !evaluation.mergeable ? evaluation.reason : 'Lakukan merge ke target branch'}
            onclick={handleOpenConfirm}
          >
            {isMerging ? 'Merging…' : 'Lakukan Merge…'}
          </button>
        {/if}
      </div>
    {:else if isMerged}
      <span class="badge-merged">Merged</span>
    {:else}
      <span class="badge-closed">Closed</span>
    {/if}
  </div>
</div>

<!-- Modal Konfirmasi Merge dengan Tampilan SHA Mutlak -->
{#if showConfirmModal}
  <div class="modal-backdrop" onclick={() => (showConfirmModal = false)} role="presentation">
    <div class="modal-box" onclick={(e) => e.stopPropagation()} onkeydown={(e) => { if (e.key === 'Escape') showConfirmModal = false; }} role="dialog" aria-modal="true" tabindex="-1">
      <div class="modal-header">
        <h3 class="modal-title">Konfirmasi Merge MR !{mrDetail.iid}</h3>
      </div>

      <div class="modal-body">
        <p class="summary-line">
          Anda akan menggabungkan branch <code>{mrDetail.sourceBranch}</code> ke dalam <code>{mrDetail.targetBranch}</code>.
        </p>

        <div class="sha-card">
          <div class="sha-label">Head Commit SHA (Verifikasi Keamanan):</div>
          <code class="sha-value">{mrDetail.sha}</code>
          <div class="sha-desc">SHA ini diverifikasi di server untuk mencegah race condition pembaruan commit.</div>
        </div>

        <div class="options-summary">
          <div class="opt-row">
            <span class="opt-icon">{squash ? '✓' : '✗'}</span>
            <span>{squash ? 'Squash semua commit menjadi satu commit' : 'Pertahankan commit history asli (No squash)'}</span>
          </div>
          <div class="opt-row">
            <span class="opt-icon">{removeSourceBranch ? '✓' : '✗'}</span>
            <span>{removeSourceBranch ? `Hapus branch sumber '${mrDetail.sourceBranch}' setelah merge` : 'Biarkan branch sumber tetap ada'}</span>
          </div>
        </div>

        {#if confirmError}
          <div class="error-banner">{confirmError}</div>
        {/if}
      </div>

      <div class="modal-footer">
        <button class="btn-cancel" onclick={() => (showConfirmModal = false)}>Batal</button>
        <button class="btn-confirm-merge" disabled={isMerging} onclick={handleConfirmMerge}>
          {isMerging ? 'Sedang Memproses…' : 'Konfirmasi & Merge'}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .mr-merge-bar {
    height: 56px;
    background: #141518;
    border-top: 1px solid #2c2e34;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 16px;
    flex-shrink: 0;
    box-sizing: border-box;
  }

  .left-controls {
    display: flex;
    align-items: center;
    gap: 16px;
  }

  .checkbox-label {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: #c9cdd4;
    cursor: pointer;
    user-select: none;
  }

  .checkbox-label input {
    cursor: pointer;
    accent-color: #3574f0;
  }

  .checkbox-label input:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }

  .right-controls {
    display: flex;
    align-items: center;
    gap: 16px;
  }

  .status-indicator {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
  }

  .status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #8b949e;
  }

  .status-indicator.ready .status-dot {
    background: #7fc98f;
  }

  .status-indicator.blocked .status-dot {
    background: #e5534b;
  }

  .status-text {
    color: #9da5b4;
  }

  .status-indicator.ready .status-text {
    color: #7fc98f;
  }

  .action-buttons {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  button {
    font-size: 12px;
    font-weight: 500;
    padding: 6px 14px;
    border-radius: 4px;
    cursor: pointer;
    transition: all 0.15s ease;
    border: none;
  }

  button:disabled {
    opacity: 0.4;
    cursor: not-allowed !important;
  }

  .btn-secondary {
    background: #23252b;
    color: #c9cdd4;
    border: 1px solid #2c2e34;
  }

  .btn-secondary:hover:not(:disabled) {
    background: #2b2e36;
    color: #fff;
  }

  .btn-merge {
    background: #2ea043;
    color: #ffffff;
  }

  .btn-merge:hover:not(:disabled) {
    background: #3fb950;
  }

  .btn-mwps {
    background: #d29922;
    color: #ffffff;
  }

  .btn-mwps:hover:not(:disabled) {
    background: #e3b341;
  }

  .badge-merged {
    background: #8957e5;
    color: #fff;
    padding: 4px 10px;
    border-radius: 4px;
    font-size: 12px;
    font-weight: 600;
  }

  .badge-closed {
    background: #cf222e;
    color: #fff;
    padding: 4px 10px;
    border-radius: 4px;
    font-size: 12px;
    font-weight: 600;
  }

  /* Modal */
  .modal-backdrop {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.65);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }

  .modal-box {
    background: #1e2024;
    border: 1px solid #2c2e34;
    border-radius: 8px;
    width: 520px;
    max-width: 90vw;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.6);
    overflow: hidden;
  }

  .modal-header {
    padding: 14px 18px;
    border-bottom: 1px solid #2c2e34;
  }

  .modal-title {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
    color: #e6edf3;
  }

  .modal-body {
    padding: 18px;
    display: flex;
    flex-direction: column;
    gap: 14px;
    font-size: 13px;
    color: #c9cdd4;
  }

  .summary-line {
    margin: 0;
  }

  .summary-line code {
    background: #141518;
    padding: 2px 6px;
    border-radius: 3px;
    color: #79c0ff;
    font-family: monospace;
  }

  .sha-card {
    background: #141518;
    border: 1px solid #2c2e34;
    border-radius: 6px;
    padding: 10px 14px;
  }

  .sha-label {
    font-size: 11px;
    color: #8b949e;
    margin-bottom: 4px;
  }

  .sha-value {
    font-family: monospace;
    font-size: 12px;
    color: #7ee787;
    word-break: break-all;
    user-select: all;
  }

  .sha-desc {
    font-size: 11px;
    color: #8b949e;
    margin-top: 4px;
  }

  .options-summary {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 12px;
    color: #8b949e;
  }

  .opt-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .opt-icon {
    font-weight: bold;
    color: #7ee787;
  }

  .error-banner {
    background: rgba(248, 81, 73, 0.15);
    border: 1px solid #f85149;
    color: #ff7b72;
    padding: 8px 12px;
    border-radius: 4px;
    font-size: 12px;
  }

  .modal-footer {
    padding: 12px 18px;
    background: #18191c;
    border-top: 1px solid #2c2e34;
    display: flex;
    justify-content: flex-end;
    gap: 10px;
  }

  .btn-cancel {
    background: #23252b;
    color: #c9cdd4;
    border: 1px solid #2c2e34;
  }

  .btn-cancel:hover {
    background: #2b2e36;
  }

  .btn-confirm-merge {
    background: #2ea043;
    color: #fff;
  }

  .btn-confirm-merge:hover:not(:disabled) {
    background: #3fb950;
  }
</style>
