<script lang="ts">
  import type { MergeRequest, Discussion, PipelineInfo, TokenScopeMode } from './types';
  import type { GitDiffFile } from '../git/types';
  import MrFiles from './MrFiles.svelte';
  import MrThread from './MrThread.svelte';
  import MrMergeBar from './MrMergeBar.svelte';
  import { renderMrMarkdown } from './mrMarkdown';

  let {
    mrDetail,
    diffFiles = [],
    discussions = [],
    pipelines = [],
    tokenScope = 'none',
    isMerging = false,
    onCheckoutBranch,
    onRefresh,
    onAddNote,
    onResolveDiscussion,
    onCreateNewThread,
    onApprove,
    onUnapprove,
    onExecuteMerge,
  } = $props<{
    mrDetail: MergeRequest;
    diffFiles: GitDiffFile[];
    discussions: Discussion[];
    pipelines: PipelineInfo[];
    tokenScope: TokenScopeMode;
    isMerging?: boolean;
    onCheckoutBranch?: (iid: number, branch: string) => Promise<string>;
    onRefresh?: () => void;
    onAddNote?: (discussionId: string, body: string) => Promise<void>;
    onResolveDiscussion?: (discussionId: string, resolved: boolean) => Promise<void>;
    onCreateNewThread?: (body: string) => Promise<void>;
    onApprove?: () => Promise<void>;
    onUnapprove?: () => Promise<void>;
    onExecuteMerge?: (params: {
      sha: string;
      squash: boolean;
      shouldRemoveSourceBranch: boolean;
    }) => Promise<void>;
  }>();

  type TabKind = 'overview' | 'changes' | 'discussions';
  let activeTab = $state<TabKind>('overview');
  let checkoutStatus = $state<string | null>(null);
  let isCheckingOut = $state(false);

  let headPipe = $derived(mrDetail.headPipeline || (pipelines.length > 0 ? pipelines[0] : null));

  async function handleCheckout() {
    if (isCheckingOut || !onCheckoutBranch) return;
    isCheckingOut = true;
    checkoutStatus = null;
    try {
      const res = await onCheckoutBranch(mrDetail.iid, mrDetail.sourceBranch);
      checkoutStatus = res || `Berhasil checkout branch 'mr-${mrDetail.iid}'`;
      setTimeout(() => (checkoutStatus = null), 4000);
    } catch (e: any) {
      checkoutStatus = `Gagal checkout: ${e?.message || e}`;
    } finally {
      isCheckingOut = false;
    }
  }

  function formatDate(dStr: string) {
    try {
      const d = new Date(dStr);
      return d.toLocaleDateString('id-ID', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return dStr;
    }
  }
</script>

<div class="mr-detail-container">
  <!-- Top Header Section -->
  <div class="detail-header">
    <div class="title-row">
      <div class="title-left">
        <span class="mr-iid">!{mrDetail.iid}</span>
        <h2 class="mr-title">{mrDetail.title}</h2>
        {#if mrDetail.draft || mrDetail.workInProgress}
          <span class="draft-badge">Draft</span>
        {/if}
        <span
          class="state-pill"
          class:open={mrDetail.state === 'opened'}
          class:merged={mrDetail.state === 'merged'}
          class:closed={mrDetail.state === 'closed'}
        >
          {mrDetail.state === 'opened' ? 'Open' : mrDetail.state === 'merged' ? 'Merged' : 'Closed'}
        </span>
      </div>

      <div class="title-right">
        <button
          class="btn-checkout"
          disabled={isCheckingOut}
          onclick={handleCheckout}
          title="Checkout refspec merge-request ini ke branch lokal 'mr-{mrDetail.iid}'"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="7 10 12 15 17 10"></polyline>
            <line x1="12" y1="15" x2="12" y2="3"></line>
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
          </svg>
          {isCheckingOut ? 'Checking out…' : 'Checkout Branch'}
        </button>

        {#if onRefresh}
          <button class="btn-icon" onclick={onRefresh} title="Segarkan MR">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M23 4v6h-6M1 20v-6h6"></path>
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
            </svg>
          </button>
        {/if}
      </div>
    </div>

    {#if checkoutStatus}
      <div class="checkout-banner">{checkoutStatus}</div>
    {/if}

    <!-- Metadata Row -->
    <div class="meta-row">
      <div class="meta-item author-info">
        <div class="avatar-circle">
          {mrDetail.author.name ? mrDetail.author.name.charAt(0).toUpperCase() : '?'}
        </div>
        <span class="author-name">{mrDetail.author.name || mrDetail.author.username}</span>
      </div>
      <div class="meta-item branch-info">
        <code class="branch-pill source">{mrDetail.sourceBranch}</code>
        <span class="branch-arrow">→</span>
        <code class="branch-pill target">{mrDetail.targetBranch}</code>
      </div>
      <div class="meta-item time-info">
        Dibuat {formatDate(mrDetail.createdAt)}
      </div>

      {#if tokenScope === 'readOnly'}
        <span class="scope-pill">Mode Lihat Saja · Scope: read_api</span>
      {/if}
    </div>

    <!-- Pipeline & Approvals Widget -->
    <div class="status-widgets-bar">
      {#if headPipe}
        <div class="widget-item pipeline-widget" class:success={headPipe.status === 'success'} class:running={headPipe.status === 'running' || headPipe.status === 'pending'} class:failed={headPipe.status === 'failed'}>
          <span class="pipe-icon">
            {#if headPipe.status === 'success'}
              ✓
            {:else if headPipe.status === 'running' || headPipe.status === 'pending'}
              ↻
            {:else if headPipe.status === 'failed'}
              ✗
            {:else}
              ○
            {/if}
          </span>
          <span class="pipe-label">
            Pipeline #{headPipe.id} {headPipe.status}
          </span>
        </div>
      {/if}

      <div class="widget-item commit-sha-widget">
        <span class="sha-label">Head:</span>
        <code class="sha-code">{mrDetail.sha.slice(0, 8)}</code>
      </div>
    </div>

    <!-- Navigation Tabs -->
    <div class="subtabs-bar">
      <button
        class="subtab-btn"
        class:active={activeTab === 'overview'}
        onclick={() => (activeTab = 'overview')}
      >
        Overview
      </button>
      <button
        class="subtab-btn"
        class:active={activeTab === 'changes'}
        onclick={() => (activeTab = 'changes')}
      >
        Perubahan Berkas ({diffFiles.length})
      </button>
      <button
        class="subtab-btn"
        class:active={activeTab === 'discussions'}
        onclick={() => (activeTab = 'discussions')}
      >
        Diskusi ({discussions.length})
      </button>
    </div>
  </div>

  <!-- Main Content Area -->
  <div class="detail-body">
    {#if activeTab === 'overview'}
      <div class="overview-pane">
        {#if mrDetail.description}
          <div class="description-card">
            {@html renderMrMarkdown(mrDetail.description)}
          </div>
        {:else}
          <div class="empty-desc">Tidak ada deskripsi yang ditulis untuk MR ini.</div>
        {/if}
      </div>
    {:else if activeTab === 'changes'}
      <MrFiles
        {diffFiles}
        {tokenScope}
      />
    {:else if activeTab === 'discussions'}
      <MrThread
        {discussions}
        {tokenScope}
        {onAddNote}
        {onResolveDiscussion}
        {onCreateNewThread}
      />
    {/if}
  </div>

  <!-- Bottom Merge Bar (Sticky) -->
  <MrMergeBar
    {mrDetail}
    {tokenScope}
    {isMerging}
    {onApprove}
    {onUnapprove}
    {onExecuteMerge}
  />
</div>

<style>
  .mr-detail-container {
    display: flex;
    flex-direction: column;
    height: 100%;
    width: 100%;
    background: #16171a;
    overflow: hidden;
  }

  .detail-header {
    background: #141518;
    border-bottom: 1px solid #2c2e34;
    padding: 16px 20px 0 20px;
    flex-shrink: 0;
  }

  .title-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .title-left {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }

  .mr-iid {
    font-size: 16px;
    font-weight: 700;
    color: #79c0ff;
  }

  .mr-title {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
    color: #e6edf3;
  }

  .draft-badge {
    background: #30363d;
    color: #8b949e;
    font-size: 11px;
    font-weight: 600;
    padding: 2px 8px;
    border-radius: 12px;
  }

  .state-pill {
    font-size: 11px;
    font-weight: 600;
    padding: 2px 8px;
    border-radius: 12px;
  }

  .state-pill.open {
    background: rgba(126, 231, 135, 0.15);
    color: #7ee787;
    border: 1px solid rgba(126, 231, 135, 0.3);
  }

  .state-pill.merged {
    background: rgba(137, 87, 229, 0.15);
    color: #a371f7;
    border: 1px solid rgba(137, 87, 229, 0.3);
  }

  .state-pill.closed {
    background: rgba(248, 81, 73, 0.15);
    color: #ff7b72;
    border: 1px solid rgba(248, 81, 73, 0.3);
  }

  .title-right {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .btn-checkout {
    display: flex;
    align-items: center;
    gap: 6px;
    background: #23252b;
    border: 1px solid #2c2e34;
    color: #c9cdd4;
    font-size: 12px;
    padding: 5px 12px;
    border-radius: 4px;
    cursor: pointer;
  }

  .btn-checkout:hover:not(:disabled) {
    background: #2b2e36;
    color: #fff;
  }

  .btn-icon {
    background: transparent;
    border: 1px solid #2c2e34;
    color: #8b949e;
    padding: 5px 8px;
    border-radius: 4px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .btn-icon:hover {
    background: #23252b;
    color: #c9cdd4;
  }

  .checkout-banner {
    margin-top: 10px;
    background: #1f242c;
    border: 1px solid #3574f0;
    color: #79c0ff;
    padding: 6px 12px;
    border-radius: 4px;
    font-size: 12px;
  }

  .meta-row {
    display: flex;
    align-items: center;
    gap: 16px;
    margin-top: 10px;
    font-size: 12px;
    color: #8b949e;
    flex-wrap: wrap;
  }

  .author-info {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .avatar-circle {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: #3574f0;
    color: #fff;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 10px;
    font-weight: 600;
  }

  .author-name {
    color: #c9cdd4;
    font-weight: 500;
  }

  .branch-info {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .branch-pill {
    background: #1e2024;
    padding: 2px 6px;
    border-radius: 4px;
    font-family: monospace;
    font-size: 11px;
    color: #79c0ff;
  }

  .branch-arrow {
    color: #6e7681;
  }

  .scope-pill {
    background: rgba(88, 166, 255, 0.15);
    color: #58a6ff;
    border: 1px solid rgba(88, 166, 255, 0.3);
    padding: 2px 8px;
    border-radius: 12px;
    font-size: 11px;
  }

  .status-widgets-bar {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-top: 12px;
    font-size: 11px;
  }

  .widget-item {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 3px 8px;
    border-radius: 4px;
    background: #1a1b1f;
    border: 1px solid #26282d;
  }

  .pipeline-widget.success {
    color: #7ee787;
    border-color: rgba(126, 231, 135, 0.2);
  }

  .pipeline-widget.running {
    color: #79c0ff;
    border-color: rgba(121, 192, 255, 0.2);
  }

  .pipeline-widget.failed {
    color: #ff7b72;
    border-color: rgba(255, 123, 114, 0.2);
  }

  .sha-code {
    font-family: monospace;
    color: #79c0ff;
  }

  .subtabs-bar {
    display: flex;
    gap: 4px;
    margin-top: 14px;
  }

  .subtab-btn {
    background: transparent;
    border: none;
    border-bottom: 2px solid transparent;
    padding: 8px 14px;
    font-size: 12px;
    font-weight: 500;
    color: #8b949e;
    cursor: pointer;
    transition: color 0.15s ease;
  }

  .subtab-btn:hover {
    color: #e6edf3;
  }

  .subtab-btn.active {
    color: #ffffff;
    border-bottom-color: #3574f0;
  }

  .detail-body {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
  }

  .overview-pane {
    padding: 20px;
    max-width: 860px;
  }

  .description-card {
    background: #1a1b1f;
    border: 1px solid #2c2e34;
    border-radius: 6px;
    padding: 16px 20px;
    color: #c9cdd4;
    line-height: 1.6;
    font-size: 13px;
  }

  .empty-desc {
    color: #8b949e;
    font-style: italic;
    font-size: 13px;
    padding: 20px 0;
  }
</style>
