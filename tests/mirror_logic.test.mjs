import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseFramePacket,
  translateCanvasToDevice,
  calculateViewportFit,
  clampPanelWidth,
  calcFps,
  calcLatency,
  mirrorStateMachine,
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
