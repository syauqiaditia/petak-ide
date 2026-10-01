import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildAdbQrPayload,
  generateAdbPairingCredentials,
  generateQrSvg,
  encodeQr,
} from '../ui/features/run/qrcode.ts';
import { api } from '../ui/lib/api.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uiRoot = path.resolve(__dirname, '../ui');

// =============================================================================
// Suite 1: ADB Wi-Fi Pairing Payload Formatting
// =============================================================================

test('payload: buildAdbQrPayload formats string WPA3/ADB precisely', () => {
  const serviceName = 'studio-petak-a1b2c3d4';
  const password = 'XyZ987wVuTsRqPoN';
  const payload = buildAdbQrPayload(serviceName, password);

  assert.equal(payload, 'WIFI:T:ADB;S:studio-petak-a1b2c3d4;P:XyZ987wVuTsRqPoN;;');
  assert.ok(payload.startsWith('WIFI:T:ADB;'));
  assert.ok(payload.includes(';S:studio-petak-a1b2c3d4;'));
  assert.ok(payload.includes(';P:XyZ987wVuTsRqPoN;;'));
  assert.ok(payload.endsWith(';;'));
});

test('payload: buildAdbQrPayload handles custom names and characters', () => {
  assert.equal(
    buildAdbQrPayload('studio-petak-00000000', '123456789012'),
    'WIFI:T:ADB;S:studio-petak-00000000;P:123456789012;;'
  );
  assert.equal(
    buildAdbQrPayload('studio-petak-ffffffff', 'PassW0rd!@#$%^'),
    'WIFI:T:ADB;S:studio-petak-ffffffff;P:PassW0rd!@#$%^;;'
  );
});

// =============================================================================
// Suite 2: Credential Generator (studio-petak- + 8 char & secure password)
// =============================================================================

test('credentials: generateAdbPairingCredentials produces required format and lengths', () => {
  const creds = generateAdbPairingCredentials();

  assert.ok(creds.serviceName, 'Service name must be present');
  assert.ok(creds.password, 'Password must be present');

  // serviceName: 'studio-petak-' + 8 alphanumeric characters
  const servicePattern = /^studio-petak-[a-z0-9]{8}$/;
  assert.match(
    creds.serviceName,
    servicePattern,
    `Service name "${creds.serviceName}" must match format studio-petak-[a-z0-9]{8}`
  );

  // password: 12-16 characters, alphanumeric
  assert.ok(
    creds.password.length >= 12 && creds.password.length <= 16,
    `Password length ${creds.password.length} must be between 12 and 16 characters`
  );
  assert.match(
    creds.password,
    /^[A-Za-z0-9]+$/,
    'Password must be alphanumeric'
  );
});

test('credentials: generateAdbPairingCredentials generates unique values across calls', () => {
  const seenServices = new Set();
  const seenPasswords = new Set();
  const iterations = 25;

  for (let i = 0; i < iterations; i++) {
    const { serviceName, password } = generateAdbPairingCredentials();
    assert.equal(seenServices.has(serviceName), false, `Collision detected for serviceName: ${serviceName}`);
    assert.equal(seenPasswords.has(password), false, `Collision detected for password: ${password}`);
    seenServices.add(serviceName);
    seenPasswords.add(password);
  }

  assert.equal(seenServices.size, iterations);
  assert.equal(seenPasswords.size, iterations);
});

// =============================================================================
// Suite 3: Zero-Dependency SVG QR Code Generator
// =============================================================================

test('svg: generateQrSvg produces valid scalable XML SVG string with required attributes', () => {
  const payload = 'WIFI:T:ADB;S:studio-petak-a1b2c3d4;P:XyZ987wVuTsRqPoN;;';
  const svg = generateQrSvg(payload);

  assert.ok(typeof svg === 'string', 'Output must be string');
  assert.ok(svg.startsWith('<svg'), 'Must begin with <svg tag');
  assert.ok(svg.includes('xmlns="http://www.w3.org/2000/svg"'), 'Must define SVG namespace');
  assert.ok(svg.includes('viewBox="0 0 '), 'Must contain viewBox attribute for scaling');
  assert.ok(svg.includes('<rect'), 'Must contain background rect');
  assert.ok(svg.includes('<path d="M'), 'Must contain path element with module coordinates');
  assert.ok(svg.endsWith('</svg>'), 'Must end with </svg>');
  assert.ok(svg.includes('shape-rendering="crispEdges"'), 'Must specify crispEdges for sharp QR scan');
});

test('svg: generateQrSvg respects custom size, margin, fg, and bg options', () => {
  const payload = 'WIFI:T:ADB;S:studio-petak-11223344;P:SecretPassword16;;';
  const customSvg = generateQrSvg(payload, {
    size: 320,
    margin: 4,
    fg: '#123456',
    bg: '#abcdef',
  });

  assert.ok(customSvg.includes('width="320"'));
  assert.ok(customSvg.includes('height="320"'));
  assert.ok(customSvg.includes('fill="#abcdef"'), 'Must use custom background');
  assert.ok(customSvg.includes('fill="#123456"'), 'Must use custom foreground');

  // Version 4 is 33x33 + margin 4*2 = 41x41 viewBox
  assert.ok(customSvg.includes('viewBox="0 0 41 41"'));
});

// =============================================================================
// Suite 4: QR Matrix Encoding & Standard Compliance
// =============================================================================

test('matrix: encodeQr generates standard finder patterns and functional modules', () => {
  const payload = 'WIFI:T:ADB;S:studio-petak-a1b2c3d4;P:XyZ987wVuTsRqPoN;;';
  const { matrix, size, version } = encodeQr(payload);

  // Version 4 for ~55 chars byte mode (33x33)
  assert.equal(version, 4, 'Payload length ~55 must map to QR Version 4');
  assert.equal(size, 33, 'Version 4 matrix size must be 33x33');
  assert.equal(matrix.length, 33);
  assert.equal(matrix[0].length, 33);

  // Helper to test 7x7 Finder Pattern at (topR, leftC)
  function verifyFinder(topR, leftC) {
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 7; c++) {
        const isBorder = (r === 0 || r === 6 || c === 0 || c === 6);
        const isCenter = (r >= 2 && r <= 4 && c >= 2 && c <= 4);
        const expected = isBorder || isCenter ? 1 : 0;
        assert.equal(
          matrix[topR + r][leftC + c],
          expected,
          `Finder module at (${topR + r}, ${leftC + c}) must be ${expected}`
        );
      }
    }
  }

  // 1. Top-Left Finder
  verifyFinder(0, 0);
  // 2. Top-Right Finder
  verifyFinder(0, size - 7);
  // 3. Bottom-Left Finder
  verifyFinder(size - 7, 0);

  // 4. Dark Module at (size - 8, 8)
  assert.equal(matrix[size - 8][8], 1, 'Dark module at (size - 8, 8) must always be 1');

  // 5. Timing Patterns: alternating 1 and 0
  for (let i = 8; i < size - 8; i++) {
    const expected = (i % 2 === 0) ? 1 : 0;
    assert.equal(matrix[6][i], expected, `Horizontal timing at col ${i} must be ${expected}`);
    assert.equal(matrix[i][6], expected, `Vertical timing at row ${i} must be ${expected}`);
  }
});

test('matrix: QR code round-trip decodes byte mode payload perfectly', () => {
  // Test helper decoder to verify bitstream encoding, data padding, and mask application
  function decodeQrBytePayload(matrix, size, version, mask) {
    const MASK_PATTERNS = [
      (r, c) => (r + c) % 2 === 0,
      (r, _c) => r % 2 === 0,
      (_r, c) => c % 3 === 0,
      (r, c) => (r + c) % 3 === 0,
      (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
      (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
      (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
      (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
    ];

    const isFunction = Array.from({ length: size }, () => new Uint8Array(size));
    function markFunc(topR, leftC, w, h) {
      for (let r = 0; r < h; r++) {
        for (let c = 0; c < w; c++) {
          isFunction[topR + r][leftC + c] = 1;
        }
      }
    }

    markFunc(0, 0, 9, 9);
    markFunc(0, size - 8, 8, 9);
    markFunc(size - 8, 0, 9, 8);

    // Alignment for V4 is (26, 26)
    if (version >= 2) {
      const alignPos = [0, 0, 18, 22, 26, 30][version];
      markFunc(alignPos - 2, alignPos - 2, 5, 5);
    }

    for (let i = 0; i < size; i++) {
      isFunction[6][i] = 1;
      isFunction[i][6] = 1;
    }
    isFunction[size - 8][8] = 1;

    for (let i = 0; i <= 8; i++) {
      if (i !== 6) isFunction[8][i] = 1;
      if (i !== 6) isFunction[i][8] = 1;
    }
    for (let i = 0; i < 8; i++) {
      isFunction[size - 1 - i][8] = 1;
      isFunction[8][size - 8 + i] = 1;
    }

    const maskFn = MASK_PATTERNS[mask];
    const bits = [];
    let goingUp = true;
    for (let rightCol = size - 1; rightCol > 0; rightCol -= 2) {
      if (rightCol === 6) rightCol--;
      const rows = goingUp
        ? Array.from({ length: size }, (_, k) => size - 1 - k)
        : Array.from({ length: size }, (_, k) => k);

      for (const r of rows) {
        for (const c of [rightCol, rightCol - 1]) {
          if (!isFunction[r][c]) {
            const bit = matrix[r][c] ^ (maskFn(r, c) ? 1 : 0);
            bits.push(bit);
          }
        }
      }
      goingUp = !goingUp;
    }

    let bitPos = 0;
    function readBits(len) {
      let val = 0;
      for (let i = 0; i < len; i++) {
        val = (val << 1) | bits[bitPos++];
      }
      return val;
    }

    const mode = readBits(4);
    assert.equal(mode, 4, 'Mode must be 4 (Byte mode)');
    const count = readBits(8);
    const charCodes = [];
    for (let i = 0; i < count; i++) {
      charCodes.push(readBits(8));
    }
    return String.fromCharCode(...charCodes);
  }

  const testPayloads = [
    'WIFI:T:ADB;S:studio-petak-a1b2c3d4;P:XyZ987wVuTsRqPoN;;',
    'WIFI:T:ADB;S:studio-petak-00000000;P:1122334455667788;;',
    'WIFI:T:ADB;S:studio-petak-test1234;P:AbCdEfGhIjKlMnOp;;',
  ];

  for (const payload of testPayloads) {
    const { matrix, size, version, mask } = encodeQr(payload);
    const decoded = decodeQrBytePayload(matrix, size, version, mask);
    assert.equal(decoded, payload, `Decoded QR string must match original payload for "${payload}"`);
  }
});

// =============================================================================
// Suite 5: API Bindings & Modal UI Contract
// =============================================================================

test('api: adbFindPairingService returns null in browser/node environment without Tauri', async () => {
  const prevWindow = globalThis.window;
  try {
    globalThis.window = {};
    const res = await api.adbFindPairingService('studio-petak-test');
    assert.equal(res, null, 'Must return null when __TAURI_INTERNALS__ is not present');
  } finally {
    globalThis.window = prevWindow;
  }
});

test('modal structure: PairDeviceModal includes QR pairing tab, credentials, polling, and instructions', () => {
  const modalPath = path.resolve(uiRoot, 'features/run/PairDeviceModal.svelte');
  const code = fs.readFileSync(modalPath, 'utf-8');

  // Verify tab labels
  assert.ok(code.includes('Pindai Kode QR'), 'Must declare "Pindai Kode QR" tab');
  assert.ok(code.includes('Kode Pemasangan (Manual)'), 'Must declare "Kode Pemasangan (Manual)" tab');
  assert.ok(code.includes('Petunjuk Langkah'), 'Must declare "Petunjuk Langkah" tab');

  // Verify QR elements & status text
  assert.ok(code.includes('{@html qrSvg}'), 'Must render SVG QR code via {@html qrSvg}');
  assert.ok(code.includes('Nama Layanan'), 'Must show service name metadata');
  assert.ok(code.includes('Menunggu pemindaian dari kamera HP...'), 'Must declare waiting status copy');
  assert.ok(code.includes('Perangkat terdeteksi! Memasangkan...'), 'Must declare pairing status copy');
  assert.ok(code.includes('Buat Ulang Kode QR') || code.includes('Refresh QR'), 'Must provide QR refresh button');
  assert.ok(code.includes('Pasangkan dengan kode QR'), 'Must provide QR scan guidance');

  // Verify polling & cleanup
  assert.ok(code.includes('adbFindPairingService'), 'Must invoke api.adbFindPairingService during polling');
  assert.ok(code.includes('clearInterval'), 'Must clear polling timer on tab switch, close, or destroy');
  assert.ok(code.includes('1500'), 'Must poll at 1.5s (1500ms) interval');

  // Verify manual form inputs retained from batch 11
  assert.ok(code.includes('Alamat IP'));
  assert.ok(code.includes('Port Pemasangan'));
  assert.ok(code.includes('Port Koneksi'));
  assert.ok(code.includes('Batal'));
  assert.ok(code.includes('Pasangkan'));
});
