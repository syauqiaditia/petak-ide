<script lang="ts">
  import type { GitDiffFile } from '../git/types';
  import type { TokenScopeMode } from './types';
  import DiffView from '../git/DiffView.svelte';

  let {
    diffFiles = [],
    selectedFilePath = null,
    tokenScope = 'none',
    onSelectFile,
    onCreateInlineNote,
  } = $props<{
    diffFiles: GitDiffFile[];
    selectedFilePath?: string | null;
    tokenScope: TokenScopeMode;
    onSelectFile?: (path: string) => void;
    onCreateInlineNote?: (path: string, line: number, text: string) => Promise<void>;
  }>();

  let activePath = $state<string | null>(null);

  $effect(() => {
    if (selectedFilePath !== undefined) {
      activePath = selectedFilePath;
    }
  });

  $effect(() => {
    if (!activePath && diffFiles.length > 0) {
      activePath = diffFiles[0].newPath || diffFiles[0].oldPath || null;
    }
  });

  let activeDiffFile = $derived<GitDiffFile | null>(
    diffFiles.find(
      (f) => (f.newPath || f.oldPath) === activePath
    ) || (diffFiles[0] ?? null)
  );

  function handleSelectFile(path: string) {
    activePath = path;
    onSelectFile?.(path);
  }

  function getFileStats(file: GitDiffFile) {
    let added = 0;
    let deleted = 0;
    for (const hunk of file.hunks) {
      for (const line of hunk.lines) {
        if (line.kind === 'add') added++;
        if (line.kind === 'del') deleted++;
      }
    }
    return { added, deleted };
  }

  function formatFilename(p: string) {
    const parts = p.split('/');
    const name = parts.pop() || p;
    const dir = parts.join('/');
    return { name, dir };
  }
</script>

<div class="mr-files-container">
  {#if diffFiles.length === 0}
    <div class="empty-diff">
      <div class="empty-icon">📄</div>
      <div class="empty-title">Tidak ada perubahan berkas</div>
      <div class="empty-desc">Tidak ada perbedaan kode yang ditemukan pada revisi Merge Request ini.</div>
    </div>
  {:else}
    <!-- Mini File Tree / List Sidebar -->
    <div class="files-sidebar">
      <div class="files-header">
        <span class="files-count">{diffFiles.length} berkas berubah</span>
      </div>
      <div class="files-list">
        {#each diffFiles as file ((file.newPath || file.oldPath || ''))}
          {@const path = file.newPath || file.oldPath || ''}
          {@const { name, dir } = formatFilename(path)}
          {@const stats = getFileStats(file)}
          {@const isSelected = path === (activeDiffFile?.newPath || activeDiffFile?.oldPath)}

          <button
            class="file-item-btn"
            class:selected={isSelected}
            onclick={() => handleSelectFile(path)}
          >
            <div class="file-item-main">
              <span class="file-status-tag" class:mod={file.status === 'modified'} class:add={file.status === 'added'} class:del={file.status === 'deleted'}>
                {file.status === 'added' ? 'A' : file.status === 'deleted' ? 'D' : 'M'}
              </span>
              <span class="file-name" title={path}>{name}</span>
            </div>
            {#if dir}
              <span class="file-dir" title={dir}>{dir}</span>
            {/if}
            <div class="file-diff-stats">
              {#if stats.added > 0}
                <span class="stat-added">+{stats.added}</span>
              {/if}
              {#if stats.deleted > 0}
                <span class="stat-deleted">-{stats.deleted}</span>
              {/if}
            </div>
          </button>
        {/each}
      </div>
    </div>

    <!-- Diff Viewer Area (reusing DiffView.svelte) -->
    <div class="diff-viewer-wrapper">
      {#if activeDiffFile}
        <DiffView
          diffFile={activeDiffFile}
          sourceKind="commit"
          filePath={activeDiffFile.newPath || activeDiffFile.oldPath || ''}
        />
      {:else}
        <div class="no-file-selected">Pilih berkas untuk melihat perbandingan diff</div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .mr-files-container {
    display: flex;
    height: 100%;
    width: 100%;
    overflow: hidden;
  }

  .empty-diff {
    margin: auto;
    text-align: center;
    padding: 40px;
    color: #8b949e;
  }

  .empty-icon {
    font-size: 32px;
    margin-bottom: 8px;
  }

  .empty-title {
    font-size: 15px;
    font-weight: 600;
    color: #c9cdd4;
    margin-bottom: 4px;
  }

  .empty-desc {
    font-size: 12px;
  }

  .files-sidebar {
    width: 250px;
    flex-shrink: 0;
    background: #141518;
    border-right: 1px solid #2c2e34;
    display: flex;
    flex-direction: column;
    overflow-y: auto;
  }

  .files-header {
    padding: 10px 14px;
    border-bottom: 1px solid #26282d;
    font-size: 11px;
    font-weight: 600;
    color: #8b949e;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .files-list {
    display: flex;
    flex-direction: column;
  }

  .file-item-btn {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    padding: 8px 12px;
    background: transparent;
    border: none;
    border-left: 2px solid transparent;
    text-align: left;
    cursor: pointer;
    transition: background 0.1s ease;
    gap: 2px;
    width: 100%;
  }

  .file-item-btn:hover {
    background: #1a1b1f;
  }

  .file-item-btn.selected {
    background: #23252b;
    border-left-color: #3574f0;
  }

  .file-item-main {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
  }

  .file-status-tag {
    font-size: 9px;
    font-weight: 700;
    padding: 1px 4px;
    border-radius: 2px;
    line-height: 1;
  }

  .file-status-tag.mod {
    background: rgba(227, 179, 65, 0.2);
    color: #e3b341;
  }

  .file-status-tag.add {
    background: rgba(126, 231, 135, 0.2);
    color: #7ee787;
  }

  .file-status-tag.del {
    background: rgba(248, 81, 73, 0.2);
    color: #f85149;
  }

  .file-name {
    font-size: 12px;
    font-weight: 500;
    color: #e6edf3;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
  }

  .file-dir {
    font-size: 10px;
    color: #8b949e;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    width: 100%;
  }

  .file-diff-stats {
    display: flex;
    gap: 6px;
    font-size: 10px;
    font-family: monospace;
    margin-top: 2px;
  }

  .stat-added {
    color: #7ee787;
  }

  .stat-deleted {
    color: #f85149;
  }

  .diff-viewer-wrapper {
    flex: 1;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    background: #16171a;
  }

  .no-file-selected {
    margin: auto;
    font-size: 13px;
    color: #8b949e;
  }
</style>
