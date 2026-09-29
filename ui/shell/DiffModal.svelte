<script lang="ts">
  import DiffView from '../features/git/DiffView.svelte';
  import type { GitDiffFile } from '../features/git/types';

  let {
    diffFile = null,
    title = '',
    onclose,
  } = $props<{
    diffFile: GitDiffFile | null;
    title: string;
    onclose: () => void;
  }>();

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      onclose();
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="modal-backdrop" onclick={onclose} role="presentation">
  <div class="modal-box" onclick={(e) => e.stopPropagation()} role="dialog">
    <div class="modal-header">
      <span class="modal-title">{title}</span>
      <button class="modal-close-btn" onclick={onclose} title="Close (Esc)">✕</button>
    </div>

    <div class="modal-body">
      {#if diffFile}
        <DiffView {diffFile} filePath={title} />
      {:else}
        <div class="empty-diff">No differences found</div>
      {/if}
    </div>

    <div class="modal-footer">
      <button class="btn btn-secondary" onclick={onclose}>Close</button>
    </div>
  </div>
</div>

<style>
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.7);
    backdrop-filter: blur(2px);
    z-index: 1100;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .modal-box {
    width: 960px;
    height: 620px;
    background: #1c1d22;
    border: 1px solid #34363d;
    border-radius: 10px;
    box-shadow: 0 24px 60px rgba(0, 0, 0, 0.7);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    color: #d8d9dc;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  }

  .modal-header {
    height: 48px;
    padding: 0 16px;
    display: flex;
    align-items: center;
    border-bottom: 1px solid #2a2c32;
    font-weight: 600;
    font-size: 13.5px;
    flex-shrink: 0;
  }

  .modal-title {
    color: #e6efff;
    font-family: 'JetBrains Mono', monospace;
    font-size: 13px;
  }

  .modal-close-btn {
    margin-left: auto;
    color: #8b8f98;
    background: none;
    border: none;
    font-size: 14px;
    cursor: pointer;
    padding: 4px;
    border-radius: 4px;
  }

  .modal-close-btn:hover {
    color: #d8d9dc;
    background: #26282d;
  }

  .modal-body {
    flex: 1;
    overflow: hidden;
    background: #1a1b1f;
    display: flex;
    flex-direction: column;
  }

  .empty-diff {
    padding: 40px;
    text-align: center;
    color: #8b8f98;
    font-size: 13px;
  }

  .modal-footer {
    height: 50px;
    padding: 0 16px;
    background: #18191d;
    border-top: 1px solid #2a2c32;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    flex-shrink: 0;
  }

  .btn {
    height: 30px;
    padding: 0 14px;
    border-radius: 6px;
    font-size: 12px;
    cursor: pointer;
    font-weight: 500;
    border: none;
    transition: background 0.15s;
  }

  .btn-secondary {
    background: #23252b;
    border: 1px solid #2c2e34;
    color: #b9bcc3;
  }

  .btn-secondary:hover {
    background: #2a2c32;
    color: #e6e7ea;
  }
</style>
