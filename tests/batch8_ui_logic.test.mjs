import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderMarkdownToHtml } from '../ui/features/editor/lsp/markdown.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uiRoot = path.resolve(__dirname, '../ui');

// =============================================================================
// Suite 1: Xcode-Style Standalone Starting Point (Scope 1)
// =============================================================================

test('starting point: 2-column xcode layout with 5 main actions and recents list', () => {
  const dashboardPath = path.resolve(uiRoot, 'features/dashboard/DashboardView.svelte');
  const code = fs.readFileSync(dashboardPath, 'utf-8');

  // 1. Dual column layout ala Xcode
  assert.ok(code.includes('xcode-window'), 'Must have xcode-window container');
  assert.ok(code.includes('column-left'), 'Must have left column for brand & actions');
  assert.ok(code.includes('column-right'), 'Must have right column for recent projects');

  // 2. Left column brand: animated logo, big Petak title & version
  assert.ok(code.includes('welcome-title'), 'Must have welcome-title');
  assert.ok(code.includes('version-tag'), 'Must have version-tag');
  assert.ok(code.includes('@keyframes petak-glow'), 'Must retain petak-glow');
  assert.ok(code.includes('@keyframes petak-logo-breathe'), 'Must retain petak-logo-breathe');
  assert.ok(code.includes('@keyframes petak-cell-pulse-1'), 'Must retain petak-cell-pulse-1');
  assert.ok(code.includes('prefers-reduced-motion'), 'Must retain prefers-reduced-motion');

  // 3. 5 Main actions
  assert.ok(code.includes('actOpen'), 'Action 1: Buka Folder');
  assert.ok(code.includes('actNew'), 'Action 2: Project Baru');
  assert.ok(code.includes('actClone'), 'Action 3: Clone Repo');
  assert.ok(code.includes('actDoctor'), 'Action 4: Petak Doctor');
  assert.ok(code.includes('actSettings'), 'Action 5: Pengaturan');

  // 4. Right column recent projects: filter, bold name, grey path, remove button
  assert.ok(code.includes('project-search-input'), 'Must have search/filter input');
  assert.ok(code.includes('project-name'), 'Must have project name');
  assert.ok(code.includes('project-path'), 'Must have grey project path');
  assert.ok(code.includes('btn-remove-project'), 'Must have remove from recents button');
  assert.ok(code.includes('handleKeydown'), 'Must support keyboard navigation');
});

test('startup behavior: starting point is always displayed first without auto-open', () => {
  const appPath = path.resolve(uiRoot, 'App.svelte');
  const code = fs.readFileSync(appPath, 'utf-8');

  // Step 2 in onMount must NOT auto-open folder
  const onMountIdx = code.indexOf('onMount(async () => {');
  const keymapIdx = code.indexOf('// 3. Register global keymap');
  const onMountBlock = code.slice(onMountIdx, keymapIdx);

  assert.ok(!onMountBlock.includes('openFolder('), 'onMount startup must not auto-open recent folder');
  assert.ok(code.includes('{#if showDashboard}'), 'Dashboard must be shown when no folder is open');
  assert.ok(code.includes('{#if currentFolderPath}'), 'Rail must be hidden when starting point is active');
});

// =============================================================================
// Suite 2: Clean Hover Tooltip & Typography (Scope 2)
// =============================================================================

test('hover markdown: separates header signature and clean body documentation', () => {
  const doc = [
    '```dart',
    'Future<void> setPreferredOrientations(List<DeviceOrientation> orientations)',
    '```',
    'Specifies the set of orientations the application interface may be displayed in.',
    '',
    '* `DeviceOrientation.portraitUp`',
    '* `DeviceOrientation.portraitDown`',
    '',
    '1. First setup orientation',
    '2. Second run window sync',
    '',
    '@param orientations The list of allowed orientations',
  ].join('\n');

  const html = renderMarkdownToHtml(doc);

  // 1. Header signature separated from body
  assert.ok(html.includes('cm-lsp-header-signature'), 'Must have distinct header signature container');
  assert.ok(html.includes('cm-lsp-signature-wrap'), 'Must have signature wrap');
  assert.ok(html.includes('setPreferredOrientations'), 'Must contain function signature');
  assert.ok(html.includes('cm-lsp-doc-body'), 'Must have documentation body container');

  // 2. Bullet list parsed to <ul> and <li>
  assert.ok(html.includes('<ul class="cm-lsp-list cm-lsp-bullet-list">'), 'Must parse bullet list to <ul>');
  assert.ok(html.includes('<li><code class="cm-lsp-inline-code">DeviceOrientation.portraitUp</code></li>'));
  assert.ok(html.includes('<li><code class="cm-lsp-inline-code">DeviceOrientation.portraitDown</code></li>'));

  // 3. Numbered list parsed to <ol> and <li>
  assert.ok(html.includes('<ol class="cm-lsp-list cm-lsp-numbered-list">'), 'Must parse numbered list to <ol>');
  assert.ok(html.includes('<li>First setup orientation</li>'));
  assert.ok(html.includes('<li>Second run window sync</li>'));

  // 4. Doc tags parsed cleanly
  assert.ok(html.includes('cm-lsp-doc-tag'), 'Must parse doc tags');
  assert.ok(html.includes('<span class="cm-lsp-tag-name">@param</span>'));
  assert.ok(html.includes('The list of allowed orientations'));
});

test('hover theme: tooltip maxHeight capped at 280px and custom scrollbar configured', () => {
  const hoverPath = path.resolve(uiRoot, 'features/editor/lsp/hover.ts');
  const code = fs.readFileSync(hoverPath, 'utf-8');

  assert.ok(code.includes("maxHeight: '280px !important'"), 'Tooltip maxHeight must be capped at 280px');
  assert.ok(code.includes('.cm-tooltip.cm-lsp-hover-tooltip::-webkit-scrollbar'), 'Must configure custom scrollbar');
  assert.ok(code.includes("scrollbarWidth: 'thin !important'"), 'Must configure thin scrollbar');
});

// =============================================================================
// Suite 3: Headless Emulator Auto-Connect Mirror (Scope 3)
// =============================================================================

test('headless mirror auto-connect: passes headless true on avdStart', () => {
  const runStorePath = path.resolve(uiRoot, 'features/run/runStore.svelte.ts');
  const runStoreCode = fs.readFileSync(runStorePath, 'utf-8');
  assert.ok(runStoreCode.includes('headless: boolean = true'), 'runStore.avdStart must default headless to true');

  const apiPath = path.resolve(uiRoot, 'lib/api.ts');
  const apiCode = fs.readFileSync(apiPath, 'utf-8');
  assert.ok(apiCode.includes('headless: boolean = true'), 'api.avdStart must accept headless param');
  assert.ok(apiCode.includes('headless'), 'api.avdStart must pass headless to invoke');
});

test('emulator-status resolution: resolves online adb serial for mirrorStore.open', () => {
  const panelPath = path.resolve(uiRoot, 'features/run/DevicesPanel.svelte');
  const panelCode = fs.readFileSync(panelPath, 'utf-8');

  // Check event.serial or online device id resolution
  assert.ok(panelCode.includes('event.serial'), 'Must check event.serial first');
  assert.ok(panelCode.includes('runStore.devices.find'), 'Must find matching online device in runStore.devices');
  assert.ok(panelCode.includes('runStore.selectDevice(target)'), 'Must select target device');
  assert.ok(panelCode.includes('mirrorStore.open(target)'), 'Must open mirror with target serial');
});

test('physical ios capture: provides Retry button and informative error on helper exit', () => {
  const discPath = path.resolve(uiRoot, 'features/mirror/states/StateDisconnected.svelte');
  const discCode = fs.readFileSync(discPath, 'utf-8');

  assert.ok(discCode.includes('isIosPhysical'), 'Must detect physical iOS');
  assert.ok(discCode.includes('Retry'), 'Must provide Retry button');
  assert.ok(discCode.includes('mirrorStore.reconnect()'), 'Retry must trigger reconnect');
  assert.ok(discCode.includes('helper exit') || discCode.includes('helper stopped'), 'Must provide informative helper exit message');
});
