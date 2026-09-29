<script lang="ts">
  import { gitStore } from './git.svelte';
  import type { GitCommitFile } from './types';

  let selectedCommit = $derived(gitStore.selectedCommit);
  let selectedCommits = $derived(gitStore.selectedCommits);
  let isMultiple = $derived(selectedCommits.length > 1);

  let commitFiles = $derived(gitStore.commitFiles);
  let loadingFiles = $derived(gitStore.commitFilesLoading);

  let copied = $state(false);

  function copySha(sha: string) {
    if (!navigator?.clipboard) return;
    navigator.clipboard.writeText(sha).then(() => {
      copied = true;
      setTimeout(() => {
        copied = false;
      }, 2000);
    });
  }

  function getStatusLetter(status: string): string {
    switch (status) {
      case 'added': return 'A';
      case 'deleted': return 'D';
      case 'renamed': return 'R';
      case 'copied': return 'C';
      case 'typeChanged': return 'T';
      default: return 'M';
    }
  }

  function getStatusColor(status: string): string {
    switch (status) {
      case 'added': return '#7fc98f'; // Green
      case 'deleted': return '#f0a6a2'; // Coral / Red
      case 'renamed': return '#e8b45a'; // Amber
      case 'copied': return '#c084fc'; // Purple
      default: return '#9cc3ff'; // Blue
    }
  }

  function splitFilePath(path: string): { fileName: string; dirName: string } {
    const parts = path.split('/');
    const fileName = parts.pop() || path;
    const dirName = parts.join('/');
    return { fileName, dirName };
  }

  function formatDate(timeSec: number): string {
    if (!timeSec) return '';
    const d = new Date(timeSec * 1000);
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }
</script>

<div class="commit-detail">
  {#if !selectedCommit}
    <div class="empty-state">
      <div class="empty-text">No commit selected</div>
      <div class="empty-sub">Select a commit from the log to view details</div>
    </div>
  {:else if isMultiple}
    <!-- Multiple Commits Selected View (Matches Git.html) -->
    <div class="detail-section border-b">
      <div class="section-title">CHANGES IN {selectedCommits.length} COMMITS</div>
      {#if loadingFiles}
        <div class="loading-text">Loading changed files…</div>
      {:else if commitFiles.length === 0}
        <div class="empty-sub">No changed files found</div>
      {:else}
        <div class="files-list">
          {#each commitFiles as file}
            {@const { fileName, dirName } = splitFilePath(file.path)}
            <button
              class="file-row"
              onclick={() => gitStore.openCommitDiff(file)}
              title="Click to view diff: {file.path}"
            >
              <span
                class="status-letter mono"
                style="color: {getStatusColor(file.status)}"
              >
                {getStatusLetter(file.status)}
              </span>
              <span class="file-name">{fileName}</span>
              {#if dirName}
                <span class="dir-name">{dirName}</span>
              {/if}
            </button>
          {/each}
        </div>
      {/if}
    </div>

    <div class="detail-section">
      <div class="section-title">SELECTED</div>
      <div class="selected-commits-list">
        {#each selectedCommits as c}
          <div class="selected-commit-row">
            <span class="mono sha">{c.shortSha}</span>
            <span class="commit-subject">{c.subject}</span>
          </div>
        {/each}
      </div>

      {#if selectedCommits.every((c) => !c.pushed)}
        <div class="notice-box">
          Local only · not pushed yet. Safe to squash without force push.
        </div>
      {:else}
        <div class="notice-box warning">
          Some selected commits are already on remote. Rewrite will require force push.
        </div>
      {/if}
    </div>
  {:else}
    <!-- Single Commit Selected View -->
    <div class="detail-header border-b">
      <div class="subject">{selectedCommit.subject}</div>

      <div class="meta-grid">
        <div class="meta-label">Author</div>
        <div class="meta-value">
          <span class="author-name">{selectedCommit.authorName}</span>
          {#if selectedCommit.authorEmail}
            <span class="author-email">&lt;{selectedCommit.authorEmail}&gt;</span>
          {/if}
        </div>

        <div class="meta-label">Date</div>
        <div class="meta-value">{formatDate(selectedCommit.authorTime)}</div>

        <div class="meta-label">Commit</div>
        <div class="meta-value sha-row">
          <span class="mono full-sha">{selectedCommit.sha.slice(0, 10)}</span>
          <button
            class="copy-btn"
            onclick={() => copySha(selectedCommit!.sha)}
            title="Copy full SHA"
          >
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>

        {#if selectedCommit.parents && selectedCommit.parents.length > 0}
          <div class="meta-label">Parents</div>
          <div class="meta-value parents-row">
            {#each selectedCommit.parents as p}
              <button
                class="parent-link mono"
                onclick={() => gitStore.selectCommit(p)}
                title="Jump to parent commit {p}"
              >
                {p.slice(0, 7)}
              </button>
            {/each}
          </div>
        {/if}
      </div>

      {#if !selectedCommit.pushed}
        <div class="pushed-status unpushed">
          <span class="status-dot"></span>
          <span>Local only · not pushed yet</span>
        </div>
      {:else}
        <div class="pushed-status pushed">
          <span class="status-dot"></span>
          <span>Pushed to remote</span>
        </div>
      {/if}
    </div>

    <!-- Changed Files List -->
    <div class="detail-section flex-1">
      <div class="section-title">
        CHANGES ({commitFiles.length} {commitFiles.length === 1 ? 'FILE' : 'FILES'})
      </div>

      {#if loadingFiles}
        <div class="loading-text">Loading changed files…</div>
      {:else if commitFiles.length === 0}
        <div class="empty-sub">No files changed in this commit</div>
      {:else}
        <div class="files-list">
          {#each commitFiles as file}
            {@const { fileName, dirName } = splitFilePath(file.path)}
            <button
              class="file-row"
              onclick={() => gitStore.openCommitDiff(file)}
              title="Click to view diff for {file.path}"
            >
              <span
                class="status-letter mono"
                style="color: {getStatusColor(file.status)}"
              >
                {getStatusLetter(file.status)}
              </span>
              <span class="file-name">{fileName}</span>
              {#if dirName}
                <span class="dir-name">{dirName}</span>
              {/if}
            </button>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .commit-detail {
    width: 360px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    background: #141518;
    border-left: 1px solid #26282d;
    height: 100%;
    overflow-y: auto;
    font-size: 13px;
    color: #d8d9dc;
  }

  .border-b {
    border-bottom: 1px solid #222428;
  }

  .empty-state {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 32px;
    text-align: center;
    color: #8b8f98;
  }

  .empty-text {
    font-weight: 500;
    font-size: 14px;
    margin-bottom: 6px;
    color: #b9bcc3;
  }

  .empty-sub {
    font-size: 12px;
    color: #656973;
  }

  .detail-header {
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .subject {
    font-size: 14px;
    font-weight: 600;
    color: #e6e7ea;
    line-height: 1.4;
    word-break: break-word;
  }

  .meta-grid {
    display: grid;
    grid-template-columns: 60px 1fr;
    row-gap: 6px;
    column-gap: 8px;
    font-size: 12px;
    align-items: center;
  }

  .meta-label {
    color: #8b8f98;
    font-size: 11px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .meta-value {
    color: #d8d9dc;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .author-name {
    color: #e6e7ea;
    font-weight: 500;
  }

  .author-email {
    color: #8b8f98;
    margin-left: 4px;
    font-size: 11px;
  }

  .sha-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .full-sha {
    color: #9cc3ff;
    font-size: 12px;
  }

  .copy-btn {
    padding: 2px 6px;
    font-size: 11px;
    border-radius: 4px;
    border: 1px solid #2c2e34;
    background: #1c1d22;
    color: #b9bcc3;
    cursor: pointer;
  }

  .copy-btn:hover {
    background: #25272e;
    color: #ffffff;
  }

  .parents-row {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }

  .parent-link {
    background: #1a1c22;
    border: 1px solid #282a30;
    border-radius: 4px;
    padding: 1px 6px;
    font-size: 11px;
    color: #6ea8ff;
    cursor: pointer;
  }

  .parent-link:hover {
    background: #22252e;
    color: #9cc3ff;
  }

  .pushed-status {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    margin-top: 4px;
  }

  .pushed-status .status-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
  }

  .pushed-status.unpushed {
    color: #e8b45a;
  }
  .pushed-status.unpushed .status-dot {
    background: #e8b45a;
  }

  .pushed-status.pushed {
    color: #7fc98f;
  }
  .pushed-status.pushed .status-dot {
    background: #7fc98f;
  }

  .detail-section {
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .detail-section.flex-1 {
    flex: 1;
  }

  .section-title {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.8px;
    color: #8b8f98;
    text-transform: uppercase;
  }

  .files-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
    line-height: 26px;
  }

  .file-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 2px 6px;
    border-radius: 4px;
    border: none;
    background: transparent;
    color: #d8d9dc;
    font-size: 12px;
    text-align: left;
    cursor: pointer;
    width: 100%;
  }

  .file-row:hover {
    background: #1c1d22;
  }

  .status-letter {
    width: 14px;
    font-weight: 600;
    text-align: center;
    font-size: 12px;
  }

  .file-name {
    color: #e6e7ea;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .dir-name {
    margin-left: auto;
    color: #8b8f98;
    font-size: 11px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 120px;
  }

  .selected-commits-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
    font-size: 12px;
    margin-top: 4px;
  }

  .selected-commit-row {
    display: flex;
    gap: 8px;
    align-items: center;
  }

  .sha {
    color: #8b8f98;
    font-size: 12px;
  }

  .commit-subject {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .notice-box {
    margin-top: 8px;
    padding: 12px;
    border-radius: 8px;
    background: #1a1b1f;
    border: 1px solid #2a2c32;
    font-size: 12px;
    line-height: 18px;
    color: #b9bcc3;
  }

  .notice-box.warning {
    border-color: #4a3818;
    background: #241d13;
    color: #f0cf8e;
  }

  .loading-text {
    font-size: 12px;
    color: #8b8f98;
    font-style: italic;
    padding: 8px 0;
  }

  .mono {
    font-family: 'JetBrains Mono', ui-monospace, monospace;
  }
</style>
