<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { api, type FileMatch, type Hit } from '../../lib/api';
  import type { SearchMode, ActionItem } from './keymap';

  let {
    mode = 'files',
    folderPath = '',
    recentFiles = [],
    actions = [],
    initialQuery = '',
    onClose,
    onOpenFile,
  } = $props<{
    mode?: SearchMode;
    folderPath?: string;
    recentFiles?: string[];
    actions?: ActionItem[];
    initialQuery?: string;
    onClose: () => void;
    onOpenFile: (path: string, line?: number, col?: number) => void;
  }>();

  let inputEl: HTMLInputElement;
  let currentMode = $state<SearchMode>('files');
  let query = $state('');
  let selectedIndex = $state(0);
  let isSearching = $state(false);

  // Text search options
  let isRegex = $state(false);
  let caseSensitive = $state(false);

  let searchTimer: ReturnType<typeof setTimeout> | null = null;
  let fileResults = $state<FileMatch[]>([]);
  let textHits = $state<Hit[]>([]);

  // Sync mode prop to currentMode
  $effect(() => {
    currentMode = mode;
    selectedIndex = 0;
    query = initialQuery || '';
  });

  interface SearchItem {
    id: string;
    type: 'action' | 'file' | 'recent' | 'hit';
    title: string;
    subtitle?: string;
    shortcut?: string;
    indices?: number[];
    action?: ActionItem;
    fileMatch?: FileMatch;
    hit?: Hit;
    filePath?: string;
  }

  interface Section {
    name?: string;
    items: SearchItem[];
  }

  async function performFileSearch(q: string) {
    if (!q.trim()) {
      fileResults = [];
      return;
    }
    isSearching = true;
    try {
      const hits = await api.findFiles(q.trim(), 40);
      fileResults = hits;
    } catch (e) {
      console.warn('findFiles error:', e);
      fileResults = [];
    } finally {
      isSearching = false;
    }
  }

  async function performTextSearch(q: string, reg: boolean, cs: boolean) {
    if (!q.trim() || !folderPath) {
      textHits = [];
      return;
    }
    isSearching = true;
    try {
      const hits = await api.grep(folderPath, q.trim(), reg, cs, 100);
      textHits = hits;
    } catch (e) {
      console.warn('grep error:', e);
      textHits = [];
    } finally {
      isSearching = false;
    }
  }

  $effect(() => {
    const q = query;
    const m = currentMode;
    const reg = isRegex;
    const cs = caseSensitive;

    if (m === 'text') {
      if (searchTimer) clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        performTextSearch(q, reg, cs);
      }, 150);
    } else if (m === 'files' || m === 'everywhere') {
      if (searchTimer) clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        performFileSearch(q);
      }, 50);
    }
  });

  function groupHitsByPath(hits: Hit[]): { path: string; hits: Hit[] }[] {
    const groups: { path: string; hits: Hit[] }[] = [];
    const map = new Map<string, { path: string; hits: Hit[] }>();
    for (const h of hits) {
      let g = map.get(h.path);
      if (!g) {
        g = { path: h.path, hits: [] };
        map.set(h.path, g);
        groups.push(g);
      }
      g.hits.push(h);
    }
    return groups;
  }

  let sections = $derived.by<Section[]>(() => {
    const q = query.trim().toLowerCase();

    if (currentMode === 'files') {
      const items: SearchItem[] = fileResults.map((f) => ({
        id: f.path,
        type: 'file',
        title: f.path,
        indices: f.indices,
        fileMatch: f,
      }));
      return [{ items }];
    }

    if (currentMode === 'actions') {
      const filtered = q
        ? actions.filter(
            (a) =>
              a.label.toLowerCase().includes(q) ||
              a.id.toLowerCase().includes(q)
          )
        : actions;
      const items: SearchItem[] = filtered.map((a) => ({
        id: a.id,
        type: 'action',
        title: a.label,
        shortcut: a.shortcut,
        action: a,
      }));
      return [{ items }];
    }

    if (currentMode === 'recent') {
      const list = recentFiles || [];
      const filtered = q
        ? list.filter((p) => p.toLowerCase().includes(q))
        : list;
      const items: SearchItem[] = filtered.map((p) => {
        const name = p.split('/').filter(Boolean).pop() || p;
        return {
          id: p,
          type: 'recent',
          title: name,
          subtitle: p,
          filePath: p,
        };
      });
      return [{ items }];
    }

    if (currentMode === 'text') {
      const groups = groupHitsByPath(textHits);
      return groups.map((g) => ({
        name: `${g.path} (${g.hits.length})`,
        items: g.hits.map((h) => ({
          id: `${h.path}:${h.line}:${h.col}`,
          type: 'hit',
          title: h.text,
          hit: h,
          filePath: h.path,
        })),
      }));
    }

    if (currentMode === 'everywhere') {
      const resultSections: Section[] = [];

      // 1. Actions matching query
      const matchedActions = q
        ? actions.filter(
            (a) =>
              a.label.toLowerCase().includes(q) ||
              a.id.toLowerCase().includes(q)
          ).slice(0, 5)
        : actions.slice(0, 5);

      if (matchedActions.length > 0) {
        resultSections.push({
          name: 'ACTIONS',
          items: matchedActions.map((a) => ({
            id: a.id,
            type: 'action',
            title: a.label,
            shortcut: a.shortcut,
            action: a,
          })),
        });
      }

      // 2. Files matching query
      if (q && fileResults.length > 0) {
        resultSections.push({
          name: 'FILES',
          items: fileResults.map((f) => ({
            id: f.path,
            type: 'file',
            title: f.path,
            indices: f.indices,
            fileMatch: f,
          })),
        });
      } else if (!q && recentFiles && recentFiles.length > 0) {
        resultSections.push({
          name: 'RECENT FILES',
          items: recentFiles.slice(0, 10).map((p) => {
            const name = p.split('/').filter(Boolean).pop() || p;
            return {
              id: p,
              type: 'recent',
              title: name,
              subtitle: p,
              filePath: p,
            };
          }),
        });
      }

      return resultSections;
    }

    return [{ items: [] }];
  });

  let flatItems = $derived.by<SearchItem[]>(() => {
    const list: SearchItem[] = [];
    for (const sec of sections) {
      for (const item of sec.items) {
        list.push(item);
      }
    }
    return list;
  });

  // Clamp selectedIndex when flatItems changes
  $effect(() => {
    if (flatItems.length === 0) {
      selectedIndex = 0;
    } else if (selectedIndex >= flatItems.length) {
      selectedIndex = flatItems.length - 1;
    }
  });

  function splitByIndices(text: string, indices?: number[]): { text: string; match: boolean }[] {
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

  function highlightSubstring(text: string, q: string): { text: string; match: boolean }[] {
    if (!q.trim()) return [{ text, match: false }];
    const lowerText = text.toLowerCase();
    const lowerQ = q.toLowerCase();
    const chunks: { text: string; match: boolean }[] = [];
    let lastIndex = 0;
    let idx = lowerText.indexOf(lowerQ, lastIndex);

    while (idx !== -1) {
      if (idx > lastIndex) {
        chunks.push({ text: text.slice(lastIndex, idx), match: false });
      }
      chunks.push({ text: text.slice(idx, idx + q.length), match: true });
      lastIndex = idx + q.length;
      idx = lowerText.indexOf(lowerQ, lastIndex);
    }

    if (lastIndex < text.length) {
      chunks.push({ text: text.slice(lastIndex), match: false });
    }

    return chunks;
  }

  function highlightHit(text: string, q: string, reg: boolean, cs: boolean): { text: string; match: boolean }[] {
    if (!q.trim()) return [{ text, match: false }];
    try {
      const flags = cs ? 'g' : 'gi';
      const pattern = reg ? q : q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(pattern, flags);
      const chunks: { text: string; match: boolean }[] = [];
      let lastIndex = 0;
      let m: RegExpExecArray | null;

      while ((m = re.exec(text)) !== null) {
        if (m.index > lastIndex) {
          chunks.push({ text: text.slice(lastIndex, m.index), match: false });
        }
        chunks.push({ text: m[0], match: true });
        lastIndex = m.index + m[0].length;
        if (m[0].length === 0) {
          re.lastIndex++;
        }
      }
      if (lastIndex < text.length) {
        chunks.push({ text: text.slice(lastIndex), match: false });
      }
      return chunks.length > 0 ? chunks : [{ text, match: false }];
    } catch {
      return [{ text, match: false }];
    }
  }

  function handleSelect(item: SearchItem) {
    if (item.type === 'action' && item.action) {
      onClose();
      item.action.run();
    } else if (item.type === 'file' && item.fileMatch) {
      const fullPath =
        folderPath && !item.fileMatch.path.startsWith('/')
          ? `${folderPath}/${item.fileMatch.path}`
          : item.fileMatch.path;
      onOpenFile(fullPath);
      onClose();
    } else if (item.type === 'recent' && item.filePath) {
      onOpenFile(item.filePath);
      onClose();
    } else if (item.type === 'hit' && item.hit) {
      const fullPath =
        folderPath && !item.hit.path.startsWith('/')
          ? `${folderPath}/${item.hit.path}`
          : item.hit.path;
      onOpenFile(fullPath, item.hit.line, item.hit.col);
      onClose();
    }
  }

  function switchMode(newMode: SearchMode) {
    currentMode = newMode;
    query = '';
    selectedIndex = 0;
    inputEl?.focus();
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (flatItems.length > 0) {
        selectedIndex = (selectedIndex + 1) % flatItems.length;
        scrollSelectedIntoView();
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (flatItems.length > 0) {
        selectedIndex = (selectedIndex - 1 + flatItems.length) % flatItems.length;
        scrollSelectedIntoView();
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (flatItems.length > 0 && selectedIndex >= 0 && selectedIndex < flatItems.length) {
        handleSelect(flatItems[selectedIndex]);
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

  let placeholderText = $derived(
    currentMode === 'everywhere'
      ? 'Search everywhere (Shift-Shift)...'
      : currentMode === 'files'
      ? 'Search files by name (Cmd-P)...'
      : currentMode === 'actions'
      ? 'Search actions (Cmd-Shift-A)...'
      : currentMode === 'recent'
      ? 'Search recent files (Cmd-E)...'
      : 'Find in project (Cmd-Shift-F)...'
  );

  onMount(() => {
    inputEl?.focus();
  });
</script>

<!-- Backdrop overlay -->
<div class="palette-backdrop" onclick={onClose} role="presentation"></div>

<!-- Palette dialog -->
<div class="palette-dialog" role="dialog" aria-modal="true" aria-label="Search Palette">
  <div class="palette-header">
    <button
      type="button"
      class="palette-tab"
      class:active={currentMode === 'everywhere'}
      onclick={() => switchMode('everywhere')}
    >
      Everywhere <span>⇧⇧</span>
    </button>
    <button
      type="button"
      class="palette-tab"
      class:active={currentMode === 'files'}
      onclick={() => switchMode('files')}
    >
      Files <span>⌘P</span>
    </button>
    <button
      type="button"
      class="palette-tab"
      class:active={currentMode === 'actions'}
      onclick={() => switchMode('actions')}
    >
      Actions <span>⇧⌘A</span>
    </button>
    <button
      type="button"
      class="palette-tab"
      class:active={currentMode === 'recent'}
      onclick={() => switchMode('recent')}
    >
      Recent <span>⌘E</span>
    </button>
    <button
      type="button"
      class="palette-tab"
      class:active={currentMode === 'text'}
      onclick={() => switchMode('text')}
    >
      Text <span>⇧⌘F</span>
    </button>
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
      placeholder={placeholderText}
      autocomplete="off"
      spellcheck="false"
    />
    {#if currentMode === 'text'}
      <div class="toggle-buttons">
        <button
          type="button"
          class="toggle-btn"
          class:active={caseSensitive}
          onclick={() => (caseSensitive = !caseSensitive)}
          title="Match Case (Aa)"
        >
          Aa
        </button>
        <button
          type="button"
          class="toggle-btn"
          class:active={isRegex}
          onclick={() => (isRegex = !isRegex)}
          title="Match Regular Expression (.*)"
        >
          .*
        </button>
      </div>
    {/if}
  </div>

  <div class="palette-list">
    {#if flatItems.length === 0}
      <div class="empty-state">
        {#if isSearching}
          Searching...
        {:else if query.trim()}
          No results found matching "{query}"
        {:else}
          Type to search
        {/if}
      </div>
    {:else}
      {#each sections as sec}
        {#if sec.name && sec.items.length > 0}
          <div class="section-header">{sec.name}</div>
        {/if}
        {#each sec.items as item}
          {@const globalIdx = flatItems.indexOf(item)}
          {@const isSelected = globalIdx === selectedIndex}
          <div
            class="palette-item"
            class:selected={isSelected}
            onclick={() => handleSelect(item)}
            onkeydown={(e) => { if (e.key === 'Enter') handleSelect(item); }}
            onmouseenter={() => (selectedIndex = globalIdx)}
            role="option"
            tabindex="-1"
            aria-selected={isSelected}
          >
            {#if item.type === 'action'}
              <div class="item-title">
                {#each highlightSubstring(item.title, query) as chunk}
                  {#if chunk.match}
                    <span class="match-highlight">{chunk.text}</span>
                  {:else}
                    <span>{chunk.text}</span>
                  {/if}
                {/each}
              </div>
              {#if item.shortcut}
                <div class="item-shortcut">{item.shortcut}</div>
              {/if}
            {:else if item.type === 'file'}
              <div class="item-title">
                {#each splitByIndices(item.title, item.indices) as chunk}
                  {#if chunk.match}
                    <span class="match-highlight">{chunk.text}</span>
                  {:else}
                    <span>{chunk.text}</span>
                  {/if}
                {/each}
              </div>
            {:else if item.type === 'recent'}
              <div class="item-title">
                {#each highlightSubstring(item.title, query) as chunk}
                  {#if chunk.match}
                    <span class="match-highlight">{chunk.text}</span>
                  {:else}
                    <span>{chunk.text}</span>
                  {/if}
                {/each}
                {#if item.subtitle}
                  <span class="item-subtitle">{item.subtitle}</span>
                {/if}
              </div>
            {:else if item.type === 'hit' && item.hit}
              <div class="hit-row">
                <span class="hit-loc">{item.hit.line}:{item.hit.col}</span>
                <span class="hit-content">
                  {#each highlightHit(item.hit.text, query, isRegex, caseSensitive) as chunk}
                    {#if chunk.match}
                      <span class="match-highlight">{chunk.text}</span>
                    {:else}
                      <span>{chunk.text}</span>
                    {/if}
                  {/each}
                </span>
              </div>
            {/if}
          </div>
        {/each}
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
    gap: 4px;
    padding: 6px 10px 0 10px;
    background: #141518;
    border-bottom: 1px solid #24262b;
    overflow-x: auto;
  }

  .palette-tab {
    font-size: 11px;
    color: #8b8f98;
    background: transparent;
    border: 1px solid transparent;
    border-bottom: none;
    padding: 5px 9px;
    border-radius: 5px 5px 0 0;
    display: flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
    font-family: inherit;
  }

  .palette-tab:hover {
    color: #bcbec4;
    background: #1a1b1f55;
  }

  .palette-tab.active {
    color: #cfe0ff;
    background: #1a1b1f;
    border-color: #2c2e34;
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

  .toggle-buttons {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .toggle-btn {
    font-size: 11px;
    font-family: inherit;
    padding: 2px 6px;
    border-radius: 4px;
    border: 1px solid #2c2e34;
    background: #202227;
    color: #8b8f98;
    cursor: pointer;
    font-weight: 600;
  }

  .toggle-btn:hover {
    background: #282a32;
    color: #bcbec4;
  }

  .toggle-btn.active {
    background: #2b3b55;
    color: #6ea8ff;
    border-color: #3e5f8a;
  }

  .palette-list {
    max-height: 380px;
    overflow-y: auto;
    padding: 4px 0;
  }

  .section-header {
    padding: 6px 14px 4px 14px;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.8px;
    color: #6b707d;
    background: #16171b;
    border-top: 1px solid #202227;
    border-bottom: 1px solid #202227;
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
    justify-content: space-between;
    padding: 0 14px;
    cursor: pointer;
    font-size: 12.5px;
    color: #bcbec4;
    user-select: none;
  }

  .palette-item.selected {
    background: #1f2a3d;
    color: #ffffff;
  }

  .item-title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 1;
  }

  .item-subtitle {
    font-size: 11px;
    color: #5b5f68;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .item-shortcut {
    font-size: 10.5px;
    color: #8b8f98;
    background: #25272e;
    padding: 1px 6px;
    border-radius: 4px;
    border: 1px solid #2c2e34;
    flex-shrink: 0;
  }

  .hit-row {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    overflow: hidden;
  }

  .hit-loc {
    font-size: 11px;
    color: #8b8f98;
    min-width: 48px;
    flex-shrink: 0;
  }

  .hit-content {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: pre;
    font-size: 12.5px;
  }

  .match-highlight {
    color: #6ea8ff;
    font-weight: 600;
  }
</style>
