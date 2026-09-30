<script lang="ts">
  import { EditorView } from '@codemirror/view';
  import {
    findMatches,
    getActiveMatchIndex,
    replaceOne,
    replaceAll,
    type MatchRange,
    type SearchOptions,
  } from './searchLogic';

  let {
    view = null,
    isOpen = false,
    mode = 'find',
    onClose = () => {},
  }: {
    view: EditorView | null;
    isOpen: boolean;
    mode: 'find' | 'replace';
    onClose: () => void;
  } = $props();

  let query = $state('');
  let replacement = $state('');
  let caseSensitive = $state(false);
  let wholeWord = $state(false);
  let isRegex = $state(false);

  let searchInputEl: HTMLInputElement;

  let options = $derived<SearchOptions>({
    caseSensitive,
    wholeWord,
    isRegex,
  });

  let docText = $derived(view ? view.state.doc.toString() : '');
  let matches = $derived<MatchRange[]>(findMatches(docText, query, options));
  let cursorHead = $derived(view ? view.state.selection.main.head : 0);
  let activeIndex = $derived<number>(getActiveMatchIndex(matches, cursorHead));

  $effect(() => {
    if (isOpen) {
      setTimeout(() => {
        searchInputEl?.focus();
        searchInputEl?.select();
      }, 50);
    }
  });

  function selectMatch(range: MatchRange) {
    if (!view) return;
    view.dispatch({
      selection: { anchor: range.from, head: range.to },
      scrollIntoView: true,
    });
  }

  function handleNext() {
    if (matches.length === 0 || !view) return;
    const nextIdx = (activeIndex + 1) % matches.length;
    selectMatch(matches[nextIdx]);
  }

  function handlePrev() {
    if (matches.length === 0 || !view) return;
    const prevIdx = (activeIndex - 1 + matches.length) % matches.length;
    selectMatch(matches[prevIdx]);
  }

  function handleReplaceNext() {
    if (matches.length === 0 || !view) return;
    const match = matches[activeIndex] || matches[0];
    const { newRange } = replaceOne(docText, match, replacement);
    view.dispatch({
      changes: { from: match.from, to: match.to, insert: replacement },
      selection: { anchor: newRange.from, head: newRange.to },
      scrollIntoView: true,
    });
  }

  function handleReplaceAll() {
    if (matches.length === 0 || !view) return;
    const { count } = replaceAll(docText, query, replacement, options);
    const regex = options.isRegex ? new RegExp(query, options.caseSensitive ? 'g' : 'gi') : new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), options.caseSensitive ? 'g' : 'gi');
    view.dispatch({
      changes: { from: 0, to: docText.length, insert: docText.replace(regex, replacement) },
    });
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'Enter') {
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
  <div class="find-replace-bar" onkeydown={handleKeyDown} role="search">
    <!-- Row 1: Search Query + Controls -->
    <div class="bar-row">
      <div class="input-wrap">
        <input
          bind:this={searchInputEl}
          type="text"
          class="find-input"
          placeholder="Find…"
          bind:value={query}
        />
        <span class="match-count">
          {matches.length > 0 ? `${activeIndex + 1}/${matches.length}` : query ? 'No matches' : ''}
        </span>
      </div>

      <!-- Toggles: Case, Word, Regex -->
      <div class="toggles-group">
        <button
          class="toggle-btn"
          class:active={caseSensitive}
          onclick={() => (caseSensitive = !caseSensitive)}
          title="Match Case (Aa)"
        >
          Aa
        </button>
        <button
          class="toggle-btn"
          class:active={wholeWord}
          onclick={() => (wholeWord = !wholeWord)}
          title="Whole Word (\b)"
        >
          |W|
        </button>
        <button
          class="toggle-btn"
          class:active={isRegex}
          onclick={() => (isRegex = !isRegex)}
          title="Regex (.*)"
        >
          .*
        </button>
      </div>

      <!-- Nav: Next / Prev -->
      <button class="nav-btn" onclick={handlePrev} title="Previous Match (Shift+Enter)">▲</button>
      <button class="nav-btn" onclick={handleNext} title="Next Match (Enter)">▼</button>
      <button class="close-btn" onclick={onClose} title="Close (Esc)">✕</button>
    </div>

    <!-- Row 2: Replace Row (when mode === 'replace') -->
    {#if mode === 'replace'}
      <div class="bar-row mt">
        <div class="input-wrap">
          <input
            type="text"
            class="find-input"
            placeholder="Replace with…"
            bind:value={replacement}
          />
        </div>
        <div class="replace-actions">
          <button class="action-btn" onclick={handleReplaceNext} disabled={matches.length === 0}>
            Replace
          </button>
          <button class="action-btn" onclick={handleReplaceAll} disabled={matches.length === 0}>
            Replace All
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
    background: #181a1f;
    border: 1px solid #2e313b;
    border-radius: 8px;
    padding: 8px 12px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
    z-index: 50;
    display: flex;
    flex-direction: column;
    gap: 6px;
    width: 380px;
  }
  .bar-row {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .bar-row.mt {
    margin-top: 2px;
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
    background: #121316;
    border: 1px solid #2b2e38;
    border-radius: 4px;
    padding: 0 60px 0 8px;
    color: #f0f0f0;
    font-size: 12px;
    outline: none;
  }
  .find-input:focus {
    border-color: #6ea8ff;
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
    background: #121316;
    border: 1px solid #282a33;
    border-radius: 4px;
    padding: 1px;
  }
  .toggle-btn {
    background: transparent;
    border: none;
    color: #7b808e;
    font-size: 11px;
    padding: 2px 6px;
    border-radius: 3px;
    cursor: pointer;
  }
  .toggle-btn:hover {
    color: #e0e2e8;
  }
  .toggle-btn.active {
    background: #2a3e63;
    color: #8bb7ff;
    font-weight: 600;
  }
  .nav-btn, .close-btn {
    background: #1f2127;
    border: 1px solid #2d3039;
    color: #8b8f98;
    width: 24px;
    height: 24px;
    border-radius: 4px;
    display: grid;
    place-items: center;
    font-size: 10px;
    cursor: pointer;
  }
  .nav-btn:hover, .close-btn:hover {
    background: #2c2f38;
    color: #ffffff;
  }
  .replace-actions {
    display: flex;
    gap: 4px;
  }
  .action-btn {
    background: #22242a;
    border: 1px solid #2f323c;
    color: #d0d2d8;
    font-size: 11px;
    padding: 3px 8px;
    border-radius: 4px;
    cursor: pointer;
    white-space: nowrap;
  }
  .action-btn:hover {
    background: #2c2e36;
    color: #ffffff;
  }
  .action-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
