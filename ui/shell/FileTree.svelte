<script lang="ts">
  import { api, type Entry } from '../lib/api';
  import { gitStore } from '../features/git/git.svelte.ts';

  let {
    rootEntries = [],
    activeFilePath = '',
    folderPath = '',
    recentFolders = [],
    onSelectFile,
    onPickFolder,
    onOpenRecent,
  } = $props<{
    rootEntries?: Entry[];
    activeFilePath?: string;
    folderPath?: string;
    recentFolders?: string[];
    onSelectFile?: (entry: Entry) => void;
    onPickFolder?: () => void;
    onOpenRecent?: (path: string) => void;
  }>();

  let expanded = $state<Record<string, boolean>>({});
  let childrenCache = $state<Record<string, Entry[]>>({});
  let loading = $state<Record<string, boolean>>({});

  let folderLeaf = $derived(
    folderPath ? folderPath.split('/').filter(Boolean).pop() || 'Project' : 'No Folder Open'
  );

  function getRelPath(absPath: string): string {
    if (!folderPath) return '';
    if (absPath.startsWith(folderPath)) {
      let rel = absPath.slice(folderPath.length);
      if (rel.startsWith('/')) rel = rel.slice(1);
      return rel;
    }
    return absPath;
  }

  function getFileGitColor(absPath: string): string | null {
    const rel = getRelPath(absPath);
    if (!rel) return null;
    const entry = gitStore.statusMap.get(rel);
    if (!entry) return null;
    if (entry.conflicted) return '#e8b45a';
    if (entry.worktree === 'modified' || entry.index === 'modified') return '#9cc3ff';
    if (
      entry.worktree === 'untracked' ||
      entry.worktree === 'added' ||
      entry.index === 'added'
    )
      return '#7fc98f';
    if (entry.worktree === 'deleted' || entry.index === 'deleted') return '#f07a74';
    return null;
  }

  function isDirChanged(absPath: string): boolean {
    const rel = getRelPath(absPath);
    if (!rel) return false;
    return gitStore.changedDirsSet.has(rel);
  }

  export async function toggleFolder(entry: Entry) {
    const path = entry.path;
    if (expanded[path]) {
      expanded[path] = false;
    } else {
      if (!childrenCache[path]) {
        loading[path] = true;
        try {
          const items = await api.listDir(path);
          childrenCache[path] = items;
        } catch (e) {
          console.error('Failed to list directory:', path, e);
        } finally {
          loading[path] = false;
        }
      }
      expanded[path] = true;
    }
  }

  export async function refreshExpandedFolders(changedPaths: string[]) {
    // If any expanded folder contains a changed path, re-fetch it
    for (const p of Object.keys(childrenCache)) {
      if (expanded[p]) {
        const affected = changedPaths.some((cp) => cp === p || cp.startsWith(p + '/'));
        if (affected) {
          try {
            childrenCache[p] = await api.listDir(p);
          } catch (e) {
            console.error('Failed to refresh folder:', p, e);
          }
        }
      }
    }
  }

  function getFileColor(filename: string): string {
    const lower = filename.toLowerCase();
    if (lower.endsWith('.kt') || lower.endsWith('.kts')) return '#7fc98f';
    if (lower.endsWith('.dart')) return '#2aacb8';
    if (lower.endsWith('.swift')) return '#cf8e6d';
    if (lower.endsWith('.yaml') || lower.endsWith('.yml')) return '#b3ae60';
    if (lower.endsWith('.json')) return '#e8b45a';
    if (lower.endsWith('.xml')) return '#8b8f98';
    if (lower.endsWith('.md')) return '#6ea8ff';
    return '#8b8f98';
  }
</script>

<div class="file-tree">
  <div class="header">
    <span class="header-title">PROJECT</span>
    <button class="open-btn" onclick={onPickFolder} title="Open Folder">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"></path>
      </svg>
      <span>Open</span>
    </button>
  </div>

  {#if folderPath}
    <div class="root-folder">
      <span class="caret">▾</span>
      <span class="folder-name">{folderLeaf}</span>
    </div>

    <div class="tree-list">
      {#if rootEntries.length === 0}
        <div class="empty-folder">Empty folder</div>
      {:else}
        {#snippet renderEntry(entry: Entry, depth: number)}
          {@const isExpanded = !!expanded[entry.path]}
          {@const isDir = entry.is_dir}
          {@const isActive = entry.path === activeFilePath}

          {#if isDir}
            <button
              class="item dir-item"
              style="padding-left: {8 + depth * 16}px;"
              onclick={() => toggleFolder(entry)}
            >
              <span class="item-caret">{isExpanded ? '▾' : '▸'}</span>
              {#if isExpanded}
                <svg class="item-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8b8f98" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M5 19h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"></path>
                  <path d="M3 19l2-8h16l-2 8"></path>
                </svg>
              {:else}
                <svg class="item-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8b8f98" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"></path>
                </svg>
              {/if}
              <span class="item-name" class:dir-changed={isDirChanged(entry.path)}>{entry.name}</span>
            </button>

            {#if isExpanded}
              {#if loading[entry.path]}
                <div class="loading-node" style="padding-left: {8 + (depth + 1) * 16}px;">...</div>
              {:else if childrenCache[entry.path]}
                {#each childrenCache[entry.path] as child (child.path)}
                  {@render renderEntry(child, depth + 1)}
                {/each}
              {/if}
            {/if}
          {:else}
            {@const gitColor = getFileGitColor(entry.path)}
            <button
              class="item file-item"
              class:active={isActive}
              style="padding-left: {8 + depth * 16}px;"
              onclick={() => onSelectFile?.(entry)}
            >
              <span class="item-spacer"></span>
              <svg class="item-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={getFileColor(entry.name)} stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"></path>
                <polyline points="14 2 14 8 20 8"></polyline>
              </svg>
              <span class="item-name" style={gitColor ? `color: ${gitColor};` : ''}>{entry.name}</span>
            </button>
          {/if}
        {/snippet}

        {#each rootEntries as entry (entry.path)}
          {@render renderEntry(entry, 0)}
        {/each}
      {/if}
    </div>
  {:else}
    <div class="empty-state">
      <span class="empty-label">No folder open</span>
      <button class="open-folder-btn" onclick={onPickFolder}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
          <path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"></path>
        </svg>
        <span>Open Folder</span>
      </button>

      {#if recentFolders && recentFolders.length > 0}
        <div class="recent-section">
          <span class="recent-title">RECENT</span>
          <div class="recent-list">
            {#each recentFolders as rf}
              {@const leaf = rf.split('/').filter(Boolean).pop() || rf}
              <button class="recent-item" onclick={() => onOpenRecent?.(rf)} title={rf}>
                <span class="recent-name">{leaf}</span>
                <span class="recent-path">{rf}</span>
              </button>
            {/each}
          </div>
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .file-tree {
    width: 250px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    background: #141518;
    border-right: 1px solid #26282d;
    user-select: none;
    -webkit-user-select: none;
    overflow: hidden;
  }
  .header {
    height: 36px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 14px;
    border-bottom: 1px solid #1c1d22;
  }
  .header-title {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.8px;
    color: #8b8f98;
  }
  .open-btn {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    color: #6ea8ff;
    padding: 2px 6px;
    border-radius: 4px;
    transition: background 0.15s;
    background: transparent;
    border: none;
    cursor: pointer;
  }
  .open-btn:hover {
    background: #1f2a3d;
  }
  .root-folder {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    font-size: 13px;
    font-weight: 500;
    color: #e6e7ea;
    border-bottom: 1px solid #1c1d22;
  }
  .caret {
    color: #8b8f98;
    font-size: 11px;
  }
  .tree-list {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    padding: 2px 0;
  }
  .item {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 26px;
    padding-right: 12px;
    font-size: 13px;
    color: #bcbec4;
    text-align: left;
    width: 100%;
    transition: background 0.1s;
    border: none;
    background: transparent;
    cursor: pointer;
  }
  .item:hover {
    background: #1b1c21;
    color: #e6e7ea;
  }
  .file-item.active {
    background: #1f2a3d;
    color: #9cc3ff;
  }
  .item-caret {
    font-size: 10px;
    color: #6e727b;
    width: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  .item-spacer {
    width: 12px;
    flex-shrink: 0;
  }
  .item-icon {
    flex-shrink: 0;
  }
  .item-name {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: 13px;
  }
  .item-name.dir-changed {
    color: #e2e4e9;
  }
  .loading-node {
    height: 20px;
    display: flex;
    align-items: center;
    font-size: 11px;
    color: #5b5f68;
  }
  .empty-folder {
    padding: 16px;
    color: #8b8f98;
    font-size: 12px;
    text-align: center;
  }
  .empty-state {
    padding: 20px 14px;
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 12px;
    color: #8b8f98;
  }
  .empty-label {
    font-size: 12px;
    color: #8b8f98;
    text-align: center;
  }
  .open-folder-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 7px 12px;
    border-radius: 6px;
    background: #1f2a3d;
    color: #6ea8ff;
    font-size: 12px;
    font-weight: 500;
    border: 1px solid #2a3d5e;
    cursor: pointer;
    transition: background 0.15s;
  }
  .open-folder-btn:hover {
    background: #253652;
  }
  .recent-section {
    margin-top: 10px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .recent-title {
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.8px;
    color: #5b5f68;
  }
  .recent-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .recent-item {
    display: flex;
    flex-direction: column;
    padding: 6px 8px;
    border-radius: 5px;
    background: #18191d;
    border: 1px solid #22242a;
    cursor: pointer;
    text-align: left;
    transition: background 0.15s;
  }
  .recent-item:hover {
    background: #202227;
  }
  .recent-name {
    font-size: 12px;
    color: #d8d9dc;
    font-weight: 500;
  }
  .recent-path {
    font-size: 10px;
    color: #6e727b;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
