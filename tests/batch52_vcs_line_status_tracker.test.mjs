import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Mock Svelte runes for Node test environment
globalThis.$state = (v) => v;
globalThis.$derived = (fn) => (typeof fn === 'function' ? fn() : fn);
globalThis.$effect = () => {};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const uiRoot = path.resolve(projectRoot, 'ui');

// =============================================================================
// Suite 1: computeVcsHunks Line Diff Algorithm
// =============================================================================

test('b52 VCS Tracker: computeVcsHunks detects added, modified, deleted hunks with original code', async () => {
  const { computeVcsHunks } = await import('../ui/features/editor/vcsGutter.ts');

  // 1. Identical text -> 0 hunks
  const identical = computeVcsHunks('line 1\nline 2', 'line 1\nline 2');
  assert.equal(identical.length, 0);

  // 2. Added hunk
  const added = computeVcsHunks('alpha\ngamma', 'alpha\nbeta\ngamma');
  assert.equal(added.length, 1);
  assert.equal(added[0].kind, 'added');
  assert.equal(added[0].startNewLine, 2);
  assert.equal(added[0].endNewLine, 2);
  assert.equal(added[0].origCode, '');
  assert.equal(added[0].currCode, 'beta');

  // 3. Modified hunk
  const modified = computeVcsHunks('final int point;', 'final String point;');
  assert.equal(modified.length, 1);
  assert.equal(modified[0].kind, 'modified');
  assert.equal(modified[0].startNewLine, 1);
  assert.equal(modified[0].origCode, 'final int point;');
  assert.equal(modified[0].currCode, 'final String point;');

  // 4. Deleted hunk
  const deleted = computeVcsHunks('alpha\nbeta\ngamma', 'alpha\ngamma');
  assert.equal(deleted.length, 1);
  assert.equal(deleted[0].kind, 'deleted');
  assert.equal(deleted[0].startNewLine, 2);
  assert.equal(deleted[0].origCode, 'beta');
  assert.equal(deleted[0].currCode, '');
});

// =============================================================================
// Suite 2: rollbackHunk Logic
// =============================================================================

test('b52 VCS Tracker: rollbackHunk reverts modified, added, and deleted hunks', async () => {
  const { rollbackHunk } = await import('../ui/features/editor/vcsTracker.svelte.ts');
  const { EditorState } = await import('@codemirror/state');

  // Helper mock EditorView with state
  function createMockView(docText) {
    let state = EditorState.create({ doc: docText });
    return {
      get state() {
        return state;
      },
      dispatch(tr) {
        if (tr.changes) {
          state = state.update({ changes: tr.changes, selection: tr.selection }).state;
        }
      },
      focus() {},
    };
  }

  // 1. Rollback modified
  const view1 = createMockView('line 1\nline 2 MOD\nline 3');
  const modHunk = {
    id: 1,
    kind: 'modified',
    startNewLine: 2,
    endNewLine: 2,
    startOldLine: 2,
    endOldLine: 2,
    origCode: 'line 2 ORIG',
    currCode: 'line 2 MOD',
    lines: [2],
  };
  rollbackHunk(view1, modHunk);
  assert.equal(view1.state.doc.toString(), 'line 1\nline 2 ORIG\nline 3');

  // 2. Rollback added
  const view2 = createMockView('line 1\nline 2 ADDED\nline 3');
  const addHunk = {
    id: 2,
    kind: 'added',
    startNewLine: 2,
    endNewLine: 2,
    startOldLine: 1,
    endOldLine: 1,
    origCode: '',
    currCode: 'line 2 ADDED',
    lines: [2],
  };
  rollbackHunk(view2, addHunk);
  assert.equal(view2.state.doc.toString(), 'line 1\nline 3');

  // 3. Rollback deleted
  const view3 = createMockView('line 1\nline 3');
  const delHunk = {
    id: 3,
    kind: 'deleted',
    startNewLine: 2,
    endNewLine: 2,
    startOldLine: 2,
    endOldLine: 2,
    origCode: 'line 2 RESTORED',
    currCode: '',
    lines: [2],
  };
  rollbackHunk(view3, delHunk);
  assert.equal(view3.state.doc.toString(), 'line 1\nline 2 RESTORED\nline 3');
});

// =============================================================================
// Suite 3: VcsDiffPopup Component Structure
// =============================================================================

test('b52 VCS Tracker: VcsDiffPopup component exists with required controls and shortcuts', () => {
  const popupPath = path.resolve(uiRoot, 'features/editor/VcsDiffPopup.svelte');
  assert.ok(fs.existsSync(popupPath), 'VcsDiffPopup.svelte must exist');

  const content = fs.readFileSync(popupPath, 'utf-8');
  assert.ok(content.includes('rollback-btn') || content.includes('handleRollback'), 'Must include rollback action');
  assert.ok(content.includes('handlePrev') && content.includes('handleNext'), 'Must include prev/next buttons');
  assert.ok(content.includes('vcsTrackerStore'), 'Must bind to vcsTrackerStore');
  assert.ok(content.includes('Escape'), 'Must support Escape key to close');
});
