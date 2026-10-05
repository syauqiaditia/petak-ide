import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { MCP_PRESETS } from '../ui/features/settings/mcpLogic.ts';
import {
  FLOW_TEMPLATES,
  formatStepStatusIcon,
  formatStepStatusLabel,
  formatDuration,
  calculatePassRate,
  formatPassRate,
  filterFlows,
  TestStoreLogic,
} from '../ui/features/tests/testLogic.ts';
import { api } from '../ui/lib/api.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uiRoot = path.resolve(__dirname, '../ui');
const repoRoot = path.resolve(__dirname, '..');

// ── 1. McpPreset Mobile-MCP Structure & Configuration ──────────────────

test('b29: McpPreset Mobile-MCP structure & configuration', () => {
  assert.ok(Array.isArray(MCP_PRESETS), 'MCP_PRESETS must be an array');
  const mobilePreset = MCP_PRESETS.find((p) => p.id === 'mobile-mcp');
  assert.ok(mobilePreset, 'mobile-mcp preset must be defined');

  assert.equal(mobilePreset.id, 'mobile-mcp');
  assert.equal(mobilePreset.name, 'Mobile MCP');
  assert.ok(
    mobilePreset.description.includes('@mobilenext/mobile-mcp'),
    'Description must mention @mobilenext/mobile-mcp'
  );

  const cfg = mobilePreset.config;
  assert.equal(cfg.command, 'npx');
  assert.ok(Array.isArray(cfg.args));
  assert.ok(cfg.args.includes('-y'));
  assert.ok(cfg.args.includes('@mobilenext/mobile-mcp'));
  assert.equal(cfg.disabled, false);
  assert.deepEqual(cfg.env, {});
  assert.ok(Array.isArray(cfg.autoApprove));
  assert.ok(cfg.autoApprove.includes('mobile_tap'));
  assert.ok(cfg.autoApprove.includes('mobile_screenshot'));
  assert.ok(cfg.autoApprove.includes('mobile_input'));
});

// ── 2. TestLogic Formatting, Templates, and Step Status Helpers ─────────

test('b29: testLogic formatting, templates, and step status helpers', () => {
  // 1. Templates
  assert.ok(Array.isArray(FLOW_TEMPLATES));
  assert.ok(FLOW_TEMPLATES.length >= 2, 'Should provide at least Login & Navigation templates');

  const loginTpl = FLOW_TEMPLATES.find((t) => t.id === 'login-flow-template');
  assert.ok(loginTpl, 'Login flow template must exist');
  assert.equal(loginTpl.name, 'Login Flow');
  assert.ok(loginTpl.steps.length > 0);
  assert.ok(loginTpl.tags.includes('auth'));

  const navTpl = FLOW_TEMPLATES.find((t) => t.id === 'navigation-flow-template');
  assert.ok(navTpl, 'Navigation flow template must exist');
  assert.equal(navTpl.name, 'Navigation Flow');
  assert.ok(navTpl.steps.length > 0);
  assert.ok(navTpl.tags.includes('navigation'));

  // 2. Status icon helper (pending ⏳, running 🔄, passed ✅, failed ❌, skipped ⏭️)
  assert.equal(formatStepStatusIcon('pending'), '⏳');
  assert.equal(formatStepStatusIcon('running'), '🔄');
  assert.equal(formatStepStatusIcon('passed'), '✅');
  assert.equal(formatStepStatusIcon('failed'), '❌');
  assert.equal(formatStepStatusIcon('skipped'), '⏭️');
  assert.equal(formatStepStatusIcon(undefined), '⏳');

  // 3. Status label helper
  assert.equal(formatStepStatusLabel('pending'), 'Menunggu');
  assert.equal(formatStepStatusLabel('running'), 'Berjalan');
  assert.equal(formatStepStatusLabel('passed'), 'Lolos');
  assert.equal(formatStepStatusLabel('failed'), 'Gagal');
  assert.equal(formatStepStatusLabel('skipped'), 'Dilewati');

  // 4. Duration formatting
  assert.equal(formatDuration(0), '0ms');
  assert.equal(formatDuration(null), '0ms');
  assert.equal(formatDuration(undefined), '0ms');
  assert.equal(formatDuration(450), '450ms');
  assert.equal(formatDuration(1500), '1.5s');
  assert.equal(formatDuration(2400), '2.4s');

  // 5. Pass rate calculation & formatting
  assert.equal(calculatePassRate(5, 5), 100);
  assert.equal(calculatePassRate(3, 4), 75);
  assert.equal(calculatePassRate(0, 0), 0);
  assert.equal(formatPassRate(4, 5), '80%');

  // 6. Search filtering
  const sampleFlows = [
    { id: '1', name: 'Auth Login', description: 'Test login', appId: 'com.app.test', tags: ['auth'], steps: [] },
    { id: '2', name: 'Checkout Payment', description: 'Test checkout flow', appId: 'com.app.shop', tags: ['payment'], steps: [] },
  ];
  assert.equal(filterFlows(sampleFlows, '').length, 2);
  assert.equal(filterFlows(sampleFlows, 'login').length, 1);
  assert.equal(filterFlows(sampleFlows, 'shop').length, 1);
  assert.equal(filterFlows(sampleFlows, 'payment').length, 1);
  assert.equal(filterFlows(sampleFlows, 'nonexistent').length, 0);
});

// ── 3. TestStore Reactive State and Flow Lifecycle Methods ─────────────

test('b29: testStore reactive state and flow lifecycle methods', async () => {
  const store = new TestStoreLogic();

  assert.deepEqual(store.flows, []);
  assert.equal(store.selectedFlow, null);
  assert.equal(store.isRunning, false);
  assert.equal(store.activeRunResult, null);
  assert.equal(store.searchQuery, '');

  let createdFlowParams = null;
  let executedFlowId = null;
  let cancelledFlowId = null;

  const mockApi = {
    async testListFlows() {
      return [
        {
          id: 'flow-1',
          name: 'Smoke Test',
          description: 'Quick smoke verification',
          appId: 'com.demo',
          tags: ['smoke'],
          steps: [{ id: 's1', action: 'launch', description: 'Start' }],
        },
      ];
    },
    async testRunFlow(flowId, deviceSerial) {
      executedFlowId = flowId;
      return {
        flowId,
        success: true,
        totalSteps: 1,
        passedSteps: 1,
        failedSteps: 0,
        durationMs: 250,
        runner: 'Maestro',
        stepResults: [{ stepId: 's1', status: 'passed', durationMs: 250 }],
      };
    },
    async testCancelFlow(flowId) {
      cancelledFlowId = flowId;
      return true;
    },
    async testCreateFlow(name, appId, steps) {
      createdFlowParams = { name, appId, steps };
      return {
        id: 'flow-created',
        name,
        description: `Scenario ${name}`,
        appId,
        tags: ['custom'],
        steps,
      };
    },
  };

  // 1. loadFlows
  await store.loadFlows(undefined, mockApi);
  assert.equal(store.flows.length, 1);
  assert.equal(store.selectedFlow?.id, 'flow-1');

  // 2. selectFlow
  store.selectFlow(null);
  assert.equal(store.selectedFlow, null);
  store.selectFlow(store.flows[0]);
  assert.equal(store.selectedFlow?.id, 'flow-1');

  // 3. runFlow
  const runResult = await store.runFlow('flow-1', 'emulator-5554', undefined, mockApi);
  assert.equal(executedFlowId, 'flow-1');
  assert.ok(runResult);
  assert.equal(runResult.success, true);
  assert.equal(store.activeRunResult?.flowId, 'flow-1');
  assert.equal(store.isRunning, false);

  // 4. cancelFlow
  const cancelOk = await store.cancelFlow('flow-1', mockApi);
  assert.equal(cancelledFlowId, 'flow-1');
  assert.equal(cancelOk, true);
  assert.equal(store.isRunning, false);

  // 5. createFlow
  const newSteps = [{ id: 'step-10', action: 'tap', selector: '#btn-submit' }];
  const created = await store.createFlow('New Checkout Flow', 'com.app.pay', newSteps, undefined, mockApi);
  assert.equal(created.id, 'flow-created');
  assert.equal(createdFlowParams.name, 'New Checkout Flow');
  assert.equal(store.flows.length, 2);
  assert.equal(store.selectedFlow?.id, 'flow-created');
});

// ── 4. API Bindings Contract in api.ts ──────────────────────────────────

test('b29: API bindings contract in api.ts', async () => {
  assert.equal(typeof api.testListFlows, 'function');
  assert.equal(typeof api.testRunFlow, 'function');
  assert.equal(typeof api.testCancelFlow, 'function');
  assert.equal(typeof api.testCreateFlow, 'function');

  // 1. testListFlows fallback in node environment
  const flows = await api.testListFlows();
  assert.ok(Array.isArray(flows));
  assert.ok(flows.length > 0);
  assert.ok(flows[0].id);
  assert.ok(flows[0].name);

  // 2. testRunFlow fallback
  const firstId = flows[0].id;
  const runRes = await api.testRunFlow(firstId, 'emulator-5554');
  assert.ok(runRes);
  assert.equal(runRes.flowId, firstId);
  assert.equal(typeof runRes.success, 'boolean');
  assert.equal(typeof runRes.totalSteps, 'number');
  assert.ok(Array.isArray(runRes.stepResults));

  // 3. testCancelFlow fallback
  const cancelRes = await api.testCancelFlow(firstId);
  assert.equal(cancelRes, true);

  // 4. testCreateFlow fallback
  const createdFlow = await api.testCreateFlow(
    'Regression Batch',
    'com.petak.test',
    [{ id: 's1', action: 'launch', description: 'Start app' }]
  );
  assert.ok(createdFlow);
  assert.equal(createdFlow.name, 'Regression Batch');
  assert.equal(createdFlow.appId, 'com.petak.test');
  assert.equal(createdFlow.steps.length, 1);

  // Verify created flow persists in mock
  const updatedFlows = await api.testListFlows();
  assert.ok(updatedFlows.some((f) => f.id === createdFlow.id));
});

// ── 5. Left Rail Tab Registration & Shortcut ⌘4 Mapping ────────────────

test('b29: Left Rail tab registration & shortcut ⌘4 mapping', () => {
  // 1. Check ui/shell/Rail.svelte
  const railPath = path.resolve(uiRoot, 'shell/Rail.svelte');
  const railCode = fs.readFileSync(railPath, 'utf-8');

  assert.ok(railCode.includes("activeTab === 'tests'"), "Rail must support activeTab === 'tests'");
  assert.ok(railCode.includes("selectTab('tests')"), "Rail must allow selecting 'tests' tab");
  assert.ok(railCode.includes('🧪'), "Rail must display 🧪 icon for tests tab");
  assert.ok(railCode.includes('⌘4'), "Rail must register ⌘4 in tool windows or button title");
  assert.ok(railCode.includes('Tests & Automation'), "Rail must label tab Tests & Automation");

  // 2. Check ui/App.svelte
  const appPath = path.resolve(uiRoot, 'App.svelte');
  const appCode = fs.readFileSync(appPath, 'utf-8');

  assert.ok(
    appCode.includes("activeRailTab === 'tests'"),
    "App.svelte must handle activeRailTab === 'tests'"
  );
  assert.ok(
    appCode.includes("import('./features/tests/TestsPanel.svelte')"),
    'App.svelte must dynamically import TestsPanel.svelte'
  );
  assert.ok(
    appCode.includes('<TestsPanelComponent folderPath={currentFolderPath} />'),
    'App.svelte must render TestsPanelComponent with folderPath'
  );
  assert.ok(
    appCode.includes("e.key === '4'"),
    "App.svelte must listen for shortcut ⌘4 / key === '4'"
  );

  // 3. Check crates/app/src/menu.rs native macOS menus
  const menuPath = path.resolve(repoRoot, 'crates/app/src/menu.rs');
  const menuCode = fs.readFileSync(menuPath, 'utf-8');

  assert.ok(
    menuCode.includes('run_test_scenario'),
    'crates/app/src/menu.rs must include run_test_scenario menu item'
  );
  assert.ok(
    menuCode.includes('Run Test Scenario'),
    'crates/app/src/menu.rs must have label Run Test Scenario'
  );
  assert.ok(
    menuCode.includes('Shift+CmdOrCtrl+T'),
    'crates/app/src/menu.rs must bind Shift+CmdOrCtrl+T to Run Test Scenario'
  );
  assert.ok(
    menuCode.includes('tool_window_tests'),
    'crates/app/src/menu.rs must include tool_window_tests menu item'
  );
  assert.ok(
    menuCode.includes('Tests & Automation'),
    'crates/app/src/menu.rs must have label Tests & Automation'
  );
  assert.ok(
    menuCode.includes('CmdOrCtrl+4'),
    'crates/app/src/menu.rs must bind CmdOrCtrl+4 to Tests & Automation'
  );
});

// ── 6. TestsPanel.svelte Component Structure & Capabilities ────────────

test('b29: TestsPanel.svelte component structure and elements', () => {
  const panelPath = path.resolve(uiRoot, 'features/tests/TestsPanel.svelte');
  assert.ok(fs.existsSync(panelPath), 'TestsPanel.svelte must exist');
  const panelCode = fs.readFileSync(panelPath, 'utf-8');

  // Must import testStore & runStore
  assert.ok(panelCode.includes('testStore'), 'Must import testStore');
  assert.ok(panelCode.includes('runStore'), 'Must import runStore');
  assert.ok(panelCode.includes('FLOW_TEMPLATES'), 'Must import FLOW_TEMPLATES');

  // Scenario list controls
  assert.ok(panelCode.includes('btn-new-flow'), 'Must include + New Flow button');
  assert.ok(panelCode.includes('btn-refresh'), 'Must include refresh button');
  assert.ok(panelCode.includes('search-input'), 'Must include search input');

  // Execution controls
  assert.ok(panelCode.includes('btn-run-flow'), 'Must include Run Scenario button');
  assert.ok(panelCode.includes('btn-cancel-flow'), 'Must include Cancel button');
  assert.ok(panelCode.includes('device-indicator'), 'Must include device indicator');
  assert.ok(panelCode.includes('runner-badge'), 'Must include runner badge');

  // Checklist & screenshot preview
  assert.ok(panelCode.includes('steps-checklist'), 'Must include progress step checklist');
  assert.ok(panelCode.includes('step-status-icon'), 'Must display step status icons');
  assert.ok(panelCode.includes('screenshot-preview-section'), 'Must include failure screenshot preview');

  // Modal create flow draft
  assert.ok(panelCode.includes('modal-dialog'), 'Must include modal dialog for creating flows');
  assert.ok(panelCode.includes('Template Skenario'), 'Must include template selector in modal');
});
