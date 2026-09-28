<script lang="ts">
  import { diagnosticsStore, type FileDiagnostic } from '../editor/lsp/diagnostics.svelte';

  let {
    onSelectProblem = (_path: string, _line: number, _col: number) => {},
  } = $props<{
    onSelectProblem?: (path: string, line: number, col: number) => void;
  }>();

  // Grouped by file
  let fileEntries = $derived.by(() => {
    const entries: { path: string; filename: string; diags: FileDiagnostic[] }[] = [];
    for (const [path, diags] of diagnosticsStore.byFile.entries()) {
      if (diags.length > 0) {
        const filename = path.split('/').filter(Boolean).pop() || path;
        entries.push({ path, filename, diags });
      }
    }
    return entries;
  });
</script>

<div class="problems-panel">
  {#if fileEntries.length === 0}
    <div class="empty-state">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#5b5f68" stroke-width="1.5" stroke-linecap="round">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
        <polyline points="22 4 12 14.01 9 11.01"></polyline>
      </svg>
      <span>No problems have been detected in the workspace</span>
    </div>
  {:else}
    <div class="problems-list">
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
                  {file.filename}:{diag.line}:{diag.col}
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
    overflow-y: auto;
    background: #141518;
    color: #d8d9dc;
    font-family: 'JetBrains Mono', monospace;
    font-size: 12px;
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
  }
</style>
