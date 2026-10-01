/**
 * Wi-Fi Pairing & Connection Logic for Android 11+ Wireless Debugging
 */

export function validateIp(ip: string | undefined | null): boolean {
  if (!ip || typeof ip !== 'string') return false;
  const trimmed = ip.trim();
  const parts = trimmed.split('.');
  if (parts.length !== 4) return false;
  return parts.every((p) => {
    if (!/^\d{1,3}$/.test(p)) return false;
    const num = Number(p);
    return num >= 0 && num <= 255;
  });
}

export function validatePort(port: number | string | undefined | null): boolean {
  if (port === undefined || port === null || port === '') return false;
  const str = String(port).trim();
  if (!/^\d+$/.test(str)) return false;
  const num = Number(str);
  return Number.isInteger(num) && num >= 1 && num <= 65535;
}

export function validatePairingCode(code: string | undefined | null): boolean {
  if (!code || typeof code !== 'string') return false;
  const trimmed = code.trim();
  return /^\d{6}$/.test(trimmed);
}

export function resolveConnectPort(
  pairingPort: number | string | undefined | null,
  connectPort?: number | string | null
): number {
  if (connectPort !== undefined && connectPort !== null) {
    const str = String(connectPort).trim();
    if (str !== '' && validatePort(str)) {
      return Number(str);
    }
  }
  if (validatePort(pairingPort)) {
    return Number(String(pairingPort).trim());
  }
  return 5555;
}

export interface PairingFormData {
  ip: string;
  pairingPort: number | string;
  pairingCode: string;
  connectPort?: number | string | null;
}

export interface FormValidationResult {
  valid: boolean;
  errors: {
    ip?: string;
    pairingPort?: string;
    pairingCode?: string;
    connectPort?: string;
  };
}

export function validatePairingForm(data: PairingFormData): FormValidationResult {
  const errors: FormValidationResult['errors'] = {};

  if (!validateIp(data.ip)) {
    errors.ip = 'Alamat IP tidak valid (contoh: 192.168.1.50)';
  }
  if (!validatePort(data.pairingPort)) {
    errors.pairingPort = 'Port pemasangan harus angka 1 - 65535';
  }
  if (!validatePairingCode(data.pairingCode)) {
    errors.pairingCode = 'Kode pemasangan harus 6 digit angka';
  }
  if (data.connectPort !== undefined && data.connectPort !== null && String(data.connectPort).trim() !== '') {
    if (!validatePort(data.connectPort)) {
      errors.connectPort = 'Port koneksi harus angka 1 - 65535';
    }
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
  };
}

export interface PairAndConnectParams {
  host: string;
  pairingPort: number | string;
  pairingCode: string;
  connectPort?: number | string | null;
  apiClient?: {
    adbPair: (host: string, port: number, code: string) => Promise<string>;
    adbConnect: (host: string, port: number) => Promise<string>;
  };
}

export interface PairAndConnectResult {
  success: boolean;
  pairOutput: string;
  connectOutput: string;
  effectiveConnectPort: number;
}

export async function executePairAndConnect(
  params: PairAndConnectParams
): Promise<PairAndConnectResult> {
  const host = params.host.trim();
  if (!validateIp(host)) {
    throw new Error(`Alamat IP tidak valid: "${params.host}"`);
  }

  if (!validatePort(params.pairingPort)) {
    throw new Error(`Port pemasangan tidak valid: "${params.pairingPort}"`);
  }
  const pairingPortNum = Number(String(params.pairingPort).trim());

  const code = params.pairingCode.trim();
  if (!validatePairingCode(code)) {
    throw new Error(`Kode pemasangan harus 6 digit angka: "${params.pairingCode}"`);
  }

  const effectiveConnectPort = resolveConnectPort(pairingPortNum, params.connectPort);

  const client = params.apiClient || (await import('../../lib/api')).api;

  const pairOutput = await client.adbPair(host, pairingPortNum, code);
  if (typeof pairOutput === 'string' && /failed|error/i.test(pairOutput)) {
    throw new Error(pairOutput);
  }

  const connectOutput = await client.adbConnect(host, effectiveConnectPort);
  if (
    typeof connectOutput === 'string' &&
    /failed|error/i.test(connectOutput) &&
    !/already connected/i.test(connectOutput)
  ) {
    throw new Error(connectOutput);
  }

  return {
    success: true,
    pairOutput,
    connectOutput,
    effectiveConnectPort,
  };
}
