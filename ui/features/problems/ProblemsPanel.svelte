<script lang="ts">
  import { diagnosticsStore, type FileDiagnostic } from '../editor/lsp/diagnostics.svelte';
  import { toolchainStore } from '../toolchain/toolchainStore.svelte';

  let {
    onSelectProblem = (_path: string, _line: number, _col: number) => {},
  } = $props<{
    onSelectProblem?: (path: string, line: number, col: number) => void;
  }>();

  let severityFilter = $state<'all' | 'error' | 'warning'>('all');
  let searchQuery = $state('');

  // Toolchain / LSP failures
  let lspFailures = $derived.by(() => {
    if (severityFilter === 'warning') return [];
    const q = searchQuery.toLowerCase().trim();
    return Object.values(toolchainStore.lspStates)
      .filter((s) => s.state === 'failed' || s.state === 'crashed')
      .filter((s) => !q || s.lang.toLowerCase().includes(q) || (s.reason || '').toLowerCase().includes(q));
  });

  // Grouped by file
  let fileEntries = $derived.by(() => {
    const q = searchQuery.toLowerCase().trim();
    const entries: { path: string; filename: string; diags: FileDiagnostic[] }[] = [];
    for (const [path, diags] of diagnosticsStore.byFile.entries()) {
      let filtered = diags;
      if (severityFilter === 'error') {
        filtered = filtered.filter((d) => d.severity === 'error');
      } else if (severityFilter === 'warning') {
        filtered = filtered.filter((d) => d.severity === 'warning');
      }
      if (q) {
        filtered = filtered.filter((d) =>
          d.message.toLowerCase().includes(q) || path.toLowerCase().includes(q)
        );
      }
      if (filtered.length > 0) {
        const filename = path.split('/').filter(Boolean).pop() || path;
        entries.push({ path, filename, diags: filtered });
      }
    }
    return entries;
  });

  let totalProblems = $derived(
    lspFailures.length + fileEntries.reduce((sum, f) => sum + f.diags.length, 0)
  );

  let totalErrors = $derived(
    lspFailures.length +
      fileEntries.reduce(
        (sum, f) => sum + f.diags.filter((d) => d.severity === 'error').length,
        0
      )
  );

  let totalWarnings = $derived(
    fileEntries.reduce(
      (sum, f) => sum + f.diags.filter((d) => d.severity === 'warning').length,
      0
    )
  );

  let flatDiags = $derived.by(() => {
    const list: { path: string; line: number; col: number }[] = [];
    for (const f of fileEntries) {
      for (const d of f.diags) {
        list.push({ path: d.path, line: d.line, col: d.col });
      }
    }
    return list;
  });

  let currentDiagIdx = $state(0);

  function handlePrevProblem() {
    if (flatDiags.length === 0) return;
    currentDiagIdx = (currentDiagIdx - 1 + flatDiags.length) % flatDiags.length;
    const item = flatDiags[currentDiagIdx];
    if (item) onSelectProblem(item.path, item.line, item.col);
  }

  function handleNextProblem() {
    if (flatDiags.length === 0) return;
    currentDiagIdx = (currentDiagIdx + 1) % flatDiags.length;
    const item = flatDiags[currentDiagIdx];
    if (item) onSelectProblem(item.path, item.line, item.col);
  }
</script>

<div class="problems-panel">
  <!-- Toolbar with Filters (Item 14) -->
  <div class="problems-toolbar">
    <div class="filter-pills">
      <button
        class="pill-btn"
        class:active={severityFilter === 'all'}
        onclick={() => (severityFilter = 'all')}
      >
        All ({totalProblems})
      </button>
      <button
        class="pill-btn error"
        class:active={severityFilter === 'error'}
        onclick={() => (severityFilter = 'error')}
      >
        Errors ({totalErrors})
      </button>
      <button
        class="pill-btn warning"
        class:active={severityFilter === 'warning'}
        onclick={() => (severityFilter = 'warning')}
      >
        Warnings ({totalWarnings})
      </button>
    </div>

    <input
      type="text"
      class="problems-search"
      placeholder="Filter problems by message or file…"
      bind:value={searchQuery}
    />

    <div class="spacer"></div>

    <div class="nav-arrows">
      <button class="arrow-btn" onclick={handlePrevProblem} disabled={flatDiags.length <= 1} title="Previous problem">▲</button>
      <button class="arrow-btn" onclick={handleNextProblem} disabled={flatDiags.length <= 1} title="Next problem">▼</button>
    </div>

    <button
      class="clear-btn"
      onclick={() => diagnosticsStore.clear()}
      title="Clear problems list"
    >
      Clear
    </button>
  </div>

  {#if lspFailures.length === 0 && fileEntries.length === 0}
    <div class="empty-state">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#5b5f68" stroke-width="1.5" stroke-linecap="round">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
        <polyline points="22 4 12 14.01 9 11.01"></polyline>
      </svg>
      <span>No problems have been detected in the workspace</span>
    </div>
  {:else}
    <div class="problems-list">
      {#if lspFailures.length > 0}
        <div class="file-group lsp-failure-group">
          <div class="file-header">
            <span class="file-name">Toolchains & Language Servers</span>
            <span class="file-badge is-error">{lspFailures.length}</span>
          </div>

          <div class="file-items">
            {#each lspFailures as failure}
              <div class="problem-row is-error">
                <div class="severity-icon">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f07a74" stroke-width="2.2" stroke-linecap="round">
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="12" y1="8" x2="12" y2="12"></line>
                    <line x1="12" y1="16" x2="12.01" y2="16"></line>
                  </svg>
                </div>

                <div class="problem-text">
                  <span class="problem-msg">
                    <strong>{failure.lang.toUpperCase()} LSP:</strong> {failure.reason || 'Server failed to start'}
                  </span>
                  <span class="problem-source">[toolchain]</span>
                </div>

                <div class="problem-action">
                  <button
                    class="open-settings-btn"
                    onclick={() => (toolchainStore.settingsModalOpen = true)}
                  >
                    Open Settings
                  </button>
                </div>
              </div>
            {/each}
          </div>
        </div>
      {/if}

      {#each fileEntries as file (file.path)}
        <div class="file-group">
          <div class="file-header">
            <span class="file-name">{file.filename}</span>
            <span class="file-path">{file.path}</span>
            <span class="file-badge">{file.diags.length}</span>
          </div>

          <div class="file-items">
            {#each file.diags as diag (diag.line + ':' + diag.col + ':' + diag.message)}
              <div
                class="problem-row"
                class:is-error={diag.severity === 'error'}
                class:is-warning={diag.severity === 'warning'}
                onclick={() => onSelectProblem(diag.path, diag.line, diag.col)}
                role="button"
                tabindex="0"
                onkeydown={(e) => {
                  if (e.key === 'Enter') onSelectProblem(diag.path, diag.line, diag.col);
                }}
              >
                <div class="severity-icon">
                  {#if diag.severity === 'error'}
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f07a74" stroke-width="2.2" stroke-linecap="round">
                      <circle cx="12" cy="12" r="10"></circle>
                      <line x1="12" y1="8" x2="12" y2="12"></line>
                      <line x1="12" y1="16" x2="12.01" y2="16"></line>
                    </svg>
                  {:else}
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#e8b45a" stroke-width="2.2" stroke-linecap="round">
                      <path d="M12 3l10 18H2z"></path>
                      <line x1="12" y1="10" x2="12" y2="15"></line>
                      <line x1="12" y1="18" x2="12.01" y2="18"></line>
                    </svg>
                  {/if}
                </div>

                <div class="problem-text">
                  <span class="problem-msg">{diag.message}</span>
                  {#if diag.source || diag.code}
                    <span class="problem-source">[{[diag.source, diag.code].filter(Boolean).join(' · ')}]</span>
                  {/if}
                </div>

                <div class="problem-loc">
                  <span class="problem-loc-badge">{file.filename}:{diag.line}:{diag.col}</span>
                  <span class="jump-link-action" title="Jump to {file.filename}:{diag.line}">Jump ↗</span>
                </div>
              </div>
            {/each}
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .problems-panel {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    background: #141518;
    color: #d8d9dc;
    font-family: 'JetBrains Mono', monospace;
    font-size: 12px;
    overflow: hidden;
  }
  .problems-toolbar {
    min-height: 32px;
    height: auto;
    padding: 4px 10px;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    background: #111215;
    border-bottom: 1px solid #1f2127;
    flex-shrink: 0;
  }
  .filter-pills {
    display: flex;
    gap: 4px;
  }
  .pill-btn {
    background: #18191e;
    border: 1px solid #262932;
    color: #8b8f98;
    padding: 2px 7px;
    border-radius: 4px;
    font-size: 11px;
    cursor: pointer;
    font-weight: 500;
  }
  .pill-btn:hover {
    color: #ffffff;
    background: #20222a;
  }
  .pill-btn.active {
    background: #242938;
    border-color: #3b5078;
    color: #8bb6ff;
  }
  .pill-btn.error.active {
    background: #351a1d;
    border-color: #5a262a;
    color: #f07a74;
  }
  .pill-btn.warning.active {
    background: #2e2617;
    border-color: #4f3e20;
    color: #e8b45a;
  }
  .problems-search {
    background: #16181d;
    border: 1px solid #282b35;
    border-radius: 4px;
    padding: 3px 8px;
    font-size: 11px;
    color: #e0e2e8;
    outline: none;
    min-width: 140px;
    flex-grow: 1;
    max-width: 280px;
    font-family: inherit;
  }
  .problems-search:focus {
    border-color: #569aff;
  }
  .nav-arrows {
    display: flex;
    gap: 3px;
  }
  .arrow-btn {
    background: transparent;
    border: 1px solid #2a2d36;
    color: #9da0ab;
    padding: 1px 4px;
    border-radius: 3px;
    font-size: 9px;
    cursor: pointer;
  }
  .arrow-btn:hover:not(:disabled) {
    background: #252830;
    color: #ffffff;
  }
  .arrow-btn:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }
  .clear-btn {
    background: transparent;
    border: 1px solid #2c2e35;
    border-radius: 4px;
    color: #8b8f98;
    padding: 2px 8px;
    font-size: 11px;
    cursor: pointer;
  }
  .clear-btn:hover {
    background: #23252b;
    color: #ffffff;
  }
  .spacer {
    flex-grow: 1;
  }
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    gap: 8px;
    color: #5b5f68;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  }
  .problems-list {
    padding: 6px 0;
    overflow-y: auto;
    flex: 1;
  }
  .file-group {
    margin-bottom: 8px;
  }
  .file-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 14px;
    font-size: 12px;
    font-weight: 600;
    color: #b9bcc3;
    background: #1a1b1f;
  }
  .file-name {
    color: #e6e7ea;
  }
  .file-path {
    font-size: 11px;
    color: #5b5f68;
    font-weight: normal;
  }
  .file-badge {
    margin-left: auto;
    font-size: 11px;
    padding: 1px 6px;
    border-radius: 10px;
    background: #23252b;
    color: #8b8f98;
  }
  .file-badge.is-error {
    background: #441e20;
    color: #f07a74;
  }
  .open-settings-btn {
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 4px;
    background: #232a38;
    border: 1px solid #374661;
    color: #8eb7ff;
    cursor: pointer;
    font-family: inherit;
  }
  .open-settings-btn:hover {
    background: #2e394d;
    color: #b9d3ff;
  }
  .file-items {
    display: flex;
    flex-direction: column;
  }
  .problem-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 4px 14px 4px 24px;
    cursor: pointer;
    line-height: 20px;
    user-select: none;
  }
  .problem-row:hover {
    background: #1c1d22;
  }
  .severity-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  .problem-text {
    flex-grow: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    display: flex;
    gap: 6px;
    align-items: center;
  }
  .problem-msg {
    color: #d8d9dc;
  }
  .problem-row.is-error .problem-msg {
    color: #f0a6a2;
  }
  .problem-row.is-warning .problem-msg {
    color: #e8c682;
  }
  .problem-source {
    font-size: 11px;
    color: #8b8f98;
    flex-shrink: 0;
  }
  .problem-loc {
    color: #8b8f98;
    font-size: 11px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .problem-loc-badge {
    background: #1a1c22;
    border: 1px solid #282a32;
    border-radius: 3px;
    padding: 1px 5px;
    font-size: 10.5px;
    color: #8f94a0;
  }
  .jump-link-action {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    font-size: 10.5px;
    color: #6ea8ff;
    padding: 1px 5px;
    border-radius: 3px;
    background: rgba(110, 168, 255, 0.08);
    border: 1px solid rgba(110, 168, 255, 0.25);
    cursor: pointer;
    transition: all 0.12s ease;
  }
  .problem-row:hover .jump-link-action {
    background: rgba(110, 168, 255, 0.22);
    border-color: #6ea8ff;
    color: #b3d3ff;
  }
</style>
