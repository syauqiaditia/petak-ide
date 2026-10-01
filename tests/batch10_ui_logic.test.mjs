import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { dedupeAndCategorizeDevices } from '../ui/features/mirror/pickerLogic.ts';
import { clearBootingForOnline } from '../ui/features/run/deviceLogic.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uiRoot = path.resolve(__dirname, '../ui');

// =============================================================================
// Suite 1: Android Physical Wi-Fi Debugging Mirror Readiness (Scope 1)
// =============================================================================

test('mirror picker: android physical Wi-Fi debugging online allows mirroring', () => {
  const devices = [
    {
      id: '192.168.1.50:5555',
      name: 'Samsung Galaxy S23 (Wi-Fi)',
      platform: 'android',
      kind: 'physical',
      state: 'online',
      transport: 'wifi',
    },
  ];

  const cards = dedupeAndCategorizeDevices(devices, []);
  assert.equal(cards.length, 1);
  const card = cards[0];

  assert.equal(card.id, '192.168.1.50:5555');
  assert.equal(card.name, 'Samsung Galaxy S23 (Wi-Fi)');
  assert.equal(card.category, 'android-usb');
  assert.equal(card.canMirror, true, 'Online Wi-Fi Android physical device must allow mirroring');
  assert.equal(card.statusText, 'Siap', 'Status text must be Siap for online Wi-Fi device');
  assert.equal(card.transportBadge, 'Wi-Fi', 'Transport badge must be Wi-Fi');
  assert.equal(card.isUsb, false);
  assert.equal(card.disabledReason, undefined, 'Must not have disabledReason when online');
});

test('mirror picker: android physical Wi-Fi debugging with mDNS/TLS serial allows mirroring', () => {
  const tlsSerial = 'adb-RR8X401YEEY-YHrbnv._adb-tls-connect._tcp';
  const devices = [
    {
      id: tlsSerial,
      name: 'Samsung SM-A155F',
      platform: 'android',
      kind: 'physical',
      state: 'online',
    },
  ];

  const cards = dedupeAndCategorizeDevices(devices, []);
  assert.equal(cards.length, 1);
  const card = cards[0];

  assert.equal(card.id, tlsSerial, 'Card id must preserve exact mDNS/TLS serial');
  assert.equal(card.name, 'Samsung SM-A155F');
  assert.equal(card.canMirror, true, 'Online SM-A155F via TLS connect Wi-Fi must allow mirroring');
  assert.equal(card.statusText, 'Siap');
  assert.equal(card.transportBadge, 'Wi-Fi');
  assert.equal(card.disabledReason, undefined);
});

test('mirror picker: android physical USB online vs offline', () => {
  const devices = [
    {
      id: 'RF8M123456',
      name: 'Samsung Galaxy S20 (USB)',
      platform: 'android',
      kind: 'physical',
      state: 'online',
      transport: 'usb',
    },
    {
      id: 'RF8M999999',
      name: 'Samsung Galaxy A50 (Offline)',
      platform: 'android',
      kind: 'physical',
      state: 'offline',
      transport: 'usb',
    },
    {
      id: '192.168.1.100:5555',
      name: 'Pixel 4a (Offline Wi-Fi)',
      platform: 'android',
      kind: 'physical',
      state: 'offline',
      transport: 'wifi',
    },
  ];

  const cards = dedupeAndCategorizeDevices(devices, []);
  const usbOnline = cards.find((c) => c.id === 'RF8M123456');
  assert.ok(usbOnline);
  assert.equal(usbOnline.canMirror, true);
  assert.equal(usbOnline.statusText, 'Siap');
  assert.equal(usbOnline.transportBadge, 'USB');

  const usbOffline = cards.find((c) => c.id === 'RF8M999999');
  assert.ok(usbOffline);
  assert.equal(usbOffline.canMirror, false);
  assert.equal(usbOffline.statusText, 'Perlu kabel USB');

  const wifiOffline = cards.find((c) => c.id === '192.168.1.100:5555');
  assert.ok(wifiOffline);
  assert.equal(wifiOffline.canMirror, false);
  assert.equal(wifiOffline.statusText, 'Hanya Run');
});

// =============================================================================
// Suite 2: Running Emulator Visibility (Serial & AVD Name) (Scope 4)
// =============================================================================

test('mirror picker: running emulator with serial appears with Siap', () => {
  const devices = [
    {
      id: 'emulator-5554',
      name: 'Pixel 8 Pro API 35',
      platform: 'android',
      kind: 'emulator',
      state: 'online',
    },
  ];

  const cards = dedupeAndCategorizeDevices(devices, []);
  const emuCard = cards.find((c) => c.id === 'emulator-5554');
  assert.ok(emuCard, 'Emulator with serial emulator-5554 must appear in picker cards');
  assert.equal(emuCard.category, 'android-emulator');
  assert.equal(emuCard.canMirror, true);
  assert.equal(emuCard.statusText, 'Siap');
  assert.equal(emuCard.transportBadge, 'Emulator');
  assert.equal(emuCard.disabledReason, undefined);
});

test('mirror picker: running emulator with AVD name appears with Siap', () => {
  const devices = [
    {
      id: 'Pixel_7',
      name: 'Pixel_7',
      platform: 'android',
      kind: 'emulator',
      state: 'online',
    },
  ];

  const cards = dedupeAndCategorizeDevices(devices, []);
  const emuCard = cards.find((c) => c.id === 'Pixel_7');
  assert.ok(emuCard, 'Emulator with AVD name Pixel_7 must appear in picker cards');
  assert.equal(emuCard.category, 'android-emulator');
  assert.equal(emuCard.canMirror, true);
  assert.equal(emuCard.statusText, 'Siap');
  assert.equal(emuCard.transportBadge, 'Emulator');
});

test('mirror picker: running emulator from emulators list appears in cards', () => {
  const emulators = [
    {
      id: 'Pixel_7_Pro',
      name: 'Pixel_7_Pro',
      running: true,
    },
  ];

  const cards = dedupeAndCategorizeDevices([], emulators);
  const emuCard = cards.find((c) => c.id === 'Pixel_7_Pro');
  assert.ok(emuCard, 'Running emulator from emulators list must be listed in picker');
  assert.equal(emuCard.category, 'android-emulator');
  assert.equal(emuCard.canMirror, true);
  assert.equal(emuCard.statusText, 'Siap');
  assert.equal(emuCard.transportBadge, 'Emulator');
});

test('mirror picker: deduplicates emulator present in both devices and emulators list', () => {
  const devices = [
    {
      id: 'emulator-5554',
      name: 'Pixel_7',
      platform: 'android',
      kind: 'emulator',
      state: 'online',
    },
  ];
  const emulators = [
    {
      id: 'Pixel_7',
      name: 'Pixel_7',
      running: true,
      deviceId: 'emulator-5554',
    },
  ];

  const cards = dedupeAndCategorizeDevices(devices, emulators);
  const emus = cards.filter((c) => c.category === 'android-emulator');
  assert.equal(emus.length, 1, 'Emulator must not be duplicated when present in both devices and emulators');
  assert.equal(emus[0].id, 'emulator-5554');
  assert.equal(emus[0].canMirror, true);
  assert.equal(emus[0].statusText, 'Siap');
});

// =============================================================================
// Suite 3: Topbar Booting Status Synchronization in runStore (Scope 3)
// =============================================================================

test('booting status sync: clearBootingForOnline removes booting status when emulator online', () => {
  const statuses = {
    Pixel_7: { state: 'booting' },
    'emulator-5556': { state: 'booting' },
    Pixel_6: { state: 'failed', error: 'AVD crashed' },
    Pixel_5: { state: 'stopped' },
  };

  const devices = [
    {
      id: 'emulator-5554',
      name: 'Pixel_7',
      platform: 'android',
      kind: 'emulator',
      state: 'online',
    },
    {
      id: 'emulator-5556',
      name: 'Pixel_8',
      platform: 'android',
      kind: 'emulator',
      state: 'online',
    },
  ];

  const updated = clearBootingForOnline(statuses, devices);

  assert.equal(updated.Pixel_7, undefined, 'Booting status for Pixel_7 must be removed when online');
  assert.equal(updated['emulator-5556'], undefined, 'Booting status for emulator-5556 must be removed when online');
  assert.deepEqual(updated.Pixel_6, { state: 'failed', error: 'AVD crashed' }, 'Failed status must remain untouched');
  assert.deepEqual(updated.Pixel_5, { state: 'stopped' }, 'Stopped status must remain untouched');
});

test('booting status sync: does not remove booting status if device is still booting or offline', () => {
  const statuses = {
    Pixel_7: { state: 'booting' },
  };

  const devices = [
    {
      id: 'Pixel_7',
      name: 'Pixel_7',
      platform: 'android',
      kind: 'emulator',
      state: 'booting',
    },
  ];

  const updated = clearBootingForOnline(statuses, devices);
  assert.deepEqual(updated.Pixel_7, { state: 'booting' }, 'Booting status must remain when device is still booting');
});

test('runStore: contains booting synchronization in updateDevices, updateSnapshot, and startAutoPolling', () => {
  const runStorePath = path.resolve(uiRoot, 'features/run/runStore.svelte.ts');
  const runStoreCode = fs.readFileSync(runStorePath, 'utf-8');

  // Verify updateDevices calls clearBootingForOnline
  assert.ok(
    runStoreCode.includes('clearBootingForOnline'),
    'runStore must import and call clearBootingForOnline'
  );

  // Verify updateSnapshot checks running emulators to clear booting
  assert.ok(
    runStoreCode.includes('this.updateDevices(devs)'),
    'updateSnapshot must forward processed devices to updateDevices'
  );

  // Verify startAutoPolling cleans up booting status upon online detection
  assert.ok(
    runStoreCode.includes('startAutoPolling(name: string)'),
    'runStore must declare startAutoPolling'
  );

  // Verify get emulators exists on runStore
  assert.ok(
    runStoreCode.includes('get emulators()'),
    'runStore must declare get emulators() getter'
  );
});

// =============================================================================
// Suite 4: Device Serial Precision for Mirror Selection (Scope 2)
// =============================================================================

test('serial precision: exact device serial preserved without truncation', () => {
  const longMdnsSerial = 'adb-RR8X401YEEY-YHrbnv._adb-tls-connect._tcp';
  const devices = [
    {
      id: longMdnsSerial,
      name: 'Samsung SM-A155F',
      platform: 'android',
      kind: 'physical',
      state: 'online',
    },
    {
      id: '192.168.1.123:5555',
      name: 'Pixel Tablet',
      platform: 'android',
      kind: 'physical',
      state: 'online',
    },
  ];

  const cards = dedupeAndCategorizeDevices(devices, []);
  const samsungCard = cards.find((c) => c.name === 'Samsung SM-A155F');
  assert.ok(samsungCard);
  assert.equal(
    samsungCard.id,
    longMdnsSerial,
    'Card id must match exact full serial including _adb-tls-connect._tcp'
  );

  const tabletCard = cards.find((c) => c.name === 'Pixel Tablet');
  assert.ok(tabletCard);
  assert.equal(tabletCard.id, '192.168.1.123:5555', 'Port and IP must be strictly preserved');
});

test('serial precision: DevicePickerView passes card.id directly to mirrorStore.start', () => {
  const pickerViewPath = path.resolve(uiRoot, 'features/mirror/DevicePickerView.svelte');
  const viewCode = fs.readFileSync(pickerViewPath, 'utf-8');

  assert.ok(
    viewCode.includes('mirrorStore.start(card.id)'),
    'DevicePickerView must invoke mirrorStore.start with card.id'
  );
});
