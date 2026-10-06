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

  let editableContent = $state('');
  let history = $state<string[]>([]);
  let historyIdx = $state(0);
  let isSaving = $state(false);
  let viewMode = $state<'visual' | 'raw'>('visual');

  $effect(() => {
    editableContent = file.merged;
    history = [file.merged];
    historyIdx = 0;
  });

  let yoursScrollEl: HTMLDivElement | null = null;
  let resultScrollEl: HTMLDivElement | null = null;
  let theirsScrollEl: HTMLDivElement | null = null;
  let isSyncingScroll = false;

  function pushHistory(newContent: string) {
    if (newContent === editableContent) return;
    history = history.slice(0, historyIdx + 1);
    history.push(newContent);
    historyIdx = history.length - 1;
    editableContent = newContent;
  }

  function handleUndo() {
    if (historyIdx > 0) {
      historyIdx--;
      editableContent = history[historyIdx];
    }
  }

  function handleRedo() {
    if (historyIdx < history.length - 1) {
      historyIdx++;
      editableContent = history[historyIdx];
    }
  }

  let canUndo = $derived(historyIdx > 0);
  let canRedo = $derived(historyIdx < history.length - 1);

  interface ParsedSection {
    type: 'clean' | 'conflict';
    lines: string[];
    blockIndex?: number;
    ours?: string[];
    theirs?: string[];
    customEdit?: string;
  }

  let parsedSections = $derived.by<ParsedSection[]>(() => {
    const lines = editableContent.split('\n');
    const sections: ParsedSection[] = [];
    let currentClean: string[] = [];
    let state: 'normal' | 'ours' | 'base' | 'theirs' = 'normal';
    let oursLines: string[] = [];
    let theirsLines: string[] = [];
    let blockIndex = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (state === 'normal') {
        if (line.startsWith('<<<<<<<')) {
          if (currentClean.length > 0) {
            sections.push({ type: 'clean', lines: currentClean });
            currentClean = [];
          }
          state = 'ours';
          oursLines = [];
          theirsLines = [];
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
        }
      } else if (state === 'theirs') {
        if (line.startsWith('>>>>>>>')) {
          sections.push({
            type: 'conflict',
            lines: [],
            blockIndex,
            ours: [...oursLines],
            theirs: [...theirsLines],
          });
          blockIndex++;
          state = 'normal';
        } else {
          theirsLines.push(line);
        }
      }
    }
    if (currentClean.length > 0) {
      sections.push({ type: 'clean', lines: currentClean });
    }
    return sections;
  });

  let conflictCount = $derived(
    parsedSections.filter((s) => s.type === 'conflict').length
  );

  let oursLines = $derived(file.ours ? file.ours.split('\n') : []);
  let theirsLines = $derived(file.theirs ? file.theirs.split('\n') : []);

  let oursLabel = $derived(gitStore.currentBranch || 'Yours');
  let theirsLabel = $derived(gitStore.opState?.ontoName || 'Theirs');

  async function resolveBlock(blockIndex: number, choice: 'ours' | 'theirs' | 'both') {
    try {
      const resolved = await api.gitResolveBlock(editableContent, blockIndex, choice);
      pushHistory(resolved);
    } catch (e: any) {
      gitStore.showToast(`Gagal resolve blok: ${e?.message || e}`, { type: 'error' });
    }
  }

  async function handleAcceptAllOurs() {
    let content = editableContent;
    while (true) {
      const bCount = content.split('\n').filter((l: string) => l.startsWith('<<<<<<<')).length;
      if (bCount === 0) break;
      content = await api.gitResolveBlock(content, 0, 'ours');
    }
    pushHistory(content);
  }

  async function handleAcceptAllTheirs() {
    let content = editableContent;
    while (true) {
      const bCount = content.split('\n').filter((l: string) => l.startsWith('<<<<<<<')).length;
      if (bCount === 0) break;
      content = await api.gitResolveBlock(content, 0, 'theirs');
    }
    pushHistory(content);
  }

  async function handleApply() {
    if (isSaving) return;
    if (conflictCount > 0) {
      if (!window.confirm(`Masih ada ${conflictCount} blok konflik yang belum diselesaikan. Tetap simpan?`)) {
        return;
      }
    }
    isSaving = true;
    try {
      await api.gitConflictWrite(gitStore.root, file.path, editableContent);
      await gitStore.stageFiles([file.path]);
      gitStore.showToast(`${file.path} berhasil diselesaikan dan di-stage!`, { type: 'success' });
      await gitStore.loadConflicts();
      await gitStore.loadOpState();
      onResolved();
      onClose();
    } catch (e: any) {
      gitStore.showToast(`Gagal menyimpan file: ${e?.message || e}`, { type: 'error' });
    } finally {
      isSaving = false;
    }
  }

  function handleSyncScroll(source: HTMLDivElement | null) {
    if (!source || isSyncingScroll) return;
    isSyncingScroll = true;
    const top = source.scrollTop;
    if (yoursScrollEl && yoursScrollEl !== source) yoursScrollEl.scrollTop = top;
    if (resultScrollEl && resultScrollEl !== source) resultScrollEl.scrollTop = top;
    if (theirsScrollEl && theirsScrollEl !== source) theirsScrollEl.scrollTop = top;
    requestAnimationFrame(() => {
      isSyncingScroll = false;
    });
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      onClose();
      return;
    }
    const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);
    const isCmd = isMac ? e.metaKey : e.ctrlKey;
    if (isCmd && !e.shiftKey && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      handleUndo();
    } else if (isCmd && ((e.shiftKey && e.key.toLowerCase() === 'z') || e.key.toLowerCase() === 'y')) {
      e.preventDefault();
      handleRedo();
    }
  }
</script>

<svelte:window onkeydown={handleKeyDown} />

<div class="merge-modal-backdrop" role="dialog" aria-modal="true" tabindex="-1">
  <div class="merge-modal-window">
    <!-- Top Bar with Undo / Redo & Stats -->
    <div class="merge-top-bar">
      <div class="top-file-info">
        <span class="file-icon">📄</span>
        <span class="file-path-title" title={file.path}>{file.path}</span>
        {#if conflictCount > 0}
          <span class="conflict-badge warn">{conflictCount} konflik tersisa</span>
        {:else}
          <span class="conflict-badge clean">Semua konflik terselesaikan ✓</span>
        {/if}
      </div>

      <!-- Center History Toolbar (Undo / Redo ala Android Studio) -->
      <div class="history-controls">
        <button
          class="hist-btn"
          onclick={handleUndo}
          disabled={!canUndo}
          title="Undo perubahan konflik terakhir (⌘Z)"
        >
          <span class="hist-icon">↶</span>
          <span>Undo</span>
        </button>
        <button
          class="hist-btn"
          onclick={handleRedo}
          disabled={!canRedo}
          title="Redo perubahan konflik (⇧⌘Z)"
        >
          <span class="hist-icon">↷</span>
          <span>Redo</span>
        </button>

        <div class="hist-sep"></div>

        <button
          class="mode-toggle-btn"
          class:active={viewMode === 'visual'}
          onclick={() => (viewMode = 'visual')}
          title="Tampilan blok konflik interaktif ala Android Studio"
        >
          Interactive
        </button>
        <button
          class="mode-toggle-btn"
          class:active={viewMode === 'raw'}
          onclick={() => (viewMode = 'raw')}
          title="Tampilan raw text editor"
        >
          Raw Text
        </button>
      </div>

      <div class="top-actions">
        <button class="btn-top-close" onclick={onClose} title="Tutup">✕</button>
      </div>
    </div>

    <!-- 3-Way Panes Header Bar -->
    <div class="panes-header-bar">
      <div class="pane-header left">
        <span class="tag yours">Yours</span>
        <span class="branch-name">{oursLabel}</span>
      </div>
      <div class="pane-header center">
        <span class="tag result">Result</span>
        <span class="branch-name">Hasil Penggabungan</span>
      </div>
      <div class="pane-header right">
        <span class="tag theirs">Theirs</span>
        <span class="branch-name">{theirsLabel}</span>
      </div>
    </div>

    <!-- 3-Way Panes Content Area -->
    <div class="panes-content-area">
      <!-- Left Column: Yours -->
      <div
        class="merge-column col-yours"
        bind:this={yoursScrollEl}
        onscroll={() => handleSyncScroll(yoursScrollEl)}
      >
        <div class="code-viewport mono">
          {#each oursLines as line, idx}
            <div class="code-row">
              <span class="line-num">{idx + 1}</span>
              <span class="line-code">{line || ' '}</span>
            </div>
          {/each}
        </div>
      </div>

      <!-- Center Column: Result (Interactive Conflict Resolver or Raw Editor) -->
      <div
        class="merge-column col-result"
        bind:this={resultScrollEl}
        onscroll={() => handleSyncScroll(resultScrollEl)}
      >
        {#if viewMode === 'raw'}
          <textarea
            class="result-raw-editor mono"
            bind:value={editableContent}
            oninput={(e) => pushHistory((e.target as HTMLTextAreaElement).value)}
            spellcheck="false"
          ></textarea>
        {:else}
          <div class="interactive-result-list mono">
            {#each parsedSections as section, sIdx}
              {#if section.type === 'clean'}
                <div class="clean-lines-block">
                  {#each section.lines as line}
                    <div class="code-row clean">
                      <span class="line-code">{line || ' '}</span>
                    </div>
                  {/each}
                </div>
              {:else if section.type === 'conflict' && section.blockIndex !== undefined}
                <!-- Prominent Interactive Conflict Card -->
                <div class="conflict-card-widget">
                  <div class="widget-header-bar">
                    <div class="widget-title-badge">
                      <span class="swords-icon">⚔️</span>
                      <span>Konflik #{section.blockIndex + 1}</span>
                    </div>

                    <!-- Direct Selection Buttons -->
                    <div class="widget-actions-group">
                      <button
                        class="widget-btn pick-yours"
                        onclick={() => resolveBlock(section.blockIndex!, 'ours')}
                        title="Ambil seluruh baris dari Yours ({oursLabel})"
                      >
                        « Accept Left (Yours)
                      </button>
                      <button
                        class="widget-btn pick-both"
                        onclick={() => resolveBlock(section.blockIndex!, 'both')}
                        title="Gabungkan kedua sisi (Yours lalu Theirs)"
                      >
                        Accept Both
                      </button>
                      <button
                        class="widget-btn pick-theirs"
                        onclick={() => resolveBlock(section.blockIndex!, 'theirs')}
                        title="Ambil seluruh baris dari Theirs ({theirsLabel})"
                      >
                        Accept Right (Theirs) »
                      </button>
                    </div>
                  </div>

                  <!-- Side-by-Side Diff Preview within the card -->
                  <div class="widget-diff-split">
                    <div class="snippet-box yours-snippet">
                      <div class="snippet-title yours-color">
                        <span>Yours ({oursLabel}):</span>
                      </div>
                      <div class="snippet-code-lines">
                        {#each section.ours || [] as line}
                          <div class="snippet-row hl-yours">+ {line || ' '}</div>
                        {/each}
                      </div>
                    </div>

                    <div class="snippet-box theirs-snippet">
                      <div class="snippet-title theirs-color">
                        <span>Theirs ({theirsLabel}):</span>
                      </div>
                      <div class="snippet-code-lines">
                        {#each section.theirs || [] as line}
                          <div class="snippet-row hl-theirs">+ {line || ' '}</div>
                        {/each}
                      </div>
                    </div>
                  </div>
                </div>
              {/if}
            {/each}
          </div>
        {/if}
      </div>

      <!-- Right Column: Theirs -->
      <div
        class="merge-column col-theirs"
        bind:this={theirsScrollEl}
        onscroll={() => handleSyncScroll(theirsScrollEl)}
      >
        <div class="code-viewport mono">
          {#each theirsLines as line, idx}
            <div class="code-row">
              <span class="line-num">{idx + 1}</span>
              <span class="line-code">{line || ' '}</span>
            </div>
          {/each}
        </div>
      </div>
    </div>

    <!-- Bottom Action Bar -->
    <div class="merge-bottom-bar">
      <div class="bottom-stats">
        {#if conflictCount > 0}
          <span class="stat-pill warn">⚠️ {conflictCount} blok konflik perlu dipilih</span>
        {:else}
          <span class="stat-pill clean">✓ Semua konflik terselesaikan! Siap disimpan ke file.</span>
        {/if}
      </div>

      <div class="bottom-buttons">
        <button class="btn-subtle" onclick={handleAcceptAllOurs} title="Ambil semua perubahan Yours sekaligus">
          Accept All Left ({oursLabel})
        </button>
        <button class="btn-subtle" onclick={handleAcceptAllTheirs} title="Ambil semua perubahan Theirs sekaligus">
          Accept All Right ({theirsLabel})
        </button>
        <button class="btn-secondary" onclick={onClose} disabled={isSaving}>
          Batal
        </button>
        <button
          class="btn-primary-apply"
          onclick={handleApply}
          disabled={isSaving}
        >
          {#if isSaving}
            <span class="spin">↻</span>
            <span>Menyimpan…</span>
          {:else}
            <span>Apply</span>
          {/if}
        </button>
      </div>
    </div>
  </div>
</div>

<style>
  .merge-modal-backdrop {
    position: fixed;
    inset: 0;
    z-index: 100000;
    background: rgba(10, 11, 14, 0.82);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
    user-select: none;
    -webkit-user-select: none;
    animation: fadeIn 0.15s ease-out;
  }

  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  .merge-modal-window {
    width: 100%;
    height: 100%;
    max-width: 1460px;
    max-height: 920px;
    background: #14161a;
    border: 1px solid #2a2e37;
    border-radius: 10px;
    box-shadow: 0 24px 60px rgba(0, 0, 0, 0.7);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  /* Top Bar */
  .merge-top-bar {
    height: 42px;
    padding: 0 16px;
    background: #111215;
    border-bottom: 1px solid #23262e;
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-shrink: 0;
    gap: 12px;
  }

  .top-file-info {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .file-icon {
    font-size: 14px;
  }

  .file-path-title {
    font-family: 'JetBrains Mono', monospace;
    font-size: 12.5px;
    font-weight: 600;
    color: #e2e8f0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 440px;
  }

  .conflict-badge {
    font-size: 11px;
    font-weight: 600;
    padding: 2px 8px;
    border-radius: 10px;
  }
  .conflict-badge.warn {
    background: #3b1d1f;
    color: #f87171;
    border: 1px solid #7f1d1d;
  }
  .conflict-badge.clean {
    background: #132e22;
    color: #4ade80;
    border: 1px solid #14532d;
  }

  /* History Controls (Undo / Redo) */
  .history-controls {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .hist-btn {
    height: 26px;
    padding: 0 9px;
    background: #1e222a;
    border: 1px solid #2c323e;
    color: #cbd5e1;
    border-radius: 5px;
    font-size: 11.5px;
    font-weight: 500;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    transition: all 0.12s ease;
  }
  .hist-btn:hover:not(:disabled) {
    background: #2a303d;
    color: #ffffff;
    border-color: #3b82f6;
  }
  .hist-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .hist-icon {
    font-size: 13px;
    font-weight: 700;
  }

  .hist-sep {
    width: 1px;
    height: 16px;
    background: #272a33;
    margin: 0 4px;
  }

  .mode-toggle-btn {
    height: 26px;
    padding: 0 10px;
    background: #16181d;
    border: 1px solid #242831;
    color: #8b92a0;
    border-radius: 5px;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.12s ease;
  }
  .mode-toggle-btn.active {
    background: #1e293b;
    border-color: #3b82f6;
    color: #60a5fa;
  }

  .btn-top-close {
    background: none;
    border: none;
    color: #8b8f98;
    cursor: pointer;
    font-size: 15px;
    padding: 4px;
  }
  .btn-top-close:hover {
    color: #ffffff;
  }

  /* Panes Header */
  .panes-header-bar {
    height: 32px;
    display: flex;
    background: #16181e;
    border-bottom: 1px solid #23262e;
    flex-shrink: 0;
  }

  .pane-header {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 14px;
    font-size: 11.5px;
  }
  .pane-header.left { border-right: 1px solid #23262e; }
  .pane-header.center {
    border-right: 1px solid #23262e;
    background: #13151a;
  }

  .tag {
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    padding: 1px 6px;
    border-radius: 4px;
  }
  .tag.yours { background: #1e293b; color: #60a5fa; }
  .tag.result { background: #1f2a24; color: #34d399; }
  .tag.theirs { background: #2d2417; color: #fbbf24; }

  .branch-name {
    color: #94a3b8;
    font-family: 'JetBrains Mono', monospace;
    font-size: 11px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Panes Body */
  .panes-content-area {
    flex: 1;
    display: flex;
    min-height: 0;
    background: #0f1115;
  }

  .merge-column {
    flex: 1;
    min-width: 0;
    height: 100%;
    overflow-y: auto;
    position: relative;
  }

  .col-yours {
    background: #101216;
    border-right: 1px solid #1f222a;
  }
  .col-result {
    background: #0d0f13;
    border-right: 1px solid #1f222a;
  }
  .col-theirs {
    background: #101216;
  }

  .code-viewport {
    padding: 8px 0;
    font-size: 12px;
    line-height: 20px;
  }

  .code-row {
    display: flex;
    padding: 0 10px;
    white-space: pre;
  }
  .code-row:hover {
    background: #181b22;
  }

  .line-num {
    width: 38px;
    color: #475569;
    font-size: 11px;
    user-select: none;
    text-align: right;
    padding-right: 12px;
    flex-shrink: 0;
  }

  .line-code {
    flex: 1;
    color: #cbd5e1;
  }

  /* Interactive Center View */
  .interactive-result-list {
    padding: 10px;
    font-size: 12px;
    line-height: 20px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .clean-lines-block {
    background: #111317;
    border-radius: 4px;
    padding: 4px 0;
  }
  .code-row.clean {
    padding: 0 12px;
  }

  /* Conflict Card Widget (The Heart of Android Studio Merge Tool) */
  .conflict-card-widget {
    background: #191c24;
    border: 1px solid #3b82f6;
    border-radius: 8px;
    overflow: hidden;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
    animation: widgetIn 0.15s ease-out;
  }

  @keyframes widgetIn {
    from { transform: translateY(4px); opacity: 0; }
    to { transform: translateY(0); opacity: 1; }
  }

  .widget-header-bar {
    padding: 8px 12px;
    background: #12141a;
    border-bottom: 1px solid #232834;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .widget-title-badge {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    font-weight: 700;
    color: #f1f5f9;
  }
  .swords-icon {
    font-size: 13px;
  }

  .widget-actions-group {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .widget-btn {
    height: 25px;
    padding: 0 10px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    border: 1px solid transparent;
    transition: all 0.12s ease;
  }

  .widget-btn.pick-yours {
    background: #1e293b;
    border-color: #3b82f6;
    color: #93c5fd;
  }
  .widget-btn.pick-yours:hover {
    background: #3b82f6;
    color: #ffffff;
  }

  .widget-btn.pick-both {
    background: #241c30;
    border-color: #a855f7;
    color: #d8b4fe;
  }
  .widget-btn.pick-both:hover {
    background: #a855f7;
    color: #ffffff;
  }

  .widget-btn.pick-theirs {
    background: #2d2315;
    border-color: #f59e0b;
    color: #fde68a;
  }
  .widget-btn.pick-theirs:hover {
    background: #f59e0b;
    color: #000000;
  }

  /* Widget Diff Split */
  .widget-diff-split {
    display: flex;
    background: #0f1116;
  }

  .snippet-box {
    flex: 1;
    min-width: 0;
    padding: 8px 12px;
  }
  .snippet-box.yours-snippet {
    border-right: 1px solid #1f232c;
    background: rgba(59, 130, 246, 0.04);
  }
  .snippet-box.theirs-snippet {
    background: rgba(245, 158, 11, 0.04);
  }

  .snippet-title {
    font-size: 11px;
    font-weight: 600;
    margin-bottom: 6px;
  }
  .yours-color { color: #60a5fa; }
  .theirs-color { color: #fbbf24; }

  .snippet-code-lines {
    font-family: 'JetBrains Mono', monospace;
    font-size: 11.5px;
    line-height: 19px;
  }

  .snippet-row.hl-yours {
    color: #bfdbfe;
  }
  .snippet-row.hl-theirs {
    color: #fef08a;
  }

  /* Raw Editor */
  .result-raw-editor {
    width: 100%;
    height: 100%;
    background: transparent;
    border: none;
    outline: none;
    resize: none;
    padding: 12px;
    font-size: 12px;
    line-height: 20px;
    color: #f1f5f9;
    white-space: pre;
    tab-size: 2;
  }

  /* Bottom Bar */
  .merge-bottom-bar {
    height: 48px;
    padding: 0 16px;
    background: #111215;
    border-top: 1px solid #23262e;
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-shrink: 0;
  }

  .stat-pill {
    font-size: 11.5px;
    font-weight: 500;
  }
  .stat-pill.warn { color: #f87171; }
  .stat-pill.clean { color: #4ade80; }

  .bottom-buttons {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .btn-subtle {
    background: #181b22;
    border: 1px solid #2a2e38;
    color: #94a3b8;
    border-radius: 6px;
    padding: 6px 12px;
    font-size: 11.5px;
    cursor: pointer;
    transition: all 0.12s ease;
  }
  .btn-subtle:hover {
    background: #232732;
    color: #e2e8f0;
  }

  .btn-secondary {
    background: #1e2128;
    border: 1px solid #2e333d;
    color: #cbd5e1;
    border-radius: 6px;
    padding: 6px 14px;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
  }
  .btn-secondary:hover:not(:disabled) {
    background: #2a2e38;
    color: #ffffff;
  }

  .btn-primary-apply {
    background: #2563eb;
    border: 1px solid #3b82f6;
    color: #ffffff;
    border-radius: 6px;
    padding: 6px 20px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 6px;
    transition: all 0.12s ease;
  }
  .btn-primary-apply:hover:not(:disabled) {
    background: #1d4ed8;
  }
  .btn-primary-apply:disabled,
  .btn-secondary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .spin {
    display: inline-block;
    animation: spin 1s infinite linear;
  }
  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
</style>
