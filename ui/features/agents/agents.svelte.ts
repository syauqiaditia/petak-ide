import { api, type UnlistenFn } from '../../lib/api';
import { listen } from '@tauri-apps/api/event';
import type {
  SlotSummary,
  SlotConfig,
  Proposal,
  PendingPermissionRequest,
  ChatMessage,
  UsageReport,
  TeamConfig,
  HermesDetectionResult,
  HermesProfileInfo,
  PermissionMode,
  FixWithAgentDraft,
  SlotEvent,
  ProviderQuotaInfo,
  LlmQuotaReport,
  MemoryItem,
  ChatSessionMeta,
  ChatSessionData,
  ToolCallData,
  CodeReference,
  PrunedContextResult,
  MemorySnippet,
  FileReference,
} from './types';
import {
  applyDisciplineDirectives,
  extractLessonFromResponse,
  formatLessonEntry,
  DEFAULT_ALLOWLIST,
  isCommandInAllowlist,
  extractChunkText,
  formatDomainMemoryForPrompt,
  formatPrunedContextForPrompt,
  isWatchdogAbortedMessage,
  formatWatchdogRecoveryText,
  generateSessionId,
  migrateV1SessionsToV2,
  resolveTargetSessionId,
  applyStreamUpdateToSession,
} from './agentsLogic';
import { settingsStore } from '../settings/settingsStore.svelte';
import { skillsStore } from './skillsStore.svelte';
import { formatSkillsForPrompt } from './skillsLogic.ts';
import {
  DEMO_SLOTS,
  DEMO_CHAT_MESSAGES,
  DEMO_PROPOSALS,
  DEMO_PENDING_PERMISSIONS,
  DEMO_HERMES_DETECTION,
  DEMO_TEAM_CONFIG,
  DEMO_USAGE_REPORTS,
} from './fixtures';

class AgentsStore {
  constructor() {
    if (typeof window !== 'undefined') {
      (window as any).__agentsStore = this;
      this.loadSavedSessions();
      this.loadActiveChatHistory();
    }
  }

  slots = $state<SlotSummary[]>([]);
  activeSlotId = $state<string | null>(null);
  sessions = $state<Record<string, ChatSessionData>>({});
  activeSessionId = $state<string>('default-sess');
  slotActiveSession = $state<Record<string, string>>({}); // slotId -> running sessionId
  chatHistory = $state<Record<string, ChatMessage[]>>({});
  activeFileReferences = $state<FileReference[]>([]);
  isHistoryOpen = $state(false);
  proposals = $state<Proposal[]>([]);
  pendingPermissions = $state<PendingPermissionRequest[]>([]);
  hermesDetection = $state<HermesDetectionResult | null>(null);
  teamConfig = $state<TeamConfig | null>(null);
  usageReports = $state<Record<string, UsageReport>>({});

  quotaReport = $state<LlmQuotaReport | null>(null);
  isQuotaLoading = $state(false);
  quotaError = $state<string | null>(null);

  memoryItems = $state<MemoryItem[]>([]);
  selectedMemoryFilename = $state<string | null>(null);
  currentMemoryContent = $state<string>('');
  isMemoryLoading = $state(false);
  isMemorySaving = $state(false);
  memorySaveSuccess = $state(false);
  memoryError = $state<string | null>(null);

  isTeamEditorOpen = $state(false);
  isFixWithAgentOpen = $state(false);
  fixWithAgentDraft = $state<FixWithAgentDraft | null>(null);
  isFullAccessWarningOpen = $state(false);
  pendingFullSlotId = $state<string | null>(null);

  isPonytailActive = $state(true); // Default true (Ponytail rule)
  isCavemanActive = $state(false);
  isSelfImproveActive = $state(true); // Default true (Self-improvement & auto-learning)

  isLoading = $state(false);
  isAwaitingPrompt = $state(false);
  attachedReference = $state<CodeReference | null>(null);
  error = $state<string | null>(null);

  isWatchdogAborted = $state(false);
  watchdogRecoveryMessage = $state<string | null>(null);
  lastPromptText = $state<string>('');

  dismissWatchdogRecovery() {
    this.isWatchdogAborted = false;
    this.watchdogRecoveryMessage = null;
  }

  getOrCreateSession(id: string, slotId?: string): ChatSessionData {
    if (!this.sessions[id]) {
      const sId = slotId || this.activeSlotId || (this.slots[0] ? this.slots[0].id : 'default');
      this.sessions[id] = {
        id,
        slotId: sId,
        title: 'Percakapan Baru',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messages: [],
        fileReferences: [],
        modelId: this.activeSlot?.config?.model,
        isStreaming: false,
        streamingContent: '',
        activeToolCalls: [],
        activeThought: '',
      };
    }
    return this.sessions[id];
  }

  resetSlotToReady(slotId?: string) {
    const targetId = slotId || this.activeSlotId;
    const runningSessId = targetId ? this.slotActiveSession[targetId] : null;
    const sess = (runningSessId && this.sessions[runningSessId]) || this.activeSession;
    if (sess) {
      sess.isStreaming = false;
      sess.streamingContent = '';
      sess.activeToolCalls = [];
      sess.activeThought = '';
    }
    if (targetId) {
      delete this.slotActiveSession[targetId];
    }
    this.isWatchdogAborted = false;
    this.watchdogRecoveryMessage = null;
    if (targetId) {
      const idx = this.slots.findIndex((s) => s.id === targetId);
      if (idx !== -1) {
        this.slots[idx] = { ...this.slots[idx], status: 'ready' };
      }
    }
    this.persistSessions();
  }

  attachCodeReference(ref: CodeReference) {
    this.attachedReference = ref;
  }

  clearAttachedReference() {
    this.attachedReference = null;
  }

  private unlistenEvent: UnlistenFn | null = null;
  private initialized = false;

  get activeSlot(): SlotSummary | null {
    if (!this.activeSlotId) return this.slots[0] || null;
    return this.slots.find((s) => s.id === this.activeSlotId) || null;
  }

  get activeSession(): ChatSessionData | null {
    return this.sessions[this.activeSessionId] || null;
  }

  get activeMessages(): ChatMessage[] {
    return this.activeSession?.messages || (this.activeSlotId ? this.chatHistory[this.activeSlotId] : []) || [];
  }

  get streamingContent(): string {
    return this.activeSession?.streamingContent || '';
  }

  get activeToolCalls(): ToolCallData[] {
    return this.activeSession?.activeToolCalls || [];
  }

  get activeThought(): string {
    return this.activeSession?.activeThought || '';
  }

  get isStreaming(): boolean {
    return !!this.activeSession?.isStreaming;
  }

  set isStreaming(val: boolean) {
    if (this.activeSession) {
      this.activeSession.isStreaming = val;
    }
  }

  get savedSessions(): ChatSessionMeta[] {
    return Object.values(this.sessions)
      .filter((s) => s.messages && s.messages.length > 0)
      .sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt))
      .slice(0, 50)
      .map((s) => ({
        id: s.id,
        slotId: s.slotId,
        title: s.title,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
        messageCount: s.messages.length,
        messages: s.messages,
        modelId: s.modelId,
      }));
  }

  set savedSessions(list: ChatSessionMeta[]) {
    if (Array.isArray(list)) {
      for (const m of list) {
        if (!m || !m.id) continue;
        if (!this.sessions[m.id]) {
          this.sessions[m.id] = {
            id: m.id,
            slotId: m.slotId || 'default',
            title: m.title,
            createdAt: m.createdAt,
            updatedAt: m.updatedAt || m.createdAt,
            messages: [...m.messages],
            fileReferences: [],
            modelId: m.modelId,
            isStreaming: false,
            streamingContent: '',
            activeToolCalls: [],
            activeThought: '',
          };
        }
      }
    }
  }

  get activeProposals(): Proposal[] {
    const id = this.activeSlotId;
    if (!id) return this.proposals.filter((p) => p.status === 'pending');
    return this.proposals.filter((p) => p.slotId === id && p.status === 'pending');
  }

  get activeUsage(): UsageReport | null {
    const id = this.activeSlotId;
    if (!id) return null;
    return this.usageReports[id] || null;
  }

  get activePendingPermission(): PendingPermissionRequest | null {
    const id = this.activeSlotId;
    if (!id) return this.pendingPermissions[0] || null;
    return this.pendingPermissions.find((p) => p.slotId === id) || null;
  }

  async init() {
    if (this.initialized) return;
    this.initialized = true;

    this.loadActiveChatHistory();

    // Load initial data
    await this.loadSlots();
    await this.loadProposals();
    await this.loadPermissions();
    await this.detectHermes();
    await this.loadQuotaReport();
    await this.loadMemoryList();

    // Listen for agent-event from backend if inside Tauri
    if (typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__) {
      try {
        this.unlistenEvent = await listen<any>('agent-event', (event) => {
          this.handleSlotEvent(event.payload);
        });
      } catch (err) {
        console.warn('Could not attach agent-event listener:', err);
      }
    }
  }

  destroy() {
    if (this.unlistenEvent) {
      this.unlistenEvent();
      this.unlistenEvent = null;
    }
    this.initialized = false;
  }

  handleSlotEvent(event: any) {
    if (!event) return;

    if (event.StatusChanged) {
      const { slot_id, status } = event.StatusChanged;
      const idx = this.slots.findIndex((s) => s.id === slot_id);
      if (idx !== -1) {
        this.slots[idx] = { ...this.slots[idx], status };
      }
      const runningSessId = this.slotActiveSession[slot_id];
      const targetSession = runningSessId
        ? this.sessions[runningSessId]
        : (slot_id === this.activeSlotId ? this.activeSession : null);

      if (status === 'busy') {
        if (targetSession) {
          targetSession.isStreaming = true;
        }
        if (slot_id === this.activeSlotId) {
          this.isStreaming = true;
        }
      } else if (status === 'ready') {
        if (!this.isAwaitingPrompt) {
          if (targetSession) {
            targetSession.isStreaming = false;
          }
          if (slot_id === this.activeSlotId) {
            this.isStreaming = false;
          }
        }
      } else if (status === 'crashed' || status === 'error') {
        if (targetSession) {
          targetSession.isStreaming = false;
        }
        if (slot_id === this.activeSlotId) {
          this.isStreaming = false;
        }
      }
      this.persistSessions();
      this.persistActiveChatHistory();
    } else if (event.WatchdogAborted) {
      const { slot_id, message } = event.WatchdogAborted;
      const runningSessId = this.slotActiveSession[slot_id];
      const targetSession = runningSessId
        ? this.sessions[runningSessId]
        : (slot_id === this.activeSlotId ? this.activeSession : null);
      if (targetSession) {
        targetSession.isStreaming = false;
      }
      if (slot_id === this.activeSlotId || targetSession?.id === this.activeSessionId) {
        this.isWatchdogAborted = true;
        this.watchdogRecoveryMessage = formatWatchdogRecoveryText(message);
      }
      const sIdx = this.slots.findIndex((s) => s.id === slot_id);
      if (sIdx !== -1) {
        this.slots[sIdx] = { ...this.slots[sIdx], status: 'ready' };
      }
      this.persistSessions();
      this.persistActiveChatHistory();
    } else if (event.Update) {
      const { slot_id, session_id, update } = event.Update;
      if (!update) return;

      const targetSessionId = resolveTargetSessionId(
        session_id,
        slot_id,
        this.sessions,
        this.slotActiveSession,
        this.activeSessionId
      );

      if (targetSessionId) {
        const session = this.getOrCreateSession(targetSessionId, slot_id);
        const updated = applyStreamUpdateToSession(session, update);
        this.sessions[targetSessionId] = updated;

        if (targetSessionId === this.activeSessionId && !updated.isStreaming && isWatchdogAbortedMessage(updated.streamingContent)) {
          this.isWatchdogAborted = true;
          this.watchdogRecoveryMessage = formatWatchdogRecoveryText(updated.streamingContent);
          const sIdx = this.slots.findIndex((s) => s.id === slot_id);
          if (sIdx !== -1) {
            this.slots[sIdx] = { ...this.slots[sIdx], status: 'ready' };
          }
        }
      }

      if (update && update.usage) {
        this.usageReports[slot_id] = {
          reported: true,
          totalTokens: update.usage.totalTokens,
          cost: update.usage.cost,
          contextPercentage: update.usage.contextPercentage,
          displayText: update.usage.displayText || '',
        };
      }
      this.persistSessions();
      this.persistActiveChatHistory();
    } else if (event.PermissionRequested) {
      const { slot_id, request_id, tool_call } = event.PermissionRequested;
      this.pendingPermissions = [
        ...this.pendingPermissions.filter((p) => p.requestId !== request_id),
        {
          requestId: request_id,
          slotId: slot_id,
          sessionId: '',
          toolCall: tool_call,
          createdAt: Date.now(),
        },
      ];
      this.persistActiveChatHistory();
    } else if (event.ProposalCreated) {
      this.loadProposals();
    }
  }

  async loadSlots() {
    try {
      this.isLoading = true;
      const slots = await api.agentListSlots();
      if (slots && slots.length > 0) {
        this.slots = slots;
        if (!this.activeSlotId) {
          const defaultSlot = slots.find((s) => s.id === 'default' || s.label.toLowerCase().includes('petak'));
          this.activeSlotId = defaultSlot ? defaultSlot.id : slots[0].id;
        }
      } else {
        // Fallback default Petak Agent slot
        const defaultSlot: SlotSummary = {
          id: 'default',
          label: 'Petak Agent',
          kind: 'hermes',
          status: 'ready',
          session_id: 'default-sess',
          capabilities: {
            load_session: true,
            supports_set_model: true,
            current_model: 'ag/gemini-3.8-flash-high',
            available_models: [],
            supports_usage: true,
          },
          history_len: 0,
          config: {
            id: 'default',
            label: 'Petak Agent',
            kind: 'hermes',
            model: 'ag/gemini-3.8-flash-high',
            permission: 'ask',
            hermesProfile: 'default',
            cwd: '.',
          },
        };
        this.slots = [defaultSlot];
        this.activeSlotId = 'default';
      }

      // Populate demo chat history if empty and in demo mode
      if (typeof window !== 'undefined' && !(window as any).__TAURI_INTERNALS__) {
        if (Object.keys(this.chatHistory).length === 0) {
          this.chatHistory = { ...DEMO_CHAT_MESSAGES };
        }
        this.usageReports = { ...DEMO_USAGE_REPORTS };
      }
    } catch (e: any) {
      this.error = e?.message || String(e);
      // Fallback to demo slots in browser
      this.slots = DEMO_SLOTS;
      this.activeSlotId = DEMO_SLOTS[0].id;
      if (Object.keys(this.chatHistory).length === 0) {
        this.chatHistory = { ...DEMO_CHAT_MESSAGES };
      }
      this.usageReports = { ...DEMO_USAGE_REPORTS };
    } finally {
      this.isLoading = false;
    }
  }

  selectSlot(id: string) {
    this.activeSlotId = id;
    this.error = null;
  }

  async startSlot(id: string) {
    try {
      const updated = await api.agentStart(id);
      const idx = this.slots.findIndex((s) => s.id === id);
      if (idx !== -1) {
        this.slots[idx] = updated;
      }
    } catch (e: any) {
      this.error = `Failed to start slot: ${e?.message || e}`;
    }
  }

  async stopSlot(id: string) {
    try {
      await api.agentStop(id);
      const idx = this.slots.findIndex((s) => s.id === id);
      if (idx !== -1) {
        this.slots[idx] = { ...this.slots[idx], status: 'stopped', active_pid: null };
      }
    } catch (e: any) {
      this.error = `Failed to stop slot: ${e?.message || e}`;
    }
  }

  async sendPrompt(
    rawPrompt: string,
    options?: {
      prunedContext?: PrunedContextResult | null;
      domainMemorySnippets?: MemorySnippet[];
      fileReferences?: FileReference[];
    }
  ) {
    if ((!rawPrompt.trim() && (!options?.fileReferences || options.fileReferences.length === 0)) || !this.activeSlotId) return;
    const slotId = this.activeSlotId;
    const dispatchSessionId = this.activeSessionId;
    const currentSessionId = dispatchSessionId;

    let memorySnippet = '';
    if (this.isSelfImproveActive) {
      memorySnippet = await this.getMemorySnippetForPrompt();
    }

    let skillsInjection = '';
    try {
      const activeSkills = await skillsStore.getActiveSkillsContent();
      if (activeSkills.length > 0) {
        skillsInjection = formatSkillsForPrompt(activeSkills);
      }
    } catch (err) {
      console.warn('Failed to retrieve active skills for prompt:', err);
    }

    let domainMemorySnippet = '';
    if (options?.domainMemorySnippets && options.domainMemorySnippets.length > 0) {
      domainMemorySnippet = formatDomainMemoryForPrompt(options.domainMemorySnippets);
    } else if (settingsStore.domainMemoryFiltering) {
      try {
        const activeFile = this.attachedReference?.path || null;
        const snippets = await api.agentGetRelevantMemory(activeFile || undefined);
        if (snippets && snippets.length > 0) {
          domainMemorySnippet = formatDomainMemoryForPrompt(snippets);
        }
      } catch (err) {
        console.warn('Failed to retrieve domain memory for prompt:', err);
      }
    }

    let prunedContextSnippet = '';
    if (options?.prunedContext) {
      prunedContextSnippet = formatPrunedContextForPrompt(options.prunedContext);
    }

    let refPrefix = '';
    if (this.attachedReference) {
      const ref = this.attachedReference;
      const loc = `${ref.path}${ref.line ? `:${ref.line}` : ''}${ref.endLine ? `-${ref.endLine}` : ''}`;
      const sym = ref.symbol ? ` (${ref.symbol})` : '';
      const snippet = ref.codeSnippet ? `\n\`\`\`\n${ref.codeSnippet.trim()}\n\`\`\`` : '';
      refPrefix = `[REFERENSI KODE: ${loc}${sym}]${snippet}\n[/REFERENSI KODE]\n\n`;
      this.clearAttachedReference();
    }
    if (options?.fileReferences && options.fileReferences.length > 0) {
      const refList = options.fileReferences
        .map((r) => `- ${r.path}${r.line ? `:${r.line}` : ''}${r.endLine && r.endLine !== r.line ? `-${r.endLine}` : ''}`)
        .join('\n');
      refPrefix += `[REFERENSI BERKAS:\n${refList}\n]\n\n`;
    }

    const fullPromptText = `${refPrefix}${rawPrompt.trim()}`;
    this.lastPromptText = rawPrompt.trim();
    this.isWatchdogAborted = false;
    this.watchdogRecoveryMessage = null;

    const formattedPrompt = applyDisciplineDirectives(
      fullPromptText,
      this.isPonytailActive,
      this.isCavemanActive,
      this.isSelfImproveActive,
      memorySnippet,
      skillsInjection,
      domainMemorySnippet,
      prunedContextSnippet
    );

    const userMsg: ChatMessage = {
      id: `usr-${Date.now()}`,
      timestamp: Date.now(),
      role: 'user',
      content: rawPrompt.trim(),
      metadata:
        options?.fileReferences && options.fileReferences.length > 0
          ? { fileReferences: options.fileReferences }
          : undefined,
    };

    const targetSession = this.getOrCreateSession(currentSessionId, slotId);
    targetSession.messages = [...targetSession.messages, userMsg];
    targetSession.updatedAt = Date.now();
    if (targetSession.messages.filter((m) => m.role === 'user').length === 1 && rawPrompt.trim()) {
      targetSession.title = rawPrompt.trim().slice(0, 48);
    }
    targetSession.isStreaming = true;
    targetSession.streamingContent = '';
    targetSession.activeToolCalls = [];
    targetSession.activeThought = '';

    // Synchronize slotActiveSession & compatibility chatHistory
    this.slotActiveSession[slotId] = currentSessionId;
    if (!this.chatHistory[slotId]) {
      this.chatHistory[slotId] = [];
    }
    this.chatHistory[slotId] = [...this.chatHistory[slotId], userMsg];

    this.persistSessions();
    this.persistActiveChatHistory();

    // Set slot status to busy
    const idx = this.slots.findIndex((s) => s.id === slotId);
    if (idx !== -1) {
      this.slots[idx] = { ...this.slots[idx], status: 'busy' };
    }

    this.isAwaitingPrompt = true;

    try {
      const response = await api.agentPrompt(slotId, formattedPrompt);
      const sessAfter = this.sessions[currentSessionId] || targetSession;
      const rawContent = response.message || sessAfter.streamingContent || 'Aksi selesai.';
      const cleanContent = typeof rawContent === 'string' ? rawContent : extractChunkText(rawContent);

      const agentMsg: ChatMessage = {
        id: `agent-${Date.now()}`,
        timestamp: Date.now(),
        role: 'agent',
        content: cleanContent || 'Aksi selesai.',
        stop_reason: response.stopReason,
        toolCalls: sessAfter.activeToolCalls.length > 0 ? [...sessAfter.activeToolCalls] : undefined,
      };

      sessAfter.messages = [...sessAfter.messages, agentMsg];
      sessAfter.isStreaming = false;
      sessAfter.streamingContent = '';
      sessAfter.activeToolCalls = [];
      sessAfter.activeThought = '';
      sessAfter.updatedAt = Date.now();

      if (dispatchSessionId === this.activeSessionId) {
        if (isWatchdogAbortedMessage(cleanContent)) {
          this.isWatchdogAborted = true;
          this.watchdogRecoveryMessage = formatWatchdogRecoveryText(cleanContent);
        }
        this.chatHistory[slotId] = [...(this.chatHistory[slotId] || []), agentMsg];
        this.persistActiveChatHistory();
      } else {
        // Dispatched session is stale / backgrounded -> Route to savedSessions
        this.appendMessageToSavedSession(dispatchSessionId, agentMsg);
      }

      delete this.slotActiveSession[slotId];
      this.persistSessions();
      this.persistActiveChatHistory();

      // Auto-learn reflection: if agent formulated a lesson, append to project memory
      if (this.isSelfImproveActive && cleanContent) {
        const extractedLesson = extractLessonFromResponse(cleanContent);
        if (extractedLesson) {
          this.appendLessonToMemory(extractedLesson, 'Auto-Improvement').catch((err) => {
            console.warn('Auto-save lesson failed:', err);
          });
        }
      }

      // Refresh proposals in case agent created diffs
      await this.loadProposals();
    } catch (e: any) {
      const errText = e?.message || String(e);
      const errMsg: ChatMessage = {
        id: `err-${Date.now()}`,
        timestamp: Date.now(),
        role: 'system',
        content: `Error: ${errText}`,
      };

      const sessAfter = this.sessions[currentSessionId] || targetSession;
      sessAfter.messages = [...sessAfter.messages, errMsg];
      sessAfter.isStreaming = false;
      sessAfter.streamingContent = '';
      sessAfter.activeToolCalls = [];
      sessAfter.activeThought = '';
      sessAfter.updatedAt = Date.now();

      if (dispatchSessionId === this.activeSessionId) {
        if (isWatchdogAbortedMessage(errText)) {
          this.isWatchdogAborted = true;
          this.watchdogRecoveryMessage = formatWatchdogRecoveryText(errText);
        }
        this.chatHistory[slotId] = [...(this.chatHistory[slotId] || []), errMsg];
        this.persistActiveChatHistory();
      } else {
        this.appendMessageToSavedSession(dispatchSessionId, errMsg);
      }

      delete this.slotActiveSession[slotId];
      this.persistSessions();
      this.persistActiveChatHistory();
    } finally {
      this.isAwaitingPrompt = false;
      const sIdx = this.slots.findIndex((s) => s.id === slotId);
      if (sIdx !== -1) {
        this.slots[sIdx] = { ...this.slots[sIdx], status: 'ready' };
      }
    }
  }

  async cancelActivePrompt() {
    const slotId = this.activeSlotId;
    if (!slotId) return;
    try {
      await api.agentCancel(slotId);
    } catch (e: any) {
      console.warn('Cancel failed:', e);
    } finally {
      this.isAwaitingPrompt = false;
      const currentSession = this.activeSession;
      if (currentSession) {
        currentSession.isStreaming = false;
        currentSession.streamingContent = '';
        currentSession.activeToolCalls = [];
        currentSession.activeThought = '';
      }
      delete this.slotActiveSession[slotId];
      this.isWatchdogAborted = false;
      this.watchdogRecoveryMessage = null;
      const sIdx = this.slots.findIndex((s) => s.id === slotId);
      if (sIdx !== -1) {
        this.slots[sIdx] = { ...this.slots[sIdx], status: 'ready' };
      }
      this.persistSessions();
      try {
        await this.loadSlots();
      } catch (_) {}
    }
  }

  async respondPermission(requestId: string, allow: boolean) {
    try {
      await api.agentRespondPermission(requestId, allow);
      this.pendingPermissions = this.pendingPermissions.filter((p) => p.requestId !== requestId);
      // Append note to active chat
      if (this.activeSlotId) {
        const note: ChatMessage = {
          id: `perm-note-${Date.now()}`,
          timestamp: Date.now(),
          role: 'system',
          content: allow ? '✓ Izin eksekusi disetujui pengguna.' : '✕ Izin eksekusi ditolak pengguna.',
        };
        this.chatHistory[this.activeSlotId] = [...(this.chatHistory[this.activeSlotId] || []), note];
        this.persistActiveChatHistory();
      }
    } catch (e: any) {
      this.error = `Gagal merespons izin: ${e?.message || e}`;
    }
  }

  async loadPermissions() {
    if (typeof window !== 'undefined' && !(window as any).__TAURI_INTERNALS__) {
      this.pendingPermissions = [...DEMO_PENDING_PERMISSIONS];
      return;
    }
    try {
      this.pendingPermissions = (await api.agentListPendingPermissions()) || [];
    } catch (e) {
      this.pendingPermissions = [];
    }
  }

  async loadProposals() {
    if (typeof window !== 'undefined' && !(window as any).__TAURI_INTERNALS__) {
      this.proposals = [...DEMO_PROPOSALS];
      return;
    }
    try {
      this.proposals = (await api.agentListProposals(this.activeSlotId || undefined)) || [];
    } catch (e) {
      this.proposals = [];
    }
  }

  async acceptProposal(proposalId: string) {
    try {
      await api.agentAcceptProposal(proposalId);
      this.proposals = this.proposals.filter((p) => p.id !== proposalId);
      if (this.activeSlotId) {
        const note: ChatMessage = {
          id: `sys-${Date.now()}`,
          timestamp: Date.now(),
          role: 'system',
          content: `✓ Seluruh perubahan usulan (${proposalId}) diterima dan disimpan ke disk. Snapshot Local History telah dibuat.`,
        };
        this.chatHistory[this.activeSlotId] = [...(this.chatHistory[this.activeSlotId] || []), note];
        this.persistActiveChatHistory();
      }
    } catch (e: any) {
      this.error = `Gagal menerima proposal: ${e?.message || e}`;
    }
  }

  async rejectProposal(proposalId: string) {
    try {
      await api.agentRejectProposal(proposalId);
      this.proposals = this.proposals.filter((p) => p.id !== proposalId);
      if (this.activeSlotId) {
        const note: ChatMessage = {
          id: `sys-${Date.now()}`,
          timestamp: Date.now(),
          role: 'system',
          content: `✕ Usulan perubahan (${proposalId}) ditolak.`,
        };
        this.chatHistory[this.activeSlotId] = [...(this.chatHistory[this.activeSlotId] || []), note];
        this.persistActiveChatHistory();
      }
    } catch (e: any) {
      this.error = `Gagal menolak proposal: ${e?.message || e}`;
    }
  }

  async acceptHunk(proposalId: string, hunkIdx: number) {
    try {
      await api.agentAcceptHunk(proposalId, hunkIdx);
      // Re-load proposals
      await this.loadProposals();
    } catch (e: any) {
      this.error = `Gagal menerima hunk: ${e?.message || e}`;
    }
  }

  async detectHermes() {
    try {
      this.hermesDetection = await api.agentDetectHermes();
    } catch (e) {
      if (typeof window !== 'undefined' && !(window as any).__TAURI_INTERNALS__) {
        this.hermesDetection = DEMO_HERMES_DETECTION;
      }
    }
  }

  async loadTeam() {
    try {
      this.teamConfig = await api.agentLoadTeam();
    } catch (e) {
      if (typeof window !== 'undefined' && !(window as any).__TAURI_INTERNALS__) {
        this.teamConfig = DEMO_TEAM_CONFIG;
      }
    }
  }

  async saveTeam(team: TeamConfig) {
    try {
      await api.agentSaveTeam(team);
      this.teamConfig = team;
      await this.loadSlots();
    } catch (e: any) {
      this.error = `Gagal menyimpan konfigurasi tim: ${e?.message || e}`;
    }
  }

  async addSlotFromHermes(profile: HermesProfileInfo) {
    const newSlot: SlotConfig = {
      id: `hermes-${profile.name}-${Date.now().toString(36)}`,
      label: profile.name.charAt(0).toUpperCase() + profile.name.slice(1),
      kind: 'hermes',
      command: null,
      hermesProfile: profile.name,
      model: profile.model || 'auto',
      fallbackModel: null,
      permission: 'ask',
      cwd: 'project',
    };

    try {
      await api.agentAddSlot(newSlot);
      await this.loadSlots();
      this.selectSlot(newSlot.id);
    } catch (e: any) {
      this.error = `Gagal menambahkan slot: ${e?.message || e}`;
    }
  }

  setPermissionMode(slotId: string, mode: PermissionMode) {
    if (mode === 'full') {
      this.pendingFullSlotId = slotId;
      this.isFullAccessWarningOpen = true;
      return;
    }
    this.applyPermissionMode(slotId, mode);
  }

  confirmFullAccess() {
    if (this.pendingFullSlotId) {
      this.applyPermissionMode(this.pendingFullSlotId, 'full');
      this.pendingFullSlotId = null;
    }
    this.isFullAccessWarningOpen = false;
  }

  cancelFullAccess() {
    this.pendingFullSlotId = null;
    this.isFullAccessWarningOpen = false;
  }

  private applyPermissionMode(slotId: string, mode: PermissionMode) {
    const idx = this.slots.findIndex((s) => s.id === slotId);
    if (idx !== -1) {
      const updatedConfig = { ...this.slots[idx].config, permission: mode };
      this.slots[idx] = { ...this.slots[idx], config: updatedConfig };
      api.agentUpdateSlot(updatedConfig).catch((err) => {
        console.warn('Update slot permission failed:', err);
      });
    }
  }

  updateSlotConfig(slotId: string, partial: Partial<SlotConfig>) {
    const idx = this.slots.findIndex((s) => s.id === slotId);
    if (idx !== -1) {
      const updatedConfig = { ...this.slots[idx].config, ...partial };
      this.slots[idx] = { ...this.slots[idx], config: updatedConfig };
      api.agentUpdateSlot(updatedConfig).catch((err) => {
        console.warn('Update slot config failed:', err);
      });
    }
  }

  async addSlot(slot: SlotConfig) {
    try {
      await api.agentAddSlot(slot);
      await this.loadSlots();
      this.selectSlot(slot.id);
    } catch (e: any) {
      this.error = `Gagal menambahkan slot: ${e?.message || e}`;
    }
  }

  async removeSlot(slotId: string) {
    try {
      await api.agentRemoveSlot(slotId);
      await this.loadSlots();
      if (this.activeSlotId === slotId) {
        this.activeSlotId = this.slots[0]?.id || null;
      }
    } catch (e: any) {
      this.error = `Gagal menghapus slot: ${e?.message || e}`;
    }
  }

  // ── Session & History Management ─────────────────────────────────────────

  loadSavedSessions() {
    if (typeof localStorage !== 'undefined') {
      try {
        const v2Raw = localStorage.getItem('petak_chat_sessions_v2');
        if (v2Raw) {
          const parsed = JSON.parse(v2Raw);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            this.sessions = parsed;
            const keys = Object.keys(parsed);
            if (keys.length > 0 && !parsed[this.activeSessionId]) {
              this.activeSessionId = keys[0];
            }
            return;
          }
        }

        // Transparent migration from v1 if v2 is empty
        const v1Raw = localStorage.getItem('petak_chat_sessions_v1');
        const activeHistoryRaw = localStorage.getItem('petak_active_chat_history_v1');
        const v1Sessions = v1Raw ? JSON.parse(v1Raw) : null;
        const activeHistory = activeHistoryRaw ? JSON.parse(activeHistoryRaw) : null;

        const migrated = migrateV1SessionsToV2(v1Sessions, activeHistory);
        if (Object.keys(migrated).length > 0) {
          this.sessions = migrated;
          const keys = Object.keys(migrated);
          if (keys.length > 0) {
            this.activeSessionId = keys[0];
          }
          this.persistSessions();
        }
      } catch (e) {
        console.warn('Failed to load or migrate sessions:', e);
      }
    }
  }

  persistSessions() {
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem('petak_chat_sessions_v2', JSON.stringify(this.sessions));
      } catch (e) {
        console.warn('Failed to save petak_chat_sessions_v2:', e);
      }
    }
  }

  private persistSavedSessions() {
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem('petak_chat_sessions_v1', JSON.stringify(this.savedSessions));
      } catch (e) {
        console.warn('Failed to save petak_chat_sessions_v1:', e);
      }
    }
  }

  // ── Active Chat & References Persistence (petak_active_chat_history_v1) ───────

  loadActiveChatHistory() {
    if (typeof localStorage !== 'undefined') {
      try {
        const raw = localStorage.getItem('petak_active_chat_history_v1');
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === 'object') {
            if (parsed.chatHistory && typeof parsed.chatHistory === 'object' && !Array.isArray(parsed.chatHistory)) {
              this.chatHistory = parsed.chatHistory;
            } else if (!parsed.chatHistory && !Array.isArray(parsed)) {
              this.chatHistory = parsed;
            }
            if (Array.isArray(parsed.fileReferences)) {
              this.activeFileReferences = parsed.fileReferences;
            }
          }
        }
      } catch (e) {
        console.warn('Failed to parse petak_active_chat_history_v1:', e);
      }
    }
  }

  persistActiveChatHistory() {
    if (typeof localStorage !== 'undefined') {
      try {
        const payload = {
          chatHistory: this.chatHistory,
          fileReferences: this.activeFileReferences,
        };
        localStorage.setItem('petak_active_chat_history_v1', JSON.stringify(payload));
      } catch (e) {
        console.warn('Failed to save petak_active_chat_history_v1:', e);
      }
    }
  }

  setFileReferences(refs: FileReference[]) {
    this.activeFileReferences = [...refs];
    const session = this.getOrCreateSession(this.activeSessionId);
    session.fileReferences = [...refs];
    this.persistSessions();
    this.persistActiveChatHistory();
  }

  addFileReference(ref: FileReference) {
    const exists = this.activeFileReferences.some(
      (r) => r.path === ref.path && r.line === ref.line && r.endLine === ref.endLine
    );
    if (!exists) {
      this.activeFileReferences = [...this.activeFileReferences, ref];
      const session = this.getOrCreateSession(this.activeSessionId);
      session.fileReferences = [...this.activeFileReferences];
      this.persistSessions();
      this.persistActiveChatHistory();
    }
  }

  removeFileReference(index: number) {
    this.activeFileReferences = this.activeFileReferences.filter((_, i) => i !== index);
    const session = this.getOrCreateSession(this.activeSessionId);
    session.fileReferences = [...this.activeFileReferences];
    this.persistSessions();
    this.persistActiveChatHistory();
  }

  clearFileReferences() {
    this.activeFileReferences = [];
    const session = this.sessions[this.activeSessionId];
    if (session) {
      session.fileReferences = [];
      this.persistSessions();
    }
    this.persistActiveChatHistory();
  }

  async newSession(slotId?: string) {
    const targetSlotId = slotId || this.activeSlotId || 'default';
    if (!targetSlotId) return;

    if (false as boolean) {
      const currentSlot = this.slots.find((s) => s.id === targetSlotId) || this.activeSlot;
      if (this.isStreaming || currentSlot?.status === 'busy') {
        await this.cancelActivePrompt();
      }
    }

    const newId = generateSessionId();
    const newSessionData: ChatSessionData = {
      id: newId,
      slotId: targetSlotId,
      title: 'Percakapan Baru',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [],
      fileReferences: [],
      modelId: this.activeSlot?.config?.model,
      isStreaming: false,
      streamingContent: '',
      activeToolCalls: [],
      activeThought: '',
    };

    this.sessions[newId] = newSessionData;
    this.activeSessionId = newId;
    this.activeSlotId = targetSlotId;
    this.chatHistory[targetSlotId] = [];
    this.clearFileReferences();
    this.persistActiveChatHistory();
    this.error = null;
    this.isHistoryOpen = false;

    this.isWatchdogAborted = false;
    this.watchdogRecoveryMessage = null;
    const sIdx = this.slots.findIndex((s) => s.id === targetSlotId);
    if (sIdx !== -1) {
      this.slots[sIdx] = { ...this.slots[sIdx], status: 'ready' };
    }
    this.persistSessions();
    this.persistSavedSessions();
  }

  appendMessageToSavedSession(sessionId: string, msg: ChatMessage) {
    let session = this.sessions[sessionId];
    if (session) {
      session.messages = [...session.messages, msg];
      session.updatedAt = Date.now();
    } else {
      session = {
        id: sessionId,
        slotId: this.activeSlotId || 'default',
        title: msg.content.slice(0, 48),
        createdAt: msg.timestamp || Date.now(),
        updatedAt: Date.now(),
        messages: [msg],
        fileReferences: [],
        modelId: this.activeSlot?.config?.model,
        isStreaming: false,
        streamingContent: '',
        activeToolCalls: [],
        activeThought: '',
      };
      this.sessions[sessionId] = session;
    }
    this.persistSessions();
    this.persistSavedSessions();
  }

  loadSession(session: ChatSessionMeta | string) {
    const sessionId = typeof session === 'string' ? session : session.id;
    let targetSession = this.sessions[sessionId];

    if (!targetSession && typeof session !== 'string') {
      targetSession = {
        id: session.id,
        slotId: session.slotId || 'default',
        title: session.title,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt || session.createdAt,
        messages: [...session.messages],
        fileReferences: [],
        modelId: session.modelId,
        isStreaming: false,
        streamingContent: '',
        activeToolCalls: [],
        activeThought: '',
      };
      this.sessions[sessionId] = targetSession;
    }

    if (targetSession) {
      this.activeSessionId = targetSession.id;
      this.activeSlotId = targetSession.slotId;
      this.chatHistory[targetSession.slotId] = [...targetSession.messages];
      this.activeFileReferences = [...(targetSession.fileReferences || [])];
      if (targetSession.modelId) {
        this.updateSlotModel(targetSession.slotId, targetSession.modelId);
      }
    }

    this.isHistoryOpen = false;
    this.persistSessions();
    this.persistActiveChatHistory();
  }

  deleteSession(sessionId: string) {
    delete this.sessions[sessionId];
    if (this.activeSessionId === sessionId) {
      const remaining = Object.keys(this.sessions);
      if (remaining.length > 0) {
        this.activeSessionId = remaining[0];
        if (this.sessions[this.activeSessionId]) {
          this.activeSlotId = this.sessions[this.activeSessionId].slotId;
        }
      } else {
        this.newSession();
      }
    }
    this.persistSessions();
    this.persistSavedSessions();
    this.persistActiveChatHistory();
  }

  clearAllSessions() {
    this.sessions = {};
    this.persistSessions();
    this.persistSavedSessions();
    this.persistActiveChatHistory();
    this.isHistoryOpen = false;
    this.newSession();
  }

  toggleHistory() {
    this.isHistoryOpen = !this.isHistoryOpen;
  }

  updateSlotModel(slotId: string, newModel: string) {
    this.updateSlotConfig(slotId, { model: newModel });
  }

  openFixWithAgent(draft: FixWithAgentDraft) {
    this.fixWithAgentDraft = draft;
    if (draft.slotId) {
      this.activeSlotId = draft.slotId;
    }
    this.isFixWithAgentOpen = true;
  }

  async submitFixWithAgent() {
    if (!this.fixWithAgentDraft) return;
    const prompt = this.fixWithAgentDraft.userPrompt;
    this.isFixWithAgentOpen = false;
    this.fixWithAgentDraft = null;
    await this.sendPrompt(prompt);
  }

  togglePonytail() {
    this.isPonytailActive = !this.isPonytailActive;
  }

  toggleCaveman() {
    this.isCavemanActive = !this.isCavemanActive;
  }

  toggleSelfImprove() {
    this.isSelfImproveActive = !this.isSelfImproveActive;
  }

  get isLspPruningActive(): boolean {
    return settingsStore.lspContextPruning;
  }

  get isDomainMemoryActive(): boolean {
    return settingsStore.domainMemoryFiltering;
  }

  toggleLspPruning() {
    settingsStore.setLspContextPruning(!settingsStore.lspContextPruning);
  }

  toggleDomainMemory() {
    settingsStore.setDomainMemoryFiltering(!settingsStore.domainMemoryFiltering);
  }

  async getMemorySnippetForPrompt(): Promise<string> {
    try {
      if (this.memoryItems.length === 0) {
        this.memoryItems = await api.agentListProjectMemory();
      }
      const keyFiles = ['conventions.md', 'gotchas.md', 'rules.md', 'lessons.md'];
      const targets = this.memoryItems
        .filter((m) => keyFiles.includes(m.filename.toLowerCase()))
        .slice(0, 3);
      const chosen = targets.length > 0 ? targets : this.memoryItems.slice(0, 2);

      const snippets: string[] = [];
      for (const item of chosen) {
        const text = await api.agentReadProjectMemory(item.filename);
        if (text && text.trim()) {
          snippets.push(`## ${item.filename}\n${text.trim().slice(0, 600)}`);
        }
      }
      return snippets.join('\n\n');
    } catch {
      return '';
    }
  }

  async appendLessonToMemory(lesson: string, topic?: string) {
    try {
      const entry = formatLessonEntry(lesson, topic);
      let existing = '';
      try {
        existing = await api.agentReadProjectMemory('lessons.md');
      } catch {
        existing = '# Lessons Learned & Self-Improvement\n\nCatatan penting dan konvensi proyek yang dipelajari otomatis oleh agen.\n\n';
      }
      const updated = `${existing.trimEnd()}\n${entry}\n`;
      await api.agentSaveProjectMemory('lessons.md', updated);
      await this.loadMemoryList();
    } catch (err: any) {
      console.warn('Failed to append lesson to memory:', err);
    }
  }

  // ── 9Router Quota & Project Memory Actions ──────────────────────────────
  async loadQuotaReport(force = false) {
    if (this.isQuotaLoading && !force) return;
    this.isQuotaLoading = true;
    this.quotaError = null;
    try {
      this.quotaReport = await api.agentGetQuotaReport();
    } catch (err: any) {
      this.quotaError = err?.message || String(err);
    } finally {
      this.isQuotaLoading = false;
    }
  }

  async loadMemoryList() {
    this.isMemoryLoading = true;
    this.memoryError = null;
    try {
      this.memoryItems = await api.agentListProjectMemory();
      if (!this.selectedMemoryFilename && this.memoryItems.length > 0) {
        await this.selectMemory(this.memoryItems[0].filename);
      }
    } catch (err: any) {
      this.memoryError = err?.message || String(err);
    } finally {
      this.isMemoryLoading = false;
    }
  }

  async selectMemory(filename: string) {
    this.selectedMemoryFilename = filename;
    this.memoryError = null;
    this.memorySaveSuccess = false;
    try {
      this.currentMemoryContent = await api.agentReadProjectMemory(filename);
    } catch (err: any) {
      this.memoryError = err?.message || String(err);
    }
  }

  async saveCurrentMemory(filename: string, content: string) {
    this.isMemorySaving = true;
    this.memoryError = null;
    this.memorySaveSuccess = false;
    try {
      await api.agentSaveProjectMemory(filename, content);
      this.currentMemoryContent = content;
      this.memorySaveSuccess = true;
      this.memoryItems = await api.agentListProjectMemory();
      setTimeout(() => {
        this.memorySaveSuccess = false;
      }, 3000);
    } catch (err: any) {
      this.memoryError = err?.message || String(err);
    } finally {
      this.isMemorySaving = false;
    }
  }

  async createNewMemory(filename: string, content = '') {
    this.isMemorySaving = true;
    this.memoryError = null;
    try {
      await api.agentSaveProjectMemory(filename, content);
      await this.loadMemoryList();
      await this.selectMemory(filename);
    } catch (err: any) {
      this.memoryError = err?.message || String(err);
    } finally {
      this.isMemorySaving = false;
    }
  }
}

export const agentsStore = new AgentsStore();
