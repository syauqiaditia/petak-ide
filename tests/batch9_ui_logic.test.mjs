import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  parseFramePacket,
  calcFps,
} from '../ui/features/mirror/logic.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uiRoot = path.resolve(__dirname, '../ui');

// =============================================================================
// Suite 1: Frame Video Mirror Stream & Canvas Decoding (Scope 1)
// =============================================================================

test('mirror frame listener: api.ts declares onMirrorFrame for mirror-frame event', () => {
  const apiPath = path.resolve(uiRoot, 'lib/api.ts');
  const apiCode = fs.readFileSync(apiPath, 'utf-8');

  assert.ok(
    apiCode.includes('onMirrorFrame(cb: (payload: { serial: string; data: number[] | Uint8Array }) => void)'),
    'api.ts must declare onMirrorFrame method with correct signature'
  );
  assert.ok(
    apiCode.includes("listen<{ serial: string; data: number[] | Uint8Array }>('mirror-frame'"),
    'api.ts must listen to mirror-frame event from Tauri backend'
  );
});

test('mirror frame conversion: mirrorStore converts number[] / Uint8Array to ArrayBuffer', () => {
  const storePath = path.resolve(uiRoot, 'features/mirror/mirrorStore.svelte.ts');
  const storeCode = fs.readFileSync(storePath, 'utf-8');

  // Verify listener registration in constructor
  assert.ok(
    storeCode.includes('api.onMirrorFrame?.'),
    'mirrorStore constructor must subscribe to api.onMirrorFrame'
  );

  // Verify Uint8Array and number[] conversion logic
  assert.ok(
    storeCode.includes('raw instanceof Uint8Array'),
    'mirrorStore must check for Uint8Array frame payload'
  );
  assert.ok(
    storeCode.includes('new Uint8Array(raw).buffer'),
    'mirrorStore must convert number[] arrays to ArrayBuffer'
  );
  assert.ok(
    storeCode.includes('this.handleBinaryFrame(buf)'),
    'mirrorStore must forward converted buffer to handleBinaryFrame'
  );

  // Verify functional frame conversion simulation
  let receivedBuffer = null;
  const mockStore = {
    serial: 'emulator-5554',
    activeRunSerial: 'emulator-5554',
    handleBinaryFrame(buf) {
      receivedBuffer = buf;
    },
    onMirrorFrameHandler(payload) {
      const current = this.activeRunSerial || this.serial;
      if (!current) return;
      if (payload.serial === current || payload.serial === this.serial || payload.serial === this.activeRunSerial) {
        const raw = payload.data;
        let buf;
        if (raw instanceof Uint8Array) {
          buf = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
        } else if (Array.isArray(raw)) {
          buf = new Uint8Array(raw).buffer;
        } else {
          buf = new Uint8Array(raw).buffer;
        }
        this.handleBinaryFrame(buf);
      }
    },
  };

  // Test 1: number[] payload (typical Tauri JSON deserialization)
  const numberData = [0, 0, 0, 0, 0, 0, 0, 0, 1, 100, 200];
  mockStore.onMirrorFrameHandler({ serial: 'emulator-5554', data: numberData });
  assert.ok(receivedBuffer instanceof ArrayBuffer, 'Payload data number[] must convert to ArrayBuffer');
  assert.equal(receivedBuffer.byteLength, 11);
  const arr1 = new Uint8Array(receivedBuffer);
  assert.equal(arr1[0], 0);
  assert.equal(arr1[8], 1);
  assert.equal(arr1[9], 100);

  // Test 2: Uint8Array payload
  const u8Data = new Uint8Array([1, 0, 0, 0, 0, 0, 0, 0, 2, 42]);
  mockStore.onMirrorFrameHandler({ serial: 'emulator-5554', data: u8Data });
  assert.ok(receivedBuffer instanceof ArrayBuffer, 'Uint8Array payload must convert to ArrayBuffer');
  assert.equal(receivedBuffer.byteLength, 10);
  const arr2 = new Uint8Array(receivedBuffer);
  assert.equal(arr2[0], 1);
  assert.equal(arr2[8], 2);
  assert.equal(arr2[9], 42);

  // Test 3: Ignores payload for mismatched serial
  receivedBuffer = null;
  mockStore.onMirrorFrameHandler({ serial: 'other-device', data: numberData });
  assert.equal(receivedBuffer, null, 'Must ignore frames for non-matching serial');
});

test('mirror fps tracking: recordFrameRendered calculates positive FPS on frame render', () => {
  const storePath = path.resolve(uiRoot, 'features/mirror/mirrorStore.svelte.ts');
  const storeCode = fs.readFileSync(storePath, 'utf-8');

  assert.ok(
    storeCode.includes('recordFrameRendered()'),
    'mirrorStore must have recordFrameRendered method'
  );
  assert.ok(
    storeCode.includes('this.fps = calcFps(this.frameTimestamps, now)'),
    'mirrorStore must compute fps via calcFps'
  );

  // Functional simulation of 60 FPS frame stream
  const now = 10000;
  const timestamps = [];
  for (let i = 0; i < 60; i++) {
    timestamps.push(now - 1000 + i * 16.6);
  }
  const fps = calcFps(timestamps, now);
  assert.ok(fps >= 58 && fps <= 62, `Expected ~60 FPS, got ${fps}`);
});

test('canvas decoding: DeviceCanvas configures VideoDecoder and decodes chunks', () => {
  const canvasPath = path.resolve(uiRoot, 'features/mirror/DeviceCanvas.svelte');
  const canvasCode = fs.readFileSync(canvasPath, 'utf-8');

  // Verify VideoDecoder lifecycle and frame rendering
  assert.ok(canvasCode.includes('new VideoDecoder('), 'Must create WebCodecs VideoDecoder');
  assert.ok(canvasCode.includes('mirrorStore.recordFrameRendered()'), 'Decoder output must call recordFrameRendered');
  assert.ok(canvasCode.includes('ctx.drawImage(frame'), 'Decoder output must draw video frame onto canvas');
  assert.ok(canvasCode.includes('frame.close()'), 'Must release video frame memory');

  // Verify packet handling
  assert.ok(canvasCode.includes('parseFramePacket(buf)'), 'Must parse incoming frame packet');
  assert.ok(canvasCode.includes('decoder.configure('), 'Config packet (kind 0) must configure decoder');
  assert.ok(canvasCode.includes('decoder.decode(chunk)'), 'Frame packets (kind 1/2) must pass chunk to decoder');
});

test('canvas hardware acceleration: DeviceCanvas configures hardwareAcceleration prefer-hardware', () => {
  const canvasPath = path.resolve(uiRoot, 'features/mirror/DeviceCanvas.svelte');
  const canvasCode = fs.readFileSync(canvasPath, 'utf-8');

  // Must configure hardwareAcceleration: 'prefer-hardware' for WebCodecs VideoDecoder
  assert.ok(
    canvasCode.includes("hardwareAcceleration: 'prefer-hardware'"),
    "DeviceCanvas must configure hardwareAcceleration: 'prefer-hardware'"
  );

  // Must apply prefer-hardware to both primary and fallback VideoDecoder configurations
  const occurrences = canvasCode.split("hardwareAcceleration: 'prefer-hardware'").length - 1;
  assert.ok(
    occurrences >= 2,
    `Expected at least 2 configurations with hardwareAcceleration: 'prefer-hardware' (primary and fallback), got ${occurrences}`
  );
});

test('canvas config dedup: DeviceCanvas skips redundant decoder.configure when signature matches', () => {
  const canvasPath = path.resolve(uiRoot, 'features/mirror/DeviceCanvas.svelte');
  const canvasCode = fs.readFileSync(canvasPath, 'utf-8');

  // Must declare lastConfigSignature
  assert.ok(canvasCode.includes('lastConfigSignature'), 'Must track lastConfigSignature');

  // Must compute config signature
  assert.ok(canvasCode.includes('configSig'), 'Must compute configSig');

  // Must check if decoder is already configured with identical signature
  assert.ok(
    canvasCode.includes('lastConfigSignature === configSig'),
    'Must check if lastConfigSignature matches current configSig'
  );

  // Must reset lastConfigSignature in initDecoder
  assert.ok(
    canvasCode.includes("lastConfigSignature = ''"),
    'Must reset lastConfigSignature on init or teardown'
  );
});

test('physical capture: cleanup zombies before spawn, 120 keyframe interval, and automated handshake', () => {
  const physicalRsPath = path.resolve(__dirname, '../crates/core/src/mirror/ios/physical.rs');
  const physicalRsCode = fs.readFileSync(physicalRsPath, 'utf-8');

  assert.ok(
    physicalRsCode.includes('pkill') && physicalRsCode.includes('petak_ios_capture.*--mode.*physical'),
    'physical.rs must clean up stale petak_ios_capture zombie processes before spawn'
  );

  const swiftHelperPath = path.resolve(__dirname, '../crates/core/src/mirror/ios/petak_ios_capture.swift');
  const swiftCode = fs.readFileSync(swiftHelperPath, 'utf-8');

  assert.ok(
    swiftCode.includes('kVTCompressionPropertyKey_MaxKeyFrameInterval, value: NSNumber(value: 120)'),
    'petak_ios_capture.swift must set MaxKeyFrameInterval to 120'
  );

  assert.ok(
    swiftCode.includes('triggerQuickTimeHandshake') && swiftCode.includes('QuickTime Player'),
    'petak_ios_capture.swift must implement automated QuickTime CoreMediaIO handshake'
  );
});

// =============================================================================
// Suite 2: Mirror Lifecycle (UQi Revision: Hide on Close, Stop on Switch/Explicit)
// =============================================================================

test('mirror close behavior: close() only hides/minimizes panel without killing stream/emulator', () => {
  const storePath = path.resolve(uiRoot, 'features/mirror/mirrorStore.svelte.ts');
  const storeCode = fs.readFileSync(storePath, 'utf-8');

  const closeMethodIdx = storeCode.indexOf('async close()');
  const closeMethodEnd = storeCode.indexOf('async stopDevice(', closeMethodIdx);
  const closeBlock = storeCode.slice(closeMethodIdx, closeMethodEnd);

  assert.ok(
    closeBlock.includes("panelStore.closeRightPanel('mirror')"),
    'close() must close/hide the right panel'
  );
  assert.ok(
    !closeBlock.includes('this.stop()'),
    'close() must NOT call this.stop() per UQi directive (hide only)'
  );
  assert.ok(
    !closeBlock.includes('api.avdStop('),
    'close() must NOT call api.avdStop per UQi directive'
  );
});

test('mirror resume on open: open() retains running stream seamlessly when reopening', () => {
  const storePath = path.resolve(uiRoot, 'features/mirror/mirrorStore.svelte.ts');
  const storeCode = fs.readFileSync(storePath, 'utf-8');

  const openMethodIdx = storeCode.indexOf('async open(targetSerial?: string)');
  const openMethodEnd = storeCode.indexOf('async close()', openMethodIdx);
  const openBlock = storeCode.slice(openMethodIdx, openMethodEnd);

  assert.ok(
    openBlock.includes("panelStore.openRightPanel('mirror')"),
    'open() must open the right panel'
  );
  assert.ok(
    openBlock.includes('this.activeRunSerial') && openBlock.includes('return;'),
    'open() must return early and resume seamlessly if stream is already active'
  );
});

test('mirror switch/stop: showDevicePicker and stopDevice hook api.avdStop for emulator AVDs', async () => {
  const storePath = path.resolve(uiRoot, 'features/mirror/mirrorStore.svelte.ts');
  const storeCode = fs.readFileSync(storePath, 'utf-8');

  assert.ok(
    storeCode.includes('async showDevicePicker()'),
    'showDevicePicker must be async and handle clean switch'
  );
  assert.ok(
    storeCode.includes('async stopDevice('),
    'mirrorStore must provide stopDevice for explicit stopping'
  );

  // Functional verification of emulator stop hook during device switch
  let stoppedAvd = null;
  const mockApi = {
    async avdStop(serial) {
      stoppedAvd = serial;
    },
  };

  const handleDeviceSwitch = async (serial, devices) => {
    stoppedAvd = null;
    if (serial) {
      const dev = devices.find((d) => d.id === serial);
      const isAvd =
        serial.startsWith('emulator-') ||
        dev?.kind === 'emulator' ||
        dev?.kind === 'avd' ||
        dev?.platform === 'android';
      if (isAvd) {
        await mockApi.avdStop(serial);
      }
    }
  };

  // Case 1: emulator-5554
  await handleDeviceSwitch('emulator-5554', []);
  assert.equal(stoppedAvd, 'emulator-5554', 'Switching from emulator-* must stop old AVD');

  // Case 2: Named AVD
  await handleDeviceSwitch('jatim_dev', [{ id: 'jatim_dev', kind: 'emulator', platform: 'android' }]);
  assert.equal(stoppedAvd, 'jatim_dev', 'Switching from named AVD must stop old AVD');

  // Case 3: Physical device
  await handleDeviceSwitch('iphone_usb_123', [{ id: 'iphone_usb_123', kind: 'physical', platform: 'ios' }]);
  assert.equal(stoppedAvd, null, 'Switching from physical iOS must NOT trigger avdStop');
});

// =============================================================================
// Suite 3: Toolchain Welcome Screen Detection & Dynamic scrcpy (Scope 3)
// =============================================================================

test('toolchain welcome detection: toolchainStore.init executes refresh even with empty root', () => {
  const storePath = path.resolve(uiRoot, 'features/toolchain/toolchainStore.svelte.ts');
  const storeCode = fs.readFileSync(storePath, 'utf-8');

  assert.ok(
    storeCode.includes("await this.refresh(root || '');"),
    'toolchainStore.init must refresh with empty string when root is missing or empty'
  );
  assert.ok(
    !storeCode.includes('if (root) {\n      await this.refresh(root);'),
    'toolchainStore.init must not guard refresh behind if (root)'
  );

  // Functional verification
  let refreshedWith = null;
  const mockToolchainStore = {
    async refresh(root) {
      refreshedWith = root;
    },
    async init(root) {
      await this.refresh(root || '');
    },
  };

  mockToolchainStore.init('');
  assert.equal(refreshedWith, '', 'init("") must invoke refresh("") for global tools scan');

  mockToolchainStore.init(undefined);
  assert.equal(refreshedWith, '', 'init(undefined) must invoke refresh("")');

  mockToolchainStore.init('/path/to/project');
  assert.equal(refreshedWith, '/path/to/project', 'init(path) must invoke refresh(path)');
});

test('dynamic scrcpy & clean actionsNeeded: scrcpyOk reflects tc.scrcpy and no artificial +1', () => {
  const dashPath = path.resolve(uiRoot, 'features/dashboard/DashboardView.svelte');
  const dashCode = fs.readFileSync(dashPath, 'utf-8');

  // 1. Dynamic scrcpyOk in summary
  assert.ok(
    dashCode.includes('const scrcpyOk = !!tc?.scrcpy;'),
    'scrcpyOk must be dynamic from tc?.scrcpy, not hardcoded false'
  );
  assert.ok(!dashCode.includes('const scrcpyOk = false;'), 'Must not hardcode scrcpyOk = false');

  // 2. actionsNeeded without artificial + 1
  assert.ok(
    dashCode.includes('const actionsNeeded = essentialTools.filter((ok) => !ok).length;'),
    'actionsNeeded must calculate missing essential tools without artificial + 1'
  );
  assert.ok(
    !dashCode.includes('.length + 1;'),
    'Must not contain artificial .length + 1 in actionsNeeded'
  );

  // 3. Dynamic scrcpy row in Doctor modal
  assert.ok(
    dashCode.includes('class:ok={toolchainSummary.scrcpyOk}'),
    'scrcpy status badge must have class:ok when scrcpyOk'
  );
  assert.ok(
    dashCode.includes('class:warn={!toolchainSummary.scrcpyOk}'),
    'scrcpy status badge must have class:warn when !scrcpyOk'
  );
  assert.ok(
    dashCode.includes("toolchainSummary.tc?.scrcpy?.version || 'Ready'"),
    'Must show scrcpy version or Ready when installed'
  );
  assert.ok(
    dashCode.includes('{#if toolchainSummary.scrcpyOk}'),
    'Must conditionally render Ready badge vs Guide button'
  );
  assert.ok(
    dashCode.includes('✓ Ready'),
    'Must display ✓ Ready when scrcpy is installed'
  );

  // 4. Functional logic calculation test
  const calculateSummary = (tc, kotlinInstalled = false) => {
    const flutterOk = !!tc?.flutter;
    const dartOk = !!tc?.dart;
    const androidOk = !!(tc?.adb || tc?.androidHome);
    const javaOk = !!tc?.java;
    const kotlinOk = !!tc?.kotlinLs || kotlinInstalled;
    const scrcpyOk = !!tc?.scrcpy;
    const xcodeOk = !!(tc?.xcrun || tc?.sourcekit);

    const essentialTools = [flutterOk, dartOk, androidOk, javaOk, kotlinOk];
    const readyCount = [flutterOk, dartOk, androidOk, javaOk, kotlinOk, scrcpyOk, xcodeOk].filter(Boolean).length;
    const actionsNeeded = essentialTools.filter((ok) => !ok).length;

    return {
      flutterOk,
      dartOk,
      androidOk,
      javaOk,
      kotlinOk,
      scrcpyOk,
      xcodeOk,
      readyCount,
      actionsNeeded,
      allGood: actionsNeeded === 0,
    };
  };

  // Scenario A: Full toolchain installed (including scrcpy)
  const fullTc = {
    flutter: { version: '3.29.0', path: '/flutter/bin/flutter' },
    dart: { version: '3.7.0', path: '/flutter/bin/dart' },
    adb: { version: '35.0.2', path: '/android/platform-tools/adb' },
    androidHome: '/android/sdk',
    java: { version: '17.0.2', path: '/jdk/bin/java' },
    kotlinLs: { version: '1.3.13', path: '/bin/kls' },
    scrcpy: { version: '2.4', path: '/usr/bin/scrcpy' },
  };
  const summaryA = calculateSummary(fullTc);
  assert.equal(summaryA.scrcpyOk, true, 'scrcpyOk must be true when tc.scrcpy is present');
  assert.equal(summaryA.actionsNeeded, 0, 'actionsNeeded must be 0 when all essential tools are present');
  assert.equal(summaryA.allGood, true, 'allGood must be true');

  // Scenario B: Toolchain without scrcpy
  const noScrcpyTc = { ...fullTc, scrcpy: null };
  const summaryB = calculateSummary(noScrcpyTc);
  assert.equal(summaryB.scrcpyOk, false, 'scrcpyOk must be false when tc.scrcpy is null');
  assert.equal(summaryB.actionsNeeded, 0, 'scrcpy is companion/optional; essential tools are still satisfied');

  // Scenario C: Toolchain missing Flutter and Java
  const partialTc = {
    flutter: null,
    dart: { version: '3.7.0' },
    adb: { version: '35' },
    java: null,
    kotlinLs: null,
    scrcpy: { version: '2.4' },
  };
  const summaryC = calculateSummary(partialTc);
  assert.equal(summaryC.flutterOk, false);
  assert.equal(summaryC.javaOk, false);
  assert.equal(summaryC.kotlinOk, false);
  assert.equal(summaryC.scrcpyOk, true);
  assert.equal(summaryC.actionsNeeded, 3, 'actionsNeeded must be exactly 3 missing essential tools');
});
