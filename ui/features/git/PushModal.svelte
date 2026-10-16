<script lang="ts">
  import { gitStore } from './git.svelte';

  let pushRemoteName = $state('origin');
  let pushBranchName = $state('');
  let pushSetUpstream = $state(false);
  let pushForceWithLease = $state(false);
  let pushLoading = $state(false);
  let pushError = $state<string | null>(null);

  $effect(() => {
    if (gitStore.isPushModalOpen) {
      pushBranchName = gitStore.pushTargetBranch || gitStore.branch?.head || gitStore.currentBranch || 'main';
      pushRemoteName = gitStore.remotes[0]?.name || 'origin';

      const upstream =
        gitStore.branches?.local?.find((b) => b.name === pushBranchName)?.upstream ||
        gitStore.branch?.upstream;
      pushSetUpstream = !upstream;

      pushForceWithLease = false;
      pushError = null;
    }
  });

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      gitStore.closePushModal();
    }
  }

  async function submitPush() {
    pushLoading = true;
    pushError = null;
    try {
      await gitStore.pushRemote(
        pushRemoteName,
        pushBranchName,
        pushSetUpstream,
        pushForceWithLease
      );
      gitStore.closePushModal();
    } catch (e: any) {
      pushError = String(e?.message || e);
    } finally {
      pushLoading = false;
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="push-modal-backdrop" onclick={() => gitStore.closePushModal()} role="presentation">
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div class="push-modal" onclick={(e) => e.stopPropagation()} role="dialog" tabindex="-1">
    <div class="push-modal-header">
      <span>Push to Remote</span>
      <button class="push-close" onclick={() => gitStore.closePushModal()}>✕</button>
    </div>

    {#if pushError}
      <div class="push-error-banner">
        {pushError}
      </div>
    {/if}

    <div class="push-modal-body">
      <div class="form-row">
        <label for="push-remote-select" class="form-label">REMOTE</label>
        <select id="push-remote-select" class="form-select" bind:value={pushRemoteName}>
          {#if gitStore.remotes.length === 0}
            <option value="origin">origin</option>
          {:else}
            {#each gitStore.remotes as r}
              <option value={r.name}>{r.name} ({r.pushUrl || r.fetchUrl || ''})</option>
            {/each}
          {/if}
        </select>
      </div>

      <div class="form-row">
        <label for="push-branch-input" class="form-label">BRANCH</label>
        <input
          id="push-branch-input"
          type="text"
          class="form-input mono"
          bind:value={pushBranchName}
          placeholder="Branch name..."
        />
      </div>

      <label class="push-check-lbl">
        <input type="checkbox" bind:checked={pushSetUpstream} />
        <span>Set upstream (-u)</span>
      </label>

      <label class="push-check-lbl danger-lbl">
        <input type="checkbox" bind:checked={pushForceWithLease} />
        <span style="color: #f0a6a2; font-weight: 500;">Force with lease (--force-with-lease)</span>
      </label>

      {#if pushForceWithLease}
        <div class="push-force-warning">
          ⚠️ PERINGATAN: Force push akan menimpa commit di remote repository. Pastikan rekan tim mengetahui hal ini!
        </div>
      {/if}
    </div>

    <div class="push-modal-footer">
      <button class="modal-btn cancel" onclick={() => gitStore.closePushModal()}>Cancel</button>
      <button
        class="modal-btn confirm"
        class:danger-btn={pushForceWithLease}
        onclick={submitPush}
        disabled={pushLoading || !pushBranchName.trim()}
      >
        {pushLoading ? 'Pushing…' : pushForceWithLease ? 'Force Push' : 'Push'}
      </button>
    </div>
  </div>
</div>

<style>
  .push-modal-backdrop {
    position: fixed;
    inset: 0;
    z-index: 1500;
    background: rgba(0, 0, 0, 0.65);
    display: flex;
    align-items: center;
    justify-content: center;
    backdrop-filter: blur(2px);
  }

  .push-modal {
    width: 460px;
    max-width: 90vw;
    background: #1c1d22;
    border: 1px solid #34363d;
    border-radius: 10px;
    box-shadow: 0 20px 50px rgba(0, 0, 0, 0.6);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .push-modal-header {
    height: 48px;
    padding: 0 18px;
    display: flex;
    align-items: center;
    border-bottom: 1px solid #2a2c32;
    font-weight: 600;
    font-size: 14px;
    color: #e6e7ea;
  }

  .push-close {
    margin-left: auto;
    background: none;
    border: none;
    color: #8b8f98;
    cursor: pointer;
    font-size: 13px;
  }

  .push-close:hover {
    color: #ffffff;
  }

  .push-error-banner {
    padding: 8px 18px;
    background: #381a1a;
    color: #f0a6a2;
    font-size: 12px;
    border-bottom: 1px solid #4a2222;
  }

  .push-modal-body {
    padding: 16px 18px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .form-row {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .form-label {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.8px;
    color: #8b8f98;
  }

  .form-select, .form-input {
    width: 100%;
    box-sizing: border-box;
    height: 32px;
    background: #141518;
    border: 1px solid #2c2e34;
    border-radius: 6px;
    padding: 0 10px;
    color: #d8d9dc;
    font-size: 12.5px;
    outline: none;
  }

  .mono {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  }

  .push-check-lbl {
    display: flex;
    align-items: center;
    gap: 8px;
    color: #b9bcc3;
    font-size: 12.5px;
    cursor: pointer;
  }

  .push-force-warning {
    padding: 8px 12px;
    border-radius: 6px;
    background: #331a1a;
    border: 1px solid #5a2222;
    color: #f0a6a2;
    font-size: 11.5px;
    line-height: 17px;
  }

  .push-modal-footer {
    height: 52px;
    padding: 0 18px;
    background: #18191d;
    border-top: 1px solid #2a2c32;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
  }

  .modal-btn {
    height: 32px;
    padding: 0 14px;
    border-radius: 6px;
    font-size: 12.5px;
    cursor: pointer;
    border: none;
    transition: all 0.15s;
  }

  .modal-btn.cancel {
    background: transparent;
    color: #b9bcc3;
    border: 1px solid #2c2e34;
  }

  .modal-btn.cancel:hover {
    background: #25272e;
    color: #ffffff;
  }

  .modal-btn.confirm {
    background: #2a3a55;
    color: #cfe0ff;
    font-weight: 500;
  }

  .modal-btn.confirm:hover:not(:disabled) {
    background: #364b6e;
    color: #ffffff;
  }

  .modal-btn.confirm:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .modal-btn.danger-btn {
    background: #8a2424;
    color: #ffffff;
    font-weight: 600;
  }

  .modal-btn.danger-btn:hover:not(:disabled) {
    background: #a82e2e;
  }
</style>
