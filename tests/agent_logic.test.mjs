import test from 'node:test';
import assert from 'node:assert/strict';

import {
  checkPermission,
  isCommandInAllowlist,
  proposalToDiffFile,
  formatUsageText,
  truncateToolOutput,
  buildFixWithAgentDraft,
  applyDisciplineDirectives,
  extractLessonFromResponse,
  formatLessonEntry,
  isValidSlotTransition,
  DEFAULT_ALLOWLIST,
  extractChunkText,
  renderChatMarkdown,
} from '../ui/features/agents/agentsLogic.ts';

test('permission: read mode always denies modification/execution', () => {
  assert.equal(checkPermission('read', 'flutter test'), 'denied');
  assert.equal(checkPermission('read', 'npm test'), 'denied');
  assert.equal(checkPermission('read', 'rm -rf .'), 'denied');
});

test('permission: full mode always approves', () => {
  assert.equal(checkPermission('full', 'rm -rf /tmp/test'), 'approved');
  assert.equal(checkPermission('full', 'flutter run'), 'approved');
});

test('permission: auto mode approves allowlisted commands and asks for others', () => {
  assert.equal(checkPermission('auto', 'flutter test test/app_test.dart'), 'approved');
  assert.equal(checkPermission('auto', 'cargo test -p petak-core'), 'approved');
  assert.equal(checkPermission('auto', 'npm run build'), 'approved');
  assert.equal(checkPermission('auto', 'gradlew build'), 'approved');
  assert.equal(checkPermission('auto', './gradlew assembleDebug'), 'approved');

  // Non-allowlisted command triggers ask
  assert.equal(checkPermission('auto', 'git push origin main'), 'ask');
  assert.equal(checkPermission('auto', 'rm -rf build/'), 'ask');
});

test('permission: ask mode always requests confirmation', () => {
  assert.equal(checkPermission('ask', 'flutter test'), 'ask');
  assert.equal(checkPermission('ask', 'npm test'), 'ask');
});

test('allowlist: command matching logic', () => {
  assert.equal(isCommandInAllowlist('flutter test', DEFAULT_ALLOWLIST), true);
  assert.equal(isCommandInAllowlist('pod install --repo-update', DEFAULT_ALLOWLIST), true);
  assert.equal(isCommandInAllowlist('cargo check --all-targets', DEFAULT_ALLOWLIST), true);
  assert.equal(isCommandInAllowlist('sh -c "rm -rf *"', DEFAULT_ALLOWLIST), false);
  assert.equal(isCommandInAllowlist('', DEFAULT_ALLOWLIST), false);
});

test('proposalToDiffFile: converts core proposal to DiffView format', () => {
  const proposal = {
    id: 'prop-1',
    slotId: 's1',
    sessionId: 'sess-1',
    path: 'lib/main.dart',
    oldContent: 'void main() {}',
    newContent: 'void main() { runApp(App()); }',
    status: 'pending',
    timestamp: 1000,
    hunks: [
      {
        old_start: 1,
        old_lines: 1,
        new_start: 1,
        new_lines: 1,
        lines: [
          { kind: 'del', text: 'void main() {}', old_lineno: 1, new_lineno: null },
          { kind: 'add', text: 'void main() { runApp(App()); }', old_lineno: null, new_lineno: 1 },
        ],
      },
    ],
  };

  const diffFile = proposalToDiffFile(proposal);
  assert.equal(diffFile.oldPath, 'lib/main.dart');
  assert.equal(diffFile.newPath, 'lib/main.dart');
  assert.equal(diffFile.status, 'modified');
  assert.equal(diffFile.hunks.length, 1);
  assert.equal(diffFile.hunks[0].lines.length, 2);
  assert.equal(diffFile.hunks[0].lines[0].kind, 'del');
  assert.equal(diffFile.hunks[0].lines[1].kind, 'add');
});

test('formatUsageText: honest usage reporting', () => {
  const unreported = formatUsageText({ reported: false, displayText: 'tidak melapor' });
  assert.equal(unreported.isReported, false);
  assert.equal(unreported.text, 'Penggunaan kuota: agen tidak melapor');

  const reported = formatUsageText({
    reported: true,
    totalTokens: 51200,
    cost: 0.25,
    contextPercentage: 25.5,
    displayText: 'Context: 25% · Tokens: 51.2k · Biaya: ~$0.25',
  });
  assert.equal(reported.isReported, true);
  assert.match(reported.text, /51\.2k/);
  assert.match(reported.text, /0\.25/);
});

test('truncateToolOutput: trims long output cleanly', () => {
  const shortText = 'Success: 1 test passed';
  assert.equal(truncateToolOutput(shortText, 50).isTruncated, false);
  assert.equal(truncateToolOutput(shortText, 50).text, shortText);

  const longText = 'x'.repeat(400);
  const truncated = truncateToolOutput(longText, 200);
  assert.equal(truncated.isTruncated, true);
  assert.match(truncated.text, /output dipotong/);
  assert.ok(truncated.text.length < 350);
});

test('buildFixWithAgentDraft: constructs transparent and editable prompt', () => {
  const draft = buildFixWithAgentDraft({
    errorMessage: 'RangeError (index): Invalid value: Valid value range is empty: 0',
    filePath: 'lib/view/home_page.dart',
    line: 45,
    col: 12,
    codeContext: 'final item = items[0];',
    toolchainSummary: 'Flutter 3.24.3 · Dart 3.5.3',
    gitSummary: 'On branch feat/fix-items, 1 file modified',
    slotId: 's1',
  });

  assert.equal(draft.slotId, 's1');
  assert.match(draft.userPrompt, /RangeError/);
  assert.match(draft.userPrompt, /lib\/view\/home_page\.dart:45:12/);
  assert.match(draft.userPrompt, /final item = items\[0\];/);
  assert.match(draft.userPrompt, /Flutter 3\.24\.3/);
  assert.match(draft.userPrompt, /feat\/fix-items/);
});

test('applyDisciplineDirectives: injects Ponytail and Caveman rules', () => {
  const rawPrompt = 'Perbaiki crash di login screen';

  const ponyOnly = applyDisciplineDirectives(rawPrompt, true, false);
  assert.match(ponyOnly, /PONYTAIL/);
  assert.ok(!ponyOnly.includes('CAVEMAN'));
  assert.match(ponyOnly, /Perbaiki crash di login screen/);

  const both = applyDisciplineDirectives(rawPrompt, true, true);
  assert.match(both, /PONYTAIL/);
  assert.match(both, /CAVEMAN/);

  const neither = applyDisciplineDirectives(rawPrompt, false, false);
  assert.equal(neither, rawPrompt);

  const withSelfImprove = applyDisciplineDirectives(
    rawPrompt,
    false,
    false,
    true,
    '## conventions.md\nAlways use BLoC context.read'
  );
  assert.match(withSelfImprove, /SELF-IMPROVE/);
  assert.match(withSelfImprove, /PROJECT MEMORY & OBSIDIAN CONVENTIONS/);
  assert.match(withSelfImprove, /Always use BLoC context\.read/);
});

test('self-improvement: extractLessonFromResponse and formatLessonEntry', () => {
  const sampleResp = 'Berikut perbaikannya.\n\nPelajaran: Jangan gunakan static state pada widget.\nKode sudah diuji.';
  const lesson = extractLessonFromResponse(sampleResp);
  assert.equal(lesson, 'Jangan gunakan static state pada widget.');

  const noLesson = extractLessonFromResponse('Perbaikan selesai tanpa catatan khusus.');
  assert.equal(noLesson, null);

  const entry = formatLessonEntry('Gunakan BLoC builder', 'Architecture');
  assert.match(entry, /Architecture/);
  assert.match(entry, /Gunakan BLoC builder/);
});

test('isValidSlotTransition: checks state machine validity', () => {
  assert.equal(isValidSlotTransition('idle', 'starting'), true);
  assert.equal(isValidSlotTransition('starting', 'ready'), true);
  assert.equal(isValidSlotTransition('ready', 'busy'), true);
  assert.equal(isValidSlotTransition('busy', 'ready'), true);
  assert.equal(isValidSlotTransition('busy', 'failed'), true);
  assert.equal(isValidSlotTransition('stopped', 'starting'), true);
});

test('proposal state handling: accept and reject transitions', () => {
  const proposals = [
    { id: 'p1', path: 'lib/auth.dart', status: 'pending' },
    { id: 'p2', path: 'lib/cart.dart', status: 'pending' },
  ];

  // Simulating proposal acceptance
  const accepted = proposals.map((p) => (p.id === 'p1' ? { ...p, status: 'accepted' } : p));
  assert.equal(accepted.find((p) => p.id === 'p1').status, 'accepted');
  assert.equal(accepted.find((p) => p.id === 'p2').status, 'pending');

  // Simulating proposal rejection
  const rejected = proposals.map((p) => (p.id === 'p2' ? { ...p, status: 'rejected' } : p));
  assert.equal(rejected.find((p) => p.id === 'p2').status, 'rejected');
});

test('permission card response: pending queue management', () => {
  let pending = [
    { requestId: 'req-1', toolCall: { name: 'terminal' } },
    { requestId: 'req-2', toolCall: { name: 'fs/write_text_file' } },
  ];

  // User responds to req-1
  const respondedId = 'req-1';
  pending = pending.filter((p) => p.requestId !== respondedId);
  assert.equal(pending.length, 1);
  assert.equal(pending[0].requestId, 'req-2');
});

test('buildFixWithAgentDraft: works gracefully with minimal context', () => {
  const minimalDraft = buildFixWithAgentDraft({
    errorMessage: 'SyntaxError: Unexpected token',
    slotId: 's2',
  });

  assert.equal(minimalDraft.slotId, 's2');
  assert.match(minimalDraft.userPrompt, /SyntaxError: Unexpected token/);
  assert.match(minimalDraft.userPrompt, /Tolong analisis error/);
});

test('extractChunkText: parses ACP session/update and text payloads safely', () => {
  // 1. ACP object with content { type: 'text', text: '...' }
  const acpChunk = {
    sessionUpdate: 'agent_message_chunk',
    content: {
      type: 'text',
      text: 'Halo! Ada yang bisa dibantu?',
    },
  };
  assert.equal(extractChunkText(acpChunk), 'Halo! Ada yang bisa dibantu?');

  // 2. Direct string content
  assert.equal(extractChunkText({ content: 'Direct content' }), 'Direct content');

  // 3. Raw string
  assert.equal(extractChunkText('Raw string'), 'Raw string');

  // 4. Array of chunks
  const chunkArray = [
    { type: 'text', text: 'Bagian 1 ' },
    { type: 'text', text: 'Bagian 2' },
  ];
  assert.equal(extractChunkText(chunkArray), 'Bagian 1 Bagian 2');

  // 5. Delta payload
  assert.equal(extractChunkText({ delta: 'Delta text' }), 'Delta text');

  // 6. Null or undefined
  assert.equal(extractChunkText(null), '');
  assert.equal(extractChunkText(undefined), '');

  // 7. Nested content object
  assert.equal(extractChunkText({ content: { text: 'Nested text' } }), 'Nested text');
});

test('renderChatMarkdown: formats headings, lists, inline tokens, and code blocks safely', () => {
  // Headings
  const headingMd = '### Arsitektur Aplikasi\n\nPenjelasan singkat:';
  const headingHtml = renderChatMarkdown(headingMd);
  assert.match(headingHtml, /<h3 class="chat-heading chat-h3">Arsitektur Aplikasi<\/h3>/);
  assert.match(headingHtml, /<p class="chat-para">Penjelasan singkat:<\/p>/);

  // Bullet list
  const listMd = '- Service layer\n- Core module\n- Application UI';
  const listHtml = renderChatMarkdown(listMd);
  assert.match(listHtml, /<ul class="chat-list chat-ul">/);
  assert.match(listHtml, /<li>Service layer<\/li>/);
  assert.match(listHtml, /<li>Core module<\/li>/);

  // Numbered list
  const numListMd = '1. Inisialisasi\n2. Konfigurasi\n3. Eksekusi';
  const numListHtml = renderChatMarkdown(numListMd);
  assert.match(numListHtml, /<ol class="chat-list chat-ol">/);
  assert.match(numListHtml, /<li>Inisialisasi<\/li>/);

  // Inline bold, code, link
  const inlineMd = 'Gunakan **Riverpod** dan `lib/main.dart` dari [repo](https://example.com).';
  const inlineHtml = renderChatMarkdown(inlineMd);
  assert.match(inlineHtml, /<strong>Riverpod<\/strong>/);
  assert.match(inlineHtml, /<code class="chat-inline-code">lib\/main\.dart<\/code>/);
  assert.match(inlineHtml, /<a href="https:\/\/example\.com" target="_blank" rel="noopener noreferrer" class="chat-link">repo<\/a>/);

  // Fenced code block with language
  const codeBlockMd = 'Contoh kode:\n\n```dart\nvoid main() {\n  runApp(const MyApp());\n}\n```';
  const codeBlockHtml = renderChatMarkdown(codeBlockMd);
  assert.match(codeBlockHtml, /<div class="chat-code-wrapper">/);
  assert.match(codeBlockHtml, /<span class="chat-code-lang">dart<\/span>/);
  assert.match(codeBlockHtml, /<code class="language-dart">void main\(\)/);

  // XSS protection: raw script tags neutralized
  const xssMd = '<script>alert("xss")</script>';
  const xssHtml = renderChatMarkdown(xssMd);
  assert.doesNotMatch(xssHtml, /<script>/);
  assert.match(xssHtml, /&lt;script&gt;/);
});



