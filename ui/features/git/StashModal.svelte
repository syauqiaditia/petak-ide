<script lang="ts">
  import { onMount } from 'svelte';
  import { api, type GitStashEntry } from '../../lib/api';
  import { gitStore } from './git.svelte.ts';

  let {
    root = '',
    initialMode = 'push',
    onclose = () => {},
  }: {
    root: string;
    initialMode?: 'push' | 'list';
    onclose: () => void;
  } = $props();

  let mode = $state<'push' | 'list'>(initialMode);
  let stashMessage = $state('');
  let includeUntracked = $state(false);
  let stashes = $state<GitStashEntry[]>([]);
  let loading = $state(false);
  let actionFeedback = $state<string | null>(null);

  async function loadStashes() {
    if (!root) return;
    loading = true;
    try {
      stashes = await api.gitStashList(root);
    } catch (e: any) {
      stashes = [];
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    loadStashes();
  });

  async function handlePush() {
    if (!root) return;
    loading = true;
    try {
      const msg = stashMessage.trim() || undefined;
      const res = await api.gitStashPush(root, msg, includeUntracked);
      gitStore.showToast(res || 'Changes stashed successfully', { type: 'success' });
      await gitStore.refresh();
      onclose();
    } catch (e: any) {
      actionFeedback = `Failed to stash: ${e?.message || e}`;
    } finally {
      loading = false;
    }
  }

  async function handleApply(index: number) {
    if (!root) return;
    loading = true;
    try {
      const res = await api.gitStashApply(root, index);
      gitStore.showToast(res || `Applied stash@{${index}}`, { type: 'success' });
      await gitStore.refresh();
      await loadStashes();
    } catch (e: any) {
      actionFeedback = `Failed to apply: ${e?.message || e}`;
    } finally {
      loading = false;
    }
  }

  async function handlePop(index?: number) {
    if (!root) return;
    loading = true;
    try {
      const res = await api.gitStashPop(root, index ?? 0);
      gitStore.showToast(res || `Popped stash@{${index ?? 0}}`, { type: 'success' });
      await gitStore.refresh();
      await loadStashes();
      if (stashes.length === 0) onclose();
    } catch (e: any) {
      actionFeedback = `Failed to pop: ${e?.message || e}`;
    } finally {
      loading = false;
    }
  }

  async function handleDrop(index: number) {
    if (!root) return;
    if (!window.confirm(`Drop stash@{${index}}? This action cannot be undone.`)) return;
    loading = true;
    try {
      const res = await api.gitStashDrop(root, index);
      gitStore.showToast(res || `Dropped stash@{${index}}`, { type: 'normal' });
      await loadStashes();
    } catch (e: any) {
      actionFeedback = `Failed to drop: ${e?.message || e}`;
    } finally {
      loading = false;
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      onclose();
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="stash-modal-backdrop" onclick={onclose} role="presentation">
  <div class="stash-modal" onclick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" tabindex="-1">
    <!-- Header -->
    <div class="modal-header">
      <div class="tab-buttons">
        <button
          class="tab-btn"
          class:active={mode === 'push'}
          onclick={() => (mode = 'push')}
        >
          Stash Changes
        </button>
        <button
          class="tab-btn"
          class:active={mode === 'list'}
          onclick={() => {
            mode = 'list';
            loadStashes();
          }}
        >
          Unstash Changes {stashes.length > 0 ? `(${stashes.length})` : ''}
        </button>
      </div>

      <button class="close-btn" onclick={onclose} title="Close (Esc)">✕</button>
    </div>

    <!-- Body -->
    <div class="modal-body">
      {#if actionFeedback}
        <div class="feedback-banner error">{actionFeedback}</div>
      {/if}

      {#if mode === 'push'}
        <div class="push-form">
          <label class="field-label" for="stash-msg-input">Stash Message (Optional)</label>
          <input
            id="stash-msg-input"
            type="text"
            class="text-input"
            placeholder="e.g. WIP before pulling main branch..."
            bind:value={stashMessage}
            onkeydown={(e) => {
              if (e.key === 'Enter') handlePush();
            }}
          />

          <label class="checkbox-label">
            <input type="checkbox" bind:checked={includeUntracked} />
            <span>Include untracked files (-u)</span>
          </label>

          <div class="modal-actions">
            <button class="btn-cancel" onclick={onclose}>Cancel</button>
            <button class="btn-primary" onclick={handlePush} disabled={loading}>
              {loading ? 'Stashing…' : 'Stash Changes'}
            </button>
          </div>
        </div>
      {:else}
        <!-- List Mode -->
        <div class="list-container">
          {#if loading && stashes.length === 0}
            <div class="empty-state">Loading stashes…</div>
          {:else if stashes.length === 0}
            <div class="empty-state">No stashes found in this repository.</div>
          {:else}
            {#each stashes as stash (stash.index)}
              <div class="stash-card">
                <div class="stash-info">
                  <div class="stash-top">
                    <span class="stash-idx">stash@&#123;{stash.index}&#125;</span>
                    {#if stash.branch}
                      <span class="stash-branch">[{stash.branch}]</span>
                    {/if}
                    <span class="stash-date">{stash.date}</span>
                  </div>
                  <div class="stash-msg">{stash.message || '(no message)'}</div>
                </div>

                <div class="stash-actions">
                  <button class="btn-sm pop" onclick={() => handlePop(stash.index)} title="Unstash and remove from list (Pop)">
                    Unstash (Pop)
                  </button>
                  <button class="btn-sm" onclick={() => handleApply(stash.index)} title="Apply stash changes and keep in stash list">
                    Apply (Keep)
                  </button>
                  <button class="btn-sm drop" onclick={() => handleDrop(stash.index)} title="Delete this stash">
                    Drop
                  </button>
                </div>
              </div>
            {/each}
          {/if}
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  .stash-modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    display: grid;
    place-items: center;
    z-index: 1000;
  }
  .stash-modal {
    width: 520px;
    max-height: 480px;
    background: #18191c;
    border: 1px solid #2a2d34;
    border-radius: 10px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    box-shadow: 0 16px 40px rgba(0, 0, 0, 0.6);
  }
  .modal-header {
    height: 44px;
    padding: 0 14px;
    border-bottom: 1px solid #24262d;
    background: #1b1c20;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .tab-buttons {
    display: flex;
    gap: 8px;
  }
  .tab-btn {
    background: transparent;
    border: none;
    color: #8b8f98;
    font-size: 12px;
    font-weight: 600;
    padding: 6px 10px;
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.15s;
  }
  .tab-btn:hover {
    color: #ffffff;
    background: #23252d;
  }
  .tab-btn.active {
    color: #ffffff;
    background: #2a2d37;
  }
  .close-btn {
    background: transparent;
    border: none;
    color: #8b8f98;
    font-size: 14px;
    cursor: pointer;
    padding: 4px 8px;
    border-radius: 4px;
  }
  .close-btn:hover {
    color: #ffffff;
    background: #24262e;
  }
  .modal-body {
    padding: 16px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .field-label {
    font-size: 11px;
    font-weight: 600;
    color: #8b8f98;
    margin-bottom: 4px;
    display: block;
  }
  .text-input {
    width: 100%;
    background: #121316;
    border: 1px solid #282a32;
    border-radius: 6px;
    padding: 8px 10px;
    font-size: 12px;
    color: #ffffff;
    outline: none;
    box-sizing: border-box;
  }
  .text-input:focus {
    border-color: #569aff;
  }
  .checkbox-label {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    color: #c0c2ca;
    cursor: pointer;
    margin-top: 8px;
    user-select: none;
  }
  .checkbox-label input {
    accent-color: #4a7acc;
  }
  .modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    margin-top: 14px;
  }
  .btn-cancel {
    background: #202228;
    border: 1px solid #2c2f38;
    color: #a0a3ad;
    padding: 6px 14px;
    border-radius: 6px;
    font-size: 12px;
    cursor: pointer;
  }
  .btn-cancel:hover {
    background: #272a33;
    color: #ffffff;
  }
  .btn-primary {
    background: #2e518d;
    border: 1px solid #4373c2;
    color: #ffffff;
    padding: 6px 16px;
    border-radius: 6px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
  }
  .btn-primary:hover:not(:disabled) {
    background: #3660a8;
  }
  .btn-primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .feedback-banner.error {
    background: #2c1a1b;
    border: 1px solid #4d2326;
    color: #f0837f;
    padding: 8px 12px;
    border-radius: 6px;
    font-size: 12px;
  }
  .list-container {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .empty-state {
    text-align: center;
    padding: 30px 16px;
    font-size: 12px;
    color: #656974;
  }
  .stash-card {
    background: #1c1d22;
    border: 1px solid #262830;
    border-radius: 8px;
    padding: 10px 12px;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .stash-info {
    display: flex;
    flex-direction: column;
    gap: 4px;
    overflow: hidden;
  }
  .stash-top {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
  }
  .stash-idx {
    font-weight: 700;
    color: #72a5ff;
    font-family: monospace;
  }
  .stash-branch {
    color: #8b8f98;
  }
  .stash-date {
    color: #585c67;
  }
  .stash-msg {
    font-size: 12px;
    color: #e0e2e8;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .stash-actions {
    display: flex;
    gap: 6px;
    margin-left: 12px;
  }
  .btn-sm {
    background: #242730;
    border: 1px solid #323644;
    color: #c0c3ce;
    font-size: 11px;
    padding: 3px 8px;
    border-radius: 4px;
    cursor: pointer;
  }
  .btn-sm:hover {
    background: #2e3240;
    color: #ffffff;
  }
  .btn-sm.pop {
    color: #7fc98f;
    border-color: #2b4533;
  }
  .btn-sm.drop {
    color: #f07a74;
    border-color: #4c2628;
  }
</style>
