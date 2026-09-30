import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { api } from '../ui/lib/api.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uiRoot = path.resolve(__dirname, '../ui');

function collectFiles(dir, exts = ['.ts', '.svelte']) {
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

test('api consistency: all api.<name>( calls across ui/ must be defined in api.ts', () => {
  const files = collectFiles(uiRoot);
  const apiCallRegex = /\bapi\.([a-zA-Z0-9_]+)\s*\(/g;
  const missingMethods = new Map();

  for (const file of files) {
    if (file.endsWith(path.join('ui', 'lib', 'api.ts'))) {
      continue;
    }
    const content = fs.readFileSync(file, 'utf-8');
    let match;
    while ((match = apiCallRegex.exec(content)) !== null) {
      const methodName = match[1];
      // Check if methodName exists as a function or property on api
      if (typeof api[methodName] !== 'function') {
        const relPath = path.relative(uiRoot, file);
        if (!missingMethods.has(methodName)) {
          missingMethods.set(methodName, []);
        }
        missingMethods.get(methodName).push(relPath);
      }
    }
  }

  if (missingMethods.size > 0) {
    const details = Array.from(missingMethods.entries())
      .map(([m, callSites]) => `  - api.${m} called in: ${callSites.join(', ')}`)
      .join('\n');
    assert.fail(`Found missing api methods in ui/lib/api.ts:\n${details}`);
  }
});

// =============================================================================
// Suite 2: Mirror Per-Platform Logic (Bug 3)
// =============================================================================
import {
  classifyMirrorDevice,
  formatMirrorConnectingInfo,
  sanitizeMirrorErrorMessage,
} from '../ui/features/mirror/mirrorErrorLogic.ts';

test('mirror classification: separates android, ios-physical, and ios-simulator', () => {
  // Physical iPhone
  const iphonePhys = classifyMirrorDevice({ id: '00008110-0012', name: "UQi's iPhone", platform: 'ios', kind: 'physical' });
  assert.equal(iphonePhys.platform, 'ios');
  assert.equal(iphonePhys.kind, 'ios-physical');
  assert.equal(iphonePhys.isPhysical, true);

  // iOS Simulator
  const iosSim = classifyMirrorDevice({ id: 'sim-123', name: 'iPhone 15 Pro', platform: 'ios', kind: 'ios-sim' });
  assert.equal(iosSim.platform, 'ios');
  assert.equal(iosSim.kind, 'ios-simulator');
  assert.equal(iosSim.isPhysical, false);

  // Android device
  const androidDev = classifyMirrorDevice({ id: 'emulator-5554', name: 'Pixel 8', platform: 'android', kind: 'emulator' });
  assert.equal(androidDev.platform, 'android');
  assert.equal(androidDev.kind, 'android');
});

test('mirror connecting & error: never mentions scrcpy for iOS and honest physical copy', () => {
  const iphonePhys = { platform: 'ios', kind: 'ios-physical', isPhysical: true };
  const connInfo = formatMirrorConnectingInfo(iphonePhys, '00008110-0012');
  assert.match(connInfo.title, /iPhone/i);
  assert.doesNotMatch(connInfo.desc, /scrcpy/i);

  // Structured error containing scrcpy
  const err = { platform: 'ios', code: 'DEVICE_UNLOCKED_REQUIRED', message: 'Failed to start scrcpy handshake: device locked' };
  const sanitized = sanitizeMirrorErrorMessage(err, iphonePhys);
  assert.equal(sanitized.isScrcpyMentioned, true);
  assert.doesNotMatch(sanitized.message, /scrcpy/i);
  assert.match(sanitized.message, /device locked/i);
});

// =============================================================================
// Suite 3: Device Dropdown Status & Labels (Bug 4)
// =============================================================================
import {
  getDeviceStatusLabel,
  getDeviceTooltip,
  groupDevices,
} from '../ui/features/run/deviceLogic.ts';

test('device status label: accurate Indonesian copy & never USB unless wired', () => {
  // 1. Wired USB
  assert.equal(getDeviceStatusLabel({ connState: 'connected_usb', transport: 'wired' }), 'Terhubung (USB)');
  assert.equal(getDeviceStatusLabel({ connection: 'connected', transport: 'wired' }), 'Terhubung (USB)');

  // 2. Connected but transport unknown or null -> MUST NOT show USB
  assert.equal(getDeviceStatusLabel({ connState: 'connected_usb', transport: null }), 'Terhubung');
  assert.equal(getDeviceStatusLabel({ connection: 'connected', transport: 'unknown' }), 'Terhubung');

  // 3. Wi-Fi
  assert.equal(getDeviceStatusLabel({ connState: 'connected_wifi', transport: 'wifi' }), 'Terhubung (Wi-Fi)');
  assert.equal(getDeviceStatusLabel({ connection: 'connected', transport: 'wifi' }), 'Terhubung (Wi-Fi)');

  // 4. Locked
  assert.equal(getDeviceStatusLabel({ connState: 'locked' }), 'Terkunci/Perlu dibuka');

  // 5. Disconnected / Paired
  assert.equal(getDeviceStatusLabel({ connState: 'disconnected' }), 'Tidak terhubung');
  assert.equal(getDeviceStatusLabel({ connection: 'paired' }), 'Tidak terhubung');
});

test('device tooltip: displays tunnelState and pairingState accurately', () => {
  const tooltip1 = getDeviceTooltip({ tunnelState: 'active', pairingState: 'paired' });
  assert.equal(tooltip1, 'tunnelState: active · pairingState: paired');

  const tooltip2 = getDeviceTooltip({ tunnelState: null, pairingState: null });
  assert.equal(tooltip2, 'tunnelState: None · pairingState: None');
});

// =============================================================================
// Suite 4: Flutter Daemon & Connection Restart (Feature A)
// =============================================================================
import {
  resetRunLifecycle,
  canPerformHotRestart,
  canPerformStop,
} from '../ui/features/run/restartLogic.ts';

test('run lifecycle reset: cleans state machine cleanly on daemon/connection restart', () => {
  const reset = resetRunLifecycle();
  assert.equal(reset.state, 'stopped');
  assert.equal(reset.uiState, 'idle');
  assert.equal(reset.runId, null);
  assert.equal(reset.pid, null);
});

test('hot restart & stop execution guards', () => {
  assert.equal(canPerformHotRestart('running', false), true);
  assert.equal(canPerformHotRestart('running', true), false);
  assert.equal(canPerformHotRestart('stopped', false), false);

  assert.equal(canPerformStop('running', 'running'), true);
  assert.equal(canPerformStop('stopped', 'starting'), true);
  assert.equal(canPerformStop('stopped', 'idle'), false);
});

// =============================================================================
// Suite 5: Resizable Bottom Panel (Feature B)
// =============================================================================
import {
  clampBottomPanelHeight,
  toggleMaximizeBottomPanel,
  MIN_BOTTOM_PANEL_HEIGHT,
  DEFAULT_BOTTOM_PANEL_HEIGHT,
} from '../ui/features/terminal/bottomPanelResize.ts';

test('bottom panel resize clamp: enforces min 120px and max 80% window height', () => {
  const winHeight = 1000;
  // 1. Min clamp
  assert.equal(clampBottomPanelHeight(50, winHeight), 120);
  assert.equal(clampBottomPanelHeight(-10, winHeight), 120);

  // 2. Normal range
  assert.equal(clampBottomPanelHeight(300, winHeight), 300);

  // 3. Max clamp (80% of 1000 = 800)
  assert.equal(clampBottomPanelHeight(850, winHeight), 800);
  assert.equal(clampBottomPanelHeight(1200, winHeight), 800);
});

test('bottom panel maximize/restore toggle on double-click', () => {
  const winHeight = 1000;
  const initialHeight = 250;

  // 1. Toggle to maximize
  const maxResult = toggleMaximizeBottomPanel(initialHeight, 232, winHeight);
  assert.equal(maxResult.isMaximized, true);
  assert.equal(maxResult.height, 800); // 80% of 1000
  assert.equal(maxResult.nextRestoredHeight, 250);

  // 2. Toggle to restore
  const restoreResult = toggleMaximizeBottomPanel(maxResult.height, maxResult.nextRestoredHeight, winHeight);
  assert.equal(restoreResult.isMaximized, false);
  assert.equal(restoreResult.height, 250);
});

// =============================================================================
// Suite 6: Single-List Commit Selection & Staging (Feature C)
// =============================================================================
import {
  isEntryStaged,
  filterUnifiedChanges,
  countCheckedEntries,
  getUnifiedStatusLetter,
} from '../ui/features/git/commitSelectionLogic.ts';

test('commit single list: unified changes filter & checkbox state consistency', () => {
  const entries = [
    { path: 'clean.dart', index: 'unmodified', worktree: 'unmodified', conflicted: false },
    { path: 'staged_ext.dart', index: 'modified', worktree: 'unmodified', conflicted: false },
    { path: 'worktree_mod.dart', index: 'unmodified', worktree: 'modified', conflicted: false },
    { path: 'untracked.dart', index: 'untracked', worktree: 'untracked', conflicted: false },
    { path: 'both.dart', index: 'modified', worktree: 'modified', conflicted: false },
    { path: 'conflict.dart', index: 'modified', worktree: 'modified', conflicted: true },
  ];

  // 1. Unified filter excludes clean files
  const changed = filterUnifiedChanges(entries);
  assert.equal(changed.length, 5);
  assert.equal(changed.some((e) => e.path === 'clean.dart'), false);

  // 2. Checked state: externally staged files are immediately checked
  assert.equal(isEntryStaged(entries[1]), true); // staged_ext.dart is checked
  assert.equal(isEntryStaged(entries[2]), false); // worktree_mod.dart is unchecked
  assert.equal(isEntryStaged(entries[3]), false); // untracked is unchecked
  assert.equal(isEntryStaged(entries[4]), true);  // both.dart has staged index -> checked

  // 3. Count checked
  assert.equal(countCheckedEntries(changed), 3); // entries[1], entries[4], entries[5]

  // 4. Status letters
  assert.equal(getUnifiedStatusLetter(entries[5]).char, '!');
  assert.equal(getUnifiedStatusLetter(entries[1]).char, 'M');
  assert.equal(getUnifiedStatusLetter(entries[3]).char, '?');
});

// =============================================================================
// Suite 7: Remove 'Open' Button in Project Tree Header (Feature D)
// =============================================================================
test('file tree header: open button removed next to PROJECT title', () => {
  const fileTreePath = path.resolve(uiRoot, 'shell/FileTree.svelte');
  const content = fs.readFileSync(fileTreePath, 'utf-8');

  // Verify open-btn is completely removed from FileTree
  assert.doesNotMatch(content, /class="open-btn"/);
  assert.doesNotMatch(content, /<span>Open<\/span>/);
});

// =============================================================================
// Suite 8: Settings > Accounts Logic & Token Security
// =============================================================================
import {
  validateAccountInputs,
  AccountsManager,
} from '../ui/features/accounts/accountsLogic.ts';

test('accounts validation: enforces valid URL and non-empty token', () => {
  assert.equal(validateAccountInputs('', 'token').valid, false);
  assert.equal(validateAccountInputs('not-url', 'token').valid, false);
  assert.equal(validateAccountInputs('https://gitlab.example.com', '').valid, false);
  assert.equal(validateAccountInputs('https://gitlab.example.com', 'glpat-xxx').valid, true);
});

test('accounts manager: saves, clears token from memory, tests connection, and deletes', async () => {
  const mockApi = {
    storedUrl: '',
    storedToken: '',
    async accountsGet() {
      return { url: this.storedUrl, hasToken: !!this.storedToken };
    },
    async accountsSave(url, token) {
      this.storedUrl = url;
      this.storedToken = token;
    },
    async accountsTest(url, token) {
      const effToken = token || this.storedToken;
      if (effToken === 'glpat-valid') {
        return { ok: true, user: 'uqi' };
      }
      return { ok: false, error: '401 Unauthorized' };
    },
    async accountsClear() {
      this.storedUrl = '';
      this.storedToken = '';
    },
  };

  const manager = new AccountsManager();

  // 1. Initial state
  await manager.load(mockApi);
  assert.equal(manager.url, '');
  assert.equal(manager.hasToken, false);

  // 2. Save account -> token MUST be cleared from manager instance immediately
  manager.url = 'https://gitlab.com';
  manager.inputToken = 'glpat-valid';
  const saveSuccess = await manager.save(mockApi);
  assert.equal(saveSuccess, true);
  assert.equal(manager.hasToken, true);
  assert.equal(manager.inputToken, '', 'Security requirement: inputToken must be cleared after save');
  assert.equal(mockApi.storedToken, 'glpat-valid');

  // 3. Test connection with saved token
  const testRes = await manager.test(mockApi);
  assert.equal(testRes.ok, true);
  assert.equal(testRes.user, 'uqi');
  assert.match(manager.statusMessage, /@uqi/);

  // 4. Clear account
  await manager.clear(mockApi);
  assert.equal(manager.url, '');
  assert.equal(manager.hasToken, false);
  assert.equal(mockApi.storedUrl, '');
  assert.equal(mockApi.storedToken, '');
});
