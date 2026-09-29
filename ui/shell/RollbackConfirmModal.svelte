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

  let isRollingBack = $state(false);
  let errorMsg = $state<string | null>(null);

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
    isRollingBack = true;
    errorMsg = null;
    try {
      await onconfirm();
      onclose();
    } catch (e: any) {
      errorMsg = e?.message || String(e);
    } finally {
      isRollingBack = false;
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="modal-backdrop" onclick={onclose} role="presentation">
  <div class="modal-box" onclick={(e) => e.stopPropagation()} role="dialog">
    <div class="modal-header">
      <span class="modal-title">Rollback Changes?</span>
      <button class="modal-close-btn" onclick={onclose} title="Close (Esc)">✕</button>
    </div>

    <div class="modal-body">
      <p class="modal-desc">
        ⚠️ Discard all uncommitted changes in:
      </p>

      <div class="file-preview-box">
        {#each paths as p}
          <div class="preview-item">
            <span class="preview-icon">📄</span>
            <span class="preview-text">{p}</span>
          </div>
        {/each}
      </div>

      <p class="sub-desc">
        This operation will revert the file to HEAD.
      </p>

      <div class="reassurance-box">
        <span class="info-icon">ℹ</span>
        <span>A Local History snapshot will be created automatically before rollback so you can undo if necessary.</span>
      </div>

      {#if errorMsg}
        <div class="error-text">{errorMsg}</div>
      {/if}
    </div>

    <div class="modal-footer">
      <button class="btn btn-secondary" onclick={onclose} disabled={isRollingBack}>Cancel</button>
      <button class="btn btn-danger" onclick={submit} disabled={isRollingBack}>
        {isRollingBack ? 'Rolling back…' : 'Rollback'}
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
    width: 460px;
    background: #1c1d22;
    border: 1px solid #34363d;
    border-radius: 10px;
    box-shadow: 0 20px 50px rgba(0, 0, 0, 0.6);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    color: #d8d9dc;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
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
    color: #e6efff;
    font-weight: 500;
  }

  .sub-desc {
    color: #8b8f98;
    font-size: 12px;
  }

  .file-preview-box {
    background: #141518;
    border: 1px solid #26282d;
    border-radius: 6px;
    padding: 8px 12px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    max-height: 100px;
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

  .reassurance-box {
    display: flex;
    gap: 8px;
    background: #192233;
    border: 1px solid #263854;
    border-radius: 6px;
    padding: 8px 12px;
    font-size: 12px;
    color: #9cc3ff;
    line-height: 1.4;
  }

  .info-icon {
    font-weight: bold;
    color: #6ea8ff;
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
