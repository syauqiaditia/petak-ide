<script lang="ts">
  import { gitStore } from './git.svelte';
  import type { LocalBranch, RemoteBranch, TagRef, GitBackupRef } from '../../lib/api';
  import {
    buildBranchTree,
    filterBranchTree,
    flattenBranchTree,
    type FlatDisplayItem,
  } from './branchTreeLogic';
  import { computeWindowing } from './windowingLogic';
  import CompareBranchModal from './CompareBranchModal.svelte';

  let { onSelectTab } = $props<{
    onSelectTab?: (tab: 'commit' | 'log' | 'conflict' | 'stash') => void;
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

  // Search filter query
  let searchQuery = $state('');

  // Collapsible sections & folders
  let expandedSections = $state<Set<string>>(new Set(['local', 'remote', 'tags', 'backups']));
  let expandedFolders = $state<Set<string>>(new Set(['canary/', 'fix/', 'feat/', 'release/']));

  function toggleSection(sec: string) {
    const next = new Set(expandedSections);
    if (next.has(sec)) {
      next.delete(sec);
    } else {
      next.add(sec);
    }
    expandedSections = next;
  }

  function toggleFolder(fullPrefix: string) {
    const next = new Set(expandedFolders);
    if (next.has(fullPrefix)) {
      next.delete(fullPrefix);
    } else {
      next.add(fullPrefix);
    }
    expandedFolders = next;
  }

  // Trees and flattened rows
  let localTree = $derived(buildBranchTree(localBranches));
  let filteredLocalTree = $derived(filterBranchTree(localTree, searchQuery));
  let flatLocalRows = $derived(flattenBranchTree(filteredLocalTree, expandedFolders));

  let remoteTree = $derived(
    buildBranchTree(
      remoteBranches.map((r) => {
        const leafName = r.name.replace(/^origin\//, '');
        return {
          name: leafName,
          sha: r.sha,
        };
      })
    )
  );
  let filteredRemoteTree = $derived(filterBranchTree(remoteTree, searchQuery));
  let flatRemoteRows = $derived(flattenBranchTree(filteredRemoteTree, expandedFolders));

  let filteredTags = $derived(
    tags.filter((t) => t.name.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  let filteredBackups = $derived(
    backups.filter((b) => b.name.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  // Scroll windowing state
  let scrollContainer: HTMLDivElement | null = $state(null);
  let scrollTop = $state(0);
  let viewportHeight = $state(450);

  function handleScroll(e: Event) {
    const target = e.currentTarget as HTMLDivElement;
    scrollTop = target.scrollTop;
    viewportHeight = target.clientHeight || 450;
  }

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

  let checkoutModalOpen = $state(false);
  let checkoutTargetBranch = $state('');
  let checkoutAutoStash = $state(true);

  let restoreBackupModalOpen = $state(false);
  let targetBackup = $state<GitBackupRef | null>(null);

  let compareModalOpen = $state(false);
  let targetCompareBranch = $state('');

  function openCompareWithBranch(branchName: string) {
    targetCompareBranch = branchName;
    compareModalOpen = true;
  }

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

  function promptCheckout(branchName: string) {
    const isDirty = totalChanges > 0;
    if (isDirty) {
      checkoutTargetBranch = branchName;
      checkoutAutoStash = true;
      checkoutModalOpen = true;
    } else {
      gitStore.branchCheckout(branchName, true);
    }
  }

  function handleBranchContextMenu(e: MouseEvent, b: LocalBranch | FlatDisplayItem) {
    e.preventDefault();
    e.stopPropagation();

    // Map FlatDisplayItem to LocalBranch if needed
    const found = localBranches.find((x) => x.name === b.fullName || x.name === b.name);
    selectedBranch = found || {
      name: b.fullName || b.name,
      ahead: b.ahead ?? 0,
      behind: b.behind ?? 0,
      isCurrent: b.isCurrent ?? false,
      upstream: b.upstream ?? null,
      sha: '',
    };

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
    promptCheckout(branchName);
  }

  async function confirmModalCheckout() {
    checkoutModalOpen = false;
    if (!checkoutTargetBranch) return;
    await gitStore.branchCheckout(checkoutTargetBranch, checkoutAutoStash);
  }

  async function handleMerge(branchName: string) {
    branchContextMenuVisible = false;
    const res = await gitStore.merge(branchName);
    if (!res.ok) {
      onSelectTab?.('conflict');
    }
  }

  async function handleRebaseOnto(branchName: string) {
    branchContextMenuVisible = false;
    const res = await gitStore.rebaseOnto(branchName);
    if (!res.ok) {
      onSelectTab?.('conflict');
    }
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
  <!-- Sub-tab switcher -->
  <div class="panel-tabs">
    <button
      class="panel-tab"
      class:active={gitStore.activeSubTab === 'log'}
      onclick={() => onSelectTab?.('log')}
    >
      Log
    </button>
    <button
      class="panel-tab"
      class:active={gitStore.activeSubTab === 'commit'}
      onclick={() => onSelectTab?.('commit')}
    >
      Commit
      {#if totalChanges > 0}
        <span class="commit-count">{totalChanges}</span>
      {/if}
    </button>
    <button
      class="panel-tab"
      class:active={gitStore.activeSubTab === 'stash'}
      onclick={() => onSelectTab?.('stash')}
    >
      Stash
      {#if gitStore.stashCount > 0}
        <span class="commit-count">{gitStore.stashCount}</span>
      {/if}
    </button>
  </div>

  <!-- Branch Search Filter -->
  <div class="branch-search-box">
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <circle cx="11" cy="11" r="7"></circle>
      <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
    </svg>
    <input
      type="text"
      class="branch-search-input"
      placeholder="Filter branches & tags…"
      bind:value={searchQuery}
    />
    {#if searchQuery}
      <button class="clear-search-btn" onclick={() => (searchQuery = '')}>✕</button>
    {/if}
  </div>

  <div
    class="branch-tree"
    bind:this={scrollContainer}
    onscroll={handleScroll}
  >
    <!-- LOCAL -->
    <div
      class="section-header"
      onclick={() => toggleSection('local')}
      role="button"
      tabindex="0"
      onkeydown={(e) => { if (e.key === 'Enter') toggleSection('local'); }}
    >
      <span class="caret">{expandedSections.has('local') ? '▾' : '▸'}</span>
      <span>LOCAL ({localBranches.length})</span>
    </div>

    {#if expandedSections.has('local')}
      {#if flatLocalRows.length === 0}
        <div class="empty-item">
          {searchQuery ? 'No matching local branches' : 'No local branches'}
        </div>
      {:else}
        {#each flatLocalRows as row}
          {#if row.type === 'folder'}
            <div
              class="tree-folder-row"
              style:padding-left="{10 + row.depth * 14}px"
              onclick={() => toggleFolder(row.fullName)}
              role="button"
              tabindex="0"
              onkeydown={(e) => { if (e.key === 'Enter') toggleFolder(row.fullName); }}
            >
              <span class="caret">{row.isExpanded ? '▾' : '▸'}</span>
              <svg class="folder-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
              </svg>
              <span class="folder-name">{row.name}</span>
              <span class="folder-count">{row.count}</span>
            </div>
          {:else}
            <button
              class="branch-item"
              class:current={row.isCurrent}
              class:filtered={activeBranchFilter === row.fullName}
              style:padding-left="{14 + row.depth * 14}px"
              onclick={() => filterByBranch(row.fullName)}
              ondblclick={() => promptCheckout(row.fullName)}
              oncontextmenu={(e) => handleBranchContextMenu(e, row)}
              title="{row.fullName}{row.upstream ? ` -> ${row.upstream}` : ''} (Double-click to checkout)"
            >
              {#if row.isCurrent}
                <span class="star">★</span>
              {/if}
              <span class="name" class:bold={row.isCurrent}>{row.name}</span>
              {#if (row.ahead ?? 0) > 0}
                <span class="ahead">↑{row.ahead}</span>
              {/if}
              {#if (row.behind ?? 0) > 0}
                <span class="behind">↓{row.behind}</span>
              {/if}
            </button>
          {/if}
        {/each}
      {/if}
    {/if}

    <!-- REMOTE -->
    <div
      class="section-header mt"
      onclick={() => toggleSection('remote')}
      role="button"
      tabindex="0"
      onkeydown={(e) => { if (e.key === 'Enter') toggleSection('remote'); }}
    >
      <span class="caret">{expandedSections.has('remote') ? '▾' : '▸'}</span>
      <span>REMOTE · origin ({remoteBranches.length})</span>
    </div>

    {#if expandedSections.has('remote')}
      {#if flatRemoteRows.length === 0}
        <div class="empty-item">
          {searchQuery ? 'No matching remote branches' : 'No remote branches'}
        </div>
      {:else}
        {#each flatRemoteRows as row}
          {#if row.type === 'folder'}
            <div
              class="tree-folder-row"
              style:padding-left="{10 + row.depth * 14}px"
              onclick={() => toggleFolder(row.fullName)}
              role="button"
              tabindex="0"
              onkeydown={(e) => { if (e.key === 'Enter') toggleFolder(row.fullName); }}
            >
              <span class="caret">{row.isExpanded ? '▾' : '▸'}</span>
              <svg class="folder-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
              </svg>
              <span class="folder-name">{row.name}</span>
              <span class="folder-count">{row.count}</span>
            </div>
          {:else}
            <button
              class="branch-item"
              class:filtered={activeBranchFilter === `origin/${row.fullName}`}
              style:padding-left="{14 + row.depth * 14}px"
              onclick={() => filterByBranch(`origin/${row.fullName}`)}
              title="origin/{row.fullName}"
            >
              <span class="name">{row.name}</span>
            </button>
          {/if}
        {/each}
      {/if}
    {/if}

    <!-- TAGS -->
    <div
      class="section-header mt"
      onclick={() => toggleSection('tags')}
      role="button"
      tabindex="0"
      onkeydown={(e) => { if (e.key === 'Enter') toggleSection('tags'); }}
    >
      <span class="caret">{expandedSections.has('tags') ? '▾' : '▸'}</span>
      <span>TAGS ({tags.length})</span>
    </div>

    {#if expandedSections.has('tags')}
      {#if filteredTags.length === 0}
        <div class="empty-item">
          {searchQuery ? 'No matching tags' : 'No tags'}
        </div>
      {:else}
        {#each filteredTags as t}
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
    {/if}

    <!-- BACKUPS -->
    <div
      class="section-header mt"
      onclick={() => toggleSection('backups')}
      role="button"
      tabindex="0"
      onkeydown={(e) => { if (e.key === 'Enter') toggleSection('backups'); }}
    >
      <span class="caret">{expandedSections.has('backups') ? '▾' : '▸'}</span>
      <span>BACKUPS ({backups.length})</span>
    </div>

    {#if expandedSections.has('backups')}
      {#if filteredBackups.length === 0}
        <div class="empty-item">No backups</div>
      {:else}
        {#each filteredBackups as bk}
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
        disabled={selectedBranch.isCurrent}
        onclick={() => handleMerge(selectedBranch!.name)}
      >
        <span>Merge into current</span>
      </button>
      <button
        class="b-menu-item"
        disabled={selectedBranch.isCurrent}
        onclick={() => handleRebaseOnto(selectedBranch!.name)}
      >
        <span>Rebase current onto</span>
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
      <button
        class="b-menu-item"
        onclick={() => {
          const b = selectedBranch!.name;
          contextMenuOpen = false;
          openCompareWithBranch(b);
        }}
      >
        <span>Compare with Current…</span>
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

  <!-- Checkout Confirm Dialog (with Auto-Stash) -->
  {#if checkoutModalOpen}
    <div class="bp-modal-backdrop" onclick={() => (checkoutModalOpen = false)} role="presentation">
      <div class="bp-modal" onclick={(e) => e.stopPropagation()} role="dialog" tabindex="-1">
        <div class="bp-modal-header">
          <span>Checkout Branch</span>
          <button class="bp-close" onclick={() => (checkoutModalOpen = false)}>✕</button>
        </div>
        <div class="bp-modal-body">
          <p class="checkout-prompt-text">
            Switch checkout to branch <strong>{checkoutTargetBranch}</strong>?
          </p>
          {#if totalChanges > 0}
            <div class="autostash-box">
              <label class="autostash-label">
                <input type="checkbox" bind:checked={checkoutAutoStash} />
                <span>Auto-stash dirty working changes before checkout, and restore after</span>
              </label>
              <span class="autostash-sub">
                {totalChanges} uncommitted changes will be safely protected via <code>git stash push -u</code>.
              </span>
            </div>
          {/if}
        </div>
        <div class="bp-modal-footer">
          <button class="bp-btn cancel" onclick={() => (checkoutModalOpen = false)}>Cancel</button>
          <button class="bp-btn confirm" onclick={confirmModalCheckout}>
            Checkout
          </button>
        </div>
      </div>
    </div>
  {/if}

  <!-- Modals for Branch Panel -->
  {#if newBranchModalOpen && selectedBranch}
    <div class="bp-modal-backdrop" onclick={() => (newBranchModalOpen = false)} role="presentation">
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
          <button class="bp-btn cancel" onclick={() => (newBranchModalOpen = false)}>Cancel</button>
          <button class="bp-btn confirm" onclick={submitNewBranch} disabled={!newBranchName.trim()}>
            Create Branch
          </button>
        </div>
      </div>
    </div>
  {/if}

  {#if renameBranchModalOpen && selectedBranch}
    <div class="bp-modal-backdrop" onclick={() => (renameBranchModalOpen = false)} role="presentation">
      <div class="bp-modal" onclick={(e) => e.stopPropagation()} role="dialog" tabindex="-1">
        <div class="bp-modal-header">
          <span>Rename Branch {selectedBranch.name}</span>
          <button class="bp-close" onclick={() => (renameBranchModalOpen = false)}>✕</button>
        </div>
        <div class="bp-modal-body">
          <label for="bp-rename-input" class="bp-label">NEW NAME</label>
          <input
            id="bp-rename-input"
            type="text"
            class="bp-input"
            bind:value={renameBranchNewName}
            onkeydown={(e) => e.key === 'Enter' && renameBranchNewName.trim() && submitRenameBranch()}
          />
        </div>
        <div class="bp-modal-footer">
          <button class="bp-btn cancel" onclick={() => (renameBranchModalOpen = false)}>Cancel</button>
          <button class="bp-btn confirm" onclick={submitRenameBranch} disabled={!renameBranchNewName.trim()}>
            Rename Branch
          </button>
        </div>
      </div>
    </div>
  {/if}

  {#if deleteBranchModalOpen && selectedBranch}
    <div class="bp-modal-backdrop" onclick={() => (deleteBranchModalOpen = false)} role="presentation">
      <div class="bp-modal" onclick={(e) => e.stopPropagation()} role="dialog" tabindex="-1">
        <div class="bp-modal-header">
          <span>Delete Branch {selectedBranch.name}</span>
          <button class="bp-close" onclick={() => (deleteBranchModalOpen = false)}>✕</button>
        </div>
        <div class="bp-modal-body">
          <p class="bp-msg">Hapus cabang lokal <strong>'{selectedBranch.name}'</strong>?</p>
          <label style="display: flex; align-items: center; gap: 6px; margin: 12px 0 6px 0; font-size: 11.5px; color: #c9cdd4; cursor: pointer;">
            <input type="checkbox" bind:checked={deleteBranchForce} />
            <span>Paksa hapus (Force Delete <code>-D</code>)</span>
          </label>
          {#if deleteBranchForce}
            <div class="bp-warn">
              Cabang akan dihapus permanen meskipun belum di-merge penuh ke remote.
            </div>
          {/if}
        </div>
        <div class="bp-modal-footer">
          <button class="bp-btn cancel" onclick={() => (deleteBranchModalOpen = false)}>Cancel</button>
          <button class="bp-btn danger" onclick={submitDeleteBranch}>
            {deleteBranchForce ? 'Force Delete Branch' : 'Delete Branch'}
          </button>
        </div>
      </div>
    </div>
  {/if}

  {#if restoreBackupModalOpen && targetBackup}
    <div class="bp-modal-backdrop" onclick={() => (restoreBackupModalOpen = false)} role="presentation">
      <div class="bp-modal" onclick={(e) => e.stopPropagation()} role="dialog" tabindex="-1">
        <div class="bp-modal-header">
          <span>Restore Backup</span>
          <button class="bp-close" onclick={() => (restoreBackupModalOpen = false)}>✕</button>
        </div>
        <div class="bp-modal-body">
          <p class="bp-msg">
            Reset current branch to this backup snapshot?
          </p>
          <div class="bp-warn">
            All current uncommitted changes will be backed up before restoration.
          </div>
        </div>
        <div class="bp-modal-footer">
          <button class="bp-btn cancel" onclick={() => (restoreBackupModalOpen = false)}>Cancel</button>
          <button class="bp-btn confirm" onclick={submitRestoreBackup}>
            Reset to This Backup
          </button>
        </div>
      </div>
    </div>
  {/if}

  {#if compareModalOpen && gitStore.root}
    <CompareBranchModal
      root={gitStore.root}
      baseBranch={gitStore.headBranch || 'HEAD'}
      targetBranch={targetCompareBranch}
      onclose={() => (compareModalOpen = false)}
    />
  {/if}
</div>

<svelte:window
  onkeydown={handleWindowKeyDown}
  onpointerdown={handleWindowPointerDown}
/>

<style>
  .branch-panel {
    width: 250px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    background: #141518;
    border-right: 1px solid #26282d;
    user-select: none;
    height: 100%;
    overflow: hidden;
  }

  .panel-tabs {
    height: 38px;
    display: flex;
    align-items: center;
    padding: 0 12px;
    gap: 8px;
    border-bottom: 1px solid #222428;
    flex-shrink: 0;
  }

  .panel-tab {
    height: 26px;
    padding: 0 10px;
    border-radius: 6px;
    border: none;
    background: transparent;
    color: #8b8f98;
    font-size: 12.5px;
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
    font-size: 10px;
    padding: 1px 5px;
    border-radius: 8px;
    background: #2a3a55;
    color: #6ea8ff;
  }

  .branch-search-box {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    border-bottom: 1px solid #222428;
    background: #16181d;
    color: #727680;
    flex-shrink: 0;
  }

  .branch-search-input {
    flex: 1;
    background: transparent;
    border: none;
    outline: none;
    color: #e6e7ea;
    font-size: 12px;
  }

  .branch-search-input::placeholder {
    color: #656972;
  }

  .clear-search-btn {
    background: transparent;
    border: none;
    color: #727680;
    cursor: pointer;
    font-size: 11px;
    padding: 0 4px;
  }

  .clear-search-btn:hover {
    color: #e6e7ea;
  }

  .branch-tree {
    flex: 1;
    overflow-y: auto;
    padding: 6px 0 16px;
  }

  .section-header {
    height: 24px;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 10px;
    font-size: 10.5px;
    font-weight: 600;
    color: #727680;
    letter-spacing: 0.5px;
    cursor: pointer;
    user-select: none;
  }

  .section-header:hover {
    color: #a0a4ae;
  }

  .section-header.mt {
    margin-top: 10px;
  }

  .caret {
    font-size: 10px;
    width: 10px;
    text-align: center;
    color: #8b8f98;
  }

  .tree-folder-row {
    height: 26px;
    display: flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
    color: #b9bcc3;
    font-size: 12px;
    transition: background 0.1s;
    user-select: none;
  }

  .tree-folder-row:hover {
    background: #1c1d22;
    color: #ffffff;
  }

  .folder-icon {
    color: #8b8f98;
    flex-shrink: 0;
  }

  .folder-name {
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .folder-count {
    font-size: 10px;
    color: #656972;
    margin-left: auto;
    padding-right: 10px;
  }

  .branch-item {
    width: 100%;
    height: 26px;
    display: flex;
    align-items: center;
    gap: 6px;
    background: transparent;
    border: none;
    color: #b9bcc3;
    font-size: 12px;
    cursor: pointer;
    text-align: left;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    transition: background 0.1s;
    padding-right: 10px;
    box-sizing: border-box;
  }

  .branch-item:hover {
    background: #1e2025;
    color: #ffffff;
  }

  .branch-item.current {
    color: #ffffff;
    background: #182333;
  }

  .branch-item.filtered {
    background: #232c3d;
  }

  .star {
    color: #e8b45a;
    font-size: 12px;
    flex-shrink: 0;
  }

  .name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .name.bold {
    font-weight: 700;
    color: #ffffff;
  }

  .ahead {
    font-size: 10px;
    font-weight: 600;
    color: #7fc98f;
    margin-left: auto;
  }

  .behind {
    font-size: 10px;
    font-weight: 600;
    color: #e8b45a;
    margin-left: 2px;
  }

  .empty-item {
    padding: 6px 18px;
    font-size: 11px;
    color: #656972;
    font-style: italic;
  }

  .backup-row {
    display: flex;
    align-items: center;
    height: 26px;
    padding: 0 10px 0 16px;
    gap: 8px;
    font-size: 11.5px;
  }

  .backup-op-badge {
    font-size: 9.5px;
    font-weight: 600;
    padding: 1px 4px;
    border-radius: 3px;
    background: #252830;
    color: #a0a4ae;
    text-transform: uppercase;
  }

  .backup-name-text {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: #b9bcc3;
  }

  .backup-btn-group {
    display: flex;
    gap: 4px;
  }

  .bk-action-btn {
    width: 20px;
    height: 20px;
    display: grid;
    place-items: center;
    background: transparent;
    border: none;
    color: #727680;
    cursor: pointer;
    border-radius: 3px;
    font-size: 11px;
  }

  .bk-action-btn:hover {
    color: #ffffff;
    background: #282a32;
  }

  /* Context Menu */
  .branch-context-menu {
    position: fixed;
    z-index: 1000;
    background: #1e2025;
    border: 1px solid #34363d;
    border-radius: 8px;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
    padding: 4px 0;
    width: 200px;
  }

  .b-menu-title {
    font-size: 11px;
    font-weight: 600;
    color: #727680;
    padding: 6px 12px 4px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    border-bottom: 1px solid #282a32;
    margin-bottom: 2px;
  }

  .b-menu-item {
    width: 100%;
    height: 26px;
    display: flex;
    align-items: center;
    padding: 0 12px;
    background: transparent;
    border: none;
    color: #d8d9dc;
    font-size: 12px;
    cursor: pointer;
    text-align: left;
    transition: background 0.12s;
  }

  .b-menu-item:hover:not(:disabled) {
    background: #252830;
    color: #ffffff;
  }

  .b-menu-item:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .b-menu-item.danger:hover:not(:disabled) {
    background: #3d1f22;
    color: #f0837f;
  }

  .b-menu-sep {
    height: 1px;
    background: #282a32;
    margin: 4px 0;
  }

  /* Modals */
  .bp-modal-backdrop {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.65);
    z-index: 1000;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .bp-modal {
    width: 380px;
    background: #18191e;
    border: 1px solid #34363d;
    border-radius: 8px;
    box-shadow: 0 16px 40px rgba(0, 0, 0, 0.6);
    overflow: hidden;
  }

  .bp-modal-header {
    height: 36px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 14px;
    background: #1d1f25;
    border-bottom: 1px solid #282a31;
    font-size: 12.5px;
    font-weight: 600;
    color: #e6e7ea;
  }

  .bp-close {
    background: transparent;
    border: none;
    color: #8b8f98;
    cursor: pointer;
    font-size: 12px;
  }

  .bp-close:hover {
    color: #e6e7ea;
  }

  .bp-modal-body {
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .checkout-prompt-text {
    margin: 0;
    font-size: 12.5px;
    color: #d8d9dc;
    line-height: 1.4;
  }

  .autostash-box {
    background: #131418;
    border: 1px solid #282a31;
    border-radius: 6px;
    padding: 10px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-top: 4px;
  }

  .autostash-label {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    font-size: 12px;
    color: #e6e7ea;
    cursor: pointer;
  }

  .autostash-sub {
    font-size: 11px;
    color: #8b8f98;
    padding-left: 22px;
  }

  .autostash-sub code {
    font-family: 'JetBrains Mono', monospace;
    color: #569aff;
  }

  .bp-label {
    font-size: 10.5px;
    font-weight: 600;
    color: #8b8f98;
  }

  .bp-input {
    width: 100%;
    height: 28px;
    background: #121316;
    border: 1px solid #2e3037;
    border-radius: 5px;
    padding: 0 8px;
    color: #e6e7ea;
    font-size: 12.5px;
    outline: none;
    box-sizing: border-box;
  }

  .bp-input:focus {
    border-color: #569aff;
  }

  .bp-msg {
    margin: 0;
    font-size: 12.5px;
    color: #d8d9dc;
  }

  .bp-warn {
    font-size: 11.5px;
    color: #f0a6a2;
    background: #2a1618;
    border: 1px solid #4a2428;
    padding: 8px 10px;
    border-radius: 5px;
    line-height: 1.4;
  }

  .bp-modal-footer {
    padding: 10px 14px;
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    border-top: 1px solid #282a31;
    background: #15161a;
  }

  .bp-btn {
    height: 28px;
    padding: 0 12px;
    border-radius: 5px;
    font-size: 12px;
    cursor: pointer;
    border: none;
    font-weight: 500;
    transition: opacity 0.12s;
  }

  .bp-btn.cancel {
    background: #282a32;
    color: #d8d9dc;
  }

  .bp-btn.confirm {
    background: #23476d;
    color: #8ec3ff;
  }

  .bp-btn.confirm:hover:not(:disabled) {
    background: #2a5582;
  }

  .bp-btn.danger {
    background: #5a2427;
    color: #f0837f;
  }

  .bp-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
