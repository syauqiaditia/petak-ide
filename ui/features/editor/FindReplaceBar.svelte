<script lang="ts">
  import { EditorView } from '@codemirror/view';
  import {
    findMatches,
    getActiveMatchIndex,
    getNextMatchIndex,
    getPrevMatchIndex,
    formatMatchCount,
    replaceOne,
    replaceAll,
    getSearchQueryFromSelection,
    setSearchHighlights,
    type MatchRange,
    type SearchOptions,
  } from './searchLogic';
  import { tabsManager } from './tabs.svelte';

  let {
    view = null,
    docVersion = 0,
    isOpen = false,
    mode = 'find',
    initialQuery = '',
    onClose = () => {},
  }: {
    view: EditorView | null;
    docVersion?: number;
    isOpen: boolean;
    mode: 'find' | 'replace';
    initialQuery?: string;
    onClose: () => void;
  } = $props();

  let query = $state('');
  let replacement = $state('');
  let caseSensitive = $state(false);
  let wholeWord = $state(false);
  let isRegex = $state(false);
  let currentMatchIndex = $state(0);

  let searchInputEl: HTMLInputElement;

  let options = $derived<SearchOptions>({
    caseSensitive,
    wholeWord,
    isRegex,
  });

  let docText = $derived.by(() => {
    if (view && docVersion >= 0) {
      try {
        const text = view.state.doc.toString();
        if (text) return text;
      } catch (_) {}
    }
    const tab = tabsManager.activeTab;
    if (tab) {
      if (tab.state) {
        return tab.state.doc.toString();
      }
      return tab.savedContent || '';
    }
    return '';
  });
  let matches = $derived<MatchRange[]>(findMatches(docText, query, options));

  // Keep match index valid when matches change
  $effect(() => {
    if (matches.length === 0) {
      currentMatchIndex = 0;
    } else if (currentMatchIndex >= matches.length) {
      currentMatchIndex = 0;
    }
  });

  // Apply search highlights in CodeMirror without interrupting mouse selection
  $effect(() => {
    if (view) {
      if (isOpen && query.length > 0) {
        view.dispatch({
          effects: setSearchHighlights.of({
            matches,
            activeIndex: currentMatchIndex,
          }),
        });
      } else {
        view.dispatch({
          effects: setSearchHighlights.of({
            matches: [],
            activeIndex: -1,
          }),
        });
      }
    }
  });

  let prevIsOpen = false;

  $effect(() => {
    const justOpened = isOpen && !prevIsOpen;
    prevIsOpen = isOpen;

    if (justOpened) {
      if (initialQuery) {
        query = initialQuery;
      } else if (view) {
        const { from, to } = view.state.selection.main;
        if (from !== to) {
          const selText = view.state.sliceDoc(from, to);
          const autoQuery = getSearchQueryFromSelection(selText);
          if (autoQuery) {
            query = autoQuery;
          }
        }
      }

      requestAnimationFrame(() => {
        searchInputEl?.focus();
        searchInputEl?.select();
      });
      setTimeout(() => {
        searchInputEl?.focus();
        searchInputEl?.select();
      }, 50);
    }
  });

  function selectMatch(range: MatchRange, index: number) {
    if (!view) return;
    currentMatchIndex = index;
    view.dispatch({
      selection: { anchor: range.from, head: range.to },
      scrollIntoView: true,
      effects: setSearchHighlights.of({
        matches,
        activeIndex: index,
      }),
    });
  }

  function handleNext() {
    if (matches.length === 0 || !view) return;
    const nextIdx = getNextMatchIndex(currentMatchIndex, matches.length);
    if (nextIdx >= 0) {
      selectMatch(matches[nextIdx], nextIdx);
    }
  }

  function handlePrev() {
    if (matches.length === 0 || !view) return;
    const prevIdx = getPrevMatchIndex(currentMatchIndex, matches.length);
    if (prevIdx >= 0) {
      selectMatch(matches[prevIdx], prevIdx);
    }
  }

  export function next() {
    handleNext();
  }

  export function prev() {
    handlePrev();
  }

  export function getQuery(): string {
    return query;
  }

  export function setQuery(q: string) {
    query = q;
  }

  function handleExclude() {
    // Android Studio Exclude: skip current match and proceed to next
    handleNext();
  }

  function handleReplaceNext() {
    if (matches.length === 0 || !view) return;
    const match = matches[currentMatchIndex] || matches[0];
    const { newRange } = replaceOne(docText, match, replacement);
    view.dispatch({
      changes: { from: match.from, to: match.to, insert: replacement },
      selection: { anchor: newRange.from, head: newRange.to },
      scrollIntoView: true,
    });
    setTimeout(() => {
      handleNext();
    }, 20);
  }

  function handleReplaceAll() {
    if (matches.length === 0 || !view) return;
    const { newDocText } = replaceAll(docText, query, replacement, options);
    view.dispatch({
      changes: { from: 0, to: docText.length, insert: newDocText },
    });
  }

  function handleClose() {
    if (view) {
      view.dispatch({
        effects: setSearchHighlights.of({
          matches: [],
          activeIndex: -1,
        }),
      });
    }
    onClose();
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      handleClose();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) {
        handlePrev();
      } else {
        handleNext();
      }
    } else if ((e.metaKey || e.ctrlKey) && (e.key.toLowerCase() === 'g' || e.code === 'KeyG')) {
      e.preventDefault();
      if (e.shiftKey) {
        handlePrev();
      } else {
        handleNext();
      }
    }
  }
</script>

{#if isOpen}
  <div class="find-replace-bar" onkeydown={handleKeyDown} role="search" aria-label="Find and Replace">
    <!-- Baris 1: Search -->
    <div class="bar-row search-row">
      <div class="input-wrap">
        <input
          bind:this={searchInputEl}
          type="text"
          class="find-input"
          placeholder="Search…"
          bind:value={query}
        />
        <span class="match-count" aria-live="polite">
          {formatMatchCount(currentMatchIndex, matches.length, query)}
        </span>
      </div>

      <!-- Toggles: Cc (Match Case), W (Words), .* (Regex) -->
      <div class="toggles-group">
        <button
          type="button"
          class="toggle-btn"
          class:active={caseSensitive}
          onclick={() => (caseSensitive = !caseSensitive)}
          title="Match Case (Cc)"
        >
          Cc
        </button>
        <button
          type="button"
          class="toggle-btn"
          class:active={wholeWord}
          onclick={() => (wholeWord = !wholeWord)}
          title="Words (W)"
        >
          W
        </button>
        <button
          type="button"
          class="toggle-btn"
          class:active={isRegex}
          onclick={() => (isRegex = !isRegex)}
          title="Regex (.*)"
        >
          .*
        </button>
      </div>

      <!-- Navigasi Up/Down: ▲ / ▼ -->
      <button type="button" class="nav-btn prev-btn" onclick={handlePrev} title="Previous Match (Shift+Enter / ⇧⌘G)">▲</button>
      <button type="button" class="nav-btn next-btn" onclick={handleNext} title="Next Match (Enter / ⌘G)">▼</button>

      <!-- Filter Icon -->
      <button type="button" class="nav-btn filter-btn" title="Filter (In Selection / File Types)" aria-label="Filter">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon>
        </svg>
      </button>

      <!-- Close ✕ -->
      <button type="button" class="close-btn" onclick={handleClose} title="Close (Esc)">✕</button>
    </div>

    <!-- Baris 2: Replace -->
    {#if mode === 'replace'}
      <div class="bar-row replace-row">
        <div class="input-wrap">
          <input
            type="text"
            class="find-input replace-input"
            placeholder="Replace…"
            bind:value={replacement}
          />
        </div>
        <div class="replace-actions">
          <button type="button" class="action-btn replace-one-btn" onclick={handleReplaceNext} disabled={matches.length === 0}>
            Replace
          </button>
          <button type="button" class="action-btn replace-all-btn" onclick={handleReplaceAll} disabled={matches.length === 0}>
            Replace All
          </button>
          <button type="button" class="action-btn exclude-btn" onclick={handleExclude} disabled={matches.length === 0} title="Exclude this match">
            Exclude
          </button>
        </div>
      </div>
    {/if}
  </div>
{/if}

<style>
  .find-replace-bar {
    position: absolute;
    top: 40px;
    right: 20px;
    background: #1e1f22;
    border: 1px solid #2b2d30;
    border-radius: 6px;
    padding: 8px 10px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.55);
    z-index: 50;
    display: flex;
    flex-direction: column;
    gap: 6px;
    width: 440px;
    user-select: none;
  }
  .bar-row {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .input-wrap {
    flex: 1;
    position: relative;
    display: flex;
    align-items: center;
  }
  .find-input {
    width: 100%;
    height: 26px;
    background: #141517;
    border: 1px solid #2e3136;
    border-radius: 4px;
    padding: 0 68px 0 8px;
    color: #dfe1e5;
    font-size: 12px;
    font-family: inherit;
    outline: none;
    box-sizing: border-box;
  }
  .find-input:focus {
    border-color: #3574f0;
  }
  .replace-input {
    padding-right: 8px;
  }
  .match-count {
    position: absolute;
    right: 8px;
    font-size: 11px;
    color: #8b8f98;
    pointer-events: none;
  }
  .toggles-group {
    display: flex;
    gap: 2px;
    background: #141517;
    border: 1px solid #2e3136;
    border-radius: 4px;
    padding: 1px;
  }
  .toggle-btn {
    background: transparent;
    border: none;
    color: #7b808e;
    font-size: 11px;
    font-family: inherit;
    padding: 2px 6px;
    border-radius: 3px;
    cursor: pointer;
    line-height: 16px;
  }
  .toggle-btn:hover {
    color: #dfe1e5;
  }
  .toggle-btn.active {
    background: #2e436e;
    color: #6ea8ff;
    font-weight: 600;
  }
  .nav-btn, .close-btn {
    background: #25272b;
    border: 1px solid #2e3136;
    color: #9aa0a6;
    width: 24px;
    height: 24px;
    border-radius: 4px;
    display: grid;
    place-items: center;
    font-size: 10px;
    cursor: pointer;
    flex-shrink: 0;
  }
  .nav-btn:hover, .close-btn:hover {
    background: #2f3238;
    color: #ffffff;
  }
  .filter-btn svg {
    color: inherit;
  }
  .replace-actions {
    display: flex;
    gap: 4px;
    flex-shrink: 0;
  }
  .action-btn {
    background: #282a2e;
    border: 1px solid #36383e;
    color: #c4c7c5;
    font-size: 11px;
    padding: 3px 8px;
    border-radius: 4px;
    cursor: pointer;
    white-space: nowrap;
    height: 26px;
    box-sizing: border-box;
  }
  .action-btn:hover {
    background: #35383f;
    color: #ffffff;
  }
  .action-btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
</style>
