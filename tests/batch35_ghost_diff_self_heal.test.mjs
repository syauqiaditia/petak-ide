import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { EditorState } from '@codemirror/state';
import {
  showGhostDiff,
  clearGhostDiff,
  acceptGhostDiff,
  dismissGhostDiff,
  getActiveGhostDiff,
  ghostDiffExtension,
  createGhostDiffExtension,
  setGhostDiffEffect,
  clearGhostDiffEffect,
  ghostDiffStateField,
  ghostDiffDecorationField,
} from '../ui/features/editor/ghostDiff.ts';
import { createEditorKeyBindings } from '../ui/features/editor/keymap.ts';
import { api, agentTriggerSelfHeal, agentGetSelfHealStatus } from '../ui/lib/api.ts';
import { DEMO_SELF_HEAL_STATUS, DEMO_SELF_HEAL_RESULT } from '../ui/features/agents/fixtures.ts';
import {
  formatSelfHealStatus,
  resolveSelfHealChip,
} from '../ui/features/agents/agentsLogic.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uiRoot = path.resolve(__dirname, '../ui');

// Helper to create mock EditorView with ghost diff extension
function createMockDiffEditorView(initialDoc) {
  let currentState = EditorState.create({
    doc: initialDoc,
    extensions: [
      ghostDiffStateField,
      ghostDiffDecorationField,
    ],
  });

  const dispatch = (tr) => {
    if (typeof tr === 'function') {
      tr = tr(currentState);
    }
    if (tr && tr.state) {
      currentState = tr.state;
    } else if (tr) {
      currentState = currentState.update(tr).state;
    }
    view.state = currentState;
  };

  const view = {
    state: currentState,
    dispatch,
    composing: false,
    destroy: () => {},
  };

  return view;
}

// =============================================================================
// Suite 1: CodeMirror 6 Inline Ghost Diff Extension Contracts
// =============================================================================

test('b35 Ghost Diff 1: Export contracts & extension structure', () => {
  assert.equal(typeof showGhostDiff, 'function', 'showGhostDiff must be a function');
  assert.equal(typeof clearGhostDiff, 'function', 'clearGhostDiff must be a function');
  assert.equal(typeof acceptGhostDiff, 'function', 'acceptGhostDiff must be a function');
  assert.equal(typeof dismissGhostDiff, 'function', 'dismissGhostDiff must be a function');
  assert.equal(typeof getActiveGhostDiff, 'function', 'getActiveGhostDiff must be a function');
  assert.equal(typeof ghostDiffExtension, 'function', 'ghostDiffExtension must be a function');
  assert.equal(typeof createGhostDiffExtension, 'function', 'createGhostDiffExtension must be an alias');

  assert.ok(setGhostDiffEffect, 'setGhostDiffEffect must be defined');
  assert.ok(clearGhostDiffEffect, 'clearGhostDiffEffect must be defined');
  assert.ok(ghostDiffStateField, 'ghostDiffStateField must be defined');
  assert.ok(ghostDiffDecorationField, 'ghostDiffDecorationField must be defined');

  const ext = ghostDiffExtension();
  assert.ok(Array.isArray(ext), 'ghostDiffExtension must return an array of extensions');
  assert.ok(ext.length >= 2, 'extension must contain state fields');
});

test('b35 Ghost Diff 2: showGhostDiff, acceptGhostDiff & dismissGhostDiff flow', () => {
  const initialDoc = 'line 1\nconst x = 10;\nline 3';
  const view = createMockDiffEditorView(initialDoc);

  // 1. Initial state has no ghost diff
  assert.equal(getActiveGhostDiff(view.state), null, 'initial ghost diff must be null');
  assert.equal(acceptGhostDiff(view), false, 'acceptGhostDiff returns false when no active diff');
  assert.equal(dismissGhostDiff(view), false, 'dismissGhostDiff returns false when no active diff');

  // 2. showGhostDiff displays hunk at line 2
  showGhostDiff(view, 'const x = 10;', 'const x = 20;', 2);
  const activeHunk = getActiveGhostDiff(view.state);
  assert.ok(activeHunk, 'active hunk must exist after showGhostDiff');
  assert.equal(activeHunk.original, 'const x = 10;');
  assert.equal(activeHunk.replacement, 'const x = 20;');
  assert.equal(activeHunk.fromLine, 2);

  // 3. acceptGhostDiff applies replacement and clears diff
  const accepted = acceptGhostDiff(view);
  assert.equal(accepted, true, 'acceptGhostDiff returns true on successful accept');
  assert.equal(view.state.doc.toString(), 'line 1\nconst x = 20;\nline 3', 'document doc must be updated');
  assert.equal(getActiveGhostDiff(view.state), null, 'ghost diff must be cleared after accept');

  // 4. showGhostDiff then dismissGhostDiff leaves document untouched
  showGhostDiff(view, 'const x = 20;', 'const x = 99;', 2);
  assert.ok(getActiveGhostDiff(view.state), 'hunk active before dismiss');
  const dismissed = dismissGhostDiff(view);
  assert.equal(dismissed, true, 'dismissGhostDiff returns true on dismiss');
  assert.equal(view.state.doc.toString(), 'line 1\nconst x = 20;\nline 3', 'document text remains unchanged on dismiss');
  assert.equal(getActiveGhostDiff(view.state), null, 'ghost diff must be cleared after dismiss');

  // 5. clearGhostDiff explicitly clears hunk
  showGhostDiff(view, 'line 1', 'first line', 1);
  assert.ok(getActiveGhostDiff(view.state));
  clearGhostDiff(view);
  assert.equal(getActiveGhostDiff(view.state), null, 'clearGhostDiff clears active diff');
});

// =============================================================================
// Suite 2: Editor Keymap Integration (Tab / Escape)
// =============================================================================

test('b35 Keymap Integration: Tab accepts ghost diff, Esc rejects ghost diff', () => {
  const bindings = createEditorKeyBindings();
  const tabBinding = bindings.find((b) => b.key === 'Tab');
  const escBinding = bindings.find((b) => b.key === 'Escape');

  assert.ok(tabBinding, 'Tab keybinding must be registered');
  assert.ok(escBinding, 'Escape keybinding must be registered');

  const view = createMockDiffEditorView('function hello() {\n  return false;\n}');

  // 1. When ghost diff is active: Tab accepts it
  showGhostDiff(view, '  return false;', '  return true;', 2);
  assert.ok(getActiveGhostDiff(view.state), 'ghost diff must be set');

  const tabHandled = tabBinding.run(view);
  assert.equal(tabHandled, true, 'Tab must handle and consume active ghost diff');
  assert.equal(view.state.doc.toString(), 'function hello() {\n  return true;\n}');
  assert.equal(getActiveGhostDiff(view.state), null, 'diff must be cleared after Tab accept');

  // 2. When ghost diff is active: Escape rejects/dismisses it
  showGhostDiff(view, '  return true;', '  return null;', 2);
  assert.ok(getActiveGhostDiff(view.state), 'ghost diff must be set');

  const escHandled = escBinding.run(view);
  assert.equal(escHandled, true, 'Escape must handle and consume active ghost diff');
  assert.equal(view.state.doc.toString(), 'function hello() {\n  return true;\n}', 'doc unchanged on Esc');
  assert.equal(getActiveGhostDiff(view.state), null, 'diff must be cleared after Esc reject');

  // 3. When no ghost diff / completion is active: Escape falls through (returns false)
  const escFallthrough = escBinding.run(view);
  assert.equal(escFallthrough, false, 'Escape falls through when no ghost diff active');
});

// =============================================================================
// Suite 3: TypeScript Interface Contracts & API Bindings
// =============================================================================

test('b35 Interface & API Contracts: SelfHealStatus & SelfHealResult', async () => {
  const typesPath = path.resolve(uiRoot, 'features/agents/types.ts');
  const typesSrc = fs.readFileSync(typesPath, 'utf-8');

  // Verify SelfHealPhase type
  assert.ok(typesSrc.includes('export type SelfHealPhase'), 'types.ts must export SelfHealPhase');
  assert.ok(typesSrc.includes("'idle'"), 'SelfHealPhase includes idle');
  assert.ok(typesSrc.includes("'hot_reloading'"), 'SelfHealPhase includes hot_reloading');
  assert.ok(typesSrc.includes("'testing'"), 'SelfHealPhase includes testing');
  assert.ok(typesSrc.includes("'passed'"), 'SelfHealPhase includes passed');
  assert.ok(typesSrc.includes("'failed'"), 'SelfHealPhase includes failed');
  assert.ok(typesSrc.includes("'paused'"), 'SelfHealPhase includes paused');

  // Verify SelfHealStatus interface
  assert.ok(typesSrc.includes('export interface SelfHealStatus'), 'types.ts must export SelfHealStatus');
  assert.ok(typesSrc.includes('task_id: string;'), 'SelfHealStatus has task_id');
  assert.ok(typesSrc.includes('active_file: string;'), 'SelfHealStatus has active_file');
  assert.ok(typesSrc.includes('status: SelfHealPhase;'), 'SelfHealStatus has status');
  assert.ok(typesSrc.includes('attempt: number;'), 'SelfHealStatus has attempt');
  assert.ok(typesSrc.includes('max_attempts: number;'), 'SelfHealStatus has max_attempts');

  // Verify SelfHealResult interface
  assert.ok(typesSrc.includes('export interface SelfHealResult'), 'types.ts must export SelfHealResult');
  assert.ok(typesSrc.includes('success: boolean;'), 'SelfHealResult has success');
  assert.ok(typesSrc.includes('attempts: number;'), 'SelfHealResult has attempts');

  // Verify API exports in api.ts
  assert.equal(typeof api.agentTriggerSelfHeal, 'function', 'api.agentTriggerSelfHeal must be a function');
  assert.equal(typeof api.agentGetSelfHealStatus, 'function', 'api.agentGetSelfHealStatus must be a function');
  assert.equal(typeof agentTriggerSelfHeal, 'function', 'agentTriggerSelfHeal standalone must be exported');
  assert.equal(typeof agentGetSelfHealStatus, 'function', 'agentGetSelfHealStatus standalone must be exported');

  // Test agentGetSelfHealStatus mock resolution
  const status = await api.agentGetSelfHealStatus('t_test_heal_1');
  assert.ok(status, 'status must be returned');
  assert.equal(status.task_id, 't_test_heal_1');
  assert.equal(status.status, 'idle');
  assert.equal(status.attempt, 0);
  assert.equal(status.max_attempts, 3);

  // Test agentTriggerSelfHeal mock resolution
  const result = await api.agentTriggerSelfHeal('t_test_heal_1', 'lib/screens/main.dart');
  assert.ok(result, 'result must be returned');
  assert.equal(result.task_id, 't_test_heal_1');
  assert.equal(result.success, true);
  assert.equal(result.status, 'passed');
  assert.equal(result.attempts, 1);

  // Verify fixtures conform to contracts
  assert.ok(DEMO_SELF_HEAL_STATUS['t_default'], 'DEMO_SELF_HEAL_STATUS t_default exists');
  assert.equal(DEMO_SELF_HEAL_STATUS['t_default'].status, 'idle');
  assert.ok(DEMO_SELF_HEAL_STATUS['t_hot_reload'], 'DEMO_SELF_HEAL_STATUS t_hot_reload exists');
  assert.equal(DEMO_SELF_HEAL_STATUS['t_hot_reload'].status, 'hot_reloading');
  assert.ok(DEMO_SELF_HEAL_RESULT, 'DEMO_SELF_HEAL_RESULT fixture exists');
  assert.equal(DEMO_SELF_HEAL_RESULT.success, true);
});

// =============================================================================
// Suite 4: Status Pill Formatting & State Transitions
// =============================================================================

test('b35 Status Pill Formatting & State Transitions', () => {
  // 1. Idle / Default
  const idle = formatSelfHealStatus('idle');
  assert.equal(idle.label, '🔄 Self-Heal: Auto (Hot Reload + Test)');
  assert.equal(idle.icon, '🔄');
  assert.equal(idle.cssClass, 'self-heal-idle');

  // 2. Hot Reloading
  const reloading = formatSelfHealStatus('hot_reloading');
  assert.equal(reloading.label, '⚡ Hot Reloading Flutter...');
  assert.equal(reloading.icon, '⚡');
  assert.equal(reloading.cssClass, 'self-heal-hot-reloading');

  // 3. Testing
  const testing = formatSelfHealStatus('testing');
  assert.equal(testing.label, '🧪 Running Maestro flow...');
  assert.equal(testing.icon, '🧪');
  assert.equal(testing.cssClass, 'self-heal-testing');

  // 4. Passed
  const passed = formatSelfHealStatus('passed');
  assert.equal(passed.label, '✅ Verification PASS');
  assert.equal(passed.icon, '✅');
  assert.equal(passed.cssClass, 'self-heal-passed');

  // 5. Failed with attempt counter
  const failed = formatSelfHealStatus('failed', 1, 3);
  assert.equal(failed.label, '⚠️ Test Failed -> Triggering Self-Fix Loop (1/3)');
  assert.equal(failed.icon, '⚠️');
  assert.equal(failed.cssClass, 'self-heal-failed');

  // 6. Paused (exhausted attempts)
  const paused = formatSelfHealStatus('paused', 3, 3);
  assert.equal(paused.label, '🛑 Self-Heal Paused (3/3 attempts failed)');
  assert.equal(paused.icon, '🛑');
  assert.equal(paused.cssClass, 'self-heal-paused');

  // 7. resolveSelfHealChip helper
  const chipIdle = resolveSelfHealChip(null);
  assert.equal(chipIdle.label, '🔄 Self-Heal: Auto (Hot Reload + Test)');

  const chipTesting = resolveSelfHealChip({
    task_id: 't_lane_1',
    active_file: 'lib/main.dart',
    status: 'testing',
    attempt: 2,
    max_attempts: 3,
  });
  assert.equal(chipTesting.label, '🧪 Running Maestro flow...');
  assert.equal(chipTesting.cssClass, 'self-heal-testing');
});

// =============================================================================
// Suite 5: Svelte Components Integration Verification
// =============================================================================

test('b35 Svelte Components Integration: AgentChat, WorktreeLanes & Editor', () => {
  // 1. AgentChat.svelte integration
  const chatSrc = fs.readFileSync(path.resolve(uiRoot, 'features/agents/AgentChat.svelte'), 'utf-8');
  assert.ok(chatSrc.includes('🔄 Self-Heal: Auto (Hot Reload + Test)'), 'AgentChat must render Self-Heal context pill label');
  assert.ok(chatSrc.includes('context-pill self-heal'), 'AgentChat must have .context-pill.self-heal button');
  assert.ok(chatSrc.includes('self-heal-status-banner'), 'AgentChat must render interactive self-heal status banner');
  assert.ok(chatSrc.includes('formatSelfHealStatus'), 'AgentChat must use formatSelfHealStatus');

  // 2. WorktreeLanes.svelte integration
  const lanesSrc = fs.readFileSync(path.resolve(uiRoot, 'features/agents/WorktreeLanes.svelte'), 'utf-8');
  assert.ok(lanesSrc.includes('self-heal-chip'), 'WorktreeLanes must render self-heal-chip');
  assert.ok(lanesSrc.includes('resolveSelfHealChip'), 'WorktreeLanes must use resolveSelfHealChip');
  assert.ok(lanesSrc.includes('api.agentGetSelfHealStatus'), 'WorktreeLanes must call api.agentGetSelfHealStatus');

  // 3. Editor.svelte integration
  const editorSrc = fs.readFileSync(path.resolve(uiRoot, 'features/editor/Editor.svelte'), 'utf-8');
  assert.ok(editorSrc.includes('ghostDiffExtension'), 'Editor.svelte must import and register ghostDiffExtension');
});
