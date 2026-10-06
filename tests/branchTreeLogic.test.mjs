import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildBranchTree,
  flattenBranchTree,
  filterBranchTree,
  nodeHasCurrent,
} from '../ui/features/git/branchTreeLogic.ts';

test('branchTreeLogic: root active branch is sorted to index 0 before other branches and folders', () => {
  const branches = [
    { name: 'develop', isCurrent: false },
    { name: 'main', isCurrent: true },
    { name: 'feature/login', isCurrent: false },
    { name: 'alpha', isCurrent: false },
  ];

  const tree = buildBranchTree(branches);

  // Top level: 'main' must be index 0
  assert.equal(tree[0].type, 'branch');
  assert.equal(tree[0].branch.name, 'main');
  assert.equal(tree[0].branch.isCurrent, true);

  // Subsequent items: folder 'feature/' and other leaves alphabetically
  const folderNode = tree.find((n) => n.type === 'folder' && n.prefix === 'feature/');
  assert.ok(folderNode, 'feature/ folder should exist');

  const developNode = tree.find((n) => n.type === 'branch' && n.branch.name === 'develop');
  const alphaNode = tree.find((n) => n.type === 'branch' && n.branch.name === 'alpha');
  assert.ok(developNode && alphaNode);
});

test('branchTreeLogic: multi-level nested active branch lifts parent folders and subfolders to top', () => {
  const branches = [
    { name: 'main', isCurrent: false },
    { name: 'alpha/beta', isCurrent: false },
    { name: 'canary/prod/1.9.0', isCurrent: false },
    { name: 'canary/dev/1.8.0', isCurrent: false },
    { name: 'canary/dev/1.9.0', isCurrent: true },
    { name: 'canary/staging', isCurrent: false },
    { name: 'zebra', isCurrent: false },
  ];

  const tree = buildBranchTree(branches);

  // 1. Root level: folder 'canary/' MUST be index 0 because it contains active branch
  assert.equal(tree[0].type, 'folder', 'Top node must be a folder');
  assert.equal(tree[0].prefix, 'canary/');
  assert.ok(nodeHasCurrent(tree[0]), 'canary/ must contain the current branch');

  // 2. Inside 'canary/': subfolder 'dev/' MUST be index 0 because it contains active branch
  const canaryChildren = tree[0].children;
  assert.equal(canaryChildren[0].type, 'folder');
  assert.equal(canaryChildren[0].prefix, 'dev/');
  assert.ok(nodeHasCurrent(canaryChildren[0]), 'dev/ must contain the current branch');

  // 3. Inside 'canary/dev/': branch '1.9.0' MUST be index 0 because isCurrent === true
  const devChildren = canaryChildren[0].children;
  assert.equal(devChildren[0].type, 'branch');
  assert.equal(devChildren[0].displayName, '1.9.0');
  assert.equal(devChildren[0].branch.name, 'canary/dev/1.9.0');
  assert.equal(devChildren[0].branch.isCurrent, true);

  // Sibling in dev/ should follow
  assert.equal(devChildren[1].displayName, '1.8.0');
  assert.equal(devChildren[1].branch.isCurrent, false);
});

test('branchTreeLogic: flattenBranchTree with active branch shows active items first', () => {
  const branches = [
    { name: 'canary/dev/1.9.0', isCurrent: true },
    { name: 'canary/dev/1.8.0', isCurrent: false },
    { name: 'feature/auth', isCurrent: false },
    { name: 'main', isCurrent: false },
  ];

  const tree = buildBranchTree(branches);
  const expanded = new Set(['canary/', 'canary/dev/']);
  const rows = flattenBranchTree(tree, expanded);

  // Row 0: folder canary/
  assert.equal(rows[0].type, 'folder');
  assert.equal(rows[0].fullName, 'canary/');

  // Row 1: subfolder canary/dev/
  assert.equal(rows[1].type, 'folder');
  assert.equal(rows[1].fullName, 'canary/dev/');

  // Row 2: active leaf 1.9.0
  assert.equal(rows[2].type, 'branch');
  assert.equal(rows[2].fullName, 'canary/dev/1.9.0');
  assert.equal(rows[2].isCurrent, true);
});

test('branchTreeLogic: filterBranchTree retains hierarchy and current branch if matched', () => {
  const branches = [
    { name: 'main', isCurrent: true },
    { name: 'fix/login', isCurrent: false },
    { name: 'fix/payment', isCurrent: false },
    { name: 'release/v1', isCurrent: false },
  ];

  const tree = buildBranchTree(branches);
  const filtered = filterBranchTree(tree, 'fix');

  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].type, 'folder');
  assert.equal(filtered[0].prefix, 'fix/');
  assert.equal(filtered[0].children.length, 2);
});
