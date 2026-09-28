<script lang="ts">
  import { gitStore } from './git.svelte';
  import type { LocalBranch, RemoteBranch, TagRef, GitBackupRef } from '../../lib/api';

  let { onSelectTab } = $props<{
    onSelectTab?: (tab: 'commit' | 'log') => void;
  }>();

  let branchList = $derived(gitStore.branches);
  let localBranches = $derived(branchList?.local ?? []);
  let remoteBranches = $derived(branchList?.remote ?? []);
  let tags = $derived(branchList?.tags ?? []);
  let backups = $derived(gitStore.backups);

  let activeBranchFilter = $derived(gitStore.logFilter.branches?.[0] ?? null);

  let totalChanges = $derived(
    gitStore.changesEntries.length +
    gitStore.stagedEntries.length +
    gitStore.untrackedEntries.length
  );

  // Branch context menu & dialog state
  let branchContextMenuVisible = $state(false);
  let branchContextMenuPos = $state({ x: 0, y: 0 });
  let selectedBranch = $state<LocalBranch | null>(null);

  let newBranchModalOpen = $state(false);
  let newBranchName = $state('');

  let renameBranchModalOpen = $state(false);
  let renameBranchNewName = $state('');

  let deleteBranchModalOpen = $state(false);
  let deleteBranchForce = $state(false);

  let restoreBackupModalOpen = $state(false);
  let targetBackup = $state<GitBackupRef | null>(null);

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

  function handleBranchContextMenu(e: MouseEvent, b: LocalBranch) {
    e.preventDefault();
    e.stopPropagation();
    selectedBranch = b;
    const x = Math.min(e.clientX, window.innerWidth - 220);
    const y = Math.min(e.clientY, window.innerHeight - 200);
    branchContextMenuPos = { x: Math.max(10, x), y: Math.max(10, y) };
    branchContextMenuVisible = true;
  }

  function handleWindowPointerDown(e: MouseEvent) {
    const target = e.target as HTMLElement;
    if (branchContextMenuVisible && !target.closest('.branch-context-menu')) {
      branchContextMenuVisible = false;
    }
  }

  function handleWindowKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      branchContextMenuVisible = false;
    }
  }

  async function handleCheckout(branchName: string) {
    branchContextMenuVisible = false;
    await gitStore.branchCheckout(branchName);
  }

  function openNewBranchFrom(branchName: string) {
    branchContextMenuVisible = false;
    newBranchName = '';
    newBranchModalOpen = true;
  }

  async function submitNewBranch() {
    newBranchModalOpen = false;
    if (!selectedBranch || !newBranchName.trim()) return;
    await gitStore.branchCreate(newBranchName.trim(), selectedBranch.name);
  }

  function openRenameBranch(b: LocalBranch) {
    branchContextMenuVisible = false;
    renameBranchNewName = b.name;
    renameBranchModalOpen = true;
  }

  async function submitRenameBranch() {
    renameBranchModalOpen = false;
    if (!selectedBranch || !renameBranchNewName.trim() || renameBranchNewName === selectedBranch.name) return;
    await gitStore.branchRename(selectedBranch.name, renameBranchNewName.trim());
  }

  function openDeleteBranch(b: LocalBranch) {
    branchContextMenuVisible = false;
    deleteBranchForce = (b.ahead ?? 0) > 0;
    deleteBranchModalOpen = true;
  }

  async function submitDeleteBranch() {
    deleteBranchModalOpen = false;
    if (!selectedBranch) return;
    await gitStore.branchDelete(selectedBranch.name, deleteBranchForce);
  }

  function openRestoreBackup(b: GitBackupRef) {
    targetBackup = b;
    restoreBackupModalOpen = true;
  }

  async function submitRestoreBackup() {
    restoreBackupModalOpen = false;
    if (!targetBackup) return;
    await gitStore.restoreBackup(targetBackup.name);
  }

  async function handleDeleteBackup(e: MouseEvent, name: string) {
    e.stopPropagation();
    await gitStore.deleteBackup(name);
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
          oncontextmenu={(e) => handleBranchContextMenu(e, b)}
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

    <!-- BACKUPS -->
    <div class="section-header mt">BACKUPS ({backups.length})</div>
    {#if backups.length === 0}
      <div class="empty-item">No backups</div>
    {:else}
      {#each backups as bk}
        {@const shortName = bk.name.replace(/^refs\/petak\/backup\//, '')}
        <div class="backup-row" title="{bk.name} • {bk.subject || 'backup ref'}">
          <span class="backup-op-badge">{bk.op}</span>
          <span class="backup-name-text">{shortName}</span>
          <div class="backup-btn-group">
            <button
              class="bk-action-btn restore"
              onclick={() => openRestoreBackup(bk)}
              title="Reset branch to this backup"
            >
              ↺
            </button>
            <button
              class="bk-action-btn del"
              onclick={(e) => handleDeleteBackup(e, bk.name)}
              title="Delete this backup ref"
            >
              ✕
            </button>
          </div>
        </div>
      {/each}
    {/if}
  </div>

  <!-- Branch Context Menu -->
  {#if branchContextMenuVisible && selectedBranch}
    <div
      class="branch-context-menu"
      style="left: {branchContextMenuPos.x}px; top: {branchContextMenuPos.y}px;"
      role="menu"
      tabindex="-1"
    >
      <div class="b-menu-title">{selectedBranch.name}</div>
      <button
        class="b-menu-item"
        disabled={selectedBranch.isCurrent}
        onclick={() => handleCheckout(selectedBranch!.name)}
      >
        <span>Checkout</span>
      </button>
      <button
        class="b-menu-item"
        onclick={() => openNewBranchFrom(selectedBranch!.name)}
      >
        <span>New Branch from…</span>
      </button>
      <button
        class="b-menu-item"
        onclick={() => openRenameBranch(selectedBranch!)}
      >
        <span>Rename…</span>
      </button>
      <div class="b-menu-sep"></div>
      <button
        class="b-menu-item danger"
        disabled={selectedBranch.isCurrent}
        onclick={() => openDeleteBranch(selectedBranch!)}
      >
        <span>Delete Branch</span>
      </button>
    </div>
  {/if}

  <!-- Modals for Branch Panel -->
  {#if newBranchModalOpen && selectedBranch}
    <div class="bp-modal-backdrop" onclick={() => (newBranchModalOpen = false)} role="presentation">
      <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <div class="bp-modal" onclick={(e) => e.stopPropagation()} role="dialog" tabindex="-1">
        <div class="bp-modal-header">
          <span>New Branch from {selectedBranch.name}</span>
          <button class="bp-close" onclick={() => (newBranchModalOpen = false)}>✕</button>
        </div>
        <div class="bp-modal-body">
          <label for="bp-new-branch-input" class="bp-label">BRANCH NAME</label>
          <input
            id="bp-new-branch-input"
            type="text"
            class="bp-input"
            bind:value={newBranchName}
            placeholder="e.g. fix/login-issue"
            onkeydown={(e) => e.key === 'Enter' && newBranchName.trim() && submitNewBranch()}
          />
        </div>
        <div class="bp-modal-footer">
          <button class="bp-btn cancel" onclick={() => (newBranchModalOpen = false)}>Batal</button>
          <button class="bp-btn confirm" onclick={submitNewBranch} disabled={!newBranchName.trim()}>
            Create Branch
          </button>
        </div>
      </div>
    </div>
  {/if}

  {#if renameBranchModalOpen && selectedBranch}
    <div class="bp-modal-backdrop" onclick={() => (renameBranchModalOpen = false)} role="presentation">
      <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <div class="bp-modal" onclick={(e) => e.stopPropagation()} role="dialog" tabindex="-1">
        <div class="bp-modal-header">
          <span>Rename Branch '{selectedBranch.name}'</span>
          <button class="bp-close" onclick={() => (renameBranchModalOpen = false)}>✕</button>
        </div>
        <div class="bp-modal-body">
          <label for="bp-rename-branch-input" class="bp-label">NEW BRANCH NAME</label>
          <input
            id="bp-rename-branch-input"
            type="text"
            class="bp-input"
            bind:value={renameBranchNewName}
            placeholder="New name..."
            onkeydown={(e) => e.key === 'Enter' && renameBranchNewName.trim() && submitRenameBranch()}
          />
        </div>
        <div class="bp-modal-footer">
          <button class="bp-btn cancel" onclick={() => (renameBranchModalOpen = false)}>Batal</button>
          <button class="bp-btn confirm" onclick={submitRenameBranch} disabled={!renameBranchNewName.trim()}>
            Rename
          </button>
        </div>
      </div>
    </div>
  {/if}

  {#if deleteBranchModalOpen && selectedBranch}
    <div class="bp-modal-backdrop" onclick={() => (deleteBranchModalOpen = false)} role="presentation">
      <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <div class="bp-modal" onclick={(e) => e.stopPropagation()} role="dialog" tabindex="-1">
        <div class="bp-modal-header">
          <span>Hapus Branch '{selectedBranch.name}'</span>
          <button class="bp-close" onclick={() => (deleteBranchModalOpen = false)}>✕</button>
        </div>
        <div class="bp-modal-body">
          <p>Yakin ingin menghapus branch <strong>{selectedBranch.name}</strong>?</p>
          {#if (selectedBranch.ahead ?? 0) > 0}
            <div class="bp-warn">
              ⚠️ Branch ini memiliki {selectedBranch.ahead} commit yang belum di-push!
            </div>
          {/if}
          <label class="bp-checkbox-lbl">
            <input type="checkbox" bind:checked={deleteBranchForce} />
            <span>Force delete branch (-D)</span>
          </label>
        </div>
        <div class="bp-modal-footer">
          <button class="bp-btn cancel" onclick={() => (deleteBranchModalOpen = false)}>Batal</button>
          <button class="bp-btn danger-btn" onclick={submitDeleteBranch}>
            Hapus Branch
          </button>
        </div>
      </div>
    </div>
  {/if}

  {#if restoreBackupModalOpen && targetBackup}
    <div class="bp-modal-backdrop" onclick={() => (restoreBackupModalOpen = false)} role="presentation">
      <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <div class="bp-modal" onclick={(e) => e.stopPropagation()} role="dialog" tabindex="-1">
        <div class="bp-modal-header">
          <span>Reset ke Backup Ref</span>
          <button class="bp-close" onclick={() => (restoreBackupModalOpen = false)}>✕</button>
        </div>
        <div class="bp-modal-body">
          <p>Reset HEAD branch aktif ke backup <strong>{targetBackup.name}</strong>?</p>
          <p class="bp-muted">Operasi: <code>{targetBackup.op}</code> • Subject: {targetBackup.subject || '(tanpa subject)'}</p>
          <p class="bp-muted">Ini akan mengembalikan repositori ke kondisi tepat sebelum operasi {targetBackup.op} dijalankan.</p>
        </div>
        <div class="bp-modal-footer">
          <button class="bp-btn cancel" onclick={() => (restoreBackupModalOpen = false)}>Batal</button>
          <button class="bp-btn confirm" onclick={submitRestoreBackup}>
            Reset ke Backup Ini
          </button>
        </div>
      </div>
    </div>
  {/if}
</div>

<svelte:window
  onkeydown={handleWindowKeyDown}
  onpointerdown={handleWindowPointerDown}
/>

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
    background: #1f2a3d;
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

  /* Backups section styling */
  .backup-row {
    display: flex;
    align-items: center;
    height: 28px;
    padding: 0 10px 0 22px;
    gap: 6px;
    font-size: 12px;
    color: #b9bcc3;
    transition: background 0.1s;
  }

  .backup-row:hover {
    background: #1a1c22;
  }

  .backup-op-badge {
    padding: 1px 5px;
    border-radius: 4px;
    background: #2a3a55;
    color: #cfe0ff;
    font-size: 10.5px;
    font-family: 'JetBrains Mono', monospace;
    flex-shrink: 0;
  }

  .backup-name-text {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: 'JetBrains Mono', monospace;
    font-size: 11px;
    color: #8b8f98;
  }

  .backup-btn-group {
    display: flex;
    align-items: center;
    gap: 2px;
    opacity: 0;
    transition: opacity 0.1s;
  }

  .backup-row:hover .backup-btn-group {
    opacity: 1;
  }

  .bk-action-btn {
    width: 20px;
    height: 20px;
    display: grid;
    place-items: center;
    border-radius: 4px;
    border: none;
    background: transparent;
    cursor: pointer;
    font-size: 11px;
    color: #8b8f98;
    transition: all 0.1s;
  }

  .bk-action-btn.restore:hover {
    background: #232d3d;
    color: #6ea8ff;
  }

  .bk-action-btn.del:hover {
    background: #3a2022;
    color: #f0a6a2;
  }

  /* Branch Context Menu */
  .branch-context-menu {
    position: fixed;
    width: 200px;
    padding: 6px;
    background: #22242a;
    border: 1px solid #34363d;
    border-radius: 10px;
    box-shadow: 0 16px 40px rgba(0, 0, 0, 0.55);
    display: flex;
    flex-direction: column;
    gap: 1px;
    z-index: 1000;
    user-select: none;
  }

  .b-menu-title {
    padding: 4px 10px 6px;
    font-size: 11px;
    color: #8b8f98;
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .b-menu-item {
    display: flex;
    align-items: center;
    height: 26px;
    padding: 0 10px;
    border-radius: 5px;
    font-size: 12px;
    color: #d8d9dc;
    background: none;
    border: 0;
    cursor: pointer;
    width: 100%;
    text-align: left;
    transition: background 0.1s, color 0.1s;
  }

  .b-menu-item:hover:not(:disabled) {
    background: #2a3a55;
    color: #e6efff;
  }

  .b-menu-item:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }

  .b-menu-item.danger {
    color: #f0a6a2;
  }

  .b-menu-item.danger:hover:not(:disabled) {
    background: #3a2022;
    color: #f0a6a2;
  }

  .b-menu-sep {
    height: 1px;
    background: #34363d;
    margin: 4px 6px;
  }

  /* Modals in Branch Panel */
  .bp-modal-backdrop {
    position: fixed;
    inset: 0;
    z-index: 1000;
    background: rgba(0, 0, 0, 0.65);
    display: flex;
    align-items: center;
    justify-content: center;
    backdrop-filter: blur(2px);
  }

  .bp-modal {
    width: 440px;
    max-width: 90vw;
    background: #1c1d22;
    border: 1px solid #34363d;
    border-radius: 10px;
    box-shadow: 0 20px 50px rgba(0, 0, 0, 0.6);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .bp-modal-header {
    height: 46px;
    padding: 0 16px;
    display: flex;
    align-items: center;
    border-bottom: 1px solid #2a2c32;
    font-weight: 600;
    font-size: 13.5px;
  }

  .bp-close {
    margin-left: auto;
    background: none;
    border: none;
    color: #8b8f98;
    cursor: pointer;
    font-size: 13px;
  }

  .bp-modal-body {
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    font-size: 13px;
  }

  .bp-label {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.8px;
    color: #8b8f98;
  }

  .bp-input {
    width: 100%;
    box-sizing: border-box;
    height: 32px;
    background: #141518;
    border: 1px solid #2c2e34;
    border-radius: 6px;
    padding: 0 10px;
    color: #d8d9dc;
    font-size: 13px;
    outline: none;
  }

  .bp-input:focus {
    border-color: #3a4f75;
  }

  .bp-warn {
    padding: 8px 12px;
    border-radius: 6px;
    background: #2e2717;
    border: 1px solid #4a3d22;
    color: #f0cf8e;
    font-size: 12px;
  }

  .bp-checkbox-lbl {
    display: flex;
    align-items: center;
    gap: 8px;
    color: #b9bcc3;
    font-size: 12.5px;
    cursor: pointer;
    margin-top: 4px;
  }

  .bp-muted {
    font-size: 12px;
    color: #8b8f98;
    margin: 0;
  }

  .bp-modal-footer {
    height: 50px;
    padding: 0 16px;
    background: #18191d;
    border-top: 1px solid #2a2c32;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
  }

  .bp-btn {
    height: 32px;
    padding: 0 14px;
    border-radius: 6px;
    font-size: 12.5px;
    cursor: pointer;
    border: none;
    transition: all 0.15s;
  }

  .bp-btn.cancel {
    background: transparent;
    color: #b9bcc3;
    border: 1px solid #2c2e34;
  }

  .bp-btn.confirm {
    background: #2a3a55;
    color: #cfe0ff;
    font-weight: 500;
  }

  .bp-btn.danger-btn {
    background: #6d2424;
    color: #ffe6e6;
    font-weight: 500;
  }
</style>
