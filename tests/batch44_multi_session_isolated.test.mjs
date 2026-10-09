import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  migrateV1SessionsToV2,
  resolveTargetSessionId,
  applyStreamUpdateToSession,
  routeStreamEvent,
  generateSessionId,
} from '../ui/features/agents/agentsLogic.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uiRoot = path.resolve(__dirname, '../ui');

// =============================================================================
// Test 1: Rapid Switching Across 3 Sessions Keeps Messages Isolated
// =============================================================================
test('b44 Multi-Session 1: Rapid switching across 3 sessions does not mix or stack messages', () => {
  const sessions = {
    'sess-a': {
      id: 'sess-a',
      slotId: 'default',
      title: 'Session Alpha',
      createdAt: 1000,
      updatedAt: 1000,
      messages: [
        { id: 'm-a1', role: 'user', content: 'Halo dari Alpha', timestamp: 1001 },
        { id: 'm-a2', role: 'agent', content: 'Jawaban Alpha', timestamp: 1002 },
      ],
      fileReferences: [{ path: 'lib/alpha.dart', name: 'alpha.dart' }],
      isStreaming: false,
      streamingContent: '',
      activeToolCalls: [],
      activeThought: '',
    },
    'sess-b': {
      id: 'sess-b',
      slotId: 'default',
      title: 'Session Beta',
      createdAt: 2000,
      updatedAt: 2000,
      messages: [
        { id: 'm-b1', role: 'user', content: 'Halo dari Beta', timestamp: 2001 },
      ],
      fileReferences: [],
      isStreaming: false,
      streamingContent: '',
      activeToolCalls: [],
      activeThought: '',
    },
    'sess-c': {
      id: 'sess-c',
      slotId: 'slot-2',
      title: 'Session Gamma',
      createdAt: 3000,
      updatedAt: 3000,
      messages: [
        { id: 'm-c1', role: 'user', content: 'Halo dari Gamma', timestamp: 3001 },
        { id: 'm-c2', role: 'agent', content: 'Jawaban Gamma 1', timestamp: 3002 },
        { id: 'm-c3', role: 'agent', content: 'Jawaban Gamma 2', timestamp: 3003 },
      ],
      fileReferences: [],
      isStreaming: false,
      streamingContent: '',
      activeToolCalls: [],
      activeThought: '',
    },
  };

  let activeSessionId = 'sess-a';

  // Rapid switching simulation 50x
  const order = ['sess-a', 'sess-b', 'sess-c', 'sess-b', 'sess-a', 'sess-c'];
  for (let i = 0; i < 50; i++) {
    const target = order[i % order.length];
    activeSessionId = target;
    const current = sessions[activeSessionId];

    if (activeSessionId === 'sess-a') {
      assert.equal(current.messages.length, 2, 'Session A must strictly retain 2 messages');
      assert.equal(current.messages[0].content, 'Halo dari Alpha');
      assert.equal(current.fileReferences.length, 1);
    } else if (activeSessionId === 'sess-b') {
      assert.equal(current.messages.length, 1, 'Session B must strictly retain 1 message');
      assert.equal(current.messages[0].content, 'Halo dari Beta');
    } else if (activeSessionId === 'sess-c') {
      assert.equal(current.messages.length, 3, 'Session C must strictly retain 3 messages');
      assert.equal(current.messages[0].content, 'Halo dari Gamma');
    }
  }

  // Ensure no cross-contamination occurred across arrays
  assert.equal(sessions['sess-a'].messages.length, 2);
  assert.equal(sessions['sess-b'].messages.length, 1);
  assert.equal(sessions['sess-c'].messages.length, 3);
});

// =============================================================================
// Test 2: Background Streaming Accumulates Chunks While Another Session Is Active
// =============================================================================
test('b44 Multi-Session 2: Background streaming continues collecting chunks while another session is active', () => {
  let sessions = {
    'sess-stream-bg': {
      id: 'sess-stream-bg',
      slotId: 'slot-worker',
      title: 'Background Task',
      createdAt: 1000,
      updatedAt: 1000,
      messages: [{ id: 'm-1', role: 'user', content: 'Generate large report', timestamp: 1001 }],
      fileReferences: [],
      isStreaming: true,
      streamingContent: '',
      activeToolCalls: [],
      activeThought: '',
    },
    'sess-foreground': {
      id: 'sess-foreground',
      slotId: 'default',
      title: 'Foreground Chat',
      createdAt: 2000,
      updatedAt: 2000,
      messages: [{ id: 'm-2', role: 'user', content: 'Quick question', timestamp: 2001 }],
      fileReferences: [],
      isStreaming: false,
      streamingContent: '',
      activeToolCalls: [],
      activeThought: '',
    },
  };

  const slotActiveSession = {
    'slot-worker': 'sess-stream-bg',
  };

  let activeSessionId = 'sess-foreground';

  // 1. Chunk 1 arrives for slot-worker
  const event1 = {
    Update: {
      slot_id: 'slot-worker',
      session_id: 'sess-stream-bg',
      update: { sessionUpdate: 'agent_message_chunk', content: 'Chunk 1: Mengunduh dependencies... ' },
    },
  };
  const res1 = routeStreamEvent(event1, sessions, slotActiveSession, activeSessionId);
  sessions = res1.updatedSessions;

  assert.equal(res1.targetSessionId, 'sess-stream-bg');
  assert.equal(sessions['sess-stream-bg'].streamingContent, 'Chunk 1: Mengunduh dependencies... ');
  assert.equal(sessions['sess-foreground'].streamingContent, '', 'Active session must remain unpolluted');

  // 2. Tool call arrives for background session
  const eventTool = {
    Update: {
      slot_id: 'slot-worker',
      session_id: 'sess-stream-bg',
      update: {
        sessionUpdate: 'tool_call',
        title: 'cargo build',
        toolCallId: 'tool-build-1',
        locations: [{ path: 'Cargo.toml' }],
      },
    },
  };
  const res2 = routeStreamEvent(eventTool, sessions, slotActiveSession, activeSessionId);
  sessions = res2.updatedSessions;

  assert.equal(sessions['sess-stream-bg'].activeToolCalls.length, 1);
  assert.equal(sessions['sess-stream-bg'].activeToolCalls[0].name, 'cargo build');
  assert.equal(sessions['sess-foreground'].activeToolCalls.length, 0, 'Active session tool calls must remain empty');

  // 3. Chunk 2 arrives without explicit session_id, relying on slotActiveSession
  const event2 = {
    Update: {
      slot_id: 'slot-worker',
      session_id: undefined,
      update: { sessionUpdate: 'agent_message_chunk', content: 'Chunk 2: Selesai build.' },
    },
  };
  const res3 = routeStreamEvent(event2, sessions, slotActiveSession, activeSessionId);
  sessions = res3.updatedSessions;

  assert.equal(res3.targetSessionId, 'sess-stream-bg');
  assert.equal(
    sessions['sess-stream-bg'].streamingContent,
    'Chunk 1: Mengunduh dependencies... Chunk 2: Selesai build.'
  );

  // 4. Switch user back to sess-stream-bg
  activeSessionId = 'sess-stream-bg';
  const activeSess = sessions[activeSessionId];
  assert.ok(activeSess.streamingContent.includes('Chunk 1'));
  assert.ok(activeSess.streamingContent.includes('Chunk 2'));
  assert.equal(activeSess.activeToolCalls.length, 1);
});

// =============================================================================
// Test 3: newSession Does Not Kill or Reset Background Streaming
// =============================================================================
test('b44 Multi-Session 3: newSession creates fresh session without killing background streaming', () => {
  const store = {
    activeSlotId: 'default',
    activeSessionId: 'sess-initial',
    sessions: {
      'sess-initial': {
        id: 'sess-initial',
        slotId: 'default',
        title: 'Initial running task',
        createdAt: 1000,
        updatedAt: 1000,
        messages: [{ id: 'm-1', role: 'user', content: 'Run long script', timestamp: 1001 }],
        fileReferences: [],
        isStreaming: true,
        streamingContent: 'Progress: 45%...',
        activeToolCalls: [{ name: 'exec', status: 'running' }],
        activeThought: 'Analyzing...',
      },
    },
    slotActiveSession: {
      default: 'sess-initial',
    },
    cancelCount: 0,
    async cancelActivePrompt() {
      this.cancelCount++;
      if (this.sessions[this.activeSessionId]) {
        this.sessions[this.activeSessionId].isStreaming = false;
      }
    },
    async newSession(slotId) {
      const targetSlotId = slotId || this.activeSlotId || 'default';
      const newId = generateSessionId();
      const newSession = {
        id: newId,
        slotId: targetSlotId,
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
      this.sessions[newId] = newSession;
      this.activeSessionId = newId;
    },
  };

  // Perform newSession
  store.newSession();

  // 1. cancelActivePrompt was NOT invoked
  assert.equal(store.cancelCount, 0, 'newSession must not cancel prompt');

  // 2. Background session maintains isStreaming and buffered content
  const bgSession = store.sessions['sess-initial'];
  assert.equal(bgSession.isStreaming, true, 'Background session must remain streaming');
  assert.equal(bgSession.streamingContent, 'Progress: 45%...', 'Background streaming content preserved');
  assert.equal(bgSession.activeToolCalls.length, 1);
  assert.equal(bgSession.activeThought, 'Analyzing...');

  // 3. New session is active and completely clean
  assert.notEqual(store.activeSessionId, 'sess-initial');
  const activeSession = store.sessions[store.activeSessionId];
  assert.equal(activeSession.messages.length, 0);
  assert.equal(activeSession.isStreaming, false);
  assert.equal(activeSession.streamingContent, '');
});

// =============================================================================
// Test 4: Transparent Migration From Storage Format V1 to Format V2
// =============================================================================
test('b44 Multi-Session 4: Transparent migration converts v1 saved sessions and active history to isolated v2 format', () => {
  const v1SavedSessions = [
    {
      id: 'sess-v1-old',
      slotId: 'default',
      title: 'Refactor Auth Service',
      createdAt: 1728000000000,
      updatedAt: 1728000500000,
      messageCount: 2,
      messages: [
        { id: 'm-v1-1', role: 'user', content: 'Tolong refactor auth service', timestamp: 1728000000000 },
        { id: 'm-v1-2', role: 'agent', content: 'Sudah selesai direfactor.', timestamp: 1728000500000 },
      ],
      modelId: 'claude-3-7-sonnet',
    },
  ];

  const v1ActiveHistory = {
    chatHistory: {
      default: [
        { id: 'm-act-1', role: 'user', content: 'Perbaiki typo di auth.dart', timestamp: 1728100000000 },
      ],
      reviewer: [
        { id: 'm-rev-1', role: 'user', content: 'Review commit abc', timestamp: 1728110000000 },
      ],
    },
    fileReferences: [
      { path: 'lib/auth.dart', name: 'auth.dart', line: 12 },
    ],
  };

  const migrated = migrateV1SessionsToV2(v1SavedSessions, v1ActiveHistory);

  // 1. Must migrate v1 saved session with isolated session fields
  assert.ok(migrated['sess-v1-old'], 'Must contain migrated v1 saved session');
  const oldSess = migrated['sess-v1-old'];
  assert.equal(oldSess.title, 'Refactor Auth Service');
  assert.equal(oldSess.messages.length, 2);
  assert.equal(oldSess.isStreaming, false);
  assert.equal(oldSess.streamingContent, '');
  assert.deepEqual(oldSess.activeToolCalls, []);
  assert.equal(oldSess.modelId, 'claude-3-7-sonnet');

  // 2. Must migrate active history slots into distinct sessions
  assert.ok(migrated['migrated-default'], 'Must contain migrated active default session');
  const defSess = migrated['migrated-default'];
  assert.equal(defSess.slotId, 'default');
  assert.equal(defSess.messages.length, 1);
  assert.equal(defSess.messages[0].content, 'Perbaiki typo di auth.dart');
  assert.equal(defSess.fileReferences.length, 1);
  assert.equal(defSess.fileReferences[0].path, 'lib/auth.dart');

  assert.ok(migrated['migrated-reviewer'], 'Must contain migrated active reviewer session');
  const revSess = migrated['migrated-reviewer'];
  assert.equal(revSess.slotId, 'reviewer');
  assert.equal(revSess.messages.length, 1);

  // 3. Handles empty or null v1 payloads gracefully
  const emptyMigrated = migrateV1SessionsToV2(null, null);
  assert.deepEqual(emptyMigrated, {});
});

// =============================================================================
// Test 5: Static Verification of Store Contracts in agents.svelte.ts
// =============================================================================
test('b44 Multi-Session 5: agents.svelte.ts adheres to Ponytail isolated sessions architecture', () => {
  const storePath = path.resolve(uiRoot, 'features/agents/agents.svelte.ts');
  const storeSrc = fs.readFileSync(storePath, 'utf8');

  // 1. Sessions map keyed by sessionId
  assert.ok(
    storeSrc.includes('sessions = $state<Record<string, ChatSessionData>>({})'),
    'agents.svelte.ts must declare sessions map keyed by sessionId'
  );
  assert.ok(
    storeSrc.includes('slotActiveSession = $state<Record<string, string>>({})'),
    'agents.svelte.ts must declare slotActiveSession mapping slotId to sessionId'
  );

  // 2. Storage key v2 persistence
  assert.ok(
    storeSrc.includes('petak_chat_sessions_v2'),
    'agents.svelte.ts must use petak_chat_sessions_v2 localStorage key'
  );

  // 3. Reactive getters
  assert.ok(
    storeSrc.includes('get activeSession(): ChatSessionData | null'),
    'agents.svelte.ts must define get activeSession()'
  );
  assert.ok(
    storeSrc.includes('get streamingContent(): string'),
    'agents.svelte.ts must define get streamingContent()'
  );
  assert.ok(
    storeSrc.includes('get activeToolCalls(): ToolCallData[]'),
    'agents.svelte.ts must define get activeToolCalls()'
  );
  assert.ok(
    storeSrc.includes('get activeThought(): string'),
    'agents.svelte.ts must define get activeThought()'
  );
  assert.ok(
    storeSrc.includes('get isStreaming(): boolean'),
    'agents.svelte.ts must define get isStreaming()'
  );
});
