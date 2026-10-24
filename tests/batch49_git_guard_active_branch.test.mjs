import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uiRoot = path.resolve(__dirname, '../ui');

// Helper pure functions mirroring LogView.svelte logic
function checkIsOnCurrentBranch(selectedCommits) {
  return selectedCommits.length > 0 && selectedCommits.every((c) => c.isHeadAncestor !== false);
}

function computeActionStates({
  selectedCommits,
  isConsecutive = true,
  hasMergeCommit = false,
  logCommits = [],
  selectedCommitSha = '',
}) {
  const selectedCount = selectedCommits.length;
  const isOnCurrentBranch = checkIsOnCurrentBranch(selectedCommits);

  const canSquash = selectedCount >= 2 && isConsecutive && !hasMergeCommit && isOnCurrentBranch;
  const canReword = selectedCount === 1 && !hasMergeCommit && isOnCurrentBranch;
  const canFixup =
    selectedCount === 1 &&
    !hasMergeCommit &&
    logCommits.findIndex((c) => c.sha === selectedCommitSha) > 0 &&
    isOnCurrentBranch;
  const canDrop = selectedCount >= 1 && !hasMergeCommit && isOnCurrentBranch;
  const canRebase = selectedCount === 1 && !hasMergeCommit && isOnCurrentBranch;

  const tooltipBranchDisabled = 'Commit bukan di branch aktif. Checkout branch ini dulu untuk mengubah riwayat.';

  const squashTooltip = !isOnCurrentBranch
    ? tooltipBranchDisabled
    : (!canSquash ? 'Select ≥ 2 contiguous non-merge commits' : 'Squash commits');

  const rewordTooltip = !isOnCurrentBranch
    ? tooltipBranchDisabled
    : (!canReword ? 'Select 1 non-merge commit' : 'Edit message');

  const fixupTooltip = !isOnCurrentBranch
    ? tooltipBranchDisabled
    : (!canFixup ? 'Select 1 commit with a previous commit' : 'Fixup into previous commit');

  const dropTooltip = !isOnCurrentBranch
    ? tooltipBranchDisabled
    : (!canDrop ? 'Select non-merge commit(s) to drop' : 'Drop commit(s)');

  const rebaseTooltip = !isOnCurrentBranch
    ? tooltipBranchDisabled
    : (!canRebase ? 'Select 1 non-merge commit' : 'Interactive rebase');

  return {
    isOnCurrentBranch,
    canSquash,
    canReword,
    canFixup,
    canDrop,
    canRebase,
    tooltips: {
      squash: squashTooltip,
      reword: rewordTooltip,
      fixup: fixupTooltip,
      drop: dropTooltip,
      rebase: rebaseTooltip,
    },
  };
}

test('b49 Git Guard 1: GitCommit interface in types.ts includes isHeadAncestor?: boolean', () => {
  const typesContent = fs.readFileSync(path.join(uiRoot, 'features/git/types.ts'), 'utf8');
  assert.ok(
    typesContent.includes('isHeadAncestor?: boolean;'),
    'GitCommit interface must declare isHeadAncestor?: boolean'
  );
});

test('b49 Git Guard 2: isOnCurrentBranch derivation correctly detects HEAD ancestor status', () => {
  // Empty selection -> false
  assert.equal(checkIsOnCurrentBranch([]), false);

  // Single commit on current branch
  assert.equal(checkIsOnCurrentBranch([{ sha: 'c1', isHeadAncestor: true }]), true);

  // Single commit on another branch
  assert.equal(checkIsOnCurrentBranch([{ sha: 'c2', isHeadAncestor: false }]), false);

  // Undefined default isHeadAncestor (treated as true because !== false)
  assert.equal(checkIsOnCurrentBranch([{ sha: 'c3' }]), true);

  // Multiple commits all on current branch
  assert.equal(
    checkIsOnCurrentBranch([
      { sha: 'c1', isHeadAncestor: true },
      { sha: 'c2', isHeadAncestor: true },
    ]),
    true
  );

  // Multiple commits where one is not on current branch
  assert.equal(
    checkIsOnCurrentBranch([
      { sha: 'c1', isHeadAncestor: true },
      { sha: 'c2', isHeadAncestor: false },
    ]),
    false
  );
});

test('b49 Git Guard 3: All rewrite actions disabled when commit is not on current branch', () => {
  const commitsOnOtherBranch = [
    { sha: 'feat1', isHeadAncestor: false, parents: ['root'] },
    { sha: 'feat2', isHeadAncestor: false, parents: ['feat1'] },
  ];

  const logCommits = [
    { sha: 'feat2', isHeadAncestor: false, parents: ['feat1'] },
    { sha: 'feat1', isHeadAncestor: false, parents: ['root'] },
    { sha: 'root', isHeadAncestor: true, parents: [] },
  ];

  // 1. Squash: 2 commits, contiguous, no merge, but not on current branch
  const squashState = computeActionStates({
    selectedCommits: commitsOnOtherBranch,
    isConsecutive: true,
    hasMergeCommit: false,
    logCommits,
  });
  assert.equal(squashState.isOnCurrentBranch, false);
  assert.equal(squashState.canSquash, false);
  assert.equal(
    squashState.tooltips.squash,
    'Commit bukan di branch aktif. Checkout branch ini dulu untuk mengubah riwayat.'
  );

  // 2. Reword: 1 commit, no merge, but not on current branch
  const rewordState = computeActionStates({
    selectedCommits: [commitsOnOtherBranch[0]],
    isConsecutive: true,
    hasMergeCommit: false,
    logCommits,
    selectedCommitSha: 'feat1',
  });
  assert.equal(rewordState.canReword, false);
  assert.equal(
    rewordState.tooltips.reword,
    'Commit bukan di branch aktif. Checkout branch ini dulu untuk mengubah riwayat.'
  );

  // 3. Fixup: 1 commit with previous in log, but not on current branch
  const fixupState = computeActionStates({
    selectedCommits: [commitsOnOtherBranch[0]],
    isConsecutive: true,
    hasMergeCommit: false,
    logCommits,
    selectedCommitSha: 'feat1',
  });
  assert.equal(fixupState.canFixup, false);
  assert.equal(
    fixupState.tooltips.fixup,
    'Commit bukan di branch aktif. Checkout branch ini dulu untuk mengubah riwayat.'
  );

  // 4. Drop: 1 or more commits, but not on current branch
  const dropState = computeActionStates({
    selectedCommits: commitsOnOtherBranch,
    isConsecutive: true,
    hasMergeCommit: false,
    logCommits,
  });
  assert.equal(dropState.canDrop, false);
  assert.equal(
    dropState.tooltips.drop,
    'Commit bukan di branch aktif. Checkout branch ini dulu untuk mengubah riwayat.'
  );

  // 5. Rebase: 1 commit, but not on current branch
  const rebaseState = computeActionStates({
    selectedCommits: [commitsOnOtherBranch[0]],
    isConsecutive: true,
    hasMergeCommit: false,
    logCommits,
  });
  assert.equal(rebaseState.canRebase, false);
  assert.equal(
    rebaseState.tooltips.rebase,
    'Commit bukan di branch aktif. Checkout branch ini dulu untuk mengubah riwayat.'
  );
});

test('b49 Git Guard 4: Rewrite actions enabled when commits are on current branch and valid', () => {
  const commitsOnMain = [
    { sha: 'm2', isHeadAncestor: true, parents: ['m1'] },
    { sha: 'm1', isHeadAncestor: true, parents: ['root'] },
  ];

  const logCommits = [
    { sha: 'm2', isHeadAncestor: true, parents: ['m1'] },
    { sha: 'm1', isHeadAncestor: true, parents: ['root'] },
    { sha: 'root', isHeadAncestor: true, parents: [] },
  ];

  // 1. Squash: 2 contiguous commits on main
  const squashState = computeActionStates({
    selectedCommits: commitsOnMain,
    isConsecutive: true,
    hasMergeCommit: false,
    logCommits,
  });
  assert.equal(squashState.isOnCurrentBranch, true);
  assert.equal(squashState.canSquash, true);
  assert.equal(squashState.tooltips.squash, 'Squash commits');

  // 2. Reword: 1 commit on main
  const rewordState = computeActionStates({
    selectedCommits: [commitsOnMain[0]],
    isConsecutive: true,
    hasMergeCommit: false,
    logCommits,
  });
  assert.equal(rewordState.canReword, true);
  assert.equal(rewordState.tooltips.reword, 'Edit message');

  // 3. Fixup: 1 commit on main with previous commit (index 1 > 0)
  const fixupState = computeActionStates({
    selectedCommits: [commitsOnMain[1]],
    isConsecutive: true,
    hasMergeCommit: false,
    logCommits,
    selectedCommitSha: 'm1',
  });
  assert.equal(fixupState.canFixup, true);
  assert.equal(fixupState.tooltips.fixup, 'Fixup into previous commit');

  // 4. Drop: 1 commit on main
  const dropState = computeActionStates({
    selectedCommits: [commitsOnMain[0]],
    isConsecutive: true,
    hasMergeCommit: false,
    logCommits,
  });
  assert.equal(dropState.canDrop, true);
  assert.equal(dropState.tooltips.drop, 'Drop commit(s)');

  // 5. Rebase: 1 commit on main
  const rebaseState = computeActionStates({
    selectedCommits: [commitsOnMain[0]],
    isConsecutive: true,
    hasMergeCommit: false,
    logCommits,
  });
  assert.equal(rebaseState.canRebase, true);
  assert.equal(rebaseState.tooltips.rebase, 'Interactive rebase');
});

test('b49 Git Guard 5: LogView.svelte implements isOnCurrentBranch and tooltips', () => {
  const logViewContent = fs.readFileSync(path.join(uiRoot, 'features/git/LogView.svelte'), 'utf8');

  // Check derivation
  assert.ok(
    logViewContent.includes('let isOnCurrentBranch = $derived('),
    'LogView must derive isOnCurrentBranch'
  );
  assert.ok(
    logViewContent.includes('c.isHeadAncestor !== false'),
    'isOnCurrentBranch must check isHeadAncestor !== false'
  );

  // Check can* derivations
  assert.ok(logViewContent.includes('canSquash = $derived(') && logViewContent.includes('isOnCurrentBranch'));
  assert.ok(logViewContent.includes('canReword = $derived(') && logViewContent.includes('isOnCurrentBranch'));
  assert.ok(logViewContent.includes('canFixup = $derived(') && logViewContent.includes('isOnCurrentBranch'));
  assert.ok(logViewContent.includes('canDrop = $derived(') && logViewContent.includes('isOnCurrentBranch'));
  assert.ok(logViewContent.includes('canRebase = $derived(') && logViewContent.includes('isOnCurrentBranch'));

  // Check tooltip warning message
  const expectedMsg = 'Commit bukan di branch aktif. Checkout branch ini dulu untuk mengubah riwayat.';
  assert.ok(
    logViewContent.includes(expectedMsg),
    'LogView must include Indonesian tooltip for non-active branch commits'
  );
});
