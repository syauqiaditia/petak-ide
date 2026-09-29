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

// -----------------------------------------------------------------------------
// Run, Toolchain, Device, Logcat Types
// -----------------------------------------------------------------------------

export interface Tool {
  path: string;
  version?: string | null;
}

export interface Toolchain {
  flutter?: Tool | null;
  dart?: Tool | null;
  fvm: boolean;
  androidHome?: string | null;
  adb?: Tool | null;
  emulator?: Tool | null;
  java?: Tool | null;
  xcrun?: Tool | null;
}

export type DevicePlatform = 'android' | 'ios' | 'web' | 'desktop';
export type DeviceKind = 'physical' | 'emulator' | 'simulator';
export type DeviceState = 'online' | 'offline' | 'unauthorized' | 'booting';

export interface Device {
  id: string;
  name: string;
  platform: DevicePlatform;
  kind: DeviceKind;
  state: DeviceState;
  sdk?: string | null;
}

export interface Avd {
  name: string;
}

export type RunKind = 'flutter' | 'gradle';

export interface RunConfig {
  name: string;
  kind: RunKind;
  target?: string | null;
  flavor?: string | null;
  dartDefines?: string[];
  module?: string | null;
  variant?: string | null;
  applicationId?: string | null;
  activity?: string | null;
}

export interface RunConfigFile {
  selected: string;
  configs: RunConfig[];
}

export interface LocalHistoryEntry {
  id: string;
  path: string;
  ts_ms: number;
  blob: string;
  kind: string;
  label?: string | null;
}

export type AppState = 'building' | 'installing' | 'running' | 'reloading' | 'stopped';
export type OutputStream = 'stdout' | 'stderr';

export interface BuildError {
  file: string;
  line: number;
  col?: number | null;
  message: string;
}

export interface ReloadResult {
  fullRestart: boolean;
  ok: boolean;
  ms: number;
  message?: string | null;
}

export type RunEvent =
  | { type: 'state'; state: AppState }
  | { type: 'output'; stream: OutputStream; line: string }
  | {
      type: 'appStarted';
      appId?: string | null;
      devtoolsUri?: string | null;
      vmServiceUri?: string | null;
      pid?: number | null;
    }
  | { type: 'progress'; id: string; message: string; finished: boolean }
  | {
      type: 'reloaded';
      fullRestart: boolean;
      ok: boolean;
      ms: number;
      message?: string | null;
    }
  | {
      type: 'buildError';
      file: string;
      line: number;
      col?: number | null;
      message: string;
    }
  | { type: 'stopped'; code?: number | null };

export interface RunEventPayload {
  runId: number;
  event: RunEvent;
}

export type LogLevel = 'V' | 'D' | 'I' | 'W' | 'E' | 'F';

export interface LogLine {
  ts: string;
  pid: number;
  tid: number;
  level: LogLevel;
  tag: string;
  msg: string;
}

export interface StackLink {
  file: string;
  line: number;
  col?: number | null;
}

export interface GradleDaemonPayload {
  running: boolean;
}

import type {
  GitRepoStatus,
  GitDiffOpts,
  GitDiffFile,
  GitLogFilter,
  GitLogPage,
  GitBranchList,
  GitCommitFile,
  GitRebaseItem,
  GitRebasePlan,
  GitOpResult,
  GitRebaseState,
  GitOpState,
  GitResetMode,
  GitBackupRef,
  GitConflictFile,
  GitConflictChoice,
  GitRemote,
  GitPullMode,
  GitCommit,
  GitBlameLine,
} from '../features/git/types';
export * from '../features/git/types';

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

  gitStatus(root: string): Promise<GitRepoStatus> {
    return invoke<GitRepoStatus>('git_status', { root });
  },

  gitDiff(root: string, opts: GitDiffOpts): Promise<GitDiffFile[]> {
    return invoke<GitDiffFile[]>('git_diff', {
      root,
      kind: opts.kind,
      sha: opts.sha ?? null,
      path: opts.path ?? null,
      ignoreWs: opts.ignoreWs ?? false,
    });
  },

  gitStageFiles(root: string, paths: string[]): Promise<void> {
    return invoke('git_stage_files', { root, paths });
  },

  gitUnstageFiles(root: string, paths: string[]): Promise<void> {
    return invoke('git_unstage_files', { root, paths });
  },

  gitStageHunk(root: string, path: string, hunkIndex: number): Promise<void> {
    return invoke('git_stage_hunk', { root, path, hunkIndex });
  },

  gitUnstageHunk(root: string, path: string, hunkIndex: number): Promise<void> {
    return invoke('git_unstage_hunk', { root, path, hunkIndex });
  },

  gitCommit(root: string, message: string, amend = false): Promise<string> {
    return invoke<string>('git_commit', { root, message, amend });
  },

  gitLastMessage(root: string): Promise<string | null> {
    return invoke<string | null>('git_last_message', { root });
  },

  gitLog(
    root: string,
    filter?: GitLogFilter,
    cursor?: number,
    limit?: number
  ): Promise<GitLogPage> {
    return invoke<GitLogPage>('git_log', {
      root,
      filter: filter ?? null,
      cursor: cursor ?? null,
      limit: limit ?? null,
    });
  },

  gitBranches(root: string): Promise<GitBranchList> {
    return invoke<GitBranchList>('git_branches', { root });
  },

  gitCommitFiles(root: string, sha: string): Promise<GitCommitFile[]> {
    return invoke<GitCommitFile[]>('git_commit_files', { root, sha });
  },

  gitRebaseTodo(root: string, base: string): Promise<GitRebaseItem[]> {
    return invoke<GitRebaseItem[]>('git_rebase_todo', { root, base });
  },

  gitRebaseRun(root: string, plan: GitRebasePlan): Promise<GitOpResult> {
    return invoke<GitOpResult>('git_rebase_run', { root, plan });
  },

  gitRebaseContinue(root: string): Promise<GitOpResult> {
    return invoke<GitOpResult>('git_rebase_continue', { root });
  },

  gitRebaseAbort(root: string): Promise<void> {
    return invoke('git_rebase_abort', { root });
  },

  gitRebaseState(root: string): Promise<GitRebaseState> {
    return invoke<GitRebaseState>('git_rebase_state', { root });
  },

  gitReword(root: string, sha: string, message: string): Promise<GitOpResult> {
    return invoke<GitOpResult>('git_reword', { root, sha, message });
  },

  gitSquash(root: string, shas: string[], message: string): Promise<GitOpResult> {
    return invoke<GitOpResult>('git_squash', { root, shas, message });
  },

  gitFixup(root: string, sha: string): Promise<GitOpResult> {
    return invoke<GitOpResult>('git_fixup', { root, sha });
  },

  gitDrop(root: string, shas: string[]): Promise<GitOpResult> {
    return invoke<GitOpResult>('git_drop', { root, shas });
  },

  gitReset(root: string, sha: string, mode: GitResetMode): Promise<GitOpResult> {
    return invoke<GitOpResult>('git_reset', { root, sha, mode });
  },

  gitCherryPick(root: string, shas: string[]): Promise<GitOpResult> {
    return invoke<GitOpResult>('git_cherry_pick', { root, shas });
  },

  gitRevert(root: string, shas: string[]): Promise<GitOpResult> {
    return invoke<GitOpResult>('git_revert', { root, shas });
  },

  gitMerge(root: string, branch: string): Promise<GitOpResult> {
    return invoke<GitOpResult>('git_merge', { root, branch });
  },

  gitRebaseOnto(root: string, upstream: string): Promise<GitOpResult> {
    return invoke<GitOpResult>('git_rebase_onto', { root, upstream });
  },

  gitBranchCreate(root: string, name: string, startPoint?: string | null): Promise<void> {
    return invoke('git_branch_create', { root, name, startPoint: startPoint ?? null });
  },

  gitBranchCheckout(root: string, name: string): Promise<void> {
    return invoke('git_branch_checkout', { root, name });
  },

  gitBranchDelete(root: string, name: string, force = false): Promise<void> {
    return invoke('git_branch_delete', { root, name, force });
  },

  gitBranchRename(root: string, oldName: string, newName: string): Promise<void> {
    return invoke('git_branch_rename', { root, oldName, newName });
  },

  gitBackupCreate(root: string, op: string): Promise<string> {
    return invoke<string>('git_backup_create', { root, op });
  },

  gitBackupList(root: string): Promise<GitBackupRef[]> {
    return invoke<GitBackupRef[]>('git_backup_list', { root });
  },

  gitBackupRestore(root: string, name: string): Promise<void> {
    return invoke('git_backup_restore', { root, name });
  },

  gitBackupDelete(root: string, name: string): Promise<void> {
    return invoke('git_backup_delete', { root, name });
  },

  gitConflicts(root: string): Promise<GitConflictFile[]> {
    return invoke<GitConflictFile[]>('git_conflicts', { root });
  },

  gitResolveBlock(merged: string, blockIndex: number, choice: GitConflictChoice): Promise<string> {
    return invoke<string>('git_resolve_block', { merged, blockIndex, choice });
  },

  gitConflictWrite(root: string, path: string, content: string): Promise<void> {
    return invoke('git_conflict_write', { root, path, content });
  },

  gitOpState(root: string): Promise<GitOpState> {
    return invoke<GitOpState>('git_op_state', { root });
  },

  gitOpContinue(root: string): Promise<GitOpResult> {
    return invoke<GitOpResult>('git_op_continue', { root });
  },

  gitOpAbort(root: string): Promise<void> {
    return invoke('git_op_abort', { root });
  },

  gitRemotes(root: string): Promise<GitRemote[]> {
    return invoke<GitRemote[]>('git_remotes', { root });
  },

  gitFetch(root: string, remote?: string, prune = false): Promise<void> {
    return invoke('git_fetch', { root, remote: remote ?? null, prune });
  },

  gitPull(root: string, mode: GitPullMode): Promise<GitOpResult> {
    return invoke<GitOpResult>('git_pull', { root, mode });
  },

  gitPush(
    root: string,
    remote: string,
    branch: string,
    setUpstream = false,
    forceWithLease = false
  ): Promise<GitOpResult> {
    return invoke<GitOpResult>('git_push', {
      root,
      remote,
      branch,
      setUpstream,
      forceWithLease,
    });
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

  testRepoPath(): Promise<string | null> {
    return invoke<string | null>('test_repo_path');
  },

  testEnv(name: string): Promise<string | null> {
    return invoke<string | null>('test_env', { name });
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

  // ---------------------------------------------------------------------------
  // Run, Toolchain, Device, Logcat Methods
  // ---------------------------------------------------------------------------

  toolchainDetect(root: string): Promise<Toolchain> {
    return invoke<Toolchain>('toolchain_detect', { root });
  },

  devicesList(): Promise<Device[]> {
    return invoke<Device[]>('devices_list');
  },

  devicesWatch(): Promise<void> {
    return invoke('devices_watch');
  },

  avdList(): Promise<Avd[]> {
    return invoke<Avd[]>('avd_list');
  },

  emulatorStart(avd: string, headless?: boolean): Promise<void> {
    return invoke('emulator_start', { avd, headless: headless ?? null });
  },

  runConfigsLoad(root: string): Promise<RunConfigFile> {
    return invoke<RunConfigFile>('run_configs_load', { root });
  },

  runConfigsSave(root: string, file: RunConfigFile): Promise<void> {
    return invoke('run_configs_save', { root, file });
  },

  runStart(root: string, config: RunConfig, deviceId: string): Promise<number> {
    return invoke<number>('run_start', { root, config, deviceId });
  },

  runReload(runId: number, full: boolean): Promise<ReloadResult> {
    return invoke<ReloadResult>('run_reload', { runId, full });
  },

  runStop(runId: number): Promise<void> {
    return invoke('run_stop', { runId });
  },

  logcatStart(deviceId: string, appId?: string): Promise<void> {
    return invoke('logcat_start', { deviceId, appId: appId ?? null });
  },

  logcatStop(): Promise<void> {
    return invoke('logcat_stop');
  },

  gradleSync(root: string): Promise<string> {
    return invoke<string>('gradle_sync', { root });
  },

  gradleStatus(root: string): Promise<boolean> {
    return invoke<boolean>('gradle_status', { root });
  },

  gradleStop(root: string): Promise<void> {
    return invoke('gradle_stop', { root });
  },

  openUrl(url: string): Promise<void> {
    return invoke('open_url', { url });
  },

  // FS operations
  fsCreateFile(root: string, rel: string, template?: string): Promise<string> {
    return invoke<string>('fs_create_file', { root, rel, template: template ?? null });
  },

  fsCreateDir(root: string, rel: string): Promise<string> {
    return invoke<string>('fs_create_dir', { root, rel });
  },

  fsRename(root: string, from: string, to: string): Promise<void> {
    return invoke('fs_rename', { root, from, to });
  },

  fsMove(root: string, srcs: string[], dest: string): Promise<string[]> {
    return invoke<string[]>('fs_move', { root, srcs, dest });
  },

  fsCopy(root: string, srcs: string[], dest: string): Promise<string[]> {
    return invoke<string[]>('fs_copy', { root, srcs, dest });
  },

  fsDuplicate(root: string, rel: string): Promise<string> {
    return invoke<string>('fs_duplicate', { root, rel });
  },

  fsTrash(root: string, rels: string[]): Promise<void> {
    return invoke('fs_trash', { root, rels });
  },

  osReveal(path: string): Promise<void> {
    return invoke('os_reveal', { path });
  },

  osOpenDefault(path: string): Promise<void> {
    return invoke('os_open_default', { path });
  },

  // Local History
  lhList(root: string, rel: string): Promise<LocalHistoryEntry[]> {
    return invoke<LocalHistoryEntry[]>('lh_list', { root, rel });
  },

  lhRead(root: string, id: string): Promise<string> {
    return invoke<string>('lh_read', { root, id });
  },

  lhRevert(root: string, id: string): Promise<void> {
    return invoke('lh_revert', { root, id });
  },

  lhLabel(root: string, rel: string, label: string): Promise<LocalHistoryEntry> {
    return invoke<LocalHistoryEntry>('lh_label', { root, rel, label });
  },

  lhSnapshot(root: string, rel: string, kind: string): Promise<LocalHistoryEntry | null> {
    return invoke<LocalHistoryEntry | null>('lh_snapshot', { root, rel, kind });
  },

  // Git Per-Path
  gitDiffPath(root: string, rel: string, mode: 'head' | 'staged' | string): Promise<GitDiffFile[]> {
    return invoke<GitDiffFile[]>('git_diff_path', { root, rel, mode });
  },

  gitFileAtRef(root: string, gitRef: string, rel: string): Promise<string | null> {
    return invoke<string | null>('git_file_at_ref', { root, gitRef, rel });
  },

  gitPathHistory(root: string, rel: string, isFile: boolean, limit?: number, skip?: number): Promise<GitCommit[]> {
    return invoke<GitCommit[]>('git_path_history', { root, rel, isFile, limit: limit ?? null, skip: skip ?? null });
  },

  gitBlame(root: string, rel: string): Promise<GitBlameLine[]> {
    return invoke<GitBlameLine[]>('git_blame', { root, rel });
  },

  gitRollback(root: string, rels: string[]): Promise<void> {
    return invoke('git_rollback', { root, rels });
  },

  gitGitignoreAdd(root: string, rel: string): Promise<void> {
    return invoke('git_gitignore_add', { root, rel });
  },

  gitCommitPaths(root: string, rels: string[], message: string): Promise<string> {
    return invoke<string>('git_commit_paths', { root, rels, message });
  },

  // Event Listeners
  onRunEvent(cb: (payload: RunEventPayload) => void): Promise<UnlistenFn> {
    return listen<RunEventPayload>('run-event', (event) => cb(event.payload));
  },

  onLogcatBatch(cb: (payload: LogLine[]) => void): Promise<UnlistenFn> {
    return listen<LogLine[]>('logcat-batch', (event) => cb(event.payload));
  },

  onDevicesChanged(cb: (payload: Device[]) => void): Promise<UnlistenFn> {
    return listen<Device[]>('devices-changed', (event) => cb(event.payload));
  },

  onGradleDaemon(cb: (payload: GradleDaemonPayload) => void): Promise<UnlistenFn> {
    return listen<GradleDaemonPayload>('gradle-daemon', (event) => cb(event.payload));
  },

  // Aliases matching snake_case naming
  run_start(root: string, config: RunConfig, deviceId: string): Promise<number> {
    return api.runStart(root, config, deviceId);
  },

  run_reload(runId: number, full: boolean): Promise<ReloadResult> {
    return api.runReload(runId, full);
  },

  run_stop(runId: number): Promise<void> {
    return api.runStop(runId);
  },

  devices_watch(): Promise<void> {
    return api.devicesWatch();
  },

  devices_list(): Promise<Device[]> {
    return api.devicesList();
  },

  avd_list(): Promise<Avd[]> {
    return api.avdList();
  },

  emulator_start(avd: string, headless?: boolean): Promise<void> {
    return api.emulatorStart(avd, headless);
  },

  run_configs_load(root: string): Promise<RunConfigFile> {
    return api.runConfigsLoad(root);
  },

  run_configs_save(root: string, file: RunConfigFile): Promise<void> {
    return api.runConfigsSave(root, file);
  },

  gradle_sync(root: string): Promise<string> {
    return api.gradleSync(root);
  },

  gradle_status(root: string): Promise<boolean> {
    return api.gradleStatus(root);
  },

  gradle_stop(root: string): Promise<void> {
    return api.gradleStop(root);
  },

  open_url(url: string): Promise<void> {
    return api.openUrl(url);
  },

  logcat_start(deviceId: string, appId?: string): Promise<void> {
    return api.logcatStart(deviceId, appId);
  },

  logcat_stop(): Promise<void> {
    return api.logcatStop();
  },

  // FS & Local History snake_case aliases
  fs_create_file(root: string, rel: string, template?: string): Promise<string> {
    return api.fsCreateFile(root, rel, template);
  },

  fs_create_dir(root: string, rel: string): Promise<string> {
    return api.fsCreateDir(root, rel);
  },

  fs_rename(root: string, from: string, to: string): Promise<void> {
    return api.fsRename(root, from, to);
  },

  fs_move(root: string, srcs: string[], dest: string): Promise<string[]> {
    return api.fsMove(root, srcs, dest);
  },

  fs_copy(root: string, srcs: string[], dest: string): Promise<string[]> {
    return api.fsCopy(root, srcs, dest);
  },

  fs_duplicate(root: string, rel: string): Promise<string> {
    return api.fsDuplicate(root, rel);
  },

  fs_trash(root: string, rels: string[]): Promise<void> {
    return api.fsTrash(root, rels);
  },

  os_reveal(path: string): Promise<void> {
    return api.osReveal(path);
  },

  os_open_default(path: string): Promise<void> {
    return api.osOpenDefault(path);
  },

  lh_list(root: string, rel: string): Promise<LocalHistoryEntry[]> {
    return api.lhList(root, rel);
  },

  lh_read(root: string, id: string): Promise<string> {
    return api.lhRead(root, id);
  },

  lh_revert(root: string, id: string): Promise<void> {
    return api.lhRevert(root, id);
  },

  lh_label(root: string, rel: string, label: string): Promise<LocalHistoryEntry> {
    return api.lhLabel(root, rel, label);
  },

  lh_snapshot(root: string, rel: string, kind: string): Promise<LocalHistoryEntry | null> {
    return api.lhSnapshot(root, rel, kind);
  },

  git_diff_path(root: string, rel: string, mode: 'head' | 'staged' | string): Promise<GitDiffFile[]> {
    return api.gitDiffPath(root, rel, mode);
  },

  git_file_at_ref(root: string, git_ref: string, rel: string): Promise<string | null> {
    return api.gitFileAtRef(root, git_ref, rel);
  },

  git_path_history(root: string, rel: string, is_file: boolean, limit?: number, skip?: number): Promise<GitCommit[]> {
    return api.gitPathHistory(root, rel, is_file, limit, skip);
  },

  git_blame(root: string, rel: string): Promise<GitBlameLine[]> {
    return api.gitBlame(root, rel);
  },

  git_rollback(root: string, rels: string[]): Promise<void> {
    return api.gitRollback(root, rels);
  },

  git_gitignore_add(root: string, rel: string): Promise<void> {
    return api.gitGitignoreAdd(root, rel);
  },

  git_commit_paths(root: string, rels: string[], message: string): Promise<string> {
    return api.gitCommitPaths(root, rels, message);
  },
};
