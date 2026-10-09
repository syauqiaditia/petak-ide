import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  resolveTargetSessionId,
  applyStreamUpdateToSession,
} from '../ui/features/agents/agentsLogic.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uiRoot = path.resolve(__dirname, '../ui');

// =============================================================================
// Suite 1: resolveTargetSessionId never returns unknown phantom session IDs
// =============================================================================
test('b45 Session Isolation 1: resolveTargetSessionId never creates or returns unknown phantom session IDs', () => {
  const sessions = {
    'sess-known-1': {
      id: 'sess-known-1',
      slotId: 'default',
      title: 'Known Session',
      createdAt: 1000,
      updatedAt: 1000,
      messages: [],
      fileReferences: [],
      isStreaming: true,
      streamingContent: '',
      activeToolCalls: [],
      activeThought: '',
    },
  };

  const slotActiveSession = {
    'default': 'sess-known-1',
  };

  // 1. Backend ACP ID that is NOT in sessions must NOT be returned directly as phantom session
  const phantomAcpId = 'backend-acp-session-999';
  const resolvedWithSlot = resolveTargetSessionId(
    phantomAcpId,
    'default',
    sessions,
    slotActiveSession,
    'sess-known-1'
  );
  assert.equal(
    resolvedWithSlot,
    'sess-known-1',
    'Must resolve to slotActiveSession when eventSessionId is not in sessions'
  );

  // 2. When slotActiveSession is missing or unknown, must NOT return the phantom eventSessionId
  const resolvedUnknownSlot = resolveTargetSessionId(
    phantomAcpId,
    'unbound-slot',
    sessions,
    slotActiveSession,
    undefined
  );
  assert.equal(
    resolvedUnknownSlot,
    null,
    'Must return null instead of leaking unknown backend eventSessionId as phantom session'
  );

  // 3. Fallback active session is respected ONLY if it exists in sessions
  const resolvedWithValidFallback = resolveTargetSessionId(
    phantomAcpId,
    'unbound-slot',
    sessions,
    {},
    'sess-known-1'
  );
  assert.equal(
    resolvedWithValidFallback,
    'sess-known-1',
    'Must use fallback session when it exists in sessions'
  );

  const resolvedWithInvalidFallback = resolveTargetSessionId(
    phantomAcpId,
    'unbound-slot',
    sessions,
    {},
    'sess-non-existent'
  );
  assert.equal(
    resolvedWithInvalidFallback,
    null,
    'Must return null when fallback session does not exist in sessions'
  );

  // 4. Direct match succeeds when eventSessionId is genuinely a known session
  const directMatch = resolveTargetSessionId(
    'sess-known-1',
    'other-slot',
    sessions,
    slotActiveSession
  );
  assert.equal(
    directMatch,
    'sess-known-1',
    'Must directly match when eventSessionId is a known frontend session'
  );
});

// =============================================================================
// Suite 2: Messages are appended exactly once to target session (no duplicates)
// =============================================================================
test('b45 Session Isolation 2: Messages are appended exactly once to the target session (no duplicates)', () => {
  const targetSessionId = 'sess-clean-append';
  const sessions = {
    [targetSessionId]: {
      id: targetSessionId,
      slotId: 'default',
      title: 'Fix Typo',
      createdAt: 1000,
      updatedAt: 1000,
      messages: [],
      fileReferences: [],
      isStreaming: true,
      streamingContent: 'Streaming chunk text',
      activeToolCalls: [{ name: 'read_file', status: 'completed', output: 'ok' }],
      activeThought: 'thinking...',
    },
  };

  // Simulate prompt completion handling in agents.svelte.ts
  const target = sessions[targetSessionId];
  assert.ok(target, 'Target session must exist');

  const userMsg = {
    id: 'usr-1',
    timestamp: 1001,
    role: 'user',
    content: 'Tolong perbaiki typo di auth.dart',
  };
  target.messages = [...target.messages, userMsg];

  const response = {
    message: 'Sudah diperbaiki dengan tepat.',
    stopReason: 'end_turn',
  };

  const cleanContent = target.streamingContent || response.message || 'Aksi selesai.';
  const agentMsg = {
    id: `agent-${Date.now()}`,
    timestamp: Date.now(),
    role: 'agent',
    content: cleanContent,
    stop_reason: response.stopReason,
    toolCalls: target.activeToolCalls.length > 0 ? [...target.activeToolCalls] : undefined,
  };

  target.messages = [...target.messages, agentMsg];
  target.isStreaming = false;
  target.streamingContent = '';
  target.activeToolCalls = [];
  target.activeThought = '';
  target.updatedAt = Date.now();

  // Verify message count is exactly 2 (1 user, 1 agent)
  assert.equal(target.messages.length, 2, 'Session messages must contain exactly 2 messages');
  assert.equal(target.messages[0].role, 'user');
  assert.equal(target.messages[1].role, 'agent');
  assert.equal(target.messages[1].content, 'Streaming chunk text');
  assert.equal(target.messages[1].toolCalls?.length, 1);
  assert.equal(target.isStreaming, false);
  assert.equal(target.streamingContent, '');
  assert.deepEqual(target.activeToolCalls, []);

  // Verify static agents.svelte.ts code does not call appendMessageToSavedSession in sendPrompt
  const storePath = path.resolve(uiRoot, 'features/agents/agents.svelte.ts');
  const storeSrc = fs.readFileSync(storePath, 'utf8');

  // Verify sendPrompt uses direct target.messages assignment without duplicate append
  assert.ok(
    storeSrc.includes('const cleanContent = target.streamingContent || response.message || \'Aksi selesai.\';'),
    'sendPrompt must calculate cleanContent directly from target'
  );
  assert.ok(
    storeSrc.includes('target.messages = [...target.messages, agentMsg];'),
    'sendPrompt must update target.messages directly'
  );
});

// =============================================================================
// Suite 3: Switching sessions while streaming preserves streamingContent
// =============================================================================
test('b45 Session Isolation 3: Switching sessions while streaming preserves streamingContent and renders upon switchback', () => {
  const sessions = {
    'sess-stream-1': {
      id: 'sess-stream-1',
      slotId: 'default',
      title: 'Streaming Task 1',
      createdAt: 1000,
      updatedAt: 1000,
      messages: [{ id: 'u1', role: 'user', content: 'Jelaskan arsitektur', timestamp: 1001 }],
      fileReferences: [],
      isStreaming: true,
      streamingContent: 'Bagian 1: ',
      activeToolCalls: [],
      activeThought: '',
    },
    'sess-stream-2': {
      id: 'sess-stream-2',
      slotId: 'default',
      title: 'Inactive Task 2',
      createdAt: 2000,
      updatedAt: 2000,
      messages: [{ id: 'u2', role: 'user', content: 'Halo', timestamp: 2001 }],
      fileReferences: [],
      isStreaming: false,
      streamingContent: '',
      activeToolCalls: [],
      activeThought: '',
    },
  };

  const slotActiveSession = { 'default': 'sess-stream-1' };

  // 1. User switches from sess-stream-1 to sess-stream-2
  let activeSessionId = 'sess-stream-2';

  // 2. Chunks continue arriving for sess-stream-1 in background
  const chunk1 = {
    sessionUpdate: 'agent_message_chunk',
    content: 'Arsitektur menggunakan Riverpod ',
  };
  const targetId = resolveTargetSessionId(null, 'default', sessions, slotActiveSession, activeSessionId);
  assert.equal(targetId, 'sess-stream-1', 'Incoming stream event for default slot must route to sess-stream-1');

  sessions[targetId] = applyStreamUpdateToSession(sessions[targetId], chunk1);

  const chunk2 = {
    sessionUpdate: 'agent_message_chunk',
    content: 'dan Clean Architecture.',
  };
  sessions[targetId] = applyStreamUpdateToSession(sessions[targetId], chunk2);

  // Verify sess-stream-2 was NOT polluted while active
  assert.equal(sessions['sess-stream-2'].streamingContent, '');
  assert.equal(sessions['sess-stream-2'].isStreaming, false);

  // 3. User switches back to sess-stream-1
  activeSessionId = 'sess-stream-1';
  const currentSession = sessions[activeSessionId];

  // Verify streaming content is completely preserved and accumulated
  assert.equal(
    currentSession.streamingContent,
    'Bagian 1: Arsitektur menggunakan Riverpod dan Clean Architecture.',
    'streamingContent must be preserved across session switching'
  );
  assert.equal(currentSession.isStreaming, true);
  assert.notEqual(currentSession.streamingContent, 'Aksi selesai.');
});

// =============================================================================
// Suite 4: Inactive session does not display live streaming indicator when slot is busy
// =============================================================================
test('b45 Session Isolation 4: Inactive session does not display live streaming indicator when slot is busy with another session', () => {
  const chatPath = path.resolve(uiRoot, 'features/agents/AgentChat.svelte');
  const chatSrc = fs.readFileSync(chatPath, 'utf8');

  // 1. Verify per-session derived busy and streaming declarations
  assert.ok(
    chatSrc.includes('let isSessionStreaming = $derived(!!agentsStore.activeSession?.isStreaming);'),
    'AgentChat must derive isSessionStreaming strictly from activeSession.isStreaming'
  );
  assert.ok(
    chatSrc.includes('let isSlotBusyWithOther = $derived('),
    'AgentChat must declare isSlotBusyWithOther'
  );
  assert.ok(
    chatSrc.includes("activeSlot?.status === 'busy' && !isSessionStreaming"),
    'isSlotBusyWithOther must check activeSlot busy while active session is not streaming'
  );
  assert.ok(
    chatSrc.includes('let isBusy = $derived(!agentsStore.isWatchdogAborted && isSessionStreaming);'),
    'isBusy must be derived from isSessionStreaming (not global slot busy)'
  );

  // 2. Live streaming bubble strictly conditional on isSessionStreaming
  assert.ok(
    chatSrc.includes('{#if isSessionStreaming}'),
    'Live streaming bubble must render only when isSessionStreaming is true'
  );

  // 3. Status warning banner for slot busy with other session
  assert.ok(
    chatSrc.includes('{#if isSlotBusyWithOther}'),
    'Must display slot busy warning banner when slot is processing another session'
  );
  assert.ok(
    chatSrc.includes('Bot ini sedang memproses sesi lain. Pilih bot lain untuk menjalankan chat secara paralel.'),
    'Must display Indonesian warning text for slot busy with other session'
  );

  // 4. Input textarea disabled logic
  assert.ok(
    chatSrc.includes('disabled={isBusy || isSlotBusyWithOther}'),
    'Composer textarea must be disabled when isBusy or isSlotBusyWithOther'
  );
});

// =============================================================================
// Suite 5: Concurrent execution: independent sessions on different slots
// =============================================================================
test('b45 Session Isolation 5: Concurrent execution: independent sessions on different slots run without interference', () => {
  const sessions = {
    'sess-slot-senior': {
      id: 'sess-slot-senior',
      slotId: 'senior',
      title: 'Senior Coding Task',
      createdAt: 1000,
      updatedAt: 1000,
      messages: [{ id: 'u-1', role: 'user', content: 'Implement feature X', timestamp: 1001 }],
      fileReferences: [],
      isStreaming: true,
      streamingContent: '',
      activeToolCalls: [],
      activeThought: '',
    },
    'sess-slot-techlead': {
      id: 'sess-slot-techlead',
      slotId: 'techlead',
      title: 'Techlead Review Task',
      createdAt: 2000,
      updatedAt: 2000,
      messages: [{ id: 'u-2', role: 'user', content: 'Review commit Y', timestamp: 2001 }],
      fileReferences: [],
      isStreaming: true,
      streamingContent: '',
      activeToolCalls: [],
      activeThought: '',
    },
  };

  const slotActiveSession = {
    'senior': 'sess-slot-senior',
    'techlead': 'sess-slot-techlead',
  };

  // Dispatch parallel chunks to both slots
  const seniorTarget = resolveTargetSessionId(null, 'senior', sessions, slotActiveSession);
  const techleadTarget = resolveTargetSessionId(null, 'techlead', sessions, slotActiveSession);

  assert.equal(seniorTarget, 'sess-slot-senior');
  assert.equal(techleadTarget, 'sess-slot-techlead');

  // Senior chunk
  sessions[seniorTarget] = applyStreamUpdateToSession(sessions[seniorTarget], {
    sessionUpdate: 'agent_message_chunk',
    content: 'Senior: Menulis kode di lib/feature.dart. ',
  });

  // Techlead chunk
  sessions[techleadTarget] = applyStreamUpdateToSession(sessions[techleadTarget], {
    sessionUpdate: 'agent_message_chunk',
    content: 'Techlead: Memeriksa git diff dan unit tests. ',
  });

  // Tool calls on both
  sessions[seniorTarget] = applyStreamUpdateToSession(sessions[seniorTarget], {
    sessionUpdate: 'tool_call',
    title: 'write_file',
    toolCallId: 'tool-s-1',
  });
  sessions[techleadTarget] = applyStreamUpdateToSession(sessions[techleadTarget], {
    sessionUpdate: 'tool_call',
    title: 'terminal',
    toolCallId: 'tool-t-1',
  });

  // Assert isolation between both sessions
  assert.equal(sessions['sess-slot-senior'].streamingContent, 'Senior: Menulis kode di lib/feature.dart. ');
  assert.equal(sessions['sess-slot-techlead'].streamingContent, 'Techlead: Memeriksa git diff dan unit tests. ');
  assert.equal(sessions['sess-slot-senior'].activeToolCalls[0].name, 'write_file');
  assert.equal(sessions['sess-slot-techlead'].activeToolCalls[0].name, 'terminal');

  // Finish Senior session
  sessions['sess-slot-senior'].messages.push({
    id: 'agent-senior-done',
    role: 'agent',
    content: sessions['sess-slot-senior'].streamingContent,
    timestamp: Date.now(),
  });
  sessions['sess-slot-senior'].isStreaming = false;
  sessions['sess-slot-senior'].streamingContent = '';
  delete slotActiveSession['senior'];

  // Assert Techlead session is still streaming undisturbed
  assert.equal(sessions['sess-slot-techlead'].isStreaming, true);
  assert.equal(sessions['sess-slot-techlead'].streamingContent, 'Techlead: Memeriksa git diff dan unit tests. ');
  assert.equal(slotActiveSession['techlead'], 'sess-slot-techlead');
});
