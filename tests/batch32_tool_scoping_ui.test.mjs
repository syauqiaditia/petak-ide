import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ROLE_SCOPE_BADGES,
  DEFAULT_ROLE_WHITELISTS,
  ROLE_BLACKLISTS,
  ALL_AVAILABLE_TOOLS,
  ROLE_SCOPE_DEFINITIONS,
  normalizeRole,
  inferRoleFromSlot,
  getRoleScopeBadge,
  getDefaultToolsForRole,
  getEffectiveToolsForSlot,
  isToolAllowedForSlot,
  validateCustomWhitelist,
  getRoleScopeDescription,
  getStandardTeamPreset,
} from '../ui/features/agents/agentsLogic.ts';
import { api } from '../ui/lib/api.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uiRoot = path.resolve(__dirname, '../ui');

test('b32 Tool Scoping UI 1: Role authority badge mapping per role', () => {
  // 1. Manager badge
  assert.equal(
    getRoleScopeBadge('manager'),
    'Tools: Scoped (Read/Plan only)',
    'Manager badge must be Read/Plan only'
  );
  assert.equal(getRoleScopeBadge('Manager'), 'Tools: Scoped (Read/Plan only)');

  // 2. Senior badge
  assert.equal(
    getRoleScopeBadge('senior'),
    'Tools: Scoped (Implement & Build)',
    'Senior badge must be Implement & Build'
  );
  assert.equal(getRoleScopeBadge('Senior'), 'Tools: Scoped (Implement & Build)');

  // 3. Senior2 badge
  assert.equal(
    getRoleScopeBadge('senior2'),
    'Tools: Scoped (UI & Toolchain)',
    'Senior2 badge must be UI & Toolchain'
  );
  assert.equal(getRoleScopeBadge('senior-2'), 'Tools: Scoped (UI & Toolchain)');
  assert.equal(getRoleScopeBadge('Senior 2'), 'Tools: Scoped (UI & Toolchain)');

  // 4. Techlead badge
  assert.equal(
    getRoleScopeBadge('techlead'),
    'Tools: Scoped (Architecture & Review)',
    'Techlead badge must be Architecture & Review'
  );
  assert.equal(getRoleScopeBadge('tech-lead'), 'Tools: Scoped (Architecture & Review)');
  assert.equal(getRoleScopeBadge('Tech Lead'), 'Tools: Scoped (Architecture & Review)');

  // 5. Reviewer badge
  assert.equal(
    getRoleScopeBadge('reviewer'),
    'Tools: Scoped (QA & Test runner only)',
    'Reviewer badge must be QA & Test runner only'
  );
  assert.equal(getRoleScopeBadge('Reviewer'), 'Tools: Scoped (QA & Test runner only)');

  // 6. Custom / other fallback badge
  assert.equal(getRoleScopeBadge('custom'), 'Tools: Scoped (Custom)');
  assert.equal(getRoleScopeBadge('unknown_role'), 'Tools: Scoped (Custom)');
  assert.equal(getRoleScopeBadge(null), 'Tools: Scoped (Custom)');
  assert.equal(getRoleScopeBadge(undefined), 'Tools: Scoped (Custom)');
});

test('b32 Tool Scoping UI 2: inferRoleFromSlot & SlotConfig badge resolution', () => {
  // Explicit role
  assert.equal(getRoleScopeBadge({ role: 'manager' }), 'Tools: Scoped (Read/Plan only)');
  assert.equal(getRoleScopeBadge({ role: 'senior' }), 'Tools: Scoped (Implement & Build)');
  assert.equal(getRoleScopeBadge({ role: 'senior2' }), 'Tools: Scoped (UI & Toolchain)');
  assert.equal(getRoleScopeBadge({ role: 'techlead' }), 'Tools: Scoped (Architecture & Review)');
  assert.equal(getRoleScopeBadge({ role: 'reviewer' }), 'Tools: Scoped (QA & Test runner only)');

  // Inferred from hermesProfile
  assert.equal(inferRoleFromSlot({ hermesProfile: 'manager' }), 'manager');
  assert.equal(inferRoleFromSlot({ hermesProfile: 'senior2' }), 'senior2');
  assert.equal(inferRoleFromSlot({ hermesProfile: 'senior' }), 'senior');
  assert.equal(inferRoleFromSlot({ hermesProfile: 'techlead' }), 'techlead');
  assert.equal(inferRoleFromSlot({ hermesProfile: 'reviewer' }), 'reviewer');

  // Inferred from id or label
  assert.equal(inferRoleFromSlot({ id: 'manager-1' }), 'manager');
  assert.equal(inferRoleFromSlot({ label: '⚡ Senior Developer' }), 'senior');
  assert.equal(inferRoleFromSlot({ label: '⚡ Senior2 Toolchain' }), 'senior2');
  assert.equal(inferRoleFromSlot({ id: 'techlead-core' }), 'techlead');
  assert.equal(inferRoleFromSlot({ label: '🔍 QA Reviewer' }), 'reviewer');

  // Standard preset team includes roles
  const team = getStandardTeamPreset();
  const slots = team.slots || team;
  assert.equal(slots[0].role, 'manager');
  assert.equal(getRoleScopeBadge(slots[0]), 'Tools: Scoped (Read/Plan only)');
  assert.equal(slots[1].role, 'senior');
  assert.equal(getRoleScopeBadge(slots[1]), 'Tools: Scoped (Implement & Build)');
  assert.equal(slots[2].role, 'reviewer');
  assert.equal(getRoleScopeBadge(slots[2]), 'Tools: Scoped (QA & Test runner only)');
});

test('b32 Tool Scoping UI 3: Default tools whitelist per role', () => {
  // Manager
  const managerTools = getDefaultToolsForRole('manager');
  assert.ok(managerTools.includes('read_file'));
  assert.ok(managerTools.includes('list_directory'));
  assert.ok(managerTools.includes('search_files'));
  assert.ok(managerTools.includes('kanban_create'));
  assert.ok(managerTools.includes('kanban_list'));
  assert.ok(managerTools.includes('kanban_show'));
  assert.ok(!managerTools.includes('write_file'), 'Manager must not have write_file in whitelist');
  assert.ok(!managerTools.includes('terminal'), 'Manager must not have terminal in whitelist');

  // Senior
  const seniorTools = getDefaultToolsForRole('senior');
  assert.ok(seniorTools.includes('read_file'));
  assert.ok(seniorTools.includes('write_file'));
  assert.ok(seniorTools.includes('patch'));
  assert.ok(seniorTools.includes('search_files'));
  assert.ok(seniorTools.includes('terminal'));
  assert.ok(seniorTools.includes('git_worktree'));
  assert.ok(!seniorTools.includes('kanban_complete'), 'Senior must not have kanban_complete');

  // Senior2
  const senior2Tools = getDefaultToolsForRole('senior2');
  assert.ok(senior2Tools.includes('read_file'));
  assert.ok(senior2Tools.includes('write_file'));
  assert.ok(senior2Tools.includes('patch'));
  assert.ok(senior2Tools.includes('terminal'));
  assert.ok(senior2Tools.includes('flutter_run'));
  assert.ok(!senior2Tools.includes('kanban_complete'), 'Senior2 must not have kanban_complete');

  // Techlead
  const techleadTools = getDefaultToolsForRole('techlead');
  assert.ok(techleadTools.includes('git_merge'));
  assert.ok(techleadTools.includes('git_checkout'));
  assert.ok(techleadTools.includes('review_diff'));
  assert.ok(techleadTools.includes('device_control'));
  assert.ok(techleadTools.includes('terminal'));
  assert.ok(techleadTools.includes('kanban_unblock'));

  // Reviewer
  const reviewerTools = getDefaultToolsForRole('reviewer');
  assert.ok(reviewerTools.includes('read_file'));
  assert.ok(reviewerTools.includes('search_files'));
  assert.ok(reviewerTools.includes('git_diff'));
  assert.ok(reviewerTools.includes('run_test'));
  assert.ok(reviewerTools.includes('kanban_complete'));
  assert.ok(reviewerTools.includes('kanban_request_changes'));
  assert.ok(!reviewerTools.includes('write_file'), 'Reviewer must not have write_file');
});

test('b32 Tool Scoping UI 4: Custom whitelist override logic & tool allowance checks', () => {
  // Slot with default role
  const slotSenior = { id: 's1', role: 'senior' };
  assert.equal(isToolAllowedForSlot(slotSenior, 'write_file'), true);
  assert.equal(isToolAllowedForSlot(slotSenior, 'kanban_complete'), false);

  // Slot with customWhitelist override
  const slotWithOverride = {
    id: 's2',
    role: 'manager',
    customWhitelist: ['read_file', 'write_file', 'terminal'],
  };
  const effectiveTools = getEffectiveToolsForSlot(slotWithOverride);
  assert.deepEqual(effectiveTools, ['read_file', 'write_file', 'terminal']);
  assert.equal(isToolAllowedForSlot(slotWithOverride, 'write_file'), true, 'Override allows write_file');
  assert.equal(isToolAllowedForSlot(slotWithOverride, 'terminal'), true, 'Override allows terminal');
  assert.equal(isToolAllowedForSlot(slotWithOverride, 'kanban_create'), false, 'Non-overridden tool excluded');

  // Empty customWhitelist falls back to role default
  const slotEmptyOverride = {
    id: 's3',
    role: 'reviewer',
    customWhitelist: [],
  };
  assert.equal(isToolAllowedForSlot(slotEmptyOverride, 'run_test'), true);
  assert.equal(isToolAllowedForSlot(slotEmptyOverride, 'write_file'), false);

  // validateCustomWhitelist
  const sanitized = validateCustomWhitelist([' READ_FILE ', 'write_file', 'write_file', '', null, 123]);
  assert.deepEqual(sanitized, ['read_file', 'write_file']);
});

test('b32 Tool Scoping UI 5: API bindings & role scope metadata', async () => {
  assert.equal(typeof api.agentGetRoleScopes, 'function', 'api.agentGetRoleScopes must be defined');
  const scopes = await api.agentGetRoleScopes();
  assert.ok(Array.isArray(scopes), 'Scopes must be an array');
  assert.ok(scopes.length >= 5, 'Must contain at least 5 standard roles');

  const managerScope = scopes.find((s) => s.role === 'manager');
  assert.ok(managerScope, 'Manager scope must be present');
  assert.equal(managerScope.badge, 'Tools: Scoped (Read/Plan only)');
  assert.ok(managerScope.defaultWhitelist.includes('read_file'));
  assert.ok(managerScope.blacklist.includes('write_file'));

  const reviewerScope = scopes.find((s) => s.role === 'reviewer');
  assert.ok(reviewerScope, 'Reviewer scope must be present');
  assert.equal(reviewerScope.badge, 'Tools: Scoped (QA & Test runner only)');
  assert.ok(reviewerScope.defaultWhitelist.includes('run_test'));
});

test('b32 Tool Scoping UI 6: UI components indicators, badges & advanced toggle', () => {
  // 1. AgentsPanel.svelte
  const agentsPanelPath = path.resolve(uiRoot, 'features/agents/AgentsPanel.svelte');
  const agentsPanelSrc = fs.readFileSync(agentsPanelPath, 'utf-8');
  assert.ok(
    agentsPanelSrc.includes('🛡️ Tool Scoping: Active'),
    'AgentsPanel must display 🛡️ Tool Scoping: Active indicator'
  );
  assert.ok(
    agentsPanelSrc.includes('tool-scoping-badge'),
    'AgentsPanel must declare tool-scoping-badge'
  );
  assert.ok(
    agentsPanelSrc.includes('getRoleScopeBadge'),
    'AgentsPanel must import getRoleScopeBadge'
  );
  assert.ok(
    agentsPanelSrc.includes('getRoleScopeDescription'),
    'AgentsPanel must import getRoleScopeDescription'
  );

  // 2. TeamEditor.svelte
  const teamEditorPath = path.resolve(uiRoot, 'features/agents/TeamEditor.svelte');
  const teamEditorSrc = fs.readFileSync(teamEditorPath, 'utf-8');
  assert.ok(
    teamEditorSrc.includes('role-scope-badge'),
    'TeamEditor must render role-scope-badge'
  );
  assert.ok(
    teamEditorSrc.includes('getRoleScopeBadge'),
    'TeamEditor must call getRoleScopeBadge'
  );
  assert.ok(
    teamEditorSrc.includes('Advanced'),
    'TeamEditor must have Advanced toggle button'
  );
  assert.ok(
    teamEditorSrc.includes('row-advanced-whitelist') || teamEditorSrc.includes('customWhitelist'),
    'TeamEditor must have custom whitelist override section'
  );
  assert.ok(
    teamEditorSrc.includes('handleRoleChange'),
    'TeamEditor must handle role changes'
  );

  // 3. SettingsModal.svelte
  const settingsModalPath = path.resolve(uiRoot, 'features/settings/SettingsModal.svelte');
  const settingsModalSrc = fs.readFileSync(settingsModalPath, 'utf-8');
  assert.ok(
    settingsModalSrc.includes('role-scope-badge'),
    'SettingsModal must declare role-scope-badge'
  );
  assert.ok(
    settingsModalSrc.includes('getRoleScopeBadge'),
    'SettingsModal must call getRoleScopeBadge'
  );
  assert.ok(
    settingsModalSrc.includes('isAdvancedScopingOpen') || settingsModalSrc.includes('Advanced'),
    'SettingsModal must have Advanced mode toggle for tool scoping'
  );
  assert.ok(
    settingsModalSrc.includes('handleToggleSlotTool') || settingsModalSrc.includes('customWhitelist'),
    'SettingsModal must support custom whitelist tool toggling'
  );
});
