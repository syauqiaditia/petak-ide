import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildBranchTree,
  filterBranchTree,
  flattenBranchTree,
  countBranchesInTree,
} from '../ui/features/git/branchTreeLogic.ts';

import { computeWindowing } from '../ui/features/git/windowingLogic.ts';

import {
  escapeHtml,
  sanitizeUrl,
  renderMarkdownToHtml,
} from '../ui/features/editor/lsp/markdown.ts';

import { groupDevices } from '../ui/features/run/deviceLogic.ts';

// =============================================================================
// Suite 1: Fold prefix branch
// =============================================================================

test('fold prefix branch: groups branches by prefix slash into collapsible tree', () => {
  const branches = [
    { name: 'main', isCurrent: false },
    { name: 'canary/dev/1.9.0', isCurrent: false, ahead: 1 },
    { name: 'canary/prod/1.9.0', isCurrent: true, behind: 2 },
    { name: 'fix/login', isCurrent: false },
    { name: 'fix/crash', isCurrent: false },
  ];

  const tree = buildBranchTree(branches);

  // Should have 2 folders ("canary/", "fix/") and 1 leaf ("main")
  assert.equal(tree.length, 3);

  const canaryFolder = tree.find((n) => n.type === 'folder' && n.prefix === 'canary/');
  assert.ok(canaryFolder);
  assert.equal(canaryFolder.totalBranches, 2);

  const fixFolder = tree.find((n) => n.type === 'folder' && n.prefix === 'fix/');
  assert.ok(fixFolder);
  assert.equal(fixFolder.totalBranches, 2);

  const mainLeaf = tree.find((n) => n.type === 'branch' && n.displayName === 'main');
  assert.ok(mainLeaf);
  assert.equal(mainLeaf.branch.name, 'main');
});

test('fold prefix branch: flattens tree with expansion and indentation depth', () => {
  const branches = [
    { name: 'canary/dev/1.9.0', isCurrent: false },
    { name: 'canary/prod/1.9.0', isCurrent: true },
    { name: 'main', isCurrent: false },
  ];

  const tree = buildBranchTree(branches);

  // Unexpanded canary/
  const flatCollapsed = flattenBranchTree(tree, new Set());
  assert.equal(flatCollapsed.length, 2); // folder 'canary/' + branch 'main'
  assert.equal(flatCollapsed[0].type, 'folder');
  assert.equal(flatCollapsed[0].isExpanded, false);
  assert.equal(flatCollapsed[1].name, 'main');

  // Expanded canary/ and canary/prod/
  const flatExpanded = flattenBranchTree(
    tree,
    new Set(['canary/', 'canary/dev/', 'canary/prod/'])
  );
  assert.ok(flatExpanded.some((r) => r.type === 'branch' && r.fullName === 'canary/prod/1.9.0' && r.isCurrent));
  assert.ok(flatExpanded.some((r) => r.type === 'branch' && r.name === '1.9.0'));
});

test('fold prefix branch: search filter prunes non-matching branches', () => {
  const branches = [
    { name: 'canary/dev/1.9.0' },
    { name: 'canary/prod/1.9.0' },
    { name: 'fix/login' },
    { name: 'main' },
  ];

  const tree = buildBranchTree(branches);
  const filtered = filterBranchTree(tree, 'login');

  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].type, 'folder');
  assert.equal(filtered[0].prefix, 'fix/');
  assert.equal(filtered[0].totalBranches, 1);
});

// =============================================================================
// Suite 2: Windowing (virtual list)
// =============================================================================

test('windowing: computes visible slice and offsets correctly', () => {
  const result = computeWindowing({
    totalItems: 500,
    itemHeight: 30,
    scrollTop: 300, // item index 10
    viewportHeight: 300, // 10 items visible
    buffer: 2,
  });

  assert.equal(result.totalHeight, 15000);
  assert.equal(result.startIndex, 8); // 10 - 2
  assert.equal(result.endIndex, 22); // (300+300)/30 = 20 + 2 = 22
  assert.equal(result.offsetY, 240); // 8 * 30
  assert.equal(result.visibleCount, 14);
  assert.equal(result.visibleIndices[0], 8);
  assert.equal(result.visibleIndices[result.visibleIndices.length - 1], 21);
});

test('windowing: handles edge cases like 0 items, top and bottom clamp', () => {
  const empty = computeWindowing({
    totalItems: 0,
    itemHeight: 30,
    scrollTop: 0,
    viewportHeight: 300,
  });
  assert.equal(empty.totalHeight, 0);
  assert.equal(empty.visibleCount, 0);

  const top = computeWindowing({
    totalItems: 100,
    itemHeight: 30,
    scrollTop: 0,
    viewportHeight: 300,
    buffer: 3,
  });
  assert.equal(top.startIndex, 0);
  assert.equal(top.offsetY, 0);

  const bottom = computeWindowing({
    totalItems: 50,
    itemHeight: 30,
    scrollTop: 2000,
    viewportHeight: 300,
    buffer: 5,
  });
  assert.equal(bottom.endIndex, 50);
});

// =============================================================================
// Suite 3: Markdown -> HTML sanitasi
// =============================================================================

test('markdown sanitasi: escapes raw HTML tags and prevents script injection', () => {
  const malicious = '<script>alert("xss")</script> **safe** & <em>inline</em>';
  const html = renderMarkdownToHtml(malicious);

  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('<strong>safe</strong>'));
  assert.ok(html.includes('&amp;'));
});

test('markdown sanitasi: converts markdown links to safe anchor tags without raw dump', () => {
  const input = 'See [Dart Documentation](https://dart.dev/guides) for details.';
  const html = renderMarkdownToHtml(input);

  assert.ok(html.includes('<a href="https://dart.dev/guides" target="_blank" rel="noopener noreferrer" class="cm-lsp-link">Dart Documentation</a>'));
  assert.ok(!html.includes('[Dart Documentation](https://dart.dev/guides)'));
});

test('markdown sanitasi: neutralizes dangerous javascript: pseudo-protocols', () => {
  const malicious = '[Click here](javascript:alert(1))';
  const html = renderMarkdownToHtml(malicious);

  assert.ok(!html.includes('href="javascript:'));
  assert.ok(html.includes('href="#"'));
});

test('markdown sanitasi: handles fenced code blocks and inline code cleanly', () => {
  const codeDoc = 'Function returns:\n```dart\nFuture<void> run() async {}\n```\nUse `await run();`.';
  const html = renderMarkdownToHtml(codeDoc);

  assert.ok(html.includes('<pre class="cm-lsp-code-block"><code class="language-dart">Future&lt;void&gt; run() async {}</code></pre>'));
  assert.ok(html.includes('<code class="cm-lsp-inline-code">await run();</code>'));
});

// =============================================================================
// Suite 4: Device grouping
// =============================================================================

test('device grouping: groups snapshot into Android Emulators, iOS Simulators, and Physical', () => {
  const snapshot = {
    emulators: [
      { id: 'Pixel_8_API_35', name: 'Pixel 8', kind: 'android-avd', state: 'running', deviceId: 'emulator-5554' },
      { id: 'Nexus_5_API_30', name: 'Nexus 5', kind: 'android-avd', state: 'stopped', deviceId: null },
      { id: 'iPhone-15-Pro', name: 'iPhone 15 Pro', kind: 'ios-sim', state: 'running', deviceId: 'udid-123' },
    ],
    physical: [
      { id: 'usb-android-1', name: 'Galaxy S23', platform: 'android', transport: 'usb', state: 'online' },
      { id: 'usb-iphone-1', name: 'UQi iPhone', platform: 'ios', transport: 'usb', state: 'offline' },
    ],
  };

  const grouped = groupDevices(snapshot);

  assert.equal(grouped.androidEmulators.length, 2);
  assert.equal(grouped.iosSimulators.length, 1);
  assert.equal(grouped.physicalDevices.length, 2);

  // Picker should only contain ONLINE/RUNNING devices (offline filtered out!)
  assert.equal(grouped.pickerItems.length, 3);

  const emuPicker = grouped.pickerItems.find((p) => p.group === 'Emulator');
  assert.ok(emuPicker);
  assert.equal(emuPicker.name, 'Pixel 8');

  const simPicker = grouped.pickerItems.find((p) => p.group === 'Simulator');
  assert.ok(simPicker);
  assert.equal(simPicker.name, 'iPhone 15 Pro');

  const physPicker = grouped.pickerItems.find((p) => p.group === 'Physical');
  assert.ok(physPicker);
  assert.equal(physPicker.name, 'Galaxy S23');

  // Offline iPhone was removed from picker!
  const offlinePicker = grouped.pickerItems.find((p) => p.id === 'usb-iphone-1');
  assert.equal(offlinePicker, undefined);
});

test('device grouping: falls back to legacy device lists when snapshot is empty', () => {
  const legacyDevices = [
    { id: 'emulator-5554', name: 'Pixel 8', platform: 'android', kind: 'emulator', state: 'online' },
    { id: 'phone-usb', name: 'Pixel 6', platform: 'android', kind: 'physical', state: 'online' },
    { id: 'phone-offline', name: 'Old Phone', platform: 'android', kind: 'physical', state: 'offline' },
  ];
  const legacyAvds = [{ name: 'Pixel_8' }, { name: 'Pixel_9_Offline' }];

  const grouped = groupDevices(null, legacyDevices, legacyAvds);

  assert.ok(grouped.androidEmulators.length >= 1);
  assert.ok(grouped.physicalDevices.length >= 2);
  // Offline device is not in pickerItems
  assert.equal(grouped.pickerItems.some((d) => d.id === 'phone-offline'), false);
  assert.equal(grouped.pickerItems.some((d) => d.id === 'phone-usb'), true);
});
