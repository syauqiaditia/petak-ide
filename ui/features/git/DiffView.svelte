<script lang="ts">
  import { onMount } from 'svelte';
  import { gitStore } from './git.svelte.ts';
  import { hunkToSbs, type SbsHunk } from './sbs.ts';
  import type { GitDiffFile, GitHunk } from './types.ts';

  let {
    diffFile = null,
    sourceKind = 'worktree',
    filePath = '',
    leftLabel = '',
    rightLabel = '',
  } = $props<{
    diffFile?: GitDiffFile | null;
    sourceKind?: 'worktree' | 'staged' | 'commit';
    filePath?: string;
    leftLabel?: string;
    rightLabel?: string;
  }>();

  let activeFile = $derived(diffFile ?? gitStore.currentDiffFile);
  let activeKind = $derived(sourceKind ?? gitStore.selectedFile?.kind ?? 'worktree');
  let activePath = $derived(
    filePath ||
    activeFile?.newPath ||
    activeFile?.oldPath ||
    gitStore.selectedFile?.path ||
    ''
  );

  let hunks = $derived(activeFile?.hunks ?? []);
  let totalHunks = $derived(hunks.length);
  let currentHunkIdx = $state(0);

  let diffStats = $derived.by(() => {
    let adds = 0;
    let dels = 0;
    for (const h of hunks) {
      for (const line of h.lines) {
        if (line.kind === 'add') adds++;
        else if (line.kind === 'del') dels++;
      }
    }
    return { adds, dels };
  });

  let sbsHunks = $derived<SbsHunk[]>(hunks.map(hunkToSbs));

  let hunkElements = $state<HTMLElement[]>([]);

  let leftPanelEl = $state<HTMLElement | null>(null);
  let rightPanelEl = $state<HTMLElement | null>(null);
  let syncingSource: 'left' | 'right' | null = null;
  let syncTimeout: any = null;

  // Compute maximum line length (characters) across all visible hunks on left and right
  // to give both panels an identical min-width for 1:1 synchronized horizontal scrolling!
  let maxLineChars = $derived.by(() => {
    let maxLen = 0;
    for (const h of sbsHunks) {
      for (const r of h.rows) {
        if (r.left.text && r.left.text.length > maxLen) maxLen = r.left.text.length;
        if (r.right.text && r.right.text.length > maxLen) maxLen = r.right.text.length;
      }
    }
    return maxLen;
  });

  let minContentWidth = $derived(Math.max(650, maxLineChars * 8.5 + 100));

  function handleSyncScroll(source: 'left' | 'right') {
    if (syncingSource && syncingSource !== source) return;
    syncingSource = source;
    if (syncTimeout) clearTimeout(syncTimeout);

    const from = source === 'left' ? leftPanelEl : rightPanelEl;
    const to = source === 'left' ? rightPanelEl : leftPanelEl;

    if (from && to) {
      to.scrollTop = from.scrollTop;
      to.scrollLeft = from.scrollLeft;
    }

    syncTimeout = setTimeout(() => {
      syncingSource = null;
    }, 40);
  }

  function scrollToHunk(idx: number) {
    if (idx < 0 || idx >= totalHunks) return;
    currentHunkIdx = idx;
    const el = hunkElements[idx];
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function prevHunk() {
    if (currentHunkIdx > 0) {
      scrollToHunk(currentHunkIdx - 1);
    }
  }

  function nextHunk() {
    if (currentHunkIdx < totalHunks - 1) {
      scrollToHunk(currentHunkIdx + 1);
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'F7') {
      e.preventDefault();
      if (e.shiftKey) {
        prevHunk();
      } else {
        nextHunk();
      }
    }
  }

  async function handleHunkAction(hunkIdx: number) {
    if (!activePath) return;
    if (activeKind === 'worktree') {
      await gitStore.stageHunk(activePath, hunkIdx);
    } else if (activeKind === 'staged') {
      await gitStore.unstageHunk(activePath, hunkIdx);
    }
  }

  function formatPath(p: string) {
    const parts = p.split('/');
    const name = parts.pop() || p;
    const dir = parts.join('/');
    return { name, dir };
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="diff-view">
  <!-- Toolbar -->
  <div class="diff-toolbar">
    <div class="file-info">
      {#if activePath}
        {@const { name, dir } = formatPath(activePath)}
        <span class="file-icon">📄</span>
        <span class="file-name">{name}</span>
        {#if dir}
          <span class="file-dir">{dir}</span>
        {/if}
        {#if diffStats.adds > 0 || diffStats.dels > 0}
          <div class="diff-stats-group">
            {#if diffStats.adds > 0}
              <span class="diff-stat-pill add">+{diffStats.adds}</span>
            {/if}
            {#if diffStats.dels > 0}
              <span class="diff-stat-pill del">-{diffStats.dels}</span>
            {/if}
          </div>
        {/if}
        {#if activeFile?.binary}
          <span class="binary-badge">BINARY</span>
        {/if}
        {#if leftLabel && rightLabel}
          <span class="compare-badge">
            <span class="badge-left">{leftLabel}</span>
            <span class="badge-sep">vs</span>
            <span class="badge-right">{rightLabel}</span>
          </span>
        {/if}
      {:else}
        <span class="empty-path">Select a file to view diff</span>
      {/if}
    </div>

    <div class="spacer"></div>

    <!-- Mode Toggle: Side-by-side vs Unified -->
    <div class="toggle-group">
      <button
        class="toggle-btn"
        class:active={gitStore.diffMode === 'sbs'}
        onclick={() => gitStore.setDiffMode('sbs')}
      >
        Side-by-side
      </button>
      <button
        class="toggle-btn"
        class:active={gitStore.diffMode === 'unified'}
        onclick={() => gitStore.setDiffMode('unified')}
      >
        Unified
      </button>
    </div>

    <!-- Ignore Whitespace -->
    <button
      class="toolbar-btn"
      class:active={gitStore.ignoreWs}
      onclick={() => gitStore.setIgnoreWs(!gitStore.ignoreWs)}
      title="Ignore whitespace changes (-w)"
    >
      Ignore whitespace
    </button>

    <!-- Hunk Navigation -->
    {#if totalHunks > 0}
      <div class="hunk-nav">
        <button
          class="nav-btn"
          disabled={currentHunkIdx <= 0}
          onclick={prevHunk}
          title="Previous hunk (Shift+F7)"
        >
          ↑
        </button>
        <button
          class="nav-btn"
          disabled={currentHunkIdx >= totalHunks - 1}
          onclick={nextHunk}
          title="Next hunk (F7)"
        >
          ↓
        </button>
        <span class="hunk-counter">hunk {currentHunkIdx + 1}/{totalHunks}</span>
      </div>
    {/if}
  </div>

  <!-- Content Area -->
  <div
    class="diff-content"
    class:sbs-mode={gitStore.diffMode === 'sbs' && !gitStore.diffLoading && !gitStore.diffError && activeFile && !activeFile.binary && totalHunks > 0}
  >
    {#if gitStore.diffLoading}
      <div class="state-msg">Loading diff...</div>
    {:else if gitStore.diffError}
      <div class="state-msg error">{gitStore.diffError}</div>
    {:else if !activeFile}
      <div class="state-msg">No file selected</div>
    {:else if activeFile.binary}
      <div class="state-msg">Binary file cannot be displayed inline</div>
    {:else if totalHunks === 0}
      <div class="state-msg">No differences found</div>
    {:else}
      <!-- Header Columns for Side-by-side -->
      {#if gitStore.diffMode === 'sbs'}
        <div class="sbs-columns-header">
          <span class="col-title left">
            {leftLabel || (activeKind === 'staged' ? 'HEAD (Committed)' : 'Index (Staged)')}
          </span>
          <div class="divider"></div>
          <span class="col-title right">
            {rightLabel || (activeKind === 'staged' ? 'Index (Staged)' : 'Working Tree')}
          </span>
        </div>

        <div class="sbs-split-wrapper">
          <!-- Left Panel (Original) -->
          <div
            class="sbs-panel-side left-panel hunks-container"
            bind:this={leftPanelEl}
            onscroll={() => handleSyncScroll('left')}
          >
            <div class="sbs-content-inner" style:min-width="{minContentWidth}px">
              {#each hunks as hunk, hunkIdx (hunkIdx)}
                {@const sbsHunk = sbsHunks[hunkIdx]}
                <div
                  class="hunk-block"
                  bind:this={hunkElements[hunkIdx]}
                  class:active-hunk={hunkIdx === currentHunkIdx}
                >
                  <!-- Hunk Header Bar -->
                  <div class="hunk-header">
                    <span class="hunk-range">{hunk.header}</span>
                    {#if activeKind === 'worktree'}
                      <button
                        class="hunk-action-btn stage"
                        onclick={() => handleHunkAction(hunkIdx)}
                      >
                        Stage hunk
                      </button>
                    {:else if activeKind === 'staged'}
                      <button
                        class="hunk-action-btn unstage"
                        onclick={() => handleHunkAction(hunkIdx)}
                      >
                        Unstage hunk
                      </button>
                    {/if}
                  </div>

                  <!-- Diff Lines -->
                  <div class="sbs-rows code">
                    {#each sbsHunk.rows as row, rowIdx (rowIdx)}
                      <div class="sbs-row sbs-cell left {row.left.kind}">
                        <span class="gutter">{row.left.lineNo ?? ''}</span>
                        <span class="cell-text">
                          {#if row.left.tokens && row.left.tokens.length > 0}
                            {#each row.left.tokens as token}
                              {#if token.changed && row.left.kind === 'del'}
                                <span class="delw">{token.text}</span>
                              {:else}
                                <span>{token.text}</span>
                              {/if}
                            {/each}
                          {:else}
                            {row.left.text ?? ''}
                          {/if}
                        </span>
                      </div>
                    {/each}
                  </div>
                </div>
              {/each}
            </div>
          </div>

          <div class="sbs-vertical-divider"></div>

          <!-- Right Panel (Modified) -->
          <div
            class="sbs-panel-side right-panel hunks-container"
            bind:this={rightPanelEl}
            onscroll={() => handleSyncScroll('right')}
          >
            <div class="sbs-content-inner" style:min-width="{minContentWidth}px">
              {#each hunks as hunk, hunkIdx (hunkIdx)}
                {@const sbsHunk = sbsHunks[hunkIdx]}
                <div
                  class="hunk-block"
                  class:active-hunk={hunkIdx === currentHunkIdx}
                >
                  <!-- Hunk Header Bar -->
                  <div class="hunk-header">
                    <span class="hunk-range">{hunk.header}</span>
                  </div>

                  <!-- Diff Lines -->
                  <div class="sbs-rows code">
                    {#each sbsHunk.rows as row, rowIdx (rowIdx)}
                      <div class="sbs-row sbs-cell right {row.right.kind}">
                        <span class="gutter">{row.right.lineNo ?? ''}</span>
                        <span class="cell-text">
                          {#if row.right.tokens && row.right.tokens.length > 0}
                            {#each row.right.tokens as token}
                              {#if token.changed && row.right.kind === 'add'}
                                <span class="addw">{token.text}</span>
                              {:else}
                                <span>{token.text}</span>
                              {/if}
                            {/each}
                          {:else}
                            {row.right.text ?? ''}
                          {/if}
                        </span>
                      </div>
                    {/each}
                  </div>
                </div>
              {/each}
            </div>
          </div>
        </div>
      {:else}
        <!-- Unified Mode -->
        <div class="diff-content">
          <div class="hunks-container">
            {#each hunks as hunk, hunkIdx (hunkIdx)}
              <div
                class="hunk-block"
                bind:this={hunkElements[hunkIdx]}
                class:active-hunk={hunkIdx === currentHunkIdx}
              >
                <div class="hunk-header">
                  <span class="hunk-range">{hunk.header}</span>
                  {#if activeKind === 'worktree'}
                    <button
                      class="hunk-action-btn stage"
                      onclick={() => handleHunkAction(hunkIdx)}
                    >
                      Stage hunk
                    </button>
                  {:else if activeKind === 'staged'}
                    <button
                      class="hunk-action-btn unstage"
                      onclick={() => handleHunkAction(hunkIdx)}
                    >
                      Unstage hunk
                    </button>
                  {/if}
                </div>
                <div class="unified-rows code">
                  {#each hunk.lines as line, lineIdx (lineIdx)}
                    <div class="unified-row {line.kind}">
                      <span class="gutter old">{line.oldNo ?? ''}</span>
                      <span class="gutter new">{line.newNo ?? ''}</span>
                      <span class="sign">
                        {#if line.kind === 'add'}+{/if}
                        {#if line.kind === 'del'}−{/if}
                        {#if line.kind === 'context'}&nbsp;{/if}
                      </span>
                      <span class="cell-text">{line.text}</span>
                    </div>
                  {/each}
                </div>
              </div>
            {/each}
          </div>
        </div>
      {/if}
    {/if}
  </div>
</div>

<style>
  .diff-view {
    flex: 1;
    display: flex;
    flex-direction: column;
    height: 100%;
    min-width: 0;
    background: #1e1f22;
    user-select: text;
    -webkit-user-select: text;
  }

  .diff-toolbar {
    height: 38px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 0 14px;
    background: #1e1f22;
    border-bottom: 1px solid #2b2d30;
    user-select: none;
    -webkit-user-select: none;
    font-size: 12px;
  }

  .file-info {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    overflow: hidden;
  }

  .file-icon {
    font-size: 13px;
    opacity: 0.8;
  }

  .file-name {
    font-weight: 600;
    color: #e6edf3;
    white-space: nowrap;
  }

  .file-dir {
    color: #8b8f98;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: 11.5px;
  }

  .diff-stats-group {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    margin-left: 2px;
  }

  .diff-stat-pill {
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    font-size: 10.5px;
    font-weight: 600;
    padding: 1px 6px;
    border-radius: 10px;
    line-height: 14px;
  }

  .diff-stat-pill.add {
    background: rgba(46, 160, 67, 0.2);
    color: #4ade80;
    border: 1px solid rgba(46, 160, 67, 0.4);
  }

  .diff-stat-pill.del {
    background: rgba(248, 81, 73, 0.2);
    color: #f87171;
    border: 1px solid rgba(248, 81, 73, 0.4);
  }

  .binary-badge {
    font-size: 10px;
    color: #e8b45a;
    background: rgba(232, 180, 90, 0.2);
    padding: 1px 6px;
    border-radius: 4px;
  }

  .compare-badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    padding: 2px 7px;
    border-radius: 4px;
    background: #1e2430;
    border: 1px solid #2d3748;
    color: #9cc3ff;
    font-family: 'JetBrains Mono', monospace;
  }
  .compare-badge .badge-sep {
    color: #718096;
    font-size: 10px;
    font-style: italic;
  }
  .compare-badge .badge-right {
    color: #68d391;
  }

  .empty-path {
    color: #62666f;
    font-style: italic;
  }

  .spacer {
    flex-grow: 1;
  }

  .toggle-group {
    display: flex;
    border: 1px solid #2c2e34;
    border-radius: 6px;
    overflow: hidden;
  }

  .toggle-btn {
    height: 26px;
    padding: 0 10px;
    font-size: 12px;
    color: #8b8f98;
    background: transparent;
    transition: all 0.1s;
  }

  .toggle-btn:hover {
    color: #d8d9dc;
  }

  .toggle-btn.active {
    background: #23252b;
    color: #e6e7ea;
    font-weight: 500;
  }

  .toolbar-btn {
    height: 26px;
    padding: 0 10px;
    font-size: 12px;
    color: #8b8f98;
    border: 1px solid #2c2e34;
    border-radius: 6px;
    background: transparent;
    transition: all 0.1s;
  }

  .toolbar-btn:hover {
    color: #d8d9dc;
  }

  .toolbar-btn.active {
    background: #1f2a3d;
    border-color: #3b5072;
    color: #cfe0ff;
  }

  .hunk-nav {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .nav-btn {
    width: 24px;
    height: 24px;
    display: grid;
    place-items: center;
    border: 1px solid #2c2e34;
    border-radius: 4px;
    color: #b9bcc3;
    font-size: 12px;
    transition: all 0.1s;
  }

  .nav-btn:hover:not(:disabled) {
    background: #23252b;
    color: #ffffff;
  }

  .nav-btn:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }

  .hunk-counter {
    color: #8b8f98;
    font-size: 12px;
    min-width: 75px;
  }

  .sbs-columns-header {
    height: 26px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    font-size: 11px;
    font-weight: 500;
    color: #8b8f98;
    background: #141518;
    border-bottom: 1px solid #26282d;
    user-select: none;
  }

  .col-title {
    flex: 1;
    padding-left: 58px;
  }

  .diff-content {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overflow-x: auto;
    display: flex;
    flex-direction: column;
  }

  .diff-content.sbs-mode {
    overflow: hidden;
  }

  .state-msg {
    display: grid;
    place-items: center;
    height: 200px;
    color: #7a7e85;
    font-size: 13px;
  }

  .state-msg.error {
    color: #f07a74;
  }

  .hunks-container {
    display: flex;
    flex-direction: column;
    content-visibility: auto;
    overflow-x: auto;
    white-space: pre;
  }

  .hunk-block {
    margin-bottom: 16px;
  }

  .hunk-header {
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 14px 0 58px;
    background: #1e2025;
    border-top: 1px solid #282a30;
    border-bottom: 1px solid #282a30;
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    font-size: 11px;
    color: #7a7e85;
    position: sticky;
    left: 0;
    width: 100%;
    box-sizing: border-box;
    z-index: 3;
  }

  .hunk-range {
    color: #8b8f98;
  }

  .hunk-action-btn {
    font-family: 'Geist', system-ui, sans-serif;
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 4px;
    border: 1px solid transparent;
    cursor: pointer;
  }

  .hunk-action-btn.stage {
    color: #7fc98f;
    background: #1b2b20;
    border-color: #24452d;
  }

  .hunk-action-btn.stage:hover {
    background: #24452d;
  }

  .hunk-action-btn.unstage {
    color: #f07a74;
    background: #2c1d1f;
    border-color: #4a2629;
  }

  .hunk-action-btn.unstage:hover {
    background: #4a2629;
  }

  .code {
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    font-size: 13px;
    line-height: 22px;
    color: #bcbec4;
  }

  /* Side by side styles */
  .sbs-split-wrapper {
    flex: 1;
    display: flex;
    min-height: 0;
    height: calc(100% - 26px);
    overflow: hidden;
  }

  .sbs-panel-side {
    flex: 1;
    min-width: 0;
    height: 100%;
    overflow-y: scroll;
    overflow-x: auto;
    white-space: pre;
    background: #1e1f22;
  }

  .sbs-content-inner {
    display: flex;
    flex-direction: column;
    width: max-content;
    min-width: 100%;
  }

  .sbs-vertical-divider {
    width: 1px;
    background: #2b2d30;
    flex-shrink: 0;
  }

  .sbs-rows {
    display: flex;
    flex-direction: column;
    width: 100%;
  }

  .sbs-row {
    display: flex;
    height: 21px;
    line-height: 21px;
    width: 100%;
    white-space: pre;
  }

  .sbs-cell {
    flex: 1;
    display: flex;
    align-items: center;
    white-space: pre;
    overflow: visible;
  }

  .cell-text {
    flex: 1;
    min-width: 0;
    white-space: pre;
    overflow: visible;
    padding-left: 8px;
    padding-right: 40px;
    color: #dfe1e5;
  }

  .gutter {
    display: inline-block;
    width: 46px;
    flex-shrink: 0;
    text-align: right;
    padding-right: 12px;
    color: #6e7681;
    user-select: none;
    position: sticky;
    left: 0;
    background: #1e1f22;
    border-right: 1px solid #2b2d30;
    z-index: 2;
  }

  .divider {
    width: 1px;
    background: #2b2d30;
    flex-shrink: 0;
  }

  .add {
    background: rgba(46, 160, 67, 0.15);
    border-left: 3px solid #2ea043;
    color: #e6edf3;
  }

  .addw {
    background: rgba(46, 160, 67, 0.4);
    border-radius: 2px;
    padding: 0 2px;
    color: #ffffff;
  }

  .del {
    background: rgba(248, 81, 73, 0.15);
    border-left: 3px solid #f85149;
    color: #e6edf3;
  }

  .delw {
    background: rgba(248, 81, 73, 0.4);
    border-radius: 2px;
    padding: 0 2px;
    color: #ffffff;
  }

  .filler {
    background: repeating-linear-gradient(
      135deg,
      #18191c 0 6px,
      #1c1d20 6px 12px
    );
  }

  /* Unified styles */
  .unified-rows {
    display: flex;
    flex-direction: column;
  }

  .unified-row {
    display: flex;
    height: 21px;
    line-height: 21px;
    white-space: pre;
  }

  .unified-row.add {
    background: rgba(46, 160, 67, 0.15);
    border-left: 3px solid #2ea043;
    color: #e6edf3;
  }

  .unified-row.del {
    background: rgba(248, 81, 73, 0.15);
    border-left: 3px solid #f85149;
    color: #e6edf3;
  }

  .gutter.old,
  .gutter.new {
    width: 40px;
    padding-right: 8px;
    background: #1e1f22;
    border-right: 1px solid #2b2d30;
  }

  .sign {
    display: inline-block;
    width: 18px;
    text-align: center;
    color: #7a7e85;
    user-select: none;
  }

  .unified-row.add .sign {
    color: #7fc98f;
  }

  .unified-row.del .sign {
    color: #f07a74;
  }
</style>
