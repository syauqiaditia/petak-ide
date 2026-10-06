<script lang="ts">
  import { onMount } from 'svelte';
  import { api, type GitStashEntry, type GitStashFileEntry } from '../../lib/api';
  import { gitStore } from './git.svelte';
  import DiffView from './DiffView.svelte';
  import type { GitDiffFile } from './types';

  let stashes = $state<GitStashEntry[]>([]);
  let selectedIndex = $state<number | null>(null);
  let stashFiles = $state<GitStashFileEntry[]>([]);
  let selectedFilePath = $state<string | null>(null);
  let activeDiffFile = $state<GitDiffFile | null>(null);

  let loading = $state(false);
  let filesLoading = $state(false);
  let diffLoading = $state(false);
  let feedback = $state<string | null>(null);

  let selectedStash = $derived(
    selectedIndex !== null ? stashes.find((s) => s.index === selectedIndex) ?? null : null
  );

  // Folder grouping (Foldering)
  interface StashFolderGroup {
    dir: string;
    files: GitStashFileEntry[];
  }

  let expandedFolders = $state<Set<string>>(new Set());

  let folderGroups = $derived.by<StashFolderGroup[]>(() => {
    const map = new Map<string, GitStashFileEntry[]>();
    for (const file of stashFiles) {
      const lastSlash = file.path.lastIndexOf('/');
      const dir = lastSlash >= 0 ? file.path.substring(0, lastSlash) : '';
      if (!map.has(dir)) {
        map.set(dir, []);
      }
      map.get(dir)!.push(file);
    }

    const groups: StashFolderGroup[] = [];
    for (const [dir, files] of map.entries()) {
      groups.push({ dir, files });
    }
    groups.sort((a, b) => a.dir.localeCompare(b.dir));
    return groups;
  });

  function toggleFolder(dir: string) {
    const next = new Set(expandedFolders);
    if (next.has(dir)) {
      next.delete(dir);
    } else {
      next.add(dir);
    }
    expandedFolders = next;
  }

  async function loadStashes() {
    if (!gitStore.root) return;
    loading = true;
    feedback = null;
    try {
      stashes = await api.gitStashList(gitStore.root);
      gitStore.stashCount = stashes.length;
      if (stashes.length > 0) {
        if (selectedIndex === null || !stashes.some((s) => s.index === selectedIndex)) {
          selectStash(stashes[0].index);
        } else {
          selectStash(selectedIndex);
        }
      } else {
        selectedIndex = null;
        stashFiles = [];
        selectedFilePath = null;
        activeDiffFile = null;
      }
    } catch (e: any) {
      stashes = [];
      gitStore.stashCount = 0;
      feedback = `Gagal memuat stash: ${e?.message || e}`;
    } finally {
      loading = false;
    }
  }

  async function selectStash(index: number) {
    selectedIndex = index;
    selectedFilePath = null;
    activeDiffFile = null;
    if (!gitStore.root) return;
    filesLoading = true;
    try {
      stashFiles = await api.gitStashFiles(gitStore.root, index);
      // Auto expand all folders
      const allDirs = new Set<string>();
      for (const f of stashFiles) {
        const lastSlash = f.path.lastIndexOf('/');
        allDirs.add(lastSlash >= 0 ? f.path.substring(0, lastSlash) : '');
      }
      expandedFolders = allDirs;

      if (stashFiles.length > 0) {
        selectFile(stashFiles[0].path);
      }
    } catch {
      stashFiles = [];
    } finally {
      filesLoading = false;
    }
  }

  async function selectFile(path: string) {
    selectedFilePath = path;
    if (!gitStore.root || selectedIndex === null) return;
    diffLoading = true;
    try {
      const diffs = await api.gitStashDiff(gitStore.root, selectedIndex, path);
      activeDiffFile = diffs[0] ?? null;
    } catch {
      activeDiffFile = null;
    } finally {
      diffLoading = false;
    }
  }

  async function handleApplyAll() {
    if (!gitStore.root || selectedIndex === null) return;
    loading = true;
    try {
      const res = await api.gitStashApply(gitStore.root, selectedIndex);
      gitStore.showToast(res || `Berhasil menerapkan stash@{${selectedIndex}} ke working tree`, { type: 'success' });
      await gitStore.refresh();
      await loadStashes();
    } catch (e: any) {
      gitStore.showToast(`Gagal apply stash: ${e?.message || e}`, { type: 'error' });
    } finally {
      loading = false;
    }
  }

  async function handlePopAll() {
    if (!gitStore.root || selectedIndex === null) return;
    loading = true;
    try {
      const res = await api.gitStashPop(gitStore.root, selectedIndex);
      gitStore.showToast(res || `Berhasil unstash & pop stash@{${selectedIndex}}`, { type: 'success' });
      await gitStore.refresh();
      await loadStashes();
    } catch (e: any) {
      gitStore.showToast(`Gagal pop stash: ${e?.message || e}`, { type: 'error' });
    } finally {
      loading = false;
    }
  }

  async function handleDrop() {
    if (!gitStore.root || selectedIndex === null) return;
    if (!window.confirm(`Hapus stash@{${selectedIndex}}? Tindakan ini tidak dapat dibatalkan.`)) return;
    loading = true;
    try {
      const res = await api.gitStashDrop(gitStore.root, selectedIndex);
      gitStore.showToast(res || `Stash@{${selectedIndex}} dihapus`, { type: 'info' });
      await gitStore.refresh();
      await loadStashes();
    } catch (e: any) {
      gitStore.showToast(`Gagal drop stash: ${e?.message || e}`, { type: 'error' });
    } finally {
      loading = false;
    }
  }

  async function handleCherryPickFile(path: string, e: MouseEvent) {
    e.stopPropagation();
    if (!gitStore.root || selectedIndex === null) return;
    try {
      const res = await api.gitStashApplyFile(gitStore.root, selectedIndex, path);
      gitStore.showToast(res || `Berhasil cherry-pick file "${path}" dari stash@{${selectedIndex}}!`, { type: 'success' });
      await gitStore.refresh();
    } catch (err: any) {
      gitStore.showToast(`Gagal cherry-pick file: ${err?.message || err}`, { type: 'error' });
    }
  }

  function getFileName(fullPath: string): string {
    const idx = fullPath.lastIndexOf('/');
    return idx >= 0 ? fullPath.substring(idx + 1) : fullPath;
  }

  onMount(() => {
    loadStashes();
  });
</script>

<div class="stash-view">
  <!-- Left Column: Stash List (300px) -->
  <div class="stash-sidebar">
    <div class="sidebar-header">
      <div class="header-title">
        <span>Stashes</span>
        {#if stashes.length > 0}
          <span class="header-count">{stashes.length}</span>
        {/if}
      </div>
      <button
        class="btn-new-stash"
        onclick={() => gitStore.openStash()}
        title="Simpan perubahan saat ini ke Stash baru"
      >
        + Stash…
      </button>
    </div>

    {#if loading && stashes.length === 0}
      <div class="empty-stash-state">Memuat riwayat stash…</div>
    {:else if stashes.length === 0}
      <div class="empty-stash-state">
        <span class="empty-icon">📦</span>
        <p>Belum ada stash tersimpan</p>
        <button class="btn-create-stash" onclick={() => gitStore.openStash()}>
          + Stash Changes Sekarang
        </button>
      </div>
    {:else}
      <div class="stash-entry-list">
        {#each stashes as item (item.index)}
          {@const isSelected = item.index === selectedIndex}
          <div
            class="stash-item-card"
            class:selected={isSelected}
            onclick={() => selectStash(item.index)}
            role="button"
            tabindex="0"
            onkeydown={(e) => e.key === 'Enter' && selectStash(item.index)}
          >
            <div class="item-card-top">
              <span class="badge-selector">stash@&#123;{item.index}&#125;</span>
              {#if item.branch}
                <span class="badge-branch">[{item.branch}]</span>
              {/if}
              <span class="item-date">{item.date.split(' ')[0]}</span>
            </div>
            <div class="item-card-msg">{item.message || '(tanpa pesan)'}</div>
          </div>
        {/each}
      </div>
    {/if}
  </div>

  <!-- Right Area: Master-Detail (Folders/Files on Left, Full DiffView on Right) -->
  <div class="stash-detail-main">
    {#if selectedStash}
      <!-- Detail Header / Action Toolbar -->
      <div class="detail-header-bar">
        <div class="stash-meta">
          <div class="stash-headline">
            <span class="meta-selector">stash@&#123;{selectedStash.index}&#125;</span>
            <span class="meta-title">{selectedStash.message || 'WIP Stash'}</span>
          </div>
          {#if selectedStash.branch}
            <div class="meta-branch">Dibuat dari cabang: <code>{selectedStash.branch}</code> • {selectedStash.date}</div>
          {/if}
        </div>

        <div class="detail-actions">
          <button
            class="action-btn apply-btn"
            onclick={handleApplyAll}
            title="Terapkan semua perubahan dari stash ini ke working tree dan biarkan stash tetap ada"
            disabled={loading}
          >
            ✓ Apply All
          </button>
          <button
            class="action-btn pop-btn"
            onclick={handlePopAll}
            title="Terapkan semua perubahan dan hapus stash ini dari daftar (Pop / Unstash)"
            disabled={loading}
          >
            Unstash (Pop)
          </button>
          <button
            class="action-btn drop-btn"
            onclick={handleDrop}
            title="Hapus stash ini tanpa menerapkan perubahan"
            disabled={loading}
          >
            Drop
          </button>
        </div>
      </div>

      <!-- Split Files Pane (Foldering) & Full DiffView -->
      <div class="stash-content-split">
        <!-- Foldering Files Pane -->
        <div class="stash-files-pane">
          <div class="pane-title-bar">
            <span>Berkas ({stashFiles.length})</span>
            <span class="cherry-hint">Cherry-pick per berkas ➔</span>
          </div>

          {#if filesLoading}
            <div class="files-loading">Membaca berkas dalam stash…</div>
          {:else if stashFiles.length === 0}
            <div class="files-loading">Tidak ada berkas yang dimodifikasi.</div>
          {:else}
            <div class="file-entry-list">
              {#each folderGroups as group (group.dir)}
                {@const isExpanded = expandedFolders.has(group.dir)}
                <!-- Folder Header Row -->
                {#if group.dir}
                  <div
                    class="folder-group-row"
                    onclick={() => toggleFolder(group.dir)}
                    role="button"
                    tabindex="0"
                    onkeydown={(e) => e.key === 'Enter' && toggleFolder(group.dir)}
                  >
                    <span class="folder-chevron" class:expanded={isExpanded}>▶</span>
                    <span class="folder-icon">📁</span>
                    <span class="folder-name">{group.dir}</span>
                    <span class="folder-count">{group.files.length}</span>
                  </div>
                {/if}

                {#if !group.dir || isExpanded}
                  <div class="folder-children" class:indented={!!group.dir}>
                    {#each group.files as file (file.path)}
                      {@const isFileSelected = file.path === selectedFilePath}
                      <div
                        class="file-row"
                        class:selected={isFileSelected}
                        onclick={() => selectFile(file.path)}
                        role="button"
                        tabindex="0"
                        onkeydown={(e) => e.key === 'Enter' && selectFile(file.path)}
                      >
                        <span class="file-status {file.status}">
                          {file.status === 'added' ? 'A' : file.status === 'deleted' ? 'D' : 'M'}
                        </span>
                        <span class="file-path-text" title={file.path}>
                          {getFileName(file.path)}
                        </span>

                        <button
                          class="cherry-pick-btn"
                          onclick={(e) => handleCherryPickFile(file.path, e)}
                          title="Cherry-pick: Terapkan HANYA file ini ke working tree lokal"
                        >
                          Cherry-pick
                        </button>
                      </div>
                    {/each}
                  </div>
                {/if}
              {/each}
            </div>
          {/if}
        </div>

        <!-- Full Integrated DiffView Pane (Identical to Commit & Log Diff) -->
        <div class="stash-diff-pane">
          {#if diffLoading}
            <div class="diff-loading-state">
              <span class="loading-spin">↻</span>
              <span>Memuat perbandingan berkas…</span>
            </div>
          {:else if activeDiffFile}
            <DiffView
              diffFile={activeDiffFile}
              filePath={selectedFilePath ?? ''}
              sourceKind="commit"
            />
          {:else if selectedFilePath}
            <div class="diff-placeholder">
              <span>Tidak ada perbedaan yang terdeteksi untuk berkas ini.</span>
            </div>
          {:else}
            <div class="diff-placeholder">
              <span class="placeholder-icon">📄</span>
              <p>Pilih salah satu berkas dari panel kiri untuk melihat perbandingannya.</p>
            </div>
          {/if}
        </div>
      </div>
    {:else}
      <div class="no-selection-state">
        <span class="big-icon">📦</span>
        <h3>Pilih Stash dari panel kiri</h3>
        <p>Kamu dapat menerapkan seluruh berkas (Apply All), mem-pop stash, atau men-cherry pick berkas tertentu saja ke working tree.</p>
      </div>
    {/if}
  </div>
</div>

<style>
  .stash-view {
    display: flex;
    flex: 1;
    height: 100%;
    min-height: 0;
    background: #141518;
    color: #d8d9dc;
    user-select: none;
    -webkit-user-select: none;
  }

  /* Left Sidebar: Stash List */
  .stash-sidebar {
    width: 290px;
    flex-shrink: 0;
    border-right: 1px solid #23252a;
    display: flex;
    flex-direction: column;
    background: #111215;
  }
  .sidebar-header {
    height: 38px;
    padding: 0 12px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    border-bottom: 1px solid #23252a;
    background: #17181c;
  }
  .header-title {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    font-weight: 600;
    color: #e2e4e9;
  }
  .header-count {
    background: #23252b;
    color: #9cc3ff;
    padding: 1px 6px;
    border-radius: 9px;
    font-size: 10.5px;
  }
  .btn-new-stash {
    background: #232a36;
    border: 1px solid #3b82f6;
    border-radius: 4px;
    color: #9cc3ff;
    font-size: 11px;
    font-weight: 500;
    padding: 3px 8px;
    cursor: pointer;
    transition: all 0.15s ease;
  }
  .btn-new-stash:hover {
    background: #3b82f6;
    color: #ffffff;
  }
  .empty-stash-state {
    padding: 32px 20px;
    text-align: center;
    color: #8b8f98;
    font-size: 12px;
  }
  .empty-icon {
    font-size: 28px;
    display: block;
    margin-bottom: 8px;
  }
  .btn-create-stash {
    margin-top: 12px;
    background: #232a36;
    border: 1px solid #3b82f6;
    color: #9cc3ff;
    border-radius: 6px;
    padding: 6px 14px;
    font-size: 11.5px;
    font-weight: 500;
    cursor: pointer;
  }
  .btn-create-stash:hover {
    background: #3b82f6;
    color: #ffffff;
  }
  .stash-entry-list {
    flex: 1;
    overflow-y: auto;
    padding: 6px;
  }
  .stash-item-card {
    padding: 8px 10px;
    border-radius: 6px;
    background: transparent;
    cursor: pointer;
    margin-bottom: 4px;
    border: 1px solid transparent;
    transition: all 0.12s ease;
  }
  .stash-item-card:hover {
    background: #191b20;
    border-color: #272a32;
  }
  .stash-item-card.selected {
    background: #1e2638;
    border-color: #3b82f6;
  }
  .item-card-top {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 4px;
  }
  .badge-selector {
    font-family: 'JetBrains Mono', monospace;
    font-size: 11px;
    font-weight: 700;
    color: #60a5fa;
  }
  .badge-branch {
    font-size: 10.5px;
    color: #8b8f98;
  }
  .item-date {
    margin-left: auto;
    font-size: 10px;
    color: #6c707a;
  }
  .item-card-msg {
    font-size: 11.5px;
    color: #cbd5e1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* Right Area: Master Details */
  .stash-detail-main {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .detail-header-bar {
    padding: 8px 16px;
    background: #17181c;
    border-bottom: 1px solid #23252a;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    flex-shrink: 0;
  }
  .stash-headline {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 2px;
  }
  .meta-selector {
    font-family: 'JetBrains Mono', monospace;
    font-size: 12px;
    font-weight: 700;
    color: #3b82f6;
    background: #1e2a3d;
    padding: 2px 6px;
    border-radius: 4px;
  }
  .meta-title {
    font-size: 13px;
    font-weight: 600;
    color: #ffffff;
  }
  .meta-branch {
    font-size: 11px;
    color: #8b8f98;
  }
  .meta-branch code {
    color: #93c5fd;
    font-family: 'JetBrains Mono', monospace;
  }
  .detail-actions {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .action-btn {
    height: 28px;
    padding: 0 12px;
    border-radius: 5px;
    font-size: 11.5px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s ease;
    border: 1px solid transparent;
  }
  .apply-btn {
    background: #1f2a3d;
    color: #60a5fa;
    border-color: #3b82f6;
  }
  .apply-btn:hover:not(:disabled) {
    background: #3b82f6;
    color: #ffffff;
  }
  .pop-btn {
    background: #163628;
    color: #6ee7b7;
    border-color: #059669;
  }
  .pop-btn:hover:not(:disabled) {
    background: #059669;
    color: #ffffff;
  }
  .drop-btn {
    background: #2a1b1e;
    color: #f87171;
    border-color: #dc2626;
  }
  .drop-btn:hover:not(:disabled) {
    background: #dc2626;
    color: #ffffff;
  }

  /* Content Split */
  .stash-content-split {
    display: flex;
    flex: 1;
    min-height: 0;
  }

  /* Foldering Files Pane */
  .stash-files-pane {
    width: 320px;
    border-right: 1px solid #23252a;
    display: flex;
    flex-direction: column;
    background: #131417;
    flex-shrink: 0;
  }
  .pane-title-bar {
    height: 32px;
    padding: 0 12px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    border-bottom: 1px solid #202227;
    background: #16171b;
    font-size: 11px;
    font-weight: 600;
    color: #a0a4ad;
  }
  .cherry-hint {
    font-size: 10px;
    color: #6ee7b7;
  }
  .files-loading {
    padding: 24px;
    text-align: center;
    color: #8b8f98;
    font-size: 11.5px;
  }
  .file-entry-list {
    flex: 1;
    overflow-y: auto;
    padding: 4px;
  }

  /* Folder Header */
  .folder-group-row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 6px;
    border-radius: 4px;
    font-size: 11.5px;
    font-weight: 600;
    color: #94a3b8;
    cursor: pointer;
    user-select: none;
    transition: background 0.1s ease;
  }
  .folder-group-row:hover {
    background: #1a1c22;
    color: #e2e8f0;
  }
  .folder-chevron {
    font-size: 9px;
    color: #64748b;
    transition: transform 0.12s ease;
  }
  .folder-chevron.expanded {
    transform: rotate(90deg);
  }
  .folder-icon {
    font-size: 12px;
  }
  .folder-name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: 'JetBrains Mono', monospace;
    font-size: 11px;
  }
  .folder-count {
    font-size: 10px;
    color: #64748b;
    background: #1e2025;
    padding: 1px 5px;
    border-radius: 8px;
  }
  .folder-children.indented {
    padding-left: 12px;
  }

  .file-row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 6px;
    border-radius: 4px;
    font-size: 11.5px;
    cursor: pointer;
    transition: background 0.1s ease;
    margin-bottom: 1px;
  }
  .file-row:hover {
    background: #1a1c22;
  }
  .file-row.selected {
    background: #1e2a40;
    color: #ffffff;
  }
  .file-status {
    font-family: 'JetBrains Mono', monospace;
    font-size: 10.5px;
    font-weight: 700;
    width: 14px;
    text-align: center;
  }
  .file-status.modified { color: #f59e0b; }
  .file-status.added { color: #10b981; }
  .file-status.deleted { color: #ef4444; }
  .file-path-text {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: #cbd5e1;
    font-family: 'JetBrains Mono', monospace;
    font-size: 11px;
  }
  .file-row.selected .file-path-text {
    color: #ffffff;
    font-weight: 500;
  }
  .cherry-pick-btn {
    opacity: 0;
    background: #1e3a2e;
    border: 1px solid #10b981;
    color: #a7f3d0;
    border-radius: 3px;
    font-size: 10px;
    font-weight: 600;
    padding: 2px 6px;
    cursor: pointer;
    transition: all 0.15s ease;
    flex-shrink: 0;
  }
  .file-row:hover .cherry-pick-btn,
  .file-row.selected .cherry-pick-btn {
    opacity: 1;
  }
  .cherry-pick-btn:hover {
    background: #10b981;
    color: #ffffff;
  }

  /* Full DiffView Integration Pane */
  .stash-diff-pane {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    background: #101114;
    overflow: hidden;
  }
  .diff-loading-state,
  .diff-placeholder {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    color: #64748b;
    font-size: 12px;
    padding: 40px;
    text-align: center;
  }
  .loading-spin {
    font-size: 20px;
    animation: spin 1s infinite linear;
    margin-bottom: 8px;
    display: inline-block;
  }
  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
  .placeholder-icon {
    font-size: 36px;
    margin-bottom: 10px;
    opacity: 0.6;
  }

  .no-selection-state {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    color: #8b8f98;
    padding: 40px;
    text-align: center;
  }
  .big-icon {
    font-size: 44px;
    margin-bottom: 12px;
  }
  .no-selection-state h3 {
    font-size: 15px;
    color: #e2e8f0;
    margin-bottom: 6px;
  }
  .no-selection-state p {
    font-size: 12px;
    max-width: 360px;
  }
</style>
