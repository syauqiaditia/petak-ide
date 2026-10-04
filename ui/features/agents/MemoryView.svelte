<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '../../lib/api';
  import { agentsStore } from './agents.svelte';
  import { sanitizeMemoryFilename, formatMemorySize, formatMemoryTime } from './agentsLogic';
  import type { MemoryItem } from './types';

  let memoryItems = $derived(agentsStore.memoryItems);
  let selectedFilename = $state<string | null>(null);
  let editorContent = $state('');
  let originalContent = $state('');
  let isSaving = $state(false);
  let isSaved = $state(false);
  let isCreating = $state(false);
  let newFilename = $state('');
  let createError = $state<string | null>(null);

  let isDirty = $derived(editorContent !== originalContent);

  let currentItem = $derived<MemoryItem | null>(
    memoryItems.find((item) => item.filename === selectedFilename) || null
  );

  onMount(async () => {
    await agentsStore.loadMemoryList();
    if (agentsStore.memoryItems.length > 0) {
      await selectFile(agentsStore.memoryItems[0].filename);
    }
  });

  async function selectFile(filename: string) {
    selectedFilename = filename;
    isSaved = false;
    try {
      const content = await api.agentReadProjectMemory(filename);
      editorContent = content;
      originalContent = content;
      agentsStore.selectMemory(filename);
    } catch (err) {
      console.warn('Failed reading memory file:', err);
    }
  }

  async function handleSave() {
    if (!selectedFilename || isSaving) return;
    isSaving = true;
    try {
      await api.agentSaveProjectMemory(selectedFilename, editorContent);
      await agentsStore.saveCurrentMemory(selectedFilename, editorContent);
      originalContent = editorContent;
      isSaved = true;
      setTimeout(() => {
        isSaved = false;
      }, 3000);
    } catch (err) {
      console.error('Failed saving project memory:', err);
    } finally {
      isSaving = false;
    }
  }

  async function handleCreateNew() {
    const raw = newFilename.trim();
    if (!raw) {
      createError = 'Nama berkas tidak boleh kosong';
      return;
    }
    const clean = sanitizeMemoryFilename(raw);
    createError = null;
    isCreating = false;
    newFilename = '';

    const initialContent = `# ${clean.replace(/\.md$/i, '')}\n\n`;
    try {
      await api.agentSaveProjectMemory(clean, initialContent);
      await agentsStore.createNewMemory(clean, initialContent);
      await selectFile(clean);
    } catch (err) {
      console.error('Failed creating new memory note:', err);
    }
  }

  function cancelCreate() {
    isCreating = false;
    newFilename = '';
    createError = null;
  }
</script>

<div class="memory-view-container">
  <!-- Top Global Header -->
  <div class="memory-header">
    <div class="header-info">
      <span class="header-icon">🧠</span>
      <span class="header-title">Project Memory</span>
      <span class="path-badge">.petak/memory/</span>
    </div>

    <button
      class="new-note-btn"
      onclick={() => { isCreating = true; newFilename = ''; createError = null; }}
      title="Buat berkas catatan markdown baru"
    >
      + Catatan Baru
    </button>
  </div>

  <!-- Inline New Note Form -->
  {#if isCreating}
    <div class="new-note-bar">
      <input
        type="text"
        class="new-file-input"
        bind:value={newFilename}
        placeholder="nama_catatan.md"
        onkeydown={(e) => {
          if (e.key === 'Enter') handleCreateNew();
          if (e.key === 'Escape') cancelCreate();
        }}
      />
      <div class="new-note-actions">
        <button class="confirm-btn" onclick={handleCreateNew} title="Buat berkas (Enter)">✓</button>
        <button class="cancel-btn" onclick={cancelCreate} title="Batal (Esc)">✕</button>
      </div>
      {#if createError}
        <span class="create-error">{createError}</span>
      {/if}
    </div>
  {/if}

  <!-- Split Panel: Left List vs Right Editor -->
  <div class="memory-split-body">
    <!-- Left: Files List -->
    <div class="files-sidebar">
      <div class="sidebar-title">
        <span>Berkas</span>
        <span class="files-count">{memoryItems.length}</span>
      </div>

      {#if memoryItems.length === 0}
        <div class="empty-list">Belum ada catatan memori.</div>
      {:else}
        <div class="files-list">
          {#each memoryItems as item (item.filename)}
            {@const isSelected = item.filename === selectedFilename}
            <button
              class="file-card"
              class:selected={isSelected}
              onclick={() => selectFile(item.filename)}
              title={item.filename}
            >
              <div class="file-card-top">
                <span class="file-icon">📝</span>
                <span class="file-name">{item.filename}</span>
              </div>
              <div class="file-card-meta">
                <span class="file-size">{formatMemorySize(item.size)}</span>
                <span class="file-date">{formatMemoryTime(item.updatedAt)}</span>
              </div>
            </button>
          {/each}
        </div>
      {/if}
    </div>

    <!-- Right: Editor Area -->
    <div class="editor-pane">
      {#if !selectedFilename}
        <div class="empty-editor">
          <span class="empty-icon">📂</span>
          <span>Pilih berkas memori di sebelah kiri atau klik "+ Catatan Baru" untuk membuat catatan proyek.</span>
        </div>
      {:else}
        <!-- Editor Toolbar -->
        <div class="editor-toolbar">
          <div class="active-file-title">
            <span class="title-text">{selectedFilename}</span>
            {#if isDirty}
              <span class="dirty-badge" title="Ada perubahan yang belum disimpan">● Belum disimpan</span>
            {/if}
          </div>

          <div class="editor-actions">
            {#if isSaved}
              <span class="saved-indicator">✓ Tersimpan</span>
            {/if}

            <button
              class="save-btn"
              onclick={handleSave}
              disabled={isSaving || !isDirty}
              title="Simpan perubahan ke disk (.petak/memory/)"
            >
              {#if isSaving}
                Menyimpan...
              {:else}
                Simpan Perubahan
              {/if}
            </button>
          </div>
        </div>

        <!-- Markdown Textarea Editor -->
        <div class="editor-content-wrap">
          <textarea
            class="memory-textarea"
            bind:value={editorContent}
            placeholder="Tulis catatan memori proyek dalam format markdown..."
            spellcheck="false"
          ></textarea>
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  .memory-view-container {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: #141518;
    color: #e6edf3;
    overflow: hidden;
    font-size: 12px;
  }

  /* Header */
  .memory-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 8px 10px;
    background: #18191f;
    border-bottom: 1px solid #282a33;
    flex-shrink: 0;
  }

  .header-info {
    display: flex;
    align-items: center;
    gap: 6px;
    overflow: hidden;
  }

  .header-icon {
    font-size: 13px;
  }

  .header-title {
    font-weight: 600;
    font-size: 12px;
    color: #e6edf3;
  }

  .path-badge {
    font-size: 10px;
    color: #8b949e;
    background: #21242c;
    padding: 1px 5px;
    border-radius: 4px;
    border: 1px solid #282a33;
  }

  .new-note-btn {
    background: #21242d;
    color: #79c0ff;
    border: 1px solid rgba(110, 168, 255, 0.3);
    border-radius: 4px;
    padding: 3px 8px;
    font-size: 11px;
    font-weight: 500;
    cursor: pointer;
    white-space: nowrap;
    transition: all 0.15s;
  }

  .new-note-btn:hover {
    background: rgba(110, 168, 255, 0.15);
    border-color: #58a6ff;
  }

  /* New note creation inline bar */
  .new-note-bar {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    background: #1c1e26;
    border-bottom: 1px solid #282a33;
    flex-shrink: 0;
  }

  .new-file-input {
    flex: 1;
    background: #121316;
    border: 1px solid #30363d;
    border-radius: 4px;
    color: #e6edf3;
    padding: 3px 8px;
    font-size: 11px;
    font-family: ui-monospace, SFMono-Regular, monospace;
    outline: none;
  }

  .new-file-input:focus {
    border-color: #58a6ff;
  }

  .new-note-actions {
    display: flex;
    gap: 4px;
  }

  .confirm-btn, .cancel-btn {
    background: #21242d;
    border: 1px solid #30363d;
    border-radius: 3px;
    color: #e6edf3;
    cursor: pointer;
    padding: 2px 6px;
    font-size: 11px;
  }

  .confirm-btn:hover {
    background: rgba(46, 160, 67, 0.2);
    color: #3fb950;
    border-color: #3fb950;
  }

  .cancel-btn:hover {
    background: rgba(248, 81, 73, 0.2);
    color: #f85149;
    border-color: #f85149;
  }

  .create-error {
    font-size: 10px;
    color: #f85149;
  }

  /* Split Layout */
  .memory-split-body {
    display: flex;
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }

  /* Left: Sidebar Files */
  .files-sidebar {
    width: 130px;
    background: #141518;
    border-right: 1px solid #282a33;
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
    overflow-y: auto;
  }

  .sidebar-title {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 8px;
    font-size: 10.5px;
    font-weight: 600;
    color: #8b949e;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    border-bottom: 1px solid #1f2126;
  }

  .files-count {
    background: #21242c;
    color: #79c0ff;
    padding: 1px 5px;
    border-radius: 8px;
    font-size: 9px;
  }

  .empty-list {
    padding: 12px 8px;
    text-align: center;
    color: #8b949e;
    font-size: 11px;
  }

  .files-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 4px;
  }

  .file-card {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 6px 8px;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 4px;
    cursor: pointer;
    text-align: left;
    transition: all 0.12s;
  }

  .file-card:hover {
    background: #1c1e24;
  }

  .file-card.selected {
    background: #1f2533;
    border-color: rgba(110, 168, 255, 0.35);
  }

  .file-card-top {
    display: flex;
    align-items: center;
    gap: 5px;
    overflow: hidden;
  }

  .file-icon {
    font-size: 11px;
    flex-shrink: 0;
  }

  .file-name {
    font-size: 11px;
    font-weight: 500;
    color: #e6edf3;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .file-card.selected .file-name {
    color: #79c0ff;
    font-weight: 600;
  }

  .file-card-meta {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 9.5px;
    color: #8b949e;
  }

  /* Right: Editor Pane */
  .editor-pane {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    background: #101114;
    overflow: hidden;
  }

  .empty-editor {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    padding: 20px;
    text-align: center;
    color: #8b949e;
    gap: 8px;
    font-size: 11px;
  }

  .empty-icon {
    font-size: 24px;
  }

  .editor-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 6px 10px;
    background: #16171d;
    border-bottom: 1px solid #21242c;
    flex-shrink: 0;
  }

  .active-file-title {
    display: flex;
    align-items: center;
    gap: 6px;
    overflow: hidden;
  }

  .title-text {
    font-weight: 600;
    font-size: 11.5px;
    font-family: ui-monospace, SFMono-Regular, monospace;
    color: #e6edf3;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .dirty-badge {
    font-size: 10px;
    color: #d29922;
    background: rgba(210, 153, 34, 0.15);
    padding: 1px 5px;
    border-radius: 3px;
    white-space: nowrap;
  }

  .editor-actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .saved-indicator {
    color: #3fb950;
    font-size: 10.5px;
    font-weight: 600;
    animation: fadeIn 0.2s ease-in;
  }

  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(-2px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .save-btn {
    background: #238636;
    color: #ffffff;
    border: 1px solid rgba(240, 246, 252, 0.1);
    border-radius: 4px;
    padding: 3px 8px;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    white-space: nowrap;
    transition: all 0.15s;
  }

  .save-btn:hover:not(:disabled) {
    background: #2ea043;
  }

  .save-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    background: #21262d;
    color: #8b949e;
  }

  .editor-content-wrap {
    flex: 1;
    min-height: 0;
    padding: 8px;
    display: flex;
  }

  .memory-textarea {
    width: 100%;
    height: 100%;
    resize: none;
    background: #0d1117;
    color: #c9d1d9;
    border: 1px solid #21242c;
    border-radius: 4px;
    padding: 8px 10px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 11.5px;
    line-height: 1.5;
    outline: none;
    tab-size: 2;
  }

  .memory-textarea:focus {
    border-color: #388bfd;
  }
</style>
