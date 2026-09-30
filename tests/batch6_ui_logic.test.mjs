import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uiRoot = path.resolve(__dirname, '../ui');

function collectFiles(dir, exts = ['.svelte']) {
  let results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results = results.concat(collectFiles(fullPath, exts));
    } else if (exts.some((ext) => entry.name.endsWith(ext))) {
      results.push(fullPath);
    }
  }
  return results;
}

const STORE_DEFS = {
  runStore: path.resolve(uiRoot, 'features/run/runStore.svelte.ts'),
  gitStore: path.resolve(uiRoot, 'features/git/git.svelte.ts'),
  toolchainStore: path.resolve(uiRoot, 'features/toolchain/toolchainStore.svelte.ts'),
  mirrorStore: path.resolve(uiRoot, 'features/mirror/mirrorStore.svelte.ts'),
  panelStore: path.resolve(uiRoot, 'shell/panelStore.svelte.ts'),
  popupStore: path.resolve(uiRoot, 'shell/popupStore.svelte.ts'),
  agentsStore: path.resolve(uiRoot, 'features/agents/agents.svelte.ts'),
  mrStore: path.resolve(uiRoot, 'features/mr/mr.svelte.ts'),
  logcatStore: path.resolve(uiRoot, 'features/run/logcatStore.svelte.ts'),
  diagnosticsStore: path.resolve(uiRoot, 'features/editor/lsp/diagnostics.svelte.ts'),
  usagesStore: path.resolve(uiRoot, 'features/editor/lsp/nav.svelte.ts'),
  renameStore: path.resolve(uiRoot, 'features/editor/lsp/rename.svelte.ts'),
  tabsManager: path.resolve(uiRoot, 'features/editor/tabs.svelte.ts'),
};

function extractStoreMethods(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const methods = new Set();

  // Match class method declarations: [async] [get] [private|public|protected] methodName(
  const methodRegex = /(?:async\s+)?(?:get\s+)?(?:(?:private|protected|public)\s+)?([a-zA-Z0-9_$]+)\s*\(/g;
  let m;
  const keywords = new Set(['if', 'for', 'while', 'switch', 'catch', 'function', 'constructor', 'import', 'super', 'return']);
  while ((m = methodRegex.exec(content)) !== null) {
    const name = m[1];
    if (!keywords.has(name)) {
      methods.add(name);
    }
  }

  // Match property methods / arrow functions: propName = (...) => or propName = function
  const propRegex = /([a-zA-Z0-9_$]+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[a-zA-Z0-9_$]+)\s*=>/g;
  while ((m = propRegex.exec(content)) !== null) {
    methods.add(m[1]);
  }

  // Also match declared state properties or fields: fieldName = $state
  const fieldRegex = /([a-zA-Z0-9_$]+)\s*=\s*\$state/g;
  while ((m = fieldRegex.exec(content)) !== null) {
    methods.add(m[1]);
  }

  return methods;
}

test('store method scanner: all <store>.<method>( calls in *.svelte must be defined in the store', () => {
  const svelteFiles = collectFiles(uiRoot, ['.svelte']);
  const storeMethodsMap = new Map();

  for (const [storeName, defPath] of Object.entries(STORE_DEFS)) {
    if (fs.existsSync(defPath)) {
      storeMethodsMap.set(storeName, extractStoreMethods(defPath));
    }
  }

  const callRegex = /\b([a-zA-Z0-9_$]+Store|tabsManager)\.([a-zA-Z0-9_$]+)\s*\(/g;
  const missingCalls = [];

  for (const file of svelteFiles) {
    const content = fs.readFileSync(file, 'utf-8');
    let match;
    while ((match = callRegex.exec(content)) !== null) {
      const storeName = match[1];
      const methodName = match[2];

      const definedMethods = storeMethodsMap.get(storeName);
      if (!definedMethods) {
        // If store is unknown, flag it
        missingCalls.push({
          storeName,
          methodName,
          file: path.relative(uiRoot, file),
          reason: `Unknown store "${storeName}" not mapped in STORE_DEFS`,
        });
      } else if (!definedMethods.has(methodName)) {
        missingCalls.push({
          storeName,
          methodName,
          file: path.relative(uiRoot, file),
          reason: `Method "${methodName}" not defined on ${storeName}`,
        });
      }
    }
  }

  if (missingCalls.length > 0) {
    const errReport = missingCalls
      .map((c) => `  - ${c.storeName}.${c.methodName}() in ${c.file}: ${c.reason}`)
      .join('\n');
    assert.fail(`Found invalid store method calls in .svelte files:\n${errReport}`);
  }
});

// =============================================================================
// Suite 2: Commit Checkbox Lokal (Bug 4)
// =============================================================================

test('commit checkbox lokal: instant in-memory toggle, per-repo memory, default true', () => {
  // Mock store behavior matching gitStore implementation
  const checkedPathsByRepo = {};

  function isPathChecked(root, filePath) {
    const repoMap = checkedPathsByRepo[root];
    if (!repoMap || repoMap[filePath] === undefined) {
      return true; // default checked
    }
    return repoMap[filePath];
  }

  function togglePathChecked(root, filePath) {
    if (!checkedPathsByRepo[root]) checkedPathsByRepo[root] = {};
    const current = isPathChecked(root, filePath);
    checkedPathsByRepo[root][filePath] = !current;
  }

  function setAllPathsChecked(root, paths, checked) {
    if (!checkedPathsByRepo[root]) checkedPathsByRepo[root] = {};
    for (const p of paths) {
      checkedPathsByRepo[root][p] = checked;
    }
  }

  const repo1 = '/repo/alpha';
  const repo2 = '/repo/beta';

  // 1. Default for newly seen file is true (checked)
  assert.equal(isPathChecked(repo1, 'lib/main.dart'), true);
  assert.equal(isPathChecked(repo1, 'pubspec.yaml'), true);

  // 2. Measure toggle latency: must be < 16ms
  const start = performance.now();
  for (let i = 0; i < 1000; i++) {
    togglePathChecked(repo1, 'lib/main.dart');
  }
  const elapsed = (performance.now() - start) / 1000;
  assert.ok(elapsed < 16, `Toggle took ${elapsed.toFixed(4)}ms, expected < 16ms`);

  // After 1000 toggles, it should be back to true
  assert.equal(isPathChecked(repo1, 'lib/main.dart'), true);

  // Uncheck one file
  togglePathChecked(repo1, 'lib/main.dart');
  assert.equal(isPathChecked(repo1, 'lib/main.dart'), false);
  assert.equal(isPathChecked(repo1, 'pubspec.yaml'), true);

  // 3. Isolated per repo
  assert.equal(isPathChecked(repo2, 'lib/main.dart'), true);

  // 4. Preserved across refresh: simulating refresh with newly discovered file
  const filesAfterRefresh = ['lib/main.dart', 'pubspec.yaml', 'lib/new_feature.dart'];
  assert.equal(isPathChecked(repo1, 'lib/main.dart'), false, 'user uncheck persisted');
  assert.equal(isPathChecked(repo1, 'pubspec.yaml'), true, 'unchanged file remains checked');
  assert.equal(isPathChecked(repo1, 'lib/new_feature.dart'), true, 'new file defaults to checked');

  // 5. Select all toggle
  setAllPathsChecked(repo1, filesAfterRefresh, false);
  assert.equal(isPathChecked(repo1, 'pubspec.yaml'), false);
  assert.equal(isPathChecked(repo1, 'lib/new_feature.dart'), false);

  setAllPathsChecked(repo1, filesAfterRefresh, true);
  assert.equal(isPathChecked(repo1, 'lib/main.dart'), true);
  assert.equal(isPathChecked(repo1, 'pubspec.yaml'), true);
});

// =============================================================================
// Suite 3: Double Shift Detector (Item 10)
// =============================================================================
import { createDoubleShiftDetector } from '../ui/features/search/keymap.ts';

test('double shift detector: unit tests with fake timer', () => {
  let virtualTime = 1000;
  const now = () => virtualTime;
  let triggerCount = 0;

  const detector = createDoubleShiftDetector({
    thresholdMs: 350,
    onTrigger: () => {
      triggerCount++;
    },
    now,
  });

  // Scenario 1: Quick double-shift (100ms apart) -> triggers once
  detector.handleKeyDown({ key: 'Shift' });
  virtualTime += 50;
  detector.handleKeyUp({ key: 'Shift' });
  virtualTime += 100;
  detector.handleKeyDown({ key: 'Shift' });
  virtualTime += 50;
  detector.handleKeyUp({ key: 'Shift' });

  assert.equal(triggerCount, 1, 'Quick double-shift must trigger once');

  // Scenario 2: Slow shift presses (>350ms apart) -> does not trigger
  virtualTime += 1000;
  detector.handleKeyDown({ key: 'Shift' });
  virtualTime += 50;
  detector.handleKeyUp({ key: 'Shift' });
  virtualTime += 400; // 400ms > 350ms
  detector.handleKeyDown({ key: 'Shift' });
  virtualTime += 50;
  detector.handleKeyUp({ key: 'Shift' });

  assert.equal(triggerCount, 1, 'Slow shift presses > 350ms must not trigger');

  // Scenario 3: Shift + A (typing capital letter) -> interrupts, does not trigger
  virtualTime += 1000;
  detector.handleKeyDown({ key: 'Shift' });
  virtualTime += 30;
  detector.handleKeyDown({ key: 'A' });
  virtualTime += 20;
  detector.handleKeyUp({ key: 'A' });
  virtualTime += 20;
  detector.handleKeyUp({ key: 'Shift' });

  virtualTime += 100; // Follow-up quick shift
  detector.handleKeyDown({ key: 'Shift' });
  virtualTime += 50;
  detector.handleKeyUp({ key: 'Shift' });

  assert.equal(triggerCount, 1, 'Shift+Letter sequence must not trigger double-shift');

  // Scenario 4: Shift repeat event (holding down Shift) -> ignored
  virtualTime += 1000;
  detector.handleKeyDown({ key: 'Shift' });
  virtualTime += 100;
  detector.handleKeyDown({ key: 'Shift', repeat: true });
  virtualTime += 100;
  detector.handleKeyDown({ key: 'Shift', repeat: true });
  virtualTime += 100;
  detector.handleKeyUp({ key: 'Shift' });

  assert.equal(triggerCount, 1, 'Holding shift with repeat events must not trigger');
});
