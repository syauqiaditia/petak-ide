import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseFramePacket,
  translateCanvasToDevice,
  calculateViewportFit,
  clampPanelWidth,
  calcFps,
  calcLatency,
  mirrorStateMachine,
  shouldReleaseMirrorFocus,
  isOutsidePhoneBezel,
} from '../ui/features/mirror/logic.ts';

test('parseFramePacket: parses valid binary packet with kind, pts_us, and payload', () => {
  // [u8 kind: 0=config, 1=key, 2=delta][u64 pts_us][payload Annex-B bytes]
  const kind = 1;
  const ptsUs = 1234567890123n;
  const payloadBytes = new Uint8Array([0x00, 0x00, 0x00, 0x01, 0x65, 0x88, 0x84]);
  
  const buffer = new ArrayBuffer(1 + 8 + payloadBytes.length);
  const view = new DataView(buffer);
  view.setUint8(0, kind);
  view.setBigUint64(1, ptsUs, false); // big-endian
  new Uint8Array(buffer, 9).set(payloadBytes);

  const parsed = parseFramePacket(buffer);
  assert.equal(parsed.kind, 1);
  assert.equal(parsed.ptsUs, ptsUs);
  assert.equal(parsed.payload.length, payloadBytes.length);
  assert.deepEqual(Array.from(parsed.payload), Array.from(payloadBytes));
});

test('parseFramePacket: throws on packet with less than 9 bytes', () => {
  const shortBuffer = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]);
  assert.throws(() => parseFramePacket(shortBuffer), /Packet too short/);
});

test('translateCanvasToDevice: scales and clamps coordinates within device resolution', () => {
  const rect = { left: 100, top: 50, width: 300, height: 600 };
  const deviceWidth = 1080;
  const deviceHeight = 2400;

  // Center point
  const center = translateCanvasToDevice(250, 350, rect, deviceWidth, deviceHeight);
  assert.equal(center.w, 1080);
  assert.equal(center.h, 2400);
  assert.equal(center.x, 540);
  assert.equal(center.y, 1200);

  // Out of bounds (negative / top-left overshoot) -> clamps to 0
  const under = translateCanvasToDevice(50, 20, rect, deviceWidth, deviceHeight);
  assert.equal(under.x, 0);
  assert.equal(under.y, 0);

  // Out of bounds (bottom-right overshoot) -> clamps to max - 1
  const over = translateCanvasToDevice(500, 800, rect, deviceWidth, deviceHeight);
  assert.equal(over.x, 1079);
  assert.equal(over.y, 2399);
});

test('calculateViewportFit: preserves aspect ratio and calculates bezel dimensions', () => {
  const stageWidth = 380;
  const stageHeight = 746;
  const deviceWidth = 1080;
  const deviceHeight = 2400; // 9:20 aspect ratio (0.45)

  const fit = calculateViewportFit(stageWidth, stageHeight, deviceWidth, deviceHeight);
  assert.ok(fit.screenWidth > 0);
  assert.ok(fit.screenHeight > 0);
  assert.ok(fit.bezelWidth <= stageWidth);
  assert.ok(fit.bezelHeight <= stageHeight);

  // Aspect ratio of screen matches device aspect ratio closely
  const expectedRatio = deviceWidth / deviceHeight;
  const actualRatio = fit.screenWidth / fit.screenHeight;
  assert.ok(Math.abs(actualRatio - expectedRatio) < 0.02, `Ratio diff too large: ${actualRatio} vs ${expectedRatio}`);
});

test('clampPanelWidth: clamps to specified min and max bounds', () => {
  assert.equal(clampPanelWidth(250), 300);
  assert.equal(clampPanelWidth(380), 380);
  assert.equal(clampPanelWidth(700), 600);
  assert.equal(clampPanelWidth(300), 300);
  assert.equal(clampPanelWidth(600), 600);
});

test('calcFps: counts frames in sliding time window', () => {
  const now = 10000;
  // 30 timestamps in last 1000ms
  const timestamps = Array.from({ length: 30 }, (_, i) => now - 900 + i * 30);
  // plus some older timestamps outside window
  timestamps.unshift(now - 2000, now - 1500, now - 1050);

  const fps = calcFps(timestamps, now, 1000);
  assert.equal(fps, 30);
});

test('calcLatency: calculates delta between pending input and rendered frame', () => {
  const inputTs = 1000;
  const frameTs = 1038;
  assert.equal(calcLatency(inputTs, frameTs), 38);
  assert.equal(calcLatency(null, frameTs), null);
  // Render ts earlier than input ts -> invalid / ignore
  assert.equal(calcLatency(1050, 1030), null);
});

test('mirrorStateMachine: handles 6 lifecycle UI states and transitions', () => {
  let state = 'empty';

  // 1. empty -> connecting
  state = mirrorStateMachine(state, { type: 'START' });
  assert.equal(state, 'connecting');

  // 2. connecting -> live
  state = mirrorStateMachine(state, { type: 'STREAM_LIVE' });
  assert.equal(state, 'live');

  // 3. live -> disconnected
  state = mirrorStateMachine(state, { type: 'DISCONNECTED', payload: { reason: 'USB Detached' } });
  assert.equal(state, 'disconnected');

  // 4. disconnected -> connecting (reconnect)
  state = mirrorStateMachine(state, { type: 'RECONNECT' });
  assert.equal(state, 'connecting');

  // 5. connecting -> error
  state = mirrorStateMachine(state, { type: 'ERROR', payload: { message: 'Handshake failed' } });
  assert.equal(state, 'error');

  // 6. error -> connecting (retry)
  state = mirrorStateMachine(state, { type: 'RETRY' });
  assert.equal(state, 'connecting');

  // 7. connecting -> view-only (iOS physical / sim without touch)
  state = mirrorStateMachine(state, { type: 'STREAM_VIEW_ONLY' });
  assert.equal(state, 'view-only');

  // 8. view-only -> empty (close/stop)
  state = mirrorStateMachine(state, { type: 'STOP' });
  assert.equal(state, 'empty');
});

// =============================================================================
// Suite 2: Mirror Keyboard Focus Stealing & Bezel Interaction Guards (Batch 39)
// =============================================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uiRoot = path.resolve(__dirname, '../ui');

class MockElement {
  constructor(options = {}) {
    this.tagName = options.tagName || 'DIV';
    this.isContentEditable = Boolean(options.isContentEditable);
    this.classes = new Set(options.classes || []);
    this.parent = options.parent || null;
  }

  closest(selector) {
    let curr = this;
    while (curr) {
      if (selector.startsWith('.') && curr.classes.has(selector.slice(1))) {
        return curr;
      }
      if (selector.toUpperCase() === curr.tagName.toUpperCase()) {
        return curr;
      }
      curr = curr.parent;
    }
    return null;
  }
}

test('shouldReleaseMirrorFocus: identifies inputs, editors, and dialogs accurately', () => {
  // Input and textarea
  assert.equal(shouldReleaseMirrorFocus({ tagName: 'INPUT' }), true);
  assert.equal(shouldReleaseMirrorFocus({ tagName: 'TEXTAREA' }), true);
  assert.equal(shouldReleaseMirrorFocus(new MockElement({ tagName: 'INPUT' })), true);
  assert.equal(shouldReleaseMirrorFocus(new MockElement({ tagName: 'TEXTAREA' })), true);

  // ContentEditable
  assert.equal(shouldReleaseMirrorFocus({ isContentEditable: true }), true);
  assert.equal(shouldReleaseMirrorFocus(new MockElement({ isContentEditable: true })), true);

  // CodeMirror editor (.cm-editor)
  const cmEl = new MockElement({ classes: ['cm-content'], parent: new MockElement({ classes: ['cm-editor'] }) });
  assert.equal(shouldReleaseMirrorFocus(cmEl), true);

  // Search palette (.search-palette)
  const searchEl = new MockElement({ classes: ['palette-input'], parent: new MockElement({ classes: ['search-palette'] }) });
  assert.equal(shouldReleaseMirrorFocus(searchEl), true);

  // Modal backdrop (.modal-backdrop)
  const modalEl = new MockElement({ classes: ['modal-window'], parent: new MockElement({ classes: ['modal-backdrop'] }) });
  assert.equal(shouldReleaseMirrorFocus(modalEl), true);

  // Terminal container (.terminal-container)
  const termEl = new MockElement({ classes: ['xterm'], parent: new MockElement({ classes: ['terminal-container'] }) });
  assert.equal(shouldReleaseMirrorFocus(termEl), true);

  // Run output panel (.run-output-panel)
  const runEl = new MockElement({ classes: ['log-line'], parent: new MockElement({ classes: ['run-output-panel'] }) });
  assert.equal(shouldReleaseMirrorFocus(runEl), true);

  // Active element fallback
  assert.equal(shouldReleaseMirrorFocus(null, cmEl), true);
  assert.equal(shouldReleaseMirrorFocus({ tagName: 'DIV' }, { tagName: 'INPUT' }), true);

  // Canvas / device inside phone bezel does not release focus
  const bezel = new MockElement({ classes: ['phone-bezel'] });
  const canvas = new MockElement({ tagName: 'CANVAS', classes: ['device-screen-canvas'], parent: bezel });
  assert.equal(shouldReleaseMirrorFocus(canvas), false);
});

test('isOutsidePhoneBezel: detects whether element is outside or inside bezel', () => {
  const bezel = new MockElement({ classes: ['phone-bezel'] });
  const canvas = new MockElement({ tagName: 'CANVAS', parent: bezel });
  const editor = new MockElement({ classes: ['cm-editor'] });

  assert.equal(isOutsidePhoneBezel(canvas), false);
  assert.equal(isOutsidePhoneBezel(editor), true);
  assert.equal(isOutsidePhoneBezel(null), true);
  assert.equal(isOutsidePhoneBezel(undefined), true);
});

test('mirror focus: keydown inside input or editor does not intercept and sets isFocused to false', () => {
  const mirrorStore = {
    isFocused: true,
    sentInputs: [],
    sendInput(input) {
      this.sentInputs.push(input);
    },
  };

  function simulateHandleKeyDown(e, isViewOnly = false) {
    const target = e.target;
    if (
      target?.tagName === 'INPUT' ||
      target?.tagName === 'TEXTAREA' ||
      target?.isContentEditable ||
      target?.closest?.('.cm-editor') ||
      target?.closest?.('.search-palette') ||
      target?.closest?.('.modal-backdrop') ||
      target?.closest?.('.terminal-container') ||
      target?.closest?.('.run-output-panel')
    ) {
      mirrorStore.isFocused = false;
      return;
    }

    if (!mirrorStore.isFocused || isViewOnly) return;

    if (e.key === 'Escape') {
      mirrorStore.isFocused = false;
      e.preventDefault();
      return;
    }

    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      mirrorStore.sendInput({ t: 'text', text: e.key });
      return;
    }
  }

  // 1. Target inside CodeMirror editor
  const cmEl = new MockElement({ classes: ['cm-line'], parent: new MockElement({ classes: ['cm-editor'] }) });
  let prevented = false;
  let event = {
    key: 'a',
    target: cmEl,
    preventDefault: () => { prevented = true; },
  };

  mirrorStore.isFocused = true;
  simulateHandleKeyDown(event);
  assert.equal(mirrorStore.isFocused, false, 'Focus must be released when keydown is in editor');
  assert.equal(prevented, false, 'Keydown in editor must not be prevented');
  assert.equal(mirrorStore.sentInputs.length, 0, 'No input should be sent to phone for editor keydown');

  // 2. Target inside Search Everywhere input
  const searchInput = new MockElement({ tagName: 'INPUT', parent: new MockElement({ classes: ['search-palette'] }) });
  prevented = false;
  event = {
    key: 'f',
    target: searchInput,
    preventDefault: () => { prevented = true; },
  };

  mirrorStore.isFocused = true;
  simulateHandleKeyDown(event);
  assert.equal(mirrorStore.isFocused, false, 'Focus must be released when keydown is in search palette');
  assert.equal(prevented, false, 'Search input keydown must not be prevented');
  assert.equal(mirrorStore.sentInputs.length, 0, 'No input should be sent to phone for search input');

  // 3. Target with isContentEditable
  const editableEl = new MockElement({ isContentEditable: true });
  prevented = false;
  event = {
    key: 'x',
    target: editableEl,
    preventDefault: () => { prevented = true; },
  };

  mirrorStore.isFocused = true;
  simulateHandleKeyDown(event);
  assert.equal(mirrorStore.isFocused, false, 'Focus must be released when target isContentEditable');
  assert.equal(prevented, false, 'contentEditable keydown must not be prevented');
  assert.equal(mirrorStore.sentInputs.length, 0);
});

test('mirror focus: mousedown outside bezel resets isFocused to false, while canvas click preserves focus', () => {
  const mirrorStore = {
    isFocused: true,
  };

  function simulateHandleGlobalMouseDown(e) {
    const target = e.target;
    if (!target?.closest?.('.phone-bezel')) {
      mirrorStore.isFocused = false;
    }
  }

  const bezel = new MockElement({ classes: ['phone-bezel'] });
  const canvasEl = new MockElement({ tagName: 'CANVAS', classes: ['device-screen-canvas'], parent: bezel });
  const editorEl = new MockElement({ classes: ['cm-editor'] });
  const sidebarEl = new MockElement({ classes: ['file-tree'] });

  // 1. Click outside bezel (editor)
  mirrorStore.isFocused = true;
  simulateHandleGlobalMouseDown({ target: editorEl });
  assert.equal(mirrorStore.isFocused, false, 'Clicking editor must set isFocused to false');

  // 2. Click outside bezel (sidebar)
  mirrorStore.isFocused = true;
  simulateHandleGlobalMouseDown({ target: sidebarEl });
  assert.equal(mirrorStore.isFocused, false, 'Clicking sidebar must set isFocused to false');

  // 3. Click on canvas inside bezel
  mirrorStore.isFocused = true;
  simulateHandleGlobalMouseDown({ target: canvasEl });
  assert.equal(mirrorStore.isFocused, true, 'Clicking canvas inside bezel must keep isFocused true');
});

test('mirror focus: focused canvas forwards keystrokes to device', () => {
  const mirrorStore = {
    isFocused: true,
    sentInputs: [],
    sendInput(input) {
      this.sentInputs.push(input);
    },
  };

  function simulateHandleKeyDown(e, isViewOnly = false) {
    const target = e.target;
    if (
      target?.tagName === 'INPUT' ||
      target?.tagName === 'TEXTAREA' ||
      target?.isContentEditable ||
      target?.closest?.('.cm-editor') ||
      target?.closest?.('.search-palette') ||
      target?.closest?.('.modal-backdrop') ||
      target?.closest?.('.terminal-container') ||
      target?.closest?.('.run-output-panel')
    ) {
      mirrorStore.isFocused = false;
      return;
    }

    if (!mirrorStore.isFocused || isViewOnly) return;

    if (e.key === 'Escape') {
      mirrorStore.isFocused = false;
      e.preventDefault();
      return;
    }

    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      mirrorStore.sendInput({ t: 'text', text: e.key });
      return;
    }

    const specialKeycodes = {
      Backspace: 67,
      Enter: 66,
      Tab: 61,
      ArrowLeft: 21,
      ArrowRight: 22,
      ArrowUp: 19,
      ArrowDown: 20,
    };

    if (specialKeycodes[e.key]) {
      e.preventDefault();
      mirrorStore.sendInput({ t: 'key', keycode: specialKeycodes[e.key], action: 'down' });
    }
  }

  const bezel = new MockElement({ classes: ['phone-bezel'] });
  const canvasEl = new MockElement({ tagName: 'CANVAS', parent: bezel });

  // 1. Printable character 'k'
  let prevented = false;
  simulateHandleKeyDown({
    key: 'k',
    target: canvasEl,
    preventDefault: () => { prevented = true; },
  });
  assert.equal(prevented, true, 'Keystroke on canvas must be preventDefaulted');
  assert.deepEqual(mirrorStore.sentInputs[0], { t: 'text', text: 'k' });

  // 2. Control key 'Enter'
  prevented = false;
  simulateHandleKeyDown({
    key: 'Enter',
    target: canvasEl,
    preventDefault: () => { prevented = true; },
  });
  assert.equal(prevented, true, 'Enter on canvas must be preventDefaulted');
  assert.deepEqual(mirrorStore.sentInputs[1], { t: 'key', keycode: 66, action: 'down' });

  // 3. Escape key releases focus
  prevented = false;
  simulateHandleKeyDown({
    key: 'Escape',
    target: canvasEl,
    preventDefault: () => { prevented = true; },
  });
  assert.equal(prevented, true);
  assert.equal(mirrorStore.isFocused, false, 'Escape on canvas must release focus');
});

test('DeviceCanvas.svelte: contains required focus release guards and capture mousedown listener', () => {
  const canvasSrc = fs.readFileSync(path.resolve(uiRoot, 'features/mirror/DeviceCanvas.svelte'), 'utf-8');

  // Verify handleGlobalMouseDown is defined and checks .phone-bezel
  assert.ok(canvasSrc.includes('function handleGlobalMouseDown'), 'DeviceCanvas must define handleGlobalMouseDown');
  assert.ok(canvasSrc.includes("!target?.closest('.phone-bezel')"), 'handleGlobalMouseDown must check !target?.closest(.phone-bezel)');
  assert.ok(canvasSrc.includes('mirrorStore.isFocused = false;'), 'handleGlobalMouseDown must set mirrorStore.isFocused = false');

  // Verify window event listeners in onMount and onDestroy with useCapture = true
  assert.ok(
    canvasSrc.includes("window.addEventListener('mousedown', handleGlobalMouseDown, true)"),
    'onMount must register capture mousedown listener'
  );
  assert.ok(
    canvasSrc.includes("window.removeEventListener('mousedown', handleGlobalMouseDown, true)"),
    'onDestroy must remove capture mousedown listener'
  );

  // Verify handleKeyDown checks inputs and editors
  assert.ok(canvasSrc.includes('target instanceof HTMLInputElement'), 'handleKeyDown must check HTMLInputElement');
  assert.ok(canvasSrc.includes('target instanceof HTMLTextAreaElement'), 'handleKeyDown must check HTMLTextAreaElement');
  assert.ok(canvasSrc.includes('target?.isContentEditable'), 'handleKeyDown must check isContentEditable');
  assert.ok(canvasSrc.includes("target?.closest('.cm-editor')"), 'handleKeyDown must check .cm-editor');
  assert.ok(canvasSrc.includes("target?.closest('.search-palette')"), 'handleKeyDown must check .search-palette');
  assert.ok(canvasSrc.includes("target?.closest('.modal-backdrop')"), 'handleKeyDown must check .modal-backdrop');
  assert.ok(canvasSrc.includes("target?.closest('.terminal-container')"), 'handleKeyDown must check .terminal-container');
  assert.ok(canvasSrc.includes("target?.closest('.run-output-panel')"), 'handleKeyDown must check .run-output-panel');
});
