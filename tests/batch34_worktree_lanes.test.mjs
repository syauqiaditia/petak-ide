import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { api } from '../ui/lib/api.ts';
import { DEMO_WORKTREES } from '../ui/features/agents/fixtures.ts';
import {
  formatRuntimeSeconds,
  formatWorktreeRuntime,
  resolveWorktreeBotInfo,
  aggregateWorktreeStats,
} from '../ui/features/agents/agentsLogic.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uiRoot = path.resolve(__dirname, '../ui');

test('b34 Worktree Lanes 1: Export & interface contracts WorktreeInfo', () => {
  const typesPath = path.resolve(uiRoot, 'features/agents/types.ts');
  const typesSrc = fs.readFileSync(typesPath, 'utf-8');

  // Verify WorktreeInfo interface contract
  assert.ok(typesSrc.includes('export interface WorktreeInfo'), 'types.ts must export WorktreeInfo interface');
  assert.ok(typesSrc.includes('task_id: string;'), 'WorktreeInfo must declare task_id: string');
  assert.ok(typesSrc.includes('path: string;'), 'WorktreeInfo must declare path: string');
  assert.ok(typesSrc.includes('branch: string;'), 'WorktreeInfo must declare branch: string');
  assert.ok(typesSrc.includes('base_branch: string;'), 'WorktreeInfo must declare base_branch: string');
  assert.ok(typesSrc.includes('head_sha: string;'), 'WorktreeInfo must declare head_sha: string');
  assert.ok(typesSrc.includes('is_dirty: boolean;'), 'WorktreeInfo must declare is_dirty: boolean');
  assert.ok(typesSrc.includes('created_at: number;'), 'WorktreeInfo must declare created_at: number');

  // Verify api.ts exports WorktreeInfo
  const apiPath = path.resolve(uiRoot, 'lib/api.ts');
  const apiSrc = fs.readFileSync(apiPath, 'utf-8');
  assert.ok(apiSrc.includes('WorktreeInfo,'), 'api.ts must export WorktreeInfo');

  // Verify DEMO_WORKTREES fixture adheres to contract
  assert.ok(Array.isArray(DEMO_WORKTREES), 'DEMO_WORKTREES must be an array');
  assert.ok(DEMO_WORKTREES.length >= 2, 'DEMO_WORKTREES must have at least 2 entries');

  const wt = DEMO_WORKTREES[0];
  assert.equal(typeof wt.task_id, 'string', 'task_id must be string');
  assert.equal(typeof wt.path, 'string', 'path must be string');
  assert.equal(typeof wt.branch, 'string', 'branch must be string');
  assert.equal(typeof wt.base_branch, 'string', 'base_branch must be string');
  assert.equal(typeof wt.head_sha, 'string', 'head_sha must be string');
  assert.equal(typeof wt.is_dirty, 'boolean', 'is_dirty must be boolean');
  assert.equal(typeof wt.created_at, 'number', 'created_at must be number');
});

test('b34 Worktree Lanes 2: API invocation bindings agentWorktree*', async () => {
  // 1. agentWorktreeList
  assert.equal(typeof api.agentWorktreeList, 'function', 'api.agentWorktreeList must be a function');
  const list = await api.agentWorktreeList();
  assert.ok(Array.isArray(list), 'agentWorktreeList must return an array');
  assert.ok(list.length >= 2, 'agentWorktreeList must return initial worktrees');

  const initialCount = list.length;
  const first = list[0];
  assert.ok(first.task_id, 'worktree task_id must exist');
  assert.ok(first.branch, 'worktree branch must exist');

  // 2. agentWorktreeCreate
  assert.equal(typeof api.agentWorktreeCreate, 'function', 'api.agentWorktreeCreate must be a function');
  const newWt = await api.agentWorktreeCreate('t_test_b34', 'wt/test-b34', 'main');
  assert.ok(newWt, 'agentWorktreeCreate must return WorktreeInfo');
  assert.equal(newWt.task_id, 't_test_b34');
  assert.equal(newWt.branch, 'wt/test-b34');
  assert.equal(newWt.base_branch, 'main');
  assert.equal(typeof newWt.is_dirty, 'boolean');

  const afterCreateList = await api.agentWorktreeList();
  assert.equal(afterCreateList.length, initialCount + 1, 'worktree list length must increase after create');

  // 3. agentWorktreeDiff
  assert.equal(typeof api.agentWorktreeDiff, 'function', 'api.agentWorktreeDiff must be a function');
  const diffStr = await api.agentWorktreeDiff('t_test_b34');
  assert.equal(typeof diffStr, 'string', 'agentWorktreeDiff must return diff string');
  assert.ok(diffStr.includes('t_test_b34'), 'diff string must reference taskId');

  // 4. agentWorktreeRemove
  assert.equal(typeof api.agentWorktreeRemove, 'function', 'api.agentWorktreeRemove must be a function');
  await api.agentWorktreeRemove('t_test_b34', true);
  const afterRemoveList = await api.agentWorktreeList();
  assert.equal(afterRemoveList.length, initialCount, 'worktree list length must decrease after remove');
});

test('b34 Worktree Lanes 3: Logic helpers (runtime, bot info & stats)', () => {
  // 1. formatRuntimeSeconds & formatWorktreeRuntime
  assert.equal(formatRuntimeSeconds(0), '00:00');
  assert.equal(formatRuntimeSeconds(65), '01:05');
  assert.equal(formatRuntimeSeconds(725), '12:05');
  assert.equal(formatRuntimeSeconds(3665), '01:01:05');

  const now = Date.now();
  assert.equal(formatWorktreeRuntime(now - 125000, now), '02:05');
  assert.equal(formatWorktreeRuntime(0, now), '00:00');

  // 2. resolveWorktreeBotInfo
  const coreWt = {
    task_id: 't_29e9668a',
    path: '/path/core',
    branch: 'wt/worktree-cockpit-core',
    base_branch: 'main',
    head_sha: 'a5171cb',
    is_dirty: false,
    created_at: now - 50000,
  };
  const coreBot = resolveWorktreeBotInfo(coreWt);
  assert.equal(coreBot.title, 'Senior (Rust)', 'core branch should map to Senior (Rust)');
  assert.equal(coreBot.avatar, '⚡');
  assert.equal(coreBot.status, 'READY');

  const uiWt = {
    task_id: 't_41ab160d',
    path: '/path/ui',
    branch: 'wt/worktree-cockpit-ui',
    base_branch: 'main',
    head_sha: '8264eda',
    is_dirty: true,
    created_at: now - 50000,
  };
  const uiBot = resolveWorktreeBotInfo(uiWt);
  assert.equal(uiBot.title, 'Senior2 (UI)', 'ui branch should map to Senior2 (UI)');
  assert.equal(uiBot.avatar, '⚡');
  assert.equal(uiBot.status, 'RUNNING', 'dirty worktree status should be RUNNING');

  // 3. aggregateWorktreeStats
  const stats = aggregateWorktreeStats([coreWt, uiWt]);
  assert.equal(stats.total, 2);
  assert.equal(stats.dirty, 1);
  assert.equal(stats.running, 1);
});

test('b34 Worktree Lanes 4: WorktreeLanes component structure and Orca-style rendering', () => {
  const lanesPath = path.resolve(uiRoot, 'features/agents/WorktreeLanes.svelte');
  const lanesSrc = fs.readFileSync(lanesPath, 'utf-8');

  // Toolbar & counters
  assert.ok(lanesSrc.includes('cockpit-toolbar'), 'WorktreeLanes must render cockpit toolbar');
  assert.ok(lanesSrc.includes('Worktree Lane Cockpit'), 'WorktreeLanes must render cockpit title');
  assert.ok(lanesSrc.includes('Active'), 'Toolbar must show Active worktrees counter');
  assert.ok(lanesSrc.includes('Running'), 'Toolbar must show Running lanes counter');
  assert.ok(lanesSrc.includes('Modified'), 'Toolbar must show Dirty/Modified count');
  assert.ok(lanesSrc.includes('+ New Lane'), 'Toolbar must have + New Lane button');
  assert.ok(lanesSrc.includes('Segarkan'), 'Toolbar must have refresh / Segarkan button');

  // Lanes Track (Orca-Style horizontal scroll)
  assert.ok(lanesSrc.includes('lanes-track') || lanesSrc.includes('lanes-viewport'), 'Must contain horizontal lanes container');
  assert.ok(lanesSrc.includes('lane-column'), 'Must render lane columns');

  // Header Lane: Bot avatar, title, status badge (RUNNING, READY, BLOCKED, DONE), dynamic runtime
  assert.ok(lanesSrc.includes('lane-header'), 'Must render lane-header');
  assert.ok(lanesSrc.includes('bot-avatar'), 'Must render bot avatar');
  assert.ok(lanesSrc.includes('bot-title'), 'Must render bot title');
  assert.ok(lanesSrc.includes('status-badge'), 'Must render status badge');
  assert.ok(lanesSrc.includes('runtime-counter'), 'Must render live runtime counter');

  // Branch Info: Branch chip wt/<task-id>, base branch main, head SHA preview, dirty indicator
  assert.ok(lanesSrc.includes('branch-chip'), 'Must render branch-chip');
  assert.ok(lanesSrc.includes('base_branch'), 'Must display base branch');
  assert.ok(lanesSrc.includes('head_sha') || lanesSrc.includes('head-sha'), 'Must display head SHA preview');
  assert.ok(lanesSrc.includes('dirty-indicator'), 'Must render dirty indicator');
  assert.ok(lanesSrc.includes('● modified'), 'Must display modified indicator when dirty');
  assert.ok(lanesSrc.includes('● clean'), 'Must display clean indicator when not dirty');

  // Mini Activity Feed / Stream
  assert.ok(lanesSrc.includes('activity-feed') || lanesSrc.includes('activity-feed-box'), 'Must render mini activity feed');

  // Aksi Cepat per Lane: Inspect Diff, Open in Editor, Cancel / Reclaim
  assert.ok(lanesSrc.includes('Inspect Diff'), 'Must have Inspect Diff button');
  assert.ok(lanesSrc.includes('handleInspectDiff'), 'Must implement handleInspectDiff');
  assert.ok(lanesSrc.includes('Open in Editor'), 'Must have Open in Editor button');
  assert.ok(lanesSrc.includes('handleOpenInEditor'), 'Must implement handleOpenInEditor');
  assert.ok(lanesSrc.includes('Cancel / Reclaim'), 'Must have Cancel / Reclaim button');
  assert.ok(lanesSrc.includes('handleCancelReclaim'), 'Must implement handleCancelReclaim');

  // Diff Modal preview
  assert.ok(lanesSrc.includes('diff-modal-window'), 'Must render diff modal preview dialog');
});

test('b34 Worktree Lanes 5: AgentsPanel integration & tab switcher', () => {
  const panelPath = path.resolve(uiRoot, 'features/agents/AgentsPanel.svelte');
  const panelSrc = fs.readFileSync(panelPath, 'utf-8');

  // Import WorktreeLanes component
  assert.ok(panelSrc.includes("import WorktreeLanes from './WorktreeLanes.svelte'"), 'AgentsPanel must import WorktreeLanes');

  // activeSubTab includes 'lanes'
  assert.ok(panelSrc.includes("'lanes'"), 'activeSubTab must support lanes');

  // Tab button Lanes Cockpit
  assert.ok(panelSrc.includes('Lanes Cockpit') || panelSrc.includes('⚡ Lanes'), 'Subtab bar must contain Lanes Cockpit tab');
  assert.ok(panelSrc.includes("activeSubTab = 'lanes'"), 'Must toggle activeSubTab to lanes');

  // View area rendering
  assert.ok(panelSrc.includes('<WorktreeLanes'), 'AgentsPanel must render <WorktreeLanes /> when activeSubTab is lanes');
});
