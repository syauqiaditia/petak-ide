import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  calculateSavingsPercentage,
  computeTokenSavingsPercentage,
  formatTokenSavingsPill,
  formatPrunedContextForPrompt,
  formatDomainMemoryForPrompt,
  buildSmartContextPrompt,
  applyDisciplineDirectives,
  isLspPruningEnabled,
  isDomainMemoryEnabled,
} from '../ui/features/agents/agentsLogic.ts';
import { api } from '../ui/lib/api.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uiRoot = path.resolve(__dirname, '../ui');

test('b33 Smart Context 1: API bindings & data structure contracts', async () => {
  // 1. Verify agentPruneContext exists on api
  assert.equal(typeof api.agentPruneContext, 'function', 'api.agentPruneContext must be a function');

  const pruned = await api.agentPruneContext('lib/features/auth/login_controller.dart', 42, 'authenticate');
  assert.ok(pruned, 'agentPruneContext must return a result object');
  assert.equal(pruned.filePath, 'lib/features/auth/login_controller.dart');
  assert.ok(typeof pruned.totalLines === 'number' && pruned.totalLines > 0, 'totalLines must be positive number');
  assert.ok(typeof pruned.prunedLines === 'number' && pruned.prunedLines > 0, 'prunedLines must be positive number');
  assert.ok(typeof pruned.estimatedTokensSaved === 'number', 'estimatedTokensSaved must be a number');
  assert.ok(Array.isArray(pruned.symbolOutline), 'symbolOutline must be an array');
  assert.ok(Array.isArray(pruned.diagnostics), 'diagnostics must be an array');
  assert.ok(typeof pruned.compactSummary === 'string' && pruned.compactSummary.length > 0, 'compactSummary must be non-empty string');

  // Verify symbol outline structure
  assert.ok(pruned.symbolOutline.length > 0);
  const sym = pruned.symbolOutline[0];
  assert.ok(sym.name, 'symbol name must exist');
  assert.ok(sym.kind, 'symbol kind must exist');
  assert.ok(typeof sym.line === 'number', 'symbol line must be number');
  assert.ok(sym.signature, 'symbol signature must exist');

  // 2. Verify agentGetRelevantMemory exists on api
  assert.equal(typeof api.agentGetRelevantMemory, 'function', 'api.agentGetRelevantMemory must be a function');

  const memoryFlutter = await api.agentGetRelevantMemory('lib/main.dart');
  assert.ok(Array.isArray(memoryFlutter), 'agentGetRelevantMemory must return an array');
  assert.ok(memoryFlutter.length > 0, 'must return at least 1 memory snippet');
  assert.equal(memoryFlutter[0].domain, 'flutter', 'dart file must map to flutter domain');
  assert.ok(memoryFlutter[0].title, 'snippet title must exist');
  assert.ok(memoryFlutter[0].content, 'snippet content must exist');

  const memoryRust = await api.agentGetRelevantMemory('crates/core/src/agent/context.rs');
  assert.equal(memoryRust[0].domain, 'rust', 'rs file must map to rust domain');

  const memoryUI = await api.agentGetRelevantMemory('ui/features/agents/AgentChat.svelte');
  assert.equal(memoryUI[0].domain, 'frontend', 'svelte file must map to frontend domain');
});

test('b33 Smart Context 2: Token savings percentage calculation & formatting', () => {
  // 1. Calculation logic
  assert.equal(calculateSavingsPercentage(250, 175), 70, '175 / 250 is 70%');
  assert.equal(calculateSavingsPercentage(100, 80), 80, '80 / 100 is 80%');
  assert.equal(calculateSavingsPercentage(100, 65), 65, '65 / 100 is 65%');
  assert.equal(calculateSavingsPercentage(0, 0), 0, '0 / 0 returns 0% without NaN/division by zero');
  assert.equal(calculateSavingsPercentage(-10, 5), 0, 'negative totalLines returns 0%');

  // Alias verification
  assert.equal(computeTokenSavingsPercentage(200, 150), 75, 'alias computeTokenSavingsPercentage works');

  // 2. formatTokenSavingsPill logic: ⚡ Pruned (~X% token saved)
  assert.equal(formatTokenSavingsPill(70), '⚡ Pruned (~70% token saved)');
  assert.equal(formatTokenSavingsPill(80), '⚡ Pruned (~80% token saved)');
  assert.equal(formatTokenSavingsPill(0), '⚡ Pruned (~0% token saved)');

  // From PrunedContextResult object
  const mockResult = {
    filePath: 'test.dart',
    totalLines: 1000,
    prunedLines: 720,
    estimatedTokensSaved: 2500,
    symbolOutline: [],
    diagnostics: [],
    compactSummary: 'Pruned summary',
  };
  assert.equal(formatTokenSavingsPill(mockResult), '⚡ Pruned (~72% token saved)');
});

test('b33 Smart Context 3: Prompt header conventions & context formatting', () => {
  // 1. formatDomainMemoryForPrompt
  const snippets = [
    {
      domain: 'flutter',
      sourceFile: 'flutter-conventions.md',
      title: 'State Management & BuildContext',
      content: 'Never use BuildContext across async gaps without mounted check.',
    },
    {
      domain: 'flutter',
      sourceFile: 'flutter-testing.md',
      title: 'Lean Testing',
      content: 'Run targeted test files instead of full test suite.',
    },
  ];

  const formattedMemory = formatDomainMemoryForPrompt(snippets);
  assert.ok(formattedMemory.includes('[PROJECT CONVENTIONS: FLUTTER]'), 'must include domain header tag');
  assert.ok(formattedMemory.includes('[/PROJECT CONVENTIONS: FLUTTER]'), 'must include domain closing tag');
  assert.ok(formattedMemory.includes('State Management & BuildContext'));
  assert.ok(formattedMemory.includes('Never use BuildContext across async gaps'));

  // Multi-domain grouping
  const multiSnippets = [
    { domain: 'rust', sourceFile: 'rust.md', title: 'Error Handling', content: 'Use thiserror for library errors.' },
    { domain: 'frontend', sourceFile: 'svelte.md', title: 'Reactivity', content: 'Use $state runes for Svelte 5.' },
  ];
  const multiFormatted = formatDomainMemoryForPrompt(multiSnippets);
  assert.ok(multiFormatted.includes('[PROJECT CONVENTIONS: RUST]'));
  assert.ok(multiFormatted.includes('[/PROJECT CONVENTIONS: RUST]'));
  assert.ok(multiFormatted.includes('[PROJECT CONVENTIONS: FRONTEND]'));
  assert.ok(multiFormatted.includes('[/PROJECT CONVENTIONS: FRONTEND]'));

  // Empty check
  assert.equal(formatDomainMemoryForPrompt([]), '');
  assert.equal(formatDomainMemoryForPrompt(null), '');

  // 2. formatPrunedContextForPrompt
  const mockPruned = {
    filePath: 'crates/core/src/agent/context.rs',
    totalLines: 500,
    prunedLines: 350,
    estimatedTokensSaved: 1200,
    symbolOutline: [
      {
        name: 'ContextPruner',
        kind: 'struct',
        line: 15,
        signature: 'pub struct ContextPruner',
        children: [
          {
            name: 'prune_file',
            kind: 'method',
            line: 25,
            signature: 'pub fn prune_file(&self, path: &Path) -> Result<PrunedContext>',
          },
        ],
      },
    ],
    diagnostics: [
      {
        line: 30,
        message: 'Unused import warning',
        severity: 'warning',
      },
    ],
    compactSummary: 'Outline for context.rs: 1 struct, 1 method.',
  };

  const formattedPruned = formatPrunedContextForPrompt(mockPruned);
  assert.ok(formattedPruned.includes('[PRUNED LSP CONTEXT: crates/core/src/agent/context.rs]'));
  assert.ok(formattedPruned.includes('Outline for context.rs: 1 struct, 1 method.'));
  assert.ok(formattedPruned.includes('struct ContextPruner (line 15): pub struct ContextPruner'));
  assert.ok(formattedPruned.includes('method prune_file (line 25)'));
  assert.ok(formattedPruned.includes('[WARNING] Line 30: Unused import warning'));
  assert.ok(formattedPruned.includes('[/PRUNED LSP CONTEXT]'));

  // 3. buildSmartContextPrompt & fallback
  const fallbackPrompt = buildSmartContextPrompt('Tolong jelaskan file ini.', null, null);
  assert.equal(fallbackPrompt, 'Tolong jelaskan file ini.', 'Fallback with nulls returns raw prompt cleanly');

  const fullPrompt = buildSmartContextPrompt('Tolong refactor method prune_file.', mockPruned, snippets);
  assert.ok(fullPrompt.includes('[PROJECT CONVENTIONS: FLUTTER]'));
  assert.ok(fullPrompt.includes('[PRUNED LSP CONTEXT: crates/core/src/agent/context.rs]'));
  assert.ok(fullPrompt.endsWith('Tolong refactor method prune_file.'));

  // 4. applyDisciplineDirectives with domainMemoryInjection
  const promptWithDirectives = applyDisciplineDirectives(
    'Refactor code ini',
    true,
    false,
    true,
    '',
    '',
    formattedMemory
  );
  assert.ok(promptWithDirectives.includes('[DISCIPLINE: PONYTAIL'));
  assert.ok(promptWithDirectives.includes('[PROJECT CONVENTIONS: FLUTTER]'));
  assert.ok(promptWithDirectives.includes('Refactor code ini'));
});

test('b33 Smart Context 4: Settings toggle reactive state and persistence contracts', () => {
  // Verify settingsStore declarations and persistence implementation
  const storePath = path.resolve(uiRoot, 'features/settings/settingsStore.svelte.ts');
  const storeCode = fs.readFileSync(storePath, 'utf-8');

  // Verify state fields and defaults
  assert.ok(
    storeCode.includes('lspContextPruning = $state<boolean>('),
    'settingsStore must declare lspContextPruning state'
  );
  assert.ok(
    storeCode.includes("localStorage.getItem('petak.agents.lsp_pruning') !== 'false'"),
    'lspContextPruning must default to true when unset'
  );

  assert.ok(
    storeCode.includes('domainMemoryFiltering = $state<boolean>('),
    'settingsStore must declare domainMemoryFiltering state'
  );
  assert.ok(
    storeCode.includes("localStorage.getItem('petak.agents.domain_memory') !== 'false'"),
    'domainMemoryFiltering must default to true when unset'
  );

  // Verify setter methods
  assert.ok(
    storeCode.includes('setLspContextPruning(value: boolean)'),
    'settingsStore must implement setLspContextPruning'
  );
  assert.ok(
    storeCode.includes("localStorage.setItem('petak.agents.lsp_pruning', String(value))"),
    'setLspContextPruning must persist to petak.agents.lsp_pruning'
  );

  assert.ok(
    storeCode.includes('setDomainMemoryFiltering(value: boolean)'),
    'settingsStore must implement setDomainMemoryFiltering'
  );
  assert.ok(
    storeCode.includes("localStorage.setItem('petak.agents.domain_memory', String(value))"),
    'setDomainMemoryFiltering must persist to petak.agents.domain_memory'
  );

  // Test pure evaluation helpers
  assert.equal(isLspPruningEnabled(null), true, 'null storage defaults to true');
  assert.equal(isLspPruningEnabled(undefined), true, 'undefined storage defaults to true');
  assert.equal(isLspPruningEnabled('true'), true, '"true" storage evaluates to true');
  assert.equal(isLspPruningEnabled('false'), false, '"false" storage evaluates to false');

  assert.equal(isDomainMemoryEnabled(null), true, 'null storage defaults to true');
  assert.equal(isDomainMemoryEnabled(undefined), true, 'undefined storage defaults to true');
  assert.equal(isDomainMemoryEnabled('true'), true, '"true" storage evaluates to true');
  assert.equal(isDomainMemoryEnabled('false'), false, '"false" storage evaluates to false');
});

test('b33 Smart Context 5: Composer pill presence & UI component integration', () => {
  // 1. AgentChat.svelte integration
  const agentChatPath = path.join(uiRoot, 'features', 'agents', 'AgentChat.svelte');
  const agentChatSrc = fs.readFileSync(agentChatPath, 'utf-8');

  assert.ok(agentChatSrc.includes('smart-context-pill'), 'AgentChat must have smart-context-pill');
  assert.ok(agentChatSrc.includes('formatTokenSavingsPill'), 'AgentChat must use formatTokenSavingsPill');
  assert.ok(agentChatSrc.includes('triggerSmartContextPruning'), 'AgentChat must invoke triggerSmartContextPruning');
  assert.ok(agentChatSrc.includes('api.agentPruneContext'), 'AgentChat must call api.agentPruneContext');
  assert.ok(agentChatSrc.includes('api.agentGetRelevantMemory'), 'AgentChat must call api.agentGetRelevantMemory');
  assert.ok(agentChatSrc.includes('pruned-summary-popover'), 'AgentChat must include pruned-summary-popover');
  assert.ok(agentChatSrc.includes('formatPrunedContextForPrompt'), 'AgentChat must format pruned context into outgoing prompt');
  assert.ok(agentChatSrc.includes('formatDomainMemoryForPrompt'), 'AgentChat must format domain memory into outgoing prompt');

  // 2. SettingsModal.svelte integration
  const settingsModalPath = path.join(uiRoot, 'features', 'settings', 'SettingsModal.svelte');
  const settingsModalSrc = fs.readFileSync(settingsModalPath, 'utf-8');

  assert.ok(
    settingsModalSrc.includes('LSP Context Pruning (Outline & Diagnostics)'),
    'SettingsModal must display "LSP Context Pruning (Outline & Diagnostics)" toggle'
  );
  assert.ok(
    settingsModalSrc.includes('Domain-Aware Memory Filtering'),
    'SettingsModal must display "Domain-Aware Memory Filtering" toggle'
  );
  assert.ok(
    settingsModalSrc.includes('settingsStore.lspContextPruning'),
    'SettingsModal must bind to settingsStore.lspContextPruning'
  );
  assert.ok(
    settingsModalSrc.includes('settingsStore.domainMemoryFiltering'),
    'SettingsModal must bind to settingsStore.domainMemoryFiltering'
  );

  // 3. MemoryView.svelte integration
  const memoryViewPath = path.join(uiRoot, 'features', 'agents', 'MemoryView.svelte');
  const memoryViewSrc = fs.readFileSync(memoryViewPath, 'utf-8');

  assert.ok(
    memoryViewSrc.includes('Domain-Aware Memory Filtering'),
    'MemoryView must display "Domain-Aware Memory Filtering" toggle'
  );
  assert.ok(
    memoryViewSrc.includes('LSP Context Pruning'),
    'MemoryView must display "LSP Context Pruning" toggle'
  );
  assert.ok(
    memoryViewSrc.includes('settingsStore.domainMemoryFiltering'),
    'MemoryView must bind to settingsStore.domainMemoryFiltering'
  );
  assert.ok(
    memoryViewSrc.includes('settingsStore.lspContextPruning'),
    'MemoryView must bind to settingsStore.lspContextPruning'
  );
});
