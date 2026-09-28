import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

export type { UnlistenFn };

export interface Entry {
  name: string;
  path: string;
  is_dir: boolean;
}

export interface FsChangedPayload {
  paths: string[];
}

export interface FileMatch {
  path: string;
  score: number;
  indices: number[];
}

export interface Hit {
  path: string;
  line: number;
  col: number;
  text: string;
}

export interface TermOutputPayload {
  id: number;
  data: string;
}

export interface TermExitPayload {
  id: number;
}

export interface LspPosition {
  line: number;
  character: number;
}

export interface LspRange {
  start: LspPosition;
  end: LspPosition;
}

export interface LspChange {
  range?: LspRange;
  text: string;
}

export interface LspDiagnostic {
  range: LspRange;
  severity?: 1 | 2 | 3 | 4; // 1: Error, 2: Warning, 3: Information, 4: Hint
  code?: number | string;
  source?: string;
  message: string;
  tags?: number[];
  relatedInformation?: Array<{
    location: { uri: string; range: LspRange };
    message: string;
  }>;
}

export interface LspDiagnosticsPayload {
  path: string;
  diagnostics: LspDiagnostic[];
}

export interface LspTextEdit {
  range: LspRange;
  newText: string;
}

export interface LspWorkspaceEdit {
  changes?: { [uri: string]: LspTextEdit[] };
  documentChanges?: Array<
    | {
        textDocument: { uri: string; version?: number };
        edits: LspTextEdit[];
      }
    | any
  >;
}

export interface LspLocation {
  uri: string;
  range: LspRange;
}

export interface LspLocationLink {
  targetUri: string;
  targetRange: LspRange;
  targetSelectionRange: LspRange;
  originSelectionRange?: LspRange;
}

export interface LspCompletionItem {
  label: string;
  kind?: number;
  detail?: string;
  documentation?: string | { kind: string; value: string };
  sortText?: string;
  filterText?: string;
  insertText?: string;
  insertTextFormat?: number; // 1: PlainText, 2: Snippet
  textEdit?: LspTextEdit | { range: LspRange; newText: string };
  additionalTextEdits?: LspTextEdit[];
  command?: any;
  data?: any;
}

export interface LspCompletionList {
  isIncomplete: boolean;
  items: LspCompletionItem[];
}

export interface LspHover {
  contents: string | { kind: string; value: string } | Array<string | { kind: string; value: string }>;
  range?: LspRange;
}

export interface LspCodeAction {
  title: string;
  kind?: string;
  diagnostics?: LspDiagnostic[];
  isPreferred?: boolean;
  disabled?: { reason: string };
  edit?: LspWorkspaceEdit;
  command?: {
    title: string;
    command: string;
    arguments?: any[];
  };
  data?: any;
}

export interface LspApplyEditPayload {
  id: any;
  edit: LspWorkspaceEdit;
}

export interface LspStatusPayload {
  lang: string;
  root: string;
  state: 'starting' | 'ready' | 'stopped' | 'crashed';
}

export const api = {
  listDir(path: string): Promise<Entry[]> {
    return invoke<Entry[]>('list_dir', { path });
  },

  readFile(path: string): Promise<string> {
    return invoke<string>('read_file', { path });
  },

  saveFile(path: string, content: string): Promise<void> {
    return invoke('save_file', { path, content });
  },

  watchRoot(root: string): Promise<void> {
    return invoke('watch_root', { root });
  },

  onFsChanged(cb: (payload: FsChangedPayload) => void): Promise<UnlistenFn> {
    return listen<FsChangedPayload>('fs-changed', (event) => cb(event.payload));
  },

  pickFolder(): Promise<string | null> {
    return invoke<string | null>('pick_folder');
  },

  gitBranch(root: string): Promise<string | null> {
    return invoke<string | null>('git_branch', { root });
  },

  recentFolders(): Promise<string[]> {
    return invoke<string[]>('recent_folders');
  },

  addRecentFolder(path: string): Promise<string[]> {
    return invoke<string[]>('add_recent_folder', { path });
  },

  markReady(tsMs: number): Promise<void> {
    return invoke('mark_ready', { tsMs });
  },

  benchLog(line: string): Promise<void> {
    return invoke('bench_log', { line });
  },

  benchMode(): Promise<boolean> {
    return invoke<boolean>('bench_mode');
  },

  testMode(): Promise<string | null> {
    return invoke<string | null>('test_mode');
  },

  indexBuild(root: string): Promise<void> {
    return invoke('index_build', { root });
  },

  findFiles(q: string, limit: number): Promise<FileMatch[]> {
    return invoke<FileMatch[]>('find_files', { q, limit });
  },

  grep(
    root: string,
    query: string,
    regex: boolean,
    caseSensitive: boolean,
    limit: number
  ): Promise<Hit[]> {
    return invoke<Hit[]>('grep', {
      root,
      query,
      regex,
      caseSensitive,
      limit,
    });
  },

  termOpen(cwd?: string | null, cols = 80, rows = 24): Promise<number> {
    return invoke<number>('term_open', { cwd: cwd ?? null, cols, rows });
  },

  termWrite(id: number, data: string): Promise<void> {
    return invoke('term_write', { id, data });
  },

  termResize(id: number, cols: number, rows: number): Promise<void> {
    return invoke('term_resize', { id, cols, rows });
  },

  termClose(id: number): Promise<void> {
    return invoke('term_close', { id });
  },

  onTermOutput(cb: (payload: TermOutputPayload) => void): Promise<UnlistenFn> {
    return listen<TermOutputPayload>('term-output', (event) => cb(event.payload));
  },

  onTermExit(cb: (payload: TermExitPayload) => void): Promise<UnlistenFn> {
    return listen<TermExitPayload>('term-exit', (event) => cb(event.payload));
  },

  resizeWindow(width: number, height: number): Promise<void> {
    return invoke('resize_window', { width, height });
  },

  lsp: {
    didOpen(path: string, text: string): Promise<void> {
      return invoke('lsp_did_open', { path, text });
    },

    didChange(path: string, version: number, changes: LspChange[]): Promise<void> {
      return invoke('lsp_did_change', { path, version, changes });
    },

    didSave(path: string, text: string): Promise<void> {
      return invoke('lsp_did_save', { path, text });
    },

    didClose(path: string): Promise<void> {
      return invoke('lsp_did_close', { path });
    },

    completion(
      path: string,
      line: number,
      character: number
    ): Promise<LspCompletionList | LspCompletionItem[] | null> {
      return invoke('lsp_completion', { path, line, character });
    },

    completionResolve(path: string, item: any): Promise<LspCompletionItem> {
      return invoke('lsp_completion_resolve', { path, item });
    },

    hover(path: string, line: number, character: number): Promise<LspHover | null> {
      return invoke('lsp_hover', { path, line, character });
    },

    definition(
      path: string,
      line: number,
      character: number
    ): Promise<LspLocation | LspLocation[] | LspLocationLink[] | null> {
      return invoke('lsp_definition', { path, line, character });
    },

    references(path: string, line: number, character: number): Promise<LspLocation[] | null> {
      return invoke('lsp_references', { path, line, character });
    },

    prepareRename(
      path: string,
      line: number,
      character: number
    ): Promise<LspRange | { range: LspRange; placeholder: string } | null> {
      return invoke('lsp_prepare_rename', { path, line, character });
    },

    rename(
      path: string,
      line: number,
      character: number,
      newName: string
    ): Promise<LspWorkspaceEdit | null> {
      return invoke('lsp_rename', { path, line, character, newName });
    },

    format(path: string): Promise<LspTextEdit[] | null> {
      return invoke('lsp_format', { path });
    },

    applyWorkspaceEditDisk(
      path: string,
      edits: Array<{
        start_line: number;
        start_character: number;
        end_line: number;
        end_character: number;
        new_text: string;
      }>
    ): Promise<void> {
      return invoke('lsp_apply_workspace_edit_disk', { path, edits });
    },

    codeActions(
      path: string,
      range: LspRange,
      diagnostics: LspDiagnostic[]
    ): Promise<Array<LspCodeAction | any> | null> {
      return invoke('lsp_code_actions', { path, range, diagnostics });
    },

    codeActionResolve(path: string, action: any): Promise<LspCodeAction> {
      return invoke('lsp_code_action_resolve', { path, action });
    },

    executeCommand(path: string, command: string, args?: any[]): Promise<any> {
      return invoke('lsp_execute_command', { path, command, arguments: args ?? null });
    },

    applyEditResult(id: any, applied: boolean): Promise<void> {
      return invoke('lsp_apply_edit_result', { id, applied });
    },
  },

  onLspDiagnostics(cb: (payload: LspDiagnosticsPayload) => void): Promise<UnlistenFn> {
    return listen<LspDiagnosticsPayload>('lsp-diagnostics', (event) => cb(event.payload));
  },

  onLspStatus(cb: (payload: LspStatusPayload) => void): Promise<UnlistenFn> {
    return listen<LspStatusPayload>('lsp-status', (event) => cb(event.payload));
  },

  onLspApplyEdit(cb: (payload: LspApplyEditPayload) => void): Promise<UnlistenFn> {
    return listen<LspApplyEditPayload>('lsp-apply-edit', (event) => cb(event.payload));
  },
};
