mod common;

use std::fs;
use std::path::Path;

use common::gitrepo::TestRepo;
use petak_core::exec::SystemExec;
use petak_core::git::{
    commit, diff_commit, diff_staged, diff_worktree, last_commit_message, stage_files, stage_hunk,
    status, unstage_files, unstage_hunk, FileState,
};

#[test]
fn test_git_status_all_types() {
    let repo = TestRepo::new();
    let exec = SystemExec;

    // Initial files
    repo.write_file("file_modified.txt", "line1\nline2\n");
    repo.write_file("file_deleted.txt", "delete me\n");
    repo.write_file("file_renamed.txt", "rename me\n");
    repo.write_file("file_conflict.txt", "base conflict\n");
    repo.commit("initial commit");

    // Create conflict via branch merge
    repo.git(&["checkout", "-b", "feature-b"]);
    repo.write_file("file_conflict.txt", "conflict from branch b\n");
    repo.commit("commit on branch b");

    repo.git(&["checkout", "main"]);
    repo.write_file("file_conflict.txt", "conflict from branch main\n");
    repo.commit("commit on main");

    // Merge feature-b into main to produce merge conflict
    let merge_res = repo.git_raw(&["merge", "feature-b"]);
    assert!(!merge_res.status.success(), "merge should have conflicted");

    // Other modifications
    repo.write_file("file_modified.txt", "line1 modified\nline2\n");
    fs::remove_file(repo.path().join("file_deleted.txt")).unwrap();
    repo.git(&["mv", "file_renamed.txt", "renamed 🚀.txt"]);
    repo.write_file("untracked 🚀.txt", "untracked content\n");
    repo.write_file("file_added.txt", "added staged content\n");
    repo.git(&["add", "file_added.txt"]);

    let repo_status = status(&exec, repo.path()).expect("status should succeed");
    assert_eq!(repo_status.branch.head, "main");
    assert!(!repo_status.branch.detached);

    let entries = &repo_status.entries;

    // file_modified: worktree modified, index unmodified
    let mod_entry = entries
        .iter()
        .find(|e| e.path == "file_modified.txt")
        .expect("file_modified.txt found");
    assert_eq!(mod_entry.index, FileState::Unmodified);
    assert_eq!(mod_entry.worktree, FileState::Modified);
    assert!(!mod_entry.conflicted);

    // file_deleted: worktree deleted
    let del_entry = entries
        .iter()
        .find(|e| e.path == "file_deleted.txt")
        .expect("file_deleted.txt found");
    assert_eq!(del_entry.index, FileState::Unmodified);
    assert_eq!(del_entry.worktree, FileState::Deleted);

    // renamed 🚀.txt: staged rename
    let ren_entry = entries
        .iter()
        .find(|e| e.path == "renamed 🚀.txt")
        .expect("renamed 🚀.txt found");
    assert_eq!(ren_entry.index, FileState::Renamed);
    assert_eq!(ren_entry.worktree, FileState::Unmodified);
    assert_eq!(ren_entry.orig_path, Some("file_renamed.txt".to_string()));

    // file_added.txt: staged added
    let add_entry = entries
        .iter()
        .find(|e| e.path == "file_added.txt")
        .expect("file_added.txt found");
    assert_eq!(add_entry.index, FileState::Added);
    assert_eq!(add_entry.worktree, FileState::Unmodified);

    // untracked 🚀.txt
    let untracked_entry = entries
        .iter()
        .find(|e| e.path == "untracked 🚀.txt")
        .expect("untracked 🚀.txt found");
    assert_eq!(untracked_entry.index, FileState::Untracked);
    assert_eq!(untracked_entry.worktree, FileState::Untracked);

    // file_conflict.txt: conflicted
    let conf_entry = entries
        .iter()
        .find(|e| e.path == "file_conflict.txt")
        .expect("file_conflict.txt found");
    assert!(conf_entry.conflicted);
}

#[test]
fn test_stage_and_unstage_files() {
    let repo = TestRepo::new();
    let exec = SystemExec;

    // Test unborn repo unstage
    repo.write_file("unborn 🚀.txt", "unborn test");
    stage_files(&exec, repo.path(), &["unborn 🚀.txt"]).unwrap();
    let st = status(&exec, repo.path()).unwrap();
    let e = st
        .entries
        .iter()
        .find(|e| e.path == "unborn 🚀.txt")
        .unwrap();
    assert_eq!(e.index, FileState::Added);

    unstage_files(&exec, repo.path(), &["unborn 🚀.txt"]).unwrap();
    let st = status(&exec, repo.path()).unwrap();
    let e = st
        .entries
        .iter()
        .find(|e| e.path == "unborn 🚀.txt")
        .unwrap();
    assert_eq!(e.index, FileState::Untracked);

    // Now commit a base file
    repo.commit("initial commit");

    // Modify file and stage/unstage
    repo.write_file("unborn 🚀.txt", "updated text");
    stage_files(&exec, repo.path(), &["unborn 🚀.txt"]).unwrap();
    let st = status(&exec, repo.path()).unwrap();
    let e = st
        .entries
        .iter()
        .find(|e| e.path == "unborn 🚀.txt")
        .unwrap();
    assert_eq!(e.index, FileState::Modified);
    assert_eq!(e.worktree, FileState::Unmodified);

    unstage_files(&exec, repo.path(), &["unborn 🚀.txt"]).unwrap();
    let st = status(&exec, repo.path()).unwrap();
    let e = st
        .entries
        .iter()
        .find(|e| e.path == "unborn 🚀.txt")
        .unwrap();
    assert_eq!(e.index, FileState::Unmodified);
    assert_eq!(e.worktree, FileState::Modified);
}

#[test]
fn test_stage_and_unstage_hunk() {
    let repo = TestRepo::new();
    let exec = SystemExec;

    let base_content = (1..=20)
        .map(|i| format!("line {i}"))
        .collect::<Vec<_>>()
        .join("\n")
        + "\n";
    repo.write_file("test_hunk.txt", &base_content);
    repo.commit("add test_hunk.txt");

    // Modify line 1 (hunk 0) and line 20 (hunk 1)
    let modified_content = base_content
        .replace("line 1\n", "line 1 modified\n")
        .replace("line 20\n", "line 20 modified\n");
    repo.write_file("test_hunk.txt", &modified_content);

    // Get worktree diff
    let diffs = diff_worktree(&exec, repo.path(), Some(Path::new("test_hunk.txt")), false).unwrap();
    assert_eq!(diffs.len(), 1);
    assert_eq!(diffs[0].hunks.len(), 2);

    // Stage only Hunk 0
    stage_hunk(&exec, repo.path(), &diffs[0], 0).unwrap();

    // Check staged diff: must only contain hunk 1's change (line 1 modified)
    let staged_diffs =
        diff_staged(&exec, repo.path(), Some(Path::new("test_hunk.txt")), false).unwrap();
    assert_eq!(staged_diffs.len(), 1);
    assert_eq!(staged_diffs[0].hunks.len(), 1);
    assert!(staged_diffs[0].hunks[0]
        .lines
        .iter()
        .any(|l| l.text == "line 1 modified"));
    assert!(!staged_diffs[0].hunks[0]
        .lines
        .iter()
        .any(|l| l.text == "line 20 modified"));

    // Check worktree diff: must still contain hunk 2's change (line 20 modified)
    let wt_diffs =
        diff_worktree(&exec, repo.path(), Some(Path::new("test_hunk.txt")), false).unwrap();
    assert_eq!(wt_diffs.len(), 1);
    assert_eq!(wt_diffs[0].hunks.len(), 1);
    assert!(wt_diffs[0].hunks[0]
        .lines
        .iter()
        .any(|l| l.text == "line 20 modified"));
    assert!(!wt_diffs[0].hunks[0]
        .lines
        .iter()
        .any(|l| l.text == "line 1 modified"));

    // Now unstage that hunk using diff_staged + unstage_hunk
    unstage_hunk(&exec, repo.path(), &staged_diffs[0], 0).unwrap();

    // Staged diff is now empty
    let staged_empty =
        diff_staged(&exec, repo.path(), Some(Path::new("test_hunk.txt")), false).unwrap();
    assert!(staged_empty.is_empty() || staged_empty[0].hunks.is_empty());

    // Worktree diff has both hunks back
    let wt_both =
        diff_worktree(&exec, repo.path(), Some(Path::new("test_hunk.txt")), false).unwrap();
    assert_eq!(wt_both[0].hunks.len(), 2);
}

#[test]
fn test_commit_and_amend() {
    let repo = TestRepo::new();
    let exec = SystemExec;

    // Repo without commits
    assert_eq!(last_commit_message(&exec, repo.path()).unwrap(), None);

    repo.write_file("file.txt", "content");
    stage_files(&exec, repo.path(), &["file.txt"]).unwrap();
    commit(&exec, repo.path(), "initial commit message", false).unwrap();

    assert_eq!(
        last_commit_message(&exec, repo.path()).unwrap(),
        Some("initial commit message".to_string())
    );

    let rev_count1 = repo.git(&["rev-list", "--count", "HEAD"]);
    assert_eq!(rev_count1.trim(), "1");

    // Amend commit message
    commit(&exec, repo.path(), "amended commit message", true).unwrap();
    assert_eq!(
        last_commit_message(&exec, repo.path()).unwrap(),
        Some("amended commit message".to_string())
    );

    let rev_count2 = repo.git(&["rev-list", "--count", "HEAD"]);
    assert_eq!(rev_count2.trim(), "1");
}

#[test]
fn test_diff_commit_and_untracked() {
    let repo = TestRepo::new();
    let exec = SystemExec;

    repo.write_file("file 🚀.txt", "initial 🚀\n");
    repo.commit("root commit");

    // Test root commit diff
    let root_diff = diff_commit(&exec, repo.path(), "HEAD", None, false).unwrap();
    assert_eq!(root_diff.len(), 1);
    assert_eq!(root_diff[0].status, FileState::Added);
    assert_eq!(root_diff[0].new_path, Some("file 🚀.txt".to_string()));

    // Test untracked file diff via diff_worktree
    repo.write_file("untracked 🚀.txt", "new untracked content\n");
    let untracked_diff = diff_worktree(
        &exec,
        repo.path(),
        Some(Path::new("untracked 🚀.txt")),
        false,
    )
    .unwrap();
    assert_eq!(untracked_diff.len(), 1);
    assert_eq!(untracked_diff[0].status, FileState::Untracked);
    assert_eq!(
        untracked_diff[0].new_path,
        Some("untracked 🚀.txt".to_string())
    );
    assert_eq!(untracked_diff[0].hunks.len(), 1);
    assert_eq!(
        untracked_diff[0].hunks[0].lines[0].text,
        "new untracked content"
    );
}
