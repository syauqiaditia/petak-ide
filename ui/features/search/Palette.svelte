<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { api, type FileMatch } from '../../lib/api';
  import type { SearchMode } from './keymap';

  let {
    mode = 'files',
    folderPath = '',
    onClose,
    onOpenFile,
  } = $props<{
    mode?: SearchMode;
    folderPath?: string;
    onClose: () => void;
    onOpenFile: (path: string) => void;
  }>();

  let inputEl: HTMLInputElement;
  let query = $state('');
  let results = $state<FileMatch[]>([]);
  let selectedIndex = $state(0);
  let isSearching = $state(false);

  let searchTimer: ReturnType<typeof setTimeout> | null = null;

  async function performSearch(q: string) {
    if (!q.trim()) {
      results = [];
      selectedIndex = 0;
      return;
    }
    isSearching = true;
    try {
      const hits = await api.findFiles(q.trim(), 50);
      results = hits;
      selectedIndex = 0;
    } catch (e) {
      console.warn('findFiles error:', e);
      results = [];
    } finally {
      isSearching = false;
    }
  }

  $effect(() => {
    const q = query;
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      performSearch(q);
    }, 60);
  });

  function splitByIndices(text: string, indices: number[]): { text: string; match: boolean }[] {
    if (!indices || indices.length === 0) {
      return [{ text, match: false }];
    }
    const matchSet = new Set(indices);
    const chunks: { text: string; match: boolean }[] = [];
    let currentText = '';
    let currentMatch = matchSet.has(0);

    for (let i = 0; i < text.length; i++) {
      const isMatch = matchSet.has(i);
      if (isMatch === currentMatch) {
        currentText += text[i];
      } else {
        if (currentText.length > 0) {
          chunks.push({ text: currentText, match: currentMatch });
        }
        currentText = text[i];
        currentMatch = isMatch;
      }
    }
    if (currentText.length > 0) {
      chunks.push({ text: currentText, match: currentMatch });
    }
    return chunks;
  }

  function handleSelect(item: FileMatch) {
    const fullPath = folderPath && !item.path.startsWith('/')
      ? `${folderPath}/${item.path}`
      : item.path;
    onOpenFile(fullPath);
    onClose();
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (results.length > 0) {
        selectedIndex = (selectedIndex + 1) % results.length;
        scrollSelectedIntoView();
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (results.length > 0) {
        selectedIndex = (selectedIndex - 1 + results.length) % results.length;
        scrollSelectedIntoView();
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (results.length > 0 && selectedIndex >= 0 && selectedIndex < results.length) {
        handleSelect(results[selectedIndex]);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  }

  function scrollSelectedIntoView() {
    tick().then(() => {
      const el = document.querySelector('.palette-item.selected');
      if (el) {
        el.scrollIntoView({ block: 'nearest' });
      }
    });
  }

  onMount(() => {
    inputEl?.focus();
  });
</script>

<!-- Backdrop overlay -->
<div class="palette-backdrop" onclick={onClose} role="presentation"></div>

<!-- Palette dialog -->
<div class="palette-dialog" role="dialog" aria-modal="true" aria-label="Search Palette">
  <div class="palette-header">
    <div class="palette-tab active">Files <span>⌘P</span></div>
  </div>

  <div class="palette-input-wrap">
    <svg class="search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <circle cx="11" cy="11" r="8"></circle>
      <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
    </svg>
    <input
      bind:this={inputEl}
      bind:value={query}
      onkeydown={handleKeyDown}
      type="text"
      class="palette-input"
      placeholder="Search files by name..."
      autocomplete="off"
      spellcheck="false"
    />
  </div>

  <div class="palette-list">
    {#if results.length === 0}
      <div class="empty-state">
        {#if isSearching}
          Searching...
        {:else if query.trim()}
          No files found matching "{query}"
        {:else}
          Type to search files
        {/if}
      </div>
    {:else}
      {#each results as item, index}
        {@const isSelected = index === selectedIndex}
        <div
          class="palette-item"
          class:selected={isSelected}
          onclick={() => handleSelect(item)}
          onkeydown={(e) => { if (e.key === 'Enter') handleSelect(item); }}
          onmouseenter={() => (selectedIndex = index)}
          role="option"
          tabindex="-1"
          aria-selected={isSelected}
        >
          <div class="item-path">
            {#each splitByIndices(item.path, item.indices) as chunk}
              {#if chunk.match}
                <span class="match-highlight">{chunk.text}</span>
              {:else}
                <span>{chunk.text}</span>
              {/if}
            {/each}
          </div>
        </div>
      {/each}
    {/if}
  </div>
</div>

<style>
  .palette-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.45);
    z-index: 1000;
  }

  .palette-dialog {
    position: fixed;
    left: 50%;
    transform: translateX(-50%);
    top: 80px;
    width: 600px;
    max-height: 480px;
    background: #1a1b1f;
    border: 1px solid #2c2e34;
    border-radius: 10px;
    box-shadow: 0 16px 40px rgba(0, 0, 0, 0.6);
    display: flex;
    flex-direction: column;
    z-index: 1001;
    overflow: hidden;
    font-family: 'JetBrains Mono', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, monospace;
  }

  .palette-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px 0 12px;
    background: #141518;
    border-bottom: 1px solid #24262b;
  }

  .palette-tab {
    font-size: 11px;
    color: #8b8f98;
    padding: 4px 8px;
    border-radius: 4px 4px 0 0;
    display: flex;
    align-items: center;
    gap: 6px;
    cursor: default;
  }

  .palette-tab.active {
    color: #cfe0ff;
    background: #1a1b1f;
    border: 1px solid #2c2e34;
    border-bottom: none;
    font-weight: 500;
  }

  .palette-tab span {
    font-size: 10px;
    color: #5b5f68;
  }

  .palette-input-wrap {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 14px;
    border-bottom: 1px solid #24262b;
    background: #1a1b1f;
  }

  .search-icon {
    color: #8b8f98;
    flex-shrink: 0;
  }

  .palette-input {
    flex: 1;
    background: transparent;
    border: none;
    outline: none;
    color: #ffffff;
    font-size: 13px;
    font-family: inherit;
  }

  .palette-input::placeholder {
    color: #5b5f68;
  }

  .palette-list {
    max-height: 380px;
    overflow-y: auto;
    padding: 4px 0;
  }

  .empty-state {
    padding: 24px;
    text-align: center;
    color: #5b5f68;
    font-size: 12px;
  }

  .palette-item {
    height: 30px;
    display: flex;
    align-items: center;
    padding: 0 14px;
    cursor: pointer;
    font-size: 12.5px;
    color: #bcbec4;
  }

  .palette-item.selected {
    background: #1f2a3d;
    color: #ffffff;
  }

  .item-path {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    width: 100%;
  }

  .match-highlight {
    color: #6ea8ff;
    font-weight: 600;
  }
</style>
