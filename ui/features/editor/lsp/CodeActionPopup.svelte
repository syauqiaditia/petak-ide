<script lang="ts">
  import type { EditorView } from '@codemirror/view';
  import {
    codeActionState,
    applyCodeAction,
    triggerCodeActions,
    type CodeActionItem,
  } from './codeAction.svelte';

  let {
    getView,
  }: {
    getView: () => EditorView | null;
  } = $props();

  let popupContainer: HTMLDivElement | null = $state(null);

  function onKeyDown(e: KeyboardEvent) {
    if (!codeActionState.active || codeActionState.actions.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      e.stopPropagation();
      codeActionState.selectedIndex =
        (codeActionState.selectedIndex + 1) % codeActionState.actions.length;
      scrollToSelected();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      codeActionState.selectedIndex =
        (codeActionState.selectedIndex - 1 + codeActionState.actions.length) %
        codeActionState.actions.length;
      scrollToSelected();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      const current = codeActionState.actions[codeActionState.selectedIndex];
      if (current) {
        handleSelect(current);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      codeActionState.reset();
      getView()?.focus();
    }
  }

  function scrollToSelected() {
    requestAnimationFrame(() => {
      if (!popupContainer) return;
      const el = popupContainer.querySelector('.is-selected');
      if (el) {
        el.scrollIntoView({ block: 'nearest' });
      }
    });
  }

  function handleSelect(action: CodeActionItem) {
    const view = getView();
    if (view && codeActionState.path) {
      applyCodeAction(action, view, codeActionState.path);
    }
  }

  function onClickLightbulb(e: MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    const view = getView();
    if (view && codeActionState.path) {
      triggerCodeActions(view, codeActionState.path);
    }
  }
</script>

<svelte:window onkeydowncapture={onKeyDown} />

<!-- Lightbulb icon near cursor/line -->
{#if codeActionState.lightbulbVisible && !codeActionState.active}
  <button
    class="lightbulb-btn"
    style="left: {codeActionState.lightbulbCoords.left}px; top: {codeActionState.lightbulbCoords.top}px;"
    onclick={onClickLightbulb}
    title="Code Actions ({codeActionState.lightbulbActionsCount} available, Alt-Enter)"
    aria-label="Code Actions"
  >
    <svg width="14" height="14" viewBox="0 0 24 24" fill="#e8b45a" stroke="#e8b45a" stroke-width="1.5">
      <path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-7 7c0 2.5 1.5 4.5 3 6h8c1.5-1.5 3-3.5 3-6a7 7 0 0 0-7-7z" />
    </svg>
  </button>
{/if}

<!-- Code Actions floating popup list -->
{#if codeActionState.active && codeActionState.actions.length > 0}
  <!-- Backdrop click catcher -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="popup-backdrop"
    onclick={() => {
      codeActionState.reset();
      getView()?.focus();
    }}
  ></div>

  <div
    bind:this={popupContainer}
    class="code-action-popup"
    style="left: {codeActionState.coords.left}px; top: {codeActionState.coords.top}px;"
    role="menu"
    tabindex="-1"
  >
    <div class="popup-header">
      <span class="header-title">Code Actions</span>
      <span class="header-hint">↑↓ navigate · ⏎ apply · Esc close</span>
    </div>

    <div class="actions-list">
      {#each codeActionState.actions as action, i}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <div
          class="action-item"
          class:is-selected={i === codeActionState.selectedIndex}
          onclick={() => handleSelect(action)}
          onmouseenter={() => (codeActionState.selectedIndex = i)}
          role="menuitem"
          tabindex="-1"
        >
          <span class="action-icon">
            {#if action.category === 'quickfix'}
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#6ea8ff" stroke-width="2" stroke-linecap="round">
                <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
              </svg>
            {:else if action.category === 'refactor'}
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#e8b45a" stroke-width="2" stroke-linecap="round">
                <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                <line x1="12" y1="22.08" x2="12" y2="12" />
              </svg>
            {:else}
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#7fc98f" stroke-width="2" stroke-linecap="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            {/if}
          </span>

          <span class="action-title">{action.title}</span>

          {#if action.category === 'quickfix'}
            <span class="category-badge quickfix">quick fix</span>
          {:else if action.category === 'refactor'}
            <span class="category-badge refactor">refactor</span>
          {/if}
        </div>
      {/each}
    </div>
  </div>
{/if}

<style>
  .popup-backdrop {
    position: fixed;
    inset: 0;
    z-index: 899;
    background: transparent;
  }

  .lightbulb-btn {
    position: fixed;
    z-index: 850;
    width: 22px;
    height: 22px;
    display: grid;
    place-items: center;
    background: #2a2517;
    border: 1px solid #e8b45a44;
    border-radius: 4px;
    color: #e8b45a;
    cursor: pointer;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
    padding: 0;
    transition: transform 0.1s ease, background 0.15s ease;
  }

  .lightbulb-btn:hover {
    background: #3a321d;
    transform: scale(1.08);
  }

  .code-action-popup {
    position: fixed;
    z-index: 900;
    width: 360px;
    max-height: 320px;
    background: #22242a;
    border: 1px solid #34363d;
    border-radius: 10px;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    font-family: 'Geist', sans-serif;
  }

  .popup-header {
    height: 28px;
    padding: 0 12px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: #1d1f24;
    border-bottom: 1px solid #2f3137;
    font-size: 11px;
    color: #8b8f98;
    user-select: none;
  }

  .header-title {
    font-weight: 500;
    color: #b9bcc3;
  }

  .header-hint {
    font-size: 10.5px;
    color: #6a6e78;
  }

  .actions-list {
    max-height: 290px;
    overflow-y: auto;
    padding: 4px 0;
  }

  .action-item {
    height: 30px;
    padding: 0 12px;
    display: flex;
    align-items: center;
    gap: 9px;
    cursor: pointer;
    font-size: 12.5px;
    color: #d8d9dc;
    user-select: none;
    transition: background 0.08s ease;
  }

  .action-item:hover,
  .action-item.is-selected {
    background: #2a3547;
    color: #ffffff;
  }

  .action-icon {
    display: grid;
    place-items: center;
    flex-shrink: 0;
    width: 14px;
    height: 14px;
  }

  .action-title {
    flex-grow: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: 'JetBrains Mono', monospace;
    font-size: 12px;
  }

  .category-badge {
    font-size: 10px;
    padding: 1px 6px;
    border-radius: 4px;
    text-transform: lowercase;
    flex-shrink: 0;
  }

  .category-badge.quickfix {
    background: #1f2c40;
    color: #90b8f8;
  }

  .category-badge.refactor {
    background: #332b1a;
    color: #e8b45a;
  }
</style>
