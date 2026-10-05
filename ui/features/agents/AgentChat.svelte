<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { agentsStore } from './agents.svelte';
  import { truncateToolOutput } from './agentsLogic';
  import type { ChatMessage, PendingPermissionRequest, PermissionMode } from './types';
  import { settingsStore } from '../settings/settingsStore.svelte';
  import { mcpStore, formatMcpPillLabel } from '../settings/mcpStore.svelte';

  let promptText = $state('');
  let textareaEl: HTMLTextAreaElement | null = $state(null);
  let messagesContainerEl: HTMLDivElement | null = $state(null);
  let expandedToolOutputs = $state<Record<string, boolean>>({});

  let isContextPickerOpen = $state(false);
  let attachedContextLabel = $state<string | null>(null);

  let activeSlot = $derived(agentsStore.activeSlot);
  let messages = $derived(agentsStore.activeMessages);
  let pendingPerm = $derived(agentsStore.activePendingPermission);
  let isBusy = $derived(agentsStore.isStreaming || activeSlot?.status === 'busy');
  let activePermission = $derived<PermissionMode>(
    ((activeSlot?.config?.permission as PermissionMode) || 'ask')
  );

  $effect(() => {
    // Scroll to bottom on new messages or streaming changes
    if (messages.length || agentsStore.streamingContent) {
      scrollToBottom();
    }
  });

  onMount(() => {
    mcpStore.loadConfig();
  });

  async function scrollToBottom() {
    await tick();
    if (messagesContainerEl) {
      messagesContainerEl.scrollTop = messagesContainerEl.scrollHeight;
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  async function handleSubmit() {
    if (!promptText.trim() || isBusy) return;
    const text = promptText;
    promptText = '';
    attachedContextLabel = null;
    await agentsStore.sendPrompt(text);
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

  function selectContext(type: 'file' | 'git' | 'status') {
    isContextPickerOpen = false;
    if (type === 'file') {
      attachedContextLabel = 'File';
      promptText = (promptText ? promptText + ' ' : '') + '@file:lib/main.dart ';
    } else if (type === 'git') {
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
  <div class="chat-messages" bind:this={messagesContainerEl}>
    {#if messages.length === 0 && !agentsStore.isStreaming}
      <!-- Empty Session Greeting & Quick Suggestions -->
      <div class="empty-chat-welcome">
        <div class="welcome-icon">✨</div>
        <div class="welcome-title">
          Sesi Agen: {activeSlot?.label || 'AI Agent'}
        </div>
        <div class="welcome-desc">
          Model: <code>{activeSlot?.config?.model || 'default'}</code> · Mode: <code>{activeSlot?.config?.permission || 'ask'}</code>
        </div>
        <div class="quick-prompts">
          <button class="quick-prompt-btn" onclick={() => applyQuickPrompt('Review perubahan git terkini dan temukan potensi bug.')}>
            🔍 Review perubahan git
          </button>
          <button class="quick-prompt-btn" onclick={() => applyQuickPrompt('Cari penyebab build error dan usulkan perbaikan minimal.')}>
            🛠️ Cari penyebab build error
          </button>
          <button class="quick-prompt-btn" onclick={() => applyQuickPrompt('Jelaskan arsitektur berkas ini dan dependensinya.')}>
            📖 Jelaskan fungsi berkas ini
          </button>
        </div>
      </div>
    {/if}

    {#each messages as msg (msg.id)}
      <div class="message-row" class:user-row={msg.role === 'user'} class:system-row={msg.role === 'system'}>
        <div class="message-bubble" class:user-bubble={msg.role === 'user'} class:agent-bubble={msg.role === 'agent'} class:system-bubble={msg.role === 'system'}>
          <div class="message-role-label">
            {msg.role === 'user' ? 'Anda' : msg.role === 'agent' ? (activeSlot?.label || 'Agent') : 'Sistem'}
          </div>
          <div class="message-body">{msg.content}</div>

          <!-- Tool calls if present -->
          {#if msg.toolCalls && msg.toolCalls.length > 0}
            <div class="tool-calls-list">
              {#each msg.toolCalls as tool, idx}
                {@const key = `${msg.id}-tool-${idx}`}
                {@const isExpanded = expandedToolOutputs[key]}
                {@const truncated = truncateToolOutput(tool.output || '', 200)}
                <div class="tool-call-card">
                  <div class="tool-call-header">
                    <span class="tool-name">⚡ {tool.name}</span>
                    {#if tool.arguments?.path}
                      <span class="tool-arg">{tool.arguments.path}</span>
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
          {/if}
        </div>
      </div>
    {/each}

    <!-- Live Streaming Bubble -->
    {#if agentsStore.isStreaming}
      <div class="message-row agent-row">
        <div class="message-bubble agent-bubble">
          <div class="message-role-label">{activeSlot?.label || 'Agent'} <span class="typing-indicator">sedang berpikir...</span></div>
          <div class="message-body">
            {agentsStore.streamingContent || 'Menyiapkan respons...'}
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
  </div>

  <!-- Floating Context Composer with Interactive Context Pills -->
  <div class="agent-composer-container">
    {#if isContextPickerOpen}
      <div class="context-picker-popup">
        <div class="context-picker-title">Pilih Konteks (@Context):</div>
        <button type="button" class="context-option-btn" onclick={() => selectContext('file')}>
          📄 Berkas Editor Aktif
        </button>
        <button type="button" class="context-option-btn" onclick={() => selectContext('git')}>
          🔀 Git Staging & Diffs
        </button>
        <button type="button" class="context-option-btn" onclick={() => selectContext('status')}>
          📊 Hierarki Proyek & Status
        </button>
      </div>
    {/if}

    <div class="composer-textarea-wrap">
      <textarea
        bind:this={textareaEl}
        bind:value={promptText}
        onkeydown={handleKeydown}
        class="composer-textarea"
        placeholder="Tanyakan sesuatu atau berikan tugas perbaikan kode… (Enter kirim, Shift+Enter baris baru)"
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
      </div>

      <div class="pills-right">
        {#if isBusy}
          <button type="button" class="cancel-prompt-btn" onclick={() => agentsStore.cancelActivePrompt()} title="Batalkan prompt aktif">
            ■
          </button>
        {:else}
          <button
            type="button"
            class="send-prompt-btn"
            onclick={handleSubmit}
            disabled={!promptText.trim()}
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
    max-width: 88%;
    border-radius: 8px;
    padding: 8px 12px;
    font-size: 12px;
    line-height: 1.45;
  }

  .user-bubble {
    background: #1e293b;
    border: 1px solid #334155;
    color: #f8fafc;
  }

  .agent-bubble {
    background: #16181d;
    border: 1px solid rgba(255, 255, 255, 0.07);
    color: #e2e8f0;
  }

  .system-bubble {
    background: #1c1917;
    border: 1px solid #44403c;
    color: #d6d3d1;
    font-style: italic;
  }

  .message-role-label {
    font-size: 10px;
    font-weight: 600;
    color: #8b949e;
    margin-bottom: 4px;
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
  }

  .tool-call-header {
    display: flex;
    align-items: center;
    gap: 6px;
    color: #f59e0b;
    font-weight: 600;
  }

  .tool-arg {
    color: #94a3b8;
    font-family: monospace;
    font-size: 10px;
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
  }

  .pills-left {
    display: flex;
    align-items: center;
    gap: 5px;
    flex-wrap: wrap;
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
    width: 24px;
    height: 24px;
    border-radius: 4px;
    background: #ef4444;
    color: white;
    border: none;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 10px;
    cursor: pointer;
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
</style>
