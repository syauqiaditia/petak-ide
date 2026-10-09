import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  clampBottomPanelHeight,
  toggleMaximizeBottomPanel,
  MIN_BOTTOM_PANEL_HEIGHT,
  DEFAULT_BOTTOM_PANEL_HEIGHT,
} from '../ui/features/terminal/bottomPanelResize.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uiRoot = path.resolve(__dirname, '../ui');

test('b41: 1. clampBottomPanelHeight enforces min 140px, max 45% window height, default 260px', () => {
  assert.equal(MIN_BOTTOM_PANEL_HEIGHT, 140, 'MIN_BOTTOM_PANEL_HEIGHT must be 140');
  assert.equal(DEFAULT_BOTTOM_PANEL_HEIGHT, 260, 'DEFAULT_BOTTOM_PANEL_HEIGHT must be 260');

  const winHeight = 1000;
  // Below minimum
  assert.equal(clampBottomPanelHeight(50, winHeight), 140, 'Height below 140 must clamp to 140');
  assert.equal(clampBottomPanelHeight(-20, winHeight), 140, 'Negative height must clamp to 140');
  assert.equal(clampBottomPanelHeight(NaN, winHeight), 140, 'NaN must clamp to 140');

  // Normal range
  assert.equal(clampBottomPanelHeight(260, winHeight), 260, 'Normal 260 must stay 260');
  assert.equal(clampBottomPanelHeight(350, winHeight), 350, 'Normal 350 must stay 350');

  // Above maximum (45% of 1000 = 450)
  assert.equal(clampBottomPanelHeight(500, winHeight), 450, 'Height above 45% must clamp to 450');
  assert.equal(clampBottomPanelHeight(800, winHeight), 450, '800px on 1000px window must clamp to 450');
  assert.equal(clampBottomPanelHeight(1200, winHeight), 450, '1200px on 1000px window must clamp to 450');
});

test('b41: 2. toggleMaximizeBottomPanel toggles between 45% max and default/restored height', () => {
  const winHeight = 1000;
  const initialHeight = 260;

  // 1. Maximize toggle from default
  const maxRes = toggleMaximizeBottomPanel(initialHeight, 260, winHeight);
  assert.equal(maxRes.isMaximized, true, 'isMaximized must be true');
  assert.equal(maxRes.height, 450, 'Maximized height must be 45% of 1000 = 450');
  assert.equal(maxRes.nextRestoredHeight, 260, 'nextRestoredHeight must store 260');

  // 2. Restore toggle from maximized
  const restoreRes = toggleMaximizeBottomPanel(maxRes.height, maxRes.nextRestoredHeight, winHeight);
  assert.equal(restoreRes.isMaximized, false, 'isMaximized must be false');
  assert.equal(restoreRes.height, 260, 'Restored height must return to 260');

  // 3. Maximize and restore with custom height (e.g. 300)
  const customMax = toggleMaximizeBottomPanel(300, 300, winHeight);
  assert.equal(customMax.height, 450);
  assert.equal(customMax.nextRestoredHeight, 300);

  const customRestore = toggleMaximizeBottomPanel(customMax.height, customMax.nextRestoredHeight, winHeight);
  assert.equal(customRestore.height, 300);
});

test('b41: 3. TerminalPanel persists petak.bottomDockHeight and provides toggle maximize/restore button', () => {
  const terminalPanelCode = fs.readFileSync(path.join(uiRoot, 'features/terminal/TerminalPanel.svelte'), 'utf8');

  // Persistence check
  assert.ok(
    terminalPanelCode.includes("localStorage.getItem('petak.bottomDockHeight')"),
    'TerminalPanel must read petak.bottomDockHeight on mount'
  );
  assert.ok(
    terminalPanelCode.includes("localStorage.setItem('petak.bottomDockHeight', String(h))"),
    'TerminalPanel must write petak.bottomDockHeight on resize/maximize'
  );

  // Toggle maximize button check
  assert.ok(
    terminalPanelCode.includes('class="toggle-maximize-btn"'),
    'TerminalPanel header must include toggle-maximize-btn'
  );
  assert.ok(
    terminalPanelCode.includes('onclick={handleToggleMaximize}'),
    'toggle-maximize-btn must call handleToggleMaximize'
  );
});

test('b41/b42: 4. Editor.svelte completely eliminates global body tooltip hacks and protects context menus', () => {
  const editorCode = fs.readFileSync(path.join(uiRoot, 'features/editor/Editor.svelte'), 'utf8');

  // Selector must NOT match any body > div:not(#app)
  assert.ok(
    !editorCode.includes(':global(body > div:not(#app)'),
    'Editor.svelte must not contain :global(body > div:not(#app)) hacks'
  );

  // Exposes deactivateCenterDiff helper
  assert.ok(
    editorCode.includes('export function deactivateCenterDiff()'),
    'Editor.svelte must export deactivateCenterDiff()'
  );
});

test('b41: 5. BranchPanel.svelte styles .branch-context-menu opaque #1e1f22 with z-index 99999 and handles dismiss', () => {
  const branchPanelCode = fs.readFileSync(path.join(uiRoot, 'features/git/BranchPanel.svelte'), 'utf8');

  // Context menu styles
  assert.ok(
    branchPanelCode.includes('background: #1e1f22 !important;'),
    'branch-context-menu must have solid opaque background #1e1f22 !important'
  );
  assert.ok(
    branchPanelCode.includes('border: 1px solid #383a42 !important;'),
    'branch-context-menu must have border 1px solid #383a42 !important'
  );
  assert.ok(
    branchPanelCode.includes('border-radius: 6px !important;'),
    'branch-context-menu must have border-radius 6px !important'
  );
  assert.ok(
    branchPanelCode.includes('box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5) !important;') ||
      branchPanelCode.includes('box-shadow: 0 8px 24px rgba(0,0,0,0.5) !important;'),
    'branch-context-menu must have box-shadow !important'
  );
  assert.ok(
    branchPanelCode.includes('z-index: 99999 !important;'),
    'branch-context-menu must have z-index 99999 !important'
  );

  // Coordinates calculation with viewport bounds
  assert.ok(
    branchPanelCode.includes('Math.min(e.clientX, window.innerWidth - 220)') &&
      branchPanelCode.includes('Math.min(e.clientY, window.innerHeight - 200)'),
    'BranchPanel must clamp context menu coordinates within viewport bounds'
  );

  // Dismiss listeners
  assert.ok(
    branchPanelCode.includes('handleWindowKeyDown') &&
      branchPanelCode.includes("e.key === 'Escape'"),
    'BranchPanel must dismiss context menu on Escape key'
  );
  assert.ok(
    branchPanelCode.includes('handleWindowPointerDown') &&
      branchPanelCode.includes("!target.closest('.branch-context-menu')"),
    'BranchPanel must dismiss context menu on clicking outside'
  );
});

test('b41: 6. Editor vs Diff View transitions: reset isCenterDiffActive on file open / tab switch', () => {
  const appCode = fs.readFileSync(path.join(uiRoot, 'App.svelte'), 'utf8');
  const tabsCode = fs.readFileSync(path.join(uiRoot, 'features/editor/tabs.svelte.ts'), 'utf8');
  const editorCode = fs.readFileSync(path.join(uiRoot, 'features/editor/Editor.svelte'), 'utf8');

  // App.svelte handleOpenFile closes or deactivates diff
  assert.ok(
    appCode.includes('editorComponent?.deactivateCenterDiff()') ||
      appCode.includes('gitStore.closeCenterDiff()'),
    'App.svelte handleOpenFile must deactivate or close centerDiff'
  );

  // tabsManager increments openToken
  assert.ok(
    tabsCode.includes('this.openToken +='),
    'tabsManager must increment openToken on openTab and setActive'
  );

  // Editor.svelte listens to openToken and resets isCenterDiffActive
  assert.ok(
    editorCode.includes('tabsManager.openToken'),
    'Editor.svelte must track tabsManager.openToken'
  );
  assert.ok(
    editorCode.includes('isCenterDiffActive = false;'),
    'Editor.svelte must set isCenterDiffActive = false on token change or tab click'
  );
});

test('b41: 7. DiffView.svelte has prominent Jump to Source button and supports line navigation', () => {
  const diffViewCode = fs.readFileSync(path.join(uiRoot, 'features/git/DiffView.svelte'), 'utf8');

  // Prominent button
  assert.ok(
    diffViewCode.includes('class="jump-source-btn"'),
    'DiffView must render jump-source-btn'
  );
  assert.ok(
    diffViewCode.includes('.jump-source-btn {') && diffViewCode.includes('background: #2b2d30;'),
    'jump-source-btn must have solid prominent button styling'
  );
  assert.ok(
    diffViewCode.includes('✏️'),
    'jump-source-btn must include pencil icon ✏️'
  );

  // Line navigation support
  assert.ok(
    diffViewCode.includes('jumpToSource(line?: number)') ||
      diffViewCode.includes('jumpToSource(line?:') ||
      diffViewCode.includes('jumpToSource(line)'),
    'jumpToSource must accept line parameter'
  );
  assert.ok(
    diffViewCode.includes('__PETAK_GOTO_LINE__'),
    'jumpToSource must call __PETAK_GOTO_LINE__ for line navigation'
  );

  // Double-click to jump on diff lines
  assert.ok(
    diffViewCode.includes('ondblclick={() => jumpToSource('),
    'Diff rows must support double-click to jump to source at that line'
  );
});
