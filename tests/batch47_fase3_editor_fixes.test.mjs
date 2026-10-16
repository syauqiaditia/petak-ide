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
// Suite 1: Tree-Sitter Highlighting Visible Ranges (from, to without * 2)
// =============================================================================

test('b47 Tree-Sitter: query captures uses exact from and to character indices without * 2', () => {
  const highlightPath = path.resolve(uiRoot, 'features/editor/ts/highlight.ts');
  const code = fs.readFileSync(highlightPath, 'utf-8');

  // Verify startIndex and endIndex use from and to without * 2
  assert.ok(
    code.includes('startIndex: from,') && code.includes('endIndex: to,'),
    'captures() must be called with startIndex: from and endIndex: to'
  );
  assert.ok(
    !code.includes('startIndex: from * 2'),
    'must not multiply from by 2'
  );
  assert.ok(
    !code.includes('endIndex: to * 2'),
    'must not multiply to by 2'
  );
});

// =============================================================================
// Suite 2: Editor Hot Reload on Save Prop Callback
// =============================================================================

test('b47 Editor Save: handleSave invokes onTabSaveProp callback', () => {
  const editorPath = path.resolve(uiRoot, 'features/editor/Editor.svelte');
  const code = fs.readFileSync(editorPath, 'utf-8');

  assert.ok(
    code.includes('onTabSave: onTabSaveProp,'),
    'Editor must destructure onTabSave as onTabSaveProp'
  );
  assert.ok(
    code.includes('onTabSave(active.path, currentText);') &&
      code.includes('onTabSaveProp?.(active.path, currentText);'),
    'handleSave must invoke both onTabSave (LSP sync) and onTabSaveProp (Hot Reload)'
  );
});

// =============================================================================
// Suite 3: App staticActions reactivity & clean lspRestart
// =============================================================================

test('b47 App: staticActions is reactive with $derived and openFolder calls lspRestart without path', () => {
  const appPath = path.resolve(uiRoot, 'App.svelte');
  const code = fs.readFileSync(appPath, 'utf-8');

  assert.ok(
    code.includes('let staticActions = $derived(') &&
      code.includes('buildStaticActions({'),
    'staticActions must be declared with $derived so editorComponent is reactive'
  );

  assert.ok(
    code.includes('api.lspRestart().catch('),
    'openFolder must call api.lspRestart() without path argument'
  );
  assert.ok(
    !code.includes('api.lspRestart(folderPath)'),
    'must not pass folderPath as language argument to lspRestart'
  );
});

// =============================================================================
// Suite 4: LSP applyEdit (applyWorkspaceEdit & dirty preservation)
// =============================================================================

test('b47 applyEdit: applyWorkspaceEdit handles open tabs and background tabs without state', () => {
  const editPath = path.resolve(uiRoot, 'features/editor/lsp/applyEdit.ts');
  const code = fs.readFileSync(editPath, 'utf-8');

  // Verify openTab && !openTab.state branch exists and uses disk apply + read
  assert.ok(
    code.includes('api.lsp.applyWorkspaceEditDisk(filePath, diskEdits);') &&
      code.includes('await api.readFile(filePath)'),
    'applyWorkspaceEdit must apply edits to disk for background tabs without EditorState'
  );

  // Verify openTab.savedContent is NOT overwritten with edited doc in active or stateful tab
  assert.ok(
    !code.includes('openTab.savedContent = activeView.state.doc.toString();'),
    'must not overwrite savedContent for active view (preserves dirty detection)'
  );
  assert.ok(
    !code.includes('openTab.savedContent = tr.state.doc.toString();'),
    'must not overwrite savedContent for stateful background tab (preserves dirty detection)'
  );

  // Verify markDirty(filePath, true) is called for modified tabs
  assert.ok(
    code.includes('tabsManager.markDirty(filePath, true);'),
    'must mark tab dirty when applying edits via transaction'
  );
});
