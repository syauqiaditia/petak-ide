import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  sanitizeSessions,
  generateSessionId,
} from '../ui/features/agents/agentsLogic.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uiRoot = path.resolve(__dirname, '../ui');

// =============================================================================
// Suite 1: Keyed each compound key logic never produces duplicate keys
// =============================================================================
test('b46 Session Switcher 1: Keyed each compound key logic never produces duplicate keys even with duplicate IDs', () => {
  const agentChatPath = path.resolve(uiRoot, 'features/agents/AgentChat.svelte');
  const agentChatSrc = fs.readFileSync(agentChatPath, 'utf8');

  // Verify AgentChat.svelte contains bulletproof keyed each
  assert.ok(
    agentChatSrc.includes('{#each messages as msg, idx (msg.id ? `${msg.id}-${idx}` : `msg-${idx}`)}'),
    'AgentChat.svelte must use compound keyed each pattern with index suffix'
  );

  // Test compound key generator with duplicate, undefined, null, and empty IDs
  const testMessages = [
    { id: 'id1', role: 'user', content: 'Pesan 1' },
    { id: 'id1', role: 'agent', content: 'Pesan 2 duplicate ID' },
    { id: undefined, role: 'user', content: 'Pesan 3 undefined ID' },
    { id: null, role: 'agent', content: 'Pesan 4 null ID' },
    { id: '', role: 'system', content: 'Pesan 5 empty ID' },
    { id: 'id1', role: 'agent', content: 'Pesan 6 third duplicate ID' },
  ];

  const keyFn = (msg, idx) => (msg.id ? `${msg.id}-${idx}` : `msg-${idx}`);
  const generatedKeys = testMessages.map(keyFn);

  assert.equal(generatedKeys.length, testMessages.length, 'Should generate a key for every message');
  const uniqueKeys = new Set(generatedKeys);
  assert.equal(
    uniqueKeys.size,
    testMessages.length,
    'Compound keys must all be strictly unique even with identical or missing IDs'
  );
  assert.equal(generatedKeys[0], 'id1-0');
  assert.equal(generatedKeys[1], 'id1-1');
  assert.equal(generatedKeys[2], 'msg-2');
  assert.equal(generatedKeys[3], 'msg-3');
  assert.equal(generatedKeys[4], 'msg-4');
  assert.equal(generatedKeys[5], 'id1-5');
});

// =============================================================================
// Suite 2: loadSession sanitizes missing message IDs and never mutates daemon slot
// =============================================================================
test('b46 Session Switcher 2: loadSession sanitizes missing message IDs and never mutates daemon slot config', () => {
  const storePath = path.resolve(uiRoot, 'features/agents/agents.svelte.ts');
  const storeSrc = fs.readFileSync(storePath, 'utf8');

  // 1. Verify updateSlotModel is NOT called inside loadSession (read-only navigation)
  const loadSessionStart = storeSrc.indexOf('loadSession(session:');
  assert.ok(loadSessionStart !== -1, 'loadSession method must exist');
  const loadSessionEnd = storeSrc.indexOf('deleteSession(sessionId:', loadSessionStart);
  assert.ok(loadSessionEnd !== -1, 'deleteSession method must follow loadSession');
  const loadSessionBody = storeSrc.slice(loadSessionStart, loadSessionEnd);

  assert.ok(
    !loadSessionBody.includes('this.updateSlotModel'),
    'loadSession must NOT call this.updateSlotModel during read-only history navigation'
  );

  // 2. Verify loadSession maps targetSession.messages with auto-sanitization
  assert.ok(
    loadSessionBody.includes('targetSession.messages = targetSession.messages.map((m, idx) => ({'),
    'loadSession must sanitize messages array'
  );
  assert.ok(
    loadSessionBody.includes('id: m.id || `msg-${targetSession!.id}-${idx}`'),
    'loadSession must assign unique fallback ID for messages missing id'
  );

  // 3. Simulate loadSession message sanitization behavior
  const mockTargetSession = {
    id: 'sess-read-only-1',
    slotId: 'senior',
    title: 'Testing Session',
    createdAt: 1000,
    updatedAt: 1000,
    modelId: 'claude-3-5-sonnet',
    messages: [
      { content: 'Pertanyaan pertama', role: 'user' }, // missing ID
      { id: 'valid-agent-id', content: 'Jawaban', role: 'agent' },
      { content: 'Pertanyaan kedua', role: 'user' }, // missing ID
    ],
    fileReferences: [],
    isStreaming: false,
    streamingContent: '',
    activeToolCalls: [],
    activeThought: '',
  };

  mockTargetSession.messages = mockTargetSession.messages.map((m, idx) => ({
    ...m,
    id: m.id || `msg-${mockTargetSession.id}-${idx}`,
  }));

  assert.equal(mockTargetSession.messages[0].id, 'msg-sess-read-only-1-0');
  assert.equal(mockTargetSession.messages[1].id, 'valid-agent-id');
  assert.equal(mockTargetSession.messages[2].id, 'msg-sess-read-only-1-2');
});

// =============================================================================
// Suite 3: newSession reuses empty session when active session has 0 messages
// =============================================================================
test('b46 Session Switcher 3: newSession reuses empty session when active session has 0 messages and is not streaming', () => {
  const storePath = path.resolve(uiRoot, 'features/agents/agents.svelte.ts');
  const storeSrc = fs.readFileSync(storePath, 'utf8');

  // Verify guard exists in newSession
  assert.ok(
    storeSrc.includes('if (this.activeSession && this.activeSession.messages.length === 0 && !this.activeSession.isStreaming)'),
    'newSession must check for empty non-streaming activeSession to prevent ghost sessions'
  );
  assert.ok(
    storeSrc.includes('this.isHistoryOpen = false;\n      return;'),
    'newSession must close history and return early when reusing empty session'
  );

  // Simulate newSession logic
  let sessions = {
    'sess-empty-1': {
      id: 'sess-empty-1',
      slotId: 'default',
      title: 'Percakapan Baru',
      createdAt: 1000,
      updatedAt: 1000,
      messages: [],
      fileReferences: [],
      isStreaming: false,
      streamingContent: '',
      activeToolCalls: [],
      activeThought: '',
    },
  };
  let activeSessionId = 'sess-empty-1';
  let isHistoryOpen = true;

  function simulateNewSession() {
    const active = sessions[activeSessionId];
    if (active && active.messages.length === 0 && !active.isStreaming) {
      isHistoryOpen = false;
      return;
    }
    const newId = generateSessionId();
    sessions[newId] = {
      id: newId,
      slotId: 'default',
      title: 'Percakapan Baru',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [],
      fileReferences: [],
      isStreaming: false,
      streamingContent: '',
      activeToolCalls: [],
      activeThought: '',
    };
    activeSessionId = newId;
    isHistoryOpen = false;
  }

  // 1. Calling simulateNewSession when active session is empty does not create a new session
  simulateNewSession();
  assert.equal(Object.keys(sessions).length, 1, 'Must NOT create duplicate session when active session is empty');
  assert.equal(activeSessionId, 'sess-empty-1', 'Active session ID must remain unchanged');
  assert.equal(isHistoryOpen, false, 'History dropdown must close');

  // 2. Calling simulateNewSession after adding a message creates a new session
  sessions['sess-empty-1'].messages.push({ id: 'm1', role: 'user', content: 'Halo', timestamp: 1002 });
  simulateNewSession();
  assert.equal(Object.keys(sessions).length, 2, 'Must create a new session when active session has messages');
  assert.notEqual(activeSessionId, 'sess-empty-1', 'Active session ID must change to new session');
});

// =============================================================================
// Suite 4: Session navigation always resets activeSubTab to 'chat'
// =============================================================================
test('b46 Session Switcher 4: Session navigation always resets activeSubTab to \'chat\' and header switcher exists', () => {
  const panelPath = path.resolve(uiRoot, 'features/agents/AgentsPanel.svelte');
  const panelSrc = fs.readFileSync(panelPath, 'utf8');

  // 1. Verify session row onclick resets activeSubTab to 'chat'
  assert.ok(
    panelSrc.includes("agentsStore.loadSession(sess); activeSubTab = 'chat';"),
    'AgentsPanel.svelte must set activeSubTab to "chat" on session click'
  );

  // 2. Verify Session Switcher button in header actions
  assert.ok(
    panelSrc.includes('session-switcher-btn'),
    'AgentsPanel.svelte must render .session-switcher-btn in header'
  );
  assert.ok(
    panelSrc.includes("agentsStore.activeSession?.title || 'Percakapan'"),
    'Header session switcher must display active session title'
  );
  assert.ok(
    panelSrc.includes('agentsStore.toggleHistory()'),
    'Header session switcher button must toggle history'
  );

  // 3. Verify CSS rules for session-switcher-btn prevent overflowing
  assert.ok(
    panelSrc.includes('.panel-icon-btn.session-switcher-btn'),
    'CSS must define styling for .session-switcher-btn'
  );
  assert.ok(
    panelSrc.includes('.session-switcher-title'),
    'CSS must define .session-switcher-title with text-overflow ellipsis'
  );
});

// =============================================================================
// Suite 5: loadSavedSessions sanitization repairs corrupted message IDs
// =============================================================================
test('b46 Session Switcher 5: loadSavedSessions sanitization correctly repairs legacy corrupted message IDs without data loss', () => {
  const storePath = path.resolve(uiRoot, 'features/agents/agents.svelte.ts');
  const storeSrc = fs.readFileSync(storePath, 'utf8');

  // Verify loadSavedSessions calls sanitizeSessions
  assert.ok(
    storeSrc.includes('this.sessions = sanitizeSessions(parsed);'),
    'loadSavedSessions must run sanitizeSessions on v2 parsed sessions'
  );
  assert.ok(
    storeSrc.includes('this.sessions = sanitizeSessions(migrated);'),
    'loadSavedSessions must run sanitizeSessions on migrated v1 sessions'
  );

  // Test sanitizeSessions directly with corrupted legacy session data
  const legacyCorrupted = {
    'legacy-sess-1': {
      title: 'Legacy Corrupted Session',
      createdAt: 5000,
      updatedAt: 6000,
      slotId: 'senior',
      messages: [
        { role: 'user', content: 'Pesan tanpa ID', timestamp: 5001 },
        { id: 'dup-id', role: 'agent', content: 'Pesan ID kembar 1', timestamp: 5002 },
        { id: 'dup-id', role: 'user', content: 'Pesan ID kembar 2', timestamp: 5003 },
        { id: null, role: 'agent', content: 'Pesan ID null', timestamp: 5004 },
      ],
      fileReferences: [{ path: 'lib/main.dart', name: 'main.dart' }],
    },
    'legacy-sess-2-no-id': {
      // id field omitted
      title: 'Session without explicit ID',
      messages: [
        { id: 'ok-id', role: 'user', content: 'Normal', timestamp: 7001 },
      ],
    },
  };

  const sanitized = sanitizeSessions(legacyCorrupted);

  // Verify sess 1
  assert.ok(sanitized['legacy-sess-1'], 'legacy-sess-1 must exist in sanitized output');
  const sess1 = sanitized['legacy-sess-1'];
  assert.equal(sess1.id, 'legacy-sess-1');
  assert.equal(sess1.title, 'Legacy Corrupted Session');
  assert.equal(sess1.messages.length, 4);

  // Every message must have unique valid ID
  const msgIds = sess1.messages.map((m) => m.id);
  const uniqueMsgIds = new Set(msgIds);
  assert.equal(uniqueMsgIds.size, 4, 'All message IDs in legacy-sess-1 must be unique');

  // Verify content preservation (zero data loss)
  assert.equal(sess1.messages[0].content, 'Pesan tanpa ID');
  assert.equal(sess1.messages[0].role, 'user');
  assert.equal(sess1.messages[0].id, 'msg-legacy-sess-1-0');

  assert.equal(sess1.messages[1].content, 'Pesan ID kembar 1');
  assert.equal(sess1.messages[1].id, 'dup-id');

  assert.equal(sess1.messages[2].content, 'Pesan ID kembar 2');
  assert.equal(sess1.messages[2].id, 'dup-id-2'); // index-suffixed to resolve collision

  assert.equal(sess1.messages[3].content, 'Pesan ID null');
  assert.equal(sess1.messages[3].id, 'msg-legacy-sess-1-3');

  // Verify sess 2
  assert.ok(sanitized['legacy-sess-2-no-id']);
  const sess2 = sanitized['legacy-sess-2-no-id'];
  assert.equal(sess2.id, 'legacy-sess-2-no-id', 'Session ID must fall back to record key');
  assert.equal(sess2.messages[0].id, 'ok-id');
  assert.equal(sess2.messages[0].content, 'Normal');
});
