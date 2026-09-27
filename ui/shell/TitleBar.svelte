<script lang="ts">
  let { projectName = 'petak', branchName = 'main', onPickFolder } = $props<{
    projectName?: string;
    branchName?: string;
    onPickFolder?: () => void;
  }>();
</script>

<div class="titlebar" data-tauri-drag-region>
  <!-- macOS window control spacer -->
  <div class="traffic-lights-spacer" data-tauri-drag-region></div>

  <!-- Brand logo & name -->
  <div class="brand">
    <div class="brand-icon">
      <div class="grid-cell"></div>
      <div class="grid-cell dim"></div>
      <div class="grid-cell dim"></div>
      <div class="grid-cell"></div>
    </div>
    <span class="brand-text">Petak</span>
  </div>

  <div class="divider"></div>

  <!-- Project selector -->
  <button class="project-btn" onclick={onPickFolder} title="Click to open or switch folder">
    <span>{projectName}</span>
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8b8f98" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M6 9l6 6 6-6"></path>
    </svg>
  </button>

  <!-- Branch -->
  <button class="branch-btn" title="Git Branch">
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="6" cy="5" r="2"></circle>
      <circle cx="6" cy="19" r="2"></circle>
      <circle cx="18" cy="7" r="2"></circle>
      <path d="M6 7v10M18 9c0 5-6 4-12 8"></path>
    </svg>
    <span>{branchName}</span>
    <span class="branch-badge">↑1</span>
  </button>

  <div class="spacer" data-tauri-drag-region></div>

  <!-- Run config (mocked as in Main.html) -->
  <div class="run-config">
    <button class="run-target">
      <span class="target-tag">AND</span>
      <span>app</span>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8b8f98" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"></path></svg>
    </button>
    <div class="divider-subtle"></div>
    <button class="run-device">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="7" y="3" width="10" height="18" rx="2"></rect><path d="M11 18h2"></path></svg>
      <span>Pixel 8 · API 35</span>
      <span class="device-dot"></span>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8b8f98" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"></path></svg>
    </button>
  </div>

  <button class="action-btn" aria-label="Sync Gradle" title="Sync">
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5"></path></svg>
  </button>
  <button class="action-btn run-btn" aria-label="Run" title="Run">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M7 5l12 7-12 7z"></path></svg>
  </button>
  <button class="action-btn" aria-label="Debug" title="Debug">
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="7" width="8" height="12" rx="4"></rect><path d="M12 7V4M4 13h4M16 13h4M5 8l3 2M19 8l-3 2M5 18l3-2M19 18l-3-2"></path></svg>
  </button>
  <button class="action-btn stop-btn" aria-label="Stop" title="Stop">
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="5" width="14" height="14" rx="2"></rect></svg>
  </button>

  <div class="spacer" data-tauri-drag-region></div>

  <!-- Search -->
  <button class="search-btn">
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="6"></circle><path d="M20 20l-4.5-4.5"></path></svg>
    <span>Search everywhere</span>
    <span class="search-shortcut">⇧⇧</span>
  </button>

  <!-- User Avatar -->
  <div class="avatar" title="User: UQi">U</div>
</div>

<style>
  .titlebar {
    height: 46px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0 12px 0 12px;
    background: #111215;
    border-bottom: 1px solid #26282d;
    user-select: none;
    -webkit-user-select: none;
  }
  .traffic-lights-spacer {
    width: 68px;
    height: 100%;
    flex-shrink: 0;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .brand-icon {
    width: 20px;
    height: 20px;
    border-radius: 5px;
    background: #6ea8ff;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 2px;
    padding: 4px;
    box-sizing: border-box;
  }
  .grid-cell {
    background: #111215;
    border-radius: 1px;
  }
  .grid-cell.dim {
    opacity: 0.4;
  }
  .brand-text {
    font-weight: 600;
    letter-spacing: 0.2px;
    color: #e6e7ea;
  }
  .divider {
    width: 1px;
    height: 18px;
    background: #2c2e34;
  }
  .divider-subtle {
    width: 1px;
    height: 18px;
    background: #2c2e34;
  }
  .project-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 30px;
    padding: 0 10px;
    border-radius: 7px;
    font-weight: 500;
    color: #d8d9dc;
    transition: background 0.15s;
  }
  .project-btn:hover {
    background: #1e2025;
  }
  .branch-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 30px;
    padding: 0 10px;
    border-radius: 7px;
    color: #b9bcc3;
    transition: background 0.15s;
  }
  .branch-btn:hover {
    background: #1e2025;
  }
  .branch-badge {
    color: #7fc98f;
    font-size: 11px;
    font-weight: 500;
  }
  .spacer {
    flex-grow: 1;
    height: 100%;
  }
  .run-config {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 3px;
    border: 1px solid #2c2e34;
    border-radius: 9px;
    background: #17181c;
  }
  .run-target, .run-device {
    display: flex;
    align-items: center;
    gap: 7px;
    height: 28px;
    padding: 0 8px;
    border-radius: 6px;
    font-size: 12px;
  }
  .target-tag {
    font-size: 10px;
    font-weight: 600;
    color: #101114;
    background: #7fc98f;
    border-radius: 4px;
    padding: 1px 5px;
  }
  .device-dot {
    width: 7px;
    height: 7px;
    border-radius: 4px;
    background: #7fc98f;
  }
  .action-btn {
    width: 32px;
    height: 32px;
    border-radius: 8px;
    display: grid;
    place-items: center;
    color: #b9bcc3;
    transition: background 0.15s;
  }
  .action-btn:hover {
    background: #23252b;
  }
  .run-btn {
    background: #1f3325;
    color: #7fc98f;
  }
  .run-btn:hover {
    background: #284431;
  }
  .stop-btn {
    color: #f07a74;
  }
  .search-btn {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 30px;
    padding: 0 12px;
    border-radius: 7px;
    border: 1px solid #2c2e34;
    color: #8b8f98;
    width: 190px;
    background: #16171a;
  }
  .search-shortcut {
    margin-left: auto;
    font-size: 11px;
    color: #666a73;
  }
  .avatar {
    width: 28px;
    height: 28px;
    border-radius: 14px;
    background: #2a3a55;
    color: #9cc3ff;
    display: grid;
    place-items: center;
    font-size: 11px;
    font-weight: 600;
  }
</style>
