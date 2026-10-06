<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '../lib/api';
  import { gitStore } from '../features/git/git.svelte';

  let {
    srcPaths = [],
    initialDestDir = '',
    onClose = () => {},
    onSuccess = (_copied: string[]) => {},
  } = $props<{
    srcPaths: string[];
    initialDestDir: string;
    onClose?: () => void;
    onSuccess?: (copied: string[]) => void;
  }>();

  let destDir = $state(initialDestDir);
  let isSingle = $derived(srcPaths.length === 1);
  let defaultName = $derived(srcPaths[0]?.split('/').pop() || '');
  let newName = $state('');
  let isCopying = $state(false);
  let inputNameEl: HTMLInputElement | null = null;

  onMount(() => {
    newName = defaultName;
    setTimeout(() => {
      inputNameEl?.focus();
      inputNameEl?.select();
    }, 50);
  });

  async function handleConfirm() {
    if (isCopying || !destDir.trim()) return;
    isCopying = true;
    try {
      const finalName = isSingle ? newName.trim() || undefined : undefined;
      const copied = await api.fsCopyExternal(srcPaths, destDir.trim(), finalName);
      gitStore.showToast(
        isSingle
          ? `File ${finalName || defaultName} berhasil disalin`
          : `${copied.length} berkas berhasil disalin`,
        { type: 'success' }
      );
      onSuccess(copied);
      onClose();
    } catch (e: any) {
      gitStore.showToast(`Gagal menyalin file: ${e?.message || e}`, { type: 'error' });
    } finally {
      isCopying = false;
    }
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      handleConfirm();
    }
  }
</script>

<svelte:window onkeydown={handleKeyDown} />

<div class="copy-modal-backdrop" onclick={onClose} role="presentation">
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
    class="copy-modal-dialog"
    onclick={(e) => e.stopPropagation()}
    role="dialog"
    aria-modal="true"
    tabindex="-1"
  >
    <!-- Header -->
    <div class="dialog-header">
      <span class="dialog-title">Copy</span>
      <button class="close-x-btn" onclick={onClose}>✕</button>
    </div>

    <!-- Body -->
    <div class="dialog-body">
      <div class="target-summary">
        {#if isSingle}
          Copy file <strong>{defaultName}</strong>
        {:else}
          Copy <strong>{srcPaths.length}</strong> files
        {/if}
      </div>

      <div class="form-field">
        <label for="dest-dir-input">To directory:</label>
        <div class="input-wrap">
          <input
            id="dest-dir-input"
            type="text"
            class="ide-input mono"
            bind:value={destDir}
            placeholder="Folder tujuan..."
          />
        </div>
      </div>

      {#if isSingle}
        <div class="form-field">
          <label for="new-name-input">New name:</label>
          <div class="input-wrap">
            <input
              id="new-name-input"
              type="text"
              class="ide-input mono"
              bind:value={newName}
              bind:this={inputNameEl}
              placeholder="Nama file baru..."
            />
          </div>
        </div>
      {/if}
    </div>

    <!-- Actions Footer -->
    <div class="dialog-footer">
      <button class="btn-cancel" onclick={onClose} disabled={isCopying}>
        Cancel
      </button>
      <button class="btn-ok" onclick={handleConfirm} disabled={isCopying}>
        {#if isCopying}
          Copying…
        {:else}
          OK
        {/if}
      </button>
    </div>
  </div>
</div>

<style>
  .copy-modal-backdrop {
    position: fixed;
    inset: 0;
    z-index: 10000;
    background: rgba(0, 0, 0, 0.6);
    backdrop-filter: blur(3px);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .copy-modal-dialog {
    width: 580px;
    max-width: 92vw;
    background: #1e1f22;
    border: 1px solid #383a40;
    border-radius: 8px;
    box-shadow: 0 16px 40px rgba(0, 0, 0, 0.6);
    color: #bcbec4;
    font-size: 13px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .mono {
    font-family: 'JetBrains Mono', ui-monospace, Menlo, Monaco, monospace;
    font-size: 12px;
  }

  .dialog-header {
    height: 38px;
    background: #141518;
    border-bottom: 1px solid #2b2d30;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 14px;
    user-select: none;
  }

  .dialog-title {
    font-size: 13px;
    font-weight: 600;
    color: #e6e7eb;
  }

  .close-x-btn {
    background: transparent;
    border: none;
    color: #8b8f98;
    font-size: 13px;
    cursor: pointer;
    border-radius: 4px;
    width: 22px;
    height: 22px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .close-x-btn:hover {
    background: #2b2d30;
    color: #ffffff;
  }

  .dialog-body {
    padding: 16px 20px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .target-summary {
    font-size: 13px;
    color: #d1d5db;
  }

  .target-summary strong {
    color: #ffffff;
  }

  .form-field {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .form-field label {
    font-size: 12px;
    color: #9ca3af;
  }

  .input-wrap {
    width: 100%;
  }

  .ide-input {
    width: 100%;
    height: 30px;
    background: #2b2d30;
    border: 1px solid #3c3f41;
    border-radius: 4px;
    padding: 0 10px;
    color: #ffffff;
    outline: none;
    box-sizing: border-box;
    transition: border-color 0.15s;
  }

  .ide-input:focus {
    border-color: #3574f0;
  }

  .dialog-footer {
    height: 48px;
    background: #141518;
    border-top: 1px solid #2b2d30;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 10px;
    padding: 0 16px;
    user-select: none;
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

  .btn-cancel:hover:not(:disabled) {
    background: #2b2d30;
    color: #ffffff;
  }

  .btn-ok {
    height: 28px;
    padding: 0 20px;
    background: #3574f0;
    border: 1px solid #2563eb;
    border-radius: 4px;
    color: #ffffff;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
  }

  .btn-ok:hover:not(:disabled) {
    background: #2563eb;
  }

  .btn-ok:disabled,
  .btn-cancel:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
