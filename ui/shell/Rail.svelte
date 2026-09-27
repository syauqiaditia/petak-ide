<script lang="ts">
  let activeTab = $state('project');
</script>

<div class="rail">
  <button
    class="rail-btn"
    class:active={activeTab === 'project'}
    onclick={() => (activeTab = 'project')}
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
    onclick={() => (activeTab = 'git')}
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
    class:active={activeTab === 'agents'}
    onclick={() => (activeTab = 'agents')}
    aria-label="Agents"
    title="Agents"
  >
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round">
      <path d="M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2z"></path>
    </svg>
  </button>

  <button
    class="rail-btn"
    class:active={activeTab === 'devices'}
    onclick={() => (activeTab = 'devices')}
    aria-label="Devices"
    title="Devices"
  >
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
      <rect x="7" y="3" width="10" height="18" rx="2"></rect>
      <path d="M11 18h2"></path>
    </svg>
  </button>

  <div class="spacer"></div>

  <button
    class="rail-btn settings-btn"
    class:active={activeTab === 'settings'}
    onclick={() => (activeTab = 'settings')}
    aria-label="Settings"
    title="Settings"
  >
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
      <circle cx="12" cy="12" r="3"></circle>
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2"></path>
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
