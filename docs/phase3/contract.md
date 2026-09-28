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
