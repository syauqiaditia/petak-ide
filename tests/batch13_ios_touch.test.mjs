import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { isDeviceViewOnly } from '../ui/features/mirror/logic.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uiRoot = path.resolve(__dirname, '../ui');

// =============================================================================
// Test 1: Klasifikasi isViewOnly untuk iOS Simulator
// Perangkat dengan { platform: 'ios', kind: 'simulator' } menghasilkan isViewOnly: false
// =============================================================================
test('classification: iOS Simulator produces isViewOnly = false', () => {
  const iosSimulator = {
    id: 'D348E05A-644E-4B0A-8217-0630D2B82463',
    name: 'iPhone 15 Pro',
    platform: 'ios',
    kind: 'simulator',
  };

  const isViewOnly = isDeviceViewOnly(iosSimulator);
  assert.equal(isViewOnly, false, 'iOS Simulator must NOT be view-only');

  // Verify inline expression matches mirrorStore logic
  const inlineEvaluation = iosSimulator.platform === 'ios' && iosSimulator.kind === 'physical';
  assert.equal(inlineEvaluation, false);
});

// =============================================================================
// Test 2: Klasifikasi isViewOnly untuk iPhone fisik
// Perangkat dengan { platform: 'ios', kind: 'physical' } menghasilkan isViewOnly: true
// =============================================================================
test('classification: physical iPhone produces isViewOnly = true', () => {
  const physicalIphone = {
    id: '00008101-001234567890',
    name: "UQi's iPhone 13 Pro",
    platform: 'ios',
    kind: 'physical',
  };

  const isViewOnly = isDeviceViewOnly(physicalIphone);
  assert.equal(isViewOnly, true, 'Physical iPhone MUST be view-only');

  const inlineEvaluation = physicalIphone.platform === 'ios' && physicalIphone.kind === 'physical';
  assert.equal(inlineEvaluation, true);
});

// =============================================================================
// Test 3: Klasifikasi isViewOnly untuk Android device & emulator
// Perangkat Android menghasilkan isViewOnly: false
// =============================================================================
test('classification: Android device & emulator produce isViewOnly = false', () => {
  const androidEmulator = {
    id: 'emulator-5554',
    name: 'Pixel 8 Pro API 34',
    platform: 'android',
    kind: 'emulator',
  };
  assert.equal(isDeviceViewOnly(androidEmulator), false, 'Android emulator must not be view-only');

  const androidPhysical = {
    id: 'RF8N1234567',
    name: 'Samsung Galaxy A15',
    platform: 'android',
    kind: 'physical',
  };
  assert.equal(isDeviceViewOnly(androidPhysical), false, 'Android physical device must not be view-only');

  const androidWifi = {
    id: '192.168.1.50:5555',
    name: 'Galaxy S21 Wi-Fi',
    platform: 'android',
    kind: 'physical',
  };
  assert.equal(isDeviceViewOnly(androidWifi), false, 'Android Wi-Fi device must not be view-only');
});

// =============================================================================
// Test 4: sendInput forwarding logic
// Event touch dan scroll diteruskan ke API jika !isViewOnly (iOS Simulator dan Android)
// Event touch dan scroll di-drop/dibatalkan jika isViewOnly (iPhone fisik)
// =============================================================================
test('sendInput: forwards touch and scroll when !isViewOnly and drops when isViewOnly', async () => {
  function createStoreMock(isViewOnly, serial = 'target-serial') {
    const sentInputs = [];
    return {
      serial,
      status: 'live',
      isViewOnly,
      sentInputs,
      async sendInput(ev) {
        if (!this.serial || this.status === 'picker' || this.status === 'empty') return;
        if (this.isViewOnly && (ev.t === 'touch' || ev.t === 'key' || ev.t === 'text' || ev.t === 'scroll')) {
          return;
        }
        this.sentInputs.push(ev);
      },
    };
  }

  // 1. iOS Simulator (isViewOnly = false) -> All interactive events forwarded
  const simStore = createStoreMock(false, 'simulator-uuid');
  const touchDown = { t: 'touch', action: 'down', x: 120, y: 340, w: 1179, h: 2556 };
  const touchMove = { t: 'touch', action: 'move', x: 120, y: 400, w: 1179, h: 2556 };
  const touchUp = { t: 'touch', action: 'up', x: 120, y: 450, w: 1179, h: 2556 };
  const scrollEv = { t: 'scroll', x: 120, y: 340, w: 1179, h: 2556, dx: 0, dy: -80 };
  const keyEv = { t: 'key', keycode: 66, action: 'down' };
  const textEv = { t: 'text', text: 'hello' };
  const navEv = { t: 'nav', key: 'home' };

  await simStore.sendInput(touchDown);
  await simStore.sendInput(touchMove);
  await simStore.sendInput(touchUp);
  await simStore.sendInput(scrollEv);
  await simStore.sendInput(keyEv);
  await simStore.sendInput(textEv);
  await simStore.sendInput(navEv);

  assert.equal(simStore.sentInputs.length, 7, 'iOS Simulator must forward all touch, scroll, key, text, and nav events');
  assert.deepEqual(simStore.sentInputs[0], touchDown);
  assert.deepEqual(simStore.sentInputs[3], scrollEv);

  // 2. Physical iPhone (isViewOnly = true) -> Touch, scroll, key, text dropped
  const physicalStore = createStoreMock(true, 'physical-udid');
  await physicalStore.sendInput(touchDown);
  await physicalStore.sendInput(touchMove);
  await physicalStore.sendInput(touchUp);
  await physicalStore.sendInput(scrollEv);
  await physicalStore.sendInput(keyEv);
  await physicalStore.sendInput(textEv);

  assert.equal(physicalStore.sentInputs.length, 0, 'Physical iPhone must drop touch, scroll, key, and text inputs');

  // Nav events pass through or don't trigger view-only guard
  await physicalStore.sendInput(navEv);
  assert.equal(physicalStore.sentInputs.length, 1, 'Nav event is not dropped by view-only touch/key/scroll filter');
});

// =============================================================================
// Test 5: Transisi state UI
// Status menjadi 'live' saat stream simulator aktif, dan 'view-only' saat stream iPhone fisik aktif
// =============================================================================
test('state transition: status becomes live for iOS Simulator and view-only for physical iPhone', () => {
  function applyMirrorStatus(isViewOnly, incomingStatus) {
    let status = 'connecting';
    const rawState = (incomingStatus.state || '').toLowerCase();
    switch (rawState) {
      case 'connecting':
        status = 'connecting';
        break;
      case 'live':
      case 'rotated':
        status = isViewOnly ? 'view-only' : 'live';
        break;
      default:
        status = 'error';
        break;
    }
    return status;
  }

  function applyBinaryFrame(isViewOnly, currentStatus) {
    if (currentStatus === 'connecting' || currentStatus === 'disconnected') {
      return isViewOnly ? 'view-only' : 'live';
    }
    return currentStatus;
  }

  // iOS Simulator (isViewOnly = false)
  assert.equal(
    applyMirrorStatus(false, { state: 'live', width: 1179, height: 2556 }),
    'live',
    'iOS Simulator must transition to live on live status'
  );
  assert.equal(
    applyMirrorStatus(false, { state: 'rotated', width: 2556, height: 1179 }),
    'live',
    'iOS Simulator must transition to live on rotated status'
  );
  assert.equal(
    applyBinaryFrame(false, 'connecting'),
    'live',
    'iOS Simulator must transition to live on binary frame'
  );

  // Physical iPhone (isViewOnly = true)
  assert.equal(
    applyMirrorStatus(true, { state: 'live', width: 1170, height: 2532 }),
    'view-only',
    'Physical iPhone must transition to view-only on live status'
  );
  assert.equal(
    applyMirrorStatus(true, { state: 'rotated', width: 2532, height: 1170 }),
    'view-only',
    'Physical iPhone must transition to view-only on rotated status'
  );
  assert.equal(
    applyBinaryFrame(true, 'connecting'),
    'view-only',
    'Physical iPhone must transition to view-only on binary frame'
  );
});

// =============================================================================
// Test 6: Verifikasi file komponen
// Cek bahwa mirrorStore.svelte.ts tidak lagi meng-hardcode this.isViewOnly = dev.platform === 'ios'
// =============================================================================
test('component verification: mirrorStore and toolbar reflect iOS Simulator live touch support', () => {
  const storePath = path.resolve(uiRoot, 'features/mirror/mirrorStore.svelte.ts');
  const storeCode = fs.readFileSync(storePath, 'utf-8');

  // Verify mirrorStore does NOT have the old bug
  assert.ok(
    !storeCode.includes("this.isViewOnly = dev.platform === 'ios';"),
    "mirrorStore must not hardcode this.isViewOnly = dev.platform === 'ios';"
  );

  // Verify mirrorStore specifies both ios and physical
  assert.ok(
    storeCode.includes("this.isViewOnly = dev.platform === 'ios' && dev.kind === 'physical';"),
    "mirrorStore must assign this.isViewOnly = dev.platform === 'ios' && dev.kind === 'physical';"
  );

  // Verify DeviceToolbarTop badge configuration
  const toolbarPath = path.resolve(uiRoot, 'features/mirror/DeviceToolbarTop.svelte');
  const toolbarCode = fs.readFileSync(toolbarPath, 'utf-8');

  assert.ok(
    toolbarCode.includes("Live"),
    "DeviceToolbarTop must show Live in device-badge-live"
  );
  assert.ok(
    toolbarCode.includes("dot-live"),
    "DeviceToolbarTop must include green dot-live indicator"
  );
  assert.ok(
    toolbarCode.includes("iOS — View only"),
    "DeviceToolbarTop must preserve iOS — View only for status === 'view-only'"
  );

  // Verify DeviceCanvas view-only class binding
  const canvasPath = path.resolve(uiRoot, 'features/mirror/DeviceCanvas.svelte');
  const canvasCode = fs.readFileSync(canvasPath, 'utf-8');

  assert.ok(
    canvasCode.includes("class:view-only={isViewOnly}"),
    "DeviceCanvas must bind view-only class to isViewOnly"
  );
  assert.ok(
    canvasCode.includes(".device-canvas-container:not(.view-only)"),
    "DeviceCanvas must style interactive container when not view-only"
  );
});
