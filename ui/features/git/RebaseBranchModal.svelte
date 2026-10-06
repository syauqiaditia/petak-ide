<script lang="ts">
  import { onMount } from 'svelte';
  import { gitStore } from './git.svelte';

  let {
    onClose = () => {},
  } = $props<{
    onClose?: () => void;
  }>();

  let searchQuery = $state('');
  let selectedBranch = $state('');
  let isRebasing = $state(false);

  let currentBranch = $derived(gitStore.currentBranch || 'HEAD');

  let allBranches = $derived.by(() => {
    const list: { name: string; isRemote: boolean; isCurrent: boolean }[] = [];
    if (gitStore.branches?.local) {
      for (const b of gitStore.branches.local) {
        list.push({
          name: b.name,
          isRemote: false,
          isCurrent: b.isCurrent || b.name === currentBranch,
        });
      }
    }
    if (gitStore.branches?.remote) {
      for (const r of gitStore.branches.remote) {
        list.push({
          name: r.name,
          isRemote: true,
          isCurrent: false,
        });
      }
    }
    return list;
  });

  let filteredBranches = $derived.by(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) {
      return allBranches.filter((b) => !b.isCurrent);
    }
    return allBranches.filter((b) => !b.isCurrent && b.name.toLowerCase().includes(q));
  });

  onMount(async () => {
    if (!gitStore.branches) {
      await gitStore.loadBranches();
    }
    const def =
      filteredBranches.find(
        (b) =>
          b.name === 'main' ||
          b.name === 'master' ||
          b.name === 'origin/main' ||
          b.name.includes('dev')
      ) || filteredBranches[0];
    if (def) {
      selectedBranch = def.name;
    }
  });

  async function handleRebase() {
    if (!selectedBranch || isRebasing) return;
    isRebasing = true;
    try {
      await gitStore.rebaseOnto(selectedBranch);
    } catch {
      // Toast error handled inside gitStore
    } finally {
      isRebasing = false;
      onClose();
    }
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      onClose();
    } else if (e.key === 'Enter' && selectedBranch && !isRebasing) {
      handleRebase();
    }
  }
</script>

<svelte:window onkeydown={handleKeyDown} />

<div class="modal-backdrop" onclick={onClose} role="presentation">
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div
    class="rebase-modal-window"
    onclick={(e) => e.stopPropagation()}
    role="dialog"
    aria-modal="true"
    tabindex="-1"
  >
    <!-- Header -->
    <div class="modal-header">
      <div class="header-title-wrap">
        <span class="git-icon">⎇</span>
        <h3>Rebase Branch</h3>
      </div>
      <button class="btn-close" onclick={onClose} title="Tutup">✕</button>
    </div>

    <!-- Body -->
    <div class="modal-body">
      <!-- Current branch indicator -->
      <div class="current-branch-banner">
        <span class="banner-label">Rebase current branch:</span>
        <span class="branch-tag current">{currentBranch}</span>
        <span class="onto-label">onto:</span>
      </div>

      <!-- Searchable branch picker -->
      <div class="branch-picker-box">
        <div class="search-row">
          <svg class="search-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="6"></circle>
            <path d="M20 20l-4.5-4.5"></path>
          </svg>
          <input
            type="text"
            class="branch-search-input"
            placeholder="Cari branch (misal: main, origin/main, dev)…"
            bind:value={searchQuery}
            autofocus
          />
        </div>

        <div class="branch-list-scroll">
          {#if filteredBranches.length === 0}
            <div class="empty-hint">Tidak ada branch yang cocok</div>
          {:else}
            {#each filteredBranches as b}
              {@const isSelected = b.name === selectedBranch}
              <div
                class="branch-row"
                class:selected={isSelected}
                onclick={() => (selectedBranch = b.name)}
                ondblclick={handleRebase}
                role="button"
                tabindex="0"
                onkeydown={(e) => e.key === 'Enter' && (selectedBranch = b.name)}
              >
                <span class="branch-type-badge" class:remote={b.isRemote}>
                  {b.isRemote ? 'remote' : 'local'}
                </span>
                <span class="branch-name-text" title={b.name}>{b.name}</span>
                {#if isSelected}
                  <span class="selected-check">✓</span>
                {/if}
              </div>
            {/each}
          {/if}
        </div>
      </div>
    </div>

    <!-- Footer -->
    <div class="modal-footer">
      <button class="btn-secondary" onclick={onClose} disabled={isRebasing}>
        Batal
      </button>
      <button
        class="btn-primary"
        onclick={handleRebase}
        disabled={!selectedBranch || isRebasing}
      >
        {#if isRebasing}
          <span class="spinner">↻</span>
          <span>Rebasing…</span>
        {:else}
          <span>Rebase</span>
        {/if}
      </button>
    </div>
  </div>
</div>

<style>
  .modal-backdrop {
    position: fixed;
    inset: 0;
    z-index: 99990;
    background: rgba(10, 11, 15, 0.65);
    backdrop-filter: blur(4px);
    -webkit-backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    user-select: none;
    -webkit-user-select: none;
    animation: fadeIn 0.15s ease-out;
  }

  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  .rebase-modal-window {
    width: 480px;
    max-width: calc(100vw - 32px);
    background: #181a1f;
    border: 1px solid #282c35;
    border-radius: 10px;
    box-shadow: 0 16px 40px rgba(0, 0, 0, 0.55);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .modal-header {
    height: 42px;
    padding: 0 16px;
    background: #141518;
    border-bottom: 1px solid #232730;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .header-title-wrap {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .git-icon {
    font-size: 15px;
    color: #60a5fa;
  }

  .modal-header h3 {
    margin: 0;
    font-size: 13px;
    font-weight: 600;
    color: #f1f5f9;
  }

  .btn-close {
    background: none;
    border: none;
    color: #8b8f98;
    cursor: pointer;
    font-size: 14px;
    padding: 4px;
  }

  .btn-close:hover {
    color: #ffffff;
  }

  .modal-body {
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .current-branch-banner {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    color: #94a3b8;
  }

  .branch-tag.current {
    font-family: 'JetBrains Mono', monospace;
    font-weight: 700;
    color: #60a5fa;
    background: #1e293b;
    border: 1px solid #2563eb;
    padding: 2px 7px;
    border-radius: 4px;
    max-width: 220px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .onto-label {
    font-weight: 600;
    color: #cbd5e1;
  }

  .branch-picker-box {
    border: 1px solid #262a33;
    border-radius: 6px;
    background: #111215;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .search-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    border-bottom: 1px solid #20242c;
    background: #14161a;
  }

  .search-icon {
    color: #64748b;
    flex-shrink: 0;
  }

  .branch-search-input {
    flex: 1;
    background: none;
    border: none;
    outline: none;
    color: #e2e8f0;
    font-size: 12px;
  }

  .branch-search-input::placeholder {
    color: #64748b;
  }

  .branch-list-scroll {
    max-height: 220px;
    overflow-y: auto;
    padding: 4px;
  }

  .empty-hint {
    padding: 24px;
    text-align: center;
    color: #64748b;
    font-size: 11.5px;
  }

  .branch-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
    transition: background 0.1s ease;
  }

  .branch-row:hover {
    background: #1b1e26;
  }

  .branch-row.selected {
    background: #1e293b;
    color: #ffffff;
  }

  .branch-type-badge {
    font-size: 9.5px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    padding: 1px 5px;
    border-radius: 3px;
    background: #1e2638;
    color: #60a5fa;
  }

  .branch-type-badge.remote {
    background: #2b2416;
    color: #fbbf24;
  }

  .branch-name-text {
    flex: 1;
    font-family: 'JetBrains Mono', monospace;
    font-size: 11.5px;
    color: #cbd5e1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .branch-row.selected .branch-name-text {
    color: #ffffff;
    font-weight: 500;
  }

  .selected-check {
    color: #38bdf8;
    font-weight: 700;
    font-size: 12px;
  }

  .modal-footer {
    height: 48px;
    padding: 0 16px;
    background: #141518;
    border-top: 1px solid #232730;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
  }

  .btn-secondary {
    background: #23262d;
    border: 1px solid #323640;
    color: #cbd5e1;
    border-radius: 6px;
    padding: 6px 14px;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .btn-secondary:hover:not(:disabled) {
    background: #2d313a;
    color: #ffffff;
  }

  .btn-primary {
    background: #2563eb;
    border: 1px solid #3b82f6;
    color: #ffffff;
    border-radius: 6px;
    padding: 6px 18px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    transition: all 0.15s ease;
  }

  .btn-primary:hover:not(:disabled) {
    background: #1d4ed8;
  }

  .btn-primary:disabled,
  .btn-secondary:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .spinner {
    display: inline-block;
    animation: spin 1s infinite linear;
    font-size: 13px;
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
</style>
