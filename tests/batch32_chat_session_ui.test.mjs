import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  applyDisciplineDirectives,
  buildCleanPromptEnvelope,
  generateSessionId,
  routePromptResponse,
  renderChatMarkdown,
} from '../ui/features/agents/agentsLogic.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uiRoot = path.resolve(__dirname, '../ui');

// =============================================================================
// Suite 1: Clean Prompt Envelope Separation
// =============================================================================

test('b32 Chat Session UI 1: Prompt Envelope strictly separates user display from backend LLM payload', () => {
  const userInput = 'pada @lib/main.dart ada context.read yang bermasalah';
  const conventionsSnippet = '[PROJECT CONVENTIONS: FLUTTER]\n### Architecture\nUse Provider or Bloc cleanly.\n[/PROJECT CONVENTIONS: FLUTTER]';
  const lspPrunedSnippet = '[PRUNED LSP CONTEXT: lib/main.dart]\nSymbols Outline:\n  - Class MyApp (line 10)\n[/PRUNED LSP CONTEXT]';

  const envelope = buildCleanPromptEnvelope(userInput, {
    isPonytail: true,
    isCaveman: true,
    isSelfImprove: true,
    domainMemoryInjection: conventionsSnippet,
    prunedContextInjection: lspPrunedSnippet,
  });

  // 1. Display content MUST only be user typed text
  assert.equal(
    envelope.displayContent,
    userInput,
    'User display content must contain ONLY what the user typed'
  );
  assert.equal(
    envelope.displayContent.includes('[PROJECT CONVENTIONS:'),
    false,
    'Display content must never leak domain memory conventions'
  );
  assert.equal(
    envelope.displayContent.includes('[DISCIPLINE:'),
    false,
    'Display content must never leak discipline directives'
  );
  assert.equal(
    envelope.displayContent.includes('[PRUNED LSP CONTEXT:'),
    false,
    'Display content must never leak pruned LSP context'
  );

  // 2. Formatted prompt payload sent to LLM backend MUST contain all injected context
  assert.ok(
    envelope.formattedPrompt.includes('[DISCIPLINE: PONYTAIL'),
    'Backend prompt must include Ponytail directive'
  );
  assert.ok(
    envelope.formattedPrompt.includes('[DISCIPLINE: CAVEMAN'),
    'Backend prompt must include Caveman directive'
  );
  assert.ok(
    envelope.formattedPrompt.includes('[DISCIPLINE: SELF-IMPROVE'),
    'Backend prompt must include Self-Improve directive'
  );
  assert.ok(
    envelope.formattedPrompt.includes('[PROJECT CONVENTIONS: FLUTTER]'),
    'Backend prompt must include domain conventions'
  );
  assert.ok(
    envelope.formattedPrompt.includes('[PRUNED LSP CONTEXT: lib/main.dart]'),
    'Backend prompt must include pruned LSP context'
  );
  assert.ok(
    envelope.formattedPrompt.endsWith(userInput),
    'Backend prompt must end with user prompt text'
  );
});

// =============================================================================
// Suite 2: Multi-Session Isolation & Response Routing
// =============================================================================

test('b32 Chat Session UI 2: routePromptResponse routes stale session responses to savedSessions without crosstalk', () => {
  const originSessionId = 'sess-10001';
  const currentSessionId = 'sess-20002'; // User clicked + New Chat, active session changed

  const activeMessages = [
    {
      id: 'usr-new',
      timestamp: 20002,
      role: 'user',
      content: 'Pertanyaan di sesi baru',
    },
  ];

  const initialSavedSessions = [
    {
      id: originSessionId,
      slotId: 'slot-1',
      title: 'Pertanyaan sesi lama',
      createdAt: 10000,
      messageCount: 1,
      messages: [
        {
          id: 'usr-old',
          timestamp: 10001,
          role: 'user',
          content: 'Pertanyaan di sesi lama',
        },
      ],
    },
  ];

  const staleAgentResponse = {
    id: 'agent-old-reply',
    timestamp: 20005,
    role: 'agent',
    content: 'Jawaban untuk pertanyaan sesi lama yang baru selesai.',
  };

  // Dispatch response from old session
  const routeResult = routePromptResponse(
    originSessionId,
    currentSessionId,
    staleAgentResponse,
    activeMessages,
    initialSavedSessions
  );

  // 1. Must NOT route to active session
  assert.equal(routeResult.isTargetActive, false, 'Stale response must not target active session');
  assert.equal(
    routeResult.updatedActiveMessages.length,
    1,
    'Active session messages count must remain exactly 1'
  );
  assert.equal(
    routeResult.updatedActiveMessages[0].id,
    'usr-new',
    'Active session must NOT have stale agent response'
  );

  // 2. Must append to origin session in savedSessions
  assert.equal(
    routeResult.updatedSavedSessions.length,
    1,
    'Saved sessions count should remain 1'
  );
  const updatedOriginSession = routeResult.updatedSavedSessions.find((s) => s.id === originSessionId);
  assert.ok(updatedOriginSession, 'Origin session must exist in saved sessions');
  assert.equal(
    updatedOriginSession.messages.length,
    2,
    'Origin session messages should now contain user + agent messages'
  );
  assert.equal(
    updatedOriginSession.messages[1].id,
    'agent-old-reply',
    'Origin session must receive the completed agent response'
  );
  assert.equal(
    updatedOriginSession.messageCount,
    2,
    'Origin session messageCount must update to 2'
  );
});

test('b32 Chat Session UI 3: routePromptResponse appends to active session when sessionId matches', () => {
  const currentSessionId = 'sess-30003';
  const activeMessages = [
    {
      id: 'usr-active',
      timestamp: 30001,
      role: 'user',
      content: 'Pertanyaan aktif',
    },
  ];
  const initialSavedSessions = [];

  const agentResponse = {
    id: 'agent-active-reply',
    timestamp: 30005,
    role: 'agent',
    content: 'Jawaban aktif.',
  };

  const routeResult = routePromptResponse(
    currentSessionId,
    currentSessionId,
    agentResponse,
    activeMessages,
    initialSavedSessions
  );

  assert.equal(routeResult.isTargetActive, true, 'Matching sessionId must target active session');
  assert.equal(routeResult.updatedActiveMessages.length, 2, 'Active messages must be appended');
  assert.equal(routeResult.updatedActiveMessages[1].id, 'agent-active-reply');
  assert.equal(routeResult.updatedSavedSessions.length, 0, 'Saved sessions must remain empty');
});

// =============================================================================
// Suite 3: newSession ID Generation & Active History Reset Contract
// =============================================================================

test('b32 Chat Session UI 4: generateSessionId creates fresh sess- timestamped ID', () => {
  const id1 = generateSessionId();
  assert.ok(id1.startsWith('sess-'), 'Session ID must start with sess-');
  assert.ok(id1.length > 8, 'Session ID must contain timestamp characters');

  const parsedTimestamp = Number(id1.replace('sess-', ''));
  assert.ok(!Number.isNaN(parsedTimestamp), 'Session ID timestamp must be a valid number');
  assert.ok(parsedTimestamp > 1700000000000, 'Session ID timestamp must be recent epoch ms');
});

// =============================================================================
// Suite 4: Static Inspection & CSS Contract Verification
// =============================================================================

test('b32 Chat Session UI 5: App.svelte user-select override contract', () => {
  const appSrc = fs.readFileSync(path.resolve(uiRoot, 'App.svelte'), 'utf-8');

  // Verify CSS overrides on agent-panel-slot
  assert.ok(
    appSrc.includes('user-select: text !important;'),
    'App.svelte must override user-select with text !important'
  );
  assert.ok(
    appSrc.includes('-webkit-user-select: text !important;'),
    'App.svelte must override -webkit-user-select with text !important'
  );
  assert.ok(
    appSrc.includes('cursor: text;'),
    'App.svelte must set cursor: text on chat selectable elements'
  );

  // Verify targeted classes
  assert.ok(appSrc.includes('.chat-messages'), 'Override must target .chat-messages');
  assert.ok(appSrc.includes('.message-bubble'), 'Override must target .message-bubble');
  assert.ok(appSrc.includes('.message-body'), 'Override must target .message-body');
  assert.ok(appSrc.includes('.user-bubble'), 'Override must target .user-bubble');
  assert.ok(appSrc.includes('.agent-bubble'), 'Override must target .agent-bubble');
});

test('b32 Chat Session UI 6: AgentChat.svelte copy button & text selection contract', () => {
  const chatSrc = fs.readFileSync(path.resolve(uiRoot, 'features/agents/AgentChat.svelte'), 'utf-8');

  // 1. Text selection styles in AgentChat
  assert.ok(
    chatSrc.includes('user-select: text !important;'),
    'AgentChat.svelte must declare user-select: text !important;'
  );
  assert.ok(
    chatSrc.includes('-webkit-user-select: text !important;'),
    'AgentChat.svelte must declare -webkit-user-select: text !important;'
  );

  // 2. Bubble copy button & feedback tooltip
  assert.ok(
    chatSrc.includes('bubble-copy-btn'),
    'AgentChat.svelte must render bubble-copy-btn'
  );
  assert.ok(
    chatSrc.includes('📋 Salin'),
    'AgentChat.svelte must include 📋 Salin label'
  );
  assert.ok(
    chatSrc.includes('Tersalin!'),
    'AgentChat.svelte must provide Tersalin! feedback'
  );

  // 3. Code block copy button
  assert.ok(
    chatSrc.includes('code-copy-btn'),
    'AgentChat.svelte must style code-copy-btn'
  );
  assert.ok(
    chatSrc.includes('handleContainerClick'),
    'AgentChat.svelte must define container click handler for code copying'
  );

  // 4. handleSubmit does not prepend conventions to promptText
  assert.ok(
    chatSrc.includes('const text = promptText.trim();'),
    'handleSubmit must keep clean promptText without prepending conventions'
  );
  assert.ok(
    !chatSrc.includes('text = `${prunedBlock}\\n\\n${text}`;'),
    'handleSubmit must NOT mutate text with prunedBlock'
  );
  assert.ok(
    !chatSrc.includes('text = `${memBlock}\\n\\n${text}`;'),
    'handleSubmit must NOT mutate text with memBlock'
  );
});

test('b32 Chat Session UI 7: agents.svelte.ts multi-session isolation and clean prompt storage', () => {
  const storeSrc = fs.readFileSync(path.resolve(uiRoot, 'features/agents/agents.svelte.ts'), 'utf-8');

  // 1. dispatchSessionId tracking at sendPrompt
  assert.ok(
    storeSrc.includes('const dispatchSessionId = this.activeSessionId;'),
    'sendPrompt must capture dispatchSessionId at invocation'
  );

  // 2. userMsg.content strictly contains rawPrompt
  assert.ok(
    storeSrc.includes('content: rawPrompt.trim(),'),
    'userMsg must store only rawPrompt.trim()'
  );

  // 3. Stale session response routed to appendMessageToSavedSession
  assert.ok(
    storeSrc.includes('dispatchSessionId === this.activeSessionId'),
    'sendPrompt must check if response matches activeSessionId'
  );
  assert.ok(
    storeSrc.includes('this.appendMessageToSavedSession(dispatchSessionId, agentMsg);'),
    'sendPrompt must route stale response to savedSessions'
  );

  // 4. newSession resets status to ready without getting stuck
  assert.ok(
    storeSrc.includes('this.chatHistory[targetSlotId] = [];'),
    'newSession must reset target slot history'
  );
  assert.ok(
    storeSrc.includes('status: \'ready\''),
    'newSession must reset slot status to ready'
  );
  assert.ok(
    storeSrc.includes('appendMessageToSavedSession('),
    'Store must declare appendMessageToSavedSession method'
  );
});

test('b32 Chat Session UI 8: renderChatMarkdown includes code copy button in code block header', () => {
  const md = 'Contoh script:\n```bash\nnpm run test\n```';
  const html = renderChatMarkdown(md);

  assert.ok(html.includes('chat-code-header'), 'Rendered markdown must have chat-code-header');
  assert.ok(html.includes('code-copy-btn'), 'Rendered markdown must include code-copy-btn');
  assert.ok(html.includes('📋 Salin'), 'Copy button must have 📋 Salin text');
  assert.ok(html.includes('<span class="chat-code-lang">bash</span>'), 'Header must retain language tag');
});
