import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Mock Svelte runes for Node test environment
if (typeof globalThis.$state === 'undefined') {
  globalThis.$state = (v) => v;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const uiRoot = path.resolve(projectRoot, 'ui');

// =============================================================================
// Suite 1: Keymap keyEventToShortcut special key mapping
// =============================================================================

test('b51 Keymap: keyEventToShortcut maps special keys correctly without uppercase shadowing', async () => {
  const { keyEventToShortcut } = await import('../ui/features/settings/keymapStore.svelte.ts');

  // Special keys without modifiers
  assert.equal(keyEventToShortcut({ key: 'Enter' }), '↩', 'Enter must map to ↩, not ENTER');
  assert.equal(keyEventToShortcut({ key: 'Backspace' }), '⌫', 'Backspace must map to ⌫, not BACKSPACE');
  assert.equal(keyEventToShortcut({ key: 'Escape' }), 'Esc', 'Escape must map to Esc, not ESCAPE');
  assert.equal(keyEventToShortcut({ key: 'ArrowUp' }), '↑', 'ArrowUp must map to ↑');
  assert.equal(keyEventToShortcut({ key: ' ' }), 'Space', 'Space key must map to Space');

  // With modifiers
  assert.equal(
    keyEventToShortcut({ key: 'Enter', metaKey: true }),
    '⌘↩',
    'Cmd+Enter must map to ⌘↩'
  );
  assert.equal(
    keyEventToShortcut({ key: 'k', metaKey: true }),
    '⌘K',
    'Cmd+k must map to ⌘K'
  );

  // Verify source code uses nullish coalescing ?? to avoid operator precedence bug
  const code = fs.readFileSync(path.resolve(uiRoot, 'features/settings/keymapStore.svelte.ts'), 'utf-8');
  assert.ok(
    code.includes('parts.push(keyMap[key] ?? (key.length === 1 ? key.toUpperCase() : key));'),
    'keymapStore must use nullish coalescing to prevent ternary operator bug'
  );
});

// =============================================================================
// Suite 2: ProblemsPanel & ToolchainStore open settings category
// =============================================================================

test('b51 Settings Trigger: ProblemsPanel & ToolchainStore navigate directly to toolchains category', () => {
  const problemsCode = fs.readFileSync(path.resolve(uiRoot, 'features/problems/ProblemsPanel.svelte'), 'utf-8');
  assert.ok(
    problemsCode.includes("import { settingsStore } from '../settings/settingsStore.svelte';"),
    'ProblemsPanel must import settingsStore'
  );
  assert.ok(
    problemsCode.includes("settingsStore.open('toolchains');"),
    "ProblemsPanel Open Settings button must call settingsStore.open('toolchains')"
  );

  const toolchainCode = fs.readFileSync(path.resolve(uiRoot, 'features/toolchain/toolchainStore.svelte.ts'), 'utf-8');
  assert.ok(
    toolchainCode.includes("import { settingsStore } from '../settings/settingsStore.svelte';"),
    'toolchainStore must import settingsStore'
  );
  assert.ok(
    toolchainCode.includes("settingsStore.open('toolchains');"),
    "toolchainStore toast action must call settingsStore.open('toolchains')"
  );
});

// =============================================================================
// Suite 3: StatusBar Kotlin LS install progress & valid root refresh
// =============================================================================

test('b51 StatusBar: handleInstallKls uses onKotlinLsProgress and passes project root to refresh', () => {
  const statusbarCode = fs.readFileSync(path.resolve(uiRoot, 'shell/StatusBar.svelte'), 'utf-8');

  assert.ok(
    statusbarCode.includes('api.onKotlinLsProgress('),
    'handleInstallKls must register api.onKotlinLsProgress'
  );
  assert.ok(
    statusbarCode.includes("toolchainStore.refresh(gitStore.root || runStore.root || '');"),
    'handleInstallKls must pass non-undefined root to toolchainStore.refresh'
  );
});
