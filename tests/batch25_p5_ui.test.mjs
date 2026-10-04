import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  formatTokens,
  formatCostUsd,
  sanitizeMemoryFilename,
  formatMemorySize,
  formatMemoryTime,
} from '../ui/features/agents/agentsLogic.ts';

import { api } from '../ui/lib/api.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uiRoot = path.resolve(__dirname, '../ui');

test('b25 UI 1: Token formatting and USD currency formatting', () => {
  // Token count thousand separators
  assert.equal(formatTokens(0), '0');
  assert.equal(formatTokens(1234), '1,234');
  assert.equal(formatTokens(12738477), '12,738,477');
  assert.equal(formatTokens(null), '0');
  assert.equal(formatTokens(undefined), '0');
  assert.equal(formatTokens(NaN), '0');

  // USD cost formatting ($X.XXXX)
  assert.equal(formatCostUsd(0), '$0.0000');
  assert.equal(formatCostUsd(0.0124), '$0.0124');
  assert.equal(formatCostUsd(1.5), '$1.5000');
  assert.equal(formatCostUsd(12.34567), '$12.3457');
  assert.equal(formatCostUsd(null), '$0.0000');
  assert.equal(formatCostUsd(undefined), '$0.0000');
  assert.equal(formatCostUsd(NaN), '$0.0000');
});

test('b25 UI 2: Honest quota reporting & fallback (no fabricated numbers)', async () => {
  const report = await api.agentGetQuotaReport();

  assert.ok(report);
  assert.equal(typeof report.proxyOnline, 'boolean');
  assert.equal(typeof report.dbFound, 'boolean');
  assert.equal(typeof report.todayRequests, 'number');
  assert.equal(typeof report.todayPromptTokens, 'number');
  assert.equal(typeof report.todayCompletionTokens, 'number');
  assert.equal(typeof report.todayCost, 'number');
  assert.ok(Array.isArray(report.providers));

  // In test/browser fallback without 9Router DB, must NOT fabricate numbers
  if (!report.dbFound) {
    assert.equal(report.todayRequests, 0);
    assert.equal(report.todayPromptTokens, 0);
    assert.equal(report.todayCompletionTokens, 0);
    assert.equal(report.todayCost, 0);
    assert.ok(report.statusMessage.includes('~/.9router/db/data.sqlite') || report.statusMessage.includes('tidak ditemukan'));
  }
});

test('b25 UI 3: API bindings contract in api.ts', () => {
  assert.equal(typeof api.agentGetQuotaReport, 'function');
  assert.equal(typeof api.agentListProjectMemory, 'function');
  assert.equal(typeof api.agentReadProjectMemory, 'function');
  assert.equal(typeof api.agentSaveProjectMemory, 'function');
});

test('b25 UI 4: Project Memory list, read, save, and sanitize logic', async () => {
  // Filename sanitation (anti path traversal, ensures .md)
  assert.equal(sanitizeMemoryFilename('lessons'), 'lessons.md');
  assert.equal(sanitizeMemoryFilename('rules.md'), 'rules.md');
  assert.equal(sanitizeMemoryFilename('../../secret.txt'), 'secret.txt.md');
  assert.equal(sanitizeMemoryFilename('folder/sub\\note'), 'foldersubnote.md');
  assert.equal(sanitizeMemoryFilename(''), 'note.md');

  // Memory list initial
  const items = await api.agentListProjectMemory();
  assert.ok(Array.isArray(items));
  assert.ok(items.length >= 1);
  assert.ok(items.some((i) => i.filename === 'lessons.md'));

  // Read memory
  const lessonsContent = await api.agentReadProjectMemory('lessons.md');
  assert.ok(typeof lessonsContent === 'string');
  assert.ok(lessonsContent.includes('Lessons Learned') || lessonsContent.length > 0);

  // Save new memory item
  const newFilename = 'test_feature_rules.md';
  const newContent = '# Feature Rules\n\n1. Always test.\n2. Keep diff minimal.';
  await api.agentSaveProjectMemory(newFilename, newContent);

  // Verify list reflects new item
  const updatedList = await api.agentListProjectMemory();
  const savedItem = updatedList.find((i) => i.filename === newFilename);
  assert.ok(savedItem, 'Newly saved item must be present in memory list');
  assert.ok(savedItem.size > 0);
  assert.ok(savedItem.updatedAt > 0);

  // Read back saved item
  const readBack = await api.agentReadProjectMemory(newFilename);
  assert.equal(readBack, newContent);

  // Size and Time helpers
  assert.equal(formatMemorySize(500), '500 B');
  assert.equal(formatMemorySize(2048), '2.0 KB');
  assert.ok(formatMemoryTime(Date.now()).length > 0);
});

test('b25 UI 5: Sub-tab integration in AgentsPanel.svelte', () => {
  const panelPath = path.resolve(uiRoot, 'features/agents/AgentsPanel.svelte');
  const code = fs.readFileSync(panelPath, 'utf-8');

  // Sub-tabs state declaration
  assert.ok(code.includes("'chat' | 'diff' | 'quota' | 'memory'"));

  // Buttons for all 4 subtabs
  assert.ok(code.includes("onclick={() => (activeSubTab = 'chat')}"));
  assert.ok(code.includes("onclick={() => (activeSubTab = 'diff')}"));
  assert.ok(code.includes("onclick={() => (activeSubTab = 'quota')}"));
  assert.ok(code.includes("onclick={() => (activeSubTab = 'memory')}"));

  // Subtab labels
  assert.ok(code.includes('Chat'));
  assert.ok(code.includes('Proposed Edits'));
  assert.ok(code.includes('Quota & Usage'));
  assert.ok(code.includes('Memory'));

  // Dynamic view rendering
  assert.ok(code.includes('<QuotaUsageView'));
  assert.ok(code.includes('<MemoryView'));
});

test('b25 UI 6: QuotaUsageView.svelte structure and data honesty', () => {
  const quotaPath = path.resolve(uiRoot, 'features/agents/QuotaUsageView.svelte');
  const code = fs.readFileSync(quotaPath, 'utf-8');

  // Proxy status
  assert.ok(code.includes('Proxy 9Router Aktif (127.0.0.1:20128)'));
  assert.ok(code.includes('Proxy Offline'));

  // Refresh button
  assert.ok(code.includes('Segarkan Data'));
  assert.ok(code.includes('handleRefresh'));

  // Metrics: requests, prompt, completion, total, cost
  assert.ok(code.includes('Requests'));
  assert.ok(code.includes('Prompt Tokens'));
  assert.ok(code.includes('Completion Tokens'));
  assert.ok(code.includes('Total Tokens'));
  assert.ok(code.includes('Estimasi Biaya USD'));

  // Honest reporting banner if DB missing
  assert.ok(code.includes('Database kuota 9Router tidak ditemukan di ~/.9router/db/data.sqlite'));

  // Providers list & alerts
  assert.ok(code.includes('Daftar Provider Connections'));
  assert.ok(code.includes('rateLimitedUntil'));
  assert.ok(code.includes('lastError'));
});

test('b25 UI 7: MemoryView.svelte structure and split viewer', () => {
  const memPath = path.resolve(uiRoot, 'features/agents/MemoryView.svelte');
  const code = fs.readFileSync(memPath, 'utf-8');

  // Header & path
  assert.ok(code.includes('Project Memory'));
  assert.ok(code.includes('.petak/memory/'));
  assert.ok(code.includes('+ Catatan Baru'));

  // File sidebar & Editor pane
  assert.ok(code.includes('files-sidebar'));
  assert.ok(code.includes('editor-pane'));
  assert.ok(code.includes('memory-textarea'));
  assert.ok(code.includes('Simpan Perubahan'));
  assert.ok(code.includes('✓ Tersimpan'));

  // API calls
  assert.ok(code.includes('api.agentReadProjectMemory'));
  assert.ok(code.includes('api.agentSaveProjectMemory'));
});
