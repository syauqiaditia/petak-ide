<script lang="ts">
  import { panelStore } from './panelStore.svelte';
  import { settingsStore } from '../features/settings/settingsStore.svelte';

  let {
    activeTab = $bindable('project'),
    onTabChange,
    onToggleAgents,
    isAgentsOpen = false,
  } = $props<{
    activeTab?: string;
    onTabChange?: (tab: string) => void;
    onToggleAgents?: () => void;
    isAgentsOpen?: boolean;
  }>();

  function selectTab(tab: string) {
    activeTab = tab;
    onTabChange?.(tab);
  }

  function handleAgentsClick() {
    if (onToggleAgents) {
      onToggleAgents();
    } else {
      selectTab('agents');
    }
  }
</script>

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

  <button
    class="rail-btn"
    class:active={isAgentsOpen || activeTab === 'agents'}
    onclick={handleAgentsClick}
    aria-label="Agents"
    title="AI Agents Panel (⌘6)"
  >
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round">
      <path d="M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2z"></path>
    </svg>
  </button>

  <div class="spacer"></div>

  <!-- Sun / Moon Quick Theme Toggle (Item 8) -->
  <button
    class="rail-btn theme-toggle-btn"
    onclick={() => settingsStore.toggleTheme()}
    aria-label="Toggle Theme"
    title={settingsStore.theme === 'dark' ? 'Switch to Light Theme' : 'Switch to Dark Theme'}
  >
    {#if settingsStore.theme === 'dark'}
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
        <circle cx="12" cy="12" r="5"></circle>
        <line x1="12" y1="1" x2="12" y2="3"></line>
        <line x1="12" y1="21" x2="12" y2="23"></line>
        <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
        <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
        <line x1="1" y1="12" x2="3" y2="12"></line>
        <line x1="21" y1="12" x2="23" y2="12"></line>
        <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
        <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
      </svg>
    {:else}
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
      </svg>
    {/if}
  </button>

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
</style>
