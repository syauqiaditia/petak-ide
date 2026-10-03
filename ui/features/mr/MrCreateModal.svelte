<script lang="ts">
  import { renderMrMarkdown } from './mrMarkdown';
  import type { CreateMrParams } from './types';

  let {
    open = false,
    currentBranch = 'feat/phase4-run',
    onClose = () => {},
    onSubmit = async () => {},
  }: {
    open?: boolean;
    currentBranch?: string;
    onClose?: () => void;
    onSubmit?: (params: CreateMrParams) => Promise<void>;
  } = $props();

  let sourceBranch = $state('feat/phase4-run');
  let targetBranch = $state('main');
  let title = $state('');
  let description = $state(
    '## Ringkasan Perubahan\n- Implementasi b23 UI polish\n\n## Verifikasi\n- [x] npm test PASS\n- [x] npm run check PASS'
  );
  let descTab = $state<'write' | 'preview'>('write');
  let deleteSourceBranch = $state(true);
  let squashCommits = $state(true);
  let assignee = $state('syauqi.aditia');
  let reviewer = $state('reviewer');
  let isSubmitting = $state(false);
  let errorMessage = $state<string | null>(null);

  $effect(() => {
    if (open) {
      sourceBranch = currentBranch || 'feat/phase4-run';
      targetBranch = 'main';
      title = '';
      descTab = 'write';
      errorMessage = null;
      isSubmitting = false;
    }
  });

  function addSnippet(kind: 'summary' | 'checklist') {
    if (kind === 'summary') {
      description += '\n\n## Detail Teknis\n- Komponen UI terverifikasi\n- Penanganan error deterministik';
    } else if (kind === 'checklist') {
      description += '\n\n## Checklist Pengujian\n- [ ] Uji responsivitas\n- [ ] Uji state error\n- [ ] Uji sync real-time';
    }
  }

  async function handleCreate() {
    if (!title.trim()) {
      errorMessage = 'Judul Merge Request wajib diisi.';
      return;
    }
    if (!sourceBranch.trim() || !targetBranch.trim()) {
      errorMessage = 'Source branch dan Target branch wajib ditentukan.';
      return;
    }
    if (sourceBranch.trim() === targetBranch.trim()) {
      errorMessage = 'Source branch dan Target branch tidak boleh sama.';
      return;
    }

    isSubmitting = true;
    errorMessage = null;

    try {
      await onSubmit({
        sourceBranch: sourceBranch.trim(),
        targetBranch: targetBranch.trim(),
        title: title.trim(),
        description: description.trim(),
        removeSourceBranch: deleteSourceBranch,
      });
      onClose();
    } catch (e: any) {
      errorMessage = e?.message || String(e);
    } finally {
      isSubmitting = false;
    }
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      onClose();
    } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleCreate();
    }
  }
</script>

<svelte:window onkeydown={handleKeyDown} />

{#if open}
  <div class="modal-backdrop" onclick={onClose} role="presentation">
    <div
      class="create-modal-window"
      onclick={(e) => e.stopPropagation()}
      role="dialog"
      aria-modal="true"
      tabindex="-1"
    >
      <!-- Header -->
      <div class="modal-header">
        <div class="header-left">
          <span class="header-icon">🔀</span>
          <span class="header-title">Buat Merge Request (GitLab)</span>
        </div>
        <button class="btn-close" onclick={onClose} aria-label="Tutup modal">✕</button>
      </div>

      <!-- Body -->
      <div class="modal-body">
        {#if errorMessage}
          <div class="error-banner">⚠️ {errorMessage}</div>
        {/if}

        <!-- Branch Selection -->
        <div class="section-box branches-box">
          <span class="box-label">CABANG (BRANCHES)</span>
          <div class="branches-row">
            <div class="branch-field">
              <label for="src-branch">Sumber (Source):</label>
              <div class="branch-input-wrap">
                <span class="branch-icon">🌿</span>
                <input
                  id="src-branch"
                  type="text"
                  class="branch-input"
                  bind:value={sourceBranch}
                  placeholder="feat/my-feature"
                />
              </div>
            </div>

            <span class="branch-arrow">➔</span>

            <div class="branch-field">
              <label for="tgt-branch">Target:</label>
              <div class="branch-input-wrap">
                <span class="branch-icon">🌿</span>
                <input
                  id="tgt-branch"
                  type="text"
                  class="branch-input"
                  bind:value={targetBranch}
                  placeholder="main"
                />
              </div>
            </div>
          </div>
          <div class="branch-hint">
            <span class="status-chip ready">✓ Siap di-merge otomatis (tanpa konflik)</span>
          </div>
        </div>

        <!-- Title -->
        <div class="form-group">
          <label for="mr-title" class="form-label">JUDUL MERGE REQUEST</label>
          <input
            id="mr-title"
            type="text"
            class="text-input"
            bind:value={title}
            placeholder="feat: deskripsi ringkas perubahan..."
          />
        </div>

        <!-- Description Markdown -->
        <div class="form-group">
          <div class="desc-header-row">
            <label for="mr-desc" class="form-label">DESKRIPSI (MARKDOWN)</label>
            <div class="desc-tabs">
              <button
                class="tab-btn"
                class:active={descTab === 'write'}
                type="button"
                onclick={() => (descTab = 'write')}
              >
                Tulis
              </button>
              <button
                class="tab-btn"
                class:active={descTab === 'preview'}
                type="button"
                onclick={() => (descTab = 'preview')}
              >
                Pratinjau (Preview)
              </button>
            </div>
          </div>

          {#if descTab === 'write'}
            <div class="write-area">
              <div class="snippet-toolbar">
                <button type="button" class="btn-snippet" onclick={() => addSnippet('summary')}>+ Ringkasan</button>
                <button type="button" class="btn-snippet" onclick={() => addSnippet('checklist')}>+ Checklist</button>
              </div>
              <textarea
                id="mr-desc"
                class="desc-textarea mono"
                bind:value={description}
                rows="6"
                placeholder="Tulis ringkasan perubahan dan verifikasi dalam format Markdown..."
              ></textarea>
            </div>
          {:else}
            <div class="preview-area">
              {@html renderMrMarkdown(description)}
            </div>
          {/if}
        </div>

        <!-- Metadata Assignment -->
        <div class="form-row-2col">
          <div class="form-group">
            <label for="mr-assignee" class="form-label">PENUGASAN (ASSIGNEE)</label>
            <div class="input-with-avatar">
              <span class="user-avatar">👤</span>
              <input
                id="mr-assignee"
                type="text"
                class="text-input"
                bind:value={assignee}
                placeholder="syauqi.aditia (Saya)"
              />
            </div>
          </div>

          <div class="form-group">
            <label for="mr-reviewer" class="form-label">PENINJAU (REVIEWER)</label>
            <div class="input-with-avatar">
              <span class="user-avatar">👤</span>
              <input
                id="mr-reviewer"
                type="text"
                class="text-input"
                bind:value={reviewer}
                placeholder="reviewer (QA Bot)"
              />
            </div>
          </div>
        </div>

        <!-- Options Checkboxes -->
        <div class="options-box">
          <label class="checkbox-row">
            <input type="checkbox" bind:checked={deleteSourceBranch} />
            <span>Hapus branch sumber setelah merge request disetujui (Delete source branch)</span>
          </label>
          <label class="checkbox-row">
            <input type="checkbox" bind:checked={squashCommits} />
            <span>Squash commit saat merge request disetujui (Squash commits)</span>
          </label>
        </div>
      </div>

      <!-- Footer -->
      <div class="modal-footer">
        <button class="btn-cancel" onclick={onClose} disabled={isSubmitting}>Batal</button>
        <button class="btn-submit" onclick={handleCreate} disabled={isSubmitting}>
          {#if isSubmitting}
            <span class="spinner"></span> Membuat MR…
          {:else}
            🚀 Buat Merge Request (⌘Enter)
          {/if}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .modal-backdrop {
    position: fixed;
    inset: 0;
    z-index: 1000;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.7);
    backdrop-filter: blur(4px);
  }

  .create-modal-window {
    width: 680px;
    max-width: 95vw;
    max-height: 90vh;
    display: flex;
    flex-direction: column;
    background: #1c1d22;
    border: 1px solid #26282d;
    border-radius: 12px;
    box-shadow: 0 16px 40px rgba(0, 0, 0, 0.55);
    overflow: hidden;
    user-select: none;
    -webkit-user-select: none;
    font-family: 'Geist', system-ui, -apple-system, sans-serif;
  }

  .modal-header {
    height: 44px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 16px;
    background: #16171a;
    border-bottom: 1px solid #26282d;
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 14px;
    font-weight: 600;
    color: #e6e7ea;
  }

  .btn-close {
    width: 26px;
    height: 26px;
    border-radius: 4px;
    display: grid;
    place-items: center;
    color: #8b8f98;
    background: transparent;
    border: none;
    cursor: pointer;
    font-size: 14px;
  }

  .btn-close:hover {
    background: #26282d;
    color: #ffffff;
  }

  .modal-body {
    flex: 1;
    overflow-y: auto;
    padding: 16px 20px;
    display: flex;
    flex-direction: column;
    gap: 14px;
    background: #18191d;
  }

  .error-banner {
    padding: 8px 12px;
    border-radius: 6px;
    background: #3d1a1c;
    border: 1px solid #f07a74;
    color: #f07a74;
    font-size: 12px;
  }

  .section-box {
    background: #141518;
    border: 1px solid #26282d;
    border-radius: 8px;
    padding: 12px 14px;
  }

  .box-label {
    display: block;
    font-size: 10.5px;
    font-weight: 700;
    color: #787c86;
    letter-spacing: 0.5px;
    margin-bottom: 8px;
  }

  .branches-row {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .branch-field {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .branch-field label {
    font-size: 11px;
    color: #8b8f98;
  }

  .branch-input-wrap {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 32px;
    padding: 0 8px;
    border-radius: 6px;
    background: #1c1d22;
    border: 1px solid #2c2e34;
  }

  .branch-icon {
    font-size: 13px;
  }

  .branch-input {
    flex: 1;
    background: transparent;
    border: none;
    color: #e6e7ea;
    font-size: 12.5px;
    font-family: 'JetBrains Mono', monospace;
    outline: none;
  }

  .branch-arrow {
    color: #787c86;
    font-size: 14px;
    padding-top: 16px;
  }

  .branch-hint {
    margin-top: 8px;
  }

  .status-chip {
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 10px;
  }

  .status-chip.ready {
    background: #1a261e;
    color: #7fc98f;
    border: 1px solid #24452d;
  }

  .form-group {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .form-label {
    font-size: 10.5px;
    font-weight: 700;
    color: #787c86;
    letter-spacing: 0.5px;
  }

  .text-input {
    height: 34px;
    padding: 0 10px;
    border-radius: 6px;
    background: #141518;
    border: 1px solid #2c2e34;
    color: #e6e7ea;
    font-size: 13px;
    font-family: inherit;
    outline: none;
    transition: border-color 0.15s;
  }

  .text-input:focus {
    border-color: #3574f0;
  }

  .desc-header-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .desc-tabs {
    display: flex;
    gap: 4px;
    background: #141518;
    padding: 2px;
    border-radius: 6px;
    border: 1px solid #2c2e34;
  }

  .tab-btn {
    padding: 3px 10px;
    border-radius: 4px;
    background: transparent;
    border: none;
    color: #8b8f98;
    font-size: 11.5px;
    cursor: pointer;
    transition: all 0.1s;
  }

  .tab-btn.active {
    background: #23252b;
    color: #ffffff;
    font-weight: 500;
  }

  .write-area {
    display: flex;
    flex-direction: column;
    border-radius: 6px;
    border: 1px solid #2c2e34;
    background: #141518;
    overflow: hidden;
  }

  .snippet-toolbar {
    height: 28px;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 8px;
    background: #1a1b20;
    border-bottom: 1px solid #26282d;
  }

  .btn-snippet {
    padding: 1px 7px;
    border-radius: 4px;
    background: #23252b;
    border: 1px solid #2c2e34;
    color: #b9bcc3;
    font-size: 10.5px;
    cursor: pointer;
  }

  .btn-snippet:hover {
    background: #2d3038;
    color: #ffffff;
  }

  .desc-textarea {
    width: 100%;
    padding: 10px;
    background: transparent;
    border: none;
    color: #e6e7ea;
    font-size: 12.5px;
    resize: vertical;
    outline: none;
    box-sizing: border-box;
  }

  .desc-textarea.mono {
    font-family: 'JetBrains Mono', monospace;
  }

  .preview-area {
    padding: 12px;
    border-radius: 6px;
    background: #141518;
    border: 1px solid #2c2e34;
    min-height: 120px;
    max-height: 200px;
    overflow-y: auto;
    font-size: 12.5px;
    color: #bcbec4;
    line-height: 1.5;
  }

  .form-row-2col {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }

  .input-with-avatar {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 34px;
    padding: 0 8px;
    border-radius: 6px;
    background: #141518;
    border: 1px solid #2c2e34;
  }

  .input-with-avatar .text-input {
    height: 100%;
    padding: 0;
    border: none;
    flex: 1;
    background: transparent;
  }

  .user-avatar {
    font-size: 13px;
  }

  .options-box {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px 12px;
    border-radius: 6px;
    background: #141518;
    border: 1px solid #26282d;
  }

  .checkbox-row {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    color: #b9bcc3;
    cursor: pointer;
  }

  .checkbox-row input {
    cursor: pointer;
  }

  .modal-footer {
    height: 50px;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 10px;
    padding: 0 16px;
    background: #16171a;
    border-top: 1px solid #26282d;
  }

  .btn-cancel {
    height: 32px;
    padding: 0 16px;
    border-radius: 6px;
    background: #202227;
    border: 1px solid #2c2e34;
    color: #d8d9dc;
    font-size: 12.5px;
    cursor: pointer;
  }

  .btn-cancel:hover {
    background: #282a32;
    color: #ffffff;
  }

  .btn-submit {
    height: 32px;
    padding: 0 18px;
    border-radius: 6px;
    background: #3574f0;
    border: 1px solid #3574f0;
    color: #ffffff;
    font-size: 12.5px;
    font-weight: 500;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .btn-submit:hover:not(:disabled) {
    background: #4884f8;
  }

  .btn-submit:disabled {
    opacity: 0.6;
    cursor: wait;
  }
</style>
