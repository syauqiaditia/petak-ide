import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildStashTree,
  flattenStashTree,
  countFilesInTree,
} from '../ui/features/git/stashTreeLogic.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uiRoot = path.resolve(__dirname, '../ui');

test('git polish 1: stashTreeLogic builds nested directory tree and aggregates counts', () => {
  const sampleFiles = [
    { path: 'src/components/Header.svelte', status: 'modified' },
    { path: 'src/components/Footer.svelte', status: 'added' },
    { path: 'src/index.ts', status: 'modified' },
    { path: 'package.json', status: 'modified' },
    { path: 'README.md', status: 'deleted' },
  ];

  const tree = buildStashTree(sampleFiles);

  // Root should contain 1 folder ('src') and 2 files ('package.json', 'README.md')
  assert.equal(tree.length, 3);
  assert.equal(tree[0].type, 'folder');
  assert.equal(tree[0].name, 'src');
  assert.equal(tree[0].path, 'src');
  assert.equal(tree[0].totalFiles, 3);

  assert.equal(tree[1].type, 'file');
  assert.equal(tree[1].name, 'package.json');
  assert.equal(tree[2].type, 'file');
  assert.equal(tree[2].name, 'README.md');

  // Check children of 'src'
  const srcFolder = tree[0];
  assert.equal(srcFolder.children.length, 2);
  assert.equal(srcFolder.children[0].type, 'folder');
  assert.equal(srcFolder.children[0].name, 'components');
  assert.equal(srcFolder.children[0].path, 'src/components');
  assert.equal(srcFolder.children[0].totalFiles, 2);

  assert.equal(srcFolder.children[1].type, 'file');
  assert.equal(srcFolder.children[1].name, 'index.ts');

  // Check children of 'src/components'
  const compFolder = srcFolder.children[0];
  assert.equal(compFolder.children.length, 2);
  assert.equal(compFolder.children[0].name, 'Footer.svelte');
  assert.equal(compFolder.children[1].name, 'Header.svelte');

  // Count total files in tree
  assert.equal(countFilesInTree(tree), 5);
});

test('git polish 2: stashTreeLogic flattening and expand/collapse behavior', () => {
  const sampleFiles = [
    { path: 'src/components/Button.svelte', status: 'modified' },
    { path: 'src/utils/math.ts', status: 'modified' },
    { path: 'package.json', status: 'modified' },
  ];

  const tree = buildStashTree(sampleFiles);

  // 1. All expanded by default (empty collapsed set)
  const expanded = flattenStashTree(tree, new Set());
  // Expected order:
  // - folder src (depth 0)
  //   - folder components (depth 1)
  //     - file Button.svelte (depth 2)
  //   - folder utils (depth 1)
  //     - file math.ts (depth 2)
  // - file package.json (depth 0)
  assert.equal(expanded.length, 6);
  assert.equal(expanded[0].path, 'src');
  assert.equal(expanded[0].isExpanded, true);
  assert.equal(expanded[1].path, 'src/components');
  assert.equal(expanded[1].depth, 1);
  assert.equal(expanded[2].path, 'src/components/Button.svelte');
  assert.equal(expanded[2].depth, 2);
  assert.equal(expanded[5].path, 'package.json');
  assert.equal(expanded[5].depth, 0);

  // 2. Collapse 'src/components'
  const collapsedSub = flattenStashTree(tree, new Set(['src/components']));
  assert.equal(collapsedSub.length, 5);
  const compItem = collapsedSub.find((i) => i.path === 'src/components');
  assert.ok(compItem);
  assert.equal(compItem.isExpanded, false);
  // Button.svelte should not be in flattened list
  assert.equal(collapsedSub.some((i) => i.path === 'src/components/Button.svelte'), false);

  // 3. Collapse root 'src'
  const collapsedRoot = flattenStashTree(tree, new Set(['src']));
  assert.equal(collapsedRoot.length, 2); // folder src, file package.json
  assert.equal(collapsedRoot[0].path, 'src');
  assert.equal(collapsedRoot[0].isExpanded, false);
  assert.equal(collapsedRoot[1].path, 'package.json');
});

test('git polish 3: CommitPanel renders directory tree for stash files with collapse controls', () => {
  const commitPanel = fs.readFileSync(path.join(uiRoot, 'features/git/CommitPanel.svelte'), 'utf8');

  // Imports stashTreeLogic
  assert.ok(
    commitPanel.includes("from './stashTreeLogic'"),
    'CommitPanel must import stashTreeLogic helpers'
  );
  assert.ok(commitPanel.includes('buildStashTree'), 'CommitPanel must use buildStashTree');
  assert.ok(commitPanel.includes('flattenStashTree'), 'CommitPanel must use flattenStashTree');

  // Tree markup
  assert.ok(
    commitPanel.includes('class="stash-files-tree"'),
    'CommitPanel must render stash-files-tree container'
  );
  assert.ok(
    commitPanel.includes('class="stash-tree-folder-row"'),
    'CommitPanel must render stash-tree-folder-row'
  );
  assert.ok(
    commitPanel.includes('toggleStashFolder'),
    'CommitPanel must support toggleStashFolder action'
  );
  assert.ok(
    commitPanel.includes('stash-folder-chevron'),
    'CommitPanel must render folder chevron indicator'
  );
  assert.ok(
    commitPanel.includes('stash-folder-badge'),
    'CommitPanel must render folder file count badge'
  );
});

test('git polish 4: DiffView toolbar has clean responsive layout and jump to source pencil button', () => {
  const diffView = fs.readFileSync(path.join(uiRoot, 'features/git/DiffView.svelte'), 'utf8');

  // Pencil button with tooltip
  assert.ok(
    diffView.includes('class="jump-source-btn"'),
    'DiffView must render jump-source-btn pencil button'
  );
  assert.ok(
    diffView.includes('title="Buka berkas di editor"'),
    'Jump button must have title "Buka berkas di editor"'
  );
  assert.ok(
    diffView.includes('jumpToSource'),
    'DiffView must define jumpToSource click handler'
  );

  // Jump to source action logic
  assert.ok(
    diffView.includes('tabsManager.openTab'),
    'jumpToSource must call tabsManager.openTab'
  );
  assert.ok(
    diffView.includes('gitStore.closeCenterDiff()'),
    'jumpToSource must close center diff when navigating to editor tab'
  );

  // Responsive toolbar styles
  assert.ok(
    diffView.includes('flex-wrap: wrap;'),
    'diff-toolbar must have flex-wrap: wrap for responsive wrapping'
  );
  assert.ok(
    diffView.includes('.jump-source-btn {'),
    'DiffView must include jump-source-btn styling'
  );
});

test('git polish 5: BranchPanel header removed Commit and Stash tabs (pure Git Log)', () => {
  const branchPanel = fs.readFileSync(path.join(uiRoot, 'features/git/BranchPanel.svelte'), 'utf8');

  // Sub-tab switcher only has Log
  const panelTabsStart = branchPanel.indexOf('<div class="panel-tabs">');
  assert.ok(panelTabsStart !== -1, 'BranchPanel must have panel-tabs container');
  const panelTabsSection = branchPanel.slice(panelTabsStart, panelTabsStart + 500);

  assert.ok(panelTabsSection.includes('>Log<') || panelTabsSection.includes('Log\n'), 'panel-tabs must contain Log button');
  assert.ok(!panelTabsSection.includes('onSelectTab?.(\'commit\')'), 'panel-tabs must NOT contain Commit tab button');
  assert.ok(!panelTabsSection.includes('onSelectTab?.(\'stash\')'), 'panel-tabs must NOT contain Stash tab button');
});

test('git polish 6: gitStore openCommitDiff sets centerDiff with commit vs parent labels', () => {
  const gitStoreCode = fs.readFileSync(path.join(uiRoot, 'features/git/git.svelte.ts'), 'utf8');

  // openCommitDiff method updates centerDiff
  assert.ok(
    gitStoreCode.includes('async openCommitDiff(file: GitCommitFile)'),
    'gitStore must declare openCommitDiff'
  );
  assert.ok(
    gitStoreCode.includes('this.centerDiff = {'),
    'openCommitDiff must assign this.centerDiff'
  );
  assert.ok(
    gitStoreCode.includes('~1 (Parent)'),
    'centerDiff leftLabel must identify parent revision'
  );
  assert.ok(
    gitStoreCode.includes('(Commit)'),
    'centerDiff rightLabel must identify commit revision'
  );

  // CommitDetail wires file-row click to gitStore.openCommitDiff
  const commitDetail = fs.readFileSync(path.join(uiRoot, 'features/git/CommitDetail.svelte'), 'utf8');
  assert.ok(
    commitDetail.includes('gitStore.openCommitDiff(file)'),
    'CommitDetail must trigger gitStore.openCommitDiff when clicked'
  );
});
