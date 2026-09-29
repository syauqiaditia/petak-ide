<script lang="ts">
  import { onMount } from 'svelte';
  import { gitStore } from './git.svelte';
  import GraphCell from './GraphCell.svelte';
  import RebaseDialog from './RebaseDialog.svelte';
  import type { GitRefLabel, GitCommit, GitOpResult } from '../../lib/api';

  const ROW_HEIGHT = 30;
  const BUFFER = 10;

  let scrollContainer: HTMLDivElement | null = $state(null);
  let scrollTop = $state(0);
  let containerHeight = $state(600);

  // Filter state
  let textQuery = $state('');
  let authorQuery = $state('');
  let pathQuery = $state('');
  let sinceQuery = $state('');
  let untilQuery = $state('');

  let branchDropdownOpen = $state(false);
  let userDropdownOpen = $state(false);
  let dateDropdownOpen = $state(false);
  let pathDropdownOpen = $state(false);

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  // Context Menu & Action Modals state
  let contextMenuVisible = $state(
    typeof window !== 'undefined' && window.location.search.includes('menu')
  );
  let contextMenuPos = $state({ x: 380, y: 120 });
  let resetSubmenuOpen = $state(false);

  let rebaseModalOpen = $state(
    typeof window !== 'undefined' && window.location.search.includes('rebase')
  );
  let rebaseBaseSha = $state(
    typeof window !== 'undefined' && window.location.search.includes('rebase')
      ? 'branch1234567890abcdef1234567890abcdef1'
      : ''
  );

  let squashModalOpen = $state(false);
  let squashMessage = $state('');

  let rewordModalOpen = $state(false);
  let rewordMessage = $state('');

  let dropModalOpen = $state(false);
  let hardResetModalOpen = $state(false);
  let newBranchModalOpen = $state(false);
  let newBranchName = $state('');

  let pushedWarningModalOpen = $state(false);
  let pendingPushedAction: (() => void) | null = null;

  function isConsecutiveSelection(shas: string[], allCommits: GitCommit[]): boolean {
    if (shas.length < 2) return false;
    const indices = shas
      .map((s) => allCommits.findIndex((c) => c.sha === s))
      .filter((idx) => idx !== -1)
      .sort((a, b) => a - b);
    if (indices.length !== shas.length) return false;
    for (let i = 1; i < indices.length; i++) {
      if (indices[i] !== indices[i - 1] + 1) return false;
    }
    return true;
  }

  let selectedCommits = $derived(gitStore.selectedCommits);
  let selectedCount = $derived(selectedCommits.length);
  let isAnyPushed = $derived(selectedCommits.some((c) => c.pushed));
  let hasMergeCommit = $derived(
    selectedCommits.some((c) => c.parents && c.parents.length > 1)
  );
  let isConsecutive = $derived(
    isConsecutiveSelection(gitStore.selectedCommitShas, gitStore.logCommits)
  );

  let canSquash = $derived(selectedCount >= 2 && isConsecutive && !hasMergeCommit);
  let canReword = $derived(selectedCount === 1 && !hasMergeCommit);
  let canFixup = $derived(
    selectedCount === 1 &&
    !hasMergeCommit &&
    gitStore.logCommits.findIndex((c) => c.sha === gitStore.selectedCommitSha) > 0
  );
  let canDrop = $derived(selectedCount >= 1 && !hasMergeCommit);
  let canRebase = $derived(selectedCount === 1 && !hasMergeCommit);

  function handleContextMenu(e: MouseEvent, commit: GitCommit) {
    e.preventDefault();
    e.stopPropagation();

    if (!gitStore.selectedCommitShas.includes(commit.sha)) {
      gitStore.selectCommit(commit.sha);
    }

    const menuWidth = 280;
    const menuHeight = 360;
    const x = Math.min(e.clientX, window.innerWidth - menuWidth - 10);
    const y = Math.min(e.clientY, window.innerHeight - menuHeight - 10);
    contextMenuPos = { x: Math.max(10, x), y: Math.max(10, y) };
    contextMenuVisible = true;
    resetSubmenuOpen = false;
  }

  function handleWindowPointerDown(e: MouseEvent) {
    const target = e.target as HTMLElement;
    if (contextMenuVisible && !target.closest('.commit-context-menu')) {
      contextMenuVisible = false;
      resetSubmenuOpen = false;
    }
  }

  function handleWindowKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      contextMenuVisible = false;
      resetSubmenuOpen = false;
    } else if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'S' || e.key === 's')) {
      if (canSquash) {
        e.preventDefault();
        openSquashModal();
      }
    } else if (e.key === 'F2') {
      if (canReword) {
        e.preventDefault();
        openRewordModal();
      }
    }
  }

  function executeWithPushCheck(action: () => void) {
    if (isAnyPushed) {
      pendingPushedAction = action;
      pushedWarningModalOpen = true;
    } else {
      action();
    }
  }

  function confirmPushedAction() {
    pushedWarningModalOpen = false;
    if (pendingPushedAction) {
      const act = pendingPushedAction;
      pendingPushedAction = null;
      act();
    }
  }

  function openSquashModal() {
    contextMenuVisible = false;
    executeWithPushCheck(() => {
      const sorted = [...gitStore.selectedCommits].reverse();
      squashMessage = sorted.map((c) => c.subject).join('\n\n');
      squashModalOpen = true;
    });
  }

  async function submitSquash() {
    squashModalOpen = false;
    const shas = gitStore.selectedCommitShas;
    await gitStore.squashCommits(shas, squashMessage);
  }

  function openRewordModal() {
    contextMenuVisible = false;
    const commit = gitStore.selectedCommit;
    if (!commit) return;
    executeWithPushCheck(() => {
      rewordMessage = commit.subject;
      rewordModalOpen = true;
    });
  }

  async function submitReword() {
    rewordModalOpen = false;
    const commit = gitStore.selectedCommit;
    if (!commit) return;
    await gitStore.rewordCommit(commit.sha, rewordMessage);
  }

  function handleFixup() {
    contextMenuVisible = false;
    const commit = gitStore.selectedCommit;
    if (!commit) return;
    executeWithPushCheck(async () => {
      await gitStore.fixupCommit(commit.sha);
    });
  }

  function openDropModal() {
    contextMenuVisible = false;
    executeWithPushCheck(() => {
      dropModalOpen = true;
    });
  }

  async function submitDrop() {
    dropModalOpen = false;
    await gitStore.dropCommits(gitStore.selectedCommitShas);
  }

  function openRebaseFromHere() {
    contextMenuVisible = false;
    const commit = gitStore.selectedCommit;
    if (!commit) return;
    executeWithPushCheck(() => {
      const parentSha = commit.parents && commit.parents.length > 0 ? commit.parents[0] : '--root';
      rebaseBaseSha = parentSha;
      rebaseModalOpen = true;
    });
  }

  async function handleCherryPick() {
    contextMenuVisible = false;
    const shas = [...gitStore.selectedCommitShas].reverse();
    await gitStore.cherryPickCommits(shas);
  }

  async function handleRevert() {
    contextMenuVisible = false;
    await gitStore.revertCommits(gitStore.selectedCommitShas);
  }

  function handleReset(mode: 'soft' | 'mixed' | 'hard') {
    contextMenuVisible = false;
    resetSubmenuOpen = false;
    const commit = gitStore.selectedCommit;
    if (!commit) return;

    if (mode === 'hard') {
      executeWithPushCheck(() => {
        hardResetModalOpen = true;
      });
    } else {
      executeWithPushCheck(async () => {
        await gitStore.resetBranch(commit.sha, mode);
      });
    }
  }

  async function submitHardReset() {
    hardResetModalOpen = false;
    const commit = gitStore.selectedCommit;
    if (!commit) return;
    await gitStore.resetBranch(commit.sha, 'hard');
  }

  function openNewBranchModal() {
    contextMenuVisible = false;
    newBranchName = '';
    newBranchModalOpen = true;
  }

  async function submitNewBranch() {
    newBranchModalOpen = false;
    const commit = gitStore.selectedCommit;
    if (!commit || !newBranchName.trim()) return;
    await gitStore.branchCreate(newBranchName.trim(), commit.sha);
  }

  function handleCopyRevision() {
    contextMenuVisible = false;
    const shas = gitStore.selectedCommitShas.join('\n');
    if (navigator?.clipboard) {
      navigator.clipboard.writeText(shas).then(() => {
        gitStore.showToast('Copied revision number to clipboard', { type: 'info' });
      });
    }
  }


  let totalRows = $derived(gitStore.logCommits.length);
  let totalHeight = $derived(totalRows * ROW_HEIGHT);

  let startIndex = $derived(
    Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - BUFFER)
  );
  let endIndex = $derived(
    Math.min(totalRows, Math.ceil((scrollTop + containerHeight) / ROW_HEIGHT) + BUFFER)
  );

  let visibleIndices = $derived(
    Array.from({ length: Math.max(0, endIndex - startIndex) }, (_, i) => startIndex + i)
  );

  let activeBranch = $derived(gitStore.logFilter.branches?.[0] || 'All');

  onMount(() => {
    if (scrollContainer) {
      containerHeight = scrollContainer.clientHeight || 600;
    }
  });

  function handleScroll(e: Event) {
    const el = e.currentTarget as HTMLElement;
    scrollTop = el.scrollTop;
    containerHeight = el.clientHeight;

    // Load next page when scrolling within 300px of bottom
    if (el.scrollHeight - (el.scrollTop + el.clientHeight) < 300) {
      gitStore.loadMoreLog();
    }
  }

  function onTextChange() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      gitStore.setLogFilter({ text: textQuery.trim() || undefined });
    }, 250);
  }

  function applyAuthorFilter() {
    userDropdownOpen = false;
    gitStore.setLogFilter({ author: authorQuery.trim() || undefined });
  }

  function applyDateFilter() {
    dateDropdownOpen = false;
    gitStore.setLogFilter({
      since: sinceQuery.trim() || undefined,
      until: untilQuery.trim() || undefined,
    });
  }

  function applyPathFilter() {
    pathDropdownOpen = false;
    gitStore.setLogFilter({ path: pathQuery.trim() || undefined });
  }

  function selectBranch(branchName: string) {
    branchDropdownOpen = false;
    if (branchName === 'All') {
      gitStore.setLogFilter({ branches: [] });
    } else {
      gitStore.setLogFilter({ branches: [branchName] });
    }
  }

  function formatRelativeDate(timeSec: number): string {
    if (!timeSec) return '';
    const now = Math.floor(Date.now() / 1000);
    const diff = Math.max(0, now - timeSec);
    if (diff < 60) return 'Just now';
    if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
    if (diff < 86400) {
      const h = Math.floor(diff / 3600);
      return `${h} hour${h > 1 ? 's' : ''} ago`;
    }
    if (diff < 172800) return 'Yesterday';
    const d = new Date(timeSec * 1000);
    const currentYear = new Date().getFullYear();
    if (d.getFullYear() === currentYear) {
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    }
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function getRefStyle(ref: GitRefLabel): { bg: string; color: string } {
    if (ref.kind === 'head' || (ref.kind === 'branch' && ref.isCurrent)) {
      return { bg: '#2a3a55', color: '#cfe0ff' };
    }
    if (ref.kind === 'tag') {
      return { bg: '#2e2717', color: '#f0cf8e' };
    }
    if (ref.kind === 'remote') {
      return { bg: '#1f3325', color: '#a8e0b3' };
    }
    return { bg: '#222b38', color: '#9cc3ff' };
  }

  function getAuthorColor(author: string): string {
    if (author === 'You') return '#b9bcc3';
    if (author === 'Claude Code') return '#e8b45a';
    if (author === 'Rina') return '#b9bcc3';
    if (author === 'Dimas') return '#8b8f98';
    return '#8b8f98';
  }
</script>

<div class="log-view">
  <!-- Filter Bar matching Git.html -->
  <div class="filter-bar">
    <div class="search-input-box">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
        <circle cx="11" cy="11" r="6"></circle>
        <path d="M20 20l-4.5-4.5"></path>
      </svg>
      <input
        type="text"
        class="search-input"
        placeholder="Text or hash"
        bind:value={textQuery}
        oninput={onTextChange}
      />
    </div>

    <!-- Branch filter dropdown -->
    <div class="dropdown-wrap">
      <button
        class="filter-btn"
        class:active={activeBranch !== 'All'}
        onclick={() => (branchDropdownOpen = !branchDropdownOpen)}
      >
        Branch: {activeBranch} ▾
      </button>
      {#if branchDropdownOpen}
        <div class="dropdown-menu">
          <button class="menu-item" onclick={() => selectBranch('All')}>All branches</button>
          <div class="menu-divider"></div>
          {#if gitStore.branches?.local}
            {#each gitStore.branches.local as b}
              <button class="menu-item" onclick={() => selectBranch(b.name)}>
                {b.isCurrent ? '★ ' : ''}{b.name}
              </button>
            {/each}
          {/if}
          {#if gitStore.branches?.remote && gitStore.branches.remote.length > 0}
            <div class="menu-divider"></div>
            {#each gitStore.branches.remote as r}
              <button class="menu-item" onclick={() => selectBranch(r.name)}>
                {r.name}
              </button>
            {/each}
          {/if}
        </div>
      {/if}
    </div>

    <!-- User filter dropdown -->
    <div class="dropdown-wrap">
      <button
        class="filter-btn"
        class:active={!!authorQuery}
        onclick={() => (userDropdownOpen = !userDropdownOpen)}
      >
        {authorQuery ? `User: ${authorQuery}` : 'User ▾'}
      </button>
      {#if userDropdownOpen}
        <div class="dropdown-menu p-menu">
          <input
            type="text"
            class="dropdown-input"
            placeholder="Author name..."
            bind:value={authorQuery}
            onkeydown={(e) => e.key === 'Enter' && applyAuthorFilter()}
          />
          <div class="dropdown-actions">
            <button class="action-btn" onclick={applyAuthorFilter}>Filter</button>
            {#if authorQuery}
              <button
                class="action-btn cancel"
                onclick={() => {
                  authorQuery = '';
                  applyAuthorFilter();
                }}
              >
                Clear
              </button>
            {/if}
          </div>
        </div>
      {/if}
    </div>

    <!-- Date filter dropdown -->
    <div class="dropdown-wrap">
      <button
        class="filter-btn"
        class:active={!!sinceQuery || !!untilQuery}
        onclick={() => (dateDropdownOpen = !dateDropdownOpen)}
      >
        Date ▾
      </button>
      {#if dateDropdownOpen}
        <div class="dropdown-menu p-menu">
          <div class="date-row">
            <span class="date-lbl">Since</span>
            <input
              type="text"
              class="dropdown-input"
              placeholder="e.g. 1.week.ago or YYYY-MM-DD"
              bind:value={sinceQuery}
            />
          </div>
          <div class="date-row">
            <span class="date-lbl">Until</span>
            <input
              type="text"
              class="dropdown-input"
              placeholder="e.g. yesterday"
              bind:value={untilQuery}
            />
          </div>
          <div class="dropdown-actions">
            <button class="action-btn" onclick={applyDateFilter}>Apply</button>
            {#if sinceQuery || untilQuery}
              <button
                class="action-btn cancel"
                onclick={() => {
                  sinceQuery = '';
                  untilQuery = '';
                  applyDateFilter();
                }}
              >
                Clear
              </button>
            {/if}
          </div>
        </div>
      {/if}
    </div>

    <!-- Paths filter dropdown -->
    <div class="dropdown-wrap">
      <button
        class="filter-btn"
        class:active={!!pathQuery}
        onclick={() => (pathDropdownOpen = !pathDropdownOpen)}
      >
        {pathQuery ? `Path: ${pathQuery}` : 'Paths ▾'}
      </button>
      {#if pathDropdownOpen}
        <div class="dropdown-menu p-menu">
          <input
            type="text"
            class="dropdown-input"
            placeholder="e.g. src/ or package.json"
            bind:value={pathQuery}
            onkeydown={(e) => e.key === 'Enter' && applyPathFilter()}
          />
          <div class="dropdown-actions">
            <button class="action-btn" onclick={applyPathFilter}>Filter</button>
            {#if pathQuery}
              <button
                class="action-btn cancel"
                onclick={() => {
                  pathQuery = '';
                  applyPathFilter();
                }}
              >
                Clear
              </button>
            {/if}
          </div>
        </div>
      {/if}
    </div>

    <div class="spacer"></div>

    {#if gitStore.logLoading}
      <span class="loading-indicator">Loading…</span>
    {:else}
      <span class="total-commits-badge">{totalRows} commits</span>
    {/if}
  </div>

  <!-- Virtual List Container -->
  <div
    class="virtual-scroll-container"
    bind:this={scrollContainer}
    onscroll={handleScroll}
  >
    {#if gitStore.logError}
      <div class="log-error-banner">
        Error loading git log: {gitStore.logError}
      </div>
    {/if}

    {#if totalRows === 0 && !gitStore.logLoading}
      <div class="empty-log-state">
        No commits match the selected filters
      </div>
    {/if}

    <div class="virtual-canvas" style="height: {totalHeight}px;">
      {#each visibleIndices as idx (idx)}
        {@const commit = gitStore.logCommits[idx]}
        {@const row = gitStore.logGraph[idx]}
        {@const prevRow = idx > 0 ? gitStore.logGraph[idx - 1] : null}
        {@const isSelected = gitStore.selectedCommitShas.includes(commit.sha)}
        {@const isHead = commit.refs?.some((r) => r.kind === 'head')}

        <div
          class="log-row"
          class:selected={isSelected}
          style="top: {idx * ROW_HEIGHT}px;"
          onclick={(e) => gitStore.selectCommit(commit.sha, e.metaKey || e.ctrlKey, e.shiftKey)}
          oncontextmenu={(e) => handleContextMenu(e, commit)}
          role="row"
          tabindex="0"
          onkeydown={(e) => {
            if (e.key === 'Enter') gitStore.selectCommit(commit.sha);
          }}
        >
          <!-- SVG Graph Cell -->
          {#if row}
            <GraphCell {row} {prevRow} {isHead} minWidth={56} />
          {:else}
            <div style="width: 56px; flex-shrink: 0;"></div>
          {/if}

          <!-- Badge refs -->
          {#if commit.refs && commit.refs.length > 0}
            <div class="ref-badges">
              {#each commit.refs as ref}
                {@const style = getRefStyle(ref)}
                <span
                  class="ref-badge"
                  style="background: {style.bg}; color: {style.color};"
                >
                  {#if ref.kind === 'head'}
                    HEAD
                  {:else}
                    {ref.name}
                  {/if}
                </span>
              {/each}
            </div>
          {/if}

          <!-- Subject -->
          <span class="commit-subject" title={commit.subject}>
            {commit.subject}
          </span>

          <!-- Unpushed indicator -->
          {#if !commit.pushed}
            <span class="unpushed-icon" title="Unpushed commit">↑</span>
          {/if}

          <!-- Author -->
          <span
            class="author-name"
            style="color: {getAuthorColor(commit.authorName)};"
            title={commit.authorName}
          >
            {commit.authorName}
          </span>

          <!-- Relative Date -->
          <span class="commit-date">
            {formatRelativeDate(commit.authorTime)}
          </span>

          <!-- Short hash -->
          <span class="commit-sha mono">
            {commit.shortSha}
          </span>
        </div>
      {/each}
    </div>
  </div>

  <!-- Context Menu (matches Git.html) -->
  {#if contextMenuVisible}
    <div
      class="commit-context-menu"
      style="left: {contextMenuPos.x}px; top: {contextMenuPos.y}px;"
      role="menu"
      tabindex="-1"
    >
      <div class="context-header">
        {selectedCount} commit{selectedCount > 1 ? 's' : ''} selected
      </div>

      <button
        class="mi"
        disabled={!canSquash}
        onclick={openSquashModal}
        title={!canSquash ? 'Select ≥ 2 contiguous non-merge commits' : 'Squash commits'}
      >
        <span>Squash Commits…</span>
        <span class="mi-shortcut">⌘⇧S</span>
      </button>

      <button
        class="mi"
        disabled={!canReword}
        onclick={openRewordModal}
        title={!canReword ? 'Select 1 non-merge commit' : 'Edit message'}
      >
        <span>Edit Commit Message…</span>
        <span class="mi-shortcut">F2</span>
      </button>

      <button
        class="mi"
        disabled={!canFixup}
        onclick={handleFixup}
        title={!canFixup ? 'Select 1 commit with a previous commit' : 'Fixup into previous commit'}
      >
        <span>Fixup into Previous</span>
      </button>

      <button
        class="mi danger"
        disabled={!canDrop}
        onclick={openDropModal}
        title={!canDrop ? 'Select non-merge commit(s) to drop' : 'Drop commit(s)'}
      >
        <span>Drop Commits</span>
      </button>

      <div class="menu-sep"></div>

      <button
        class="mi"
        disabled={!canRebase}
        onclick={openRebaseFromHere}
        title={!canRebase ? 'Select 1 non-merge commit' : 'Interactive rebase'}
      >
        <span>Interactively Rebase from Here…</span>
      </button>

      <button
        class="mi"
        disabled={selectedCount === 0}
        onclick={handleCherryPick}
      >
        <span>Cherry-Pick</span>
      </button>

      <button
        class="mi"
        disabled={selectedCount === 0}
        onclick={handleRevert}
      >
        <span>Revert Commits</span>
      </button>

      <!-- Reset Submenu Parent -->
      <div
        class="submenu-parent"
        onmouseenter={() => (resetSubmenuOpen = true)}
        onmouseleave={() => (resetSubmenuOpen = false)}
        role="none"
      >
        <button
          class="mi"
          disabled={selectedCount !== 1}
          onclick={() => (resetSubmenuOpen = !resetSubmenuOpen)}
        >
          <span>Reset Current Branch to Here</span>
          <span class="arrow-right">▸</span>
        </button>

        {#if resetSubmenuOpen && selectedCount === 1}
          <div class="submenu">
            <button class="mi" onclick={() => handleReset('soft')}>
              <span>Soft (keep in index)</span>
            </button>
            <button class="mi" onclick={() => handleReset('mixed')}>
              <span>Mixed (keep in worktree)</span>
            </button>
            <button class="mi danger" onclick={() => handleReset('hard')}>
              <span>Hard (discard — backup ref created)</span>
            </button>
          </div>
        {/if}
      </div>

      <div class="menu-sep"></div>

      <button
        class="mi"
        disabled={selectedCount !== 1}
        onclick={openNewBranchModal}
      >
        <span>New Branch…</span>
      </button>

      <button
        class="mi"
        disabled={selectedCount === 0}
        onclick={handleCopyRevision}
      >
        <span>Copy Revision Number</span>
      </button>

      <div class="menu-sep"></div>

      <!-- Agent Placeholder (Disabled, Phase 5) -->
      <button class="mi agent-disabled" disabled title="Available in Phase 5">
        <span>Write message with agent</span>
        <span class="phase-badge">Phase 5</span>
      </button>
    </div>
  {/if}

  <!-- Interactive Rebase Dialog -->
  {#if rebaseModalOpen}
    <RebaseDialog
      root={gitStore.root}
      baseSha={rebaseBaseSha}
      onClose={() => (rebaseModalOpen = false)}
      onSuccess={(res) => {
        rebaseModalOpen = false;
        gitStore.showToast('Rebase completed', { type: 'success', backupRef: res.backupRef });
        gitStore.refresh();
      }}
    />
  {/if}

  <!-- Squash Modal -->
  {#if squashModalOpen}
    <div class="action-modal-backdrop" onclick={() => (squashModalOpen = false)} role="presentation">
      <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <div class="action-modal" onclick={(e) => e.stopPropagation()} role="dialog" tabindex="-1">
        <div class="action-modal-header">
          <span class="modal-title">Squash {selectedCount} Commits</span>
          <button class="close-x" onclick={() => (squashModalOpen = false)}>✕</button>
        </div>
        {#if isAnyPushed}
          <div class="modal-warning">
            ⚠️ Warning: This commit has already been pushed to remote. You will need force push!
          </div>
        {/if}
        <div class="action-modal-body">
          <label for="squash-combined-msg" class="field-label">COMBINED COMMIT MESSAGE</label>
          <textarea
            id="squash-combined-msg"
            class="modal-textarea mono"
            bind:value={squashMessage}
            rows="6"
            placeholder="Combined message..."
          ></textarea>
        </div>
        <div class="action-modal-footer">
          <button class="modal-btn cancel" onclick={() => (squashModalOpen = false)}>Cancel</button>
          <button class="modal-btn confirm" onclick={submitSquash} disabled={!squashMessage.trim()}>
            Squash Commits
          </button>
        </div>
      </div>
    </div>
  {/if}

  <!-- Reword Modal -->
  {#if rewordModalOpen}
    <div class="action-modal-backdrop" onclick={() => (rewordModalOpen = false)} role="presentation">
      <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <div class="action-modal" onclick={(e) => e.stopPropagation()} role="dialog" tabindex="-1">
        <div class="action-modal-header">
          <span class="modal-title">Edit Commit Message</span>
          <button class="close-x" onclick={() => (rewordModalOpen = false)}>✕</button>
        </div>
        {#if isAnyPushed}
          <div class="modal-warning">
            ⚠️ Warning: This commit has already been pushed to remote. You will need force push!
          </div>
        {/if}
        <div class="action-modal-body">
          <label for="reword-msg-input" class="field-label">COMMIT MESSAGE</label>
          <textarea
            id="reword-msg-input"
            class="modal-textarea mono"
            bind:value={rewordMessage}
            rows="4"
            placeholder="New commit message..."
          ></textarea>
        </div>
        <div class="action-modal-footer">
          <button class="modal-btn cancel" onclick={() => (rewordModalOpen = false)}>Cancel</button>
          <button class="modal-btn confirm" onclick={submitReword} disabled={!rewordMessage.trim()}>
            Save Message
          </button>
        </div>
      </div>
    </div>
  {/if}

  <!-- Drop Confirmation Modal -->
  {#if dropModalOpen}
    <div class="action-modal-backdrop" onclick={() => (dropModalOpen = false)} role="presentation">
      <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <div class="action-modal" onclick={(e) => e.stopPropagation()} role="dialog" tabindex="-1">
        <div class="action-modal-header">
          <span class="modal-title">Drop {selectedCount} Commit{selectedCount > 1 ? 's' : ''}</span>
          <button class="close-x" onclick={() => (dropModalOpen = false)}>✕</button>
        </div>
        <div class="action-modal-body">
          <p>Are you sure you want to drop the {selectedCount} selected commit{selectedCount > 1 ? 's' : ''}?</p>
          <p class="muted-note">An automatic backup will be created in <code>refs/petak/backup/...</code> before rewrite.</p>
          {#if isAnyPushed}
            <div class="modal-warning">
              ⚠️ Warning: This commit is already on remote. Remote history will diverge!
            </div>
          {/if}
        </div>
        <div class="action-modal-footer">
          <button class="modal-btn cancel" onclick={() => (dropModalOpen = false)}>Cancel</button>
          <button class="modal-btn danger-btn" onclick={submitDrop}>
            Drop Commits
          </button>
        </div>
      </div>
    </div>
  {/if}

  <!-- Hard Reset Confirmation Modal (Red Dialog) -->
  {#if hardResetModalOpen}
    <div class="action-modal-backdrop" onclick={() => (hardResetModalOpen = false)} role="presentation">
      <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <div class="action-modal red-danger-modal" onclick={(e) => e.stopPropagation()} role="dialog" tabindex="-1">
        <div class="action-modal-header danger-header">
          <span class="modal-title">⚠️ Confirm Hard Reset</span>
          <button class="close-x" onclick={() => (hardResetModalOpen = false)}>✕</button>
        </div>
        <div class="action-modal-body">
          <p style="color: #f0a6a2; font-weight: 500;">
            All changes in the worktree and commits after {gitStore.selectedCommitSha?.slice(0, 7)} will be DISCARDED!
          </p>
          <p class="muted-note" style="color: #d8d9dc;">
            An automatic backup will be created before resetting (refs/petak/backup/...). You can Undo at any time from the toast button or Backups list.
          </p>
        </div>
        <div class="action-modal-footer">
          <button class="modal-btn cancel" onclick={() => (hardResetModalOpen = false)}>Cancel</button>
          <button class="modal-btn danger-btn" onclick={submitHardReset}>
            Hard Reset Now
          </button>
        </div>
      </div>
    </div>
  {/if}

  <!-- New Branch Modal -->
  {#if newBranchModalOpen}
    <div class="action-modal-backdrop" onclick={() => (newBranchModalOpen = false)} role="presentation">
      <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <div class="action-modal" onclick={(e) => e.stopPropagation()} role="dialog" tabindex="-1">
        <div class="action-modal-header">
          <span class="modal-title">New Branch from {gitStore.selectedCommitSha?.slice(0, 7)}</span>
          <button class="close-x" onclick={() => (newBranchModalOpen = false)}>✕</button>
        </div>
        <div class="action-modal-body">
          <label for="new-branch-name-input" class="field-label">BRANCH NAME</label>
          <input
            id="new-branch-name-input"
            type="text"
            class="modal-input mono"
            bind:value={newBranchName}
            placeholder="e.g. feature/my-new-branch"
            onkeydown={(e) => e.key === 'Enter' && newBranchName.trim() && submitNewBranch()}
          />
        </div>
        <div class="action-modal-footer">
          <button class="modal-btn cancel" onclick={() => (newBranchModalOpen = false)}>Cancel</button>
          <button class="modal-btn confirm" onclick={submitNewBranch} disabled={!newBranchName.trim()}>
            Create Branch
          </button>
        </div>
      </div>
    </div>
  {/if}

  <!-- Pushed Warning Confirmation Modal -->
  {#if pushedWarningModalOpen}
    <div class="action-modal-backdrop" onclick={() => (pushedWarningModalOpen = false)} role="presentation">
      <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <div class="action-modal" onclick={(e) => e.stopPropagation()} role="dialog" tabindex="-1">
        <div class="action-modal-header">
          <span class="modal-title">Commit Already on Remote</span>
          <button class="close-x" onclick={() => (pushedWarningModalOpen = false)}>✕</button>
        </div>
        <div class="action-modal-body">
          <div class="modal-warning" style="margin-bottom: 10px;">
            ⚠️ The selected commit has already been pushed to the remote repository (pushed=true).
          </div>
          <p style="font-size: 13px; line-height: 20px; color: #b9bcc3;">
            Rewriting (squash, reword, drop, or reset) this commit will modify local Git history, requiring <code>git push --force-with-lease</code> to synchronize back.
          </p>
          <p style="font-size: 12.5px; color: #8b8f98;">
            Are you sure you want to proceed with this action?
          </p>
        </div>
        <div class="action-modal-footer">
          <button class="modal-btn cancel" onclick={() => (pushedWarningModalOpen = false)}>Cancel</button>
          <button class="modal-btn confirm" onclick={confirmPushedAction}>
            Proceed
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
  .log-view {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    background: #1a1b1f;
    position: relative;
    height: 100%;
    overflow: hidden;
  }

  .filter-bar {
    height: 40px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 12px;
    border-bottom: 1px solid #26282d;
    background: #141518;
    user-select: none;
  }

  .search-input-box {
    width: 220px;
    height: 28px;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 10px;
    border: 1px solid #2c2e34;
    border-radius: 6px;
    color: #8b8f98;
    background: #18191d;
  }

  .search-input {
    flex: 1;
    background: transparent;
    border: none;
    outline: none;
    color: #d8d9dc;
    font-size: 13px;
  }

  .search-input::placeholder {
    color: #8b8f98;
  }

  .dropdown-wrap {
    position: relative;
  }

  .filter-btn {
    height: 28px;
    padding: 0 10px;
    border-radius: 6px;
    border: none;
    background: transparent;
    color: #b9bcc3;
    font-size: 13px;
    cursor: pointer;
  }

  .filter-btn:hover {
    background: #23252b;
    color: #ffffff;
  }

  .filter-btn.active {
    background: #2a3a55;
    color: #cfe0ff;
  }

  .dropdown-menu {
    position: absolute;
    top: 32px;
    left: 0;
    z-index: 100;
    min-width: 180px;
    background: #22242a;
    border: 1px solid #34363d;
    border-radius: 8px;
    box-shadow: 0 12px 30px rgba(0, 0, 0, 0.5);
    padding: 6px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .dropdown-menu.p-menu {
    padding: 10px;
    width: 240px;
    gap: 8px;
  }

  .menu-item {
    height: 28px;
    padding: 0 10px;
    border-radius: 5px;
    border: none;
    background: transparent;
    color: #d8d9dc;
    text-align: left;
    font-size: 12px;
    cursor: pointer;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .menu-item:hover {
    background: #2a3a55;
    color: #cfe0ff;
  }

  .menu-divider {
    height: 1px;
    background: #34363d;
    margin: 4px 0;
  }

  .dropdown-input {
    width: 100%;
    height: 28px;
    padding: 0 8px;
    background: #18191d;
    border: 1px solid #34363d;
    border-radius: 5px;
    color: #d8d9dc;
    font-size: 12px;
    outline: none;
    box-sizing: border-box;
  }

  .date-row {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .date-lbl {
    font-size: 11px;
    color: #8b8f98;
    text-transform: uppercase;
    font-weight: 500;
  }

  .dropdown-actions {
    display: flex;
    justify-content: flex-end;
    gap: 6px;
    margin-top: 4px;
  }

  .action-btn {
    padding: 4px 10px;
    border-radius: 5px;
    border: none;
    background: #2a3a55;
    color: #cfe0ff;
    font-size: 11px;
    cursor: pointer;
  }

  .action-btn.cancel {
    background: transparent;
    border: 1px solid #34363d;
    color: #8b8f98;
  }

  .action-btn:hover {
    filter: brightness(1.1);
  }

  .spacer {
    flex-grow: 1;
  }

  .loading-indicator {
    color: #9cc3ff;
    font-size: 12px;
    font-style: italic;
  }

  .total-commits-badge {
    color: #8b8f98;
    font-size: 12px;
  }

  .virtual-scroll-container {
    flex: 1;
    overflow-y: auto;
    position: relative;
    height: 100%;
  }

  .virtual-canvas {
    position: relative;
    width: 100%;
  }

  .log-row {
    position: absolute;
    left: 0;
    right: 0;
    height: 30px;
    display: flex;
    align-items: center;
    padding-right: 14px;
    gap: 10px;
    white-space: nowrap;
    cursor: pointer;
    user-select: none;
    font-size: 13px;
    color: #d8d9dc;
    box-sizing: border-box;
  }

  .log-row:hover {
    background: #1c1d22;
  }

  .log-row.selected {
    background: #243552;
    color: #e6efff;
  }

  .ref-badges {
    display: flex;
    gap: 6px;
    flex-shrink: 0;
  }

  .ref-badge {
    font-size: 11px;
    border-radius: 4px;
    padding: 1px 6px;
    font-weight: 500;
  }

  .commit-subject {
    flex-grow: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 100px;
  }

  .unpushed-icon {
    color: #7fc98f;
    font-size: 12px;
    font-weight: 600;
    flex-shrink: 0;
  }

  .author-name {
    width: 100px;
    font-size: 12px;
    overflow: hidden;
    text-overflow: ellipsis;
    flex-shrink: 0;
  }

  .commit-date {
    color: #8b8f98;
    width: 90px;
    text-align: right;
    font-size: 12px;
    flex-shrink: 0;
  }

  .commit-sha {
    color: #8b8f98;
    width: 60px;
    text-align: right;
    font-size: 11px;
    flex-shrink: 0;
  }

  .mono {
    font-family: 'JetBrains Mono', ui-monospace, monospace;
  }

  .empty-log-state {
    padding: 32px;
    text-align: center;
    color: #8b8f98;
    font-size: 13px;
  }

  .log-error-banner {
    padding: 8px 14px;
    background: #381a1a;
    color: #f0a6a2;
    font-size: 12px;
    border-bottom: 1px solid #4a2222;
  }

  /* Context Menu (matches Git.html) */
  .commit-context-menu {
    position: fixed;
    width: 280px;
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

  .context-header {
    padding: 4px 12px 6px;
    font-size: 11px;
    color: #8b8f98;
    font-weight: 500;
  }

  .mi {
    display: flex;
    align-items: center;
    height: 28px;
    padding: 0 12px;
    border-radius: 5px;
    justify-content: space-between;
    gap: 16px;
    font-size: 12.5px;
    color: #d8d9dc;
    background: none;
    border: 0;
    cursor: pointer;
    width: 100%;
    text-align: left;
    transition: background 0.1s, color 0.1s;
  }

  .mi:hover:not(:disabled) {
    background: #2a3a55;
    color: #e6efff;
  }

  .mi:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }

  .mi.danger {
    color: #f0a6a2;
  }

  .mi.danger:hover:not(:disabled) {
    background: #3a2022;
    color: #f0a6a2;
  }

  .mi-shortcut {
    color: #8b8f98;
    font-size: 11.5px;
  }

  .mi:hover:not(:disabled) .mi-shortcut {
    color: #9cc3ff;
  }

  .menu-sep {
    height: 1px;
    background: #34363d;
    margin: 4px 6px;
  }

  .submenu-parent {
    position: relative;
    width: 100%;
  }

  .arrow-right {
    font-size: 11px;
    color: #8b8f98;
  }

  .submenu {
    position: absolute;
    left: 100%;
    top: -4px;
    width: 240px;
    padding: 6px;
    background: #22242a;
    border: 1px solid #34363d;
    border-radius: 10px;
    box-shadow: 0 16px 40px rgba(0, 0, 0, 0.55);
    display: flex;
    flex-direction: column;
    gap: 1px;
    z-index: 1001;
  }

  .agent-disabled {
    color: #e8b45a !important;
    opacity: 0.55 !important;
  }

  .phase-badge {
    font-size: 10px;
    padding: 1px 5px;
    border-radius: 4px;
    background: #2e2717;
    color: #f0cf8e;
    border: 1px solid #4a3d22;
  }

  /* Action Modals */
  .action-modal-backdrop {
    position: fixed;
    inset: 0;
    z-index: 1000;
    background: rgba(0, 0, 0, 0.65);
    display: flex;
    align-items: center;
    justify-content: center;
    backdrop-filter: blur(2px);
  }

  .action-modal {
    width: 480px;
    max-width: 90vw;
    background: #1c1d22;
    border: 1px solid #34363d;
    border-radius: 10px;
    box-shadow: 0 20px 50px rgba(0, 0, 0, 0.6);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .action-modal.red-danger-modal {
    border-color: #6d2d2a;
  }

  .action-modal-header {
    height: 48px;
    padding: 0 18px;
    display: flex;
    align-items: center;
    border-bottom: 1px solid #2a2c32;
    font-weight: 600;
    font-size: 14px;
  }

  .action-modal-header.danger-header {
    background: #281515;
    color: #f0a6a2;
    border-bottom-color: #4a2222;
  }

  .close-x {
    margin-left: auto;
    background: none;
    border: none;
    color: #8b8f98;
    cursor: pointer;
    font-size: 14px;
    padding: 4px;
  }

  .close-x:hover {
    color: #ffffff;
  }

  .action-modal-body {
    padding: 16px 18px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    font-size: 13px;
  }

  .field-label {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.8px;
    color: #8b8f98;
  }

  .modal-textarea {
    width: 100%;
    box-sizing: border-box;
    background: #141518;
    border: 1px solid #2c2e34;
    border-radius: 6px;
    padding: 10px;
    color: #d8d9dc;
    font-size: 12.5px;
    line-height: 18px;
    resize: vertical;
    outline: none;
  }

  .modal-textarea:focus {
    border-color: #3a4f75;
  }

  .modal-input {
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

  .modal-input:focus {
    border-color: #3a4f75;
  }

  .modal-warning {
    padding: 8px 12px;
    border-radius: 6px;
    background: #2e2717;
    border: 1px solid #4a3d22;
    color: #f0cf8e;
    font-size: 12px;
    line-height: 18px;
  }

  .muted-note {
    color: #8b8f98;
    font-size: 12px;
    margin: 0;
  }

  .action-modal-footer {
    height: 52px;
    padding: 0 18px;
    background: #18191d;
    border-top: 1px solid #2a2c32;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
  }

  .modal-btn {
    height: 32px;
    padding: 0 14px;
    border-radius: 6px;
    font-size: 12.5px;
    cursor: pointer;
    border: none;
    transition: all 0.15s;
  }

  .modal-btn.cancel {
    background: transparent;
    color: #b9bcc3;
    border: 1px solid #2c2e34;
  }

  .modal-btn.cancel:hover {
    background: #23252b;
    color: #ffffff;
  }

  .modal-btn.confirm {
    background: #2a3a55;
    color: #cfe0ff;
    font-weight: 500;
  }

  .modal-btn.confirm:hover:not(:disabled) {
    background: #364b6e;
  }

  .modal-btn.confirm:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .modal-btn.danger-btn {
    background: #6d2424;
    color: #ffe6e6;
    font-weight: 500;
  }

  .modal-btn.danger-btn:hover {
    background: #8b2e2e;
  }
</style>
