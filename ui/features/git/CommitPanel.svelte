<script lang="ts">
  import { onMount } from 'svelte';
  import { gitStore } from './git.svelte.ts';
  import type { GitStatusEntry } from './types.ts';

  let commitMessage = $state('');
  let isAmend = $state(false);
  let isCommitting = $state(false);
  let commitError = $state<string | null>(null);

  let lines = $derived(commitMessage.split('\n'));
  let subject = $derived(lines[0] ?? '');
  let subjectLen = $derived(subject.length);
  let hasLine2Warning = $derived(lines.length > 1 && lines[1].trim().length > 0);

  let canCommit = $derived(
    !isCommitting &&
    commitMessage.trim().length > 0 &&
    (gitStore.stagedEntries.length > 0 || isAmend)
  );

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
      await gitStore.commit(commitMessage.trim(), isAmend);
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
        return { char: 'M', color: '#6ea8ff' };
      case 'added':
        return { char: 'A', color: '#7fc98f' };
      case 'deleted':
        return { char: 'D', color: '#f07a74' };
      case 'renamed':
        return { char: 'R', color: '#6ea8ff' };
      case 'copied':
        return { char: 'C', color: '#7fc98f' };
      case 'untracked':
        return { char: '?', color: '#7fc98f' };
      default:
        return { char: 'M', color: '#8b8f98' };
    }
  }

  function formatPath(filePath: string) {
    const parts = filePath.split('/');
    const name = parts.pop() || filePath;
    const dir = parts.join('/');
    return { name, dir };
  }
</script>

<div class="commit-panel">
  <!-- File Groups List -->
  <div class="files-container">
    <!-- 1. Staged Changes -->
    <div class="group-section">
      <div class="group-header">
        <span class="group-title">STAGED ({gitStore.stagedEntries.length})</span>
        {#if gitStore.stagedEntries.length > 0}
          <button
            class="action-btn"
            title="Unstage all"
            onclick={() => gitStore.unstageAll()}
          >
            Unstage All
          </button>
        {/if}
      </div>

      <div class="group-list">
        {#if gitStore.stagedEntries.length === 0}
          <div class="empty-hint">No staged changes</div>
        {:else}
          {#each gitStore.stagedEntries as entry (entry.path)}
            {@const { char, color } = getStatusLetter(entry, true)}
            {@const { name, dir } = formatPath(entry.path)}
            {@const isSelected =
              gitStore.selectedFile?.path === entry.path &&
              gitStore.selectedFile?.kind === 'staged'}
            <div
              class="file-row"
              class:selected={isSelected}
              onclick={() => gitStore.selectFile(entry.path, 'staged')}
              role="button"
              tabindex="0"
              onkeydown={(e) => {
                if (e.key === 'Enter') gitStore.selectFile(entry.path, 'staged');
              }}
            >
              <button
                class="stage-toggle-btn unstage"
                title="Unstage file"
                onclick={(e) => {
                  e.stopPropagation();
                  gitStore.unstageFiles([entry.path]);
                }}
              >
                −
              </button>
              <span class="status-badge" style="color: {color};">{char}</span>
              <span class="file-name" title={entry.path}>{name}</span>
              {#if dir}
                <span class="file-dir">{dir}</span>
              {/if}
            </div>
          {/each}
        {/if}
      </div>
    </div>

    <!-- 2. Changes (Worktree) -->
    <div class="group-section">
      <div class="group-header">
        <span class="group-title">CHANGES ({gitStore.changesEntries.length})</span>
        {#if gitStore.changesEntries.length > 0}
          <button
            class="action-btn"
            title="Stage all changes"
            onclick={() => gitStore.stageAll()}
          >
            Stage All
          </button>
        {/if}
      </div>

      <div class="group-list">
        {#if gitStore.changesEntries.length === 0}
          <div class="empty-hint">No unstaged changes</div>
        {:else}
          {#each gitStore.changesEntries as entry (entry.path)}
            {@const { char, color } = getStatusLetter(entry, false)}
            {@const { name, dir } = formatPath(entry.path)}
            {@const isSelected =
              gitStore.selectedFile?.path === entry.path &&
              gitStore.selectedFile?.kind === 'worktree'}
            <div
              class="file-row"
              class:selected={isSelected}
              class:conflicted={entry.conflicted}
              onclick={() => gitStore.selectFile(entry.path, 'worktree')}
              role="button"
              tabindex="0"
              onkeydown={(e) => {
                if (e.key === 'Enter') gitStore.selectFile(entry.path, 'worktree');
              }}
            >
              <button
                class="stage-toggle-btn stage"
                title="Stage file"
                onclick={(e) => {
                  e.stopPropagation();
                  gitStore.stageFiles([entry.path]);
                }}
              >
                +
              </button>
              <span class="status-badge" style="color: {color};">{char}</span>
              <span class="file-name" title={entry.path}>{name}</span>
              {#if entry.conflicted}
                <span class="conflict-tag">conflict</span>
              {:else if dir}
                <span class="file-dir">{dir}</span>
              {/if}
            </div>
          {/each}
        {/if}
      </div>
    </div>

    <!-- 3. Untracked -->
    {#if gitStore.untrackedEntries.length > 0}
      <div class="group-section">
        <div class="group-header">
          <span class="group-title">UNTRACKED ({gitStore.untrackedEntries.length})</span>
          <button
            class="action-btn"
            title="Stage untracked files"
            onclick={() => {
              const paths = gitStore.untrackedEntries.map((e) => e.path);
              gitStore.stageFiles(paths);
            }}
          >
            Stage All
          </button>
        </div>

        <div class="group-list">
          {#each gitStore.untrackedEntries as entry (entry.path)}
            {@const { char, color } = getStatusLetter(entry, false)}
            {@const { name, dir } = formatPath(entry.path)}
            {@const isSelected =
              gitStore.selectedFile?.path === entry.path &&
              gitStore.selectedFile?.kind === 'worktree'}
            <div
              class="file-row"
              class:selected={isSelected}
              onclick={() => gitStore.selectFile(entry.path, 'worktree')}
              role="button"
              tabindex="0"
              onkeydown={(e) => {
                if (e.key === 'Enter') gitStore.selectFile(entry.path, 'worktree');
              }}
            >
              <button
                class="stage-toggle-btn stage"
                title="Stage file"
                onclick={(e) => {
                  e.stopPropagation();
                  gitStore.stageFiles([entry.path]);
                }}
              >
                +
              </button>
              <span class="status-badge" style="color: {color};">{char}</span>
              <span class="file-name" title={entry.path}>{name}</span>
              {#if dir}
                <span class="file-dir">{dir}</span>
              {/if}
            </div>
          {/each}
        </div>
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
        ⚠️ Baris ke-2 sebaiknya kosong (pemisah subject & deskripsi).
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
        title="Fase 5 — Write commit message with AI agent"
      >
        ✨ Write with agent
      </button>

      <button
        class="commit-btn"
        disabled={!canCommit}
        onclick={doCommit}
      >
        {#if isCommitting}
          Committing...
        {:else if isAmend}
          Amend Commit
        {:else}
          Commit ({gitStore.stagedEntries.length})
        {/if}
      </button>
    </div>
  </div>
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

  .stage-toggle-btn {
    width: 18px;
    height: 18px;
    display: grid;
    place-items: center;
    border-radius: 3px;
    font-size: 13px;
    font-weight: 600;
    line-height: 1;
    color: #8b8f98;
    background: #1c1e23;
    border: 1px solid #2c2e34;
    transition: all 0.1s;
  }

  .stage-toggle-btn:hover {
    color: #d8d9dc;
    border-color: #6ea8ff;
  }

  .stage-toggle-btn.stage:hover {
    background: #1b2b20;
    color: #7fc98f;
  }

  .stage-toggle-btn.unstage:hover {
    background: #2c1d1f;
    color: #f07a74;
  }

  .status-badge {
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    font-size: 11px;
    font-weight: 700;
    width: 14px;
    text-align: center;
  }

  .file-name {
    flex-shrink: 0;
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
