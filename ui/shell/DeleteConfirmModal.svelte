<script lang="ts">
  let {
    paths = [],
    onclose,
    onconfirm,
  } = $props<{
    paths: string[];
    onclose: () => void;
    onconfirm: () => Promise<void> | void;
  }>();

  let isDeleting = $state(false);
  let errorMsg = $state<string | null>(null);

  const isMulti = $derived(paths.length > 1);
  const title = $derived(isMulti ? `Move ${paths.length} items to Trash?` : 'Move to Trash?');
  const previewPaths = $derived(paths.slice(0, 3));
  const remainingCount = $derived(Math.max(0, paths.length - 3));

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      onclose();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      submit();
    }
  }

  async function submit() {
    isDeleting = true;
    errorMsg = null;
    try {
      await onconfirm();
      onclose();
    } catch (e: any) {
      errorMsg = e?.message || String(e);
    } finally {
      isDeleting = false;
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="modal-backdrop" onclick={onclose} role="presentation">
  <div class="modal-box" onclick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" tabindex="-1">
    <div class="modal-header">
      <span class="modal-title">{title}</span>
      <button class="modal-close-btn" onclick={onclose} title="Close (Esc)">✕</button>
    </div>

    <div class="modal-body">
      <p class="modal-desc">
        Are you sure you want to move the following {isMulti ? `${paths.length} items` : 'item'} to the Trash?
      </p>

      <div class="file-preview-box">
        {#each previewPaths as p}
          <div class="preview-item">
            <span class="preview-icon">📄</span>
            <span class="preview-text">{p}</span>
          </div>
        {/each}
        {#if remainingCount > 0}
          <div class="preview-more">
            … and {remainingCount} more {remainingCount === 1 ? 'item' : 'items'}
          </div>
        {/if}
      </div>

      <div class="reassurance-text">
        ℹ Items can be restored from the Trash if needed.
      </div>

      {#if errorMsg}
        <div class="error-text">{errorMsg}</div>
      {/if}
    </div>

    <div class="modal-footer">
      <button class="btn btn-secondary" onclick={onclose} disabled={isDeleting}>Cancel</button>
      <button class="btn btn-danger" onclick={submit} disabled={isDeleting}>
        {isDeleting ? 'Moving to Trash…' : 'Move to Trash'}
      </button>
    </div>
  </div>
</div>

<style>
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.65);
    backdrop-filter: blur(2px);
    z-index: 1100;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .modal-box {
    width: 440px;
    background: #1c1d22;
    border: 1px solid #34363d;
    border-radius: 10px;
    box-shadow: 0 20px 50px rgba(0, 0, 0, 0.6);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    color: #d8d9dc;
    font-family: 'Geist', system-ui, -apple-system, sans-serif;
  }

  .modal-header {
    height: 46px;
    padding: 0 16px;
    display: flex;
    align-items: center;
    border-bottom: 1px solid #2a2c32;
    font-weight: 600;
    font-size: 13.5px;
  }

  .modal-title {
    color: #f0a6a2;
  }

  .modal-close-btn {
    margin-left: auto;
    color: #8b8f98;
    background: none;
    border: none;
    font-size: 14px;
    cursor: pointer;
    padding: 4px;
    line-height: 1;
    border-radius: 4px;
  }

  .modal-close-btn:hover {
    color: #d8d9dc;
    background: #26282d;
  }

  .modal-body {
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    font-size: 13px;
  }

  .modal-desc {
    color: #bcbec4;
    line-height: 1.4;
  }

  .file-preview-box {
    background: #141518;
    border: 1px solid #26282d;
    border-radius: 6px;
    padding: 8px 12px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    max-height: 120px;
    overflow-y: auto;
  }

  .preview-item {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    color: #b9bcc3;
    font-family: 'JetBrains Mono', monospace;
  }

  .preview-icon {
    font-size: 11px;
    opacity: 0.8;
  }

  .preview-text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .preview-more {
    font-size: 11.5px;
    color: #8b8f98;
    font-style: italic;
    padding-top: 2px;
  }

  .reassurance-text {
    font-size: 12px;
    color: #8b8f98;
  }

  .error-text {
    font-size: 11.5px;
    color: #f0a6a2;
  }

  .modal-footer {
    height: 50px;
    padding: 0 16px;
    background: #18191d;
    border-top: 1px solid #2a2c32;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
  }

  .btn {
    height: 32px;
    padding: 0 14px;
    border-radius: 6px;
    font-size: 12.5px;
    cursor: pointer;
    font-weight: 500;
    border: none;
    transition: background 0.15s;
  }

  .btn-secondary {
    background: #23252b;
    border: 1px solid #2c2e34;
    color: #b9bcc3;
  }

  .btn-secondary:hover:not(:disabled) {
    background: #2a2c32;
    color: #e6e7ea;
  }

  .btn-danger {
    background: #6d2424;
    color: #ffe6e6;
  }

  .btn-danger:hover:not(:disabled) {
    background: #7f2b2b;
  }

  .btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
</style>
