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

  // password: 6 digits numeric
  assert.equal(creds.password.length, 6, 'Password length must be 6 digits');
  assert.match(
    creds.password,
    /^[0-9]{6}$/,
    'Password must be 6 digits'
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

  // viewBox incorporates size + margin * 2
  assert.ok(customSvg.includes('viewBox="0 0 '));
});

// =============================================================================
// Suite 4: QR Matrix Encoding & Standard Compliance
// =============================================================================

test('matrix: encodeQr generates standard finder patterns and functional modules', () => {
  const payload = 'WIFI:T:ADB;S:studio-petak-a1b2c3d4;P:XyZ987wVuTsRqPoN;;';
  const { matrix, size, version } = encodeQr(payload);

  assert.ok(version >= 1 && version <= 10, 'Version must be a valid QR version');
  assert.equal(size, version * 4 + 17, 'Size must follow version * 4 + 17 formula');
  assert.equal(matrix.length, size);
  assert.equal(matrix[0].length, size);

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

  // 4. Dark Module at (size - 8, 8) or standard position
  assert.ok(matrix[size - 8][8] === 1 || matrix[8][size - 8] === 1, 'Dark module must exist in standard position');

  // 5. Timing Patterns: alternating 1 and 0
  for (let i = 8; i < size - 8; i++) {
    const expected = (i % 2 === 0) ? 1 : 0;
    assert.equal(matrix[6][i], expected, `Horizontal timing at col ${i} must be ${expected}`);
    assert.equal(matrix[i][6], expected, `Vertical timing at row ${i} must be ${expected}`);
  }
});

test('matrix: QR code produces valid modules and encodes ADB payload', () => {
  const testPayloads = [
    'WIFI:T:ADB;S:studio-petak-a1b2c3d4;P:XyZ987wVuTsRqPoN;;',
    'WIFI:T:ADB;S:studio-petak-test01;P:Pass12345678;;',
    'WIFI:T:ADB;S:studio-petak-longname1234;P:SuperSecretPass99;;',
  ];

  for (const payload of testPayloads) {
    const { matrix, size, version } = encodeQr(payload);
    assert.ok(matrix.length === size);
    assert.ok(version >= 1);
    
    // Count black vs white modules to ensure healthy density (30% - 70%)
    let blackCount = 0;
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (matrix[r][c] === 1) blackCount++;
      }
    }
    const ratio = blackCount / (size * size);
    assert.ok(ratio > 0.3 && ratio < 0.7, `Module density ratio ${ratio} must be balanced`);
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
