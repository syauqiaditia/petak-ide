/**
 * Pure Run state machine for Petak (B3).
 * States: idle | starting | running | error
 *
 * Rules from contract:
 * - idle: warna hijau, Stop disabled
 * - starting: warna kuning + spinner disabled, Stop aktif
 * - running: hijau solid + hot reload / hot restart, Stop aktif
 * - error: warna merah, Stop disabled
 * - Stop aktif HANYA saat proses jalan (starting atau running)
 * - Debug ikut aturan aktif / jalan
 */

export type RunUiState = 'idle' | 'starting' | 'running' | 'error';

export type RunAction =
  | 'START'
  | 'APP_STARTED'
  | 'ERROR'
  | 'STOP'
  | 'RESET';

export interface RunVisualAttrs {
  state: RunUiState;
  buttonColor: string;
  buttonBg: string;
  icon: 'play' | 'spinner' | 'retry';
  runDisabled: boolean;
  stopDisabled: boolean;
  debugDisabled: boolean;
  showHotReload: boolean;
  statusLabel: string;
}

export class RunStateMachine {
  private _state: RunUiState = 'idle';

  constructor(initialState: RunUiState = 'idle') {
    this._state = initialState;
  }

  get state(): RunUiState {
    return this._state;
  }

  transition(action: RunAction): RunUiState {
    this._state = reduceRunUiState(this._state, action);
    return this._state;
  }

  reset(): void {
    this._state = 'idle';
  }
}

export function reduceRunUiState(current: RunUiState, action: RunAction): RunUiState {
  switch (action) {
    case 'START':
      return 'starting';
    case 'APP_STARTED':
      return 'running';
    case 'ERROR':
      return 'error';
    case 'STOP':
    case 'RESET':
      return 'idle';
    default:
      return current;
  }
}

export function getRunVisualAttrs(
  state: RunUiState,
  isDeviceOnline: boolean = true,
  hasConfig: boolean = true
): RunVisualAttrs {
  const readyToRun = isDeviceOnline && hasConfig;

  switch (state) {
    case 'idle':
      return {
        state: 'idle',
        buttonColor: '#7fc98f', // Hijau
        buttonBg: '#1f3325',
        icon: 'play',
        runDisabled: !readyToRun,
        stopDisabled: true, // Stop disabled saat idle
        debugDisabled: !readyToRun,
        showHotReload: false,
        statusLabel: 'Idle',
      };

    case 'starting':
      return {
        state: 'starting',
        buttonColor: '#e8b45a', // Kuning
        buttonBg: '#362d1a',
        icon: 'spinner',
        runDisabled: true, // Spinner disabled saat starting
        stopDisabled: false, // Stop aktif saat proses jalan
        debugDisabled: true,
        showHotReload: false,
        statusLabel: 'Starting…',
      };

    case 'running':
      return {
        state: 'running',
        buttonColor: '#7fc98f', // Hijau solid
        buttonBg: '#1f3325',
        icon: 'play',
        runDisabled: true,
        stopDisabled: false, // Stop aktif saat proses jalan
        debugDisabled: false,
        showHotReload: true, // Hot reload & hot restart aktif
        statusLabel: 'Running',
      };

    case 'error':
      return {
        state: 'error',
        buttonColor: '#f07a74', // Merah
        buttonBg: '#361d1e',
        icon: 'retry',
        runDisabled: !readyToRun,
        stopDisabled: true, // Stop disabled saat error
        debugDisabled: !readyToRun,
        showHotReload: false,
        statusLabel: 'Error',
      };
  }
}
