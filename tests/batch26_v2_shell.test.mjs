import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  MENU_CATEGORIES,
  isTitleBarInteractive,
} from '../ui/shell/titleBarLogic.ts';

import {
  getUnifiedStatusLetter,
} from '../ui/features/git/commitSelectionLogic.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const uiRoot = path.resolve(projectRoot, 'ui');

// =============================================================================
// Suite 1: 4-Layer Depth Tokens & Variant A / B in index.html
// =============================================================================
test('b26 UI 1: 4-layer depth tokens and .variant-a / .variant-b theme in index.html', () => {
  const indexPath = path.resolve(projectRoot, 'index.html');
  const indexHtml = fs.readFileSync(indexPath, 'utf-8');

  // Layer 0: Canvas Base (#0c0d10)
  assert.ok(indexHtml.includes('--p-bg-base: #0c0d10'));
  // Layer 1: Surface Panels (#121317)
  assert.ok(indexHtml.includes('--p-bg-surface: #121317'));
  // Layer 2: Work Surface (#15161b)
  assert.ok(indexHtml.includes('--p-bg-workspace: #15161b'));
  // Layer 3: Elevated / Popovers (#1c1e24)
  assert.ok(indexHtml.includes('--p-bg-elevated: #1c1e24'));
  // Hover & Active states
  assert.ok(indexHtml.includes('--p-bg-hover: #22242c'));
  assert.ok(indexHtml.includes('--p-bg-active: #2a2d36'));

  // Border refinement (anti jail-cell)
  assert.ok(indexHtml.includes('--border-default: #1e2027'));
  assert.ok(indexHtml.includes('--border-subtle: rgba(255, 255, 255, 0.06)'));
  assert.ok(indexHtml.includes('--border-focus: rgba(59, 130, 246, 0.5)'));

  // Variant A & B classes
  assert.ok(indexHtml.includes('body.variant-a'));
  assert.ok(indexHtml.includes('body.variant-b'));
  assert.ok(indexHtml.includes('<body class="variant-a">'));

  // Variant B tokens (Zed / Fleet Zen)
  assert.ok(indexHtml.includes('--p-bg-base: #0a0b0d'));
  assert.ok(indexHtml.includes('--p-bg-surface: #0f1013'));
  assert.ok(indexHtml.includes('--p-bg-workspace: #141518'));
  assert.ok(indexHtml.includes('--p-bg-elevated: #191a1e'));
  assert.ok(indexHtml.includes('rgba(255, 255, 255, 0.035)'));
});

// =============================================================================
// Suite 2: Elimination of M/U Text Badges in FileTree and CommitPanel
// =============================================================================
test('b26 UI 2: No M and U text badges in FileTree and CommitPanel', () => {
  const fileTreePath = path.resolve(uiRoot, 'shell/FileTree.svelte');
  const fileTreeCode = fs.readFileSync(fileTreePath, 'utf-8');

  // FileTree must not contain status-badge elements
  assert.doesNotMatch(fileTreeCode, /class="status-badge"/);
  assert.doesNotMatch(fileTreeCode, /<span[^>]*>[MU]<\/span>/);

  const commitPanelPath = path.resolve(uiRoot, 'features/git/CommitPanel.svelte');
  const commitPanelCode = fs.readFileSync(commitPanelPath, 'utf-8');

  // CommitPanel must have status-badge removed from file rows
  assert.doesNotMatch(commitPanelCode, /class="status-badge"/);
  // File name in CommitPanel is colored directly
  assert.ok(commitPanelCode.includes('class="file-name" style="color: {color};"'));
});

// =============================================================================
// Suite 3: Android Studio VCS Coloring for FileTree, CommitPanel, and Editor Tabs
// =============================================================================
test('b26 UI 3: Android Studio VCS text colors (clean, modified, untracked, ignored)', () => {
  // 1. CommitSelectionLogic colors
  const modEntry = {
    path: 'lib/main.dart',
    index: 'modified',
    worktree: 'modified',
    conflicted: false,
  };
  const untrackedEntry = {
    path: 'lib/new.dart',
    index: 'untracked',
    worktree: 'untracked',
    conflicted: false,
  };
  const addedEntry = {
    path: 'lib/added.dart',
    index: 'added',
    worktree: 'unmodified',
    conflicted: false,
  };
  const ignoredEntry = {
    path: '.env',
    index: 'ignored',
    worktree: 'ignored',
    conflicted: false,
  };
  const cleanEntry = {
    path: 'lib/clean.dart',
    index: 'unmodified',
    worktree: 'unmodified',
    conflicted: false,
  };

  assert.equal(getUnifiedStatusLetter(modEntry).color, '#58a6ff'); // Blue
  assert.equal(getUnifiedStatusLetter(untrackedEntry).color, '#4ade80'); // Green
  assert.equal(getUnifiedStatusLetter(addedEntry).color, '#4ade80'); // Green
  assert.equal(getUnifiedStatusLetter(ignoredEntry).color, '#606470'); // Dark gray
  assert.equal(getUnifiedStatusLetter(cleanEntry).color, '#d8d9dc'); // Soft white/gray

  // 2. FileTree.svelte uses Android Studio colors
  const fileTreePath = path.resolve(uiRoot, 'shell/FileTree.svelte');
  const fileTreeCode = fs.readFileSync(fileTreePath, 'utf-8');
  assert.ok(fileTreeCode.includes('#58a6ff'));
  assert.ok(fileTreeCode.includes('#4ade80'));
  assert.ok(fileTreeCode.includes('#606470'));
  assert.ok(fileTreeCode.includes('#d8d9dc'));
  assert.ok(fileTreeCode.includes('style="color: {gitColor};"'));

  // 3. Editor.svelte uses #58a6ff for modified/dirty tabs with round dot
  const editorPath = path.resolve(uiRoot, 'features/editor/Editor.svelte');
  const editorCode = fs.readFileSync(editorPath, 'utf-8');
  assert.ok(editorCode.includes('getTabColor('));
  assert.ok(editorCode.includes('#58a6ff'));
  assert.ok(editorCode.includes('border-radius: 50%'));
  assert.ok(editorCode.includes('class="tab-dot"'));
});

// =============================================================================
// Suite 4: 12-Category Menu Bar and TitleBar Cockpit
// =============================================================================
test('b26 UI 4: 12-Category Menu Bar structure and shortcuts in titleBarLogic', () => {
  assert.equal(MENU_CATEGORIES.length, 12);

  const expectedCategories = [
    'File',
    'Edit',
    'View',
    'Navigate',
    'Code',
    'Refactor',
    'Build',
    'Run',
    'Git',
    'Tools',
    'Window',
    'Help',
  ];

  const actualCategories = MENU_CATEGORIES.map((c) => c.label);
  assert.deepEqual(actualCategories, expectedCategories);

  // File menu
  const fileCat = MENU_CATEGORIES.find((c) => c.id === 'file');
  assert.ok(fileCat);
  assert.ok(fileCat.items.some((i) => i.label.includes('New Flutter Project') && i.shortcut === '⌘N'));
  assert.ok(fileCat.items.some((i) => i.label.includes('Open Folder') && i.shortcut === '⌘O'));
  assert.ok(fileCat.items.some((i) => i.label.includes('Save') && i.shortcut === '⌘S'));
  assert.ok(fileCat.items.some((i) => i.label.includes('Save All') && i.shortcut === '⌥⌘S'));
  assert.ok(fileCat.items.some((i) => i.label.includes('Exit') && i.shortcut === '⌘Q'));

  // Edit menu
  const editCat = MENU_CATEGORIES.find((c) => c.id === 'edit');
  assert.ok(editCat);
  assert.ok(editCat.items.some((i) => i.label === 'Undo' && i.shortcut === '⌘Z'));
  assert.ok(editCat.items.some((i) => i.label === 'Redo' && i.shortcut === '⇧⌘Z'));
  assert.ok(editCat.items.some((i) => i.label === 'Find in File' && i.shortcut === '⌘F'));
  assert.ok(editCat.items.some((i) => i.label === 'Replace' && i.shortcut === '⌘R'));
  assert.ok(editCat.items.some((i) => i.label === 'Search in Project' && i.shortcut === '⇧⌘F'));

  // View menu
  const viewCat = MENU_CATEGORIES.find((c) => c.id === 'view');
  assert.ok(viewCat);
  assert.ok(viewCat.items.some((i) => i.label === 'Toggle File Tree' && i.shortcut === '⌘B'));
  assert.ok(viewCat.items.some((i) => i.label === 'Toggle Terminal' && i.shortcut === '⌘J'));
  assert.ok(viewCat.items.some((i) => i.label === 'Toggle AI Agents' && i.shortcut === '⌘6'));
  assert.ok(viewCat.items.some((i) => i.label === 'Toggle Device Mirror' && i.shortcut === '⇧⌘D'));
  assert.ok(viewCat.items.some((i) => i.label === 'Full Screen' && i.shortcut === '⌃⌘F'));
  assert.ok(viewCat.items.some((i) => i.label === 'Zen Mode' && i.shortcut === '⌘K Z'));

  // Navigate menu
  const navCat = MENU_CATEGORIES.find((c) => c.id === 'navigate');
  assert.ok(navCat);
  assert.ok(navCat.items.some((i) => i.label === 'Go to File' && i.shortcut === '⌘P'));
  assert.ok(navCat.items.some((i) => i.label === 'Go to Symbol' && i.shortcut === '⌘⌥O'));
  assert.ok(navCat.items.some((i) => i.label === 'Go to Line' && i.shortcut === '⌘G'));
  assert.ok(navCat.items.some((i) => i.label === 'Next Problem' && i.shortcut === 'F2'));

  // Code menu
  const codeCat = MENU_CATEGORIES.find((c) => c.id === 'code');
  assert.ok(codeCat);
  assert.ok(codeCat.items.some((i) => i.label === 'Format Document' && i.shortcut === '⌥⇧F'));
  assert.ok(codeCat.items.some((i) => i.label === 'AI Inline Completion' && i.shortcut === 'Tab'));
  assert.ok(codeCat.items.some((i) => i.label === 'Organize Imports' && i.shortcut === '⌥⇧O'));
  assert.ok(codeCat.items.some((i) => i.label === 'Quick Fix' && i.shortcut === '⌘.'));

  // Refactor menu
  const refCat = MENU_CATEGORIES.find((c) => c.id === 'refactor');
  assert.ok(refCat);
  assert.ok(refCat.items.some((i) => i.label === 'Rename Symbol' && i.shortcut === '⇧F6'));
  assert.ok(refCat.items.some((i) => i.label === 'Extract Widget' && i.shortcut === '⌥⌘W'));
  assert.ok(refCat.items.some((i) => i.label === 'Extract Method' && i.shortcut === '⌥⌘M'));
  assert.ok(refCat.items.some((i) => i.label === 'Move File' && i.shortcut === 'F6'));

  // Build menu
  const buildCat = MENU_CATEGORIES.find((c) => c.id === 'build');
  assert.ok(buildCat);
  assert.ok(buildCat.items.some((i) => i.label === 'Flutter Build APK'));
  assert.ok(buildCat.items.some((i) => i.label === 'Flutter Build iOS'));
  assert.ok(buildCat.items.some((i) => i.label === 'Gradle Clean Build'));

  // Run menu
  const runCat = MENU_CATEGORIES.find((c) => c.id === 'run');
  assert.ok(runCat);
  assert.ok(runCat.items.some((i) => i.label === 'Start Debugging' && i.shortcut === 'F5'));
  assert.ok(runCat.items.some((i) => i.label === 'Run Without Debugging' && i.shortcut === '⌃F5'));
  assert.ok(runCat.items.some((i) => i.label === 'Flutter Hot Reload' && i.shortcut === '⌘\\'));
  assert.ok(runCat.items.some((i) => i.label === 'Flutter Hot Restart' && i.shortcut === '⇧⌘\\'));
  assert.ok(runCat.items.some((i) => i.label === 'Stop' && i.shortcut === '⇧F5'));

  // Git menu
  const gitCat = MENU_CATEGORIES.find((c) => c.id === 'git');
  assert.ok(gitCat);
  assert.ok(gitCat.items.some((i) => i.label === 'Commit' && i.shortcut === '⌘K'));
  assert.ok(gitCat.items.some((i) => i.label === 'Push' && i.shortcut === '⇧⌘K'));
  assert.ok(gitCat.items.some((i) => i.label === 'Pull/Update' && i.shortcut === '⌘T'));
  assert.ok(gitCat.items.some((i) => i.label === 'GitLab Merge Requests' && i.shortcut === '⌘5'));

  // Tools menu
  const toolsCat = MENU_CATEGORIES.find((c) => c.id === 'tools');
  assert.ok(toolsCat);
  assert.ok(toolsCat.items.some((i) => i.label === 'Toolchain Doctor'));
  assert.ok(toolsCat.items.some((i) => i.label === 'Kotlin Language Server Manager'));
  assert.ok(toolsCat.items.some((i) => i.label === 'Scrcpy Device Manager'));

  // Window menu
  const winCat = MENU_CATEGORIES.find((c) => c.id === 'window');
  assert.ok(winCat);
  assert.ok(winCat.items.some((i) => i.label === 'Minimize' && i.shortcut === '⌘M'));
  assert.ok(winCat.items.some((i) => i.label === 'Split Editor Right' && i.shortcut === '⌘\\'));

  // Help menu
  const helpCat = MENU_CATEGORIES.find((c) => c.id === 'help');
  assert.ok(helpCat);
  assert.ok(helpCat.items.some((i) => i.label === 'Documentation'));
  assert.ok(helpCat.items.some((i) => i.label === 'Keyboard Shortcuts Reference' && i.shortcut === '⌘K ⌘S'));
  assert.ok(helpCat.items.some((i) => i.label === 'About Petak'));
});

// =============================================================================
// Suite 5: Clean Cockpit TitleBar (38px) & Controls
// =============================================================================
test('b26 UI 5: Clean Cockpit TitleBar (38px) without in-window menu bar', () => {
  const titleBarPath = path.resolve(uiRoot, 'shell/TitleBar.svelte');
  const titleBarCode = fs.readFileSync(titleBarPath, 'utf-8');

  // In-window menu bar removed (now native macOS menu bar)
  assert.ok(!titleBarCode.includes('id="ide-menu-bar"'), 'In-window menu bar #ide-menu-bar must be removed');
  assert.ok(!titleBarCode.includes('class="menu-bar"'), 'Menu bar class must be removed');
  assert.ok(!titleBarCode.includes('class="menu-dropdown"'), 'Floating dropdowns must be removed');

  // Tauri menu-action event listener registered
  assert.ok(titleBarCode.includes('menu-action'), 'Must register listener for Tauri menu-action event');

  // Cockpit TitleBar exists with ID and controls
  assert.ok(titleBarCode.includes('id="ide-titlebar"'));
  assert.ok(titleBarCode.includes('height: 38px'));
  assert.ok(titleBarCode.includes('traffic-lights-spacer'));
  assert.ok(titleBarCode.includes('class="cockpit-center'));
  assert.ok(titleBarCode.includes('RunConfigPicker'));
  assert.ok(titleBarCode.includes('DevicePicker'));

  // Unified cockpit buttons
  assert.ok(titleBarCode.includes('run-btn'));
  assert.ok(titleBarCode.includes('debug-btn'));
  assert.ok(titleBarCode.includes('reload-btn'));
  assert.ok(titleBarCode.includes('restart-btn'));
  assert.ok(titleBarCode.includes('stop-btn'));

  // Search everywhere button with Shift Shift
  assert.ok(titleBarCode.includes('search-everywhere-btn'));
  assert.ok(titleBarCode.includes('Search everywhere'));
  assert.ok(titleBarCode.includes('⇧⇧'));

  // Right toggle buttons (Agents, Mirror, Settings)
  assert.ok(titleBarCode.includes('agents-toggle-btn'));
  assert.ok(titleBarCode.includes('mirror-toggle-btn'));
  assert.ok(titleBarCode.includes('settings-toggle-btn'));

  // Interactive exclusion tests
  function createMockNode(tagName, classList = [], role = null, parent = null) {
    const classes = new Set(classList);
    return {
      tagName: tagName.toUpperCase(),
      classList: {
        contains: (c) => classes.has(c),
      },
      getAttribute: (attr) => (attr === 'role' ? role : null),
      parentElement: parent,
    };
  }

  const titlebar = createMockNode('div', ['titlebar'], null, null);
  const cockpitBtn = createMockNode('button', ['cockpit-btn'], null, titlebar);
  assert.equal(isTitleBarInteractive(cockpitBtn), true);

  const searchEverywhere = createMockNode('button', ['search-everywhere-btn'], null, titlebar);
  assert.equal(isTitleBarInteractive(searchEverywhere), true);

  const agentsBtn = createMockNode('button', ['agents-toggle-btn'], null, titlebar);
  assert.equal(isTitleBarInteractive(agentsBtn), true);

  const mirrorBtn = createMockNode('button', ['mirror-toggle-btn'], null, titlebar);
  assert.equal(isTitleBarInteractive(mirrorBtn), true);

  const settingsBtn = createMockNode('button', ['settings-toggle-btn'], null, titlebar);
  assert.equal(isTitleBarInteractive(settingsBtn), true);
});
