<script lang="ts">
  import type { EditorView } from '@codemirror/view';
  import { vcsTrackerStore } from './vcsTracker.svelte';
  import { gitStore } from '../git/git.svelte.ts';

  let {
    getView,
    onShowDiff,
  }: {
    getView: () => EditorView | null;
    onShowDiff?: (filePath?: string) => void;
  } = $props();

  let copied = $state(false);

  let curHunk = $derived(vcsTrackerStore.activeHunk);
  let allHunks = $derived(vcsTrackerStore.allHunks);
  let curIndex = $derived(
    curHunk ? allHunks.findIndex((h) => h.id === curHunk?.id) : -1
  );
  let isFirst = $derived(curIndex <= 0);
  let isLast = $derived(curIndex >= allHunks.length - 1 || curIndex === -1);

  function handleClose() {
    vcsTrackerStore.close();
    getView()?.focus();
  }

  function handleRollback() {
    const view = getView();
    if (view) {
      vcsTrackerStore.rollback(view);
    }
  }

  async function handleShowDiff() {
    const targetPath = vcsTrackerStore.filePath;
    vcsTrackerStore.close();
    if (onShowDiff) {
      onShowDiff(targetPath || undefined);
    } else if (vcsTrackerStore.onShowDiff) {
      vcsTrackerStore.onShowDiff(targetPath);
    } else if (targetPath) {
      const relPath = gitStore.root && targetPath.startsWith(gitStore.root)
        ? targetPath.slice(gitStore.root.length).replace(/^\/+/, '')
        : targetPath;
      await gitStore.selectFile(relPath, 'worktree');
      const fileName = relPath.split('/').pop() || relPath;
      gitStore.openCenterDiff({
        diffFile: gitStore.currentDiffFile,
        filePath: relPath,
        leftLabel: 'Index (Staged)',
        rightLabel: 'Working Tree',
        sourceKind: 'worktree',
        title: `${fileName} (Worktree)`,
      });
    }
  }

  function handlePrev() {
    const view = getView();
    if (view) {
      vcsTrackerStore.prevHunk(view);
    }
  }

  function handleNext() {
    const view = getView();
    if (view) {
      vcsTrackerStore.nextHunk(view);
    }
  }

  async function handleCopy() {
    if (!curHunk) return;
    const textToCopy = curHunk.origCode || curHunk.currCode;
    try {
      await navigator.clipboard.writeText(textToCopy);
      copied = true;
      setTimeout(() => (copied = false), 1500);
    } catch (e) {
      console.error('Failed to copy to clipboard', e);
    }
  }

  function onKeyDown(e: KeyboardEvent) {
    if (!vcsTrackerStore.isOpen) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      handleClose();
    } else if (e.key === 'ArrowUp' && (e.altKey || e.metaKey)) {
      e.preventDefault();
      e.stopPropagation();
      handlePrev();
    } else if (e.key === 'ArrowDown' && (e.altKey || e.metaKey)) {
      e.preventDefault();
      e.stopPropagation();
      handleNext();
    }
  }
</script>

<svelte:window onkeydowncapture={onKeyDown} />

{#if vcsTrackerStore.isOpen && curHunk}
  <!-- Backdrop click to dismiss -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="vcs-popup-backdrop" onclick={handleClose}></div>

  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div
    class="vcs-diff-popup"
    style="left: {vcsTrackerStore.coords.left}px; top: {vcsTrackerStore.coords.top}px;"
    onclick={(e) => e.stopPropagation()}
    role="dialog"
    aria-label="Line Status Tracker Diff"
  >
    <!-- Header Toolbar -->
    <div class="popup-toolbar">
      <div class="toolbar-left">
        <button
          class="tool-btn"
          onclick={handlePrev}
          disabled={isFirst}
          title="Previous change (⌥↑)"
          aria-label="Previous change"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <polyline points="18 15 12 9 6 15"></polyline>
          </svg>
        </button>

        <button
          class="tool-btn"
          onclick={handleNext}
          disabled={isLast}
          title="Next change (⌥↓)"
          aria-label="Next change"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <polyline points="6 9 12 15 18 9"></polyline>
          </svg>
        </button>

        <div class="sep"></div>

        <button
          class="tool-btn rollback-btn"
          onclick={handleRollback}
          title="Rollback hunk to Git HEAD"
          aria-label="Rollback hunk"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="1 4 1 10 7 10"></polyline>
            <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path>
          </svg>
          <span class="btn-text">Rollback</span>
        </button>

        <button
          class="tool-btn"
          onclick={handleShowDiff}
          title="Show Diff in Center Editor"
          aria-label="Show Diff"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
            <line x1="12" y1="3" x2="12" y2="21"></line>
          </svg>
          <span class="btn-text">Show Diff</span>
        </button>

        <button
          class="tool-btn"
          onclick={handleCopy}
          title="Copy original code"
          aria-label="Copy original code"
        >
          {#if copied}
            <span class="copied-indicator">✓</span>
          {:else}
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
          {/if}
        </button>
      </div>

      <div class="toolbar-center">
        <span class="badge {curHunk.kind}">
          {curHunk.kind === 'modified' ? 'Modified' : curHunk.kind === 'added' ? 'Added' : 'Deleted'}
          {#if curHunk.startNewLine === curHunk.endNewLine}
            Ln {curHunk.startNewLine}
          {:else}
            Ln {curHunk.startNewLine}–{curHunk.endNewLine}
          {/if}
        </span>
        {#if allHunks.length > 1}
          <span class="counter">{curIndex + 1}/{allHunks.length}</span>
        {/if}
      </div>

      <div class="toolbar-right">
        <button class="close-btn" onclick={handleClose} title="Close (Esc)" aria-label="Close">
          ✕
        </button>
      </div>
    </div>

    <!-- Diff Content Body -->
    <div class="popup-body">
      {#if curHunk.kind === 'added'}
        <div class="body-header added-hdr">
          <span class="hdr-icon">+</span>
          <span class="hdr-label">Added lines (not present in HEAD)</span>
        </div>
        <pre class="code-block added-block"><code>{curHunk.currCode}</code></pre>
      {:else}
        <div class="body-header deleted-hdr">
          <span class="hdr-icon">-</span>
          <span class="hdr-label">Original from HEAD (replaced/deleted)</span>
        </div>
        <pre class="code-block deleted-block"><code>{curHunk.origCode}</code></pre>
      {/if}
    </div>

    <!-- Footer Bar -->
    <div class="popup-footer">
      <span class="footer-hint">
        <kbd>Esc</kbd> Close · <kbd>⌥↑</kbd>/<kbd>⌥↓</kbd> Navigasi
      </span>
      <button class="footer-rollback-btn" onclick={handleRollback}>
        Revert to HEAD
      </button>
    </div>
  </div>
{/if}

<style>
  .vcs-popup-backdrop {
    position: fixed;
    inset: 0;
    z-index: 99990;
    background: transparent;
  }

  .vcs-diff-popup {
    position: fixed;
    z-index: 99995;
    width: 440px;
    max-width: calc(100vw - 40px);
    background-color: #25272a;
    border: 1px solid #3c3f41;
    border-radius: 6px;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.55), 0 2px 6px rgba(0, 0, 0, 0.35);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  }

  .popup-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 32px;
    background-color: #2b2d30;
    border-bottom: 1px solid #36383b;
    padding: 0 8px;
    user-select: none;
  }

  .toolbar-left {
    display: flex;
    align-items: center;
    gap: 3px;
  }

  .tool-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    background: transparent;
    border: none;
    color: #bcbec4;
    padding: 3px 6px;
    border-radius: 3px;
    cursor: pointer;
    font-size: 11px;
    height: 22px;
    transition: background-color 0.1s ease, color 0.1s ease;
  }

  .tool-btn:hover:not(:disabled) {
    background-color: #383a3e;
    color: #ffffff;
  }

  .tool-btn:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }

  .rollback-btn {
    color: #79a8ff;
    font-weight: 500;
  }

  .rollback-btn:hover:not(:disabled) {
    background-color: #2f3e58 !important;
    color: #a8c8ff !important;
  }

  .btn-text {
    font-size: 11px;
  }

  .sep {
    width: 1px;
    height: 14px;
    background-color: #3c3f41;
    margin: 0 2px;
  }

  .copied-indicator {
    color: #4ade80;
    font-weight: bold;
    font-size: 12px;
  }

  .toolbar-center {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .badge {
    font-size: 10px;
    padding: 1px 6px;
    border-radius: 3px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.4px;
  }

  .badge.modified {
    background-color: rgba(56, 130, 246, 0.2);
    color: #79a8ff;
    border: 1px solid rgba(56, 130, 246, 0.4);
  }

  .badge.added {
    background-color: rgba(74, 222, 128, 0.2);
    color: #4ade80;
    border: 1px solid rgba(74, 222, 128, 0.4);
  }

  .badge.deleted {
    background-color: rgba(240, 122, 116, 0.2);
    color: #f07a74;
    border: 1px solid rgba(240, 122, 116, 0.4);
  }

  .counter {
    font-size: 11px;
    color: #7a7e85;
  }

  .toolbar-right {
    display: flex;
    align-items: center;
  }

  .close-btn {
    background: transparent;
    border: none;
    color: #7a7e85;
    cursor: pointer;
    font-size: 11px;
    padding: 2px 6px;
    border-radius: 3px;
  }

  .close-btn:hover {
    background-color: #383a3e;
    color: #ffffff;
  }

  .popup-body {
    max-height: 220px;
    overflow-y: auto;
    background-color: #1e1f22;
    padding: 8px 10px;
    font-size: 12px;
    line-height: 1.45;
  }

  .body-header {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    font-weight: 500;
    margin-bottom: 6px;
  }

  .deleted-hdr {
    color: #f07a74;
  }

  .added-hdr {
    color: #4ade80;
  }

  .hdr-icon {
    font-weight: bold;
    font-size: 13px;
  }

  .code-block {
    margin: 0;
    padding: 8px;
    border-radius: 4px;
    font-family: 'JetBrains Mono', Menlo, Monaco, Consolas, monospace;
    font-size: 11.5px;
    overflow-x: auto;
    white-space: pre;
  }

  .deleted-block {
    background-color: rgba(240, 122, 116, 0.1);
    color: #ffb4b0;
    border-left: 2px solid #f07a74;
  }

  .added-block {
    background-color: rgba(74, 222, 128, 0.1);
    color: #bbf7d0;
    border-left: 2px solid #4ade80;
  }

  .popup-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 30px;
    background-color: #2b2d30;
    border-top: 1px solid #36383b;
    padding: 0 10px;
  }

  .footer-hint {
    font-size: 10px;
    color: #7a7e85;
  }

  .footer-hint kbd {
    background: #1e1f22;
    border: 1px solid #3c3f41;
    border-radius: 2px;
    padding: 1px 4px;
    font-size: 9px;
    color: #bcbec4;
  }

  .footer-rollback-btn {
    background-color: #2b4365;
    border: 1px solid #3b669b;
    color: #dbeafe;
    border-radius: 3px;
    font-size: 10.5px;
    font-weight: 500;
    padding: 2px 8px;
    cursor: pointer;
    transition: background-color 0.1s ease;
  }

  .footer-rollback-btn:hover {
    background-color: #365885;
    color: #ffffff;
  }
</style>
