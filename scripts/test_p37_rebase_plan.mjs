import assert from 'assert';
import {
  validateRebasePlan,
  summarizeRebasePlan,
  reorderItems,
  setItemAction,
  setItemMessage,
  buildRebasePlan,
} from '../ui/features/git/rebasePlan.ts';

console.log('=== Running Rebase Plan Logic Tests ===');

// 1. Validation tests
{
  const emptyRes = validateRebasePlan([]);
  assert.strictEqual(emptyRes.valid, false);
  assert.ok(emptyRes.error?.includes('kosong'));

  const firstSquash = validateRebasePlan([
    { sha: 'sha1', action: 'squash', message: 'm1' },
    { sha: 'sha2', action: 'pick', message: 'm2' },
  ]);
  assert.strictEqual(firstSquash.valid, false);
  assert.ok(firstSquash.error?.includes('squash'));

  const firstFixup = validateRebasePlan([
    { sha: 'sha1', action: 'fixup', message: 'm1' },
    { sha: 'sha2', action: 'pick', message: 'm2' },
  ]);
  assert.strictEqual(firstFixup.valid, false);
  assert.ok(firstFixup.error?.includes('fixup'));

  const allDrop = validateRebasePlan([
    { sha: 'sha1', action: 'drop', message: 'm1' },
    { sha: 'sha2', action: 'drop', message: 'm2' },
  ]);
  assert.strictEqual(allDrop.valid, false);
  assert.ok(allDrop.error?.includes('drop'));

  const validPlan = validateRebasePlan([
    { sha: 'sha1', action: 'pick', message: 'm1' },
    { sha: 'sha2', action: 'squash', message: 'm2' },
    { sha: 'sha3', action: 'reword', message: 'm3' },
  ]);
  assert.strictEqual(validPlan.valid, true);
  assert.strictEqual(validPlan.error, undefined);
  console.log('✓ Validation rules verified');
}

// 2. Summary tests (e.g. 5 commit jadi 3)
{
  const items = [
    { sha: 'f3a91c2', action: 'pick', message: 'feat(checkout): voucher input field' },
    { sha: '8d02e11', action: 'squash', message: 'wip' },
    { sha: '1c7be90', action: 'squash', message: 'wip checkout' },
    { sha: '5e44a0b', action: 'reword', message: 'fix: correct voucher label copy' },
    { sha: '9ab1d77', action: 'pick', message: 'fix(checkout): guard empty voucher body' },
  ];

  const summary = summarizeRebasePlan(items);
  assert.strictEqual(summary.total, 5);
  assert.strictEqual(summary.resulting, 3);
  assert.strictEqual(summary.pickCount, 2);
  assert.strictEqual(summary.squashCount, 2);
  assert.strictEqual(summary.rewordCount, 1);
  assert.strictEqual(summary.dropCount, 0);
  console.log('✓ Plan summary calculation verified: 5 commits -> 3 resulting commits');
}

// 3. Reordering items
{
  const items = [
    { sha: 'c1', action: 'pick', message: 'one' },
    { sha: 'c2', action: 'pick', message: 'two' },
    { sha: 'c3', action: 'pick', message: 'three' },
  ];

  const reordered = reorderItems(items, 0, 2);
  assert.deepStrictEqual(
    reordered.map((x) => x.sha),
    ['c2', 'c3', 'c1']
  );

  const reorderedUp = reorderItems(reordered, 2, 0);
  assert.deepStrictEqual(
    reorderedUp.map((x) => x.sha),
    ['c1', 'c2', 'c3']
  );
  console.log('✓ Reordering items verified');
}

// 4. Updating action & message
{
  const items = [
    { sha: 'c1', action: 'pick', message: 'initial' },
    { sha: 'c2', action: 'pick', message: 'second' },
  ];

  const updatedAction = setItemAction(items, 1, 'reword');
  assert.strictEqual(updatedAction[1].action, 'reword');
  assert.strictEqual(updatedAction[0].action, 'pick');

  const updatedMessage = setItemMessage(updatedAction, 1, 'new message for second');
  assert.strictEqual(updatedMessage[1].message, 'new message for second');
  console.log('✓ Action and message updates verified');
}

// 5. Build RebasePlan
{
  const items = [
    { sha: 'c1', action: 'pick', message: 'm1' },
    { sha: 'c2', action: 'drop', message: null },
  ];
  const plan = buildRebasePlan('base123', items, true);
  assert.strictEqual(plan.base, 'base123');
  assert.strictEqual(plan.backup, true);
  assert.strictEqual(plan.items.length, 2);
  assert.strictEqual(plan.items[1].action, 'drop');
  console.log('✓ Build RebasePlan verified');
}

console.log('ALL REBASE PLAN TESTS PASSED! ✓');
