<script lang="ts">
  import { panelStore } from './panelStore.svelte';
  import { settingsStore } from '../features/settings/settingsStore.svelte';
  import { TOOL_WINDOWS_SVG } from '../icons';

  let {
    activeTab = $bindable('project'),
    onTabChange,
    onToggleAgents,
    isAgentsOpen = false,
    onOpenTerminal,
    onOpenRun,
    onOpenLogcat,
    onOpenProblems,
    onToggleDevices,
    onToggleMirror,
    onSelectRailTab,
  } = $props<{
    activeTab?: string;
    onTabChange?: (tab: string) => void;
    onToggleAgents?: () => void;
    isAgentsOpen?: boolean;
    onOpenTerminal?: () => void;
    onOpenRun?: () => void;
    onOpenLogcat?: () => void;
    onOpenProblems?: () => void;
    onToggleDevices?: () => void;
    onToggleMirror?: () => void;
    onSelectRailTab?: (tab: string) => void;
  }>();

  let isToolWindowsOpen = $state(false);

  function selectTab(tab: string) {
    activeTab = tab;
    onTabChange?.(tab);
    onSelectRailTab?.(tab);
  }

  function handleAgentsClick() {
    if (onToggleAgents) {
      onToggleAgents();
    } else {
      selectTab('agents');
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === '0') {
      e.preventDefault();
      isToolWindowsOpen = !isToolWindowsOpen;
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="rail">
  <button
    class="rail-btn"
    class:active={activeTab === 'project'}
    onclick={() => selectTab('project')}
    aria-label="Project"
    title="Project"
  >
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round">
      <path d="M3 5h7l2 2h9v12H3z"></path>
    </svg>
  </button>

  <button
    class="rail-btn"
    class:active={activeTab === 'git'}
    onclick={() => selectTab('git')}
    aria-label="Git"
    title="Git"
  >
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
      <circle cx="6" cy="5" r="2"></circle>
      <circle cx="6" cy="19" r="2"></circle>
      <circle cx="18" cy="7" r="2"></circle>
      <path d="M6 7v10M18 9c0 5-6 4-12 8"></path>
    </svg>
  </button>

  <button
    class="rail-btn"
    class:active={activeTab === 'mr'}
    onclick={() => selectTab('mr')}
    aria-label="Merge Requests"
    title="GitLab Merge Requests (⌘5)"
  >
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="18" cy="18" r="3"></circle>
      <circle cx="6" cy="6" r="3"></circle>
      <path d="M13 6h3a2 2 0 0 1 2 2v7"></path>
      <line x1="6" y1="9" x2="6" y2="21"></line>
    </svg>
  </button>

  <div class="spacer"></div>

  <!-- Tool Windows Quick Menu Button -->
  <button
    class="rail-btn tool-windows-btn"
    class:active={isToolWindowsOpen}
    onclick={() => (isToolWindowsOpen = !isToolWindowsOpen)}
    aria-label="Tool Windows Quick Menu"
    aria-haspopup="true"
    title="Tool Windows (⌘0)"
  >
    <span class="rail-icon-svg">{@html TOOL_WINDOWS_SVG}</span>
  </button>

  {#if isToolWindowsOpen}
    <div class="tw-backdrop" onclick={() => (isToolWindowsOpen = false)} role="presentation">
      <div
        class="tw-popup"
        onclick={(e) => e.stopPropagation()}
        role="menu"
        tabindex="-1"
      >
        <div class="tw-group-title">PANEL UTAMA</div>
        <button class="tw-menu-btn" onclick={() => { isToolWindowsOpen = false; selectTab('project'); }}>
          <span class="tw-shortcut-badge">1</span>
          <span class="tw-emoji">📁</span>
          <span class="tw-name">Project Explorer</span>
          <span class="tw-kbd">⌘1</span>
        </button>
        <button class="tw-menu-btn" onclick={() => { isToolWindowsOpen = false; selectTab('git'); }}>
          <span class="tw-shortcut-badge">2</span>
          <span class="tw-emoji">🌿</span>
          <span class="tw-name">Git Source Control</span>
          <span class="tw-kbd">⌘2</span>
        </button>
        <button class="tw-menu-btn" onclick={() => { isToolWindowsOpen = false; selectTab('mr'); }}>
          <span class="tw-shortcut-badge">3</span>
          <span class="tw-emoji">🔀</span>
          <span class="tw-name">GitLab Merge Requests</span>
          <span class="tw-kbd">⌘5</span>
        </button>
        <button class="tw-menu-btn" onclick={() => { isToolWindowsOpen = false; handleAgentsClick(); }}>
          <span class="tw-shortcut-badge">4</span>
          <span class="tw-emoji">✨</span>
          <span class="tw-name">AI Agents Panel</span>
          <span class="tw-kbd">⌘6</span>
        </button>
        <button class="tw-menu-btn" onclick={() => { isToolWindowsOpen = false; onToggleMirror?.(); }}>
          <span class="tw-shortcut-badge">5</span>
          <span class="tw-emoji">📱</span>
          <span class="tw-name">Device Mirror Dock</span>
          <span class="tw-kbd">⌘⇧D</span>
        </button>

        <div class="tw-sep"></div>

        <div class="tw-group-title">PANEL BAWAH</div>
        <button class="tw-menu-btn" onclick={() => { isToolWindowsOpen = false; onOpenTerminal?.(); }}>
          <span class="tw-shortcut-badge">T</span>
          <span class="tw-emoji">💻</span>
          <span class="tw-name">Terminal</span>
          <span class="tw-kbd">⌃`</span>
        </button>
        <button class="tw-menu-btn" onclick={() => { isToolWindowsOpen = false; onOpenRun?.(); }}>
          <span class="tw-shortcut-badge">R</span>
          <span class="tw-emoji">⚡</span>
          <span class="tw-name">Run / Build Output</span>
          <span class="tw-kbd">⌘4</span>
        </button>
        <button class="tw-menu-btn" onclick={() => { isToolWindowsOpen = false; onOpenLogcat?.(); }}>
          <span class="tw-shortcut-badge">L</span>
          <span class="tw-emoji">📋</span>
          <span class="tw-name">Logcat Device Logs</span>
        </button>
        <button class="tw-menu-btn" onclick={() => { isToolWindowsOpen = false; onOpenProblems?.(); }}>
          <span class="tw-shortcut-badge">P</span>
          <span class="tw-emoji">⚠️</span>
          <span class="tw-name">Problems & Diagnostics</span>
        </button>
        <button class="tw-menu-btn" onclick={() => { isToolWindowsOpen = false; onToggleDevices?.(); }}>
          <span class="tw-shortcut-badge">D</span>
          <span class="tw-emoji">📱</span>
          <span class="tw-name">Devices & Emulators</span>
        </button>
      </div>
    </div>
  {/if}

  <!-- Settings Gear Button (Item 7 & 8) -->
  <button
    class="rail-btn settings-btn"
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
  .rail {
    width: 48px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding-top: 8px;
    background: #111215;
    border-right: 1px solid #26282d;
    user-select: none;
    -webkit-user-select: none;
  }
  .rail-btn {
    width: 36px;
    height: 36px;
    border-radius: 8px;
    display: grid;
    place-items: center;
    color: #8b8f98;
    transition: all 0.15s;
  }
  .rail-btn:hover {
    color: #d8d9dc;
    background: #1a1b1f;
  }
  .rail-btn.active {
    background: #23252b;
    color: #e6e7ea;
  }
  .spacer {
    flex-grow: 1;
  }
  .settings-btn {
    margin-bottom: 8px;
  }
  .rail-icon-svg {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
  }
  .tw-backdrop {
    position: fixed;
    inset: 0;
    z-index: 999;
  }
  .tw-popup {
    position: absolute;
    left: 54px;
    bottom: 50px;
    width: 230px;
    background: #1c1d22;
    border: 1px solid #26282d;
    border-radius: 10px;
    box-shadow: 0 12px 30px rgba(0, 0, 0, 0.55);
    padding: 6px 4px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    z-index: 1000;
  }
  .tw-group-title {
    font-size: 10px;
    font-weight: 700;
    color: #6b707d;
    letter-spacing: 0.6px;
    padding: 6px 10px 4px 10px;
  }
  .tw-menu-btn {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 30px;
    padding: 0 8px;
    border-radius: 6px;
    background: transparent;
    border: none;
    color: #bcbec4;
    font-size: 12.5px;
    cursor: pointer;
    text-align: left;
    transition: background 0.1s;
    width: 100%;
    box-sizing: border-box;
  }
  .tw-menu-btn:hover {
    background: #262830;
    color: #ffffff;
  }
  .tw-shortcut-badge {
    width: 16px;
    height: 16px;
    border-radius: 3px;
    background: #22242b;
    border: 1px solid #2c2e36;
    color: #8b8f98;
    font-size: 10px;
    font-weight: 600;
    display: grid;
    place-items: center;
    flex-shrink: 0;
  }
  .tw-emoji {
    font-size: 13px;
    flex-shrink: 0;
  }
  .tw-name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tw-kbd {
    font-size: 10.5px;
    color: #6b707d;
    background: #16171b;
    padding: 1px 5px;
    border-radius: 4px;
    font-family: inherit;
    flex-shrink: 0;
  }
  .tw-sep {
    height: 1px;
    background: #26282d;
    margin: 4px 6px;
  }
</style>
