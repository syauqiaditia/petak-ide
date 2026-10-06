<script lang="ts">
  import { onMount } from 'svelte';
  import { gitStore } from './git.svelte';
  import { api } from '../../lib/api';
  import type { GitConflictFile } from '../../lib/api';

  let {
    file,
    onClose = () => {},
    onResolved = () => {},
  } = $props<{
    file: GitConflictFile;
    onClose?: () => void;
    onResolved?: () => void;
  }>();

  // Model a synchronized row/hunk across 3 panes
  interface MergeHunk {
    id: number;
    kind: 'clean' | 'conflict';
    cleanLines: string[];
    oursLines: string[];
    theirsLines: string[];
    baseLines: string[];
    // Resolution state for this hunk:
    resolution: 'unresolved' | 'ours' | 'theirs' | 'both' | 'discarded' | 'custom';
    resultLines: string[];
    isEditing?: boolean;
  }

  let hunks = $state<MergeHunk[]>([]);
  let history = $state<MergeHunk[][]>([]);
  let historyIdx = $state(0);
  let isSaving = $state(false);
  let activeHunkIdx = $state(0);

  // Parse file.merged into synchronized hunks
  function parseMergedIntoHunks(mergedText: string, baseText?: string | null): MergeHunk[] {
    const lines = mergedText.split('\n');
    const result: MergeHunk[] = [];
    let currentClean: string[] = [];
    let state: 'clean' | 'ours' | 'base' | 'theirs' = 'clean';
    let oursLines: string[] = [];
    let theirsLines: string[] = [];
    let baseLines: string[] = [];
    let hunkId = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (state === 'clean') {
        if (line.startsWith('<<<<<<<')) {
          if (currentClean.length > 0) {
            result.push({
              id: hunkId++,
              kind: 'clean',
              cleanLines: currentClean,
              oursLines: [],
              theirsLines: [],
              baseLines: [],
              resolution: 'clean' as any,
              resultLines: [...currentClean],
            });
            currentClean = [];
          }
          state = 'ours';
          oursLines = [];
          theirsLines = [];
          baseLines = [];
        } else {
          currentClean.push(line);
        }
      } else if (state === 'ours') {
        if (line.startsWith('=======')) {
          state = 'theirs';
        } else if (line.startsWith('|||||||')) {
          state = 'base';
        } else {
          oursLines.push(line);
        }
      } else if (state === 'base') {
        if (line.startsWith('=======')) {
          state = 'theirs';
        } else {
          baseLines.push(line);
        }
      } else if (state === 'theirs') {
        if (line.startsWith('>>>>>>>')) {
          // If in rebase, git puts target branch (HEAD) at top and incoming at bottom.
          // In Android Studio, Left = incoming commit, Right = target branch.
          // We provide base if available, else empty in center
          const initialResult = baseLines.length > 0 ? [...baseLines] : [];
          result.push({
            id: hunkId++,
            kind: 'conflict',
            cleanLines: [],
            oursLines: [...oursLines],
            theirsLines: [...theirsLines],
            baseLines: [...baseLines],
            resolution: 'unresolved',
            resultLines: initialResult,
          });
          state = 'clean';
        } else {
          theirsLines.push(line);
        }
      }
    }

    if (currentClean.length > 0) {
      result.push({
        id: hunkId++,
        kind: 'clean',
        cleanLines: currentClean,
        oursLines: [],
        theirsLines: [],
        baseLines: [],
        resolution: 'clean' as any,
        resultLines: [...currentClean],
      });
    }

    return result;
  }

  function cloneHunks(source: MergeHunk[]): MergeHunk[] {
    return source.map((h) => ({
      ...h,
      cleanLines: [...h.cleanLines],
      oursLines: [...h.oursLines],
      theirsLines: [...h.theirsLines],
      baseLines: [...h.baseLines],
      resultLines: [...h.resultLines],
    }));
  }

  function pushHistory(newHunks: MergeHunk[]) {
    history = history.slice(0, historyIdx + 1);
    history.push(cloneHunks(newHunks));
    historyIdx = history.length - 1;
    hunks = newHunks;
  }

  function handleUndo() {
    if (historyIdx > 0) {
      historyIdx--;
      hunks = cloneHunks(history[historyIdx]);
    }
  }

  function handleRedo() {
    if (historyIdx < history.length - 1) {
      historyIdx++;
      hunks = cloneHunks(history[historyIdx]);
    }
  }

  let canUndo = $derived(historyIdx > 0);
  let canRedo = $derived(historyIdx < history.length - 1);

  // Initialize
  $effect(() => {
    const initial = parseMergedIntoHunks(file.merged, file.base);
    hunks = initial;
    history = [cloneHunks(initial)];
    historyIdx = 0;
  });

  // Conflict statistics
  let conflictHunks = $derived(hunks.filter((h) => h.kind === 'conflict'));
  let unresolvedCount = $derived(
    conflictHunks.filter((h) => h.resolution === 'unresolved').length
  );
  let totalConflicts = $derived(conflictHunks.length);

  // Gutter actions per hunk
  function acceptLeftHunk(hunkId: number) {
    const next = cloneHunks(hunks);
    const target = next.find((h) => h.id === hunkId);
    if (!target) return;
    target.resolution = 'ours';
    target.resultLines = [...target.oursLines];
    pushHistory(next);
  }

  function acceptRightHunk(hunkId: number) {
    const next = cloneHunks(hunks);
    const target = next.find((h) => h.id === hunkId);
    if (!target) return;
    target.resolution = 'theirs';
    target.resultLines = [...target.theirsLines];
    pushHistory(next);
  }

  function discardLeftHunk(hunkId: number) {
    const next = cloneHunks(hunks);
    const target = next.find((h) => h.id === hunkId);
    if (!target) return;
    target.resolution = 'theirs';
    target.resultLines = [...target.theirsLines];
    pushHistory(next);
  }

  function discardRightHunk(hunkId: number) {
    const next = cloneHunks(hunks);
    const target = next.find((h) => h.id === hunkId);
    if (!target) return;
    target.resolution = 'ours';
    target.resultLines = [...target.oursLines];
    pushHistory(next);
  }

  function acceptBothHunk(hunkId: number) {
    const next = cloneHunks(hunks);
    const target = next.find((h) => h.id === hunkId);
    if (!target) return;
    target.resolution = 'both';
    target.resultLines = [...target.oursLines, ...target.theirsLines];
    pushHistory(next);
  }

  function updateHunkResultText(hunkId: number, text: string) {
    const next = cloneHunks(hunks);
    const target = next.find((h) => h.id === hunkId);
    if (!target) return;
    target.resolution = 'custom';
    target.resultLines = text.split('\n');
    pushHistory(next);
  }

  // Bulk actions
  function handleAcceptAllLeft() {
    const next = cloneHunks(hunks);
    for (const h of next) {
      if (h.kind === 'conflict') {
        h.resolution = 'ours';
        h.resultLines = [...h.oursLines];
      }
    }
    pushHistory(next);
  }

  function handleAcceptAllRight() {
    const next = cloneHunks(hunks);
    for (const h of next) {
      if (h.kind === 'conflict') {
        h.resolution = 'theirs';
        h.resultLines = [...h.theirsLines];
      }
    }
    pushHistory(next);
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

  // Synchronized scrolling across all 3 columns
  let scrollContainerEl: HTMLDivElement | null = null;

  function scrollToNextConflict() {
    const conflicts = hunks.filter((h) => h.kind === 'conflict');
    if (conflicts.length === 0) return;
    activeHunkIdx = (activeHunkIdx + 1) % conflicts.length;
    const targetEl = document.getElementById(`hunk-row-${conflicts[activeHunkIdx].id}`);
    targetEl?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function scrollToPrevConflict() {
    const conflicts = hunks.filter((h) => h.kind === 'conflict');
    if (conflicts.length === 0) return;
    activeHunkIdx = (activeHunkIdx - 1 + conflicts.length) % conflicts.length;
    const targetEl = document.getElementById(`hunk-row-${conflicts[activeHunkIdx].id}`);
    targetEl?.scrollIntoView({ behavior: 'smooth', block: 'center' });
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
      const fullContent = hunks
        .flatMap((h) => (h.kind === 'clean' ? h.cleanLines : h.resultLines))
        .join('\n');

      await api.gitConflictWrite(gitStore.root, file.path, fullContent);
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
    <!-- Top Window Title Bar (macOS / IDE style) -->
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

        <!-- Bulk Apply Controls -->
        <span class="toolbar-label">Apply non-conflicting:</span>
        <button
          class="tool-btn bulk-btn"
          onclick={handleAcceptAllLeft}
          title="Apply Non-Conflicting Changes from Left"
        >
          <span>»</span>
        </button>
        <button
          class="tool-btn bulk-btn"
          onclick={handleAcceptAllRight}
          title="Apply Non-Conflicting Changes from Right"
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

      <div class="gutter-header gutter-left-header"></div>

      <div class="col-header center-header">
        <span class="header-title">
          Result <strong>{file.path.split('/').pop()}</strong>
        </span>
      </div>

      <div class="gutter-header gutter-right-header"></div>

      <div class="col-header right-header">
        <span class="lock-icon">🔒</span>
        <span class="header-title">
          Commits from <strong>{rightBranch}</strong> (Theirs)
        </span>
      </div>
    </div>

    <!-- 3-Way Editor Viewport (Synchronized Rows Grid) -->
    <div class="editor-viewport" bind:this={scrollContainerEl}>
      <div class="sync-grid mono">
        {#each hunks as hunk (hunk.id)}
          <div
            class="hunk-row"
            class:is-conflict={hunk.kind === 'conflict'}
            class:is-unresolved={hunk.kind === 'conflict' && hunk.resolution === 'unresolved'}
            class:is-resolved={hunk.kind === 'conflict' && hunk.resolution !== 'unresolved'}
            id={`hunk-row-${hunk.id}`}
          >
            <!-- 1. LEFT PANE (Yours) -->
            <div class="hunk-pane pane-left">
              {#if hunk.kind === 'clean'}
                {#each hunk.cleanLines as line}
                  <div class="code-line clean-line">
                    <span class="line-content">{line || ' '}</span>
                  </div>
                {/each}
              {:else}
                {#each hunk.oursLines as line}
                  <div class="code-line conflict-diff-line ours-line">
                    <span class="line-content">{line || ' '}</span>
                  </div>
                {/each}
              {/if}
            </div>

            <!-- 2. GUTTER LEFT-TO-CENTER (» and ✕) -->
            <div class="hunk-gutter gutter-left">
              {#if hunk.kind === 'conflict'}
                <div class="gutter-actions-stack">
                  <button
                    class="gutter-action-btn accept-left"
                    onclick={() => acceptLeftHunk(hunk.id)}
                    title="Accept Left change into Result (»)"
                  >
                    »
                  </button>
                  <button
                    class="gutter-action-btn discard-btn"
                    onclick={() => discardLeftHunk(hunk.id)}
                    title="Discard Left change (✕)"
                  >
                    ✕
                  </button>
                </div>
              {/if}
            </div>

            <!-- 3. CENTER PANE (Result - Editable Buffer) -->
            <div class="hunk-pane pane-center">
              {#if hunk.kind === 'clean'}
                {#each hunk.cleanLines as line}
                  <div class="code-line clean-line">
                    <span class="line-content">{line || ' '}</span>
                  </div>
                {/each}
              {:else}
                {#if hunk.resolution === 'unresolved'}
                  <div class="unresolved-zone">
                    <div class="unresolved-banner">
                      <span class="unresolved-title">⚠️ Conflict</span>
                      <div class="banner-quick-actions">
                        <button onclick={() => acceptLeftHunk(hunk.id)} class="btn-micro">Accept Left</button>
                        <button onclick={() => acceptBothHunk(hunk.id)} class="btn-micro">Both</button>
                        <button onclick={() => acceptRightHunk(hunk.id)} class="btn-micro">Accept Right</button>
                      </div>
                    </div>
                    {#if hunk.resultLines.length > 0}
                      {#each hunk.resultLines as line}
                        <div class="code-line base-preview-line">
                          <span class="line-content">{line || ' '}</span>
                        </div>
                      {/each}
                    {/if}
                  </div>
                {:else}
                  <div class="resolved-zone">
                    <textarea
                      class="inline-result-editor mono"
                      value={hunk.resultLines.join('\n')}
                      oninput={(e) => updateHunkResultText(hunk.id, (e.target as HTMLTextAreaElement).value)}
                      rows={Math.max(1, hunk.resultLines.length)}
                      spellcheck="false"
                    ></textarea>
                  </div>
                {/if}
              {/if}
            </div>

            <!-- 4. GUTTER CENTER-TO-RIGHT (« and ✕) -->
            <div class="hunk-gutter gutter-right">
              {#if hunk.kind === 'conflict'}
                <div class="gutter-actions-stack">
                  <button
                    class="gutter-action-btn accept-right"
                    onclick={() => acceptRightHunk(hunk.id)}
                    title="Accept Right change into Result («)"
                  >
                    «
                  </button>
                  <button
                    class="gutter-action-btn discard-btn"
                    onclick={() => discardRightHunk(hunk.id)}
                    title="Discard Right change (✕)"
                  >
                    ✕
                  </button>
                </div>
              {/if}
            </div>

            <!-- 5. RIGHT PANE (Theirs) -->
            <div class="hunk-pane pane-right">
              {#if hunk.kind === 'clean'}
                {#each hunk.cleanLines as line}
                  <div class="code-line clean-line">
                    <span class="line-content">{line || ' '}</span>
                  </div>
                {/each}
              {:else}
                {#each hunk.theirsLines as line}
                  <div class="code-line conflict-diff-line theirs-line">
                    <span class="line-content">{line || ' '}</span>
                  </div>
                {/each}
              {/if}
            </div>
          </div>
        {/each}
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
    background: rgba(0, 0, 0, 0.75);
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
    background: #1e1f22;
    border: 1px solid #383a40;
    border-radius: 8px;
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.6);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    color: #bcbec4;
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
    background: #141518;
    border-bottom: 1px solid #2b2d30;
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
    background: #2b2d30;
    color: #ffffff;
  }

  /* Toolbar */
  .dialog-toolbar {
    height: 36px;
    background: #25272a;
    border-bottom: 1px solid #2b2d30;
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
    background: #3c3f41;
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
    background: #2e3136;
    border: 1px solid #3c3f41;
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
    background: #393b40;
    color: #ffffff;
  }

  .tool-btn:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }

  .counter-badge {
    padding: 3px 8px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 500;
    background: #1e3a29;
    color: #4ade80;
    border: 1px solid #2e5c3e;
  }

  .counter-badge.has-conflicts {
    background: #3f1f1d;
    color: #f87171;
    border-color: #632926;
  }

  /* Pane Headers */
  .pane-headers-row {
    height: 32px;
    background: #1e1f22;
    border-bottom: 1px solid #2b2d30;
    display: grid;
    grid-template-columns: 1fr 34px 1fr 34px 1fr;
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
  }

  .col-header strong {
    color: #e6e7eb;
  }

  .lock-icon {
    font-size: 11px;
    opacity: 0.7;
  }

  .gutter-header {
    background: #1e1f22;
  }

  /* Editor Viewport & Grid */
  .editor-viewport {
    flex: 1;
    overflow: auto;
    background: #1e1f22;
  }

  .sync-grid {
    display: flex;
    flex-direction: column;
    min-width: 100%;
  }

  .hunk-row {
    display: grid;
    grid-template-columns: 1fr 34px 1fr 34px 1fr;
    border-bottom: 1px solid #232529;
  }

  .hunk-row.is-conflict.is-unresolved {
    background: rgba(72, 46, 44, 0.45);
    border-top: 1px solid #78350f;
    border-bottom: 1px solid #78350f;
  }

  .hunk-row.is-conflict.is-resolved {
    background: rgba(30, 41, 59, 0.35);
  }

  .hunk-pane {
    padding: 4px 10px;
    overflow-x: auto;
    white-space: pre;
  }

  .pane-left {
    border-right: 1px solid #2b2d30;
  }

  .pane-center {
    background: #1a1b1e;
    border-left: 1px solid #2b2d30;
    border-right: 1px solid #2b2d30;
  }

  .pane-right {
    border-left: 1px solid #2b2d30;
  }

  .code-line {
    min-height: 19px;
    color: #d1d5db;
  }

  .clean-line {
    color: #a1a1aa;
  }

  .conflict-diff-line {
    color: #ffffff;
  }

  .ours-line {
    background: rgba(46, 67, 94, 0.6);
  }

  .theirs-line {
    background: rgba(72, 46, 44, 0.7);
  }

  .base-preview-line {
    background: rgba(72, 46, 44, 0.4);
    color: #fca5a5;
  }

  /* Gutters & Action Buttons */
  .hunk-gutter {
    background: #222427;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-start;
    padding-top: 4px;
    user-select: none;
  }

  .gutter-actions-stack {
    display: flex;
    flex-direction: column;
    gap: 3px;
    position: sticky;
    top: 4px;
  }

  .gutter-action-btn {
    width: 22px;
    height: 20px;
    border-radius: 3px;
    border: none;
    font-size: 12px;
    font-weight: 700;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: transform 0.08s;
  }

  .gutter-action-btn:hover {
    transform: scale(1.15);
  }

  .accept-left,
  .accept-right {
    background: #2563eb;
    color: #ffffff;
  }

  .discard-btn {
    background: #374151;
    color: #9ca3af;
  }

  .discard-btn:hover {
    background: #ef4444;
    color: #ffffff;
  }

  /* Center Zone */
  .unresolved-zone {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .unresolved-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 2px 6px;
    background: #7f1d1d;
    border-radius: 3px;
    font-size: 11px;
    color: #fecaca;
    user-select: none;
  }

  .banner-quick-actions {
    display: flex;
    gap: 4px;
  }

  .btn-micro {
    padding: 1px 6px;
    font-size: 10px;
    background: #991b1b;
    border: 1px solid #b91c1c;
    color: #ffffff;
    border-radius: 2px;
    cursor: pointer;
  }

  .btn-micro:hover {
    background: #b91c1c;
  }

  .resolved-zone {
    width: 100%;
  }

  .inline-result-editor {
    width: 100%;
    background: transparent;
    border: none;
    color: #e5e7eb;
    resize: none;
    outline: none;
    font-family: inherit;
    font-size: inherit;
    line-height: inherit;
    padding: 0;
    display: block;
  }

  /* Bottom Bar */
  .dialog-bottom-bar {
    height: 48px;
    background: #141518;
    border-top: 1px solid #2b2d30;
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
    background: #2b2d30;
    border: 1px solid #3c3f41;
    border-radius: 4px;
    color: #d1d5db;
    font-size: 12px;
    cursor: pointer;
  }

  .btn-secondary:hover {
    background: #393b40;
    color: #ffffff;
  }

  .btn-cancel {
    height: 28px;
    padding: 0 14px;
    background: transparent;
    border: 1px solid #3c3f41;
    border-radius: 4px;
    color: #9ca3af;
    font-size: 12px;
    cursor: pointer;
  }

  .btn-cancel:hover {
    background: #2b2d30;
    color: #ffffff;
  }

  .btn-apply-primary {
    height: 28px;
    padding: 0 18px;
    background: #3574f0;
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
