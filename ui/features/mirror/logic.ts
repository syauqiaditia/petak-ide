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
