/**
 * Zero-dependency QR Code SVG generator for ADB Wi-Fi pairing.
 * Implements ISO/IEC 18004 QR code standard in Byte mode (Versions 1-5, Level L)
 * with Reed-Solomon error correction and standard SVG output.
 */

// --- 1. Galois Field GF(256) Arithmetic ---
const EXP_TABLE = new Uint8Array(512);
const LOG_TABLE = new Uint8Array(256);

(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP_TABLE[i] = x;
    EXP_TABLE[i + 255] = x;
    LOG_TABLE[x] = i;
    x <<= 1;
    if (x & 256) {
      x ^= 0x11d; // 285 = x^8 + x^4 + x^3 + x^2 + 1
    }
  }
})();

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return EXP_TABLE[LOG_TABLE[a] + LOG_TABLE[b]];
}

// --- 2. Reed-Solomon Generator & Remainder ---
function rsGeneratorPoly(degree: number): Uint8Array {
  let poly = new Uint8Array([1]);
  for (let i = 0; i < degree; i++) {
    const nextPoly = new Uint8Array(poly.length + 1);
    for (let j = 0; j < poly.length; j++) {
      nextPoly[j] ^= poly[j];
      nextPoly[j + 1] ^= gfMul(poly[j], EXP_TABLE[i]);
    }
    poly = nextPoly;
  }
  return poly;
}

function rsRemainder(data: Uint8Array, numEcCodewords: number): Uint8Array {
  const gen = rsGeneratorPoly(numEcCodewords);
  const rem = new Uint8Array(numEcCodewords);
  for (let i = 0; i < data.length; i++) {
    const factor = data[i] ^ rem[0];
    for (let j = 0; j < numEcCodewords - 1; j++) {
      rem[j] = rem[j + 1] ^ gfMul(gen[j + 1], factor);
    }
    rem[numEcCodewords - 1] = gfMul(gen[numEcCodewords], factor);
  }
  return rem;
}

// --- 3. QR Version Specs (Versions 1-5, Error Correction Level L) ---
interface VersionSpec {
  size: number;
  totalCodewords: number;
  ecCodewords: number;
  dataCodewords: number;
  align: number[];
}

const VERSION_SPECS: Record<number, VersionSpec> = {
  1: { size: 21, totalCodewords: 26, ecCodewords: 7, dataCodewords: 19, align: [] },
  2: { size: 25, totalCodewords: 44, ecCodewords: 10, dataCodewords: 34, align: [18] },
  3: { size: 29, totalCodewords: 70, ecCodewords: 15, dataCodewords: 55, align: [22] },
  4: { size: 33, totalCodewords: 100, ecCodewords: 20, dataCodewords: 80, align: [26] },
  5: { size: 37, totalCodewords: 134, ecCodewords: 26, dataCodewords: 108, align: [30] },
};

function selectVersion(dataLength: number): number {
  // Byte mode overhead: 4 bits mode + 8 bits count = 12 bits -> 2 bytes.
  for (let v = 1; v <= 5; v++) {
    const spec = VERSION_SPECS[v];
    if (dataLength <= spec.dataCodewords - 2) {
      return v;
    }
  }
  return 5;
}

// Format info: BCH(15, 5) with generator 0x537 and mask 0x5412
function getFormatBits(ecLevelBits: number, mask: number): number {
  const data = (ecLevelBits << 3) | mask;
  let rem = data << 10;
  for (let i = 4; i >= 0; i--) {
    if ((rem >> (i + 10)) & 1) {
      rem ^= (0x537 << i);
    }
  }
  return ((data << 10) | rem) ^ 0x5412;
}

// 8 Standard QR mask functions
const MASK_PATTERNS: Array<(r: number, c: number) => boolean> = [
  (r, c) => (r + c) % 2 === 0,
  (r, _c) => r % 2 === 0,
  (_r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

function evaluatePenalty(matrix: Uint8Array[], size: number): number {
  let penalty = 0;

  // N1: Runs of 5+ same color in rows & cols
  for (let r = 0; r < size; r++) {
    let runColor = -1;
    let runLen = 0;
    for (let c = 0; c < size; c++) {
      const val = matrix[r][c];
      if (val === runColor) {
        runLen++;
      } else {
        if (runLen >= 5) penalty += 3 + (runLen - 5);
        runColor = val;
        runLen = 1;
      }
    }
    if (runLen >= 5) penalty += 3 + (runLen - 5);
  }

  for (let c = 0; c < size; c++) {
    let runColor = -1;
    let runLen = 0;
    for (let r = 0; r < size; r++) {
      const val = matrix[r][c];
      if (val === runColor) {
        runLen++;
      } else {
        if (runLen >= 5) penalty += 3 + (runLen - 5);
        runColor = val;
        runLen = 1;
      }
    }
    if (runLen >= 5) penalty += 3 + (runLen - 5);
  }

  // N2: 2x2 blocks of same color
  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const val = matrix[r][c];
      if (
        val === matrix[r + 1][c] &&
        val === matrix[r][c + 1] &&
        val === matrix[r + 1][c + 1]
      ) {
        penalty += 3;
      }
    }
  }

  // N3: 1:1:3:1:1 pattern
  for (let r = 0; r < size; r++) {
    for (let c = 0; c <= size - 11; c++) {
      let isPat1 = true;
      let isPat2 = true;
      const target1 = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
      const target2 = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
      for (let k = 0; k < 11; k++) {
        if (matrix[r][c + k] !== target1[k]) isPat1 = false;
        if (matrix[r][c + k] !== target2[k]) isPat2 = false;
      }
      if (isPat1 || isPat2) penalty += 40;
    }
  }

  for (let c = 0; c < size; c++) {
    for (let r = 0; r <= size - 11; r++) {
      let isPat1 = true;
      let isPat2 = true;
      const target1 = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
      const target2 = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
      for (let k = 0; k < 11; k++) {
        if (matrix[r + k][c] !== target1[k]) isPat1 = false;
        if (matrix[r + k][c] !== target2[k]) isPat2 = false;
      }
      if (isPat1 || isPat2) penalty += 40;
    }
  }

  // N4: Dark module ratio
  let dark = 0;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (matrix[r][c] === 1) dark++;
    }
  }
  const pct = (dark * 100) / (size * size);
  const step = Math.floor(Math.abs(pct - 50) / 5);
  penalty += step * 10;

  return penalty;
}

export interface QrEncodeResult {
  matrix: Uint8Array[];
  size: number;
  version: number;
  mask: number;
}

function encodeUtf8(str: string): Uint8Array {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(str);
  }
  const utf8: number[] = [];
  for (let i = 0; i < str.length; i++) {
    let charcode = str.charCodeAt(i);
    if (charcode < 0x80) utf8.push(charcode);
    else if (charcode < 0x800) {
      utf8.push(0xc0 | (charcode >> 6), 0x80 | (charcode & 0x3f));
    } else if (charcode < 0xd800 || charcode >= 0xe000) {
      utf8.push(0xe0 | (charcode >> 12), 0x80 | ((charcode >> 6) & 0x3f), 0x80 | (charcode & 0x3f));
    } else {
      i++;
      charcode = 0x10000 + (((charcode & 0x3ff) << 10) | (str.charCodeAt(i) & 0x3ff));
      utf8.push(
        0xf0 | (charcode >> 18),
        0x80 | ((charcode >> 12) & 0x3f),
        0x80 | ((charcode >> 6) & 0x3f),
        0x80 | (charcode & 0x3f)
      );
    }
  }
  return new Uint8Array(utf8);
}

export function encodeQr(text: string): QrEncodeResult {
  const bytes = encodeUtf8(text);

  const version = selectVersion(bytes.length);
  const spec = VERSION_SPECS[version];
  const size = spec.size;

  // 1. Bitstream
  const bits: number[] = [];
  function pushBits(val: number, len: number) {
    for (let i = len - 1; i >= 0; i--) {
      bits.push((val >> i) & 1);
    }
  }

  // Byte mode = 0100
  pushBits(4, 4);
  // Character count (8 bits for versions 1-9)
  pushBits(bytes.length, 8);
  // Data bytes
  for (let i = 0; i < bytes.length; i++) {
    pushBits(bytes[i], 8);
  }
  // Terminator: up to 4 zeros
  const maxBits = spec.dataCodewords * 8;
  const termLen = Math.min(4, maxBits - bits.length);
  pushBits(0, termLen);

  // Pad to multiple of 8
  while (bits.length % 8 !== 0) {
    bits.push(0);
  }

  // Pad codewords (0xEC, 0x11)
  const dataCodewords = new Uint8Array(spec.dataCodewords);
  for (let i = 0; i < bits.length / 8; i++) {
    let byte = 0;
    for (let b = 0; b < 8; b++) {
      byte = (byte << 1) | bits[i * 8 + b];
    }
    dataCodewords[i] = byte;
  }
  let padIdx = bits.length / 8;
  const padBytes = [0xec, 0x11];
  let p = 0;
  while (padIdx < spec.dataCodewords) {
    dataCodewords[padIdx++] = padBytes[p % 2];
    p++;
  }

  // 2. Error correction
  const ecCodewords = rsRemainder(dataCodewords, spec.ecCodewords);

  // Combine data + EC
  const allCodewords = new Uint8Array(spec.totalCodewords);
  allCodewords.set(dataCodewords, 0);
  allCodewords.set(ecCodewords, spec.dataCodewords);

  // 3. Grid setup
  const matrix = Array.from({ length: size }, () => new Uint8Array(size));
  const isFunction = Array.from({ length: size }, () => new Uint8Array(size));

  function setFunction(r: number, c: number, val: boolean) {
    matrix[r][c] = val ? 1 : 0;
    isFunction[r][c] = 1;
  }

  // Finder pattern
  function drawFinder(topR: number, leftC: number) {
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 7; c++) {
        const isBorder = (r === 0 || r === 6 || c === 0 || c === 6);
        const isCenter = (r >= 2 && r <= 4 && c >= 2 && c <= 4);
        setFunction(topR + r, leftC + c, isBorder || isCenter);
      }
    }
  }

  // 3 Finders
  drawFinder(0, 0);
  drawFinder(0, size - 7);
  drawFinder(size - 7, 0);

  // Separators around finders
  // Top-left
  for (let i = 0; i < 8; i++) {
    setFunction(7, i, false);
    setFunction(i, 7, false);
  }
  // Top-right
  for (let i = 0; i < 8; i++) {
    setFunction(7, size - 8 + i, false);
    setFunction(i, size - 8, false);
  }
  // Bottom-left
  for (let i = 0; i < 8; i++) {
    setFunction(size - 8, i, false);
    setFunction(size - 8 + i, 7, false);
  }

  // Alignment patterns (for V >= 2)
  for (const pos of spec.align) {
    for (let r = -2; r <= 2; r++) {
      for (let c = -2; c <= 2; c++) {
        const isBorder = (Math.abs(r) === 2 || Math.abs(c) === 2);
        const isDot = (r === 0 && c === 0);
        setFunction(pos + r, pos + c, isBorder || isDot);
      }
    }
  }

  // Timing patterns
  for (let i = 8; i < size - 8; i++) {
    if (!isFunction[6][i]) setFunction(6, i, i % 2 === 0);
    if (!isFunction[i][6]) setFunction(i, 6, i % 2 === 0);
  }

  // Dark module at (size - 8, 8)
  setFunction(size - 8, 8, true);

  // Reserve format info modules
  for (let i = 0; i <= 8; i++) {
    if (i !== 6) isFunction[8][i] = 1;
    if (i !== 6) isFunction[i][8] = 1;
  }
  for (let i = 0; i < 8; i++) {
    isFunction[size - 1 - i][8] = 1;
    isFunction[8][size - 8 + i] = 1;
  }

  // 4. Zig-zag data placement
  const allBits: number[] = [];
  for (let i = 0; i < allCodewords.length; i++) {
    for (let b = 7; b >= 0; b--) {
      allBits.push((allCodewords[i] >> b) & 1);
    }
  }

  let bitIdx = 0;
  let goingUp = true;
  for (let rightCol = size - 1; rightCol > 0; rightCol -= 2) {
    if (rightCol === 6) rightCol--; // Skip vertical timing column
    const rows = goingUp
      ? Array.from({ length: size }, (_, k) => size - 1 - k)
      : Array.from({ length: size }, (_, k) => k);

    for (const r of rows) {
      for (const c of [rightCol, rightCol - 1]) {
        if (!isFunction[r][c]) {
          matrix[r][c] = bitIdx < allBits.length ? allBits[bitIdx++] : 0;
        }
      }
    }
    goingUp = !goingUp;
  }

  // 5. Evaluate 8 masks and pick the lowest penalty
  let bestMask = 0;
  let lowestPenalty = Infinity;
  let bestMatrix: Uint8Array[] = matrix;

  for (let mask = 0; mask < 8; mask++) {
    const candidate = matrix.map(row => new Uint8Array(row));
    const maskFn = MASK_PATTERNS[mask];

    // Apply mask to data modules
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (!isFunction[r][c]) {
          if (maskFn(r, c)) {
            candidate[r][c] ^= 1;
          }
        }
      }
    }

    // Write format bits (Level L = 01)
    const fmt = getFormatBits(1, mask);
    const getBit = (val: number, bit: number) => (val >> bit) & 1;

    // Top-left
    for (let i = 0; i <= 5; i++) candidate[8][i] = getBit(fmt, i);
    candidate[8][7] = getBit(fmt, 6);
    candidate[8][8] = getBit(fmt, 7);
    candidate[7][8] = getBit(fmt, 8);
    for (let i = 9; i < 15; i++) candidate[14 - i][8] = getBit(fmt, i);

    // Split bottom-left and top-right
    for (let i = 0; i < 7; i++) candidate[size - 1 - i][8] = getBit(fmt, i);
    for (let i = 7; i < 15; i++) candidate[8][size - 15 + i] = getBit(fmt, i);

    // Evaluate penalty
    const penalty = evaluatePenalty(candidate, size);
    if (penalty < lowestPenalty) {
      lowestPenalty = penalty;
      bestMask = mask;
      bestMatrix = candidate;
    }
  }

  return { matrix: bestMatrix, size, version, mask: bestMask };
}

// --- Public API ---

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
 * - password: 16 random alphanumeric characters.
 */
export function generateAdbPairingCredentials(): { serviceName: string; password: string } {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const passChars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

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
  const password = getRandomString(16, passChars);
  return { serviceName, password };
}

export interface QrSvgOptions {
  size?: number;
  margin?: number;
  fg?: string;
  bg?: string;
}

/**
 * Generates valid SVG XML string for a QR code.
 */
export function generateQrSvg(text: string, options?: QrSvgOptions): string {
  const size = options?.size ?? 256;
  const margin = options?.margin ?? 2;
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
