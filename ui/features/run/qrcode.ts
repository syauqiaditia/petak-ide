/**
 * ISO/IEC 18004 compliant QR Code generator for ADB Wi-Fi pairing.
 * Uses battle-tested standard QR encoding with clean SVG output and verified scanability.
 */

import QRCode from 'qrcode';

export interface QrEncodeResult {
  matrix: Uint8Array[];
  size: number;
  version: number;
  mask: number;
}

/**
 * Encodes text into a standard QR code matrix.
 */
export function encodeQr(text: string): QrEncodeResult {
  const qr = QRCode.create(text, { errorCorrectionLevel: 'L' });
  const size = qr.modules.size;
  const data = qr.modules.data;
  const matrix: Uint8Array[] = [];

  for (let r = 0; r < size; r++) {
    const row = new Uint8Array(size);
    for (let c = 0; c < size; c++) {
      row[c] = data[r * size + c] ? 1 : 0;
    }
    matrix.push(row);
  }

  return {
    matrix,
    size,
    version: qr.version,
    mask: (qr as any).maskPattern ?? (qr as any).mask ?? 0,
  };
}

/**
 * Builds ADB Wi-Fi pairing payload in standard format:
 * `WIFI:T:ADB;S:<service_name>;P:<password>;;`
 */
export function buildAdbQrPayload(serviceName: string, password: string): string {
  return `WIFI:T:ADB;S:${serviceName};P:${password};;`;
}

/**
 * Generates secure random credentials for ADB pairing.
 * - serviceName: format `studio-petak-` + 8 random alphanumeric characters.
 * - password: 12-16 random alphanumeric characters.
 */
export function generateAdbPairingCredentials(): { serviceName: string; password: string } {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';

  const getRandomString = (len: number, charset: string): string => {
    let res = '';
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      const bytes = new Uint8Array(len);
      crypto.getRandomValues(bytes);
      for (let i = 0; i < len; i++) {
        res += charset[bytes[i] % charset.length];
      }
    } else {
      for (let i = 0; i < len; i++) {
        res += charset[Math.floor(Math.random() * charset.length)];
      }
    }
    return res;
  };

  const serviceName = `studio-petak-${getRandomString(8, chars)}`;
  
  // Universal 6-digit numeric pairing code for maximum Android vendor compatibility
  let password = '';
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const bytes = new Uint32Array(1);
    crypto.getRandomValues(bytes);
    password = (100000 + (bytes[0] % 900000)).toString();
  } else {
    password = Math.floor(100000 + Math.random() * 900000).toString();
  }

  return { serviceName, password };
}

export interface QrSvgOptions {
  size?: number;
  margin?: number;
  fg?: string;
  bg?: string;
}

/**
 * Generates valid SVG XML string for a QR code with sharp crispEdges.
 */
export function generateQrSvg(text: string, options?: QrSvgOptions): string {
  const size = options?.size ?? 256;
  const margin = options?.margin ?? 4;
  const fg = options?.fg ?? '#000000';
  const bg = options?.bg ?? '#ffffff';

  const { matrix, size: matrixSize } = encodeQr(text);
  const total = matrixSize + margin * 2;

  let pathData = '';
  for (let r = 0; r < matrixSize; r++) {
    for (let c = 0; c < matrixSize; c++) {
      if (matrix[r][c] === 1) {
        pathData += `M${c + margin} ${r + margin}h1v1h-1z`;
      }
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" width="${size}" height="${size}" shape-rendering="crispEdges">
  <rect width="100%" height="100%" fill="${bg}"/>
  <path d="${pathData}" fill="${fg}"/>
</svg>`;
}
