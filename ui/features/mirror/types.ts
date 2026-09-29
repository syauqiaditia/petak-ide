export type MirrorUiState =
  | 'empty'
  | 'connecting'
  | 'live'
  | 'disconnected'
  | 'error'
  | 'view-only';

export type MirrorStatus =
  | { state: 'Connecting' }
  | { state: 'Live'; width: number; height: number }
  | { state: 'Rotated'; width: number; height: number }
  | { state: 'Disconnected'; reason?: string }
  | { state: 'Error'; message: string };

export type TouchAction = 'down' | 'move' | 'up';
export type KeyAction = 'down' | 'up';
export type NavKey = 'back' | 'home' | 'recents' | 'power' | 'volup' | 'voldown';

export type InputEvent =
  | { t: 'touch'; action: TouchAction; x: number; y: number; w: number; h: number }
  | { t: 'scroll'; x: number; y: number; w: number; h: number; dx: number; dy: number }
  | { t: 'key'; keycode: number; action: KeyAction }
  | { t: 'text'; text: string }
  | { t: 'nav'; key: NavKey }
  | { t: 'rotate' };

export interface MirrorInfo {
  serial: string;
  name: string;
  width: number;
  height: number;
  codec: string;
}

export interface ParsedPacket {
  kind: number; // 0=config (SPS+PPS Annex-B), 1=key, 2=delta
  ptsUs: bigint;
  payload: Uint8Array;
}

export interface ViewportFit {
  screenWidth: number;
  screenHeight: number;
  bezelWidth: number;
  bezelHeight: number;
  scale: number;
}
