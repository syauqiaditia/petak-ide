import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  parseMergedIntoHunks,
  checkIsIdentical,
  cloneHunks,
  getResultLines,
  computeMergedText,
  resolveHunkSide,
  acceptAllSide,
  applyAllIdentical,
  autoResolveTrivialBlocks,
  createSyncScrollCoordinator,
  createConflictResultEditor,
  getConflictEditorExtensions,
} from '../ui/features/git/conflictResolverLogic.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const uiRoot = path.resolve(projectRoot, 'ui');

// =============================================================================
// Suite 1: Parsing & Hunk Extraction
// =============================================================================

test('b51 Conflict Resolver 1: parseMergedIntoHunks correctly parses clean and conflict blocks', () => {
  const mergedText = [
    'function hello() {',
    '<<<<<<< HEAD',
    '  console.log("Yours version");',
    '||||||| base',
    '  console.log("Original base");',
    '=======',
    '  console.log("Theirs version");',
    '>>>>>>> feature',
    '  return true;',
    '}',
  ].join('\n');

  const hunks = parseMergedIntoHunks(mergedText);
  assert.equal(hunks.length, 3, 'Should have 3 hunks: clean, conflict, clean');

  // Hunk 0: Clean
  assert.equal(hunks[0].kind, 'clean');
  assert.deepEqual(hunks[0].cleanLines, ['function hello() {']);

  // Hunk 1: Conflict with base ancestor
  assert.equal(hunks[1].kind, 'conflict');
  assert.equal(hunks[1].isIdentical, false);
  assert.deepEqual(hunks[1].oursLines, ['  console.log("Yours version");']);
  assert.deepEqual(hunks[1].baseLines, ['  console.log("Original base");']);
  assert.deepEqual(hunks[1].theirsLines, ['  console.log("Theirs version");']);

  // Hunk 2: Clean
  assert.equal(hunks[2].kind, 'clean');
  assert.deepEqual(hunks[2].cleanLines, ['  return true;', '}']);
});

test('b51 Conflict Resolver 1b: handles identical conflict additions as auto-marked identical', () => {
  const mergedText = [
    '<<<<<<< HEAD',
    '  const value = 42;',
    '=======',
    '  const value = 42;',
    '>>>>>>> target',
  ].join('\n');

  const hunks = parseMergedIntoHunks(mergedText);
  assert.equal(hunks.length, 1);
  assert.equal(hunks[0].kind, 'conflict');
  assert.equal(hunks[0].isIdentical, true, 'Identical additions should have isIdentical = true');
  assert.equal(hunks[0].acceptedSides.ours, true, 'Identical additions automatically accept ours');
});

// =============================================================================
// Suite 2: Block Resolution Logic (ours, theirs, both, none, bulk)
// =============================================================================

test('b51 Conflict Resolver 2: resolveHunkSide handles ours (>>), theirs (<<), both, and discard', () => {
  const mergedText = [
    '<<<<<<< HEAD',
    'alpha',
    '=======',
    'beta',
    '>>>>>>> branch',
  ].join('\n');

  const initial = parseMergedIntoHunks(mergedText);
  assert.equal(initial[0].acceptedSides.ours, false);
  assert.equal(initial[0].acceptedSides.theirs, false);

  // Toggle Accept Left (Yours) -> >>
  const afterOurs = resolveHunkSide(initial, 0, 'ours');
  assert.equal(afterOurs[0].acceptedSides.ours, true);
  assert.equal(afterOurs[0].acceptedSides.theirs, false);
  assert.deepEqual(getResultLines(afterOurs[0]), ['alpha']);

  // Toggle Accept Right (Theirs) as well -> Both included
  const afterBoth = resolveHunkSide(afterOurs, 0, 'theirs');
  assert.equal(afterBoth[0].acceptedSides.ours, true);
  assert.equal(afterBoth[0].acceptedSides.theirs, true);
  assert.deepEqual(getResultLines(afterBoth[0]), ['alpha', 'beta']);

  // Discard all -> None
  const afterNone = resolveHunkSide(afterBoth, 0, 'none');
  assert.equal(afterNone[0].acceptedSides.ours, false);
  assert.equal(afterNone[0].acceptedSides.theirs, false);
  assert.deepEqual(getResultLines(afterNone[0]), []);
});

test('b51 Conflict Resolver 2b: computeMergedText aggregates all hunks cleanly', () => {
  const mergedText = [
    'header',
    '<<<<<<< HEAD',
    'left_line',
    '=======',
    'right_line',
    '>>>>>>> target',
    'footer',
  ].join('\n');

  const hunks = parseMergedIntoHunks(mergedText);
  const resolved = resolveHunkSide(hunks, 1, 'ours');
  const fullText = computeMergedText(resolved);

  assert.equal(fullText, 'header\nleft_line\nfooter');
});

test('b51 Conflict Resolver 2c: acceptAllSide accepts all left or right across all conflicts', () => {
  const mergedText = [
    '<<<<<<< HEAD',
    'one_left',
    '=======',
    'one_right',
    '>>>>>>> target',
    'middle',
    '<<<<<<< HEAD',
    'two_left',
    '=======',
    'two_right',
    '>>>>>>> target',
  ].join('\n');

  const hunks = parseMergedIntoHunks(mergedText);

  // Bulk Accept Left
  const allLeft = acceptAllSide(hunks, 'ours');
  assert.equal(computeMergedText(allLeft), 'one_left\nmiddle\ntwo_left');

  // Bulk Accept Right
  const allRight = acceptAllSide(hunks, 'theirs');
  assert.equal(computeMergedText(allRight), 'one_right\nmiddle\ntwo_right');
});

// =============================================================================
// Suite 3: Auto-Resolve Trivial Blocks (Magic Wand)
// =============================================================================

test('b51 Conflict Resolver 3: autoResolveTrivialBlocks resolves identical and base-matching blocks', () => {
  const mergedText = [
    '// Block 1: Ours unchanged from base (Theirs modified)',
    '<<<<<<< HEAD',
    'const baseVal = 0;',
    '||||||| base',
    'const baseVal = 0;',
    '=======',
    'const baseVal = 99;',
    '>>>>>>> branch',
    '// Block 2: Theirs unchanged from base (Ours modified)',
    '<<<<<<< HEAD',
    'const user = "alice";',
    '||||||| base',
    'const user = "anon";',
    '=======',
    'const user = "anon";',
    '>>>>>>> branch',
    '// Block 3: Non-overlapping addition on Ours only',
    '<<<<<<< HEAD',
    'const extraParam = true;',
    '=======',
    '>>>>>>> branch',
    '// Block 4: Truly conflicting (both diverged)',
    '<<<<<<< HEAD',
    'const color = "red";',
    '||||||| base',
    'const color = "grey";',
    '=======',
    'const color = "blue";',
    '>>>>>>> branch',
  ].join('\n');

  const hunks = parseMergedIntoHunks(mergedText);
  assert.equal(hunks.filter((h) => h.kind === 'conflict').length, 4);

  const { hunks: resolvedHunks, resolvedCount } = autoResolveTrivialBlocks(hunks);

  // Block 1: ours == base -> resolved to theirs ("const baseVal = 99;")
  // Block 2: theirs == base -> resolved to ours ("const user = "alice";")
  // Block 3: non-overlapping addition on ours -> resolved to ours
  // Block 4: diverged -> remains unresolved
  assert.equal(resolvedCount, 3, `Expected 3 auto-resolved trivial blocks, got ${resolvedCount}`);

  const block1 = resolvedHunks.find((h) => h.id === 1);
  assert.equal(block1.acceptedSides.theirs, true);
  assert.equal(block1.acceptedSides.ours, false);

  const block2 = resolvedHunks.find((h) => h.id === 3);
  assert.equal(block2.acceptedSides.ours, true);
  assert.equal(block2.acceptedSides.theirs, false);

  const block3 = resolvedHunks.find((h) => h.id === 5);
  assert.equal(block3.acceptedSides.ours, true);
  assert.equal(block3.acceptedSides.theirs, false);

  const block4 = resolvedHunks.find((h) => h.id === 7);
  assert.equal(block4.acceptedSides.ours, false);
  assert.equal(block4.acceptedSides.theirs, false);
});

// =============================================================================
// Suite 4: Synchronized Scrolling Coordinator (Continuous 3-Column Sync)
// =============================================================================

test('b51 Conflict Resolver 4: createSyncScrollCoordinator synchronizes 3 columns without recursive loop', () => {
  // Mock 3 panel elements
  const leftPanel = {
    scrollTop: 0,
    scrollHeight: 1000,
    clientHeight: 200,
  };
  const centerPanel = {
    scrollTop: 0,
    scrollHeight: 2000,
    clientHeight: 400,
  };
  const rightPanel = {
    scrollTop: 0,
    scrollHeight: 1000,
    clientHeight: 200,
  };

  const coordinator = createSyncScrollCoordinator(() => ({
    left: leftPanel,
    center: centerPanel,
    right: rightPanel,
  }));

  // 1. Scroll Left by 400px (50% of 800px max)
  leftPanel.scrollTop = 400;
  coordinator.sync('left');

  // Verify proportional sync to center (50% of 1600px max = 800px) and right (400px)
  assert.equal(centerPanel.scrollTop, 800, 'Center panel should be synchronized to 800px');
  assert.equal(rightPanel.scrollTop, 400, 'Right panel should be synchronized to 400px');
  assert.equal(coordinator.isSyncing(), true, 'isSyncing flag should be active to block loops');

  // 2. While syncing, another event must be safely ignored (no infinite recursion loop)
  rightPanel.scrollTop = 999;
  coordinator.sync('right');
  assert.equal(centerPanel.scrollTop, 800, 'Center panel must NOT be overwritten while isSyncing is true');

  // 3. Reset lock and scroll from Center
  coordinator.reset();
  assert.equal(coordinator.isSyncing(), false);

  centerPanel.scrollTop = 400; // 25% of 1600px max
  coordinator.sync('center');

  // 25% of 800px max = 200px
  assert.equal(leftPanel.scrollTop, 200, 'Left panel should sync to 200px');
  assert.equal(rightPanel.scrollTop, 200, 'Right panel should sync to 200px');
});

// =============================================================================
// Suite 5: CodeMirror 6 Result Editor Lifecycle & Theme Contracts
// =============================================================================

test('b51 Conflict Resolver 5: createConflictResultEditor mounts with required extensions and theme', () => {
  // Mock container DOM element
  const container = {
    appendChild: () => {},
    removeChild: () => {},
  };

  let capturedDoc = '';
  const editor = createConflictResultEditor(
    container,
    '// Initial Result Content',
    {
      onDocChange: (doc) => {
        capturedDoc = doc;
      },
    }
  );

  assert.ok(editor, 'EditorView instance must be created');
  assert.equal(editor.state.doc.toString(), '// Initial Result Content');

  // Dispatch a change
  editor.dispatch({
    changes: { from: 0, to: editor.state.doc.length, insert: '// Updated by Action' },
  });

  assert.equal(editor.state.doc.toString(), '// Updated by Action');
  assert.equal(capturedDoc, '// Updated by Action', 'onDocChange callback must receive updated text');

  // Verify destroy lifecycle cleans up
  assert.doesNotThrow(() => {
    editor.destroy();
  }, 'destroy() must execute cleanly without error');

  // Verify extension bundle includes all required extensions
  const extensions = getConflictEditorExtensions();
  assert.ok(extensions.length >= 6, 'Must include standard CodeMirror extensions and Slate Grey theme');
});

// =============================================================================
// Suite 6: Slate Grey Theme & Parity Styling Verification
// =============================================================================

test('b51 Conflict Resolver 6: ThreeWayMergeModal and ConflictView strictly adhere to Slate Grey tokens and zero pitch black', () => {
  const modalPath = path.resolve(uiRoot, 'features/git/ThreeWayMergeModal.svelte');
  const conflictViewPath = path.resolve(uiRoot, 'features/git/ConflictView.svelte');

  const modalCode = fs.readFileSync(modalPath, 'utf-8');
  const viewCode = fs.readFileSync(conflictViewPath, 'utf-8');

  // Check required tokens in modal
  assert.ok(modalCode.includes('var(--p-bg-workspace, #2b2d30)'), 'Modal must use --p-bg-workspace');
  assert.ok(modalCode.includes('var(--p-bg-surface, #26282b)'), 'Modal must use --p-bg-surface');
  assert.ok(modalCode.includes('var(--border-default, #393b40)'), 'Modal must use --border-default');

  // Check gutter action arrows and magic wand in modal markup
  assert.ok(modalCode.includes('accept-left'), 'Modal must define accept-left action');
  assert.ok(modalCode.includes('accept-right'), 'Modal must define accept-right action');
  assert.ok(modalCode.includes('>>'), 'Modal must show visual >> arrow');
  assert.ok(modalCode.includes('<<'), 'Modal must show visual << arrow');
  assert.ok(modalCode.includes('Auto-resolve non-conflicting'), 'Modal must have Magic Wand auto-resolve button');

  // Check CodeMirror integration in modal
  assert.ok(modalCode.includes('createConflictResultEditor'), 'Modal must instantiate CodeMirror Result editor');
  assert.ok(modalCode.includes('editorView.destroy()'), 'Modal must destroy editorView on unmount');

  // Check scroll coordinator in modal
  assert.ok(modalCode.includes('createSyncScrollCoordinator'), 'Modal must use scroll coordinator');
  assert.ok(modalCode.includes("scrollCoordinator.sync('left')"), 'Modal must sync from left column');
  assert.ok(modalCode.includes("scrollCoordinator.sync('right')"), 'Modal must sync from right column');

  // Strict check: No hardcoded pitch black hex (#0c0d10, #08090d, #000000, #000, #111215, #141518)
  const forbiddenHex = ['#0c0d10', '#08090d', '#000000', '#111215', '#141518'];
  for (const hex of forbiddenHex) {
    assert.ok(!modalCode.includes(hex), `ThreeWayMergeModal.svelte must not contain ${hex}`);
    assert.ok(!viewCode.includes(hex), `ConflictView.svelte must not contain ${hex}`);
  }
});
