pub mod backup;
pub mod conflict;
pub mod diff;
pub mod graph;
pub mod log;
pub mod model;
pub mod ops;
pub mod path;
pub mod rebase;
pub mod remote;
pub mod status;
pub mod stash;

pub use backup::{backup_create, backup_delete, backup_list, backup_restore};
pub use conflict::{
    conflict_write, conflicts, op_abort, op_continue, op_state, parse_conflict_blocks,
    resolve_block,
};
pub use diff::{
    commit_files, compare_branch, diff_between_refs, diff_commit, diff_stash, diff_staged,
    diff_worktree, parse_diff, parse_name_status, CompareBranchResult, CompareFileEntry,
};
pub use graph::layout;
pub use log::{
    branches, get_pushed_shas, get_refs_map, log, log_with_state, parse_branches_output,
    parse_log_output, parse_tracking,
};
pub use model::{
    BackupRef, BlameLine, BranchInfo, BranchList, Choice, Commit, CommitFile, ConflictBlock, ConflictChoice,
    ConflictFile, ConflictSide, DiffFile, DiffLine, DiffLineKind, Edge, EdgeKind, FileState,
    GraphRow, GraphState, Hunk, LocalBranch, LogFilter, LogPage, OpKind, OpResult, OpState,
    OpStateKind, PullMode, RebaseAction, RebaseItem, RebasePlan, RebaseState, RebaseStateKind,
    RefKind, RefLabel, Remote, RemoteBranch, RepoStatus, ResetMode, StatusEntry, StopKind,
    StopReason, TagRef,
};
pub use ops::{
    branch_checkout, branch_create, branch_delete, branch_rename, build_hunk_patch, checkout_mr,
    checkout_with_stash, cherry_pick, commit, last_commit_message, merge, rebase_onto, reset,
    revert, stage_files, stage_hunk, unstage_files, unstage_hunk, CheckoutResult,
};
pub use path::{
    add_to_gitignore, blame, commit_paths, commit_selected, delete_untracked, diff_path_head,
    diff_path_staged, diff_path_vs_ref, file_at_ref, parse_blame_porcelain, path_history,
    rollback_paths, CommitSelectedResult,
};
pub use rebase::{
    drop, fixup_into_previous, rebase_abort, rebase_continue, rebase_run, rebase_run_with_op,
    rebase_state, rebase_todo, reword, squash,
};
pub use remote::{fetch, pull, push, remotes};
pub use status::{parse_status, status};
pub use stash::{
    stash_apply, stash_apply_file, stash_drop, stash_file_diff, stash_files, stash_list,
    stash_pop, stash_push, StashEntry, StashFileEntry,
};

use std::fs;
use std::path::Path;

/// Reads current git branch or detached commit SHA from `<root>/.git/HEAD`.
///
/// Returns:
/// - `Some(branch_name)` if HEAD points to `ref: refs/heads/<branch>`
/// - `Some(short_sha)` (7 chars) if HEAD is a detached commit SHA
/// - `None` if `<root>` has no `.git` or HEAD cannot be read
pub fn branch<P: AsRef<Path>>(root: P) -> Option<String> {
    let root = root.as_ref();
    let git_path = root.join(".git");

    let head_path = if git_path.is_file() {
        // Handle git worktree or submodule where .git is a file: "gitdir: <path>"
        let content = fs::read_to_string(&git_path).ok()?;
        let path_str = content.trim().strip_prefix("gitdir:")?.trim();
        let p = Path::new(path_str);
        let git_dir = if p.is_relative() {
            root.join(p)
        } else {
            p.to_path_buf()
        };
        git_dir.join("HEAD")
    } else if git_path.is_dir() {
        git_path.join("HEAD")
    } else {
        return None;
    };

    let content = fs::read_to_string(head_path).ok()?;
    let trimmed = content.trim();

    if let Some(branch_name) = trimmed.strip_prefix("ref: refs/heads/") {
        if !branch_name.is_empty() {
            return Some(branch_name.to_string());
        }
    }

    // Detached HEAD: 40-char SHA (or at least 7 hex characters)
    if trimmed.len() >= 7 && trimmed.chars().take(7).all(|c| c.is_ascii_hexdigit()) {
        return Some(trimmed[..7].to_string());
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::File;
    use std::io::Write;

    #[test]
    fn test_branch_ref_head() {
        let temp_dir = tempfile::tempdir().unwrap();
        let git_dir = temp_dir.path().join(".git");
        fs::create_dir_all(&git_dir).unwrap();

        let head_file = git_dir.join("HEAD");
        let mut f = File::create(&head_file).unwrap();
        f.write_all(b"ref: refs/heads/feature/login-v2\n").unwrap();

        let b = branch(temp_dir.path());
        assert_eq!(b, Some("feature/login-v2".to_string()));
    }

    #[test]
    fn test_branch_ref_main() {
        let temp_dir = tempfile::tempdir().unwrap();
        let git_dir = temp_dir.path().join(".git");
        fs::create_dir_all(&git_dir).unwrap();

        let head_file = git_dir.join("HEAD");
        let mut f = File::create(&head_file).unwrap();
        f.write_all(b"ref: refs/heads/main\n").unwrap();

        let b = branch(temp_dir.path());
        assert_eq!(b, Some("main".to_string()));
    }

    #[test]
    fn test_branch_detached_head() {
        let temp_dir = tempfile::tempdir().unwrap();
        let git_dir = temp_dir.path().join(".git");
        fs::create_dir_all(&git_dir).unwrap();

        let head_file = git_dir.join("HEAD");
        let mut f = File::create(&head_file).unwrap();
        f.write_all(b"b0ea6c855a82390f779a1f1a566190be2d627b0f\n")
            .unwrap();

        let b = branch(temp_dir.path());
        assert_eq!(b, Some("b0ea6c8".to_string()));
    }

    #[test]
    fn test_branch_no_git() {
        let temp_dir = tempfile::tempdir().unwrap();
        let b = branch(temp_dir.path());
        assert_eq!(b, None);
    }

    #[test]
    fn test_branch_empty_head() {
        let temp_dir = tempfile::tempdir().unwrap();
        let git_dir = temp_dir.path().join(".git");
        fs::create_dir_all(&git_dir).unwrap();

        let head_file = git_dir.join("HEAD");
        let mut f = File::create(&head_file).unwrap();
        f.write_all(b"").unwrap();

        let b = branch(temp_dir.path());
        assert_eq!(b, None);
    }

    #[test]
    fn test_branch_worktree() {
        let temp_dir = tempfile::tempdir().unwrap();
        let main_repo = temp_dir.path().join("main_repo");
        let worktree_repo = temp_dir.path().join("wt_repo");
        let main_git = main_repo.join(".git");
        let wt_git = main_git.join("worktrees").join("wt");

        fs::create_dir_all(&wt_git).unwrap();
        fs::create_dir_all(&worktree_repo).unwrap();

        let mut head = File::create(wt_git.join("HEAD")).unwrap();
        head.write_all(b"ref: refs/heads/wt-branch\n").unwrap();

        let mut git_file = File::create(worktree_repo.join(".git")).unwrap();
        writeln!(git_file, "gitdir: {}", wt_git.display()).unwrap();

        let b = branch(&worktree_repo);
        assert_eq!(b, Some("wt-branch".to_string()));
    }
}
