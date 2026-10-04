<script lang="ts">
  import type { RightPanelId } from './panelExclusivity';
  import { settingsStore } from '../features/settings/settingsStore.svelte';

  let {
    activeRight = null,
    onToggleAgent,
    onToggleMemory,
    onToggleMirror,
    onToggleDevices,
  } = $props<{
    activeRight?: RightPanelId;
    onToggleAgent?: () => void;
    onToggleMemory?: () => void;
    onToggleMirror?: () => void;
    onToggleDevices?: () => void;
  }>();
</script>

<div class="right-rail">
  <!-- 1. AI Agents (⌘6) -->
  <button
    class="right-rail-btn"
    class:active={activeRight === 'agent'}
    onclick={onToggleAgent}
    aria-label="AI Agents"
    title="AI Agents (⌘6)"
  >
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round">
      <path d="M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2z"></path>
    </svg>
    <span class="right-rail-indicator" class:visible={activeRight === 'agent'}></span>
  </button>

  <!-- 2. Project Memory & Obsidian (⌘M) -->
  <button
    class="right-rail-btn"
    class:active={activeRight === 'memory'}
    onclick={onToggleMemory}
    aria-label="Project Memory & Obsidian"
    title="Project Memory & Obsidian (⌘M)"
  >
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path>
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path>
      <line x1="8" y1="6" x2="16" y2="6"></line>
      <line x1="8" y1="10" x2="14" y2="10"></line>
    </svg>
    <span class="right-rail-indicator" class:visible={activeRight === 'memory'}></span>
  </button>

  <!-- 3. Device Mirror (⇧⌘D) -->
  <button
    class="right-rail-btn"
    class:active={activeRight === 'mirror'}
    onclick={onToggleMirror}
    aria-label="Device Mirror"
    title="Device Mirror (⇧⌘D)"
  >
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <rect x="5" y="2" width="14" height="20" rx="3"></rect>
      <path d="M10 18h4"></path>
    </svg>
    <span class="right-rail-indicator" class:visible={activeRight === 'mirror'}></span>
  </button>

  <!-- 4. Devices & Emulators (⌘D) -->
  <button
    class="right-rail-btn"
    class:active={activeRight === 'devices'}
    onclick={onToggleDevices}
    aria-label="Devices & Emulators"
    title="Devices & Emulators (⌘D)"
  >
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <rect x="4" y="4" width="16" height="12" rx="2"></rect>
      <path d="M12 16v4"></path>
      <path d="M8 20h8"></path>
    </svg>
    <span class="right-rail-indicator" class:visible={activeRight === 'devices'}></span>
  </button>

  <div class="spacer"></div>

  <!-- Settings Gear (Bottom) -->
  <button
    class="right-rail-btn settings-btn"
    class:active={settingsStore.isOpen}
    onclick={() => settingsStore.open()}
    aria-label="Settings"
    title="Settings (⌘,)"
  >
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="3"></circle>
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
    </svg>
  </button>
</div>

<style>
  .right-rail {
    width: 44px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding-top: 8px;
    padding-bottom: 8px;
    background: #111215;
    border-left: 1px solid #26282d;
    user-select: none;
    -webkit-user-select: none;
    z-index: 10;
  }
  .right-rail-btn {
    position: relative;
    width: 34px;
    height: 34px;
    border-radius: 7px;
    display: grid;
    place-items: center;
    color: #8b8f98;
    background: transparent;
    border: none;
    cursor: pointer;
    transition: all 0.15s;
  }
  .right-rail-btn:hover {
    color: #d8d9dc;
    background: #1a1b1f;
  }
  .right-rail-btn.active {
    background: #23252b;
    color: #58a6ff;
  }
  .right-rail-indicator {
    position: absolute;
    right: -5px;
    top: 50%;
    transform: translateY(-50%);
    width: 3px;
    height: 16px;
    border-radius: 2px;
    background: #58a6ff;
    display: none;
  }
  .right-rail-indicator.visible {
    display: block;
  }
  .spacer {
    flex-grow: 1;
  }
</style>
