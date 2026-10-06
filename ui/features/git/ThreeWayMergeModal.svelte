<script lang="ts">
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
    isIdentical: boolean; // Kiri dan kanan identik (Hijau)
    cleanLines: string[];
    oursLines: string[];
    theirsLines: string[];
    baseLines: string[];
    // Status sisi yang dimasukkan ke Result:
    acceptedSides: {
      ours: boolean;
      theirs: boolean;
    };
    customEdit?: string | null;
  }

  let hunks = $state<MergeHunk[]>([]);
  let history = $state<MergeHunk[][]>([]);
  let historyIdx = $state(0);
  let isSaving = $state(false);
  let activeHunkIdx = $state(0);

  function checkIsIdentical(ours: string[], theirs: string[]): boolean {
    if (ours.length !== theirs.length) return false;
    for (let i = 0; i < ours.length; i++) {
      if (ours[i] !== theirs[i]) return false;
    }
    return true;
  }

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
              isIdentical: false,
              cleanLines: currentClean,
              oursLines: [],
              theirsLines: [],
              baseLines: [],
              acceptedSides: { ours: false, theirs: false },
              customEdit: null,
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
          const isIdentical = checkIsIdentical(oursLines, theirsLines);
          result.push({
            id: hunkId++,
            kind: 'conflict',
            isIdentical,
            cleanLines: [],
            oursLines: [...oursLines],
            theirsLines: [...theirsLines],
            baseLines: [...baseLines],
            // Jika identik (hijau), otomatis masuk ke result!
            acceptedSides: {
              ours: isIdentical,
              theirs: false,
            },
            customEdit: null,
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
        isIdentical: false,
        cleanLines: currentClean,
        oursLines: [],
        theirsLines: [],
        baseLines: [],
        acceptedSides: { ours: false, theirs: false },
        customEdit: null,
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
      acceptedSides: { ...h.acceptedSides },
      customEdit: h.customEdit,
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

  // Hitung hasil baris Result untuk sebuah hunk
  function getResultLines(hunk: MergeHunk): string[] {
    if (hunk.kind === 'clean') return hunk.cleanLines;
    if (hunk.customEdit !== null && hunk.customEdit !== undefined) {
      return hunk.customEdit.split('\n');
    }
    // Jika identik (hijau), otomatis satu sisi masuk
    if (hunk.isIdentical) {
      return hunk.oursLines;
    }
    // Jika merah:
    const lines: string[] = [];
    if (hunk.acceptedSides.ours) {
      lines.push(...hunk.oursLines);
    }
    if (hunk.acceptedSides.theirs) {
      lines.push(...hunk.theirsLines);
    }
    return lines;
  }

  // Conflict statistics
  let conflictHunks = $derived(hunks.filter((h) => h.kind === 'conflict'));
  // Konflik belum selesai jika bukan identik DAN belum ada sisi yang dipilih
  let unresolvedCount = $derived(
    conflictHunks.filter(
      (h) => !h.isIdentical && !h.acceptedSides.ours && !h.acceptedSides.theirs && h.customEdit === null
    ).length
  );
  let totalConflicts = $derived(conflictHunks.length);

  /**
   * AKSI GUTTER ALA ANDROID STUDIO:
   * Jika klik Kiri (»): masukkan Kiri. Jika Kanan belum masuk, sekarang Kiri masuk.
   * Jika kemudian klik Kanan («): Kanan IKUT MASUK (kiri duluan + kanan, jadi masuk semua)!
   * Jika klik lagi pada sisi yang sudah aktif: batalkan sisi tersebut.
   */
  function toggleAcceptLeft(hunkId: number) {
    const next = cloneHunks(hunks);
    const target = next.find((h) => h.id === hunkId);
    if (!target) return;
    target.customEdit = null;
    // Toggle sisi Kiri
    target.acceptedSides.ours = !target.acceptedSides.ours;
    pushHistory(next);
  }

  function toggleAcceptRight(hunkId: number) {
    const next = cloneHunks(hunks);
    const target = next.find((h) => h.id === hunkId);
    if (!target) return;
    target.customEdit = null;
    // Toggle sisi Kanan (jika Kiri sudah aktif, Kanan ikut masuk jadi keduanya ada)
    target.acceptedSides.theirs = !target.acceptedSides.theirs;
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

  function updateHunkCustomText(hunkId: number, text: string) {
    const next = cloneHunks(hunks);
    const target = next.find((h) => h.id === hunkId);
    if (!target) return;
    target.customEdit = text;
    pushHistory(next);
  }

  // Bulk actions
  function handleAcceptAllLeft() {
    const next = cloneHunks(hunks);
    for (const h of next) {
      if (h.kind === 'conflict' && !h.isIdentical) {
        h.acceptedSides.ours = true;
        h.acceptedSides.theirs = false;
        h.customEdit = null;
      }
    }
    pushHistory(next);
  }

  function handleAcceptAllRight() {
    const next = cloneHunks(hunks);
    for (const h of next) {
      if (h.kind === 'conflict' && !h.isIdentical) {
        h.acceptedSides.theirs = true;
        h.acceptedSides.ours = false;
        h.customEdit = null;
      }
    }
    pushHistory(next);
  }

  function handleApplyAllIdentical() {
    const next = cloneHunks(hunks);
    for (const h of next) {
      if (h.kind === 'conflict' && h.isIdentical) {
        h.acceptedSides.ours = true;
        h.acceptedSides.theirs = false;
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

  function scrollToNextConflict() {
    const conflicts = hunks.filter((h) => h.kind === 'conflict' && !h.isIdentical);
    if (conflicts.length === 0) return;
    activeHunkIdx = (activeHunkIdx + 1) % conflicts.length;
    const targetEl = document.getElementById(`hunk-row-${conflicts[activeHunkIdx].id}`);
    targetEl?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function scrollToPrevConflict() {
    const conflicts = hunks.filter((h) => h.kind === 'conflict' && !h.isIdentical);
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
        .flatMap((h) => getResultLines(h))
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
          onclick={handleApplyAllIdentical}
          title="Apply Non-Conflicting Changes from Both Sides (»«)"
        >
          <span>»«</span>
        </button>
        <button
          class="tool-btn bulk-btn"
          onclick={handleAcceptAllLeft}
          title="Apply Changes from Left (»)"
        >
          <span>»</span>
        </button>
        <button
          class="tool-btn bulk-btn"
          onclick={handleAcceptAllRight}
          title="Apply Changes from Right («)"
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
    <div class="editor-viewport">
      <div class="sync-grid mono">
        {#each hunks as hunk (hunk.id)}
          {@const resultLines = getResultLines(hunk)}
          {@const hasSelection = hunk.acceptedSides.ours || hunk.acceptedSides.theirs || hunk.customEdit !== null}

          <div
            class="hunk-row"
            class:is-clean={hunk.kind === 'clean'}
            class:is-identical={hunk.kind === 'conflict' && hunk.isIdentical}
            class:is-conflict={hunk.kind === 'conflict' && !hunk.isIdentical}
            class:is-unresolved={hunk.kind === 'conflict' && !hunk.isIdentical && !hasSelection}
            class:is-resolved={hunk.kind === 'conflict' && (hunk.isIdentical || hasSelection)}
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
              {:else if hunk.isIdentical}
                <!-- HIJAU: Kanan-kiri identik atau penambahan sama -->
                <div class="hunk-badge badge-green">✓ Identik (Masuk Otomatis)</div>
                {#each hunk.oursLines as line}
                  <div class="code-line hl-green">
                    <span class="line-content">{line || ' '}</span>
                  </div>
                {/each}
              {:else}
                <!-- MERAH: Kanan-kiri berbeda -->
                <div class="hunk-badge badge-red">⚠️ Berbeda (Yours)</div>
                {#each hunk.oursLines as line}
                  <div class="code-line hl-red" class:is-picked={hunk.acceptedSides.ours}>
                    <span class="line-content">{line || ' '}</span>
                  </div>
                {/each}
              {/if}
            </div>

            <!-- 2. GUTTER LEFT-TO-CENTER (» and ✕) -->
            <div class="hunk-gutter gutter-left">
              {#if hunk.kind === 'conflict' && !hunk.isIdentical}
                <div class="gutter-actions-stack">
                  <button
                    class="gutter-action-btn accept-left"
                    class:active-applied={hunk.acceptedSides.ours}
                    onclick={() => toggleAcceptLeft(hunk.id)}
                    title={hunk.acceptedSides.ours ? "Kiri sudah ada di Result (Klik untuk batalkan)" : "Masukkan baris Kiri ke Result (»)"}
                  >
                    {#if hunk.acceptedSides.ours}✓{:else}»{/if}
                  </button>
                  <button
                    class="gutter-action-btn discard-btn"
                    onclick={() => discardLeft(hunk.id)}
                    title="Abaikan Kiri (✕)"
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
              {:else if hunk.isIdentical}
                <!-- HIJAU: Otomatis masuk jadi result -->
                {#each hunk.oursLines as line}
                  <div class="code-line hl-green-result">
                    <span class="line-content">{line || ' '}</span>
                  </div>
                {/each}
              {:else}
                <!-- MERAH: Menampilkan baris yang masuk (Kiri, Kanan, atau Keduanya) -->
                {#if !hasSelection}
                  <!-- Belum ada yang dipilih: panduan klik -->
                  <div class="unresolved-center-hint">
                    <div class="hint-title">⚠️ Konflik — Klik panah untuk memilih:</div>
                    <div class="hint-buttons-row">
                      <button class="hint-btn" onclick={() => toggleAcceptLeft(hunk.id)}>« Masukkan Kiri</button>
                      <button class="hint-btn hint-both" onclick={() => { toggleAcceptLeft(hunk.id); toggleAcceptRight(hunk.id); }}>Masukkan Keduanya</button>
                      <button class="hint-btn" onclick={() => toggleAcceptRight(hunk.id)}>Masukkan Kanan »</button>
                    </div>
                    {#if hunk.baseLines.length > 0}
                      <div class="base-preview-section">
                        <span class="base-label">Base ancestor:</span>
                        {#each hunk.baseLines as line}
                          <div class="code-line base-line">{line || ' '}</div>
                        {/each}
                      </div>
                    {/if}
                  </div>
                {:else}
                  <!-- Sudah dipilih: tampilkan baris yang masuk dan bisa diedit langsung -->
                  <div class="resolved-center-editor">
                    {#if hunk.acceptedSides.ours && hunk.acceptedSides.theirs}
                      <div class="merged-both-pill">✓ Kiri + Kanan keduanya masuk</div>
                    {:else if hunk.acceptedSides.ours}
                      <div class="merged-side-pill ours">✓ Baris Kiri dimasukkan</div>
                    {:else if hunk.acceptedSides.theirs}
                      <div class="merged-side-pill theirs">✓ Baris Kanan dimasukkan</div>
                    {/if}
                    <textarea
                      class="inline-result-editor mono"
                      value={resultLines.join('\n')}
                      oninput={(e) => updateHunkCustomText(hunk.id, (e.target as HTMLTextAreaElement).value)}
                      rows={Math.max(1, resultLines.length)}
                      spellcheck="false"
                    ></textarea>
                  </div>
                {/if}
              {/if}
            </div>

            <!-- 4. GUTTER CENTER-TO-RIGHT (« and ✕) -->
            <div class="hunk-gutter gutter-right">
              {#if hunk.kind === 'conflict' && !hunk.isIdentical}
                <div class="gutter-actions-stack">
                  <button
                    class="gutter-action-btn accept-right"
                    class:active-applied={hunk.acceptedSides.theirs}
                    onclick={() => toggleAcceptRight(hunk.id)}
                    title={hunk.acceptedSides.theirs ? "Kanan sudah ada di Result (Klik untuk batalkan)" : "Masukkan baris Kanan ke Result («)"}
                  >
                    {#if hunk.acceptedSides.theirs}✓{:else}«{/if}
                  </button>
                  <button
                    class="gutter-action-btn discard-btn"
                    onclick={() => discardRight(hunk.id)}
                    title="Abaikan Kanan (✕)"
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
              {:else if hunk.isIdentical}
                <!-- HIJAU: Kanan-kiri identik -->
                <div class="hunk-badge badge-green">✓ Identik (Masuk Otomatis)</div>
                {#each hunk.theirsLines as line}
                  <div class="code-line hl-green">
                    <span class="line-content">{line || ' '}</span>
                  </div>
                {/each}
              {:else}
                <!-- MERAH: Kanan-kiri berbeda -->
                <div class="hunk-badge badge-red">⚠️ Berbeda (Theirs)</div>
                {#each hunk.theirsLines as line}
                  <div class="code-line hl-red" class:is-picked={hunk.acceptedSides.theirs}>
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

  /* HIJAU: Identik / Penambahan */
  .hunk-row.is-identical {
    background: rgba(34, 197, 94, 0.08);
    border-top: 1px solid #166534;
    border-bottom: 1px solid #166534;
  }

  /* MERAH: Konflik berbeda */
  .hunk-row.is-conflict.is-unresolved {
    background: rgba(239, 68, 68, 0.12);
    border-top: 1px solid #991b1b;
    border-bottom: 1px solid #991b1b;
  }

  .hunk-row.is-conflict.is-resolved {
    background: rgba(30, 41, 59, 0.25);
  }

  .hunk-pane {
    padding: 6px 10px;
    overflow-x: auto;
    white-space: pre;
  }

  .pane-left {
    border-right: 1px solid #2b2d30;
  }

  .pane-center {
    background: #18191c;
    border-left: 1px solid #2b2d30;
    border-right: 1px solid #2b2d30;
  }

  .pane-right {
    border-left: 1px solid #2b2d30;
  }

  .code-line {
    min-height: 19px;
    color: #d1d5db;
    padding: 0 4px;
    border-radius: 2px;
  }

  .clean-line {
    color: #a1a1aa;
  }

  /* HIJAU STYLING (Identik / Penambahan) */
  .hl-green {
    background: rgba(34, 197, 94, 0.22);
    border-left: 3px solid #22c55e;
    color: #86efac;
  }

  .hl-green-result {
    background: rgba(34, 197, 94, 0.18);
    border-left: 3px solid #22c55e;
    color: #bbf7d0;
  }

  /* MERAH STYLING (Konflik berbeda) */
  .hl-red {
    background: rgba(239, 68, 68, 0.22);
    border-left: 3px solid #ef4444;
    color: #fca5a5;
  }

  .hl-red.is-picked {
    background: rgba(59, 130, 246, 0.28);
    border-left: 3px solid #3b82f6;
    color: #93c5fd;
  }

  .hunk-badge {
    font-size: 10px;
    font-weight: 600;
    padding: 1px 6px;
    border-radius: 3px;
    margin-bottom: 4px;
    display: inline-block;
    user-select: none;
  }

  .badge-green {
    background: #14532d;
    color: #86efac;
    border: 1px solid #166534;
  }

  .badge-red {
    background: #7f1d1d;
    color: #fca5a5;
    border: 1px solid #991b1b;
  }

  /* Gutters & Action Buttons */
  .hunk-gutter {
    background: #222427;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-start;
    padding-top: 6px;
    user-select: none;
  }

  .gutter-actions-stack {
    display: flex;
    flex-direction: column;
    gap: 4px;
    position: sticky;
    top: 6px;
  }

  .gutter-action-btn {
    width: 24px;
    height: 22px;
    border-radius: 4px;
    border: none;
    font-size: 13px;
    font-weight: 700;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: transform 0.08s, background 0.1s;
  }

  .gutter-action-btn:hover {
    transform: scale(1.15);
  }

  .accept-left,
  .accept-right {
    background: #2563eb;
    color: #ffffff;
  }

  .accept-left:hover,
  .accept-right:hover {
    background: #3b82f6;
  }

  .accept-left.active-applied,
  .accept-right.active-applied {
    background: #16a34a;
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

  /* Center Result Zone */
  .unresolved-center-hint {
    background: rgba(127, 29, 29, 0.25);
    border: 1px dashed #ef4444;
    border-radius: 4px;
    padding: 8px 10px;
    user-select: none;
  }

  .hint-title {
    font-size: 11px;
    font-weight: 600;
    color: #fca5a5;
    margin-bottom: 6px;
  }

  .hint-buttons-row {
    display: flex;
    gap: 6px;
    margin-bottom: 6px;
  }

  .hint-btn {
    padding: 3px 8px;
    font-size: 11px;
    background: #2563eb;
    border: 1px solid #3b82f6;
    color: #ffffff;
    border-radius: 3px;
    cursor: pointer;
    font-weight: 500;
  }

  .hint-btn:hover {
    background: #3b82f6;
  }

  .hint-btn.hint-both {
    background: #7c3aed;
    border-color: #8b5cf6;
  }

  .hint-btn.hint-both:hover {
    background: #8b5cf6;
  }

  .base-preview-section {
    margin-top: 6px;
    padding-top: 6px;
    border-top: 1px dashed rgba(239, 68, 68, 0.3);
  }

  .base-label {
    font-size: 10px;
    color: #9ca3af;
    display: block;
    margin-bottom: 2px;
  }

  .base-line {
    color: #9ca3af;
    font-size: 11px;
  }

  .resolved-center-editor {
    width: 100%;
  }

  .merged-both-pill {
    font-size: 10px;
    font-weight: 600;
    padding: 1px 6px;
    border-radius: 3px;
    background: #581c87;
    color: #d8b4fe;
    display: inline-block;
    margin-bottom: 4px;
  }

  .merged-side-pill {
    font-size: 10px;
    font-weight: 600;
    padding: 1px 6px;
    border-radius: 3px;
    display: inline-block;
    margin-bottom: 4px;
  }

  .merged-side-pill.ours {
    background: #1e3a8a;
    color: #93c5fd;
  }

  .merged-side-pill.theirs {
    background: #831843;
    color: #fbcfe8;
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
