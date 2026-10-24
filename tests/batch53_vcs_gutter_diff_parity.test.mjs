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
// Suite 1: VCS Gutter Deletion Triangle Marker & Styling Parity
// =============================================================================

test('b53 VCS Gutter: .cm-vcs-deleted styling defines wedge triangle marker in vcsGutter.ts and Editor.svelte', () => {
  const gutterTsPath = path.resolve(uiRoot, 'features/editor/vcsGutter.ts');
  assert.ok(fs.existsSync(gutterTsPath), 'vcsGutter.ts must exist');
  const gutterTsCode = fs.readFileSync(gutterTsPath, 'utf-8');

  // Verify deletion triangle marker CSS rules in vcsGutterTheme
  assert.ok(gutterTsCode.includes("'.cm-vcs-deleted'"), 'vcsGutter.ts must define .cm-vcs-deleted');
  assert.ok(gutterTsCode.includes("borderLeft: '5px solid #f07a74 !important'"), 'Must use soft red #f07a74 left border for wedge');
  assert.ok(gutterTsCode.includes("top: '-3px !important'"), 'Must align at line boundary (-3px top)');
  assert.ok(gutterTsCode.includes("width: '0 !important'"), 'Must have zero width for triangle border trick');
  assert.ok(gutterTsCode.includes("height: '0 !important'"), 'Must have zero height for triangle border trick');
  assert.ok(gutterTsCode.includes("backgroundColor: 'transparent !important'"), 'Background must be transparent');

  // Verify hover expands the wedge
  assert.ok(gutterTsCode.includes("'.cm-vcs-deleted:hover'"), 'Must define .cm-vcs-deleted:hover');
  assert.ok(gutterTsCode.includes("borderLeftWidth: '6px !important'"), 'Hover expands border-left-width to 6px');

  // Verify Editor.svelte global styles
  const editorSveltePath = path.resolve(uiRoot, 'features/editor/Editor.svelte');
  assert.ok(fs.existsSync(editorSveltePath), 'Editor.svelte must exist');
  const editorCode = fs.readFileSync(editorSveltePath, 'utf-8');

  assert.ok(editorCode.includes(':global(.cm-vcs-deleted)'), 'Editor.svelte must style :global(.cm-vcs-deleted)');
  assert.ok(editorCode.includes('border-left: 5px solid #f07a74 !important'), 'Editor.svelte must use 5px solid #f07a74');
  assert.ok(editorCode.includes('top: -3px !important'), 'Editor.svelte must set top: -3px');
});

test('b53 VCS Gutter: computeVcsLineChanges populates deleted boundary markers correctly', async () => {
  const { computeVcsLineChanges } = await import('../ui/features/editor/vcsGutter.ts');

  const oldDoc = 'line 1\nline 2 to delete\nline 3';
  const newDoc = 'line 1\nline 3';

  const map = computeVcsLineChanges(oldDoc, newDoc);
  assert.equal(map.get(2), 'deleted', 'Line 2 boundary must be marked as deleted');
});

// =============================================================================
// Suite 2: VcsDiffPopup Show Diff Action & vcsTracker Integration
// =============================================================================

test('b53 VCS Popup: VcsDiffPopup contains Show Diff button with split icon and handleShowDiff', () => {
  const popupPath = path.resolve(uiRoot, 'features/editor/VcsDiffPopup.svelte');
  assert.ok(fs.existsSync(popupPath), 'VcsDiffPopup.svelte must exist');
  const popupCode = fs.readFileSync(popupPath, 'utf-8');

  // Verify Show Diff button presence
  assert.ok(popupCode.includes('aria-label="Show Diff"'), 'Must have aria-label="Show Diff"');
  assert.ok(popupCode.includes('title="Show Diff in Center Editor"'), 'Must have tooltip for center editor diff');
  assert.ok(popupCode.includes('Show Diff'), 'Must display "Show Diff" text');
  assert.ok(popupCode.includes('handleShowDiff'), 'Must trigger handleShowDiff');

  // Verify split view icon (rect + vertical line)
  assert.ok(popupCode.includes('<rect x="3" y="3" width="18" height="18" rx="2" ry="2">'), 'Must render split window rect');
  assert.ok(popupCode.includes('<line x1="12" y1="3" x2="12" y2="21">'), 'Must render split center divider');

  // Verify onShowDiff prop and gitStore fallback
  assert.ok(popupCode.includes('onShowDiff'), 'Must support onShowDiff callback prop');
  assert.ok(popupCode.includes('vcsTrackerStore.close()'), 'Must close popup when opening diff');
});

test('b53 VCS Popup: VcsTrackerStore supports showDiff and onShowDiff callback', async () => {
  const { vcsTrackerStore } = await import('../ui/features/editor/vcsTracker.svelte.ts');

  let calledPath = null;
  vcsTrackerStore.filePath = 'lib/main.dart';
  vcsTrackerStore.isOpen = true;
  vcsTrackerStore.onShowDiff = (p) => {
    calledPath = p;
  };

  vcsTrackerStore.showDiff();
  assert.equal(calledPath, 'lib/main.dart', 'showDiff must pass filePath to onShowDiff');
  assert.equal(vcsTrackerStore.isOpen, false, 'showDiff must close the popup');
});

test('b53 VCS Popup: Editor.svelte wires onShowDiff to openCenterDiff', () => {
  const editorPath = path.resolve(uiRoot, 'features/editor/Editor.svelte');
  const editorCode = fs.readFileSync(editorPath, 'utf-8');

  assert.ok(editorCode.includes('handleShowVcsDiff'), 'Editor.svelte must implement handleShowVcsDiff');
  assert.ok(editorCode.includes('gitStore.openCenterDiff'), 'handleShowVcsDiff must call gitStore.openCenterDiff');
  assert.ok(editorCode.includes('onShowDiff={handleShowVcsDiff}'), 'VcsDiffPopup must be passed onShowDiff prop');
});

// =============================================================================
// Suite 3: Hunk Row Alignment & Filler Balancing in Side-by-Side Diff
// =============================================================================

test('b53 Sbs Diff: hunkToSbs produces balanced 1:1 rows with filler spacers for mismatched edits', async () => {
  const { hunkToSbs } = await import('../ui/features/git/sbs.ts');

  // Case 1: More additions than deletions (1 del, 3 adds)
  const hunkMoreAdds = {
    oldStart: 10,
    oldLines: 1,
    newStart: 10,
    newLines: 3,
    header: '@@ -10,1 +10,3 @@',
    lines: [
      { kind: 'del', text: 'old line', oldNo: 10, newNo: null },
      { kind: 'add', text: 'new line 1', oldNo: null, newNo: 10 },
      { kind: 'add', text: 'new line 2', oldNo: null, newNo: 11 },
      { kind: 'add', text: 'new line 3', oldNo: null, newNo: 12 },
    ],
  };

  const sbsAdds = hunkToSbs(hunkMoreAdds);
  assert.equal(sbsAdds.rows.length, 3, 'Must produce 3 aligned rows');
  assert.equal(sbsAdds.rows[0].left.kind, 'del');
  assert.equal(sbsAdds.rows[0].right.kind, 'add');
  assert.equal(sbsAdds.rows[1].left.kind, 'filler', 'Row 1 left must be a filler row');
  assert.equal(sbsAdds.rows[1].right.kind, 'add');
  assert.equal(sbsAdds.rows[2].left.kind, 'filler', 'Row 2 left must be a filler row');
  assert.equal(sbsAdds.rows[2].right.kind, 'add');

  // Case 2: More deletions than additions (3 dels, 1 add)
  const hunkMoreDels = {
    oldStart: 20,
    oldLines: 3,
    newStart: 20,
    newLines: 1,
    header: '@@ -20,3 +20,1 @@',
    lines: [
      { kind: 'del', text: 'del 1', oldNo: 20, newNo: null },
      { kind: 'del', text: 'del 2', oldNo: 21, newNo: null },
      { kind: 'del', text: 'del 3', oldNo: 22, newNo: null },
      { kind: 'add', text: 'replacement', oldNo: null, newNo: 20 },
    ],
  };

  const sbsDels = hunkToSbs(hunkMoreDels);
  assert.equal(sbsDels.rows.length, 3, 'Must produce 3 aligned rows');
  assert.equal(sbsDels.rows[0].left.kind, 'del');
  assert.equal(sbsDels.rows[0].right.kind, 'add');
  assert.equal(sbsDels.rows[1].left.kind, 'del');
  assert.equal(sbsDels.rows[1].right.kind, 'filler', 'Row 1 right must be a filler row');
  assert.equal(sbsDels.rows[2].left.kind, 'del');
  assert.equal(sbsDels.rows[2].right.kind, 'filler', 'Row 2 right must be a filler row');

  // Case 3: Pure additions (0 dels, 2 adds)
  const hunkPureAdds = {
    oldStart: 30,
    oldLines: 0,
    newStart: 30,
    newLines: 2,
    header: '@@ -30,0 +30,2 @@',
    lines: [
      { kind: 'add', text: 'add 1', oldNo: null, newNo: 30 },
      { kind: 'add', text: 'add 2', oldNo: null, newNo: 31 },
    ],
  };

  const sbsPure = hunkToSbs(hunkPureAdds);
  assert.equal(sbsPure.rows.length, 2);
  assert.equal(sbsPure.rows[0].left.kind, 'filler');
  assert.equal(sbsPure.rows[0].right.kind, 'add');
  assert.equal(sbsPure.rows[1].left.kind, 'filler');
  assert.equal(sbsPure.rows[1].right.kind, 'add');
});

test('b53 DiffView: .filler row styling has transparent background and consistent 21px height', () => {
  const diffViewPath = path.resolve(uiRoot, 'features/git/DiffView.svelte');
  assert.ok(fs.existsSync(diffViewPath), 'DiffView.svelte must exist');
  const diffViewCode = fs.readFileSync(diffViewPath, 'utf-8');

  assert.ok(diffViewCode.includes('.filler'), 'DiffView.svelte must define .filler class');
  assert.ok(diffViewCode.includes('height: 21px'), 'DiffView.svelte must set consistent 21px height');
  assert.ok(diffViewCode.includes('background: transparent'), 'DiffView.svelte filler must have transparent neutral background');
});
