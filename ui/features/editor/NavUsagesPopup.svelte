<script lang="ts">
  import { navPopupStore, type UsageItem } from './lsp/nav.svelte';
  import { tabsManager } from './tabs.svelte';
  import { api } from '../../lib/api';

  let {
    gotoLineFn = () => {},
  }: {
    gotoLineFn: (line: number, col: number, options?: { center?: boolean }) => void;
  } = $props();

  async function handleSelect(item: UsageItem) {
    const existing = tabsManager.tabs.find((t) => t.path === item.path);
    if (existing) {
      tabsManager.setActive(item.path);
    } else {
      try {
        const content = await api.readFile(item.path);
        tabsManager.openTab(item.path, item.name, content);
      } catch (err) {
        console.error('Failed to open file:', item.path, err);
      }
    }

    setTimeout(() => {
      gotoLineFn(item.line, item.col, { center: true });
    }, 50);

    navPopupStore.close();
  }

  function handleBackdropClick() {
    navPopupStore.close();
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      navPopupStore.close();
    }
  }
</script>

<svelte:window onkeydown={handleKeyDown} />

{#if navPopupStore.isOpen}
  <!-- Backdrop for click outside -->
  <div class="nav-popup-backdrop" onclick={handleBackdropClick} role="presentation">
    {#if navPopupStore.kind === 'tooltip'}
      <div
        class="nav-tooltip"
        style="left: {Math.max(10, Math.min(navPopupStore.x, window.innerWidth - 220))}px; top: {Math.max(10, navPopupStore.y - 36)}px;"
        role="tooltip"
      >
        <span class="tooltip-icon">ℹ️</span>
        <span class="tooltip-text">{navPopupStore.message || 'tidak terpakai (0 usages)'}</span>
      </div>
    {:else}
      <!-- Dropdown Usages -->
      <div
        class="nav-dropdown"
        class:is-public={!navPopupStore.isPrivate}
        style="left: {Math.max(10, Math.min(navPopupStore.x, window.innerWidth - 380))}px; top: {Math.min(navPopupStore.y + 12, window.innerHeight - 300)}px;"
        onclick={(e) => e.stopPropagation()}
        role="dialog"
        tabindex="-1"
      >
        <div class="dropdown-header">
          <span class="header-title">
            Usages of <code>{navPopupStore.symbol}</code>
          </span>
          <span class="header-badge">{navPopupStore.items.length}</span>
          <button type="button" class="close-btn" onclick={() => navPopupStore.close()} title="Close">✕</button>
        </div>

        <div class="dropdown-list">
          {#each navPopupStore.items as item}
            <div
              class="usage-row"
              onclick={() => handleSelect(item)}
              role="button"
              tabindex="0"
              onkeydown={(e) => { if (e.key === 'Enter') handleSelect(item); }}
            >
              <div class="usage-meta">
                <span class="file-name">{item.name}</span>
                <span class="line-badge">:{item.line}</span>
              </div>

              {#if navPopupStore.isPrivate}
                <!-- Private: compact single line -->
                <div class="usage-snippet single-line">{item.text}</div>
              {:else}
                <!-- Public: 2-3 lines preview -->
                <div class="usage-snippet multiline">
                  {#if item.previewLines && item.previewLines.length > 0}
                    {#each item.previewLines as pl}
                      <div class="preview-line">{pl}</div>
                    {/each}
                  {:else}
                    <div class="preview-line">{item.text}</div>
                  {/if}
                </div>
              {/if}
            </div>
          {/each}
        </div>
      </div>
    {/if}
  </div>
{/if}

<style>
  .nav-popup-backdrop {
    position: fixed;
    inset: 0;
    z-index: 9999;
    background: transparent;
  }
  .nav-tooltip {
    position: fixed;
    background: #1e1f22;
    border: 1px solid #3c3f41;
    color: #dfe1e5;
    padding: 4px 10px;
    border-radius: 4px;
    font-size: 11px;
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.4);
    display: flex;
    align-items: center;
    gap: 6px;
    pointer-events: none;
    z-index: 10000;
  }
  .tooltip-icon {
    font-size: 12px;
  }
  .nav-dropdown {
    position: fixed;
    background: #1e1f22;
    border: 1px solid #2b2d30;
    border-radius: 6px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.55);
    width: 360px;
    max-height: 280px;
    display: flex;
    flex-direction: column;
    z-index: 10000;
    overflow: hidden;
  }
  .nav-dropdown.is-public {
    width: 440px;
    max-height: 360px;
  }
  .dropdown-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 10px;
    background: #25272b;
    border-bottom: 1px solid #2b2d30;
    font-size: 12px;
  }
  .header-title {
    color: #dfe1e5;
    font-weight: 500;
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .header-title code {
    color: #6ea8ff;
    font-size: 11px;
  }
  .header-badge {
    background: #2e436e;
    color: #8bb7ff;
    font-size: 10px;
    padding: 1px 6px;
    border-radius: 10px;
    font-weight: 600;
  }
  .close-btn {
    background: transparent;
    border: none;
    color: #8b8f98;
    cursor: pointer;
    font-size: 11px;
    padding: 2px 4px;
    border-radius: 3px;
  }
  .close-btn:hover {
    color: #ffffff;
    background: #36383e;
  }
  .dropdown-list {
    overflow-y: auto;
    padding: 4px 0;
  }
  .usage-row {
    padding: 6px 10px;
    cursor: pointer;
    border-bottom: 1px solid #25272b;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .usage-row:last-child {
    border-bottom: none;
  }
  .usage-row:hover {
    background: #2b2d30;
  }
  .usage-meta {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
  }
  .file-name {
    color: #a8adbd;
    font-weight: 500;
  }
  .line-badge {
    color: #6e7681;
    font-size: 10px;
  }
  .usage-snippet {
    font-family: 'JetBrains Mono', monospace;
    font-size: 11px;
    color: #bcbec4;
    white-space: pre;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .usage-snippet.multiline {
    background: #141517;
    border: 1px solid #26282d;
    border-radius: 3px;
    padding: 4px 6px;
    line-height: 16px;
  }
  .preview-line {
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
