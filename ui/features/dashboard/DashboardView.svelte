<script lang="ts">
  import { onMount } from 'svelte';
  import { api, type RecentProject, type KotlinLsProgress, type UnlistenFn } from '../../lib/api';
  import { toolchainStore } from '../toolchain/toolchainStore.svelte';
  import { runStore } from '../run/runStore.svelte';
  import { settingsStore } from '../settings/settingsStore.svelte';

  let {
    onOpenFolder = () => {},
    onSelectProject = () => {},
    onOpenSettings = () => settingsStore.open(),
  }: {
    onOpenFolder?: () => void;
    onSelectProject?: (path: string) => void;
    onOpenSettings?: () => void;
  } = $props();

  let recentList = $state<RecentProject[]>([]);
  let searchQuery = $state('');
  let pinnedPaths = $state<Set<string>>(new Set());

  // Doctor state
  let isInstallingKotlin = $state(false);
  let kotlinProgress = $state<KotlinLsProgress | null>(null);
  let kotlinInstalled = $state(false);
  let scrcpyModalOpen = $state(false);
  let copiedSnippet = $state<string | null>(null);

  const i18n = {
    id: {
      heroSub: 'Native Flutter & Mobile Engineering IDE Ringan & Cepat',
      actOpen: 'Buka Folder',
      actOpenDesc: 'Buka workspace Flutter, Android, atau multiplatform yang ada di disk',
      actNew: 'Project Baru',
      actNewDesc: 'Buat boilerplate Flutter app, Dart package, atau modul native baru',
      actClone: 'Clone Git',
      actCloneDesc: 'Clone repository dari GitLab Bank Jatim atau GitHub via URL / SSH',
      recentsTitle: 'PROYEK TERAKHIR',
      docTitle: 'Toolchain Doctor',
      docSub: 'Deteksi otomatis compiler, SDK & tools emulator',
      btnRecheck: 'Pindai',
      btnInstallKls: 'Install 1-Click',
      btnInstalling: 'Memasang…',
      btnScrcpyGuide: 'Panduan Install',
      docFooterLink: 'Buka Pengaturan Toolchain (⌘,)',
      prefTitle: 'Personalisasi Cepat',
      prefTheme: 'Tema Warna',
      prefThemeDesc: 'Gelap (OLED JetBrains) atau Terang',
      prefLang: 'Bahasa Tampilan',
      prefLangDesc: 'Pilihan lokalisasi antarmuka IDE',
      prefReopen: 'Buka Proyek Terakhir Otomatis',
      prefReopenDesc: 'Langsung ke editor saat Petak dibuka',
      copied: 'Tersalin!',
      copy: 'Salin',
      allReady: 'Semua Siap',
      needAction: 'Perlu Tindakan',
      toolsConfigured: 'tools terkonfigurasi',
      notConfigured: 'Belum terpasang',
      optional: 'Opsional',
    },
    en: {
      heroSub: 'Fast, lightweight native Flutter & mobile engineering IDE',
      actOpen: 'Open Folder',
      actOpenDesc: 'Open an existing Flutter, Android, or multiplatform workspace from disk',
      actNew: 'New Project',
      actNewDesc: 'Generate a clean Flutter app, Dart package, or native module boilerplate',
      actClone: 'Clone Git',
      actCloneDesc: 'Clone repository from Bank Jatim GitLab or GitHub via URL or SSH',
      recentsTitle: 'RECENT PROJECTS',
      docTitle: 'Toolchain Doctor',
      docSub: 'Automated health-check for compilers, SDKs, and emulators',
      btnRecheck: 'Scan',
      btnInstallKls: 'Install 1-Click',
      btnInstalling: 'Installing…',
      btnScrcpyGuide: 'Setup Guide',
      docFooterLink: 'Open Toolchain Settings (⌘,)',
      prefTitle: 'Quick Personalization',
      prefTheme: 'Color Theme',
      prefThemeDesc: 'Dark (OLED JetBrains) or Light mode',
      prefLang: 'Interface Language',
      prefLangDesc: 'Localized display language for IDE',
      prefReopen: 'Reopen Last Project on Launch',
      prefReopenDesc: 'Jump straight into editor on Petak startup',
      copied: 'Copied!',
      copy: 'Copy',
      allReady: 'All Ready',
      needAction: 'Actions Needed',
      toolsConfigured: 'toolchains ready',
      notConfigured: 'Not Installed',
      optional: 'Optional',
    },
  };

  let dict = $derived(i18n[settingsStore.language] || i18n.id);

  onMount(async () => {
    try {
      recentList = await api.recentProjectsList();
    } catch {
      recentList = [];
    }

    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem('petak.dashboard.pinned');
      if (saved) {
        try {
          pinnedPaths = new Set(JSON.parse(saved));
        } catch {}
      }
    }

    // Refresh toolchain detection
    try {
      await toolchainStore.refresh('');
    } catch {}
  });

  function togglePin(e: MouseEvent, path: string) {
    e.stopPropagation();
    const next = new Set(pinnedPaths);
    if (next.has(path)) {
      next.delete(path);
    } else {
      next.add(path);
    }
    pinnedPaths = next;
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('petak.dashboard.pinned', JSON.stringify(Array.from(next)));
    }
  }

  async function handleRemoveProject(e: MouseEvent, path: string) {
    e.stopPropagation();
    try {
      await api.recentProjectsRemove(path);
      recentList = recentList.filter((p) => p.path !== path);
    } catch {}
  }

  function formatRelativeTime(ts: number): string {
    const now = Math.floor(Date.now() / 1000);
    const diff = Math.max(0, now - ts);
    if (diff < 60) return settingsStore.language === 'id' ? 'Baru saja' : 'Just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ${settingsStore.language === 'id' ? 'lalu' : 'ago'}`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ${settingsStore.language === 'id' ? 'lalu' : 'ago'}`;
    const days = Math.floor(diff / 86400);
    if (days < 30) return `${days}d ${settingsStore.language === 'id' ? 'lalu' : 'ago'}`;
    return new Date(ts * 1000).toLocaleDateString(settingsStore.language === 'id' ? 'id-ID' : 'en-US', {
      month: 'short',
      day: 'numeric',
    });
  }

  function getProjectIcon(name: string, path: string): string {
    const lower = (name + path).toLowerCase();
    if (lower.includes('flutter') || lower.includes('jatim') || lower.includes('app')) return '💙';
    if (lower.includes('android')) return '🤖';
    if (lower.includes('ios')) return '🍎';
    return '📦';
  }

  let filteredProjects = $derived.by(() => {
    let list = recentList;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter((p) => p.name.toLowerCase().includes(q) || p.path.toLowerCase().includes(q));
    }
    return [...list].sort((a, b) => {
      const aPinned = pinnedPaths.has(a.path);
      const bPinned = pinnedPaths.has(b.path);
      if (aPinned && !bPinned) return -1;
      if (!aPinned && bPinned) return 1;
      return b.lastOpened - a.lastOpened;
    });
  });

  let toolchainSummary = $derived.by(() => {
    const tc = toolchainStore.toolchain;
    const flutterOk = !!tc?.flutter;
    const dartOk = !!tc?.dart;
    const androidOk = !!(tc?.adb || tc?.androidHome);
    const javaOk = !!tc?.java;
    const kotlinOk = !!tc?.kotlinLs || kotlinInstalled;
    const scrcpyOk = false; // Missing in PATH on Linux by default, guide provided
    const xcodeOk = !!(tc?.xcrun || tc?.sourcekit);

    const essentialTools = [flutterOk, dartOk, androidOk, javaOk, kotlinOk];
    const readyCount = [flutterOk, dartOk, androidOk, javaOk, kotlinOk, scrcpyOk, xcodeOk].filter(Boolean).length;
    const actionsNeeded = essentialTools.filter((ok) => !ok).length + 1; // +1 for scrcpy

    return {
      tc,
      flutterOk,
      dartOk,
      androidOk,
      javaOk,
      kotlinOk,
      scrcpyOk,
      xcodeOk,
      readyCount,
      actionsNeeded,
      allGood: actionsNeeded === 0,
    };
  });

  async function handleInstallKotlinLs() {
    if (isInstallingKotlin) return;
    isInstallingKotlin = true;
    kotlinProgress = { stage: 'downloading', percent: 10, message: 'Menghubungkan ke GitHub releases…' };
    let unlisten: UnlistenFn | null = null;
    try {
      unlisten = await api.onKotlinLsProgress((p) => {
        kotlinProgress = p;
      });
      await api.installKotlinLs();
      kotlinInstalled = true;
      await toolchainStore.refresh('');
    } catch (e: any) {
      console.warn('Failed to install Kotlin LS:', e);
    } finally {
      if (unlisten) unlisten();
      isInstallingKotlin = false;
      kotlinProgress = null;
    }
  }

  function copySnippet(text: string) {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(text);
      copiedSnippet = text;
      setTimeout(() => {
        if (copiedSnippet === text) copiedSnippet = null;
      }, 2000);
    }
  }
</script>

<div class="dashboard-container">
  <div class="dashboard-card-wrap">
    <!-- Header with Animated Petak Logo -->
    <div class="dashboard-header">
      <div class="logo-row">
        <div class="logo-container" aria-label="Logo Petak">
          <div class="logo-glow"></div>
          <div class="petak-logo">
            <span class="petak-cell c1"></span>
            <span class="petak-cell c2"></span>
            <span class="petak-cell c3"></span>
            <span class="petak-cell c4"></span>
          </div>
        </div>

        <div class="header-titles">
          <div class="title-badge-row">
            <h1 class="welcome-title">Petak</h1>
            <span class="version-tag">v0.7.0</span>
            <span class="badge-mem">● RAM &lt; 150MB</span>
            <span class="badge-tag">⚡ Svelte 5</span>
          </div>
          <p class="welcome-sub">{dict.heroSub}</p>
        </div>
      </div>
    </div>

    <!-- Quick Action Row -->
    <div class="action-tiles">
      <button class="tile primary" onclick={onOpenFolder}>
        <div class="tile-icon">📂</div>
        <div class="tile-text">
          <div class="tile-title-row">
            <span class="tile-title">{dict.actOpen}</span>
            <span class="kbd-pill">⌘O</span>
          </div>
          <span class="tile-desc">{dict.actOpenDesc}</span>
        </div>
      </button>

      <button
        class="tile"
        onclick={() => alert(settingsStore.language === 'id' ? 'Project baru: Buka terminal dan jalankan `flutter create <nama>` lalu pilih Buka Folder.' : 'New project: Run `flutter create <name>` in terminal then choose Open Folder.')}
      >
        <div class="tile-icon">✨</div>
        <div class="tile-text">
          <div class="tile-title-row">
            <span class="tile-title">{dict.actNew}</span>
            <span class="kbd-pill">⌘N</span>
          </div>
          <span class="tile-desc">{dict.actNewDesc}</span>
        </div>
      </button>

      <button
        class="tile"
        onclick={() => alert(settingsStore.language === 'id' ? 'Clone Git: Jalankan `git clone <repo>` pada disk lalu buka foldernya di Petak.' : 'Clone Git: Run `git clone <repo>` on disk and open folder in Petak.')}
      >
        <div class="tile-icon">📥</div>
        <div class="tile-text">
          <div class="tile-title-row">
            <span class="tile-title">{dict.actClone}</span>
            <span class="kbd-pill">⌘⇧O</span>
          </div>
          <span class="tile-desc">{dict.actCloneDesc}</span>
        </div>
      </button>
    </div>

    <!-- Main Dual Column Layout -->
    <div class="dashboard-grid">
      <!-- Left Column: Recent Projects -->
      <div class="recents-section">
        <div class="section-bar">
          <div class="section-title-wrap">
            <span class="section-title">{dict.recentsTitle}</span>
            <span class="count-badge">{recentList.length}</span>
          </div>
          <div class="search-wrap">
            <input
              type="text"
              class="project-search-input"
              placeholder={settingsStore.language === 'id' ? 'Filter proyek terakhir…' : 'Filter recent projects…'}
              bind:value={searchQuery}
            />
          </div>
        </div>

        <div class="projects-list">
          {#if filteredProjects.length === 0}
            <div class="empty-projects">
              {#if searchQuery}
                <span>No projects match "{searchQuery}"</span>
              {:else}
                <span>{settingsStore.language === 'id' ? 'Belum ada riwayat proyek. Klik Buka Folder untuk memulai!' : 'No recent workspaces found. Click Open Folder to begin!'}</span>
              {/if}
            </div>
          {:else}
            {#each filteredProjects as proj (proj.path)}
              {@const isPinned = pinnedPaths.has(proj.path)}
              {@const icon = getProjectIcon(proj.name, proj.path)}
              <div
                class="project-card"
                class:missing={!proj.exists}
                onclick={() => onSelectProject(proj.path)}
                role="button"
                tabindex="0"
                onkeydown={(e) => { if (e.key === 'Enter') onSelectProject(proj.path); }}
              >
                <div class="card-icon">{icon}</div>
                <div class="card-body">
                  <div class="card-top-row">
                    <span class="project-name">{proj.name}</span>
                    {#if isPinned}
                      <span class="pinned-tag">📌</span>
                    {/if}
                    {#if !proj.exists}
                      <span class="missing-tag">not found</span>
                    {/if}
                  </div>
                  <div class="project-path" title={proj.path}>{proj.path}</div>
                  <div class="card-meta-row">
                    {#if proj.lastBranch}
                      <span class="branch-pill">🌿 {proj.lastBranch}</span>
                    {/if}
                    <span class="time-pill">{formatRelativeTime(proj.lastOpened)}</span>
                  </div>
                </div>

                <div class="card-actions" onclick={(e) => e.stopPropagation()} role="presentation">
                  <button
                    class="action-icon-btn pin"
                    class:pinned={isPinned}
                    onclick={(e) => togglePin(e, proj.path)}
                    title={isPinned ? 'Unpin project' : 'Pin to top'}
                  >
                    📌
                  </button>
                  <button
                    class="action-icon-btn del"
                    onclick={(e) => handleRemoveProject(e, proj.path)}
                    title="Remove from recents"
                  >
                    ✕
                  </button>
                </div>
              </div>
            {/each}
          {/if}
        </div>
      </div>

      <!-- Right Column: Toolchain Doctor & Quick Personalization -->
      <div class="side-section">
        <!-- Toolchain Doctor Card -->
        <div class="doctor-card">
          <div class="doctor-header">
            <div class="doctor-title-group">
              <div class="doctor-title-row">
                <span class="doctor-main-title">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M22 12h-4l-3 9L9 3l-3 9H2"></path>
                  </svg>
                  {dict.docTitle}
                </span>
                <span class="status-summary-pill" class:ready={toolchainSummary.actionsNeeded === 0} class:warning={toolchainSummary.actionsNeeded > 0}>
                  ● {toolchainSummary.actionsNeeded === 0 ? dict.allReady : `${toolchainSummary.actionsNeeded} ${dict.needAction}`}
                </span>
              </div>
              <span class="doctor-sub">{dict.docSub}</span>
            </div>
            <button class="btn-recheck" onclick={() => toolchainStore.refresh('')} title="Re-scan toolchains">
              <span>🔄</span> {dict.btnRecheck}
            </button>
          </div>

          <div class="doctor-items">
            <!-- 1. Flutter SDK -->
            <div class="tool-item">
              <div class="tool-left">
                <span class="status-badge-dot" class:ok={toolchainSummary.flutterOk} class:err={!toolchainSummary.flutterOk}></span>
                <div class="tool-labels">
                  <div class="tool-name-row">
                    <span class="tool-name">Flutter SDK</span>
                    <span class="tool-version">{toolchainSummary.tc?.flutter?.version || (toolchainSummary.flutterOk ? 'Available' : 'Missing')}</span>
                  </div>
                  <span class="tool-detail">{toolchainSummary.tc?.flutter?.path || 'Flutter CLI compiler'}</span>
                </div>
              </div>
              <div class="tool-action">
                {#if toolchainSummary.flutterOk}
                  <span class="badge-ready">✓ Ready</span>
                {:else}
                  <button class="btn-doctor-action guide" onclick={onOpenSettings}>Configure SDK</button>
                {/if}
              </div>
            </div>

            <!-- 2. Dart SDK -->
            <div class="tool-item">
              <div class="tool-left">
                <span class="status-badge-dot" class:ok={toolchainSummary.dartOk} class:err={!toolchainSummary.dartOk}></span>
                <div class="tool-labels">
                  <div class="tool-name-row">
                    <span class="tool-name">Dart SDK</span>
                    <span class="tool-version">{toolchainSummary.tc?.dart?.version || (toolchainSummary.dartOk ? 'Ready' : dict.notConfigured)}</span>
                  </div>
                  <span class="tool-detail">{toolchainSummary.tc?.dart?.path || 'Bundled with Flutter SDK'}</span>
                </div>
              </div>
              <div class="tool-action">
                {#if toolchainSummary.dartOk}
                  <span class="badge-ready">✓ Ready</span>
                {:else}
                  <button class="btn-doctor-action guide" onclick={onOpenSettings}>Configure SDK</button>
                {/if}
              </div>
            </div>

            <!-- 3. Android SDK & ADB -->
            <div class="tool-item">
              <div class="tool-left">
                <span class="status-badge-dot" class:ok={toolchainSummary.androidOk} class:err={!toolchainSummary.androidOk}></span>
                <div class="tool-labels">
                  <div class="tool-name-row">
                    <span class="tool-name">Android SDK & ADB</span>
                    <span class="tool-version">{toolchainSummary.tc?.adb?.version || (toolchainSummary.androidOk ? 'API 34' : 'Missing')}</span>
                  </div>
                  <span class="tool-detail">{toolchainSummary.tc?.androidHome || toolchainSummary.tc?.adb?.path || 'Android SDK Platform-Tools'}</span>
                </div>
              </div>
              <div class="tool-action">
                {#if toolchainSummary.androidOk}
                  <span class="badge-ready">✓ Ready</span>
                {:else}
                  <button class="btn-doctor-action guide" onclick={onOpenSettings}>Configure SDK</button>
                {/if}
              </div>
            </div>

            <!-- 4. Java JDK -->
            <div class="tool-item">
              <div class="tool-left">
                <span class="status-badge-dot" class:ok={toolchainSummary.javaOk} class:err={!toolchainSummary.javaOk}></span>
                <div class="tool-labels">
                  <div class="tool-name-row">
                    <span class="tool-name">Java JDK</span>
                    <span class="tool-version">{toolchainSummary.tc?.java?.version || (toolchainSummary.javaOk ? 'Detected' : 'Missing')}</span>
                  </div>
                  <span class="tool-detail">{toolchainSummary.tc?.java?.path || 'JAVA_HOME configured'}</span>
                </div>
              </div>
              <div class="tool-action">
                {#if toolchainSummary.javaOk}
                  <span class="badge-ready">✓ Ready</span>
                {:else}
                  <button class="btn-doctor-action guide" onclick={onOpenSettings}>Configure SDK</button>
                {/if}
              </div>
            </div>

            <!-- 5. Kotlin Language Server -->
            <div class="tool-item">
              <div class="tool-left">
                <span class="status-badge-dot" class:ok={toolchainSummary.kotlinOk} class:warn={!toolchainSummary.kotlinOk}></span>
                <div class="tool-labels">
                  <div class="tool-name-row">
                    <span class="tool-name">Kotlin LS</span>
                    <span class="tool-version">{toolchainSummary.kotlinOk ? 'v1.3.13' : dict.notConfigured}</span>
                  </div>
                  <span class="tool-detail">LSP autocomplete & diagnostics kode Kotlin</span>
                </div>
              </div>
              <div class="tool-action">
                {#if toolchainSummary.kotlinOk}
                  <span class="badge-ready">✓ Ready</span>
                {:else}
                  <button class="btn-doctor-action install" onclick={handleInstallKotlinLs} disabled={isInstallingKotlin}>
                    <span>⚡</span> {isInstallingKotlin ? dict.btnInstalling : dict.btnInstallKls}
                  </button>
                {/if}
              </div>
            </div>

            <!-- Kotlin Install Progress Box -->
            {#if isInstallingKotlin && kotlinProgress}
              <div class="install-progress-box">
                <div class="progress-status-text">
                  <span>{kotlinProgress.message}</span>
                  <span>{kotlinProgress.percent ?? 50}%</span>
                </div>
                <div class="progress-bar-track">
                  <div class="progress-bar-fill" style:width="{kotlinProgress.percent ?? 50}%"></div>
                </div>
              </div>
            {/if}

            <!-- 6. scrcpy Device Mirroring -->
            <div class="tool-item">
              <div class="tool-left">
                <span class="status-badge-dot warn"></span>
                <div class="tool-labels">
                  <div class="tool-name-row">
                    <span class="tool-name">scrcpy Mirroring</span>
                    <span class="tool-version">Missing in PATH</span>
                  </div>
                  <span class="tool-detail">Dibutuhkan untuk mirror layar device Android USB</span>
                </div>
              </div>
              <div class="tool-action">
                <button class="btn-doctor-action guide" onclick={() => (scrcpyModalOpen = true)}>
                  <span>📖</span> {dict.btnScrcpyGuide}
                </button>
              </div>
            </div>

            <!-- 7. Xcode & Swift -->
            <div class="tool-item">
              <div class="tool-left">
                <span class="status-badge-dot neutral"></span>
                <div class="tool-labels">
                  <div class="tool-name-row">
                    <span class="tool-name">Xcode & Swift</span>
                    <span class="tool-version">macOS Only</span>
                  </div>
                  <span class="tool-detail">Simulasi via host bridge / remote build</span>
                </div>
              </div>
              <div class="tool-action">
                <span class="badge-ready" style="color: var(--text-dim); font-weight: 500;">{dict.optional}</span>
              </div>
            </div>
          </div>

          <div class="doctor-footer">
            <span class="doctor-footer-text">
              {toolchainSummary.readyCount} {settingsStore.language === 'id' ? 'dari 7' : 'of 7'} {dict.toolsConfigured}
            </span>
            <button class="doctor-footer-link" onclick={onOpenSettings}>
              {dict.docFooterLink} →
            </button>
          </div>
        </div>

        <!-- Quick Controls & Personalization Card -->
        <div class="preferences-card">
          <span class="pref-title">{dict.prefTitle}</span>

          <!-- Theme -->
          <div class="pref-row">
            <div class="pref-label-group">
              <span class="pref-label">{dict.prefTheme}</span>
              <span class="pref-desc">{dict.prefThemeDesc}</span>
            </div>
            <div class="segmented-control">
              <button
                class="segmented-btn"
                class:active={settingsStore.theme === 'dark'}
                onclick={() => settingsStore.setTheme('dark')}
              >
                🌙 Dark
              </button>
              <button
                class="segmented-btn"
                class:active={settingsStore.theme === 'light'}
                onclick={() => settingsStore.setTheme('light')}
              >
                ☀️ Light
              </button>
            </div>
          </div>

          <!-- Language -->
          <div class="pref-row">
            <div class="pref-label-group">
              <span class="pref-label">{dict.prefLang}</span>
              <span class="pref-desc">{dict.prefLangDesc}</span>
            </div>
            <div class="segmented-control">
              <button
                class="segmented-btn"
                class:active={settingsStore.language === 'id'}
                onclick={() => settingsStore.setLanguage('id')}
              >
                ID
              </button>
              <button
                class="segmented-btn"
                class:active={settingsStore.language === 'en'}
                onclick={() => settingsStore.setLanguage('en')}
              >
                EN
              </button>
            </div>
          </div>

          <!-- Reopen Last Project Toggle -->
          <div class="pref-row">
            <div class="pref-label-group">
              <span class="pref-label">{dict.prefReopen}</span>
              <span class="pref-desc">{dict.prefReopenDesc}</span>
            </div>
            <label class="switch">
              <input
                type="checkbox"
                checked={settingsStore.reopenLastProjectOnLaunch}
                onchange={(e) => settingsStore.setReopenLastProjectOnLaunch((e.target as HTMLInputElement).checked)}
              />
              <span class="slider"></span>
            </label>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>

<!-- Modal Panduan Instalasi scrcpy -->
{#if scrcpyModalOpen}
  <div class="modal-backdrop show" onclick={() => (scrcpyModalOpen = false)} role="presentation">
    <div class="guide-modal" onclick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" tabindex="-1">
      <div class="modal-header">
        <h3>Panduan Instalasi scrcpy (Device Mirroring)</h3>
        <button class="icon-btn" onclick={() => (scrcpyModalOpen = false)} aria-label="Close">✕</button>
      </div>
      <div class="modal-body">
        <p>Petak membutuhkan tool <code>scrcpy</code> di PATH untuk menampilkan mirroring layar perangkat Android tanpa lag.</p>

        <div>
          <strong style="color: var(--text-main); font-size: 12px;">Untuk macOS (Homebrew):</strong>
          <div class="code-box" style="margin-top: 6px;">
            <span>brew install scrcpy</span>
            <button class="btn-copy" onclick={() => copySnippet('brew install scrcpy')}>
              {copiedSnippet === 'brew install scrcpy' ? dict.copied : dict.copy}
            </button>
          </div>
        </div>

        <div>
          <strong style="color: var(--text-main); font-size: 12px;">Untuk Ubuntu / Debian Linux:</strong>
          <div class="code-box" style="margin-top: 6px;">
            <span>sudo apt update && sudo apt install scrcpy</span>
            <button class="btn-copy" onclick={() => copySnippet('sudo apt update && sudo apt install scrcpy')}>
              {copiedSnippet === 'sudo apt update && sudo apt install scrcpy' ? dict.copied : dict.copy}
            </button>
          </div>
        </div>

        <p style="font-size: 11px; color: var(--text-dim);">
          Setelah instalasi selesai, klik tombol <strong>Pindai Ulang</strong> pada kartu Doctor di atas.
        </p>
      </div>
      <div class="modal-footer">
        <button class="btn-close-modal" onclick={() => (scrcpyModalOpen = false)}>Tutup</button>
      </div>
    </div>
  </div>
{/if}

<style>
  :global(:root) {
    --bg-app: #141518;
    --bg-card: #18191d;
    --bg-card-hover: #1f2127;
    --bg-elevated: #23252c;
    --border-subtle: #23252a;
    --border: #282a32;
    --border-strong: #383b46;
    --text-main: #f0f1f4;
    --text-muted: #8b8f98;
    --text-dim: #656974;
    --accent: #6ea8ff;
    --accent-hover: #5092f6;
    --accent-bg: rgba(110, 168, 255, 0.12);
    --accent-border: rgba(110, 168, 255, 0.25);
    --success: #7fc98f;
    --success-bg: rgba(127, 201, 143, 0.12);
    --success-border: rgba(127, 201, 143, 0.25);
    --warning: #e8b45a;
    --warning-bg: rgba(232, 180, 90, 0.14);
    --warning-border: rgba(232, 180, 90, 0.28);
    --danger: #f07a74;
    --danger-bg: rgba(240, 122, 116, 0.12);
    --radius-sm: 4px;
    --radius-md: 6px;
    --radius-lg: 10px;
    --font-sans: 'Geist', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    --font-code: 'JetBrains Mono', ui-monospace, SFMono-Regular, monospace;
    --shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.25);
    --shadow-lg: 0 16px 36px rgba(0, 0, 0, 0.45);
  }

  :global(.light-theme) {
    --bg-app: #f4f5f8;
    --bg-card: #ffffff;
    --bg-card-hover: #f8f9fc;
    --bg-elevated: #e5e7eb;
    --border-subtle: #e2e4e9;
    --border: #d1d5db;
    --border-strong: #9ca3af;
    --text-main: #111827;
    --text-muted: #374151;
    --text-dim: #6b7280;
    --accent: #2563eb;
    --accent-hover: #1d4ed8;
    --accent-bg: rgba(37, 99, 235, 0.08);
    --accent-border: rgba(37, 99, 235, 0.25);
    --success: #15803d;
    --success-bg: rgba(21, 128, 61, 0.08);
    --success-border: rgba(21, 128, 61, 0.25);
    --warning: #92400e;
    --warning-bg: rgba(146, 64, 14, 0.08);
    --warning-border: rgba(146, 64, 14, 0.25);
    --danger: #b91c1c;
    --danger-bg: rgba(185, 28, 28, 0.08);
  }

  .dashboard-container {
    width: 100%;
    height: 100%;
    background: var(--bg-app);
    color: var(--text-main);
    overflow-y: auto;
    display: flex;
    justify-content: center;
    padding: 32px 20px;
    font-family: var(--font-sans);
  }

  .dashboard-card-wrap {
    width: 100%;
    max-width: 1060px;
    display: flex;
    flex-direction: column;
    gap: 22px;
  }

  /* Header & Animated Logo */
  .dashboard-header {
    padding-bottom: 4px;
  }

  .logo-row {
    display: flex;
    align-items: center;
    gap: 16px;
  }

  .logo-container {
    position: relative;
    width: 48px;
    height: 48px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .logo-glow {
    position: absolute;
    inset: -4px;
    border-radius: 14px;
    background: radial-gradient(circle, rgba(110, 168, 255, 0.45) 0%, rgba(110, 168, 255, 0) 70%);
    opacity: 0.35;
    animation: petak-glow 2.8s cubic-bezier(0.4, 0, 0.2, 1) infinite;
    pointer-events: none;
    z-index: 1;
  }

  .petak-logo {
    position: relative;
    z-index: 2;
    width: 46px;
    height: 46px;
    display: grid;
    grid-template-columns: 1fr 1fr;
    grid-template-rows: 1fr 1fr;
    gap: 4px;
    background: var(--bg-card);
    padding: 6px;
    border-radius: 10px;
    border: 1px solid var(--border);
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.2);
    animation: petak-logo-breathe 2.8s ease-in-out infinite;
  }

  .petak-cell {
    border-radius: 2px;
    transition: background 0.25s ease;
  }

  .petak-cell.c1 {
    background: var(--accent);
    animation: petak-cell-pulse-1 2.8s ease-in-out infinite;
  }

  .petak-cell.c4 {
    background: var(--accent);
    animation: petak-cell-pulse-4 2.8s ease-in-out infinite;
  }

  .petak-cell.c2 {
    background: #2a3754;
    animation: petak-cell-stagger-2 2.8s ease-in-out infinite;
  }

  .petak-cell.c3 {
    background: #2a3754;
    animation: petak-cell-stagger-3 2.8s ease-in-out infinite;
  }

  @keyframes petak-glow {
    0%, 100% { opacity: 0.25; transform: scale(0.96); }
    50% { opacity: 0.7; transform: scale(1.08); }
  }

  @keyframes petak-logo-breathe {
    0%, 100% { transform: translateY(0); box-shadow: 0 4px 10px rgba(0, 0, 0, 0.25); }
    50% { transform: translateY(-2px); box-shadow: 0 8px 20px rgba(110, 168, 255, 0.22); }
  }

  @keyframes petak-cell-pulse-1 {
    0%, 100% { transform: scale(1); filter: brightness(1); }
    50% { transform: scale(1.04); filter: brightness(1.2); }
  }

  @keyframes petak-cell-stagger-2 {
    0%, 100% { background: #2a3754; }
    50% { background: #3c527e; }
  }

  @keyframes petak-cell-stagger-3 {
    0%, 100% { background: #2a3754; }
    50% { background: #354a72; }
  }

  @keyframes petak-cell-pulse-4 {
    0%, 100% { transform: scale(1); filter: brightness(1); }
    50% { transform: scale(1.04); filter: brightness(1.15); }
  }

  @media (prefers-reduced-motion: reduce) {
    .logo-glow, .petak-logo, .petak-cell {
      animation: none !important;
      transform: none !important;
    }
  }

  .header-titles {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .title-badge-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .welcome-title {
    font-size: 20px;
    font-weight: 700;
    color: var(--text-main);
    margin: 0;
  }

  .version-tag {
    font-size: 11px;
    font-family: var(--font-code);
    color: var(--text-muted);
  }

  .badge-mem, .badge-tag {
    font-size: 10px;
    font-weight: 600;
    padding: 1px 6px;
    border-radius: var(--radius-sm);
    background: var(--bg-elevated);
    color: var(--text-muted);
    border: 1px solid var(--border);
  }

  .welcome-sub {
    font-size: 12px;
    color: var(--text-muted);
    margin: 0;
  }

  /* Action Tiles */
  .action-tiles {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 12px;
  }

  .tile {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: 12px 14px;
    display: flex;
    align-items: center;
    gap: 12px;
    cursor: pointer;
    text-align: left;
    transition: all 0.15s ease;
    box-shadow: var(--shadow-sm);
  }

  .tile:hover {
    background: var(--bg-card-hover);
    border-color: var(--border-strong);
    transform: translateY(-1px);
  }

  .tile.primary {
    border-color: var(--accent-border);
    background: linear-gradient(135deg, var(--bg-card) 0%, var(--accent-bg) 100%);
  }

  .tile-icon {
    font-size: 20px;
    width: 36px;
    height: 36px;
    border-radius: var(--radius-md);
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .tile.primary .tile-icon {
    background: var(--accent);
    color: #ffffff;
    border-color: transparent;
  }

  .tile-text {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .tile-title-row {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .tile-title {
    font-size: 12.5px;
    font-weight: 600;
    color: var(--text-main);
  }

  .kbd-pill {
    font-family: var(--font-code);
    font-size: 10px;
    font-weight: 600;
    background: var(--bg-elevated);
    color: var(--text-muted);
    padding: 1px 4px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border);
  }

  .tile-desc {
    font-size: 11px;
    color: var(--text-muted);
    line-height: 1.3;
  }

  /* Dual Column Grid */
  .dashboard-grid {
    display: grid;
    grid-template-columns: 1.25fr 1fr;
    gap: 16px;
    align-items: start;
  }

  /* Left Column: Recent Projects */
  .recents-section {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    overflow: hidden;
    display: flex;
    flex-direction: column;
    box-shadow: var(--shadow-sm);
  }

  .section-bar {
    padding: 10px 14px;
    border-bottom: 1px solid var(--border-subtle);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .section-title-wrap {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .section-title {
    font-size: 11px;
    font-weight: 700;
    color: var(--text-muted);
    letter-spacing: 0.5px;
    text-transform: uppercase;
  }

  .count-badge {
    background: var(--bg-elevated);
    color: var(--text-main);
    font-size: 10px;
    font-weight: 600;
    padding: 1px 6px;
    border-radius: 10px;
    border: 1px solid var(--border);
  }

  .search-wrap {
    position: relative;
    max-width: 200px;
    flex: 1;
  }

  .project-search-input {
    width: 100%;
    background: var(--bg-app);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    padding: 4px 8px;
    font-size: 11px;
    color: var(--text-main);
    outline: none;
    transition: border-color 0.15s ease;
  }

  .project-search-input:focus {
    border-color: var(--accent);
  }

  .projects-list {
    display: flex;
    flex-direction: column;
    max-height: 440px;
    overflow-y: auto;
  }

  .empty-projects {
    padding: 36px 16px;
    text-align: center;
    color: var(--text-muted);
    font-size: 12px;
  }

  .project-card {
    display: flex;
    align-items: center;
    padding: 10px 14px;
    border-bottom: 1px solid var(--border-subtle);
    cursor: pointer;
    gap: 12px;
    transition: background 0.12s ease;
  }

  .project-card:last-child {
    border-bottom: none;
  }

  .project-card:hover {
    background: var(--bg-card-hover);
  }

  .card-icon {
    width: 32px;
    height: 32px;
    border-radius: var(--radius-md);
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 15px;
    flex-shrink: 0;
  }

  .card-body {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .card-top-row {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .project-name {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-main);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .pinned-tag {
    font-size: 11px;
    color: var(--warning);
  }

  .missing-tag {
    font-size: 9px;
    color: var(--danger);
    background: var(--danger-bg);
    padding: 1px 4px;
    border-radius: 3px;
  }

  .project-path {
    font-family: var(--font-code);
    font-size: 11px;
    color: var(--text-dim);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .card-meta-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 2px;
  }

  .branch-pill {
    font-size: 10px;
    font-family: var(--font-code);
    color: var(--accent);
    background: var(--accent-bg);
    padding: 1px 6px;
    border-radius: var(--radius-sm);
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }

  .time-pill {
    font-size: 11px;
    color: var(--text-muted);
  }

  .card-actions {
    display: flex;
    align-items: center;
    gap: 4px;
    opacity: 0.6;
    transition: opacity 0.15s ease;
  }

  .project-card:hover .card-actions {
    opacity: 1;
  }

  .action-icon-btn {
    width: 24px;
    height: 24px;
    border-radius: var(--radius-sm);
    background: transparent;
    border: 1px solid transparent;
    color: var(--text-muted);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    font-size: 11px;
    transition: all 0.12s ease;
  }

  .action-icon-btn:hover {
    background: var(--bg-elevated);
    border-color: var(--border);
    color: var(--text-main);
  }

  .action-icon-btn.pin.pinned {
    opacity: 1;
  }

  /* Right Column: Doctor Card & Quick Controls */
  .side-section {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .doctor-card {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    box-shadow: var(--shadow-sm);
  }

  .doctor-header {
    padding: 10px 14px;
    background: var(--bg-card);
    border-bottom: 1px solid var(--border-subtle);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }

  .doctor-title-group {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .doctor-title-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .doctor-main-title {
    font-size: 12px;
    font-weight: 700;
    color: var(--text-main);
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .doctor-sub {
    font-size: 11px;
    color: var(--text-muted);
  }

  .status-summary-pill {
    font-size: 10px;
    font-weight: 600;
    padding: 2px 7px;
    border-radius: 20px;
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .status-summary-pill.ready {
    background: var(--success-bg);
    color: var(--success);
    border: 1px solid var(--success-border);
  }

  .status-summary-pill.warning {
    background: var(--warning-bg);
    color: var(--warning);
    border: 1px solid var(--warning-border);
  }

  .btn-recheck {
    background: var(--bg-app);
    border: 1px solid var(--border);
    color: var(--text-muted);
    font-size: 11px;
    font-weight: 500;
    padding: 3px 8px;
    border-radius: var(--radius-sm);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    transition: all 0.15s ease;
  }

  .btn-recheck:hover {
    background: var(--bg-elevated);
    color: var(--text-main);
    border-color: var(--border-strong);
  }

  .doctor-items {
    display: flex;
    flex-direction: column;
    padding: 6px 10px;
    gap: 4px;
  }

  .tool-item {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    padding: 7px 10px;
    border-radius: var(--radius-md);
    background: var(--bg-app);
    border: 1px solid var(--border-subtle);
    gap: 8px;
    transition: all 0.15s ease;
  }

  .tool-item:hover {
    border-color: var(--border);
    background: var(--bg-card-hover);
  }

  .tool-left {
    display: flex;
    align-items: flex-start;
    gap: 9px;
    min-width: 0;
    flex: 1;
  }

  .status-badge-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
    margin-top: 4px;
  }

  .status-badge-dot.ok {
    background: var(--success);
    box-shadow: 0 0 6px rgba(127, 201, 143, 0.4);
  }

  .status-badge-dot.warn {
    background: var(--warning);
    box-shadow: 0 0 6px rgba(232, 180, 90, 0.4);
  }

  .status-badge-dot.err {
    background: var(--danger);
    box-shadow: 0 0 6px rgba(240, 122, 116, 0.4);
  }

  .status-badge-dot.neutral {
    background: var(--text-dim);
  }

  .tool-labels {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
    flex: 1;
  }

  .tool-name-row {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .tool-name {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-main);
  }

  .tool-version {
    font-size: 10px;
    font-family: var(--font-code);
    color: var(--text-muted);
  }

  .tool-detail {
    font-size: 11px;
    color: var(--text-dim);
    line-height: 1.3;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .tool-action {
    flex-shrink: 0;
    margin-top: 1px;
  }

  .btn-doctor-action {
    font-size: 11px;
    font-weight: 600;
    padding: 3px 8px;
    border-radius: var(--radius-sm);
    border: 1px solid transparent;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    transition: all 0.15s ease;
    white-space: nowrap;
  }

  .btn-doctor-action.install {
    background: var(--accent);
    color: #ffffff;
    border-color: var(--accent-hover);
  }

  .btn-doctor-action.install:hover:not(:disabled) {
    background: var(--accent-hover);
    box-shadow: 0 2px 8px rgba(110, 168, 255, 0.35);
  }

  .btn-doctor-action.guide {
    background: var(--warning-bg);
    color: var(--warning);
    border-color: var(--warning-border);
  }

  .btn-doctor-action.guide:hover {
    background: rgba(232, 180, 90, 0.22);
  }

  .badge-ready {
    font-size: 11px;
    color: var(--success);
    display: inline-flex;
    align-items: center;
    gap: 3px;
    font-weight: 600;
  }

  .install-progress-box {
    width: 100%;
    padding: 6px 10px;
    background: var(--accent-bg);
    border-radius: var(--radius-md);
    border: 1px solid var(--accent-border);
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-top: 3px;
  }

  .progress-bar-track {
    width: 100%;
    height: 4px;
    background: rgba(255, 255, 255, 0.15);
    border-radius: 2px;
    overflow: hidden;
  }

  .progress-bar-fill {
    height: 100%;
    background: var(--accent);
    border-radius: 2px;
    transition: width 0.3s ease;
  }

  .progress-status-text {
    font-size: 10px;
    color: var(--accent);
    font-weight: 500;
    display: flex;
    justify-content: space-between;
  }

  .doctor-footer {
    padding: 8px 12px;
    background: var(--bg-card);
    border-top: 1px solid var(--border-subtle);
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .doctor-footer-text {
    font-size: 11px;
    color: var(--text-dim);
  }

  .doctor-footer-link {
    font-size: 11px;
    font-weight: 600;
    color: var(--accent);
    background: transparent;
    border: none;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 0;
  }

  .doctor-footer-link:hover {
    text-decoration: underline;
  }

  /* Quick Controls & Personalization Card */
  .preferences-card {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: 10px 14px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    box-shadow: var(--shadow-sm);
  }

  .pref-title {
    font-size: 10px;
    font-weight: 700;
    color: var(--text-muted);
    letter-spacing: 0.5px;
    text-transform: uppercase;
  }

  .pref-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .pref-label-group {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .pref-label {
    font-size: 12px;
    font-weight: 500;
    color: var(--text-main);
  }

  .pref-desc {
    font-size: 11px;
    color: var(--text-dim);
  }

  .segmented-control {
    display: flex;
    background: var(--bg-app);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    padding: 2px;
    gap: 2px;
  }

  .segmented-btn {
    font-size: 11px;
    font-weight: 500;
    padding: 3px 8px;
    border-radius: var(--radius-sm);
    border: none;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    transition: all 0.12s ease;
  }

  .segmented-btn:hover {
    color: var(--text-main);
  }

  .segmented-btn.active {
    background: var(--bg-card);
    color: var(--text-main);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.15);
    font-weight: 600;
  }

  .switch {
    position: relative;
    display: inline-block;
    width: 32px;
    height: 18px;
    flex-shrink: 0;
  }

  .switch input {
    opacity: 0;
    width: 0;
    height: 0;
  }

  .slider {
    position: absolute;
    cursor: pointer;
    top: 0; left: 0; right: 0; bottom: 0;
    background-color: var(--bg-elevated);
    border: 1px solid var(--border);
    transition: .2s;
    border-radius: 20px;
  }

  .slider:before {
    position: absolute;
    content: "";
    height: 12px;
    width: 12px;
    left: 2px;
    bottom: 2px;
    background-color: var(--text-dim);
    transition: .2s;
    border-radius: 50%;
  }

  input:checked + .slider {
    background-color: var(--accent);
    border-color: var(--accent);
  }

  input:checked + .slider:before {
    transform: translateX(14px);
    background-color: #ffffff;
  }

  /* Modal scrcpy Guide */
  .modal-backdrop {
    display: none;
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.65);
    backdrop-filter: blur(4px);
    z-index: 999;
    align-items: center;
    justify-content: center;
    padding: 16px;
  }

  .modal-backdrop.show {
    display: flex;
  }

  .guide-modal {
    background: var(--bg-card);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-lg);
    width: 100%;
    max-width: 480px;
    box-shadow: var(--shadow-lg);
    overflow: hidden;
    animation: modal-pop 0.18s cubic-bezier(0.16, 1, 0.3, 1);
  }

  @keyframes modal-pop {
    from { transform: scale(0.95); opacity: 0; }
    to { transform: scale(1); opacity: 1; }
  }

  .modal-header {
    padding: 14px 18px;
    border-bottom: 1px solid var(--border-subtle);
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .modal-header h3 {
    font-size: 13px;
    font-weight: 700;
    margin: 0;
    color: var(--text-main);
  }

  .modal-body {
    padding: 16px 18px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    font-size: 12px;
    color: var(--text-muted);
    line-height: 1.4;
  }

  .modal-body code {
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    padding: 1px 4px;
    border-radius: 3px;
    font-family: var(--font-code);
    color: var(--accent);
  }

  .code-box {
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: var(--bg-app);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    padding: 6px 10px;
    font-family: var(--font-code);
    font-size: 11px;
    color: var(--text-main);
  }

  .btn-copy {
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    color: var(--text-muted);
    font-size: 10px;
    padding: 2px 7px;
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .btn-copy:hover {
    color: var(--text-main);
    border-color: var(--accent);
  }

  .modal-footer {
    padding: 10px 18px;
    border-top: 1px solid var(--border-subtle);
    display: flex;
    justify-content: flex-end;
  }

  .btn-close-modal {
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    color: var(--text-main);
    font-size: 11px;
    font-weight: 500;
    padding: 4px 12px;
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .btn-close-modal:hover {
    background: var(--bg-card-hover);
    border-color: var(--border-strong);
  }
</style>
