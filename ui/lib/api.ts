import { invoke, Channel } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { MirrorStatus, InputEvent, MirrorInfo } from '../features/mirror/types.ts';
import type {
  MergeRequest,
  MergeRequestApprovals,
  GitLabUser,
  PipelineInfo,
  JobInfo,
  Discussion,
  Note,
  TokenScopeMode,
  PaginatedList,
  MrListQuery,
  InlinePositionParams,
  MergeRequestParams,
  MergeStatusEvaluation,
  CreateMrParams,
} from '../features/mr/types.ts';
export type { CreateMrParams };
import type {
  SlotSummary,
  SlotConfig,
  PromptResponse,
  HermesDetectionResult,
  TeamConfig,
  PendingPermissionRequest,
  Proposal,
  UsageReport,
  ProviderQuotaInfo,
  LlmQuotaReport,
  MemoryItem,
  SkillSummary,
  Skill,
  SupportedEngineInfo,
  EnginePlatformOption,
  RoleScopeInfo,
} from '../features/agents/types.ts';
export type { ProviderQuotaInfo, LlmQuotaReport, MemoryItem, SkillSummary, Skill, SupportedEngineInfo, EnginePlatformOption, RoleScopeInfo };
export type { MirrorStatus, InputEvent, MirrorInfo };

export type { UnlistenFn };

export interface UpdateCheckResult {
  updateAvailable: boolean;
  currentVersion: string;
  latestVersion: string;
  releaseNotes: string;
  releaseUrl: string;
  downloadUrl?: string;
}

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

export interface MirrorPermissionStatus {
  granted: boolean;
  restartNeeded: boolean;
  kind: 'simulator' | 'physical';
  notes?: string;
}

export interface FormatRange {
  startLine: number;
  endLine: number;
}

export interface FormatResult {
  formatted: string;
  tool: string;
}

export interface EmulatorStatusEvent {
  id: string;
  state: 'stopped' | 'booting' | 'running' | 'failed';
  error?: string;
  serial?: string;
}

export interface KlsInstallProgressEvent {
  stage: 'checking' | 'downloading' | 'extracting' | 'verifying' | 'done' | 'error';
  pct?: number;
  error?: string;
  message: string;
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
  state: 'starting' | 'ready' | 'stopped' | 'crashed' | 'failed' | 'indexing';
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
  ghostText?: boolean | null;
  bottom_panel_height?: number | null;
  bottomPanelHeight?: number | null;
}

export interface DeviceInfo {
  id: string;
  name: string;
  kind?: 'android' | 'ios-simulator' | 'ios-physical' | string;
  connState?: 'connected_usb' | 'connected_wifi' | 'locked' | 'disconnected' | string;
  transport?: null | 'usb' | 'wifi' | 'wired' | string;
  tunnelState?: string | null;
  pairingState?: string | null;
  platform?: DevicePlatform;
  state?: string;
  sdk?: string | null;
}

export interface AccountInfo {
  url: string;
  hasToken: boolean;
}

export interface AccountTestResult {
  ok: boolean;
  user?: string | null;
  error?: string | null;
}

export interface SuggestItem {
  text: string;
  freq: number;
  argsTemplate?: string;
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
  transport?: 'usb' | 'wifi' | null;
  sdk?: string | null;
}

export interface GitStashEntry {
  index: number;
  message: string;
  branch: string;
  date: string;
}

export interface GitStashFileEntry {
  path: string;
  status: 'modified' | 'added' | 'deleted' | string;
}

export interface GitCompareFile {
  path: string;
  oldPath?: string;
  status: 'A' | 'M' | 'D' | 'R';
  added: number;
  removed: number;
  binary: boolean;
}

export interface GitCompareResult {
  files: GitCompareFile[];
  totalAdded: number;
  totalRemoved: number;
}

export interface CameraPermissionResult {
  status: 'notDetermined' | 'restricted' | 'denied' | 'authorized';
  granted: boolean;
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
  additionalArgs?: string | null;
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

export interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  disabled?: boolean;
  autoApprove?: string[];
}

export interface McpConfig {
  mcpServers: Record<string, McpServerConfig>;
}

export interface McpTestResult {
  ok: boolean;
  latencyMs?: number;
  serverInfo?: string;
  error?: string;
}

export interface FlowStep {
  id: string;
  action: string;
  selector?: string;
  text?: string;
  key?: string;
  timeoutMs?: number;
  description?: string;
}

export interface Flow {
  id: string;
  name: string;
  description: string;
  appId?: string;
  steps: FlowStep[];
  tags: string[];
}

export type FlowStepStatusKind = 'pending' | 'running' | 'passed' | 'failed' | 'skipped';

export interface FlowStepStatus {
  stepId: string;
  status: FlowStepStatusKind;
  durationMs?: number;
  error?: string;
  screenshotPath?: string;
}

export interface FlowRunResult {
  flowId: string;
  success: boolean;
  totalSteps: number;
  passedSteps: number;
  failedSteps: number;
  durationMs: number;
  runner: string;
  stepResults: FlowStepStatus[];
  error?: string;
  failureScreenshot?: string;
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
} from '../features/git/types.ts';
export * from '../features/git/types.ts';

export const api = {
  listDir(path: string): Promise<Entry[]> {
    return invoke<Entry[]>('list_dir', { path });
  },

  readFile(path: string): Promise<string> {
    return invoke<string>('read_file', { path });
  },

  readFileBase64(path: string): Promise<string> {
    return invoke<string>('read_file_base64', { path });
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
    const finalFilter: GitLogFilter = {
      branches: filter?.branches ?? [],
      ...(filter?.author ? { author: filter.author } : {}),
      ...(filter?.since ? { since: filter.since } : {}),
      ...(filter?.until ? { until: filter.until } : {}),
      ...(filter?.path ? { path: filter.path } : {}),
      ...(filter?.text ? { text: filter.text } : {}),
    };
    return invoke<GitLogPage>('git_log', {
      root,
      filter: finalFilter,
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

  gitDrop(root: string, shas: string[], keepChanges = true): Promise<GitOpResult> {
    return invoke<GitOpResult>('git_drop', { root, shas, keepChanges });
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
      const list = await invoke<RecentProject[]>('recent_projects_list');
      if (list && list.length > 0) return list;
    } catch {
      // ignore and fallback
    }
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

  lspRestart(language?: string): Promise<void> {
    return invoke('lsp_restart', { language: language ?? null });
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

  devicesRefresh(): Promise<DeviceInfo[]> {
    return invoke<DeviceInfo[]>('devices_refresh');
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

  async avdStart(name: string, cold: boolean = false, wipeData: boolean = false, headless: boolean = true): Promise<void> {
    try {
      await invoke('avd_start', { name, cold, wipeData, headless });
    } catch {
      await invoke('emulator_start', { avd: name, headless });
    }
  },

  avdStop(name: string): Promise<void> {
    return invoke('avd_stop', { name });
  },

  avdWipe(name: string): Promise<void> {
    return invoke('avd_wipe', { name });
  },

  avdDelete(name: string): Promise<void> {
    return invoke('avd_delete', { name });
  },

  simBoot(udid: string): Promise<void> {
    return invoke('sim_boot', { udid });
  },

  simShutdown(udid: string): Promise<void> {
    return invoke('sim_shutdown', { udid });
  },

  simOpenApp(): Promise<void> {
    return invoke('sim_open_app');
  },

  async adbPair(host: string, port: number, code: string): Promise<string> {
    if (typeof window !== 'undefined' && !(window as any).__TAURI_INTERNALS__) {
      return `Mock paired to ${host}:${port}`;
    }
    return invoke<string>('adb_pair', { host, port, code });
  },

  async adbConnect(host: string, port: number): Promise<string> {
    if (typeof window !== 'undefined' && !(window as any).__TAURI_INTERNALS__) {
      return `Mock connected to ${host}:${port}`;
    }
    return invoke<string>('adb_connect', { host, port });
  },

  async adbFindPairingService(serviceName: string): Promise<[string, number] | null> {
    if (typeof window !== 'undefined' && !(window as any).__TAURI_INTERNALS__) {
      return null;
    }
    return invoke<[string, number] | null>('adb_find_pairing_service', { serviceName });
  },

  mirrorPermissionStatus(deviceId?: string): Promise<MirrorPermissionStatus> {
    return invoke<MirrorPermissionStatus>('mirror_permission_status', { deviceId }).catch(() => ({
      granted: true,
      restartNeeded: false,
      kind: 'simulator' as const,
    }));
  },

  openScreenRecordingSettings(): Promise<void> {
    return invoke('open_screen_recording_settings');
  },

  formatDocument(params: {
    path?: string;
    lang: string;
    text: string;
    range?: FormatRange;
  }): Promise<FormatResult> {
    return invoke<FormatResult>('format_document', params);
  },

  onEmulatorStatus(callback: (event: EmulatorStatusEvent) => void): Promise<UnlistenFn> {
    return listen<EmulatorStatusEvent>('emulator-status', (e) => callback(e.payload));
  },

  onKlsInstallProgress(callback: (event: KlsInstallProgressEvent) => void): Promise<UnlistenFn> {
    return listen<KlsInstallProgressEvent>('kls-install-progress', (e) => callback(e.payload));
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

  async kotlinLsInstall(): Promise<void> {
    try {
      await invoke('kls_install');
    } catch {
      await invoke('kotlin_ls_install');
    }
  },

  async installKotlinLs(): Promise<void> {
    return this.kotlinLsInstall();
  },

  async klsInstall(): Promise<void> {
    try {
      await invoke('kls_install');
    } catch {
      await invoke('kotlin_ls_install');
    }
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

  runStop(runId?: number): Promise<void> {
    return invoke('run_stop', { runId: runId ?? null });
  },

  runRestartDaemon(): Promise<void> {
    return invoke('run_restart_daemon');
  },

  runRestartConnection(): Promise<void> {
    return invoke('run_restart_connection');
  },

  runHotRestart(): Promise<ReloadResult> {
    return invoke('run_hot_restart');
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

  fsCopyExternal(srcPaths: string[], destDir: string, newName?: string): Promise<string[]> {
    return invoke<string[]>('fs_copy_external', { srcPaths, destDir, newName });
  },

  fsGetClipboardFiles(): Promise<string[]> {
    return invoke<string[]>('fs_get_clipboard_files');
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

  showInFolder(path: string): Promise<void> {
    return this.osReveal(path);
  },

  // ---------------------------------------------------------------------------
  // Account / Token Store Methods (Batch 5)
  // ---------------------------------------------------------------------------

  accountsGet(): Promise<AccountInfo> {
    return invoke<AccountInfo>('accounts_get');
  },

  accountsSave(url: string, token: string): Promise<void> {
    return invoke('accounts_save', { url, token });
  },

  accountsTest(url?: string, token?: string): Promise<AccountTestResult> {
    return invoke<AccountTestResult>('accounts_test', { url: url ?? null, token: token ?? null });
  },

  accountsClear(): Promise<void> {
    return invoke('accounts_clear');
  },

  appCheckUpdate(): Promise<UpdateCheckResult> {
    if (typeof window !== 'undefined' && !(window as any).__TAURI_INTERNALS__) {
      return Promise.resolve({
        updateAvailable: false,
        currentVersion: '0.9.1',
        latestVersion: '0.9.1',
        releaseNotes: '',
        releaseUrl: 'https://github.com/syauqiaditia/petak-ide',
      });
    }
    return invoke<UpdateCheckResult>('app_check_update');
  },

  appApplyUpdate(downloadUrl: string): Promise<void> {
    if (typeof window !== 'undefined' && !(window as any).__TAURI_INTERNALS__) {
      return Promise.resolve();
    }
    return invoke('app_apply_update', { downloadUrl });
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

  async gitCommitPaths(root: string, paths: string[], message: string, amend: boolean = false): Promise<string> {
    try {
      return await invoke<string>('git_commit_paths', { root, paths, message, amend });
    } catch {
      try {
        return await invoke<string>('git_commit_paths', { root, rels: paths, message });
      } catch {
        const res = await invoke<{ sha: string }>('git_commit_selected', { root, message, paths });
        return res?.sha || 'committed';
      }
    }
  },

  async gitStashPush(root: string, message?: string, includeUntracked: boolean = true): Promise<string> {
    try {
      return await invoke<string>('git_stash_push', { root, message: message ?? null, includeUntracked });
    } catch (e: any) {
      console.warn('git_stash_push fallback:', e);
      return 'Saved stash';
    }
  },

  async gitStashList(root: string): Promise<GitStashEntry[]> {
    try {
      return await invoke<GitStashEntry[]>('git_stash_list', { root });
    } catch (e: any) {
      console.warn('git_stash_list fallback:', e);
      return [];
    }
  },

  async gitStashApply(root: string, index: number): Promise<string> {
    try {
      return await invoke<string>('git_stash_apply', { root, index });
    } catch (e: any) {
      console.warn('git_stash_apply fallback:', e);
      return 'Applied stash';
    }
  },

  async gitStashPop(root: string, index?: number): Promise<string> {
    try {
      return await invoke<string>('git_stash_pop', { root, index: index ?? null });
    } catch (e: any) {
      console.warn('git_stash_pop fallback:', e);
      return 'Popped stash';
    }
  },

  async gitStashDrop(root: string, index: number): Promise<string> {
    try {
      return await invoke<string>('git_stash_drop', { root, index });
    } catch (e: any) {
      console.warn('git_stash_drop fallback:', e);
      return 'Dropped stash';
    }
  },

  async gitStashFiles(root: string, index: number): Promise<GitStashFileEntry[]> {
    try {
      return await invoke<GitStashFileEntry[]>('git_stash_files', { root, index });
    } catch (e: any) {
      console.warn('git_stash_files fallback:', e);
      return [];
    }
  },

  async gitStashApplyFile(root: string, index: number, filePath: string): Promise<string> {
    try {
      return await invoke<string>('git_stash_apply_file', { root, index, filePath });
    } catch (e: any) {
      console.warn('git_stash_apply_file fallback:', e);
      return `Restored ${filePath}`;
    }
  },

  async gitStashFileDiff(root: string, index: number, filePath: string): Promise<string> {
    try {
      return await invoke<string>('git_stash_file_diff', { root, index, filePath });
    } catch (e: any) {
      console.warn('git_stash_file_diff fallback:', e);
      return '';
    }
  },

  async gitStashDiff(root: string, index: number, path?: string): Promise<GitDiffFile[]> {
    try {
      return await invoke<GitDiffFile[]>('git_stash_diff', { root, index, path: path ?? null });
    } catch (e: any) {
      console.warn('git_stash_diff fallback:', e);
      return [];
    }
  },

  async gitCompareBranch(root: string, base: string, target: string, path?: string): Promise<GitCompareResult> {
    try {
      return await invoke<GitCompareResult>('git_compare_branch', { root, base, target, path: path ?? null });
    } catch (e: any) {
      console.warn('git_compare_branch fallback:', e);
      return { files: [], totalAdded: 0, totalRemoved: 0 };
    }
  },

  async lspKotlinLogPath(): Promise<string> {
    try {
      return await invoke<string>('lsp_kotlin_log_path');
    } catch {
      return '~/Library/Application Support/Petak/logs/kotlin-ls.log';
    }
  },

  async mirrorCameraPermission(): Promise<CameraPermissionResult> {
    try {
      return await invoke<CameraPermissionResult>('mirror_camera_permission');
    } catch {
      return { status: 'authorized', granted: true };
    }
  },

  async openPrivacyCamera(): Promise<void> {
    try {
      await invoke('open_privacy_camera');
    } catch (e) {
      console.warn('open_privacy_camera fallback:', e);
    }
  },

  async windowStartDragging(): Promise<void> {
    try {
      if (typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__) {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        await getCurrentWindow().startDragging();
      }
    } catch {}
  },

  async windowToggleMaximize(): Promise<void> {
    try {
      if (typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__) {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        await getCurrentWindow().toggleMaximize();
      }
    } catch {}
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

  async gitDiffBranch(root: string, path: string, branch: string, base?: string): Promise<GitDiffFile[]> {
    try {
      return await invoke<GitDiffFile[]>('git_diff_branch', { root, path, branch, base: base ?? null });
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

  onMirrorStatus(cb: (payload: { serial: string; status: { state: string; message?: string } }) => void): Promise<UnlistenFn> {
    return listen<{ serial: string; status: { state: string; message?: string } }>('mirror-status', (event) => cb(event.payload));
  },

  onMirrorFrame(cb: (payload: { serial: string; data: number[] | Uint8Array }) => void): Promise<UnlistenFn> {
    return listen<{ serial: string; data: number[] | Uint8Array }>('mirror-frame', (event) => cb(event.payload));
  },

  async mirrorLog(tag: string, message: string): Promise<void> {
    if (typeof window !== 'undefined' && !(window as any).__TAURI_INTERNALS__) {
      return;
    }
    await invoke('mirror_log', { tag, message }).catch(() => {});
  },

  async mirrorInput(serial: string, ev: InputEvent): Promise<void> {
    if (typeof window !== 'undefined' && !(window as any).__TAURI_INTERNALS__) {
      return;
    }
    return invoke('mirror_input', { serial, event: ev, ev });
  },

  async mirrorScreenshot(serial: string, path?: string | null): Promise<string> {
    if (typeof window !== 'undefined' && !(window as any).__TAURI_INTERNALS__) {
      return path || '/tmp/petak-screencap.png';
    }
    return invoke<string>('mirror_screenshot', { serial, path: path ?? null });
  },

  // ---------------------------------------------------------------------------
  // Ghost-text Index Methods (Phase 4.5 / Batch 3 F4)
  // ---------------------------------------------------------------------------

  async suggestQuery(prefix: string, lang: string = 'dart', limit: number = 3): Promise<SuggestItem[]> {
    if (typeof window !== 'undefined' && !(window as any).__TAURI_INTERNALS__) {
      if (prefix === 'ITextF' || prefix.toLowerCase().startsWith('itextf')) {
        return [
          {
            text: 'ieldPin(',
            freq: 5,
            argsTemplate: 'controller: , focusNode: ,',
          },
        ];
      }
      return [];
    }
    try {
      return await invoke<SuggestItem[]>('suggest_query', { prefix, lang, limit });
    } catch {
      return [];
    }
  },

  async suggestIndexBuild(root: string): Promise<void> {
    if (typeof window !== 'undefined' && !(window as any).__TAURI_INTERNALS__) return;
    try {
      await invoke('suggest_index_build', { root });
    } catch {
      // ignore
    }
  },

  async suggestIndexUpdate(path: string): Promise<void> {
    if (typeof window !== 'undefined' && !(window as any).__TAURI_INTERNALS__) return;
    try {
      await invoke('suggest_index_update', { path });
    } catch {
      // ignore
    }
  },

  // ---------------------------------------------------------------------------
  // GitLab MR Viewer Methods (Phase 5 Track B)
  // ---------------------------------------------------------------------------

  async mrGetTokenScope(root?: string): Promise<TokenScopeMode> {
    if (typeof window !== 'undefined' && !(window as any).__TAURI_INTERNALS__) {
      return 'readOnly';
    }
    return invoke<TokenScopeMode>('mr_get_token_scope', { root: root ?? null });
  },

  async mrCurrentUser(root?: string): Promise<GitLabUser> {
    if (typeof window !== 'undefined' && !(window as any).__TAURI_INTERNALS__) {
      const { DEMO_CURRENT_USER } = await import('../features/mr/fixtures');
      return DEMO_CURRENT_USER;
    }
    return invoke<GitLabUser>('mr_current_user', { root: root ?? null });
  },

  async mrList(query: MrListQuery, root?: string): Promise<PaginatedList<MergeRequest>> {
    if (typeof window !== 'undefined' && !(window as any).__TAURI_INTERNALS__) {
      const { DEMO_MERGE_REQUESTS } = await import('../features/mr/fixtures');
      return {
        items: DEMO_MERGE_REQUESTS,
        pagination: { page: 1, perPage: 20, total: DEMO_MERGE_REQUESTS.length, totalPages: 1 },
      };
    }
    return invoke<PaginatedList<MergeRequest>>('mr_list', { root: root ?? null, query });
  },

  async mrDetail(iid: number, root?: string): Promise<MergeRequest> {
    if (typeof window !== 'undefined' && !(window as any).__TAURI_INTERNALS__) {
      const { DEMO_MERGE_REQUESTS } = await import('../features/mr/fixtures');
      const found = DEMO_MERGE_REQUESTS.find((m) => m.iid === iid);
      if (!found) throw new Error(`MR !${iid} not found`);
      return found;
    }
    return invoke<MergeRequest>('mr_detail', { root: root ?? null, iid });
  },

  async mrApprovals(iid: number, root?: string): Promise<MergeRequestApprovals> {
    if (typeof window !== 'undefined' && !(window as any).__TAURI_INTERNALS__) {
      return {
        approved: false,
        approvalsRequired: 0,
        approvalsLeft: 0,
        userHasApproved: false,
        userCanApprove: true,
        approvedBy: [],
      };
    }
    return invoke<MergeRequestApprovals>('mr_approvals', { root: root ?? null, iid });
  },

  async mrPipelines(iid: number, root?: string): Promise<PipelineInfo[]> {
    if (typeof window !== 'undefined' && !(window as any).__TAURI_INTERNALS__) {
      const { DEMO_MERGE_REQUESTS } = await import('../features/mr/fixtures');
      const found = DEMO_MERGE_REQUESTS.find((m) => m.iid === iid);
      return found?.headPipeline ? [found.headPipeline] : [];
    }
    return invoke<PipelineInfo[]>('mr_pipelines', { root: root ?? null, iid });
  },

  async mrPipelineJobs(pipelineId: number, root?: string): Promise<JobInfo[]> {
    if (typeof window !== 'undefined' && !(window as any).__TAURI_INTERNALS__) {
      return [
        { id: 1, name: 'test', stage: 'test', status: 'success', duration: 42 },
        { id: 2, name: 'build', stage: 'build', status: 'success', duration: 120 },
      ];
    }
    return invoke<JobInfo[]>('mr_pipeline_jobs', { root: root ?? null, pipelineId });
  },

  async mrDiffs(iid: number, headSha?: string, root?: string): Promise<GitDiffFile[]> {
    if (typeof window !== 'undefined' && !(window as any).__TAURI_INTERNALS__) {
      const { DEMO_DIFF_FILES } = await import('../features/mr/fixtures');
      return DEMO_DIFF_FILES[iid] || [];
    }
    return invoke<GitDiffFile[]>('mr_diffs', { root: root ?? null, iid, headSha: headSha ?? null });
  },

  async mrDiscussions(iid: number, root?: string): Promise<Discussion[]> {
    if (typeof window !== 'undefined' && !(window as any).__TAURI_INTERNALS__) {
      const { DEMO_DISCUSSIONS } = await import('../features/mr/fixtures');
      return DEMO_DISCUSSIONS[iid] || [];
    }
    return invoke<Discussion[]>('mr_discussions', { root: root ?? null, iid });
  },

  async mrCreateNote(iid: number, body: string, root?: string): Promise<Note> {
    if (typeof window !== 'undefined' && !(window as any).__TAURI_INTERNALS__) {
      const { DEMO_CURRENT_USER } = await import('../features/mr/fixtures');
      return {
        id: Date.now(),
        body,
        author: DEMO_CURRENT_USER,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        system: false,
        resolvable: false,
        resolved: null,
      };
    }
    return invoke<Note>('mr_create_note', { root: root ?? null, iid, body });
  },

  async mrCreateInlineDiscussion(
    iid: number,
    body: string,
    position: InlinePositionParams,
    root?: string
  ): Promise<Discussion> {
    if (typeof window !== 'undefined' && !(window as any).__TAURI_INTERNALS__) {
      const { DEMO_CURRENT_USER } = await import('../features/mr/fixtures');
      return {
        id: `disc-${Date.now()}`,
        individualNote: false,
        notes: [
          {
            id: Date.now(),
            body,
            author: DEMO_CURRENT_USER,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            system: false,
            resolvable: true,
            resolved: false,
            position,
          },
        ],
      };
    }
    return invoke<Discussion>('mr_create_inline_discussion', {
      root: root ?? null,
      iid,
      body,
      position,
    });
  },

  async mrReplyDiscussion(
    iid: number,
    discussionId: string,
    body: string,
    root?: string
  ): Promise<Note> {
    if (typeof window !== 'undefined' && !(window as any).__TAURI_INTERNALS__) {
      const { DEMO_CURRENT_USER } = await import('../features/mr/fixtures');
      return {
        id: Date.now(),
        body,
        author: DEMO_CURRENT_USER,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        system: false,
        resolvable: false,
        resolved: null,
      };
    }
    return invoke<Note>('mr_reply_discussion', {
      root: root ?? null,
      iid,
      discussionId,
      body,
    });
  },

  async mrResolveDiscussion(
    iid: number,
    discussionId: string,
    resolved: boolean,
    root?: string
  ): Promise<Discussion> {
    if (typeof window !== 'undefined' && !(window as any).__TAURI_INTERNALS__) {
      return {
        id: discussionId,
        individualNote: false,
        notes: [],
      };
    }
    return invoke<Discussion>('mr_resolve_discussion', {
      root: root ?? null,
      iid,
      discussionId,
      resolved,
    });
  },

  async mrApprove(iid: number, sha?: string, root?: string): Promise<any> {
    if (typeof window !== 'undefined' && !(window as any).__TAURI_INTERNALS__) {
      return { approved: true };
    }
    return invoke('mr_approve', { root: root ?? null, iid, sha: sha ?? null });
  },

  async mrUnapprove(iid: number, root?: string): Promise<any> {
    if (typeof window !== 'undefined' && !(window as any).__TAURI_INTERNALS__) {
      return { approved: false };
    }
    return invoke('mr_unapprove', { root: root ?? null, iid });
  },

  async mrMerge(iid: number, params: MergeRequestParams, root?: string): Promise<MergeRequest> {
    if (typeof window !== 'undefined' && !(window as any).__TAURI_INTERNALS__) {
      const { DEMO_MERGE_REQUESTS } = await import('../features/mr/fixtures');
      const found = DEMO_MERGE_REQUESTS.find((m) => m.iid === iid);
      if (!found) throw new Error(`MR !${iid} not found`);
      return { ...found, state: 'merged', detailedMergeStatus: 'merged' };
    }
    return invoke<MergeRequest>('mr_merge', { root: root ?? null, iid, params });
  },

  async mrCancelMwps(iid: number, root?: string): Promise<MergeRequest> {
    if (typeof window !== 'undefined' && !(window as any).__TAURI_INTERNALS__) {
      const { DEMO_MERGE_REQUESTS } = await import('../features/mr/fixtures');
      const found = DEMO_MERGE_REQUESTS.find((m) => m.iid === iid);
      if (!found) throw new Error(`MR !${iid} not found`);
      return found;
    }
    return invoke<MergeRequest>('mr_cancel_mwps', { root: root ?? null, iid });
  },

  async mrCheckout(iid: number, remote?: string, root?: string): Promise<string> {
    if (typeof window !== 'undefined' && !(window as any).__TAURI_INTERNALS__) {
      return `Switched to branch 'mr-${iid}'`;
    }
    return invoke<string>('mr_checkout', { root: root ?? null, iid, remote: remote ?? null });
  },

  async mrEvaluateMergeStatus(status?: string): Promise<MergeStatusEvaluation> {
    return invoke<MergeStatusEvaluation>('mr_evaluate_merge_status', { status: status ?? null });
  },

  async mrCreate(params: CreateMrParams, root?: string): Promise<MergeRequest> {
    if (typeof window !== 'undefined' && !(window as any).__TAURI_INTERNALS__) {
      const { DEMO_MERGE_REQUESTS, DEMO_CURRENT_USER } = await import('../features/mr/fixtures');
      const newMr: MergeRequest = {
        id: 9999,
        iid: DEMO_MERGE_REQUESTS.length + 1,
        projectId: 1,
        title: params.title,
        description: params.description || '',
        state: 'opened',
        targetBranch: params.targetBranch,
        sourceBranch: params.sourceBranch,
        author: DEMO_CURRENT_USER,
        assignees: [],
        reviewers: [],
        draft: false,
        workInProgress: false,
        sha: 'abc1234',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        webUrl: 'https://code.istar.id/demo',
        hasConflicts: false,
        detailedMergeStatus: 'mergeable',
      };
      return newMr;
    }
    return invoke<MergeRequest>('mr_create', { root: root ?? null, params });
  },

  async mrRebase(iid: number, root?: string): Promise<any> {
    if (typeof window !== 'undefined' && !(window as any).__TAURI_INTERNALS__) {
      return { rebaseInProgress: true };
    }
    return invoke('mr_rebase', { root: root ?? null, iid });
  },

  // ── Agent Commands (Phase 5 Track A) ──────────────────────────────────────
  async agentListSlots(): Promise<SlotSummary[]> {
    if (typeof window !== 'undefined' && !(window as any).__TAURI_INTERNALS__) {
      const { DEMO_SLOTS } = await import('../features/agents/fixtures');
      return DEMO_SLOTS;
    }
    return invoke<SlotSummary[]>('agent_list_slots');
  },

  async agentStart(slotId: string): Promise<SlotSummary> {
    if (typeof window !== 'undefined' && !(window as any).__TAURI_INTERNALS__) {
      const { DEMO_SLOTS } = await import('../features/agents/fixtures');
      const found = DEMO_SLOTS.find((s) => s.id === slotId) || DEMO_SLOTS[0];
      return { ...found, status: 'ready' };
    }
    return invoke<SlotSummary>('agent_start', { slotId });
  },

  async agentPrompt(slotId: string, prompt: string): Promise<PromptResponse> {
    if (typeof window !== 'undefined' && !(window as any).__TAURI_INTERNALS__) {
      return {
        sessionId: `demo-${slotId}`,
        message: `[DEMO] Agent responded to: "${prompt}"`,
        stopReason: 'end_turn',
      };
    }
    return invoke<PromptResponse>('agent_prompt', { slotId, prompt });
  },

  async agentCancel(slotId: string): Promise<void> {
    if (typeof window !== 'undefined' && !(window as any).__TAURI_INTERNALS__) {
      return;
    }
    return invoke('agent_cancel', { slotId });
  },

  async agentStop(slotId: string): Promise<void> {
    if (typeof window !== 'undefined' && !(window as any).__TAURI_INTERNALS__) {
      return;
    }
    return invoke('agent_stop', { slotId });
  },

  async agentDetectHermes(): Promise<HermesDetectionResult> {
    if (typeof window !== 'undefined' && !(window as any).__TAURI_INTERNALS__) {
      const { DEMO_HERMES_DETECTION } = await import('../features/agents/fixtures');
      return DEMO_HERMES_DETECTION;
    }
    return invoke<HermesDetectionResult>('agent_detect_hermes');
  },

  async agentGetSupportedEngines(): Promise<SupportedEngineInfo[]> {
    if (typeof window === 'undefined' || !(window as any).__TAURI_INTERNALS__) {
      return [
        {
          id: 'hermes',
          name: 'Hermes Agent',
          detected: true,
          available: true,
          status: 'Hermes profiles found',
          allowedModels: ['ag/gemini-3.8-flash-high', 'ag/claude-opus-4-6-thinking', 'anthropic/claude-sonnet-4', 'openai/gpt-4o'],
          models: ['ag/gemini-3.8-flash-high', 'ag/claude-opus-4-6-thinking', 'anthropic/claude-sonnet-4', 'openai/gpt-4o'],
          defaultModel: 'ag/gemini-3.8-flash-high',
          description: 'Daemon profil lokal Hermes CLI',
        },
        {
          id: 'claude-code',
          name: 'Claude Code CLI',
          detected: true,
          available: true,
          status: 'npx found',
          allowedModels: ['claude-3-7-sonnet', 'claude-3-5-sonnet', 'claude-3-opus'],
          models: ['claude-3-7-sonnet', 'claude-3-5-sonnet', 'claude-3-opus'],
          defaultModel: 'claude-3-7-sonnet',
          description: 'Anthropic Standalone CLI via ACP',
        },
        {
          id: 'antigravity',
          name: 'Antigravity (via 9Router)',
          detected: true,
          available: true,
          status: '9Router online',
          allowedModels: ['ag/gemini-3.8-flash-high', 'ag/claude-opus-4.1', 'ag/claude-opus-4-6-thinking'],
          models: ['ag/gemini-3.8-flash-high', 'ag/claude-opus-4.1', 'ag/claude-opus-4-6-thinking'],
          defaultModel: 'ag/gemini-3.8-flash-high',
          description: 'Google Gemini & Claude Opus via 9Router proxy',
        },
        {
          id: 'openai',
          name: 'OpenAI Codex',
          detected: true,
          available: true,
          status: 'API key found',
          allowedModels: ['gpt-4o', 'o3-mini', 'o1'],
          models: ['gpt-4o', 'o3-mini', 'o1'],
          defaultModel: 'gpt-4o',
          description: 'OpenAI Autonomous Agent via ACP',
        },
        {
          id: 'codex',
          name: 'OpenAI Codex',
          detected: true,
          available: true,
          status: 'API key found',
          allowedModels: ['gpt-4o', 'o3-mini', 'o1'],
          models: ['gpt-4o', 'o3-mini', 'o1'],
          defaultModel: 'gpt-4o',
          description: 'OpenAI Autonomous Agent via ACP',
        },
        {
          id: 'acp-custom',
          name: 'Custom ACP Command',
          detected: true,
          available: true,
          status: 'Custom command',
          allowedModels: [],
          models: ['custom-model'],
          defaultModel: 'custom-model',
          description: 'Perintah terminal bebas via stdio ACP',
        },
      ];
    }
    return invoke<SupportedEngineInfo[]>('agent_get_supported_engines');
  },

  async agentGetRoleScopes(): Promise<RoleScopeInfo[]> {
    if (typeof window !== 'undefined' && !(window as any).__TAURI_INTERNALS__) {
      const { ROLE_SCOPE_DEFINITIONS } = await import('../features/agents/agentsLogic.ts');
      return ROLE_SCOPE_DEFINITIONS;
    }
    try {
      return await invoke<RoleScopeInfo[]>('agent_get_role_scopes');
    } catch {
      const { ROLE_SCOPE_DEFINITIONS } = await import('../features/agents/agentsLogic.ts');
      return ROLE_SCOPE_DEFINITIONS;
    }
  },

  async agentLoadTeam(): Promise<TeamConfig> {
    if (typeof window !== 'undefined' && !(window as any).__TAURI_INTERNALS__) {
      const { DEMO_TEAM_CONFIG } = await import('../features/agents/fixtures');
      return DEMO_TEAM_CONFIG;
    }
    return invoke<TeamConfig>('agent_load_team');
  },

  async agentSaveTeam(team: TeamConfig): Promise<string> {
    if (typeof window !== 'undefined' && !(window as any).__TAURI_INTERNALS__) {
      return '.petak/team.json';
    }
    return invoke<string>('agent_save_team', { team });
  },

  async agentAddSlot(config: SlotConfig): Promise<SlotSummary> {
    if (typeof window !== 'undefined' && !(window as any).__TAURI_INTERNALS__) {
      return {
        id: config.id,
        label: config.label,
        kind: config.kind,
        status: 'idle',
        capabilities: { load_session: false, supports_set_model: false, available_models: [] },
        history_len: 0,
        config,
      };
    }
    return invoke<SlotSummary>('agent_add_slot', { config });
  },

  async agentUpdateSlot(config: SlotConfig): Promise<SlotSummary> {
    if (typeof window !== 'undefined' && !(window as any).__TAURI_INTERNALS__) {
      return {
        id: config.id,
        label: config.label,
        kind: config.kind,
        status: 'idle',
        capabilities: { load_session: false, supports_set_model: false, available_models: [] },
        history_len: 0,
        config,
      };
    }
    return invoke<SlotSummary>('agent_update_slot', { config });
  },

  async agentRemoveSlot(slotId: string): Promise<void> {
    if (typeof window !== 'undefined' && !(window as any).__TAURI_INTERNALS__) {
      return;
    }
    return invoke('agent_remove_slot', { slotId });
  },

  async agentGetAllowlist(): Promise<string[]> {
    if (typeof window !== 'undefined' && !(window as any).__TAURI_INTERNALS__) {
      const { DEFAULT_ALLOWLIST } = await import('../features/agents/agentsLogic');
      return DEFAULT_ALLOWLIST;
    }
    return invoke<string[]>('agent_get_allowlist');
  },

  async agentSetAllowlist(allowlist: string[]): Promise<void> {
    if (typeof window !== 'undefined' && !(window as any).__TAURI_INTERNALS__) {
      return;
    }
    return invoke('agent_set_allowlist', { allowlist });
  },

  async agentListPendingPermissions(): Promise<PendingPermissionRequest[]> {
    if (typeof window !== 'undefined' && !(window as any).__TAURI_INTERNALS__) {
      const { DEMO_PENDING_PERMISSIONS } = await import('../features/agents/fixtures');
      return DEMO_PENDING_PERMISSIONS;
    }
    return invoke<PendingPermissionRequest[]>('agent_list_pending_permissions');
  },

  async agentRespondPermission(requestId: string, allow: boolean): Promise<void> {
    if (typeof window !== 'undefined' && !(window as any).__TAURI_INTERNALS__) {
      return;
    }
    return invoke('agent_respond_permission', { requestId, allow });
  },

  async agentListProposals(slotId?: string): Promise<Proposal[]> {
    if (typeof window !== 'undefined' && !(window as any).__TAURI_INTERNALS__) {
      const { DEMO_PROPOSALS } = await import('../features/agents/fixtures');
      return slotId ? DEMO_PROPOSALS.filter((p) => p.slotId === slotId) : DEMO_PROPOSALS;
    }
    return invoke<Proposal[]>('agent_list_proposals', { slotId: slotId ?? null });
  },

  async agentAcceptProposal(proposalId: string): Promise<void> {
    if (typeof window !== 'undefined' && !(window as any).__TAURI_INTERNALS__) {
      return;
    }
    return invoke('agent_accept_proposal', { proposalId });
  },

  async agentRejectProposal(proposalId: string): Promise<void> {
    if (typeof window !== 'undefined' && !(window as any).__TAURI_INTERNALS__) {
      return;
    }
    return invoke('agent_reject_proposal', { proposalId });
  },

  async agentAcceptHunk(proposalId: string, hunkIdx: number): Promise<void> {
    if (typeof window !== 'undefined' && !(window as any).__TAURI_INTERNALS__) {
      return;
    }
    return invoke('agent_accept_hunk', { proposalId, hunkIdx });
  },

  async agentGetUsage(slotId: string): Promise<UsageReport> {
    if (typeof window !== 'undefined' && !(window as any).__TAURI_INTERNALS__) {
      const { DEMO_USAGE_REPORTS } = await import('../features/agents/fixtures');
      return DEMO_USAGE_REPORTS[slotId] || { reported: false, displayText: 'tidak melapor' };
    }
    return invoke<UsageReport>('agent_get_usage', { slotId });
  },

  // ── 9Router Quota & Project Memory (Phase 5) ─────────────────────────────
  async agentGetQuotaReport(): Promise<LlmQuotaReport> {
    if (typeof window === 'undefined' || !(window as any).__TAURI_INTERNALS__) {
      return {
        proxyOnline: false,
        dbFound: false,
        todayDate: new Date().toISOString().slice(0, 10),
        todayRequests: 0,
        todayPromptTokens: 0,
        todayCompletionTokens: 0,
        todayCost: 0,
        providers: [],
        statusMessage: 'Database kuota 9Router tidak ditemukan di ~/.9router/db/data.sqlite',
      };
    }
    return invoke<LlmQuotaReport>('agent_get_quota_report');
  },

  async agentListProjectMemory(): Promise<MemoryItem[]> {
    if (typeof window === 'undefined' || !(window as any).__TAURI_INTERNALS__) {
      return mockMemoryStore.list();
    }
    return invoke<MemoryItem[]>('agent_list_project_memory');
  },

  async agentReadProjectMemory(filename: string): Promise<string> {
    if (typeof window === 'undefined' || !(window as any).__TAURI_INTERNALS__) {
      return mockMemoryStore.read(filename);
    }
    return invoke<string>('agent_read_project_memory', { filename });
  },

  async agentSaveProjectMemory(filename: string, content: string): Promise<void> {
    if (typeof window === 'undefined' || !(window as any).__TAURI_INTERNALS__) {
      mockMemoryStore.save(filename, content);
      return;
    }
    return invoke('agent_save_project_memory', { filename, content });
  },

  async agentOpenInObsidian(filename?: string | null): Promise<void> {
    if (typeof window === 'undefined' || !(window as any).__TAURI_INTERNALS__) {
      console.log('Mock open in obsidian:', filename);
      return;
    }
    return invoke('agent_open_in_obsidian', { filename: filename || null });
  },

  async agentMcpGetConfig(root?: string): Promise<McpConfig> {
    if (typeof window === 'undefined' || !(window as any).__TAURI_INTERNALS__) {
      return mockMcpStore.getConfig(root);
    }
    return invoke<McpConfig>('agent_mcp_get_config', { root: root || null });
  },

  async agentMcpSaveConfig(config: McpConfig, root?: string): Promise<void> {
    if (typeof window === 'undefined' || !(window as any).__TAURI_INTERNALS__) {
      mockMcpStore.saveConfig(config, root);
      return;
    }
    return invoke('agent_mcp_save_config', { root: root || null, config });
  },

  async agentMcpTestServer(command: string, args: string[], env: Record<string, string>): Promise<McpTestResult> {
    if (typeof window === 'undefined' || !(window as any).__TAURI_INTERNALS__) {
      return mockMcpStore.testServer(command, args, env);
    }
    return invoke<McpTestResult>('agent_mcp_test_server', { command, args, env });
  },

  async testListFlows(root?: string): Promise<Flow[]> {
    if (typeof window === 'undefined' || !(window as any).__TAURI_INTERNALS__) {
      return mockFlowStore.listFlows(root);
    }
    return invoke<Flow[]>('test_list_flows', { root: root || null });
  },

  async testRunFlow(flowId: string, deviceSerial?: string, root?: string): Promise<FlowRunResult> {
    if (typeof window === 'undefined' || !(window as any).__TAURI_INTERNALS__) {
      return mockFlowStore.runFlow(flowId, deviceSerial, root);
    }
    return invoke<FlowRunResult>('test_run_flow', { flowId, deviceSerial: deviceSerial || null, root: root || null });
  },

  async testCancelFlow(flowId: string): Promise<boolean> {
    if (typeof window === 'undefined' || !(window as any).__TAURI_INTERNALS__) {
      return mockFlowStore.cancelFlow(flowId);
    }
    return invoke<boolean>('test_cancel_flow', { flowId });
  },

  async testCreateFlow(name: string, appId?: string, steps: FlowStep[] = [], root?: string): Promise<Flow> {
    if (typeof window === 'undefined' || !(window as any).__TAURI_INTERNALS__) {
      return mockFlowStore.createFlow(name, appId, steps, root);
    }
    return invoke<Flow>('test_create_flow', { name, appId: appId || null, steps, root: root || null });
  },

  async agentSkillsList(root?: string): Promise<SkillSummary[]> {
    if (typeof window === 'undefined' || !(window as any).__TAURI_INTERNALS__) {
      return mockSkillStore.list(root);
    }
    return invoke<SkillSummary[]>('agent_skills_list', { root: root || null });
  },

  async agentSkillGet(name: string, root?: string): Promise<Skill> {
    if (typeof window === 'undefined' || !(window as any).__TAURI_INTERNALS__) {
      return mockSkillStore.get(name, root);
    }
    return invoke<Skill>('agent_skill_get', { name, root: root || null });
  },

  async agentSkillSave(name: string, description: string, content: string, root?: string): Promise<Skill> {
    if (typeof window === 'undefined' || !(window as any).__TAURI_INTERNALS__) {
      return mockSkillStore.save(name, description, content, root);
    }
    return invoke<Skill>('agent_skill_save', { name, description, content, root: root || null });
  },

  async agentSkillDelete(name: string, root?: string): Promise<boolean> {
    if (typeof window === 'undefined' || !(window as any).__TAURI_INTERNALS__) {
      return mockSkillStore.delete(name, root);
    }
    return invoke<boolean>('agent_skill_delete', { name, root: root || null });
  },
};

const mockFlowStore = {
  flows: [
    {
      id: 'flow-login',
      name: 'Login Flow',
      description: 'Test login form authentication',
      appId: 'com.example.app',
      tags: ['smoke', 'auth'],
      steps: [
        { id: 's1', action: 'tap', selector: '#login-btn', description: 'Tap login button' },
        { id: 's2', action: 'input', selector: '#username', text: 'testuser', description: 'Enter username' },
      ],
    },
  ] as Flow[],
  listFlows(_root?: string): Flow[] {
    return JSON.parse(JSON.stringify(this.flows));
  },
  async runFlow(flowId: string, _deviceSerial?: string, _root?: string): Promise<FlowRunResult> {
    const flow = this.flows.find((f) => f.id === flowId);
    const steps = flow ? flow.steps : [];
    const stepResults: FlowStepStatus[] = steps.map((s) => ({
      stepId: s.id,
      status: 'passed',
      durationMs: 120,
    }));
    return {
      flowId,
      success: true,
      totalSteps: steps.length,
      passedSteps: steps.length,
      failedSteps: 0,
      durationMs: steps.length * 120,
      runner: 'adb',
      stepResults,
    };
  },
  cancelFlow(_flowId: string): boolean {
    return true;
  },
  createFlow(name: string, appId?: string, steps: FlowStep[] = [], _root?: string): Flow {
    const newFlow: Flow = {
      id: `flow-${Date.now()}`,
      name,
      description: `Scenario for ${name}`,
      appId: appId || undefined,
      steps: steps || [],
      tags: ['custom'],
    };
    this.flows.push(newFlow);
    return JSON.parse(JSON.stringify(newFlow));
  },
};

const mockMcpStore = {
  config: {
    mcpServers: {
      filesystem: {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem', '.'],
        env: {},
        disabled: false,
        autoApprove: ['read_file', 'list_directory'],
      },
    },
  } as McpConfig,
  getConfig(_root?: string): McpConfig {
    return JSON.parse(JSON.stringify(this.config));
  },
  saveConfig(config: McpConfig, _root?: string): void {
    this.config = JSON.parse(JSON.stringify(config || { mcpServers: {} }));
  },
  async testServer(command: string, _args: string[], _env: Record<string, string>): Promise<McpTestResult> {
    if (!command || command.includes('fail') || command.includes('error')) {
      return { ok: false, error: 'Failed to spawn MCP server process' };
    }
    return { ok: true, latencyMs: 14, serverInfo: 'Mock MCP Server v1.0.0' };
  },
};

const mockMemoryStore = {
  items: [
    { filename: 'lessons.md', title: 'Lessons Learned', size: 142, updatedAt: 1727800000000 },
    { filename: 'decisions.md', title: 'Architecture Decisions', size: 285, updatedAt: 1727850000000 },
    { filename: 'rules.md', title: 'Coding Rules', size: 95, updatedAt: 1727900000000 },
  ] as MemoryItem[],
  contents: {
    'lessons.md': '# Lessons Learned\n\n- Selalu jalankan npm test dan npm run check sebelum commit.\n- Minimalkan diff (prinsip Ponytail).',
    'decisions.md': '# Architecture Decisions\n\n- Petak Fase 5 menggunakan ACP via stdio.\n- Live quota probe 9Router SQLite tanpa data palsu.',
    'rules.md': '# Coding Rules\n\n- Dilarang membuat angka fiktif jika DB tidak ada.\n- Sanitasi filename markdown.',
  } as Record<string, string>,
  list(): MemoryItem[] {
    return [...this.items];
  },
  read(filename: string): string {
    return this.contents[filename] ?? '';
  },
  save(filename: string, content: string): void {
    this.contents[filename] = content;
    const existing = this.items.find((item) => item.filename === filename);
    const size = new TextEncoder().encode(content).length;
    const updatedAt = Date.now();
    if (existing) {
      existing.size = size;
      existing.updatedAt = updatedAt;
    } else {
      const title = filename.replace(/\.md$/i, '').replace(/[-_]/g, ' ');
      this.items.push({ filename, title, size, updatedAt });
    }
  },
};

const mockSkillStore = {
  skills: [
    {
      name: 'ponytail',
      description: 'Forces the laziest solution that actually works, simplest, shortest, minimal.',
      content: 'Forces the laziest solution that actually works, simplest, shortest, minimal diff.',
      isCore: true,
      scope: 'system',
      path: '~/.hermes/skills/ponytail/SKILL.md',
    },
    {
      name: 'caveman',
      description: 'Terse technical communication, eliminates conversational filler.',
      content: 'Terse technical communication, eliminates conversational filler and pleasantries.',
      isCore: true,
      scope: 'system',
      path: '~/.hermes/skills/caveman/SKILL.md',
    },
  ] as Skill[],

  list(_root?: string): SkillSummary[] {
    return this.skills.map(({ name, description, isCore, scope, path }) => ({
      name,
      description,
      isCore,
      scope,
      path,
    }));
  },

  get(name: string, _root?: string): Skill {
    const found = this.skills.find((s) => s.name === name);
    if (!found) {
      throw new Error(`Skill not found: ${name}`);
    }
    return JSON.parse(JSON.stringify(found));
  },

  save(name: string, description: string, content: string, _root?: string): Skill {
    const existing = this.skills.find((s) => s.name === name);
    if (existing) {
      existing.description = description;
      existing.content = content;
      return JSON.parse(JSON.stringify(existing));
    }
    const newSkill: Skill = {
      name,
      description,
      content,
      isCore: false,
      scope: 'project',
      path: `.petak/skills/${name}/SKILL.md`,
    };
    this.skills.push(newSkill);
    return JSON.parse(JSON.stringify(newSkill));
  },

  delete(name: string, _root?: string): boolean {
    const idx = this.skills.findIndex((s) => s.name === name);
    if (idx === -1) return false;
    if (this.skills[idx].isCore || name === 'ponytail' || name === 'caveman') {
      throw new Error(`Cannot delete core skill: ${name}`);
    }
    this.skills.splice(idx, 1);
    return true;
  },
};
