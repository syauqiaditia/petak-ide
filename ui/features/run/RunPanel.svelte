<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { runStore } from './runStore.svelte';
  import { formatAppState } from './logic';

  let outputContainer: HTMLDivElement;
  let userScrolledUp = false;

  let stateInfo = $derived(formatAppState(runStore.state));

  function handleScroll() {
    if (!outputContainer) return;
    const { scrollTop, scrollHeight, clientHeight } = outputContainer;
    // If within 30px of bottom, stick to bottom
    userScrolledUp = scrollHeight - (scrollTop + clientHeight) > 30;
  }

  $effect(() => {
    // Whenever outputLines changes, auto-scroll if user hasn't scrolled up
    if (runStore.outputLines.length && !userScrolledUp && outputContainer) {
      tick().then(() => {
        if (outputContainer && !userScrolledUp) {
          outputContainer.scrollTop = outputContainer.scrollHeight;
        }
      });
    }
  });

  onMount(() => {
    if (outputContainer) {
      outputContainer.scrollTop = outputContainer.scrollHeight;
    }
  });
</script>

<div class="run-panel">
  <!-- Toolbar -->
  <div class="toolbar">
    <div class="status-indicator">
      <span class="dot" style:background={stateInfo.dotColor}></span>
      <span class="status-label" style:color={stateInfo.color}>{stateInfo.label}</span>
      {#if runStore.selectedConfig && runStore.selectedDevice}
        <span class="config-target">
          ({runStore.selectedConfig.name} on {runStore.selectedDevice.name})
        </span>
      {/if}
      {#if runStore.lastReloadMs !== null && runStore.state === 'running'}
        <span class="reload-tag">⚡ {runStore.lastReloadMs}ms</span>
      {/if}
    </div>

    <div class="spacer"></div>

    <label class="setting-toggle" title="Auto hot-reload when saving files">
      <input
        type="checkbox"
        checked={runStore.hotReloadOnSave}
        onchange={(e) => runStore.setHotReloadOnSave((e.target as HTMLInputElement).checked)}
      />
      <span>Reload on save</span>
    </label>

    {#if runStore.devtoolsUri}
      <button
        class="devtools-btn"
        onclick={() => runStore.openDevTools()}
        title="Open Flutter DevTools in browser"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
          <polyline points="15 3 21 3 21 9"></polyline>
          <line x1="10" y1="14" x2="21" y2="3"></line>
        </svg>
        DevTools
      </button>
    {/if}

    <button
      class="action-btn restart-action-btn"
      onclick={() => runStore.restartDaemon()}
      title="Restart Flutter Daemon"
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"></path>
      </svg>
      Restart Flutter Daemon
    </button>

    <button
      class="action-btn restart-action-btn"
      onclick={() => runStore.restartConnection()}
      title="Restart connection"
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="23 4 23 10 17 10"></polyline>
        <polyline points="1 20 1 14 7 14"></polyline>
        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
      </svg>
      Restart connection
    </button>

    {#if runStore.state === 'running' || runStore.state === 'reloading'}
      <button
        class="action-btn reload-btn"
        onclick={() => runStore.reload(false)}
        title="Hot Reload"
        disabled={runStore.isReloading}
      >
        ⚡ Reload
      </button>

      <button
        class="action-btn restart-btn"
        onclick={() => runStore.hotRestart()}
        title="Hot Restart"
        disabled={runStore.isReloading}
      >
        🔄 Hot Restart
      </button>

      <button
        class="action-btn stop-btn"
        onclick={() => runStore.stopRun()}
        title="Stop"
      >
        ⏹ Stop
      </button>
    {/if}

    <button
      class="clear-btn"
      onclick={() => runStore.clearOutput()}
      title="Clear console output"
    >
      Clear
    </button>
  </div>

  <!-- Output console -->
  <div
    class="console-output"
    bind:this={outputContainer}
    onscroll={handleScroll}
  >
    {#if runStore.outputLines.length === 0}
      <div class="empty-output">
        {#if runStore.state === 'stopped'}
          Console output is empty. Press Run to start the application.
        {:else}
          Waiting for application output...
        {/if}
      </div>
    {:else}
      {#each runStore.outputLines as line (line.id)}
        <div class="log-line" class:stderr={line.stream === 'stderr'}>
          <span class="line-content">{line.line}</span>
        </div>
      {/each}
    {/if}
  </div>
</div>

<style>
  .run-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    width: 100%;
    background: #141518;
    overflow: hidden;
  }
  .toolbar {
    height: 32px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0 12px;
    border-bottom: 1px solid #222428;
    background: #141518;
  }
  .status-indicator {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
  }
  .dot {
    width: 6px;
    height: 6px;
    border-radius: 3px;
  }
  .status-label {
    font-weight: 500;
  }
  .config-target {
    color: #8b8f98;
    font-size: 11px;
  }
  .reload-tag {
    font-size: 11px;
    color: #e8b45a;
    background: #2e2717;
    padding: 1px 6px;
    border-radius: 4px;
    font-weight: 500;
  }
  .spacer {
    flex-grow: 1;
  }
  .setting-toggle {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    color: #8b8f98;
    cursor: pointer;
    user-select: none;
  }
  .setting-toggle input {
    cursor: pointer;
    accent-color: #6ea8ff;
  }
  .devtools-btn {
    display: flex;
    align-items: center;
    gap: 5px;
    height: 22px;
    padding: 0 8px;
    border-radius: 4px;
    background: #1f2a3d;
    color: #9cc3ff;
    border: 1px solid #2f4366;
    font-size: 11px;
    cursor: pointer;
    transition: background 0.15s;
  }
  .devtools-btn:hover {
    background: #273854;
  }
  .action-btn {
    height: 22px;
    padding: 0 8px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 500;
    cursor: pointer;
    border: none;
    transition: background 0.15s;
  }
  .reload-btn {
    background: #1f3325;
    color: #7fc98f;
    border: 1px solid #284431;
  }
  .reload-btn:hover:not(:disabled) {
    background: #284431;
  }
  .restart-btn {
    background: #1a2936;
    color: #6ea8ff;
    border: 1px solid #22374c;
  }
  .restart-btn:hover:not(:disabled) {
    background: #22374c;
  }
  .stop-btn {
    background: #2a1d1e;
    color: #f07a74;
    border: 1px solid #4a2629;
  }
  .stop-btn:hover {
    background: #4a2629;
  }
  .action-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .clear-btn {
    height: 22px;
    padding: 0 8px;
    border-radius: 4px;
    background: transparent;
    color: #8b8f98;
    border: 1px solid #2c2e34;
    font-size: 11px;
    cursor: pointer;
  }
  .clear-btn:hover {
    color: #d8d9dc;
    background: #1e2025;
  }
  .console-output {
    flex: 1;
    overflow-y: auto;
    padding: 8px 14px;
    display: flex;
    flex-direction: column;
    gap: 1px;
    font-family: 'JetBrains Mono', monospace;
    font-size: 12px;
    line-height: 20px;
    background: #141518;
  }
  .empty-output {
    color: #666a73;
    font-style: italic;
    padding: 12px 0;
  }
  .log-line {
    color: #d8d9dc;
    white-space: pre-wrap;
    word-break: break-all;
  }
  .log-line.stderr {
    color: #f07a74;
    background: rgba(240, 122, 116, 0.08);
  }
</style>
