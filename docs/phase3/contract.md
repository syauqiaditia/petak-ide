# Kontrak API Git Tauri ↔ TypeScript (Fase 3)

Tabel kontrak antarmuka Tauri command (`crates/app/src/commands.rs`) dan frontend (`ui/lib/api.ts`).
Seluruh model data memakai serde `rename_all = "camelCase"` dari `petak_core::git::model`.

## 1. Daftar Command

| Tauri Command | JS invoke name | Parameter (Tauri / JS camelCase) | Return Type (Rust / TS) | Keterangan |
|---|---|---|---|---|
| `git_status` | `git_status` | `root: String` | `petak_core::git::RepoStatus` / `GitRepoStatus` | Status porcelain v2: branch info (ahead/behind/detached) + entries |
| `git_diff` | `git_diff` | `root: String`, `kind: String` (`"worktree"` \| `"staged"` \| `"commit"`), `sha: Option<String>`, `path: Option<String>`, `ignore_ws: Option<bool>` (`ignoreWs`) | `Vec<petak_core::git::DiffFile>` / `GitDiffFile[]` | Parsed git diff per file dan per hunk |
| `git_stage_files` | `git_stage_files` | `root: String`, `paths: Vec<String>` | `()` / `void` | `git add -- <paths>` |
| `git_unstage_files` | `git_unstage_files` | `root: String`, `paths: Vec<String>` | `()` / `void` | `git restore --staged -- <paths>` (fallback `rm --cached`) |
| `git_stage_hunk` | `git_stage_hunk` | `root: String`, `path: String`, `hunk_index: usize` (`hunkIndex`) | `()` / `void` | Diff worktree file → build patch hunk → `git apply --cached` |
| `git_unstage_hunk` | `git_unstage_hunk` | `root: String`, `path: String`, `hunk_index: usize` (`hunkIndex`) | `()` / `void` | Diff staged file → build patch hunk → `git apply --cached --reverse` |
| `git_commit` | `git_commit` | `root: String`, `message: String`, `amend: bool` | `String` / `string` | `git commit [-amend] -F -` |
| `git_last_message` | `git_last_message` | `root: String` | `Option<String>` / `string \| null` | `git log -1 --format=%B` (null jika repo kosong) |
| `git_log` | `git_log` | `root: String`, `filter: Option<LogFilter>`, `cursor: Option<usize>`, `limit: Option<usize>` | `petak_core::git::LogPage` / `GitLogPage` | Paged log dengan layout lane graph |
| `git_branches` | `git_branches` | `root: String` | `petak_core::git::BranchList` / `GitBranchList` | Local branches, remote branches, dan tags dalam 1 panggilan |
| `git_commit_files` | `git_commit_files` | `root: String`, `sha: String` | `Vec<petak_core::git::CommitFile>` / `GitCommitFile[]` | Daftar nama file + status perubahan dari `git show --name-status` |
| `git_rebase_todo` | `git_rebase_todo` | `root: String`, `base: String` | `Vec<petak_core::git::RebaseItem>` / `GitRebaseItem[]` | Daftar commit untuk interactive rebase plan |
| `git_rebase_run` | `git_rebase_run` | `root: String`, `plan: RebasePlan` | `petak_core::git::OpResult` / `GitOpResult` | Menjalankan rebase plan dengan opsi backup ref |
| `git_rebase_continue` | `git_rebase_continue` | `root: String` | `petak_core::git::OpResult` / `GitOpResult` | Melanjutkan rebase setelah resolusi konflik |
| `git_rebase_abort` | `git_rebase_abort` | `root: String` | `()` / `void` | Membatalkan rebase dan mengembalikan worktree |
| `git_rebase_state` | `git_rebase_state` | `root: String` | `petak_core::git::RebaseState` / `GitRebaseState` | Status rebase yang sedang berjalan |
| `git_reword` | `git_reword` | `root: String`, `sha: String`, `message: String` | `petak_core::git::OpResult` / `GitOpResult` | Mengubah commit message (auto backup) |
| `git_squash` | `git_squash` | `root: String`, `shas: Vec<String>`, `message: String` | `petak_core::git::OpResult` / `GitOpResult` | Menggabungkan >=2 commit berurutan (auto backup) |
| `git_fixup` | `git_fixup` | `root: String`, `sha: String` | `petak_core::git::OpResult` / `GitOpResult` | Fixup commit ke commit sebelumnya (auto backup) |
| `git_drop` | `git_drop` | `root: String`, `shas: Vec<String>` | `petak_core::git::OpResult` / `GitOpResult` | Menghapus commit dari riwayat (auto backup) |
| `git_reset` | `git_reset` | `root: String`, `sha: String`, `mode: ResetMode` | `petak_core::git::OpResult` / `GitOpResult` | Reset soft/mixed/hard (hard auto-creates backup) |
| `git_cherry_pick` | `git_cherry_pick` | `root: String`, `shas: Vec<String>` | `petak_core::git::OpResult` / `GitOpResult` | Cherry-pick commit |
| `git_revert` | `git_revert` | `root: String`, `shas: Vec<String>` | `petak_core::git::OpResult` / `GitOpResult` | Revert commit |
| `git_branch_create` | `git_branch_create` | `root: String`, `name: String`, `start_point: Option<String>` | `()` / `void` | Membuat branch baru |
| `git_branch_checkout` | `git_branch_checkout` | `root: String`, `name: String` | `()` / `void` | Pindah branch (checkout) |
| `git_branch_delete` | `git_branch_delete` | `root: String`, `name: String`, `force: bool` | `()` / `void` | Menghapus branch lokal |
| `git_branch_rename` | `git_branch_rename` | `root: String`, `old_name: String`, `new_name: String` | `()` / `void` | Mengganti nama branch |
| `git_backup_create` | `git_backup_create` | `root: String`, `op: String` | `String` / `string` | Membuat backup ref petak |
| `git_backup_list` | `git_backup_list` | `root: String` | `Vec<petak_core::git::BackupRef>` / `GitBackupRef[]` | Daftar backup ref petak |
| `git_backup_restore` | `git_backup_restore` | `root: String`, `name: String` | `()` / `void` | Merestore branch ke state backup ref |
| `git_backup_delete` | `git_backup_delete` | `root: String`, `name: String` | `()` / `void` | Menghapus backup ref |
| `git_conflicts` | `git_conflicts` | `root: String` | `Vec<petak_core::git::ConflictFile>` / `GitConflictFile[]` | Daftar file berkonflik & blok parsed |
| `git_resolve_block` | `git_resolve_block` | `merged: String`, `block_index: usize`, `choice: ConflictChoice` | `String` / `string` | Resolusi blok konflik murni |
| `git_conflict_write` | `git_conflict_write` | `root: String`, `path: String`, `content: String` | `()` / `void` | Menulis file hasil resolusi konflik |
| `git_op_state` | `git_op_state` | `root: String` | `petak_core::git::OpState` / `GitOpState` | Status operasi berlangsung (rebase/merge/cherry-pick/revert) |
| `git_op_continue` | `git_op_continue` | `root: String` | `petak_core::git::OpResult` / `GitOpResult` | Melanjutkan operasi yang berhenti |
| `git_op_abort` | `git_op_abort` | `root: String` | `()` / `void` | Membatalkan operasi yang berhenti |
| `git_remotes` | `git_remotes` | `root: String` | `Vec<petak_core::git::Remote>` / `GitRemote[]` | Daftar configured remote |
| `git_fetch` | `git_fetch` | `root: String`, `remote: Option<String>`, `prune: Option<bool>` | `()` / `void` | Fetch update dari remote |
| `git_pull` | `git_pull` | `root: String`, `mode: PullMode` | `petak_core::git::OpResult` / `GitOpResult` | Pull rebase atau merge |
| `git_push` | `git_push` | `root: String`, `remote: String`, `branch: String`, `set_upstream: bool`, `force_with_lease: bool` | `petak_core::git::OpResult` / `GitOpResult` | Push branch ke remote |

## 2. Model & Tipe Data

### FileState (Enum)
Rust: `petak_core::git::model::FileState` (`rename_all = "camelCase"`)
TS: `'unmodified' | 'modified' | 'added' | 'deleted' | 'renamed' | 'copied' | 'untracked' | 'ignored' | 'typeChanged'`

### StatusEntry
Rust:
```rust
pub struct StatusEntry {
    pub path: String,
    pub orig_path: Option<String>,
    pub index: FileState,
    pub worktree: FileState,
    pub conflicted: bool,
}
```
TS (`GitStatusEntry`):
```typescript
{
  path: string;
  origPath?: string | null;
  index: GitFileState;
  worktree: GitFileState;
  conflicted: boolean;
}
```

### BranchInfo
Rust:
```rust
pub struct BranchInfo {
    pub head: String,
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    pub detached: bool,
}
```
TS (`GitBranchInfo`):
```typescript
{
  head: string;
  upstream?: string | null;
  ahead: number;
  behind: number;
  detached: boolean;
}
```

### DiffLineKind
Rust: `petak_core::git::model::DiffLineKind` (`rename_all = "camelCase"`)
TS: `'context' | 'add' | 'del' | 'noNewline'`

### DiffLine
Rust:
```rust
pub struct DiffLine {
    pub kind: DiffLineKind,
    pub text: String,
    pub old_no: Option<u32>,
    pub new_no: Option<u32>,
}
```
TS (`GitDiffLine`):
```typescript
{
  kind: GitDiffLineKind;
  text: string;
  oldNo?: number | null;
  newNo?: number | null;
}
```

### Hunk
Rust:
```rust
pub struct Hunk {
    pub old_start: u32,
    pub old_lines: u32,
    pub new_start: u32,
    pub new_lines: u32,
    pub header: String,
    pub lines: Vec<DiffLine>,
}
```
TS (`GitHunk`):
```typescript
{
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  header: string;
  lines: GitDiffLine[];
}
```

### DiffFile
Rust:
```rust
pub struct DiffFile {
    pub old_path: Option<String>,
    pub new_path: Option<String>,
    pub status: FileState,
    pub binary: bool,
    pub hunks: Vec<Hunk>,
}
```
TS (`GitDiffFile`):
```typescript
{
  oldPath?: string | null;
  newPath?: string | null;
  status: GitFileState;
  binary: boolean;
  hunks: GitHunk[];
}
```

### CommitFile
Rust: `petak_core::git::CommitFile`
```rust
pub struct CommitFile {
    pub path: String,
    pub status: FileState,
}
```
TS (`GitCommitFile`):
```typescript
{
  path: string;
  status: GitFileState;
}
```

### Edge & GraphRow
Rust: `petak_core::git::{Edge, GraphRow, EdgeKind}`
TS (`GitEdge`, `GitGraphRow`):
```typescript
type GitEdgeKind = 'straight' | 'mergeIn' | 'branchOut';

interface GitEdge {
  from: number;
  to: number;
  kind: GitEdgeKind;
  color: number;
}

interface GitGraphRow {
  lane: number;
  color: number;
  edges: GitEdge[];
}
```

### Commit & LogPage
Rust: `petak_core::git::{Commit, RefLabel, RefKind, LogPage, LogFilter}`
TS (`GitCommit`, `GitLogPage`, `GitLogFilter`):
```typescript
type GitRefKind = 'head' | 'branch' | 'remote' | 'tag';

interface GitRefLabel {
  kind: GitRefKind;
  name: string;
  isCurrent: boolean;
}

interface GitCommit {
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

interface GitLogPage {
  commits: GitCommit[];
  graph: GitGraphRow[];
  nextCursor: number | null;
}

interface GitLogFilter {
  branches?: string[];
  author?: string;
  since?: string;
  until?: string;
  path?: string;
  text?: string;
}
```

### BranchList
Rust: `petak_core::git::{BranchList, LocalBranch, RemoteBranch, TagRef}`
TS (`GitBranchList`):
```typescript
interface GitLocalBranch {
  name: string;
  upstream?: string | null;
  ahead: number;
  behind: number;
  isCurrent: boolean;
  sha: string;
}

interface GitRemoteBranch {
  name: string;
  sha: string;
}

interface GitTagRef {
  name: string;
  sha: string;
}

interface GitBranchList {
  local: GitLocalBranch[];
  remote: GitRemoteBranch[];
  tags: GitTagRef[];
}
```

### RebasePlan & RebaseItem
Rust: `petak_core::git::{RebasePlan, RebaseItem, RebaseAction}`
TS:
```typescript
type GitRebaseAction = 'pick' | 'reword' | 'edit' | 'squash' | 'fixup' | 'drop';

interface GitRebaseItem {
  sha: string;
  action: GitRebaseAction;
  message?: string | null;
}

interface GitRebasePlan {
  base: string;
  items: GitRebaseItem[];
  backup: boolean;
}
```

### OpResult & BackupRef
Rust: `petak_core::git::{OpResult, StopReason, StopKind, BackupRef, ResetMode}`
TS:
```typescript
type GitStopKind = 'conflict' | 'edit';

interface GitStopReason {
  kind: GitStopKind;
  sha: string;
}

interface GitOpResult {
  ok: boolean;
  backupRef?: string | null;
  stoppedAt?: GitStopReason | null;
  newHead: string;
}

interface GitBackupRef {
  name: string;
  sha: string;
  createdAt: string;
  op: string;
  subject: string;
}

type GitResetMode = 'soft' | 'mixed' | 'hard';
```

### ConflictFile, ConflictBlock, ConflictChoice & OpState
Rust: `petak_core::git::{ConflictFile, ConflictBlock, ConflictChoice, ConflictSide, RebaseState, RebaseStateKind}`
TS:
```typescript
type GitConflictSide = 'ours' | 'theirs';

interface GitConflictBlock {
  startLine: number;
  endLine: number;
  ours: string[];
  base?: string[] | null;
  theirs: string[];
}

interface GitConflictFile {
  path: string;
  ours: string;
  theirs: string;
  base?: string | null;
  merged: string;
  blocks: GitConflictBlock[];
  deletedIn?: GitConflictSide | null;
}

type GitConflictChoice = 'ours' | 'theirs' | 'both' | 'bothTheirsFirst';

type GitRebaseStateKind = 'none' | 'rebase' | 'merge' | 'cherryPick' | 'revert';

interface GitRebaseState {
  kind: GitRebaseStateKind;
  step?: [number, number] | null;
  headName?: string | null;
  ontoName?: string | null;
  currentCommit?: string | null;
}

type GitOpState = GitRebaseState;
```

### Remote & PullMode
Rust: `petak_core::git::{Remote, PullMode}`
TS:
```typescript
interface GitRemote {
  name: string;
  fetchUrl?: string | null;
  pushUrl?: string | null;
}

type GitPullMode = 'rebase' | 'merge';
```

