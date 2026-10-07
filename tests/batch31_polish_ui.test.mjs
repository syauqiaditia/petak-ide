import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  stripAnsi,
  parseAnsiToTokens,
  parseAnsiToHtml,
  findMatchingLineIndices,
  formatRunLogLineHtml,
} from '../ui/features/run/ansi.ts';

import {
  shouldPlaceHoverAbove,
  computeTooltipMaxWidth,
} from '../ui/features/editor/lsp/hoverLogic.ts';

import {
  getSearchQueryFromSelection,
} from '../ui/features/editor/searchLogic.ts';

import { portal } from '../ui/shell/portal.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uiRoot = path.resolve(__dirname, '../ui');

// =============================================================================
// Suite 1: ANSI Color Parser (parseAnsiToHtml, parseAnsiToTokens, stripAnsi)
// =============================================================================

test('b31 Polish UI 1: stripAnsi strips escape codes cleanly', () => {
  const raw = '\x1b[31mError:\x1b[0m \x1b[1;32mBuild succeeded\x1b[0m in \x1b[33m120ms\x1b[0m';
  const clean = stripAnsi(raw);
  assert.equal(clean, 'Error: Build succeeded in 120ms');
  assert.equal(stripAnsi(''), '');
  assert.equal(stripAnsi('Plain text'), 'Plain text');
});

test('b31 Polish UI 1b: parseAnsiToTokens parses colors and attributes', () => {
  const raw = '\x1b[31mRedText\x1b[0m\x1b[1;32mGreenBold\x1b[0mNormal';
  const tokens = parseAnsiToTokens(raw);

  assert.equal(tokens.length, 3);
  assert.equal(tokens[0].text, 'RedText');
  assert.equal(tokens[0].color, '#f07a74'); // Red
  assert.equal(tokens[0].bold, undefined);

  assert.equal(tokens[1].text, 'GreenBold');
  assert.equal(tokens[1].color, '#5cdb95'); // Green
  assert.equal(tokens[1].bold, true);

  assert.equal(tokens[2].text, 'Normal');
  assert.equal(tokens[2].color, undefined);
  assert.equal(tokens[2].bold, undefined);
});

test('b31 Polish UI 1c: parseAnsiToHtml converts escape codes to styled HTML spans', () => {
  // 1. Red for error/stderr
  const redHtml = parseAnsiToHtml('\x1b[31mUncaught Error: Crash\x1b[0m');
  assert.match(redHtml, /<span style="[^"]*color: #f07a74;[^"]*">Uncaught Error: Crash<\/span>/);

  // 2. Green for reload/success
  const greenHtml = parseAnsiToHtml('\x1b[32mReloaded 1 of 550 libraries in 180ms\x1b[0m');
  assert.match(greenHtml, /<span style="[^"]*color: #5cdb95;[^"]*">Reloaded 1 of 550 libraries in 180ms<\/span>/);

  // 3. Yellow for warning
  const yellowHtml = parseAnsiToHtml('\x1b[33mWarning: deprecated API\x1b[0m');
  assert.match(yellowHtml, /<span style="[^"]*color: #e8b45a;[^"]*">Warning: deprecated API<\/span>/);

  // 4. Cyan / Blue for info & tags
  const cyanHtml = parseAnsiToHtml('\x1b[36m[flutter.tools]\x1b[0m App running');
  assert.match(cyanHtml, /<span style="[^"]*color: #4ec9b0;[^"]*">\[flutter\.tools\]<\/span>/);

  const blueHtml = parseAnsiToHtml('\x1b[34m[INFO]\x1b[0m Service started');
  assert.match(blueHtml, /<span style="[^"]*color: #64a0f4;[^"]*">\[INFO\]<\/span>/);

  // 5. Default stderr stream fallback
  const stderrHtml = parseAnsiToHtml('Standard error line without ANSI', 'stderr');
  assert.match(stderrHtml, /<span style="[^"]*color: #f07a74;[^"]*">Standard error line without ANSI<\/span>/);

  // 6. Combined bold + green
  const boldGreenHtml = parseAnsiToHtml('\x1b[1;32mHot restart completed.\x1b[0m');
  assert.match(boldGreenHtml, /color: #5cdb95;/);
  assert.match(boldGreenHtml, /font-weight: bold;/);
});

// =============================================================================
// Suite 2: Full Retention Run Log Search & Navigation (findMatchingLineIndices)
// =============================================================================

test('b31 Polish UI 2: search logic retains all lines and returns matching indices', () => {
  const logLines = [
    { line: 'Launching lib/main.dart on macOS in debug mode...' },
    { line: '\x1b[36m[flutter.tools]\x1b[0m Compiling flutter_assets...' },
    { line: '\x1b[33mWarning: Use of deprecated member\x1b[0m' },
    { line: 'Syncing files to device...' },
    { line: '\x1b[32mReloaded 1 of 500 libraries in 210ms\x1b[0m' },
    { line: '\x1b[31mError: Null pointer exception at line 42\x1b[0m' },
  ];

  // Search "Reloaded" -> finds line index 4
  const reloadMatches = findMatchingLineIndices(logLines, 'Reloaded');
  assert.deepEqual(reloadMatches, [4]);

  // Search "error" (case-insensitive) -> finds line index 5
  const errorMatches = findMatchingLineIndices(logLines, 'error');
  assert.deepEqual(errorMatches, [5]);

  // Search "deprecated" -> finds line index 2
  const depMatches = findMatchingLineIndices(logLines, 'deprecated');
  assert.deepEqual(depMatches, [2]);

  // Multiple matches: "flutter" matches index 1
  const flutterMatches = findMatchingLineIndices(logLines, 'flutter');
  assert.deepEqual(flutterMatches, [1]);

  // Empty query returns empty array
  assert.deepEqual(findMatchingLineIndices(logLines, ''), []);
  assert.deepEqual(findMatchingLineIndices(logLines, '   '), []);

  // Non-matching query returns empty array
  assert.deepEqual(findMatchingLineIndices(logLines, 'nonexistent_token'), []);
});

test('b31 Polish UI 2b: formatRunLogLineHtml highlights search matches', () => {
  const rawLine = '\x1b[31mUnhandled Exception: Network timeout\x1b[0m';
  const html = formatRunLogLineHtml(rawLine, 'stdout', 'timeout', false);

  assert.match(html, /<mark class="run-search-highlight">timeout<\/mark>/);
  assert.match(html, /color: #f07a74;/);

  // Active line match gets "is-active" class
  const activeHtml = formatRunLogLineHtml(rawLine, 'stdout', 'timeout', true);
  assert.match(activeHtml, /<mark class="run-search-highlight is-active">timeout<\/mark>/);
});

// =============================================================================
// Suite 3: Adaptive Hover Tooltip (shouldPlaceHoverAbove & computeTooltipMaxWidth)
// =============================================================================

test('b31 Polish UI 3: shouldPlaceHoverAbove forces above: true when remaining bottom space < 260px', () => {
  const editorRect = { top: 40, bottom: 600, right: 900 };
  const viewportHeight = 700;

  // Case 1: Cursor near bottom dock (visualPos.bottom = 450, remaining to editor.bottom = 150 < 260px)
  const visualNearBottom = { top: 430, bottom: 450 };
  const placeAbove1 = shouldPlaceHoverAbove(visualNearBottom, editorRect, viewportHeight, null);
  assert.equal(placeAbove1, true, 'Should force above: true when bottom space is 150px (< 260px)');

  // Case 2: Cursor with bottom dock open at top = 500 (visualPos.bottom = 300, remaining to dock = 200 < 260px)
  const visualNearDock = { top: 280, bottom: 300 };
  const placeAbove2 = shouldPlaceHoverAbove(visualNearDock, editorRect, viewportHeight, 500);
  assert.equal(placeAbove2, true, 'Should force above: true when dockTop restricts space to 200px (< 260px)');

  // Case 3: Cursor with plenty of bottom space (visualPos.bottom = 150, remaining to dock = 350 >= 260px)
  const visualPlentySpace = { top: 130, bottom: 150 };
  const placeAbove3 = shouldPlaceHoverAbove(visualPlentySpace, editorRect, viewportHeight, 500);
  assert.equal(placeAbove3, false, 'Should place below when remaining space is >= 260px');

  // Case 4: Null visualPos returns false
  assert.equal(shouldPlaceHoverAbove(null, editorRect, viewportHeight), false);
});

test('b31 Polish UI 3b: computeTooltipMaxWidth constrains width to editor boundary', () => {
  // Wide editor width: 800px -> capped at maxCap (560px)
  const width1 = computeTooltipMaxWidth(800);
  assert.equal(width1, 560);

  // Narrow editor: 300px -> clamped to editorWidth - 24 = 276px
  const width2 = computeTooltipMaxWidth(300);
  assert.equal(width2, 276);

  // Minimum clamp at 260px
  const width3 = computeTooltipMaxWidth(200);
  assert.equal(width3, 260);

  // When right space is tight: clamped to 260px minimum
  const width4 = computeTooltipMaxWidth(500, 350, 500);
  assert.equal(width4, 260);
});

// =============================================================================
// Suite 4: Search Auto-Populate from Active Selection (getSearchQueryFromSelection)
// =============================================================================

test('b31 Polish UI 4: getSearchQueryFromSelection populates single-line query', () => {
  // 1. Single-line identifier
  assert.equal(getSearchQueryFromSelection('myVariable'), 'myVariable');

  // 2. Multiline selection takes first line only
  assert.equal(
    getSearchQueryFromSelection('firstLineIdentifier\nsecondLineIgnored\nthirdLine'),
    'firstLineIdentifier'
  );

  // 3. Windows CRLF multiline selection
  assert.equal(
    getSearchQueryFromSelection('windowsHeader\r\nwindowsBody'),
    'windowsHeader'
  );

  // 4. Empty or null/undefined
  assert.equal(getSearchQueryFromSelection(''), '');
  assert.equal(getSearchQueryFromSelection(null), '');
  assert.equal(getSearchQueryFromSelection(undefined), '');
});

// =============================================================================
// Suite 5: Portal Action, Stacking Context & Component Integrations
// =============================================================================

test('b31 Polish UI 5: portal action and ContextMenu z-index 99999', () => {
  // Test portal action exists and is callable
  assert.equal(typeof portal, 'function');

  // Verify ContextMenu.svelte source file contains z-index: 99999 and use:portal
  const contextMenuFile = fs.readFileSync(path.join(uiRoot, 'shell/ContextMenu.svelte'), 'utf-8');
  assert.match(contextMenuFile, /use:portal/, 'ContextMenu must use portal action');
  assert.match(contextMenuFile, /z-index:\s*99999/, 'ContextMenu must have z-index: 99999');

  // Verify FileTree and Editor render ContextMenu
  const fileTreeFile = fs.readFileSync(path.join(uiRoot, 'shell/FileTree.svelte'), 'utf-8');
  assert.match(fileTreeFile, /<ContextMenu/, 'FileTree must render ContextMenu');

  const editorFile = fs.readFileSync(path.join(uiRoot, 'features/editor/Editor.svelte'), 'utf-8');
  assert.match(editorFile, /<ContextMenu/, 'Editor must render ContextMenu');

  // Verify FindReplaceBar has auto-populate and auto-focus
  const findReplaceFile = fs.readFileSync(path.join(uiRoot, 'features/editor/FindReplaceBar.svelte'), 'utf-8');
  assert.match(findReplaceFile, /getSearchQueryFromSelection/, 'FindReplaceBar must import selection helper');
  assert.match(findReplaceFile, /searchInputEl\?\.focus\(\)/, 'FindReplaceBar must auto-focus search input');

  // Verify ProblemsPanel has summary badges and jump to code
  const problemsFile = fs.readFileSync(path.join(uiRoot, 'features/problems/ProblemsPanel.svelte'), 'utf-8');
  assert.match(problemsFile, /Errors \(\{totalErrors\}\)/, 'ProblemsPanel must display error summary badge');
  assert.match(problemsFile, /Warnings \(\{totalWarnings\}\)/, 'ProblemsPanel must display warning summary badge');
  assert.match(problemsFile, /jump-link-action/, 'ProblemsPanel must have jump to code link');

  // Verify LogcatPanel has responsive toolbar
  const logcatFile = fs.readFileSync(path.join(uiRoot, 'features/run/LogcatPanel.svelte'), 'utf-8');
  assert.match(logcatFile, /toolbar-left/, 'LogcatPanel must have left toolbar controls');
  assert.match(logcatFile, /toolbar-right/, 'LogcatPanel must have right toolbar controls');

  // Verify RunPanel retains all lines and has ANSI parser
  const runPanelFile = fs.readFileSync(path.join(uiRoot, 'features/run/RunPanel.svelte'), 'utf-8');
  assert.match(runPanelFile, /findMatchingLineIndices/, 'RunPanel must import findMatchingLineIndices');
  assert.match(runPanelFile, /formatRunLogLineHtml/, 'RunPanel must import formatRunLogLineHtml');
});
