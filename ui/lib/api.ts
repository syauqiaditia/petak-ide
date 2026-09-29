import { invoke, Channel } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { MirrorStatus, InputEvent, MirrorInfo } from '../features/mirror/types';
export type { MirrorStatus, InputEvent, MirrorInfo };

export type { UnlistenFn };

export interface Entry {
  name: string;
  path: string;
  is_dir: boolean;
}

export interface RecentProject {
  name: string;
  path: string;
  lastOpened: number;
  exists: boolean;
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
  state: 'starting' | 'ready' | 'stopped' | 'crashed' | 'failed';
  reason?: string | null;
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
  kotlinLs?: Tool | null;
  sourcekit?: Tool | null;
  effectivePath?: string | null;
}

export interface ToolchainConfig {
  flutterSdk?: string | null;
  androidSdk?: string | null;
  kotlinLanguageServer?: string | null;
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

export interface KotlinLsStatus {
  installed: boolean;
  version: string | null;
  javaOk: boolean;
  javaVersion: string | null;
  message: string;
}

export interface KotlinLsProgress {
  stage: 'downloading' | 'extracting' | 'verifying' | 'done' | 'error';
  percent: number | null;
  message: string;
}

export interface CheckoutResult {
  stashed: boolean;
  stashPopped: boolean;
  message: string;
}

export interface SnapshotEmulator {
  id: string;
  name: string;
  kind: 'android-avd' | 'ios-sim';
  state: 'running' | 'stopped' | 'booting';
  deviceId?: string | null;
  sdk?: string;
}

export interface SnapshotPhysical {
  id: string;
  name: string;
  platform: DevicePlatform;
  transport: 'usb' | 'wifi';
  state?: string;
  sdk?: string;
}

export interface DevicesSnapshot {
  emulators: SnapshotEmulator[];
  physical: SnapshotPhysical[];
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

  async recentProjectsList(): Promise<RecentProject[]> {
    try {
      return await invoke<RecentProject[]>('recent_projects_list');
    } catch {
      const folders = await this.recentFolders().catch(() => []);
      return folders.slice(0, 10).map((p) => {
        const parts = p.split('/').filter(Boolean);
        return {
          name: parts[parts.length - 1] || p,
          path: p,
          lastOpened: Date.now(),
          exists: true,
        };
      });
    }
  },

  async recentProjectsAdd(path: string): Promise<void> {
    try {
      await invoke('recent_projects_add', { path });
    } catch {
      await this.addRecentFolder(path).catch(() => []);
    }
  },

  async recentProjectsRemove(path: string): Promise<void> {
    try {
      await invoke('recent_projects_remove', { path });
    } catch {
      // Best-effort fallback
    }
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

  toolchainGetConfig(): Promise<ToolchainConfig> {
    return invoke<ToolchainConfig>('toolchain_get_config');
  },

  toolchainSaveConfig(config: ToolchainConfig): Promise<void> {
    return invoke('toolchain_save_config', { config });
  },

  devicesList(): Promise<Device[]> {
    return invoke<Device[]>('devices_list');
  },

  devicesWatch(): Promise<void> {
    return invoke('devices_watch');
  },

  devicesSnapshot(): Promise<DevicesSnapshot> {
    return invoke<DevicesSnapshot>('devices_snapshot').catch(async () => {
      // Fallback to devicesList and avdList
      const devs = await invoke<Device[]>('devices_list').catch(() => []);
      const avds = await invoke<Avd[]>('avd_list').catch(() => []);
      const emus: SnapshotEmulator[] = devs
        .filter((d) => d.kind === 'emulator' || d.platform === 'ios')
        .map((d) => ({
          id: d.id,
          name: d.name,
          kind: (d.platform === 'ios' ? 'ios-sim' : 'android-avd') as 'android-avd' | 'ios-sim',
          state: (d.state === 'online' ? 'running' : 'stopped') as 'running' | 'stopped',
          deviceId: d.id,
          sdk: d.sdk ?? undefined,
        }));
      for (const a of avds) {
        if (!emus.some((e) => e.name.toLowerCase() === a.name.toLowerCase())) {
          emus.push({
            id: a.name,
            name: a.name,
            kind: 'android-avd',
            state: 'stopped',
            deviceId: null,
          });
        }
      }
      const phys: SnapshotPhysical[] = devs
        .filter((d) => d.kind === 'physical')
        .map((d) => ({
          id: d.id,
          name: d.name,
          platform: d.platform,
          transport: d.id.includes(':') ? 'wifi' : 'usb',
          state: d.state,
          sdk: d.sdk ?? undefined,
        }));
      return { emulators: emus, physical: phys };
    });
  },

  async avdStart(name: string, cold: boolean = false): Promise<void> {
    try {
      await invoke('avd_start', { name, cold });
    } catch {
      await invoke('emulator_start', { avd: name, headless: null });
    }
  },

  avdStop(name: string): Promise<void> {
    return invoke('avd_stop', { name });
  },

  simBoot(udid: string): Promise<void> {
    return invoke('sim_boot', { udid });
  },

  simShutdown(udid: string): Promise<void> {
    return invoke('sim_shutdown', { udid });
  },

  kotlinLsStatus(): Promise<KotlinLsStatus> {
    return invoke<KotlinLsStatus>('kotlin_ls_status').catch(() => ({
      installed: false,
      version: null,
      javaOk: true,
      javaVersion: null,
      message: 'Status check unavailable',
    }));
  },

  kotlinLsInstall(): Promise<void> {
    return invoke('kotlin_ls_install');
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

  async gitBranchesTree(root: string): Promise<GitBranchList> {
    try {
      return await invoke<GitBranchList>('git_branches_tree', { root });
    } catch {
      return await invoke<GitBranchList>('git_branches', { root });
    }
  },

  async gitCheckout(root: string, branch: string, autoStash: boolean = true): Promise<CheckoutResult> {
    try {
      return await invoke<CheckoutResult>('git_checkout', {
        root,
        branch,
        autoStash,
        auto_stash: autoStash,
      });
    } catch {
      await invoke('git_checkout_branch', { root, branch });
      return { stashed: false, stashPopped: false, message: 'Checked out ' + branch };
    }
  },

  async gitStage(root: string, path: string): Promise<void> {
    try {
      await invoke('git_stage', { root, path });
    } catch {
      await invoke('git_stage_files', { root, paths: [path] });
    }
  },

  async gitStagePaths(root: string, paths: string[]): Promise<void> {
    try {
      await invoke('git_stage_paths', { root, paths });
    } catch {
      await invoke('git_stage_files', { root, paths });
    }
  },

  async gitUnstage(root: string, path: string): Promise<void> {
    try {
      await invoke('git_unstage', { root, path });
    } catch {
      await invoke('git_unstage_files', { root, paths: [path] });
    }
  },

  async gitUnstagePaths(root: string, paths: string[]): Promise<void> {
    try {
      await invoke('git_unstage_paths', { root, paths });
    } catch {
      await invoke('git_unstage_files', { root, paths });
    }
  },

  async gitCommitSelected(root: string, message: string, paths: string[]): Promise<{ sha: string }> {
    try {
      return await invoke<{ sha: string }>('git_commit_selected', { root, message, paths });
    } catch {
      const sha = await invoke<string>('git_commit_paths', { root, rels: paths, message });
      return { sha };
    }
  },

  async gitDeleteUntracked(root: string, path: string): Promise<void> {
    try {
      await invoke('git_delete_untracked', { root, path });
    } catch {
      await invoke('fs_delete', { path });
    }
  },

  async gitLogPath(root: string, path: string, limit?: number): Promise<GitCommit[]> {
    try {
      return await invoke<GitCommit[]>('git_log_path', { root, path, limit: limit ?? null });
    } catch {
      return await invoke<GitCommit[]>('git_path_history', {
        root,
        rel: path,
        isFile: true,
        limit: limit ?? null,
      });
    }
  },

  async gitDiffBranch(root: string, path: string, branch: string): Promise<GitDiffFile[]> {
    try {
      return await invoke<GitDiffFile[]>('git_diff_branch', { root, path, branch });
    } catch {
      return await invoke<GitDiffFile[]>('git_diff_path', { root, rel: path, mode: branch });
    }
  },

  async gitDiffRevision(root: string, path: string, rev: string): Promise<GitDiffFile[]> {
    try {
      return await invoke<GitDiffFile[]>('git_diff_revision', { root, path, rev });
    } catch {
      return await invoke<GitDiffFile[]>('git_diff_path', { root, rel: path, mode: rev });
    }
  },

  // Event Listeners
  onRunEvent(cb: (payload: RunEventPayload) => void): Promise<UnlistenFn> {
    return listen<RunEventPayload>('run-event', (event) => cb(event.payload));
  },

  onLogcatBatch(cb: (payload: LogLine[]) => void): Promise<UnlistenFn> {
    return listen<LogLine[]>('logcat-batch', (event) => cb(event.payload));
  },

  onDevicesChanged(cb: (payload: DevicesSnapshot | Device[]) => void): Promise<UnlistenFn> {
    return listen<DevicesSnapshot | Device[]>('devices-changed', (event) => cb(event.payload));
  },

  onDeviceReady(cb: (payload: { id: string; kind: string }) => void): Promise<UnlistenFn> {
    return listen<{ id: string; kind: string }>('device-ready', (event) => cb(event.payload));
  },

  onKotlinLsProgress(cb: (payload: KotlinLsProgress) => void): Promise<UnlistenFn> {
    return listen<KotlinLsProgress>('kotlin-ls-progress', (event) => cb(event.payload));
  },

  onGradleDaemon(cb: (payload: GradleDaemonPayload) => void): Promise<UnlistenFn> {
    return listen<GradleDaemonPayload>('gradle-daemon', (event) => cb(event.payload));
  },

  // ---------------------------------------------------------------------------
  // Device Mirror Methods (Phase 4.5)
  // ---------------------------------------------------------------------------

  async mirrorStart(
    serial: string,
    onFrame: (buf: ArrayBuffer) => void,
    onStatus: (status: MirrorStatus) => void
  ): Promise<MirrorInfo> {
    if (typeof window !== 'undefined' && !(window as any).__TAURI_INTERNALS__) {
      // In browser preview / dev bridge mode
      onStatus({ state: 'Connecting' });
      setTimeout(() => {
        onStatus({ state: 'Live', width: 1080, height: 2400 });
      }, 100);
      return {
        serial,
        name: serial.toLowerCase().includes('iphone') ? 'iPhone 15 Pro' : 'Pixel 8 · API 35',
        width: 1080,
        height: 2400,
        codec: 'h264',
      };
    }

    const onFrameChannel = new Channel<ArrayBuffer>();
    onFrameChannel.onmessage = (buf) => onFrame(buf);

    const onStatusChannel = new Channel<MirrorStatus>();
    onStatusChannel.onmessage = (status) => onStatus(status);

    return invoke<MirrorInfo>('mirror_start', {
      serial,
      on_frame: onFrameChannel,
      on_status: onStatusChannel,
      onFrame: onFrameChannel,
      onStatus: onStatusChannel,
    });
  },

  async mirrorStop(serial: string): Promise<void> {
    if (typeof window !== 'undefined' && !(window as any).__TAURI_INTERNALS__) {
      return;
    }
    return invoke('mirror_stop', { serial });
  },

  async mirrorInput(serial: string, ev: InputEvent): Promise<void> {
    if (typeof window !== 'undefined' && !(window as any).__TAURI_INTERNALS__) {
      return;
    }
    return invoke('mirror_input', { serial, ev });
  },

  async mirrorScreenshot(serial: string, path?: string | null): Promise<string> {
    if (typeof window !== 'undefined' && !(window as any).__TAURI_INTERNALS__) {
      return path || '/tmp/petak-screencap.png';
    }
    return invoke<string>('mirror_screenshot', { serial, path: path ?? null });
  },
};
