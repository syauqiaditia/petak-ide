/**
 * Pure logic for Flutter daemon and connection restart actions & run lifecycle state reset (Batch 5 - Feature A).
 */

export interface RunLifecycleState {
  state: 'stopped' | 'building' | 'installing' | 'running' | 'reloading' | 'error';
  uiState: 'idle' | 'starting' | 'running' | 'error';
  runId: number | null;
  pid: number | null;
}

export function resetRunLifecycle(): RunLifecycleState {
  return {
    state: 'stopped',
    uiState: 'idle',
    runId: null,
    pid: null,
  };
}

export function canPerformHotRestart(state: string, isReloading: boolean = false): boolean {
  return (state === 'running' || state === 'reloading') && !isReloading;
}

export function canPerformStop(state: string, uiState: string): boolean {
  return state !== 'stopped' || uiState !== 'idle';
}
