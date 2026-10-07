import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { computeIsBusy } from '../ui/features/agents/agentsLogic.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uiRoot = path.resolve(__dirname, '../ui');

// =============================================================================
// Suite 1: Accurate Busy State Computation (computeIsBusy)
// =============================================================================

test('b33 Live Status & Stop 1: computeIsBusy evaluates accurately under all conditions', () => {
  // 1. Slot status 'busy' evaluates to true even if isStreaming is false
  assert.equal(
    computeIsBusy(false, false, 'busy'),
    true,
    'isBusy must be true when slot status is busy, even if isStreaming is false'
  );

  // 2. isStreaming true evaluates to true even if slot status is not busy
  assert.equal(
    computeIsBusy(false, true, 'ready'),
    true,
    'isBusy must be true when isStreaming is true, even if slot status is ready'
  );

  // 3. Both isStreaming and status 'busy' evaluates to true
  assert.equal(
    computeIsBusy(false, true, 'busy'),
    true,
    'isBusy must be true when both isStreaming and slot status are busy'
  );

  // 4. Idle / ready slot with isStreaming false evaluates to false
  assert.equal(
    computeIsBusy(false, false, 'ready'),
    false,
    'isBusy must be false when neither streaming nor slot status is busy'
  );
  assert.equal(
    computeIsBusy(false, false, 'idle'),
    false,
    'isBusy must be false when slot status is idle and streaming is false'
  );
  assert.equal(
    computeIsBusy(false, false, null),
    false,
    'isBusy must be false when slot is null and streaming is false'
  );

  // 5. Watchdog aborted overrides and forces isBusy to false
  assert.equal(
    computeIsBusy(true, true, 'busy'),
    false,
    'isBusy must be false when watchdog aborted is true, regardless of status'
  );
  assert.equal(
    computeIsBusy(true, false, 'busy'),
    false,
    'isBusy must be false when watchdog aborted is true and slot is busy'
  );
});

// =============================================================================
// Suite 2: AgentChat.svelte Template & Interaction Contracts
// =============================================================================

test('b33 Live Status & Stop 2: AgentChat.svelte derived isBusy expression', () => {
  const chatSrc = fs.readFileSync(path.resolve(uiRoot, 'features/agents/AgentChat.svelte'), 'utf-8');

  // Verify exact derived isBusy expression
  assert.ok(
    chatSrc.includes('let isBusy = $derived('),
    'AgentChat must declare derived isBusy'
  );
  assert.ok(
    chatSrc.includes('!agentsStore.isWatchdogAborted && (agentsStore.isStreaming || activeSlot?.status === \'busy\')'),
    'AgentChat must derive isBusy from watchdog aborted, isStreaming, and activeSlot status busy'
  );
});

test('b33 Live Status & Stop 3: AgentChat.svelte Live Bubble & Tool Calls during isBusy', () => {
  const chatSrc = fs.readFileSync(path.resolve(uiRoot, 'features/agents/AgentChat.svelte'), 'utf-8');

  // 1. Live bubble rendered on isBusy (not only isStreaming)
  assert.ok(
    chatSrc.includes('{#if isBusy}'),
    'AgentChat must render live bubble conditional on isBusy'
  );
  assert.ok(
    chatSrc.includes('class="message-row agent-row live-generating"'),
    'AgentChat must apply live-generating class to live message row'
  );

  // 2. Investigating indicator when streamingContent is empty
  assert.ok(
    chatSrc.includes('Sedang menginvestigasi kode proyek...'),
    'AgentChat must display "Sedang menginvestigasi kode proyek..." while waiting for tokens'
  );
  assert.ok(
    chatSrc.includes('investigating-indicator'),
    'AgentChat must render investigating-indicator element'
  );
  assert.ok(
    chatSrc.includes('investigating-spinner'),
    'AgentChat must render investigating-spinner'
  );

  // 3. Blinking cursor during live state
  assert.ok(
    chatSrc.includes('cursor-blink'),
    'AgentChat must include cursor-blink element'
  );
  assert.ok(
    chatSrc.includes('▌'),
    'AgentChat must render blinking cursor character ▌'
  );

  // 4. Live tool call arguments visibility
  assert.ok(
    chatSrc.includes('⚡ {tool.name}'),
    'AgentChat must render tool name with lightning bolt icon'
  );
  assert.ok(
    chatSrc.includes('tool.arguments?.path'),
    'AgentChat must check and render tool arguments path'
  );
});

test('b33 Live Status & Stop 4: AgentChat.svelte Persistent Stop Button in .pills-right', () => {
  const chatSrc = fs.readFileSync(path.resolve(uiRoot, 'features/agents/AgentChat.svelte'), 'utf-8');

  // 1. pills-right container conditional on isBusy
  assert.ok(
    chatSrc.includes('<div class="pills-right">'),
    'AgentChat must contain pills-right container'
  );
  assert.ok(
    chatSrc.includes('cancel-prompt-btn'),
    'AgentChat must render cancel-prompt-btn when isBusy'
  );
  assert.ok(
    chatSrc.includes('⏹ Stop'),
    'AgentChat cancel-prompt-btn must display "⏹ Stop" label'
  );
  assert.ok(
    chatSrc.includes('title="Batalkan prompt aktif"'),
    'AgentChat cancel-prompt-btn must have tooltip "Batalkan prompt aktif"'
  );
  assert.ok(
    chatSrc.includes('agentsStore.cancelActivePrompt()'),
    'AgentChat cancel button must invoke agentsStore.cancelActivePrompt()'
  );
  assert.ok(
    chatSrc.includes('send-prompt-btn'),
    'AgentChat must render send-prompt-btn when not busy'
  );
  assert.ok(
    chatSrc.includes('➤'),
    'AgentChat send button must display ➤ symbol'
  );
});

// =============================================================================
// Suite 3: agents.svelte.ts Event Handling & Safe New Chat Contracts
// =============================================================================

test('b33 Live Status & Stop 5: agents.svelte.ts StatusChanged handling and awaitingPrompt protection', () => {
  const storeSrc = fs.readFileSync(path.resolve(uiRoot, 'features/agents/agents.svelte.ts'), 'utf-8');

  // 1. isAwaitingPrompt state declaration
  assert.ok(
    storeSrc.includes('isAwaitingPrompt = $state(false);'),
    'agentsStore must declare isAwaitingPrompt state'
  );

  // 2. handleSlotEvent activates streaming on busy
  assert.ok(
    storeSrc.includes('if (status === \'busy\')'),
    'handleSlotEvent must handle status === "busy"'
  );
  assert.ok(
    storeSrc.includes('if (slot_id === this.activeSlotId) {\n          this.isStreaming = true;\n        }') ||
    storeSrc.includes('slot_id === this.activeSlotId') && storeSrc.includes('this.isStreaming = true'),
    'handleSlotEvent must activate isStreaming = true when active slot turns busy'
  );

  // 3. handleSlotEvent does NOT set isStreaming = false if isAwaitingPrompt is true
  assert.ok(
    storeSrc.includes('!this.isAwaitingPrompt'),
    'handleSlotEvent must guard isStreaming = false on ready with !this.isAwaitingPrompt'
  );

  // 4. sendPrompt and cancelActivePrompt manage isAwaitingPrompt lifecycle
  assert.ok(
    storeSrc.includes('this.isAwaitingPrompt = true;'),
    'sendPrompt must set isAwaitingPrompt = true before dispatch'
  );
  assert.ok(
    storeSrc.includes('this.isAwaitingPrompt = false;'),
    'sendPrompt finally and cancelActivePrompt must reset isAwaitingPrompt = false'
  );
});

test('b33 Live Status & Stop 6: agents.svelte.ts newSession cancels active prompt cleanly', () => {
  const storeSrc = fs.readFileSync(path.resolve(uiRoot, 'features/agents/agents.svelte.ts'), 'utf-8');

  // 1. async newSession definition
  assert.ok(
    storeSrc.includes('async newSession(slotId?: string)'),
    'newSession must be an async function'
  );

  // 2. Checks if slot is busy or streaming before new session
  assert.ok(
    storeSrc.includes('currentSlot?.status === \'busy\'') || storeSrc.includes('slot?.status === \'busy\''),
    'newSession must check if slot status is busy'
  );
  assert.ok(
    storeSrc.includes('this.isStreaming'),
    'newSession must check if isStreaming is true'
  );

  // 3. Invokes cancelActivePrompt
  assert.ok(
    storeSrc.includes('await this.cancelActivePrompt()'),
    'newSession must await cancelActivePrompt() when busy or streaming'
  );
});

// =============================================================================
// Suite 4: Simulated Lifecycle & State Machine Verification
// =============================================================================

test('b33 Live Status & Stop 7: Simulated handleSlotEvent state machine transitions', () => {
  const mockStore = {
    activeSlotId: 'slot-alpha',
    slots: [
      { id: 'slot-alpha', status: 'ready' },
      { id: 'slot-beta', status: 'ready' },
    ],
    isStreaming: false,
    isAwaitingPrompt: false,
    handleSlotEvent(event) {
      if (!event) return;
      if (event.StatusChanged) {
        const { slot_id, status } = event.StatusChanged;
        const idx = this.slots.findIndex((s) => s.id === slot_id);
        if (idx !== -1) {
          this.slots[idx] = { ...this.slots[idx], status };
        }
        if (status === 'busy') {
          if (slot_id === this.activeSlotId) {
            this.isStreaming = true;
          }
        } else if (status === 'ready') {
          if (!this.isAwaitingPrompt) {
            this.isStreaming = false;
          }
        } else if (status === 'crashed' || status === 'error') {
          this.isStreaming = false;
        }
      }
    },
  };

  // 1. StatusChanged to 'busy' for active slot activates isStreaming
  mockStore.handleSlotEvent({ StatusChanged: { slot_id: 'slot-alpha', status: 'busy' } });
  assert.equal(mockStore.slots[0].status, 'busy');
  assert.equal(mockStore.isStreaming, true, 'isStreaming must become true when active slot turns busy');

  // 2. StatusChanged to 'busy' for non-active slot updates slot but not isStreaming
  mockStore.isStreaming = false;
  mockStore.handleSlotEvent({ StatusChanged: { slot_id: 'slot-beta', status: 'busy' } });
  assert.equal(mockStore.slots[1].status, 'busy');
  assert.equal(mockStore.isStreaming, false, 'isStreaming must not turn true when inactive slot turns busy');

  // 3. StatusChanged to 'ready' while awaitingPrompt is true retains isStreaming = true
  mockStore.isStreaming = true;
  mockStore.isAwaitingPrompt = true;
  mockStore.handleSlotEvent({ StatusChanged: { slot_id: 'slot-alpha', status: 'ready' } });
  assert.equal(mockStore.isStreaming, true, 'isStreaming must NOT be set to false while prompt is still awaiting');

  // 4. StatusChanged to 'ready' when awaitingPrompt is false resets isStreaming
  mockStore.isAwaitingPrompt = false;
  mockStore.handleSlotEvent({ StatusChanged: { slot_id: 'slot-alpha', status: 'ready' } });
  assert.equal(mockStore.isStreaming, false, 'isStreaming must be set to false when awaitingPrompt is finished');
});

test('b33 Live Status & Stop 8: Simulated newSession cancellation lifecycle', async () => {
  let cancelCalled = false;
  const mockStore = {
    activeSlotId: 'slot-gamma',
    slots: [{ id: 'slot-gamma', status: 'busy' }],
    isStreaming: true,
    async cancelActivePrompt() {
      cancelCalled = true;
      this.isStreaming = false;
      this.slots[0].status = 'ready';
    },
    async newSession(slotId) {
      const targetSlotId = slotId || this.activeSlotId;
      const currentSlot = this.slots.find((s) => s.id === targetSlotId);
      if (this.isStreaming || currentSlot?.status === 'busy') {
        await this.cancelActivePrompt();
      }
      this.isStreaming = false;
    },
  };

  await mockStore.newSession();
  assert.equal(cancelCalled, true, 'newSession must call cancelActivePrompt when slot is busy or streaming');
  assert.equal(mockStore.slots[0].status, 'ready', 'Slot must be reset to ready');
  assert.equal(mockStore.isStreaming, false, 'Streaming must be terminated');

  // Second run when idle does not call cancelActivePrompt again
  cancelCalled = false;
  await mockStore.newSession();
  assert.equal(cancelCalled, false, 'newSession on idle slot should not invoke cancelActivePrompt');
});
