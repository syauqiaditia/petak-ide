import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  detectIsAfterDot,
  getKeywordOptions,
  getSnippetOptions,
} from '../ui/features/editor/lsp/completionLogic.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const uiRoot = path.resolve(projectRoot, 'ui');

// =============================================================================
// Suite 1: Dot Detection Logic (isAfterDot)
// =============================================================================

test('b43 isAfterDot: cursor right after dot (e.g. Future.|)', () => {
  const doc = 'Future.';
  const sliceDoc = (from, to) => doc.slice(from, to);
  const pos = 7;
  const wordFrom = null; // No word matched before cursor

  const result = detectIsAfterDot(sliceDoc, pos, wordFrom);
  assert.equal(result, true, 'Position right after dot must be detected as isAfterDot');
});

test('b43 isAfterDot: cursor with typed prefix after dot (e.g. Future.del|)', () => {
  const doc = 'Future.del';
  const sliceDoc = (from, to) => doc.slice(from, to);
  const pos = 10;
  const wordFrom = 7; // "del" begins at index 7

  const result = detectIsAfterDot(sliceDoc, pos, wordFrom);
  assert.equal(result, true, 'Position with prefix preceded by dot must be detected as isAfterDot');
});

test('b43 isAfterDot: chained member access (e.g. Platform.isAndroid.| and Platform.isAndroid.toS|)', () => {
  const doc1 = 'Platform.isAndroid.';
  const sliceDoc1 = (from, to) => doc1.slice(from, to);
  assert.equal(detectIsAfterDot(sliceDoc1, doc1.length, null), true);

  const doc2 = 'Platform.isAndroid.toS';
  const sliceDoc2 = (from, to) => doc2.slice(from, to);
  const wordFrom2 = 'Platform.isAndroid.'.length;
  assert.equal(detectIsAfterDot(sliceDoc2, doc2.length, wordFrom2), true);
});

test('b43 isAfterDot: false when not after dot (e.g. Future| or var x = |)', () => {
  const doc1 = 'Future';
  const sliceDoc1 = (from, to) => doc1.slice(from, to);
  assert.equal(detectIsAfterDot(sliceDoc1, 6, 0), false);

  const doc2 = 'var x = ';
  const sliceDoc2 = (from, to) => doc2.slice(from, to);
  assert.equal(detectIsAfterDot(sliceDoc2, 8, null), false);

  // Document start
  assert.equal(detectIsAfterDot(() => '', 0, null), false);
});

// =============================================================================
// Suite 2: Suppression of Keywords and Snippets After Dot
// =============================================================================

test('b43 Keyword and Snippet suppression: empty array when isAfterDot is true', () => {
  const keywords = ['class', 'final', 'Future', 'void'];
  const snippets = [{ label: 'stful', detail: 'StatefulWidget' }];

  // Right after dot
  const kwAfterDot = getKeywordOptions(keywords, '', true);
  assert.deepEqual(kwAfterDot, [], 'Keywords must be empty array when after dot');

  const snipAfterDot = getSnippetOptions(snippets, '', true);
  assert.deepEqual(snipAfterDot, [], 'Snippets must be empty array when after dot');

  // With prefix after dot (e.g. Future.cl|)
  const kwPrefixAfterDot = getKeywordOptions(keywords, 'cl', true);
  assert.deepEqual(kwPrefixAfterDot, [], 'Keywords must remain empty when after dot even with prefix');

  const snipPrefixAfterDot = getSnippetOptions(snippets, 'st', true);
  assert.deepEqual(snipPrefixAfterDot, [], 'Snippets must remain empty when after dot even with prefix');
});

test('b43 Keyword boost: boost is 0 when not after dot', () => {
  const keywords = ['class', 'final', 'Future', 'void'];

  const kwOptions = getKeywordOptions(keywords, '', false);
  assert.ok(kwOptions.length > 0, 'Keyword options should not be empty');
  for (const opt of kwOptions) {
    assert.equal(opt.boost, 0, `Keyword ${opt.label} must have boost 0, got ${opt.boost}`);
  }

  const filteredKw = getKeywordOptions(keywords, 'cl', false);
  assert.equal(filteredKw.length, 1);
  assert.equal(filteredKw[0].label, 'class');
  assert.equal(filteredKw[0].boost, 0);
});

// =============================================================================
// Suite 3: triggerKind and triggerCharacter Sent to LSP API
// =============================================================================

test('b43 LSP Completion Source: triggerKind 2 and triggerCharacter "." when after dot', () => {
  const compCode = fs.readFileSync(path.resolve(uiRoot, 'features/editor/lsp/completion.ts'), 'utf-8');

  // Verify triggerKind calculation
  assert.ok(
    compCode.includes("const triggerKind = isAfterDot ? 2 : (context.explicit ? 1 : 1);"),
    'completion.ts must calculate triggerKind as 2 for dot trigger, 1 otherwise'
  );

  // Verify triggerCharacter calculation
  assert.ok(
    compCode.includes("const triggerCharacter = isAfterDot ? '.' : undefined;"),
    'completion.ts must set triggerCharacter to "." when after dot'
  );

  // Verify forwarding to api.lsp.completion
  assert.ok(
    compCode.includes('api.lsp.completion(path, lspPos.line, lspPos.character, triggerKind, triggerCharacter)'),
    'completion.ts must pass triggerKind and triggerCharacter to api.lsp.completion'
  );
});

// =============================================================================
// Suite 4: UI API Interface & Implementation
// =============================================================================

test('b43 UI API: api.lsp.completion accepts triggerKind and triggerCharacter', () => {
  const apiCode = fs.readFileSync(path.resolve(uiRoot, 'lib/api.ts'), 'utf-8');

  assert.ok(
    apiCode.includes('triggerKind?: number') && apiCode.includes('triggerCharacter?: string'),
    'api.lsp.completion must accept triggerKind?: number and triggerCharacter?: string'
  );

  assert.ok(
    apiCode.includes("return invoke('lsp_completion', { path, line, character, triggerKind, triggerCharacter });"),
    'api.lsp.completion must pass triggerKind and triggerCharacter to invoke lsp_completion'
  );
});

// =============================================================================
// Suite 5: Rust Core Capabilities (contextSupport: true)
// =============================================================================

test('b43 Rust Core: client_capabilities contains "contextSupport": true under completion', () => {
  const serverCode = fs.readFileSync(path.resolve(projectRoot, 'crates/core/src/lsp/server.rs'), 'utf-8');

  assert.ok(
    serverCode.includes('"completion": {') &&
      serverCode.includes('"contextSupport": true'),
    'crates/core/src/lsp/server.rs must declare "contextSupport": true in textDocument.completion capabilities'
  );
});

// =============================================================================
// Suite 6: Rust App Command lsp_completion Accepts and Formats context
// =============================================================================

test('b43 Rust App: lsp_completion accepts trigger_kind and trigger_character and builds context', () => {
  const appCmdCode = fs.readFileSync(path.resolve(projectRoot, 'crates/app/src/commands/editor.rs'), 'utf-8');

  // Parameters
  assert.ok(
    appCmdCode.includes('trigger_kind: Option<u32>') &&
      appCmdCode.includes('trigger_character: Option<String>'),
    'lsp_completion in crates/app/src/commands/editor.rs must accept trigger_kind and trigger_character'
  );

  // Context JSON building
  assert.ok(
    appCmdCode.includes('if let Some(kind) = trigger_kind {') &&
      appCmdCode.includes('let mut ctx = serde_json::json!({ "triggerKind": kind });') &&
      appCmdCode.includes('if let Some(ref ch) = trigger_character {') &&
      appCmdCode.includes('ctx["triggerCharacter"] = serde_json::json!(ch);') &&
      appCmdCode.includes('params["context"] = ctx;'),
    'lsp_completion must format params["context"] with triggerKind and optional triggerCharacter'
  );
});
