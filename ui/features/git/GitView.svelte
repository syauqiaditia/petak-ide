<script lang="ts">
  import { onMount } from 'svelte';
  import { gitStore } from './git.svelte';
  import CommitPanel from './CommitPanel.svelte';
  import DiffView from './DiffView.svelte';
  import BranchPanel from './BranchPanel.svelte';
  import LogView from './LogView.svelte';
  import CommitDetail from './CommitDetail.svelte';
  import ConflictView from './ConflictView.svelte';

  let { folderPath = '' } = $props<{ folderPath?: string }>();

  let activeSubTab = $state<'commit' | 'log' | 'conflict'>(
    typeof window !== 'undefined' && (window.location.search.includes('log') || window.location.search.includes('sub=log'))
      ? 'log'
      : typeof window !== 'undefined' && window.location.search.includes('conflict')
      ? 'conflict'
      : 'commit'
  );

  // Pull dropdown & Push modal state
  let pullDropdownOpen = $state(false);
  let pushModalOpen = $state(false);
  let pushRemoteName = $state('origin');
  let pushBranchName = $state('');
  let pushSetUpstream = $state(false);
  let pushForceWithLease = $state(false);
  let pushLoading = $state(false);
  let pushError = $state<string | null>(null);

  $effect(() => {
    if (gitStore.activeSubTab && gitStore.activeSubTab !== activeSubTab) {
      activeSubTab = gitStore.activeSubTab;
    }
  });

  $effect(() => {
    if (activeSubTab && gitStore.activeSubTab !== activeSubTab) {
      gitStore.activeSubTab = activeSubTab;
    }
  });

  $effect(() => {
    if (folderPath && folderPath !== gitStore.root) {
      gitStore.refresh(folderPath);
    }
  });

  $effect(() => {
    if (gitStore.branch?.head) {
      pushBranchName = gitStore.branch.head;
    }
    if (gitStore.remotes.length > 0 && !gitStore.remotes.some((r) => r.name === pushRemoteName)) {
      pushRemoteName = gitStore.remotes[0].name;
    }
  });

  onMount(() => {
    if (folderPath) {
      gitStore.refresh(folderPath);
    }
  });

  let totalChanges = $derived(
    gitStore.changesEntries.length +
    gitStore.stagedEntries.length +
    gitStore.untrackedEntries.length
  );

  let opRunning = $derived(
    gitStore.opState && gitStore.opState.kind !== 'none'
  );

  let opKindText = $derived(
    gitStore.opState?.kind === 'rebase'
      ? 'Rebasing'
      : gitStore.opState?.kind === 'merge'
      ? 'Merging'
      : gitStore.opState?.kind === 'cherryPick'
      ? 'Cherry-picking'
      : gitStore.opState?.kind === 'revert'
      ? 'Reverting'
      : 'Operation'
  );

  let opStepText = $derived(
    gitStore.opState?.step
      ? `${gitStore.opState.step[0]}/${gitStore.opState.step[1]}`
      : ''
  );

  let conflictCount = $derived(
    gitStore.conflicts.length || gitStore.conflictedEntries.length
  );

  async function handleFetch() {
    await gitStore.fetchRemote();
  }

  async function handlePull(mode: 'rebase' | 'merge') {
    pullDropdownOpen = false;
    await gitStore.pullRemote(mode);
  }

  function openPushModal() {
    pushModalOpen = true;
    pushError = null;
    pushBranchName = gitStore.branch?.head || 'main';
    pushRemoteName = gitStore.remotes[0]?.name || 'origin';
  }

  async function submitPush() {
    pushLoading = true;
    pushError = null;
    try {
      await gitStore.pushRemote(
        pushRemoteName,
        pushBranchName,
        pushSetUpstream,
        pushForceWithLease
      );
      pushModalOpen = false;
    } catch (e: any) {
      pushError = String(e);
    } finally {
      pushLoading = false;
    }
  }
</script>

<div class="git-view">
  <!-- Git Top Bar (Sub-tabs & Remote Actions) -->
  <div class="git-top-bar">
    <div class="tabs-group">
      <button
        class="tab-btn"
        class:active={activeSubTab === 'commit'}
        onclick={() => (activeSubTab = 'commit')}
      >
        Commit
        {#if totalChanges > 0}
          <span class="count-badge">{totalChanges}</span>
        {/if}
      </button>

      <button
        class="tab-btn"
        class:active={activeSubTab === 'log'}
        onclick={() => (activeSubTab = 'log')}
      >
        Log
      </button>

      {#if conflictCount > 0 || opRunning}
        <button
          class="tab-btn conflict-tab"
          class:active={activeSubTab === 'conflict'}
          onclick={() => (activeSubTab = 'conflict')}
        >
          Conflicts
          <span class="count-badge conflict">{conflictCount || '!'}</span>
        </button>
      {/if}
    </div>

    <div class="spacer"></div>

    <!-- Remote Actions Toolbar (Fetch, Pull ▾, Push) -->
    <div class="remote-toolbar">
      <button class="remote-btn" onclick={handleFetch} title="Fetch updates from remotes">
        Fetch
      </button>

      <div class="pull-dropdown-wrapper">
        <button
          class="remote-btn pull-btn"
          onclick={() => (pullDropdownOpen = !pullDropdownOpen)}
          title="Pull from upstream"
        >
          <span>Pull</span>
          <span class="pull-arrow">▾</span>
        </button>

        {#if pullDropdownOpen}
          <div class="pull-menu">
            <button class="pull-item" onclick={() => handlePull('merge')}>
              Pull (Merge)
            </button>
            <button class="pull-item" onclick={() => handlePull('rebase')}>
              Pull (Rebase)
            </button>
          </div>
        {/if}
      </div>

      <button
        class="remote-btn push-btn"
        onclick={openPushModal}
        title="Push commits to remote"
      >
        Push
        {#if gitStore.branch?.ahead && gitStore.branch.ahead > 0}
          <span class="push-count">{gitStore.branch.ahead}</span>
        {/if}
      </button>
    </div>

    <button
      class="refresh-btn"
      onclick={() => gitStore.refresh(folderPath)}
      title="Refresh Git status"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 2v6h-6"></path>
        <path d="M3 12a9 9 0 0 1 15-6.7L21 8"></path>
        <path d="M3 22v-6h6"></path>
        <path d="M21 12a9 9 0 0 1-15 6.7L3 16"></path>
      </svg>
      <span>Refresh</span>
    </button>
  </div>

  <!-- Op State Banner (Rebase / Merge / Cherry-Pick / Revert in progress) -->
  {#if opRunning}
    <div class="op-state-banner">
      <span class="op-icon">⚡</span>
      <span class="op-text">
        <strong>{opKindText}</strong> {opStepText}
        {#if conflictCount > 0}
          — <span class="op-conflict-highlight">{conflictCount} file{conflictCount > 1 ? 's' : ''} in conflict</span>
        {:else}
          — in progress
        {/if}
      </span>
      <div class="spacer"></div>
      <button class="banner-btn abort" onclick={() => gitStore.opAbort()}>
        Abort
      </button>
      {#if conflictCount > 0}
        <button class="banner-btn conflicts" onclick={() => (activeSubTab = 'conflict')}>
          Open Conflicts
        </button>
      {/if}
      <button class="banner-btn continue" onclick={() => gitStore.opContinue()}>
        Continue
      </button>
    </div>
  {/if}

  <!-- Git View Body -->
  <div class="git-view-body">
    {#if activeSubTab === 'commit'}
      <div class="commit-layout">
        <CommitPanel />
        <DiffView />
      </div>
    {:else if activeSubTab === 'log'}
      <div class="log-layout">
        <BranchPanel onSelectTab={(t) => (activeSubTab = t)} />
        <LogView />
        <CommitDetail />
      </div>
    {:else}
      <ConflictView onClose={() => (activeSubTab = 'commit')} />
    {/if}
  </div>

  <!-- Floating Toast with Undo button -->
  {#if gitStore.toast}
    <div class="git-floating-toast {gitStore.toast.type || 'info'}">
      <span class="toast-msg">{gitStore.toast.message}</span>
      {#if gitStore.toast.backupRef}
        <button
          class="toast-undo-btn"
          onclick={() => gitStore.undoBackup(gitStore.toast!.backupRef!)}
          title="Restore repository state before this operation"
        >
          Undo
        </button>
      {/if}
      <button class="toast-close-btn" onclick={() => gitStore.clearToast()}>✕</button>
    </div>
  {/if}

  <!-- Push Modal Dialog -->
  {#if pushModalOpen}
    <div class="push-modal-backdrop" onclick={() => (pushModalOpen = false)} role="presentation">
      <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <div class="push-modal" onclick={(e) => e.stopPropagation()} role="dialog" tabindex="-1">
        <div class="push-modal-header">
          <span>Push to Remote</span>
          <button class="push-close" onclick={() => (pushModalOpen = false)}>✕</button>
        </div>

        {#if pushError}
          <div class="push-error-banner">
            {pushError}
          </div>
        {/if}

        <div class="push-modal-body">
          <div class="form-row">
            <label for="push-remote-select" class="form-label">REMOTE</label>
            <select id="push-remote-select" class="form-select" bind:value={pushRemoteName}>
              {#if gitStore.remotes.length === 0}
                <option value="origin">origin</option>
              {:else}
                {#each gitStore.remotes as r}
                  <option value={r.name}>{r.name} ({r.pushUrl || r.fetchUrl || ''})</option>
                {/each}
              {/if}
            </select>
          </div>

          <div class="form-row">
            <label for="push-branch-input" class="form-label">BRANCH</label>
            <input
              id="push-branch-input"
              type="text"
              class="form-input mono"
              bind:value={pushBranchName}
              placeholder="Branch name..."
            />
          </div>

          <label class="push-check-lbl">
            <input type="checkbox" bind:checked={pushSetUpstream} />
            <span>Set upstream (-u)</span>
          </label>

          <label class="push-check-lbl danger-lbl">
            <input type="checkbox" bind:checked={pushForceWithLease} />
            <span style="color: #f0a6a2; font-weight: 500;">Force with lease (--force-with-lease)</span>
          </label>

          {#if pushForceWithLease}
            <div class="push-force-warning">
              ⚠️ PERINGATAN: Force push akan menimpa commit di remote repository. Pastikan rekan tim mengetahui hal ini!
            </div>
          {/if}
        </div>

        <div class="push-modal-footer">
          <button class="modal-btn cancel" onclick={() => (pushModalOpen = false)}>Cancel</button>
          <button
            class="modal-btn confirm"
            class:danger-btn={pushForceWithLease}
            onclick={submitPush}
            disabled={pushLoading || !pushBranchName.trim()}
          >
            {pushLoading ? 'Pushing…' : pushForceWithLease ? 'Force Push' : 'Push'}
          </button>
        </div>
      </div>
    </div>
  {/if}

  <!-- Commit File Diff Modal / Overlay -->
  {#if gitStore.commitDiffOpen && gitStore.commitDiffFile}
    <div
      class="commit-diff-modal-backdrop"
      onclick={() => gitStore.closeCommitDiff()}
      onkeydown={(e) => e.key === 'Escape' && gitStore.closeCommitDiff()}
      role="button"
      tabindex="0"
    >
      <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
      <div
        class="commit-diff-modal"
        onclick={(e) => e.stopPropagation()}
        onkeydown={(e) => e.stopPropagation()}
        role="dialog"
        tabindex="-1"
      >
        <div class="modal-header">
          <div class="modal-title">
            <span class="mono sha">{gitStore.selectedCommitSha?.slice(0, 7)}</span>
            <span class="modal-path">{gitStore.commitDiffPath}</span>
          </div>
          <button
            class="modal-close-btn"
            onclick={() => gitStore.closeCommitDiff()}
            title="Close diff view"
          >
            ✕
          </button>
        </div>
        <div class="modal-body">
          <DiffView
            diffFile={gitStore.commitDiffFile}
            sourceKind="commit"
            filePath={gitStore.commitDiffPath}
          />
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .git-view {
    flex: 1;
    display: flex;
    flex-direction: column;
    height: 100%;
    min-width: 0;
    background: #16171a;
    overflow: hidden;
  }

  .git-top-bar {
    height: 36px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 14px;
    background: #111215;
    border-bottom: 1px solid #26282d;
    user-select: none;
    -webkit-user-select: none;
  }

  .tabs-group {
    display: flex;
    gap: 4px;
  }

  .tab-btn {
    height: 28px;
    padding: 0 12px;
    border-radius: 6px;
    font-size: 12.5px;
    color: #8b8f98;
    background: transparent;
    display: flex;
    align-items: center;
    gap: 6px;
    transition: all 0.15s;
    cursor: pointer;
  }

  .tab-btn:hover {
    color: #d8d9dc;
    background: #1a1b1f;
  }

  .tab-btn.active {
    background: #23252b;
    color: #e6e7ea;
    font-weight: 500;
  }

  .count-badge {
    font-size: 11px;
    font-weight: 600;
    color: #6ea8ff;
    background: #1f2a3d;
    padding: 1px 6px;
    border-radius: 10px;
  }

  .spacer {
    flex-grow: 1;
  }

  .refresh-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 26px;
    padding: 0 10px;
    font-size: 12px;
    color: #8b8f98;
    border: 1px solid #2c2e34;
    border-radius: 6px;
    transition: all 0.1s;
    cursor: pointer;
  }

  .refresh-btn:hover {
    color: #d8d9dc;
    background: #1a1b1f;
  }

  .git-view-body {
    flex: 1;
    display: flex;
    min-height: 0;
    overflow: hidden;
  }

  .commit-layout {
    flex: 1;
    display: flex;
    min-height: 0;
    overflow: hidden;
  }

  .log-layout {
    flex: 1;
    display: flex;
    min-height: 0;
    overflow: hidden;
    width: 100%;
    height: 100%;
  }

  .commit-diff-modal-backdrop {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.6);
    z-index: 1000;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    backdrop-filter: blur(2px);
  }

  .commit-diff-modal {
    width: 90vw;
    max-width: 1200px;
    height: 85vh;
    background: #141518;
    border: 1px solid #34363d;
    border-radius: 10px;
    box-shadow: 0 20px 50px rgba(0, 0, 0, 0.7);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .modal-header {
    height: 44px;
    padding: 0 16px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: #111215;
    border-bottom: 1px solid #26282d;
    flex-shrink: 0;
  }

  .modal-title {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 13px;
  }

  .modal-title .sha {
    color: #9cc3ff;
    font-size: 12px;
  }

  .modal-path {
    color: #e6e7ea;
    font-weight: 500;
  }

  .modal-close-btn {
    width: 28px;
    height: 28px;
    display: grid;
    place-items: center;
    border-radius: 6px;
    border: none;
    background: transparent;
    color: #8b8f98;
    font-size: 14px;
    cursor: pointer;
  }

  .modal-close-btn:hover {
    background: #23252b;
    color: #ffffff;
  }

  .modal-body {
    flex: 1;
    min-height: 0;
    overflow: hidden;
    display: flex;
  }

  .mono {
    font-family: 'JetBrains Mono', ui-monospace, monospace;
  }

  /* Remote Toolbar */
  .remote-toolbar {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-right: 6px;
  }

  .remote-btn {
    height: 26px;
    padding: 0 10px;
    border-radius: 6px;
    border: 1px solid #2c2e34;
    color: #b9bcc3;
    background: transparent;
    font-size: 12px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    transition: all 0.15s;
  }

  .remote-btn:hover {
    background: #1a1b1f;
    color: #ffffff;
    border-color: #3e4149;
  }

  .remote-btn.push-btn {
    background: #2a3a55;
    color: #cfe0ff;
    border-color: #3a4f75;
    font-weight: 500;
  }

  .remote-btn.push-btn:hover {
    background: #364b6e;
  }

  .push-count {
    background: #1f2a3d;
    color: #7fc98f;
    padding: 0 4px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 600;
  }

  .pull-dropdown-wrapper {
    position: relative;
  }

  .pull-arrow {
    font-size: 10px;
    color: #8b8f98;
  }

  .pull-menu {
    position: absolute;
    top: 100%;
    left: 0;
    margin-top: 4px;
    width: 140px;
    padding: 4px;
    background: #22242a;
    border: 1px solid #34363d;
    border-radius: 8px;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
    display: flex;
    flex-direction: column;
    gap: 1px;
    z-index: 1000;
  }

  .pull-item {
    height: 28px;
    padding: 0 10px;
    border-radius: 5px;
    border: none;
    background: transparent;
    color: #d8d9dc;
    font-size: 12px;
    cursor: pointer;
    text-align: left;
    transition: background 0.1s;
  }

  .pull-item:hover {
    background: #2a3a55;
    color: #e6efff;
  }

  /* Op State Banner */
  .op-state-banner {
    height: 38px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0 16px;
    background: #231c12;
    border-bottom: 1px solid #4a3818;
    color: #f0cf8e;
    font-size: 12.5px;
    user-select: none;
  }

  .op-icon {
    font-size: 14px;
  }

  .op-conflict-highlight {
    color: #f07a74;
    font-weight: 600;
  }

  .banner-btn {
    height: 24px;
    padding: 0 10px;
    border-radius: 5px;
    font-size: 11.5px;
    cursor: pointer;
    border: none;
    transition: all 0.15s;
  }

  .banner-btn.abort {
    background: transparent;
    border: 1px solid #5a3e1a;
    color: #f0cf8e;
  }

  .banner-btn.abort:hover {
    background: #3d2a12;
  }

  .banner-btn.conflicts {
    background: #3d281a;
    border: 1px solid #6b3e20;
    color: #f09574;
    font-weight: 500;
  }

  .banner-btn.conflicts:hover {
    background: #523522;
  }

  .banner-btn.continue {
    background: #e8b45a;
    color: #1a1406;
    font-weight: 600;
  }

  .banner-btn.continue:hover {
    background: #f0cf8e;
  }

  .count-badge.conflict {
    background: #3d1a1a;
    color: #f07a74;
  }

  /* Floating Toast */
  .git-floating-toast {
    position: fixed;
    bottom: 24px;
    right: 24px;
    z-index: 2000;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 16px;
    border-radius: 8px;
    background: #1f232b;
    border: 1px solid #343b47;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
    font-size: 13px;
    color: #d8d9dc;
    animation: toast-in 0.2s ease-out;
  }

  @keyframes toast-in {
    from { opacity: 0; transform: translateY(8px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .git-floating-toast.success {
    border-color: #2e4d35;
    background: #16241b;
    color: #b7e8c3;
  }

  .git-floating-toast.error {
    border-color: #552a2d;
    background: #2a1618;
    color: #f0a6a2;
  }

  .git-floating-toast.warning {
    border-color: #4a3d22;
    background: #241e12;
    color: #f0cf8e;
  }

  .toast-undo-btn {
    height: 24px;
    padding: 0 10px;
    border-radius: 4px;
    border: none;
    background: #6ea8ff;
    color: #0e1a2e;
    font-weight: 600;
    font-size: 12px;
    cursor: pointer;
    transition: background 0.1s;
  }

  .toast-undo-btn:hover {
    background: #8ec0ff;
  }

  .toast-close-btn {
    background: none;
    border: none;
    color: #8b8f98;
    cursor: pointer;
    font-size: 13px;
    padding: 0;
  }

  .toast-close-btn:hover {
    color: #ffffff;
  }

  /* Push Modal */
  .push-modal-backdrop {
    position: fixed;
    inset: 0;
    z-index: 1500;
    background: rgba(0, 0, 0, 0.65);
    display: flex;
    align-items: center;
    justify-content: center;
    backdrop-filter: blur(2px);
  }

  .push-modal {
    width: 460px;
    max-width: 90vw;
    background: #1c1d22;
    border: 1px solid #34363d;
    border-radius: 10px;
    box-shadow: 0 20px 50px rgba(0, 0, 0, 0.6);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .push-modal-header {
    height: 48px;
    padding: 0 18px;
    display: flex;
    align-items: center;
    border-bottom: 1px solid #2a2c32;
    font-weight: 600;
    font-size: 14px;
  }

  .push-close {
    margin-left: auto;
    background: none;
    border: none;
    color: #8b8f98;
    cursor: pointer;
    font-size: 13px;
  }

  .push-error-banner {
    padding: 8px 18px;
    background: #381a1a;
    color: #f0a6a2;
    font-size: 12px;
    border-bottom: 1px solid #4a2222;
  }

  .push-modal-body {
    padding: 16px 18px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .form-row {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .form-label {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.8px;
    color: #8b8f98;
  }

  .form-select, .form-input {
    width: 100%;
    box-sizing: border-box;
    height: 32px;
    background: #141518;
    border: 1px solid #2c2e34;
    border-radius: 6px;
    padding: 0 10px;
    color: #d8d9dc;
    font-size: 12.5px;
    outline: none;
  }

  .push-check-lbl {
    display: flex;
    align-items: center;
    gap: 8px;
    color: #b9bcc3;
    font-size: 12.5px;
    cursor: pointer;
  }

  .push-force-warning {
    padding: 8px 12px;
    border-radius: 6px;
    background: #331a1a;
    border: 1px solid #5a2222;
    color: #f0a6a2;
    font-size: 11.5px;
    line-height: 17px;
  }

  .push-modal-footer {
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

  .modal-btn.confirm {
    background: #2a3a55;
    color: #cfe0ff;
    font-weight: 500;
  }

  .modal-btn.danger-btn {
    background: #8a2424;
    color: #ffffff;
    font-weight: 600;
  }
</style>
