<script lang="ts">
  import { onMount } from 'svelte';
  import { gitStore } from './git.svelte.ts';
  import { api, type GitStashEntry, type GitStashFileEntry } from '../../lib/api';
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
  import { agentsStore } from '../agents/agents.svelte.ts';

  let { folderPath = '' } = $props<{ folderPath?: string }>();

  let activePanelTab = $state<'changes' | 'stashes'>('changes');
  let panelWidth = $state<number>(320);
  let isResizing = $state(false);

  let commitMessage = $state('');
  let isAmend = $state(false);
  let isCommitting = $state(false);
  let isWritingWithAgent = $state(false);
  let commitError = $state<string | null>(null);
  let commitDropdownOpen = $state(false);
  let commitActionKind = $state<'commit' | 'commit_and_push'>('commit');

  let changesExpanded = $state(true);
  let unversionedExpanded = $state(false);

  // Stashes state
  let stashes = $state<GitStashEntry[]>([]);
  let stashesLoading = $state(false);
  let selectedStashIndex = $state<number | null>(null);
  let stashFiles = $state<GitStashFileEntry[]>([]);
  let stashFilesLoading = $state(false);
  let selectedStashFilePath = $state<string | null>(null);

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
      await loadStashes();
    } catch (e: any) {
      gitStore.showToast(`Failed to pop stash: ${e?.message || e}`, { type: 'error' });
    }
  }

  async function loadStashes() {
    const root = folderPath || gitStore.root;
    if (!root) return;
    stashesLoading = true;
    try {
      stashes = await api.gitStashList(root);
      gitStore.stashCount = stashes.length;
      if (stashes.length > 0) {
        if (selectedStashIndex === null || !stashes.some((s) => s.index === selectedStashIndex)) {
          await selectStash(stashes[0].index);
        } else {
          await selectStash(selectedStashIndex);
        }
      } else {
        selectedStashIndex = null;
        stashFiles = [];
        selectedStashFilePath = null;
      }
    } catch {
      stashes = [];
      gitStore.stashCount = 0;
    } finally {
      stashesLoading = false;
    }
  }

  async function selectStash(index: number) {
    selectedStashIndex = index;
    selectedStashFilePath = null;
    const root = folderPath || gitStore.root;
    if (!root) return;
    stashFilesLoading = true;
    try {
      stashFiles = await api.gitStashFiles(root, index);
    } catch {
      stashFiles = [];
    } finally {
      stashFilesLoading = false;
    }
  }

  async function handleStashFileClick(stashIndex: number, path: string) {
    selectedStashFilePath = path;
    await gitStore.openStashFileDiff(stashIndex, path);
  }

  async function handleApplyStash(index: number) {
    const root = folderPath || gitStore.root;
    if (!root) return;
    try {
      const res = await api.gitStashApply(root, index);
      gitStore.showToast(res || `Stash@{${index}} diterapkan ke working tree`, { type: 'success' });
      await gitStore.refresh();
      await loadStashes();
    } catch (e: any) {
      gitStore.showToast(`Gagal apply stash: ${e?.message || e}`, { type: 'error' });
    }
  }

  async function handlePopStash(index: number) {
    const root = folderPath || gitStore.root;
    if (!root) return;
    try {
      const res = await api.gitStashPop(root, index);
      gitStore.showToast(res || `Stash@{${index}} berhasil di-pop (unstash)`, { type: 'success' });
      await gitStore.refresh();
      await loadStashes();
    } catch (e: any) {
      gitStore.showToast(`Gagal pop stash: ${e?.message || e}`, { type: 'error' });
    }
  }

  async function handleDropStash(index: number) {
    const root = folderPath || gitStore.root;
    if (!root) return;
    if (!window.confirm(`Hapus stash@{${index}}? Tindakan ini tidak dapat dibatalkan.`)) return;
    try {
      const res = await api.gitStashDrop(root, index);
      gitStore.showToast(res || `Stash@{${index}} dihapus`, { type: 'info' });
      await gitStore.refresh();
      await loadStashes();
    } catch (e: any) {
      gitStore.showToast(`Gagal drop stash: ${e?.message || e}`, { type: 'error' });
    }
  }

  async function handleSelectChangeFile(path: string, kind: 'worktree' | 'staged') {
    await gitStore.selectFile(path, kind);
    const fileName = path.split('/').pop() || path;
    gitStore.openCenterDiff({
      diffFile: gitStore.currentDiffFile,
      filePath: path,
      leftLabel: kind === 'staged' ? 'HEAD (Committed)' : 'Index (Staged)',
      rightLabel: kind === 'staged' ? 'Index (Staged)' : 'Working Tree',
      sourceKind: kind,
      title: `${fileName} (${kind === 'staged' ? 'HEAD vs Index' : 'Working Tree'})`,
    });
  }

  function startResize(e: MouseEvent) {
    e.preventDefault();
    isResizing = true;
    const startX = e.clientX;
    const startW = panelWidth;

    function onMouseMove(ev: MouseEvent) {
      panelWidth = Math.min(Math.max(startW + (ev.clientX - startX), 200), 650);
    }

    function onMouseUp() {
      isResizing = false;
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    }

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }

  onMount(() => {
    loadStashes();
  });

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
      case 'stash_changes':
        gitStore.openStash();
        break;
      case 'unstash_changes':
        gitStore.openUnstash();
        break;
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

  async function doCommitAndPush() {
    await doCommit();
    if (!commitError && gitStore.root) {
      gitStore.openPushModal();
    }
  }

  async function handleWriteWithAgent() {
    if (isWritingWithAgent) return;
    if (checkedCount === 0) {
      gitStore.showToast('Pilih file yang ingin di-commit terlebih dahulu', { type: 'warning' });
      return;
    }
    if (!gitStore.root) return;

    isWritingWithAgent = true;
    try {
      // 1. Gather diff summary
      let diffSnippets = '';
      for (const p of checkedPaths.slice(0, 2)) {
        try {
          const d = await api.gitDiff(gitStore.root, { kind: 'worktree', path: p });
          if (d && d.length > 0 && d[0].hunks) {
            diffSnippets += `\n--- ${p} ---\n` + d[0].hunks.map(h => h.lines.map(l => l.text).join('\n')).join('\n').slice(0, 400);
          }
        } catch {
          // fallback
        }
      }

      // 2. Build prompt
      const prompt = `Write a concise conventional git commit message (format: <type>(<scope>): <summary>) in English or Indonesian for these changes:\nFiles changed: ${checkedPaths.join(', ')}\n${diffSnippets}\n\nIMPORTANT: Return ONLY the commit message in 1 line, no markdown fences, no quotes, no extra explanation.`;

      let msg = '';
      try {
        if (agentsStore.slots.length === 0) {
          await agentsStore.loadSlots();
        }
        const slotId = agentsStore.activeSlotId || (agentsStore.slots[0]?.id ?? 'default');
        const res = await api.agentPrompt(slotId, prompt);
        msg = (res.message || '').trim();
      } catch {
        // Fallback to heuristic
      }

      if (!msg) {
        // Smart conventional commit heuristics based on file paths
        const firstFile = checkedPaths[0];
        if (firstFile.includes('GoogleService-Info.plist') || firstFile.includes('google-services.json')) {
          msg = 'chore(config): update Firebase service configuration credentials';
        } else if (firstFile.startsWith('ios/')) {
          msg = 'chore(ios): update iOS configuration and runner settings';
        } else if (firstFile.startsWith('android/')) {
          msg = 'chore(android): update Android build and configuration';
        } else if (firstFile.includes('test') || firstFile.endsWith('.test.ts') || firstFile.endsWith('_test.dart')) {
          msg = 'test: update test cases and assertions';
        } else if (firstFile.endsWith('.dart')) {
          const fileName = firstFile.split('/').pop()?.replace('.dart', '') || 'component';
          msg = `feat(${fileName}): update implementation`;
        } else if (firstFile.endsWith('.rs')) {
          msg = 'feat(core): update Rust backend logic';
        } else if (firstFile.endsWith('.svelte')) {
          const comp = firstFile.split('/').pop()?.replace('.svelte', '') || 'ui';
          msg = `feat(ui): update ${comp} view`;
        } else {
          msg = `chore: update ${checkedPaths.length} file(s)`;
        }
      }

      // Clean up markdown quotes or codeblock fences
      msg = msg
        .replace(/```[a-z]*\n?/gi, '')
        .replace(/\n?```/g, '')
        .replace(/^["'`]|["'`]$/g, '')
        .trim();

      const lines = msg.split('\n').filter((l) => l.trim().length > 0);
      commitMessage = lines.slice(0, 2).join('\n');
      gitStore.showToast('Pesan commit dibuat oleh AI agent!', { type: 'success' });
    } catch (err: any) {
      gitStore.showToast(`Gagal membuat pesan commit: ${err?.message || err}`, { type: 'error' });
    } finally {
      isWritingWithAgent = false;
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

<svelte:window onclick={() => { contextMenuOpen = false; emptyContextMenuOpen = false; commitDropdownOpen = false; }} />

<div
  class="commit-panel"
  style:width="{panelWidth}px"
  style:min-width="{panelWidth}px"
>
  <!-- Segmented Tab Switcher [ Changes ] and [ Stashes ] -->
  <div class="panel-header-tabs">
    <div class="tab-segments">
      <button
        class="segment-btn"
        class:active={activePanelTab === 'changes'}
        onclick={() => (activePanelTab = 'changes')}
        type="button"
      >
        <span>Changes</span>
        {#if totalFiles > 0}
          <span class="count-badge">{totalFiles}</span>
        {/if}
      </button>
      <button
        class="segment-btn"
        class:active={activePanelTab === 'stashes'}
        onclick={() => {
          activePanelTab = 'stashes';
          loadStashes();
        }}
        type="button"
      >
        <span>Stashes</span>
        {#if stashes.length > 0 || gitStore.stashCount > 0}
          <span class="count-badge stash">{stashes.length || gitStore.stashCount}</span>
        {/if}
      </button>
    </div>
  </div>

  {#if activePanelTab === 'changes'}
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

      <div class="stash-quick-actions">
        <button
          type="button"
          class="btn-quick-stash"
          onclick={() => gitStore.openStash()}
          title="Stash Changes (Simpan perubahan sementara)"
        >
          Stash…
        </button>
        <button
          type="button"
          class="btn-quick-stash"
          onclick={() => gitStore.openUnstash()}
          title="Unstash Changes (Terapkan perubahan yang distash)"
        >
          Unstash{gitStore.stashCount > 0 ? ` (${gitStore.stashCount})` : ''}
        </button>
      </div>
    </div>
  {:else if gitStore.stashCount > 0}
    <div class="stash-prompt-banner">
      <span>📦 {gitStore.stashCount} stash tersimpan</span>
      <button
        type="button"
        class="btn-quick-stash highlight"
        onclick={() => gitStore.openUnstash()}
      >
        Unstash…
      </button>
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
                onclick={() => handleSelectChangeFile(entry.path, isEntryStaged(entry) ? 'staged' : 'worktree')}
                oncontextmenu={(e) => handleRowContextMenu(e, entry, isEntryStaged(entry))}
                role="button"
                tabindex="0"
                onkeydown={(e) => {
                  if (e.key === 'Enter') handleSelectChangeFile(entry.path, isEntryStaged(entry) ? 'staged' : 'worktree');
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
                onclick={() => handleSelectChangeFile(entry.path, isEntryStaged(entry) ? 'staged' : 'worktree')}
                oncontextmenu={(e) => handleRowContextMenu(e, entry, isEntryStaged(entry))}
                role="button"
                tabindex="0"
                onkeydown={(e) => {
                  if (e.key === 'Enter') handleSelectChangeFile(entry.path, isEntryStaged(entry) ? 'staged' : 'worktree');
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
        disabled={isWritingWithAgent || checkedCount === 0}
        onclick={handleWriteWithAgent}
        title="Buat pesan commit otomatis dengan AI agent berdasarkan berkas yang dipilih"
      >
        {#if isWritingWithAgent}
          <span class="spin-icon">↻</span>
          <span>Menulis…</span>
        {:else}
          <span>✨ Write with agent</span>
        {/if}
      </button>

      <!-- Split Commit & Push Button -->
      <div class="commit-split-btn-group">
        <button
          class="commit-btn"
          disabled={!canCommit}
          onclick={commitActionKind === 'commit_and_push' ? doCommitAndPush : doCommit}
        >
          {commitActionKind === 'commit_and_push' ? `${commitBtnLabel} & Push` : commitBtnLabel}
        </button>

        <button
          class="commit-dropdown-trigger"
          disabled={!canCommit}
          onclick={(e) => {
            e.stopPropagation();
            commitDropdownOpen = !commitDropdownOpen;
          }}
          title="Pilih opsi: Commit atau Commit and Push"
        >
          ▾
        </button>

        {#if commitDropdownOpen}
          <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
          <div class="commit-dropdown-menu" onclick={(e) => e.stopPropagation()}>
            <button
              class="dropdown-menu-item"
              class:selected={commitActionKind === 'commit'}
              onclick={() => {
                commitActionKind = 'commit';
                commitDropdownOpen = false;
                doCommit();
              }}
            >
              <span>{commitBtnLabel}</span>
              <span class="item-shortcut">⌘⏎</span>
            </button>
            <button
              class="dropdown-menu-item"
              class:selected={commitActionKind === 'commit_and_push'}
              onclick={() => {
                commitActionKind = 'commit_and_push';
                commitDropdownOpen = false;
                doCommitAndPush();
              }}
            >
              <span>{commitBtnLabel} and Push…</span>
              <span class="item-shortcut">⌥⌘⏎</span>
            </button>
          </div>
        {/if}
      </div>
    </div>
  </div>
  {/if}

  {#if activePanelTab === 'stashes'}
    <!-- Stashes Tab: Compact List & Files -->
    <div class="stashes-container">
      <div class="stash-toolbar">
        <span class="toolbar-title">STASHED CHANGES</span>
        <div class="toolbar-actions">
          <button
            type="button"
            class="btn-stash-action"
            onclick={() => gitStore.openStash()}
            title="Stash changes working tree saat ini"
          >
            + Stash…
          </button>
          <button
            type="button"
            class="btn-stash-refresh"
            onclick={loadStashes}
            title="Muat ulang daftar stash"
          >
            ↻
          </button>
        </div>
      </div>

      {#if stashesLoading && stashes.length === 0}
        <div class="stash-empty-box">Memuat riwayat stash…</div>
      {:else if stashes.length === 0}
        <div class="stash-empty-box">
          <span class="empty-stash-icon">📦</span>
          <p>Belum ada stash tersimpan</p>
          <button class="btn-create-stash-primary" onclick={() => gitStore.openStash()}>
            + Stash Changes Sekarang
          </button>
        </div>
      {:else}
        <div class="stash-cards-scroll">
          {#each stashes as item (item.index)}
            {@const isSelected = item.index === selectedStashIndex}
            <div
              class="compact-stash-card"
              class:selected={isSelected}
              onclick={() => selectStash(item.index)}
              role="button"
              tabindex="0"
              onkeydown={(e) => e.key === 'Enter' && selectStash(item.index)}
            >
              <div class="card-meta-line">
                <span class="stash-index-pill">stash@&#123;{item.index}&#125;</span>
                {#if item.branch}
                  <span class="stash-branch-tag">[{item.branch}]</span>
                {/if}
                <span class="stash-date">{item.date.split(' ')[0]}</span>
              </div>
              <div class="card-msg-line">{item.message || '(tanpa pesan)'}</div>

              {#if isSelected}
                <!-- Compact Actions Bar for Selected Stash -->
                <div class="selected-stash-actions" onclick={(e) => e.stopPropagation()}>
                  <button
                    class="stash-act-btn apply"
                    onclick={() => handleApplyStash(item.index)}
                    title="Apply: Terapkan perubahan ke working tree, pertahankan stash"
                  >
                    Apply
                  </button>
                  <button
                    class="stash-act-btn pop"
                    onclick={() => handlePopStash(item.index)}
                    title="Pop: Terapkan perubahan dan hapus dari stash"
                  >
                    Pop
                  </button>
                  <button
                    class="stash-act-btn drop"
                    onclick={() => handleDropStash(item.index)}
                    title="Drop: Hapus stash ini"
                  >
                    Drop
                  </button>
                </div>

                <!-- List of modified files in this stash -->
                <div class="selected-stash-files-section">
                  <div class="files-header-line">
                    <span>BERKAS ({stashFiles.length})</span>
                    <span class="click-hint">Klik berkas untuk diff</span>
                  </div>
                  {#if stashFilesLoading}
                    <div class="files-loading-hint">Membaca berkas…</div>
                  {:else if stashFiles.length === 0}
                    <div class="files-loading-hint">Tidak ada berkas.</div>
                  {:else}
                    <div class="stash-files-list">
                      {#each stashFiles as file (file.path)}
                        {@const isFileActive = file.path === selectedStashFilePath}
                        {@const fName = file.path.split('/').pop() || file.path}
                        {@const fDir = file.path.includes('/') ? file.path.substring(0, file.path.lastIndexOf('/')) : ''}
                        <div
                          class="stash-file-row"
                          class:active={isFileActive}
                          onclick={() => handleStashFileClick(item.index, file.path)}
                          role="button"
                          tabindex="0"
                          onkeydown={(e) => e.key === 'Enter' && handleStashFileClick(item.index, file.path)}
                          title="Klik untuk membuka perbandingan diff di editor tengah"
                        >
                          <span class="stash-file-badge {file.status}">
                            {file.status === 'added' ? 'A' : file.status === 'deleted' ? 'D' : 'M'}
                          </span>
                          <span class="stash-file-name">{fName}</span>
                          {#if fDir}
                            <span class="stash-file-dir">{fDir}</span>
                          {/if}
                        </div>
                      {/each}
                    </div>
                  {/if}
                </div>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/if}

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
  {#if (stashModalOpen || gitStore.isStashModalOpen) && gitStore.root}
    <StashModal
      root={gitStore.root}
      initialMode={gitStore.isStashModalOpen ? gitStore.stashModalMode : stashModalMode}
      onclose={() => {
        stashModalOpen = false;
        gitStore.closeStash();
      }}
    />
  {/if}

  <!-- Commit Panel Horizontal Resize Handle -->
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
    class="commit-resize-handle"
    onmousedown={startResize}
    role="separator"
    aria-label="Resize Commit Panel"
    title="Geser untuk mengubah lebar panel commit"
  ></div>
</div>

<style>
  .commit-panel {
    position: relative;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    background: #18191c;
    border-right: 1px solid #2b2d30;
    height: 100%;
    overflow: hidden;
    user-select: none;
    -webkit-user-select: none;
    font-size: 13px;
  }

  .panel-header-tabs {
    height: 38px;
    padding: 4px 10px;
    background: #141518;
    border-bottom: 1px solid #26282d;
    display: flex;
    align-items: center;
    flex-shrink: 0;
  }
  .tab-segments {
    display: flex;
    background: #1c1d22;
    padding: 2px;
    border-radius: 6px;
    border: 1px solid #282a30;
    width: 100%;
    gap: 2px;
  }
  .segment-btn {
    flex: 1;
    height: 26px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    border-radius: 4px;
    font-size: 11.5px;
    font-weight: 500;
    color: #8b8f98;
    background: transparent;
    border: none;
    cursor: pointer;
    transition: all 0.12s ease;
  }
  .segment-btn:hover {
    color: #d8d9dc;
  }
  .segment-btn.active {
    background: #2b2d35;
    color: #ffffff;
    font-weight: 600;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
  }
  .count-badge {
    font-size: 10px;
    padding: 0 5px;
    border-radius: 8px;
    background: #363a45;
    color: #9cc3ff;
    line-height: 14px;
  }
  .count-badge.stash {
    background: #2b3345;
    color: #70b0ff;
  }

  .stashes-container {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
    overflow: hidden;
    background: #151619;
  }
  .stash-toolbar {
    height: 32px;
    padding: 0 10px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: #18191c;
    border-bottom: 1px solid #26282d;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.5px;
    color: #8b8f98;
  }
  .toolbar-actions {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .btn-stash-action {
    background: #1e2430;
    border: 1px solid #2e3a50;
    border-radius: 4px;
    color: #9cc3ff;
    font-size: 11px;
    font-weight: 500;
    padding: 2px 8px;
    cursor: pointer;
    transition: all 0.15s;
  }
  .btn-stash-action:hover {
    background: #28354d;
    border-color: #3b82f6;
    color: #fff;
  }
  .btn-stash-refresh {
    background: transparent;
    border: none;
    color: #8b8f98;
    font-size: 13px;
    cursor: pointer;
    padding: 2px 4px;
    border-radius: 4px;
  }
  .btn-stash-refresh:hover {
    color: #fff;
  }
  .stash-empty-box {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 40px 16px;
    text-align: center;
    color: #6c707e;
    font-size: 12px;
    gap: 10px;
  }
  .empty-stash-icon {
    font-size: 32px;
    opacity: 0.6;
  }
  .btn-create-stash-primary {
    background: #2563eb;
    border: none;
    border-radius: 6px;
    color: #fff;
    font-size: 12px;
    font-weight: 500;
    padding: 6px 14px;
    cursor: pointer;
    transition: background 0.15s;
  }
  .btn-create-stash-primary:hover {
    background: #1d4ed8;
  }
  .stash-cards-scroll {
    flex: 1;
    overflow-y: auto;
    padding: 8px 6px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .compact-stash-card {
    background: #191b20;
    border: 1px solid #262931;
    border-radius: 6px;
    padding: 8px 10px;
    cursor: pointer;
    transition: all 0.12s;
  }
  .compact-stash-card:hover {
    background: #1e2128;
    border-color: #383c48;
  }
  .compact-stash-card.selected {
    background: #1c222e;
    border-color: #3b82f6;
  }
  .card-meta-line {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    margin-bottom: 4px;
  }
  .stash-index-pill {
    background: #1e293b;
    border: 1px solid #334155;
    color: #60a5fa;
    font-family: 'JetBrains Mono', monospace;
    font-size: 10px;
    padding: 1px 5px;
    border-radius: 4px;
    font-weight: 600;
  }
  .stash-branch-tag {
    color: #8b8f98;
    font-family: 'JetBrains Mono', monospace;
    font-size: 10.5px;
  }
  .stash-date {
    margin-left: auto;
    color: #626674;
    font-size: 10px;
  }
  .card-msg-line {
    font-size: 12px;
    color: #d1d5db;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .selected-stash-actions {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 8px;
    padding-top: 8px;
    border-top: 1px solid #2b3346;
  }
  .stash-act-btn {
    flex: 1;
    height: 24px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 500;
    cursor: pointer;
    border: 1px solid transparent;
    transition: all 0.12s;
  }
  .stash-act-btn.apply {
    background: #1e3a2f;
    border-color: #276749;
    color: #48bb78;
  }
  .stash-act-btn.apply:hover {
    background: #22543d;
    color: #68d391;
  }
  .stash-act-btn.pop {
    background: #1e2a44;
    border-color: #2b4372;
    color: #60a5fa;
  }
  .stash-act-btn.pop:hover {
    background: #25395f;
    color: #93c5fd;
  }
  .stash-act-btn.drop {
    background: #3d1f24;
    border-color: #632832;
    color: #f87171;
  }
  .stash-act-btn.drop:hover {
    background: #52222a;
    color: #fca5a5;
  }
  .selected-stash-files-section {
    margin-top: 8px;
    background: #14161b;
    border-radius: 4px;
    padding: 6px 8px;
    border: 1px solid #232732;
  }
  .files-header-line {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 10px;
    font-weight: 600;
    color: #7e8494;
    margin-bottom: 6px;
  }
  .click-hint {
    font-size: 9.5px;
    color: #555b6a;
    font-style: italic;
  }
  .files-loading-hint {
    font-size: 11px;
    color: #6c7283;
    padding: 4px 0;
  }
  .stash-files-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-height: 180px;
    overflow-y: auto;
  }
  .stash-file-row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 3px 6px;
    border-radius: 4px;
    font-size: 11.5px;
    cursor: pointer;
    transition: background 0.1s;
  }
  .stash-file-row:hover {
    background: #1e222c;
  }
  .stash-file-row.active {
    background: #232d3f;
    color: #93c5fd;
  }
  .stash-file-badge {
    font-size: 10px;
    font-weight: 700;
    font-family: 'JetBrains Mono', monospace;
    width: 14px;
    text-align: center;
  }
  .stash-file-badge.modified {
    color: #60a5fa;
  }
  .stash-file-badge.added {
    color: #4ade80;
  }
  .stash-file-badge.deleted {
    color: #f87171;
  }
  .stash-file-name {
    font-weight: 500;
    color: #e2e8f0;
  }
  .stash-file-dir {
    color: #64748b;
    font-size: 10.5px;
    margin-left: auto;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 120px;
  }
  .commit-resize-handle {
    position: absolute;
    top: 0;
    right: 0;
    width: 5px;
    height: 100%;
    cursor: col-resize;
    z-index: 5;
    background: transparent;
    transition: background 0.15s ease;
  }
  .commit-resize-handle:hover {
    background: #3b82f6;
  }

  .select-all-bar {
    height: 32px;
    display: flex;
    align-items: center;
    padding: 0 12px;
    background: #18191c;
    border-bottom: 1px solid #2b2d30;
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
  .stash-quick-actions {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .btn-quick-stash {
    background: transparent;
    border: 1px solid #2e3037;
    border-radius: 4px;
    color: #9cc3ff;
    font-size: 10.5px;
    font-weight: 500;
    padding: 2px 6px;
    cursor: pointer;
    transition: all 0.15s ease;
  }
  .btn-quick-stash:hover {
    background: #232a36;
    border-color: #3b82f6;
    color: #ffffff;
  }
  .btn-quick-stash.highlight {
    background: #1e2638;
    border-color: #3b82f6;
    color: #9cc3ff;
    padding: 3px 8px;
  }
  .stash-prompt-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 12px;
    background: #171c26;
    border-bottom: 1px solid #232d3f;
    font-size: 11px;
    color: #9cc3ff;
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
    padding: 0 8px;
    margin: 1px 4px;
    border-radius: 4px;
    cursor: pointer;
    transition: background 0.1s;
    font-size: 12.5px;
  }

  .file-row:hover {
    background: rgba(255, 255, 255, 0.05);
  }

  .file-row.selected {
    background: #232d3f;
    color: #cfe0ff;
  }

  .file-row.conflicted {
    background: rgba(232, 180, 90, 0.14);
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
    color: #71757e;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 130px;
    padding-left: 6px;
  }

  .conflict-tag {
    margin-left: auto;
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    color: #e8b45a;
    background: rgba(232, 180, 90, 0.2);
    padding: 1px 6px;
    border-radius: 4px;
  }

  /* Commit Box */
  .commit-box {
    border-top: 1px solid #2b2d30;
    background: #18191c;
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
    color: #dfe1e5;
    background: #1e1f22;
    border: 1px solid #383a40;
    border-radius: 6px;
    padding: 8px 10px;
    resize: vertical;
    min-height: 70px;
    outline: none;
    box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.2);
    transition: border-color 0.15s;
  }

  .message-input:focus {
    border-color: #3574f0;
    box-shadow: 0 0 0 1px #3574f0;
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
    font-size: 11.5px;
    height: 28px;
    box-sizing: border-box;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: #e8b45a;
    background: #232018;
    border: 1px solid #544423;
    border-radius: 6px;
    padding: 0 10px;
    cursor: pointer;
    transition: all 0.15s ease;
  }
  .agent-msg-btn:hover:not(:disabled) {
    background: #362e18;
    border-color: #7d6325;
    color: #fde68a;
  }
  .agent-msg-btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
    background: #1b1c20;
    border-color: #2c2e35;
    color: #71757e;
  }
  .spin-icon {
    display: inline-block;
    animation: spin 1s infinite linear;
    font-size: 12px;
  }
  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  /* Split Commit & Push Button - Pixel-Perfect Unified Height */
  .commit-split-btn-group {
    margin-left: auto;
    display: inline-flex;
    align-items: stretch;
    height: 28px;
    box-sizing: border-box;
    position: relative;
  }

  .commit-split-btn-group .commit-btn {
    margin-left: 0;
    height: 28px;
    box-sizing: border-box;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0 14px;
    font-size: 12px;
    font-weight: 600;
    line-height: 1;
    color: #ffffff;
    background: #2a3a55;
    border: 1px solid #3c5278;
    border-right: none;
    border-top-left-radius: 6px;
    border-bottom-left-radius: 6px;
    border-top-right-radius: 0;
    border-bottom-right-radius: 0;
    cursor: pointer;
    transition: all 0.15s;
  }
  .commit-split-btn-group .commit-btn:hover:not(:disabled) {
    background: #364b6e;
    color: #ffffff;
  }
  .commit-split-btn-group .commit-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
    background: #23252b;
    border-color: #2c2e34;
    color: #8b8f98;
  }

  .commit-dropdown-trigger {
    height: 28px;
    width: 24px;
    box-sizing: border-box;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    font-size: 11px;
    line-height: 1;
    background: #2a3a55;
    border: 1px solid #3c5278;
    border-left: 1px solid #1c283c;
    border-top-left-radius: 0;
    border-bottom-left-radius: 0;
    border-top-right-radius: 6px;
    border-bottom-right-radius: 6px;
    color: #ffffff;
    cursor: pointer;
    transition: all 0.15s;
  }
  .commit-dropdown-trigger:hover:not(:disabled) {
    background: #364b6e;
  }
  .commit-dropdown-trigger:disabled {
    opacity: 0.4;
    cursor: not-allowed;
    background: #23252b;
    border-color: #2c2e34;
    color: #8b8f98;
  }
  .commit-dropdown-menu {
    position: absolute;
    bottom: calc(100% + 4px);
    right: 0;
    width: 210px;
    background: #1c1d22;
    border: 1px solid #2d3139;
    border-radius: 6px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
    padding: 4px;
    z-index: 100;
  }
  .dropdown-menu-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: 6px 10px;
    background: transparent;
    border: none;
    border-radius: 4px;
    color: #e2e8f0;
    font-size: 12px;
    cursor: pointer;
    text-align: left;
    transition: background 0.1s;
  }
  .dropdown-menu-item:hover {
    background: #282b34;
    color: #ffffff;
  }
  .dropdown-menu-item.selected {
    color: #60a5fa;
    font-weight: 600;
  }
  .item-shortcut {
    font-size: 10.5px;
    color: #64748b;
    font-family: 'JetBrains Mono', monospace;
  }
</style>
