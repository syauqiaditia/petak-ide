<script lang="ts">
  import { runStore } from './runStore.svelte';
  import { mapBuildErrorToLink } from './logic';

  let { onSelectFile } = $props<{
    onSelectFile?: (file: string, line: number, col?: number) => void;
  }>();

  function handleOpen(file: string, line: number, col?: number | null) {
    if (file && onSelectFile) {
      onSelectFile(file, line, col ?? 1);
    }
  }
</script>

<div class="build-panel">
  <!-- Header / Summary -->
  <div class="toolbar">
    <div class="status-summary">
      {#if runStore.buildErrors.length === 0}
        <span class="status-clean">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#7fc98f" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
          No build issues
        </span>
      {:else}
        <span class="status-errors">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f07a74" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="8" x2="12" y2="12"></line>
            <line x1="12" y1="16" x2="12.01" y2="16"></line>
          </svg>
          {runStore.buildErrors.length} {runStore.buildErrors.length === 1 ? 'error' : 'errors'}
        </span>
      {/if}
    </div>

    <div class="spacer"></div>

    {#if runStore.buildErrors.length > 0}
      <button class="clear-btn" onclick={() => runStore.clearBuildErrors()}>
        Clear
      </button>
    {/if}
  </div>

  <!-- Errors List -->
  <div class="errors-list">
    {#if runStore.buildErrors.length === 0}
      <div class="empty-state">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#5b5f68" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
          <polyline points="22 4 12 14.01 9 11.01"></polyline>
        </svg>
        <span>Build output is clean. No errors recorded.</span>
      </div>
    {:else}
      {#each runStore.buildErrors as err, i (i)}
        {@const link = mapBuildErrorToLink(err)}
        <div
          class="error-row"
          onclick={() => handleOpen(err.file, err.line, err.col)}
          role="button"
          tabindex="0"
          onkeydown={(e) => { if (e.key === 'Enter') handleOpen(err.file, err.line, err.col); }}
        >
          <span class="error-badge">E</span>
          <span class="error-loc" title={err.file}>{link.label}</span>
          <span class="error-msg">{err.message}</span>
        </div>
      {/each}
    {/if}
  </div>
</div>

<style>
  .build-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    width: 100%;
    background: #141518;
    overflow: hidden;
  }
  .toolbar {
    height: 32px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0 12px;
    border-bottom: 1px solid #222428;
    background: #141518;
  }
  .status-summary {
    display: flex;
    align-items: center;
    font-size: 12px;
    font-weight: 500;
  }
  .status-clean {
    display: flex;
    align-items: center;
    gap: 6px;
    color: #7fc98f;
  }
  .status-errors {
    display: flex;
    align-items: center;
    gap: 6px;
    color: #f07a74;
  }
  .spacer {
    flex-grow: 1;
  }
  .clear-btn {
    height: 22px;
    padding: 0 8px;
    border-radius: 4px;
    background: transparent;
    color: #8b8f98;
    border: 1px solid #2c2e34;
    font-size: 11px;
    cursor: pointer;
  }
  .clear-btn:hover {
    color: #d8d9dc;
    background: #1e2025;
  }
  .errors-list {
    flex: 1;
    overflow-y: auto;
    padding: 8px 14px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 30px 0;
    color: #8b8f98;
    font-size: 12px;
  }
  .error-row {
    display: flex;
    align-items: baseline;
    gap: 10px;
    padding: 6px 10px;
    border-radius: 6px;
    background: #1b1718;
    border: 1px solid #362224;
    cursor: pointer;
    font-size: 12px;
    line-height: 18px;
    transition: background 0.1s;
  }
  .error-row:hover {
    background: #251b1d;
    border-color: #4a2629;
  }
  .error-badge {
    color: #f07a74;
    font-weight: 700;
    font-size: 11px;
    flex-shrink: 0;
  }
  .error-loc {
    font-family: 'JetBrains Mono', monospace;
    color: #6ea8ff;
    font-size: 12px;
    flex-shrink: 0;
    text-decoration: underline;
  }
  .error-msg {
    color: #e6e7ea;
    font-family: 'JetBrains Mono', monospace;
    font-size: 12px;
    white-space: pre-wrap;
    word-break: break-all;
  }
</style>
