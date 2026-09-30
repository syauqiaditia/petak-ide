<script lang="ts">
  import { agentsStore } from './agents.svelte';
  import { proposalToDiffFile } from './agentsLogic';
  import DiffView from '../git/DiffView.svelte';
  import type { Proposal } from './types';

  let proposals = $derived(agentsStore.activeProposals);
  let selectedProposalId = $state<string | null>(null);

  let activeProposal = $derived<Proposal | null>(
    (selectedProposalId ? proposals.find((p) => p.id === selectedProposalId) : null) ||
    proposals[0] ||
    null
  );

  let activeDiffFile = $derived(
    activeProposal ? proposalToDiffFile(activeProposal) : null
  );

  function selectProposal(id: string) {
    selectedProposalId = id;
  }

  async function handleAcceptAll() {
    for (const prop of proposals) {
      await agentsStore.acceptProposal(prop.id);
    }
  }

  async function handleRejectAll() {
    for (const prop of proposals) {
      await agentsStore.rejectProposal(prop.id);
    }
  }

  async function handleAcceptCurrent() {
    if (!activeProposal) return;
    await agentsStore.acceptProposal(activeProposal.id);
  }

  async function handleRejectCurrent() {
    if (!activeProposal) return;
    await agentsStore.rejectProposal(activeProposal.id);
  }

  async function handleAcceptHunk(idx: number) {
    if (!activeProposal) return;
    await agentsStore.acceptHunk(activeProposal.id, idx);
  }
</script>

<div class="proposed-edits-container">
  {#if proposals.length === 0}
    <div class="empty-proposals">
      <div class="empty-icon">✓</div>
      <div class="empty-title">Tidak ada usulan perubahan</div>
      <div class="empty-desc">Setiap modifikasi berkas oleh agen melalui ACP akan muncul di sini untuk ditinjau sebelum disimpan.</div>
    </div>
  {:else}
    <!-- Proposals Toolbar -->
    <div class="proposals-toolbar">
      <div class="proposals-summary">
        <span class="count-badge">{proposals.length}</span>
        <span class="summary-text">berkas diusulkan</span>
      </div>

      <div class="bulk-actions">
        <button class="bulk-btn reject-all-btn" onclick={handleRejectAll} title="Tolak semua usulan agen">
          ✕ Tolak Semua
        </button>
        <button class="bulk-btn accept-all-btn" onclick={handleAcceptAll} title="Terima seluruh perubahan ke disk">
          ✓ Terima Semua
        </button>
      </div>
    </div>

    <!-- File Pills Bar -->
    <div class="file-pills-bar">
      {#each proposals as prop (prop.id)}
        {@const isSelected = activeProposal?.id === prop.id}
        {@const fileName = prop.path.split('/').pop() || prop.path}
        <button
          class="file-pill"
          class:selected={isSelected}
          onclick={() => selectProposal(prop.id)}
          title={prop.path}
        >
          <span class="mod-tag">M</span>
          <span class="file-name">{fileName}</span>
        </button>
      {/each}
    </div>

    <!-- Active File Action Bar & Hunk Actions -->
    {#if activeProposal}
      <div class="active-file-actions-bar">
        <div class="file-path-label" title={activeProposal.path}>
          📄 {activeProposal.path}
        </div>
        <div class="single-file-buttons">
          <button class="small-btn reject-btn" onclick={handleRejectCurrent} title="Tolak berkas ini">
            Tolak Berkas
          </button>
          <button class="small-btn accept-btn" onclick={handleAcceptCurrent} title="Terima berkas ini">
            Terima Berkas
          </button>
        </div>
      </div>

      <!-- Hunk-level quick controls if multiple hunks -->
      {#if activeProposal.hunks.length > 0}
        <div class="hunks-quick-bar">
          <span class="hunks-label">Hunks ({activeProposal.hunks.length}):</span>
          {#each activeProposal.hunks as hunk, idx}
            <div class="hunk-chip">
              <span class="hunk-range">#{idx + 1} (L{hunk.new_start})</span>
              <button class="hunk-accept-btn" onclick={() => handleAcceptHunk(idx)} title="Terima Hunk {idx + 1}">
                ✓
              </button>
            </div>
          {/each}
        </div>
      {/if}

      <!-- Embedded DiffView (Reused from GitView) -->
      <div class="diff-view-embed">
        {#if activeDiffFile}
          <DiffView
            diffFile={activeDiffFile}
            sourceKind="worktree"
            filePath={activeProposal.path}
          />
        {/if}
      </div>
    {/if}
  {/if}
</div>

<style>
  .proposed-edits-container {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: #141518;
    overflow: hidden;
  }

  .empty-proposals {
    margin: auto;
    text-align: center;
    padding: 32px 16px;
    max-width: 300px;
    color: #8b949e;
  }

  .empty-icon {
    font-size: 32px;
    color: #7fc98f;
    margin-bottom: 8px;
  }

  .empty-title {
    font-size: 14px;
    font-weight: 600;
    color: #c9cdd4;
    margin-bottom: 4px;
  }

  .empty-desc {
    font-size: 11px;
    line-height: 1.4;
  }

  .proposals-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    background: #111215;
    border-bottom: 1px solid #26282d;
    flex-shrink: 0;
  }

  .proposals-summary {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .count-badge {
    background: #1f304d;
    color: #6ea8ff;
    padding: 1px 6px;
    border-radius: 10px;
    font-size: 11px;
    font-weight: 700;
  }

  .summary-text {
    font-size: 12px;
    font-weight: 500;
    color: #c9cdd4;
  }

  .bulk-actions {
    display: flex;
    gap: 8px;
  }

  .bulk-btn {
    padding: 4px 10px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    border: none;
    transition: opacity 0.12s;
  }

  .bulk-btn:hover {
    opacity: 0.85;
  }

  .reject-all-btn {
    background: transparent;
    color: #f07a74;
    border: 1px solid #5a2729;
  }

  .accept-all-btn {
    background: #233428;
    color: #7fc98f;
    border: 1px solid #35573d;
  }

  .file-pills-bar {
    display: flex;
    gap: 6px;
    padding: 6px 12px;
    background: #131417;
    border-bottom: 1px solid #1f2126;
    overflow-x: auto;
    flex-shrink: 0;
  }

  .file-pill {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 3px 8px;
    border-radius: 4px;
    background: #1a1c22;
    border: 1px solid #26282d;
    color: #8b949e;
    font-size: 11px;
    cursor: pointer;
    white-space: nowrap;
  }

  .file-pill:hover {
    color: #c9cdd4;
    border-color: #3b3f49;
  }

  .file-pill.selected {
    background: #202633;
    border-color: #3b5073;
    color: #6ea8ff;
  }

  .mod-tag {
    font-size: 9px;
    font-weight: 700;
    color: #e8b45a;
  }

  .active-file-actions-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 12px;
    background: #16181d;
    border-bottom: 1px solid #26282d;
    flex-shrink: 0;
  }

  .file-path-label {
    font-size: 11px;
    font-family: monospace;
    color: #e6edf3;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 60%;
  }

  .single-file-buttons {
    display: flex;
    gap: 6px;
  }

  .small-btn {
    padding: 2px 8px;
    font-size: 10px;
    border-radius: 3px;
    cursor: pointer;
    border: none;
  }

  .small-btn.accept-btn {
    background: #233428;
    color: #7fc98f;
    border: 1px solid #35573d;
  }

  .small-btn.reject-btn {
    background: #3d1a1c;
    color: #f07a74;
    border: 1px solid #5a2729;
  }

  .hunks-quick-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 12px;
    background: #121316;
    border-bottom: 1px solid #1f2126;
    font-size: 10px;
    color: #8b949e;
    flex-shrink: 0;
  }

  .hunk-chip {
    display: flex;
    align-items: center;
    gap: 4px;
    background: #1a1c22;
    padding: 2px 6px;
    border-radius: 3px;
    border: 1px solid #26282d;
  }

  .hunk-range {
    font-family: monospace;
    color: #c9cdd4;
  }

  .hunk-accept-btn {
    background: #233428;
    border: 1px solid #35573d;
    color: #7fc98f;
    border-radius: 2px;
    padding: 0 4px;
    font-size: 10px;
    cursor: pointer;
  }

  .diff-view-embed {
    flex: 1;
    overflow-y: auto;
    position: relative;
  }
</style>
