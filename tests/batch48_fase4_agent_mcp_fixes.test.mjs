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
// Suite 1: PermissionModal single-invoke via agentsStore
// =============================================================================

test('b48 PermissionModal: avoids double-invoke and delegates solely to agentsStore.respondPermission', () => {
  const modalPath = path.resolve(uiRoot, 'features/agents/PermissionModal.svelte');
  const code = fs.readFileSync(modalPath, 'utf-8');

  assert.ok(
    !code.includes('api.agentRespondPermission'),
    'PermissionModal must not directly invoke api.agentRespondPermission'
  );
  assert.ok(
    code.includes('await agentsStore.respondPermission(reqId, true)'),
    'handleAllow must call agentsStore.respondPermission(reqId, true)'
  );
  assert.ok(
    code.includes('await agentsStore.respondPermission(reqId, false)'),
    'handleDeny must call agentsStore.respondPermission(reqId, false)'
  );
});

// =============================================================================
// Suite 2: AgentChat multi-line context line selection
// =============================================================================

test('b48 AgentChat: selectActiveTabContext sets endLine properly without shadowing', () => {
  const chatPath = path.resolve(uiRoot, 'features/agents/AgentChat.svelte');
  const code = fs.readFileSync(chatPath, 'utf-8');

  assert.ok(
    code.includes('const toLine = view.state.doc.lineAt(sel.to).number;'),
    'must use toLine variable to avoid shadowing outer endLine'
  );
  assert.ok(
    code.includes('if (toLine > startLine) {') && code.includes('endLine = toLine;'),
    'must assign toLine to outer endLine when toLine > startLine'
  );
});

// =============================================================================
// Suite 3: Memory filename sanitization in Rust
// =============================================================================

test('b48 Rust agent commands: sanitize_memory_filename guards traversal and extension', () => {
  const commandsPath = path.resolve(cratesRoot, 'app/src/agent_commands.rs');
  const code = fs.readFileSync(commandsPath, 'utf-8');

  assert.ok(
    code.includes('fn sanitize_memory_filename'),
    'agent_commands.rs must define sanitize_memory_filename'
  );
  assert.ok(
    code.includes('contains("..")') && code.includes('contains(\'/\')') && code.includes('contains(\'\\\\\')'),
    'sanitize_memory_filename must check for .., /, and \\'
  );
  assert.ok(
    code.includes('ends_with(".md")'),
    'sanitize_memory_filename must require .md extension'
  );
});

// =============================================================================
// Suite 4: MCP test server line streaming and Slot cleanup
// =============================================================================

test('b48 Rust core: mcp test_mcp_server reads lines stream and slot cleans up on failure', () => {
  const mcpPath = path.resolve(cratesRoot, 'core/src/agent/mcp.rs');
  const mcpCode = fs.readFileSync(mcpPath, 'utf-8');

  assert.ok(
    mcpCode.includes('for line_res in r.lines()'),
    'test_mcp_server must iterate over lines()'
  );
  assert.ok(
    mcpCode.includes('child.kill()'),
    'test_mcp_server must kill child process on receiving message'
  );

  const slotPath = path.resolve(cratesRoot, 'core/src/agent/slot.rs');
  const slotCode = fs.readFileSync(slotPath, 'utf-8');

  assert.ok(
    slotCode.includes('client.kill()'),
    'slot must clean up client process when start or handshake fails'
  );
});
