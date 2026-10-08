import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Provide Svelte 5 rune polyfills before loading .svelte.ts modules
globalThis.$state = (v) => v;
globalThis.$derived = (v) => (typeof v === 'function' ? v() : v);
globalThis.$effect = () => {};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

// Dynamically import modules so rune polyfills are initialized first
const {
  findMatches,
  getActiveMatchIndex,
  getNextMatchIndex,
  getPrevMatchIndex,
  formatMatchCount,
  replaceOne,
  replaceAll,
  getSearchQueryFromSelection,
} = await import('../ui/features/editor/searchLogic.ts');

const {
  isDeclarationSite,
  isSymbolPrivate,
  resolveNavAction,
} = await import('../ui/features/editor/lsp/nav.svelte.ts');

const { tabsManager } = await import('../ui/features/editor/tabs.svelte.ts');

const { EditorSettings } = await import('../ui/features/editor/editorSettingsLogic.ts');
const { darculaTheme } = await import('../ui/features/editor/themeDarcula.ts');

const {
  computeVcsLineChanges,
  formatBlameInline,
} = await import('../ui/features/editor/vcsGutter.ts');

const {
  calculateIndentLevel,
  findMatchingBrackets,
} = await import('../ui/features/editor/indentGuides.ts');

test('Batch 37 - 1. Search & Replace Logic: Regex, Matches & Navigation', () => {
  const doc = `function helloWorld() {\n  const message = "hello world";\n  console.log(message);\n  return "hello";\n}`;

  // Case insensitive match
  const matches = findMatches(doc, 'hello', { caseSensitive: false, wholeWord: false, isRegex: false });
  assert.equal(matches.length, 3, 'Should find 3 matches of "hello"');

  // Case sensitive match
  const caseMatches = findMatches(doc, 'hello', { caseSensitive: true, wholeWord: false, isRegex: false });
  assert.equal(caseMatches.length, 3, 'Should match exact case');

  // Whole word match
  const wordMatches = findMatches(doc, 'hello', { caseSensitive: false, wholeWord: true, isRegex: false });
  assert.equal(wordMatches.length, 2, 'Should match whole word "hello" only (excluding helloWorld)');

  // Active match index inside range
  const idx0 = getActiveMatchIndex(matches, matches[0].from + 2);
  assert.equal(idx0, 0, 'Cursor inside match 0 should yield active index 0');

  const idx1 = getActiveMatchIndex(matches, matches[1].from);
  assert.equal(idx1, 1, 'Cursor at start of match 1 should yield active index 1');

  // Wrap navigation without 0/0 error
  assert.equal(getNextMatchIndex(0, matches.length), 1);
  assert.equal(getNextMatchIndex(2, matches.length), 0);
  assert.equal(getPrevMatchIndex(0, matches.length), 2);
  assert.equal(getPrevMatchIndex(1, matches.length), 0);

  // Match count formatting
  assert.equal(formatMatchCount(0, 3, 'hello'), '1/3');
  assert.equal(formatMatchCount(2, 3, 'hello'), '3/3');
  assert.equal(formatMatchCount(0, 0, 'unknown'), '0 results');
  assert.equal(formatMatchCount(0, 0, ''), '');

  // Selection masking
  assert.equal(getSearchQueryFromSelection('selectedText'), 'selectedText');
  assert.equal(getSearchQueryFromSelection('firstLine\nsecondLine'), 'firstLine');
  assert.equal(getSearchQueryFromSelection(''), '');

  // Replace one & Replace all
  const repOne = replaceOne(doc, matches[0], 'greet');
  assert.match(repOne.newDocText, /^function greetWorld/);

  const repAll = replaceAll(doc, 'hello', 'hi', { caseSensitive: false, wholeWord: false, isRegex: false });
  assert.equal(repAll.count, 3);
  assert.ok(!repAll.newDocText.includes('hello'));
});

test('Batch 37 - 2. ⌘+Click (Go to Definition & Usages) Cerdas', () => {
  // Call site vs Declaration site detection
  const currentPath = '/project/lib/user.dart';
  const currentLine = 42;

  // If definition points to line 10 in same file -> Call site
  assert.equal(
    isDeclarationSite(currentPath, currentLine, 'file:///project/lib/user.dart', 10),
    false,
    'Pointing to different line should be identified as call site'
  );

  // If definition points to line 42 in same file -> Declaration site
  assert.equal(
    isDeclarationSite(currentPath, currentLine, 'file:///project/lib/user.dart', 42),
    true,
    'Pointing to same file and line should be identified as declaration site'
  );

  // Private vs Public symbol classification
  assert.equal(isSymbolPrivate('_loadUserData'), true, 'Symbol starting with _ is private');
  assert.equal(isSymbolPrivate('#privateField'), true, 'Symbol starting with # is private');
  assert.equal(isSymbolPrivate('getUserData'), false, 'Public symbol');

  // Resolve Nav Action decisions:
  // 1. Call site -> jump-to-def
  const actDef = resolveNavAction({
    isDeclaration: false,
    defPath: '/project/lib/auth.dart',
    defLine: 15,
    defCol: 5,
    usages: [],
    symbolName: 'authenticate',
  });
  assert.equal(actDef.type, 'jump-to-def');

  // 2. Declaration site with 0 usages -> show-unused-tooltip
  const actUnused = resolveNavAction({
    isDeclaration: true,
    usages: [],
    symbolName: '_deadFunction',
  });
  assert.equal(actUnused.type, 'show-unused-tooltip');
  assert.equal(actUnused.message, 'tidak terpakai (0 usages)');

  // 3. Declaration site with exactly 1 usage -> jump-to-usage
  const actSingle = resolveNavAction({
    isDeclaration: true,
    usages: [
      {
        path: '/project/lib/main.dart',
        name: 'main.dart',
        line: 55,
        col: 12,
        text: 'final res = helper();',
      },
    ],
    symbolName: 'helper',
  });
  assert.equal(actSingle.type, 'jump-to-usage');
  assert.equal(actSingle.targetPath, '/project/lib/main.dart');
  assert.equal(actSingle.line, 55);

  // 4. Declaration site with >1 usages & private -> dropdown list
  const actMultiPriv = resolveNavAction({
    isDeclaration: true,
    usages: [
      { path: '/a.dart', name: 'a.dart', line: 1, col: 1, text: 'a' },
      { path: '/b.dart', name: 'b.dart', line: 2, col: 1, text: 'b' },
    ],
    symbolName: '_privateHelper',
  });
  assert.equal(actMultiPriv.type, 'show-usages-dropdown');
  assert.equal(actMultiPriv.isPrivate, true);

  // 5. Declaration site with >1 usages & public -> dropdown with preview
  const actMultiPub = resolveNavAction({
    isDeclaration: true,
    usages: [
      { path: '/a.dart', name: 'a.dart', line: 10, col: 1, text: 'a', previewLines: ['line 9', 'line 10', 'line 11'] },
      { path: '/b.dart', name: 'b.dart', line: 20, col: 1, text: 'b', previewLines: ['line 19', 'line 20', 'line 21'] },
    ],
    symbolName: 'publicService',
  });
  assert.equal(actMultiPub.type, 'show-usages-dropdown');
  assert.equal(actMultiPub.isPrivate, false);
});

test('Batch 37 - 3. Retensi Posisi Scroll per Tab', () => {
  tabsManager.clearAll();

  const tabA = tabsManager.openTab('/workspace/A.dart', 'A.dart', 'content A');
  const tabB = tabsManager.openTab('/workspace/B.dart', 'B.dart', 'content B');

  // Save view state for Tab A
  tabsManager.saveViewState('/workspace/A.dart', {
    scrollTop: 450,
    scrollLeft: 20,
    cursorHead: 120,
    cursorAnchor: 120,
  });

  // Save view state for Tab B
  tabsManager.saveViewState('/workspace/B.dart', {
    scrollTop: 1200,
    scrollLeft: 0,
    cursorHead: 350,
    cursorAnchor: 350,
  });

  // Check retrieval
  const stateA = tabsManager.getViewState('/workspace/A.dart');
  assert.ok(stateA);
  assert.equal(stateA.scrollTop, 450);
  assert.equal(stateA.scrollLeft, 20);
  assert.equal(stateA.cursorHead, 120);

  const stateB = tabsManager.getViewState('/workspace/B.dart');
  assert.ok(stateB);
  assert.equal(stateB.scrollTop, 1200);
  assert.equal(stateB.cursorHead, 350);

  // Switch tabs and verify retention
  tabsManager.setActive('/workspace/A.dart');
  const curStateA = tabsManager.getViewState(tabsManager.activePath);
  assert.equal(curStateA?.scrollTop, 450);

  tabsManager.setActive('/workspace/B.dart');
  const curStateB = tabsManager.getViewState(tabsManager.activePath);
  assert.equal(curStateB?.scrollTop, 1200);
});

test('Batch 37 - 4. Tema Android Studio Dark (Darcula / New UI)', () => {
  // Theme extension exists and is valid
  assert.ok(darculaTheme, 'darculaTheme must be defined');

  // EditorSettings contains theme property and defaults to darcula
  const settings = new EditorSettings();
  assert.equal(settings.theme, 'darcula', 'Default editor theme should be darcula');

  let updatedTheme = '';
  settings.onThemeChange((t) => {
    updatedTheme = t;
  });

  settings.setTheme('custom-dark');
  assert.equal(settings.theme, 'custom-dark');
  assert.equal(updatedTheme, 'custom-dark');

  // Verify themeDarcula.ts color tokens
  const themeFile = fs.readFileSync(path.join(ROOT, 'ui/features/editor/themeDarcula.ts'), 'utf-8');
  assert.ok(themeFile.includes('#1e1f22'), 'Darcula theme must use slate gray #1e1f22 background');
  assert.ok(themeFile.includes('#2b2d30'), 'Darcula theme must use #2b2d30 for active line & border');
  assert.ok(themeFile.includes('#214283'), 'Darcula theme must use high-contrast selection #214283');
});

test('Batch 37 - 5. VCS Gutter Markers & Git Blame', () => {
  const orig = `line 1\nline 2\nline 3`;
  const modified = `line 1\nline 2 modified\nline 3\nline 4 added`;

  const changes = computeVcsLineChanges(orig, modified);
  assert.ok(changes.size > 0, 'Should detect changes');
  assert.equal(changes.get(2), 'modified', 'Line 2 should be marked modified');
  assert.equal(changes.get(4), 'added', 'Line 4 should be marked added');

  // Deleted lines detection
  const shortened = `line 1\nline 3`;
  const delChanges = computeVcsLineChanges(orig, shortened);
  assert.ok(delChanges.has(2), 'Boundary should indicate deleted lines');

  // Inline Blame formatting
  const formatted = formatBlameInline('Syauqi', Math.floor(Date.now() / 1000) - 120, 'feat(editor): parity');
  assert.ok(formatted.startsWith('Syauqi, 2m ago • feat(editor): parity'));
});

test('Batch 37 - 6. Indent Guides & Bracket Matching Lines', () => {
  // Indent level calculation
  assert.equal(calculateIndentLevel('    const x = 1;', 2), 2);
  assert.equal(calculateIndentLevel('  const x = 1;', 2), 1);
  assert.equal(calculateIndentLevel('\t\tconst x = 1;', 2), 2);
  assert.equal(calculateIndentLevel('const x = 1;', 2), 0);

  // Bracket matching multiline
  const code = `function test() {\n  const a = 1;\n  const b = 2;\n}`;
  const match = findMatchingBrackets(code, 20); // inside function body
  assert.ok(match, 'Should find matching bracket pair');
  assert.equal(match.openLine, 1);
  assert.equal(match.closeLine, 4);

  // Single-line brackets return null (no vertical guide needed)
  const singleLine = `const arr = [1, 2, 3];`;
  const noMatch = findMatchingBrackets(singleLine, 15);
  assert.equal(noMatch, null, 'Single line bracket should return null');
});

test('Batch 37 - 7. Svelte Components & Editor Integration Verification', () => {
  // FindReplaceBar.svelte verification
  const findReplaceSource = fs.readFileSync(path.join(ROOT, 'ui/features/editor/FindReplaceBar.svelte'), 'utf-8');
  assert.ok(findReplaceSource.includes('Cc'), 'FindReplaceBar must have Cc toggle');
  assert.ok(findReplaceSource.includes('W'), 'FindReplaceBar must have W toggle');
  assert.ok(findReplaceSource.includes('.*'), 'FindReplaceBar must have .* toggle');
  assert.ok(findReplaceSource.includes('▲') && findReplaceSource.includes('▼'), 'FindReplaceBar must have ▲ and ▼ buttons');
  assert.ok(findReplaceSource.includes('filter-btn'), 'FindReplaceBar must have filter button');
  assert.ok(findReplaceSource.includes('close-btn'), 'FindReplaceBar must have close button');
  assert.ok(findReplaceSource.includes('Replace All'), 'FindReplaceBar must have Replace All button');
  assert.ok(findReplaceSource.includes('Exclude'), 'FindReplaceBar must have Exclude button');
  assert.ok(findReplaceSource.includes('formatMatchCount'), 'FindReplaceBar must format match count without 0/0 error');

  // NavUsagesPopup.svelte verification
  const popupSource = fs.readFileSync(path.join(ROOT, 'ui/features/editor/NavUsagesPopup.svelte'), 'utf-8');
  assert.ok(popupSource.includes('nav-tooltip'), 'NavUsagesPopup must have tooltip view');
  assert.ok(popupSource.includes('tidak terpakai'), 'NavUsagesPopup must support tidak terpakai copy');
  assert.ok(popupSource.includes('nav-dropdown'), 'NavUsagesPopup must have dropdown view');
  assert.ok(popupSource.includes('previewLines'), 'NavUsagesPopup must display multiline previews');

  // Editor.svelte verification
  const editorSource = fs.readFileSync(path.join(ROOT, 'ui/features/editor/Editor.svelte'), 'utf-8');
  assert.ok(editorSource.includes('darculaTheme'), 'Editor must include darculaTheme');
  assert.ok(editorSource.includes('searchHighlightField'), 'Editor must include searchHighlightField');
  assert.ok(editorSource.includes('createVcsGutterExtension'), 'Editor must include VCS gutter extension');
  assert.ok(editorSource.includes('createInlineBlameExtension'), 'Editor must include inline blame extension');
  assert.ok(editorSource.includes('createIndentGuidesExtension'), 'Editor must include indent guides extension');
  assert.ok(editorSource.includes('NavUsagesPopup'), 'Editor must include NavUsagesPopup');
  assert.ok(editorSource.includes('saveViewState'), 'Editor must save view state on tab switch');
  assert.ok(editorSource.includes('getViewState'), 'Editor must restore view state on tab switch');
});
