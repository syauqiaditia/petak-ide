<script lang="ts">
  import { onMount, tick } from 'svelte';

  export type ItemType = 'file' | 'folder' | 'dart' | 'kotlin' | 'swift';

  let {
    targetDir = '',
    initialType = 'file',
    onclose,
    oncreate,
  } = $props<{
    targetDir: string;
    initialType?: ItemType;
    onclose: () => void;
    oncreate: (relPath: string, type: ItemType) => Promise<void> | void;
  }>();

  let itemType = $state<ItemType>(initialType);
  let pathInput = $state('');
  let inputEl: HTMLInputElement;
  let isCreating = $state(false);
  let errorMsg = $state<string | null>(null);

  onMount(() => {
    tick().then(() => inputEl?.focus());
  });

  function handleTypeChange(newType: ItemType) {
    itemType = newType;
    if (pathInput.trim()) {
      // Auto-adjust extension if changing template
      const lastDot = pathInput.lastIndexOf('.');
      const base = lastDot > 0 ? pathInput.slice(0, lastDot) : pathInput;
      if (newType === 'dart') pathInput = base + '.dart';
      else if (newType === 'kotlin') pathInput = base + '.kt';
      else if (newType === 'swift') pathInput = base + '.swift';
      else if (newType === 'folder' && lastDot > 0) pathInput = base;
    }
  }

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
    let name = pathInput.trim();
    if (!name) {
      errorMsg = 'Please enter a name or path';
      return;
    }

    // Auto-append extension if specific template selected and missing
    if (itemType === 'dart' && !name.endsWith('.dart')) name += '.dart';
    if (itemType === 'kotlin' && !name.endsWith('.kt')) name += '.kt';
    if (itemType === 'swift' && !name.endsWith('.swift')) name += '.swift';

    const fullRel = targetDir ? `${targetDir.replace(/\/+$/, '')}/${name}` : name;

    isCreating = true;
    errorMsg = null;
    try {
      await oncreate(fullRel, itemType);
      onclose();
    } catch (e: any) {
      errorMsg = e?.message || String(e);
    } finally {
      isCreating = false;
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="modal-backdrop" onclick={onclose} role="presentation">
  <div class="modal-box" onclick={(e) => e.stopPropagation()} role="dialog">
    <div class="modal-header">
      <span class="modal-title">New {itemType === 'folder' ? 'Folder' : 'File'}</span>
      <button class="modal-close-btn" onclick={onclose} title="Close (Esc)">✕</button>
    </div>

    <div class="modal-body">
      <div class="type-selector">
        <button
          class="type-btn"
          class:active={itemType === 'file'}
          onclick={() => handleTypeChange('file')}
        >
          File
        </button>
        <button
          class="type-btn"
          class:active={itemType === 'folder'}
          onclick={() => handleTypeChange('folder')}
        >
          Folder
        </button>
        <button
          class="type-btn"
          class:active={itemType === 'dart'}
          onclick={() => handleTypeChange('dart')}
        >
          Dart
        </button>
        <button
          class="type-btn"
          class:active={itemType === 'kotlin'}
          onclick={() => handleTypeChange('kotlin')}
        >
          Kotlin
        </button>
        <button
          class="type-btn"
          class:active={itemType === 'swift'}
          onclick={() => handleTypeChange('swift')}
        >
          Swift
        </button>
      </div>

      <div class="field-wrap">
        <label class="field-label" for="new-item-path">
          Enter {itemType === 'folder' ? 'folder' : 'file'} path
          {#if targetDir}
            <span class="target-sub">in /{targetDir}</span>
          {/if}:
        </label>
        <input
          id="new-item-path"
          bind:this={inputEl}
          bind:value={pathInput}
          class="input-field"
          placeholder={itemType === 'folder' ? 'e.g. features/checkout' : 'e.g. features/auth/login.dart'}
          disabled={isCreating}
        />
        {#if pathInput.includes('/')}
          <div class="hint-text">
            Parent folders will be created automatically.
          </div>
        {/if}
        {#if errorMsg}
          <div class="error-text">{errorMsg}</div>
        {/if}
      </div>
    </div>

    <div class="modal-footer">
      <button class="btn btn-secondary" onclick={onclose} disabled={isCreating}>Cancel</button>
      <button class="btn btn-primary" onclick={submit} disabled={isCreating}>
        {isCreating ? 'Creating…' : 'Create'}
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
    color: #e6efff;
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
    gap: 14px;
    font-size: 13px;
  }

  .type-selector {
    display: flex;
    gap: 6px;
    background: #141518;
    padding: 3px;
    border-radius: 6px;
    border: 1px solid #26282d;
  }

  .type-btn {
    flex: 1;
    height: 24px;
    background: transparent;
    border: none;
    border-radius: 4px;
    color: #8b8f98;
    font-size: 11.5px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s;
  }

  .type-btn.active {
    background: #2a3a55;
    color: #e6efff;
  }

  .type-btn:hover:not(.active) {
    color: #d8d9dc;
  }

  .field-wrap {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .field-label {
    font-size: 12px;
    color: #8b8f98;
  }

  .target-sub {
    color: #6ea8ff;
    font-family: 'JetBrains Mono', monospace;
    font-size: 11px;
  }

  .input-field {
    width: 100%;
    height: 32px;
    background: #141518;
    border: 1px solid #2c2e34;
    border-radius: 6px;
    padding: 0 10px;
    color: #d8d9dc;
    font-size: 13px;
    outline: none;
    box-sizing: border-box;
    font-family: 'JetBrains Mono', monospace;
  }

  .input-field:focus {
    border-color: #6ea8ff;
  }

  .hint-text {
    font-size: 11px;
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

  .btn-primary {
    background: #2a4b8d;
    color: #e6efff;
  }

  .btn-primary:hover:not(:disabled) {
    background: #345ca8;
  }

  .btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
</style>
