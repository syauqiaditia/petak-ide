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
const projectRoot = path.resolve(__dirname, '..');
const uiRoot = path.resolve(projectRoot, 'ui');

// =============================================================================
// Suite 1: Clean Body & No Tooltip Portal Hacks
// =============================================================================

test('b42 Ponytail 1: No tooltips({ parent: document.body }) across Editor.svelte, hover.ts, and completion.ts', () => {
  const editorCode = fs.readFileSync(path.resolve(uiRoot, 'features/editor/Editor.svelte'), 'utf-8');
  const hoverCode = fs.readFileSync(path.resolve(uiRoot, 'features/editor/lsp/hover.ts'), 'utf-8');
  const compCode = fs.readFileSync(path.resolve(uiRoot, 'features/editor/lsp/completion.ts'), 'utf-8');

  // Editor.svelte
  assert.ok(
    !editorCode.includes('parent: typeof document !== \'undefined\' ? document.body : undefined'),
    'Editor.svelte must not attach tooltips to document.body'
  );
  assert.ok(
    !editorCode.includes('tooltips({'),
    'Editor.svelte must not configure redundant tooltips() extension'
  );

  // hover.ts
  assert.ok(
    !hoverCode.includes('tooltips({'),
    'hover.ts must not configure tooltips() extension'
  );
  assert.ok(
    !hoverCode.includes('document.body'),
    'hover.ts must not reference document.body'
  );

  // completion.ts
  assert.ok(
    !compCode.includes('tooltips({'),
    'completion.ts must not configure tooltips() extension'
  );
  assert.ok(
    !compCode.includes('document.body'),
    'completion.ts must not reference document.body'
  );
});

test('b42 Ponytail 2: No body > div:not(#app) rules in index.html and Editor.svelte', () => {
  const indexCode = fs.readFileSync(path.resolve(projectRoot, 'index.html'), 'utf-8');
  const editorCode = fs.readFileSync(path.resolve(uiRoot, 'features/editor/Editor.svelte'), 'utf-8');

  assert.ok(
    !indexCode.includes('body > div:not(#app)'),
    'index.html must not contain body > div:not(#app) hack rules'
  );
  assert.ok(
    !editorCode.includes('body > div:not(#app)'),
    'Editor.svelte must not contain body > div:not(#app) hack rules'
  );
});

test('b42 Ponytail 3: .editor-container and .cm-editor have overflow: visible to prevent clipping', () => {
  const editorCode = fs.readFileSync(path.resolve(uiRoot, 'features/editor/Editor.svelte'), 'utf-8');

  assert.ok(
    editorCode.includes('.editor-container {') &&
      editorCode.includes('position: relative;') &&
      editorCode.includes('overflow: visible;'),
    '.editor-container must have position: relative and overflow: visible'
  );

  assert.ok(
    editorCode.includes(':global(.editor-container .cm-editor) {') &&
      editorCode.includes('overflow: visible;'),
    ':global(.editor-container .cm-editor) must have overflow: visible'
  );
});

// =============================================================================
// Suite 2: Simplified hover.ts (Native CodeMirror 6 hoverTooltip)
// =============================================================================

test('b42 Ponytail 4: hover.ts uses native CodeMirror 6 hoverTooltip without custom math hacks', () => {
  const hoverCode = fs.readFileSync(path.resolve(uiRoot, 'features/editor/lsp/hover.ts'), 'utf-8');

  // Uses hoverTooltip and returns standard Tooltip object with create()
  assert.ok(
    hoverCode.includes('hoverTooltip('),
    'hover.ts must use hoverTooltip'
  );
  assert.ok(
    hoverCode.includes('create() {') &&
      hoverCode.includes('dom.className = \'cm-lsp-hover-tooltip\';') &&
      hoverCode.includes('return { dom };'),
    'hover.ts must return native CodeMirror create() tooltip DOM element'
  );

  // No computeAdaptiveHoverCoords or hoverMemoryCache
  assert.ok(
    !hoverCode.includes('computeAdaptiveHoverCoords'),
    'hover.ts must not use computeAdaptiveHoverCoords'
  );
  assert.ok(
    !hoverCode.includes('hoverMemoryCache'),
    'hover.ts must not use fragile in-memory cache'
  );
  assert.ok(
    !hoverCode.includes('adjustPosition'),
    'hover.ts must not micro-manage coordinates via adjustPosition'
  );

  // Calls flushPending before api.lsp.hover
  assert.ok(
    hoverCode.includes('await flushPending(path);') &&
      hoverCode.includes('await api.lsp.hover('),
    'hover.ts must flush pending changes before query'
  );

  // Suppresses hover when autocomplete is active
  assert.ok(
    hoverCode.includes('currentCompletions(view.state).length > 0'),
    'hover.ts must suppress hover when currentCompletions > 0'
  );

  // CSS theme styles
  assert.ok(
    hoverCode.includes("backgroundColor: '#1e1f22 !important'") &&
      hoverCode.includes("border: '1px solid #383a42 !important'") &&
      hoverCode.includes("borderRadius: '6px !important'") &&
      hoverCode.includes("boxShadow: '0 8px 24px rgba(0,0,0,0.5) !important'") &&
      hoverCode.includes("zIndex: '9999 !important'") &&
      hoverCode.includes("maxWidth: '500px !important'") &&
      hoverCode.includes("maxHeight: '260px !important'"),
    'hover.ts must style tooltip with solid #1e1f22, border #383a42, radius 6px, shadow, z-index 9999, max-width 500px, max-height 260px'
  );
});

// =============================================================================
// Suite 3: Simplified completion.ts (Native CodeMirror 6 autocompletion)
// =============================================================================

test('b42 Ponytail 5: completion.ts uses clean unified completion source without timer races', () => {
  const compCode = fs.readFileSync(path.resolve(uiRoot, 'features/editor/lsp/completion.ts'), 'utf-8');

  // Matches word before cursor
  assert.ok(
    compCode.includes('context.matchBefore(/[\\w$]+/)'),
    'completion.ts must match identifier prefix before cursor'
  );

  // No timer races or Promise.race
  assert.ok(
    !compCode.includes('Promise.race'),
    'completion.ts must not use Promise.race timeouts'
  );
  assert.ok(
    !compCode.includes('timeoutPromise'),
    'completion.ts must not create timeoutPromise'
  );
  assert.ok(
    !compCode.includes('docAborted'),
    'completion.ts must not have tangled docAborted state'
  );

  // Combines snippets, keywords, and lsp options cleanly
  assert.ok(
    compCode.includes('[...filteredSnippets, ...filteredKeywords, ...lspOptions]'),
    'completion.ts must combine filteredSnippets, filteredKeywords, and lspOptions'
  );

  // Valid for identifier regex
  assert.ok(
    compCode.includes('validFor: /^[\\w$]*$/'),
    'completion.ts must specify validFor: /^[\\w$]*$/'
  );

  // Styling
  assert.ok(
    compCode.includes("backgroundColor: '#22242a !important'") &&
      compCode.includes("border: '1px solid #34363d !important'") &&
      compCode.includes("borderRadius: '8px !important'") &&
      compCode.includes("zIndex: '9999 !important'"),
    'completion.ts must style autocomplete tooltip with #22242a, border #34363d, radius 8px, z-index 9999'
  );
});

// =============================================================================
// Suite 4: Branch Context Menu in BranchPanel.svelte
// =============================================================================

test('b42 Ponytail 6: BranchPanel context menu styles and coordinates', () => {
  const branchPanelCode = fs.readFileSync(path.resolve(uiRoot, 'features/git/BranchPanel.svelte'), 'utf-8');

  assert.ok(
    branchPanelCode.includes('class="branch-context-menu"') &&
      branchPanelCode.includes('use:portal') &&
      branchPanelCode.includes('style="top: {branchContextMenuPos.y}px; left: {branchContextMenuPos.x}px;"'),
    'BranchPanel.svelte must position branch context menu with top and left coords and use:portal'
  );

  assert.ok(
    branchPanelCode.includes('background: #1e1f22 !important;') &&
      branchPanelCode.includes('border: 1px solid #383a42 !important;') &&
      branchPanelCode.includes('box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5) !important;') &&
      branchPanelCode.includes('z-index: 99999 !important;'),
    'BranchPanel.svelte must style context menu with background #1e1f22, border #383a42, shadow, and z-index 99999'
  );

  assert.ok(
    branchPanelCode.includes('handleWindowKeyDown') &&
      branchPanelCode.includes("e.key === 'Escape'") &&
      branchPanelCode.includes('handleWindowPointerDown') &&
      branchPanelCode.includes("!target.closest('.branch-context-menu')"),
    'BranchPanel.svelte must dismiss context menu on Escape and click outside'
  );
});

// =============================================================================
// Suite 5: Bottom Dock Height Clamp & Toggle Maximize
// =============================================================================

test('b42 Ponytail 7: bottomPanelResize enforces height clamp and toggle maximize', () => {
  assert.equal(MIN_BOTTOM_PANEL_HEIGHT, 140);
  assert.equal(DEFAULT_BOTTOM_PANEL_HEIGHT, 260);

  const winHeight = 1000;
  // min clamp
  assert.equal(clampBottomPanelHeight(100, winHeight), 140);
  // max clamp (45% of 1000 = 450)
  assert.equal(clampBottomPanelHeight(600, winHeight), 450);

  // toggle maximize
  const maxRes = toggleMaximizeBottomPanel(260, 260, winHeight);
  assert.equal(maxRes.isMaximized, true);
  assert.equal(maxRes.height, 450);

  // toggle restore
  const restoreRes = toggleMaximizeBottomPanel(maxRes.height, maxRes.nextRestoredHeight, winHeight);
  assert.equal(restoreRes.isMaximized, false);
  assert.equal(restoreRes.height, 260);
});
