<script lang="ts">
  import type { Entry } from '../lib/api';

  let {
    entries = [],
    activeFilePath = '',
    folderPath = '',
    onSelectFile,
    onPickFolder,
  } = $props<{
    entries?: Entry[];
    activeFilePath?: string;
    folderPath?: string;
    onSelectFile?: (entry: Entry) => void;
    onPickFolder?: () => void;
  }>();

  let folderLeaf = $derived(
    folderPath ? folderPath.split('/').filter(Boolean).pop() || 'Project' : 'No Folder Open'
  );
</script>

<div class="file-tree">
  <div class="header">
    <span class="header-title">PROJECT</span>
    <button class="open-btn" onclick={onPickFolder} title="Open Folder">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
        <path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"></path>
      </svg>
      <span>Open</span>
    </button>
  </div>

  <div class="root-folder">
    <span class="caret">▾</span>
    <span class="folder-name">{folderLeaf}</span>
  </div>

  <div class="tree-list">
    {#if entries.length === 0}
      <div class="empty-state">
        <span>No files loaded</span>
        <button class="empty-open-btn" onclick={onPickFolder}>Open a Folder</button>
      </div>
    {:else}
      {#each entries as entry (entry.path)}
        {#if entry.is_dir}
          <div class="item dir-item">
            <span class="item-caret">▾</span>
            <svg class="item-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8b8f98" stroke-width="1.8">
              <path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"></path>
            </svg>
            <span class="item-name">{entry.name}</span>
          </div>
        {:else}
          <button
            class="item file-item"
            class:active={entry.path === activeFilePath}
            onclick={() => onSelectFile?.(entry)}
          >
            <span class="item-spacer"></span>
            <svg class="item-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8b8f98" stroke-width="1.8">
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"></path>
              <polyline points="14 2 14 8 20 8"></polyline>
            </svg>
            <span class="item-name">{entry.name}</span>
          </button>
        {/if}
      {/each}
    {/if}
  </div>
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
    padding-left: 20px;
    padding-right: 12px;
    font-size: 13px;
    color: #bcbec4;
    text-align: left;
    width: 100%;
    transition: background 0.1s;
    border: none;
    background: transparent;
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
    width: 10px;
  }
  .item-spacer {
    width: 10px;
  }
  .item-icon {
    flex-shrink: 0;
  }
  .item-name {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .empty-state {
    padding: 20px 14px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    color: #8b8f98;
    font-size: 12px;
  }
  .empty-open-btn {
    padding: 6px 12px;
    border-radius: 6px;
    background: #1f2a3d;
    color: #6ea8ff;
    font-size: 12px;
  }
  .empty-open-btn:hover {
    background: #253652;
  }
</style>
