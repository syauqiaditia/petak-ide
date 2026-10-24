<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import type { EditorView } from '@codemirror/view';
  import { gitStore } from './git.svelte';
  import { api } from '../../lib/api';
  import type { GitConflictFile } from '../../lib/api';
  import {
    parseMergedIntoHunks,
    cloneHunks,
    getResultLines,
    computeMergedText,
    resolveHunkSide,
    autoResolveTrivialBlocks,
    acceptAllSide,
    applyAllIdentical,
    createSyncScrollCoordinator,
    createConflictResultEditor,
    type MergeHunk,
  } from './conflictResolverLogic';

  let {
    file,
    onClose = () => {},
    onResolved = () => {},
  } = $props<{
    file: GitConflictFile;
    onClose?: () => void;
    onResolved?: () => void;
  }>();

  let hunks = $state<MergeHunk[]>([]);
  let history = $state<MergeHunk[][]>([]);
  let historyIdx = $state(0);
  let isSaving = $state(false);
  let activeHunkIdx = $state(0);
  let editableContent = $state('');

  // DOM Elements for 3-Column Synchronized Scrolling
  let leftPanelEl = $state<HTMLElement | null>(null);
  let rightPanelEl = $state<HTMLElement | null>(null);
  let cmMountEl = $state<HTMLDivElement | null>(null);
  let editorView: EditorView | null = null;

  const scrollCoordinator = createSyncScrollCoordinator(() => ({
    left: leftPanelEl,
    center: editorView?.scrollDOM ?? null,
    right: rightPanelEl,
  }));

  function pushHistory(newHunks: MergeHunk[]) {
    history = history.slice(0, historyIdx + 1);
    history.push(cloneHunks(newHunks));
    historyIdx = history.length - 1;
    hunks = newHunks;
    const newMergedText = computeMergedText(newHunks);
    editableContent = newMergedText;
    if (editorView) {
      const cur = editorView.state.doc.toString();
      if (cur !== newMergedText) {
        editorView.dispatch({
          changes: { from: 0, to: cur.length, insert: newMergedText },
        });
      }
    }
  }

  function handleUndo() {
    if (historyIdx > 0) {
      historyIdx--;
      hunks = cloneHunks(history[historyIdx]);
      const restored = computeMergedText(hunks);
      editableContent = restored;
      if (editorView) {
        const cur = editorView.state.doc.toString();
        if (cur !== restored) {
          editorView.dispatch({
            changes: { from: 0, to: cur.length, insert: restored },
          });
        }
      }
    }
  }

  function handleRedo() {
    if (historyIdx < history.length - 1) {
      historyIdx++;
      hunks = cloneHunks(history[historyIdx]);
      const restored = computeMergedText(hunks);
      editableContent = restored;
      if (editorView) {
        const cur = editorView.state.doc.toString();
        if (cur !== restored) {
          editorView.dispatch({
            changes: { from: 0, to: cur.length, insert: restored },
          });
        }
      }
    }
  }

  let canUndo = $derived(historyIdx > 0);
  let canRedo = $derived(historyIdx < history.length - 1);

  // Initialize hunks from file
  $effect(() => {
    if (file) {
      const initial = parseMergedIntoHunks(file.merged, file.base);
      hunks = initial;
      history = [cloneHunks(initial)];
      historyIdx = 0;
      const initialText = computeMergedText(initial);
      editableContent = initialText;
      if (editorView) {
        const cur = editorView.state.doc.toString();
        if (cur !== initialText) {
          editorView.dispatch({
            changes: { from: 0, to: cur.length, insert: initialText },
          });
        }
      }
    }
  });

  // Mount CodeMirror 6 in Result column
  onMount(() => {
    if (cmMountEl) {
      const initialText = computeMergedText(hunks);
      editorView = createConflictResultEditor(cmMountEl, initialText, {
        onDocChange: (newDoc) => {
          editableContent = newDoc;
        },
        onScroll: () => {
          scrollCoordinator.sync('center');
        },
      });
    }

    return () => {
      if (editorView) {
        editorView.destroy();
        editorView = null;
      }
    };
  });

  onDestroy(() => {
    if (editorView) {
      editorView.destroy();
      editorView = null;
    }
  });

  // Calculate conflict statistics
  let conflictHunks = $derived(hunks.filter((h) => h.kind === 'conflict'));
  let unresolvedCount = $derived(
    conflictHunks.filter(
      (h) =>
        !h.isIdentical &&
        !h.acceptedSides.ours &&
        !h.acceptedSides.theirs &&
        h.customEdit === null
    ).length
  );

  // Hunks decorated with continuous line numbers
  let hunksWithLines = $derived.by(() => {
    let leftLine = 1;
    let rightLine = 1;
    return hunks.map((h) => {
      const leftStart = leftLine;
      const rightStart = rightLine;
      if (h.kind === 'clean') {
        leftLine += h.cleanLines.length;
        rightLine += h.cleanLines.length;
      } else {
        leftLine += h.oursLines.length;
        rightLine += h.theirsLines.length;
      }
      return {
        ...h,
        leftStartLine: leftStart,
        rightStartLine: rightStart,
      };
    });
  });

  // Gutter actions (>> and <<)
  function toggleAcceptLeft(hunkId: number) {
    const next = resolveHunkSide(hunks, hunkId, 'ours');
    pushHistory(next);
  }

  function toggleAcceptRight(hunkId: number) {
    const next = resolveHunkSide(hunks, hunkId, 'theirs');
    pushHistory(next);
  }

  function discardLeft(hunkId: number) {
    const next = cloneHunks(hunks);
    const target = next.find((h) => h.id === hunkId);
    if (!target) return;
    target.customEdit = null;
    target.acceptedSides.ours = false;
    pushHistory(next);
  }

  function discardRight(hunkId: number) {
    const next = cloneHunks(hunks);
    const target = next.find((h) => h.id === hunkId);
    if (!target) return;
    target.customEdit = null;
    target.acceptedSides.theirs = false;
    pushHistory(next);
  }

  // Magic Wand: Auto-resolve trivial/non-conflicting blocks
  function handleAutoResolve() {
    const { hunks: nextHunks, resolvedCount } = autoResolveTrivialBlocks(hunks);
    if (resolvedCount > 0) {
      pushHistory(nextHunks);
      gitStore.showToast(`Berhasil menyelesaikan ${resolvedCount} blok non-konflik secara otomatis`, { type: 'success' });
    } else {
      gitStore.showToast('Tidak ada blok non-konflik trivial yang dapat diselesaikan otomatis', { type: 'info' });
    }
  }

  // Bulk actions
  function handleAcceptAllLeft() {
    const next = acceptAllSide(hunks, 'ours');
    pushHistory(next);
  }

  function handleAcceptAllRight() {
    const next = acceptAllSide(hunks, 'theirs');
    pushHistory(next);
  }

  function handleApplyAllIdentical() {
    const next = applyAllIdentical(hunks);
    pushHistory(next);
  }

  // Navigation
  function scrollToNextConflict() {
    const conflicts = hunks.filter((h) => h.kind === 'conflict' && !h.isIdentical);
    if (conflicts.length === 0) return;
    activeHunkIdx = (activeHunkIdx + 1) % conflicts.length;
    const targetEl = document.getElementById(`left-hunk-${conflicts[activeHunkIdx].id}`);
    targetEl?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function scrollToPrevConflict() {
    const conflicts = hunks.filter((h) => h.kind === 'conflict' && !h.isIdentical);
    if (conflicts.length === 0) return;
    activeHunkIdx = (activeHunkIdx - 1 + conflicts.length) % conflicts.length;
    const targetEl = document.getElementById(`left-hunk-${conflicts[activeHunkIdx].id}`);
    targetEl?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  // Keyboard navigation & shortcuts
  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      onClose();
      return;
    }
    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
    const isCmd = isMac ? e.metaKey : e.ctrlKey;
    if (isCmd && !e.shiftKey && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      handleUndo();
    } else if (isCmd && ((e.shiftKey && e.key.toLowerCase() === 'z') || e.key.toLowerCase() === 'y')) {
      e.preventDefault();
      handleRedo();
    }
  }

  // Apply resolution to disk
  async function handleApply() {
    if (!gitStore.root || isSaving) return;
    if (unresolvedCount > 0) {
      const ok = confirm(`Masih ada ${unresolvedCount} konflik yang belum diselesaikan. Yakin simpan?`);
      if (!ok) return;
    }

    isSaving = true;
    try {
      const finalContent = editorView
        ? editorView.state.doc.toString()
        : (editableContent || computeMergedText(hunks));

      await api.gitConflictWrite(gitStore.root, file.path, finalContent);
      await api.gitStage(gitStore.root, file.path);

      gitStore.showToast(`Berhasil menyelesaikan konflik: ${file.path}`, { type: 'success' });
      onResolved();
      onClose();
    } catch (e: any) {
      gitStore.showToast(`Gagal menyimpan: ${e?.message || e}`, { type: 'error' });
    } finally {
      isSaving = false;
    }
  }

  // Header branch metadata
  let leftBranch = $derived(gitStore.opState?.headName ?? gitStore.currentBranch ?? 'Yours');
  let rightBranch = $derived(gitStore.opState?.ontoName ?? 'Theirs');
  let stoppedCommit = $derived(gitStore.opState?.currentCommit?.slice(0, 8) ?? '');
</script>

<svelte:window onkeydown={handleKeyDown} />

<div class="three-way-backdrop" role="presentation">
  <div class="three-way-dialog" role="dialog" aria-modal="true" tabindex="-1">
    <!-- Top Window Title Bar -->
    <div class="dialog-top-bar">
      <div class="top-title-group">
        <span class="file-icon">📄</span>
        <span class="window-title">Merge Revisions for <strong>{file.path}</strong></span>
      </div>
      <div class="top-close-btn" onclick={onClose} role="button" tabindex="0">✕</div>
    </div>

    <!-- Toolbar Bar (ala Android Studio / IntelliJ) -->
    <div class="dialog-toolbar">
      <div class="toolbar-left-group">
        <!-- Navigation -->
        <button class="tool-btn" onclick={scrollToPrevConflict} title="Previous Difference (↑)">
          <span class="icon">↑</span>
        </button>
        <button class="tool-btn" onclick={scrollToNextConflict} title="Next Difference (↓)">
          <span class="icon">↓</span>
        </button>

        <span class="toolbar-sep"></span>

        <!-- Undo & Redo (⌘Z / ⇧⌘Z) -->
        <button
          class="tool-btn undo-btn"
          disabled={!canUndo}
          onclick={handleUndo}
          title="Undo (⌘Z)"
        >
          <span class="icon">↶</span>
          <span>Undo</span>
        </button>
        <button
          class="tool-btn redo-btn"
          disabled={!canRedo}
          onclick={handleRedo}
          title="Redo (⇧⌘Z)"
        >
          <span class="icon">↷</span>
          <span>Redo</span>
        </button>

        <span class="toolbar-sep"></span>

        <!-- Magic Wand: Auto-Resolve Trivial Blocks -->
        <button
          class="tool-btn magic-wand-btn"
          onclick={handleAutoResolve}
          title="Auto-resolve non-conflicting trivial blocks (🪄)"
        >
          <span class="icon">🪄</span>
          <span>Auto-resolve non-conflicting</span>
        </button>

        <span class="toolbar-sep"></span>

        <!-- Bulk Apply Controls -->
        <span class="toolbar-label">Apply:</span>
        <button
          class="tool-btn bulk-btn"
          onclick={handleApplyAllIdentical}
          title="Apply Non-Conflicting Changes from Both Sides (»«)"
        >
          <span>»«</span>
        </button>
        <button
          class="tool-btn bulk-btn"
          onclick={handleAcceptAllLeft}
          title="Apply All Changes from Left (»)"
        >
          <span>»</span>
        </button>
        <button
          class="tool-btn bulk-btn"
          onclick={handleAcceptAllRight}
          title="Apply All Changes from Right («)"
        >
          <span>«</span>
        </button>
      </div>

      <!-- Right Summary Counter -->
      <div class="toolbar-right-group">
        <span class="counter-badge" class:has-conflicts={unresolvedCount > 0}>
          {#if unresolvedCount > 0}
            ⚠️ {unresolvedCount} conflict{unresolvedCount > 1 ? 's' : ''} remaining
          {:else}
            ✓ All conflicts resolved
          {/if}
        </span>
      </div>
    </div>

    <!-- 3-Way Column Headers -->
    <div class="pane-headers-row">
      <div class="col-header left-header">
        <span class="lock-icon">🔒</span>
        <span class="header-title">
          {#if stoppedCommit}
            Rebasing {stoppedCommit} from <strong>{leftBranch}</strong>
          {:else}
            <strong>{leftBranch}</strong> (Yours)
          {/if}
        </span>
      </div>

      <div class="col-header center-header">
        <span class="header-title">
          Result <strong>{file.path.split('/').pop()}</strong> (CodeMirror 6)
        </span>
      </div>

      <div class="col-header right-header">
        <span class="lock-icon">🔒</span>
        <span class="header-title">
          Commits from <strong>{rightBranch}</strong> (Theirs)
        </span>
      </div>
    </div>

    <!-- 3-Way Editor Viewport (3 Continuous Synchronized Columns) -->
    <div class="three-way-viewport">
      <!-- 1. LEFT COLUMN (Yours) -->
      <div
        class="col-panel col-left"
        bind:this={leftPanelEl}
        onscroll={() => scrollCoordinator.sync('left')}
      >
        <div class="hunks-stream mono">
          {#each hunksWithLines as hunk (hunk.id)}
            <div
              class="hunk-card hunk-left"
              class:is-clean={hunk.kind === 'clean'}
              class:is-identical={hunk.kind === 'conflict' && hunk.isIdentical}
              class:is-conflict={hunk.kind === 'conflict' && !hunk.isIdentical}
              id={`left-hunk-${hunk.id}`}
            >
              <div class="hunk-content-wrap">
                <div class="hunk-lines">
                  {#if hunk.kind === 'clean'}
                    {#each hunk.cleanLines as line, idx}
                      <div class="code-line clean-line">
                        <span class="line-num">{hunk.leftStartLine + idx}</span>
                        <span class="line-content">{line || ' '}</span>
                      </div>
                    {/each}
                  {:else if hunk.isIdentical}
                    <div class="hunk-badge badge-green">✓ Identik (Masuk Otomatis)</div>
                    {#each hunk.oursLines as line, idx}
                      <div class="code-line hl-green">
                        <span class="line-num">{hunk.leftStartLine + idx}</span>
                        <span class="line-content">{line || ' '}</span>
                      </div>
                    {/each}
                  {:else}
                    <div class="hunk-badge badge-teal">⚠️ Berbeda (Yours)</div>
                    {#each hunk.oursLines as line, idx}
                      <div class="code-line hl-yours" class:is-picked={hunk.acceptedSides.ours}>
                        <span class="line-num">{hunk.leftStartLine + idx}</span>
                        <span class="line-content">{line || ' '}</span>
                      </div>
                    {/each}
                  {/if}
                </div>

                <!-- Gutter Action: >> -->
                {#if hunk.kind === 'conflict' && !hunk.isIdentical}
                  <div class="gutter-action-slot right-slot">
                    <button
                      class="gutter-action-btn accept-left"
                      class:active-applied={hunk.acceptedSides.ours}
                      onclick={() => toggleAcceptLeft(hunk.id)}
                      title={hunk.acceptedSides.ours ? "Yours sudah ada di Result (Klik untuk batalkan)" : "Tarik baris Yours ke Result (>>)"}
                    >
                      <span class="gutter-arrow">{hunk.acceptedSides.ours ? '✓' : '>>'}</span>
                    </button>
                    <button
                      class="gutter-action-btn discard-btn"
                      onclick={() => discardLeft(hunk.id)}
                      title="Abaikan Yours (✕)"
                    >
                      ✕
                    </button>
                  </div>
                {/if}
              </div>
            </div>
          {/each}
        </div>
      </div>

      <!-- 2. CENTER COLUMN (Result with CodeMirror 6) -->
      <div class="col-panel col-center">
        <div class="cm-host-wrapper" bind:this={cmMountEl}></div>
      </div>

      <!-- 3. RIGHT COLUMN (Theirs) -->
      <div
        class="col-panel col-right"
        bind:this={rightPanelEl}
        onscroll={() => scrollCoordinator.sync('right')}
      >
        <div class="hunks-stream mono">
          {#each hunksWithLines as hunk (hunk.id)}
            <div
              class="hunk-card hunk-right"
              class:is-clean={hunk.kind === 'clean'}
              class:is-identical={hunk.kind === 'conflict' && hunk.isIdentical}
              class:is-conflict={hunk.kind === 'conflict' && !hunk.isIdentical}
              id={`right-hunk-${hunk.id}`}
            >
              <div class="hunk-content-wrap">
                <!-- Gutter Action: << -->
                {#if hunk.kind === 'conflict' && !hunk.isIdentical}
                  <div class="gutter-action-slot left-slot">
                    <button
                      class="gutter-action-btn accept-right"
                      class:active-applied={hunk.acceptedSides.theirs}
                      onclick={() => toggleAcceptRight(hunk.id)}
                      title={hunk.acceptedSides.theirs ? "Theirs sudah ada di Result (Klik untuk batalkan)" : "Tarik baris Theirs ke Result (<<)"}
                    >
                      <span class="gutter-arrow">{hunk.acceptedSides.theirs ? '✓' : '<<'}</span>
                    </button>
                    <button
                      class="gutter-action-btn discard-btn"
                      onclick={() => discardRight(hunk.id)}
                      title="Abaikan Theirs (✕)"
                    >
                      ✕
                    </button>
                  </div>
                {/if}

                <div class="hunk-lines">
                  {#if hunk.kind === 'clean'}
                    {#each hunk.cleanLines as line, idx}
                      <div class="code-line clean-line">
                        <span class="line-num">{hunk.rightStartLine + idx}</span>
                        <span class="line-content">{line || ' '}</span>
                      </div>
                    {/each}
                  {:else if hunk.isIdentical}
                    <div class="hunk-badge badge-green">✓ Identik (Masuk Otomatis)</div>
                    {#each hunk.theirsLines as line, idx}
                      <div class="code-line hl-green">
                        <span class="line-num">{hunk.rightStartLine + idx}</span>
                        <span class="line-content">{line || ' '}</span>
                      </div>
                    {/each}
                  {:else}
                    <div class="hunk-badge badge-orange">⚠️ Berbeda (Theirs)</div>
                    {#each hunk.theirsLines as line, idx}
                      <div class="code-line hl-theirs" class:is-picked={hunk.acceptedSides.theirs}>
                        <span class="line-num">{hunk.rightStartLine + idx}</span>
                        <span class="line-content">{line || ' '}</span>
                      </div>
                    {/each}
                  {/if}
                </div>
              </div>
            </div>
          {/each}
        </div>
      </div>
    </div>

    <!-- Bottom Action Bar (ala Android Studio) -->
    <div class="dialog-bottom-bar">
      <div class="bottom-left-group">
        <button class="btn-secondary" onclick={handleAcceptAllLeft}>
          Accept Left
        </button>
        <button class="btn-secondary" onclick={handleAcceptAllRight}>
          Accept Right
        </button>
      </div>

      <div class="bottom-right-group">
        <button class="btn-cancel" onclick={onClose}>
          Cancel
        </button>
        <button
          class="btn-apply-primary"
          onclick={handleApply}
          disabled={isSaving}
        >
          {#if isSaving}
            Saving…
          {:else}
            Apply
          {/if}
        </button>
      </div>
    </div>
  </div>
</div>

<style>
  .three-way-backdrop {
    position: fixed;
    inset: 0;
    z-index: 9999;
    background: rgba(20, 22, 25, 0.75);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
  }

  .three-way-dialog {
    width: 98vw;
    height: 94vh;
    max-width: 1720px;
    background: var(--p-bg-workspace, #2b2d30);
    border: 1px solid var(--border-default, #393b40);
    border-radius: 8px;
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.6);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    color: #dbdee1;
    font-size: 13px;
  }

  .mono {
    font-family: 'JetBrains Mono', 'Fira Code', ui-monospace, Menlo, Monaco, monospace;
    font-size: 12px;
    line-height: 19px;
  }

  /* Top Window Title Bar */
  .dialog-top-bar {
    height: 38px;
    background: var(--p-bg-surface, #26282b);
    border-bottom: 1px solid var(--border-default, #393b40);
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 14px;
    user-select: none;
  }

  .top-title-group {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    color: #e6e7eb;
  }

  .top-close-btn {
    width: 24px;
    height: 24px;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    color: #8b8f98;
    font-size: 13px;
  }

  .top-close-btn:hover {
    background: var(--p-bg-elevated, #313338);
    color: #ffffff;
  }

  /* Toolbar */
  .dialog-toolbar {
    height: 36px;
    background: var(--p-bg-surface, #26282b);
    border-bottom: 1px solid var(--border-default, #393b40);
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 12px;
    user-select: none;
  }

  .toolbar-left-group {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .toolbar-sep {
    width: 1px;
    height: 16px;
    background: var(--border-default, #393b40);
    margin: 0 4px;
  }

  .toolbar-label {
    font-size: 11px;
    color: #8b8f98;
    margin-right: 2px;
  }

  .tool-btn {
    height: 24px;
    padding: 0 8px;
    background: var(--p-bg-elevated, #313338);
    border: 1px solid var(--border-default, #393b40);
    border-radius: 4px;
    color: #bcbec4;
    font-size: 12px;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    cursor: pointer;
    transition: background 0.1s;
  }

  .tool-btn:hover:not(:disabled) {
    background: var(--p-bg-hover, #383a40);
    color: #ffffff;
  }

  .tool-btn:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }

  .magic-wand-btn {
    background: rgba(53, 116, 240, 0.15);
    border-color: rgba(53, 116, 240, 0.4);
    color: #70a1ff;
  }

  .magic-wand-btn:hover:not(:disabled) {
    background: rgba(53, 116, 240, 0.28);
    color: #ffffff;
  }

  .counter-badge {
    padding: 3px 8px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 500;
    background: rgba(34, 197, 94, 0.15);
    color: #4ade80;
    border: 1px solid rgba(34, 197, 94, 0.3);
  }

  .counter-badge.has-conflicts {
    background: rgba(239, 68, 68, 0.15);
    color: #f87171;
    border-color: rgba(239, 68, 68, 0.3);
  }

  /* Pane Headers */
  .pane-headers-row {
    height: 32px;
    background: var(--p-bg-surface, #26282b);
    border-bottom: 1px solid var(--border-default, #393b40);
    display: grid;
    grid-template-columns: 1fr 1.25fr 1fr;
    user-select: none;
  }

  .col-header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 12px;
    font-size: 11.5px;
    color: #8b8f98;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    border-right: 1px solid var(--border-default, #393b40);
  }

  .col-header:last-child {
    border-right: none;
  }

  .col-header strong {
    color: #e6e7eb;
  }

  .lock-icon {
    font-size: 11px;
    opacity: 0.7;
  }

  /* 3-Way Viewport */
  .three-way-viewport {
    flex: 1;
    display: grid;
    grid-template-columns: 1fr 1.25fr 1fr;
    overflow: hidden;
    background: var(--p-bg-workspace, #2b2d30);
  }

  .col-panel {
    height: 100%;
    overflow-y: auto;
    overflow-x: auto;
    border-right: 1px solid var(--border-default, #393b40);
    position: relative;
    background: var(--p-bg-workspace, #2b2d30);
  }

  .col-panel:last-child {
    border-right: none;
  }

  .col-center {
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .cm-host-wrapper {
    height: 100%;
    width: 100%;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .cm-host-wrapper :global(.cm-editor) {
    height: 100%;
    flex: 1;
    font-family: 'JetBrains Mono', 'Fira Code', monospace;
    font-size: 12px;
    background: var(--p-bg-workspace, #2b2d30);
  }

  .cm-host-wrapper :global(.cm-scroller) {
    font-family: inherit;
    line-height: 19px;
  }

  /* Hunks stream in Left and Right panels */
  .hunks-stream {
    display: flex;
    flex-direction: column;
    min-width: 100%;
  }

  .hunk-card {
    border-bottom: 1px solid var(--border-default, #393b40);
    position: relative;
  }

  .hunk-content-wrap {
    display: flex;
    align-items: stretch;
    justify-content: space-between;
    width: 100%;
  }

  .hunk-lines {
    flex: 1;
    overflow-x: auto;
    padding: 2px 0;
  }

  .code-line {
    min-height: 19px;
    display: flex;
    align-items: center;
    padding: 0 4px;
    color: #dbdee1;
    white-space: pre;
  }

  .line-num {
    display: inline-block;
    width: 38px;
    min-width: 38px;
    text-align: right;
    padding-right: 10px;
    color: #72767d;
    user-select: none;
    font-size: 11px;
  }

  .line-content {
    flex: 1;
  }

  .clean-line {
    color: #949ba4;
  }

  /* Soft Slate Grey Parity Highlights */
  .hunk-badge {
    font-size: 10px;
    font-weight: 600;
    padding: 1px 6px;
    border-radius: 3px;
    margin: 3px 6px;
    display: inline-block;
    user-select: none;
  }

  .badge-green {
    background: rgba(34, 197, 94, 0.2);
    color: #86efac;
    border: 1px solid rgba(34, 197, 94, 0.4);
  }

  .badge-teal {
    background: rgba(45, 140, 110, 0.25);
    color: #a7f3d0;
    border: 1px solid rgba(45, 140, 110, 0.5);
  }

  .badge-orange {
    background: rgba(180, 100, 40, 0.25);
    color: #fed7aa;
    border: 1px solid rgba(180, 100, 40, 0.5);
  }

  .hl-green {
    background: rgba(34, 197, 94, 0.12);
    border-left: 3px solid #22c55e;
    color: #86efac;
  }

  .hl-yours {
    background: rgba(45, 140, 110, 0.16);
    border-left: 3px solid #38b289;
    color: #a7f3d0;
  }

  .hl-yours.is-picked {
    background: rgba(53, 116, 240, 0.2);
    border-left: 3px solid #3574f0;
    color: #93c5fd;
  }

  .hl-theirs {
    background: rgba(180, 100, 40, 0.16);
    border-left: 3px solid #e08438;
    color: #fed7aa;
  }

  .hl-theirs.is-picked {
    background: rgba(53, 116, 240, 0.2);
    border-left: 3px solid #3574f0;
    color: #93c5fd;
  }

  /* Gutter Action Slot & Buttons (>> and <<) */
  .gutter-action-slot {
    width: 32px;
    min-width: 32px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-start;
    gap: 4px;
    padding: 4px 2px;
    background: var(--p-bg-surface, #26282b);
    user-select: none;
  }

  .right-slot {
    border-left: 1px solid var(--border-default, #393b40);
  }

  .left-slot {
    border-right: 1px solid var(--border-default, #393b40);
  }

  .gutter-action-btn {
    width: 24px;
    height: 22px;
    border-radius: 4px;
    border: none;
    font-size: 11px;
    font-weight: 700;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: transform 0.08s, background 0.1s;
  }

  .gutter-action-btn:hover {
    transform: scale(1.12);
  }

  .accept-left,
  .accept-right {
    background: var(--accent, #3574f0);
    color: #ffffff;
  }

  .accept-left:hover,
  .accept-right:hover {
    background: #2563eb;
  }

  .accept-left.active-applied,
  .accept-right.active-applied {
    background: #16a34a;
    color: #ffffff;
  }

  .discard-btn {
    background: var(--p-bg-elevated, #313338);
    color: #9ca3af;
    border: 1px solid var(--border-default, #393b40);
  }

  .discard-btn:hover {
    background: #dc2626;
    color: #ffffff;
    border-color: #dc2626;
  }

  /* Bottom Bar */
  .dialog-bottom-bar {
    height: 48px;
    background: var(--p-bg-surface, #26282b);
    border-top: 1px solid var(--border-default, #393b40);
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 16px;
    user-select: none;
  }

  .bottom-left-group,
  .bottom-right-group {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .btn-secondary {
    height: 28px;
    padding: 0 12px;
    background: var(--p-bg-elevated, #313338);
    border: 1px solid var(--border-default, #393b40);
    border-radius: 4px;
    color: #d1d5db;
    font-size: 12px;
    cursor: pointer;
  }

  .btn-secondary:hover {
    background: var(--p-bg-hover, #383a40);
    color: #ffffff;
  }

  .btn-cancel {
    height: 28px;
    padding: 0 14px;
    background: transparent;
    border: 1px solid var(--border-default, #393b40);
    border-radius: 4px;
    color: #9ca3af;
    font-size: 12px;
    cursor: pointer;
  }

  .btn-cancel:hover {
    background: var(--p-bg-elevated, #313338);
    color: #ffffff;
  }

  .btn-apply-primary {
    height: 28px;
    padding: 0 18px;
    background: var(--accent, #3574f0);
    border: 1px solid #2563eb;
    border-radius: 4px;
    color: #ffffff;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
  }

  .btn-apply-primary:hover:not(:disabled) {
    background: #2563eb;
  }

  .btn-apply-primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
