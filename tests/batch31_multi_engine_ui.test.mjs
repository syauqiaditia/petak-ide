import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  getEngineOptions,
  normalizeEngineId,
  getModelsForEngine,
  getDefaultModelForEngine,
  isModelAllowedForEngine,
  resetModelOnEngineChange,
  resolveModelForEngine,
  getStandardTeamPreset,
  formatEngineName,
  getEngineShortBadge,
  formatShortModelName,
  ENGINE_WHITELIST_MODELS,
  SUPPORTED_ENGINES,
} from '../ui/features/agents/agentsLogic.ts';
import { api } from '../ui/lib/api.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uiRoot = path.resolve(__dirname, '../ui');

test('b31 Multi-Engine UI 1: cascading model mapping & engine filtering', () => {
  // 1. Supported engine options
  const engines = getEngineOptions();
  assert.ok(Array.isArray(engines), 'getEngineOptions must return an array');
  const engineIds = engines.map((e) => e.id);
  assert.ok(engineIds.includes('hermes'), 'must include hermes engine');
  assert.ok(engineIds.includes('claude-code'), 'must include claude-code engine');
  assert.ok(engineIds.includes('antigravity'), 'must include antigravity engine');
  assert.ok(engineIds.includes('codex'), 'must include codex engine');
  assert.ok(engineIds.includes('acp-custom'), 'must include acp-custom engine');

  // 2. Claude Code model whitelist
  const claudeModels = getModelsForEngine('claude-code');
  const claudeIds = claudeModels.map((m) => m.id);
  assert.ok(claudeIds.includes('claude-3-7-sonnet'), 'Claude Code must have claude-3-7-sonnet');
  assert.ok(claudeIds.includes('claude-3-5-sonnet'), 'Claude Code must have claude-3-5-sonnet');
  assert.ok(claudeIds.includes('claude-3-opus'), 'Claude Code must have claude-3-opus');
  assert.ok(!claudeIds.includes('gpt-4o'), 'Claude Code must not include gpt-4o');

  // 3. Antigravity model whitelist
  const agModels = getModelsForEngine('antigravity');
  const agIds = agModels.map((m) => m.id);
  assert.ok(agIds.includes('ag/gemini-3.8-flash-high'), 'Antigravity must have ag/gemini-3.8-flash-high');
  assert.ok(agIds.includes('ag/claude-opus-4.1'), 'Antigravity must have ag/claude-opus-4.1');
  assert.ok(agIds.includes('ag/claude-opus-4-6-thinking'), 'Antigravity must have ag/claude-opus-4-6-thinking');
  assert.ok(!agIds.includes('claude-3-5-haiku-20241022'), 'Antigravity whitelist must be locked');

  // 4. Codex / OpenAI model whitelist
  const codexModels = getModelsForEngine('codex');
  const codexIds = codexModels.map((m) => m.id);
  assert.ok(codexIds.includes('gpt-4o'), 'Codex must have gpt-4o');
  assert.ok(codexIds.includes('o3-mini'), 'Codex must have o3-mini');
  assert.ok(codexIds.includes('o1'), 'Codex must have o1');

  // 5. Normalization for aliases
  assert.equal(normalizeEngineId('openai'), 'codex');
  assert.equal(normalizeEngineId('custom'), 'acp-custom');
  const openaiModels = getModelsForEngine('openai');
  assert.ok(openaiModels.some((m) => m.id === 'gpt-4o'), 'openai alias maps to codex whitelist');

  // 6. Hermes detection integration
  const mockProfiles = [
    { name: 'senior2', model: 'ag/gemini-3.8-flash-high', is_active: true },
    { name: 'manager', model: 'ag/claude-opus-4-6-thinking', is_active: false },
  ];
  const hermesWithProfiles = getModelsForEngine('hermes', mockProfiles);
  assert.ok(
    hermesWithProfiles.some((m) => m.id === 'ag/gemini-3.8-flash-high'),
    'Hermes models must include detected profile models'
  );

  // 7. Whitelist validation helper
  assert.equal(isModelAllowedForEngine('claude-code', 'claude-3-7-sonnet'), true);
  assert.equal(isModelAllowedForEngine('claude-code', 'gpt-4o'), false);
  assert.equal(isModelAllowedForEngine('antigravity', 'ag/gemini-3.8-flash-high'), true);
  assert.equal(isModelAllowedForEngine('antigravity', 'claude-3-opus'), false);
});

test('b31 Multi-Engine UI 2: model lock reset logic saat engine berubah', () => {
  // Default models for engines
  assert.equal(getDefaultModelForEngine('claude-code'), 'claude-3-7-sonnet');
  assert.equal(getDefaultModelForEngine('antigravity'), 'ag/gemini-3.8-flash-high');
  assert.equal(getDefaultModelForEngine('codex'), 'gpt-4o');
  assert.equal(getDefaultModelForEngine('openai'), 'gpt-4o');
  assert.equal(getDefaultModelForEngine('hermes'), 'ag/gemini-3.8-flash-high');
  assert.equal(getDefaultModelForEngine('acp-custom'), 'custom-model');

  // resetModelOnEngineChange resets to default model
  assert.equal(resetModelOnEngineChange('claude-code', 'ag/gemini-3.8-flash-high'), 'claude-3-7-sonnet');
  assert.equal(resetModelOnEngineChange('antigravity', 'claude-3-7-sonnet'), 'ag/gemini-3.8-flash-high');
  assert.equal(resetModelOnEngineChange('codex', 'ag/gemini-3.8-flash-high'), 'gpt-4o');

  // resolveModelForEngine resets if not in whitelist
  assert.equal(resolveModelForEngine('claude-code', 'gpt-4o'), 'claude-3-7-sonnet');
  assert.equal(resolveModelForEngine('claude-code', 'claude-3-5-sonnet'), 'claude-3-5-sonnet');
  assert.equal(resolveModelForEngine('antigravity', 'claude-3-7-sonnet'), 'ag/gemini-3.8-flash-high');
  assert.equal(resolveModelForEngine('antigravity', 'ag/claude-opus-4.1'), 'ag/claude-opus-4.1');
});

test('b31 Multi-Engine UI 3: standard team preset generator', () => {
  const team = getStandardTeamPreset('/mock/project');
  const slots = team.slots || team;
  assert.equal(slots.length, 3, 'Standard team preset must configure exactly 3 slots');

  // Manager: Antigravity Opus, permission ask
  const manager = slots.find((s) => s.id === 'manager' || s.label.toLowerCase().includes('manager'));
  assert.ok(manager, 'Manager slot must exist in standard team preset');
  assert.equal(manager.engine, 'antigravity', 'Manager engine must be antigravity');
  assert.equal(manager.kind, 'antigravity', 'Manager kind must be antigravity');
  assert.ok(
    manager.model === 'ag/claude-opus-4.1' || manager.model === 'ag/claude-opus-4-6-thinking',
    'Manager model must be Antigravity Opus'
  );
  assert.equal(manager.permission, 'ask', 'Manager permission must be ask');

  // Senior: Claude Code Sonnet, permission ask
  const senior = slots.find((s) => s.id === 'senior' || s.label.toLowerCase().includes('senior'));
  assert.ok(senior, 'Senior slot must exist in standard team preset');
  assert.equal(senior.engine, 'claude-code', 'Senior engine must be claude-code');
  assert.equal(senior.kind, 'claude-code', 'Senior kind must be claude-code');
  assert.equal(senior.model, 'claude-3-7-sonnet', 'Senior model must be claude-3-7-sonnet');
  assert.equal(senior.permission, 'ask', 'Senior permission must be ask');

  // Reviewer: Gemini Flash, permission ask
  const reviewer = slots.find((s) => s.id === 'reviewer' || s.label.toLowerCase().includes('reviewer'));
  assert.ok(reviewer, 'Reviewer slot must exist in standard team preset');
  assert.equal(reviewer.engine, 'antigravity', 'Reviewer engine must be antigravity');
  assert.equal(reviewer.kind, 'antigravity', 'Reviewer kind must be antigravity');
  assert.equal(reviewer.model, 'ag/gemini-3.8-flash-high', 'Reviewer model must be Gemini Flash');
  assert.equal(reviewer.permission, 'ask', 'Reviewer permission must be ask');

  // Dual format support (Array & TeamConfig)
  assert.equal(team.version, 1, 'Preset must have version 1');
  assert.ok(Array.isArray(team.slots), 'Preset must have slots array');
});

test('b31 Multi-Engine UI 4: team config roundtrip dengan engine fields', () => {
  const originalConfig = {
    version: 1,
    slots: [
      {
        id: 'slot-1',
        label: '👑 Lead Manager',
        kind: 'antigravity',
        engine: 'antigravity',
        model: 'ag/claude-opus-4.1',
        fallbackModel: 'ag/claude-opus-4-6-thinking',
        permission: 'ask',
        cwd: 'project',
      },
      {
        id: 'slot-2',
        label: '⚡ Senior Engineer',
        kind: 'claude-code',
        engine: 'claude-code',
        model: 'claude-3-7-sonnet',
        fallbackModel: null,
        permission: 'ask',
        cwd: 'project',
      },
    ],
  };

  const jsonStr = JSON.stringify(originalConfig);
  const parsed = JSON.parse(jsonStr);

  assert.equal(parsed.version, 1);
  assert.equal(parsed.slots.length, 2);
  assert.equal(parsed.slots[0].engine, 'antigravity');
  assert.equal(parsed.slots[0].kind, 'antigravity');
  assert.equal(parsed.slots[0].model, 'ag/claude-opus-4.1');
  assert.equal(parsed.slots[1].engine, 'claude-code');
  assert.equal(parsed.slots[1].model, 'claude-3-7-sonnet');
});

test('b31 Multi-Engine UI 5: API contracts & SupportedEngineInfo', async () => {
  assert.equal(typeof api.agentGetSupportedEngines, 'function', 'api.agentGetSupportedEngines must exist');
  const supported = await api.agentGetSupportedEngines();
  assert.ok(Array.isArray(supported), 'agentGetSupportedEngines must return an array');
  assert.ok(supported.length >= 4, 'Must return at least 4 supported engines');

  const claude = supported.find((e) => e.id === 'claude-code');
  assert.ok(claude, 'claude-code must be in supported engines');
  assert.equal(claude.defaultModel, 'claude-3-7-sonnet');

  const ag = supported.find((e) => e.id === 'antigravity');
  assert.ok(ag, 'antigravity must be in supported engines');
  assert.equal(ag.defaultModel, 'ag/gemini-3.8-flash-high');
});

test('b31 Multi-Engine UI 6: UI components cascading, presets & badges', () => {
  // 1. TeamEditor.svelte
  const teamEditorPath = path.resolve(uiRoot, 'features/agents/TeamEditor.svelte');
  const teamEditorSrc = fs.readFileSync(teamEditorPath, 'utf-8');
  assert.ok(teamEditorSrc.includes('Engine / Platform'), 'TeamEditor must declare Engine / Platform label');
  assert.ok(teamEditorSrc.includes('handleEngineChange'), 'TeamEditor must handle engine change');
  assert.ok(teamEditorSrc.includes('getModelsForEngine'), 'TeamEditor must use getModelsForEngine');
  assert.ok(teamEditorSrc.includes('Gunakan Susunan Tim Standar'), 'TeamEditor must include 1-Click preset button');
  assert.ok(teamEditorSrc.includes('getStandardTeamPreset'), 'TeamEditor must import getStandardTeamPreset');

  // 2. SettingsModal.svelte
  const settingsModalPath = path.resolve(uiRoot, 'features/settings/SettingsModal.svelte');
  const settingsModalSrc = fs.readFileSync(settingsModalPath, 'utf-8');
  assert.ok(settingsModalSrc.includes('getModelsForEngine'), 'SettingsModal must use getModelsForEngine');
  assert.ok(settingsModalSrc.includes('resetModelOnEngineChange'), 'SettingsModal must use resetModelOnEngineChange');
  assert.ok(settingsModalSrc.includes('Gunakan Susunan Tim Standar'), 'SettingsModal must include 1-Click preset button');
  assert.ok(settingsModalSrc.includes('api.agentSaveTeam'), 'SettingsModal must call api.agentSaveTeam');

  // 3. AgentTabs.svelte
  const agentTabsPath = path.resolve(uiRoot, 'features/agents/AgentTabs.svelte');
  const agentTabsSrc = fs.readFileSync(agentTabsPath, 'utf-8');
  assert.ok(agentTabsSrc.includes('engine-badge'), 'AgentTabs must declare engine-badge');
  assert.ok(agentTabsSrc.includes('model-tag'), 'AgentTabs must declare model-tag');
  assert.ok(agentTabsSrc.includes('active-engine-model-badge'), 'AgentTabs must declare active-engine-model-badge');

  // 4. AgentsPanel.svelte
  const agentsPanelPath = path.resolve(uiRoot, 'features/agents/AgentsPanel.svelte');
  const agentsPanelSrc = fs.readFileSync(agentsPanelPath, 'utf-8');
  assert.ok(agentsPanelSrc.includes('dynamic-engine-badge'), 'AgentsPanel must declare dynamic-engine-badge');
  assert.ok(agentsPanelSrc.includes('footer-agent-badges'), 'AgentsPanel must declare footer-agent-badges');
  assert.ok(agentsPanelSrc.includes('footer-engine-badge'), 'AgentsPanel must declare footer-engine-badge');
  assert.ok(agentsPanelSrc.includes('footer-model-badge'), 'AgentsPanel must declare footer-model-badge');
});
