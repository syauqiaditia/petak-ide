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
