export type GitFileState =
  | 'unmodified'
  | 'modified'
  | 'added'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'untracked'
  | 'ignored'
  | 'typeChanged';

export interface GitStatusEntry {
  path: string;
  origPath?: string | null;
  index: GitFileState;
  worktree: GitFileState;
  conflicted: boolean;
}

export interface GitBranchInfo {
  head: string;
  upstream?: string | null;
  ahead: number;
  behind: number;
  detached: boolean;
}

export interface GitRepoStatus {
  branch: GitBranchInfo;
  entries: GitStatusEntry[];
}

export type GitDiffLineKind = 'context' | 'add' | 'del' | 'noNewline';

export interface GitDiffLine {
  kind: GitDiffLineKind;
  text: string;
  oldNo?: number | null;
  newNo?: number | null;
}

export interface GitHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  header: string;
  lines: GitDiffLine[];
}

export interface GitDiffFile {
  oldPath?: string | null;
  newPath?: string | null;
  status: GitFileState;
  binary: boolean;
  hunks: GitHunk[];
}

export interface GitDiffOpts {
  kind: 'worktree' | 'staged' | 'commit';
  sha?: string;
  path?: string;
  ignoreWs?: boolean;
}

export interface GitCommitFile {
  path: string;
  status: GitFileState;
}

export type GitRefKind = 'head' | 'branch' | 'remote' | 'tag';

export interface GitRefLabel {
  kind: GitRefKind;
  name: string;
  isCurrent: boolean;
}

export interface GitCommit {
  sha: string;
  shortSha: string;
  parents: string[];
  authorName: string;
  authorEmail: string;
  authorTime: number;
  subject: string;
  refs: GitRefLabel[];
  pushed: boolean;
}

export type GitEdgeKind = 'straight' | 'mergeIn' | 'branchOut';

export interface GitEdge {
  from: number;
  to: number;
  kind: GitEdgeKind;
  color: number;
}

export interface GitGraphRow {
  lane: number;
  color: number;
  edges: GitEdge[];
}

export interface GitLogPage {
  commits: GitCommit[];
  graph: GitGraphRow[];
  nextCursor: number | null;
}

export interface GitLocalBranch {
  name: string;
  upstream?: string | null;
  ahead: number;
  behind: number;
  isCurrent: boolean;
  sha: string;
}

export interface GitRemoteBranch {
  name: string;
  sha: string;
}

export interface GitTagRef {
  name: string;
  sha: string;
}

export interface GitBranchList {
  local: GitLocalBranch[];
  remote: GitRemoteBranch[];
  tags: GitTagRef[];
}

export interface GitLogFilter {
  branches?: string[];
  author?: string;
  since?: string;
  until?: string;
  path?: string;
  text?: string;
}

export type GitRebaseAction = 'pick' | 'reword' | 'edit' | 'squash' | 'fixup' | 'drop';

export interface GitRebaseItem {
  sha: string;
  action: GitRebaseAction;
  message?: string | null;
}

export interface GitRebasePlan {
  base: string;
  items: GitRebaseItem[];
  backup: boolean;
}

export type GitStopKind = 'conflict' | 'edit';

export interface GitStopReason {
  kind: GitStopKind;
  sha: string;
}

export interface GitOpResult {
  ok: boolean;
  backupRef?: string | null;
  stoppedAt?: GitStopReason | null;
  newHead: string;
  stashConflict?: boolean;
}

export interface GitBackupRef {
  name: string;
  sha: string;
  createdAt: string;
  op: string;
  subject: string;
}

export type GitResetMode = 'soft' | 'mixed' | 'hard';

export type GitRebaseStateKind = 'none' | 'rebase' | 'merge' | 'cherryPick' | 'revert';

export interface GitRebaseState {
  kind: GitRebaseStateKind;
  step?: [number, number] | null;
  headName?: string | null;
  ontoName?: string | null;
  currentCommit?: string | null;
}

export type GitOpState = GitRebaseState;

export type GitConflictSide = 'ours' | 'theirs';

export interface GitConflictBlock {
  startLine: number;
  endLine: number;
  ours: string[];
  base?: string[] | null;
  theirs: string[];
}

export interface GitConflictFile {
  path: string;
  ours: string;
  theirs: string;
  base?: string | null;
  merged: string;
  blocks: GitConflictBlock[];
  deletedIn?: GitConflictSide | null;
}

export type GitConflictChoice = 'ours' | 'theirs' | 'both' | 'bothTheirsFirst';

export interface GitRemote {
  name: string;
  fetchUrl?: string | null;
  pushUrl?: string | null;
}

export type GitPullMode = 'rebase' | 'merge';

