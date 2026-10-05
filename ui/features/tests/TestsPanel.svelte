<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import {
    testStore,
    FLOW_TEMPLATES,
    formatStepStatusIcon,
    formatStepStatusLabel,
    formatDuration,
    formatPassRate,
    type FlowTemplate,
  } from './testStore.svelte';
  import { runStore } from '../run/runStore.svelte';
  import type { Flow, FlowStep, FlowStepStatus } from '../../lib/api';

  let { folderPath = '' }: { folderPath?: string } = $props();

  // Create Modal State
  let isCreateModalOpen = $state(false);
  let formName = $state('');
  let formAppId = $state('com.example.app');
  let formTags = $state('smoke, test');
  let formTemplateId = $state('login-flow-template');
  let formSteps = $state<FlowStep[]>([]);
  let formError = $state<string | null>(null);

  // Screenshot Lightbox Modal
  let expandedScreenshotUrl = $state<string | null>(null);

  onMount(async () => {
    await testStore.loadFlows(folderPath);
  });

  $effect(() => {
    if (folderPath) {
      testStore.loadFlows(folderPath);
    }
  });

  function handleSelectFlow(flow: Flow) {
    testStore.selectFlow(flow);
  }

  async function handleRunFlow() {
    if (!testStore.selectedFlow) return;
    const deviceId = runStore.selectedDevice?.id;
    await testStore.runFlow(testStore.selectedFlow.id, deviceId, folderPath);
  }

  async function handleCancelFlow() {
    if (!testStore.selectedFlow) return;
    await testStore.cancelFlow(testStore.selectedFlow.id);
  }

  function openCreateModal(template?: FlowTemplate) {
    const tpl = template || FLOW_TEMPLATES[0];
    formTemplateId = tpl ? tpl.id : 'custom';
    formName = tpl ? `${tpl.name} Draft` : '';
    formAppId = tpl?.appId || 'com.example.app';
    formTags = tpl ? tpl.tags.join(', ') : 'custom';
    formSteps = tpl ? JSON.parse(JSON.stringify(tpl.steps)) : [
      { id: 'step-1', action: 'launch', description: 'Buka aplikasi', timeoutMs: 10000 }
    ];
    formError = null;
    isCreateModalOpen = true;
  }

  function handleTemplateSelect(e: Event) {
    const target = e.target as HTMLSelectElement;
    const val = target.value;
    formTemplateId = val;
    const found = FLOW_TEMPLATES.find((t) => t.id === val);
    if (found) {
      formName = `${found.name} Draft`;
      formAppId = found.appId || 'com.example.app';
      formTags = found.tags.join(', ');
      formSteps = JSON.parse(JSON.stringify(found.steps));
    }
  }

  function addStepToForm() {
    const newId = `step-${formSteps.length + 1}`;
    formSteps = [
      ...formSteps,
      { id: newId, action: 'tap', selector: '', description: 'Step baru' }
    ];
  }

  function removeStepFromForm(index: number) {
    formSteps = formSteps.filter((_, idx) => idx !== index);
  }

  async function handleSaveNewFlow() {
    if (!formName.trim()) {
      formError = 'Nama flow wajib diisi.';
      return;
    }
    const tagsArray = formTags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);

    try {
      await testStore.createFlow(
        formName.trim(),
        formAppId.trim() || undefined,
        formSteps,
        folderPath
      );
      isCreateModalOpen = false;
    } catch (err: any) {
      formError = err?.message || 'Gagal menyimpan skenario flow.';
    }
  }

  // Lookup step run result for active execution
  function getStepResult(stepId: string): FlowStepStatus | undefined {
    if (!testStore.activeRunResult || !testStore.activeRunResult.stepResults) return undefined;
    return testStore.activeRunResult.stepResults.find((s) => s.stepId === stepId);
  }
</script>

<div class="tests-panel-root">
  <!-- Left Column: Scenarios List -->
  <div class="scenarios-sidebar">
    <div class="sidebar-header">
      <div class="title-row">
        <span class="header-icon">🧪</span>
        <span class="header-title">Automation & Tests</span>
        <span class="flows-count">({testStore.filteredFlows.length})</span>
      </div>
      <div class="header-actions">
        <button class="btn-refresh" onclick={() => testStore.loadFlows(folderPath)} title="Refresh Flow">
          🔄
        </button>
        <button class="btn-new-flow" onclick={() => openCreateModal()} title="Buat Flow Baru">
          + New Flow
        </button>
      </div>
    </div>

    <!-- Search Bar -->
    <div class="search-bar-wrap">
      <input
        type="text"
        class="search-input"
        placeholder="Cari skenario flow (nama, tag, appId)..."
        bind:value={testStore.searchQuery}
      />
    </div>

    <!-- Flows List -->
    <div class="flows-list-scroll">
      {#if testStore.filteredFlows.length === 0}
        <div class="empty-list">
          <span class="empty-icon">📂</span>
          <div class="empty-text">Tidak ada skenario flow</div>
          <button class="btn-create-prompt" onclick={() => openCreateModal()}>
            + Buat Flow Pertama
          </button>
        </div>
      {:else}
        {#each testStore.filteredFlows as flow (flow.id)}
          {@const isSelected = testStore.selectedFlow?.id === flow.id}
          <div
            class="flow-item"
            class:active={isSelected}
            onclick={() => handleSelectFlow(flow)}
            role="button"
            tabindex="0"
            onkeydown={(e) => { if (e.key === 'Enter') handleSelectFlow(flow); }}
          >
            <div class="flow-item-header">
              <span class="flow-name">{flow.name}</span>
              <span class="steps-badge">{flow.steps?.length || 0} steps</span>
            </div>
            <div class="flow-desc">{flow.description}</div>
            <div class="flow-meta">
              {#if flow.appId}
                <span class="app-id-tag">{flow.appId}</span>
              {/if}
              {#each flow.tags as tag}
                <span class="meta-tag">#{tag}</span>
              {/each}
            </div>
          </div>
        {/each}
      {/if}
    </div>
  </div>

  <!-- Right Column: Detail & Execution Canvas -->
  <div class="scenario-detail-canvas">
    {#if testStore.selectedFlow}
      {@const flow = testStore.selectedFlow}
      {@const runRes = testStore.activeRunResult}

      <div class="detail-header">
        <div class="flow-info-col">
          <div class="flow-title-row">
            <h2 class="detail-title">{flow.name}</h2>
            <span class="runner-badge">
              Runner: {runRes?.runner || 'Maestro / ADB'}
            </span>
          </div>
          <p class="detail-description">{flow.description}</p>
          <div class="tags-row">
            <span class="meta-app-label">Target App:</span>
            <code class="meta-app-code">{flow.appId || 'default'}</code>
            {#each flow.tags as tag}
              <span class="detail-tag-pill">#{tag}</span>
            {/each}
          </div>
        </div>

        <div class="action-bar-top">
          {#if testStore.isRunning}
            <button class="btn-cancel-flow" onclick={handleCancelFlow}>
              ⏹ Cancel Run
            </button>
          {:else}
            <button class="btn-run-flow" onclick={handleRunFlow}>
              ▶ Run Scenario
            </button>
          {/if}
          <div class="device-indicator">
            <span class="device-dot">●</span>
            <span class="device-text">{runStore.selectedDevice?.name || 'ADB / Emulator Default'}</span>
          </div>
        </div>
      </div>

      <!-- Execution Status Summary Bar (if run occurred) -->
      {#if runRes && runRes.flowId === flow.id}
        <div class="run-summary-bar" class:success={runRes.success} class:failed={!runRes.success}>
          <div class="summary-left">
            <span class="summary-icon">{runRes.success ? '✅' : '❌'}</span>
            <span class="summary-verdict">
              {runRes.success ? 'Skenario Berhasil Lolos' : 'Skenario Gagal Terdeteksi'}
            </span>
            <span class="summary-rate">
              Passed {runRes.passedSteps}/{runRes.totalSteps} ({formatPassRate(runRes.passedSteps, runRes.totalSteps)})
            </span>
          </div>
          <div class="summary-right">
            <span class="summary-duration">Total Durasi: {formatDuration(runRes.durationMs)}</span>
          </div>
        </div>

        {#if runRes.error}
          <div class="run-error-box">
            <div class="error-box-title">Detail Error:</div>
            <pre class="error-box-body">{runRes.error}</pre>
          </div>
        {/if}
      {/if}

      <!-- Progress Step Checklist -->
      <div class="steps-section">
        <div class="steps-section-header">
          <span class="section-heading">Langkah Pengujian ({flow.steps?.length || 0} Steps)</span>
        </div>

        <div class="steps-checklist">
          {#each flow.steps as step, index (step.id || index)}
            {@const status = getStepResult(step.id)}
            {@const statusKind = testStore.isRunning && !status ? 'running' : (status?.status || 'pending')}
            <div class="step-card" class:passed={statusKind === 'passed'} class:failed={statusKind === 'failed'} class:running={statusKind === 'running'}>
              <div class="step-num">{index + 1}</div>
              <div class="step-status-icon" title={formatStepStatusLabel(statusKind)}>
                {formatStepStatusIcon(statusKind)}
              </div>
              <div class="step-main-content">
                <div class="step-action-row">
                  <span class="step-action-badge">{step.action}</span>
                  {#if step.selector}
                    <code class="step-selector">{step.selector}</code>
                  {/if}
                  {#if step.text}
                    <span class="step-text-val">"{step.text}"</span>
                  {/if}
                  {#if step.key}
                    <span class="step-key-badge">key: {step.key}</span>
                  {/if}
                </div>
                {#if step.description}
                  <div class="step-desc-text">{step.description}</div>
                {/if}
                {#if status?.error}
                  <div class="step-error-msg">⚠️ {status.error}</div>
                {/if}
              </div>
              <div class="step-meta-right">
                {#if status?.durationMs}
                  <span class="step-duration">{formatDuration(status.durationMs)}</span>
                {/if}
              </div>
            </div>
          {/each}
        </div>
      </div>

      <!-- Error Screenshot Preview -->
      {#if runRes?.failureScreenshot || runRes?.stepResults?.some((s) => s.screenshotPath)}
        {@const shotPath = runRes.failureScreenshot || runRes.stepResults.find((s) => s.screenshotPath)?.screenshotPath}
        <div class="screenshot-preview-section">
          <div class="section-heading">📸 Screenshot Bukti Kegagalan</div>
          <div class="screenshot-container">
            <div
              class="screenshot-card"
              role="button"
              tabindex="0"
              onclick={() => { expandedScreenshotUrl = shotPath || null; }}
              onkeydown={(e) => { if (e.key === 'Enter') expandedScreenshotUrl = shotPath || null; }}
            >
              <img src={shotPath} alt="Failure Screenshot" class="screenshot-img" />
              <div class="screenshot-caption">Klik untuk perbesar: {shotPath}</div>
            </div>
          </div>
        </div>
      {/if}

    {:else}
      <!-- Empty Scenario Selection Placeholder -->
      <div class="empty-selection-placeholder">
        <div class="placeholder-icon">🧪</div>
        <div class="placeholder-title">Pilih Skenario Automation</div>
        <div class="placeholder-desc">
          Pilih flow pengujian dari panel sebelah kiri atau klik tombol "+ New Flow" untuk membuat skenario Maestro / ADB baru.
        </div>
        <button class="btn-create-prompt" onclick={() => openCreateModal()}>
          + Buat Skenario Flow
        </button>
      </div>
    {/if}
  </div>
</div>

<!-- Modal: Create Flow Draft -->
{#if isCreateModalOpen}
  <div class="modal-backdrop" onclick={() => (isCreateModalOpen = false)} role="presentation">
    <div
      class="modal-dialog"
      onclick={(e) => e.stopPropagation()}
      role="dialog"
      aria-modal="true"
      tabindex="-1"
    >
      <div class="modal-header">
        <h3 class="modal-title">Buat Skenario Flow Baru</h3>
        <button class="btn-close" onclick={() => (isCreateModalOpen = false)}>✕</button>
      </div>

      <div class="modal-body">
        {#if formError}
          <div class="form-error-alert">{formError}</div>
        {/if}

        <div class="form-group">
          <label for="template-select" class="form-label">Template Skenario:</label>
          <select id="template-select" class="form-select" value={formTemplateId} onchange={handleTemplateSelect}>
            {#each FLOW_TEMPLATES as tpl}
              <option value={tpl.id}>{tpl.name} — {tpl.description}</option>
            {/each}
            <option value="custom">Blank / Custom Flow</option>
          </select>
        </div>

        <div class="form-group">
          <label for="flow-name-input" class="form-label">Nama Flow:</label>
          <input
            id="flow-name-input"
            type="text"
            class="form-input"
            placeholder="Contoh: Checkout Payment Flow"
            bind:value={formName}
          />
        </div>

        <div class="form-group">
          <label for="flow-appid-input" class="form-label">Target App ID (Package / Bundle ID):</label>
          <input
            id="flow-appid-input"
            type="text"
            class="form-input"
            placeholder="Contoh: com.bankjatim.connect"
            bind:value={formAppId}
          />
        </div>

        <div class="form-group">
          <label for="flow-tags-input" class="form-label">Tags (dipisahkan koma):</label>
          <input
            id="flow-tags-input"
            type="text"
            class="form-input"
            placeholder="Contoh: smoke, auth, payment"
            bind:value={formTags}
          />
        </div>

        <div class="form-group">
          <div class="steps-builder-header">
            <span class="form-label">Daftar Steps ({formSteps.length}):</span>
            <button type="button" class="btn-add-step" onclick={addStepToForm}>+ Tambah Step</button>
          </div>

          <div class="steps-builder-list">
            {#each formSteps as step, i}
              <div class="step-builder-row">
                <span class="step-row-num">{i + 1}</span>
                <select class="step-select-action" bind:value={step.action}>
                  <option value="launch">launch</option>
                  <option value="tap">tap</option>
                  <option value="input">input</option>
                  <option value="assert_visible">assert_visible</option>
                  <option value="back">back</option>
                  <option value="wait">wait</option>
                </select>
                <input
                  type="text"
                  class="step-input-selector"
                  placeholder="Selector / Text"
                  bind:value={step.selector}
                />
                {#if step.action === 'input'}
                  <input
                    type="text"
                    class="step-input-text"
                    placeholder="Input Text"
                    bind:value={step.text}
                  />
                {/if}
                <button
                  type="button"
                  class="btn-remove-step"
                  onclick={() => removeStepFromForm(i)}
                  title="Hapus step"
                >
                  ✕
                </button>
              </div>
            {/each}
          </div>
        </div>
      </div>

      <div class="modal-footer">
        <button class="btn-secondary" onclick={() => (isCreateModalOpen = false)}>
          Batal
        </button>
        <button class="btn-primary" onclick={handleSaveNewFlow}>
          Simpan Skenario
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- Screenshot Expanded Lightbox -->
{#if expandedScreenshotUrl}
  <div class="lightbox-backdrop" onclick={() => (expandedScreenshotUrl = null)} role="presentation">
    <div class="lightbox-content" onclick={(e) => e.stopPropagation()} role="dialog" tabindex="-1">
      <button class="lightbox-close" onclick={() => (expandedScreenshotUrl = null)}>✕</button>
      <img src={expandedScreenshotUrl} alt="Expanded Screenshot" class="lightbox-img" />
      <div class="lightbox-path">{expandedScreenshotUrl}</div>
    </div>
  </div>
{/if}

<style>
  .tests-panel-root {
    display: flex;
    width: 100%;
    height: 100%;
    background: #0f1013;
    color: #e6e7ea;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    overflow: hidden;
  }

  /* Left Column: Sidebar */
  .scenarios-sidebar {
    width: 320px;
    min-width: 280px;
    max-width: 360px;
    background: #14151a;
    border-right: 1px solid rgba(255, 255, 255, 0.08);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .sidebar-header {
    padding: 12px 14px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .title-row {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .header-icon {
    font-size: 16px;
  }

  .header-title {
    font-size: 13px;
    font-weight: 600;
    color: #ffffff;
  }

  .flows-count {
    font-size: 12px;
    color: #8b8f98;
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .btn-refresh {
    background: transparent;
    border: none;
    cursor: pointer;
    font-size: 13px;
    padding: 3px 6px;
    border-radius: 4px;
    color: #a0a4ae;
    transition: background 0.15s;
  }
  .btn-refresh:hover {
    background: rgba(255, 255, 255, 0.08);
  }

  .btn-new-flow {
    background: #2563eb;
    color: #ffffff;
    border: none;
    border-radius: 4px;
    padding: 4px 8px;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s;
  }
  .btn-new-flow:hover {
    background: #1d4ed8;
  }

  .search-bar-wrap {
    padding: 8px 12px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  }

  .search-input {
    width: 100%;
    box-sizing: border-box;
    background: #1b1c22;
    border: 1px solid rgba(255, 255, 255, 0.1);
    color: #e6e7ea;
    border-radius: 6px;
    padding: 6px 10px;
    font-size: 12px;
    outline: none;
  }
  .search-input:focus {
    border-color: #3b82f6;
  }

  .flows-list-scroll {
    flex: 1;
    overflow-y: auto;
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .empty-list {
    text-align: center;
    padding: 40px 16px;
    color: #8b8f98;
  }
  .empty-icon {
    font-size: 32px;
    display: block;
    margin-bottom: 8px;
  }
  .empty-text {
    font-size: 13px;
    margin-bottom: 12px;
  }

  .flow-item {
    background: #191b22;
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 6px;
    padding: 10px;
    cursor: pointer;
    transition: all 0.15s ease;
  }
  .flow-item:hover {
    background: #20232c;
    border-color: rgba(255, 255, 255, 0.15);
  }
  .flow-item.active {
    background: #1e2638;
    border-color: #3b82f6;
  }

  .flow-item-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 4px;
  }

  .flow-name {
    font-size: 13px;
    font-weight: 600;
    color: #f1f2f4;
  }

  .steps-badge {
    font-size: 11px;
    background: rgba(255, 255, 255, 0.08);
    color: #8b8f98;
    padding: 1px 6px;
    border-radius: 10px;
  }

  .flow-desc {
    font-size: 11px;
    color: #8b8f98;
    margin-bottom: 6px;
    line-height: 1.3;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .flow-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }

  .app-id-tag {
    font-size: 10px;
    font-family: monospace;
    background: #242936;
    color: #93c5fd;
    padding: 1px 5px;
    border-radius: 4px;
  }

  .meta-tag {
    font-size: 10px;
    color: #a0a4ae;
    background: rgba(255, 255, 255, 0.04);
    padding: 1px 5px;
    border-radius: 4px;
  }

  /* Right Column: Detail Canvas */
  .scenario-detail-canvas {
    flex: 1;
    overflow-y: auto;
    padding: 20px 24px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .detail-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 16px;
    padding-bottom: 14px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  }

  .flow-title-row {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 4px;
  }

  .detail-title {
    margin: 0;
    font-size: 20px;
    font-weight: 700;
    color: #ffffff;
  }

  .runner-badge {
    font-size: 11px;
    font-weight: 500;
    background: #1e293b;
    color: #38bdf8;
    border: 1px solid rgba(56, 189, 248, 0.25);
    padding: 2px 8px;
    border-radius: 12px;
  }

  .detail-description {
    margin: 4px 0 8px 0;
    font-size: 13px;
    color: #9ca3af;
  }

  .tags-row {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
  }

  .meta-app-label {
    color: #6b7280;
  }

  .meta-app-code {
    background: #1f2430;
    color: #60a5fa;
    padding: 1px 6px;
    border-radius: 4px;
    font-size: 11px;
  }

  .detail-tag-pill {
    background: rgba(255, 255, 255, 0.06);
    color: #9ca3af;
    padding: 1px 6px;
    border-radius: 4px;
    font-size: 11px;
  }

  .action-bar-top {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 8px;
  }

  .btn-run-flow {
    background: #16a34a;
    color: #ffffff;
    border: none;
    border-radius: 6px;
    padding: 8px 16px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s ease;
  }
  .btn-run-flow:hover {
    background: #15803d;
  }

  .btn-cancel-flow {
    background: #dc2626;
    color: #ffffff;
    border: none;
    border-radius: 6px;
    padding: 8px 16px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s ease;
  }
  .btn-cancel-flow:hover {
    background: #b91c1c;
  }

  .device-indicator {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    color: #8b8f98;
  }

  .device-dot {
    color: #22c55e;
    font-size: 10px;
  }

  /* Run Summary Bar */
  .run-summary-bar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 10px 14px;
    border-radius: 6px;
    font-size: 13px;
    border: 1px solid transparent;
  }
  .run-summary-bar.success {
    background: rgba(34, 197, 94, 0.12);
    border-color: rgba(34, 197, 94, 0.25);
    color: #4ade80;
  }
  .run-summary-bar.failed {
    background: rgba(239, 68, 68, 0.12);
    border-color: rgba(239, 68, 68, 0.25);
    color: #f87171;
  }

  .summary-left {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .summary-verdict {
    font-weight: 600;
  }

  .summary-rate {
    opacity: 0.9;
  }

  .summary-duration {
    font-size: 12px;
    color: #9ca3af;
  }

  .run-error-box {
    background: #241416;
    border: 1px solid rgba(239, 68, 68, 0.3);
    border-radius: 6px;
    padding: 12px;
  }
  .error-box-title {
    font-size: 12px;
    font-weight: 600;
    color: #fca5a5;
    margin-bottom: 4px;
  }
  .error-box-body {
    margin: 0;
    font-family: monospace;
    font-size: 11px;
    color: #fecaca;
    white-space: pre-wrap;
  }

  /* Steps Section */
  .steps-section {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .section-heading {
    font-size: 14px;
    font-weight: 600;
    color: #d1d5db;
  }

  .steps-checklist {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .step-card {
    display: flex;
    align-items: center;
    gap: 12px;
    background: #181920;
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 6px;
    padding: 10px 14px;
    transition: all 0.15s;
  }
  .step-card.passed {
    border-left: 3px solid #22c55e;
  }
  .step-card.failed {
    border-left: 3px solid #ef4444;
    background: #1d171a;
  }
  .step-card.running {
    border-left: 3px solid #3b82f6;
  }

  .step-num {
    font-size: 12px;
    font-weight: bold;
    color: #6b7280;
    min-width: 18px;
  }

  .step-status-icon {
    font-size: 16px;
  }

  .step-main-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .step-action-row {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .step-action-badge {
    background: #262933;
    color: #e5e7eb;
    font-size: 11px;
    font-weight: 600;
    padding: 2px 6px;
    border-radius: 4px;
    text-transform: uppercase;
  }

  .step-selector {
    background: #111317;
    color: #a5b4fc;
    font-size: 11px;
    padding: 2px 6px;
    border-radius: 4px;
  }

  .step-text-val {
    font-size: 12px;
    color: #86efac;
  }

  .step-key-badge {
    font-size: 11px;
    background: #1e293b;
    color: #cbd5e1;
    padding: 2px 6px;
    border-radius: 4px;
  }

  .step-desc-text {
    font-size: 12px;
    color: #9ca3af;
  }

  .step-error-msg {
    font-size: 11px;
    color: #f87171;
    font-weight: 500;
  }

  .step-meta-right {
    font-size: 11px;
    color: #6b7280;
  }

  /* Screenshot preview */
  .screenshot-preview-section {
    margin-top: 10px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .screenshot-container {
    background: #181920;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 8px;
    padding: 12px;
    display: inline-block;
  }

  .screenshot-card {
    display: flex;
    flex-direction: column;
    gap: 6px;
    cursor: pointer;
  }

  .screenshot-img {
    max-width: 320px;
    max-height: 240px;
    border-radius: 6px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    object-fit: contain;
    background: #000;
  }

  .screenshot-caption {
    font-size: 11px;
    color: #9ca3af;
  }

  /* Empty placeholder */
  .empty-selection-placeholder {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: 40px;
    color: #6b7280;
  }

  .placeholder-icon {
    font-size: 48px;
    margin-bottom: 12px;
  }

  .placeholder-title {
    font-size: 18px;
    font-weight: 600;
    color: #e5e7eb;
    margin-bottom: 6px;
  }

  .placeholder-desc {
    font-size: 13px;
    max-width: 440px;
    margin-bottom: 16px;
    line-height: 1.4;
  }

  .btn-create-prompt {
    background: #2563eb;
    color: #ffffff;
    border: none;
    border-radius: 6px;
    padding: 8px 16px;
    font-size: 13px;
    cursor: pointer;
    transition: background 0.15s;
  }
  .btn-create-prompt:hover {
    background: #1d4ed8;
  }

  /* Modal Form */
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.75);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }

  .modal-dialog {
    background: #191b22;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 10px;
    width: 600px;
    max-width: 90vw;
    max-height: 85vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
  }

  .modal-header {
    padding: 14px 18px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .modal-title {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
    color: #ffffff;
  }

  .btn-close {
    background: transparent;
    border: none;
    color: #8b8f98;
    font-size: 16px;
    cursor: pointer;
  }

  .modal-body {
    padding: 16px 18px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .form-error-alert {
    background: rgba(239, 68, 68, 0.15);
    border: 1px solid rgba(239, 68, 68, 0.3);
    color: #fca5a5;
    padding: 8px 12px;
    border-radius: 6px;
    font-size: 12px;
  }

  .form-group {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .form-label {
    font-size: 12px;
    font-weight: 500;
    color: #c9d1d9;
  }

  .form-select,
  .form-input {
    background: #121317;
    border: 1px solid rgba(255, 255, 255, 0.1);
    color: #e6e7ea;
    border-radius: 6px;
    padding: 7px 10px;
    font-size: 12px;
    outline: none;
  }
  .form-select:focus,
  .form-input:focus {
    border-color: #3b82f6;
  }

  .steps-builder-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .btn-add-step {
    background: #1f2937;
    border: 1px solid rgba(255, 255, 255, 0.1);
    color: #93c5fd;
    padding: 3px 8px;
    border-radius: 4px;
    font-size: 11px;
    cursor: pointer;
  }

  .steps-builder-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
    max-height: 200px;
    overflow-y: auto;
    padding-right: 4px;
  }

  .step-builder-row {
    display: flex;
    align-items: center;
    gap: 6px;
    background: #131418;
    padding: 6px 8px;
    border-radius: 6px;
    border: 1px solid rgba(255, 255, 255, 0.05);
  }

  .step-row-num {
    font-size: 11px;
    color: #6b7280;
    width: 16px;
  }

  .step-select-action {
    background: #1e222a;
    border: 1px solid rgba(255, 255, 255, 0.1);
    color: #e6e7ea;
    padding: 4px 6px;
    font-size: 11px;
    border-radius: 4px;
  }

  .step-input-selector,
  .step-input-text {
    flex: 1;
    background: #1e222a;
    border: 1px solid rgba(255, 255, 255, 0.1);
    color: #e6e7ea;
    padding: 4px 8px;
    font-size: 11px;
    border-radius: 4px;
  }

  .btn-remove-step {
    background: transparent;
    border: none;
    color: #ef4444;
    cursor: pointer;
    font-size: 12px;
    padding: 2px 4px;
  }

  .modal-footer {
    padding: 12px 18px;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }

  .btn-secondary {
    background: #21262d;
    border: 1px solid rgba(255, 255, 255, 0.1);
    color: #c9d1d9;
    padding: 6px 14px;
    border-radius: 6px;
    font-size: 12px;
    cursor: pointer;
  }

  .btn-primary {
    background: #2563eb;
    border: none;
    color: #ffffff;
    padding: 6px 14px;
    border-radius: 6px;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
  }

  /* Lightbox */
  .lightbox-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.85);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 2000;
  }

  .lightbox-content {
    position: relative;
    max-width: 90vw;
    max-height: 90vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
  }

  .lightbox-close {
    position: absolute;
    top: -30px;
    right: 0;
    background: transparent;
    border: none;
    color: #fff;
    font-size: 20px;
    cursor: pointer;
  }

  .lightbox-img {
    max-width: 100%;
    max-height: 80vh;
    border-radius: 8px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.8);
  }

  .lightbox-path {
    font-size: 12px;
    color: #9ca3af;
    font-family: monospace;
  }
</style>
