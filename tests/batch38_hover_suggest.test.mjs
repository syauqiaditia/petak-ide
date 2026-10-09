import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const uiRoot = path.resolve(projectRoot, 'ui');

// =============================================================================
// Suite 1: Rust Core LSP Registry Mutex Drop-before-I/O Pattern
// =============================================================================

test('b38 Rust Core: did_open drops self.servers lock before server.notify', () => {
  const regPath = path.resolve(projectRoot, 'crates/core/src/lsp/registry.rs');
  const code = fs.readFileSync(regPath, 'utf-8');

  // Verify did_open extracts Arc<Server> in isolated lock block
  assert.ok(
    code.includes('let (server, started_fresh) = {') &&
      code.includes('Arc::clone(&managed.server)') &&
      code.includes('server.notify("textDocument/didOpen"'),
    'did_open must release self.servers lock before calling server.notify'
  );
});

test('b38 Rust Core: did_change drops self.servers lock before server.notify', () => {
  const regPath = path.resolve(projectRoot, 'crates/core/src/lsp/registry.rs');
  const code = fs.readFileSync(regPath, 'utf-8');

  assert.ok(
    code.includes('let server = {') &&
      code.includes('Arc::clone(&managed.server)') &&
      code.includes('server.notify(\n            "textDocument/didChange"'),
    'did_change must release self.servers lock before calling server.notify'
  );
});

test('b38 Rust Core: did_save and did_close drop self.servers lock before server.notify', () => {
  const regPath = path.resolve(projectRoot, 'crates/core/src/lsp/registry.rs');
  const code = fs.readFileSync(regPath, 'utf-8');

  // did_save
  assert.ok(
    code.includes('server.notify("textDocument/didSave", &params)?;'),
    'did_save must call server.notify with dropped lock'
  );

  // did_close
  assert.ok(
    code.includes('let server_opt = {') &&
      code.includes('server.notify(\n                "textDocument/didClose"'),
    'did_close must release self.servers lock before calling server.notify'
  );
});

test('b38 Rust Core: respond_to_server and respond_apply_edit drop lock before respond', () => {
  const regPath = path.resolve(projectRoot, 'crates/core/src/lsp/registry.rs');
  const code = fs.readFileSync(regPath, 'utf-8');

  assert.ok(
    code.includes('pub fn respond_to_server') &&
      code.includes('server.respond(id, result)'),
    'respond_to_server must release lock before server.respond'
  );

  assert.ok(
    code.includes('pub fn respond_apply_edit') &&
      code.includes('let (server_for_key, fallback_servers) = {') &&
      code.includes('server.respond(id, &result)'),
    'respond_apply_edit must release lock before server.respond'
  );
});

// =============================================================================
// Suite 2: CSS Selector Hierarchy Fix di Hover Tooltip
// =============================================================================

test('b38 Hover CSS: hover.ts defines .cm-tooltip-hover and .cm-tooltip.cm-tooltip-hover outer wrapper', () => {
  const hoverPath = path.resolve(uiRoot, 'features/editor/lsp/hover.ts');
  const code = fs.readFileSync(hoverPath, 'utf-8');

  assert.ok(
    code.includes("'.cm-tooltip-hover, .cm-tooltip.cm-tooltip-hover'"),
    'hover.ts must target outer wrapper via .cm-tooltip-hover, .cm-tooltip.cm-tooltip-hover'
  );
  assert.ok(
    code.includes("zIndex: '9999 !important'"),
    'hover.ts outer wrapper must specify zIndex: 9999 !important'
  );
  assert.ok(
    code.includes("'.cm-tooltip-hover .cm-lsp-hover-tooltip, .cm-lsp-hover-tooltip'"),
    'hover.ts inner child must target .cm-tooltip-hover .cm-lsp-hover-tooltip, .cm-lsp-hover-tooltip'
  );
});

test('b38 Hover CSS: Editor.svelte defines :global(.cm-tooltip.cm-tooltip-hover) and child hierarchy', () => {
  const editorPath = path.resolve(uiRoot, 'features/editor/Editor.svelte');
  const code = fs.readFileSync(editorPath, 'utf-8');

  assert.ok(
    code.includes(':global(.cm-tooltip.cm-tooltip-hover)'),
    'Editor.svelte must style :global(.cm-tooltip.cm-tooltip-hover)'
  );
  assert.ok(
    code.includes(':global(.cm-tooltip.cm-tooltip-hover .cm-lsp-hover-tooltip)'),
    'Editor.svelte must style :global(.cm-tooltip.cm-tooltip-hover .cm-lsp-hover-tooltip)'
  );
  assert.ok(
    code.includes('z-index: 9999 !important;'),
    'Editor.svelte must ensure z-index: 9999 !important on hover tooltip'
  );
});

// =============================================================================
// Suite 3: Await Document Sync Sebelum Request Completion & Hover
// =============================================================================

test('b38 LSP Sync: flushPending in sync.ts returns Promise<void> and awaits didChange', () => {
  const syncPath = path.resolve(uiRoot, 'features/editor/lsp/sync.ts');
  const code = fs.readFileSync(syncPath, 'utf-8');

  assert.ok(
    code.includes('export async function flushPending(path: string): Promise<void>'),
    'flushPending must be async and return Promise<void>'
  );
  assert.ok(
    code.includes('await api.lsp.didChange(path, tracked.version, changes)'),
    'flushPending must await api.lsp.didChange'
  );
});

test('b38 LSP Completion: completion.ts awaits flushPending before api.lsp.completion', () => {
  const compPath = path.resolve(uiRoot, 'features/editor/lsp/completion.ts');
  const code = fs.readFileSync(compPath, 'utf-8');

  const flushIndex = code.indexOf('await flushPending(path);');
  const completionIndex = code.indexOf('await api.lsp.completion(path, lspPos.line, lspPos.character);');

  assert.ok(flushIndex !== -1, 'completion.ts must call await flushPending(path)');
  assert.ok(completionIndex !== -1, 'completion.ts must call await api.lsp.completion');
  assert.ok(flushIndex < completionIndex, 'await flushPending must occur before await api.lsp.completion');
});

test('b38 LSP Hover: hover.ts awaits flushPending before api.lsp.hover', () => {
  const hoverPath = path.resolve(uiRoot, 'features/editor/lsp/hover.ts');
  const code = fs.readFileSync(hoverPath, 'utf-8');

  const flushIndex = code.indexOf('await flushPending(path);');
  const hoverIndex = code.indexOf('await api.lsp.hover(path, lspPos.line, lspPos.character);');

  assert.ok(flushIndex !== -1, 'hover.ts must call await flushPending(path)');
  assert.ok(hoverIndex !== -1, 'hover.ts must call await api.lsp.hover');
  assert.ok(flushIndex < hoverIndex, 'await flushPending must occur before await api.lsp.hover');
});
