<script lang="ts">
  import type { MergeRequest, MrFilter, TokenScopeMode } from './types';

  let {
    mergeRequests = [],
    activeFilter = 'opened',
    selectedIid = null,
    searchQuery = '',
    isLoading = false,
    tokenScope = 'none',
    isDemoMode = false,
    onSelectFilter,
    onSelectMr,
    onSearchChange,
    onRefresh,
    onEnableDemoMode,
  } = $props<{
    mergeRequests: MergeRequest[];
    activeFilter: MrFilter;
    selectedIid: number | null;
    searchQuery?: string;
    isLoading?: boolean;
    tokenScope: TokenScopeMode;
    isDemoMode?: boolean;
    onSelectFilter?: (filter: MrFilter) => void;
    onSelectMr?: (iid: number) => void;
    onSearchChange?: (q: string) => void;
    onRefresh?: () => void;
    onEnableDemoMode?: () => void;
  }>();

  let searchInput = $state('');

  $effect(() => {
    searchInput = searchQuery;
  });

  function handleSearchInput(e: Event) {
    const val = (e.target as HTMLInputElement).value;
    searchInput = val;
    onSearchChange?.(val);
  }

  function formatDate(dStr: string) {
    try {
      const d = new Date(dStr);
      return d.toLocaleDateString('id-ID', {
        day: 'numeric',
        month: 'short',
      });
    } catch {
      return dStr;
    }
  }
</script>

<div class="mr-list-container">
  <!-- Header Bar -->
  <div class="list-header">
    <div class="header-top">
      <div class="header-title-wrap">
        <span class="header-title">Merge Requests</span>
        {#if isDemoMode}
          <span class="demo-badge">DEMO</span>
        {/if}
      </div>
      {#if onRefresh}
        <button class="btn-refresh" onclick={onRefresh} title="Segarkan daftar MR" disabled={isLoading}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M23 4v6h-6M1 20v-6h6"></path>
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
          </svg>
        </button>
      {/if}
    </div>

    <!-- Filter Tabs -->
    <div class="filter-tabs">
      <button
        class="filter-tab"
        class:active={activeFilter === 'opened'}
        onclick={() => onSelectFilter?.('opened')}
      >
        Open
      </button>
      <button
        class="filter-tab"
        class:active={activeFilter === 'mine'}
        onclick={() => onSelectFilter?.('mine')}
      >
        Mine
      </button>
      <button
        class="filter-tab"
        class:active={activeFilter === 'assigned'}
        onclick={() => onSelectFilter?.('assigned')}
      >
        Assigned
      </button>
      <button
        class="filter-tab"
        class:active={activeFilter === 'reviewer'}
        onclick={() => onSelectFilter?.('reviewer')}
      >
        Review requested
      </button>
    </div>

    <!-- Search Input -->
    <div class="search-bar">
      <svg class="search-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="11" cy="11" r="8"></circle>
        <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
      </svg>
      <input
        type="text"
        placeholder="Cari judul, !iid, branch, author…"
        value={searchInput}
        oninput={handleSearchInput}
      />
      {#if searchInput}
        <button class="clear-search" onclick={() => { searchInput = ''; onSearchChange?.(''); }}>✕</button>
      {/if}
    </div>
  </div>

  <!-- MR Cards List -->
  <div class="list-body">
    {#if tokenScope === 'none' && !isDemoMode}
      <!-- Empty state: Belum ada akun GitLab -->
      <div class="no-token-card">
        <div class="lock-icon">🔒</div>
        <div class="no-token-title">Belum ada akun GitLab</div>
        <div class="no-token-desc">
          Tambahkan Personal Access Token di Settings untuk melihat Merge Request proyek ini.
        </div>
        <div class="no-token-actions">
          <button class="btn-demo-mode" onclick={onEnableDemoMode}>
            Lihat Mode DEMO (Fixture Lokal)
          </button>
        </div>
      </div>
    {:else if isLoading}
      <div class="loading-state">
        <div class="spinner"></div>
        <span>Memuat Merge Requests…</span>
      </div>
    {:else if mergeRequests.length === 0}
      <div class="empty-state">
        <div class="empty-icon">📭</div>
        <div class="empty-title">Tidak ada Merge Request</div>
        <div class="empty-desc">Tidak ada MR terbuka yang cocok dengan filter aktif.</div>
      </div>
    {:else}
      <div class="mr-cards">
        {#each mergeRequests as mr (mr.id)}
          {@const isSelected = mr.iid === selectedIid}
          {@const headPipe = mr.headPipeline}
          <button
            class="mr-card"
            class:selected={isSelected}
            onclick={() => onSelectMr?.(mr.iid)}
          >
            <div class="card-row-top">
              <span class="mr-iid-tag">!{mr.iid}</span>
              <span class="mr-title-text" title={mr.title}>{mr.title}</span>
            </div>

            <div class="card-row-meta">
              <div class="author-tag">
                <span class="avatar-small">
                  {mr.author.name ? mr.author.name.charAt(0).toUpperCase() : '?'}
                </span>
                <span class="author-name">{mr.author.name || mr.author.username}</span>
              </div>
              <div class="branch-tag" title="{mr.sourceBranch} -> {mr.targetBranch}">
                → {mr.targetBranch}
              </div>
            </div>

            <div class="card-row-bottom">
              <div class="pipeline-status">
                {#if headPipe}
                  <span
                    class="pipe-dot"
                    class:success={headPipe.status === 'success'}
                    class:running={headPipe.status === 'running' || headPipe.status === 'pending'}
                    class:failed={headPipe.status === 'failed'}
                    title="Pipeline #{headPipe.id} ({headPipe.status})"
                  ></span>
                  <span class="pipe-text">{headPipe.status}</span>
                {/if}
              </div>
              <span class="card-time">{formatDate(mr.updatedAt)}</span>
            </div>
          </button>
        {/each}
      </div>
    {/if}
  </div>
</div>

<style>
  .mr-list-container {
    width: 330px;
    flex-shrink: 0;
    height: 100%;
    background: #141518;
    border-right: 1px solid #2c2e34;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .list-header {
    padding: 12px 14px 10px 14px;
    border-bottom: 1px solid #26282d;
    background: #111215;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .header-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .header-title-wrap {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .header-title {
    font-size: 13px;
    font-weight: 600;
    color: #e6edf3;
  }

  .demo-badge {
    background: #d29922;
    color: #000;
    font-size: 10px;
    font-weight: 700;
    padding: 1px 6px;
    border-radius: 10px;
  }

  .btn-refresh {
    background: transparent;
    border: none;
    color: #8b949e;
    cursor: pointer;
    padding: 4px;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .btn-refresh:hover:not(:disabled) {
    background: #23252b;
    color: #fff;
  }

  .filter-tabs {
    display: flex;
    background: #1a1b1f;
    padding: 2px;
    border-radius: 5px;
    gap: 2px;
  }

  .filter-tab {
    flex: 1;
    background: transparent;
    border: none;
    color: #8b949e;
    font-size: 11px;
    font-weight: 500;
    padding: 4px 6px;
    border-radius: 4px;
    cursor: pointer;
    text-align: center;
    white-space: nowrap;
    transition: all 0.1s ease;
  }

  .filter-tab:hover {
    color: #c9cdd4;
  }

  .filter-tab.active {
    background: #26282d;
    color: #fff;
    font-weight: 600;
  }

  .search-bar {
    position: relative;
    display: flex;
    align-items: center;
  }

  .search-icon {
    position: absolute;
    left: 8px;
    color: #6e7681;
    pointer-events: none;
  }

  .search-bar input {
    width: 100%;
    background: #1a1b1f;
    border: 1px solid #2c2e34;
    border-radius: 4px;
    padding: 5px 24px 5px 28px;
    font-size: 11px;
    color: #e6edf3;
    outline: none;
    box-sizing: border-box;
  }

  .search-bar input:focus {
    border-color: #3574f0;
  }

  .clear-search {
    position: absolute;
    right: 6px;
    background: transparent;
    border: none;
    color: #6e7681;
    font-size: 10px;
    cursor: pointer;
  }

  .list-body {
    flex: 1;
    overflow-y: auto;
  }

  .no-token-card {
    padding: 30px 16px;
    text-align: center;
    color: #8b949e;
  }

  .lock-icon {
    font-size: 28px;
    margin-bottom: 8px;
  }

  .no-token-title {
    font-size: 13px;
    font-weight: 600;
    color: #e6edf3;
    margin-bottom: 6px;
  }

  .no-token-desc {
    font-size: 11px;
    line-height: 1.4;
    margin-bottom: 16px;
  }

  .btn-demo-mode {
    background: #23252b;
    border: 1px solid #3574f0;
    color: #79c0ff;
    font-size: 11px;
    font-weight: 500;
    padding: 6px 12px;
    border-radius: 4px;
    cursor: pointer;
  }

  .btn-demo-mode:hover {
    background: #3574f0;
    color: #fff;
  }

  .loading-state, .empty-state {
    padding: 40px 16px;
    text-align: center;
    color: #8b949e;
    font-size: 12px;
  }

  .empty-icon {
    font-size: 28px;
    margin-bottom: 6px;
  }

  .empty-title {
    font-size: 13px;
    font-weight: 600;
    color: #c9cdd4;
    margin-bottom: 4px;
  }

  .spinner {
    width: 20px;
    height: 20px;
    border: 2px solid #2c2e34;
    border-top-color: #3574f0;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
    margin: 0 auto 10px auto;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .mr-cards {
    display: flex;
    flex-direction: column;
  }

  .mr-card {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 10px 14px;
    background: transparent;
    border: none;
    border-bottom: 1px solid #1e2024;
    border-left: 2px solid transparent;
    text-align: left;
    cursor: pointer;
    width: 100%;
    transition: background 0.1s ease;
  }

  .mr-card:hover {
    background: #1a1b1f;
  }

  .mr-card.selected {
    background: #23252b;
    border-left-color: #3574f0;
  }

  .card-row-top {
    display: flex;
    align-items: flex-start;
    gap: 6px;
  }

  .mr-iid-tag {
    font-size: 12px;
    font-weight: 700;
    color: #79c0ff;
    flex-shrink: 0;
  }

  .mr-title-text {
    font-size: 12px;
    font-weight: 500;
    color: #e6edf3;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
  }

  .card-row-meta {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 11px;
    color: #8b949e;
  }

  .author-tag {
    display: flex;
    align-items: center;
    gap: 5px;
  }

  .avatar-small {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: #3574f0;
    color: #fff;
    font-size: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .branch-tag {
    font-family: monospace;
    font-size: 10px;
    color: #6e7681;
  }

  .card-row-bottom {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 10px;
    color: #6e7681;
  }

  .pipeline-status {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .pipe-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #8b949e;
  }

  .pipe-dot.success {
    background: #7ee787;
  }

  .pipe-dot.running {
    background: #79c0ff;
  }

  .pipe-dot.failed {
    background: #ff7b72;
  }

  .pipe-text {
    font-size: 10px;
    text-transform: capitalize;
  }
</style>
