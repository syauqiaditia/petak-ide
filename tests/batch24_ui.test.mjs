import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  isEntryStaged,
  isEntryUntracked,
  filterTrackedChanges,
  filterUnversionedFiles,
  formatGroupHeader,
  getFileContextActions,
} from '../ui/features/git/commitSelectionLogic.ts';

import {
  isImageFile,
  getImageFormat,
  getImageMimeType,
  formatFileSize,
  calculateZoom,
  IMAGE_EXTENSIONS,
} from '../ui/features/editor/imageUtils.ts';

import { api } from '../ui/lib/api.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uiRoot = path.resolve(__dirname, '../ui');

test('b24 UI 1: VCS Changes vs Unversioned Files pure logic and headers', () => {
  const trackedModified = {
    path: 'lib/main.dart',
    index: 'unmodified',
    worktree: 'modified',
    conflicted: false,
  };
  const trackedStaged = {
    path: 'lib/app.dart',
    index: 'modified',
    worktree: 'unmodified',
    conflicted: false,
  };
  const trackedAdded = {
    path: 'lib/new_staged.dart',
    index: 'added',
    worktree: 'unmodified',
    conflicted: false,
  };
  const untrackedFile = {
    path: 'assets/logo.png',
    index: 'untracked',
    worktree: 'untracked',
    conflicted: false,
  };

  assert.equal(isEntryStaged(trackedModified), false);
  assert.equal(isEntryStaged(trackedStaged), true);
  assert.equal(isEntryStaged(trackedAdded), true);
  assert.equal(isEntryStaged(untrackedFile), false);

  assert.equal(isEntryUntracked(trackedModified), false);
  assert.equal(isEntryUntracked(trackedStaged), false);
  assert.equal(isEntryUntracked(trackedAdded), false);
  assert.equal(isEntryUntracked(untrackedFile), true);

  const allEntries = [trackedModified, trackedStaged, trackedAdded, untrackedFile];
  const trackedList = filterTrackedChanges(allEntries);
  const untrackedList = filterUnversionedFiles(allEntries);

  assert.equal(trackedList.length, 3);
  assert.equal(trackedList.some((e) => e.path === 'assets/logo.png'), false);
  assert.equal(untrackedList.length, 1);
  assert.equal(untrackedList[0].path, 'assets/logo.png');

  assert.equal(formatGroupHeader('Changes', 1), 'Changes (1 file)');
  assert.equal(formatGroupHeader('Changes', 3), 'Changes (3 files)');
  assert.equal(formatGroupHeader('Unversioned Files', 1), 'Unversioned Files (1 file)');
  assert.equal(formatGroupHeader('Unversioned Files', 0), 'Unversioned Files (0 files)');

  // Context menu actions for untracked includes "Add to VCS"
  const actionsUntracked = getFileContextActions('assets/logo.png', false, true);
  assert.ok(actionsUntracked.some((a) => a.id === 'add_to_vcs'));
  assert.ok(actionsUntracked.some((a) => a.id === 'delete_untracked'));

  const actionsTracked = getFileContextActions('lib/main.dart', false, false);
  assert.equal(actionsTracked.some((a) => a.id === 'add_to_vcs'), false);
});

test('b24 UI 2: CommitPanel.svelte groups separation, click diff kind and context menu', () => {
  const panelPath = path.resolve(uiRoot, 'features/git/CommitPanel.svelte');
  const code = fs.readFileSync(panelPath, 'utf-8');

  // Must separate Changes and Unversioned Files
  assert.ok(code.includes("formatGroupHeader('Changes'"));
  assert.ok(code.includes("formatGroupHeader('Unversioned Files'"));
  assert.ok(code.includes('changesExpanded'));
  assert.ok(code.includes('unversionedExpanded'));

  // Onclick must use isEntryStaged and NEVER isChecked
  assert.ok(
    code.includes("isEntryStaged(entry) ? 'staged' : 'worktree'"),
    'Row click must use isEntryStaged pure function'
  );
  assert.ok(
    !code.includes("isChecked ? 'staged' : 'worktree'"),
    'Row click MUST NOT bind kind to isChecked'
  );

  // Context action add_to_vcs stages file
  assert.ok(code.includes("case 'add_to_vcs':"));
  assert.ok(code.includes('await gitStore.stageFiles([path])'));
});

test('b24 UI 3: git.svelte.ts loadDiff() automatic fallback to opposite kind', () => {
  const gitPath = path.resolve(uiRoot, 'features/git/git.svelte.ts');
  const code = fs.readFileSync(gitPath, 'utf-8');

  assert.ok(code.includes('async loadDiff()'));
  assert.ok(code.includes('oppositeKind'));
  assert.ok(code.includes("this.selectedFile.kind === 'staged' ? 'worktree' : 'staged'"));
  assert.ok(code.includes('fallbackFiles'));
});

test('b24 UI 4: In-IDE Image Preview utilities and format detection', () => {
  for (const ext of ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico']) {
    assert.equal(isImageFile(`path/to/image${ext}`), true);
    assert.equal(isImageFile(`path/to/IMAGE${ext.toUpperCase()}`), true);
  }
  assert.equal(isImageFile('lib/main.dart'), false);
  assert.equal(isImageFile('pubspec.yaml'), false);
  assert.equal(isImageFile(''), false);
  assert.equal(isImageFile(null), false);

  assert.equal(getImageFormat('photo.png'), 'PNG');
  assert.equal(getImageFormat('photo.jpg'), 'JPEG');
  assert.equal(getImageFormat('vector.svg'), 'SVG');

  assert.equal(getImageMimeType('photo.png'), 'image/png');
  assert.equal(getImageMimeType('photo.jpeg'), 'image/jpeg');
  assert.equal(getImageMimeType('vector.svg'), 'image/svg+xml');

  assert.equal(formatFileSize(500), '500 B');
  assert.equal(formatFileSize(2048), '2.0 KB');
  assert.equal(formatFileSize(1048576 * 2.5), '2.50 MB');

  assert.equal(calculateZoom(1, 'in'), 1.25);
  assert.equal(calculateZoom(1.25, 'out'), 1);
  assert.equal(calculateZoom(2.5, 'reset'), 1);
});

test('b24 UI 5: ImagePreview.svelte and Editor.svelte integration', () => {
  const previewPath = path.resolve(uiRoot, 'features/editor/ImagePreview.svelte');
  assert.ok(fs.existsSync(previewPath));
  const previewCode = fs.readFileSync(previewPath, 'utf-8');

  // Checkerboard CSS
  assert.ok(previewCode.includes('checkerboard'));
  assert.ok(previewCode.includes('linear-gradient(45deg'));

  // Status bar info
  assert.ok(previewCode.includes('Dimensi:'));
  assert.ok(previewCode.includes('Ukuran:'));
  assert.ok(previewCode.includes('Format:'));

  // Toolbar mini actions
  assert.ok(previewCode.includes('handleZoomIn'));
  assert.ok(previewCode.includes('handleZoomOut'));
  assert.ok(previewCode.includes('handleZoomReset'));
  assert.ok(previewCode.includes('handleFitToScreen'));

  // Editor.svelte switches to ImagePreview for image tabs
  const editorPath = path.resolve(uiRoot, 'features/editor/Editor.svelte');
  const editorCode = fs.readFileSync(editorPath, 'utf-8');
  assert.ok(editorCode.includes('ImagePreview'));
  assert.ok(editorCode.includes('isImageFile'));
  assert.ok(editorCode.includes('activeIsImage'));
  assert.ok(editorCode.includes('<ImagePreview filePath={tabsManager.activeTab.path} />'));
});

test('b24 UI 6: api.ts declares readFileBase64 and RunConfig additionalArgs', () => {
  const apiPath = path.resolve(uiRoot, 'lib/api.ts');
  const apiCode = fs.readFileSync(apiPath, 'utf-8');

  assert.ok(apiCode.includes('readFileBase64(path: string): Promise<string>'));
  assert.ok(apiCode.includes('additionalArgs?: string | null;'));
  assert.equal(typeof api.readFileBase64, 'function');
});

test('b24 UI 7: RunConfigDialog.svelte draft system, selectedConfigName and additionalArgs binding', () => {
  const dialogPath = path.resolve(uiRoot, 'features/run/RunConfigDialog.svelte');
  const dialogCode = fs.readFileSync(dialogPath, 'utf-8');

  // String selectedConfigName
  assert.ok(dialogCode.includes('selectedConfigName = $state'));
  assert.ok(!dialogCode.includes('selectedConfigIndex'));

  // Operations: Add, Remove, Duplicate
  assert.ok(dialogCode.includes('handleAddConfig'));
  assert.ok(dialogCode.includes('handleRemoveConfig'));
  assert.ok(dialogCode.includes('handleDuplicateConfig'));

  // Form bindings
  assert.ok(dialogCode.includes('bind:value={currentSelectedConfig.additionalArgs}'));
  assert.ok(dialogCode.includes('entrypoint-suggestions') || dialogCode.includes('suggestedEntrypoints'));
  assert.ok(dialogCode.includes('bind:value={currentSelectedConfig.flavor}'));

  // Footer draft actions
  assert.ok(dialogCode.includes('Batal'));
  assert.ok(dialogCode.includes('Terapkan'));
  assert.ok(dialogCode.includes('OK'));
  assert.ok(dialogCode.includes('✓ Diterapkan'));
});
