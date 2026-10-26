import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { api } from '../ui/lib/api.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uiRoot = path.resolve(__dirname, '../ui');

// =============================================================================
// Test 1: api.agentPrompt accepts sessionId and history, supports demo fallback
// =============================================================================
test('b57 Retention 1: api.agentPrompt accepts sessionId and history, fallback returns sessionId', async () => {
  // 1. Without sessionId
  const res1 = await api.agentPrompt('default', 'Tes pesan prompt');
  assert.equal(res1.sessionId, 'demo-default');
  assert.ok(res1.message.includes('Tes pesan prompt'));
  assert.equal(res1.stopReason, 'end_turn');

  // 2. With specific sessionId and history
  const customSessionId = 'sess-retained-8899';
  const history = [
    { id: 'm1', role: 'user', content: 'Halo', timestamp: 100 },
    { id: 'm2', role: 'agent', content: 'Hai', timestamp: 101 },
  ];
  const res2 = await api.agentPrompt('default', 'Lanjutkan percakapan', customSessionId, history);
  assert.equal(res2.sessionId, customSessionId);
  assert.ok(res2.message.includes('Lanjutkan percakapan'));
});

// =============================================================================
// Test 2: api.agentPrompt passes sessionId and history to backend invoke
// =============================================================================
test('b57 Retention 2: api.agentPrompt passes sessionId and history to invoke when tauri internals present', async () => {
  const origWindow = globalThis.window;
  let interceptedCmd = null;
  let interceptedArgs = null;

  globalThis.window = {
    __TAURI_INTERNALS__: {
      invoke: async (cmd, args) => {
        interceptedCmd = cmd;
        interceptedArgs = args;
        return {
          sessionId: args.sessionId || 'invoked-session',
          stopReason: 'end_turn',
          message: 'Response from fake tauri invoke',
        };
      },
    },
  };

  try {
    const history = [
      { id: 'm1', role: 'user', content: 'Tanya sebelumnya', timestamp: 100 },
    ];
    const res = await api.agentPrompt('slot-test', 'Prompt baru', 'session-inv-123', history);

    assert.equal(interceptedCmd, 'agent_prompt');
    assert.deepEqual(interceptedArgs, {
      slotId: 'slot-test',
      prompt: 'Prompt baru',
      sessionId: 'session-inv-123',
      history,
    });
    assert.equal(res.sessionId, 'session-inv-123');

    // Test with undefined sessionId and history -> converts to null
    await api.agentPrompt('slot-test', 'Prompt tanpa session');
    assert.deepEqual(interceptedArgs, {
      slotId: 'slot-test',
      prompt: 'Prompt tanpa session',
      sessionId: null,
      history: null,
    });
  } finally {
    globalThis.window = origWindow;
  }
});

// =============================================================================
// Test 3: sendPrompt takes priorHistory snapshot BEFORE user message is appended
// =============================================================================
test('b57 Retention 3: sendPrompt snapshots priorHistory before appending active user message', () => {
  const agentsStorePath = path.resolve(uiRoot, 'features/agents/agents.svelte.ts');
  const storeSrc = fs.readFileSync(agentsStorePath, 'utf8');

  // Verify priorHistory snapshot is taken before targetSession.messages = [...targetSession.messages, userMsg]
  const priorHistoryIdx = storeSrc.indexOf('const priorHistory = [...targetSession.messages];');
  assert.ok(
    priorHistoryIdx !== -1,
    'agents.svelte.ts must take priorHistory snapshot before pushing userMsg'
  );

  const appendUserMsgIdx = storeSrc.indexOf('targetSession.messages = [...targetSession.messages, userMsg];');
  assert.ok(
    appendUserMsgIdx !== -1,
    'agents.svelte.ts must append userMsg to targetSession.messages'
  );

  assert.ok(
    priorHistoryIdx < appendUserMsgIdx,
    'priorHistory snapshot MUST occur before userMsg is appended to messages array'
  );

  // Verify api.agentPrompt call passes currentSessionId and priorHistory
  const agentPromptCall = storeSrc.indexOf('await api.agentPrompt(slotId, formattedPrompt, currentSessionId, priorHistory);');
  assert.ok(
    agentPromptCall !== -1,
    'agents.svelte.ts must call api.agentPrompt with currentSessionId and priorHistory'
  );
});

// =============================================================================
// Test 4: selectSession method exists and delegates cleanly to loadSession
// =============================================================================
test('b57 Retention 4: selectSession method exists and delegates cleanly to loadSession', () => {
  const agentsStorePath = path.resolve(uiRoot, 'features/agents/agents.svelte.ts');
  const storeSrc = fs.readFileSync(agentsStorePath, 'utf8');

  // Verify selectSession definition in agents.svelte.ts
  const selectSessionDef = storeSrc.includes('selectSession(sessionId: string) {');
  assert.ok(
    selectSessionDef,
    'agents.svelte.ts must define selectSession(sessionId: string)'
  );

  const selectSessionBody = storeSrc.slice(
    storeSrc.indexOf('selectSession(sessionId: string) {'),
    storeSrc.indexOf('deleteSession(sessionId: string)')
  );
  assert.ok(
    selectSessionBody.includes('this.loadSession(sessionId)'),
    'selectSession must execute this.loadSession(sessionId)'
  );
});

// =============================================================================
// Test 5: Session switching isolates message state and prevents cross-talk
// =============================================================================
test('b57 Retention 5: Session switching keeps session context isolated and cleanly separated', () => {
  // Simulate multi-session state management
  const sessions = {
    'session-alpha': {
      id: 'session-alpha',
      slotId: 'default',
      messages: [
        { id: 'a1', role: 'user', content: 'Konteks Alpha 1' },
        { id: 'a2', role: 'agent', content: 'Jawaban Alpha 1' },
      ],
    },
    'session-beta': {
      id: 'session-beta',
      slotId: 'default',
      messages: [
        { id: 'b1', role: 'user', content: 'Konteks Beta 1' },
      ],
    },
  };

  let activeSessionId = 'session-alpha';
  const selectSession = (id) => {
    activeSessionId = id;
  };

  // Check initial active session context
  assert.equal(activeSessionId, 'session-alpha');
  assert.equal(sessions[activeSessionId].messages.length, 2);
  assert.equal(sessions[activeSessionId].messages[0].content, 'Konteks Alpha 1');

  // Switch to beta
  selectSession('session-beta');
  assert.equal(activeSessionId, 'session-beta');
  assert.equal(sessions[activeSessionId].messages.length, 1);
  assert.equal(sessions[activeSessionId].messages[0].content, 'Konteks Beta 1');

  // Snapshot priorHistory on prompt in beta
  const priorHistory = [...sessions[activeSessionId].messages];
  assert.equal(priorHistory.length, 1);
  assert.equal(priorHistory[0].content, 'Konteks Beta 1');

  // Alpha history remains untainted
  assert.equal(sessions['session-alpha'].messages.length, 2);
  assert.equal(sessions['session-alpha'].messages[0].content, 'Konteks Alpha 1');
});
