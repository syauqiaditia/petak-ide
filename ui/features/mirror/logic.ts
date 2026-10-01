import type { MirrorUiState, ParsedPacket, ViewportFit } from './types';

/**
 * Parses binary frame packet according to contract:
 * [u8 kind: 0=config(SPS+PPS Annex-B), 1=key, 2=delta][u64 pts_us][payload Annex-B bytes]
 */
export function parseFramePacket(data: Uint8Array | ArrayBuffer): ParsedPacket {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (bytes.length < 9) {
    throw new Error(`Packet too short: ${bytes.length} bytes (minimum 9 required)`);
  }

  const kind = bytes[0];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ptsUs = view.getBigUint64(1, false); // big-endian
  const payload = bytes.subarray(9);

  return { kind, ptsUs, payload };
}

/**
 * Translates canvas client coordinates into bounded device integer pixels.
 */
export function translateCanvasToDevice(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
  deviceWidth: number,
  deviceHeight: number
): { x: number; y: number; w: number; h: number } {
  if (rect.width <= 0 || rect.height <= 0) {
    return { x: 0, y: 0, w: deviceWidth, h: deviceHeight };
  }

  const scaleX = deviceWidth / rect.width;
  const scaleY = deviceHeight / rect.height;

  const rawX = (clientX - rect.left) * scaleX;
  const rawY = (clientY - rect.top) * scaleY;

  const x = Math.max(0, Math.min(deviceWidth - 1, Math.round(rawX)));
  const y = Math.max(0, Math.min(deviceHeight - 1, Math.round(rawY)));

  return { x, y, w: deviceWidth, h: deviceHeight };
}

/**
 * Calculates responsive phone bezel and screen scaling preserving device aspect ratio.
 */
export function calculateViewportFit(
  stageWidth: number,
  stageHeight: number,
  deviceWidth: number,
  deviceHeight: number,
  bezelPaddingX = 20,
  bezelPaddingY = 24
): ViewportFit {
  const availW = Math.max(80, stageWidth - bezelPaddingX);
  const availH = Math.max(80, stageHeight - bezelPaddingY);
  const deviceRatio = deviceWidth / deviceHeight;

  let screenW = availW;
  let screenH = availW / deviceRatio;

  if (screenH > availH) {
    screenH = availH;
    screenW = availH * deviceRatio;
  }

  return {
    screenWidth: Math.round(screenW),
    screenHeight: Math.round(screenH),
    bezelWidth: Math.round(screenW + bezelPaddingX),
    bezelHeight: Math.round(screenH + bezelPaddingY),
    scale: screenW / deviceWidth,
  };
}

/**
 * Clamps mirror panel dock width between min and max bounds (default: 300..600px).
 */
export function clampPanelWidth(width: number, min = 300, max = 600): number {
  return Math.max(min, Math.min(max, Math.round(width)));
}

/**
 * Calculates genuine frames per second from sliding timestamp window.
 */
export function calcFps(timestamps: number[], now: number, windowMs = 1000): number {
  const threshold = now - windowMs;
  let count = 0;
  for (let i = timestamps.length - 1; i >= 0; i--) {
    if (timestamps[i] >= threshold) {
      count++;
    } else {
      break;
    }
  }
  return Math.round((count * 1000) / windowMs);
}

/**
 * Calculates latency in milliseconds from input dispatch to next frame rendered.
 */
export function calcLatency(
  inputTimestamp: number | null,
  renderTimestamp: number
): number | null {
  if (inputTimestamp === null) return null;
  if (renderTimestamp < inputTimestamp) return null;
  return Math.round(renderTimestamp - inputTimestamp);
}

/**
 * State machine for the 6 lifecycle states of the Device Mirror panel.
 */
export function mirrorStateMachine(
  currentState: MirrorUiState,
  event: { type: string; payload?: any }
): MirrorUiState {
  switch (event.type) {
    case 'SHOW_PICKER':
      return 'picker';

    case 'START':
    case 'RECONNECT':
    case 'RETRY':
      return 'connecting';

    case 'STREAM_LIVE':
      return 'live';

    case 'STREAM_VIEW_ONLY':
      return 'view-only';

    case 'DISCONNECTED':
      return 'disconnected';

    case 'ERROR':
      return 'error';

    case 'RESET':
    case 'STOP':
      return 'empty';

    default:
      return currentState;
  }
}


/**
 * Splits Annex-B stream into individual NAL units by 0x000001 or 0x00000001 start codes.
 */
export function splitNals(data: Uint8Array): Uint8Array[] {
  const nals: Uint8Array[] = [];
  const len = data.length;
  let i = 0;
  const scPositions: Array<{ pos: number; scLen: number }> = [];

  while (i + 2 < len) {
    if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 1) {
      if (i > 0 && data[i - 1] === 0) {
        scPositions.push({ pos: i - 1, scLen: 4 });
      } else {
        scPositions.push({ pos: i, scLen: 3 });
      }
      i += 3;
    } else {
      i++;
    }
  }

  for (let idx = 0; idx < scPositions.length; idx++) {
    const nalStart = scPositions[idx].pos + scPositions[idx].scLen;
    const nalEnd = idx + 1 < scPositions.length ? scPositions[idx + 1].pos : len;
    if (nalStart < nalEnd) {
      nals.push(data.subarray(nalStart, nalEnd));
    }
  }

  return nals;
}

/**
 * Parses H.264 SPS and PPS NALs to extract dynamic codec string (e.g. 'avc1.640020')
 * and build AVCDecoderConfigurationRecord (avcC) format required by WebCodecs.
 */
export function parseH264Config(nals: Uint8Array[]): { codec: string; description: Uint8Array } {
  const spsList: Uint8Array[] = [];
  const ppsList: Uint8Array[] = [];
  let codec = 'avc1.42001f';

  for (const nal of nals) {
    if (nal.length === 0) continue;
    const nalType = nal[0] & 0x1f;
    if (nalType === 7 && nal.length >= 4) {
      codec = `avc1.${nal[1].toString(16).padStart(2, '0')}${nal[2].toString(16).padStart(2, '0')}${nal[3].toString(16).padStart(2, '0')}`;
      spsList.push(nal);
    } else if (nalType === 8) {
      ppsList.push(nal);
    }
  }

  if (spsList.length === 0) {
    return { codec, description: new Uint8Array(0) };
  }

  const sps = spsList[0];
  const out: number[] = [
    1, // configurationVersion
    sps[1], // AVCProfileIndication
    sps[2], // profile_compatibility
    sps[3], // AVCLevelIndication
    0xff, // lengthSizeMinusOneWithReserved (6 bits 1s, 2 bits lengthSizeMinusOne=3 -> 4 bytes)
    0xe0 | (spsList.length & 0x1f), // numOfSequenceParameterSetsWithReserved
  ];

  for (const s of spsList) {
    out.push((s.length >> 8) & 0xff);
    out.push(s.length & 0xff);
    for (let j = 0; j < s.length; j++) out.push(s[j]);
  }

  out.push(ppsList.length & 0xff);
  for (const p of ppsList) {
    out.push((p.length >> 8) & 0xff);
    out.push(p.length & 0xff);
    for (let j = 0; j < p.length; j++) out.push(p[j]);
  }

  return { codec, description: new Uint8Array(out) };
}

/**
 * Converts Annex-B NAL stream to AVCC format (4-byte big-endian length prefix).
 */
export function nalsToAvcc(data: Uint8Array): Uint8Array {
  const nals = splitNals(data);
  if (nals.length === 0) return data;
  let totalLen = 0;
  for (const nal of nals) totalLen += 4 + nal.length;
  const out = new Uint8Array(totalLen);
  let offset = 0;
  for (const nal of nals) {
    const len = nal.length;
    out[offset] = (len >> 24) & 0xff;
    out[offset + 1] = (len >> 16) & 0xff;
    out[offset + 2] = (len >> 8) & 0xff;
    out[offset + 3] = len & 0xff;
    out.set(nal, offset + 4);
    offset += 4 + len;
  }
  return out;
}
