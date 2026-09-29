<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { placeMenu, placeSubmenu } from './menuPos';

  export interface MenuItem {
    id?: string;
    label?: string;
    shortcut?: string;
    icon?: string;
    danger?: boolean;
    disabled?: boolean;
    disabledReason?: string;
    separator?: boolean;
    header?: boolean;
    items?: MenuItem[];
    action?: () => void;
  }

  let {
    x = 0,
    y = 0,
    title = '',
    items = [],
    onclose,
  } = $props<{
    x: number;
    y: number;
    title?: string;
    items: MenuItem[];
    onclose: () => void;
  }>();

  let menuEl: HTMLDivElement;
  let activeIndex = $state<number>(-1);
  let activeSubmenuIndex = $state<number>(-1);
  let submenuPos = $state<{ x: number; y: number }>({ x: 0, y: 0 });
  let menuPos = $state<{ x: number; y: number }>({ x: 0, y: 0 });
  let subMenuTimer: ReturnType<typeof setTimeout> | null = null;

  // Filter actionable items for keyboard navigation
  function isActionable(item: MenuItem): boolean {
    return !item.separator && !item.header && !item.disabled;
  }

  function recalculatePos() {
    if (!menuEl) return;
    const rect = menuEl.getBoundingClientRect();
    const vp = {
      w: typeof window !== 'undefined' ? window.innerWidth : 1024,
      h: typeof window !== 'undefined' ? window.innerHeight : 768,
    };
    menuPos = placeMenu({ x, y }, { w: rect.width || 240, h: rect.height || 300 }, vp);
  }

  onMount(() => {
    recalculatePos();

    function handlePointerDown(e: PointerEvent) {
      if (!menuEl) return;
      const target = e.target as HTMLElement;
      if (!target.closest('.context-menu-root')) {
        onclose();
      }
    }

    function handleScroll(e: Event) {
      const target = e.target as HTMLElement;
      if (!target.closest?.('.context-menu-root')) {
        onclose();
      }
    }

    function handleBlur() {
      onclose();
    }

    window.addEventListener('pointerdown', handlePointerDown, { capture: true });
    window.addEventListener('scroll', handleScroll, { capture: true, passive: true });
    window.addEventListener('resize', handleBlur);
    window.addEventListener('blur', handleBlur);

    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, { capture: true });
      window.removeEventListener('scroll', handleScroll, { capture: true });
      window.removeEventListener('resize', handleBlur);
      window.removeEventListener('blur', handleBlur);
      if (subMenuTimer) clearTimeout(subMenuTimer);
    };
  });

  $effect(() => {
    // When items or coordinates change, re-position
    x;
    y;
    items;
    tick().then(recalculatePos);
  });

  function openSubmenu(idx: number, itemEl: HTMLElement) {
    if (subMenuTimer) clearTimeout(subMenuTimer);
    activeSubmenuIndex = idx;
    const parentRect = menuEl.getBoundingClientRect();
    const itemRect = itemEl.getBoundingClientRect();
    const vp = {
      w: window.innerWidth,
      h: window.innerHeight,
    };
    submenuPos = placeSubmenu(
      { x: parentRect.left, y: parentRect.top, w: parentRect.width, h: parentRect.height },
      itemRect.top,
      { w: 220, h: 200 },
      vp
    );
  }

  function handleItemMouseEnter(idx: number, item: MenuItem, e: MouseEvent) {
    activeIndex = idx;
    if (item.items && item.items.length > 0 && !item.disabled) {
      if (subMenuTimer) clearTimeout(subMenuTimer);
      const target = e.currentTarget as HTMLElement;
      subMenuTimer = setTimeout(() => {
        openSubmenu(idx, target);
      }, 100);
    } else {
      if (subMenuTimer) clearTimeout(subMenuTimer);
      activeSubmenuIndex = -1;
    }
  }

  function handleItemClick(item: MenuItem) {
    if (item.disabled || item.separator || item.header) return;
    if (item.items && item.items.length > 0) return;
    onclose();
    item.action?.();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (activeSubmenuIndex !== -1) {
        activeSubmenuIndex = -1;
      } else {
        onclose();
      }
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      let next = activeIndex + 1;
      while (next < items.length && !isActionable(items[next])) {
        next++;
      }
      if (next < items.length) {
        activeIndex = next;
      } else {
        // wrap to first actionable
        const first = items.findIndex(isActionable);
        if (first !== -1) activeIndex = first;
      }
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      let prev = activeIndex - 1;
      while (prev >= 0 && !isActionable(items[prev])) {
        prev--;
      }
      if (prev >= 0) {
        activeIndex = prev;
      } else {
        // wrap to last actionable
        for (let i = items.length - 1; i >= 0; i--) {
          if (isActionable(items[i])) {
            activeIndex = i;
            break;
          }
        }
      }
      return;
    }

    if (e.key === 'ArrowRight') {
      if (activeIndex >= 0 && activeIndex < items.length) {
        const item = items[activeIndex];
        if (item.items && item.items.length > 0 && !item.disabled) {
          e.preventDefault();
          const itemEl = menuEl.querySelectorAll('.menu-item')[activeIndex] as HTMLElement;
          if (itemEl) openSubmenu(activeIndex, itemEl);
        }
      }
      return;
    }

    if (e.key === 'ArrowLeft') {
      if (activeSubmenuIndex !== -1) {
        e.preventDefault();
        activeSubmenuIndex = -1;
      }
      return;
    }

    if (e.key === 'Enter') {
      if (activeIndex >= 0 && activeIndex < items.length) {
        const item = items[activeIndex];
        if (isActionable(item)) {
          e.preventDefault();
          handleItemClick(item);
        }
      }
      return;
    }

    // Letter mnemonic navigation
    if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      const char = e.key.toLowerCase();
      const start = activeIndex + 1;
      for (let i = 0; i < items.length; i++) {
        const idx = (start + i) % items.length;
        const it = items[idx];
        if (isActionable(it) && it.label?.toLowerCase().startsWith(char)) {
          activeIndex = idx;
          break;
        }
      }
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="context-menu-root">
  <div
    bind:this={menuEl}
    class="context-menu"
    style="left: {menuPos.x}px; top: {menuPos.y}px;"
    role="menu"
    tabindex="-1"
  >
    {#if title}
      <div class="menu-header-label">{title}</div>
    {/if}

    {#each items as item, idx}
      {#if item.separator}
        <div class="menu-sep"></div>
      {:else if item.header}
        <div class="menu-header-label">{item.label}</div>
      {:else}
        <button
          class="menu-item"
          class:active-hover={activeIndex === idx}
          class:danger={item.danger}
          disabled={item.disabled}
          title={item.disabled ? item.disabledReason : undefined}
          onclick={() => handleItemClick(item)}
          onmouseenter={(e) => handleItemMouseEnter(idx, item, e)}
          role="menuitem"
        >
          {#if item.icon}
            <span class="menu-icon">
              {#if item.icon === 'file'}
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
              {:else if item.icon === 'folder'}
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"/></svg>
              {:else if item.icon === 'cut'}
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" y1="4" x2="8.12" y2="15.88"/><line x1="14.47" y1="14.48" x2="20" y2="20"/><line x1="8.12" y1="8.12" x2="12" y2="12"/></svg>
              {:else if item.icon === 'copy'}
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
              {:else if item.icon === 'paste'}
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></svg>
              {:else if item.icon === 'edit'}
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
              {:else if item.icon === 'trash'}
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
              {:else if item.icon === 'search'}
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              {:else if item.icon === 'git'}
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M6 9v12"/><path d="M18 9a9 9 0 00-9 9"/></svg>
              {:else if item.icon === 'clock'}
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              {:else if item.icon === 'diff'}
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="7" height="18" rx="1"/><rect x="14" y="3" width="7" height="18" rx="1"/></svg>
              {:else if item.icon === 'terminal'}
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>
              {:else if item.icon === 'external'}
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
              {:else if item.icon === 'refresh'}
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg>
              {/if}
            </span>
          {/if}
          <span class="menu-item-text">{item.label}</span>
          {#if item.shortcut}
            <span class="menu-shortcut">{item.shortcut}</span>
          {/if}
          {#if item.items && item.items.length > 0}
            <span class="menu-arrow">▸</span>
          {/if}
        </button>
      {/if}
    {/each}
  </div>

  <!-- Submenu Cascade -->
  {#if activeSubmenuIndex >= 0 && items[activeSubmenuIndex]?.items}
    {@const subItems = items[activeSubmenuIndex].items!}
    <div
      class="context-menu submenu-cascading"
      style="left: {submenuPos.x}px; top: {submenuPos.y}px;"
      role="menu"
      tabindex="-1"
      onmouseenter={() => {
        if (subMenuTimer) clearTimeout(subMenuTimer);
      }}
    >
      {#each subItems as subItem}
        {#if subItem.separator}
          <div class="menu-sep"></div>
        {:else}
          <button
            class="menu-item"
            class:danger={subItem.danger}
            disabled={subItem.disabled}
            title={subItem.disabled ? subItem.disabledReason : undefined}
            onclick={() => handleItemClick(subItem)}
            role="menuitem"
          >
            <span class="menu-item-text">{subItem.label}</span>
            {#if subItem.shortcut}
              <span class="menu-shortcut">{subItem.shortcut}</span>
            {/if}
          </button>
        {/if}
      {/each}
    </div>
  {/if}
</div>

<style>
  .context-menu-root {
    position: relative;
    z-index: 1000;
  }

  .context-menu {
    position: fixed;
    width: 240px;
    max-height: calc(100vh - 32px);
    overflow-y: auto;
    padding: 6px;
    background: #22242a;
    border: 1px solid #34363d;
    border-radius: 10px;
    box-shadow: 0 16px 40px rgba(0, 0, 0, 0.55);
    display: flex;
    flex-direction: column;
    gap: 1px;
    user-select: none;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  }

  .context-menu::-webkit-scrollbar {
    width: 4px;
  }

  .context-menu::-webkit-scrollbar-thumb {
    background: #34363d;
    border-radius: 4px;
  }

  .context-menu::-webkit-scrollbar-thumb:hover {
    background: #5b5f68;
  }

  .submenu-cascading {
    width: 220px;
    z-index: 1001;
  }

  .menu-header-label {
    padding: 4px 10px 6px;
    font-size: 11px;
    color: #8b8f98;
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .menu-item {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 26px;
    padding: 0 10px;
    border-radius: 5px;
    font-size: 12px;
    color: #d8d9dc;
    text-align: left;
    width: 100%;
    background: none;
    border: 0;
    cursor: pointer;
    transition: background 0.1s, color 0.1s;
    font-family: inherit;
  }

  .menu-item:hover:not(:disabled),
  .menu-item.active-hover:not(:disabled) {
    background: #2a3a55;
    color: #e6efff;
  }

  .menu-item:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }

  .menu-item.danger {
    color: #f0a6a2;
  }

  .menu-item.danger:hover:not(:disabled) {
    background: #3a2022;
    color: #f0a6a2;
  }

  .menu-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 14px;
    height: 14px;
    color: inherit;
    opacity: 0.85;
    flex-shrink: 0;
  }

  .menu-item-text {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .menu-shortcut {
    color: #8b8f98;
    font-size: 11px;
    margin-left: 8px;
    font-family: 'JetBrains Mono', monospace;
    flex-shrink: 0;
  }

  .menu-item:hover .menu-shortcut,
  .menu-item.active-hover .menu-shortcut {
    color: #9cc3ff;
  }

  .menu-arrow {
    color: #8b8f98;
    font-size: 10px;
    margin-left: 4px;
    flex-shrink: 0;
  }

  .menu-sep {
    height: 1px;
    background: #34363d;
    margin: 4px 6px;
    flex-shrink: 0;
  }
</style>
