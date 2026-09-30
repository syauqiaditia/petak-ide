<script lang="ts">
  import { agentsStore } from './agents.svelte';

  let draft = $derived(agentsStore.fixWithAgentDraft);
  let slots = $derived(agentsStore.slots);

  function handleSlotChange(e: Event) {
    const sel = e.target as HTMLSelectElement;
    if (draft) {
      draft.slotId = sel.value;
      agentsStore.activeSlotId = sel.value;
    }
  }

  function handleClose() {
    agentsStore.isFixWithAgentOpen = false;
    agentsStore.fixWithAgentDraft = null;
  }

  function handleSubmit() {
    agentsStore.submitFixWithAgent();
  }
</script>

{#if agentsStore.isFixWithAgentOpen && draft}
  <div class="fix-modal-backdrop" onclick={handleClose} role="presentation">
    <div class="fix-modal" onclick={(e) => e.stopPropagation()} role="dialog" tabindex="-1">
      <div class="fix-modal-header">
        <div class="modal-title">
          <span>🔧 Fix with Agent</span>
          <span class="modal-subtitle">Draf prompt diagnostik transparan (dapat diedit sebelum kirim)</span>
        </div>
        <button class="close-btn" onclick={handleClose} aria-label="Close">✕</button>
      </div>

      <div class="fix-modal-body">
        <!-- Target Slot Selector -->
        <div class="slot-picker-row">
          <label for="slot-select">Pilih Agen Target:</label>
          <select id="slot-select" value={draft.slotId} onchange={handleSlotChange}>
            {#each slots as s}
              <option value={s.id}>{s.label} ({s.kind} · {s.config?.model || 'default'})</option>
            {/each}
          </select>
        </div>

        <!-- Metadata Summary Chips -->
        <div class="meta-chips">
          {#if draft.filePath}
            <div class="chip">
              <span class="chip-label">File:</span>
              <span class="chip-val">{draft.filePath}{draft.line ? `:${draft.line}` : ''}</span>
            </div>
          {/if}
          {#if draft.toolchainSummary}
            <div class="chip">
              <span class="chip-label">Toolchain:</span>
              <span class="chip-val">{draft.toolchainSummary}</span>
            </div>
          {/if}
          {#if draft.gitSummary}
            <div class="chip">
              <span class="chip-label">Git:</span>
              <span class="chip-val">{draft.gitSummary}</span>
            </div>
          {/if}
        </div>

        <!-- Editable User Prompt -->
        <div class="prompt-editor-wrap">
          <label for="prompt-textarea">Isi Prompt Draf:</label>
          <textarea
            id="prompt-textarea"
            bind:value={draft.userPrompt}
            rows="12"
            placeholder="Prompt yang akan dikirimkan ke agen..."
          ></textarea>
        </div>
      </div>

      <div class="fix-modal-footer">
        <button class="footer-btn cancel-btn" onclick={handleClose}>
          Batal
        </button>
        <button class="footer-btn submit-btn" onclick={handleSubmit}>
          Kirim ke Agen ➤
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .fix-modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.65);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }

  .fix-modal {
    width: 600px;
    max-width: 90vw;
    background: #18191e;
    border: 1px solid #2d3039;
    border-radius: 8px;
    box-shadow: 0 16px 36px rgba(0, 0, 0, 0.5);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .fix-modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    background: #131417;
    border-bottom: 1px solid #26282d;
  }

  .modal-title {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .modal-title span:first-child {
    font-size: 13px;
    font-weight: 600;
    color: #e6edf3;
  }

  .modal-subtitle {
    font-size: 11px;
    color: #8b949e;
  }

  .close-btn {
    background: transparent;
    border: none;
    color: #8b949e;
    cursor: pointer;
    font-size: 14px;
    padding: 4px;
  }

  .close-btn:hover {
    color: #e6edf3;
  }

  .fix-modal-body {
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .slot-picker-row {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    color: #c9cdd4;
  }

  .slot-picker-row select {
    flex: 1;
    background: #121316;
    border: 1px solid #282a33;
    border-radius: 4px;
    padding: 4px 8px;
    color: #e6edf3;
    font-size: 12px;
    outline: none;
  }

  .meta-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .chip {
    display: flex;
    align-items: center;
    gap: 4px;
    background: #131417;
    border: 1px solid #23252b;
    border-radius: 4px;
    padding: 3px 6px;
    font-size: 10px;
    font-family: monospace;
  }

  .chip-label {
    color: #8b949e;
  }

  .chip-val {
    color: #79c0ff;
  }

  .prompt-editor-wrap {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .prompt-editor-wrap label {
    font-size: 11px;
    font-weight: 500;
    color: #8b949e;
  }

  .prompt-editor-wrap textarea {
    background: #121316;
    border: 1px solid #282a33;
    border-radius: 6px;
    padding: 8px;
    color: #e6edf3;
    font-size: 12px;
    font-family: monospace;
    line-height: 1.4;
    resize: vertical;
    outline: none;
  }

  .prompt-editor-wrap textarea:focus {
    border-color: #6ea8ff;
  }

  .fix-modal-footer {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    padding: 10px 16px;
    background: #131417;
    border-top: 1px solid #26282d;
  }

  .footer-btn {
    padding: 6px 14px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    border: none;
  }

  .footer-btn.cancel-btn {
    background: #1f2228;
    color: #c9cdd4;
  }

  .footer-btn.submit-btn {
    background: #1f4277;
    color: #79c0ff;
    border: 1px solid #2d5a9e;
  }
</style>
