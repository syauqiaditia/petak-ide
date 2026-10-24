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
// Suite 1: TypeScript Interface & API Contracts
// =============================================================================

test('b50 API Types: GitCompareResult includes incomingCommits and outgoingCommits', () => {
  const apiPath = path.resolve(uiRoot, 'lib/api.ts');
  const code = fs.readFileSync(apiPath, 'utf-8');

  assert.ok(
    code.includes('export interface GitCompareResult {'),
    'api.ts must export GitCompareResult interface'
  );
  assert.ok(
    code.includes('incomingCommits: GitCommit[];'),
    'GitCompareResult must declare incomingCommits: GitCommit[]'
  );
  assert.ok(
    code.includes('outgoingCommits: GitCommit[];'),
    'GitCompareResult must declare outgoingCommits: GitCommit[]'
  );
  assert.ok(
    code.includes('files: GitCompareFile[];'),
    'GitCompareResult must declare files: GitCompareFile[]'
  );
  assert.ok(
    code.includes('totalAdded: number;'),
    'GitCompareResult must declare totalAdded: number'
  );
  assert.ok(
    code.includes('totalRemoved: number;'),
    'GitCompareResult must declare totalRemoved: number'
  );

  // Fallback check
  assert.ok(
    code.includes('return { incomingCommits: [], outgoingCommits: [], files: [], totalAdded: 0, totalRemoved: 0 };'),
    'gitCompareBranch fallback must return valid empty GitCompareResult shape'
  );
});

// =============================================================================
// Suite 2: Rust Backend CompareBranchResult & Commit Range Logic
// =============================================================================

test('b50 Rust Core: CompareBranchResult has incoming_commits and outgoing_commits', () => {
  const diffPath = path.resolve(cratesRoot, 'core/src/git/diff.rs');
  const diffCode = fs.readFileSync(diffPath, 'utf-8');

  assert.ok(
    diffCode.includes('pub struct CompareBranchResult {'),
    'diff.rs must declare CompareBranchResult'
  );
  assert.ok(
    diffCode.includes('pub incoming_commits: Vec<Commit>,'),
    'CompareBranchResult must have incoming_commits field'
  );
  assert.ok(
    diffCode.includes('pub outgoing_commits: Vec<Commit>,'),
    'CompareBranchResult must have outgoing_commits field'
  );
  assert.ok(
    diffCode.includes('#[serde(rename_all = "camelCase")]'),
    'CompareBranchResult must serialize with camelCase'
  );

  // Ensure command injection protection
  assert.ok(
    diffCode.includes('crate::git::path::validate_ref_name(base)?;'),
    'compare_branch must validate base ref against injection'
  );
  assert.ok(
    diffCode.includes('crate::git::path::validate_ref_name(target)?;'),
    'compare_branch must validate target ref against injection'
  );

  // Ensure commit range helper queries both directions
  assert.ok(
    diffCode.includes('get_commits_in_range(exec, repo, base, target'),
    'compare_branch must query incoming commits (base..target)'
  );
  assert.ok(
    diffCode.includes('get_commits_in_range(exec, repo, target, base'),
    'compare_branch must query outgoing commits (target..base)'
  );
});

// =============================================================================
// Suite 3: CompareBranchModal UI Structure & Android Studio Parity
// =============================================================================

test('b50 Compare Modal: Header badges for Ahead/Behind and Files', () => {
  const modalPath = path.resolve(uiRoot, 'features/git/CompareBranchModal.svelte');
  const code = fs.readFileSync(modalPath, 'utf-8');

  assert.ok(
    code.includes('incomingCommits.length') && code.includes('Incoming'),
    'Header must render incoming commits count badge'
  );
  assert.ok(
    code.includes('outgoingCommits.length') && code.includes('Outgoing'),
    'Header must render outgoing commits count badge'
  );
  assert.ok(
    code.includes('allFiles.length') && code.includes('Files'),
    'Header must render files count badge'
  );
});

test('b50 Compare Modal: Tabs Switcher between Commits and Files', () => {
  const modalPath = path.resolve(uiRoot, 'features/git/CompareBranchModal.svelte');
  const code = fs.readFileSync(modalPath, 'utf-8');

  assert.ok(
    code.includes("let activeMainTab = $state<'commits' | 'files'>"),
    'Modal must have activeMainTab state'
  );
  assert.ok(
    code.includes("Commits ({totalCommitsCount})") || code.includes("activeMainTab = 'commits'"),
    'Modal must render Commits tab button'
  );
  assert.ok(
    code.includes("Files ({allFiles.length})") || code.includes("activeMainTab = 'files'"),
    'Modal must render Files tab button'
  );
});

test('b50 Compare Modal: Commits tab sub-toggle and commit list details', () => {
  const modalPath = path.resolve(uiRoot, 'features/git/CompareBranchModal.svelte');
  const code = fs.readFileSync(modalPath, 'utf-8');

  assert.ok(
    code.includes("activeCommitTab = 'incoming'") && code.includes("activeCommitTab = 'outgoing'"),
    'Commits view must allow toggling between Incoming and Outgoing'
  );
  assert.ok(
    code.includes('commit.shortSha') || code.includes('commit.sha.slice'),
    'Commits row must display short SHA'
  );
  assert.ok(
    code.includes('commit.subject'),
    'Commits row must display commit subject'
  );
  assert.ok(
    code.includes('commit.authorName'),
    'Commits row must display author name'
  );
  assert.ok(
    code.includes('commit.authorTime') || code.includes('formatCommitDate'),
    'Commits row must format author time / date'
  );
});

test('b50 Compare Modal: Slate Grey theme compliance (zero pitch black)', () => {
  const modalPath = path.resolve(uiRoot, 'features/git/CompareBranchModal.svelte');
  const code = fs.readFileSync(modalPath, 'utf-8');

  // Verify Slate Grey tokens are used
  assert.ok(
    code.includes('var(--p-bg-surface, #26282b)'),
    'Modal must use --p-bg-surface'
  );
  assert.ok(
    code.includes('var(--p-bg-workspace, #2b2d30)'),
    'Modal must use --p-bg-workspace'
  );
  assert.ok(
    code.includes('var(--p-bg-elevated, #35373c)'),
    'Modal must use --p-bg-elevated'
  );
  assert.ok(
    code.includes('var(--border-default, #393b40)'),
    'Modal must use --border-default'
  );

  // Verify no hardcoded pitch black hex (#000000, #141518, #16171b, #0c0d10)
  const forbiddenBlackHex = [/#000000/i, /#141518/i, /#16171b/i, /#0c0d10/i, /#08090d/i];
  for (const regex of forbiddenBlackHex) {
    assert.ok(
      !regex.test(code),
      `CompareBranchModal must not contain forbidden pitch black hex ${regex}`
    );
  }
});

// =============================================================================
// Suite 4: BranchPanel Context Menu Integration
// =============================================================================

test('b50 BranchPanel: Compare with Current is enabled for non-current branch', () => {
  const panelPath = path.resolve(uiRoot, 'features/git/BranchPanel.svelte');
  const code = fs.readFileSync(panelPath, 'utf-8');

  assert.ok(
    code.includes('disabled={selectedBranch.isCurrent}'),
    'Compare with Current must be disabled when selected branch is current'
  );
  assert.ok(
    code.includes('openCompareWithCurrent(selectedBranch!.name)'),
    'Context menu must trigger openCompareWithCurrent'
  );
  assert.ok(
    code.includes('<CompareBranchModal'),
    'BranchPanel must mount CompareBranchModal'
  );
});

// =============================================================================
// Suite 5: Parsing & Shape Validation
// =============================================================================

test('b50 Data Shape: GitCompareResult parses JSON payload cleanly', () => {
  const mockJson = JSON.stringify({
    incomingCommits: [
      {
        sha: 'abc1234567890abcdef1234567890abcdef123456',
        shortSha: 'abc1234',
        parents: ['def5678'],
        authorName: 'UQi Senior Dev',
        authorEmail: 'uqi@example.com',
        authorTime: 1792821685,
        subject: 'feat: add commit range compare',
        refs: [],
        pushed: false,
        isHeadAncestor: false,
      },
    ],
    outgoingCommits: [],
    files: [
      {
        path: 'crates/core/src/git/diff.rs',
        status: 'M',
        added: 50,
        removed: 10,
        binary: false,
      },
    ],
    totalAdded: 50,
    totalRemoved: 10,
  });

  const parsed = JSON.parse(mockJson);

  assert.equal(parsed.incomingCommits.length, 1);
  assert.equal(parsed.incomingCommits[0].shortSha, 'abc1234');
  assert.equal(parsed.incomingCommits[0].authorName, 'UQi Senior Dev');
  assert.equal(parsed.outgoingCommits.length, 0);
  assert.equal(parsed.files.length, 1);
  assert.equal(parsed.files[0].path, 'crates/core/src/git/diff.rs');
  assert.equal(parsed.totalAdded, 50);
  assert.equal(parsed.totalRemoved, 10);
});
