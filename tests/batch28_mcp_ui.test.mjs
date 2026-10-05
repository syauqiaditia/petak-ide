import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  McpStoreLogic,
  calculateActiveMcpCount,
  formatMcpTestResult,
  formatMcpPillLabel,
  parseArgsString,
  formatArgsString,
  parseEnvEntries,
  buildEnvRecord,
  MCP_PRESETS,
} from '../ui/features/settings/mcpLogic.ts';

import { api } from '../ui/lib/api.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uiRoot = path.resolve(__dirname, '../ui');

// ── 1. McpStore Logic & State ──────────────────────────────────────────

test('b28 MCP 1: McpStore initial state and activeCount calculation', () => {
  const store = new McpStoreLogic();

  assert.deepEqual(store.config, { mcpServers: {} });
  assert.equal(store.activeCount, 0);
  assert.equal(store.isLoading, false);
  assert.deepEqual(store.isTesting, {});
  assert.deepEqual(store.testResults, {});

  // Calculate activeCount with mixed servers
  const configWithServers = {
    mcpServers: {
      srv1: { command: 'node', disabled: false },
      srv2: { command: 'npx', disabled: true },
      srv3: { command: 'uvx', disabled: false },
      srv4: { command: 'python3' }, // undefined disabled defaults to active
    },
  };

  assert.equal(calculateActiveMcpCount(configWithServers), 3);
  assert.equal(calculateActiveMcpCount(null), 0);
  assert.equal(calculateActiveMcpCount(undefined), 0);
  assert.equal(calculateActiveMcpCount({ mcpServers: {} }), 0);
});

test('b28 MCP 2: McpStore loadConfig, addOrUpdateServer, toggleServer, removeServer', async () => {
  // Create a mock API instance for store operations
  let savedConfig = null;
  const mockApi = {
    async agentMcpGetConfig() {
      return {
        mcpServers: {
          testServer: {
            command: 'npx',
            args: ['-y', 'dummy-pkg'],
            env: { FOO: 'BAR' },
            disabled: false,
            autoApprove: ['tool1'],
          },
        },
      };
    },
    async agentMcpSaveConfig(cfg) {
      savedConfig = JSON.parse(JSON.stringify(cfg));
    },
    async agentMcpTestServer(cmd) {
      if (cmd === 'fail_cmd') {
        return { ok: false, error: 'Command not found' };
      }
      return { ok: true, latencyMs: 18, serverInfo: 'Dummy MCP 1.0' };
    },
  };

  const store = new McpStoreLogic();

  // 1. loadConfig
  await store.loadConfig(undefined, mockApi);
  assert.equal(store.activeCount, 1);
  assert.ok(store.config.mcpServers.testServer);
  assert.equal(store.config.mcpServers.testServer.command, 'npx');

  // 2. toggleServer
  await store.toggleServer('testServer', undefined, mockApi);
  assert.equal(store.config.mcpServers.testServer.disabled, true);
  assert.equal(store.activeCount, 0);
  assert.equal(savedConfig.mcpServers.testServer.disabled, true);

  await store.toggleServer('testServer', undefined, mockApi);
  assert.equal(store.config.mcpServers.testServer.disabled, false);
  assert.equal(store.activeCount, 1);

  // 3. addOrUpdateServer
  await store.addOrUpdateServer(
    'sqlite',
    {
      command: 'uvx',
      args: ['mcp-server-sqlite'],
      env: {},
      disabled: false,
      autoApprove: ['read_query'],
    },
    undefined,
    mockApi
  );

  assert.equal(store.activeCount, 2);
  assert.ok(store.config.mcpServers.sqlite);
  assert.equal(store.config.mcpServers.sqlite.command, 'uvx');
  assert.equal(savedConfig.mcpServers.sqlite.command, 'uvx');

  // 4. testServer
  const testRes = await store.testServer('sqlite', mockApi);
  assert.ok(testRes);
  assert.equal(testRes.ok, true);
  assert.equal(testRes.latencyMs, 18);
  assert.equal(store.testResults.sqlite.ok, true);
  assert.equal(store.isTesting.sqlite, false);

  // Test failure
  await store.addOrUpdateServer('bad', { command: 'fail_cmd' }, undefined, mockApi);
  const failRes = await store.testServer('bad', mockApi);
  assert.equal(failRes.ok, false);
  assert.ok(failRes.error.includes('not found'));

  // 5. removeServer
  await store.removeServer('bad', undefined, mockApi);
  assert.equal(store.config.mcpServers.bad, undefined);
  assert.equal(store.testResults.bad, undefined);
  assert.equal(savedConfig.mcpServers.bad, undefined);
});

// ── 2. Preset Templates Structure & Defaults ───────────────────────────

test('b28 MCP 3: Preset templates structure & defaults', () => {
  assert.ok(Array.isArray(MCP_PRESETS));
  assert.ok(MCP_PRESETS.length >= 5);

  const presetIds = MCP_PRESETS.map((p) => p.id);
  assert.ok(presetIds.includes('filesystem'));
  assert.ok(presetIds.includes('memory'));
  assert.ok(presetIds.includes('gitlab'));
  assert.ok(presetIds.includes('sqlite'));
  assert.ok(presetIds.includes('custom'));

  // Filesystem preset
  const fsPreset = MCP_PRESETS.find((p) => p.id === 'filesystem');
  assert.equal(fsPreset.config.command, 'npx');
  assert.ok(fsPreset.config.args.includes('@modelcontextprotocol/server-filesystem'));
  assert.ok(fsPreset.config.autoApprove.includes('read_file'));

  // Memory preset
  const memPreset = MCP_PRESETS.find((p) => p.id === 'memory');
  assert.equal(memPreset.config.command, 'npx');
  assert.ok(memPreset.config.args.includes('@modelcontextprotocol/server-memory'));
  assert.ok(memPreset.config.autoApprove.includes('create_entities'));

  // GitLab preset
  const glPreset = MCP_PRESETS.find((p) => p.id === 'gitlab');
  assert.equal(glPreset.config.command, 'npx');
  assert.ok(glPreset.config.args.includes('@modelcontextprotocol/server-gitlab'));
  assert.ok('GITLAB_PERSONAL_ACCESS_TOKEN' in glPreset.config.env);
  assert.ok('GITLAB_API_URL' in glPreset.config.env);

  // SQLite preset
  const sqlPreset = MCP_PRESETS.find((p) => p.id === 'sqlite');
  assert.equal(sqlPreset.config.command, 'uvx');
  assert.ok(sqlPreset.config.args.includes('mcp-server-sqlite'));
  assert.ok(sqlPreset.config.autoApprove.includes('read_query'));

  // Custom preset
  const customPreset = MCP_PRESETS.find((p) => p.id === 'custom');
  assert.equal(customPreset.config.command, '');
  assert.deepEqual(customPreset.config.args, []);
  assert.deepEqual(customPreset.config.env, {});
});

// ── 3. Formatting Helpers & String Parsing ─────────────────────────────

test('b28 MCP 4: Format server test result helper', () => {
  // Idle / undefined
  assert.deepEqual(formatMcpTestResult(null), { status: 'idle', label: '' });
  assert.deepEqual(formatMcpTestResult(undefined), { status: 'idle', label: '' });

  // Success
  const okRes = formatMcpTestResult({ ok: true, latencyMs: 24, serverInfo: 'petak-mcp/0.8' });
  assert.equal(okRes.status, 'ok');
  assert.ok(okRes.label.includes('24ms'));
  assert.ok(okRes.label.includes('petak-mcp/0.8'));

  // Error
  const errRes = formatMcpTestResult({ ok: false, error: 'Executable not found in PATH' });
  assert.equal(errRes.status, 'error');
  assert.ok(errRes.label.includes('Executable not found in PATH'));
});

test('b28 MCP 5: MCP Pill active count formatting', () => {
  assert.equal(formatMcpPillLabel(0), 'MCP (Off)');
  assert.equal(formatMcpPillLabel(1), 'MCP (1)');
  assert.equal(formatMcpPillLabel(3), 'MCP (3)');
  assert.equal(formatMcpPillLabel(10), 'MCP (10)');
});

test('b28 MCP 6: Command args and env parsing helpers', () => {
  // Args string parsing
  assert.deepEqual(parseArgsString(''), []);
  assert.deepEqual(parseArgsString('-y @mcp/server .'), ['-y', '@mcp/server', '.']);
  assert.deepEqual(parseArgsString('--path "C:/Program Files/test" -v'), ['--path', 'C:/Program Files/test', '-v']);
  assert.equal(formatArgsString(['-y', 'server']), '-y server');
  assert.equal(formatArgsString([]), '');

  // Env entries parsing and rebuilding
  const envObj = { KEY1: 'VAL1', KEY2: 'VAL2' };
  const entries = parseEnvEntries(envObj);
  assert.equal(entries.length, 2);
  assert.deepEqual(entries[0], { key: 'KEY1', value: 'VAL1' });

  const rebuilt = buildEnvRecord(entries);
  assert.deepEqual(rebuilt, envObj);
});

// ── 4. API Bindings Contract in api.ts ──────────────────────────────────

test('b28 MCP 7: API bindings contract in api.ts', async () => {
  assert.equal(typeof api.agentMcpGetConfig, 'function');
  assert.equal(typeof api.agentMcpSaveConfig, 'function');
  assert.equal(typeof api.agentMcpTestServer, 'function');

  // Verify default mock behavior in node/test environment
  const cfg = await api.agentMcpGetConfig();
  assert.ok(cfg);
  assert.ok(typeof cfg.mcpServers === 'object');

  // Verify save roundtrip in mock
  const newConfig = {
    mcpServers: {
      customServer: {
        command: 'echo',
        args: ['hello'],
        env: {},
        disabled: false,
        autoApprove: [],
      },
    },
  };

  await api.agentMcpSaveConfig(newConfig);
  const reloaded = await api.agentMcpGetConfig();
  assert.ok(reloaded.mcpServers.customServer);
  assert.equal(reloaded.mcpServers.customServer.command, 'echo');

  // Test server mock
  const testRes = await api.agentMcpTestServer('echo', ['hello'], {});
  assert.equal(testRes.ok, true);
  assert.equal(typeof testRes.latencyMs, 'number');

  const failRes = await api.agentMcpTestServer('fail_test', [], {});
  assert.equal(failRes.ok, false);
  assert.ok(failRes.error);
});

// ── 5. Component Structure & Template Verifications ────────────────────

test('b28 MCP 8: SettingsModal integration (category, sidebar icon, view)', () => {
  const modalPath = path.resolve(uiRoot, 'features/settings/SettingsModal.svelte');
  const code = fs.readFileSync(modalPath, 'utf-8');

  // Import McpSettings
  assert.ok(code.includes("import McpSettings from './McpSettings.svelte'"), 'Must import McpSettings');

  // Category mcp in categories list
  assert.ok(code.includes("id: 'mcp'"), "Must have id: 'mcp' category");
  assert.ok(code.includes("label: 'MCP Servers'"), "Must have label: 'MCP Servers'");
  assert.ok(code.includes("icon: 'server'"), "Must have icon: 'server'");

  // Render McpSettings
  assert.ok(code.includes("activeCategory === 'mcp'"), "Must handle activeCategory === 'mcp'");
  assert.ok(code.includes('<McpSettings root={root} />'), 'Must render McpSettings with root prop');

  // settingsStore activeCategory type check
  const storePath = path.resolve(uiRoot, 'features/settings/settingsStore.svelte.ts');
  const storeCode = fs.readFileSync(storePath, 'utf-8');
  assert.ok(storeCode.includes("'mcp'"), "settingsStore must include 'mcp' in activeCategory type");
});

test('b28 MCP 9: AgentChat integration (MCP Context Pill)', () => {
  const chatPath = path.resolve(uiRoot, 'features/agents/AgentChat.svelte');
  const code = fs.readFileSync(chatPath, 'utf-8');

  // Imports
  assert.ok(code.includes('mcpStore'), 'Must import mcpStore');
  assert.ok(code.includes('formatMcpPillLabel'), 'Must import formatMcpPillLabel');

  // MCP Context Pill button in composer pills row
  assert.ok(code.includes('context-pill mcp'), 'Must have context-pill mcp class');
  assert.ok(code.includes("settingsStore.open('mcp')"), "Must open MCP settings on pill click");
  assert.ok(code.includes('formatMcpPillLabel(mcpStore.activeCount)'), 'Must render formatted active count');
});

test('b28 MCP 10: McpSettings.svelte UI components & functionality', () => {
  const mcpPath = path.resolve(uiRoot, 'features/settings/McpSettings.svelte');
  const code = fs.readFileSync(mcpPath, 'utf-8');

  // Core features
  assert.ok(code.includes('mcpStore.loadConfig'), 'Must load config on mount');
  assert.ok(code.includes('mcpStore.toggleServer'), 'Must support toggle server');
  assert.ok(code.includes('mcpStore.removeServer'), 'Must support remove server');
  assert.ok(code.includes('mcpStore.testServer'), 'Must support test server');
  assert.ok(code.includes('mcpStore.addOrUpdateServer'), 'Must support add or update server');

  // Presets and templates
  assert.ok(code.includes('MCP_PRESETS'), 'Must utilize MCP_PRESETS');
  assert.ok(code.includes('quick-presets-label') || code.includes('presets-quick-bar'), 'Must have quick presets section');

  // Cards display
  assert.ok(code.includes('mcp-card'), 'Must render mcp-card containers');
  assert.ok(code.includes('server-name'), 'Must display server name');
  assert.ok(code.includes('btn-test'), 'Must provide Test button');

  // Modal form
  assert.ok(code.includes('modal-dialog'), 'Must have modal dialog for add/edit');
  assert.ok(code.includes('mcp-preset-select'), 'Must have preset selector in form');
  assert.ok(code.includes('mcp-name'), 'Must have name input');
  assert.ok(code.includes('mcp-command'), 'Must have command input');
  assert.ok(code.includes('mcp-args'), 'Must have args input');
});
