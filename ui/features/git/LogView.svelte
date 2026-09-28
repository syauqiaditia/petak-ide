<script lang="ts">
  import { onMount } from 'svelte';
  import { gitStore } from './git.svelte';
  import GraphCell from './GraphCell.svelte';
  import type { GitRefLabel } from './types';

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
</div>

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
</style>
