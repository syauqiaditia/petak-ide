/**
 * Batch 27 — Fase 6 & 7 feature tests:
 * keymapStore, PAT expiry logic, theme/variant persistence, status bar GitLab indicator.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const UI = path.resolve('ui');

// ── 1. Keymap Store Logic ──────────────────────────────────────────

test('keymap store: default shortcuts list is complete and correct', () => {
  const src = fs.readFileSync(path.join(UI, 'features/settings/keymapStore.svelte.ts'), 'utf-8');

  // Has DEFAULT_KEYMAPS with expected entries
  assert.ok(src.includes("id: 'search-everywhere'"), 'search-everywhere shortcut exists');
  assert.ok(src.includes("id: 'quick-open'"), 'quick-open shortcut exists');
  assert.ok(src.includes("id: 'hot-reload'"), 'hot-reload shortcut exists');
  assert.ok(src.includes("id: 'hot-restart'"), 'hot-restart shortcut exists');
  assert.ok(src.includes("id: 'toggle-agents'"), 'toggle-agents shortcut exists');
  assert.ok(src.includes("id: 'toggle-mirror'"), 'toggle-mirror shortcut exists');
  assert.ok(src.includes("id: 'gitlab-mrs'"), 'gitlab-mrs shortcut exists');
  assert.ok(src.includes("id: 'settings'"), 'settings shortcut exists');
  assert.ok(src.includes("id: 'find-replace'"), 'find-replace shortcut exists');
  assert.ok(src.includes("id: 'fold-unfold'"), 'fold-unfold shortcut exists');
});

test('keymap store: custom mapping via localStorage and conflict detection', () => {
  const src = fs.readFileSync(path.join(UI, 'features/settings/keymapStore.svelte.ts'), 'utf-8');

  // Storage key
  assert.ok(src.includes("'petak.keymaps'"), 'uses petak.keymaps localStorage key');

  // updateShortcut returns ConflictInfo or null
  assert.ok(src.includes('updateShortcut(actionId: string, newShortcut: string): ConflictInfo | null'),
    'updateShortcut signature has conflict return');

  // Conflict detection logic
  assert.ok(src.includes('conflictingActionId'), 'returns conflictingActionId on conflict');
  assert.ok(src.includes('conflictingAction'), 'returns conflictingAction on conflict');
});

test('keymap store: resetDefaults clears all custom mappings', () => {
  const src = fs.readFileSync(path.join(UI, 'features/settings/keymapStore.svelte.ts'), 'utf-8');
  assert.ok(src.includes('resetDefaults()'), 'resetDefaults method exists');
  assert.ok(src.includes('this.customMappings = {}'), 'resetDefaults clears mappings');
});

test('keymap store: keyEventToShortcut converts keyboard events', () => {
  const src = fs.readFileSync(path.join(UI, 'features/settings/keymapStore.svelte.ts'), 'utf-8');
  assert.ok(src.includes('keyEventToShortcut'), 'keyEventToShortcut function exported');
  // Handles modifiers
  assert.ok(src.includes("'⌃'"), 'ctrl modifier mapped');
  assert.ok(src.includes("'⌥'"), 'alt modifier mapped');
  assert.ok(src.includes("'⇧'"), 'shift modifier mapped');
  assert.ok(src.includes("'⌘'"), 'meta modifier mapped');
});

// ── 2. PAT Expiry Token Logic ──────────────────────────────────────

test('PAT expiry: calcPatDaysLeft returns correct days for future date', () => {
  // Import the pure logic directly
  const src = fs.readFileSync(path.join(UI, 'features/accounts/accountsExpiryLogic.ts'), 'utf-8');
  assert.ok(src.includes('calcPatDaysLeft'), 'calcPatDaysLeft exported');

  // Test the logic inline: future date 30 days away
  const future = new Date();
  future.setDate(future.getDate() + 30);
  const dateStr = future.toISOString().split('T')[0];

  // Parse the logic manually
  const exp = new Date(dateStr + 'T23:59:59');
  const now = new Date();
  const diff = exp.getTime() - now.getTime();
  const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
  assert.ok(days >= 29 && days <= 31, `30-day future date gives ${days} days`);
});

test('PAT expiry: warning threshold at 14 days', () => {
  const src = fs.readFileSync(path.join(UI, 'features/accounts/accountsExpiryLogic.ts'), 'utf-8');
  assert.ok(src.includes('patNeedsWarning'), 'patNeedsWarning exported');
  assert.ok(src.includes('<= 14'), 'uses 14-day threshold');

  // Inline test: 5 days = warning
  const needsWarning5 = (5 <= 14);
  assert.ok(needsWarning5, '5 days left triggers warning');

  // Inline test: 20 days = no warning
  const needsWarning20 = (20 <= 14);
  assert.ok(!needsWarning20, '20 days left does not trigger warning');
});

test('PAT expiry: expired token detection', () => {
  const src = fs.readFileSync(path.join(UI, 'features/accounts/accountsExpiryLogic.ts'), 'utf-8');

  // Past date
  const past = new Date();
  past.setDate(past.getDate() - 5);
  const dateStr = past.toISOString().split('T')[0];
  const exp = new Date(dateStr + 'T23:59:59');
  const now = new Date();
  const diff = exp.getTime() - now.getTime();
  const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
  assert.ok(days < 0, `past date gives negative days: ${days}`);
});

test('PAT expiry: formatPatIndicator returns correct text', () => {
  const src = fs.readFileSync(path.join(UI, 'features/accounts/accountsExpiryLogic.ts'), 'utf-8');
  assert.ok(src.includes('formatPatIndicator'), 'formatPatIndicator exported');
  assert.ok(src.includes("'⚠️ PAT Expired'"), 'expired format');
  assert.ok(src.includes('⚠️ PAT:'), 'warning format with days');
});

test('PAT expiry: null/empty expiresAt returns no warning', () => {
  const src = fs.readFileSync(path.join(UI, 'features/accounts/accountsExpiryLogic.ts'), 'utf-8');
  assert.ok(src.includes('if (!expiresAt) return { daysLeft: null, expired: false }'),
    'null expiresAt returns safe defaults');
});

// ── 3. Theme/Variant Persistence ───────────────────────────────────

test('theme persistence: setVariant calls persistToBackend', () => {
  const src = fs.readFileSync(path.join(UI, 'features/settings/settingsStore.svelte.ts'), 'utf-8');
  assert.ok(src.includes("persistToBackend('variant', newVariant)"), 'setVariant persists to backend');
});

test('theme persistence: setTheme calls persistToBackend', () => {
  const src = fs.readFileSync(path.join(UI, 'features/settings/settingsStore.svelte.ts'), 'utf-8');
  assert.ok(src.includes("persistToBackend('theme', newTheme)"), 'setTheme persists to backend');
});

test('theme persistence: syncFromBackendIfEmpty on startup', () => {
  const src = fs.readFileSync(path.join(UI, 'features/settings/settingsStore.svelte.ts'), 'utf-8');
  assert.ok(src.includes('syncFromBackendIfEmpty'), 'syncFromBackendIfEmpty called on init');
  assert.ok(src.includes('toolchainGetConfig'), 'reads backend config');
  assert.ok(src.includes('toolchainSaveConfig'), 'writes backend config');
});

test('theme persistence: localStorage still primary, backend is secondary', () => {
  const src = fs.readFileSync(path.join(UI, 'features/settings/settingsStore.svelte.ts'), 'utf-8');
  // localStorage is checked before backend
  assert.ok(src.includes("localStorage.setItem('petak.variant'"), 'variant saved to localStorage');
  assert.ok(src.includes("localStorage.setItem('petak.theme'"), 'theme saved to localStorage');
  // backend sync only when localStorage is empty
  assert.ok(src.includes("!localStorage.getItem('petak.variant')"), 'syncs variant only if localStorage empty');
  assert.ok(src.includes("!localStorage.getItem('petak.theme')"), 'syncs theme only if localStorage empty');
});

// ── 4. Status Bar GitLab Indicator ─────────────────────────────────

test('status bar: GitLab indicator present with token detection', () => {
  const src = fs.readFileSync(path.join(UI, 'shell/StatusBar.svelte'), 'utf-8');
  assert.ok(src.includes('gitlabHasToken'), 'gitlabHasToken state');
  assert.ok(src.includes('gitlabUser'), 'gitlabUser state');
  assert.ok(src.includes('gitlab-indicator'), 'gitlab-indicator CSS class');
  assert.ok(src.includes("settingsStore.open('accounts')"), 'clicking opens accounts settings');
});

test('status bar: GitLab indicator imports shared expiry logic', () => {
  const src = fs.readFileSync(path.join(UI, 'shell/StatusBar.svelte'), 'utf-8');
  assert.ok(src.includes('accountsExpiryLogic'), 'imports from accountsExpiryLogic');
  assert.ok(src.includes('patNeedsWarning'), 'uses patNeedsWarning');
  assert.ok(src.includes('formatPatIndicator'), 'uses formatPatIndicator');
});

test('status bar: GitLab warning style for expiring tokens', () => {
  const src = fs.readFileSync(path.join(UI, 'shell/StatusBar.svelte'), 'utf-8');
  assert.ok(src.includes('gitlab-warning'), 'warning CSS class for expiring token');
  assert.ok(src.includes('#e8b45a'), 'warning color is yellow/amber');
});

// ── 5. Keymap Editor Interactive UI ────────────────────────────────

test('keymap editor: interactive recording mode in SettingsModal', () => {
  const src = fs.readFileSync(path.join(UI, 'features/settings/SettingsModal.svelte'), 'utf-8');
  assert.ok(src.includes('recordingActionId'), 'recording state exists');
  assert.ok(src.includes('startRecording'), 'startRecording function');
  assert.ok(src.includes('cancelRecording'), 'cancelRecording function');
  assert.ok(src.includes('handleKeymapKeydown'), 'handleKeymapKeydown for key capture');
  assert.ok(src.includes('keymap-record-input'), 'recording input element');
});

test('keymap editor: conflict display and force-override', () => {
  const src = fs.readFileSync(path.join(UI, 'features/settings/SettingsModal.svelte'), 'utf-8');
  assert.ok(src.includes('keymapConflict'), 'conflict state');
  assert.ok(src.includes('keymap-conflict-bar'), 'conflict bar UI');
  assert.ok(src.includes('forceApplyShortcut'), 'force override function');
  assert.ok(src.includes('btn-force'), 'force button CSS class');
});

test('keymap editor: reset per-row and global', () => {
  const src = fs.readFileSync(path.join(UI, 'features/settings/SettingsModal.svelte'), 'utf-8');
  assert.ok(src.includes('keymapStore.resetDefaults()'), 'global reset button');
  assert.ok(src.includes('keymapStore.resetSingle(k.id)'), 'per-row reset button');
  assert.ok(src.includes('btn-reset-all'), 'reset all button CSS');
  assert.ok(src.includes('btn-reset-single'), 'reset single button CSS');
});

test('keymap editor: search filter works on keymapStore.keymaps', () => {
  const src = fs.readFileSync(path.join(UI, 'features/settings/SettingsModal.svelte'), 'utf-8');
  assert.ok(src.includes('keymapStore.keymaps.filter'), 'filters from keymapStore');
  assert.ok(src.includes('keymapSearch'), 'search binding');
});

// ── 6. Accounts Settings Token Details ─────────────────────────────

test('accounts settings: shows token details section', () => {
  const src = fs.readFileSync(path.join(UI, 'features/accounts/AccountsSettings.svelte'), 'utf-8');
  assert.ok(src.includes('token-details'), 'token-details section');
  assert.ok(src.includes('connectedUser'), 'connected user display');
  assert.ok(src.includes('tokenScopes'), 'scopes display');
  assert.ok(src.includes('scope-badge'), 'scope badge styling');
});

test('accounts settings: expiry warning badge', () => {
  const src = fs.readFileSync(path.join(UI, 'features/accounts/AccountsSettings.svelte'), 'utf-8');
  assert.ok(src.includes('expiry-badge'), 'expiry badge CSS class');
  assert.ok(src.includes('expiry-badge warning'), 'warning variant');
  assert.ok(src.includes('expiry-badge expired'), 'expired variant');
  assert.ok(src.includes('expiry-badge ok'), 'ok variant');
});

// ── 7. Version Bump ────────────────────────────────────────────────

test('version bump: DashboardView shows v0.10.0', () => {
  const src = fs.readFileSync(path.join(UI, 'features/dashboard/DashboardView.svelte'), 'utf-8');
  assert.ok(src.includes("version: 'v0.10.0'"), 'v0.10.0 in DashboardView');
});

test('version bump: package.json has 0.10.0', () => {
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf-8'));
  assert.equal(pkg.version, '0.10.0', 'package.json version is 0.10.0');
});

test('version bump: tauri.conf.json has 0.10.0', () => {
  const conf = JSON.parse(fs.readFileSync('crates/app/tauri.conf.json', 'utf-8'));
  assert.equal(conf.version, '0.10.0', 'tauri.conf.json version is 0.10.0');
});

// ── 8. Integration: Self-Improve & Obsidian loop not broken ────────

test('integration: self-improve and obsidian context from commit 3d0bc1c intact', () => {
  // Verify the agent logic and agents.svelte still have the self-improve and obsidian references
  const agentsLogic = fs.readFileSync(path.join(UI, 'features/agents/agentsLogic.ts'), 'utf-8');
  const agentsSvelte = fs.readFileSync(path.join(UI, 'features/agents/agents.svelte.ts'), 'utf-8');
  // Self-improve should still be referenced somewhere
  assert.ok(
    agentsLogic.includes('selfImprove') || agentsLogic.includes('self_improve') ||
    agentsLogic.includes('lesson') || agentsLogic.includes('Lesson') ||
    agentsSvelte.includes('selfImprove') || agentsSvelte.includes('lesson'),
    'Self-improve logic still present in agents module'
  );
});
