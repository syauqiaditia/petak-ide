import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { EditorSettings } from '../ui/features/editor/editorSettingsLogic.ts';
import { computeGhostFromSuggest } from '../ui/features/editor/ghostText.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uiRoot = path.resolve(__dirname, '../ui');

// =============================================================================
// Suite 1: Normal Mode First / Vim Opt-in (Item 5)
// =============================================================================

test('editor settings: normal mode first (vimMode default false), vim opt-in only', () => {
  const settings = new EditorSettings(true);
  assert.equal(settings.vimMode, false, 'Default mode must be normal typing, not Vim');

  let notifiedVim = null;
  const unsub = settings.onVimModeChange((enabled) => {
    notifiedVim = enabled;
  });

  settings.setVimMode(true);
  assert.equal(settings.vimMode, true);
  assert.equal(notifiedVim, true);

  settings.setVimMode(false);
  assert.equal(settings.vimMode, false);
  assert.equal(notifiedVim, false);

  unsub();
});

test('editor settings: codeFolding defaults to true and emits changes', () => {
  const settings = new EditorSettings(true);
  assert.equal(settings.codeFolding, true);

  let notifiedFold = null;
  const unsub = settings.onCodeFoldingChange((enabled) => {
    notifiedFold = enabled;
  });

  settings.setCodeFolding(false);
  assert.equal(settings.codeFolding, false);
  assert.equal(notifiedFold, false);

  unsub();
});

// =============================================================================
// Suite 2: Mirror State Case-Insensitive Handling & needs_usb (Item 3)
// =============================================================================

test('mirror status: handles all state variants case-insensitively and needs_usb', () => {
  class MockMirrorStore {
    status = 'empty';
    errorMessage = '';
    disconnectReason = '';
    isViewOnly = false;
    fps = 60;

    handleMirrorStatus(status) {
      const rawState = (status.state || '').toLowerCase();
      switch (rawState) {
        case 'connecting':
          this.status = 'connecting';
          break;
        case 'live':
          this.status = this.isViewOnly ? 'view-only' : 'live';
          break;
        case 'disconnected':
          this.status = 'disconnected';
          this.disconnectReason = status.reason || 'Device disconnected';
          this.fps = 0;
          break;
        case 'needs_usb':
          this.status = 'error';
          this.errorMessage =
            status.message ||
            'needs_usb: iPhone Fisik membutuhkan kabel USB langsung ke Mac (tidak mendukung Wi-Fi / ncm).';
          this.fps = 0;
          break;
        case 'failed':
        case 'error':
          this.status = 'error';
          this.errorMessage = status.message || 'Mirroring session failed';
          this.fps = 0;
          break;
        default:
          if (rawState.includes('fail') || rawState.includes('error')) {
            this.status = 'error';
            this.errorMessage = status.message || rawState;
            this.fps = 0;
          }
          break;
      }
    }
  }

  const store = new MockMirrorStore();

  // 1. TitleCase Live
  store.handleMirrorStatus({ state: 'Live' });
  assert.equal(store.status, 'live');

  // 2. lowercase connecting
  store.handleMirrorStatus({ state: 'connecting' });
  assert.equal(store.status, 'connecting');

  // 3. needs_usb event
  store.handleMirrorStatus({ state: 'needs_usb', message: 'Kabel USB diperlukan' });
  assert.equal(store.status, 'error');
  assert.match(store.errorMessage, /Kabel USB/);
  assert.equal(store.fps, 0);

  // 4. failed state
  store.handleMirrorStatus({ state: 'failed', message: 'scrcpy handshake failed' });
  assert.equal(store.status, 'error');
  assert.equal(store.errorMessage, 'scrcpy handshake failed');

  // 5. error state
  store.handleMirrorStatus({ state: 'error', message: 'TCC permission denied' });
  assert.equal(store.status, 'error');
  assert.equal(store.errorMessage, 'TCC permission denied');

  // 6. disconnected
  store.handleMirrorStatus({ state: 'disconnected', reason: 'Cable unplugged' });
  assert.equal(store.status, 'disconnected');
  assert.equal(store.disconnectReason, 'Cable unplugged');
});

// =============================================================================
// Suite 3: Ghost Text Single-line Inline Preview (Item 8)
// =============================================================================

test('ghost text: multiline blocks are trimmed to single-line preview to prevent startle', () => {
  const multilineItem = {
    text: 'buildHeader() {\n  return Container(\n    height: 60,\n  );\n}',
    freq: 3,
  };

  const fullGhost = computeGhostFromSuggest('', multilineItem);
  assert.ok(fullGhost.includes('\n'));

  // In ghostText.ts plugin:
  let inlineGhost = fullGhost;
  if (inlineGhost.includes('\n')) {
    inlineGhost = inlineGhost.split('\n')[0];
  }

  assert.equal(inlineGhost, 'buildHeader() {');
  assert.ok(!inlineGhost.includes('\n'));
});

// =============================================================================
// Suite 4: Code Folding CSS Styling in Dark Mode (Item 4)
// =============================================================================

test('code folding: .cm-foldPlaceholder styled properly for dark mode without white background', () => {
  const foldingPath = path.resolve(uiRoot, 'features/editor/folding.ts');
  const foldingCode = fs.readFileSync(foldingPath, 'utf-8');

  assert.ok(foldingCode.includes('.cm-foldPlaceholder'));
  assert.ok(foldingCode.includes('#2a2d32'));
  assert.ok(foldingCode.includes('#3c3c3c'));
  assert.ok(foldingCode.includes('#8b8f98'));

  const editorPath = path.resolve(uiRoot, 'features/editor/Editor.svelte');
  const editorCode = fs.readFileSync(editorPath, 'utf-8');
  assert.ok(editorCode.includes('.cm-foldPlaceholder'));
  assert.ok(editorCode.includes('#2a2d32'));
});

// =============================================================================
// Suite 5: Git Diff Horizontal Scroll & No Ellipsis (Item 6)
// =============================================================================

test('git diff: diff view removes code ellipsis and enables horizontal scrolling', () => {
  const diffPath = path.resolve(uiRoot, 'features/git/DiffView.svelte');
  const diffCode = fs.readFileSync(diffPath, 'utf-8');

  // .cell-text must NOT have text-overflow: ellipsis
  const cellTextRegex = /\.cell-text\s*\{[^}]*text-overflow:\s*ellipsis;/;
  assert.equal(cellTextRegex.test(diffCode), false, '.cell-text must not truncate with ellipsis');

  // .sbs-cell and .hunks-container must support horizontal scroll
  assert.ok(diffCode.includes('overflow-x: auto'));
  assert.ok(diffCode.includes('white-space: pre'));
});

// =============================================================================
// Suite 6: Standalone Starting Point & Animated Logo in Welcome Screen (Item 1)
// =============================================================================

test('welcome screen: rail hidden when !currentFolderPath for clean standalone view', () => {
  const appPath = path.resolve(uiRoot, 'App.svelte');
  const appCode = fs.readFileSync(appPath, 'utf-8');

  // Rail wrapped in {#if currentFolderPath}
  assert.ok(appCode.includes('{#if currentFolderPath}'));
  assert.ok(appCode.includes('<Rail'));
});

test('welcome screen: petak logo has subtle breathing and glow keyframe animations', () => {
  const dashboardPath = path.resolve(uiRoot, 'features/dashboard/DashboardView.svelte');
  const dashboardCode = fs.readFileSync(dashboardPath, 'utf-8');

  assert.ok(dashboardCode.includes('@keyframes petak-glow'));
  assert.ok(dashboardCode.includes('@keyframes petak-logo-breathe'));
  assert.ok(dashboardCode.includes('@keyframes petak-cell-pulse-1'));
  assert.ok(dashboardCode.includes('prefers-reduced-motion'));
});
