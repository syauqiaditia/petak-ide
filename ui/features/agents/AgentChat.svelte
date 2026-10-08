<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { agentsStore } from './agents.svelte';
  import {
    truncateToolOutput,
    extractChunkText,
    renderChatMarkdown,
    formatTokenSavingsPill,
    formatPrunedContextForPrompt,
    formatDomainMemoryForPrompt,
    formatSelfHealStatus,
    isWatchdogAbortedMessage,
    formatWatchdogRecoveryText,
    formatToolGroupSummary,
    isToolGroupCollapsed,
    toggleToolGroupCollapsed,
    separateStreamingToolCalls,
  } from './agentsLogic';
  import type {
    ChatMessage,
    PendingPermissionRequest,
    PermissionMode,
    PrunedContextResult,
    MemorySnippet,
    SelfHealStatus,
    SelfHealResult,
    SelfHealPhase,
  } from './types';
  import { settingsStore } from '../settings/settingsStore.svelte';
  import { mcpStore, formatMcpPillLabel } from '../settings/mcpStore.svelte';
  import { skillsStore } from './skillsStore.svelte';
  import { tabsManager } from '../editor/tabs.svelte';
  import { api } from '../../lib/api';
  import PermissionModal from './PermissionModal.svelte';

  export interface FileReference {
    path: string;
    name: string;
    line?: number;
    endLine?: number;
    isDir?: boolean;
  }

  let promptText = $state('');
  let fileReferences = $state<FileReference[]>([]);
  let userPinnedToBottom = $state(true);
  let textareaEl: HTMLTextAreaElement | null = $state(null);
  let messagesContainerEl: HTMLDivElement | null = $state(null);
  let expandedToolOutputs = $state<Record<string, boolean>>({});
  let collapsedToolGroups = $state<Record<string, boolean>>({});

  $effect(() => {
    if (agentsStore.activeFileReferences.length > 0 && fileReferences.length === 0) {
      fileReferences = [...agentsStore.activeFileReferences];
    }
  });

  function isGroupCollapsed(groupId: string): boolean {
    return isToolGroupCollapsed(collapsedToolGroups, groupId);
  }

  function toggleGroup(groupId: string) {
    collapsedToolGroups = toggleToolGroupCollapsed(collapsedToolGroups, groupId);
  }

  export function addFileReference(ref: FileReference) {
    const exists = fileReferences.some(
      (r) => r.path === ref.path && r.line === ref.line && r.endLine === ref.endLine
    );
    if (!exists) {
      fileReferences = [...fileReferences, ref];
      agentsStore.activeFileReferences = [...fileReferences];
      agentsStore.persistActiveChatHistory();
    }
  }

  export function removeFileReference(index: number) {
    fileReferences = fileReferences.filter((_, i) => i !== index);
    agentsStore.activeFileReferences = [...fileReferences];
    agentsStore.persistActiveChatHistory();
  }

  export async function openReferencedFile(filePath: string, line?: number) {
    if (!filePath) return;
    const fileName = filePath.split('/').pop() || filePath;
    const existing = tabsManager.tabs.find((t) => t.path === filePath);
    let content = existing ? existing.savedContent : '';
    if (!existing) {
      try {
        content = await api.readFile(filePath);
      } catch (err) {
        console.warn('Failed to read referenced file content:', err);
        content = '';
      }
    }
    tabsManager.openTab(filePath, fileName, content);
    if (line !== undefined && line !== null) {
      setTimeout(() => {
        if (typeof window !== 'undefined' && (window as any).__PETAK_GOTO_LINE__) {
          (window as any).__PETAK_GOTO_LINE__(line, 1);
        }
      }, 50);
    }
  }

  let isContextPickerOpen = $state(false);
  let attachedContextLabel = $state<string | null>(null);
  let fileSearchQuery = $state('');
  let fileSearchResults = $state<string[]>([]);
  let isSearchingFiles = $state(false);
  let isSkillPickerOpen = $state(false);
  let skillSearch = $state('');

  let prunedContext = $state<PrunedContextResult | null>(null);
  let isPruning = $state(false);
  let relevantMemorySnippets = $state<MemorySnippet[]>([]);
  let isPrunedPopoverOpen = $state(false);

  let isMentionPopupOpen = $state(false);
  let mentionQuery = $state('');
  let mentionResults = $state<Array<{ name: string; path: string; isTab?: boolean }>>([]);
  let mentionSelectedIndex = $state(0);
  let mentionCursorStart = 0;

  let activeSlot = $derived(agentsStore.activeSlot);
  let messages = $derived(agentsStore.activeMessages);
  let pendingPerm = $derived(agentsStore.activePendingPermission);
  let isBusy = $derived(
    !agentsStore.isWatchdogAborted && (agentsStore.isStreaming || activeSlot?.status === 'busy')
  );
  let activePermission = $derived<PermissionMode>(
    ((activeSlot?.config?.permission as PermissionMode) || 'ask')
  );

  let lastMessage = $derived(messages.length > 0 ? messages[messages.length - 1] : null);
  let lastMessageWatchdog = $derived(
    lastMessage && isWatchdogAbortedMessage(typeof lastMessage.content === 'string' ? lastMessage.content : '')
      ? formatWatchdogRecoveryText(typeof lastMessage.content === 'string' ? lastMessage.content : '')
      : null
  );
  let watchdogRecoveryText = $derived<string | null>(
    agentsStore.watchdogRecoveryMessage || lastMessageWatchdog
  );
  let isWatchdogBannerDismissed = $state(false);

  let copiedBubbleId = $state<string | null>(null);
  let copyTimeoutId: any = null;

  async function handleCopyBubble(id: string, text: string) {
    if (!text) return;
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      copiedBubbleId = id;
      if (copyTimeoutId) clearTimeout(copyTimeoutId);
      copyTimeoutId = setTimeout(() => {
        if (copiedBubbleId === id) {
          copiedBubbleId = null;
        }
      }, 2000);
    } catch (err) {
      console.warn('Failed to copy bubble:', err);
    }
  }

  function handleContainerClick(e: MouseEvent) {
    const target = e.target as HTMLElement | null;
    const pillBtn = target?.closest('.bubble-file-pill') as HTMLElement | null;
    if (pillBtn) {
      e.preventDefault();
      e.stopPropagation();
      const p = pillBtn.getAttribute('data-path') || '';
      const l = pillBtn.getAttribute('data-line');
      const lineNum = l ? parseInt(l, 10) : undefined;
      if (p) {
        openReferencedFile(p, lineNum);
        return;
      }
    }

    const copyBtn = target?.closest('.code-copy-btn') as HTMLButtonElement | null;
    if (copyBtn) {
      e.preventDefault();
      e.stopPropagation();
      const codeWrapper = copyBtn.closest('.chat-code-wrapper');
      const codeEl = codeWrapper?.querySelector('pre.chat-code-block code') || codeWrapper?.querySelector('pre code');
      const codeText = codeEl?.textContent || '';
      if (codeText) {
        if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
          navigator.clipboard.writeText(codeText);
        } else {
          const ta = document.createElement('textarea');
          ta.value = codeText;
          ta.style.position = 'fixed';
          ta.style.opacity = '0';
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          document.body.removeChild(ta);
        }
        const originalText = copyBtn.textContent;
        copyBtn.textContent = '✓ Tersalin!';
        copyBtn.title = 'Tersalin!';
        copyBtn.classList.add('copied');
        setTimeout(() => {
          copyBtn.textContent = originalText || '📋 Salin';
          copyBtn.title = 'Salin kode';
          copyBtn.classList.remove('copied');
        }, 2000);
      }
    }
  }

  $effect(() => {
    if (agentsStore.isWatchdogAborted || lastMessageWatchdog) {
      isWatchdogBannerDismissed = false;
    }
  });

  let showWatchdogBanner = $derived(
    !isWatchdogBannerDismissed && Boolean(watchdogRecoveryText)
  );

  function handleWatchdogContinue() {
    isWatchdogBannerDismissed = true;
    agentsStore.dismissWatchdogRecovery();
    agentsStore.sendPrompt('Lanjutkan');
  }

  function handleWatchdogResend() {
    isWatchdogBannerDismissed = true;
    agentsStore.dismissWatchdogRecovery();
    const toResend = agentsStore.lastPromptText || promptText;
    if (toResend?.trim()) {
      agentsStore.sendPrompt(toResend.trim());
    } else {
      promptText = 'Lanjutkan';
      textareaEl?.focus();
    }
  }

  function dismissWatchdogAlert() {
    isWatchdogBannerDismissed = true;
    agentsStore.dismissWatchdogRecovery();
  }

  let isSelfHealActive = $state(true);
  let selfHealStatus = $state<SelfHealStatus | null>(null);
  let selfHealInfo = $derived(
    formatSelfHealStatus(
      selfHealStatus?.status || 'idle',
      selfHealStatus?.attempt || 0,
      selfHealStatus?.max_attempts || 3
    )
  );

  async function checkSelfHealStatus() {
    if (!activeSlot) return;
    try {
      selfHealStatus = await api.agentGetSelfHealStatus(activeSlot.id);
    } catch {
      // ignore
    }
  }

  function toggleSelfHeal() {
    isSelfHealActive = !isSelfHealActive;
  }

  function handleScroll() {
    if (!messagesContainerEl) return;
    const distanceToBottom =
      messagesContainerEl.scrollHeight -
      messagesContainerEl.scrollTop -
      messagesContainerEl.clientHeight;
    if (distanceToBottom <= 60) {
      userPinnedToBottom = true;
    } else {
      userPinnedToBottom = false;
    }
  }

  $effect(() => {
    // Scroll to bottom on new messages or streaming changes only if pinned
    if ((messages.length || agentsStore.streamingContent) && userPinnedToBottom) {
      scrollToBottom();
    }
  });

  onMount(() => {
    mcpStore.loadConfig();
    skillsStore.loadSkills();
    checkSelfHealStatus();
  });

  async function scrollToBottom(force = false) {
    if (force) {
      userPinnedToBottom = true;
    }
    await tick();
    if (messagesContainerEl && (userPinnedToBottom || force)) {
      messagesContainerEl.scrollTop = messagesContainerEl.scrollHeight;
    }
  }

  async function handleTextareaInput(e: Event) {
    const el = textareaEl;
    if (!el) return;
    const val = el.value;
    const cursorPos = el.selectionStart;

    const textBeforeCursor = val.slice(0, cursorPos);
    const atMatch = textBeforeCursor.match(/@([a-zA-Z0-9_\-\./]*)$/);

    if (atMatch) {
      const query = atMatch[1];
      mentionQuery = query;
      mentionCursorStart = cursorPos - atMatch[0].length;
      mentionSelectedIndex = 0;

      const qLower = query.toLowerCase();
      const tabHits = tabsManager.tabs
        .filter((t) => !query || t.name.toLowerCase().includes(qLower) || t.path.toLowerCase().includes(qLower))
        .map((t) => ({ name: t.name, path: t.path, isTab: true }));

      let fileHits: Array<{ name: string; path: string; isTab?: boolean }> = [];
      if (query.trim()) {
        try {
          const hits = await api.findFiles(query.trim(), 8);
          fileHits = hits
            .filter((h: any) => !tabHits.some((t) => t.path === h.path))
            .map((h: any) => ({
              name: h.path.split('/').pop() || h.path,
              path: h.path,
              isTab: false,
            }));
        } catch {
          // ignore
        }
      }

      const combined = [...tabHits, ...fileHits].slice(0, 8);
      if (combined.length > 0) {
        mentionResults = combined;
        isMentionPopupOpen = true;
        return;
      }
    }

    isMentionPopupOpen = false;
    mentionResults = [];
  }

  async function triggerSmartContextPruning(filePath: string, line?: number) {
    if (settingsStore.lspContextPruning) {
      isPruning = true;
      try {
        prunedContext = await api.agentPruneContext(filePath, line);
      } catch (err) {
        console.warn('Context pruning failed:', err);
        prunedContext = null;
      } finally {
        isPruning = false;
      }
    } else {
      prunedContext = null;
    }

    if (settingsStore.domainMemoryFiltering) {
      try {
        relevantMemorySnippets = await api.agentGetRelevantMemory(filePath);
      } catch (err) {
        console.warn('Relevant domain memory retrieval failed:', err);
        relevantMemorySnippets = [];
      }
    } else {
      relevantMemorySnippets = [];
    }
  }

  function applyMention(item: { name: string; path: string; isTab?: boolean }) {
    if (!textareaEl) return;
    const val = textareaEl.value;
    const cursorPos = textareaEl.selectionStart;

    const before = val.slice(0, mentionCursorStart);
    const after = val.slice(cursorPos);

    promptText = before + after;
    isMentionPopupOpen = false;
    mentionResults = [];
    attachedContextLabel = item.name;

    let filePath = item.path;
    let startLine: number | undefined;
    let endLine: number | undefined;
    const lineMatch = filePath.match(/^(.+?):(\d+)(?:-(\d+))?$/);
    if (lineMatch) {
      filePath = lineMatch[1];
      startLine = parseInt(lineMatch[2], 10);
      endLine = lineMatch[3] ? parseInt(lineMatch[3], 10) : undefined;
    }

    addFileReference({
      path: filePath,
      name: item.name || filePath.split('/').pop() || filePath,
      line: startLine,
      endLine,
      isDir: !item.isTab && !filePath.includes('.'),
    });

    triggerSmartContextPruning(filePath, startLine);

    tick().then(() => {
      if (textareaEl) {
        textareaEl.setSelectionRange(before.length, before.length);
        textareaEl.focus();
      }
    });
  }

  function handleKeydown(e: KeyboardEvent) {
    if (isMentionPopupOpen && mentionResults.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        mentionSelectedIndex = (mentionSelectedIndex + 1) % mentionResults.length;
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        mentionSelectedIndex = (mentionSelectedIndex - 1 + mentionResults.length) % mentionResults.length;
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        const selected = mentionResults[mentionSelectedIndex];
        if (selected) {
          applyMention(selected);
        }
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        isMentionPopupOpen = false;
        return;
      }
    }

    if (e.key === 'Backspace') {
      const isEmpty = !promptText || promptText.length === 0;
      const isAtStart = textareaEl?.selectionStart === 0 && textareaEl?.selectionEnd === 0;
      if (isEmpty && isAtStart && fileReferences.length > 0) {
        e.preventDefault();
        removeFileReference(fileReferences.length - 1);
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  async function handleSubmit() {
    if (!promptText.trim() && fileReferences.length === 0) return;
    if (isBusy) return;

    userPinnedToBottom = true;
    scrollToBottom(true);

    const text = promptText.trim();
    const refsSnapshot = [...fileReferences];

    // Prepare extra context payload without polluting visible user message
    const options: {
      prunedContext?: PrunedContextResult | null;
      domainMemorySnippets?: MemorySnippet[];
      fileReferences?: FileReference[];
    } = {};

    if (refsSnapshot.length > 0) {
      options.fileReferences = refsSnapshot;
    }

    if (prunedContext && settingsStore.lspContextPruning) {
      options.prunedContext = prunedContext;
    }

    if (relevantMemorySnippets.length > 0 && settingsStore.domainMemoryFiltering) {
      options.domainMemorySnippets = relevantMemorySnippets;
    }

    promptText = '';
    fileReferences = [];
    agentsStore.activeFileReferences = [];
    agentsStore.persistActiveChatHistory();
    attachedContextLabel = null;
    prunedContext = null;
    relevantMemorySnippets = [];
    isPrunedPopoverOpen = false;
    await agentsStore.sendPrompt(text, options);
    textareaEl?.focus();
  }

  function toggleToolOutput(key: string) {
    expandedToolOutputs[key] = !expandedToolOutputs[key];
  }

  function applyQuickPrompt(prompt: string) {
    promptText = prompt;
    handleSubmit();
  }

  function handleToggleContextPicker() {
    isContextPickerOpen = !isContextPickerOpen;
  }

  async function handleFileSearch(q: string) {
    fileSearchQuery = q;
    if (!q.trim()) {
      fileSearchResults = [];
      return;
    }
    isSearchingFiles = true;
    try {
      const hits = await api.findFiles(q.trim(), 8);
      fileSearchResults = hits.map((h: any) => h.path);
    } catch {
      fileSearchResults = [];
    } finally {
      isSearchingFiles = false;
    }
  }

  function tagSpecificFile(filePath: string) {
    isContextPickerOpen = false;
    fileSearchQuery = '';
    fileSearchResults = [];
    const fileName = filePath.split('/').pop() || filePath;
    attachedContextLabel = fileName;
    addFileReference({
      path: filePath,
      name: fileName,
      isDir: !filePath.includes('.'),
    });
    triggerSmartContextPruning(filePath);
    textareaEl?.focus();
  }

  function selectActiveTabContext() {
    isContextPickerOpen = false;
    if (!tabsManager.activeTab) return;
    const path = tabsManager.activeTab.path;
    const fileName = tabsManager.activeTab.name;

    // Get current line if available from active editor view
    let lineSuffix = '';
    let startLine: number | undefined;
    let endLine: number | undefined;
    const view = (window as any).__PETAK_EDITOR_VIEW__;
    if (view) {
      try {
        const sel = view.state.selection.main;
        startLine = view.state.doc.lineAt(sel.from).number;
        const endLine = view.state.doc.lineAt(sel.to).number;
        lineSuffix = startLine === endLine ? `:${startLine}` : `:${startLine}-${endLine}`;
      } catch {
        // ignore
      }
    }

    attachedContextLabel = `${fileName}${lineSuffix}`;
    addFileReference({
      path,
      name: fileName,
      line: startLine,
      endLine: endLine && endLine !== startLine ? endLine : undefined,
      isDir: false,
    });
    triggerSmartContextPruning(path, startLine);
    textareaEl?.focus();
  }

  function selectContext(type: 'git' | 'status') {
    isContextPickerOpen = false;
    if (type === 'git') {
      attachedContextLabel = 'Git';
      promptText = (promptText ? promptText + ' ' : '') + '@git:diff ';
    } else {
      attachedContextLabel = 'Tree';
      promptText = (promptText ? promptText + ' ' : '') + '@context:project ';
    }
    textareaEl?.focus();
  }

  function handlePermissionChange(e: Event) {
    const select = e.target as HTMLSelectElement;
    if (!activeSlot) return;
    const mode = select.value as PermissionMode;
    agentsStore.setPermissionMode(activeSlot.id, mode);
  }
</script>

<div class="agent-chat-wrapper">
  <!-- Messages Scroll Area -->
  <div class="chat-messages" bind:this={messagesContainerEl} onscroll={handleScroll} onclick={handleContainerClick}>
    {#if messages.length === 0 && !agentsStore.isStreaming}
      <!-- Empty Session Greeting & Quick Suggestions -->
      <div class="empty-chat-welcome">
        <div class="welcome-icon">🤖</div>
        <div class="welcome-title">
          {activeSlot?.label || 'Petak Agent'}
        </div>
        <div class="welcome-desc">
          Model: <code>{activeSlot?.config?.model || 'ag/gemini-3.8-flash-high'}</code> · Izin: <code>{activePermission}</code>
        </div>
        <div class="quick-prompts">
          <button class="quick-prompt-btn" onclick={() => applyQuickPrompt('Review perubahan git terkini dan temukan potensi bug.')}>
            🔍 Review perubahan git
          </button>
          <button class="quick-prompt-btn" onclick={() => applyQuickPrompt('Cari penyebab build error dan usulkan perbaikan minimal.')}>
            🛠️ Cari penyebab build error
          </button>
          <button class="quick-prompt-btn" onclick={() => applyQuickPrompt('Buatkan skenario pengujian otomatis Maestro untuk flow fitur ini.')}>
            🧪 Buatkan flow test Maestro
          </button>
          <button class="quick-prompt-btn" onclick={() => applyQuickPrompt('Jelaskan arsitektur berkas ini dan dependensinya.')}>
            📖 Jelaskan fungsi berkas ini
          </button>
        </div>

        {#if agentsStore.savedSessions.length > 0}
          <div class="recent-chats-box">
            <div class="recent-chats-header">
              <span class="recent-chats-title">⏱️ Sesi Percakapan Terakhir ({agentsStore.savedSessions.length})</span>
              <button type="button" class="recent-clear-btn" onclick={() => agentsStore.clearAllSessions()}>Hapus Semua</button>
            </div>
            <div class="recent-chats-scroll">
              {#each agentsStore.savedSessions.slice(0, 6) as sess (sess.id)}
                <!-- svelte-ignore a11y_click_events_have_key_events -->
                <div class="recent-chat-row" role="button" tabindex="0" onclick={() => agentsStore.loadSession(sess)}>
                  <div class="recent-chat-content">
                    <span class="recent-chat-title">{sess.title}</span>
                    <span class="recent-chat-meta">{sess.messageCount} pesan · {new Date((sess as any).updatedAt || sess.createdAt).toLocaleDateString('id-ID', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                  <button type="button" class="recent-del-btn" onclick={(e) => { e.stopPropagation(); agentsStore.deleteSession(sess.id); }} title="Hapus sesi">🗑️</button>
                </div>
              {/each}
            </div>
          </div>
        {/if}
      </div>
    {/if}

    {#each messages as msg (msg.id)}
      <div class="message-row" class:user-row={msg.role === 'user'} class:system-row={msg.role === 'system'}>
        <div class="message-bubble" class:user-bubble={msg.role === 'user'} class:agent-bubble={msg.role === 'agent'} class:system-bubble={msg.role === 'system'}>
          <div class="message-bubble-header">
            <div class="message-role-label">
              {msg.role === 'user' ? 'Anda' : msg.role === 'agent' ? (activeSlot?.label || 'Agent') : 'Sistem'}
            </div>
            {#if msg.role === 'user' || msg.role === 'agent'}
              <button
                type="button"
                class="bubble-copy-btn"
                class:copied={copiedBubbleId === msg.id}
                title={copiedBubbleId === msg.id ? 'Tersalin!' : 'Salin pesan'}
                onclick={() => handleCopyBubble(msg.id, typeof msg.content === 'string' ? msg.content : (extractChunkText(msg.content) || ''))}
              >
                {copiedBubbleId === msg.id ? '✓ Tersalin!' : '📋 Salin'}
              </button>
            {/if}
          </div>

          <!-- Interactive File Reference Pills if present in metadata -->
          {#if msg.metadata?.fileReferences && msg.metadata.fileReferences.length > 0}
            <div class="bubble-file-pills">
              {#each msg.metadata.fileReferences as ref}
                <button
                  type="button"
                  class="bubble-file-pill"
                  data-path={ref.path}
                  data-line={ref.line}
                  onclick={() => openReferencedFile(ref.path, ref.line)}
                  title={`Buka ${ref.path}${ref.line ? `:${ref.line}` : ''} di Editor`}
                >
                  <span class="pill-icon">{ref.isDir ? '📁' : '📄'}</span>
                  <span class="pill-name">{ref.name || ref.path.split('/').pop()}{ref.line ? `:${ref.line}` : ''}</span>
                </button>
              {/each}
            </div>
          {/if}

          <div class="message-body chat-markdown">
            {@html renderChatMarkdown(typeof msg.content === 'string' ? msg.content : (extractChunkText(msg.content) || JSON.stringify(msg.content)))}
          </div>

          <!-- Tool calls if present -->
          {#if msg.toolCalls && msg.toolCalls.length > 0}
            {@const groupId = `msg-${msg.id}`}
            {@const isCollapsed = isGroupCollapsed(groupId)}
            <div class="tool-group-accordion">
              <button
                type="button"
                class="tool-group-header"
                onclick={() => toggleGroup(groupId)}
                aria-expanded={!isCollapsed}
              >
                <span class="tool-group-title">
                  ⚙️ {msg.toolCalls.length} tindakan alat ({formatToolGroupSummary(msg.toolCalls)})
                </span>
                <span class="tool-group-arrow">{isCollapsed ? '▶' : '▼'}</span>
              </button>
              {#if !isCollapsed}
                <div class="tool-group-content">
                  <div class="tool-calls-list">
                    {#each msg.toolCalls as tool, idx}
                      {@const key = `${msg.id}-tool-${idx}`}
                      {@const isExpanded = expandedToolOutputs[key]}
                      {@const truncated = truncateToolOutput(tool.output || '', 200)}
                      <div class="tool-call-card">
                        <div class="tool-call-header">
                          <span class="tool-name">⚡ {tool.name}</span>
                          {#if tool.arguments?.path || tool.arguments?.filepath || tool.arguments?.file}
                            <span class="tool-arg">{tool.arguments.path || tool.arguments.filepath || tool.arguments.file}</span>
                          {:else if tool.arguments?.command}
                            <span class="tool-arg">{tool.arguments.command}</span>
                          {/if}
                          {#if tool.status === 'completed'}
                            <span class="tool-badge-completed">✓ Selesai</span>
                          {:else if tool.status === 'failed'}
                            <span class="tool-badge-failed">✕ Gagal</span>
                          {:else if tool.status === 'running'}
                            <span class="tool-badge-running">Berjalan...</span>
                          {/if}
                        </div>
                        {#if tool.output}
                          <div class="tool-output">
                            <pre>{isExpanded ? tool.output : truncated.text}</pre>
                            {#if truncated.isTruncated}
                              <button class="expand-tool-btn" onclick={() => toggleToolOutput(key)}>
                                {isExpanded ? 'Sembunyikan' : 'Tampilkan seluruh output'}
                              </button>
                            {/if}
                          </div>
                        {/if}
                      </div>
                    {/each}
                  </div>
                </div>
              {/if}
            </div>
          {/if}
        </div>
      </div>
    {/each}

    <!-- Live Streaming Bubble -->
    {#if isBusy}
      <div class="message-row agent-row live-generating">
        <div class="message-bubble agent-bubble">
          <div class="message-bubble-header">
            <div class="message-role-label">
              {activeSlot?.label || 'Agent'}
              {#if agentsStore.activeThought}
                <span class="typing-thought">💭 {agentsStore.activeThought}</span>
              {:else}
                <span class="typing-indicator">sedang berpikir...</span>
              {/if}
            </div>
            {#if agentsStore.streamingContent}
              <button
                type="button"
                class="bubble-copy-btn"
                class:copied={copiedBubbleId === 'live-stream'}
                title={copiedBubbleId === 'live-stream' ? 'Tersalin!' : 'Salin pesan'}
                onclick={() => handleCopyBubble('live-stream', agentsStore.streamingContent)}
              >
                {copiedBubbleId === 'live-stream' ? '✓ Tersalin!' : '📋 Salin'}
              </button>
            {/if}
          </div>

          <!-- Active tool calls during streaming -->
          {#if agentsStore.activeToolCalls.length > 0}
            {@const separated = separateStreamingToolCalls(agentsStore.activeToolCalls)}
            <div class="tool-streaming-container">
              {#if separated.completedTools.length > 0}
                {@const liveGroupId = 'live-stream-tools'}
                {@const isCollapsed = isGroupCollapsed(liveGroupId)}
                <div class="tool-group-accordion live-accordion">
                  <button
                    type="button"
                    class="tool-group-header"
                    onclick={() => toggleGroup(liveGroupId)}
                    aria-expanded={!isCollapsed}
                  >
                    <span class="tool-group-title">
                      ⚙️ {separated.completedTools.length} tindakan alat selesai ({formatToolGroupSummary(separated.completedTools)})
                    </span>
                    <span class="tool-group-arrow">{isCollapsed ? '▶' : '▼'}</span>
                  </button>
                  {#if !isCollapsed}
                    <div class="tool-group-content">
                      <div class="tool-calls-list">
                        {#each separated.completedTools as tool, idx}
                          {@const key = `live-tool-${idx}`}
                          {@const isExpanded = expandedToolOutputs[key]}
                          {@const truncated = truncateToolOutput(tool.output || '', 200)}
                          <div class="tool-call-card">
                            <div class="tool-call-header">
                              <span class="tool-name">⚡ {tool.name}</span>
                              {#if tool.arguments?.path || tool.arguments?.filepath || tool.arguments?.file}
                                <span class="tool-arg">{tool.arguments.path || tool.arguments.filepath || tool.arguments.file}</span>
                              {:else if tool.arguments?.command}
                                <span class="tool-arg">{tool.arguments.command}</span>
                              {/if}
                              {#if tool.status === 'completed'}
                                <span class="tool-badge-completed">✓ Selesai</span>
                              {:else if tool.status === 'failed'}
                                <span class="tool-badge-failed">✕ Gagal</span>
                              {:else}
                                <span class="tool-badge-running">Berjalan...</span>
                              {/if}
                            </div>
                            {#if tool.output}
                              <div class="tool-output">
                                <pre>{isExpanded ? tool.output : truncated.text}</pre>
                                {#if truncated.isTruncated}
                                  <button class="expand-tool-btn" onclick={() => toggleToolOutput(key)}>
                                    {isExpanded ? 'Sembunyikan' : 'Tampilkan seluruh output'}
                                  </button>
                                {/if}
                              </div>
                            {/if}
                          </div>
                        {/each}
                      </div>
                    </div>
                  {/if}
                </div>
              {/if}

              {#if separated.activeRunningTool}
                <div class="tool-call-card live">
                  <div class="tool-call-header">
                    <span class="tool-name">⚡ {separated.activeRunningTool.name}</span>
                    {#if separated.activeRunningTool.arguments?.path || separated.activeRunningTool.arguments?.filepath || separated.activeRunningTool.arguments?.file}
                      <span class="tool-arg">{separated.activeRunningTool.arguments.path || separated.activeRunningTool.arguments.filepath || separated.activeRunningTool.arguments.file}</span>
                    {:else if separated.activeRunningTool.arguments?.command}
                      <span class="tool-arg">{separated.activeRunningTool.arguments.command}</span>
                    {/if}
                    <span class="tool-badge-running">Berjalan...</span>
                  </div>
                </div>
              {/if}
            </div>
          {/if}

          <div class="message-body chat-markdown">
            {#if agentsStore.streamingContent}
              {@html renderChatMarkdown(agentsStore.streamingContent)}
            {:else}
              <div class="investigating-indicator">
                <span class="investigating-spinner"></span>
                <span class="status-placeholder">Sedang menginvestigasi kode proyek...</span>
              </div>
            {/if}
            <span class="cursor-blink">▌</span>
          </div>
        </div>
      </div>
    {/if}

    <!-- Permission Ask Card (in-chat confirmation) -->
    {#if pendingPerm}
      <div class="perm-card-container">
        <div class="perm-card">
          <div class="perm-header">
            <span class="perm-icon">⚠️</span>
            <span class="perm-title">Permintaan Persetujuan Eksekusi</span>
          </div>
          <div class="perm-content">
            <div class="perm-row">
              <span class="perm-label">Alat/Perintah:</span>
              <code class="perm-val">{pendingPerm.toolCall?.name || 'terminal'}</code>
            </div>
            {#if pendingPerm.toolCall?.command || pendingPerm.toolCall?.args?.command}
              <div class="perm-row">
                <span class="perm-label">Command:</span>
                <code class="perm-code">{pendingPerm.toolCall?.command || pendingPerm.toolCall?.args?.command}</code>
              </div>
            {/if}
            {#if pendingPerm.toolCall?.reason}
              <div class="perm-reason">
                "{pendingPerm.toolCall.reason}"
              </div>
            {/if}
          </div>
          <div class="perm-actions">
            <button class="perm-btn reject" onclick={() => agentsStore.respondPermission(pendingPerm.requestId, false)}>
              ✕ Tolak
            </button>
            <button class="perm-btn approve" onclick={() => agentsStore.respondPermission(pendingPerm.requestId, true)}>
              ✓ Izinkan Eksekusi
            </button>
          </div>
        </div>
      </div>
    {/if}

    <!-- ACP Permission Approval Dialog Modal -->
    <PermissionModal />

    <!-- Interactive Self-Healing Loop Verification Status -->
    {#if selfHealStatus && selfHealStatus.status !== 'idle'}
      <div class="self-heal-status-banner {selfHealInfo.cssClass}">
        <div class="status-banner-content">
          <span class="status-banner-icon">{selfHealInfo.icon}</span>
          <span class="status-banner-text">{selfHealInfo.label}</span>
          {#if selfHealStatus.active_file}
            <code class="status-banner-file">{selfHealStatus.active_file}</code>
          {/if}
        </div>
        {#if selfHealStatus.status === 'failed' || selfHealStatus.status === 'paused'}
          <div class="status-banner-actions">
            <button
              type="button"
              class="self-heal-retry-btn"
              onclick={() => {
                if (activeSlot) {
                  api.agentTriggerSelfHeal(activeSlot.id, selfHealStatus?.active_file || 'lib/main.dart').then(() => checkSelfHealStatus());
                }
              }}
            >
              🔄 Retry Self-Heal
            </button>
          </div>
        {/if}
      </div>
    {/if}

    <!-- Interactive ACP Watchdog Recovery Alert Banner / Status Chip -->
    {#if showWatchdogBanner && watchdogRecoveryText}
      <div class="watchdog-recovery-banner" role="alert">
        <div class="status-banner-content">
          <span class="status-banner-icon">⚠️</span>
          <span class="status-banner-text">{watchdogRecoveryText}</span>
        </div>
        <div class="status-banner-actions">
          <button
            type="button"
            class="watchdog-btn watchdog-continue-btn"
            onclick={handleWatchdogContinue}
            title="Lanjutkan tugas agen"
          >
            Lanjutkan (Continue)
          </button>
          <button
            type="button"
            class="watchdog-btn watchdog-resend-btn"
            onclick={handleWatchdogResend}
            title="Kirim ulang instruksi sebelumnya"
          >
            Kirim Ulang
          </button>
          <button
            type="button"
            class="watchdog-btn-dismiss"
            onclick={dismissWatchdogAlert}
            title="Tutup notifikasi pemulihan"
          >
            ✕
          </button>
        </div>
      </div>
    {/if}
  </div>

  <!-- Floating Context Composer with Interactive Context Pills -->
  <div class="agent-composer-container chat-input-box">
    {#if isContextPickerOpen}
      <div class="context-picker-popup">
        <div class="context-picker-header">
          <span class="context-picker-title">Lampirkan Konteks (@Context):</span>
          <button type="button" class="close-picker-btn" onclick={() => (isContextPickerOpen = false)}>✕</button>
        </div>

        {#if tabsManager.activeTab}
          <button type="button" class="context-option-btn highlight" onclick={selectActiveTabContext}>
            📄 Berkas Aktif: <strong>{tabsManager.activeTab.name}</strong>
          </button>
        {/if}

        <div class="file-search-wrap">
          <input
            type="text"
            class="context-file-search"
            placeholder="Cari & tag berkas proyek..."
            bind:value={fileSearchQuery}
            oninput={(e) => handleFileSearch((e.target as HTMLInputElement).value)}
          />
        </div>

        {#if fileSearchResults.length > 0}
          <div class="file-search-list">
            {#each fileSearchResults as fPath}
              <button type="button" class="context-file-item" onclick={() => tagSpecificFile(fPath)}>
                <span class="file-item-name">{fPath.split('/').pop()}</span>
                <span class="file-item-path">{fPath}</span>
              </button>
            {/each}
          </div>
        {/if}

        <div class="context-divider"></div>

        <button type="button" class="context-option-btn" onclick={() => selectContext('git')}>
          🔀 Git Staging & Diffs (@git:diff)
        </button>
        <button type="button" class="context-option-btn" onclick={() => selectContext('status')}>
          📊 Hierarki Proyek & Status (@context:project)
        </button>
      </div>
    {/if}

    {#if agentsStore.attachedReference}
      <div class="attached-ref-chip">
        <span class="ref-icon">📌</span>
        <span class="ref-loc">
          {agentsStore.attachedReference.path.split('/').pop()}{agentsStore.attachedReference.line ? `:${agentsStore.attachedReference.line}` : ''}
        </span>
        {#if agentsStore.attachedReference.symbol}
          <span class="ref-sym">({agentsStore.attachedReference.symbol})</span>
        {/if}
        <button type="button" class="ref-close" onclick={() => agentsStore.clearAttachedReference()} title="Hapus referensi">✕</button>
      </div>
    {/if}

    <!-- In-line @ Mention Autocomplete Popup -->
    {#if isMentionPopupOpen && mentionResults.length > 0}
      <div class="mention-autocomplete-popup" role="listbox">
        <div class="mention-popup-header">
          <span class="mention-popup-title">Pilih berkas untuk di-tag:</span>
          <span class="mention-popup-hint">↑↓ pilih · ⏎ / Tab sisipkan · Esc</span>
        </div>
        <div class="mention-popup-list">
          {#each mentionResults as item, idx}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <div
              class="mention-item"
              class:is-selected={idx === mentionSelectedIndex}
              role="option"
              aria-selected={idx === mentionSelectedIndex}
              tabindex="-1"
              onclick={() => applyMention(item)}
              onmouseenter={() => (mentionSelectedIndex = idx)}
            >
              <span class="mention-item-icon">{item.isTab ? '📄' : '📁'}</span>
              <div class="mention-item-text">
                <span class="mention-item-name">{item.name}</span>
                <span class="mention-item-path">{item.path}</span>
              </div>
              {#if item.isTab}
                <span class="mention-tab-badge">tab aktif</span>
              {/if}
            </div>
          {/each}
        </div>
      </div>
    {/if}

    <!-- Rich File Reference Chips -->
    {#if fileReferences.length > 0}
      <div class="composer-file-chips">
        {#each fileReferences as ref, idx (ref.path + (ref.line || ''))}
          <div class="composer-file-chip" title={ref.path}>
            <span class="chip-icon">{ref.isDir ? '📁' : '📄'}</span>
            <span class="chip-name">{ref.name}{ref.line ? `:${ref.line}${ref.endLine && ref.endLine !== ref.line ? `-${ref.endLine}` : ''}` : ''}</span>
            <button
              type="button"
              class="chip-remove-btn"
              onclick={() => removeFileReference(idx)}
              title="Hapus referensi berkas"
            >
              ✕
            </button>
          </div>
        {/each}
      </div>
    {/if}

    <div class="composer-textarea-wrap">
      <textarea
        bind:this={textareaEl}
        bind:value={promptText}
        oninput={handleTextareaInput}
        onkeydown={handleKeydown}
        class="composer-textarea"
        placeholder="Tanyakan sesuatu atau ketik @ untuk tag berkas… (Enter kirim, Shift+Enter baris baru)"
        disabled={isBusy}
        rows="2"
      ></textarea>
    </div>

    <!-- Context Pills Row: @Context, Permission, Ponytail, Caveman -->
    <div class="composer-pills-row">
      <div class="pills-left">
        <!-- @Context Pill -->
        <button
          type="button"
          class="context-pill context-picker-pill"
          class:active={attachedContextLabel !== null}
          onclick={handleToggleContextPicker}
          title="Lampirkan konteks Berkas & Git"
        >
          <span class="pill-at">@</span>
          <span class="pill-label">{attachedContextLabel ? `Context (${attachedContextLabel})` : 'Context'}</span>
        </button>

        <!-- Smart Context Pill: ⚡ Pruned (~70% token saved) -->
        {#if prunedContext && settingsStore.lspContextPruning}
          <div class="smart-context-pill-wrap">
            <button
              type="button"
              class="context-pill smart-context-pill active"
              onclick={() => (isPrunedPopoverOpen = !isPrunedPopoverOpen)}
              title={`LSP Context Pruned: ${prunedContext.prunedLines}/${prunedContext.totalLines} baris (${prunedContext.estimatedTokensSaved} token dihemat). Klik untuk ringkasan.`}
            >
              <span>{formatTokenSavingsPill(prunedContext)}</span>
            </button>
            {#if isPrunedPopoverOpen}
              <div class="pruned-summary-popover">
                <div class="popover-header">
                  <span class="popover-title">{formatTokenSavingsPill(prunedContext)}</span>
                  <button type="button" class="close-picker-btn" onclick={() => (isPrunedPopoverOpen = false)}>✕</button>
                </div>
                <div class="popover-meta">
                  <span>📄 {prunedContext.filePath}</span>
                  <span>⚡ Hemat ~{prunedContext.estimatedTokensSaved} token ({prunedContext.prunedLines}/{prunedContext.totalLines} baris)</span>
                </div>
                {#if prunedContext.compactSummary}
                  <div class="popover-summary">{prunedContext.compactSummary}</div>
                {/if}
              </div>
            {/if}
          </div>
        {:else if isPruning}
          <span class="context-pill smart-context-pill pruning-loading" title="Sedang memangkas konteks berkas...">
            <span>⚡ Pruning…</span>
          </span>
        {/if}

        <!-- Permission Pill (Read, Ask, Auto, Full) -->
        <div class="permission-pill-wrap">
          <select
            class="permission-pill-select"
            class:perm-read={activePermission === 'read'}
            class:perm-ask={activePermission === 'ask'}
            class:perm-auto={activePermission === 'auto'}
            class:perm-full={activePermission === 'full'}
            value={activePermission}
            onchange={handlePermissionChange}
            aria-label="Permission Pill"
            title="Tingkat izin eksekusi aksi agen: Read, Ask, Auto, Full"
          >
            <option value="read">Read</option>
            <option value="ask">Ask</option>
            <option value="auto">Auto</option>
            <option value="full">Full</option>
          </select>
        </div>

        <!-- Discipline Pills: Ponytail: ON/OFF and Caveman: ON/OFF -->
        <button
          type="button"
          class="context-pill ponytail"
          class:active={agentsStore.isPonytailActive}
          onclick={() => agentsStore.togglePonytail()}
          title="Disiplin Ponytail: Solusi minimalis, reuse code, diff terpendek"
        >
          <span>Ponytail: {agentsStore.isPonytailActive ? 'ON' : 'OFF'}</span>
        </button>

        <button
          type="button"
          class="context-pill caveman"
          class:active={agentsStore.isCavemanActive}
          onclick={() => agentsStore.toggleCaveman()}
          title="Disiplin Caveman: Komunikasi teknis lugas tanpa basa-basi"
        >
          <span>Caveman: {agentsStore.isCavemanActive ? 'ON' : 'OFF'}</span>
        </button>

        <button
          type="button"
          class="context-pill self-improve"
          class:active={agentsStore.isSelfImproveActive}
          onclick={() => agentsStore.toggleSelfImprove()}
          title="Self-Improve: Injeksi memory Obsidian & auto-catat lessons learned"
        >
          <span>Self-Improve: {agentsStore.isSelfImproveActive ? 'ON' : 'OFF'}</span>
        </button>

        <!-- MCP Context Pill: MCP (N) or MCP (Off) -->
        <button
          type="button"
          class="context-pill mcp"
          class:active={mcpStore.activeCount > 0}
          onclick={() => settingsStore.open('mcp')}
          title={`Model Context Protocol: ${mcpStore.activeCount} server aktif. Klik untuk buka pengaturan MCP.`}
        >
          <span>{formatMcpPillLabel(mcpStore.activeCount)}</span>
        </button>

        <!-- Self-Heal Context Pill: 🔄 Self-Heal: Auto (Hot Reload + Test) -->
        <button
          type="button"
          class="context-pill self-heal"
          class:active={isSelfHealActive}
          onclick={toggleSelfHeal}
          title="Self-Healing Loop: Otomatis Hot Reload dan Maestro verification flow setelah patch code"
        >
          <span>{isSelfHealActive ? '🔄 Self-Heal: Auto (Hot Reload + Test)' : '🔄 Self-Heal: OFF'}</span>
        </button>

        <!-- Custom Skills Context Pills (Render ONLY active custom skills to prevent badge flood) -->
        {#each skillsStore.skills.filter((s) => !s.isCore && s.name !== 'ponytail' && s.name !== 'caveman' && skillsStore.activeCustomSkills.includes(s.name)) as skill}
          <button
            type="button"
            class="context-pill custom-skill active"
            onclick={() => skillsStore.toggleSkill(skill.name)}
            title={`Skill ${skill.name}: ${skill.description || 'Klik untuk nonaktifkan'}`}
          >
            <span>{skill.name}: ON</span>
            <span class="pill-remove-x">✕</span>
          </button>
        {/each}

        <!-- Add / Toggle Skill Popover Trigger -->
        <div class="skill-picker-anchor">
          <button
            type="button"
            class="context-pill add-skill-pill"
            class:active={isSkillPickerOpen}
            onclick={() => (isSkillPickerOpen = !isSkillPickerOpen)}
            title="Aktifkan atau pilih skill tambahan untuk percakapan ini"
          >
            <span>+ Skill ▾</span>
          </button>

          {#if isSkillPickerOpen}
            <div class="skill-picker-popover" role="dialog" aria-label="Pilih Skills">
              <div class="picker-header">
                <span class="picker-title">Skills Tersedia ({skillsStore.skills.filter((s) => !s.isCore && s.name !== 'ponytail' && s.name !== 'caveman').length})</span>
                <button type="button" class="close-picker-btn" onclick={() => (isSkillPickerOpen = false)}>✕</button>
              </div>
              <input
                type="text"
                class="skill-search-input"
                placeholder="Cari nama skill..."
                bind:value={skillSearch}
              />
              <div class="skills-picker-list">
                {#each skillsStore.skills.filter((s) => !s.isCore && s.name !== 'ponytail' && s.name !== 'caveman' && (!skillSearch || s.name.toLowerCase().includes(skillSearch.toLowerCase()))) as skill}
                  <label class="skill-picker-item">
                    <input
                      type="checkbox"
                      checked={skillsStore.activeCustomSkills.includes(skill.name)}
                      onchange={() => skillsStore.toggleSkill(skill.name)}
                    />
                    <div class="skill-item-info">
                      <span class="skill-item-name">{skill.name}</span>
                      {#if skill.description}
                        <span class="skill-item-desc">{skill.description}</span>
                      {/if}
                    </div>
                  </label>
                {/each}
              </div>
              <div class="picker-footer">
                <button type="button" class="manage-skills-link" onclick={() => { isSkillPickerOpen = false; settingsStore.open('agents'); }}>
                  ⚙️ Kelola & Tambah Skill di Settings
                </button>
              </div>
            </div>
          {/if}
        </div>
      </div>

      <div class="pills-right">
        {#if isBusy}
          <button type="button" class="cancel-prompt-btn" onclick={() => agentsStore.cancelActivePrompt()} title="Batalkan prompt aktif">
            ⏹ Stop
          </button>
        {:else}
          <button
            type="button"
            class="send-prompt-btn"
            onclick={handleSubmit}
            disabled={!promptText.trim() && fileReferences.length === 0}
            title="Kirim instruksi ke agen"
          >
            ➤
          </button>
        {/if}
      </div>
    </div>
  </div>
</div>

<style>
  .agent-chat-wrapper {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    background: #141518;
  }

  .chat-messages {
    flex: 1;
    overflow-y: auto;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    user-select: text !important;
    -webkit-user-select: text !important;
    cursor: text;
  }

  .empty-chat-welcome {
    margin: auto;
    text-align: center;
    padding: 24px 16px;
    max-width: 320px;
  }

  .welcome-icon {
    font-size: 28px;
    margin-bottom: 8px;
  }

  .welcome-title {
    font-size: 14px;
    font-weight: 600;
    color: #e6edf3;
    margin-bottom: 4px;
  }

  .welcome-desc {
    font-size: 11px;
    color: #8b949e;
    margin-bottom: 16px;
  }

  .welcome-desc code {
    background: #1f2228;
    padding: 2px 4px;
    border-radius: 3px;
    color: #c9cdd4;
  }

  .quick-prompts {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .quick-prompt-btn {
    background: #18191f;
    border: 1px solid #282a33;
    border-radius: 6px;
    padding: 8px 10px;
    color: #c9cdd4;
    font-size: 11.5px;
    text-align: left;
    cursor: pointer;
    transition: all 0.12s;
  }

  .quick-prompt-btn:hover {
    background: #20232c;
    border-color: #3b82f6;
    color: #f1f2f4;
  }

  .message-row {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
  }

  .message-row.user-row {
    align-items: flex-end;
  }

  .message-bubble {
    max-width: 95%;
    border-radius: 8px;
    padding: 8px 12px;
    font-size: 12px;
    line-height: 1.45;
    position: relative;
    user-select: text !important;
    -webkit-user-select: text !important;
    cursor: text;
    box-sizing: border-box;
    overflow-wrap: break-word;
    word-break: break-word;
    overflow: hidden;
  }

  .message-bubble pre,
  .message-bubble :global(pre) {
    max-width: 100%;
    overflow-x: auto;
    box-sizing: border-box;
  }

  .message-bubble code,
  .message-bubble :global(code) {
    max-width: 100%;
    overflow-x: auto;
    box-sizing: border-box;
  }

  .user-bubble {
    background: #1e293b;
    border: 1px solid #334155;
    color: #f8fafc;
    user-select: text !important;
    -webkit-user-select: text !important;
    cursor: text;
  }

  .agent-bubble {
    background: #16181d;
    border: 1px solid rgba(255, 255, 255, 0.07);
    color: #e2e8f0;
    user-select: text !important;
    -webkit-user-select: text !important;
    cursor: text;
  }

  .system-bubble {
    background: #1c1917;
    border: 1px solid #44403c;
    color: #d6d3d1;
    font-style: italic;
  }

  .message-bubble-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 4px;
    position: relative;
    user-select: none;
    -webkit-user-select: none;
  }

  .bubble-copy-btn {
    opacity: 0;
    pointer-events: none;
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 4px;
    padding: 2px 6px;
    font-size: 10px;
    color: #94a3b8;
    cursor: pointer;
    transition: all 0.15s ease-in-out;
    display: inline-flex;
    align-items: center;
    gap: 3px;
    user-select: none;
    -webkit-user-select: none;
  }

  .message-bubble:hover .bubble-copy-btn,
  .bubble-copy-btn.copied {
    opacity: 1;
    pointer-events: auto;
  }

  .bubble-copy-btn:hover {
    background: rgba(255, 255, 255, 0.16);
    color: #f8fafc;
  }

  .bubble-copy-btn.copied {
    color: #34d399;
    border-color: rgba(52, 211, 153, 0.3);
    background: rgba(52, 211, 153, 0.1);
  }

  .message-role-label {
    font-size: 10px;
    font-weight: 600;
    color: #8b949e;
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .message-body {
    word-break: break-word;
    font-size: 12px;
    line-height: 1.55;
    color: #e2e8f0;
    user-select: text !important;
    -webkit-user-select: text !important;
    cursor: text;
  }

  .message-body :global(p) {
    margin: 0 0 6px 0;
  }

  .message-body :global(p:last-child) {
    margin-bottom: 0;
  }

  .message-body :global(ul), .message-body :global(ol) {
    margin: 4px 0 6px 0;
    padding-left: 18px;
  }

  .message-body :global(li) {
    margin-bottom: 2px;
  }

  .message-body :global(code) {
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    font-size: 11px;
    background: rgba(255, 255, 255, 0.08);
    padding: 1px 4px;
    border-radius: 3px;
    color: #38bdf8;
    user-select: text !important;
    -webkit-user-select: text !important;
    cursor: text;
  }

  .message-body :global(.chat-code-wrapper) {
    margin: 8px 0;
    background: #0d0e12;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 6px;
    overflow: hidden;
  }

  .message-body :global(.chat-code-header) {
    display: flex;
    justify-content: space-between;
    align-items: center;
    background: rgba(255, 255, 255, 0.03);
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    padding: 2px 8px;
    user-select: none;
    -webkit-user-select: none;
  }

  .message-body :global(.code-copy-btn) {
    opacity: 0;
    pointer-events: none;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 4px;
    padding: 1px 6px;
    font-size: 10px;
    color: #94a3b8;
    cursor: pointer;
    transition: all 0.15s ease-in-out;
    display: inline-flex;
    align-items: center;
    gap: 3px;
    user-select: none;
    -webkit-user-select: none;
  }

  .message-body :global(.chat-code-wrapper:hover .code-copy-btn),
  .message-body :global(.code-copy-btn.copied) {
    opacity: 1;
    pointer-events: auto;
  }

  .message-body :global(.code-copy-btn:hover) {
    background: rgba(255, 255, 255, 0.14);
    color: #f8fafc;
  }

  .message-body :global(.code-copy-btn.copied) {
    color: #34d399;
    border-color: rgba(52, 211, 153, 0.3);
    background: rgba(52, 211, 153, 0.1);
  }

  .message-body :global(.chat-code-lang) {
    font-size: 10px;
    color: #8b949e;
    text-transform: lowercase;
    font-family: 'JetBrains Mono', ui-monospace, monospace;
  }

  .message-body :global(pre.chat-code-block),
  .message-body :global(pre) {
    margin: 0;
    padding: 8px 10px;
    background: transparent;
    overflow-x: auto;
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    font-size: 11px;
    line-height: 1.45;
    user-select: text !important;
    -webkit-user-select: text !important;
    cursor: text;
  }

  .message-body :global(pre.chat-code-block code) {
    background: none;
    padding: 0;
    border-radius: 0;
    color: #f1f2f4;
  }

  .message-body :global(strong) {
    font-weight: 600;
    color: #ffffff;
  }

  .message-body :global(em) {
    font-style: italic;
    color: #cbd5e1;
  }

  .message-body :global(.chat-heading) {
    color: #ffffff;
    font-weight: 700;
    margin: 10px 0 4px 0;
  }

  .message-body :global(.chat-h1) { font-size: 14px; }
  .message-body :global(.chat-h2) { font-size: 13px; }
  .message-body :global(.chat-h3) { font-size: 12.5px; }
  .message-body :global(.chat-h4) { font-size: 12px; }

  .message-body :global(.chat-quote) {
    margin: 6px 0;
    padding-left: 8px;
    border-left: 2px solid #3b82f6;
    color: #94a3b8;
    font-style: italic;
  }

  .message-body :global(.chat-link) {
    color: #58a6ff;
    text-decoration: underline;
  }

  .typing-thought {
    color: #a78bfa;
    font-size: 10.5px;
    font-style: italic;
    margin-left: 4px;
  }

  .tool-badge-completed {
    font-size: 10px;
    color: #4ade80;
    margin-left: auto;
    flex-shrink: 0;
  }

  .tool-badge-failed {
    font-size: 10px;
    color: #f87171;
    margin-left: auto;
    flex-shrink: 0;
  }

  .tool-badge-running {
    font-size: 10px;
    color: #38bdf8;
    margin-left: auto;
    flex-shrink: 0;
  }

  .status-placeholder {
    color: #8b949e;
    font-style: italic;
  }

  .investigating-indicator {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  .investigating-spinner {
    width: 11px;
    height: 11px;
    border: 2px solid rgba(59, 130, 246, 0.25);
    border-top-color: #3b82f6;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
    display: inline-block;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .live-generating .agent-bubble {
    border-color: rgba(59, 130, 246, 0.35);
  }

  .typing-indicator {
    color: #3b82f6;
    font-weight: normal;
    font-style: italic;
  }

  .cursor-blink {
    animation: blink 1s infinite;
    color: #3b82f6;
  }

  @keyframes blink {
    0%, 50% { opacity: 1; }
    51%, 100% { opacity: 0; }
  }

  .tool-group-accordion {
    margin-top: 6px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 6px;
    background: #111216;
    overflow: hidden;
  }

  .tool-group-header {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 6px 10px;
    background: rgba(255, 255, 255, 0.03);
    border: none;
    color: #cbd5e1;
    font-size: 11px;
    font-weight: 500;
    cursor: pointer;
    text-align: left;
    transition: background 0.15s ease;
  }

  .tool-group-header:hover {
    background: rgba(255, 255, 255, 0.06);
    color: #f1f5f9;
  }

  .tool-group-title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
    flex: 1;
  }

  .tool-group-arrow {
    color: #94a3b8;
    font-size: 9px;
    flex-shrink: 0;
  }

  .tool-group-content {
    padding: 6px 8px 8px;
    border-top: 1px solid rgba(255, 255, 255, 0.05);
    background: #0d0e11;
  }

  .tool-streaming-container {
    margin-top: 8px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .tool-calls-list {
    margin-top: 8px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .tool-call-card {
    background: #0f1013;
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 5px;
    padding: 6px 8px;
    font-size: 11px;
    box-sizing: border-box;
    max-width: 100%;
    overflow: hidden;
  }

  .tool-call-header {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    width: 100%;
    color: #f59e0b;
    font-weight: 600;
  }

  .tool-arg {
    color: #94a3b8;
    font-family: monospace;
    font-size: 10px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
    min-width: 0;
  }

  .tool-output {
    margin-top: 4px;
  }

  .tool-output pre {
    margin: 0;
    background: #090a0c;
    border-radius: 3px;
    padding: 4px 6px;
    font-family: monospace;
    font-size: 10px;
    color: #94a3b8;
    overflow-x: auto;
    white-space: pre-wrap;
    word-break: break-all;
  }

  .expand-tool-btn {
    margin-top: 3px;
    background: transparent;
    border: none;
    color: #3b82f6;
    font-size: 10px;
    cursor: pointer;
    padding: 0;
  }

  /* Permission Card in-chat */
  .perm-card-container {
    margin: 8px 0;
  }

  .perm-card {
    background: #231b15;
    border: 1px solid #78350f;
    border-radius: 8px;
    padding: 10px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .perm-header {
    display: flex;
    align-items: center;
    gap: 6px;
    color: #f59e0b;
    font-weight: 600;
    font-size: 12px;
  }

  .perm-content {
    font-size: 11px;
    color: #e2e8f0;
  }

  .perm-row {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 2px 0;
  }

  .perm-label {
    color: #94a3b8;
  }

  .perm-code {
    background: #18191f;
    padding: 2px 5px;
    border-radius: 3px;
    font-family: monospace;
    color: #60a5fa;
  }

  .perm-reason {
    font-style: italic;
    color: #cbd5e1;
    margin-top: 4px;
  }

  .perm-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 6px;
  }

  .perm-btn {
    padding: 4px 10px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    border: none;
  }

  .perm-btn.reject {
    background: #3f1819;
    color: #f87171;
    border: 1px solid #991b1b;
  }

  .perm-btn.approve {
    background: #143522;
    color: #4ade80;
    border: 1px solid #166534;
  }

  /* Floating Context Composer */
  .agent-composer-container {
    position: relative;
    border-top: 1px solid rgba(255, 255, 255, 0.06);
    background: #121317;
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
  }

  .composer-textarea-wrap {
    padding: 6px 8px 0;
  }

  .composer-textarea {
    width: 100%;
    background: transparent;
    border: none;
    color: #e6edf3;
    font-size: 12px;
    font-family: inherit;
    resize: none;
    outline: none;
    box-sizing: border-box;
    min-height: 48px;
    line-height: 1.4;
  }

  .composer-textarea::placeholder {
    color: #6e7681;
  }

  .composer-pills-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 5px 8px;
    background: rgba(0, 0, 0, 0.22);
    border-top: 1px solid rgba(255, 255, 255, 0.04);
    gap: 6px;
    min-height: 32px;
    overflow: hidden; /* overflow guard */
    box-sizing: border-box;
  }

  .pills-left {
    display: flex;
    align-items: center;
    gap: 5px;
    overflow-x: auto;
    scrollbar-width: none;
    flex-wrap: nowrap;
    min-width: 0;
    flex: 1 1 auto;
  }

  .pills-left::-webkit-scrollbar {
    display: none;
  }

  .context-pill {
    font-size: 10.5px;
    font-weight: 500;
    padding: 2px 7px;
    border-radius: 4px;
    background: #18191f;
    border: 1px solid rgba(255, 255, 255, 0.08);
    color: #9da1ad;
    display: inline-flex;
    align-items: center;
    gap: 3px;
    cursor: pointer;
    white-space: nowrap;
    transition: all 0.12s;
  }

  .context-pill:hover {
    background: #22242c;
    color: #f1f2f4;
    border-color: rgba(255, 255, 255, 0.16);
  }

  .context-pill.context-picker-pill {
    color: #60a5fa;
    border-color: rgba(96, 165, 250, 0.25);
  }

  .context-pill.context-picker-pill.active {
    background: rgba(59, 130, 246, 0.15);
    border-color: rgba(59, 130, 246, 0.4);
    color: #93c5fd;
    font-weight: 600;
  }

  .smart-context-pill-wrap {
    position: relative;
    display: inline-flex;
  }

  .context-pill.smart-context-pill {
    color: #facc15;
    border-color: rgba(250, 204, 21, 0.3);
    background: rgba(250, 204, 21, 0.08);
  }

  .context-pill.smart-context-pill:hover,
  .context-pill.smart-context-pill.active {
    color: #fef08a;
    border-color: rgba(250, 204, 21, 0.6);
    background: rgba(250, 204, 21, 0.18);
    font-weight: 600;
  }

  .context-pill.smart-context-pill.pruning-loading {
    color: #eab308;
    opacity: 0.8;
    cursor: wait;
  }

  .pruned-summary-popover {
    position: absolute;
    bottom: calc(100% + 6px);
    left: 0;
    width: 280px;
    background: #18191f;
    border: 1px solid rgba(250, 204, 21, 0.3);
    border-radius: var(--radius-sm, 6px);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
    padding: 10px;
    z-index: 100;
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 11px;
  }

  .pruned-summary-popover .popover-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-weight: 600;
    color: #fef08a;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    padding-bottom: 4px;
  }

  .pruned-summary-popover .popover-meta {
    display: flex;
    flex-direction: column;
    gap: 2px;
    color: var(--text-muted, #8b949e);
  }

  .pruned-summary-popover .popover-summary {
    color: var(--text-normal, #e6edf3);
    line-height: 1.4;
    background: rgba(255, 255, 255, 0.04);
    padding: 4px 6px;
    border-radius: 4px;
    max-height: 120px;
    overflow-y: auto;
  }

  .pill-at {
    color: #3b82f6;
    font-weight: 700;
  }

  .context-pill.ponytail {
    color: #8b949e;
    border-color: rgba(255, 255, 255, 0.08);
  }

  .context-pill.ponytail.active {
    color: #d8b4fe;
    border-color: rgba(192, 132, 252, 0.4);
    background: rgba(192, 132, 252, 0.15);
    font-weight: 600;
  }

  .context-pill.caveman {
    color: #8b949e;
    border-color: rgba(255, 255, 255, 0.08);
  }

  .context-pill.caveman.active {
    color: #fde047;
    border-color: rgba(250, 204, 21, 0.4);
    background: rgba(250, 204, 21, 0.15);
    font-weight: 600;
  }

  .context-pill.self-improve {
    color: #8b949e;
    border-color: rgba(255, 255, 255, 0.08);
  }

  .context-pill.self-improve.active {
    color: #34d399;
    border-color: rgba(52, 211, 153, 0.4);
    background: rgba(52, 211, 153, 0.15);
    font-weight: 600;
  }

  .context-pill.mcp {
    color: #8b949e;
    border-color: rgba(255, 255, 255, 0.08);
  }

  .context-pill.mcp.active {
    color: #60a5fa;
    border-color: rgba(96, 165, 250, 0.4);
    background: rgba(96, 165, 250, 0.15);
    font-weight: 600;
  }

  .context-pill.self-heal {
    color: #8b949e;
    border-color: rgba(255, 255, 255, 0.08);
  }

  .context-pill.self-heal.active {
    color: #38bdf8;
    border-color: rgba(56, 189, 248, 0.4);
    background: rgba(56, 189, 248, 0.15);
    font-weight: 600;
  }

  .self-heal-status-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin: 6px 12px;
    padding: 7px 12px;
    border-radius: 6px;
    font-size: 12px;
    font-family: 'JetBrains Mono', monospace;
    border: 1px solid rgba(255, 255, 255, 0.1);
    background: #181a1f;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
  }

  .status-banner-content {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .status-banner-icon {
    font-size: 13px;
  }

  .status-banner-text {
    font-weight: 500;
  }

  .status-banner-file {
    font-size: 11px;
    padding: 1px 5px;
    background: rgba(0, 0, 0, 0.3);
    border-radius: 3px;
    color: #94a3b8;
  }

  .status-banner-actions {
    display: flex;
    align-items: center;
  }

  .self-heal-retry-btn {
    padding: 3px 8px;
    border-radius: 4px;
    font-size: 11px;
    cursor: pointer;
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.15);
    color: #f1f5f9;
    font-weight: 500;
  }

  .self-heal-retry-btn:hover {
    background: rgba(255, 255, 255, 0.15);
  }

  .self-heal-status-banner.self-heal-hot-reloading {
    border-color: rgba(234, 179, 8, 0.4);
    background: rgba(234, 179, 8, 0.12);
    color: #facc15;
  }

  .self-heal-status-banner.self-heal-testing {
    border-color: rgba(56, 189, 248, 0.4);
    background: rgba(56, 189, 248, 0.12);
    color: #38bdf8;
  }

  .self-heal-status-banner.self-heal-passed {
    border-color: rgba(34, 197, 94, 0.4);
    background: rgba(34, 197, 94, 0.12);
    color: #4ade80;
  }

  .self-heal-status-banner.self-heal-failed {
    border-color: rgba(249, 115, 22, 0.4);
    background: rgba(249, 115, 22, 0.12);
    color: #fb923c;
  }

  .self-heal-status-banner.self-heal-paused {
    border-color: rgba(239, 68, 68, 0.4);
    background: rgba(239, 68, 68, 0.12);
    color: #f87171;
  }

  .watchdog-recovery-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin: 6px 12px;
    padding: 7px 12px;
    border-radius: 6px;
    font-size: 12px;
    font-family: 'JetBrains Mono', monospace;
    border: 1px solid rgba(245, 158, 11, 0.4);
    background: rgba(245, 158, 11, 0.12);
    color: #fbbf24;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
    gap: 8px;
    flex-wrap: wrap;
  }

  .watchdog-btn {
    padding: 3px 9px;
    border-radius: 4px;
    font-size: 11px;
    cursor: pointer;
    background: rgba(255, 255, 255, 0.1);
    border: 1px solid rgba(255, 255, 255, 0.2);
    color: #f1f5f9;
    font-weight: 500;
    transition: background 0.15s, border-color 0.15s;
  }

  .watchdog-btn:hover {
    background: rgba(255, 255, 255, 0.2);
    border-color: rgba(255, 255, 255, 0.3);
  }

  .watchdog-continue-btn {
    background: rgba(34, 197, 94, 0.2);
    border-color: rgba(34, 197, 94, 0.4);
    color: #86efac;
  }

  .watchdog-continue-btn:hover {
    background: rgba(34, 197, 94, 0.3);
    border-color: rgba(34, 197, 94, 0.5);
  }

  .watchdog-resend-btn {
    background: rgba(56, 189, 248, 0.2);
    border-color: rgba(56, 189, 248, 0.4);
    color: #7dd3fc;
  }

  .watchdog-resend-btn:hover {
    background: rgba(56, 189, 248, 0.3);
    border-color: rgba(56, 189, 248, 0.5);
  }

  .watchdog-btn-dismiss {
    padding: 2px 6px;
    margin-left: 4px;
    background: transparent;
    border: none;
    color: #94a3b8;
    cursor: pointer;
    font-size: 12px;
  }

  .watchdog-btn-dismiss:hover {
    color: #f1f5f9;
  }

  .context-pill.custom-skill {
    color: #8b949e;
    border-color: rgba(245, 158, 11, 0.25);
  }

  .context-pill.custom-skill.active {
    color: #f59e0b;
    border-color: rgba(245, 158, 11, 0.5);
    background: rgba(245, 158, 11, 0.15);
    font-weight: 600;
  }

  .context-pill.custom-skill.active {
    color: #38bdf8;
    border-color: rgba(56, 189, 248, 0.4);
    background: rgba(56, 189, 248, 0.12);
    font-weight: 600;
  }

  .pill-remove-x {
    font-size: 8px;
    opacity: 0.6;
    margin-left: 2px;
  }

  .pill-remove-x:hover {
    opacity: 1;
    color: #ef4444;
  }

  .skill-picker-anchor {
    position: relative;
    display: inline-flex;
  }

  .context-pill.add-skill-pill {
    color: #8b949e;
    border-color: rgba(255, 255, 255, 0.15);
    border-style: dashed;
  }

  .context-pill.add-skill-pill:hover,
  .context-pill.add-skill-pill.active {
    color: #a78bfa;
    border-color: rgba(167, 139, 250, 0.4);
    background: rgba(167, 139, 250, 0.1);
  }

  .skill-picker-popover {
    position: absolute;
    bottom: 30px;
    left: 0;
    width: 260px;
    max-height: 280px;
    background: #181920;
    border: 1px solid rgba(255, 255, 255, 0.14);
    border-radius: 8px;
    box-shadow: 0 12px 28px rgba(0, 0, 0, 0.65);
    z-index: 100;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .picker-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 7px 10px;
    background: #131418;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  }

  .picker-title {
    font-size: 11px;
    font-weight: 700;
    color: #94a3b8;
    text-transform: uppercase;
  }

  .close-picker-btn {
    background: transparent;
    border: none;
    color: #64748b;
    cursor: pointer;
    font-size: 11px;
    padding: 2px 4px;
  }

  .close-picker-btn:hover {
    color: #f1f5f9;
  }

  .skill-search-input {
    margin: 6px 8px;
    padding: 4px 8px;
    background: #101114;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 4px;
    color: #e2e8f0;
    font-size: 11px;
    outline: none;
  }

  .skill-search-input:focus {
    border-color: #3b82f6;
  }

  .skills-picker-list {
    overflow-y: auto;
    max-height: 180px;
    padding: 2px 6px 6px;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .skill-picker-item {
    display: flex;
    align-items: flex-start;
    gap: 7px;
    padding: 5px 6px;
    border-radius: 4px;
    cursor: pointer;
    background: #14151a;
    transition: background 0.1s;
  }

  .skill-picker-item:hover {
    background: #20222a;
  }

  .skill-picker-item input[type="checkbox"] {
    margin-top: 2px;
    cursor: pointer;
  }

  .skill-item-info {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .skill-item-name {
    font-size: 11px;
    color: #e2e8f0;
    font-weight: 600;
  }

  .skill-item-desc {
    font-size: 9.5px;
    color: #64748b;
    line-height: 1.3;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .picker-footer {
    padding: 6px 10px;
    background: #111216;
    border-top: 1px solid rgba(255, 255, 255, 0.06);
    text-align: center;
  }

  .manage-skills-link {
    background: transparent;
    border: none;
    color: #60a5fa;
    font-size: 10.5px;
    cursor: pointer;
    font-weight: 500;
  }

  .manage-skills-link:hover {
    text-decoration: underline;
  }

  .permission-pill-wrap {
    display: inline-flex;
  }

  .permission-pill-select {
    font-size: 10.5px;
    font-weight: 600;
    padding: 2px 6px;
    border-radius: 4px;
    background: #18191f;
    border: 1px solid rgba(255, 255, 255, 0.08);
    color: #9da1ad;
    outline: none;
    cursor: pointer;
  }

  .permission-pill-select.perm-read {
    color: #38bdf8;
    border-color: rgba(56, 189, 248, 0.3);
  }

  .permission-pill-select.perm-ask {
    color: #34d399;
    border-color: rgba(52, 211, 153, 0.3);
  }

  .permission-pill-select.perm-auto {
    color: #a78bfa;
    border-color: rgba(167, 139, 250, 0.3);
  }

  .permission-pill-select.perm-full {
    color: #f87171;
    border-color: rgba(248, 113, 113, 0.4);
    background: rgba(248, 113, 113, 0.1);
  }

  .pills-right {
    display: flex;
    align-items: center;
    padding-right: 4px; /* backward-compat guard for batch35 */
    padding-right: 6px;
    flex-shrink: 0;
  }

  .send-prompt-btn {
    width: 24px;
    height: 24px;
    border-radius: 4px;
    background: #3b82f6;
    color: white;
    border: none;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
    cursor: pointer;
    transition: background 0.12s;
  }

  .send-prompt-btn:hover {
    background: #2563eb;
  }

  .send-prompt-btn:disabled {
    opacity: 0.35;
    cursor: not-allowed;
    background: #1e293b;
  }

  .cancel-prompt-btn {
    height: 24px;
    padding: 0 8px;
    padding-right: 6px;
    margin-right: 2px;
    border-radius: 4px;
    background: #ef4444;
    color: white;
    border: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    font-size: 11px;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.12s;
    flex-shrink: 0;
    box-sizing: border-box;
  }

  .cancel-prompt-btn:hover {
    background: #dc2626;
  }

  .context-picker-popup {
    position: absolute;
    bottom: 100%;
    left: 8px;
    background: #18191f;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 6px;
    padding: 6px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    box-shadow: 0 8px 20px rgba(0, 0, 0, 0.5);
    z-index: 20;
    min-width: 180px;
  }

  .context-picker-title {
    font-size: 10px;
    font-weight: 600;
    color: #8b949e;
    margin-bottom: 2px;
    padding: 0 4px;
  }

  .context-option-btn {
    text-align: left;
    background: transparent;
    border: none;
    color: #e6edf3;
    font-size: 11px;
    padding: 4px 8px;
    border-radius: 4px;
    cursor: pointer;
  }

  .context-option-btn:hover {
    background: rgba(255, 255, 255, 0.08);
  }

  /* Attached Reference Chip */
  .attached-ref-chip {
    margin: 4px 8px 0;
    padding: 3px 8px;
    background: rgba(56, 189, 248, 0.12);
    border: 1px solid rgba(56, 189, 248, 0.35);
    border-radius: 4px;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    color: #38bdf8;
    max-width: fit-content;
  }

  .ref-icon {
    font-size: 11px;
  }

  .ref-loc {
    font-weight: 600;
    font-family: 'JetBrains Mono', monospace;
  }

  .ref-sym {
    color: #94a3b8;
    font-size: 10.5px;
  }

  .ref-close {
    background: transparent;
    border: none;
    color: #38bdf8;
    cursor: pointer;
    font-size: 10px;
    padding: 0 2px;
    margin-left: 4px;
  }

  .ref-close:hover {
    color: #ffffff;
  }

  /* Context Picker Popup Enhanced */
  .context-picker-popup {
    position: absolute;
    bottom: 100%;
    left: 8px;
    background: #18191f;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 6px;
    padding: 6px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.65);
    z-index: 20;
    min-width: 240px;
    max-width: 320px;
  }

  .context-picker-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 2px 4px;
  }

  .context-picker-title {
    font-size: 10.5px;
    font-weight: 600;
    color: #8b949e;
  }

  .context-option-btn.highlight {
    background: rgba(59, 130, 246, 0.12);
    border: 1px solid rgba(59, 130, 246, 0.3);
    color: #93c5fd;
  }

  .context-option-btn.highlight:hover {
    background: rgba(59, 130, 246, 0.22);
  }

  .file-search-wrap {
    margin: 3px 0;
  }

  .context-file-search {
    width: 100%;
    box-sizing: border-box;
    padding: 4px 7px;
    background: #101114;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 4px;
    color: #f1f2f4;
    font-size: 11px;
    outline: none;
  }

  .context-file-search:focus {
    border-color: #3b82f6;
  }

  .file-search-list {
    max-height: 140px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin-bottom: 3px;
  }

  .context-file-item {
    display: flex;
    flex-direction: column;
    text-align: left;
    background: #131418;
    border: 1px solid rgba(255, 255, 255, 0.05);
    border-radius: 4px;
    padding: 4px 6px;
    cursor: pointer;
  }

  .context-file-item:hover {
    background: #1e2027;
    border-color: #3b82f6;
  }

  .file-item-name {
    font-size: 11px;
    font-weight: 600;
    color: #e2e8f0;
  }

  .file-item-path {
    font-size: 9.5px;
    color: #64748b;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .context-divider {
    height: 1px;
    background: rgba(255, 255, 255, 0.06);
    margin: 2px 0;
  }

  /* Recent Chats Box in Welcome View */
  .recent-chats-box {
    margin-top: 16px;
    width: 100%;
    max-width: 380px;
    background: #14151a;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 8px;
    overflow: hidden;
  }

  .recent-chats-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 7px 10px;
    background: rgba(255, 255, 255, 0.02);
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  }

  .recent-chats-title {
    font-size: 11px;
    font-weight: 600;
    color: #94a3b8;
  }

  .recent-clear-btn {
    background: transparent;
    border: none;
    color: #64748b;
    font-size: 10px;
    cursor: pointer;
  }

  .recent-clear-btn:hover {
    color: #ef4444;
  }

  .recent-chats-scroll {
    max-height: 160px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
  }

  .recent-chat-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 10px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.03);
    cursor: pointer;
    transition: background 0.1s;
  }

  .recent-chat-row:hover {
    background: #1e2028;
  }

  .recent-chat-content {
    display: flex;
    flex-direction: column;
    min-width: 0;
    gap: 2px;
  }

  .recent-chat-title {
    font-size: 11px;
    color: #f1f2f4;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-weight: 500;
  }

  .recent-chat-meta {
    font-size: 9.5px;
    color: #64748b;
  }

  .recent-del-btn {
    background: transparent;
    border: none;
    cursor: pointer;
    font-size: 10px;
    opacity: 0.5;
    padding: 2px 4px;
    transition: opacity 0.1s;
  }

  .recent-del-btn:hover {
    opacity: 1;
  }

  /* In-line @ Mention Autocomplete Popup */
  .mention-autocomplete-popup {
    position: absolute;
    bottom: calc(100% + 4px);
    left: 8px;
    right: 8px;
    max-width: 360px;
    background: #16181f;
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 7px;
    box-shadow: 0 12px 30px rgba(0, 0, 0, 0.7);
    z-index: 100;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .mention-popup-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 10px;
    background: #121317;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  }

  .mention-popup-title {
    font-size: 10.5px;
    font-weight: 600;
    color: #94a3b8;
  }

  .mention-popup-hint {
    font-size: 9.5px;
    color: #64748b;
  }

  .mention-popup-list {
    max-height: 180px;
    overflow-y: auto;
    padding: 3px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .mention-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 8px;
    border-radius: 4px;
    cursor: pointer;
    transition: background 0.08s;
  }

  .mention-item:hover,
  .mention-item.is-selected {
    background: #252834;
  }

  .mention-item-icon {
    font-size: 12px;
    flex-shrink: 0;
  }

  .mention-item-text {
    display: flex;
    flex-direction: column;
    min-width: 0;
    flex: 1;
  }

  .mention-item-name {
    font-size: 11px;
    font-weight: 600;
    color: #f1f2f4;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .mention-item-path {
    font-size: 9.5px;
    color: #64748b;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .mention-tab-badge {
    font-size: 9px;
    padding: 1px 5px;
    border-radius: 3px;
    background: rgba(59, 130, 246, 0.15);
    color: #60a5fa;
    border: 1px solid rgba(59, 130, 246, 0.3);
    flex-shrink: 0;
  }

  /* Rich File Reference Chips in Composer & Chat Bubbles */
  .composer-file-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    padding: 6px 10px;
    background: rgba(255, 255, 255, 0.02);
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  }

  .composer-file-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    background: rgba(59, 130, 246, 0.12);
    border: 1px solid rgba(59, 130, 246, 0.25);
    border-radius: 4px;
    padding: 2px 6px;
    font-size: 11px;
    color: #93c5fd;
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    max-width: 100%;
  }

  .composer-file-chip .chip-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 240px;
  }

  .composer-file-chip .chip-remove-btn {
    background: transparent;
    border: none;
    color: #93c5fd;
    cursor: pointer;
    font-size: 10px;
    padding: 0 2px;
    line-height: 1;
    opacity: 0.7;
    transition: opacity 0.1s;
  }

  .composer-file-chip .chip-remove-btn:hover {
    opacity: 1;
    color: #ef4444;
  }

  .bubble-file-pills {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-bottom: 6px;
  }

  .bubble-file-pill {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    background: rgba(59, 130, 246, 0.12);
    border: 1px solid rgba(59, 130, 246, 0.25);
    border-radius: 4px;
    padding: 2px 6px;
    font-size: 11px;
    color: #60a5fa;
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    cursor: pointer;
    transition: all 0.12s ease-in-out;
    user-select: none;
    -webkit-user-select: none;
  }

  .bubble-file-pill:hover {
    background: rgba(59, 130, 246, 0.22);
    border-color: rgba(59, 130, 246, 0.45);
    color: #93c5fd;
  }
</style>
