<script lang="ts">
  import { onMount } from 'svelte';
  import { api, type RecentProject, type KotlinLsProgress, type UnlistenFn } from '../../lib/api';
  import { toolchainStore } from '../toolchain/toolchainStore.svelte';
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
  let selectedIndex = $state<number>(0);
  let searchInputEl = $state<HTMLInputElement | null>(null);

  // Modals state
  let newProjectModalOpen = $state(false);
  let cloneRepoModalOpen = $state(false);
  let doctorModalOpen = $state(false);
  let quickSettingsModalOpen = $state(false);
  let scrcpyModalOpen = $state(false);

  // Modal form states
  let newProjectName = $state('my_flutter_app');
  let newProjectOrg = $state('id.co.bankjatim');
  let cloneRepoUrl = $state('https://code.istar.id/bankjatim/jatim-ist-mb-flutter.git');
  let cloneTargetDir = $state('/mnt/storage/projects');

  // Doctor state
  let isInstallingKotlin = $state(false);
  let kotlinProgress = $state<KotlinLsProgress | null>(null);
  let kotlinInstalled = $state(false);
  let copiedSnippet = $state<string | null>(null);

  const i18n = {
    id: {
      version: 'v0.8.0',
      heroSub: 'Native Flutter & Mobile Engineering IDE Ringan & Cepat',
      actOpen: 'Buka Folder…',
      actOpenDesc: 'Buka workspace Flutter atau native dari disk',
      actNew: 'Buat Project Baru…',
      actNewDesc: 'Panduan membuat Flutter app atau modul baru',
      actClone: 'Clone Repositori Git…',
      actCloneDesc: 'Clone repository dari GitLab Bank Jatim atau GitHub',
      actDoctor: 'Petak Doctor',
      actDoctorDesc: 'Pemeriksaan toolchain: Flutter, Dart, SDK, JDK, scrcpy, KLS',
      actSettings: 'Pengaturan',
      actSettingsDesc: 'Tema Gelap/Terang, Bahasa ID/EN & Preferensi',
      recentsTitle: 'Recent Projects',
      searchPlaceholder: 'Filter proyek terakhir… (↑↓ Enter)',
      emptyRecents: 'Belum ada riwayat proyek. Pilih Buka Folder untuk memulai!',
      noMatch: 'Tidak ada proyek yang cocok dengan filter',
      removeTooltip: 'Hapus dari daftar riwayat',
      docTitle: 'Toolchain Doctor',
      docSub: 'Deteksi otomatis compiler, SDK & tools emulator',
      btnRecheck: 'Pindai Ulang',
      btnInstallKls: 'Install 1-Click',
      btnInstalling: 'Memasang…',
      btnScrcpyGuide: 'Panduan Install',
      docFooterLink: 'Buka Pengaturan Toolchain Lengkap (⌘,)',
      prefTitle: 'Pengaturan Cepat',
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
      newModalTitle: 'Buat Project Baru (Flutter Create)',
      newModalDesc: 'Jalankan perintah ini di terminal untuk membuat project baru, lalu buka foldernya di Petak:',
      cloneModalTitle: 'Clone Repositori Git',
      cloneModalDesc: 'Jalankan perintah clone berikut di terminal atau disk:',
      close: 'Tutup',
    },
    en: {
      version: 'v0.8.0',
      heroSub: 'Fast, lightweight native Flutter & mobile engineering IDE',
      actOpen: 'Open Folder…',
      actOpenDesc: 'Open an existing Flutter, Android, or mobile workspace from disk',
      actNew: 'Create New Project…',
      actNewDesc: 'Generate a clean Flutter app, Dart package, or native module',
      actClone: 'Clone Git Repository…',
      actCloneDesc: 'Clone repository from Bank Jatim GitLab or GitHub',
      actDoctor: 'Petak Doctor',
      actDoctorDesc: 'Toolchain health check: Flutter, Dart, SDK, JDK, scrcpy, KLS',
      actSettings: 'Settings',
      actSettingsDesc: 'Dark/Light theme, ID/EN language & preferences',
      recentsTitle: 'Recent Projects',
      searchPlaceholder: 'Filter recent projects… (↑↓ Enter)',
      emptyRecents: 'No recent workspaces found. Click Open Folder to begin!',
      noMatch: 'No projects match query',
      removeTooltip: 'Remove from recents',
      docTitle: 'Toolchain Doctor',
      docSub: 'Automated health-check for compilers, SDKs, and emulators',
      btnRecheck: 'Scan Again',
      btnInstallKls: 'Install 1-Click',
      btnInstalling: 'Installing…',
      btnScrcpyGuide: 'Setup Guide',
      docFooterLink: 'Open Full Toolchain Settings (⌘,)',
      prefTitle: 'Quick Settings',
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
      newModalTitle: 'Create New Project (Flutter Create)',
      newModalDesc: 'Run this command in terminal to create a project, then open its folder in Petak:',
      cloneModalTitle: 'Clone Git Repository',
      cloneModalDesc: 'Run this clone command in terminal or disk:',
      close: 'Close',
    },
  };

  let dict = $derived(i18n[settingsStore.language] || i18n.id);

  onMount(async () => {
    try {
      recentList = await api.recentProjectsList();
    } catch {
      recentList = [];
    }

    try {
      await toolchainStore.refresh('');
    } catch {}

    try {
      await api.markReady(Date.now());
    } catch {}
  });

  async function handleRemoveProject(e: MouseEvent, path: string) {
    e.stopPropagation();
    try {
      await api.recentProjectsRemove(path);
      recentList = recentList.filter((p) => p.path !== path);
      if (selectedIndex >= filteredProjects.length) {
        selectedIndex = Math.max(0, filteredProjects.length - 1);
      }
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
    return [...list].sort((a, b) => b.lastOpened - a.lastOpened);
  });

  $effect(() => {
    if (selectedIndex >= filteredProjects.length && filteredProjects.length > 0) {
      selectedIndex = filteredProjects.length - 1;
    }
  });

  function handleKeydown(e: KeyboardEvent) {
    if (newProjectModalOpen || cloneRepoModalOpen || doctorModalOpen || quickSettingsModalOpen || scrcpyModalOpen) {
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (filteredProjects.length > 0) {
        selectedIndex = (selectedIndex + 1) % filteredProjects.length;
        scrollSelectedIntoView();
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (filteredProjects.length > 0) {
        selectedIndex = (selectedIndex - 1 + filteredProjects.length) % filteredProjects.length;
        scrollSelectedIntoView();
      }
    } else if (e.key === 'Enter') {
      if (filteredProjects.length > 0 && selectedIndex >= 0 && selectedIndex < filteredProjects.length) {
        e.preventDefault();
        onSelectProject(filteredProjects[selectedIndex].path);
      }
    }
  }

  function scrollSelectedIntoView() {
    setTimeout(() => {
      const el = document.querySelector('.project-card.selected');
      el?.scrollIntoView({ block: 'nearest' });
    }, 0);
  }

  let toolchainSummary = $derived.by(() => {
    const tc = toolchainStore.toolchain;
    const flutterOk = !!tc?.flutter;
    const dartOk = !!tc?.dart;
    const androidOk = !!(tc?.adb || tc?.androidHome);
    const javaOk = !!tc?.java;
    const kotlinOk = !!tc?.kotlinLs || kotlinInstalled;
    const scrcpyOk = !!tc?.scrcpy;
    const xcodeOk = !!(tc?.xcrun || tc?.sourcekit);

    const essentialTools = [flutterOk, dartOk, androidOk, javaOk, kotlinOk];
    const readyCount = [flutterOk, dartOk, androidOk, javaOk, kotlinOk, scrcpyOk, xcodeOk].filter(Boolean).length;
    const actionsNeeded = essentialTools.filter((ok) => !ok).length;

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

<svelte:window onkeydown={handleKeydown} />

<div class="dashboard-container">
  <div class="xcode-window">
    <!-- Kolom Kiri (Brand & Actions ala Xcode) -->
    <div class="column-left">
      <!-- Brand & Version -->
      <div class="brand-section">
        <div class="logo-container" aria-label="Logo Petak">
          <div class="logo-glow"></div>
          <div class="petak-logo">
            <span class="petak-cell c1"></span>
            <span class="petak-cell c2"></span>
            <span class="petak-cell c3"></span>
            <span class="petak-cell c4"></span>
          </div>
        </div>

        <h1 class="welcome-title">Petak</h1>
        <span class="version-tag">{dict.version}</span>
        <p class="brand-tagline">{dict.heroSub}</p>
      </div>

      <!-- 5 Aksi Utama -->
      <div class="actions-menu">
        <!-- 1. Buka Folder... -->
        <button class="action-item primary" onclick={onOpenFolder}>
          <div class="action-icon-box">📂</div>
          <div class="action-details">
            <div class="action-title-row">
              <span class="action-title">{dict.actOpen}</span>
              <span class="action-kbd">⌘O</span>
            </div>
            <span class="action-desc">{dict.actOpenDesc}</span>
          </div>
        </button>

        <!-- 2. Buat Project Baru... -->
        <button class="action-item" onclick={() => (newProjectModalOpen = true)}>
          <div class="action-icon-box">✨</div>
          <div class="action-details">
            <div class="action-title-row">
              <span class="action-title">{dict.actNew}</span>
              <span class="action-kbd">⌘N</span>
            </div>
            <span class="action-desc">{dict.actNewDesc}</span>
          </div>
        </button>

        <!-- 3. Clone Repositori Git... -->
        <button class="action-item" onclick={() => (cloneRepoModalOpen = true)}>
          <div class="action-icon-box">📥</div>
          <div class="action-details">
            <div class="action-title-row">
              <span class="action-title">{dict.actClone}</span>
              <span class="action-kbd">⌘⇧O</span>
            </div>
            <span class="action-desc">{dict.actCloneDesc}</span>
          </div>
        </button>

        <!-- 4. Petak Doctor -->
        <button class="action-item" onclick={() => (doctorModalOpen = true)}>
          <div class="action-icon-box">🩺</div>
          <div class="action-details">
            <div class="action-title-row">
              <span class="action-title">{dict.actDoctor}</span>
              <span class="doctor-badge" class:ready={toolchainSummary.actionsNeeded === 0} class:warn={toolchainSummary.actionsNeeded > 0}>
                {toolchainSummary.actionsNeeded === 0 ? '✓ Ready' : `! ${toolchainSummary.actionsNeeded}`}
              </span>
            </div>
            <span class="action-desc">{dict.actDoctorDesc}</span>
          </div>
        </button>

        <!-- 5. Pengaturan -->
        <button class="action-item" onclick={() => (quickSettingsModalOpen = true)}>
          <div class="action-icon-box">⚙️</div>
          <div class="action-details">
            <div class="action-title-row">
              <span class="action-title">{dict.actSettings}</span>
              <span class="theme-lang-pill">{settingsStore.theme.toUpperCase()} • {settingsStore.language.toUpperCase()}</span>
            </div>
            <span class="action-desc">{dict.actSettingsDesc}</span>
          </div>
        </button>
      </div>

      <!-- Bottom System Specs -->
      <div class="left-footer">
        <span class="spec-pill">● RAM &lt; 150MB</span>
        <span class="spec-pill">⚡ Svelte 5</span>
      </div>
    </div>

    <!-- Kolom Kanan (Recent Projects ala Xcode) -->
    <div class="column-right">
      <div class="recents-header">
        <div class="recents-title-row">
          <span class="recents-title">{dict.recentsTitle}</span>
          <span class="recents-count">{filteredProjects.length}</span>
        </div>
        <div class="search-input-wrap">
          <svg class="search-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="8"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          </svg>
          <input
            bind:this={searchInputEl}
            type="text"
            class="project-search-input"
            placeholder={dict.searchPlaceholder}
            bind:value={searchQuery}
          />
          {#if searchQuery}
            <button class="clear-search-btn" onclick={() => (searchQuery = '')} aria-label="Clear filter">✕</button>
          {/if}
        </div>
      </div>

      <!-- Projects List -->
      <div class="projects-scroll-area">
        {#if filteredProjects.length === 0}
          <div class="empty-projects-state">
            {#if searchQuery}
              <span class="empty-icon">🔍</span>
              <span class="empty-text">{dict.noMatch} "{searchQuery}"</span>
            {:else}
              <span class="empty-icon">📂</span>
              <span class="empty-text">{dict.emptyRecents}</span>
            {/if}
          </div>
        {:else}
          <div class="projects-list-wrap" role="list">
            {#each filteredProjects as proj, idx (proj.path)}
              {@const isSelected = selectedIndex === idx}
              {@const icon = getProjectIcon(proj.name, proj.path)}
              <div
                class="project-card"
                class:selected={isSelected}
                class:missing={!proj.exists}
                onclick={() => onSelectProject(proj.path)}
                onmouseenter={() => (selectedIndex = idx)}
                role="button"
                tabindex="0"
                onkeydown={(e) => {
                  if (e.key === 'Enter') onSelectProject(proj.path);
                }}
              >
                <div class="project-icon-box">{icon}</div>

                <div class="project-text-box">
                  <div class="project-title-row">
                    <span class="project-name">{proj.name}</span>
                    {#if !proj.exists}
                      <span class="missing-badge">not found</span>
                    {/if}
                  </div>
                  <div class="project-path" title={proj.path}>{proj.path}</div>
                  <div class="project-meta-row">
                    {#if proj.lastBranch}
                      <span class="branch-tag">🌿 {proj.lastBranch}</span>
                    {/if}
                    <span class="time-tag">{formatRelativeTime(proj.lastOpened)}</span>
                  </div>
                </div>

                <div class="project-actions-box" onclick={(e) => e.stopPropagation()} role="presentation">
                  <button
                    class="btn-remove-project"
                    onclick={(e) => handleRemoveProject(e, proj.path)}
                    title={dict.removeTooltip}
                    aria-label="Remove project"
                  >
                    ✕
                  </button>
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    </div>
  </div>
</div>

<!-- Modal 1: Buat Project Baru -->
{#if newProjectModalOpen}
  <div class="modal-backdrop" onclick={() => (newProjectModalOpen = false)} role="presentation">
    <div class="modal-window" onclick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" tabindex="-1">
      <div class="modal-header">
        <h3>{dict.newModalTitle}</h3>
        <button class="modal-close-btn" onclick={() => (newProjectModalOpen = false)}>✕</button>
      </div>
      <div class="modal-content">
        <p class="modal-desc">{dict.newModalDesc}</p>
        <div class="form-row">
          <label class="form-label" for="proj-name">Nama Project:</label>
          <input id="proj-name" type="text" class="modal-input" bind:value={newProjectName} placeholder="my_app" />
        </div>
        <div class="form-row">
          <label class="form-label" for="proj-org">Organization (--org):</label>
          <input id="proj-org" type="text" class="modal-input" bind:value={newProjectOrg} placeholder="id.co.bankjatim" />
        </div>

        <div class="code-preview-box">
          <span class="code-snippet">flutter create --org {newProjectOrg} {newProjectName}</span>
          <button class="btn-copy-code" onclick={() => copySnippet(`flutter create --org ${newProjectOrg} ${newProjectName}`)}>
            {copiedSnippet === `flutter create --org ${newProjectOrg} ${newProjectName}` ? dict.copied : dict.copy}
          </button>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn-subtle" onclick={() => (newProjectModalOpen = false)}>{dict.close}</button>
        <button
          class="btn-accent"
          onclick={() => {
            newProjectModalOpen = false;
            onOpenFolder();
          }}
        >
          {dict.actOpen}
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- Modal 2: Clone Repositori Git -->
{#if cloneRepoModalOpen}
  <div class="modal-backdrop" onclick={() => (cloneRepoModalOpen = false)} role="presentation">
    <div class="modal-window" onclick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" tabindex="-1">
      <div class="modal-header">
        <h3>{dict.cloneModalTitle}</h3>
        <button class="modal-close-btn" onclick={() => (cloneRepoModalOpen = false)}>✕</button>
      </div>
      <div class="modal-content">
        <p class="modal-desc">{dict.cloneModalDesc}</p>
        <div class="form-row">
          <label class="form-label" for="clone-url">Repository URL:</label>
          <input id="clone-url" type="text" class="modal-input" bind:value={cloneRepoUrl} placeholder="https://code.istar.id/..." />
        </div>
        <div class="form-row">
          <label class="form-label" for="clone-dir">Target Directory:</label>
          <input id="clone-dir" type="text" class="modal-input" bind:value={cloneTargetDir} placeholder="/mnt/storage/projects" />
        </div>

        <div class="code-preview-box">
          <span class="code-snippet">git clone {cloneRepoUrl}</span>
          <button class="btn-copy-code" onclick={() => copySnippet(`git clone ${cloneRepoUrl}`)}>
            {copiedSnippet === `git clone ${cloneRepoUrl}` ? dict.copied : dict.copy}
          </button>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn-subtle" onclick={() => (cloneRepoModalOpen = false)}>{dict.close}</button>
        <button
          class="btn-accent"
          onclick={() => {
            cloneRepoModalOpen = false;
            onOpenFolder();
          }}
        >
          {dict.actOpen}
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- Modal 3: Petak Doctor -->
{#if doctorModalOpen}
  <div class="modal-backdrop" onclick={() => (doctorModalOpen = false)} role="presentation">
    <div class="modal-window doctor-modal-window" onclick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" tabindex="-1">
      <div class="modal-header">
        <div class="doctor-modal-title">
          <h3>🩺 {dict.docTitle}</h3>
          <span class="status-summary-pill" class:ready={toolchainSummary.actionsNeeded === 0} class:warning={toolchainSummary.actionsNeeded > 0}>
            ● {toolchainSummary.actionsNeeded === 0 ? dict.allReady : `${toolchainSummary.actionsNeeded} ${dict.needAction}`}
          </span>
        </div>
        <button class="modal-close-btn" onclick={() => (doctorModalOpen = false)}>✕</button>
      </div>

      <div class="modal-content doctor-content">
        <div class="doctor-items-list">
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
                <button class="btn-doctor-action guide" onclick={() => { doctorModalOpen = false; onOpenSettings(); }}>Configure SDK</button>
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
                <button class="btn-doctor-action guide" onclick={() => { doctorModalOpen = false; onOpenSettings(); }}>Configure SDK</button>
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
                <button class="btn-doctor-action guide" onclick={() => { doctorModalOpen = false; onOpenSettings(); }}>Configure SDK</button>
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
                <button class="btn-doctor-action guide" onclick={() => { doctorModalOpen = false; onOpenSettings(); }}>Configure SDK</button>
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
              <span class="status-badge-dot" class:ok={toolchainSummary.scrcpyOk} class:warn={!toolchainSummary.scrcpyOk}></span>
              <div class="tool-labels">
                <div class="tool-name-row">
                  <span class="tool-name">scrcpy Mirroring</span>
                  <span class="tool-version">{toolchainSummary.scrcpyOk ? (toolchainSummary.tc?.scrcpy?.version || 'Ready') : 'Missing in PATH'}</span>
                </div>
                <span class="tool-detail">{toolchainSummary.scrcpyOk ? (toolchainSummary.tc?.scrcpy?.path || 'scrcpy binary ready') : 'Dibutuhkan untuk mirror layar device Android USB'}</span>
              </div>
            </div>
            <div class="tool-action">
              {#if toolchainSummary.scrcpyOk}
                <span class="badge-ready">✓ Ready</span>
              {:else}
                <button class="btn-doctor-action guide" onclick={() => (scrcpyModalOpen = true)}>
                  <span>📖</span> {dict.btnScrcpyGuide}
                </button>
              {/if}
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
      </div>

      <div class="modal-footer doctor-footer-row">
        <button class="btn-recheck" onclick={() => toolchainStore.refresh('')}>
          <span>🔄</span> {dict.btnRecheck}
        </button>
        <div class="doctor-footer-right">
          <button class="doctor-footer-link" onclick={() => { doctorModalOpen = false; onOpenSettings(); }}>
            {dict.docFooterLink} →
          </button>
          <button class="btn-subtle" onclick={() => (doctorModalOpen = false)}>{dict.close}</button>
        </div>
      </div>
    </div>
  </div>
{/if}

<!-- Modal 4: Pengaturan Cepat -->
{#if quickSettingsModalOpen}
  <div class="modal-backdrop" onclick={() => (quickSettingsModalOpen = false)} role="presentation">
    <div class="modal-window" onclick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" tabindex="-1">
      <div class="modal-header">
        <h3>⚙️ {dict.prefTitle}</h3>
        <button class="modal-close-btn" onclick={() => (quickSettingsModalOpen = false)}>✕</button>
      </div>

      <div class="modal-content">
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

      <div class="modal-footer">
        <button
          class="btn-subtle"
          onclick={() => {
            quickSettingsModalOpen = false;
            onOpenSettings();
          }}
        >
          {dict.docFooterLink}
        </button>
        <button class="btn-accent" onclick={() => (quickSettingsModalOpen = false)}>{dict.close}</button>
      </div>
    </div>
  </div>
{/if}

<!-- Modal 5: Panduan Instalasi scrcpy -->
{#if scrcpyModalOpen}
  <div class="modal-backdrop show" onclick={() => (scrcpyModalOpen = false)} role="presentation">
    <div class="guide-modal" onclick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" tabindex="-1">
      <div class="modal-header">
        <h3>Panduan Instalasi scrcpy (Device Mirroring)</h3>
        <button class="modal-close-btn" onclick={() => (scrcpyModalOpen = false)} aria-label="Close">✕</button>
      </div>
      <div class="modal-body">
        <p>Petak membutuhkan tool <code>scrcpy</code> di PATH untuk menampilkan mirroring layar perangkat Android tanpa lag.</p>

        <div>
          <strong style="color: var(--text-main); font-size: 12px;">Untuk macOS (Homebrew):</strong>
          <div class="code-preview-box" style="margin-top: 6px;">
            <span class="code-snippet">brew install scrcpy</span>
            <button class="btn-copy-code" onclick={() => copySnippet('brew install scrcpy')}>
              {copiedSnippet === 'brew install scrcpy' ? dict.copied : dict.copy}
            </button>
          </div>
        </div>

        <div>
          <strong style="color: var(--text-main); font-size: 12px;">Untuk Ubuntu / Debian Linux:</strong>
          <div class="code-preview-box" style="margin-top: 6px;">
            <span class="code-snippet">sudo apt update && sudo apt install scrcpy</span>
            <button class="btn-copy-code" onclick={() => copySnippet('sudo apt update && sudo apt install scrcpy')}>
              {copiedSnippet === 'sudo apt update && sudo apt install scrcpy' ? dict.copied : dict.copy}
            </button>
          </div>
        </div>

        <p style="font-size: 11px; color: var(--text-dim); margin-top: 8px;">
          Setelah instalasi selesai, buka Petak Doctor dan klik <strong>Pindai Ulang</strong>.
        </p>
      </div>
      <div class="modal-footer">
        <button class="btn-subtle" onclick={() => (scrcpyModalOpen = false)}>{dict.close}</button>
      </div>
    </div>
  </div>
{/if}

<style>
  :global(:root) {
    --bg-app: var(--p-bg-base, #0c0d10);
    --bg-card: var(--p-bg-surface, #121317);
    --bg-card-hover: var(--p-bg-hover, #22242c);
    --bg-elevated: var(--p-bg-elevated, #1c1e24);
    --border-subtle: var(--border-subtle, rgba(255, 255, 255, 0.06));
    --border: var(--border-default, #1e2027);
    --border-strong: #2f323c;
    --text-main: var(--text, #d8d9dc);
    --text-muted: var(--text-muted, #8b8f98);
    --text-dim: #606470;
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
    --font-sans: 'Geist', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    --font-code: 'JetBrains Mono', ui-monospace, SFMono-Regular, monospace;
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
    min-height: calc(100vh - 36px);
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--bg-app);
    font-family: var(--font-sans);
    padding: 24px;
    box-sizing: border-box;
  }

  /* Xcode-Style Dual Column Floating Window */
  .xcode-window {
    display: flex;
    width: 880px;
    max-width: 95vw;
    height: 560px;
    max-height: 88vh;
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 12px;
    box-shadow: 0 24px 64px rgba(0, 0, 0, 0.6), 0 4px 16px rgba(0, 0, 0, 0.4);
    overflow: hidden;
  }

  /* Left Column: Brand & Actions */
  .column-left {
    width: 370px;
    flex-shrink: 0;
    background: var(--p-bg-base, #0c0d10);
    border-right: 1px solid var(--border-default, #1e2027);
    display: flex;
    flex-direction: column;
    padding: 28px 24px;
    box-sizing: border-box;
    justify-content: space-between;
  }

  :global(.light-theme) .column-left {
    background: #f7f8fa;
  }

  .brand-section {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
  }

  .welcome-title {
    font-size: 28px;
    font-weight: 700;
    letter-spacing: -0.5px;
    color: var(--text-main);
    margin: 8px 0 0 0;
  }

  .version-tag {
    font-size: 11px;
    color: var(--text-dim);
    margin-bottom: 4px;
    font-family: var(--font-code);
  }

  .brand-tagline {
    font-size: 11.5px;
    color: var(--text-muted);
    margin: 0;
    line-height: 1.35;
    max-width: 260px;
  }

  /* 5 Action Items Menu */
  .actions-menu {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin: 16px 0;
  }

  .action-item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 12px;
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.02);
    border: 1px solid transparent;
    cursor: pointer;
    text-align: left;
    transition: all 0.15s ease;
  }

  .action-item:hover {
    background: var(--bg-card-hover);
    border-color: var(--border-subtle);
    transform: translateY(-1px);
  }

  .action-item.primary {
    background: rgba(110, 168, 255, 0.08);
    border-color: rgba(110, 168, 255, 0.2);
  }

  .action-item.primary:hover {
    background: rgba(110, 168, 255, 0.14);
    border-color: rgba(110, 168, 255, 0.35);
  }

  .action-icon-box {
    font-size: 20px;
    width: 34px;
    height: 34px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(255, 255, 255, 0.04);
    border-radius: 6px;
    flex-shrink: 0;
  }

  .action-details {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
  }

  .action-title-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
  }

  .action-title {
    font-size: 12.5px;
    font-weight: 600;
    color: var(--text-main);
  }

  .action-kbd {
    font-size: 10px;
    font-family: var(--font-code);
    color: var(--text-dim);
    background: rgba(255, 255, 255, 0.06);
    padding: 1px 5px;
    border-radius: 3px;
  }

  .action-desc {
    font-size: 11px;
    color: var(--text-muted);
    line-height: 1.3;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .doctor-badge {
    font-size: 10px;
    font-weight: 600;
    padding: 1px 6px;
    border-radius: 4px;
  }

  .doctor-badge.ready {
    background: var(--success-bg);
    color: var(--success);
    border: 1px solid var(--success-border);
  }

  .doctor-badge.warn {
    background: var(--warning-bg);
    color: var(--warning);
    border: 1px solid var(--warning-border);
  }

  .theme-lang-pill {
    font-size: 10px;
    color: var(--text-dim);
    background: rgba(255, 255, 255, 0.05);
    padding: 1px 5px;
    border-radius: 3px;
  }

  .left-footer {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
  }

  .spec-pill {
    font-size: 10px;
    font-family: var(--font-code);
    color: var(--text-dim);
    background: rgba(255, 255, 255, 0.03);
    padding: 2px 6px;
    border-radius: 4px;
    border: 1px solid var(--border-subtle);
  }

  /* Right Column: Recent Projects */
  .column-right {
    flex: 1;
    display: flex;
    flex-direction: column;
    background: var(--bg-card);
    padding: 20px 24px;
    box-sizing: border-box;
    overflow: hidden;
  }

  .recents-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 12px;
    flex-shrink: 0;
  }

  .recents-title-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .recents-title {
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 0.2px;
    color: var(--text-main);
  }

  .recents-count {
    font-size: 11px;
    color: var(--text-dim);
    background: rgba(255, 255, 255, 0.06);
    padding: 1px 6px;
    border-radius: 10px;
    font-weight: 600;
  }

  .search-input-wrap {
    position: relative;
    display: flex;
    align-items: center;
    width: 220px;
  }

  .search-icon {
    position: absolute;
    left: 8px;
    color: var(--text-dim);
    pointer-events: none;
  }

  .project-search-input {
    width: 100%;
    height: 28px;
    background: rgba(0, 0, 0, 0.25);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 0 24px 0 26px;
    font-size: 11.5px;
    color: var(--text-main);
    outline: none;
    box-sizing: border-box;
    transition: border-color 0.15s;
  }

  .project-search-input:focus {
    border-color: var(--accent);
  }

  .clear-search-btn {
    position: absolute;
    right: 6px;
    background: none;
    border: none;
    color: var(--text-dim);
    cursor: pointer;
    font-size: 10px;
    padding: 2px;
  }

  .projects-scroll-area {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    margin: 0 -8px;
    padding: 0 8px;
  }

  .projects-scroll-area::-webkit-scrollbar {
    width: 5px;
  }
  .projects-scroll-area::-webkit-scrollbar-thumb {
    background: var(--border-strong);
    border-radius: 4px;
  }

  .empty-projects-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 280px;
    color: var(--text-dim);
    gap: 8px;
  }

  .empty-icon {
    font-size: 28px;
    opacity: 0.7;
  }

  .empty-text {
    font-size: 12px;
    text-align: center;
    max-width: 280px;
  }

  .projects-list-wrap {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  /* Recent Project Card */
  .project-card {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 10px;
    border-radius: 6px;
    background: transparent;
    border: 1px solid transparent;
    cursor: pointer;
    transition: all 0.12s ease;
  }

  .project-card:hover {
    background: var(--bg-card-hover);
    border-color: var(--border-subtle);
  }

  .project-card.selected {
    background: rgba(110, 168, 255, 0.08);
    border-color: rgba(110, 168, 255, 0.28);
  }

  .project-card.missing {
    opacity: 0.55;
  }

  .project-icon-box {
    font-size: 20px;
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .project-text-box {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }

  .project-title-row {
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

  .missing-badge {
    font-size: 10px;
    color: var(--danger);
    background: var(--danger-bg);
    padding: 1px 4px;
    border-radius: 3px;
    font-family: var(--font-code);
  }

  .project-path {
    font-size: 11px;
    color: var(--text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    margin-top: 2px;
  }

  .project-meta-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 3px;
  }

  .branch-tag {
    font-size: 10px;
    color: var(--text-dim);
    font-family: var(--font-code);
  }

  .time-tag {
    font-size: 10px;
    color: var(--text-dim);
  }

  .project-actions-box {
    opacity: 0;
    transition: opacity 0.15s;
  }

  .project-card:hover .project-actions-box,
  .project-card.selected .project-actions-box {
    opacity: 1;
  }

  .btn-remove-project {
    width: 22px;
    height: 22px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
    background: transparent;
    border: none;
    color: var(--text-dim);
    cursor: pointer;
    font-size: 12px;
    transition: all 0.12s;
  }

  .btn-remove-project:hover {
    background: rgba(240, 122, 116, 0.18);
    color: var(--danger);
  }

  /* Modals */
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.65);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 500;
  }

  .modal-window {
    width: 480px;
    max-width: 90vw;
    background: var(--bg-card);
    border: 1px solid var(--border-strong);
    border-radius: 10px;
    box-shadow: 0 20px 48px rgba(0, 0, 0, 0.6);
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .doctor-modal-window {
    width: 620px;
    max-height: 85vh;
  }

  .guide-modal {
    width: 500px;
    max-width: 90vw;
    background: var(--bg-card);
    border: 1px solid var(--border-strong);
    border-radius: 10px;
    padding: 16px 20px;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 20px;
    border-bottom: 1px solid var(--border);
  }

  .modal-header h3 {
    margin: 0;
    font-size: 14px;
    font-weight: 700;
    color: var(--text-main);
  }

  .modal-close-btn {
    background: none;
    border: none;
    color: var(--text-dim);
    cursor: pointer;
    font-size: 14px;
    padding: 4px;
    border-radius: 4px;
  }

  .modal-close-btn:hover {
    color: var(--text-main);
  }

  .modal-content {
    padding: 16px 20px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .doctor-content {
    overflow-y: auto;
    max-height: 60vh;
  }

  .modal-desc {
    margin: 0;
    font-size: 12px;
    color: var(--text-muted);
    line-height: 1.45;
  }

  .form-row {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .form-label {
    font-size: 11.5px;
    font-weight: 600;
    color: var(--text-main);
  }

  .modal-input {
    height: 32px;
    background: rgba(0, 0, 0, 0.25);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 0 10px;
    font-size: 12px;
    color: var(--text-main);
    outline: none;
  }

  .modal-input:focus {
    border-color: var(--accent);
  }

  .code-preview-box {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    background: #0f1013;
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 8px 12px;
    margin-top: 4px;
  }

  .code-snippet {
    font-family: var(--font-code);
    font-size: 11.5px;
    color: #7eb2ff;
    word-break: break-all;
  }

  .btn-copy-code {
    background: rgba(110, 168, 255, 0.12);
    border: 1px solid rgba(110, 168, 255, 0.25);
    color: #90beff;
    padding: 4px 8px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    flex-shrink: 0;
  }

  .btn-copy-code:hover {
    background: rgba(110, 168, 255, 0.2);
  }

  .modal-footer {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    padding: 12px 20px;
    border-top: 1px solid var(--border);
    background: rgba(0, 0, 0, 0.15);
  }

  .btn-subtle {
    height: 28px;
    padding: 0 12px;
    border-radius: 6px;
    background: transparent;
    border: 1px solid var(--border);
    color: var(--text-muted);
    font-size: 11.5px;
    cursor: pointer;
  }

  .btn-subtle:hover {
    color: var(--text-main);
    border-color: var(--border-strong);
  }

  .btn-accent {
    height: 28px;
    padding: 0 14px;
    border-radius: 6px;
    background: var(--accent);
    border: none;
    color: #fff;
    font-size: 11.5px;
    font-weight: 600;
    cursor: pointer;
  }

  .btn-accent:hover {
    background: var(--accent-hover);
  }

  /* Toolchain items inside Doctor Modal */
  .doctor-modal-title {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .status-summary-pill {
    font-size: 10px;
    padding: 2px 6px;
    border-radius: 4px;
    font-weight: 600;
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

  .doctor-items-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .tool-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 8px 12px;
    background: rgba(255, 255, 255, 0.02);
    border: 1px solid var(--border-subtle);
    border-radius: 6px;
  }

  .tool-left {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .status-badge-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--text-dim);
    flex-shrink: 0;
  }

  .status-badge-dot.ok {
    background: var(--success);
    box-shadow: 0 0 6px var(--success);
  }

  .status-badge-dot.warn {
    background: var(--warning);
    box-shadow: 0 0 6px var(--warning);
  }

  .status-badge-dot.err {
    background: var(--danger);
    box-shadow: 0 0 6px var(--danger);
  }

  .status-badge-dot.neutral {
    background: var(--text-dim);
  }

  .tool-labels {
    display: flex;
    flex-direction: column;
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
    font-size: 11px;
    color: var(--text-dim);
    font-family: var(--font-code);
  }

  .tool-detail {
    font-size: 10.5px;
    color: var(--text-muted);
  }

  .badge-ready {
    font-size: 11px;
    color: var(--success);
    font-weight: 600;
  }

  .btn-doctor-action {
    padding: 3px 8px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 600;
    border: none;
    cursor: pointer;
  }

  .btn-doctor-action.install {
    background: var(--accent);
    color: #fff;
  }

  .btn-doctor-action.guide {
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid var(--border);
    color: var(--text-muted);
  }

  .btn-doctor-action.guide:hover {
    color: var(--text-main);
  }

  .install-progress-box {
    padding: 8px 12px;
    background: rgba(110, 168, 255, 0.05);
    border: 1px solid var(--accent-border);
    border-radius: 6px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .progress-status-text {
    display: flex;
    justify-content: space-between;
    font-size: 11px;
    color: var(--accent);
  }

  .progress-bar-track {
    height: 4px;
    background: rgba(0, 0, 0, 0.3);
    border-radius: 2px;
    overflow: hidden;
  }

  .progress-bar-fill {
    height: 100%;
    background: var(--accent);
    transition: width 0.3s;
  }

  .doctor-footer-row {
    justify-content: space-between;
  }

  .btn-recheck {
    background: none;
    border: 1px solid var(--border);
    color: var(--text-muted);
    font-size: 11.5px;
    padding: 4px 10px;
    border-radius: 6px;
    cursor: pointer;
  }

  .btn-recheck:hover {
    color: var(--text-main);
  }

  .doctor-footer-right {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .doctor-footer-link {
    background: none;
    border: none;
    color: var(--accent);
    font-size: 11.5px;
    cursor: pointer;
    text-decoration: underline;
  }

  /* Quick Settings rows */
  .pref-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 8px 0;
    border-bottom: 1px solid var(--border-subtle);
  }

  .pref-row:last-child {
    border-bottom: none;
  }

  .pref-label-group {
    display: flex;
    flex-direction: column;
  }

  .pref-label {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-main);
  }

  .pref-desc {
    font-size: 11px;
    color: var(--text-muted);
  }

  .segmented-control {
    display: flex;
    background: rgba(0, 0, 0, 0.25);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 2px;
    gap: 2px;
  }

  .segmented-btn {
    padding: 3px 8px;
    border-radius: 4px;
    background: none;
    border: none;
    color: var(--text-dim);
    font-size: 11px;
    cursor: pointer;
    font-weight: 500;
  }

  .segmented-btn.active {
    background: var(--bg-elevated);
    color: var(--text-main);
    font-weight: 600;
  }

  /* Switch */
  .switch {
    position: relative;
    display: inline-block;
    width: 36px;
    height: 20px;
  }
  .switch input {
    opacity: 0;
    width: 0;
    height: 0;
  }
  .slider {
    position: absolute;
    cursor: pointer;
    inset: 0;
    background: rgba(255, 255, 255, 0.1);
    transition: 0.2s;
    border-radius: 20px;
    border: 1px solid var(--border);
  }
  .slider:before {
    position: absolute;
    content: '';
    height: 14px;
    width: 14px;
    left: 2px;
    bottom: 2px;
    background: #fff;
    transition: 0.2s;
    border-radius: 50%;
  }
  input:checked + .slider {
    background: var(--accent);
  }
  input:checked + .slider:before {
    transform: translateX(16px);
  }

  /* Logo Petak & Keyframe Animations */
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
    inset: -6px;
    border-radius: 12px;
    background: radial-gradient(circle, rgba(110, 168, 255, 0.35) 0%, rgba(110, 168, 255, 0) 70%);
    animation: petak-glow 4s ease-in-out infinite alternate;
    pointer-events: none;
  }

  .petak-logo {
    display: grid;
    grid-template-columns: 1fr 1fr;
    grid-gap: 3px;
    width: 34px;
    height: 34px;
    padding: 3px;
    background: #1e2026;
    border: 1px solid #363945;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.35);
    animation: petak-logo-breathe 4s ease-in-out infinite alternate;
  }

  .petak-cell {
    border-radius: 3px;
    transition: all 0.3s ease;
  }

  .petak-cell.c1 {
    background: #6ea8ff;
    animation: petak-cell-pulse-1 4s ease-in-out infinite alternate;
  }
  .petak-cell.c2 {
    background: #5092f6;
    opacity: 0.85;
  }
  .petak-cell.c3 {
    background: #3b7cd8;
    opacity: 0.7;
  }
  .petak-cell.c4 {
    background: #2863b5;
    opacity: 0.55;
  }

  @keyframes petak-glow {
    0% {
      opacity: 0.3;
      transform: scale(0.9);
    }
    100% {
      opacity: 0.8;
      transform: scale(1.1);
    }
  }

  @keyframes petak-logo-breathe {
    0% {
      transform: scale(1);
    }
    100% {
      transform: scale(1.03);
    }
  }

  @keyframes petak-cell-pulse-1 {
    0% {
      opacity: 0.8;
      filter: drop-shadow(0 0 2px rgba(110, 168, 255, 0.4));
    }
    100% {
      opacity: 1;
      filter: drop-shadow(0 0 5px rgba(110, 168, 255, 0.8));
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .logo-glow,
    .petak-logo,
    .petak-cell.c1 {
      animation: none !important;
    }
  }
</style>
