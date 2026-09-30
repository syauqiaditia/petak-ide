<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { runStore } from './runStore.svelte';
  import { logcatStore } from './logcatStore.svelte';
  import {
    LEVEL_COLORS,
    LEVEL_BG,
    parseStackLinks,
    splitLogMessageWithLinks,
    type LogLevel,
    type LogItem,
  } from './logcat';

  let { onOpenFile } = $props<{
    onOpenFile?: (file: string, line: number, col?: number) => void;
  }>();

  const ROW_HEIGHT = 22;
  const OVERSCAN = 6;

  let viewportEl = $state<HTMLDivElement | null>(null);
  let scrollTop = $state<number>(0);
  let clientHeight = $state<number>(300);

  let searchInput = $state<string>(logcatStore.searchQuery);
  let tagInput = $state<string>(logcatStore.tagFilter);
  let caseSensitive = $state(false);
  let isRegex = $state(false);
  let currentMatchIdx = $state(0);

  function handlePrevMatch() {
    if (totalCount === 0) return;
    currentMatchIdx = (currentMatchIdx - 1 + totalCount) % totalCount;
    if (viewportEl) {
      viewportEl.scrollTop = currentMatchIdx * ROW_HEIGHT;
    }
  }

  function handleNextMatch() {
    if (totalCount === 0) return;
    currentMatchIdx = (currentMatchIdx + 1) % totalCount;
    if (viewportEl) {
      viewportEl.scrollTop = currentMatchIdx * ROW_HEIGHT;
    }
  }

  // Virtual list windowing
  let totalCount = $derived(logcatStore.filteredLines.length);
  let totalHeight = $derived(totalCount * ROW_HEIGHT);

  let startIndex = $derived(Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN));
  let endIndex = $derived(Math.min(totalCount, Math.ceil((scrollTop + clientHeight) / ROW_HEIGHT) + OVERSCAN));
  let offsetY = $derived(startIndex * ROW_HEIGHT);
  let visibleLines = $derived(logcatStore.filteredLines.slice(startIndex, endIndex));

  function handleScroll(e: Event) {
    const target = e.currentTarget as HTMLDivElement;
    scrollTop = target.scrollTop;
    clientHeight = target.clientHeight;

    // Check if near bottom to manage autoScroll
    const atBottom = target.scrollHeight - target.scrollTop - target.clientHeight < 30;
    logcatStore.autoScroll = atBottom;
  }

  function scrollToBottom() {
    logcatStore.autoScroll = true;
    if (viewportEl) {
      viewportEl.scrollTop = viewportEl.scrollHeight;
    }
  }

  function handleSearchInput(e: Event) {
    const val = (e.target as HTMLInputElement).value;
    searchInput = val;
    logcatStore.setSearchQuery(val);
  }

  function handleTagInput(e: Event) {
    const val = (e.target as HTMLInputElement).value;
    tagInput = val;
    logcatStore.setTagFilter(val);
  }

  function handleLevelChange(e: Event) {
    const val = (e.target as HTMLSelectElement).value as LogLevel;
    logcatStore.setMinLevel(val);
  }

  function handleLinkClick(file: string, line: number, col?: number | null) {
    if (onOpenFile) {
      onOpenFile(file, line, col ?? 1);
    }
  }

  $effect(() => {
    // Keep viewport height updated on resize / changes
    if (viewportEl) {
      clientHeight = viewportEl.clientHeight;
    }
  });

  $effect(() => {
    // Auto-scroll when new items arrive if autoScroll is enabled
    const count = logcatStore.filteredLines.length;
    if (logcatStore.autoScroll && viewportEl && count > 0) {
      tick().then(() => {
        if (viewportEl && logcatStore.autoScroll) {
          viewportEl.scrollTop = viewportEl.scrollHeight;
        }
      });
    }
  });

  onMount(() => {
    if (viewportEl) {
      clientHeight = viewportEl.clientHeight;
      if (logcatStore.autoScroll) {
        viewportEl.scrollTop = viewportEl.scrollHeight;
      }
    }
  });
</script>

<div class="logcat-panel">
  <!-- Toolbar -->
  <div class="toolbar">
    <!-- Device / App info -->
    <div class="info-pill" title="Target device and app">
      <span class="device-name">{runStore.selectedDevice?.name || 'No Device'}</span>
      <span class="info-divider">·</span>
      <span class="app-identifier">
        {runStore.appId || (runStore.pid ? `PID ${runStore.pid}` : 'all apps')}
      </span>
    </div>

    <!-- Toggle package:mine -->
    <button
      class="toggle-btn"
      class:active={logcatStore.packageMine}
      onclick={() => logcatStore.togglePackageMine()}
      title="Filter logs to current app process"
    >
      package:mine
    </button>

    <!-- Min level filter -->
    <div class="level-select-wrapper">
      <label for="min-level-select" class="visually-hidden">Minimum Level</label>
      <select
        id="min-level-select"
        class="level-select"
        value={logcatStore.minLevel}
        onchange={handleLevelChange}
        title="Minimum log level"
      >
        <option value="V">Verbose (V)</option>
        <option value="D">Debug (D)</option>
        <option value="I">Info (I)</option>
        <option value="W">Warn (W)</option>
        <option value="E">Error (E)</option>
      </select>
    </div>

    <!-- Tag filter -->
    <input
      type="text"
      class="text-filter tag-filter"
      placeholder="Tag filter"
      value={tagInput}
      oninput={handleTagInput}
      title="Filter by tag"
    />

    <!-- Text search (debounced 100ms) with Case/Regex/Next/Prev -->
    <div class="search-input-wrapper">
      <input
        type="text"
        class="text-filter search-filter"
        placeholder="Search logs..."
        value={searchInput}
        oninput={handleSearchInput}
        title="Filter by text (debounce 100ms)"
      />
      <button
        class="opt-btn"
        class:active={caseSensitive}
        onclick={() => (caseSensitive = !caseSensitive)}
        title="Match Case (Aa)"
      >
        Aa
      </button>
      <button
        class="opt-btn"
        class:active={isRegex}
        onclick={() => (isRegex = !isRegex)}
        title="Use Regular Expression (.*)"
      >
        .*
      </button>
      {#if searchInput.trim()}
        <button class="nav-arrow" onclick={handlePrevMatch} title="Previous match">▲</button>
        <button class="nav-arrow" onclick={handleNextMatch} title="Next match">▼</button>
      {/if}
    </div>

    <div class="spacer"></div>

    <!-- Stats & status badge -->
    <div class="stats-wrapper">
      {#if logcatStore.isPaused}
        <span class="paused-badge">PAUSED</span>
      {/if}
      <span class="count-label">
        {totalCount.toLocaleString()} {totalCount === 1 ? 'line' : 'lines'}
      </span>
      <span
        class="buffer-cap-pill"
        title="Ring buffer 50.000 baris memori hemat (&lt;150MB) & 60 FPS stabil. Log lama dibuang otomatis."
      >
        50k buffer ℹ
      </span>
    </div>

    <!-- Auto scroll button -->
    <button
      class="icon-action-btn"
      class:active={logcatStore.autoScroll}
      onclick={scrollToBottom}
      title={logcatStore.autoScroll ? 'Auto-scroll enabled' : 'Scroll to bottom'}
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="12" y1="5" x2="12" y2="19"></line>
        <polyline points="19 12 12 19 5 12"></polyline>
      </svg>
    </button>

    <!-- Pause button -->
    <button
      class="action-btn"
      class:is-paused={logcatStore.isPaused}
      onclick={() => logcatStore.togglePause()}
      title={logcatStore.isPaused ? 'Resume log rendering' : 'Pause log rendering'}
    >
      {logcatStore.isPaused ? 'Resume' : 'Pause'}
    </button>

    <!-- Clear button -->
    <button
      class="action-btn clear-btn"
      onclick={() => logcatStore.clear()}
      title="Clear log buffer"
    >
      Clear
    </button>
  </div>

  <!-- Virtual Scroll Viewport -->
  <div class="viewport" bind:this={viewportEl} onscroll={handleScroll}>
    {#if totalCount === 0}
      <div class="empty-state">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#5b5f68" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="4 17 10 11 4 5"></polyline>
          <line x1="12" y1="19" x2="20" y2="19"></line>
        </svg>
        {#if logcatStore.totalBufferedCount > 0}
          <span>No logs match current filter</span>
        {:else}
          <span>Waiting for logcat output...</span>
        {/if}
      </div>
    {:else}
      <div class="virtual-spacer" style:height="{totalHeight}px">
        <div class="virtual-content" style:transform="translateY({offsetY}px)">
          {#each visibleLines as line (line.id)}
            {@const isErr = line.level === 'E' || line.level === 'F'}
            {@const links = parseStackLinks(line.msg, runStore.root)}
            {@const parts = splitLogMessageWithLinks(line.msg, links)}
            <div
              class="log-row"
              class:is-error={isErr}
              class:is-warn={line.level === 'W'}
              style:background={LEVEL_BG[line.level] || 'transparent'}
            >
              <!-- Timestamp -->
              <span class="col-ts">{line.ts.slice(0, 12)}</span>

              <!-- Level indicator -->
              <span
                class="col-level"
                style:color={LEVEL_COLORS[line.level] || '#8b8f98'}
              >
                {line.level}
              </span>

              <!-- Tag -->
              <span class="col-tag" title={line.tag}>{line.tag}</span>

              <!-- Message with clickable stack links -->
              <span class="col-msg">
                {#each parts as part}
                  {#if part.link}
                    <button
                      class="stack-link"
                      onclick={() => handleLinkClick(part.link!.file, part.link!.line, part.link!.col)}
                      title="Open {part.link.file}:{part.link.line}"
                    >{part.text}</button>
                  {:else}
                    <span>{part.text}</span>
                  {/if}
                {/each}
              </span>

              <!-- Fix with agent (OUT of scope, placeholder disabled) -->
              {#if isErr}
                <button
                  class="fix-agent-btn"
                  disabled
                  title="Fix with agent (fase 5)"
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round">
                    <path d="M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2z"></path>
                  </svg>
                  Fix with agent
                </button>
              {/if}
            </div>
          {/each}
        </div>
      </div>
    {/if}
  </div>
</div>

<style>
  .logcat-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    width: 100%;
    background: #141518;
    color: #e6e7ea;
    font-family: 'JetBrains Mono', monospace;
    font-size: 12px;
    overflow: hidden;
  }

  .toolbar {
    height: 36px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 12px;
    border-bottom: 1px solid #222428;
    background: #17181c;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  }

  .info-pill {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 11px;
    color: #8b8f98;
    background: #1e2025;
    padding: 3px 8px;
    border-radius: 4px;
    border: 1px solid #2c2e34;
    max-width: 180px;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .device-name {
    font-weight: 500;
    color: #b9bcc3;
  }

  .info-divider {
    color: #4a4d55;
  }

  .app-identifier {
    color: #8b8f98;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .toggle-btn {
    height: 24px;
    padding: 0 8px;
    border-radius: 4px;
    background: #1e2025;
    color: #8b8f98;
    border: 1px solid #2c2e34;
    font-size: 11px;
    font-family: 'JetBrains Mono', monospace;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .toggle-btn:hover {
    color: #e6e7ea;
    border-color: #3f424b;
  }

  .toggle-btn.active {
    background: #23344d;
    color: #6ea8ff;
    border-color: #3b5f99;
    font-weight: 500;
  }

  .level-select-wrapper {
    position: relative;
    display: flex;
    align-items: center;
  }

  .level-select {
    height: 24px;
    padding: 0 6px;
    border-radius: 4px;
    background: #1e2025;
    color: #b9bcc3;
    border: 1px solid #2c2e34;
    font-size: 11px;
    cursor: pointer;
    outline: none;
  }

  .level-select:focus {
    border-color: #6ea8ff;
  }

  .text-filter {
    height: 24px;
    padding: 0 8px;
    border-radius: 4px;
    background: #141518;
    color: #e6e7ea;
    border: 1px solid #2c2e34;
    font-size: 11px;
    font-family: 'JetBrains Mono', monospace;
    outline: none;
    transition: border-color 0.15s ease;
  }

  .text-filter:focus {
    border-color: #6ea8ff;
  }

  .tag-filter {
    width: 90px;
  }

  .search-input-wrapper {
    display: flex;
    align-items: center;
    background: #141518;
    border: 1px solid #2c2e34;
    border-radius: 4px;
    padding: 0 4px;
    height: 24px;
  }

  .search-input-wrapper .search-filter {
    border: none;
    background: transparent;
    padding: 0 4px;
    width: 130px;
    height: 22px;
  }

  .opt-btn {
    background: transparent;
    border: none;
    color: #656976;
    font-size: 10px;
    padding: 2px 4px;
    border-radius: 3px;
    cursor: pointer;
    font-weight: 700;
  }

  .opt-btn:hover {
    color: #c0c3ce;
  }

  .opt-btn.active {
    background: #2b4573;
    color: #ffffff;
  }

  .nav-arrow {
    background: transparent;
    border: none;
    color: #8b8f98;
    font-size: 9px;
    cursor: pointer;
    padding: 1px 3px;
  }

  .nav-arrow:hover {
    color: #ffffff;
  }

  .buffer-cap-pill {
    font-size: 10px;
    background: #1d2028;
    color: #8b92a3;
    border: 1px solid #282d3a;
    padding: 1px 5px;
    border-radius: 3px;
    cursor: help;
  }

  .spacer {
    flex-grow: 1;
  }

  .stats-wrapper {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .paused-badge {
    font-size: 10px;
    font-weight: 600;
    color: #e8b45a;
    background: #2e2717;
    border: 1px solid #4a3d24;
    padding: 1px 5px;
    border-radius: 3px;
    letter-spacing: 0.5px;
  }

  .count-label {
    font-size: 11px;
    color: #6e7380;
    font-variant-numeric: tabular-nums;
  }

  .action-btn {
    height: 24px;
    padding: 0 9px;
    border-radius: 4px;
    background: #1e2025;
    color: #b9bcc3;
    border: 1px solid #2c2e34;
    font-size: 11px;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .action-btn:hover {
    color: #e6e7ea;
    background: #262930;
    border-color: #3f424b;
  }

  .action-btn.is-paused {
    background: #2e2717;
    color: #e8b45a;
    border-color: #4a3d24;
  }

  .icon-action-btn {
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
    background: #1e2025;
    color: #6e7380;
    border: 1px solid #2c2e34;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .icon-action-btn:hover {
    color: #e6e7ea;
    border-color: #3f424b;
  }

  .icon-action-btn.active {
    color: #6ea8ff;
    background: #1c2533;
    border-color: #2e4366;
  }

  .viewport {
    flex-grow: 1;
    overflow-y: auto;
    overflow-x: auto;
    position: relative;
    contain: strict;
  }

  .virtual-spacer {
    position: relative;
    width: 100%;
    min-width: 100%;
  }

  .virtual-content {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    will-change: transform;
  }

  .log-row {
    height: 22px;
    line-height: 22px;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 0 12px;
    white-space: nowrap;
    border-bottom: 1px solid transparent;
  }

  .log-row:hover {
    background: rgba(255, 255, 255, 0.03);
  }

  .log-row.is-error {
    color: #f07a74;
    background: #2a1d1e !important;
  }

  .log-row.is-warn {
    color: #e8b45a;
  }

  .col-ts {
    color: #5b5f68;
    width: 82px;
    flex-shrink: 0;
    font-size: 11px;
    font-variant-numeric: tabular-nums;
  }

  .is-error .col-ts {
    color: #8a6566;
  }

  .col-level {
    width: 12px;
    flex-shrink: 0;
    font-weight: 700;
    text-align: center;
  }

  .col-tag {
    width: 120px;
    flex-shrink: 0;
    color: #9cc3ff;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .is-warn .col-tag {
    color: #e8b45a;
  }

  .is-error .col-tag {
    color: #f07a74;
  }

  .col-msg {
    flex-grow: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    color: #c9ccd3;
  }

  .is-error .col-msg {
    color: #f07a74;
  }

  .is-warn .col-msg {
    color: #e8b45a;
  }

  .stack-link {
    background: none;
    border: none;
    padding: 0;
    margin: 0;
    color: #6ea8ff;
    font-family: inherit;
    font-size: inherit;
    text-decoration: underline;
    text-underline-offset: 2px;
    cursor: pointer;
  }

  .stack-link:hover {
    color: #9cc3ff;
  }

  .is-error .stack-link {
    color: #ffa49e;
  }

  .fix-agent-btn {
    margin-left: auto;
    height: 18px;
    padding: 0 6px;
    border-radius: 4px;
    background: #3a2e1a;
    color: #e8b45a;
    border: 1px solid #4a3d24;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 11px;
    font-weight: 500;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    opacity: 0.65;
    cursor: not-allowed;
    flex-shrink: 0;
  }

  .empty-state {
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    color: #6e7380;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 13px;
  }

  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
</style>
