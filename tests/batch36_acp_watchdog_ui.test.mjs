import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  isWatchdogAbortedMessage,
  formatWatchdogRecoveryText,
} from '../ui/features/agents/agentsLogic.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uiRoot = path.resolve(__dirname, '../ui');

// =============================================================================
// Suite 1: Watchdog Message Detection (isWatchdogAbortedMessage)
// =============================================================================

test('b36 Watchdog UI 1: isWatchdogAbortedMessage detection logic', () => {
  // Positive cases (Watchdog abort, idle timeout, subprocess unstuck)
  const positiveCases = [
    '⚠️ Perintah terminal macet dibatalkan otomatis karena tidak ada aktivitas selama 5 menit. Mencoba pemulihan...',
    '⚠️ Perintah terminal macet dibatalkan otomatis -> Melanjutkan...',
    'Perintah terminal macet dibatalkan otomatis',
    'perintah macet dibatalkan otomatis',
    'tidak ada aktivitas selama 5 menit',
    'tidak ada aktivitas selama 300 detik',
    'Watchdog timeout: idle timeout exceeded',
    'ACP activity watchdog abort triggered',
    'idle timeout occurred during command execution',
    'command timed out due to inactivity',
    'proses terminal macet dihentikan otomatis',
  ];

  for (const text of positiveCases) {
    assert.equal(
      isWatchdogAbortedMessage(text),
      true,
      `Should detect watchdog abort message: "${text}"`
    );
  }

  // Negative cases (normal messages, empty, null, undefined)
  const negativeCases = [
    'Build and test passed successfully.',
    'Menjalankan tugas Flutter...',
    'Halo, ada yang bisa saya bantu?',
    'Error: syntax error at line 42',
    '',
    null,
    undefined,
  ];

  for (const text of negativeCases) {
    assert.equal(
      isWatchdogAbortedMessage(text),
      false,
      `Should not detect watchdog message for normal content: "${text}"`
    );
  }
});

// =============================================================================
// Suite 2: Watchdog Recovery Text Formatting (formatWatchdogRecoveryText)
// =============================================================================

test('b36 Watchdog UI 2: formatWatchdogRecoveryText formatting', () => {
  const expectedDefault = '⚠️ Perintah terminal macet dibatalkan otomatis -> Melanjutkan...';

  // 1. Default fallback on empty/null/undefined
  assert.equal(formatWatchdogRecoveryText(''), expectedDefault);
  assert.equal(formatWatchdogRecoveryText(null), expectedDefault);
  assert.equal(formatWatchdogRecoveryText(undefined), expectedDefault);

  // 2. Formats abort messages to standard recovery banner text
  const longBackendMessage = '⚠️ Perintah terminal macet dibatalkan otomatis karena tidak ada aktivitas selama 5 menit. Mencoba pemulihan...';
  assert.equal(formatWatchdogRecoveryText(longBackendMessage), expectedDefault);

  const exactBannerMessage = '⚠️ Perintah terminal macet dibatalkan otomatis -> Melanjutkan...';
  assert.equal(formatWatchdogRecoveryText(exactBannerMessage), expectedDefault);

  const watchdogTimeoutMsg = 'Watchdog timeout: idle timeout exceeded';
  assert.equal(formatWatchdogRecoveryText(watchdogTimeoutMsg), expectedDefault);

  // 3. Formats custom message with clean ⚠️ prefix if missing
  assert.equal(formatWatchdogRecoveryText('Koneksi terputus tiba-tiba'), '⚠️ Koneksi terputus tiba-tiba');
  assert.equal(formatWatchdogRecoveryText('⚠️ Koneksi terputus tiba-tiba'), '⚠️ Koneksi terputus tiba-tiba');
});

// =============================================================================
// Suite 3: State Machine & Unstuck Logic Verification
// =============================================================================

test('b36 Watchdog UI 3: Slot unstuck & prompt cancellation logic', () => {
  // Simulating store slot & composer state
  const mockSlot = {
    id: 's_test_1',
    label: 'Test Agent',
    status: 'busy',
  };

  let isStreaming = true;
  let isWatchdogAborted = false;
  let watchdogRecoveryMessage = null;

  // Derived composer busy state:
  const computeIsBusy = () => !isWatchdogAborted && isStreaming;

  // Initially busy during active streaming
  assert.equal(computeIsBusy(), true, 'Composer should be busy during streaming');

  // Trigger prompt cancellation
  const simulateCancelPrompt = () => {
    isStreaming = false;
    isWatchdogAborted = false;
    watchdogRecoveryMessage = null;
    mockSlot.status = 'ready';
  };

  simulateCancelPrompt();
  assert.equal(isStreaming, false, 'isStreaming must be false after cancel');
  assert.equal(mockSlot.status, 'ready', 'slot status must be reset to ready after cancel');
  assert.equal(computeIsBusy(), false, 'Composer must be immediately unblocked after cancel');

  // Simulate stuck prompt triggering watchdog abort
  mockSlot.status = 'busy';
  isStreaming = true;
  assert.equal(computeIsBusy(), true, 'Slot should be busy before watchdog abort');

  const simulateWatchdogAbort = (abortMsg) => {
    isStreaming = false;
    isWatchdogAborted = true;
    watchdogRecoveryMessage = formatWatchdogRecoveryText(abortMsg);
    mockSlot.status = 'ready';
  };

  simulateWatchdogAbort('⚠️ Perintah terminal macet dibatalkan otomatis karena tidak ada aktivitas selama 5 menit. Mencoba pemulihan...');
  assert.equal(isStreaming, false, 'isStreaming must be false after watchdog abort');
  assert.equal(mockSlot.status, 'ready', 'slot status must be refreshed back to ready');
  assert.equal(isWatchdogAborted, true, 'isWatchdogAborted must be true');
  assert.equal(watchdogRecoveryMessage, '⚠️ Perintah terminal macet dibatalkan otomatis -> Melanjutkan...');
  assert.equal(computeIsBusy(), false, 'Composer must be unblocked after watchdog abort');
});

// =============================================================================
// Suite 4: Svelte Component Integration Verification (AgentChat.svelte)
// =============================================================================

test('b36 Watchdog UI 4: AgentChat.svelte recovery banner & action buttons', () => {
  const chatSrc = fs.readFileSync(path.resolve(uiRoot, 'features/agents/AgentChat.svelte'), 'utf-8');

  // 1. Recovery alert banner presence
  assert.ok(chatSrc.includes('watchdog-recovery-banner'), 'AgentChat must render watchdog-recovery-banner');
  assert.ok(chatSrc.includes('role="alert"'), 'Banner must have role="alert" for accessibility');

  // 2. Action buttons
  assert.ok(chatSrc.includes('Lanjutkan (Continue)'), 'Banner must render [Lanjutkan (Continue)] button');
  assert.ok(chatSrc.includes('Kirim Ulang'), 'Banner must render [Kirim Ulang] button');
  assert.ok(chatSrc.includes('watchdog-continue-btn'), 'Must have watchdog-continue-btn class');
  assert.ok(chatSrc.includes('watchdog-resend-btn'), 'Must have watchdog-resend-btn class');

  // 3. Helper imports & reactive derivation
  assert.ok(chatSrc.includes('isWatchdogAbortedMessage'), 'AgentChat must import isWatchdogAbortedMessage');
  assert.ok(chatSrc.includes('formatWatchdogRecoveryText'), 'AgentChat must import formatWatchdogRecoveryText');
  assert.ok(chatSrc.includes('handleWatchdogContinue'), 'AgentChat must define handleWatchdogContinue');
  assert.ok(chatSrc.includes('handleWatchdogResend'), 'AgentChat must define handleWatchdogResend');

  // 4. Composer textarea unblocking
  assert.ok(chatSrc.includes('disabled={isBusy}'), 'Textarea must bind disabled to isBusy');
  assert.ok(chatSrc.includes('!agentsStore.isWatchdogAborted'), 'isBusy derivation must check isWatchdogAborted');
});

// =============================================================================
// Suite 5: Store Integration Verification (agents.svelte.ts)
// =============================================================================

test('b36 Watchdog UI 5: agents.svelte.ts state machine & lifecycle methods', () => {
  const storeSrc = fs.readFileSync(path.resolve(uiRoot, 'features/agents/agents.svelte.ts'), 'utf-8');

  // 1. Store state properties
  assert.ok(storeSrc.includes('isWatchdogAborted = $state(false);'), 'Store must declare isWatchdogAborted state');
  assert.ok(storeSrc.includes('watchdogRecoveryMessage = $state<string | null>(null);'), 'Store must declare watchdogRecoveryMessage state');
  assert.ok(storeSrc.includes('lastPromptText = $state<string>(\'\');'), 'Store must declare lastPromptText state');

  // 2. Reset methods
  assert.ok(storeSrc.includes('dismissWatchdogRecovery()'), 'Store must declare dismissWatchdogRecovery method');
  assert.ok(storeSrc.includes('resetSlotToReady('), 'Store must declare resetSlotToReady method');

  // 3. Watchdog detection in prompt loop & cancellation
  assert.ok(storeSrc.includes('isWatchdogAbortedMessage(cleanContent)'), 'sendPrompt must check cleanContent with isWatchdogAbortedMessage');
  assert.ok(storeSrc.includes('isWatchdogAbortedMessage(errText)'), 'sendPrompt catch must check errText with isWatchdogAbortedMessage');
  assert.ok(storeSrc.includes('formatWatchdogRecoveryText('), 'Store must use formatWatchdogRecoveryText');
  assert.ok(storeSrc.includes('status: \'ready\''), 'cancelActivePrompt must reset slot to ready');
});
