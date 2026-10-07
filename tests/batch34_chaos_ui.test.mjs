import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  filterLogLines,
  LogcatRingBuffer,
} from '../ui/features/run/logcat.ts';

import {
  renderChatMarkdown,
  buildCleanPromptEnvelope,
  routePromptResponse,
  generateSessionId,
  formatChatInline,
} from '../ui/features/agents/agentsLogic.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uiRoot = path.resolve(__dirname, '../ui');

// =============================================================================
// Suite 1: Chat Spam Stress Test (Burst 50+ rapid events)
// =============================================================================

test('b34 Chaos UI 1: Chat Spam Stress Test - Burst 60 markdown parse events without leak or crash', () => {
  const startMem = process.memoryUsage().heapUsed;
  const startHr = process.hrtime.bigint();

  const payloads = [
    'Halo bot! Tolong perbaiki bug di lib/main.dart.\n```dart\nvoid main() => runApp(MyApp());\n```',
    '# Header 1\n## Header 2\n- Item 1\n- Item 2\n1. Number 1\n2. Number 2',
    'Short message: **bold** and *italic* with `inline code` and [link](https://flutter.dev).',
    '> Quote line 1\n> Quote line 2\n\nParagraf biasa dengan teks biasa.',
    '```bash\ncargo test -p petak-core -- --nocapture\n```\nOutput berhasil 100%.',
  ];

  // Emit 60 rapid burst events
  const burstCount = 60;
  const renderedOutputs = [];
  for (let i = 0; i < burstCount; i++) {
    const raw = payloads[i % payloads.length] + `\n\nEvent sequence index: #${i}`;
    const html = renderChatMarkdown(raw);
    assert.ok(html.length > 0, `Rendered output #${i} must not be empty`);
    renderedOutputs.push(html);
  }

  const endHr = process.hrtime.bigint();
  const elapsedMs = Number(endHr - startHr) / 1_000_000;

  assert.equal(renderedOutputs.length, burstCount, 'All 60 burst events must be rendered');
  // Burst 60 markdown renderings should be sub-100ms in Node
  assert.ok(elapsedMs < 100, `60 burst markdown parses should take < 100ms (actual: ${elapsedMs.toFixed(2)}ms)`);

  // Verify memory did not explode (growth < 30MB)
  const endMem = process.memoryUsage().heapUsed;
  const memGrowthMb = (endMem - startMem) / (1024 * 1024);
  assert.ok(memGrowthMb < 30, `Memory growth should remain controlled (<30MB, actual: ${memGrowthMb.toFixed(2)}MB)`);
});

test('b34 Chaos UI 2: Chat Spam Stress Test - Burst 60 prompt responses routed without orphan state', () => {
  const currentSessionId = 'sess-active-stream';
  let activeMessages = [
    { id: 'usr-init', timestamp: 1000, role: 'user', content: 'Active prompt' },
  ];
  let savedSessions = [];

  // Simulate 60 incoming background responses arriving in rapid succession
  for (let i = 1; i <= 60; i++) {
    const originSessionId = `sess-bg-${i % 5}`; // Spread across 5 different background sessions
    const agentMsg = {
      id: `agent-reply-${i}`,
      timestamp: 2000 + i,
      role: 'agent',
      content: `Response #${i} for origin session`,
    };

    const result = routePromptResponse(
      originSessionId,
      currentSessionId,
      agentMsg,
      activeMessages,
      savedSessions
    );

    assert.equal(result.isTargetActive, false, `Background response #${i} must not target active session`);
    assert.equal(result.updatedActiveMessages.length, 1, 'Active session must remain strictly untouched');
    savedSessions = result.updatedSavedSessions;
  }

  // Verify background sessions aggregated the messages cleanly
  assert.ok(savedSessions.length <= 5, 'Must have at most 5 unique background sessions');
  const totalBgMessages = savedSessions.reduce((acc, s) => acc + s.messages.length, 0);
  assert.equal(totalBgMessages, 60, 'All 60 responses must be stored across the background sessions without loss');
});

// =============================================================================
// Suite 2: Rapid Session Switching & Prompt Concurrency
// =============================================================================

test('b34 Chaos UI 3: Rapid Session Switching - 100 rapid switches with in-flight response without crosstalk', () => {
  const originSessionId = 'sess-origin-slow-task';
  let activeSessionId = originSessionId;
  let activeMessages = [{ id: 'm-orig', timestamp: 1000, role: 'user', content: 'Long running task' }];
  let savedSessions = [];

  // Switch sessions rapidly 100 times
  for (let i = 0; i < 100; i++) {
    const newSessionId = `sess-switch-${i}`;

    // Archive current session if it has messages
    if (activeMessages.length > 0) {
      savedSessions = [
        {
          id: activeSessionId,
          slotId: 'slot-1',
          title: `Session ${activeSessionId}`,
          createdAt: Date.now(),
          messageCount: activeMessages.length,
          messages: [...activeMessages],
        },
        ...savedSessions.filter((s) => s.id !== activeSessionId),
      ].slice(0, 50);
    }

    activeSessionId = newSessionId;
    activeMessages = [{ id: `usr-${newSessionId}`, timestamp: Date.now(), role: 'user', content: `Prompt for ${newSessionId}` }];
  }

  // Now the slow original task finishes while activeSession is sess-switch-99
  const lateAgentMsg = {
    id: 'agent-late-reply',
    timestamp: Date.now() + 5000,
    role: 'agent',
    content: 'Long running analysis completed successfully.',
  };

  const routeResult = routePromptResponse(
    originSessionId,
    activeSessionId,
    lateAgentMsg,
    activeMessages,
    savedSessions
  );

  // Must not contaminate active session
  assert.equal(routeResult.isTargetActive, false, 'Late response must not hit active session');
  assert.equal(routeResult.updatedActiveMessages[0].content, 'Prompt for sess-switch-99');
  assert.equal(routeResult.updatedActiveMessages.length, 1, 'Active session must have no orphan agent message');

  // Must find origin in saved sessions and append
  const originInSaved = routeResult.updatedSavedSessions.find((s) => s.id === originSessionId);
  assert.ok(originInSaved, 'Origin session must exist in saved sessions');
  const foundReply = originInSaved.messages.find((m) => m.id === 'agent-late-reply');
  assert.ok(foundReply, 'Late agent reply must be appended to origin session in savedSessions');
});

// =============================================================================
// Suite 3: Long Input & Giant Payload Handling (100k+ chars)
// =============================================================================

test('b34 Chaos UI 4: Giant Payload - 120,000+ character prompt through buildCleanPromptEnvelope', () => {
  const giantInput = 'A'.repeat(60_000) + ' ' + 'B'.repeat(60_000);
  const conventionsSnippet = '[PROJECT CONVENTIONS: FLUTTER]\nStandard rules\n[/PROJECT CONVENTIONS: FLUTTER]';

  const envelope = buildCleanPromptEnvelope(giantInput, {
    isPonytail: true,
    isCaveman: true,
    isSelfImprove: true,
    domainMemoryInjection: conventionsSnippet,
    prunedContextInjection: null,
  });

  // Display content must equal input exactly without truncating or mutating
  assert.equal(envelope.displayContent.length, giantInput.length);
  assert.equal(envelope.displayContent, giantInput);

  // Formatted prompt must include discipline flags and end with giantInput
  assert.ok(envelope.formattedPrompt.includes('[DISCIPLINE: PONYTAIL'));
  assert.ok(envelope.formattedPrompt.includes('[DISCIPLINE: CAVEMAN'));
  assert.ok(envelope.formattedPrompt.endsWith(giantInput));
  assert.ok(envelope.formattedPrompt.length > giantInput.length);
});

test('b34 Chaos UI 5: Giant Payload - 100,000+ character markdown rendering without call stack overflow', () => {
  // Construct 100k+ characters with mixed code fences, paragraphs, and lists
  const chunk = 'Line of repeated text that simulates very large code or analysis output.\n';
  const giantMarkdown = '# Giant Document Title\n\n```text\n' + chunk.repeat(1500) + '```\n\n' + '- List item line\n'.repeat(1000);

  assert.ok(giantMarkdown.length > 100_000, `Input should exceed 100k chars (actual: ${giantMarkdown.length})`);

  const startHr = process.hrtime.bigint();
  const html = renderChatMarkdown(giantMarkdown);
  const elapsedMs = Number(process.hrtime.bigint() - startHr) / 1_000_000;

  assert.ok(html.length > 0, 'Rendered HTML must not be empty');
  assert.ok(html.includes('chat-code-wrapper'), 'Must include code wrapper');
  assert.ok(html.includes('chat-list'), 'Must include rendered list');
  assert.ok(elapsedMs < 100, `Rendering 100k+ chars markdown must complete in <100ms (actual: ${elapsedMs.toFixed(2)}ms)`);
});

test('b34 Chaos UI 6: Giant Payload - 100,000+ character query on filterLogLines does not freeze', () => {
  const giantQuery = 'x'.repeat(100_000);
  const mockLines = [
    { ts: '12:00:01.000', pid: 101, tid: 201, level: 'I', tag: 'ActivityManager', msg: 'Start proc 1234:com.test' },
    { ts: '12:00:02.000', pid: 101, tid: 201, level: 'E', tag: 'AndroidRuntime', msg: 'FATAL EXCEPTION: main' },
    { ts: '12:00:03.000', pid: 101, tid: 201, level: 'D', tag: 'ViewRootImpl', msg: 'Relayout window completed' },
  ];

  const filter = {
    tag: '',
    search: giantQuery,
    minLevel: 'V',
    packageMine: false,
    appPid: null,
  };

  const startHr = process.hrtime.bigint();
  const filtered = filterLogLines(mockLines, filter);
  const elapsedMs = Number(process.hrtime.bigint() - startHr) / 1_000_000;

  assert.equal(filtered.length, 0, 'No lines should match 100k character non-existent query');
  assert.ok(elapsedMs < 20, `Giant query filter must execute in <20ms (actual: ${elapsedMs.toFixed(2)}ms)`);
});

// =============================================================================
// Suite 4: Edge Case Formatting & Corrupted Markdown Parsing
// =============================================================================

test('b34 Chaos UI 7: Corrupted Markdown - Unclosed code fences and nested broken fences', () => {
  const corruptedSamples = [
    '```typescript\nconst a = 1;\n// unclosed fence without trailing backticks',
    '```\n```\n```\nTriple fences without code',
    'Some text ```unclosed fence inside paragraph text',
    '```dart\nvoid main() {\n```inner fence\n}\n```',
    '``two backticks`` and `single backtick',
  ];

  for (const sample of corruptedSamples) {
    assert.doesNotThrow(() => {
      const html = renderChatMarkdown(sample);
      assert.ok(typeof html === 'string', 'Parser must return string for corrupted sample');
    }, `Failed parsing sample: ${sample}`);
  }
});

test('b34 Chaos UI 8: Corrupted Markdown - XSS injection vectors sanitized', () => {
  const xssSamples = [
    '<script>alert("xss")</script>',
    '<img src=x onerror=alert(1)>',
    '<iframe src="https://evil.com"></iframe>',
    '<svg onload="alert(1)">',
    '<a href="javascript:alert(1)">Click me</a>',
    '[Click me](javascript:alert(1))',
    '[Data URL](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)',
    '<b onmouseover="alert(1)">Hover me</b>',
  ];

  for (const xss of xssSamples) {
    const html = renderChatMarkdown(xss);

    // Assert malicious tags are strictly escaped and never rendered as executable HTML elements
    assert.equal(html.includes('<script>'), false, `Must not contain unescaped <script>: ${html}`);
    assert.equal(html.includes('<img '), false, `Must not contain unescaped <img: ${html}`);
    assert.equal(html.includes('<iframe'), false, `Must not contain unescaped <iframe>: ${html}`);
    assert.equal(html.includes('<svg'), false, `Must not contain unescaped <svg: ${html}`);
    assert.equal(html.includes('href="javascript:'), false, `Must not contain javascript: url: ${html}`);
    assert.equal(html.includes('href="data:'), false, `Must not contain data: url: ${html}`);
  }
});

test('b34 Chaos UI 9: Corrupted Markdown - Special regex characters and ReDoS safety', () => {
  const reDoSPatterns = [
    '(' + 'a+'.repeat(30) + ')' + 'b',
    '*'.repeat(2000),
    '_'.repeat(2000),
    '`'.repeat(1500),
    '['.repeat(500) + ']'.repeat(500) + '('.repeat(500) + ')'.repeat(500),
    '# '.repeat(200),
    '> '.repeat(200) + 'Nested quote',
    '^$*+?()[]{}|\\'.repeat(100),
  ];

  for (const pattern of reDoSPatterns) {
    const startHr = process.hrtime.bigint();
    const html = renderChatMarkdown(pattern);
    const elapsedMs = Number(process.hrtime.bigint() - startHr) / 1_000_000;

    assert.ok(typeof html === 'string');
    assert.ok(elapsedMs < 50, `Pattern parsing took too long (${elapsedMs.toFixed(2)}ms), possible catastrophic backtracking!`);
  }
});

test('b34 Chaos UI 10: Corrupted Markdown - Falsy, null, undefined, control chars, and Unicode extremes', () => {
  const extremeInputs = [
    null,
    undefined,
    '',
    '   \t\n\r  ',
    '\x00\x01\x02\x03\x04\x05\x06\x07\x08', // control characters
    '🎉🚀🔥💡✨'.repeat(200), // multi-byte emojis
    '\u200B\u200C\u200D\uFEFF', // zero-width characters
    'مرحبا بالعالم! testing bidirectional text עִבְרִית', // RTL unicode
  ];

  for (const input of extremeInputs) {
    assert.doesNotThrow(() => {
      const html = renderChatMarkdown(input);
      assert.ok(typeof html === 'string');
    });
  }
});

// =============================================================================
// Suite 5: Logcat Buffer & Rapid Filter Thrashing (10,000 log lines)
// =============================================================================

test('b34 Chaos UI 11: Logcat 10,000 lines buffer throughput and integrity', () => {
  const ring = new LogcatRingBuffer(10_000);
  const levels = ['V', 'D', 'I', 'W', 'E', 'F'];
  const tags = ['ActivityManager', 'WindowManager', 'FlutterView', 'DartVM', 'CRASH', 'OkHttp'];

  // Generate 10,000 realistic log lines
  const batch = [];
  for (let i = 0; i < 10_000; i++) {
    batch.push({
      ts: `12:00:${String(Math.floor(i / 1000)).padStart(2, '0')}.${String(i % 1000).padStart(3, '0')}`,
      pid: 1000 + (i % 20),
      tid: 2000 + (i % 40),
      level: levels[i % levels.length],
      tag: tags[i % tags.length],
      msg: `Log entry #${i} with detail payload for process verification`,
    });
  }

  const startHr = process.hrtime.bigint();
  const prepared = ring.pushBatch(batch);
  const elapsedMs = Number(process.hrtime.bigint() - startHr) / 1_000_000;

  assert.equal(prepared.length, 10_000);
  assert.equal(ring.length, 10_000);
  assert.ok(elapsedMs < 100, `Pushing 10k items should take < 100ms (actual: ${elapsedMs.toFixed(2)}ms)`);

  // Verify first and last items
  const first = ring.get(0);
  const last = ring.get(9_999);
  assert.equal(first.msg, 'Log entry #0 with detail payload for process verification');
  assert.equal(last.msg, 'Log entry #9999 with detail payload for process verification');
});

test('b34 Chaos UI 12: Logcat Rapid Filter Thrashing - 200 filter changes on 10,000 lines completes in < 500ms', () => {
  const ring = new LogcatRingBuffer(10_000);
  const levels = ['V', 'D', 'I', 'W', 'E', 'F'];
  const tags = ['ActivityManager', 'WindowManager', 'FlutterView', 'DartVM', 'CRASH', 'OkHttp'];

  // Seed 10,000 log lines
  const lines = [];
  for (let i = 0; i < 10_000; i++) {
    lines.push({
      ts: '12:00:00.000',
      pid: 1000 + (i % 5),
      tid: 2000 + (i % 10),
      level: levels[i % levels.length],
      tag: tags[i % tags.length],
      msg: `Testing line #${i} with tag ${tags[i % tags.length]} and level ${levels[i % levels.length]}`,
      id: i + 1,
    });
  }
  ring.pushBatch(lines);
  const allLines = ring.getAll();

  // Simulate user thrashing filter: typing query, changing level, toggling tag filter 200 times
  const searchQueries = [
    '', 'a', 'act', 'activity', 'flutter', 'crash', 'nonexistent_key_12345',
    'testing', 'tag', 'line #9', 'level E', 'vm', 'http',
  ];
  const tagQueries = ['', 'act', 'flutter', 'crash', 'dart'];

  const startHr = process.hrtime.bigint();
  let totalFilteredCount = 0;

  for (let step = 0; step < 200; step++) {
    const filter = {
      tag: tagQueries[step % tagQueries.length],
      search: searchQueries[step % searchQueries.length],
      minLevel: levels[step % levels.length],
      packageMine: false,
      appPid: null,
    };

    const res = filterLogLines(allLines, filter);
    totalFilteredCount += res.length;
  }

  const elapsedMs = Number(process.hrtime.bigint() - startHr) / 1_000_000;

  assert.ok(totalFilteredCount > 0, 'Total filtered items across 200 runs must be positive');
  assert.ok(
    elapsedMs < 500,
    `200 filter thrashing cycles across 10k lines must finish in <500ms without freeze (actual: ${elapsedMs.toFixed(2)}ms)`
  );
});
