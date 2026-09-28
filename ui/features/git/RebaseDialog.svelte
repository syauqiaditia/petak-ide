<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '../../lib/api';
  import type { GitRebaseItem, GitOpResult } from '../../lib/api';
  import {
    validateRebasePlan,
    summarizeRebasePlan,
    reorderItems,
    setItemAction,
    setItemMessage,
    buildRebasePlan,
  } from './rebasePlan';

  let {
    root,
    baseSha,
    commits = [],
    onClose,
    onSuccess,
  } = $props<{
    root: string;
    baseSha: string;
    commits?: GitRebaseItem[];
    onClose: () => void;
    onSuccess: (result: GitOpResult) => void;
  }>();

  let items = $state<GitRebaseItem[]>([]);
  let selectedIdx = $state<number>(0);
  let createBackup = $state<boolean>(true);
  let loading = $state<boolean>(false);
  let error = $state<string | null>(null);
  let draggedIdx = $state<number | null>(null);

  let currentItem = $derived(items[selectedIdx] ?? null);
  let summary = $derived(summarizeRebasePlan(items));
  let validation = $derived(validateRebasePlan(items));

  let currentSubject = $derived(
    currentItem?.message?.split('\n')[0] ?? ''
  );
  let subjectLen = $derived(currentSubject.length);

  onMount(async () => {
    if (commits.length > 0) {
      items = commits.map((c) => ({ ...c }));
    } else {
      loading = true;
      try {
        const fetched = await api.gitRebaseTodo(root, baseSha);
        items = fetched;
      } catch (e: any) {
        error = String(e);
      } finally {
        loading = false;
      }
    }
  });

  function handleActionClick(action: GitRebaseItem['action']) {
    if (selectedIdx < 0 || selectedIdx >= items.length) return;
    items = setItemAction(items, selectedIdx, action);
  }

  function handleRowActionChange(idx: number, e: Event) {
    const val = (e.target as HTMLSelectElement).value as GitRebaseItem['action'];
    items = setItemAction(items, idx, val);
  }

  function handleMoveUp() {
    if (selectedIdx > 0) {
      items = reorderItems(items, selectedIdx, selectedIdx - 1);
      selectedIdx -= 1;
    }
  }

  function handleMoveDown() {
    if (selectedIdx < items.length - 1) {
      items = reorderItems(items, selectedIdx, selectedIdx + 1);
      selectedIdx += 1;
    }
  }

  function handleMessageChange(e: Event) {
    const val = (e.target as HTMLTextAreaElement).value;
    if (selectedIdx >= 0 && selectedIdx < items.length) {
      items = setItemMessage(items, selectedIdx, val);
    }
  }

  function handleKeyDown(e: KeyboardEvent) {
    // If typing in textarea, don't trigger row shortcuts
    if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) {
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (selectedIdx > 0) selectedIdx--;
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (selectedIdx < items.length - 1) selectedIdx++;
    } else if (e.key === 'p') {
      handleActionClick('pick');
    } else if (e.key === 'r') {
      handleActionClick('reword');
    } else if (e.key === 'e') {
      handleActionClick('edit');
    } else if (e.key === 's') {
      handleActionClick('squash');
    } else if (e.key === 'f') {
      handleActionClick('fixup');
    } else if (e.key === 'd') {
      handleActionClick('drop');
    } else if (e.key === 'Escape') {
      onClose();
    }
  }

  // HTML5 Drag and Drop
  function onDragStart(idx: number, e: DragEvent) {
    draggedIdx = idx;
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
    }
  }

  function onDragOver(idx: number, e: DragEvent) {
    e.preventDefault();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'move';
    }
  }

  function onDrop(idx: number, e: DragEvent) {
    e.preventDefault();
    if (draggedIdx !== null && draggedIdx !== idx) {
      items = reorderItems(items, draggedIdx, idx);
      selectedIdx = idx;
    }
    draggedIdx = null;
  }

  async function handleStartRebasing() {
    if (!validation.valid) {
      error = validation.error ?? 'Rencana rebase tidak valid';
      return;
    }

    loading = true;
    error = null;
    try {
      const plan = buildRebasePlan(baseSha, items, createBackup);
      const res = await api.gitRebaseRun(root, plan);
      onSuccess(res);
    } catch (e: any) {
      error = String(e);
      loading = false;
    }
  }

  function getActionBadgeStyle(action: GitRebaseItem['action']): { bg: string; color: string } {
    switch (action) {
      case 'squash':
        return { bg: '#2a3a55', color: '#cfe0ff' };
      case 'reword':
        return { bg: '#2e2717', color: '#f0cf8e' };
      case 'fixup':
        return { bg: '#2a3a55', color: '#cfe0ff' };
      case 'drop':
        return { bg: '#3a2022', color: '#f0a6a2' };
      case 'edit':
        return { bg: '#23303d', color: '#9cc3ff' };
      default:
        return { bg: '#23252b', color: '#d8d9dc' };
    }
  }
</script>

<svelte:window onkeydown={handleKeyDown} />

<div
  class="rebase-dialog-backdrop"
  onclick={onClose}
  role="presentation"
>
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div
    class="rebase-dialog"
    onclick={(e) => e.stopPropagation()}
    role="dialog"
    aria-label="Interactive rebase"
    tabindex="-1"
  >
    <!-- Header -->
    <div class="dialog-header">
      <span class="dialog-title">Interactively rebase from</span>
      <span class="mono base-sha">{baseSha.slice(0, 7)}</span>
      <button class="close-btn" onclick={onClose} aria-label="Close">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <path d="M6 6l12 12M18 6L6 18"></path>
        </svg>
      </button>
    </div>

    {#if error}
      <div class="dialog-error">
        {error}
      </div>
    {/if}

    <!-- Dialog Body -->
    <div class="dialog-body">
      <!-- Left List & Actions -->
      <div class="list-section">
        <!-- Action Toolbar -->
        <div class="action-toolbar">
          <button
            class="tb"
            class:active={currentItem?.action === 'pick'}
            onclick={() => handleActionClick('pick')}
            title="Pick commit (p)"
          >
            Pick
          </button>
          <button
            class="tb"
            class:active={currentItem?.action === 'edit'}
            onclick={() => handleActionClick('edit')}
            title="Edit commit (e)"
          >
            Edit
          </button>
          <button
            class="tb"
            class:active={currentItem?.action === 'reword'}
            onclick={() => handleActionClick('reword')}
            title="Reword commit message (r)"
          >
            Reword
          </button>
          <button
            class="tb squash"
            class:active={currentItem?.action === 'squash'}
            onclick={() => handleActionClick('squash')}
            title="Squash into previous commit (s)"
          >
            Squash
          </button>
          <button
            class="tb"
            class:active={currentItem?.action === 'fixup'}
            onclick={() => handleActionClick('fixup')}
            title="Fixup into previous without keeping message (f)"
          >
            Fixup
          </button>
          <button
            class="tb drop"
            class:active={currentItem?.action === 'drop'}
            onclick={() => handleActionClick('drop')}
            title="Drop commit (d)"
          >
            Drop
          </button>

          <div class="toolbar-spacer"></div>

          <button
            class="tb arrow"
            onclick={handleMoveUp}
            disabled={selectedIdx <= 0}
            title="Move commit up (↑)"
            aria-label="Move up"
          >
            ↑
          </button>
          <button
            class="tb arrow"
            onclick={handleMoveDown}
            disabled={selectedIdx >= items.length - 1}
            title="Move commit down (↓)"
            aria-label="Move down"
          >
            ↓
          </button>
        </div>

        <!-- Commit List Table -->
        <div class="commits-list-container">
          {#if loading && items.length === 0}
            <div class="empty-hint">Loading commits for rebase…</div>
          {:else if items.length === 0}
            <div class="empty-hint">No commits found in range</div>
          {:else}
            {#each items as item, idx}
              {@const badgeStyle = getActionBadgeStyle(item.action)}
              {@const isSelected = selectedIdx === idx}
              <div
                class="commit-row"
                class:selected={isSelected}
                class:squash-row={item.action === 'squash' || item.action === 'fixup'}
                draggable="true"
                ondragstart={(e) => onDragStart(idx, e)}
                ondragover={(e) => onDragOver(idx, e)}
                ondrop={(e) => onDrop(idx, e)}
                onclick={() => (selectedIdx = idx)}
                role="button"
                tabindex="0"
                onkeydown={(e) => e.key === 'Enter' && (selectedIdx = idx)}
              >
                <!-- Custom or native Select for Action -->
                <div class="act-wrapper" style="background: {badgeStyle.bg}; color: {badgeStyle.color};">
                  <select
                    class="act-select"
                    value={item.action}
                    onchange={(e) => handleRowActionChange(idx, e)}
                    onclick={(e) => e.stopPropagation()}
                  >
                    <option value="pick">pick</option>
                    <option value="reword">reword</option>
                    <option value="edit">edit</option>
                    <option value="squash">squash</option>
                    <option value="fixup">fixup</option>
                    <option value="drop">drop</option>
                  </select>
                  <span class="act-label">{item.action} ▾</span>
                </div>

                <span class="mono sha">{item.sha.slice(0, 7)}</span>

                <span class="subject" title={item.message || ''}>
                  {#if item.action === 'drop'}
                    <span style="text-decoration: line-through; opacity: 0.6;">{item.message?.split('\n')[0] || ''}</span>
                  {:else}
                    {item.message?.split('\n')[0] || ''}
                  {/if}
                </span>

                <span class="drag-handle" title="Drag to reorder">⋮⋮</span>
              </div>
            {/each}
          {/if}
        </div>

        <!-- Info note -->
        <div class="rebase-info-box">
          Hasil: {summary.total} commit jadi {summary.resulting}. Drag baris buat ubah urutan.
          {#if summary.squashCount > 0}
            ({summary.squashCount} commit di-squash)
          {/if}
          {#if summary.dropCount > 0}
            ({summary.dropCount} commit di-drop)
          {/if}
        </div>
      </div>

      <!-- Right Message Editor -->
      <div class="editor-section">
        <div class="editor-header">
          <label for="rebase-msg-input" class="editor-title">
            {#if currentItem?.action === 'squash'}
              SQUASHED COMMIT MESSAGE
            {:else if currentItem?.action === 'reword'}
              REWORD COMMIT MESSAGE
            {:else}
              COMMIT MESSAGE
            {/if}
          </label>
          <button
            class="agent-btn"
            disabled
            title="Tersedia di fase 5"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round">
              <path d="M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2z"></path>
            </svg>
            <span>Write with agent</span>
            <span class="phase-tag">Fase 5</span>
          </button>
        </div>

        <textarea
          id="rebase-msg-input"
          class="msg-textarea mono"
          value={currentItem?.message ?? ''}
          oninput={handleMessageChange}
          placeholder="Commit message…"
        ></textarea>

        <div class="editor-footer">
          <span class="counter">
            Subject {subjectLen}/50 · Conventional Commits
          </span>
        </div>
      </div>
    </div>

    <!-- Dialog Footer -->
    <div class="dialog-footer">
      <label class="backup-checkbox">
        <input type="checkbox" bind:checked={createBackup} />
        <span>Backup branch before rebase</span>
      </label>

      <div class="footer-spacer"></div>

      <button class="footer-btn cancel" onclick={onClose} disabled={loading}>
        Cancel
      </button>

      <button
        class="footer-btn start"
        onclick={handleStartRebasing}
        disabled={loading || !validation.valid}
      >
        {loading ? 'Rebasing…' : 'Start Rebasing'}
      </button>
    </div>
  </div>
</div>

<style>
  .rebase-dialog-backdrop {
    position: fixed;
    inset: 0;
    z-index: 999;
    background: rgba(0, 0, 0, 0.65);
    display: flex;
    align-items: center;
    justify-content: center;
    backdrop-filter: blur(2px);
  }

  .rebase-dialog {
    width: 960px;
    height: 620px;
    max-width: 95vw;
    max-height: 90vh;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    background: #1c1d22;
    color: #d8d9dc;
    font-family: 'Geist', system-ui, sans-serif;
    font-size: 13px;
    border: 1px solid #34363d;
    border-radius: 12px;
    overflow: hidden;
    box-shadow: 0 20px 50px rgba(0, 0, 0, 0.6);
  }

  .dialog-header {
    height: 52px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    padding: 0 20px;
    border-bottom: 1px solid #2a2c32;
  }

  .dialog-title {
    font-size: 15px;
    font-weight: 600;
  }

  .base-sha {
    color: #8b8f98;
    margin-left: 8px;
    font-size: 13px;
  }

  .close-btn {
    margin-left: auto;
    width: 30px;
    height: 30px;
    border-radius: 7px;
    display: grid;
    place-items: center;
    color: #8b8f98;
    cursor: pointer;
    background: transparent;
    border: none;
    transition: all 0.15s;
  }

  .close-btn:hover {
    color: #d8d9dc;
    background: #26282d;
  }

  .dialog-error {
    padding: 8px 20px;
    background: #331a1a;
    color: #f07a74;
    font-size: 12px;
    border-bottom: 1px solid #4a2222;
  }

  .dialog-body {
    flex-grow: 1;
    display: flex;
    min-height: 0;
  }

  .list-section {
    flex-grow: 1;
    display: flex;
    flex-direction: column;
    border-right: 1px solid #2a2c32;
    min-width: 0;
  }

  .action-toolbar {
    height: 44px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 14px;
    border-bottom: 1px solid #26282d;
  }

  .tb {
    height: 28px;
    padding: 0 10px;
    border-radius: 6px;
    border: 1px solid #2c2e34;
    color: #b9bcc3;
    font-size: 12px;
    cursor: pointer;
    background: transparent;
    transition: all 0.15s;
  }

  .tb:hover:not(:disabled) {
    background: #23252b;
    color: #ffffff;
    border-color: #3e4149;
  }

  .tb.active {
    background: #23252b;
    color: #ffffff;
    border-color: #4f535d;
    font-weight: 500;
  }

  .tb.squash.active {
    background: #2a3a55;
    color: #cfe0ff;
    border-color: #3a4f75;
  }

  .tb.drop {
    color: #f0a6a2;
  }

  .tb.drop.active {
    background: #3a2022;
    border-color: #552a2d;
    color: #f0a6a2;
  }

  .tb.arrow {
    width: 28px;
    padding: 0;
    display: grid;
    place-items: center;
  }

  .tb:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }

  .toolbar-spacer {
    flex-grow: 1;
  }

  .commits-list-container {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
  }

  .commit-row {
    display: flex;
    align-items: center;
    gap: 14px;
    height: 38px;
    padding: 0 14px;
    border-bottom: 1px solid #26282d;
    cursor: pointer;
    user-select: none;
    transition: background 0.1s;
  }

  .commit-row:hover {
    background: #1f2127;
  }

  .commit-row.selected {
    background: #242935;
  }

  .commit-row.squash-row.selected {
    background: #243552;
  }

  .act-wrapper {
    position: relative;
    width: 78px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 8px;
    border-radius: 5px;
    font-size: 12px;
    font-family: 'JetBrains Mono', monospace;
  }

  .act-select {
    position: absolute;
    inset: 0;
    opacity: 0;
    cursor: pointer;
    width: 100%;
    height: 100%;
  }

  .act-label {
    pointer-events: none;
    font-size: 11.5px;
  }

  .sha {
    font-size: 12px;
    color: #8b8f98;
    width: 56px;
    flex-shrink: 0;
  }

  .subject {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12.5px;
  }

  .drag-handle {
    color: #555861;
    cursor: grab;
    padding: 0 4px;
    font-size: 14px;
  }

  .rebase-info-box {
    margin: 14px;
    padding: 12px;
    border-radius: 9px;
    background: #17181c;
    border: 1px solid #2a2c32;
    font-size: 12px;
    line-height: 19px;
    color: #9a9ea6;
  }

  .editor-section {
    width: 360px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    padding: 14px;
    gap: 10px;
    background: #17181c;
  }

  .editor-header {
    display: flex;
    align-items: center;
  }

  .editor-title {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.8px;
    color: #8b8f98;
  }

  .agent-btn {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 6px;
    color: #8b8f98;
    font-size: 12px;
    background: transparent;
    border: none;
    opacity: 0.5;
    cursor: not-allowed;
  }

  .phase-tag {
    font-size: 10px;
    padding: 1px 5px;
    border-radius: 4px;
    background: #252830;
    color: #e8b45a;
    border: 1px solid #3c3e47;
  }

  .msg-textarea {
    flex-grow: 1;
    resize: none;
    background: #141518;
    border: 1px solid #3a4f75;
    border-radius: 8px;
    padding: 12px;
    color: #d8d9dc;
    font-size: 12px;
    line-height: 19px;
    outline: none;
    transition: border-color 0.15s;
  }

  .msg-textarea:focus {
    border-color: #3a4f75;
  }

  .editor-footer {
    display: flex;
    justify-content: flex-end;
  }

  .counter {
    font-size: 12px;
    color: #8b8f98;
  }

  .dialog-footer {
    height: 60px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 20px;
    border-top: 1px solid #2a2c32;
    background: #18191d;
  }

  .backup-checkbox {
    display: flex;
    align-items: center;
    gap: 8px;
    color: #b9bcc3;
    font-size: 13px;
    cursor: pointer;
    user-select: none;
  }

  .backup-checkbox input {
    accent-color: #6ea8ff;
  }

  .footer-spacer {
    flex-grow: 1;
  }

  .footer-btn {
    height: 34px;
    padding: 0 16px;
    border-radius: 8px;
    font-size: 13px;
    cursor: pointer;
    transition: all 0.15s;
    border: none;
  }

  .footer-btn.cancel {
    color: #b9bcc3;
    border: 1px solid #2c2e34;
    background: transparent;
  }

  .footer-btn.cancel:hover {
    background: #23252b;
    color: #ffffff;
  }

  .footer-btn.start {
    background: #6ea8ff;
    color: #0e1a2e;
    font-weight: 600;
  }

  .footer-btn.start:hover:not(:disabled) {
    background: #85b7ff;
  }

  .footer-btn.start:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .empty-hint {
    padding: 24px;
    text-align: center;
    color: #8b8f98;
    font-size: 13px;
  }

  .mono {
    font-family: 'JetBrains Mono', monospace;
  }
</style>
