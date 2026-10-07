<script lang="ts">
  import { onMount } from 'svelte';
  import { agentsStore } from './agents.svelte';
  import type { SlotConfig, HermesProfileInfo, PermissionMode, AgentKind } from './types';
  import {
    ALL_PRESET_MODELS,
    getModelsForEngine,
    resetModelOnEngineChange,
    getStandardTeamPreset,
  } from './agentsLogic';

  let localSlots = $state<SlotConfig[]>([]);
  let isSaving = $state(false);

  let hermes = $derived(agentsStore.hermesDetection);

  onMount(async () => {
    await agentsStore.loadTeam();
    if (agentsStore.teamConfig?.slots) {
      localSlots = JSON.parse(JSON.stringify(agentsStore.teamConfig.slots));
    } else {
      localSlots = agentsStore.slots.map((s) => JSON.parse(JSON.stringify(s.config)));
    }
    await agentsStore.detectHermes();
  });

  function addEmptySlot() {
    const newId = `slot-${Date.now().toString(36)}`;
    localSlots = [
      ...localSlots,
      {
        id: newId,
        label: `Agent ${localSlots.length + 1}`,
        kind: 'claude-code',
        engine: 'claude-code',
        command: null,
        hermesProfile: null,
        model: 'claude-3-7-sonnet',
        fallbackModel: 'claude-3-5-sonnet',
        permission: 'ask',
        cwd: 'project',
      },
    ];
  }

  function removeSlot(idx: number) {
    localSlots = localSlots.filter((_, i) => i !== idx);
  }

  function handleEngineChange(idx: number, newEngine: string) {
    const slot = localSlots[idx];
    if (!slot) return;
    const oldEngine = slot.engine || slot.kind;
    slot.engine = newEngine;
    slot.kind = newEngine === 'codex' ? 'openai' : (newEngine === 'custom' ? 'acp-custom' : newEngine);
    if (oldEngine !== newEngine) {
      slot.model = resetModelOnEngineChange(newEngine, slot.model, hermes?.profiles);
      slot.fallbackModel = null;
    }
  }

  function handleApplyStandardTeamPreset() {
    const preset = getStandardTeamPreset();
    localSlots = JSON.parse(JSON.stringify(preset.slots || preset));
  }

  async function handleAddHermesProfile(profile: HermesProfileInfo) {
    const newId = `hermes-${profile.name}-${Date.now().toString(36)}`;
    localSlots = [
      ...localSlots,
      {
        id: newId,
        label: profile.name.charAt(0).toUpperCase() + profile.name.slice(1),
        kind: 'hermes',
        engine: 'hermes',
        command: null,
        hermesProfile: profile.name,
        model: profile.model || 'ag/gemini-3.8-flash-high',
        fallbackModel: null,
        permission: 'ask',
        cwd: 'project',
      },
    ];
  }

  async function handleSave() {
    isSaving = true;
    try {
      await agentsStore.saveTeam({
        version: 1,
        slots: localSlots,
      });
      agentsStore.isTeamEditorOpen = false;
    } finally {
      isSaving = false;
    }
  }
</script>

<div class="team-modal-backdrop" onclick={() => (agentsStore.isTeamEditorOpen = false)} role="presentation">
  <div class="team-modal" onclick={(e) => e.stopPropagation()} role="dialog" tabindex="-1">
    <!-- Header -->
    <div class="team-modal-header">
      <div class="header-title">
        <span>⚙️ Konfigurasi Tim Agen</span>
        <span class="file-hint">(.petak/team.json)</span>
      </div>
      <button class="close-btn" onclick={() => (agentsStore.isTeamEditorOpen = false)} aria-label="Close">
        ✕
      </button>
    </div>

    <div class="team-modal-body">
      <!-- Section 1: Detected Hermes Profiles -->
      <div class="section-card hermes-section">
        <div class="section-header">
          <div class="section-title">
            <span>Hermes Agent Auto-Detection</span>
            {#if hermes?.installed}
              <span class="badge-installed">Terpasang ({hermes.version || 'OK'})</span>
            {:else}
              <span class="badge-missing">Tidak Ditemukan</span>
            {/if}
          </div>
          <button class="refresh-btn" onclick={() => agentsStore.detectHermes()} title="Refresh deteksi">
            ↻
          </button>
        </div>

        {#if hermes?.installed && hermes.profiles && hermes.profiles.length > 0}
          <div class="profiles-list">
            {#each hermes.profiles as profile}
              <div class="profile-item">
                <div class="profile-info">
                  <span class="profile-name">🤖 {profile.name}</span>
                  {#if profile.model}
                    <span class="profile-model">({profile.model})</span>
                  {/if}
                  {#if profile.kanban}
                    <div class="kanban-badge" title="Status tugas Kanban">
                      <span class="kb-item running" title="Running">⚡ {profile.kanban.running}</span>
                      <span class="kb-item ready" title="Ready">✓ {profile.kanban.ready}</span>
                      {#if profile.kanban.blocked > 0}
                        <span class="kb-item blocked" title="Blocked">⛔ {profile.kanban.blocked}</span>
                      {/if}
                    </div>
                  {/if}
                </div>
                <button
                  class="add-to-team-btn"
                  onclick={() => handleAddHermesProfile(profile)}
                  title="Tambahkan profil {profile.name} ke tim proyek"
                >
                  + Tambah ke Tim
                </button>
              </div>
            {/each}
          </div>
        {:else}
          <div class="hermes-empty">
            Hermes CLI tidak terdeteksi di PATH atau belum ada profil yang dikonfigurasi di <code>~/.hermes/profiles/</code>.
          </div>
        {/if}
      </div>

      <!-- Section 2: Configured Slots List -->
      <div class="section-card">
        <div class="section-header">
          <div class="section-title">
            <span>Daftar Slot Agen Proyek ({localSlots.length})</span>
          </div>
          <div style="display: flex; gap: 8px; align-items: center;">
            <button
              class="preset-team-btn"
              type="button"
              onclick={handleApplyStandardTeamPreset}
              title="Terapkan preset Manager (Antigravity Opus), Senior (Claude Code Sonnet), Reviewer (Gemini Flash)"
            >
              ⚡ Gunakan Susunan Tim Standar
            </button>
            <button class="add-slot-btn" onclick={addEmptySlot}>
              + Tambah Slot
            </button>
          </div>
        </div>

        {#if localSlots.length === 0}
          <div class="slots-empty">
            Belum ada slot agen yang dikonfigurasi. Tambahkan slot manual atau pilih dari profil Hermes di atas.
          </div>
        {:else}
          <div class="slots-table-wrapper">
            {#each localSlots as slot, idx (slot.id || idx)}
              <div class="slot-edit-row">
                <div class="row-main">
                  <div class="field-group">
                    <label>Label</label>
                    <input type="text" bind:value={slot.label} placeholder="Techlead / Reviewer" />
                  </div>

                  <div class="field-group">
                    <label>Engine / Platform</label>
                    <select
                      value={slot.engine || slot.kind}
                      onchange={(e) => handleEngineChange(idx, (e.target as HTMLSelectElement).value)}
                    >
                      <option value="antigravity">Antigravity (via 9Router)</option>
                      <option value="claude-code">Claude Code CLI</option>
                      <option value="codex">OpenAI Codex</option>
                      <option value="hermes">Hermes Agent</option>
                      <option value="acp-custom">Custom ACP Command</option>
                    </select>
                  </div>

                  <div class="field-group">
                    <label>Model (Terkunci)</label>
                    <select bind:value={slot.model}>
                      {#each getModelsForEngine(slot.engine || slot.kind, hermes?.profiles) as m}
                        <option value={m.id}>{m.name} ({m.id})</option>
                      {/each}
                    </select>
                  </div>

                  <div class="field-group">
                    <label>Fallback</label>
                    <select bind:value={slot.fallbackModel}>
                      <option value="">(Tanpa Fallback)</option>
                      {#each ALL_PRESET_MODELS as m}
                        <option value={m.id}>{m.name} ({m.id})</option>
                      {/each}
                    </select>
                  </div>

                  <div class="field-group">
                    <label>Izin Awal</label>
                    <select bind:value={slot.permission} class:full-perm={slot.permission === 'full'}>
                      <option value="read">Read-Only</option>
                      <option value="ask">Ask Before Action</option>
                      <option value="auto">Auto-Run Safe</option>
                      <option value="full">FULL ACCESS ⚠️</option>
                    </select>
                  </div>

                  <button class="remove-slot-btn" onclick={() => removeSlot(idx)} title="Hapus slot ini">
                    ✕
                  </button>
                </div>

                {#if slot.kind === 'hermes'}
                  <div class="row-sub">
                    <span class="sub-label">Hermes Profile:</span>
                    <input type="text" bind:value={slot.hermesProfile} placeholder="e.g. senior / reviewer" />
                  </div>
                {:else if slot.kind === 'acp-custom'}
                  <div class="row-sub">
                    <span class="sub-label">Command:</span>
                    <input type="text" bind:value={slot.command} placeholder="e.g. opencode acp --model x" />
                  </div>
                {/if}
              </div>
            {/each}
          </div>
        {/if}
      </div>
    </div>

    <!-- Footer Actions -->
    <div class="team-modal-footer">
      <button class="footer-btn cancel-btn" onclick={() => (agentsStore.isTeamEditorOpen = false)}>
        Batal
      </button>
      <button class="footer-btn save-btn" onclick={handleSave} disabled={isSaving}>
        {isSaving ? 'Menyimpan...' : 'Simpan Konfigurasi'}
      </button>
    </div>
  </div>
</div>

<style>
  .team-modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.65);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 999;
  }

  .team-modal {
    width: 620px;
    max-width: 90vw;
    max-height: 85vh;
    background: #18191e;
    border: 1px solid #2d3039;
    border-radius: 8px;
    box-shadow: 0 16px 36px rgba(0, 0, 0, 0.5);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .team-modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    background: #131417;
    border-bottom: 1px solid #26282d;
  }

  .header-title {
    font-size: 13px;
    font-weight: 600;
    color: #e6edf3;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .file-hint {
    font-size: 11px;
    font-family: monospace;
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

  .team-modal-body {
    padding: 16px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .section-card {
    background: #131417;
    border: 1px solid #23252b;
    border-radius: 6px;
    padding: 12px;
  }

  .section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 10px;
  }

  .section-title {
    font-size: 12px;
    font-weight: 600;
    color: #c9cdd4;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .badge-installed {
    font-size: 10px;
    background: #1f3325;
    color: #7fc98f;
    padding: 1px 6px;
    border-radius: 3px;
    border: 1px solid #2c4d36;
  }

  .badge-missing {
    font-size: 10px;
    background: #33221f;
    color: #f08c5a;
    padding: 1px 6px;
    border-radius: 3px;
    border: 1px solid #4d302c;
  }

  .refresh-btn {
    background: transparent;
    border: none;
    color: #8b949e;
    cursor: pointer;
    font-size: 14px;
  }

  .profiles-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .profile-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: #1a1c22;
    border: 1px solid #26282d;
    border-radius: 4px;
    padding: 6px 10px;
  }

  .profile-info {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
  }

  .profile-name {
    font-weight: 600;
    color: #e6edf3;
  }

  .profile-model {
    font-size: 11px;
    color: #8b949e;
  }

  .kanban-badge {
    display: flex;
    gap: 4px;
    font-size: 10px;
    background: #121316;
    padding: 1px 5px;
    border-radius: 3px;
  }

  .kb-item.running {
    color: #7fc98f;
  }

  .kb-item.ready {
    color: #6ea8ff;
  }

  .kb-item.blocked {
    color: #f07a74;
  }

  .add-to-team-btn {
    background: #1f304d;
    border: 1px solid #2c4773;
    color: #6ea8ff;
    padding: 3px 8px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
  }

  .add-to-team-btn:hover {
    background: #27406b;
  }

  .hermes-empty {
    font-size: 11px;
    color: #8b949e;
    line-height: 1.4;
  }

  .hermes-empty code {
    background: #1c1d22;
    padding: 1px 4px;
    border-radius: 3px;
  }

  .preset-team-btn {
    background: #1e293b;
    border: 1px solid #3b82f6;
    color: #60a5fa;
    padding: 3px 10px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s;
  }

  .preset-team-btn:hover {
    background: #2563eb;
    color: #ffffff;
  }

  .add-slot-btn {
    background: #233428;
    border: 1px solid #35573d;
    color: #7fc98f;
    padding: 3px 8px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
  }

  .slots-empty {
    font-size: 11px;
    color: #8b949e;
    padding: 12px 0;
  }

  .slots-table-wrapper {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .slot-edit-row {
    background: #1a1c22;
    border: 1px solid #26282d;
    border-radius: 6px;
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .row-main {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .field-group {
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex: 1;
  }

  .field-group label {
    font-size: 9px;
    color: #8b949e;
    text-transform: uppercase;
  }

  .field-group input,
  .field-group select {
    background: #121316;
    border: 1px solid #282a33;
    border-radius: 4px;
    padding: 4px 6px;
    color: #e6edf3;
    font-size: 11px;
    outline: none;
  }

  .field-group select.full-perm {
    border-color: #d9534f;
    color: #f07a74;
  }

  .remove-slot-btn {
    background: transparent;
    border: none;
    color: #8b949e;
    cursor: pointer;
    font-size: 14px;
    padding: 4px;
    margin-top: 12px;
  }

  .remove-slot-btn:hover {
    color: #f07a74;
  }

  .row-sub {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 11px;
  }

  .sub-label {
    color: #8b949e;
    font-size: 10px;
  }

  .row-sub input {
    background: #121316;
    border: 1px solid #282a33;
    border-radius: 4px;
    padding: 3px 6px;
    color: #e6edf3;
    font-size: 11px;
    flex: 1;
  }

  .team-modal-footer {
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

  .footer-btn.save-btn {
    background: #1f4277;
    color: #79c0ff;
    border: 1px solid #2d5a9e;
  }

  .footer-btn.save-btn:disabled {
    opacity: 0.5;
  }
</style>
