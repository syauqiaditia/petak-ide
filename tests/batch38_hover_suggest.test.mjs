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

// =============================================================================
// Suite 4: Hotfix - Hover Suppress Logic & HoverTime
// =============================================================================

test('b38 Hotfix Hover: hover.ts suppresses hover using currentCompletions length > 0', () => {
  const hoverPath = path.resolve(uiRoot, 'features/editor/lsp/hover.ts');
  const code = fs.readFileSync(hoverPath, 'utf-8');

  assert.ok(
    code.includes("import { currentCompletions } from '@codemirror/autocomplete';") ||
      code.includes('currentCompletions'),
    'hover.ts must import currentCompletions'
  );
  assert.ok(
    code.includes('currentCompletions(view.state).length > 0'),
    'hover.ts must check currentCompletions(view.state).length > 0'
  );
  assert.ok(
    !code.includes("completionStatus(view.state) === 'active'"),
    'hover.ts must not suppress hover on raw completionStatus === active'
  );
});

test('b38 Hotfix Hover: hover.ts sets hoverTime: 180 for fast Android Studio response', () => {
  const hoverPath = path.resolve(uiRoot, 'features/editor/lsp/hover.ts');
  const code = fs.readFileSync(hoverPath, 'utf-8');

  assert.ok(
    code.includes('hoverTime: 180'),
    'hoverTooltip options in hover.ts must specify hoverTime: 180'
  );
});

// =============================================================================
// Suite 5: Hotfix - Autocomplete Source Unification & Fallback
// =============================================================================

test('b38 Hotfix Completion: completion.ts imports snippets helpers and unifies sources', () => {
  const compPath = path.resolve(uiRoot, 'features/editor/lsp/completion.ts');
  const code = fs.readFileSync(compPath, 'utf-8');

  assert.ok(
    code.includes('getSnippetCompletionsForLanguage') && code.includes('getLangForFilename'),
    'completion.ts must import getSnippetCompletionsForLanguage and getLangForFilename from ../snippets'
  );
  assert.ok(
    code.includes('createLspCompletionSource(getPath)'),
    'createLspAutocompleteExtension must use unified createLspCompletionSource'
  );
  assert.ok(
    !code.includes('createSnippetCompletionSource(getPath)'),
    'createLspAutocompleteExtension must not override with standalone createSnippetCompletionSource'
  );
});

test('b38 Hotfix Completion: completion.ts provides fallback and deduplication', () => {
  const compPath = path.resolve(uiRoot, 'features/editor/lsp/completion.ts');
  const code = fs.readFileSync(compPath, 'utf-8');

  assert.ok(
    code.includes('[...filteredSnippets, ...filteredKeywords, ...lspOptions]'),
    'completion.ts must combine [...filteredSnippets, ...filteredKeywords, ...lspOptions]'
  );
  assert.ok(
    code.includes('[...snippetOptions, ...keywordOptions]'),
    'completion.ts must fallback to [...snippetOptions, ...keywordOptions] on error/timeout/abort'
  );
});

test('b38 Hotfix Keymap: keymap registers Alt-/ for macOS completion trigger', () => {
  const compPath = path.resolve(uiRoot, 'features/editor/lsp/completion.ts');
  const compCode = fs.readFileSync(compPath, 'utf-8');
  const keymapPath = path.resolve(uiRoot, 'features/editor/keymap.ts');
  const keymapCode = fs.readFileSync(keymapPath, 'utf-8');

  assert.ok(
    compCode.includes("key: 'Alt-/'") && compCode.includes('run: startCompletion'),
    'completion.ts must include Alt-/ shortcut in keymap extension'
  );
  assert.ok(
    keymapCode.includes("key: 'Alt-/'") && keymapCode.includes('run: startCompletion'),
    'keymap.ts must include Alt-/ shortcut for startCompletion'
  );
});

// =============================================================================
// Suite 6: Hotfix - Z-Index & Pointer-Events CSS
// =============================================================================

test('b38 Hotfix CSS: .cm-tooltip-autocomplete has z-index: 99999 and pointer-events: auto', () => {
  const compPath = path.resolve(uiRoot, 'features/editor/lsp/completion.ts');
  const compCode = fs.readFileSync(compPath, 'utf-8');
  const editorPath = path.resolve(uiRoot, 'features/editor/Editor.svelte');
  const editorCode = fs.readFileSync(editorPath, 'utf-8');

  assert.ok(
    compCode.includes("zIndex: '99999 !important'") &&
      compCode.includes("pointerEvents: 'auto !important'"),
    'completionTheme in completion.ts must set zIndex 99999 and pointerEvents auto'
  );
  assert.ok(
    compCode.includes("'.cm-tooltip.cm-tooltip-autocomplete'"),
    'completionTheme must target .cm-tooltip.cm-tooltip-autocomplete'
  );

  assert.ok(
    editorCode.includes(':global(.cm-tooltip-autocomplete)') &&
      editorCode.includes(':global(.cm-tooltip.cm-tooltip-autocomplete)') &&
      editorCode.includes('z-index: 99999 !important;') &&
      editorCode.includes('pointer-events: auto !important;'),
    'Editor.svelte must enforce z-index: 99999 !important and pointer-events: auto !important on autocomplete tooltip'
  );
});

// =============================================================================
// Suite 7: Hotfix - Rust Core workspaceFolders & App lsp_did_change await
// =============================================================================

test('b38 Hotfix Rust Core: client_capabilities includes workspaceFolders with root_uri and name', () => {
  const serverPath = path.resolve(projectRoot, 'crates/core/src/lsp/server.rs');
  const code = fs.readFileSync(serverPath, 'utf-8');

  assert.ok(
    code.includes('"workspaceFolders": [') &&
      code.includes('"uri": root_uri') &&
      code.includes('"name": name'),
    'client_capabilities in server.rs must include workspaceFolders with uri and name'
  );
});

test('b38 Hotfix Rust App: lsp_did_change awaits spawn_blocking handle', () => {
  const cmdPath = path.resolve(projectRoot, 'crates/app/src/commands/editor.rs');
  const code = fs.readFileSync(cmdPath, 'utf-8');

  const fnIndex = code.indexOf('pub async fn lsp_did_change(');
  assert.ok(fnIndex !== -1, 'lsp_did_change function must exist');

  const fnSlice = code.slice(fnIndex, fnIndex + 600);
  assert.ok(
    fnSlice.includes('let handle = tauri::async_runtime::spawn_blocking(') &&
      fnSlice.includes('handle.await.map_err('),
    'lsp_did_change must await spawn_blocking handle'
  );
});

// =============================================================================
// Suite 8: WebKit Tooltip Rendering & Body Attachment Fix
// =============================================================================

test('b38 WebKit Tooltip: Editor.svelte configures tooltips attached to document.body with fixed position', () => {
  const editorPath = path.resolve(uiRoot, 'features/editor/Editor.svelte');
  const code = fs.readFileSync(editorPath, 'utf-8');

  assert.ok(
    code.includes("import {") && code.includes("tooltips,") && code.includes("from '@codemirror/view'"),
    'Editor.svelte must import tooltips from @codemirror/view'
  );
  assert.ok(
    code.includes('tooltips({') &&
      code.includes('parent: typeof document !== \'undefined\' ? document.body : undefined') &&
      code.includes("position: 'fixed'"),
    'Editor.svelte must configure tooltips with parent document.body and position fixed to escape WebKit container clipping'
  );
});

test('b38 WebKit Tooltip: hover.ts and completion.ts include tooltips body attachment and clip: false', () => {
  const hoverPath = path.resolve(uiRoot, 'features/editor/lsp/hover.ts');
  const hoverCode = fs.readFileSync(hoverPath, 'utf-8');
  const compPath = path.resolve(uiRoot, 'features/editor/lsp/completion.ts');
  const compCode = fs.readFileSync(compPath, 'utf-8');

  assert.ok(
    hoverCode.includes('tooltips({') &&
      hoverCode.includes('parent: typeof document !== \'undefined\' ? document.body : undefined'),
    'hover.ts must include tooltips extension targeting document.body'
  );
  assert.ok(
    hoverCode.includes('clip: false'),
    'hover.ts must specify clip: false on hover tooltip to prevent WebKit subpixel clipping'
  );

  assert.ok(
    compCode.includes('tooltips({') &&
      compCode.includes('parent: typeof document !== \'undefined\' ? document.body : undefined'),
    'completion.ts must include tooltips extension targeting document.body'
  );
});

test('b38 WebKit Tooltip: user-select text styling is applied to hover tooltips', () => {
  const hoverPath = path.resolve(uiRoot, 'features/editor/lsp/hover.ts');
  const hoverCode = fs.readFileSync(hoverPath, 'utf-8');
  const editorPath = path.resolve(uiRoot, 'features/editor/Editor.svelte');
  const editorCode = fs.readFileSync(editorPath, 'utf-8');

  assert.ok(
    hoverCode.includes("userSelect: 'text !important'") &&
      hoverCode.includes("webkitUserSelect: 'text !important'"),
    'hoverTheme must set userSelect and webkitUserSelect text !important'
  );
  assert.ok(
    editorCode.includes('user-select: text !important;') &&
      editorCode.includes('-webkit-user-select: text !important;'),
    'Editor.svelte must enforce user-select and -webkit-user-select on hover tooltip'
  );
});
