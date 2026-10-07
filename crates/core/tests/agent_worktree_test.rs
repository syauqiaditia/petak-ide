mod common;

use common::gitrepo::TestRepo;
use petak_core::agent::{
    create_worktree, get_worktree_diff, list_worktrees, remove_worktree, sanitize_branch_name,
    sanitize_task_id, WorktreeManager,
};
use std::fs;
use std::path::Path;
use std::process::Command;

#[test]
fn test_worktree_lifecycle_full() {
    let repo = TestRepo::new();
    repo.write_file("main.txt", "Initial content on main\n");
    repo.commit("initial commit on main");

    // 1. Initial list should be empty (main working tree is excluded)
    let initial_list = list_worktrees(repo.path()).expect("list worktrees");
    assert_eq!(initial_list.len(), 0);

    // 2. Create worktree for task-1
    let info =
        create_worktree(repo.path(), "task-1", "wt/task-1", Some("main")).expect("create worktree");
    assert_eq!(info.task_id, "task-1");
    assert_eq!(info.branch, "wt/task-1");
    assert_eq!(info.base_branch, "main");
    assert!(!info.head_sha.is_empty());
    assert!(!info.is_dirty);
    assert!(info.created_at > 0);
    assert!(Path::new(&info.path).exists());

    // 3. List should now contain task-1
    let list_after_create = list_worktrees(repo.path()).expect("list after create");
    assert_eq!(list_after_create.len(), 1);
    assert_eq!(list_after_create[0].task_id, "task-1");
    assert_eq!(list_after_create[0].branch, "wt/task-1");
    assert!(!list_after_create[0].is_dirty);

    // 4. Dirty tracking: add an uncommitted file inside the worktree
    let wt_file = Path::new(&info.path).join("feature.txt");
    fs::write(&wt_file, "Worktree feature in progress\n").expect("write feature file");

    let list_dirty = list_worktrees(repo.path()).expect("list after dirty change");
    assert_eq!(list_dirty.len(), 1);
    assert!(list_dirty[0].is_dirty);

    // 5. Diff should report the uncommitted changes
    let diff_uncommitted = get_worktree_diff(repo.path(), "task-1").expect("get worktree diff");
    assert!(
        diff_uncommitted.contains("Worktree feature in progress"),
        "Diff should contain uncommitted change, got: {}",
        diff_uncommitted
    );

    // 6. Commit inside the worktree
    let mut add_cmd = Command::new("git");
    add_cmd.current_dir(&info.path).args(["add", "feature.txt"]);
    let out = add_cmd.output().expect("git add in worktree");
    assert!(out.status.success());

    let mut commit_cmd = Command::new("git");
    commit_cmd
        .current_dir(&info.path)
        .args(["commit", "-m", "commit feature in worktree"]);
    let out = commit_cmd.output().expect("git commit in worktree");
    assert!(out.status.success());

    // Status should be clean again
    let list_clean = list_worktrees(repo.path()).expect("list after commit");
    assert_eq!(list_clean.len(), 1);
    assert!(!list_clean[0].is_dirty);

    // Diff should still reflect the committed changes vs main
    let diff_committed = get_worktree_diff(repo.path(), "task-1").expect("get diff after commit");
    assert!(
        diff_committed.contains("Worktree feature in progress"),
        "Diff should contain committed feature vs main, got: {}",
        diff_committed
    );

    // 7. Remove worktree and delete its branch
    remove_worktree(repo.path(), "task-1", true).expect("remove worktree");

    assert!(!Path::new(&info.path).exists());

    let final_list = list_worktrees(repo.path()).expect("list after remove");
    assert_eq!(final_list.len(), 0);

    // Branch should be deleted
    let verify_branch = repo.git_raw(&["rev-parse", "--verify", "refs/heads/wt/task-1"]);
    assert!(!verify_branch.status.success());
}

#[test]
fn test_path_traversal_guards() {
    let repo = TestRepo::new();
    repo.write_file("init.txt", "init\n");
    repo.commit("initial");

    // task_id traversal checks
    assert!(sanitize_task_id("../../etc").is_err());
    assert!(sanitize_task_id("../sibling").is_err());
    assert!(sanitize_task_id("task/sub").is_err());
    assert!(sanitize_task_id("task\\sub").is_err());
    assert!(sanitize_task_id("").is_err());
    assert!(sanitize_task_id("valid-slug_123").is_ok());

    let create_err = create_worktree(repo.path(), "../../etc", "wt/test", None);
    assert!(create_err.is_err());
    assert!(create_err.unwrap_err().contains("Invalid task_id"));

    // branch name traversal & illegal character checks
    assert!(sanitize_branch_name("../master").is_err());
    assert!(sanitize_branch_name("wt//double").is_err());
    assert!(sanitize_branch_name("wt/feat~1").is_err());
    assert!(sanitize_branch_name("wt/feat^2").is_err());
    assert!(sanitize_branch_name("wt/feat?").is_err());
    assert!(sanitize_branch_name("").is_err());
    assert!(sanitize_branch_name("wt/valid-branch").is_ok());

    let branch_err = create_worktree(repo.path(), "task-safe", "../bad-branch", None);
    assert!(branch_err.is_err());

    let base_err = create_worktree(repo.path(), "task-safe", "wt/safe", Some("../bad-base"));
    assert!(base_err.is_err());

    // remove traversal check
    let remove_err = remove_worktree(repo.path(), "../../etc", false);
    assert!(remove_err.is_err());
}

#[test]
fn test_worktree_manager_wrapper() {
    let repo = TestRepo::new();
    repo.write_file("main.txt", "Initial\n");
    repo.commit("initial");

    let manager = WorktreeManager::new(repo.path());
    assert_eq!(manager.project_root(), repo.path());

    let created = manager
        .create("task-mgr", "wt/task-mgr", None)
        .expect("manager create");
    assert_eq!(created.task_id, "task-mgr");

    let list = manager.list().expect("manager list");
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].task_id, "task-mgr");

    let diff = manager.diff("task-mgr").expect("manager diff");
    assert_eq!(diff.trim(), "");

    manager.remove("task-mgr", true).expect("manager remove");
    let after = manager.list().expect("manager list after remove");
    assert_eq!(after.len(), 0);
}

#[test]
fn test_worktree_attach_existing_branch() {
    let repo = TestRepo::new();
    repo.write_file("main.txt", "Initial\n");
    repo.commit("initial");

    // Pre-create branch on repo
    repo.git(&["branch", "feat/pre-existing"]);

    // Create worktree pointing to existing branch
    let info = create_worktree(repo.path(), "task-pre", "feat/pre-existing", None)
        .expect("create worktree with existing branch");
    assert_eq!(info.task_id, "task-pre");
    assert_eq!(info.branch, "feat/pre-existing");

    remove_worktree(repo.path(), "task-pre", true).expect("remove worktree");
}
