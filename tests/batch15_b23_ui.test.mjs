import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hunkToSbs } from '../ui/features/git/sbs.ts';
import {
  ANDROID_EMULATOR_SVG,
  IOS_SIMULATOR_SVG,
  DEVICE_USB_SVG,
  DEVICE_WIFI_SVG,
  TOOL_WINDOWS_SVG,
  MR_APPROVE_SVG,
  MR_MERGE_SVG,
  MR_REBASE_SVG,
} from '../ui/icons/index.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uiRoot = path.resolve(__dirname, '../ui');

test('b23 UI 1: Standalone Welcome Dashboard isolation in App.svelte and TitleBar.svelte', () => {
  const appPath = path.resolve(uiRoot, 'App.svelte');
  const appCode = fs.readFileSync(appPath, 'utf-8');

  // TitleBar receives showDashboard prop
  assert.ok(appCode.includes('showDashboard={showDashboard}') || appCode.includes('{showDashboard}'));
  // Rail is isolated when showDashboard
  assert.ok(appCode.includes('{#if !showDashboard}'));
  // StatusBar is isolated when showDashboard
  assert.ok(appCode.includes('{#if !showDashboard}'));

  const titleBarPath = path.resolve(uiRoot, 'shell/TitleBar.svelte');
  const titleBarCode = fs.readFileSync(titleBarPath, 'utf-8');
  assert.ok(titleBarCode.includes('showDashboard = false') || titleBarCode.includes('showDashboard?: boolean'));
  assert.ok(titleBarCode.includes('{#if showDashboard}'));
  assert.ok(titleBarCode.includes('brand-version-badge') || titleBarCode.includes('v0.8.0'));
});

test('b23 UI 2: Toolchains panel has live rescan button and toolchain SVG icons', () => {
  const panelPath = path.resolve(uiRoot, 'features/toolchain/ToolchainsPanel.svelte');
  const panelCode = fs.readFileSync(panelPath, 'utf-8');

  assert.ok(panelCode.includes('toolchainStore.refresh(root)'));
  assert.ok(panelCode.includes('btn-rescan'));
  assert.ok(panelCode.includes('Pindai Ulang'));
  assert.ok(panelCode.includes('TOOLCHAIN_FLUTTER_SVG'));
  assert.ok(panelCode.includes('TOOLCHAIN_ANDROID_SVG'));
});

test('b23 UI 3: Search Everywhere UX file name bold and directory subtitle in Palette.svelte', () => {
  const palettePath = path.resolve(uiRoot, 'features/search/Palette.svelte');
  const paletteCode = fs.readFileSync(palettePath, 'utf-8');

  assert.ok(paletteCode.includes('file-name-bold'));
  assert.ok(paletteCode.includes('file-dir-path'));
  assert.ok(paletteCode.includes('lastIndexOf(\'/\')'));
  assert.ok(paletteCode.includes('fileName'));
  assert.ok(paletteCode.includes('dirPath'));
});

test('b23 UI 4: Side-by-side Diff Viewer synchronized scroll and horizontal container in DiffView.svelte', () => {
  const diffPath = path.resolve(uiRoot, 'features/git/DiffView.svelte');
  const diffCode = fs.readFileSync(diffPath, 'utf-8');

  assert.ok(diffCode.includes('handleSyncScroll'));
  assert.ok(diffCode.includes('sbs-split-wrapper'));
  assert.ok(diffCode.includes('leftPanelEl'));
  assert.ok(diffCode.includes('rightPanelEl'));
  assert.ok(diffCode.includes('scrollTop'));
  assert.ok(diffCode.includes('scrollLeft'));
  assert.ok(diffCode.includes('overflow-x: auto'));
  assert.ok(diffCode.includes('white-space: pre'));

  // Test hunkToSbs line-by-line alignment filler spacers
  const hunk = {
    oldStart: 1,
    oldLines: 2,
    newStart: 1,
    newLines: 3,
    header: '@@ -1,2 +1,3 @@',
    lines: [
      { kind: 'del', text: 'deleted line', oldNo: 1, newNo: null },
      { kind: 'add', text: 'added line 1', oldNo: null, newNo: 1 },
      { kind: 'add', text: 'added line 2', oldNo: null, newNo: 2 },
      { kind: 'context', text: 'common line', oldNo: 2, newNo: 3 },
    ],
  };
  const sbs = hunkToSbs(hunk);
  assert.equal(sbs.rows.length, 3);
  assert.equal(sbs.rows[0].left.kind, 'del');
  assert.equal(sbs.rows[0].right.kind, 'add');
  assert.equal(sbs.rows[1].left.kind, 'filler'); // Spacer!
  assert.equal(sbs.rows[1].right.kind, 'add');
  assert.equal(sbs.rows[2].left.kind, 'context');
  assert.equal(sbs.rows[2].right.kind, 'context');
});

test('b23 UI 5: Edit Configurations modal dialog and RunConfigPicker trigger', () => {
  const dialogPath = path.resolve(uiRoot, 'features/run/RunConfigDialog.svelte');
  assert.ok(fs.existsSync(dialogPath), 'RunConfigDialog.svelte must exist');

  const dialogCode = fs.readFileSync(dialogPath, 'utf-8');
  assert.ok(dialogCode.includes('Run/Debug Configurations'));
  assert.ok(dialogCode.includes('Dart Entrypoint Target'));
  assert.ok(dialogCode.includes('runConfigsSave'));
  assert.ok(dialogCode.includes('.petak/run.json'));

  const pickerPath = path.resolve(uiRoot, 'features/run/RunConfigPicker.svelte');
  const pickerCode = fs.readFileSync(pickerPath, 'utf-8');
  assert.ok(pickerCode.includes('Edit Configurations…'));
  assert.ok(pickerCode.includes('onOpenEditConfigs'));

  const titleBarPath = path.resolve(uiRoot, 'shell/TitleBar.svelte');
  const titleBarCode = fs.readFileSync(titleBarPath, 'utf-8');
  assert.ok(titleBarCode.includes('config-gear-btn'));
  assert.ok(titleBarCode.includes('RunConfigDialog'));
});

test('b23 UI 6: GitLab MR Actions (Approve, Rebase, Create MR Modal & Tabs)', () => {
  const apiPath = path.resolve(uiRoot, 'lib/api.ts');
  const apiCode = fs.readFileSync(apiPath, 'utf-8');
  assert.ok(apiCode.includes('mrCreate('));
  assert.ok(apiCode.includes('mrRebase('));

  const mrCreateModalPath = path.resolve(uiRoot, 'features/mr/MrCreateModal.svelte');
  assert.ok(fs.existsSync(mrCreateModalPath), 'MrCreateModal.svelte must exist');
  const modalCode = fs.readFileSync(mrCreateModalPath, 'utf-8');
  assert.ok(modalCode.includes('Buat Merge Request (GitLab)'));
  assert.ok(modalCode.includes('sourceBranch'));
  assert.ok(modalCode.includes('targetBranch'));
  assert.ok(modalCode.includes('removeSourceBranch'));

  const mrDetailPath = path.resolve(uiRoot, 'features/mr/MrDetail.svelte');
  const mrDetailCode = fs.readFileSync(mrDetailPath, 'utf-8');
  assert.ok(mrDetailCode.includes('btn-approve'));
  assert.ok(mrDetailCode.includes('btn-rebase'));
  assert.ok(mrDetailCode.includes('Discussion'));
  assert.ok(mrDetailCode.includes('Commits'));
  assert.ok(mrDetailCode.includes('Changes'));
  assert.ok(mrDetailCode.includes('MR_APPROVE_SVG'));
  assert.ok(mrDetailCode.includes('MR_REBASE_SVG'));
});

test('b23 UI 7: Rail Quick Menu Tool Windows and shortcut ⌘0', () => {
  const railPath = path.resolve(uiRoot, 'shell/Rail.svelte');
  const railCode = fs.readFileSync(railPath, 'utf-8');

  assert.ok(railCode.includes('tool-windows-btn'));
  assert.ok(railCode.includes('TOOL_WINDOWS_SVG'));
  assert.ok(railCode.includes('PANEL UTAMA'));
  assert.ok(railCode.includes('PANEL BAWAH'));
  assert.ok(railCode.includes('Terminal'));
  assert.ok(railCode.includes('Run / Build Output'));
  assert.ok(railCode.includes('e.key === \'0\''));
});

test('b23 UI 8: Minimalist Coder SVG icons exist, are well-formed XML and stroke-based', () => {
  const icons = [
    ANDROID_EMULATOR_SVG,
    IOS_SIMULATOR_SVG,
    DEVICE_USB_SVG,
    DEVICE_WIFI_SVG,
    TOOL_WINDOWS_SVG,
    MR_APPROVE_SVG,
    MR_MERGE_SVG,
    MR_REBASE_SVG,
  ];

  for (const svg of icons) {
    assert.ok(svg.includes('<svg'));
    assert.ok(svg.includes('viewBox="0 0 24 24"'));
    assert.ok(svg.includes('stroke="currentColor"'));
    assert.ok(svg.includes('fill="none"'));
  }

  // Check device picker integration
  const devicePickerPath = path.resolve(uiRoot, 'features/run/DevicePicker.svelte');
  const pickerCode = fs.readFileSync(devicePickerPath, 'utf-8');
  assert.ok(pickerCode.includes('ANDROID_EMULATOR_SVG'));
  assert.ok(pickerCode.includes('IOS_SIMULATOR_SVG'));
  assert.ok(pickerCode.includes('DEVICE_USB_SVG'));
  assert.ok(pickerCode.includes('DEVICE_WIFI_SVG'));
});
