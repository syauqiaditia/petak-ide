import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  validateIp,
  validatePort,
  validatePairingCode,
  resolveConnectPort,
  validatePairingForm,
  executePairAndConnect,
} from '../ui/features/run/wifiPairingLogic.ts';
import { api } from '../ui/lib/api.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uiRoot = path.resolve(__dirname, '../ui');

// =============================================================================
// Suite 1: Input Validation (IP, Port 1-65535, 6-digit Code)
// =============================================================================

test('validation: IP address valid formats', () => {
  assert.equal(validateIp('192.168.1.50'), true);
  assert.equal(validateIp('10.0.0.1'), true);
  assert.equal(validateIp('127.0.0.1'), true);
  assert.equal(validateIp('172.16.0.100'), true);
  assert.equal(validateIp('0.0.0.0'), true);
  assert.equal(validateIp('255.255.255.255'), true);
  assert.equal(validateIp('  192.168.1.50  '), true, 'Should trim surrounding whitespace');
});

test('validation: IP address invalid formats', () => {
  assert.equal(validateIp('192.168.1.256'), false, 'Octet > 255 is invalid');
  assert.equal(validateIp('192.168.1'), false, '3 octets is invalid');
  assert.equal(validateIp('192.168.1.1.1'), false, '5 octets is invalid');
  assert.equal(validateIp('192.168.1.50:5555'), false, 'IP with port is invalid for IP field');
  assert.equal(validateIp('abc.def.ghi.jkl'), false);
  assert.equal(validateIp(''), false);
  assert.equal(validateIp('   '), false);
  assert.equal(validateIp(null), false);
  assert.equal(validateIp(undefined), false);
});

test('validation: port numbers in range 1-65535', () => {
  assert.equal(validatePort(1), true);
  assert.equal(validatePort(80), true);
  assert.equal(validatePort(5555), true);
  assert.equal(validatePort(37123), true);
  assert.equal(validatePort(65535), true);
  assert.equal(validatePort('37123'), true, 'Numeric string is valid');
  assert.equal(validatePort('  5555  '), true, 'Trimmed numeric string is valid');
});

test('validation: port numbers out of range or invalid', () => {
  assert.equal(validatePort(0), false, 'Port 0 is invalid');
  assert.equal(validatePort(-1), false, 'Negative port is invalid');
  assert.equal(validatePort(65536), false, 'Port 65536 is out of range');
  assert.equal(validatePort(99999), false, 'Port 99999 is out of range');
  assert.equal(validatePort(''), false);
  assert.equal(validatePort('abc'), false);
  assert.equal(validatePort('3712a'), false);
  assert.equal(validatePort(3.14), false, 'Non-integer is invalid');
  assert.equal(validatePort(null), false);
  assert.equal(validatePort(undefined), false);
});

test('validation: pairing code must be exactly 6 digits', () => {
  assert.equal(validatePairingCode('123456'), true);
  assert.equal(validatePairingCode('000000'), true);
  assert.equal(validatePairingCode('999999'), true);
  assert.equal(validatePairingCode('  482910  '), true, 'Trimmed 6 digits is valid');

  assert.equal(validatePairingCode('12345'), false, '5 digits is invalid');
  assert.equal(validatePairingCode('1234567'), false, '7 digits is invalid');
  assert.equal(validatePairingCode('12345a'), false, 'Non-numeric is invalid');
  assert.equal(validatePairingCode('abcdef'), false);
  assert.equal(validatePairingCode(''), false);
  assert.equal(validatePairingCode(null), false);
  assert.equal(validatePairingCode(undefined), false);
});

test('validation: validatePairingForm aggregates errors accurately', () => {
  const validForm = validatePairingForm({
    ip: '192.168.1.50',
    pairingPort: '37123',
    pairingCode: '123456',
    connectPort: '41234',
  });
  assert.equal(validForm.valid, true);
  assert.deepEqual(validForm.errors, {});

  const invalidForm = validatePairingForm({
    ip: 'invalid-ip',
    pairingPort: '99999',
    pairingCode: '12',
    connectPort: 'invalid-port',
  });
  assert.equal(invalidForm.valid, false);
  assert.ok(invalidForm.errors.ip);
  assert.ok(invalidForm.errors.pairingPort);
  assert.ok(invalidForm.errors.pairingCode);
  assert.ok(invalidForm.errors.connectPort);

  // Optional connectPort omitted
  const optionalOmitted = validatePairingForm({
    ip: '192.168.1.50',
    pairingPort: '37123',
    pairingCode: '123456',
    connectPort: '',
  });
  assert.equal(optionalOmitted.valid, true);
  assert.equal(optionalOmitted.errors.connectPort, undefined);
});

// =============================================================================
// Suite 2: Fallback Connect Port Logic
// =============================================================================

test('fallback connect port: uses connectPort if provided and valid', () => {
  assert.equal(resolveConnectPort(37123, 41234), 41234);
  assert.equal(resolveConnectPort('37123', '5555'), 5555);
  assert.equal(resolveConnectPort(37123, '40001'), 40001);
});

test('fallback connect port: falls back to pairingPort if connectPort is empty or omitted', () => {
  assert.equal(resolveConnectPort(37123, undefined), 37123);
  assert.equal(resolveConnectPort(37123, null), 37123);
  assert.equal(resolveConnectPort('37123', ''), 37123);
  assert.equal(resolveConnectPort('37123', '   '), 37123);
  assert.equal(resolveConnectPort(37123, 'invalid'), 37123, 'Falls back to pairingPort if connectPort is invalid');
});

test('fallback connect port: falls back to 5555 if both are missing or invalid', () => {
  assert.equal(resolveConnectPort(undefined, undefined), 5555);
  assert.equal(resolveConnectPort('invalid', ''), 5555);
});

// =============================================================================
// Suite 3: Mock API Call adbPair & adbConnect Flow
// =============================================================================

test('api bindings: adbPair and adbConnect return mock strings in browser/node environment', async () => {
  const prevWindow = globalThis.window;
  try {
    globalThis.window = {};
    const pairRes = await api.adbPair('192.168.1.50', 37123, '123456');
    assert.equal(pairRes, 'Mock paired to 192.168.1.50:37123');

    const connectRes = await api.adbConnect('192.168.1.50', 5555);
    assert.equal(connectRes, 'Mock connected to 192.168.1.50:5555');
  } finally {
    globalThis.window = prevWindow;
  }
});

test('executePairAndConnect: performs sequential pair then connect with explicit connectPort', async () => {
  const calls = [];
  const mockApi = {
    async adbPair(host, port, code) {
      calls.push({ fn: 'adbPair', host, port, code });
      return `Successfully paired to ${host}:${port}`;
    },
    async adbConnect(host, port) {
      calls.push({ fn: 'adbConnect', host, port });
      return `connected to ${host}:${port}`;
    },
  };

  const res = await executePairAndConnect({
    host: '192.168.1.50',
    pairingPort: 37123,
    pairingCode: '123456',
    connectPort: 42000,
    apiClient: mockApi,
  });

  assert.equal(res.success, true);
  assert.equal(res.effectiveConnectPort, 42000);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], {
    fn: 'adbPair',
    host: '192.168.1.50',
    port: 37123,
    code: '123456',
  });
  assert.deepEqual(calls[1], {
    fn: 'adbConnect',
    host: '192.168.1.50',
    port: 42000,
  });
});

test('executePairAndConnect: falls back to pairingPort when connectPort is empty', async () => {
  const calls = [];
  const mockApi = {
    async adbPair(host, port, code) {
      calls.push({ fn: 'adbPair', host, port, code });
      return 'Successfully paired';
    },
    async adbConnect(host, port) {
      calls.push({ fn: 'adbConnect', host, port });
      return 'connected';
    },
  };

  const res = await executePairAndConnect({
    host: '192.168.1.100',
    pairingPort: 39999,
    pairingCode: '654321',
    connectPort: '',
    apiClient: mockApi,
  });

  assert.equal(res.success, true);
  assert.equal(res.effectiveConnectPort, 39999);
  assert.equal(calls[1].port, 39999, 'adbConnect must receive pairingPort as fallback');
});

test('executePairAndConnect: halts and throws if adbPair fails', async () => {
  const calls = [];
  const mockApi = {
    async adbPair(host, port, code) {
      calls.push({ fn: 'adbPair', host, port, code });
      return 'Failed: Wrong password or connection timed out';
    },
    async adbConnect(host, port) {
      calls.push({ fn: 'adbConnect', host, port });
      return 'connected';
    },
  };

  await assert.rejects(
    async () => {
      await executePairAndConnect({
        host: '192.168.1.50',
        pairingPort: 37123,
        pairingCode: '123456',
        apiClient: mockApi,
      });
    },
    /Failed: Wrong password/
  );

  assert.equal(calls.length, 1, 'adbConnect must NOT be called if adbPair fails');
});

test('executePairAndConnect: validates inputs before invoking API', async () => {
  await assert.rejects(
    async () => {
      await executePairAndConnect({
        host: 'invalid-ip',
        pairingPort: 37123,
        pairingCode: '123456',
      });
    },
    /Alamat IP tidak valid/
  );

  await assert.rejects(
    async () => {
      await executePairAndConnect({
        host: '192.168.1.50',
        pairingPort: 70000,
        pairingCode: '123456',
      });
    },
    /Port pemasangan tidak valid/
  );

  await assert.rejects(
    async () => {
      await executePairAndConnect({
        host: '192.168.1.50',
        pairingPort: 37123,
        pairingCode: '12345',
      });
    },
    /Kode pemasangan harus 6 digit/
  );
});

// =============================================================================
// Suite 4: UI Trigger Buttons & Modal Integration
// =============================================================================

test('component trigger: DevicePickerView includes PairDeviceModal and trigger button', () => {
  const filePath = path.resolve(uiRoot, 'features/mirror/DevicePickerView.svelte');
  const code = fs.readFileSync(filePath, 'utf-8');

  assert.ok(
    code.includes("import PairDeviceModal from '../run/PairDeviceModal.svelte'"),
    'DevicePickerView must import PairDeviceModal'
  );
  assert.ok(
    code.includes('+ Pasangkan via Wi-Fi'),
    'DevicePickerView must include "+ Pasangkan via Wi-Fi" button label'
  );
  assert.ok(
    code.includes('<PairDeviceModal'),
    'DevicePickerView must mount <PairDeviceModal'
  );
});

test('component trigger: DevicesPanel includes PairDeviceModal and trigger button', () => {
  const filePath = path.resolve(uiRoot, 'features/run/DevicesPanel.svelte');
  const code = fs.readFileSync(filePath, 'utf-8');

  assert.ok(
    code.includes("import PairDeviceModal from './PairDeviceModal.svelte'"),
    'DevicesPanel must import PairDeviceModal'
  );
  assert.ok(
    code.includes('+ Pasangkan via Wi-Fi'),
    'DevicesPanel must include "+ Pasangkan via Wi-Fi" button label'
  );
  assert.ok(
    code.includes('<PairDeviceModal'),
    'DevicesPanel must mount <PairDeviceModal'
  );
});

test('modal structure: PairDeviceModal declares required tabs, inputs, and step guide', () => {
  const modalPath = path.resolve(uiRoot, 'features/run/PairDeviceModal.svelte');
  const code = fs.readFileSync(modalPath, 'utf-8');

  // Verify header and titles
  assert.ok(code.includes('Pasangkan Perangkat via Wi-Fi'));

  // Verify tab labels
  assert.ok(code.includes('Kode Pemasangan'));
  assert.ok(code.includes('Petunjuk Langkah'));

  // Verify inputs
  assert.ok(code.includes('Alamat IP'));
  assert.ok(code.includes('Port Pemasangan'));
  assert.ok(code.includes('Kode Pemasangan'));
  assert.ok(code.includes('Port Koneksi'));

  // Verify button labels
  assert.ok(code.includes('Batal'));
  assert.ok(code.includes('Pasangkan'));

  // Verify keyboard shortcuts handling
  assert.ok(code.includes("e.key === 'Escape'"));
  assert.ok(code.includes("e.key === 'Enter'"));

  // Verify guide contents
  assert.ok(code.includes('Pilihan Pengembang'));
  assert.ok(code.includes('Debugging Nirkabel'));
  assert.ok(code.includes('Pasangkan perangkat dengan kode pemasangan'));
});
