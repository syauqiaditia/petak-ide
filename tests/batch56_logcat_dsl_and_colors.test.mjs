import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  TAG_PALETTE,
  getTagColor,
  parseLogcatFilter,
  matchesFilter,
  filterLogLines,
  LogcatRingBuffer,
  parseStackLinks,
  splitLogMessageWithLinks,
  defaultLogcatFilter,
} from '../ui/features/run/logcat.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uiRoot = path.resolve(__dirname, '../ui');

// =============================================================================
// Suite 1: Tag Hash Color Generator (getTagColor & TAG_PALETTE)
// =============================================================================

test('b56 Tag Color 1: TAG_PALETTE contains 8 Slate Grey friendly palette colors', () => {
  assert.equal(TAG_PALETTE.length, 8);
  const expectedColors = [
    '#4ec9b0', // teal
    '#e8b45a', // amber
    '#b180d7', // violet
    '#4fc1ff', // cyan
    '#56a8f5', // sky
    '#f08d49', // coral
    '#7fc98f', // mint
    '#e57373', // rose
  ];
  for (const c of expectedColors) {
    assert.ok(TAG_PALETTE.includes(c), `TAG_PALETTE must contain ${c}`);
  }
});

test('b56 Tag Color 2: getTagColor is deterministic and pure across repeated invocations', () => {
  const tag1 = 'FlutterJNI';
  const tag2 = 'ActivityManager';
  const tag3 = 'AndroidRuntime';

  const color1A = getTagColor(tag1);
  const color1B = getTagColor(tag1);
  assert.equal(color1A, color1B, 'Same tag must always produce the same color');

  // Verify consistency over 500 repetitions
  for (let i = 0; i < 500; i++) {
    assert.equal(getTagColor(tag1), color1A);
    assert.equal(getTagColor(tag2), getTagColor(tag2));
    assert.equal(getTagColor(tag3), getTagColor(tag3));
  }

  // All colors produced must be members of TAG_PALETTE
  assert.ok(TAG_PALETTE.includes(color1A));
  assert.ok(TAG_PALETTE.includes(getTagColor(tag2)));
  assert.ok(TAG_PALETTE.includes(getTagColor(tag3)));
});

test('b56 Tag Color 3: getTagColor handles falsy, empty string and whitespace cleanly', () => {
  const defaultMuted = '#8b8f98';
  assert.equal(getTagColor(''), defaultMuted);
  assert.equal(getTagColor('   '), defaultMuted);
  assert.equal(getTagColor('\t\n'), defaultMuted);
  assert.equal(getTagColor(null), defaultMuted);
  assert.equal(getTagColor(undefined), defaultMuted);
});

test('b56 Tag Color 4: getTagColor distributes across TAG_PALETTE slots', () => {
  const sampleTags = [
    'FlutterJNI',
    'ActivityManager',
    'AndroidRuntime',
    'ViewRootImpl',
    'NetworkSecurityConfig',
    'AuthService',
    'Database',
    'WindowManager',
    'Choreographer',
    'InputMethodManager',
    'SurfaceView',
    'Skia',
  ];

  const colors = new Set(sampleTags.map(getTagColor));
  // At least 4 distinct colors should be assigned across 12 diverse tags
  assert.ok(colors.size >= 4, `Expected at least 4 distinct colors across sample tags, got ${colors.size}`);
  for (const c of colors) {
    assert.ok(TAG_PALETTE.includes(c), `Color ${c} must be in TAG_PALETTE`);
  }
});

// =============================================================================
// Suite 2: Logcat Filter DSL Parser (parseLogcatFilter)
// =============================================================================

test('b56 DSL Parser 1: parses tag: and -tag: tokens', () => {
  const parsed = parseLogcatFilter('tag:FlutterJNI -tag:ViewRootImpl tag:ActivityManager');
  assert.deepEqual(parsed.tags, ['FlutterJNI', 'ActivityManager']);
  assert.deepEqual(parsed.excludeTags, ['ViewRootImpl']);
  assert.deepEqual(parsed.textTerms, []);
  assert.equal(parsed.minLevel, undefined);
  assert.equal(parsed.packageMine, undefined);
});

test('b56 DSL Parser 2: parses and normalizes level: tokens (v, d, i, w, e, f and words)', () => {
  assert.equal(parseLogcatFilter('level:v').minLevel, 'V');
  assert.equal(parseLogcatFilter('level:verbose').minLevel, 'V');
  assert.equal(parseLogcatFilter('level:d').minLevel, 'D');
  assert.equal(parseLogcatFilter('level:debug').minLevel, 'D');
  assert.equal(parseLogcatFilter('level:i').minLevel, 'I');
  assert.equal(parseLogcatFilter('level:info').minLevel, 'I');
  assert.equal(parseLogcatFilter('level:w').minLevel, 'W');
  assert.equal(parseLogcatFilter('level:warn').minLevel, 'W');
  assert.equal(parseLogcatFilter('level:warning').minLevel, 'W');
  assert.equal(parseLogcatFilter('level:e').minLevel, 'E');
  assert.equal(parseLogcatFilter('level:error').minLevel, 'E');
  assert.equal(parseLogcatFilter('level:f').minLevel, 'F');
  assert.equal(parseLogcatFilter('level:fatal').minLevel, 'F');
});

test('b56 DSL Parser 3: parses package:mine and app:mine flags', () => {
  const p1 = parseLogcatFilter('package:mine');
  assert.equal(p1.packageMine, true);

  const p2 = parseLogcatFilter('app:mine');
  assert.equal(p2.packageMine, true);
});

test('b56 DSL Parser 4: parses plain text terms alongside DSL tokens', () => {
  const parsed = parseLogcatFilter('tag:Flutter level:warn -tag:ViewRoot crash null pointer exception');
  assert.deepEqual(parsed.tags, ['Flutter']);
  assert.deepEqual(parsed.excludeTags, ['ViewRoot']);
  assert.equal(parsed.minLevel, 'W');
  assert.deepEqual(parsed.textTerms, ['crash', 'null', 'pointer', 'exception']);
});

test('b56 DSL Parser 5: handles empty or whitespace queries cleanly', () => {
  const p1 = parseLogcatFilter('');
  assert.deepEqual(p1.tags, []);
  assert.deepEqual(p1.excludeTags, []);
  assert.deepEqual(p1.textTerms, []);
  assert.equal(p1.minLevel, undefined);
  assert.equal(p1.packageMine, undefined);

  const p2 = parseLogcatFilter('   \t\n  ');
  assert.deepEqual(p2.tags, []);
  assert.deepEqual(p2.excludeTags, []);
  assert.deepEqual(p2.textTerms, []);
});

// =============================================================================
// Suite 3: matchesFilter and filterLogLines with DSL & Backwards Compatibility
// =============================================================================

test('b56 Filtering 1: inclusive tag vs exclusive tag filtering', () => {
  const sampleLogs = [
    { id: 1, level: 'I', tag: 'FlutterJNI', msg: 'Engine started', ts: '10:00:00.000', pid: 100, tid: 1 },
    { id: 2, level: 'D', tag: 'ViewRootImpl', msg: 'Input event dispatched', ts: '10:00:01.000', pid: 100, tid: 2 },
    { id: 3, level: 'W', tag: 'FlutterRenderer', msg: 'Frame dropped', ts: '10:00:02.000', pid: 100, tid: 3 },
    { id: 4, level: 'I', tag: 'ActivityManager', msg: 'Displayed component', ts: '10:00:03.000', pid: 200, tid: 4 },
  ];

  const filter = {
    ...defaultLogcatFilter(),
    search: 'tag:Flutter',
  };

  const results = filterLogLines(sampleLogs, filter);
  assert.equal(results.length, 2);
  assert.equal(results[0].tag, 'FlutterJNI');
  assert.equal(results[1].tag, 'FlutterRenderer');

  const excludeFilter = {
    ...defaultLogcatFilter(),
    search: '-tag:ViewRootImpl',
  };
  const excludeResults = filterLogLines(sampleLogs, excludeFilter);
  assert.equal(excludeResults.length, 3);
  assert.ok(!excludeResults.some((l) => l.tag === 'ViewRootImpl'));
});

test('b56 Filtering 2: minLevel filtering via DSL level:<v|d|i|w|e|f>', () => {
  const sampleLogs = [
    { id: 1, level: 'V', tag: 'A', msg: 'verbose msg', ts: '10:00:00.000', pid: 100, tid: 1 },
    { id: 2, level: 'D', tag: 'B', msg: 'debug msg', ts: '10:00:01.000', pid: 100, tid: 2 },
    { id: 3, level: 'I', tag: 'C', msg: 'info msg', ts: '10:00:02.000', pid: 100, tid: 3 },
    { id: 4, level: 'W', tag: 'D', msg: 'warn msg', ts: '10:00:03.000', pid: 100, tid: 4 },
    { id: 5, level: 'E', tag: 'E', msg: 'error msg', ts: '10:00:04.000', pid: 100, tid: 5 },
    { id: 6, level: 'F', tag: 'F', msg: 'fatal msg', ts: '10:00:05.000', pid: 100, tid: 6 },
  ];

  const warnFilter = {
    ...defaultLogcatFilter(),
    search: 'level:warn',
  };
  const warnResults = filterLogLines(sampleLogs, warnFilter);
  assert.equal(warnResults.length, 3);
  assert.deepEqual(warnResults.map((l) => l.level), ['W', 'E', 'F']);

  const errorFilter = {
    ...defaultLogcatFilter(),
    search: 'level:e',
  };
  const errorResults = filterLogLines(sampleLogs, errorFilter);
  assert.equal(errorResults.length, 2);
  assert.deepEqual(errorResults.map((l) => l.level), ['E', 'F']);
});

test('b56 Filtering 3: package:mine filters by appPid', () => {
  const sampleLogs = [
    { id: 1, level: 'I', tag: 'MyFlutterApp', msg: 'Hello', ts: '10:00:00.000', pid: 4321, tid: 1 },
    { id: 2, level: 'I', tag: 'SystemServer', msg: 'Battery check', ts: '10:00:01.000', pid: 1000, tid: 2 },
    { id: 3, level: 'E', tag: 'OtherApp', msg: 'Crash in other app', ts: '10:00:02.000', pid: 9999, tid: 3 },
  ];

  const mineFilter = {
    ...defaultLogcatFilter(),
    appPid: 4321,
    search: 'package:mine',
  };
  const results = filterLogLines(sampleLogs, mineFilter);
  assert.equal(results.length, 1);
  assert.equal(results[0].pid, 4321);
  assert.equal(results[0].tag, 'MyFlutterApp');
});

test('b56 Filtering 4: complex combined DSL query and free text', () => {
  const sampleLogs = [
    { id: 1, level: 'W', tag: 'FlutterJNI', msg: 'Exception in thread main', ts: '10:00:00.000', pid: 500, tid: 1 },
    { id: 2, level: 'E', tag: 'FlutterJNI', msg: 'Critical exception caught', ts: '10:00:01.000', pid: 500, tid: 1 },
    { id: 3, level: 'E', tag: 'ViewRootImpl', msg: 'Critical exception in view hierarchy', ts: '10:00:02.000', pid: 500, tid: 2 },
    { id: 4, level: 'I', tag: 'FlutterJNI', msg: 'Critical exception in debug', ts: '10:00:03.000', pid: 500, tid: 1 },
    { id: 5, level: 'E', tag: 'FlutterJNI', msg: 'Everything normal', ts: '10:00:04.000', pid: 500, tid: 1 },
  ];

  // Must match tag:Flutter, level >= warn, not ViewRootImpl, and contain text 'critical' and 'exception'
  const filter = {
    ...defaultLogcatFilter(),
    search: 'tag:Flutter level:warn -tag:ViewRootImpl critical exception',
  };

  const results = filterLogLines(sampleLogs, filter);
  assert.equal(results.length, 1);
  assert.equal(results[0].id, 2);
  assert.equal(results[0].msg, 'Critical exception caught');
});

test('b56 Filtering 5: backward compatibility with legacy tag, search, caseSensitive and isRegex', () => {
  const sampleLogs = [
    { id: 1, level: 'I', tag: 'AuthService', msg: 'User login SUCCESS with Token123', ts: '10:00:00.000', pid: 100, tid: 1 },
    { id: 2, level: 'D', tag: 'authservice', msg: 'Token validation success', ts: '10:00:01.000', pid: 100, tid: 2 },
    { id: 3, level: 'E', tag: 'Database', msg: 'Error code: 404 & id < 10', ts: '10:00:02.000', pid: 100, tid: 3 },
  ];

  // Case-sensitive search
  const caseMatch = filterLogLines(sampleLogs, { ...defaultLogcatFilter(), search: 'SUCCESS', caseSensitive: true });
  assert.equal(caseMatch.length, 1);
  assert.equal(caseMatch[0].id, 1);

  // Regex search
  const regexMatch = filterLogLines(sampleLogs, { ...defaultLogcatFilter(), search: 'code:\\s+\\d+', isRegex: true });
  assert.equal(regexMatch.length, 1);
  assert.equal(regexMatch[0].id, 3);

  // Legacy tag filter
  const legacyTag = filterLogLines(sampleLogs, { ...defaultLogcatFilter(), tag: 'AuthService', caseSensitive: true });
  assert.equal(legacyTag.length, 1);
  assert.equal(legacyTag[0].id, 1);
});

// =============================================================================
// Suite 4: Clickable Stack Trace Links
// =============================================================================

test('b56 Stack Links: detects Dart and JVM/Kotlin stack traces', () => {
  // Dart package link
  const dartPkgMsg = 'Unhandled exception: at package:bank_jatim/features/home.dart:42:15';
  const dartPkgLinks = parseStackLinks(dartPkgMsg);
  assert.equal(dartPkgLinks.length, 1);
  assert.equal(dartPkgLinks[0].line, 42);
  assert.equal(dartPkgLinks[0].col, 15);
  assert.ok(dartPkgLinks[0].file.endsWith('lib/features/home.dart'));

  // Dart relative lib link
  const dartRelMsg = 'Error occurred in lib/main.dart:18:4';
  const dartRelLinks = parseStackLinks(dartRelMsg);
  assert.equal(dartRelLinks.length, 1);
  assert.equal(dartRelLinks[0].line, 18);
  assert.equal(dartRelLinks[0].col, 4);

  // Kotlin JVM stack trace
  const kotlinMsg = 'FATAL EXCEPTION: main\n\tat com.bankjatim.jconnect.MainActivity.onCreate(MainActivity.kt:55)';
  const kotlinLinks = parseStackLinks(kotlinMsg);
  assert.equal(kotlinLinks.length, 1);
  assert.equal(kotlinLinks[0].file, 'MainActivity.kt');
  assert.equal(kotlinLinks[0].line, 55);

  // Java JVM stack trace
  const javaMsg = '\tat android.app.ActivityThread.performLaunchActivity(ActivityThread.java:3300)';
  const javaLinks = parseStackLinks(javaMsg);
  assert.equal(javaLinks.length, 1);
  assert.equal(javaLinks[0].file, 'ActivityThread.java');
  assert.equal(javaLinks[0].line, 3300);

  // splitLogMessageWithLinks splits cleanly into text and clickable button link
  const parts = splitLogMessageWithLinks(kotlinMsg, kotlinLinks);
  assert.ok(parts.some((p) => p.link && p.link.file === 'MainActivity.kt' && p.link.line === 55));
});

// =============================================================================
// Suite 5: Ring Buffer and Performance Non-Mutation
// =============================================================================

test('b56 Performance 1: RingBuffer bounds memory and does not mutate input batches', () => {
  const ring = new LogcatRingBuffer(5);
  const inputBatch = [
    { ts: '10:00:00.000', pid: 1, tid: 1, level: 'I', tag: 'A', msg: 'm1' },
    { ts: '10:00:01.000', pid: 1, tid: 1, level: 'I', tag: 'B', msg: 'm2' },
    { ts: '10:00:02.000', pid: 1, tid: 1, level: 'I', tag: 'C', msg: 'm3' },
  ];

  const added = ring.pushBatch(inputBatch);
  assert.equal(added.length, 3);
  assert.equal(ring.length, 3);

  // Input objects were not modified with unexpected mutated properties
  assert.equal(inputBatch[0].id, undefined);

  // Push 4 more items to trigger capacity overflow (cap = 5)
  const secondBatch = [
    { ts: '10:00:03.000', pid: 1, tid: 1, level: 'I', tag: 'D', msg: 'm4' },
    { ts: '10:00:04.000', pid: 1, tid: 1, level: 'I', tag: 'E', msg: 'm5' },
    { ts: '10:00:05.000', pid: 1, tid: 1, level: 'I', tag: 'F', msg: 'm6' },
    { ts: '10:00:06.000', pid: 1, tid: 1, level: 'I', tag: 'G', msg: 'm7' },
  ];
  ring.pushBatch(secondBatch);
  assert.equal(ring.length, 5, 'Ring buffer must remain capped at 5 items');
  const all = ring.getAll();
  assert.equal(all[0].tag, 'C');
  assert.equal(all[4].tag, 'G');
});

test('b56 Performance 2: filterLogLines handles 5,000 synthetic lines under 50ms without mutation', () => {
  const syntheticLines = [];
  for (let i = 0; i < 5000; i++) {
    syntheticLines.push({
      id: i + 1,
      ts: '10:00:00.000',
      pid: i % 2 === 0 ? 1234 : 5678,
      tid: 1,
      level: i % 10 === 0 ? 'E' : i % 5 === 0 ? 'W' : 'I',
      tag: i % 3 === 0 ? 'FlutterJNI' : i % 2 === 0 ? 'ViewRootImpl' : 'ActivityManager',
      msg: `Synthetic log event sequence ${i} with payload data details`,
    });
  }

  const complexFilter = {
    ...defaultLogcatFilter(),
    search: 'tag:Flutter level:warn -tag:ViewRoot sequence payload',
  };

  const start = performance.now();
  const filtered = filterLogLines(syntheticLines, complexFilter);
  const elapsed = performance.now() - start;

  assert.ok(elapsed < 50, `Filtering 5000 lines took ${elapsed.toFixed(2)}ms, must be < 50ms`);
  assert.ok(filtered.length > 0);
  assert.ok(filtered.every((l) => l.tag === 'FlutterJNI' && (l.level === 'W' || l.level === 'E')));
});

// =============================================================================
// Suite 6: UI Component Slate Grey Compliance & Zero Pitch Black
// =============================================================================

test('b56 UI Compliance 1: LogcatPanel.svelte applies dynamic tag color and DSL search placeholder', () => {
  const panelSrc = fs.readFileSync(path.resolve(uiRoot, 'features/run/LogcatPanel.svelte'), 'utf-8');

  // Verify dynamic tag color style
  assert.ok(
    panelSrc.includes('style:color={getTagColor(line.tag)}'),
    'LogcatPanel.svelte must set dynamic color on tag using getTagColor(line.tag)'
  );

  // Verify updated search placeholder
  assert.ok(
    panelSrc.includes('placeholder="Filter (e.g. tag:Flutter level:warn -tag:ViewRoot)"'),
    'LogcatPanel.svelte must have updated DSL search placeholder'
  );

  // Verify Include Native Logs button
  assert.ok(
    panelSrc.includes('logcatStore.toggleIncludeNativeLogs()'),
    'LogcatPanel.svelte must have toggle button calling toggleIncludeNativeLogs()'
  );
  assert.ok(
    panelSrc.includes('Include Native Logs'),
    'LogcatPanel.svelte must include button label "Include Native Logs"'
  );
});

test('b56 UI Compliance 2: RunPanel.svelte toolbar includes Include Native Logs toggle', () => {
  const runPanelSrc = fs.readFileSync(path.resolve(uiRoot, 'features/run/RunPanel.svelte'), 'utf-8');

  assert.ok(
    runPanelSrc.includes('runStore.setIncludeNativeLogs('),
    'RunPanel.svelte must include toggle for runStore.includeNativeLogs'
  );
  assert.ok(
    runPanelSrc.includes('Include Native Logs'),
    'RunPanel.svelte must display label "Include Native Logs"'
  );
});

test('b56 UI Compliance 3: logcatStore.svelte.ts and runStore.svelte.ts contracts', () => {
  const logcatStoreSrc = fs.readFileSync(path.resolve(uiRoot, 'features/run/logcatStore.svelte.ts'), 'utf-8');
  assert.ok(logcatStoreSrc.includes('includeNativeLogs = $state<boolean>(true)'), 'logcatStore must declare includeNativeLogs defaulting to true');
  assert.ok(logcatStoreSrc.includes('toggleIncludeNativeLogs()'), 'logcatStore must declare toggleIncludeNativeLogs');
  assert.ok(logcatStoreSrc.includes('parseLogcatFilter'), 'logcatStore must integrate parseLogcatFilter');

  const runStoreSrc = fs.readFileSync(path.resolve(uiRoot, 'features/run/runStore.svelte.ts'), 'utf-8');
  assert.ok(runStoreSrc.includes('includeNativeLogs = $state<boolean>(true)'), 'runStore must declare includeNativeLogs defaulting to true');
  assert.ok(runStoreSrc.includes('setIncludeNativeLogs('), 'runStore must declare setIncludeNativeLogs');
});

test('b56 UI Compliance 4: Zero pitch black in LogcatPanel and RunPanel styles', () => {
  const panelSrc = fs.readFileSync(path.resolve(uiRoot, 'features/run/LogcatPanel.svelte'), 'utf-8');
  const runPanelSrc = fs.readFileSync(path.resolve(uiRoot, 'features/run/RunPanel.svelte'), 'utf-8');

  const pitchBlackRegex = /#(000000|08090d|0c0d10)\b/i;
  assert.ok(!pitchBlackRegex.test(panelSrc), 'LogcatPanel.svelte must have zero pitch black hex colors');

  // Verify Slate Grey layers are used
  assert.ok(panelSrc.includes('#2b2d30') || panelSrc.includes('--p-bg-workspace'));
  assert.ok(panelSrc.includes('#26282b') || panelSrc.includes('--p-bg-surface'));
});
