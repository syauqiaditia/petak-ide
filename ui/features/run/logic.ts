import type { AppState, OutputStream, BuildError, RunEvent } from '../../lib/api';

export interface OutputItem {
  id: number;
  stream: OutputStream;
  line: string;
}

export interface RunLogicState {
  state: AppState;
  runId: number | null;
  appId: string | null;
  devtoolsUri: string | null;
  vmServiceUri: string | null;
  pid: number | null;
  lastReloadMs: number | null;
  lastReloadOk: boolean | null;
  buildErrors: BuildError[];
  outputLines: OutputItem[];
}

export function initialRunLogicState(): RunLogicState {
  return {
    state: 'stopped',
    runId: null,
    appId: null,
    devtoolsUri: null,
    vmServiceUri: null,
    pid: null,
    lastReloadMs: null,
    lastReloadOk: null,
    buildErrors: [],
    outputLines: [],
  };
}

let outputCounter = 1;

export function reduceRunEvent(
  state: RunLogicState,
  event: RunEvent,
  maxOutputLines: number = 5000
): RunLogicState {
  switch (event.type) {
    case 'state':
      return {
        ...state,
        state: event.state,
      };

    case 'appStarted':
      return {
        ...state,
        state: 'running',
        appId: event.appId ?? state.appId,
        devtoolsUri: event.devtoolsUri ?? state.devtoolsUri,
        vmServiceUri: event.vmServiceUri ?? state.vmServiceUri,
        pid: event.pid ?? state.pid,
      };

    case 'progress':
      return state;

    case 'reloaded':
      return {
        ...state,
        state: 'running',
        lastReloadMs: event.ms,
        lastReloadOk: event.ok,
      };

    case 'buildError': {
      const newErr: BuildError = {
        file: event.file,
        line: event.line,
        col: event.col ?? null,
        message: event.message,
      };
      return {
        ...state,
        buildErrors: [...state.buildErrors, newErr],
      };
    }

    case 'stopped':
      return {
        ...state,
        state: 'stopped',
        runId: null,
        pid: null,
      };

    case 'output': {
      const item: OutputItem = {
        id: outputCounter++,
        stream: event.stream,
        line: event.line,
      };
      let lines = [...state.outputLines, item];
      if (lines.length > maxOutputLines) {
        lines = lines.slice(lines.length - maxOutputLines);
      }
      return {
        ...state,
        outputLines: lines,
      };
    }

    default:
      return state;
  }
}

export interface BuildErrorLink {
  file: string;
  line: number;
  col: number | null;
  label: string;
  filename: string;
}

export function mapBuildErrorToLink(err: BuildError): BuildErrorLink {
  const normFile = err.file.replace(/\\/g, '/');
  const filename = normFile.split('/').pop() || normFile;
  const colPart = err.col !== null && err.col !== undefined && err.col > 0 ? `:${err.col}` : '';
  const label = `${filename}:${err.line}${colPart}`;
  return {
    file: err.file,
    line: err.line,
    col: err.col ?? null,
    label,
    filename,
  };
}

export function parseBuildErrorLine(line: string): BuildError | null {
  // Dart pattern: lib/main.dart:42:10: Error: Message
  const dartMatch = line.match(/^([a-zA-Z0-9_./-]+\.dart):(\d+):(\d+):\s*(?:Error|Warning)?:\s*(.+)$/);
  if (dartMatch) {
    return {
      file: dartMatch[1],
      line: parseInt(dartMatch[2], 10),
      col: parseInt(dartMatch[3], 10),
      message: dartMatch[4].trim(),
    };
  }

  // Kotlin pattern: e: /path/to/File.kt:15:4 Unresolved reference: foo
  const ktMatch = line.match(/^(?:e:\s+)?([a-zA-Z0-9_./-]+\.kts?):(\d+):(\d+)(?:\s+(.+))?$/);
  if (ktMatch) {
    return {
      file: ktMatch[1],
      line: parseInt(ktMatch[2], 10),
      col: parseInt(ktMatch[3], 10),
      message: (ktMatch[4] || 'Compilation error').trim(),
    };
  }

  // Swift pattern: /path/to/File.swift:20:5: error: message
  const swiftMatch = line.match(/^([a-zA-Z0-9_./-]+\.swift):(\d+):(\d+):\s*(?:error|warning)?:\s*(.+)$/);
  if (swiftMatch) {
    return {
      file: swiftMatch[1],
      line: parseInt(swiftMatch[2], 10),
      col: parseInt(swiftMatch[3], 10),
      message: swiftMatch[4].trim(),
    };
  }

  return null;
}

export function formatAppState(state: AppState): { label: string; color: string; dotColor: string } {
  switch (state) {
    case 'building':
      return { label: 'Building...', color: '#e8b45a', dotColor: '#e8b45a' };
    case 'installing':
      return { label: 'Installing...', color: '#e8b45a', dotColor: '#e8b45a' };
    case 'running':
      return { label: 'Running', color: '#7fc98f', dotColor: '#7fc98f' };
    case 'reloading':
      return { label: 'Reloading...', color: '#6ea8ff', dotColor: '#6ea8ff' };
    case 'stopped':
    default:
      return { label: 'Ready', color: '#8b8f98', dotColor: '#8b8f98' };
  }
}
