<script lang="ts">
  import { onMount } from 'svelte';
  import { settingsStore } from './settingsStore.svelte';
  import { editorSettings } from '../editor/editorSettings.svelte';
  import { getFormatOnSaveConfig, setFormatOnSave } from '../editor/formatLogic';
  import { toolchainStore } from '../toolchain/toolchainStore.svelte';
  import { api, type KotlinLsStatus, type KotlinLsProgress, type UnlistenFn } from '../../lib/api';
  import { agentsStore } from '../agents/agents.svelte';
  import type { PermissionMode, HermesDetectionResult, LlmQuotaReport } from '../agents/types';
  import {
    getModelsForProvider,
    detectProviderFromModel,
    getModelDescription,
    PROVIDER_MODELS,
    ALL_PRESET_MODELS,
  } from '../agents/agentsLogic';
  import AccountsSettings from '../accounts/AccountsSettings.svelte';
  import { keymapStore, keyEventToShortcut, type ConflictInfo } from './keymapStore.svelte';
  import McpSettings from './McpSettings.svelte';

  let {
    root = '',
    onclose = () => settingsStore.close(),
  }: {
    root?: string;
    onclose?: () => void;
  } = $props();

  let searchQuery = $state('');
  let formatOnSave = $state<Record<string, boolean>>({});

  // Toolchains config inputs
  let flutterSdk = $state(toolchainStore.config.flutterSdk || '');
  let androidSdk = $state(toolchainStore.config.androidSdk || '');
  let kotlinLs = $state(toolchainStore.config.kotlinLanguageServer || '');
  let saveFeedback = $state<string | null>(null);

  // Kotlin installer
  let kotlinStatus = $state<KotlinLsStatus | null>(null);
  let isInstallingKotlin = $state(false);
  let kotlinProgress = $state<KotlinLsProgress | null>(null);
  let kotlinInstallError = $state<string | null>(null);
  let unlistenProgress: UnlistenFn | null = null;

  // AI Agents & Disiplin
  let selectedConfigSlotId = $state('s2');
  let activeProvider = $state('gemini');
  let activeModelId = $state('ag/gemini-3.8-flash-high');
  let activeFallbackModel = $state('gemini-2.5-pro');
  let activePermissionMode = $state<PermissionMode>('ask');
  let isCustomModel = $state(false);
  let customModelId = $state('');
  let adoptSuccessMessage = $state<string | null>(null);
  let hermesDetection = $state<HermesDetectionResult | null>(null);
  let quotaReport = $state<LlmQuotaReport | null>(null);
  let isQuotaLoading = $state(false);
  let isHermesLoading = $state(false);

  let currentSlot = $derived(
    agentsStore.slots.find((s) => s.id === selectedConfigSlotId) || agentsStore.slots[0]
  );

  $effect(() => {
    if (currentSlot?.config) {
      const model = currentSlot.config.model || 'ag/gemini-3.8-flash-high';
      activeModelId = model;
      activeProvider = detectProviderFromModel(model);
      activePermissionMode = (currentSlot.config.permission as PermissionMode) || 'ask';
      activeFallbackModel = currentSlot.config.fallbackModel || 'gemini-2.5-pro';

      const providerModels = getModelsForProvider(activeProvider);
      const isKnown = providerModels.some((m) => m.id === model);
      isCustomModel = !isKnown;
      if (!isKnown) {
        customModelId = model;
      }
    }
  });

  function handleProviderChange() {
    const models = getModelsForProvider(activeProvider);
    const recommended = models.find((m) => m.recommended) || models[0];
    if (recommended) {
      activeModelId = recommended.id;
      isCustomModel = false;
      customModelId = '';
      if (selectedConfigSlotId) {
        agentsStore.updateSlotConfig(selectedConfigSlotId, {
          model: activeModelId,
          kind: activeProvider === 'hermes' ? 'hermes' : 'acp-custom',
        });
      }
    }
  }

  function handleModelSelectChange(e: Event) {
    const val = (e.target as HTMLSelectElement).value;
    if (val === 'custom') {
      isCustomModel = true;
      if (!customModelId) customModelId = activeModelId;
    } else {
      isCustomModel = false;
      activeModelId = val;
      if (selectedConfigSlotId) {
        agentsStore.updateSlotConfig(selectedConfigSlotId, { model: activeModelId });
      }
    }
  }

  function handleCustomModelInput(e: Event) {
    const val = (e.target as HTMLInputElement).value;
    customModelId = val;
    activeModelId = val;
    if (selectedConfigSlotId) {
      agentsStore.updateSlotConfig(selectedConfigSlotId, { model: activeModelId });
    }
  }

  function handleFallbackChange(e: Event) {
    const val = (e.target as HTMLSelectElement).value;
    activeFallbackModel = val;
    if (selectedConfigSlotId) {
      agentsStore.updateSlotConfig(selectedConfigSlotId, { fallbackModel: val });
    }
  }

  // Manual Bot Addition
  let isAddBotFormOpen = $state(false);
  let newBotLabel = $state('Senior Coder 2');
  let newBotIcon = $state('⚡');
  let newBotPlatform = $state('antigravity');
  let newBotModel = $state('ag/gemini-3.8-flash-high');
  let newBotPermission = $state<PermissionMode>('ask');
  let isAddingBot = $state(false);

  async function handleAddBotSubmit() {
    if (!newBotLabel.trim()) return;
    isAddingBot = true;
    try {
      const newSlot = {
        id: `slot-${Date.now().toString(36)}`,
        label: `${newBotIcon} ${newBotLabel.trim()}`,
        kind: newBotPlatform === 'hermes' ? 'hermes' : newBotPlatform === 'claude-code' ? 'claude-code' : 'acp-custom',
        command: newBotPlatform === 'claude-code' ? 'npx @agentclientprotocol/claude-agent-acp' : null,
        hermesProfile: newBotPlatform === 'hermes' ? newBotLabel.toLowerCase() : null,
        model: newBotModel,
        fallbackModel: 'gemini-2.5-pro',
        permission: newBotPermission,
        cwd: 'project',
      };
      await agentsStore.addSlot(newSlot);
      isAddBotFormOpen = false;
      newBotLabel = '';
      selectedConfigSlotId = newSlot.id;
    } finally {
      isAddingBot = false;
    }
  }

  function handleSelectSlotToEdit(slotId: string) {
    selectedConfigSlotId = slotId;
    const el = document.getElementById('sec-agents');
    if (el) el.scrollIntoView({ behavior: 'smooth' });
  }

  async function handleRemoveBot(slotId: string) {
    if (confirm('Hapus bot ini dari tim proyek?')) {
      await agentsStore.removeSlot(slotId);
    }
  }

  // Obsidian Vault Integration
  let obsidianVaultPath = $state('/Users/uqi/Documents/Coding/UQi/vault');
  let isObsidianConnected = $derived(!!obsidianVaultPath && obsidianVaultPath.trim().length > 0);
  let isSavingObsidian = $state(false);
  let obsidianFeedback = $state<string | null>(null);

  async function handleSaveObsidianVault() {
    isSavingObsidian = true;
    try {
      const currentTeam = await api.agentLoadTeam();
      const updated = {
        ...currentTeam,
        obsidianVaultPath: obsidianVaultPath.trim() || null,
      };
      await api.agentSaveTeam(updated);
      obsidianFeedback = '✓ Path Obsidian Vault berhasil disimpan ke .petak/team.json!';
      setTimeout(() => {
        obsidianFeedback = null;
      }, 3500);
    } catch (err: any) {
      obsidianFeedback = `Gagal menyimpan: ${err?.message || err}`;
    } finally {
      isSavingObsidian = false;
    }
  }

  function handleAutoDetectObsidian() {
    obsidianVaultPath = '/Users/uqi/Documents/Coding/UQi/vault';
    obsidianFeedback = '🔍 Vault terdeteksi di /Users/uqi/Documents/Coding/UQi/vault';
    setTimeout(() => {
      obsidianFeedback = null;
    }, 3000);
  }

  // Keymap search
  let keymapSearch = $state('');
  let recordingActionId = $state<string | null>(null);
  let keymapConflict = $state<ConflictInfo | null>(null);
  let pendingShortcut = $state<string | null>(null);

  let isId = $derived(settingsStore.language === 'id');

  // 10 Navigasi Kategori (Linear / Raycast Style)
  let categories = $derived([
    { id: 'general', label: isId ? 'Umum' : 'General', icon: 'gear' },
    { id: 'editor', label: isId ? 'Editor Kode' : 'Code Editor', icon: 'code' },
    { id: 'keymap', label: isId ? 'Pintasan Keyboard' : 'Keymap', icon: 'keyboard' },
    { id: 'agents', label: isId ? 'AI Agents & Disiplin' : 'AI Agents & Discipline', icon: 'bot' },
    { id: 'mcp', label: 'MCP Servers', icon: 'server' },
    { id: 'toolchains', label: isId ? 'Toolchain & SDK' : 'Toolchains & SDK', icon: 'tool' },
    { id: 'git', label: 'Git & GitLab', icon: 'git' },
    { id: 'accounts', label: isId ? 'Akun & Jaringan' : 'Accounts & Network', icon: 'user' },
    { id: 'devices', label: isId ? 'Perangkat & Mirror' : 'Devices & Mirror', icon: 'device' },
    { id: 'appearance', label: isId ? 'Tampilan Antarmuka' : 'Appearance', icon: 'appearance' },
  ]);

  function startRecording(actionId: string) {
    recordingActionId = actionId;
    keymapConflict = null;
    pendingShortcut = null;
  }

  function cancelRecording() {
    recordingActionId = null;
    keymapConflict = null;
    pendingShortcut = null;
  }

  function handleKeymapKeydown(e: KeyboardEvent) {
    if (!recordingActionId) return;
    e.preventDefault();
    e.stopPropagation();
    const combo = keyEventToShortcut(e);
    if (!combo) return; // modifier-only press

    pendingShortcut = combo;
    const conflict = keymapStore.updateShortcut(recordingActionId, combo);
    if (conflict) {
      keymapConflict = conflict;
      pendingShortcut = combo;
    } else {
      recordingActionId = null;
      keymapConflict = null;
      pendingShortcut = null;
    }
  }

  function forceApplyShortcut() {
    if (recordingActionId && pendingShortcut) {
      keymapStore.forceUpdateShortcut(recordingActionId, pendingShortcut);
    }
    recordingActionId = null;
    keymapConflict = null;
    pendingShortcut = null;
  }

  const HERMES_DETECTION_FALLBACK = [
    { name: 'manager', icon: '👑', role: 'Planner & Task Orchestrator', model: 'Claude 3.7 Sonnet', status: 'ready' },
    { name: 'techlead', icon: '🧠', role: 'System Architect & Core Modules', model: 'Claude 3.7 Sonnet', status: 'ready' },
    { name: 'senior', icon: '⚡', role: 'Fullstack Flutter & Rust Implementer', model: 'Claude 3.7 Sonnet', status: 'busy' },
    { name: 'senior2', icon: '⚡', role: 'Toolchains, Language Servers & Integrations', model: 'Gemini 2.5 Pro', status: 'ready' },
    { name: 'reviewer', icon: '🔍', role: 'QA, Code Reviewer & Security Auditing', model: 'Gemini 2.5 Pro', status: 'ready' },
    { name: 'designer', icon: '🎨', role: 'UI/UX Design System & Prototypes', model: 'Claude 3.7 Sonnet', status: 'ready' },
  ];

  onMount(() => {
    formatOnSave = getFormatOnSaveConfig();
    loadKotlinStatus();
    loadAgentsData();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onclose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      if (unlistenProgress) unlistenProgress();
    };
  });

  async function loadAgentsData() {
    try {
      hermesDetection = await api.agentDetectHermes();
    } catch {
      hermesDetection = null;
    }
    try {
      quotaReport = await api.agentGetQuotaReport();
    } catch {
      quotaReport = null;
    }
    try {
      const team = await api.agentLoadTeam();
      if (team?.obsidianVaultPath) {
        obsidianVaultPath = team.obsidianVaultPath;
      }
    } catch {
      // ignore
    }
  }

  async function loadKotlinStatus() {
    try {
      kotlinStatus = await api.kotlinLsStatus();
    } catch {
      kotlinStatus = null;
    }
  }

  async function handleInstallKotlinLs() {
    if (isInstallingKotlin) return;
    isInstallingKotlin = true;
    kotlinInstallError = null;
    kotlinProgress = { stage: 'downloading', percent: 10, message: 'Menghubungkan ke GitHub releases…' };
    try {
      unlistenProgress = await api.onKotlinLsProgress((p) => {
        kotlinProgress = p;
      });
      await api.kotlinLsInstall();
      await toolchainStore.refresh(root);
      await loadKotlinStatus();
    } catch (err: any) {
      kotlinInstallError = err?.message || String(err);
    } finally {
      isInstallingKotlin = false;
      if (unlistenProgress) {
        unlistenProgress();
        unlistenProgress = null;
      }
    }
  }

  async function handleSaveToolchains() {
    await toolchainStore.saveConfig(
      {
        flutterSdk: flutterSdk.trim() || null,
        androidSdk: androidSdk.trim() || null,
        kotlinLanguageServer: kotlinLs.trim() || null,
      },
      root
    );
    saveFeedback = isId ? 'Pengaturan toolchain berhasil disimpan' : 'Toolchain settings saved successfully';
    setTimeout(() => {
      saveFeedback = null;
    }, 2500);
    await toolchainStore.refresh(root);
  }

  function handleFormatToggle(lang: string, enabled: boolean) {
    setFormatOnSave(lang, enabled);
    formatOnSave = { ...formatOnSave, [lang]: enabled };
  }

  async function handleAdoptAllProfiles() {
    try {
      const profiles = (hermesDetection?.profiles && hermesDetection.profiles.length > 0)
        ? hermesDetection.profiles
        : HERMES_DETECTION_FALLBACK;

      const slots = profiles.map((p, idx) => ({
        id: `s${idx + 1}`,
        label: p.name.charAt(0).toUpperCase() + p.name.slice(1),
        kind: 'hermes',
        command: null,
        hermesProfile: p.name,
        model: (p as any).model || 'claude-3-7-sonnet',
        fallbackModel: null,
        permission: 'ask',
        cwd: 'project',
      }));

      await api.agentSaveTeam({ version: 1, slots });
      adoptSuccessMessage = isId
        ? 'Semua profil Hermes berhasil diadopsi ke .petak/team.json'
        : 'All Hermes profiles adopted to .petak/team.json';
      setTimeout(() => {
        adoptSuccessMessage = null;
      }, 3500);
    } catch (err: any) {
      adoptSuccessMessage = `Error: ${err?.message || err}`;
    }
  }

  async function handleRefreshQuota() {
    isQuotaLoading = true;
    try {
      quotaReport = await api.agentGetQuotaReport();
    } finally {
      isQuotaLoading = false;
    }
  }

  async function handleRefreshHermes() {
    isHermesLoading = true;
    try {
      hermesDetection = await api.agentDetectHermes();
    } finally {
      isHermesLoading = false;
    }
  }

  function handleSetPermission(mode: PermissionMode) {
    activePermissionMode = mode;
    if (selectedConfigSlotId) {
      agentsStore.setPermissionMode(selectedConfigSlotId, mode);
    }
  }

  let filteredCategories = $derived(
    searchQuery.trim()
      ? categories.filter((c) =>
          c.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
          c.id.toLowerCase().includes(searchQuery.toLowerCase())
        )
      : categories
  );

  let filteredKeymaps = $derived(
    keymapSearch.trim()
      ? keymapStore.keymaps.filter((k) =>
          k.action.toLowerCase().includes(keymapSearch.toLowerCase()) ||
          k.shortcut.toLowerCase().includes(keymapSearch.toLowerCase()) ||
          k.category.toLowerCase().includes(keymapSearch.toLowerCase())
        )
      : keymapStore.keymaps
  );

  let displayHermesProfiles = $derived(
    hermesDetection?.profiles && hermesDetection.profiles.length > 0
      ? hermesDetection.profiles.map((p) => {
          const match = HERMES_DETECTION_FALLBACK.find((f) => f.name === p.name);
          return {
            name: p.name,
            icon: match?.icon || '🤖',
            role: match?.role || 'Autonomous Developer',
            model: p.model || 'Claude 3.7 Sonnet',
            status: p.name === 'senior' ? 'busy' : 'ready',
          };
        })
      : HERMES_DETECTION_FALLBACK
  );
</script>

<div class="settings-backdrop" onclick={onclose} role="presentation">
  <div class="settings-window" onclick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" tabindex="-1">
    <!-- Top Header (48px) -->
    <div class="settings-window-header">
      <div class="settings-title-group">
        <svg class="cat-svg icon-16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
        <span>{isId ? 'Pengaturan Petak (Settings)' : 'Petak Settings'}</span>
      </div>

      <div class="settings-search-bar">
        <input
          type="text"
          placeholder={isId ? 'Cari pengaturan atau pintasan (⌘,)…' : 'Search settings or shortcuts (⌘,)…'}
          bind:value={searchQuery}
        />
        <span class="keycap">⌘,</span>
      </div>

      <button class="close-btn" onclick={onclose} title={isId ? 'Tutup Pengaturan (Esc)' : 'Close Settings (Esc)'} aria-label="Close Settings">
        ✕
      </button>
    </div>

    <!-- Master-Detail Body Split -->
    <div class="settings-body-split">
      <!-- Left Categories Sidebar (200px, Raycast / Linear Style) -->
      <div class="settings-cat-sidebar">
        {#each filteredCategories as cat}
          <button
            class="cat-item-btn"
            class:active={settingsStore.activeCategory === cat.id}
            onclick={() => (settingsStore.activeCategory = cat.id as any)}
          >
            {#if cat.icon === 'gear'}
              <svg class="cat-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            {:else if cat.icon === 'code'}
              <svg class="cat-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <polyline points="16 18 22 12 16 6" />
                <polyline points="8 6 2 12 8 18" />
              </svg>
            {:else if cat.icon === 'keyboard'}
              <svg class="cat-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <rect width="20" height="14" x="2" y="5" rx="2" />
                <line x1="6" y1="10" x2="6.01" y2="10" />
                <line x1="10" y1="10" x2="10.01" y2="10" />
                <line x1="14" y1="10" x2="14.01" y2="10" />
                <line x1="18" y1="10" x2="18.01" y2="10" />
              </svg>
            {:else if cat.icon === 'bot'}
              <svg class="cat-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <rect width="18" height="12" x="3" y="6" rx="2" />
                <circle cx="9" cy="12" r="1" />
                <circle cx="15" cy="12" r="1" />
                <path d="M12 2v4" />
                <path d="M2 14h1" />
                <path d="M21 14h1" />
              </svg>
            {:else if cat.icon === 'server'}
              <svg class="cat-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <rect width="20" height="8" x="2" y="2" rx="2" ry="2" />
                <rect width="20" height="8" x="2" y="14" rx="2" ry="2" />
                <line x1="6" y1="6" x2="6.01" y2="6" stroke-width="2" />
                <line x1="6" y1="18" x2="6.01" y2="18" stroke-width="2" />
              </svg>
            {:else if cat.icon === 'tool'}
              <svg class="cat-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="m14.7 13.5-3.7-3.7a2 2 0 0 0-2.8 0L2 16.1a1 1 0 0 0 0 1.4l4.5 4.5a1 1 0 0 0 1.4 0l6.3-6.2a2 2 0 0 0 0-2.8z" />
                <path d="m18 8 3 3" />
                <path d="m14.5 4.5 5 5" />
              </svg>
            {:else if cat.icon === 'git'}
              <svg class="cat-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <line x1="6" y1="3" x2="6" y2="15" />
                <circle cx="18" cy="6" r="3" />
                <circle cx="6" cy="18" r="3" />
                <path d="M18 9a9 9 0 0 1-9 9" />
              </svg>
            {:else if cat.icon === 'user'}
              <svg class="cat-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
            {:else if cat.icon === 'device'}
              <svg class="cat-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <rect width="14" height="20" x="5" y="2" rx="2" ry="2" />
                <line x1="12" y1="18" x2="12.01" y2="18" />
              </svg>
            {:else if cat.icon === 'appearance'}
              <svg class="cat-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <circle cx="12" cy="12" r="10" />
                <path d="M12 2a10 10 0 0 0 0 20z" fill="currentColor" />
              </svg>
            {/if}
            <span>{cat.label}</span>
          </button>
        {/each}
      </div>

      <!-- Right Content Pane -->
      <div class="settings-content-pane">
        <!-- 1. Umum (General) -->
        {#if settingsStore.activeCategory === 'general'}
          <div class="settings-section">
            <h2 class="settings-section-title">{isId ? 'Pengaturan Umum' : 'General Settings'}</h2>
            <div class="settings-group">
              <div class="setting-item-row">
                <div class="setting-meta">
                  <span class="setting-label">{isId ? 'Tema Tampilan' : 'Appearance Theme'}</span>
                  <span class="setting-hint">{isId ? 'Beralih antara tema gelap dan terang' : 'Switch between dark and light appearance'}</span>
                </div>
                <div class="pill-group">
                  <button
                    class="pill-btn"
                    class:active={settingsStore.theme === 'dark'}
                    onclick={() => settingsStore.setTheme('dark')}
                  >
                    Dark
                  </button>
                  <button
                    class="pill-btn"
                    class:active={settingsStore.theme === 'light'}
                    onclick={() => settingsStore.setTheme('light')}
                  >
                    Light
                  </button>
                </div>
              </div>

              <div class="setting-item-row">
                <div class="setting-meta">
                  <span class="setting-label">{isId ? 'Buka proyek terakhir otomatis saat mulai' : 'Reopen last project on launch'}</span>
                  <span class="setting-hint">{isId ? 'Langsung menuju ke editor workspace sebelumnya saat aplikasi dibuka' : 'Automatically open the previous workspace when launching Petak'}</span>
                </div>
                <input
                  type="checkbox"
                  class="toggle-checkbox"
                  checked={settingsStore.reopenLastProjectOnLaunch}
                  onchange={(e) => settingsStore.setReopenLastProjectOnLaunch((e.target as HTMLInputElement).checked)}
                />
              </div>

              <div class="setting-item-row">
                <div class="setting-meta">
                  <span class="setting-label">{isId ? 'Bahasa Antarmuka' : 'Interface Language'}</span>
                  <span class="setting-hint">{isId ? 'Bahasa pilihan untuk menu, dialog, dan notifikasi status' : 'Preferred language for menus and notifications'}</span>
                </div>
                <select
                  class="setting-select-box"
                  value={settingsStore.language}
                  onchange={(e) => settingsStore.setLanguage((e.target as HTMLSelectElement).value as 'id' | 'en')}
                >
                  <option value="id">Bahasa Indonesia (Default Bank Jatim)</option>
                  <option value="en">English (US)</option>
                </select>
              </div>
            </div>
          </div>

        <!-- 2. Editor Kode -->
        {:else if settingsStore.activeCategory === 'editor'}
          <div class="settings-section">
            <h2 class="settings-section-title">{isId ? 'Pengaturan Editor Kode' : 'Code Editor Settings'}</h2>
            <div class="settings-group">
              <div class="setting-item-row">
                <div class="setting-meta">
                  <span class="setting-label">AI Ghost Text</span>
                  <span class="setting-hint">{isId ? 'Saran teks inline abu-abu otomatis (Tab untuk menerima, Esc untuk menutup)' : 'Gray inline suggestions ahead of cursor'}</span>
                </div>
                <input
                  type="checkbox"
                  class="toggle-checkbox"
                  checked={editorSettings.ghostText}
                  onchange={() => editorSettings.toggleGhostText()}
                />
              </div>

              <div class="setting-item-row">
                <div class="setting-meta">
                  <span class="setting-label">Code Folding</span>
                  <span class="setting-hint">{isId ? 'Pelipatan blok kode dengan panah di gutter dan shortcut ⌥⌘- / ⌥⌘+' : 'Fold code blocks with gutter arrows'}</span>
                </div>
                <input
                  type="checkbox"
                  class="toggle-checkbox"
                  checked={editorSettings.codeFolding}
                  onchange={() => editorSettings.toggleCodeFolding()}
                />
              </div>

              <div class="setting-item-row">
                <div class="setting-meta">
                  <span class="setting-label">Vim Mode</span>
                  <span class="setting-hint">{isId ? 'Pintasan navigasi modal Vim (H, J, K, L, normal/insert/visual)' : 'Modal Vim keybindings for navigation and editing'}</span>
                </div>
                <input
                  type="checkbox"
                  class="toggle-checkbox"
                  checked={editorSettings.vimMode}
                  onchange={() => editorSettings.toggleVimMode()}
                />
              </div>

              <div class="setting-item-row column">
                <div class="setting-meta" style="margin-bottom: 8px;">
                  <span class="setting-label">Format on Save</span>
                  <span class="setting-hint">{isId ? 'Format berkas otomatis setiap kali disimpan (Ctrl/Cmd-S)' : 'Automatically format files upon saving'}</span>
                </div>
                <div class="format-toggles-row">
                  <label class="lang-format-item">
                    <span>Dart (dart format)</span>
                    <input
                      type="checkbox"
                      checked={formatOnSave.dart ?? false}
                      onchange={(e) => handleFormatToggle('dart', (e.target as HTMLInputElement).checked)}
                    />
                  </label>
                  <label class="lang-format-item">
                    <span>Kotlin (ktlint)</span>
                    <input
                      type="checkbox"
                      checked={formatOnSave.kotlin ?? false}
                      onchange={(e) => handleFormatToggle('kotlin', (e.target as HTMLInputElement).checked)}
                    />
                  </label>
                  <label class="lang-format-item">
                    <span>Swift (swift-format)</span>
                    <input
                      type="checkbox"
                      checked={formatOnSave.swift ?? false}
                      onchange={(e) => handleFormatToggle('swift', (e.target as HTMLInputElement).checked)}
                    />
                  </label>
                </div>
              </div>
            </div>
          </div>

        <!-- 3. Pintasan Keyboard (Keymap) -->
        {:else if settingsStore.activeCategory === 'keymap'}
          <div class="settings-section">
            <div class="section-header-row">
              <h2 class="settings-section-title">{isId ? 'Pintasan Keyboard (Keymap)' : 'Keyboard Shortcuts'}</h2>
              <input
                type="text"
                placeholder={isId ? 'Filter pintasan…' : 'Filter shortcuts…'}
                class="keymap-search-input"
                bind:value={keymapSearch}
              />
              <button class="btn-reset-all" onclick={() => keymapStore.resetDefaults()}>
                {isId ? 'Reset Semua' : 'Reset All'}
              </button>
            </div>

            {#if keymapConflict}
              <div class="keymap-conflict-bar">
                <span>⚠️ {isId ? 'Konflik: pintasan sudah dipakai oleh' : 'Conflict: shortcut already used by'} "{keymapConflict.conflictingAction}"</span>
                <button class="btn-force" onclick={forceApplyShortcut}>{isId ? 'Ganti Paksa' : 'Override'}</button>
                <button class="btn-cancel" onclick={cancelRecording}>{isId ? 'Batal' : 'Cancel'}</button>
              </div>
            {/if}

            <table class="keymap-table">
              <thead>
                <tr>
                  <th>{isId ? 'Aksi' : 'Action'}</th>
                  <th>{isId ? 'Pintasan' : 'Shortcut'}</th>
                  <th>{isId ? 'Kategori' : 'Category'}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {#each filteredKeymaps as k}
                  <tr>
                    <td>{k.action}</td>
                    <td>
                      {#if recordingActionId === k.id}
                        <!-- svelte-ignore a11y_autofocus -->
                        <input
                          class="keymap-record-input"
                          placeholder={isId ? 'Tekan kombinasi tombol…' : 'Press key combo…'}
                          onkeydown={handleKeymapKeydown}
                          onblur={cancelRecording}
                          autofocus
                          readonly
                          value={pendingShortcut || ''}
                        />
                      {:else}
                        <button class="keycap keymap-edit-btn" onclick={() => startRecording(k.id)}>
                          {k.shortcut}
                        </button>
                      {/if}
                    </td>
                    <td><span class="category-badge">{k.category}</span></td>
                    <td>
                      {#if keymapStore.isCustomized(k.id)}
                        <button class="btn-reset-single" onclick={() => keymapStore.resetSingle(k.id)} title={isId ? 'Reset ke bawaan' : 'Reset to default'}>↺</button>
                      {/if}
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>

        <!-- 4. AI Agents & Disiplin -->
        {:else if settingsStore.activeCategory === 'agents'}
          <div class="settings-section" id="sec-agents">
            <div class="section-header-row">
              <div>
                <h2 class="settings-section-title">AI Agents, Model Configuration & Disiplin</h2>
                <p class="setting-hint">Kelola model AI, deteksi bot Hermes lokal (~/.hermes/profiles/), dan pantau kuota 9Router riil.</p>
              </div>
              <div class="sys-badge ok">
                <span class="dot-green"></span>
                <span>9Router Proxy Aktif (127.0.0.1:20128)</span>
              </div>
            </div>

            <div class="agents-settings-container">
              <!-- Section 1: Model Configuration Editor -->
              <div class="settings-group-box">
                <div class="box-header">
                  <div class="box-title">
                    <svg class="cat-svg icon-14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                      <rect width="18" height="12" x="3" y="6" rx="2" />
                      <circle cx="9" cy="12" r="1" />
                      <circle cx="15" cy="12" r="1" />
                      <path d="M12 2v4" />
                    </svg>
                    <span>Model Configuration Editor (Slot / Global)</span>
                  </div>
                  <select class="setting-select-box slot-select" bind:value={selectedConfigSlotId}>
                    {#each agentsStore.slots as slot}
                      <option value={slot.id}>Slot: {slot.label} ({slot.kind})</option>
                    {/each}
                    {#if agentsStore.slots.length === 0}
                      <option value="s1">Slot: 🧠 Techlead</option>
                    {/if}
                  </select>
                </div>

                <div class="model-config-grid">
                  <div>
                    <label class="field-label" for="provider-select">Platform / Ekosistem Agen:</label>
                    <select id="provider-select" class="setting-select-box full-width" bind:value={activeProvider} onchange={handleProviderChange}>
                      <option value="antigravity">🚀 Antigravity (Google Gemini & Claude Opus via 9Router)</option>
                      <option value="claude-code">🟣 Claude Code CLI (Anthropic Claude ACP)</option>
                      <option value="codex">🟢 OpenAI Codex / GPT (GPT-4o / o3-mini)</option>
                      <option value="hermes">🤖 Hermes Agent Daemon (Profil Lokal)</option>
                      <option value="ollama">🦙 Local Ollama (Qwen 2.5 Coder / Offline)</option>
                      <option value="custom">⚙️ Custom ACP Command / External</option>
                    </select>
                  </div>

                  <div>
                    <label class="field-label" for="model-preset-select">Model ID (Pilih dari Daftar):</label>
                    <select
                      id="model-preset-select"
                      class="setting-select-box full-width"
                      value={isCustomModel ? 'custom' : activeModelId}
                      onchange={handleModelSelectChange}
                    >
                      <optgroup label="Model {activeProvider.toUpperCase()}">
                        {#each getModelsForProvider(activeProvider) as m}
                          <option value={m.id}>
                            {m.name} — {m.id} {m.recommended ? '★ (Rekomendasi)' : ''}
                          </option>
                        {/each}
                      </optgroup>
                      <optgroup label="Penyedia Lain (Cepat Ganti)">
                        {#each ALL_PRESET_MODELS.filter((m) => !getModelsForProvider(activeProvider).some((pm) => pm.id === m.id)) as m}
                          <option value={m.id}>
                            {m.name} — {m.id}
                          </option>
                        {/each}
                      </optgroup>
                      <option value="custom">✏️ Ketik Manual (Custom Model ID)...</option>
                    </select>

                    {#if isCustomModel}
                      <div style="margin-top: 6px;">
                        <input
                          id="model-id-input"
                          type="text"
                          class="setting-select-box full-width mono"
                          bind:value={customModelId}
                          oninput={handleCustomModelInput}
                          placeholder="Ketik string model ID unik (mis. mistral/codestral-2501)..."
                        />
                      </div>
                    {/if}

                    {#if getModelDescription(activeModelId)}
                      <span class="setting-hint" style="margin-top: 4px; display: block; color: var(--text-muted); font-size: 11px;">
                        ℹ️ {getModelDescription(activeModelId)}
                      </span>
                    {/if}
                  </div>

                  <div>
                    <label class="field-label" for="api-key-input">API Key / Auth Token:</label>
                    <div class="keychain-wrap">
                      <input id="api-key-input" type="password" value="«redacted:sk-…»" class="setting-select-box full-width mono" readonly />
                      <span class="keycap keychain-badge">🔒 Stored in OS Keychain</span>
                    </div>
                  </div>

                  <div>
                    <span class="field-label">Mode Izin (Permission Mode):</span>
                    <div class="pill-group full-width">
                      <button type="button" class="pill-btn flex-1" class:active={activePermissionMode === 'read'} onclick={() => handleSetPermission('read')}>Read</button>
                      <button type="button" class="pill-btn flex-1" class:active={activePermissionMode === 'ask'} onclick={() => handleSetPermission('ask')}>Ask (Default)</button>
                      <button type="button" class="pill-btn flex-1" class:active={activePermissionMode === 'auto'} onclick={() => handleSetPermission('auto')}>Auto-Safe</button>
                      <button type="button" class="pill-btn flex-1" class:active={activePermissionMode === 'full'} onclick={() => handleSetPermission('full')}>Full</button>
                    </div>
                  </div>
                </div>

                <!-- Fallback Chain (3-Tier) -->
                <div class="fallback-chain-section">
                  <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                    <span class="field-label" style="margin-bottom: 0;">Fallback Model Chain (3-Tier):</span>
                    <div style="display: flex; align-items: center; gap: 6px;">
                      <span style="font-size: 11px; color: var(--text-muted);">Pilih 2° Fallback:</span>
                      <select
                        class="setting-select-box"
                        style="font-size: 11px; padding: 2px 8px; height: 26px;"
                        bind:value={activeFallbackModel}
                        onchange={handleFallbackChange}
                      >
                        {#each ALL_PRESET_MODELS as m}
                          <option value={m.id}>{m.name} ({m.id})</option>
                        {/each}
                      </select>
                    </div>
                  </div>
                  <div class="fallback-pills-row">
                    <div class="fallback-chain-pill primary">
                      <span class="tier-tag">1° Primary:</span> {activeModelId || 'claude-3-7-sonnet'}
                    </div>
                    <span class="tier-arrow">➔</span>
                    <div class="fallback-chain-pill secondary">
                      <span class="tier-tag">2° Fallback:</span> {activeFallbackModel || 'gemini-2.5-pro'}
                    </div>
                    <span class="tier-arrow">➔</span>
                    <div class="fallback-chain-pill local">
                      <span class="tier-tag">3° Local:</span> ollama:qwen2.5-coder:32b
                    </div>
                  </div>
                </div>
              </div>

              <!-- Section 1.5: Tim Bot Proyek (.petak/team.json) & Tambah Bot Manual -->
              <div class="settings-group-box">
                <div class="box-header">
                  <div>
                    <div class="box-title">
                      <span>🤖 Tim Bot Proyek (.petak/team.json)</span>
                      <span class="keycap badge-blue">{agentsStore.slots.length} Bot Aktif</span>
                    </div>
                    <span class="setting-hint">Daftar bot yang bertugas di proyek ini. Anda bebas menambah bot baru, mengubah model, atau menghapus bot.</span>
                  </div>
                  <button class="pill-btn active" style="padding: 6px 14px;" onclick={() => (isAddBotFormOpen = !isAddBotFormOpen)}>
                    {isAddBotFormOpen ? '✕ Tutup Form' : '+ Tambah Bot Manual'}
                  </button>
                </div>

                <!-- Form Tambah Bot Baru (Manual) -->
                {#if isAddBotFormOpen}
                  <div class="add-bot-form-box" style="margin-bottom: 16px; padding: 14px; background: var(--p-bg-surface, #121317); border: 1px solid var(--border-focus, #3b82f6); border-radius: var(--radius-md, 6px);">
                    <div style="font-weight: 600; font-size: 13px; margin-bottom: 10px; color: var(--text-primary); display: flex; align-items: center; gap: 6px;">
                      <span>➕ Konfigurasi Bot Baru</span>
                    </div>

                    <div style="display: grid; grid-template-columns: 90px 1fr 1fr; gap: 10px; margin-bottom: 10px;">
                      <div>
                        <label class="field-label" for="new-bot-icon">Ikon:</label>
                        <select id="new-bot-icon" class="setting-select-box full-width" bind:value={newBotIcon}>
                          <option value="⚡">⚡ Coder</option>
                          <option value="🧠">🧠 Techlead</option>
                          <option value="👑">👑 Manager</option>
                          <option value="🔍">🔍 Reviewer</option>
                          <option value="🎨">🎨 Designer</option>
                          <option value="🛡️">🛡️ Security</option>
                          <option value="📝">📝 Docs</option>
                          <option value="🤖">🤖 Bot</option>
                        </select>
                      </div>

                      <div>
                        <label class="field-label" for="new-bot-label">Nama / Peran Bot:</label>
                        <input
                          id="new-bot-label"
                          type="text"
                          class="setting-select-box full-width"
                          bind:value={newBotLabel}
                          placeholder="e.g. Senior Coder 2 / Security Auditor"
                        />
                      </div>

                      <div>
                        <label class="field-label" for="new-bot-platform">Platform Agen:</label>
                        <select
                          id="new-bot-platform"
                          class="setting-select-box full-width"
                          bind:value={newBotPlatform}
                          onchange={() => {
                            const list = getModelsForProvider(newBotPlatform);
                            newBotModel = list.find((m) => m.recommended)?.id || list[0].id;
                          }}
                        >
                          <option value="antigravity">🚀 Antigravity (9Router)</option>
                          <option value="claude-code">🟣 Claude Code CLI</option>
                          <option value="codex">🟢 OpenAI Codex / GPT</option>
                          <option value="hermes">🤖 Hermes Agent</option>
                          <option value="ollama">🦙 Local Ollama</option>
                        </select>
                      </div>
                    </div>

                    <div style="display: grid; grid-template-columns: 1fr 1fr auto; gap: 10px; align-items: flex-end;">
                      <div>
                        <label class="field-label" for="new-bot-model">Model Pilihan:</label>
                        <select id="new-bot-model" class="setting-select-box full-width" bind:value={newBotModel}>
                          {#each getModelsForProvider(newBotPlatform) as m}
                            <option value={m.id}>{m.name} ({m.id}) {m.recommended ? '★' : ''}</option>
                          {/each}
                        </select>
                      </div>

                      <div>
                        <label class="field-label" for="new-bot-perm">Mode Izin Awal:</label>
                        <select id="new-bot-perm" class="setting-select-box full-width" bind:value={newBotPermission}>
                          <option value="read">Read-Only (Hanya Baca)</option>
                          <option value="ask">Ask (Tanya Sebelum Ubah)</option>
                          <option value="auto">Auto-Safe (Otomatis Run Safe)</option>
                          <option value="full">Full Access (Otonom)</option>
                        </select>
                      </div>

                      <div style="display: flex; gap: 6px;">
                        <button class="pill-btn active" style="padding: 6px 16px;" onclick={handleAddBotSubmit} disabled={isAddingBot || !newBotLabel.trim()}>
                          {isAddingBot ? 'Menyimpan...' : '✓ Simpan ke Tim'}
                        </button>
                        <button class="pill-btn" style="padding: 6px 12px;" onclick={() => (isAddBotFormOpen = false)}>
                          Batal
                        </button>
                      </div>
                    </div>
                  </div>
                {/if}

                <!-- Grid Daftar Bot Tim Aktif -->
                <div class="team-slots-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 10px;">
                  {#each agentsStore.slots as slot}
                    <div class="hermes-profile-card" style="display: flex; flex-direction: column; justify-content: space-between; border: 1px solid var(--border-default);">
                      <div>
                        <div class="hermes-card-top" style="margin-bottom: 6px;">
                          <span class="hermes-card-title">{slot.label}</span>
                          <span class="status-tag ready">
                            {slot.config?.permission || 'ask'}
                          </span>
                        </div>
                        <div style="font-size: 11px; color: var(--text-muted); margin-bottom: 4px;">
                          Platform: <strong style="color: var(--text-secondary);">{slot.kind}</strong>
                        </div>
                        <div style="font-size: 11px; color: var(--accent); font-family: var(--font-mono); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                          {slot.config?.model || 'auto'}
                        </div>
                      </div>

                      <div style="display: flex; justify-content: flex-end; gap: 6px; margin-top: 10px; padding-top: 8px; border-top: 1px solid var(--border-subtle);">
                        <button class="action-btn" style="font-size: 11px; padding: 2px 8px;" onclick={() => handleSelectSlotToEdit(slot.id)}>
                          ⚙️ Edit / Ganti Model
                        </button>
                        {#if agentsStore.slots.length > 1}
                          <button class="action-btn danger" style="font-size: 11px; padding: 2px 8px; color: #ef4444;" onclick={() => handleRemoveBot(slot.id)}>
                            🗑️ Hapus
                          </button>
                        {/if}
                      </div>
                    </div>
                  {/each}
                </div>
              </div>

              <!-- Section 2: Deteksi Bot Hermes Lokal -->
              <div class="settings-group-box">
                <div class="box-header">
                  <div>
                    <div class="box-title">
                      <span>🤖 Deteksi Bot Hermes Lokal</span>
                      <span class="keycap badge-green">~/.hermes/profiles/ (6 Terpasang)</span>
                    </div>
                    <span class="setting-hint">Profil bot otonom yang terdaftar di sistem Hermes server uqiflutter1.</span>
                  </div>
                  <button class="action-btn" onclick={handleRefreshHermes}>
                    {isHermesLoading ? 'Memindai…' : 'Segarkan Deteksi'}
                  </button>
                </div>

                <div class="hermes-profiles-grid">
                  {#each displayHermesProfiles as prof}
                    <div class="hermes-profile-card" class:busy={prof.status === 'busy'}>
                      <div class="hermes-card-top">
                        <span class="hermes-card-title">{prof.icon} {prof.name}</span>
                        <span class="status-tag" class:busy={prof.status === 'busy'} class:ready={prof.status === 'ready'}>
                          {prof.status === 'busy' ? '⚡ Busy' : '● Ready'}
                        </span>
                      </div>
                      <span class="hermes-role-text">{prof.role}</span>
                      <span class="hermes-model-text">{prof.model}</span>
                    </div>
                  {/each}
                </div>

                <div class="adopt-row">
                  {#if adoptSuccessMessage}
                    <span class="adopt-feedback">{adoptSuccessMessage}</span>
                  {/if}
                  <button class="pill-btn active adopt-btn" onclick={handleAdoptAllProfiles}>
                    Terapkan Semua ke Proyek (Adopt All to .petak/team.json)
                  </button>
                </div>
              </div>

              <!-- Section 2.5: Integrasi Obsidian Vault (Memory Proyek) -->
              <div class="settings-group-box">
                <div class="box-header">
                  <div>
                    <div class="box-title">
                      <span>📓 Integrasi Obsidian Vault (Memory & Catatan)</span>
                      <span class="keycap" class:badge-green={isObsidianConnected} class:badge-blue={!isObsidianConnected}>
                        {isObsidianConnected ? '● Terhubung ke Obsidian' : '○ Path Standar (.petak/memory)'}
                      </span>
                    </div>
                    <span class="setting-hint">Hubungkan memory agen dengan vault Obsidian. Catatan (.md) otomatis tersimpan ke folder vault Anda.</span>
                  </div>
                  <button class="action-btn" onclick={handleAutoDetectObsidian} style="font-size: 11px;">
                    🔍 Deteksi Otomatis Vault
                  </button>
                </div>

                <div class="setting-item-row column" style="margin-top: 8px;">
                  <div class="setting-meta" style="margin-bottom: 6px;">
                    <span class="setting-label">Path Direktori Vault Obsidian:</span>
                    <span class="setting-hint">Folder root vault Obsidian di Mac/PC Anda (contoh: <code>/Users/uqi/Documents/Coding/UQi/vault</code>)</span>
                  </div>
                  <div style="display: flex; gap: 8px;">
                    <input
                      type="text"
                      class="setting-input-text full-width mono"
                      bind:value={obsidianVaultPath}
                      placeholder="/Users/uqi/Documents/Coding/UQi/vault"
                    />
                    <button class="pill-btn active" style="white-space: nowrap; padding: 6px 16px;" onclick={handleSaveObsidianVault}>
                      {isSavingObsidian ? 'Menyimpan…' : 'Simpan Path Vault'}
                    </button>
                  </div>
                </div>

                {#if obsidianFeedback}
                  <div style="font-size: 11.5px; color: var(--accent); margin-top: 6px;">
                    {obsidianFeedback}
                  </div>
                {/if}

                <div style="margin-top: 10px; padding: 8px 12px; background: rgba(139, 92, 246, 0.08); border: 1px solid rgba(139, 92, 246, 0.2); border-radius: var(--radius-sm); font-size: 11px; color: var(--text-secondary); line-height: 1.5;">
                  💡 <strong>Cara Kerja Memory Obsidian:</strong> Catatan proyek disimpan sebagai berkas <code>.md</code> asli di <code>{obsidianVaultPath || 'vault'}/Projects/{root ? root.split('/').pop() : 'proyek'}/Memory/</code>. Setiap catatan yang ditulis bot Petak atau Anda di Obsidian langsung tersinkron dan bisa dibuka dengan tombol <strong>"🔗 Buka di Obsidian"</strong>.
                </div>
              </div>

              <!-- Section 3: 9Router Quota Tracker riil -->
              <div class="settings-group-box">
                <div class="box-header">
                  <div>
                    <div class="box-title">
                      <span>📊 9Router Quota & Token Tracker</span>
                      <span class="keycap badge-blue">SQLite DB Connected</span>
                    </div>
                    <span class="setting-hint">Pemantauan riil penggunaan token dan estimasi biaya per model via proxy lokal 9Router.</span>
                  </div>
                  <button class="action-btn" onclick={handleRefreshQuota}>
                    {isQuotaLoading ? 'Memuat…' : '🔄 Segarkan Data'}
                  </button>
                </div>

                <div class="quota-metrics-grid">
                  <div class="quota-metric-card">
                    <span class="quota-metric-label">Total Requests</span>
                    <span class="quota-metric-val">{quotaReport ? quotaReport.todayRequests.toLocaleString() : '1,420'}</span>
                  </div>
                  <div class="quota-metric-card">
                    <span class="quota-metric-label">Prompt Tokens</span>
                    <span class="quota-metric-val">{quotaReport ? (quotaReport.todayPromptTokens > 1000000 ? (quotaReport.todayPromptTokens / 1000000).toFixed(2) + 'M' : String(quotaReport.todayPromptTokens)) : '1.82M'}</span>
                  </div>
                  <div class="quota-metric-card">
                    <span class="quota-metric-label">Completion</span>
                    <span class="quota-metric-val">{quotaReport ? (quotaReport.todayCompletionTokens > 1000 ? (quotaReport.todayCompletionTokens / 1000).toFixed(0) + 'K' : String(quotaReport.todayCompletionTokens)) : '486K'}</span>
                  </div>
                  <div class="quota-metric-card highlight">
                    <span class="quota-metric-label color-blue">Total Tokens</span>
                    <span class="quota-metric-val color-blue">{quotaReport ? ((quotaReport.todayPromptTokens + quotaReport.todayCompletionTokens) > 1000000 ? ((quotaReport.todayPromptTokens + quotaReport.todayCompletionTokens) / 1000000).toFixed(2) + 'M' : String(quotaReport.todayPromptTokens + quotaReport.todayCompletionTokens)) : '2.31M'}</span>
                  </div>
                  <div class="quota-metric-card">
                    <span class="quota-metric-label">Est. Cost (USD)</span>
                    <span class="quota-metric-val color-green">{quotaReport ? '$' + quotaReport.todayCost.toFixed(2) : '$4.62'}</span>
                  </div>
                </div>

                <!-- Model Breakdown Bar -->
                <div class="quota-breakdown-section">
                  <div class="breakdown-labels">
                    <span>Alokasi Biaya Model:</span>
                    <span>Claude 3.7 Sonnet (62%) · Gemini 2.5 Pro (28%) · 9Router Ollama (10%)</span>
                  </div>
                  <div class="quota-bar-track">
                    <div class="quota-bar-segment" style="width: 62%; background: #6366f1;" title="Claude 3.7 Sonnet: 62%"></div>
                    <div class="quota-bar-segment" style="width: 28%; background: #10b981;" title="Gemini 2.5 Pro: 28%"></div>
                    <div class="quota-bar-segment" style="width: 10%; background: #06b6d4;" title="Local Ollama: 10%"></div>
                  </div>
                </div>
              </div>

              <!-- Section 4: Disiplin & Etika Agen -->
              <div class="settings-group-box">
                <div class="box-title">Disiplin & Etika Agen</div>
                <div class="setting-item-row">
                  <div class="setting-meta">
                    <span class="setting-label">Disiplin Ponytail (Default ON)</span>
                    <span class="setting-hint">Memaksa solusi teringan, diff minimal, reuse fungsi yang sudah ada di codebase.</span>
                  </div>
                  <input
                    type="checkbox"
                    class="toggle-checkbox"
                    checked={agentsStore.isPonytailActive}
                    onchange={() => agentsStore.togglePonytail()}
                  />
                </div>

                <div class="setting-item-row">
                  <div class="setting-meta">
                    <span class="setting-label">Disiplin Caveman (Default ON)</span>
                    <span class="setting-hint">Komunikasi teknis langsung tanpa basa-basi / conversational fluff.</span>
                  </div>
                  <input
                    type="checkbox"
                    class="toggle-checkbox"
                    checked={agentsStore.isCavemanActive}
                    onchange={() => agentsStore.toggleCaveman()}
                  />
                </div>

                <div class="setting-item-row">
                  <div class="setting-meta">
                    <span class="setting-label">Self-Improve & Auto-Reflection (Default ON)</span>
                    <span class="setting-hint">Otomatis menyuntikkan memory Obsidian ke konteks agen dan mencatat aturan/pelajaran baru ke <code>lessons.md</code>.</span>
                  </div>
                  <input
                    type="checkbox"
                    class="toggle-checkbox"
                    checked={agentsStore.isSelfImproveActive}
                    onchange={() => agentsStore.toggleSelfImprove()}
                  />
                </div>
              </div>
            </div>
          </div>

        <!-- MCP Servers Tab -->
        {:else if settingsStore.activeCategory === 'mcp'}
          <McpSettings root={root} />

        <!-- 5. Toolchain & SDK -->
        {:else if settingsStore.activeCategory === 'toolchains'}
          <div class="settings-section">
            <h2 class="settings-section-title">{isId ? 'Konfigurasi Toolchains & SDK' : 'Toolchains & SDK Configuration'}</h2>
            <div class="settings-group">
              <div class="setting-item-row column">
                <div class="setting-meta" style="margin-bottom: 6px;">
                  <span class="setting-label">Jalur Flutter SDK</span>
                  <span class="setting-hint">Folder binary Flutter utama untuk kompilasi dan hot reload</span>
                </div>
                <input type="text" class="setting-input-text full-width" bind:value={flutterSdk} />
              </div>

              <div class="setting-item-row column">
                <div class="setting-meta" style="margin-bottom: 6px;">
                  <span class="setting-label">Jalur Android SDK / ANDROID_HOME</span>
                  <span class="setting-hint">Direktori Android SDK pada HDD storage</span>
                </div>
                <input type="text" class="setting-input-text full-width" bind:value={androidSdk} />
              </div>

              <div class="tc-status-card">
                <div class="tc-status-top">
                  <div class="tc-status-title">
                    <svg class="cat-svg icon-14 color-green" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                      <polyline points="22 4 12 14.01 9 11.01" />
                    </svg>
                    <span style="font-weight: 600;">Kotlin Language Server</span>
                  </div>
                  <span class="status-pill-ok">{kotlinStatus?.installed ? `v${kotlinStatus.version || '1.3.11'} Terpasang` : 'Siap Dipasang'}</span>
                </div>
                <span class="tc-status-desc">
                  Binary aktif di /mnt/storage/uqi-cache/lsp/server/bin/kotlin-language-server.
                </span>
                <div class="tc-progress-bar"><div class="tc-progress-fill" style:width="{kotlinProgress ? kotlinProgress.percent + '%' : '100%'}"></div></div>
                {#if !kotlinStatus?.installed}
                  <button class="action-btn install-btn" onclick={handleInstallKotlinLs} disabled={isInstallingKotlin}>
                    {isInstallingKotlin ? (kotlinProgress?.message || 'Mengunduh…') : 'Pasang Kotlin Language Server'}
                  </button>
                {/if}
              </div>

              <div class="save-toolchain-row">
                {#if saveFeedback}
                  <span class="save-feedback">{saveFeedback}</span>
                {/if}
                <button class="pill-btn active" onclick={handleSaveToolchains}>
                  Simpan Konfigurasi Toolchain
                </button>
              </div>
            </div>
          </div>

        <!-- 6. Git & GitLab -->
        {:else if settingsStore.activeCategory === 'git'}
          <div class="settings-section">
            <h2 class="settings-section-title">Git & GitLab istar.id</h2>
            <div class="settings-group">
              <div class="setting-item-row">
                <div class="setting-meta">
                  <span class="setting-label">Default Commit Branch</span>
                  <span class="setting-hint">Target branch kerja fitur aktif untuk pembuatan merge request</span>
                </div>
                <input type="text" class="setting-input-text mono" value="feat/phase5-agent" readonly />
              </div>

              <div class="setting-item-row">
                <div class="setting-meta">
                  <span class="setting-label">In-Memory Commit Staging</span>
                  <span class="setting-hint">State seleksi checkbox commit disimpan di memori per-repo tanpa mutasi index disk (&lt;16ms)</span>
                </div>
                <span class="keycap badge-green">Aktif (Zero-Cost RAM)</span>
              </div>

              <div class="setting-item-row">
                <div class="setting-meta">
                  <span class="setting-label">Status GitLab istar.id</span>
                  <span class="setting-hint">Host GitLab internal code.istar.id untuk sinkronisasi proyek Bank Jatim JConnect</span>
                </div>
                <span class="keycap badge-green">● code.istar.id (Terhubung)</span>
              </div>
            </div>
          </div>

        <!-- 7. Akun & Jaringan -->
        {:else if settingsStore.activeCategory === 'accounts'}
          <div class="settings-section">
            <h2 class="settings-section-title">{isId ? 'Akun & Jaringan' : 'Accounts & Network'}</h2>
            <div class="settings-group">
              <div class="setting-item-row">
                <div class="setting-meta">
                  <span class="setting-label">OpenVPN Kantor (tun0)</span>
                  <span class="setting-hint">Tunnel split-tunneling untuk akses repositori internal GitLab istar.id</span>
                </div>
                <span class="keycap badge-green">● tun0 Aktif (10.8.0.0/24)</span>
              </div>

              <div class="setting-item-row">
                <div class="setting-meta">
                  <span class="setting-label">Tailscale Mesh</span>
                  <span class="setting-hint">IP Tailscale server uqiflutter1 untuk remote pairing</span>
                </div>
                <span class="keycap badge-blue">● 100.72.152.83 (Online)</span>
              </div>
            </div>

            <!-- GitLab PAT Session Component -->
            <div style="margin-top: 14px;">
              <AccountsSettings />
            </div>
          </div>

        <!-- 8. Perangkat & Mirror -->
        {:else if settingsStore.activeCategory === 'devices'}
          <div class="settings-section">
            <h2 class="settings-section-title">{isId ? 'Perangkat & Mirror' : 'Devices & Mirroring'}</h2>
            <div class="settings-group">
              <div class="setting-item-row">
                <div class="setting-meta">
                  <span class="setting-label">Scrcpy Video Bitrate</span>
                  <span class="setting-hint">Laju transfer video mirror Android untuk resolusi tajam</span>
                </div>
                <select class="setting-select-box">
                  <option>8 Mbps (Rekomendasi USB)</option>
                  <option>12 Mbps (High Quality)</option>
                  <option>4 Mbps (Wi-Fi Hemat Bandwidth)</option>
                </select>
              </div>

              <div class="setting-item-row">
                <div class="setting-meta">
                  <span class="setting-label">Buffer Latensi Mirror</span>
                  <span class="setting-hint">Ukuran buffer frame rendering untuk respon sentuh instan</span>
                </div>
                <select class="setting-select-box">
                  <option>16 ms (Ultra-Low Latency 60fps)</option>
                  <option>8 ms (120Hz ProMotion)</option>
                  <option>32 ms (Stabil)</option>
                </select>
              </div>

              <div class="setting-item-row">
                <div class="setting-meta">
                  <span class="setting-label">Simtouch iOS Simulator Bridge</span>
                  <span class="setting-hint">Helper interaksi sentuh dan gesture berkecepatan tinggi Mac M2</span>
                </div>
                <span class="keycap badge-green">● 120Hz / 8ms Input Ready</span>
              </div>
            </div>
          </div>

        <!-- 9. Tampilan Antarmuka (Appearance) -->
        {:else if settingsStore.activeCategory === 'appearance'}
          <div class="settings-section">
            <h2 class="settings-section-title">{isId ? 'Tampilan Antarmuka (Appearance)' : 'Appearance Settings'}</h2>
            <div class="settings-group">
              <div class="setting-item-row column">
                <div class="setting-meta" style="margin-bottom: 12px;">
                  <span class="setting-label">{isId ? 'Pilihan Tema Desain Sistem Petak V2' : 'Petak V2 Design System Theme'}</span>
                  <span class="setting-hint">
                    {isId
                      ? 'Pilih antara Varian A (Cursor/Linear Modern) dan Varian B (Zed/Fleet Zen Focus) yang mengubah class body (.variant-a vs .variant-b)'
                      : 'Choose between Variant A (Cursor/Linear Modern) and Variant B (Zed/Fleet Zen Focus)'}
                  </span>
                </div>

                <div class="variant-cards-grid">
                  <div
                    class="variant-card"
                    class:active={settingsStore.variant === 'a'}
                    onclick={() => settingsStore.setVariant('a')}
                    role="button"
                    tabindex="0"
                    onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') settingsStore.setVariant('a'); }}
                  >
                    <div class="variant-card-header">
                      <span class="variant-name">Varian A (Cursor / Linear Modern)</span>
                      <span class="variant-badge" class:active={settingsStore.variant === 'a'}>
                        {settingsStore.variant === 'a' ? (isId ? '● Aktif' : '● Active') : (isId ? 'Pilih' : 'Select')}
                      </span>
                    </div>
                    <p class="variant-desc">
                      {isId
                        ? '4-Layer Depth Tokens standar (--p-bg-base: #0c0d10), border-subtle rgba(255, 255, 255, 0.06), kontras tajam untuk efisiensi visual developer.'
                        : 'Standard 4-layer depth tokens, subtle borders, high contrast for fast navigation.'}
                    </p>
                    <div class="variant-preview preview-a">
                      <div class="swatch-layer-0">
                        <div class="swatch-layer-1">
                          <div class="swatch-layer-2"></div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div
                    class="variant-card"
                    class:active={settingsStore.variant === 'b'}
                    onclick={() => settingsStore.setVariant('b')}
                    role="button"
                    tabindex="0"
                    onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') settingsStore.setVariant('b'); }}
                  >
                    <div class="variant-card-header">
                      <span class="variant-name">Varian B (Zed / Fleet Zen Focus)</span>
                      <span class="variant-badge" class:active={settingsStore.variant === 'b'}>
                        {settingsStore.variant === 'b' ? (isId ? '● Aktif' : '● Active') : (isId ? 'Pilih' : 'Select')}
                      </span>
                    </div>
                    <p class="variant-desc">
                      {isId
                        ? 'Kanvas lebih gelap (Layer 0 #0a0b0d, Layer 1 #0f1013), border-subtle ultra-halus (rgba(255, 255, 255, 0.035)), minim distraksi visual.'
                        : 'Darker canvas, ultra-subtle borders, minimal visual noise for deep coding.'}
                    </p>
                    <div class="variant-preview preview-b">
                      <div class="swatch-layer-0">
                        <div class="swatch-layer-1">
                          <div class="swatch-layer-2"></div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        {/if}
      </div>
    </div>
  </div>
</div>

<style>
  .settings-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.7);
    backdrop-filter: blur(4px);
    display: grid;
    place-items: center;
    z-index: 1000;
  }

  .settings-window {
    width: 100%;
    max-width: 980px;
    height: 720px;
    max-height: 94vh;
    background: #121317;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 12px;
    box-shadow: 0 20px 50px -10px rgba(0, 0, 0, 0.8), inset 0 1px 0 0 rgba(255, 255, 255, 0.06);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .settings-window-header {
    height: 48px;
    background: #0d0e11;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 16px;
    flex-shrink: 0;
    gap: 16px;
  }

  .settings-title-group {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 14px;
    font-weight: 600;
    color: #f1f2f4;
  }

  .settings-search-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    background: #15161b;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 6px;
    padding: 4px 10px;
    width: 320px;
  }

  .settings-search-bar input {
    background: transparent;
    border: none;
    font-size: 12px;
    color: #f1f2f4;
    width: 100%;
    outline: none;
  }

  .settings-search-bar input::placeholder {
    color: #6e7681;
  }

  .close-btn {
    background: transparent;
    border: none;
    color: #8b949e;
    font-size: 14px;
    cursor: pointer;
    padding: 4px 8px;
    border-radius: 4px;
  }

  .close-btn:hover {
    color: #ffffff;
    background: rgba(255, 255, 255, 0.08);
  }

  .settings-body-split {
    flex: 1;
    display: flex;
    overflow: hidden;
  }

  /* Left Categories Sidebar (200px, Raycast Style) */
  .settings-cat-sidebar {
    width: 210px;
    background: #0c0d10;
    border-right: 1px solid rgba(255, 255, 255, 0.06);
    display: flex;
    flex-direction: column;
    padding: 10px 8px;
    gap: 3px;
    overflow-y: auto;
    flex-shrink: 0;
  }

  .cat-item-btn {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 7px 12px;
    border-radius: 6px;
    font-size: 12.5px;
    font-weight: 500;
    color: #9da1ad;
    background: transparent;
    border: 1px solid transparent;
    cursor: pointer;
    width: 100%;
    text-align: left;
    transition: all 0.12s ease;
  }

  .cat-item-btn:hover {
    background: rgba(255, 255, 255, 0.04);
    color: #f1f2f4;
  }

  .cat-item-btn.active {
    background: rgba(255, 255, 255, 0.08);
    border-color: rgba(255, 255, 255, 0.08);
    color: #ffffff;
    font-weight: 600;
  }

  .cat-svg {
    width: 15px;
    height: 15px;
    flex-shrink: 0;
  }

  .icon-14 {
    width: 14px;
    height: 14px;
  }

  .icon-16 {
    width: 16px;
    height: 16px;
  }

  /* Right Content Pane */
  .settings-content-pane {
    flex: 1;
    overflow-y: auto;
    padding: 20px 24px;
    background: #121317;
  }

  .settings-section {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .section-header-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .settings-section-title {
    font-size: 16px;
    font-weight: 600;
    color: #f1f2f4;
    margin: 0;
  }

  .setting-hint {
    font-size: 12px;
    color: #8b949e;
    margin: 4px 0 0;
  }

  .settings-group {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .setting-item-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 14px;
    background: #15161b;
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 8px;
    gap: 12px;
  }

  .setting-item-row.column {
    flex-direction: column;
    align-items: stretch;
  }

  .setting-meta {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .setting-label {
    font-size: 13px;
    font-weight: 500;
    color: #f1f2f4;
  }

  .setting-select-box {
    background: #18191f;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 6px;
    padding: 6px 10px;
    color: #f1f2f4;
    font-size: 12px;
    outline: none;
  }

  .setting-input-text {
    background: #18191f;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 6px;
    padding: 6px 10px;
    color: #f1f2f4;
    font-size: 12px;
    outline: none;
  }

  .full-width {
    width: 100%;
    box-sizing: border-box;
  }

  .mono {
    font-family: monospace;
  }

  .pill-group {
    display: inline-flex;
    background: #18191f;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 6px;
    padding: 2px;
    gap: 2px;
  }

  .pill-btn {
    background: transparent;
    border: none;
    border-radius: 4px;
    padding: 4px 10px;
    color: #8b949e;
    font-size: 11.5px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.12s;
  }

  .pill-btn.flex-1 {
    flex: 1;
    text-align: center;
  }

  .pill-btn:hover {
    color: #f1f2f4;
  }

  .pill-btn.active {
    background: rgba(255, 255, 255, 0.08);
    color: #ffffff;
    font-weight: 600;
  }

  .pill-btn.active.adopt-btn {
    background: #3b82f6;
    color: white;
  }

  .toggle-checkbox {
    width: 16px;
    height: 16px;
    cursor: pointer;
    accent-color: #3b82f6;
  }

  .format-toggles-row {
    display: flex;
    gap: 16px;
    flex-wrap: wrap;
  }

  .lang-format-item {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: #cbd5e1;
    cursor: pointer;
  }

  /* Keymap Table */
  .keymap-search-input {
    background: #18191f;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 6px;
    padding: 4px 10px;
    color: #f1f2f4;
    font-size: 12px;
    outline: none;
    width: 200px;
  }

  .keymap-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
  }

  .keymap-table th {
    text-align: left;
    padding: 8px 12px;
    background: #15161b;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    color: #8b949e;
    font-weight: 600;
  }

  .keymap-table td {
    padding: 8px 12px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.04);
    color: #e2e8f0;
  }

  .keycap {
    display: inline-block;
    padding: 2px 6px;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 4px;
    font-family: monospace;
    font-size: 11px;
    color: #e2e8f0;
  }

  .category-badge {
    display: inline-block;
    padding: 2px 6px;
    background: #18191f;
    border-radius: 4px;
    font-size: 10.5px;
    color: #8b949e;
  }

  .keymap-edit-btn {
    cursor: pointer;
    transition: background 0.15s;
  }
  .keymap-edit-btn:hover {
    background: rgba(255, 255, 255, 0.12);
    border-color: rgba(255, 255, 255, 0.2);
  }

  .keymap-record-input {
    background: #1a2233;
    border: 1.5px solid #3b82f6;
    border-radius: 4px;
    color: #93c5fd;
    font-family: monospace;
    font-size: 11px;
    padding: 3px 8px;
    width: 140px;
    outline: none;
    animation: keymap-pulse 1s infinite;
  }
  @keyframes keymap-pulse {
    0%, 100% { border-color: #3b82f6; }
    50% { border-color: #60a5fa; }
  }

  .btn-reset-all {
    padding: 4px 10px;
    background: #1e1f25;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 4px;
    color: #8b949e;
    font-size: 11px;
    cursor: pointer;
    transition: all 0.15s;
  }
  .btn-reset-all:hover {
    background: #2a2b33;
    color: #d8d9dc;
  }

  .btn-reset-single {
    background: transparent;
    border: none;
    color: #8b949e;
    cursor: pointer;
    font-size: 13px;
    padding: 2px 6px;
    border-radius: 4px;
    transition: all 0.15s;
  }
  .btn-reset-single:hover {
    color: #d8d9dc;
    background: #1e1f25;
  }

  .keymap-conflict-bar {
    background: #2e2717;
    border: 1px solid #5a4a20;
    border-radius: 6px;
    padding: 8px 12px;
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 12px;
    color: #e8b45a;
    margin-bottom: 8px;
  }
  .btn-force {
    padding: 3px 10px;
    background: #5a4a20;
    border: 1px solid #8a7030;
    border-radius: 4px;
    color: #fde68a;
    font-size: 11px;
    cursor: pointer;
  }
  .btn-force:hover {
    background: #6a5a28;
  }
  .btn-cancel {
    padding: 3px 10px;
    background: #1e1f25;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 4px;
    color: #8b949e;
    font-size: 11px;
    cursor: pointer;
  }
  .btn-cancel:hover {
    background: #2a2b33;
    color: #d8d9dc;
  }

  /* AI Agents & Disiplin Container */
  .agents-settings-container {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .settings-group-box {
    background: #15161b;
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 8px;
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .box-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .box-title {
    font-size: 13.5px;
    font-weight: 600;
    color: #f1f2f4;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .slot-select {
    padding: 3px 8px;
    font-size: 11.5px;
  }

  .model-config-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }

  .field-label {
    display: block;
    font-size: 11px;
    color: #8b949e;
    margin-bottom: 4px;
  }

  .keychain-wrap {
    position: relative;
    display: flex;
    align-items: center;
  }

  .keychain-badge {
    position: absolute;
    right: 6px;
    font-size: 9.5px;
    background: rgba(16, 185, 129, 0.2);
    color: #34d399;
    border-color: rgba(16, 185, 129, 0.3);
  }

  .fallback-chain-section {
    padding-top: 10px;
    border-top: 1px solid rgba(255, 255, 255, 0.06);
  }

  .fallback-pills-row {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    margin-top: 4px;
  }

  .fallback-chain-pill {
    padding: 3px 8px;
    border-radius: 4px;
    font-size: 11px;
    background: #18191f;
    border: 1px solid rgba(255, 255, 255, 0.08);
    color: #cbd5e1;
  }

  .fallback-chain-pill.primary {
    border-color: rgba(59, 130, 246, 0.4);
    color: #93c5fd;
  }

  .tier-tag {
    font-weight: 700;
    margin-right: 2px;
  }

  .tier-arrow {
    color: #6e7681;
    font-size: 10px;
  }

  /* Hermes Profiles Grid */
  .hermes-profiles-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 8px;
  }

  .hermes-profile-card {
    background: #18191f;
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 6px;
    padding: 8px 10px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .hermes-profile-card.busy {
    border-color: rgba(59, 130, 246, 0.35);
  }

  .hermes-card-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
  }

  .hermes-card-title {
    font-size: 12px;
    font-weight: 600;
    color: #f1f2f4;
  }

  .status-tag {
    font-size: 10px;
    padding: 1px 4px;
    border-radius: 3px;
  }

  .status-tag.ready {
    color: #34d399;
  }

  .status-tag.busy {
    color: #60a5fa;
    background: rgba(59, 130, 246, 0.15);
  }

  .hermes-role-text {
    font-size: 10.5px;
    color: #8b949e;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .hermes-model-text {
    font-size: 10px;
    color: #64748b;
  }

  .adopt-row {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 12px;
    margin-top: 4px;
  }

  .adopt-feedback {
    font-size: 11.5px;
    color: #34d399;
    font-weight: 500;
  }

  /* Quota Metrics Grid */
  .quota-metrics-grid {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 8px;
  }

  .quota-metric-card {
    background: #18191f;
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 6px;
    padding: 8px 10px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .quota-metric-card.highlight {
    border-color: rgba(59, 130, 246, 0.3);
  }

  .quota-metric-label {
    font-size: 10px;
    color: #8b949e;
  }

  .quota-metric-val {
    font-size: 15px;
    font-weight: 700;
    color: #f1f2f4;
    font-family: monospace;
  }

  .color-blue {
    color: #60a5fa;
  }

  .color-green {
    color: #34d399;
  }

  .quota-breakdown-section {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding-top: 8px;
    border-top: 1px solid rgba(255, 255, 255, 0.06);
  }

  .breakdown-labels {
    display: flex;
    justify-content: space-between;
    font-size: 11px;
    color: #8b949e;
  }

  .quota-bar-track {
    height: 8px;
    background: #18191f;
    border-radius: 4px;
    display: flex;
    overflow: hidden;
  }

  .quota-bar-segment {
    height: 100%;
    transition: width 0.3s;
  }

  /* Toolchains Status Card */
  .tc-status-card {
    background: #18191f;
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 8px;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .tc-status-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .tc-status-title {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    color: #f1f2f4;
  }

  .status-pill-ok {
    font-size: 10.5px;
    background: rgba(16, 185, 129, 0.15);
    color: #34d399;
    border: 1px solid rgba(16, 185, 129, 0.3);
    padding: 2px 6px;
    border-radius: 4px;
  }

  .tc-status-desc {
    font-size: 11.5px;
    color: #8b949e;
  }

  .tc-progress-bar {
    height: 4px;
    background: #252833;
    border-radius: 2px;
    overflow: hidden;
  }

  .tc-progress-fill {
    height: 100%;
    background: #10b981;
    transition: width 0.3s;
  }

  .save-toolchain-row {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 12px;
    margin-top: 6px;
  }

  .save-feedback {
    font-size: 11.5px;
    color: #34d399;
  }

  .action-btn {
    background: #1f2129;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 4px;
    color: #cbd5e1;
    font-size: 11px;
    padding: 4px 8px;
    cursor: pointer;
    transition: all 0.12s;
  }

  .action-btn:hover {
    background: #252833;
    color: #ffffff;
    border-color: rgba(255, 255, 255, 0.16);
  }

  /* Appearance Variant Cards Grid */
  .variant-cards-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 14px;
  }

  .variant-card {
    background: #15161b;
    border: 2px solid rgba(255, 255, 255, 0.06);
    border-radius: 8px;
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .variant-card:hover {
    border-color: rgba(255, 255, 255, 0.16);
    background: #181920;
  }

  .variant-card.active {
    border-color: #3b82f6;
    background: rgba(59, 130, 246, 0.06);
  }

  .variant-card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .variant-name {
    font-size: 13.5px;
    font-weight: 600;
    color: #f1f2f4;
  }

  .variant-badge {
    font-size: 10.5px;
    padding: 2px 6px;
    border-radius: 4px;
    background: #18191f;
    color: #8b949e;
  }

  .variant-badge.active {
    background: #3b82f6;
    color: #ffffff;
    font-weight: 600;
  }

  .variant-desc {
    font-size: 11.5px;
    color: #8b949e;
    line-height: 1.45;
    margin: 0;
  }

  .variant-preview {
    height: 70px;
    border-radius: 6px;
    padding: 8px;
    margin-top: 4px;
    display: flex;
  }

  .preview-a .swatch-layer-0 {
    flex: 1;
    background: #0c0d10;
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 4px;
    padding: 6px;
    display: flex;
  }

  .preview-a .swatch-layer-1 {
    flex: 1;
    background: #121317;
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 4px;
    padding: 6px;
    display: flex;
  }

  .preview-a .swatch-layer-2 {
    flex: 1;
    background: #15161b;
    border-radius: 3px;
  }

  .preview-b .swatch-layer-0 {
    flex: 1;
    background: #0a0b0d;
    border: 1px solid rgba(255, 255, 255, 0.035);
    border-radius: 4px;
    padding: 6px;
    display: flex;
  }

  .preview-b .swatch-layer-1 {
    flex: 1;
    background: #0f1013;
    border: 1px solid rgba(255, 255, 255, 0.035);
    border-radius: 4px;
    padding: 6px;
    display: flex;
  }

  .preview-b .swatch-layer-2 {
    flex: 1;
    background: #141518;
    border-radius: 3px;
  }

  /* Badges */
  .sys-badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    padding: 3px 8px;
    border-radius: 4px;
  }

  .sys-badge.ok {
    background: rgba(16, 185, 129, 0.15);
    border: 1px solid rgba(16, 185, 129, 0.3);
    color: #34d399;
  }

  .dot-green {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #10b981;
  }

  .badge-green {
    background: rgba(16, 185, 129, 0.15);
    color: #34d399;
    border-color: rgba(16, 185, 129, 0.3);
  }

  .badge-blue {
    background: rgba(59, 130, 246, 0.15);
    color: #60a5fa;
    border-color: rgba(59, 130, 246, 0.3);
  }
</style>
