import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const uiRoot = path.resolve(projectRoot, 'ui');
const cratesRoot = path.resolve(projectRoot, 'crates');

// =============================================================================
// Suite 1: GitLab MR View and Create Modal
// =============================================================================

test('b50 MrView: binds currentBranch to active git branch and not hardcoded feat branch', () => {
  const viewPath = path.resolve(uiRoot, 'features/mr/MrView.svelte');
  const code = fs.readFileSync(viewPath, 'utf-8');

  assert.ok(
    code.includes("import { gitStore } from '../git/git.svelte';"),
    'MrView must import gitStore'
  );
  assert.ok(
    code.includes('currentBranch={gitStore.branch?.head || gitStore.currentBranch || \'main\'}'),
    'MrView must pass dynamic currentBranch to MrCreateModal'
  );
  assert.ok(
    !code.includes('currentBranch="feat/phase4-run"'),
    'MrView must not use hardcoded feat branch'
  );
});

test('b50 MR Types & Modal: CreateMrParams supports squash parameter', () => {
  const typesPath = path.resolve(uiRoot, 'features/mr/types.ts');
  const typesCode = fs.readFileSync(typesPath, 'utf-8');

  assert.ok(
    typesCode.includes('squash?: boolean;'),
    'CreateMrParams must declare optional squash property'
  );

  const modalPath = path.resolve(uiRoot, 'features/mr/MrCreateModal.svelte');
  const modalCode = fs.readFileSync(modalPath, 'utf-8');

  assert.ok(
    modalCode.includes('squash: squashCommits'),
    'MrCreateModal must pass squash: squashCommits in onSubmit payload'
  );
});

// =============================================================================
// Suite 2: Rust GitLab Model & Cache Pagination
// =============================================================================

test('b50 Rust GitLab: model has squash field and client preserves page_info in cache', () => {
  const modelPath = path.resolve(cratesRoot, 'core/src/gitlab/model.rs');
  const modelCode = fs.readFileSync(modelPath, 'utf-8');

  assert.ok(
    modelCode.includes('pub squash: Option<bool>,'),
    'CreateMrParams must declare squash: Option<bool>'
  );

  const clientPath = path.resolve(cratesRoot, 'core/src/gitlab/client.rs');
  const clientCode = fs.readFileSync(clientPath, 'utf-8');

  assert.ok(
    clientCode.includes('page_info: Option<PageInfo>,'),
    'CacheEntry must store page_info'
  );
  assert.ok(
    clientCode.includes('insert_with_page_info'),
    'GitLabCache must support insert_with_page_info'
  );
});

// =============================================================================
// Suite 3: Local History Prune & Fsops Copy Protection
// =============================================================================

test('b50 Rust Core: Local history prune cleans orphan blobs and fsops copy protects self-nesting', () => {
  const lhPath = path.resolve(cratesRoot, 'core/src/local_history.rs');
  const lhCode = fs.readFileSync(lhPath, 'utf-8');

  const orphanIdx = lhCode.indexOf('// Clean orphan blobs first');
  const totalBytesIdx = lhCode.indexOf('// Calculate total blob bytes of surviving referenced blobs');

  assert.ok(orphanIdx > 0 && totalBytesIdx > 0, 'Both orphan cleanup and total_bytes sections must exist');
  assert.ok(orphanIdx < totalBytesIdx, 'Orphan blobs must be cleaned up BEFORE calculating total_bytes');

  const fsopsPath = path.resolve(cratesRoot, 'core/src/fsops.rs');
  const fsopsCode = fs.readFileSync(fsopsPath, 'utf-8');

  assert.ok(
    fsopsCode.includes('Cannot copy directory into itself or its subdirectory'),
    'copy_into must guard against copying directory into itself or its subdirectory'
  );
});
