<script lang="ts">
  import type { Discussion, TokenScopeMode } from './types';
  import { renderMrMarkdown } from './mrMarkdown';
  import { SCOPE_DISABLED_TOOLTIP } from './mrLogic';

  let {
    discussions = [],
    tokenScope = 'none',
    onAddNote,
    onResolveDiscussion,
    onCreateNewThread,
  } = $props<{
    discussions: Discussion[];
    tokenScope: TokenScopeMode;
    onAddNote?: (discussionId: string, body: string) => Promise<void>;
    onResolveDiscussion?: (discussionId: string, resolved: boolean) => Promise<void>;
    onCreateNewThread?: (body: string) => Promise<void>;
  }>();

  let canWrite = $derived(tokenScope === 'full');
  let newThreadBody = $state('');
  let replyBodies = $state<Record<string, string>>({});
  let submitting = $state(false);

  async function handleCreateNewThread() {
    if (!canWrite || !newThreadBody.trim() || submitting) return;
    submitting = true;
    try {
      if (onCreateNewThread) {
        await onCreateNewThread(newThreadBody.trim());
      }
      newThreadBody = '';
    } finally {
      submitting = false;
    }
  }

  async function handleReply(discId: string) {
    const text = replyBodies[discId]?.trim();
    if (!canWrite || !text || submitting) return;
    submitting = true;
    try {
      if (onAddNote) {
        await onAddNote(discId, text);
      }
      replyBodies[discId] = '';
    } finally {
      submitting = false;
    }
  }

  async function handleToggleResolve(disc: Discussion) {
    if (!canWrite) return;
    const firstNote = disc.notes[0];
    const currentResolved = !!firstNote?.resolved;
    if (onResolveDiscussion) {
      await onResolveDiscussion(disc.id, !currentResolved);
    }
  }

  function formatDate(dStr: string) {
    try {
      const d = new Date(dStr);
      return d.toLocaleDateString('id-ID', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return dStr;
    }
  }
</script>

<div class="mr-thread-container">
  {#if discussions.length === 0}
    <div class="empty-thread">
      <div class="empty-icon">💬</div>
      <div class="empty-title">Belum ada diskusi</div>
      <div class="empty-desc">Mulai diskusi atau tinggalkan catatan umum untuk Merge Request ini.</div>
    </div>
  {:else}
    <div class="discussions-list">
      {#each discussions as disc (disc.id)}
        {@const firstNote = disc.notes[0]}
        {@const isResolved = !!firstNote?.resolved}
        {@const isResolvable = !!firstNote?.resolvable}
        {@const isInline = !!firstNote?.position}

        <div class="discussion-card" class:resolved={isResolved}>
          <!-- Discussion Header -->
          <div class="discussion-header">
            <div class="header-left">
              {#if isInline && firstNote.position}
                <span class="inline-badge">
                  📍 {firstNote.position.newPath || firstNote.position.oldPath}
                  {#if firstNote.position.newLine}
                    :{firstNote.position.newLine}
                  {/if}
                </span>
              {/if}
              {#if isResolvable}
                <span class="resolve-badge" class:resolved={isResolved}>
                  {isResolved ? '✓ Diselesaikan' : '● Belum Selesai'}
                </span>
              {/if}
            </div>

            {#if isResolvable}
              <button
                class="btn-resolve"
                disabled={!canWrite}
                title={!canWrite ? SCOPE_DISABLED_TOOLTIP : isResolved ? 'Buka kembali diskusi' : 'Tandai diskusi selesai'}
                onclick={() => handleToggleResolve(disc)}
              >
                {isResolved ? 'Buka Kembali' : 'Selesaikan Diskusi'}
              </button>
            {/if}
          </div>

          <!-- Notes List -->
          <div class="notes-container">
            {#each disc.notes as note (note.id)}
              <div class="note-item" class:system={note.system}>
                <div class="note-meta">
                  <div class="author-avatar">
                    {note.author.name ? note.author.name.charAt(0).toUpperCase() : '?'}
                  </div>
                  <span class="author-name">{note.author.name || note.author.username}</span>
                  <span class="note-time">{formatDate(note.createdAt)}</span>
                  {#if note.system}
                    <span class="system-tag">Sistem</span>
                  {/if}
                </div>
                <div class="note-body">
                  {@html renderMrMarkdown(note.body)}
                </div>
              </div>
            {/each}
          </div>

          <!-- Reply Box -->
          <div class="reply-box">
            <textarea
              class="reply-input"
              placeholder={canWrite ? 'Balas diskusi ini…' : 'Token scope read_api: tidak dapat membalas diskusi'}
              disabled={!canWrite}
              bind:value={replyBodies[disc.id]}
              rows="2"
            ></textarea>
            <div class="reply-footer">
              <button
                class="btn-reply"
                disabled={!canWrite || !replyBodies[disc.id]?.trim() || submitting}
                title={!canWrite ? SCOPE_DISABLED_TOOLTIP : 'Kirim balasan'}
                onclick={() => handleReply(disc.id)}
              >
                Balas
              </button>
            </div>
          </div>
        </div>
      {/each}
    </div>
  {/if}

  <!-- New Discussion Form -->
  <div class="new-thread-box">
    <div class="new-thread-title">Tambah Komentar Umum</div>
    <textarea
      class="new-thread-input"
      placeholder={canWrite ? 'Tulis komentar atau ulasan baru…' : 'Token scope read_api: mode lihat saja'}
      disabled={!canWrite}
      bind:value={newThreadBody}
      rows="3"
    ></textarea>
    <div class="new-thread-footer">
      <button
        class="btn-post"
        disabled={!canWrite || !newThreadBody.trim() || submitting}
        title={!canWrite ? SCOPE_DISABLED_TOOLTIP : 'Kirim komentar baru ke GitLab'}
        onclick={handleCreateNewThread}
      >
        Kirim Komentar
      </button>
    </div>
  </div>
</div>

<style>
  .mr-thread-container {
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 20px;
    height: 100%;
    overflow-y: auto;
    box-sizing: border-box;
  }

  .empty-thread {
    text-align: center;
    padding: 40px 20px;
    color: #8b949e;
  }

  .empty-icon {
    font-size: 32px;
    margin-bottom: 8px;
  }

  .empty-title {
    font-size: 15px;
    font-weight: 600;
    color: #c9cdd4;
    margin-bottom: 4px;
  }

  .empty-desc {
    font-size: 12px;
  }

  .discussions-list {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .discussion-card {
    background: #1a1b1f;
    border: 1px solid #2c2e34;
    border-radius: 6px;
    overflow: hidden;
  }

  .discussion-card.resolved {
    border-left: 3px solid #7fc98f;
    opacity: 0.85;
  }

  .discussion-header {
    background: #141518;
    padding: 8px 12px;
    border-bottom: 1px solid #26282d;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .inline-badge {
    font-size: 11px;
    background: #23252b;
    color: #79c0ff;
    padding: 2px 6px;
    border-radius: 3px;
    font-family: monospace;
  }

  .resolve-badge {
    font-size: 11px;
    padding: 2px 6px;
    border-radius: 3px;
    background: #23252b;
    color: #d29922;
  }

  .resolve-badge.resolved {
    color: #7ee787;
    background: rgba(126, 231, 135, 0.1);
  }

  .btn-resolve {
    font-size: 11px;
    background: transparent;
    border: 1px solid #2c2e34;
    color: #c9cdd4;
    padding: 3px 8px;
    border-radius: 4px;
    cursor: pointer;
  }

  .btn-resolve:hover:not(:disabled) {
    background: #23252b;
    color: #fff;
  }

  .btn-resolve:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .notes-container {
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .note-item {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .note-item.system {
    opacity: 0.7;
    font-style: italic;
  }

  .note-meta {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .author-avatar {
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: #3574f0;
    color: #fff;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 10px;
    font-weight: 600;
  }

  .author-name {
    font-size: 12px;
    font-weight: 600;
    color: #e6edf3;
  }

  .note-time {
    font-size: 11px;
    color: #8b949e;
  }

  .system-tag {
    font-size: 10px;
    background: #23252b;
    color: #8b949e;
    padding: 1px 4px;
    border-radius: 3px;
  }

  .note-body {
    font-size: 13px;
    color: #c9cdd4;
    line-height: 1.5;
    margin-left: 28px;
  }

  /* Reply Box */
  .reply-box {
    background: #141518;
    border-top: 1px solid #26282d;
    padding: 10px 14px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .reply-input, .new-thread-input {
    width: 100%;
    background: #1a1b1f;
    border: 1px solid #2c2e34;
    border-radius: 4px;
    color: #e6edf3;
    font-size: 12px;
    padding: 8px;
    box-sizing: border-box;
    resize: vertical;
    font-family: inherit;
  }

  .reply-input:focus, .new-thread-input:focus {
    outline: none;
    border-color: #3574f0;
  }

  .reply-input:disabled, .new-thread-input:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .reply-footer, .new-thread-footer {
    display: flex;
    justify-content: flex-end;
  }

  .btn-reply, .btn-post {
    font-size: 12px;
    font-weight: 500;
    padding: 5px 12px;
    background: #3574f0;
    color: #fff;
    border: none;
    border-radius: 4px;
    cursor: pointer;
  }

  .btn-reply:hover:not(:disabled), .btn-post:hover:not(:disabled) {
    background: #4682f4;
  }

  .btn-reply:disabled, .btn-post:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  /* New Thread Box */
  .new-thread-box {
    background: #1a1b1f;
    border: 1px solid #2c2e34;
    border-radius: 6px;
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .new-thread-title {
    font-size: 13px;
    font-weight: 600;
    color: #e6edf3;
  }

  /* Markdown rendered elements */
  :global(.mr-para) {
    margin: 4px 0;
  }

  :global(.mr-code-block) {
    background: #111215;
    padding: 8px 12px;
    border-radius: 4px;
    overflow-x: auto;
    font-family: monospace;
    font-size: 12px;
  }

  :global(.mr-inline-code) {
    background: #111215;
    padding: 2px 4px;
    border-radius: 3px;
    font-family: monospace;
    font-size: 12px;
    color: #79c0ff;
  }

  :global(.mr-link) {
    color: #58a6ff;
    text-decoration: underline;
  }
</style>
