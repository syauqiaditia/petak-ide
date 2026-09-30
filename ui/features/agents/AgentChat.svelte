<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { agentsStore } from './agents.svelte';
  import { truncateToolOutput } from './agentsLogic';
  import type { ChatMessage, PendingPermissionRequest } from './types';

  let promptText = $state('');
  let textareaEl: HTMLTextAreaElement | null = $state(null);
  let messagesContainerEl: HTMLDivElement | null = $state(null);
  let expandedToolOutputs = $state<Record<string, boolean>>({});

  let activeSlot = $derived(agentsStore.activeSlot);
  let messages = $derived(agentsStore.activeMessages);
  let pendingPerm = $derived(agentsStore.activePendingPermission);
  let isBusy = $derived(agentsStore.isStreaming || activeSlot?.status === 'busy');

  $effect(() => {
    // Scroll to bottom on new messages or streaming changes
    if (messages.length || agentsStore.streamingContent) {
      scrollToBottom();
    }
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

  <!-- Input Prompt Bar -->
  <div class="chat-input-bar">
    <div class="input-wrap">
      <textarea
        bind:this={textareaEl}
        bind:value={promptText}
        onkeydown={handleKeydown}
        placeholder="Tanya atau instruksikan agen... (Enter untuk kirim, Shift+Enter untuk baris baru)"
        disabled={isBusy}
        rows="2"
      ></textarea>
    </div>
    <div class="input-actions">
      {#if isBusy}
        <button class="action-btn cancel-btn" onclick={() => agentsStore.cancelActivePrompt()} title="Batalkan prompt aktif">
          ■ Batalkan
        </button>
      {:else}
        <button class="action-btn send-btn" onclick={handleSubmit} disabled={!promptText.trim()} title="Kirim instruksi">
          Kirim ➤
        </button>
      {/if}
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
    text-align: left;
    background: #1a1c22;
    border: 1px solid #26282d;
    border-radius: 6px;
    padding: 6px 10px;
    font-size: 11px;
    color: #c9cdd4;
    cursor: pointer;
    transition: background 0.12s, border-color 0.12s;
  }

  .quick-prompt-btn:hover {
    background: #232730;
    border-color: #3b4252;
    color: #6ea8ff;
  }

  .message-row {
    display: flex;
    flex-direction: column;
  }

  .message-row.user-row {
    align-items: flex-end;
  }

  .message-bubble {
    max-width: 90%;
    padding: 8px 12px;
    border-radius: 8px;
    font-size: 12px;
    line-height: 1.45;
    word-break: break-word;
  }

  .user-bubble {
    background: #1c2b42;
    border: 1px solid #2c3e60;
    color: #e6edf3;
  }

  .agent-bubble {
    background: #18191f;
    border: 1px solid #282a33;
    color: #c9cdd4;
  }

  .system-bubble {
    background: #1e1e24;
    border: 1px dashed #3a3b45;
    color: #8b949e;
    font-size: 11px;
    width: 100%;
    max-width: 100%;
  }

  .message-role-label {
    font-size: 10px;
    font-weight: 600;
    color: #8b949e;
    margin-bottom: 4px;
  }

  .user-bubble .message-role-label {
    color: #79c0ff;
  }

  .typing-indicator {
    font-style: italic;
    color: #7fc98f;
    margin-left: 4px;
  }

  .cursor-blink {
    animation: blink 1s step-start infinite;
    color: #6ea8ff;
  }

  @keyframes blink {
    50% { opacity: 0; }
  }

  .tool-calls-list {
    margin-top: 8px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .tool-call-card {
    background: #121316;
    border: 1px solid #23252b;
    border-radius: 4px;
    padding: 6px 8px;
    font-size: 11px;
  }

  .tool-call-header {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .tool-name {
    font-weight: 600;
    color: #e8b45a;
  }

  .tool-arg {
    color: #8b949e;
    font-family: monospace;
    font-size: 10px;
  }

  .tool-output {
    margin-top: 4px;
    background: #0d0e11;
    padding: 4px 6px;
    border-radius: 3px;
  }

  .tool-output pre {
    margin: 0;
    font-family: monospace;
    font-size: 10px;
    color: #8b949e;
    white-space: pre-wrap;
  }

  .expand-tool-btn {
    background: transparent;
    border: none;
    color: #6ea8ff;
    font-size: 10px;
    padding: 2px 0 0 0;
    cursor: pointer;
  }

  /* Permission Request Card */
  .perm-card-container {
    width: 100%;
  }

  .perm-card {
    background: #231e15;
    border: 1px solid #4a3d22;
    border-radius: 8px;
    padding: 10px 12px;
  }

  .perm-header {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 6px;
  }

  .perm-icon {
    font-size: 14px;
  }

  .perm-title {
    font-size: 12px;
    font-weight: 600;
    color: #e8b45a;
  }

  .perm-content {
    font-size: 11px;
    color: #c9cdd4;
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 10px;
  }

  .perm-row {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .perm-label {
    color: #8b949e;
  }

  .perm-code {
    background: #141518;
    padding: 2px 6px;
    border-radius: 4px;
    font-family: monospace;
    color: #79c0ff;
  }

  .perm-reason {
    font-style: italic;
    color: #8b949e;
    font-size: 11px;
  }

  .perm-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }

  .perm-btn {
    padding: 4px 10px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    border: none;
    transition: opacity 0.12s;
  }

  .perm-btn.reject {
    background: #3d1a1c;
    color: #f07a74;
    border: 1px solid #d9534f;
  }

  .perm-btn.approve {
    background: #233428;
    color: #7fc98f;
    border: 1px solid #35573d;
  }

  .perm-btn:hover {
    opacity: 0.85;
  }

  /* Chat Input Bar */
  .chat-input-bar {
    border-top: 1px solid #26282d;
    background: #111215;
    padding: 8px 10px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    flex-shrink: 0;
  }

  .input-wrap textarea {
    width: 100%;
    background: #18191f;
    border: 1px solid #282a33;
    border-radius: 6px;
    padding: 6px 8px;
    color: #e6edf3;
    font-size: 12px;
    font-family: inherit;
    resize: none;
    outline: none;
    box-sizing: border-box;
  }

  .input-wrap textarea:focus {
    border-color: #6ea8ff;
  }

  .input-actions {
    display: flex;
    justify-content: flex-end;
  }

  .action-btn {
    padding: 5px 12px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    border: none;
  }

  .send-btn {
    background: #1f4277;
    color: #79c0ff;
    border: 1px solid #2d5a9e;
  }

  .send-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .cancel-btn {
    background: #3d1a1c;
    color: #f07a74;
    border: 1px solid #d9534f;
  }
</style>
