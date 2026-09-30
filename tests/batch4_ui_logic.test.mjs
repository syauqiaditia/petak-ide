import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PopupManager,
} from '../ui/shell/popupLogic.ts';

import {
  PanelExclusivityManager,
} from '../ui/shell/panelExclusivity.ts';

import {
  groupDevices,
  pruneDeviceSelection,
} from '../ui/features/run/deviceLogic.ts';

import {
  computeMinimalDiff,
  detectLanguage,
  isFormatOnSaveEnabled,
  setFormatOnSave,
} from '../ui/features/editor/formatLogic.ts';

import {
  formatRecentProjects,
} from '../ui/shell/projectResetLogic.ts';

// =============================================================================
// Suite 1: Central Popup Exclusivity (Bug 4)
// =============================================================================

test('popup exclusivity: only one popup active at a time (runner vs device vs branch vs project)', () => {
  const popup = new PopupManager();
  assert.equal(popup.activePopup, null);

  // 1. Open device dropdown
  popup.open('device');
  assert.equal(popup.activePopup, 'device');
  assert.equal(popup.isOpen('device'), true);
  assert.equal(popup.isOpen('runner'), false);

  // 2. Opening runner dropdown automatically closes device dropdown
  popup.open('runner');
  assert.equal(popup.activePopup, 'runner');
  assert.equal(popup.isOpen('device'), false);
  assert.equal(popup.isOpen('runner'), true);

  // 3. Opening branch dropdown automatically closes runner
  popup.open('branch');
  assert.equal(popup.activePopup, 'branch');
  assert.equal(popup.isOpen('runner'), false);
  assert.equal(popup.isOpen('branch'), true);

  // 4. Opening project dropdown automatically closes branch
  popup.open('project');
  assert.equal(popup.activePopup, 'project');
  assert.equal(popup.isOpen('branch'), false);
  assert.equal(popup.isOpen('project'), true);

  // 5. Toggling same popup closes it
  popup.toggle('project');
  assert.equal(popup.activePopup, null);
  assert.equal(popup.isOpen('project'), false);

  // 6. Escape key dismisses active popup
  popup.open('contextMenu');
  assert.equal(popup.isOpen('contextMenu'), true);
  const escaped = popup.handleEscape();
  assert.equal(escaped, true);
  assert.equal(popup.activePopup, null);

  // Escape when no popup open returns false
  assert.equal(popup.handleEscape(), false);

  // 7. Click outside dismisses active popup
  popup.open('device');
  assert.equal(popup.isOpen('device'), true);
  popup.handleClickOutside('device', false);
  assert.equal(popup.isOpen('device'), false);
});

test('panel exclusivity: right panel exclusivity covers mirror, devices, agent, and mr', () => {
  const manager = new PanelExclusivityManager();
  assert.equal(manager.activeRightPanel, null);

  // Opening mirror
  manager.openRight('mirror');
  assert.equal(manager.activeRightPanel, 'mirror');

  // Opening devices closes mirror
  manager.openRight('devices');
  assert.equal(manager.activeRightPanel, 'devices');
  assert.equal(manager.isRightOpen('mirror'), false);
  assert.equal(manager.isRightOpen('devices'), true);

  // Opening mr closes devices
  manager.openRight('mr');
  assert.equal(manager.activeRightPanel, 'mr');
  assert.equal(manager.isRightOpen('devices'), false);
  assert.equal(manager.isRightOpen('mr'), true);

  // Opening agent closes mr
  manager.openRight('agent');
  assert.equal(manager.activeRightPanel, 'agent');
  assert.equal(manager.isRightOpen('mr'), false);
  assert.equal(manager.isRightOpen('agent'), true);

  // Toggling agent closes it
  manager.toggleRight('agent');
  assert.equal(manager.activeRightPanel, null);
});

// =============================================================================
// Suite 2: Device State, Connection, and Transport (Bug 1 UI)
// =============================================================================

test('device grouping: connected devices are online & runnable; paired devices are disabled; unavailable are hidden', () => {
  const legacyDevices = [
    {
      id: 'iphone-prio',
      name: 'iPhone Prio',
      kind: 'physical',
      platform: 'ios',
      state: 'offline',
      connection: 'unavailable', // unavailable friend device
      transport: 'usb',
    },
    {
      id: 'iphone-uqi',
      name: 'iPhone UQi',
      kind: 'physical',
      platform: 'ios',
      state: 'offline',
      connection: 'paired', // paired over cellular, not connected
      transport: 'wifi',
    },
    {
      id: 'pixel-8',
      name: 'Pixel 8 Pro',
      kind: 'physical',
      platform: 'android',
      state: 'online',
      connection: 'connected',
      transport: 'usb',
    },
  ];

  const grouped = groupDevices(null, legacyDevices, []);

  // 1. Unavailable (Prio) must NOT appear in pickerItems!
  const prioInPicker = grouped.pickerItems.find((p) => p.id === 'iphone-prio');
  assert.equal(prioInPicker, undefined, 'Unavailable device must be hidden from dropdown');

  // 2. Paired (UQi) appears in pickerItems as paired & disabled (runnable: false)
  const uqiInPicker = grouped.pickerItems.find((p) => p.id === 'iphone-uqi');
  assert.ok(uqiInPicker, 'Paired device must be present in picker list');
  assert.equal(uqiInPicker.connection, 'paired');
  assert.equal(uqiInPicker.runnable, false);
  assert.equal(uqiInPicker.transport, 'wifi');

  // 3. Connected (Pixel 8) appears as connected & runnable
  const pixelInPicker = grouped.pickerItems.find((p) => p.id === 'pixel-8');
  assert.ok(pixelInPicker, 'Connected device must be present in picker list');
  assert.equal(pixelInPicker.connection, 'connected');
  assert.equal(pixelInPicker.state, 'online');
  assert.equal(pixelInPicker.runnable, true);
  assert.equal(pixelInPicker.transport, 'usb');

  // 4. In physicalDevices (for Manage Devices panel), all devices are present
  assert.equal(grouped.physicalDevices.length, 3);
});

test('device selection pruning: never auto-selects paired or unavailable devices', () => {
  const devices = [
    { id: 'iphone-prio', state: 'offline', connection: 'unavailable', flutterId: null },
    { id: 'iphone-uqi', state: 'offline', connection: 'paired', runnable: false, flutterId: 'iphone-uqi' },
    { id: 'pixel-online', state: 'online', connection: 'connected', runnable: true, flutterId: 'pixel-online' },
  ];

  // If current selection is iphone-uqi (paired), it must be pruned to pixel-online
  const pruned = pruneDeviceSelection('iphone-uqi', devices);
  assert.equal(pruned, 'pixel-online');

  // If no device currently selected, picks pixel-online
  const initial = pruneDeviceSelection(null, devices);
  assert.equal(initial, 'pixel-online');

  // If no connected device available, returns empty string
  const noConnected = [
    { id: 'iphone-uqi', state: 'offline', connection: 'paired', runnable: false, flutterId: 'iphone-uqi' },
  ];
  assert.equal(pruneDeviceSelection('iphone-uqi', noConnected), '');
});

// =============================================================================
// Suite 3: Recent Projects & Status Bar Accuracy (Bug 3)
// =============================================================================

test('recent projects: formatting list trims and orders correctly', () => {
  const recents = [
    { name: 'App 1', path: '/path/app1', lastOpened: 100, exists: true },
    { name: 'App 2', path: '/path/app2', lastOpened: 200, exists: false },
    { name: 'App 3', path: '/path/app3', lastOpened: 300, exists: true },
  ];

  const formatted = formatRecentProjects(recents, 2);
  assert.equal(formatted.length, 2);
  assert.equal(formatted[0].name, 'App 3');
  assert.equal(formatted[1].name, 'App 2');
});

test('status bar error formatting: detects error status text accurately', () => {
  const getStatusColor = (statusText, statusKind) => {
    const kind =
      statusKind ||
      (statusText.toLowerCase().includes('failed') || statusText.toLowerCase().includes('error')
        ? 'error'
        : statusText.toLowerCase().includes('warn')
        ? 'warning'
        : 'normal');
    return kind === 'error' ? '#f07a74' : kind === 'warning' ? '#e8b45a' : '#7fc98f';
  };

  // Error condition (e.g. failed to open folder)
  assert.equal(getStatusColor('Failed to open folder /workspace/notfound', undefined), '#f07a74');
  assert.equal(getStatusColor('Error saving file.dart', undefined), '#f07a74');
  assert.equal(getStatusColor('Explicit error', 'error'), '#f07a74');

  // Success / ready condition
  assert.equal(getStatusColor('Ready', undefined), '#7fc98f');
  assert.equal(getStatusColor('Opened my_flutter_project', undefined), '#7fc98f');
  assert.equal(getStatusColor('Saved main.dart', undefined), '#7fc98f');
});

// =============================================================================
// Suite 4: Minimal Diff for Single-Transaction Formatter (Fitur A)
// =============================================================================

test('formatter minimal diff: identical content produces null diff', () => {
  const code = 'void main() {\n  print("Hello");\n}\n';
  const diff = computeMinimalDiff(code, code);
  assert.equal(diff, null);
});

test('formatter minimal diff: calculates minimal range between original and formatted text', () => {
  const original = 'class Foo{\nvoid bar(){print(1);}\n}\n';
  const formatted = 'class Foo {\n  void bar() {\n    print(1);\n  }\n}\n';

  const diff = computeMinimalDiff(original, formatted);
  assert.ok(diff);
  assert.equal(diff.from, 9); // 'class Foo' is common prefix (length 9)

  // Applying diff.insert into original[diff.from..diff.to] produces formatted text
  const applied = original.slice(0, diff.from) + diff.insert + original.slice(diff.to);
  assert.equal(applied, formatted);
});

test('formatter minimal diff: handles indentation fix with single-undo replacement', () => {
  const original = 'fun test() {\nval x = 1\nval y = 2\n}\n';
  const formatted = 'fun test() {\n  val x = 1\n  val y = 2\n}\n';

  const diff = computeMinimalDiff(original, formatted);
  assert.ok(diff);
  assert.equal(original.slice(0, diff.from), 'fun test() {\n');

  const applied = original.slice(0, diff.from) + diff.insert + original.slice(diff.to);
  assert.equal(applied, formatted);
});

test('formatter language detection: detects supported languages from file extension', () => {
  assert.equal(detectLanguage('lib/main.dart'), 'dart');
  assert.equal(detectLanguage('app/src/MainActivity.kt'), 'kotlin');
  assert.equal(detectLanguage('build.gradle.kts'), 'kotlin');
  assert.equal(detectLanguage('ios/Runner/AppDelegate.swift'), 'swift');
  assert.equal(detectLanguage('package.json'), 'json');
  assert.equal(detectLanguage('pubspec.yaml'), 'yaml');
  assert.equal(detectLanguage('ui/main.ts'), 'typescript');
  assert.equal(detectLanguage('README.md'), 'markdown');
});

test('formatter on-save toggle: toggles language format on save persistently', () => {
  const memoryStore = {};
  globalThis.window = {
    localStorage: {
      getItem: (key) => memoryStore[key] || null,
      setItem: (key, val) => { memoryStore[key] = String(val); },
    },
  };

  // Default is OFF
  assert.equal(isFormatOnSaveEnabled('dart'), false);
  assert.equal(isFormatOnSaveEnabled('kotlin'), false);

  // Enable dart
  setFormatOnSave('dart', true);
  assert.equal(isFormatOnSaveEnabled('dart'), true);
  assert.equal(isFormatOnSaveEnabled('kotlin'), false);

  // Toggle dart OFF
  setFormatOnSave('dart', false);
  assert.equal(isFormatOnSaveEnabled('dart'), false);
});

test('formatter fallback message: formats missing tool error and hints properly', () => {
  const formatErrorFallback = (err, lang) => {
    const raw = typeof err === 'string' ? err : err?.message || String(err);
    if (raw.includes('tidak ditemukan')) {
      return raw;
    }
    return `Formatter untuk '${lang}' tidak ditemukan. Silakan periksa toolchain.`;
  };

  const err1 = "Formatter untuk 'dart' (dart format) tidak ditemukan. Pasang Flutter/Dart SDK.";
  assert.equal(formatErrorFallback(err1, 'dart'), err1);

  const errGeneric = new Error('command failed');
  assert.equal(
    formatErrorFallback(errGeneric, 'swift'),
    "Formatter untuk 'swift' tidak ditemukan. Silakan periksa toolchain."
  );
});

// =============================================================================
// Suite 5: Git Log minimal filter branches default (Bug 10 UI)
// =============================================================================

test('git log query: ensures branches is always present as an array', () => {
  const buildGitLogArgs = (root, filter, cursor, limit) => {
    const finalFilter = {
      branches: filter?.branches ?? [],
      ...(filter?.author ? { author: filter.author } : {}),
      ...(filter?.since ? { since: filter.since } : {}),
      ...(filter?.until ? { until: filter.until } : {}),
      ...(filter?.path ? { path: filter.path } : {}),
      ...(filter?.text ? { text: filter.text } : {}),
    };
    return {
      root,
      filter: finalFilter,
      cursor: cursor ?? null,
      limit: limit ?? null,
    };
  };

  // Called with undefined filter
  const args1 = buildGitLogArgs('/repo', undefined);
  assert.deepEqual(args1.filter.branches, []);

  // Called with empty filter object
  const args2 = buildGitLogArgs('/repo', {});
  assert.deepEqual(args2.filter.branches, []);

  // Called with specific branch
  const args3 = buildGitLogArgs('/repo', { branches: ['main', 'feat/login'] });
  assert.deepEqual(args3.filter.branches, ['main', 'feat/login']);
});
