<script lang="ts">
  import { api, type PubActionResult } from '../../lib/api.ts';

  let {
    filePath = '',
    projectRoot = '',
    onStatusChange,
  } = $props<{
    filePath?: string;
    projectRoot?: string;
    onStatusChange?: (statusText: string) => void;
  }>();

  let loadingAction = $state<string | null>(null);
  let feedbackMessage = $state<string | null>(null);
  let feedbackIsError = $state<boolean>(false);
  let feedbackTimer: any = null;

  function showFeedback(msg: string, isError: boolean = false) {
    feedbackMessage = msg;
    feedbackIsError = isError;
    onStatusChange?.(msg);
    if (feedbackTimer) clearTimeout(feedbackTimer);
    feedbackTimer = setTimeout(() => {
      feedbackMessage = null;
    }, 6000);
  }

  export async function runPubAction(action: 'get' | 'upgrade' | 'outdated') {
    if (loadingAction) return;
    loadingAction = action;
    const label = `flutter pub ${action}`;
    showFeedback(`Running ${label}...`, false);

    try {
      const root = projectRoot || (filePath.includes('/') ? filePath.substring(0, filePath.lastIndexOf('/')) : '.');
      const res: PubActionResult = await api.flutterPubAction(root, action);
      if (res.exit_code === 0) {
        showFeedback(`${label} completed successfully`, false);
      } else {
        const errDetail = res.stderr.trim() || res.stdout.trim() || `Exit code ${res.exit_code}`;
        showFeedback(`${label} failed: ${errDetail.slice(0, 100)}`, true);
      }
    } catch (err: any) {
      showFeedback(`${label} error: ${err?.message || String(err)}`, true);
    } finally {
      loadingAction = null;
    }
  }
</script>

<div class="pubspec-action-bar">
  <div class="pubspec-actions">
    <button
      class="pub-btn"
      disabled={loadingAction !== null}
      onclick={() => runPubAction('get')}
      title="Run flutter pub get"
    >
      {#if loadingAction === 'get'}
        <span class="spinner"></span>
      {:else}
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <polyline points="7 10 12 15 17 10"></polyline>
          <line x1="12" y1="15" x2="12" y2="3"></line>
        </svg>
      {/if}
      <span>Pub get</span>
    </button>

    <button
      class="pub-btn"
      disabled={loadingAction !== null}
      onclick={() => runPubAction('upgrade')}
      title="Run flutter pub upgrade"
    >
      {#if loadingAction === 'upgrade'}
        <span class="spinner"></span>
      {:else}
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"></path>
        </svg>
      {/if}
      <span>Pub upgrade</span>
    </button>

    <button
      class="pub-btn"
      disabled={loadingAction !== null}
      onclick={() => runPubAction('outdated')}
      title="Run flutter pub outdated"
    >
      {#if loadingAction === 'outdated'}
        <span class="spinner"></span>
      {:else}
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <circle cx="12" cy="12" r="10"></circle>
          <polyline points="12 6 12 12 14 14"></polyline>
        </svg>
      {/if}
      <span>Pub outdated</span>
    </button>
  </div>

  {#if feedbackMessage}
    <div class="pubspec-feedback" class:error={feedbackIsError} title={feedbackMessage}>
      {#if feedbackIsError}
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#f07a74" stroke-width="2" stroke-linecap="round">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="12" y1="8" x2="12" y2="12"></line>
          <line x1="12" y1="16" x2="12.01" y2="16"></line>
        </svg>
      {:else if loadingAction}
        <span class="mini-spinner"></span>
      {:else}
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" stroke-width="2" stroke-linecap="round">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
      {/if}
      <span class="feedback-text">{feedbackMessage}</span>
    </div>
  {/if}
</div>

<style>
  .pubspec-action-bar {
    height: 32px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 16px;
    background: #2b2d30;
    border-bottom: 1px solid #383a40;
    font-size: 12px;
    user-select: none;
    z-index: 10;
  }

  .pubspec-actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .pub-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 3px 10px;
    background: #313338;
    border: 1px solid #383a40;
    border-radius: 4px;
    color: #dfe1e5;
    font-size: 11px;
    font-weight: 500;
    font-family: 'JetBrains Mono', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s, color 0.15s;
  }

  .pub-btn:hover:not(:disabled) {
    background: #383a40;
    color: #ffffff;
    border-color: #4e5157;
  }

  .pub-btn:active:not(:disabled) {
    background: #26282b;
  }

  .pub-btn:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .spinner,
  .mini-spinner {
    width: 11px;
    height: 11px;
    border: 2px solid rgba(255, 255, 255, 0.2);
    border-top-color: #6ea8ff;
    border-radius: 50%;
    animation: pub-spin 0.8s linear infinite;
    display: inline-block;
  }

  @keyframes pub-spin {
    to {
      transform: rotate(360deg);
    }
  }

  .pubspec-feedback {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    color: #8b8f98;
    max-width: 50%;
    overflow: hidden;
  }

  .pubspec-feedback.error {
    color: #f07a74;
  }

  .feedback-text {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
