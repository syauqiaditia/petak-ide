<script lang="ts">
  import { agentsStore } from './agents.svelte';
  import { api } from '../../lib/api';
  import type { PendingPermissionRequest } from './types';

  interface Props {
    permission?: PendingPermissionRequest | null;
    onAllow?: (requestId: string) => void;
    onDeny?: (requestId: string) => void;
    onClose?: () => void;
  }

  let { permission, onAllow, onDeny, onClose }: Props = $props();

  let activePerm = $derived(
    permission !== undefined ? permission : agentsStore.activePendingPermission
  );

  let toolName = $derived(
    activePerm?.toolCall?.name ||
    activePerm?.toolCall?.tool ||
    (activePerm?.toolCall?.command ? 'terminal' : 'Alat Sistem')
  );

  let commandText = $derived(
    activePerm?.toolCall?.command ||
    activePerm?.toolCall?.arguments?.command ||
    activePerm?.toolCall?.params?.command ||
    activePerm?.toolCall?.args?.command ||
    (activePerm?.toolCall?.arguments
      ? typeof activePerm.toolCall.arguments === 'string'
        ? activePerm.toolCall.arguments
        : JSON.stringify(activePerm.toolCall.arguments, null, 2)
      : '')
  );

  let reasonText = $derived(
    activePerm?.toolCall?.reason ||
    activePerm?.toolCall?.description ||
    ''
  );

  let isSubmitting = $state(false);

  export async function handleAllow() {
    if (!activePerm || isSubmitting) return;
    const reqId = activePerm.requestId;
    isSubmitting = true;
    try {
      await api.agentRespondPermission(reqId, true);
      await agentsStore.respondPermission(reqId, true);
      onAllow?.(reqId);
    } catch (err) {
      console.error('Failed to allow permission:', err);
    } finally {
      isSubmitting = false;
      onClose?.();
    }
  }

  export async function handleDeny() {
    if (!activePerm || isSubmitting) return;
    const reqId = activePerm.requestId;
    isSubmitting = true;
    try {
      await api.agentRespondPermission(reqId, false);
      await agentsStore.respondPermission(reqId, false);
      onDeny?.(reqId);
    } catch (err) {
      console.error('Failed to deny permission:', err);
    } finally {
      isSubmitting = false;
      onClose?.();
    }
  }
</script>

{#if activePerm}
  <div class="perm-modal-backdrop" role="presentation">
    <div class="perm-modal" role="dialog" aria-modal="true" tabindex="-1">
      <div class="perm-modal-header">
        <div class="perm-modal-title">
          <span class="perm-modal-icon">⚠️</span>
          <span class="perm-title-text">Persetujuan Eksekusi Alat (ACP Permission)</span>
        </div>
        <span class="perm-badge">{toolName}</span>
      </div>

      <div class="perm-modal-body">
        <p class="perm-modal-desc">
          Agen meminta persetujuan untuk menjalankan perintah/alat berikut pada workspace proyek:
        </p>

        <div class="perm-detail-row">
          <span class="perm-detail-label">Alat (Tool):</span>
          <code class="perm-tool-name">{toolName}</code>
        </div>

        {#if commandText}
          <div class="perm-code-section">
            <span class="perm-detail-label">Perintah / Argumen:</span>
            <pre class="perm-cmd-box"><code>{commandText}</code></pre>
          </div>
        {/if}

        {#if reasonText}
          <div class="perm-reason-section">
            <span class="perm-detail-label">Alasan:</span>
            <p class="perm-reason-text">"{reasonText}"</p>
          </div>
        {/if}

        <div class="perm-notice">
          <span>⚠️ Eksekusi aman: Keputusan Anda mengontrol apakah perintah diizinkan berjalan atau ditolak langsung tanpa auto-reject.</span>
        </div>
      </div>

      <div class="perm-modal-actions">
        <button
          type="button"
          class="perm-btn perm-btn-deny"
          onclick={handleDeny}
          disabled={isSubmitting}
          data-testid="perm-btn-deny"
        >
          ✕ Tolak (Deny)
        </button>
        <button
          type="button"
          class="perm-btn perm-btn-allow"
          onclick={handleAllow}
          disabled={isSubmitting}
          data-testid="perm-btn-allow"
        >
          ✓ Izinkan (Allow)
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .perm-modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.65);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
  }

  .perm-modal {
    background: #18191f;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 8px;
    width: 480px;
    max-width: 92vw;
    box-shadow: 0 16px 36px rgba(0, 0, 0, 0.6);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    color: #e2e8f0;
    font-family: inherit;
    outline: none;
  }

  .perm-modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    background: #14151a;
  }

  .perm-modal-title {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    font-weight: 600;
    color: #f1f5f9;
  }

  .perm-modal-icon {
    font-size: 14px;
  }

  .perm-badge {
    font-size: 10.5px;
    font-weight: 600;
    padding: 2px 8px;
    border-radius: 4px;
    background: rgba(245, 158, 11, 0.15);
    color: #fbbf24;
    border: 1px solid rgba(245, 158, 11, 0.3);
  }

  .perm-modal-body {
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .perm-modal-desc {
    margin: 0;
    font-size: 12px;
    color: #94a3b8;
    line-height: 1.45;
  }

  .perm-detail-row {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
  }

  .perm-detail-label {
    font-size: 11px;
    font-weight: 600;
    color: #94a3b8;
    text-transform: uppercase;
    letter-spacing: 0.4px;
  }

  .perm-tool-name {
    font-family: var(--font-mono, monospace);
    font-size: 11.5px;
    color: #38bdf8;
    background: rgba(56, 189, 248, 0.1);
    padding: 2px 6px;
    border-radius: 4px;
    border: 1px solid rgba(56, 189, 248, 0.2);
  }

  .perm-code-section {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .perm-cmd-box {
    margin: 0;
    padding: 10px 12px;
    background: #0f1013;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 6px;
    font-family: var(--font-mono, monospace);
    font-size: 11.5px;
    color: #a5f3fc;
    line-height: 1.45;
    max-height: 160px;
    overflow-y: auto;
    white-space: pre-wrap;
    word-break: break-all;
  }

  .perm-reason-section {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .perm-reason-text {
    margin: 0;
    font-size: 11.5px;
    font-style: italic;
    color: #cbd5e1;
    background: rgba(255, 255, 255, 0.03);
    padding: 6px 10px;
    border-radius: 4px;
    border-left: 2px solid #64748b;
  }

  .perm-notice {
    font-size: 10.5px;
    color: #64748b;
    line-height: 1.35;
    padding: 6px 8px;
    background: rgba(255, 255, 255, 0.02);
    border-radius: 4px;
  }

  .perm-modal-actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 10px;
    padding: 12px 16px;
    background: #14151a;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
  }

  .perm-btn {
    padding: 6px 14px;
    border-radius: 4px;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    border: 1px solid transparent;
    transition: background 0.15s, border-color 0.15s;
  }

  .perm-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .perm-btn-deny {
    background: rgba(239, 68, 68, 0.15);
    color: #fca5a5;
    border-color: rgba(239, 68, 68, 0.3);
  }

  .perm-btn-deny:hover:not(:disabled) {
    background: rgba(239, 68, 68, 0.25);
    color: #fee2e2;
  }

  .perm-btn-allow {
    background: #10b981;
    color: white;
  }

  .perm-btn-allow:hover:not(:disabled) {
    background: #059669;
  }
</style>
