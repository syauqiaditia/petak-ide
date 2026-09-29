import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PanelExclusivityManager,
} from '../ui/shell/panelExclusivity.ts';

import {
  pruneDeviceSelection,
  groupDevices,
} from '../ui/features/run/deviceLogic.ts';

import {
  RunStateMachine,
  reduceRunUiState,
  getRunVisualAttrs,
} from '../ui/features/run/runStateMachine.ts';

import {
  formatRecentProjects,
  removeProjectFromList,
  executeProjectSwitchReset,
} from '../ui/shell/projectResetLogic.ts';

import {
  getTotalFilesCount,
  isAllSelected,
  isPartiallySelected,
  getCommitButtonLabel,
  canExecuteCommit,
  planSelectAllToggle,
  getFileContextActions,
} from '../ui/features/git/commitSelectionLogic.ts';

// =============================================================================
// Suite 1: Panel Exclusivity Store (B1)
// =============================================================================

test('panel exclusivity: only one right panel active (mirror vs devices vs agent)', () => {
  const manager = new PanelExclusivityManager();
  assert.equal(manager.activeRightPanel, null);

  // Opening mirror
  manager.openRight('mirror');
  assert.equal(manager.activeRightPanel, 'mirror');
  assert.equal(manager.isRightOpen('mirror'), true);
  assert.equal(manager.isRightOpen('devices'), false);

  // Opening devices closes mirror
  manager.openRight('devices');
  assert.equal(manager.activeRightPanel, 'devices');
  assert.equal(manager.isRightOpen('mirror'), false);
  assert.equal(manager.isRightOpen('devices'), true);

  // Opening agent closes devices
  manager.openRight('agent');
  assert.equal(manager.activeRightPanel, 'agent');
  assert.equal(manager.isRightOpen('devices'), false);

  // Toggling agent closes it
  manager.toggleRight('agent');
  assert.equal(manager.activeRightPanel, null);

  // Toggling mirror opens it
  manager.toggleRight('mirror');
  assert.equal(manager.activeRightPanel, 'mirror');

  // Closing right panel
  manager.closeRight();
  assert.equal(manager.activeRightPanel, null);
});

test('panel exclusivity: only one left sidebar active (project vs git vs agents)', () => {
  const manager = new PanelExclusivityManager(null, 'project');
  assert.equal(manager.activeLeftSidebar, 'project');

  // Switching to git closes project
  manager.setLeft('git');
  assert.equal(manager.activeLeftSidebar, 'git');
  assert.equal(manager.isLeftActive('git'), true);
  assert.equal(manager.isLeftActive('project'), false);

  // Switching to agents closes git
  manager.setLeft('agents');
  assert.equal(manager.activeLeftSidebar, 'agents');
  assert.equal(manager.isLeftActive('agents'), true);
  assert.equal(manager.isLeftActive('git'), false);
});

// =============================================================================
// Suite 2: Device Selection Pruning (B2)
// =============================================================================

test('device selection pruning: automatically prunes offline or missing devices', () => {
  const devices = [
    { id: 'emulator-5554', state: 'offline', flutterId: 'emulator-5554' },
    { id: 'phone-usb', state: 'online', flutterId: 'phone-usb' },
  ];

  // If emulator-5554 is offline, selection is pruned to the online device
  const result = pruneDeviceSelection('emulator-5554', devices);
  assert.equal(result, 'phone-usb');

  // If currently selected device is not in list at all, pruned to online device
  const missingResult = pruneDeviceSelection('emulator-9999', devices);
  assert.equal(missingResult, 'phone-usb');

  // If no device is online, pruned to empty (no device selected / no checkmark)
  const allOffline = [
    { id: 'emu-1', state: 'offline', flutterId: 'emu-1' },
    { id: 'emu-2', state: 'stopped', flutterId: null },
  ];
  assert.equal(pruneDeviceSelection('emu-1', allOffline), '');
  assert.equal(pruneDeviceSelection('', allOffline), '');

  // If selected device is online and valid, it is retained
  assert.equal(pruneDeviceSelection('phone-usb', devices), 'phone-usb');

  // Device with flutterId == null is not valid for Run and must be pruned
  const devicesWithNullFlutterId = [
    { id: 'raw-ios', state: 'online', flutterId: null },
    { id: 'valid-mac', state: 'online', flutterId: 'macos' },
  ];
  assert.equal(pruneDeviceSelection('raw-ios', devicesWithNullFlutterId), 'valid-mac');
});

// =============================================================================
// Suite 3: Run State Machine (B3)
// =============================================================================

test('run state machine: lifecycle transitions idle -> starting -> running -> error -> idle', () => {
  const sm = new RunStateMachine('idle');
  assert.equal(sm.state, 'idle');

  // Idle visual attributes: green button, stop disabled
  const idleAttrs = getRunVisualAttrs('idle', true, true);
  assert.equal(idleAttrs.buttonColor, '#7fc98f');
  assert.equal(idleAttrs.stopDisabled, true);
  assert.equal(idleAttrs.runDisabled, false);

  // Transition to starting
  sm.transition('START');
  assert.equal(sm.state, 'starting');
  const startingAttrs = getRunVisualAttrs('starting', true, true);
  assert.equal(startingAttrs.buttonColor, '#e8b45a'); // Yellow
  assert.equal(startingAttrs.icon, 'spinner');
  assert.equal(startingAttrs.runDisabled, true); // Spinner disabled
  assert.equal(startingAttrs.stopDisabled, false); // Stop is active while starting!
  assert.equal(startingAttrs.debugDisabled, true);

  // Transition to running
  sm.transition('APP_STARTED');
  assert.equal(sm.state, 'running');
  const runningAttrs = getRunVisualAttrs('running', true, true);
  assert.equal(runningAttrs.buttonColor, '#7fc98f'); // Green solid
  assert.equal(runningAttrs.showHotReload, true); // Hot reload / restart visible
  assert.equal(runningAttrs.stopDisabled, false); // Stop active while running!
  assert.equal(runningAttrs.debugDisabled, false); // Debug active

  // Transition to error on failure
  sm.transition('ERROR');
  assert.equal(sm.state, 'error');
  const errorAttrs = getRunVisualAttrs('error', true, true);
  assert.equal(errorAttrs.buttonColor, '#f07a74'); // Red
  assert.equal(errorAttrs.icon, 'retry');
  assert.equal(errorAttrs.stopDisabled, true); // Stop disabled when error
  assert.equal(errorAttrs.runDisabled, false); // Can retry!

  // Transition back to idle
  sm.transition('STOP');
  assert.equal(sm.state, 'idle');
});

test('run state machine: disabled and tooltip when device is offline or missing', () => {
  const noDeviceAttrs = getRunVisualAttrs('idle', false, true);
  assert.equal(noDeviceAttrs.runDisabled, true);
  assert.equal(noDeviceAttrs.debugDisabled, true);
  assert.equal(noDeviceAttrs.stopDisabled, true);
});

// =============================================================================
// Suite 4: Project Switch Reset & Recent Projects (B4 + F1)
// =============================================================================

test('project switch reset: formats recent list and removes items cleanly', () => {
  const recents = [
    { name: 'jatim-ist-mb-flutter', path: '/code/jatim', lastOpened: 1, exists: true },
    { name: 'voinzy', path: '/code/voinzy', lastOpened: 2, exists: true },
    { name: 'ghost', path: '/code/ghost', lastOpened: 3, exists: false },
  ];

  const formatted = formatRecentProjects(recents, 2);
  assert.equal(formatted.length, 2);

  const pruned = removeProjectFromList(recents, '/code/ghost');
  assert.equal(pruned.length, 2);
  assert.equal(pruned.some((p) => p.path === '/code/ghost'), false);
});

test('project switch reset: closes all tabs, clears problems, resets run logs and git', async () => {
  let clearedTabs = false;
  let clearedDiags = false;
  let resetRun = false;
  let resetGit = false;

  const mockContext = {
    tabsManager: {
      tabs: [
        { path: '/old/main.dart', name: 'main.dart', dirty: false },
        { path: '/old/app.dart', name: 'app.dart', dirty: false },
      ],
      clearAll: () => {
        clearedTabs = true;
      },
    },
    diagnosticsStore: {
      clear: () => {
        clearedDiags = true;
      },
    },
    runStore: {
      resetLogs: () => {
        resetRun = true;
      },
    },
    gitStore: {
      resetState: () => {
        resetGit = true;
      },
    },
  };

  const res = await executeProjectSwitchReset(mockContext);
  assert.equal(res.success, true);
  assert.equal(res.cancelled, false);
  assert.equal(res.tabsClosedCount, 2);
  assert.equal(clearedTabs, true);
  assert.equal(clearedDiags, true);
  assert.equal(resetRun, true);
  assert.equal(resetGit, true);
});

test('project switch reset: prompts save on dirty tabs and respects cancel', async () => {
  let clearedTabs = false;
  const mockContext = {
    tabsManager: {
      tabs: [
        { path: '/old/dirty.dart', name: 'dirty.dart', dirty: true },
      ],
      clearAll: () => {
        clearedTabs = true;
      },
    },
    diagnosticsStore: { clear: () => {} },
    runStore: { resetLogs: () => {} },
    gitStore: { resetState: () => {} },
    onSaveDirtyTab: async () => false, // User clicked Cancel
  };

  const res = await executeProjectSwitchReset(mockContext);
  assert.equal(res.success, false);
  assert.equal(res.cancelled, true);
  assert.equal(clearedTabs, false); // Tabs NOT closed if cancelled
});

// =============================================================================
// Suite 5: Commit Selection Count (F3)
// =============================================================================

test('commit selection count: calculates checked staged count and label Commit (N)', () => {
  assert.equal(getCommitButtonLabel(0, false, false), 'Commit (0)');
  assert.equal(getCommitButtonLabel(3, false, false), 'Commit (3)');
  assert.equal(getCommitButtonLabel(0, true, false), 'Amend Commit');
  assert.equal(getCommitButtonLabel(2, false, true), 'Committing…');

  // Can commit only if message is present AND (staged > 0 or amend)
  assert.equal(canExecuteCommit(0, 'feat: add login', false), false);
  assert.equal(canExecuteCommit(2, '', false), false);
  assert.equal(canExecuteCommit(2, '   ', false), false);
  assert.equal(canExecuteCommit(2, 'feat: add login', false), true);
  assert.equal(canExecuteCommit(0, 'amend old', true), true);
});

test('commit selection count: select all toggling and context menu actions', () => {
  const staged = ['lib/a.dart'];
  const all = ['lib/a.dart', 'lib/b.dart', 'lib/c.dart'];

  assert.equal(isAllSelected(staged.length, all.length), false);
  assert.equal(isPartiallySelected(staged.length, all.length), true);

  // Toggling when partially selected stages the remaining files
  const plan1 = planSelectAllToggle(staged, all);
  assert.equal(plan1.action, 'stage');
  assert.deepEqual(plan1.paths, ['lib/b.dart', 'lib/c.dart']);

  // Toggling when all selected unstages all
  const plan2 = planSelectAllToggle(all, all);
  assert.equal(plan2.action, 'unstage');
  assert.deepEqual(plan2.paths, all);

  // Context menu actions include required actions from contract
  const actions = getFileContextActions('lib/a.dart', true, false);
  const ids = actions.map((a) => a.id);
  assert.ok(ids.includes('rollback'));
  assert.ok(ids.includes('goto_file'));
  assert.ok(ids.includes('show_diff'));
  assert.ok(ids.includes('toggle_stage'));
  assert.ok(ids.includes('gitignore_add'));
  assert.ok(ids.includes('show_history'));
  assert.ok(ids.includes('copy_path'));
  assert.ok(ids.includes('reveal_finder'));
  assert.equal(ids.includes('delete_untracked'), false);

  const untrackedActions = getFileContextActions('new_file.txt', false, true);
  assert.ok(untrackedActions.some((a) => a.id === 'delete_untracked'));
});
