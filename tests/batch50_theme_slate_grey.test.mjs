import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const uiRoot = path.resolve(projectRoot, 'ui');

// =============================================================================
// Helper: WCAG 2.1 Relative Luminance & Contrast Ratio Calculation
// =============================================================================
function hexToRgb(hex) {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.substring(0, 2), 16);
  const g = parseInt(clean.substring(2, 4), 16);
  const b = parseInt(clean.substring(4, 6), 16);
  return [r, g, b];
}

function sRgbToLinear(c) {
  const norm = c / 255;
  return norm <= 0.03928 ? norm / 12.92 : Math.pow((norm + 0.055) / 1.055, 2.4);
}

function relativeLuminance([r, g, b]) {
  const R = sRgbToLinear(r);
  const G = sRgbToLinear(g);
  const B = sRgbToLinear(b);
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

function contrastRatio(hex1, hex2) {
  const l1 = relativeLuminance(hexToRgb(hex1));
  const l2 = relativeLuminance(hexToRgb(hex2));
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

// =============================================================================
// Suite 1: Token Slate Grey di index.html (:root, body.variant-a dan body.variant-b)
// =============================================================================
test('b50 Slate Grey 1: index.html defines exact tokens for default / variant-a and variant-b', () => {
  const indexHtml = fs.readFileSync(path.resolve(projectRoot, 'index.html'), 'utf-8');

  // Variant A & Default
  assert.ok(indexHtml.includes('--p-bg-base: #1e1f22'), 'Base background must be #1e1f22');
  assert.ok(indexHtml.includes('--p-bg-surface: #26282b'), 'Surface background must be #26282b');
  assert.ok(indexHtml.includes('--p-bg-workspace: #2b2d30'), 'Workspace/editor background must be #2b2d30');
  assert.ok(indexHtml.includes('--p-bg-elevated: #35373c'), 'Elevated background must be #35373c');
  assert.ok(indexHtml.includes('--p-bg-hover: #323539'), 'Hover background must be #323539');
  assert.ok(indexHtml.includes('--p-bg-active: #383a40'), 'Active surface must be #383a40');
  assert.ok(indexHtml.includes('--border-default: #393b40'), 'Border default must be #393b40');
  assert.ok(indexHtml.includes('--border-subtle: rgba(255, 255, 255, 0.08)'), 'Border subtle must be rgba(255,255,255,0.08)');
  assert.ok(indexHtml.includes('--border-focus: rgba(53, 116, 240, 0.6)'), 'Border focus must be rgba(53,116,240,0.6)');
  assert.ok(indexHtml.includes('--text: #dbdee1'), 'Primary text must be #dbdee1');
  assert.ok(indexHtml.includes('--text-muted: #949ba4'), 'Muted text must be #949ba4');
  assert.ok(indexHtml.includes('--selection-bg: #353b4b'), 'Selection background must be #353b4b');
  assert.ok(indexHtml.includes('--accent: #3574f0'), 'Accent must be #3574f0 (JetBrains Blue)');
  assert.ok(indexHtml.includes('--success: #57c87c'), 'Success status must be #57c87c');
  assert.ok(indexHtml.includes('--warning: #e0aa4e'), 'Warning status must be #e0aa4e');
  assert.ok(indexHtml.includes('--danger: #e5534b'), 'Danger status must be #e5534b');

  // Variant B (Discord Dark)
  assert.ok(indexHtml.includes('body.variant-b'), 'Must define body.variant-b selector');
  assert.ok(indexHtml.includes('--p-bg-surface: #2b2d31'), 'Variant B surface must be #2b2d31');
  assert.ok(indexHtml.includes('--p-bg-workspace: #313338'), 'Variant B workspace must be #313338');
  assert.ok(indexHtml.includes('--border-focus: rgba(88, 101, 242, 0.6)'), 'Variant B border focus must be Discord purple/blue');
  assert.ok(indexHtml.includes('--accent: #5865f2'), 'Variant B accent must be #5865f2');
});

// =============================================================================
// Suite 2: Zero Pitch Black pada Editor Canvas & Chrome IDE
// =============================================================================
test('b50 Slate Grey 2: Zero pitch black (#0c0d10, #08090d, #000000) on editor background and IDE chrome', () => {
  const filesToCheck = [
    path.resolve(projectRoot, 'index.html'),
    path.resolve(uiRoot, 'shell/TitleBar.svelte'),
    path.resolve(uiRoot, 'features/dashboard/DashboardView.svelte'),
  ];

  for (const filePath of filesToCheck) {
    const content = fs.readFileSync(filePath, 'utf-8');
    assert.ok(!content.includes('#0c0d10'), `${path.basename(filePath)} must not contain legacy pitch black #0c0d10`);
    assert.ok(!content.includes('#08090d'), `${path.basename(filePath)} must not contain pitch black #08090d`);
  }

  // SettingsModal variant descriptions & chrome
  const settingsContent = fs.readFileSync(path.resolve(uiRoot, 'features/settings/SettingsModal.svelte'), 'utf-8');
  assert.ok(!settingsContent.includes('#0c0d10'), 'SettingsModal must not contain #0c0d10');
  assert.ok(!settingsContent.includes('#08090d'), 'SettingsModal must not contain #08090d');

  // Editor background in Editor.svelte
  const editorContent = fs.readFileSync(path.resolve(uiRoot, 'features/editor/Editor.svelte'), 'utf-8');
  assert.ok(!editorContent.includes('#0c0d10'), 'Editor.svelte must not contain #0c0d10');
  assert.ok(!editorContent.includes('#08090d'), 'Editor.svelte must not contain #08090d');
  assert.ok(!editorContent.includes('background: #1a1b1f'), 'Editor.svelte must not use obsolete background #1a1b1f');
});

// =============================================================================
// Suite 3: Validasi Rasio Kontras WCAG AAA
// =============================================================================
test('b50 Slate Grey 3: WCAG AAA contrast ratio compliance (>= 7:1) for text against all slate layers', () => {
  const textPrimary = '#dbdee1';

  const layers = [
    { name: 'Layer 0 Base (Activity Rail / App)', hex: '#1e1f22' },
    { name: 'Layer 1 Surface (Tool Windows / TitleBar)', hex: '#26282b' },
    { name: 'Layer 2 Workspace (Editor Canvas Variant A)', hex: '#2b2d30' },
    { name: 'Layer 2 Workspace (Editor Canvas Variant B)', hex: '#313338' },
    { name: 'Layer 3 Elevated (Cards / Popovers)', hex: '#35373c' },
    { name: 'Hover Surface', hex: '#323539' },
  ];

  for (const layer of layers) {
    const ratio = contrastRatio(textPrimary, layer.hex);
    assert.ok(
      ratio >= 7.0,
      `Contrast ratio for ${textPrimary} on ${layer.name} (${layer.hex}) must be >= 7.0:1 (got ${ratio.toFixed(2)}:1)`
    );
  }
});

// =============================================================================
// Suite 4: CodeMirror Theme Synchronization (themeDarcula.ts & Editor.svelte)
// =============================================================================
test('b50 Slate Grey 4: CodeMirror theme synchronization in themeDarcula.ts and Editor.svelte', async () => {
  const darculaSource = fs.readFileSync(path.resolve(uiRoot, 'features/editor/themeDarcula.ts'), 'utf-8');
  const editorSource = fs.readFileSync(path.resolve(uiRoot, 'features/editor/Editor.svelte'), 'utf-8');

  // Verify themeDarcula.ts tokens
  assert.ok(darculaSource.includes("backgroundColor: '#2b2d30'"), 'darculaTheme canvas background must be #2b2d30');
  assert.ok(darculaSource.includes("backgroundColor: '#26282b'"), 'darculaTheme gutters background must be #26282b');
  assert.ok(darculaSource.includes("borderRight: '1px solid #393b40'"), 'darculaTheme gutter divider must be 1px solid #393b40');
  assert.ok(darculaSource.includes("caretColor: '#3574f0'"), 'darculaTheme caret must be #3574f0');
  assert.ok(darculaSource.includes("borderLeftColor: '#3574f0'"), 'darculaTheme cursor must be #3574f0');
  assert.ok(darculaSource.includes("backgroundColor: '#353b4b !important'"), 'darculaTheme selection must be #353b4b');
  assert.ok(darculaSource.includes("color: '#dbdee1'"), 'darculaTheme text color must be #dbdee1');

  // Verify Editor.svelte petakTheme tokens
  assert.ok(editorSource.includes("backgroundColor: '#2b2d30'"), 'petakTheme canvas background must be #2b2d30');
  assert.ok(editorSource.includes("borderRight: '1px solid #393b40'"), 'petakTheme gutter divider must be 1px solid #393b40');
  assert.ok(editorSource.includes("borderTop: '1px solid #393b40'"), 'petakTheme vim panel borderTop must be 1px solid #393b40');
});

// =============================================================================
// Suite 5: Zero Pitch Black pada Shell, Activity Rail, Menu & AI Panels
// =============================================================================
test('b50 Slate Grey 5: Shell components, Activity Rail, Menus & AI Panel free of hardcoded pitch black', () => {
  const shellFiles = [
    path.resolve(uiRoot, 'shell/Rail.svelte'),
    path.resolve(uiRoot, 'shell/RightRail.svelte'),
    path.resolve(uiRoot, 'shell/FileTree.svelte'),
    path.resolve(uiRoot, 'shell/TitleBar.svelte'),
    path.resolve(uiRoot, 'shell/RightDock.svelte'),
    path.resolve(uiRoot, 'shell/StatusBar.svelte'),
    path.resolve(uiRoot, 'features/agents/AgentsPanel.svelte'),
    path.resolve(uiRoot, 'features/agents/AgentChat.svelte'),
    path.resolve(uiRoot, 'features/terminal/TerminalPanel.svelte'),
  ];

  const pitchBlackTokens = [
    '#111215',
    '#141518',
    '#0d0e12',
    '#0d0e11',
    '#0f1013',
    '#090a0c',
    '#121317',
    '#16171a',
  ];

  for (const filePath of shellFiles) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const fileName = path.basename(filePath);
    for (const token of pitchBlackTokens) {
      assert.ok(
        !content.includes(`background: ${token}`) &&
        !content.includes(`background:${token}`) &&
        !content.includes(`background-color: ${token}`) &&
        !content.includes(`background-color:${token}`),
        `${fileName} must not have background with pitch black token ${token}`
      );
    }
  }

  // Verify CSS variable token adoption on key selectors
  const railContent = fs.readFileSync(path.resolve(uiRoot, 'shell/Rail.svelte'), 'utf-8');
  assert.ok(railContent.includes('var(--p-bg-base, #1e1f22)'), 'Rail.svelte must use var(--p-bg-base, #1e1f22)');

  const rightRailContent = fs.readFileSync(path.resolve(uiRoot, 'shell/RightRail.svelte'), 'utf-8');
  assert.ok(rightRailContent.includes('var(--p-bg-base, #1e1f22)'), 'RightRail.svelte must use var(--p-bg-base, #1e1f22)');

  const fileTreeContent = fs.readFileSync(path.resolve(uiRoot, 'shell/FileTree.svelte'), 'utf-8');
  assert.ok(fileTreeContent.includes('var(--p-bg-surface, #26282b)'), 'FileTree.svelte must use var(--p-bg-surface, #26282b)');

  const titleBarContent = fs.readFileSync(path.resolve(uiRoot, 'shell/TitleBar.svelte'), 'utf-8');
  assert.ok(titleBarContent.includes('var(--p-bg-workspace, #2b2d30)'), 'TitleBar.svelte search-btn must use var(--p-bg-workspace, #2b2d30)');
  assert.ok(titleBarContent.includes('var(--p-bg-elevated, #35373c)'), 'TitleBar.svelte popup menus must use var(--p-bg-elevated, #35373c)');

  const agentChatContent = fs.readFileSync(path.resolve(uiRoot, 'features/agents/AgentChat.svelte'), 'utf-8');
  assert.ok(agentChatContent.includes('var(--p-bg-workspace, #2b2d30)'), 'AgentChat.svelte messages must use var(--p-bg-workspace, #2b2d30)');
  assert.ok(agentChatContent.includes('var(--p-bg-surface, #26282b)'), 'AgentChat.svelte composer must use var(--p-bg-surface, #26282b)');

  const statusBarContent = fs.readFileSync(path.resolve(uiRoot, 'shell/StatusBar.svelte'), 'utf-8');
  assert.ok(statusBarContent.includes('var(--p-bg-surface, #26282b)'), 'StatusBar.svelte must use var(--p-bg-surface, #26282b)');

  const termPanelContent = fs.readFileSync(path.resolve(uiRoot, 'features/terminal/TerminalPanel.svelte'), 'utf-8');
  assert.ok(termPanelContent.includes('var(--p-bg-surface, #26282b)'), 'TerminalPanel.svelte header must use var(--p-bg-surface, #26282b)');
  assert.ok(termPanelContent.includes('var(--p-bg-workspace, #2b2d30)'), 'TerminalPanel.svelte body must use var(--p-bg-workspace, #2b2d30)');
});

// =============================================================================
// Suite 6: Zero Pitch Black pada Seluruh Panel Fitur (Slate Grey)
// =============================================================================
test('b50 Slate Grey 6: Feature panels free of hardcoded pitch black', () => {
  const featureFiles = [
    // 1. Changes (Commit Panel & Stash)
    path.resolve(uiRoot, 'features/git/CommitPanel.svelte'),
    path.resolve(uiRoot, 'features/git/StashView.svelte'),
    // 2. Git
    path.resolve(uiRoot, 'features/git/GitView.svelte'),
    path.resolve(uiRoot, 'features/git/LogView.svelte'),
    path.resolve(uiRoot, 'features/git/BranchPanel.svelte'),
    path.resolve(uiRoot, 'features/git/CommitDetail.svelte'),
    path.resolve(uiRoot, 'features/git/DiffView.svelte'),
    // 3. Run Panel & Run Config
    path.resolve(uiRoot, 'features/run/RunPanel.svelte'),
    path.resolve(uiRoot, 'features/run/RunConfigDialog.svelte'),
    // 4. Build Panel
    path.resolve(uiRoot, 'features/run/BuildPanel.svelte'),
    // 5. Logcat Panel
    path.resolve(uiRoot, 'features/run/LogcatPanel.svelte'),
    // 6. Problems Panel
    path.resolve(uiRoot, 'features/problems/ProblemsPanel.svelte'),
    // 7. Toolchains Panel
    path.resolve(uiRoot, 'features/toolchain/ToolchainsPanel.svelte'),
    // 8. Merge / MR & Three-Way Merge
    path.resolve(uiRoot, 'features/mr/MrView.svelte'),
    path.resolve(uiRoot, 'features/mr/MrList.svelte'),
    path.resolve(uiRoot, 'features/mr/MrDetail.svelte'),
    path.resolve(uiRoot, 'features/mr/MrFiles.svelte'),
    path.resolve(uiRoot, 'features/mr/MrThread.svelte'),
    path.resolve(uiRoot, 'features/mr/MrMergeBar.svelte'),
    path.resolve(uiRoot, 'features/mr/MrCreateModal.svelte'),
    path.resolve(uiRoot, 'features/git/ThreeWayMergeModal.svelte'),
    path.resolve(uiRoot, 'features/git/ConflictView.svelte'),
    path.resolve(uiRoot, 'features/git/RebaseBranchModal.svelte'),
    path.resolve(uiRoot, 'features/git/RebaseDialog.svelte'),
    // 9. Automation & Tests Panel
    path.resolve(uiRoot, 'features/tests/TestsPanel.svelte'),
    // 10. Devices Panel & Pair Device Modal
    path.resolve(uiRoot, 'features/run/DevicesPanel.svelte'),
    path.resolve(uiRoot, 'features/run/PairDeviceModal.svelte'),
    // 11. Device Mirror
    path.resolve(uiRoot, 'features/mirror/DeviceMirrorPanel.svelte'),
    path.resolve(uiRoot, 'features/mirror/DeviceStage.svelte'),
    path.resolve(uiRoot, 'features/mirror/DeviceToolbarTop.svelte'),
    path.resolve(uiRoot, 'features/mirror/DeviceToolbarBottom.svelte'),
    path.resolve(uiRoot, 'features/mirror/DevicePickerView.svelte'),
    // 12. Project Memory (Obsidian Vault Panel)
    path.resolve(uiRoot, 'features/agents/MemoryView.svelte'),
  ];

  const pitchBlackTokens = [
    '#141518',
    '#111215',
    '#16171a',
    '#1c1d22',
    '#121316',
    '#18191d',
    '#0d1117',
    '#0f1013',
    '#0c0d10',
    '#121317',
    '#18191c',
    '#151619',
    '#131417',
    '#1e2025',
    '#101114',
    '#18191e',
    '#1a1c22',
    '#17181c',
    '#14151a',
    '#111317',
    '#18191f',
    '#131418',
  ];

  for (const filePath of featureFiles) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const fileName = path.basename(filePath);
    for (const token of pitchBlackTokens) {
      assert.ok(
        !content.includes(`background: ${token}`) &&
        !content.includes(`background:${token}`) &&
        !content.includes(`background-color: ${token}`) &&
        !content.includes(`background-color:${token}`),
        `${fileName} must not have background with pitch black token ${token}`
      );
    }
  }

  // Verify CSS variable token adoption in key feature panels
  const commitPanelContent = fs.readFileSync(path.resolve(uiRoot, 'features/git/CommitPanel.svelte'), 'utf-8');
  assert.ok(commitPanelContent.includes('var(--p-bg-surface, #26282b)'), 'CommitPanel.svelte must use var(--p-bg-surface, #26282b)');
  assert.ok(commitPanelContent.includes('var(--p-bg-workspace, #2b2d30)'), 'CommitPanel.svelte must use var(--p-bg-workspace, #2b2d30)');

  const logViewContent = fs.readFileSync(path.resolve(uiRoot, 'features/git/LogView.svelte'), 'utf-8');
  assert.ok(logViewContent.includes('var(--p-bg-surface, #26282b)'), 'LogView.svelte must use var(--p-bg-surface, #26282b)');
  assert.ok(logViewContent.includes('var(--p-bg-workspace, #2b2d30)'), 'LogView.svelte must use var(--p-bg-workspace, #2b2d30)');

  const runPanelContent = fs.readFileSync(path.resolve(uiRoot, 'features/run/RunPanel.svelte'), 'utf-8');
  assert.ok(runPanelContent.includes('var(--p-bg-surface, #26282b)'), 'RunPanel.svelte must use var(--p-bg-surface, #26282b)');
  assert.ok(runPanelContent.includes('var(--p-bg-workspace, #2b2d30)'), 'RunPanel.svelte must use var(--p-bg-workspace, #2b2d30)');

  const problemsContent = fs.readFileSync(path.resolve(uiRoot, 'features/problems/ProblemsPanel.svelte'), 'utf-8');
  assert.ok(problemsContent.includes('var(--p-bg-surface, #26282b)'), 'ProblemsPanel.svelte must use var(--p-bg-surface, #26282b)');

  const toolchainsContent = fs.readFileSync(path.resolve(uiRoot, 'features/toolchain/ToolchainsPanel.svelte'), 'utf-8');
  assert.ok(toolchainsContent.includes('var(--p-bg-surface, #26282b)'), 'ToolchainsPanel.svelte must use var(--p-bg-surface, #26282b)');

  const mrViewContent = fs.readFileSync(path.resolve(uiRoot, 'features/mr/MrView.svelte'), 'utf-8');
  assert.ok(mrViewContent.includes('var(--p-bg-workspace, #2b2d30)'), 'MrView.svelte must use var(--p-bg-workspace, #2b2d30)');

  const testsPanelContent = fs.readFileSync(path.resolve(uiRoot, 'features/tests/TestsPanel.svelte'), 'utf-8');
  assert.ok(testsPanelContent.includes('var(--p-bg-surface, #26282b)'), 'TestsPanel.svelte must use var(--p-bg-surface, #26282b)');

  const mirrorPanelContent = fs.readFileSync(path.resolve(uiRoot, 'features/mirror/DeviceMirrorPanel.svelte'), 'utf-8');
  assert.ok(mirrorPanelContent.includes('var(--p-bg-surface, #26282b)'), 'DeviceMirrorPanel.svelte must use var(--p-bg-surface, #26282b)');

  const memoryViewContent = fs.readFileSync(path.resolve(uiRoot, 'features/agents/MemoryView.svelte'), 'utf-8');
  assert.ok(memoryViewContent.includes('var(--p-bg-surface, #26282b)'), 'MemoryView.svelte must use var(--p-bg-surface, #26282b)');
  assert.ok(memoryViewContent.includes('var(--p-bg-workspace, #2b2d30)'), 'MemoryView.svelte must use var(--p-bg-workspace, #2b2d30)');
});
