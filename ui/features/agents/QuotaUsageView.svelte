<script lang="ts">
  import { onMount } from 'svelte';
  import { agentsStore } from './agents.svelte';
  import { formatTokens, formatCostUsd } from './agentsLogic';

  let quotaReport = $derived(agentsStore.quotaReport);
  let isLoading = $derived(agentsStore.isQuotaLoading);
  let error = $derived(agentsStore.quotaError);

  let totalTokens = $derived(
    (quotaReport?.todayPromptTokens ?? 0) + (quotaReport?.todayCompletionTokens ?? 0)
  );

  onMount(async () => {
    await agentsStore.loadQuotaReport();
  });

  async function handleRefresh() {
    await agentsStore.loadQuotaReport(true);
  }
</script>

<div class="quota-usage-view">
  <!-- Top Bar: Proxy Status & Refresh Button -->
  <div class="status-bar-header">
    <div class="proxy-status">
      {#if quotaReport?.proxyOnline}
        <span class="proxy-badge online">
          <span class="dot">●</span> Proxy 9Router Aktif (127.0.0.1:20128)
        </span>
      {:else}
        <span class="proxy-badge offline">
          <span class="dot">○</span> Proxy Offline
        </span>
      {/if}
    </div>

    <button
      class="refresh-btn"
      onclick={handleRefresh}
      disabled={isLoading}
      title="Segarkan data kuota & token 9Router"
    >
      <span class="refresh-icon" class:spin={isLoading}>🔄</span>
      <span class="refresh-label">Segarkan Data</span>
    </button>
  </div>

  <!-- Honest Data Warning Banner if DB not found -->
  {#if quotaReport && !quotaReport.dbFound}
    <div class="db-missing-banner" role="alert">
      <span class="banner-icon">ℹ️</span>
      <div class="banner-content">
        <div class="banner-title">Database kuota 9Router tidak ditemukan di ~/.9router/db/data.sqlite</div>
        <div class="banner-sub">Menampilkan status tanpa angka fiktif. Pastikan 9Router berjalan dan database telah dibuat.</div>
      </div>
    </div>
  {/if}

  {#if error}
    <div class="error-banner" role="alert">
      <span class="banner-icon">⚠️</span>
      <span class="banner-text">{error}</span>
    </div>
  {/if}

  <!-- Today Token Summary -->
  <div class="section-card">
    <div class="section-header">
      <span class="section-title">Ringkasan Token Hari Ini</span>
      {#if quotaReport?.todayDate}
        <span class="date-badge">{quotaReport.todayDate}</span>
      {/if}
    </div>

    <div class="metrics-grid">
      <div class="metric-card">
        <div class="metric-label">Requests</div>
        <div class="metric-value">{formatTokens(quotaReport?.todayRequests ?? 0)}</div>
      </div>

      <div class="metric-card">
        <div class="metric-label">Prompt Tokens</div>
        <div class="metric-value">{formatTokens(quotaReport?.todayPromptTokens ?? 0)}</div>
      </div>

      <div class="metric-card">
        <div class="metric-label">Completion Tokens</div>
        <div class="metric-value">{formatTokens(quotaReport?.todayCompletionTokens ?? 0)}</div>
      </div>

      <div class="metric-card highlight">
        <div class="metric-label">Total Tokens</div>
        <div class="metric-value">{formatTokens(totalTokens)}</div>
      </div>

      <div class="metric-card cost">
        <div class="metric-label">Estimasi Biaya USD</div>
        <div class="metric-value">{formatCostUsd(quotaReport?.todayCost ?? 0)}</div>
      </div>
    </div>
  </div>

  <!-- Provider Connections List -->
  <div class="section-card providers-section">
    <div class="section-header">
      <span class="section-title">
        Daftar Provider Connections
        <span class="count-pill">{quotaReport?.providers?.length ?? 0}</span>
      </span>
    </div>

    {#if !quotaReport?.providers || quotaReport.providers.length === 0}
      <div class="empty-providers">
        {#if quotaReport?.dbFound === false}
          <span>Data koneksi provider tidak tersedia (database 9Router belum terdeteksi).</span>
        {:else}
          <span>Belum ada koneksi provider yang terdaftar di 9Router.</span>
        {/if}
      </div>
    {:else}
      <div class="providers-list">
        {#each quotaReport.providers as provider (provider.id)}
          <div class="provider-item" class:inactive={!provider.isActive}>
            <div class="provider-top">
              <div class="provider-main-info">
                <span class="provider-name">{provider.name || provider.provider}</span>
                <span class="provider-id">{provider.id}</span>
              </div>
              <span
                class="status-pill"
                class:active={provider.isActive}
                class:inactive={!provider.isActive}
              >
                {provider.isActive ? 'Aktif' : 'Tidak Aktif'}
              </span>
            </div>

            <!-- Rate Limit Alert -->
            {#if provider.rateLimitedUntil}
              <div class="rate-limit-badge">
                <span class="badge-icon">⏳</span>
                <span>Rate limited sampai: {provider.rateLimitedUntil}</span>
              </div>
            {/if}

            <!-- Last Error Alert -->
            {#if provider.lastError}
              <div class="last-error-badge">
                <span class="badge-icon">⚠️</span>
                <span class="error-msg">{provider.lastError}</span>
              </div>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>

<style>
  .quota-usage-view {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 12px;
    height: 100%;
    overflow-y: auto;
    background: #141518;
    color: #e6edf3;
    font-size: 12px;
  }

  /* Header Bar */
  .status-bar-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    flex-wrap: wrap;
    background: #18191f;
    border: 1px solid #282a33;
    border-radius: 6px;
    padding: 8px 10px;
  }

  .proxy-status {
    display: flex;
    align-items: center;
  }

  .proxy-badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    font-weight: 500;
    padding: 2px 6px;
    border-radius: 4px;
  }

  .proxy-badge.online {
    background: rgba(46, 160, 67, 0.15);
    color: #3fb950;
    border: 1px solid rgba(46, 160, 67, 0.3);
  }

  .proxy-badge.offline {
    background: rgba(248, 81, 73, 0.12);
    color: #f85149;
    border: 1px solid rgba(248, 81, 73, 0.25);
  }

  .dot {
    font-size: 9px;
  }

  .refresh-btn {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    background: #21242d;
    color: #c9d1d9;
    border: 1px solid #30363d;
    border-radius: 4px;
    padding: 4px 8px;
    font-size: 11px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s;
  }

  .refresh-btn:hover:not(:disabled) {
    background: #2b303c;
    color: #ffffff;
    border-color: #58a6ff;
  }

  .refresh-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .refresh-icon.spin {
    display: inline-block;
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  /* Missing DB Banner */
  .db-missing-banner {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    background: rgba(210, 153, 34, 0.12);
    border: 1px solid rgba(210, 153, 34, 0.3);
    border-radius: 6px;
    padding: 8px 10px;
    color: #d29922;
  }

  .banner-icon {
    font-size: 13px;
    flex-shrink: 0;
  }

  .banner-content {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .banner-title {
    font-weight: 600;
    font-size: 11px;
  }

  .banner-sub {
    font-size: 10.5px;
    color: #c9d1d9;
    opacity: 0.85;
  }

  .error-banner {
    display: flex;
    align-items: center;
    gap: 6px;
    background: rgba(248, 81, 73, 0.15);
    border: 1px solid rgba(248, 81, 73, 0.3);
    border-radius: 6px;
    padding: 6px 10px;
    color: #f85149;
    font-size: 11px;
  }

  /* Section Cards */
  .section-card {
    display: flex;
    flex-direction: column;
    gap: 8px;
    background: #18191f;
    border: 1px solid #282a33;
    border-radius: 6px;
    padding: 10px;
  }

  .section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .section-title {
    font-size: 11.5px;
    font-weight: 600;
    color: #8b949e;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .date-badge {
    font-size: 10px;
    background: #21262d;
    color: #8b949e;
    padding: 1px 6px;
    border-radius: 4px;
    border: 1px solid #30363d;
  }

  .count-pill {
    background: #252833;
    color: #79c0ff;
    font-size: 10px;
    padding: 1px 6px;
    border-radius: 10px;
  }

  /* Metrics Grid */
  .metrics-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
    gap: 6px;
  }

  .metric-card {
    background: #121316;
    border: 1px solid #21242c;
    border-radius: 4px;
    padding: 6px 8px;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .metric-card.highlight {
    border-color: rgba(110, 168, 255, 0.3);
    background: rgba(110, 168, 255, 0.05);
  }

  .metric-card.cost {
    border-color: rgba(63, 185, 80, 0.3);
    background: rgba(63, 185, 80, 0.05);
  }

  .metric-label {
    font-size: 10px;
    color: #8b949e;
  }

  .metric-value {
    font-size: 13px;
    font-weight: 700;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    color: #f0f6fc;
  }

  .metric-card.highlight .metric-value {
    color: #79c0ff;
  }

  .metric-card.cost .metric-value {
    color: #3fb950;
  }

  /* Providers List */
  .empty-providers {
    padding: 12px 8px;
    text-align: center;
    color: #8b949e;
    font-size: 11px;
    background: #121316;
    border-radius: 4px;
  }

  .providers-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .provider-item {
    background: #121316;
    border: 1px solid #21242c;
    border-radius: 5px;
    padding: 8px 10px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    transition: border-color 0.12s;
  }

  .provider-item:hover {
    border-color: #30363d;
  }

  .provider-item.inactive {
    opacity: 0.75;
  }

  .provider-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .provider-main-info {
    display: flex;
    align-items: center;
    gap: 6px;
    overflow: hidden;
  }

  .provider-name {
    font-size: 12px;
    font-weight: 600;
    color: #e6edf3;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .provider-id {
    font-size: 10px;
    color: #8b949e;
    background: #1c1e24;
    padding: 1px 4px;
    border-radius: 3px;
    border: 1px solid #282a33;
  }

  .status-pill {
    font-size: 10px;
    font-weight: 600;
    padding: 1px 6px;
    border-radius: 10px;
    white-space: nowrap;
  }

  .status-pill.active {
    background: rgba(46, 160, 67, 0.15);
    color: #3fb950;
    border: 1px solid rgba(46, 160, 67, 0.3);
  }

  .status-pill.inactive {
    background: rgba(139, 148, 158, 0.15);
    color: #8b949e;
    border: 1px solid rgba(139, 148, 158, 0.25);
  }

  .rate-limit-badge {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 10.5px;
    color: #d29922;
    background: rgba(210, 153, 34, 0.1);
    border: 1px solid rgba(210, 153, 34, 0.2);
    border-radius: 4px;
    padding: 3px 6px;
  }

  .last-error-badge {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 10.5px;
    color: #f85149;
    background: rgba(248, 81, 73, 0.1);
    border: 1px solid rgba(248, 81, 73, 0.2);
    border-radius: 4px;
    padding: 3px 6px;
    overflow: hidden;
  }

  .badge-icon {
    font-size: 11px;
    flex-shrink: 0;
  }

  .error-msg {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
