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
// Suite 1: VCS Gutter LCS Line Changes Algorithm
// =============================================================================

test('b49 VCS Gutter: computeVcsLineChanges LCS line diff logic', async () => {
  const { computeVcsLineChanges } = await import('../ui/features/editor/vcsGutter.ts');

  // 1. Identical text returns empty Map
  const unchanged = computeVcsLineChanges('line 1\nline 2', 'line 1\nline 2');
  assert.equal(unchanged.size, 0, 'Identical text must return empty map');

  // 2. Empty original -> all lines added
  const fromEmpty = computeVcsLineChanges('', 'line 1\nline 2\nline 3');
  assert.equal(fromEmpty.size, 3);
  assert.equal(fromEmpty.get(1), 'added');
  assert.equal(fromEmpty.get(2), 'added');
  assert.equal(fromEmpty.get(3), 'added');

  // 3. Empty current -> line 1 deleted
  const toEmpty = computeVcsLineChanges('line 1\nline 2', '');
  assert.equal(toEmpty.size, 1);
  assert.equal(toEmpty.get(1), 'deleted');

  // 4. Insert 1 line at top does NOT shift lines below into modified
  const orig = 'alpha\nbeta\ngamma';
  const insertedTop = 'top\nalpha\nbeta\ngamma';
  const topChanges = computeVcsLineChanges(orig, insertedTop);
  assert.equal(topChanges.size, 1, 'Only inserted line should be marked');
  assert.equal(topChanges.get(1), 'added', 'Line 1 must be marked added');
  assert.equal(topChanges.has(2), false, 'Line 2 must not be modified');
  assert.equal(topChanges.has(3), false, 'Line 3 must not be modified');
  assert.equal(topChanges.has(4), false, 'Line 4 must not be modified');

  // 5. Replace single line in middle
  const modMiddle = 'alpha\nbeta_mod\ngamma';
  const modChanges = computeVcsLineChanges(orig, modMiddle);
  assert.equal(modChanges.size, 1);
  assert.equal(modChanges.get(2), 'modified');

  // 6. Delete line in middle
  const delMiddle = 'alpha\ngamma';
  const delChanges = computeVcsLineChanges(orig, delMiddle);
  assert.equal(delChanges.size, 1);
  assert.equal(delChanges.get(2), 'deleted');

  // 7. Replacement with more lines (paired = modified, extra = added)
  const replaceAndExpand = 'alpha\nbeta1\nbeta2\ngamma';
  const expChanges = computeVcsLineChanges(orig, replaceAndExpand);
  assert.equal(expChanges.get(2), 'modified', 'First replaced line is modified');
  assert.equal(expChanges.get(3), 'added', 'Extra line is added');
  assert.equal(expChanges.has(4), false, 'Gamma line is unchanged');
});

// =============================================================================
// Suite 2: Editor VCS Gutter CSS & DOM rules
// =============================================================================

test('b49 Editor: VCS Gutter styles and gutterElement zero padding', () => {
  const editorCode = fs.readFileSync(path.resolve(uiRoot, 'features/editor/Editor.svelte'), 'utf-8');

  assert.ok(
    editorCode.includes(':global(.cm-vcs-gutter) {') &&
      editorCode.includes('width: 6px !important;') &&
      editorCode.includes('min-width: 6px !important;'),
    'Editor must style .cm-vcs-gutter with 6px width'
  );

  assert.ok(
    editorCode.includes(':global(.cm-vcs-gutter .cm-gutterElement) {') &&
      editorCode.includes('padding: 0 !important;') &&
      editorCode.includes('width: 6px !important;'),
    'Editor must override .cm-gutterElement padding to 0 and width to 6px'
  );

  assert.ok(
    editorCode.includes('background-color: #4ade80 !important;') &&
      editorCode.includes('background-color: #3882f6 !important;') &&
      editorCode.includes('background-color: #f07a74 !important;'),
    'Editor must style added (#4ade80), modified (#3882f6), and deleted (#f07a74) markers'
  );
});

// =============================================================================
// Suite 3: TabItem gitHeadContent & Editor refreshTabVcsBase
// =============================================================================

test('b49 Editor & Tabs: gitHeadContent baseline comparison against HEAD', () => {
  const tabsCode = fs.readFileSync(path.resolve(uiRoot, 'features/editor/tabs.svelte.ts'), 'utf-8');
  assert.ok(
    tabsCode.includes('gitHeadContent?: string | null;'),
    'TabItem interface must declare optional gitHeadContent'
  );

  const editorCode = fs.readFileSync(path.resolve(uiRoot, 'features/editor/Editor.svelte'), 'utf-8');
  assert.ok(
    editorCode.includes('async function refreshTabVcsBase(tab: TabItem'),
    'Editor must define refreshTabVcsBase helper'
  );
  assert.ok(
    editorCode.includes('api.gitFileAtRef(folderPath, \'HEAD\', rel)'),
    'refreshTabVcsBase must query api.gitFileAtRef with HEAD'
  );
  assert.ok(
    editorCode.includes('const baseText = active.gitHeadContent ?? active.savedContent;'),
    'Editor must use gitHeadContent as priority baseline for computeVcsLineChanges'
  );
});
