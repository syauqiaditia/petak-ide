import test from 'node:test';
import assert from 'node:assert/strict';
import { dedupeAndCategorizeDevices, isIosSimulatorDevice } from '../ui/features/mirror/pickerLogic.ts';
import { classifyMirrorDevice } from '../ui/features/mirror/mirrorErrorLogic.ts';

// Test 1: "iPhone 17 Pro" simulator (id: 1B4A5D9E-4392-4C90-880F-7F026210A2B1, platform: 'ios', kind: 'simulator')
// -> category 'ios-simulator', transportBadge 'Emulator', statusText 'Siap'
test('Test 1: iPhone 17 Pro simulator is categorized as ios-simulator with Emulator badge and Siap status', () => {
  const devices = [
    {
      id: '1B4A5D9E-4392-4C90-880F-7F026210A2B1',
      name: 'iPhone 17 Pro',
      platform: 'ios',
      kind: 'simulator',
      state: 'online',
    },
  ];

  const cards = dedupeAndCategorizeDevices(devices, []);
  assert.equal(cards.length, 1);
  const card = cards[0];

  assert.equal(card.category, 'ios-simulator');
  assert.equal(card.transportBadge, 'Emulator');
  assert.equal(card.statusText, 'Siap');
  assert.equal(card.canMirror, true);
  assert.equal(card.isUsb, false);
});

// Test 2: "iPhone 17 Pro" tanpa kind simulator tapi dengan UUID simulator 36-karakter
// -> category 'ios-simulator', transportBadge 'Emulator'
test('Test 2: iPhone 17 Pro without simulator kind but with 36-char UUID is categorized as ios-simulator', () => {
  const devices = [
    {
      id: '1B4A5D9E-4392-4C90-880F-7F026210A2B1',
      name: 'iPhone 17 Pro',
      platform: 'ios',
    },
  ];

  const cards = dedupeAndCategorizeDevices(devices, []);
  assert.equal(cards.length, 1);
  const card = cards[0];

  assert.equal(card.category, 'ios-simulator');
  assert.equal(card.transportBadge, 'Emulator');
  assert.equal(card.statusText, 'Siap');
  assert.equal(card.isUsb, false);
});

// Test 3: "UQi" (id: 00008110-00012CCE0C09401E, platform: 'ios', transport: 'usb')
// -> category 'iphone-usb', transportBadge 'USB', statusText 'Siap'
test('Test 3: UQi physical iPhone via USB is categorized as iphone-usb with USB badge and Siap status', () => {
  const devices = [
    {
      id: '00008110-00012CCE0C09401E',
      name: 'UQi',
      platform: 'ios',
      transport: 'usb',
      state: 'online',
    },
  ];

  const cards = dedupeAndCategorizeDevices(devices, []);
  assert.equal(cards.length, 1);
  const card = cards[0];

  assert.equal(card.category, 'iphone-usb');
  assert.equal(card.transportBadge, 'USB');
  assert.equal(card.statusText, 'Siap');
  assert.equal(card.canMirror, true);
  assert.equal(card.isUsb, true);
});

// Test 4: "UQi" (id: 00008110-00012CCE0C09401E, platform: 'ios', transport: 'wifi')
// -> category 'iphone-usb', transportBadge 'Wi-Fi', statusText 'Perlu kabel USB'
test('Test 4: UQi physical iPhone via Wi-Fi is categorized as iphone-usb with Wi-Fi badge and Perlu kabel USB status', () => {
  const devices = [
    {
      id: '00008110-00012CCE0C09401E',
      name: 'UQi',
      platform: 'ios',
      transport: 'wifi',
      state: 'online',
    },
  ];

  const cards = dedupeAndCategorizeDevices(devices, []);
  assert.equal(cards.length, 1);
  const card = cards[0];

  assert.equal(card.category, 'iphone-usb');
  assert.equal(card.transportBadge, 'Wi-Fi');
  assert.equal(card.statusText, 'Perlu kabel USB');
  assert.equal(card.canMirror, false);
  assert.equal(card.isUsb, false);
});

// Test 5: "SM A155F" (Android physical)
// -> category 'android-usb', transportBadge 'USB', statusText 'Siap'
test('Test 5: SM A155F Android physical device is categorized as android-usb with USB badge and Siap status', () => {
  const devices = [
    {
      id: 'RR8X401YEEY',
      name: 'SM A155F',
      platform: 'android',
      kind: 'physical',
      transport: 'usb',
      state: 'online',
    },
  ];

  const cards = dedupeAndCategorizeDevices(devices, []);
  assert.equal(cards.length, 1);
  const card = cards[0];

  assert.equal(card.category, 'android-usb');
  assert.equal(card.transportBadge, 'USB');
  assert.equal(card.statusText, 'Siap');
  assert.equal(card.canMirror, true);
  assert.equal(card.isUsb, true);
});

// Test 6: "Pixel 7 API 34" (Android emulator)
// -> category 'android-emulator', transportBadge 'Emulator'
test('Test 6: Pixel 7 API 34 Android emulator is categorized as android-emulator with Emulator badge', () => {
  const devices = [
    {
      id: 'emulator-5554',
      name: 'Pixel 7 API 34',
      platform: 'android',
      kind: 'emulator',
      state: 'online',
    },
  ];

  const cards = dedupeAndCategorizeDevices(devices, []);
  assert.equal(cards.length, 1);
  const card = cards[0];

  assert.equal(card.category, 'android-emulator');
  assert.equal(card.transportBadge, 'Emulator');
  assert.equal(card.statusText, 'Siap');
  assert.equal(card.canMirror, true);
  assert.equal(card.isUsb, false);
});

// Test 7: classifyMirrorDevice mengklasifikasikan "iPhone 17 Pro" sebagai simulator (bukan fisik) dan "UQi" sebagai fisik (isPhysical: true)
test('Test 7: classifyMirrorDevice classifies iPhone 17 Pro as simulator and UQi as physical', () => {
  const simDev = {
    id: '1B4A5D9E-4392-4C90-880F-7F026210A2B1',
    name: 'iPhone 17 Pro',
    platform: 'ios',
    kind: 'simulator',
  };
  const simClassification = classifyMirrorDevice(simDev);
  assert.equal(simClassification.platform, 'ios');
  assert.equal(simClassification.kind, 'ios-simulator');
  assert.equal(simClassification.isPhysical, false);

  // iPhone 17 Pro without explicit kind but simulator UUID
  const simDevNoKind = {
    id: '1B4A5D9E-4392-4C90-880F-7F026210A2B1',
    name: 'iPhone 17 Pro',
    platform: 'ios',
  };
  const simNoKindClassification = classifyMirrorDevice(simDevNoKind);
  assert.equal(simNoKindClassification.platform, 'ios');
  assert.equal(simNoKindClassification.kind, 'ios-simulator');
  assert.equal(simNoKindClassification.isPhysical, false);

  // UQi physical iPhone
  const uqiDev = {
    id: '00008110-00012CCE0C09401E',
    name: 'UQi',
    platform: 'ios',
    transport: 'usb',
  };
  const uqiClassification = classifyMirrorDevice(uqiDev);
  assert.equal(uqiClassification.platform, 'ios');
  assert.equal(uqiClassification.kind, 'ios-physical');
  assert.equal(uqiClassification.isPhysical, true);
});
