mod common;

use common::gitrepo::TestRepo;
use petak_core::exec::SystemExec;
use petak_core::git::{
    add_to_gitignore, blame, commit_paths, commit_selected, delete_untracked, diff_path_head,
    diff_path_staged, diff_path_vs_ref, file_at_ref, path_history, rollback_paths,
};
use petak_core::local_history::{list, read, snapshot};
use std::fs;
use tempfile::TempDir;

#[test]
fn test_diff_path_vs_ref_and_head_and_staged() {
    let repo = TestRepo::new();
    let exec = SystemExec;

    repo.write_file("src/a.txt", "hello\n");
    repo.commit("initial commit");

    // Branch feat
    repo.git(&["checkout", "-b", "feat"]);
    repo.write_file("src/a.txt", "hello world\n");
    repo.commit("update a on feat");

    // 1. diff_path_vs_ref vs main branch
    let diffs = diff_path_vs_ref(&exec, repo.path(), "main", "src/a.txt")
        .expect("diff_path_vs_ref should succeed");
    assert_eq!(diffs.len(), 1);
    assert_eq!(diffs[0].path(), "src/a.txt");

    // Folder diff vs main
    let dir_diffs = diff_path_vs_ref(&exec, repo.path(), "main", "src")
        .expect("diff_path_vs_ref on dir should succeed");
    assert_eq!(dir_diffs.len(), 1);
    assert_eq!(dir_diffs[0].path(), "src/a.txt");

    // 2. Uncommitted working tree diff vs HEAD
    repo.write_file("src/a.txt", "hello world working\n");
    let head_diffs = diff_path_head(&exec, repo.path(), "src/a.txt")
        .expect("diff_path_head should succeed");
    assert_eq!(head_diffs.len(), 1);
    assert_eq!(head_diffs[0].path(), "src/a.txt");

    // 3. Staged diff vs HEAD
    repo.git(&["add", "src/a.txt"]);
    let staged_diffs = diff_path_staged(&exec, repo.path(), "src/a.txt")
        .expect("diff_path_staged should succeed");
    assert_eq!(staged_diffs.len(), 1);
    assert_eq!(staged_diffs[0].path(), "src/a.txt");
}

#[test]
fn test_file_at_ref() {
    let repo = TestRepo::new();
    let exec = SystemExec;

    repo.write_file("file.txt", "v1 content\n");
    repo.commit("commit on main");

    repo.git(&["checkout", "-b", "feature"]);
    repo.write_file("file.txt", "v2 content\n");
    repo.commit("commit on feature");

    let at_main = file_at_ref(&exec, repo.path(), "main", "file.txt");
    assert_eq!(at_main.as_deref(), Some("v1 content\n"));

    let at_feat = file_at_ref(&exec, repo.path(), "feature", "file.txt");
    assert_eq!(at_feat.as_deref(), Some("v2 content\n"));

    let at_none = file_at_ref(&exec, repo.path(), "main", "does_not_exist.txt");
    assert_eq!(at_none, None);
}

#[test]
fn test_path_history_follow_and_folder() {
    let repo = TestRepo::new();
    let exec = SystemExec;

    // File rename tracking with --follow
    repo.write_file("original.txt", "line1\n");
    repo.commit("commit 1: original");

    repo.git(&["mv", "original.txt", "renamed.txt"]);
    repo.commit("commit 2: rename to renamed");

    repo.write_file("renamed.txt", "line1\nline2\n");
    repo.commit("commit 3: modify renamed");

    let history = path_history(&exec, repo.path(), "renamed.txt", true, 10, 0)
        .expect("path_history with follow should succeed");
    assert_eq!(history.len(), 3, "history should contain 3 commits through rename");
    assert_eq!(history[0].subject, "commit 3: modify renamed");
    assert_eq!(history[1].subject, "commit 2: rename to renamed");
    assert_eq!(history[2].subject, "commit 1: original");

    // Folder history
    repo.write_file("sub/file_a.txt", "alpha\n");
    repo.commit("commit in sub");

    repo.write_file("other.txt", "beta\n");
    repo.commit("commit outside sub");

    let folder_hist = path_history(&exec, repo.path(), "sub", false, 10, 0)
        .expect("folder history should succeed");
    assert_eq!(folder_hist.len(), 1);
    assert_eq!(folder_hist[0].subject, "commit in sub");
}

#[test]
fn test_blame_multi_author_and_uncommitted() {
    let repo = TestRepo::new();
    let exec = SystemExec;

    // Alice commit line 1
    repo.git(&["config", "user.name", "Alice"]);
    repo.git(&["config", "user.email", "alice@example.com"]);
    repo.write_file("blame_target.txt", "Line 1 by Alice\n");
    repo.commit("Alice first line");

    // Bob commit line 2
    repo.git(&["config", "user.name", "Bob"]);
    repo.git(&["config", "user.email", "bob@example.com"]);
    repo.write_file("blame_target.txt", "Line 1 by Alice\nLine 2 by Bob\n");
    repo.commit("Bob second line");

    // Blame committed file
    let blame_lines = blame(&exec, repo.path(), "blame_target.txt")
        .expect("blame should succeed");
    assert_eq!(blame_lines.len(), 2);
    assert_eq!(blame_lines[0].line, 1);
    assert_eq!(blame_lines[0].author, "Alice");
    assert_eq!(blame_lines[0].summary, "Alice first line");

    assert_eq!(blame_lines[1].line, 2);
    assert_eq!(blame_lines[1].author, "Bob");
    assert_eq!(blame_lines[1].summary, "Bob second line");

    // Add uncommitted line 3
    repo.write_file("blame_target.txt", "Line 1 by Alice\nLine 2 by Bob\nLine 3 Uncommitted\n");
    let blame_with_uncommitted = blame(&exec, repo.path(), "blame_target.txt")
        .expect("blame with uncommitted line should succeed");
    assert_eq!(blame_with_uncommitted.len(), 3);
    assert_eq!(blame_with_uncommitted[2].line, 3);
    assert!(blame_with_uncommitted[2].sha.chars().all(|c| c == '0'));
    assert_eq!(blame_with_uncommitted[2].author, "Not committed");

    // Untracked new file
    repo.write_file("fresh_untracked.txt", "hello\nworld\n");
    let untracked_blame = blame(&exec, repo.path(), "fresh_untracked.txt")
        .expect("blame on untracked file should succeed");
    assert_eq!(untracked_blame.len(), 2);
    for b in untracked_blame {
        assert!(b.sha.chars().all(|c| c == '0'));
        assert_eq!(b.author, "Not committed");
    }
}

#[test]
fn test_rollback_paths_tracked_and_untracked_with_lh_revert() {
    let repo = TestRepo::new();
    let exec = SystemExec;

    // Tracked file
    repo.write_file("tracked.txt", "tracked v1\n");
    repo.commit("add tracked");

    // Working directory changes
    repo.write_file("tracked.txt", "tracked v2 modified\n");
    repo.write_file("untracked.txt", "untracked fresh\n");

    // Simulate LH snapshots before rollback
    let lh_temp = TempDir::new().unwrap();
    let store = lh_temp.path();

    snapshot(store, "tracked.txt", b"tracked v2 modified\n", "before_rollback").unwrap();
    snapshot(store, "untracked.txt", b"untracked fresh\n", "before_rollback").unwrap();

    // Perform rollback
    rollback_paths(&exec, repo.path(), &["tracked.txt", "untracked.txt"])
        .expect("rollback_paths should succeed");

    // Tracked file restored to v1
    assert_eq!(repo.read_file("tracked.txt"), "tracked v1\n");

    // Untracked file removed / trashed
    assert!(!repo.path().join("untracked.txt").exists());

    // Revert both via local history store
    let tracked_entries = list(store, "tracked.txt").unwrap();
    let tracked_rollback_entry = tracked_entries.iter().find(|e| e.kind == "before_rollback").unwrap();
    let tracked_bytes = read(store, &tracked_rollback_entry.id).unwrap();
    fs::write(repo.path().join("tracked.txt"), &tracked_bytes).unwrap();
    assert_eq!(repo.read_file("tracked.txt"), "tracked v2 modified\n");

    let untracked_entries = list(store, "untracked.txt").unwrap();
    let untracked_rollback_entry = untracked_entries.iter().find(|e| e.kind == "before_rollback").unwrap();
    let untracked_bytes = read(store, &untracked_rollback_entry.id).unwrap();
    fs::write(repo.path().join("untracked.txt"), &untracked_bytes).unwrap();
    assert_eq!(repo.read_file("untracked.txt"), "untracked fresh\n");
}

#[test]
fn test_add_to_gitignore_dedup_and_folder() {
    let repo = TestRepo::new();

    // Folder
    fs::create_dir_all(repo.path().join("build_output")).unwrap();
    add_to_gitignore(repo.path(), "build_output").expect("add folder to gitignore");

    let content = repo.read_file(".gitignore");
    assert!(content.contains("/build_output/\n"), "must format folder as /name/");

    // File
    add_to_gitignore(repo.path(), "secret.env").expect("add file to gitignore");
    let content2 = repo.read_file(".gitignore");
    assert!(content2.contains("/secret.env\n"), "must format file as /name");

    // Dedup
    add_to_gitignore(repo.path(), "secret.env").expect("dedup add file to gitignore");
    let content3 = repo.read_file(".gitignore");
    let count = content3.lines().filter(|l| l.trim() == "/secret.env").count();
    assert_eq!(count, 1, "entry must not be duplicated");
}

#[test]
fn test_path_guards_reject_parent_traversal() {
    let repo = TestRepo::new();
    assert!(petak_core::fsops::resolve_in_root(repo.path(), "../secret.txt").is_err());
    assert!(petak_core::fsops::resolve_in_root(repo.path(), "sub/../../secret.txt").is_err());
    assert!(add_to_gitignore(repo.path(), "../escape.txt").is_err());
}

#[test]
fn test_commit_paths_isolated() {
    let repo = TestRepo::new();
    let exec = SystemExec;

    repo.write_file("file_a.txt", "v1\n");
    repo.write_file("file_b.txt", "v1\n");
    repo.commit("initial both");

    repo.write_file("file_a.txt", "v2-a\n");
    repo.write_file("file_b.txt", "v2-b\n");

    commit_paths(&exec, repo.path(), "commit only a", &["file_a.txt"])
        .expect("commit_paths should succeed");

    // file_a should be clean at HEAD
    let diff_a = diff_path_head(&exec, repo.path(), "file_a.txt").unwrap();
    assert!(diff_a.is_empty(), "file_a should have no uncommitted diff vs HEAD");

    // file_b should still be modified in worktree
    let diff_b = diff_path_head(&exec, repo.path(), "file_b.txt").unwrap();
    assert_eq!(diff_b.len(), 1, "file_b should still have diff vs HEAD");
}

#[test]
fn test_commit_selected_in_dummy_repo_3_files_commit_2_leaves_1_dirty() {
    let repo = TestRepo::new();
    let exec = SystemExec;

    // Initial commit
    repo.write_file("file1.txt", "v1-1\n");
    repo.write_file("file2.txt", "v1-2\n");
    repo.write_file("file3.txt", "v1-3\n");
    repo.commit("initial commit");

    // Modify all 3 files
    repo.write_file("file1.txt", "v2-1 modified\n");
    repo.write_file("file2.txt", "v2-2 modified\n");
    repo.write_file("file3.txt", "v2-3 modified\n");

    // Commit 2 files: file1.txt and file2.txt
    let res = commit_selected(&exec, repo.path(), "commit file1 and file2", &["file1.txt", "file2.txt"])
        .expect("commit_selected should succeed");
    assert!(!res.sha.is_empty());

    // Verify file1 and file2 are clean at HEAD
    let diff1 = diff_path_head(&exec, repo.path(), "file1.txt").unwrap();
    assert!(diff1.is_empty(), "file1.txt should be committed and clean");

    let diff2 = diff_path_head(&exec, repo.path(), "file2.txt").unwrap();
    assert!(diff2.is_empty(), "file2.txt should be committed and clean");

    // Verify file3.txt is STILL DIRTY (uncommitted)
    let diff3 = diff_path_head(&exec, repo.path(), "file3.txt").unwrap();
    assert_eq!(diff3.len(), 1, "file3.txt must remain dirty/uncommitted");

    // Check HEAD sha matches returned sha
    let head_sha = petak_core::exec::git(&exec, repo.path(), &["rev-parse", "HEAD"]).unwrap();
    assert_eq!(head_sha.trim(), res.sha);
}

#[test]
fn test_delete_untracked_and_reject_tracked() {
    let repo = TestRepo::new();
    let exec = SystemExec;

    repo.write_file("tracked.txt", "tracked content\n");
    repo.commit("commit tracked.txt");

    // 1. Attempting to delete a tracked file must fail
    let err = delete_untracked(&exec, repo.path(), "tracked.txt").unwrap_err();
    assert!(err.message.contains("tracked"));
    assert!(repo.path().join("tracked.txt").exists());

    // 2. Untracked file
    repo.write_file("untracked_temp.txt", "scratch content\n");
    assert!(repo.path().join("untracked_temp.txt").exists());

    delete_untracked(&exec, repo.path(), "untracked_temp.txt").expect("should delete untracked file");
    assert!(!repo.path().join("untracked_temp.txt").exists(), "untracked file must be deleted");
}
