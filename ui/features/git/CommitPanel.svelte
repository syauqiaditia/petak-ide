<script lang="ts">
  import { onMount } from 'svelte';
  import { gitStore } from './git.svelte.ts';
  import { api } from '../../lib/api';
  import type { GitStatusEntry } from './types.ts';
  import {
    isAllSelected,
    isPartiallySelected,
    planSelectAllToggle,
    getFileContextActions,
    getCommitButtonLabel,
    canExecuteCommit,
    isEntryStaged,
    isEntryUntracked,
    filterUnifiedChanges,
    filterTrackedChanges,
    filterUnversionedFiles,
    formatGroupHeader,
    countCheckedEntries,
    getUnifiedStatusLetter,
    type FileContextAction,
  } from './commitSelectionLogic';
  import StashModal from './StashModal.svelte';

  let commitMessage = $state('');
  let isAmend = $state(false);
  let isCommitting = $state(false);
  let commitError = $state<string | null>(null);

  let changesExpanded = $state(true);
  let unversionedExpanded = $state(true);

  let contextMenuOpen = $state(
    typeof window !== 'undefined' && window.location.search.includes('ctx-menu')
  );
  let contextMenuPos = $state<{ x: number; y: number }>({ x: 180, y: 160 });
  let contextTargetEntry = $state<GitStatusEntry | null>(null);
  let contextTargetStaged = $state(false);

  let emptyContextMenuOpen = $state(false);
  let emptyContextMenuPos = $state<{ x: number; y: number }>({ x: 0, y: 0 });
  let stashModalOpen = $state(false);
  let stashModalMode = $state<'push' | 'list'>('push');

  function handleEmptyAreaContextMenu(e: MouseEvent) {
    const target = e.target as HTMLElement;
    if (target.closest('.file-row')) return;

    e.preventDefault();
    e.stopPropagation();
    contextMenuOpen = false;
    emptyContextMenuPos = { x: e.clientX, y: e.clientY };
    emptyContextMenuOpen = true;
  }

  async function handlePopLatestStash() {
    emptyContextMenuOpen = false;
    if (!gitStore.root) return;
    try {
      const res = await api.gitStashPop(gitStore.root, 0);
      gitStore.showToast(res || 'Popped latest stash', { type: 'success' });
      await gitStore.refresh();
    } catch (e: any) {
      gitStore.showToast(`Failed to pop stash: ${e?.message || e}`, { type: 'error' });
    }
  }

  $effect(() => {
    if (contextMenuOpen && !contextTargetEntry && gitStore.status.entries.length > 0) {
      contextTargetEntry = gitStore.status.entries[0];
    }
  });

  let allChanges = $derived(filterUnifiedChanges(gitStore.status?.entries || []));
  let trackedChanges = $derived(filterTrackedChanges(gitStore.status?.entries || []));
  let unversionedFiles = $derived(filterUnversionedFiles(gitStore.status?.entries || []));

  let totalFiles = $derived(allChanges.length);
  let allFilePaths = $derived(allChanges.map((e) => e.path));
  let checkedCount = $derived(allChanges.filter((e) => gitStore.isPathChecked(e.path)).length);
  let checkedPaths = $derived(allChanges.filter((e) => gitStore.isPathChecked(e.path)).map((e) => e.path));
  let stagedPaths = $derived(checkedPaths);

  let allSelected = $derived(totalFiles > 0 && checkedCount === totalFiles);
  let partiallySelected = $derived(checkedCount > 0 && checkedCount < totalFiles);

  let trackedCheckedCount = $derived(trackedChanges.filter((e) => gitStore.isPathChecked(e.path)).length);
  let trackedAllSelected = $derived(trackedChanges.length > 0 && trackedCheckedCount === trackedChanges.length);
  let trackedPartiallySelected = $derived(trackedCheckedCount > 0 && trackedCheckedCount < trackedChanges.length);

  let unversionedCheckedCount = $derived(unversionedFiles.filter((e) => gitStore.isPathChecked(e.path)).length);
  let unversionedAllSelected = $derived(unversionedFiles.length > 0 && unversionedCheckedCount === unversionedFiles.length);
  let unversionedPartiallySelected = $derived(unversionedCheckedCount > 0 && unversionedCheckedCount < unversionedFiles.length);

  let canCommit = $derived(
    canExecuteCommit(checkedCount, commitMessage, isAmend, isCommitting)
  );
  let commitBtnLabel = $derived(
    getCommitButtonLabel(checkedCount, isAmend, isCommitting)
  );

  function handleToggleSelectAll() {
    const shouldCheckAll = checkedCount !== totalFiles;
    gitStore.setAllPathsChecked(allFilePaths, shouldCheckAll);
  }

  function handleToggleTrackedAll() {
    const shouldCheck = trackedCheckedCount !== trackedChanges.length;
    gitStore.setAllPathsChecked(trackedChanges.map((e) => e.path), shouldCheck);
  }

  function handleToggleUnversionedAll() {
    const shouldCheck = unversionedCheckedCount !== unversionedFiles.length;
    gitStore.setAllPathsChecked(unversionedFiles.map((e) => e.path), shouldCheck);
  }

  function handleToggleFile(entry: GitStatusEntry, e: MouseEvent) {
    e.stopPropagation();
    gitStore.togglePathChecked(entry.path);
  }

  function handleRowContextMenu(e: MouseEvent, entry: GitStatusEntry, inStaged: boolean) {
    e.preventDefault();
    e.stopPropagation();
    contextTargetEntry = entry;
    contextTargetStaged = inStaged;
    contextMenuPos = { x: e.clientX, y: e.clientY };
    contextMenuOpen = true;
  }

  let contextActions = $derived(
    contextTargetEntry
      ? getFileContextActions(
          contextTargetEntry.path,
          contextTargetStaged,
          contextTargetEntry.worktree === 'untracked'
        )
      : []
  );

  async function handleContextAction(actionId: string) {
    if (!contextTargetEntry) return;
    const path = contextTargetEntry.path;
    const isUntracked = contextTargetEntry.worktree === 'untracked';
    contextMenuOpen = false;

    switch (actionId) {
      case 'add_to_vcs':
        await gitStore.stageFiles([path]);
        break;
      case 'rollback':
        await gitStore.rollback([path]);
        break;
      case 'goto_file':
      case 'show_diff':
        gitStore.selectFile(path, contextTargetStaged ? 'staged' : 'worktree');
        break;
      case 'toggle_stage':
        gitStore.togglePathChecked(path);
        break;
      case 'gitignore_add':
        if (gitStore.root) {
          await api.gitGitignoreAdd(gitStore.root, path);
          await gitStore.refresh();
        }
        break;
      case 'show_history':
        gitStore.setLogFilter({ path });
        gitStore.activeSubTab = 'log';
        break;
      case 'copy_path':
        if (typeof navigator !== 'undefined' && navigator.clipboard) {
          await navigator.clipboard.writeText(path);
        }
        break;
      case 'reveal_finder':
        if (gitStore.root) {
          const fullPath = `${gitStore.root}/${path}`;
          api.showInFolder(fullPath).catch(() => {});
        }
        break;
      case 'delete_untracked':
        if (gitStore.root && isUntracked) {
          const ok = window.confirm(`Delete untracked file "${path}"?`);
          if (ok) {
            await api.gitDeleteUntracked(gitStore.root, path);
            await gitStore.refresh();
          }
        }
        break;
    }
  }

  let lines = $derived(commitMessage.split('\n'));
  let subject = $derived(lines[0] ?? '');
  let subjectLen = $derived(subject.length);
  let hasLine2Warning = $derived(lines.length > 1 && lines[1].trim().length > 0);

  async function handleAmendToggle(e: Event) {
    const checked = (e.target as HTMLInputElement).checked;
    isAmend = checked;
    if (checked && commitMessage.trim().length === 0) {
      try {
        const last = await gitStore.getLastMessage();
        if (last) {
          commitMessage = last;
        }
      } catch (err) {
        console.warn('Failed to load last message:', err);
      }
    }
  }

  async function doCommit() {
    if (!canCommit) return;
    isCommitting = true;
    commitError = null;
    try {
      if (gitStore.root) {
        await api.gitCommitPaths(gitStore.root, checkedPaths, commitMessage.trim(), isAmend);
        await gitStore.refresh();
      } else {
        await gitStore.commit(commitMessage.trim(), isAmend);
      }
      commitMessage = '';
      isAmend = false;
    } catch (e: any) {
      commitError = String(e?.message || e);
    } finally {
      isCommitting = false;
    }
  }

  function getStatusLetter(entry: GitStatusEntry, inStaged: boolean): { char: string; color: string } {
    if (entry.conflicted) {
      return { char: '!', color: '#e8b45a' };
    }
    const state = inStaged ? entry.index : entry.worktree;
    switch (state) {
      case 'modified':
        return { char: 'M', color: '#58a6ff' };
      case 'added':
        return { char: 'A', color: '#4ade80' };
      case 'deleted':
        return { char: 'D', color: '#f07a74' };
      case 'renamed':
        return { char: 'R', color: '#6ea8ff' };
      case 'copied':
        return { char: 'C', color: '#4ade80' };
      case 'untracked':
        return { char: '?', color: '#4ade80' };
      case 'ignored':
        return { char: '', color: '#606470' };
      default:
        return { char: 'M', color: '#d8d9dc' };
    }
  }

  function formatPath(filePath: string) {
    const parts = filePath.split('/');
    const name = parts.pop() || filePath;
    const dir = parts.join('/');
    return { name, dir };
  }
</script>

<svelte:window onclick={() => { contextMenuOpen = false; emptyContextMenuOpen = false; }} />

<div class="commit-panel">
  <!-- Select All Bar (F3 / Feature C) -->
  {#if totalFiles > 0}
    <div class="select-all-bar">
      <label class="select-all-label">
        <input
          type="checkbox"
          class="file-checkbox"
          checked={allSelected}
          indeterminate={partiallySelected}
          onchange={handleToggleSelectAll}
        />
        <span class="select-all-text">Select All ({checkedCount}/{totalFiles})</span>
      </label>
    </div>
  {/if}

  <!-- Grouped Changes List (Changes & Unversioned Files ala Android Studio) -->
  <div class="files-container" oncontextmenu={handleEmptyAreaContextMenu}>
    <!-- Tracked Changes Group -->
    <div class="group-section">
      <div class="group-header">
        <div class="group-header-left">
          <button
            type="button"
            class="collapse-btn"
            onclick={() => (changesExpanded = !changesExpanded)}
            aria-label="Toggle Changes"
          >
            <span class="chevron" class:expanded={changesExpanded}>▶</span>
          </button>
          <label class="group-header-label">
            <input
              type="checkbox"
              class="file-checkbox"
              checked={trackedAllSelected}
              indeterminate={trackedPartiallySelected}
              disabled={trackedChanges.length === 0}
              onchange={handleToggleTrackedAll}
              title={trackedAllSelected ? "Deselect Changes" : "Select Changes"}
            />
            <span class="group-title">{formatGroupHeader('Changes', trackedChanges.length)}</span>
          </label>
        </div>
      </div>

      {#if changesExpanded}
        <div class="group-list">
          {#if trackedChanges.length === 0}
            <div class="empty-hint">No changes</div>
          {:else}
            {#each trackedChanges as entry (entry.path)}
              {@const isChecked = gitStore.isPathChecked(entry.path)}
              {@const { char, color } = getUnifiedStatusLetter(entry)}
              {@const { name, dir } = formatPath(entry.path)}
              {@const isSelected = gitStore.selectedFile?.path === entry.path}
              <div
                class="file-row"
                class:selected={isSelected}
                class:conflicted={entry.conflicted}
                onclick={() => gitStore.selectFile(entry.path, isEntryStaged(entry) ? 'staged' : 'worktree')}
                oncontextmenu={(e) => handleRowContextMenu(e, entry, isEntryStaged(entry))}
                role="button"
                tabindex="0"
                onkeydown={(e) => {
                  if (e.key === 'Enter') gitStore.selectFile(entry.path, isEntryStaged(entry) ? 'staged' : 'worktree');
                }}
              >
                <input
                  type="checkbox"
                  class="file-checkbox"
                  checked={isChecked}
                  title={isChecked ? "Uncheck to exclude from commit" : "Check to include in commit"}
                  onclick={(e) => handleToggleFile(entry, e)}
                />
                <span class="file-name" style="color: {color};" title={entry.path}>{name}</span>
                {#if entry.conflicted}
                  <span class="conflict-tag">conflict</span>
                {:else if dir}
                  <span class="file-dir">{dir}</span>
                {/if}
              </div>
            {/each}
          {/if}
        </div>
      {/if}
    </div>

    <!-- Unversioned Files Group -->
    {#if unversionedFiles.length > 0}
      <div class="group-section unversioned-section">
        <div class="group-header">
          <div class="group-header-left">
            <button
              type="button"
              class="collapse-btn"
              onclick={() => (unversionedExpanded = !unversionedExpanded)}
              aria-label="Toggle Unversioned Files"
            >
              <span class="chevron" class:expanded={unversionedExpanded}>▶</span>
            </button>
            <label class="group-header-label">
              <input
                type="checkbox"
                class="file-checkbox"
                checked={unversionedAllSelected}
                indeterminate={unversionedPartiallySelected}
                disabled={unversionedFiles.length === 0}
                onchange={handleToggleUnversionedAll}
                title={unversionedAllSelected ? "Deselect Unversioned Files" : "Select Unversioned Files"}
              />
              <span class="group-title">{formatGroupHeader('Unversioned Files', unversionedFiles.length)}</span>
            </label>
          </div>
        </div>

        {#if unversionedExpanded}
          <div class="group-list">
            {#each unversionedFiles as entry (entry.path)}
              {@const isChecked = gitStore.isPathChecked(entry.path)}
              {@const { char, color } = getUnifiedStatusLetter(entry)}
              {@const { name, dir } = formatPath(entry.path)}
              {@const isSelected = gitStore.selectedFile?.path === entry.path}
              <div
                class="file-row"
                class:selected={isSelected}
                class:conflicted={entry.conflicted}
                onclick={() => gitStore.selectFile(entry.path, isEntryStaged(entry) ? 'staged' : 'worktree')}
                oncontextmenu={(e) => handleRowContextMenu(e, entry, isEntryStaged(entry))}
                role="button"
                tabindex="0"
                onkeydown={(e) => {
                  if (e.key === 'Enter') gitStore.selectFile(entry.path, isEntryStaged(entry) ? 'staged' : 'worktree');
                }}
              >
                <input
                  type="checkbox"
                  class="file-checkbox"
                  checked={isChecked}
                  title={isChecked ? "Uncheck to exclude from commit" : "Check to include in commit"}
                  onclick={(e) => handleToggleFile(entry, e)}
                />
                <span class="file-name" style="color: {color};" title={entry.path}>{name}</span>
                {#if dir}
                  <span class="file-dir">{dir}</span>
                {/if}
              </div>
            {/each}
          </div>
        {/if}
      </div>
    {/if}
  </div>

  <!-- Commit Box at Bottom -->
  <div class="commit-box">
    <div class="commit-box-header">
      <span class="commit-label">COMMIT MESSAGE</span>
      <span class="counter" class:over-limit={subjectLen > 50}>
        {subjectLen}/50
      </span>
    </div>

    <textarea
      class="message-input"
      bind:value={commitMessage}
      placeholder="feat: concise commit subject&#10;&#10;Detailed explanation (optional)..."
      rows="4"
    ></textarea>

    {#if hasLine2Warning}
      <div class="hint-warning">
        ⚠️ Line 2 should be empty (separates subject & description).
      </div>
    {/if}

    <div class="conventional-hint">
      Format: <code>feat:</code>, <code>fix:</code>, <code>chore:</code>, <code>docs:</code>, <code>refactor:</code>
    </div>

    {#if commitError}
      <div class="commit-error-msg">{commitError}</div>
    {/if}

    <div class="commit-actions-row">
      <label class="amend-label" title="Amend previous commit">
        <input
          type="checkbox"
          checked={isAmend}
          onchange={handleAmendToggle}
        />
        <span>Amend</span>
      </label>

      <button
        class="agent-msg-btn"
        disabled
        title="Phase 5 — Write commit message with AI agent"
      >
        ✨ Write with agent
      </button>

      <button
        class="commit-btn"
        disabled={!canCommit}
        onclick={doCommit}
      >
        {commitBtnLabel}
      </button>
    </div>
  </div>

  <!-- Context Menu (F3) -->
  {#if contextMenuOpen}
    <div
      class="file-context-menu"
      style:left="{contextMenuPos.x}px"
      style:top="{contextMenuPos.y}px"
      role="menu"
      tabindex="-1"
      onclick={(e) => e.stopPropagation()}
    >
      {#each contextActions as action}
        <button
          class="context-menu-item"
          class:danger={action.danger}
          onclick={() => handleContextAction(action.id)}
        >
          {action.label}
        </button>
      {/each}
    </div>
  {/if}

  <!-- Empty Area Context Menu for Stash (Item 11) -->
  {#if emptyContextMenuOpen}
    <div
      class="file-context-menu"
      style:left="{emptyContextMenuPos.x}px"
      style:top="{emptyContextMenuPos.y}px"
      role="menu"
      tabindex="-1"
      onclick={(e) => e.stopPropagation()}
    >
      <button
        class="context-menu-item"
        onclick={() => {
          emptyContextMenuOpen = false;
          stashModalMode = 'push';
          stashModalOpen = true;
        }}
      >
        Stash Changes…
      </button>
      <button
        class="context-menu-item"
        onclick={handlePopLatestStash}
      >
        Pop Latest Stash
      </button>
      <button
        class="context-menu-item"
        onclick={() => {
          emptyContextMenuOpen = false;
          stashModalMode = 'list';
          stashModalOpen = true;
        }}
      >
        View Stashes…
      </button>
    </div>
  {/if}

  <!-- Stash Modal Dialog -->
  {#if stashModalOpen && gitStore.root}
    <StashModal
      root={gitStore.root}
      initialMode={stashModalMode}
      onclose={() => (stashModalOpen = false)}
    />
  {/if}
</div>

<style>
  .commit-panel {
    width: 320px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    background: #141518;
    border-right: 1px solid #26282d;
    height: 100%;
    overflow: hidden;
    user-select: none;
    -webkit-user-select: none;
    font-size: 13px;
  }

  .select-all-bar {
    height: 30px;
    display: flex;
    align-items: center;
    padding: 0 12px;
    background: #17181c;
    border-bottom: 1px solid #23252a;
    flex-shrink: 0;
  }
  .select-all-label {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 11.5px;
    font-weight: 500;
    color: #a0a4ad;
    cursor: pointer;
    user-select: none;
  }
  .select-all-text {
    letter-spacing: 0.2px;
  }
  .group-header-label {
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
    user-select: none;
  }
  .file-checkbox {
    width: 14px;
    height: 14px;
    accent-color: #6ea8ff;
    cursor: pointer;
    flex-shrink: 0;
    margin: 0;
  }

  .file-context-menu {
    position: fixed;
    width: 180px;
    background: #1e2025;
    border: 1px solid #34363d;
    border-radius: 6px;
    box-shadow: 0 10px 28px rgba(0, 0, 0, 0.55);
    z-index: 2000;
    padding: 4px 0;
    display: flex;
    flex-direction: column;
  }
  .context-menu-item {
    padding: 6px 12px;
    font-size: 12px;
    color: #d8d9dc;
    background: transparent;
    border: none;
    text-align: left;
    cursor: pointer;
    transition: background 0.1s;
  }
  .context-menu-item:hover {
    background: #272a32;
    color: #ffffff;
  }
  .context-menu-item.danger {
    color: #f07a74;
  }
  .context-menu-item.danger:hover {
    background: #361d1e;
  }

  .files-container {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
  }

  .group-section {
    border-bottom: 1px solid #222428;
  }

  .group-header {
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 12px;
    background: #16171a;
  }

  .group-header-left {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .collapse-btn {
    background: transparent;
    border: none;
    cursor: pointer;
    padding: 2px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #8b8f98;
    font-size: 8px;
    line-height: 1;
    transition: color 0.1s;
  }
  .collapse-btn:hover {
    color: #bcbec4;
  }

  .chevron {
    display: inline-block;
    transition: transform 0.15s ease;
  }
  .chevron.expanded {
    transform: rotate(90deg);
  }

  .group-title {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.8px;
    color: #8b8f98;
  }

  .action-btn {
    font-size: 11px;
    color: #6ea8ff;
    padding: 2px 6px;
    border-radius: 4px;
    transition: background 0.1s;
  }
  .action-btn:hover {
    background: #1f2a3d;
  }

  .group-list {
    display: flex;
    flex-direction: column;
  }

  .empty-hint {
    padding: 10px 14px;
    color: #5b5f68;
    font-size: 12px;
    font-style: italic;
  }

  .file-row {
    height: 28px;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 10px;
    cursor: pointer;
    transition: background 0.1s;
    font-size: 12.5px;
  }

  .file-row:hover {
    background: #1a1b1f;
  }

  .file-row.selected {
    background: #1f2a3d;
    color: #cfe0ff;
  }

  .file-row.conflicted {
    background: rgba(232, 180, 90, 0.12);
  }

  .status-badge {
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    font-size: 11px;
    font-weight: 700;
    width: 14px;
    text-align: center;
  }

  .file-name {
    flex: 1;
    min-width: 0;
    font-weight: 450;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .file-dir {
    margin-left: auto;
    font-size: 11px;
    color: #7a7e85;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 110px;
  }

  .conflict-tag {
    margin-left: auto;
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    color: #e8b45a;
    background: rgba(232, 180, 90, 0.2);
    padding: 1px 4px;
    border-radius: 3px;
  }

  /* Commit Box */
  .commit-box {
    border-top: 1px solid #26282d;
    background: #141518;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .commit-box-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .commit-label {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.8px;
    color: #8b8f98;
  }

  .counter {
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    font-size: 11px;
    color: #8b8f98;
  }

  .counter.over-limit {
    color: #f07a74;
    font-weight: 600;
  }

  .message-input {
    width: 100%;
    box-sizing: border-box;
    font-family: 'Geist', system-ui, sans-serif;
    font-size: 12.5px;
    line-height: 1.4;
    color: #d8d9dc;
    background: #1a1b1f;
    border: 1px solid #2c2e34;
    border-radius: 6px;
    padding: 8px 10px;
    resize: vertical;
    min-height: 70px;
    outline: none;
  }

  .message-input:focus {
    border-color: #6ea8ff;
  }

  .hint-warning {
    font-size: 11px;
    color: #e8b45a;
    background: rgba(232, 180, 90, 0.1);
    padding: 4px 6px;
    border-radius: 4px;
  }

  .conventional-hint {
    font-size: 11px;
    color: #62666f;
  }
  .conventional-hint code {
    font-family: 'JetBrains Mono', monospace;
    color: #8b8f98;
  }

  .commit-error-msg {
    font-size: 11px;
    color: #f07a74;
    background: rgba(240, 122, 116, 0.1);
    padding: 4px 6px;
    border-radius: 4px;
    word-break: break-word;
  }

  .commit-actions-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 4px;
  }

  .amend-label {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 12px;
    color: #b9bcc3;
    cursor: pointer;
  }

  .amend-label input {
    cursor: pointer;
  }

  .agent-msg-btn {
    font-size: 11px;
    color: #62666f;
    border: 1px solid #282a30;
    border-radius: 6px;
    padding: 4px 8px;
    opacity: 0.6;
    cursor: not-allowed;
  }

  .commit-btn {
    margin-left: auto;
    font-size: 12px;
    font-weight: 600;
    color: #ffffff;
    background: #2a3a55;
    border: 1px solid #3c5278;
    border-radius: 6px;
    padding: 6px 14px;
    transition: all 0.15s;
  }

  .commit-btn:hover:not(:disabled) {
    background: #364b6e;
    color: #ffffff;
  }

  .commit-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
    background: #23252b;
    border-color: #2c2e34;
    color: #8b8f98;
  }
</style>
