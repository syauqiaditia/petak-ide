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
