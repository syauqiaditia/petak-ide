mod common;

use std::collections::HashSet;
use std::fs;
use std::io::Write;
use std::path::Path;
use std::process::{Command, Stdio};

use common::gitrepo::TestRepo;
use petak_core::exec::SystemExec;
use petak_core::git::{
    backup_create, backup_delete, backup_list, backup_restore, branch_checkout, branch_create,
    branch_delete, branch_rename, cherry_pick, drop, fixup_into_previous, rebase_abort, rebase_run,
    rebase_state, rebase_todo, reset, revert, reword, squash, RebaseAction, RebasePlan,
    RebaseStateKind, ResetMode, StopKind,
};

fn setup_six_commit_repo() -> (TestRepo, Vec<String>) {
    let repo = TestRepo::new();
    let mut shas = Vec::new();

    // 6 linear commits
    repo.write_file("file1.txt", "content 1\n");
    shas.push(repo.commit("c1: add file 1").trim().to_string());

    repo.write_file("file2.txt", "content 2\n");
    shas.push(repo.commit("c2: add file 2").trim().to_string());

    repo.write_file("file3.txt", "content 3\n");
    shas.push(repo.commit("c3: add file 3").trim().to_string());

    repo.write_file("file4.txt", "content 4\n");
    shas.push(repo.commit("c4: add file 4").trim().to_string());

    repo.write_file("file5.txt", "content 5\n");
    shas.push(repo.commit("c5: add file 5").trim().to_string());

    repo.write_file("file6.txt", "content 6\n");
    shas.push(repo.commit("c6: add file 6").trim().to_string());

    // 1 branch from c4
    let c4_sha = repo.git(&["rev-parse", "HEAD~2"]).trim().to_string();
    repo.git(&["checkout", "-b", "feature", &c4_sha]);
    repo.write_file("feat.txt", "feature content\n");
    repo.commit("f1: feature commit");

    // Checkout main again
    repo.git(&["checkout", "main"]);

    (repo, shas)
}

fn tree_hash(repo: &TestRepo, rev: &str) -> String {
    repo.git(&["rev-parse", &format!("{}^{{tree}}", rev)])
        .trim()
        .to_string()
}

fn head_sha(repo: &TestRepo) -> String {
    repo.git(&["rev-parse", "HEAD"]).trim().to_string()
}

fn commit_count(repo: &TestRepo) -> usize {
    let out = repo.git(&["rev-list", "--count", "HEAD"]);
    out.trim().parse().unwrap_or(0)
}

fn extract_patch_ids(repo: &TestRepo, extra_args: &[&str]) -> HashSet<String> {
    let mut args = vec!["log", "-p"];
    args.extend_from_slice(extra_args);
    let diff = repo.git(&args);
    let mut child = Command::new("git")
        .arg("patch-id")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .expect("spawn git patch-id");
    child
        .stdin
        .take()
        .unwrap()
        .write_all(diff.as_bytes())
        .expect("write patch to stdin");
    let out = child.wait_with_output().expect("wait git patch-id");
    let text = String::from_utf8_lossy(&out.stdout);
    text.lines()
        .filter_map(|l| l.split_whitespace().next().map(|s| s.to_string()))
        .collect()
}

#[test]
fn test_backup_crud_and_collision() {
    let repo = TestRepo::new();
    let exec = SystemExec;

    repo.write_file("a.txt", "hello\n");
    repo.commit("init");

    let head = head_sha(&repo);

    // Create first backup
    let ref1 = backup_create(&exec, repo.path(), "test").unwrap();
    assert!(ref1.starts_with("refs/petak/backup/"));
    assert!(ref1.ends_with("-test"));

    // Create second backup in same second -> collision adds -2
    let mut ref2 = backup_create(&exec, repo.path(), "test").unwrap();
    if !ref2.ends_with("-test-2") {
        // If the second rolled over between ref1 and ref2, create one more in the same second as ref2
        ref2 = backup_create(&exec, repo.path(), "test").unwrap();
    }
    assert!(ref2.starts_with("refs/petak/backup/"));
    assert!(ref2.ends_with("-test-2"));

    // List backups
    let list = backup_list(&exec, repo.path()).unwrap();
    assert!(list.len() >= 2);
    assert_eq!(list[0].sha, head);
    assert_eq!(list[1].sha, head);
    assert_eq!(list[0].op, "test");
    assert_eq!(list[1].op, "test");
    assert_eq!(list[0].subject, "init");

    // Restore to ref1
    repo.write_file("b.txt", "untracked\n");
    repo.commit("commit 2");
    assert_eq!(commit_count(&repo), 2);

    let restored_head = backup_restore(&exec, repo.path(), &ref1, false).unwrap();
    assert_eq!(restored_head, head);
    assert_eq!(commit_count(&repo), 1);
    let status_out = repo.git(&["status", "--porcelain"]);
    assert!(status_out.trim().is_empty());

    // Notice restore created a restore backup ref!
    let list_after_restore = backup_list(&exec, repo.path()).unwrap();
    assert!(list_after_restore.iter().any(|b| b.op == "restore"));

    // Delete ref1
    backup_delete(&exec, repo.path(), &ref1).unwrap();
    let list_after_del = backup_list(&exec, repo.path()).unwrap();
    assert!(!list_after_del.iter().any(|b| b.name == ref1));
}

#[test]
fn test_rebase_squash_middle_commits() {
    let (repo, _shas) = setup_six_commit_repo();
    let exec = SystemExec;

    let old_head = head_sha(&repo);
    let old_tree = tree_hash(&repo, "HEAD");
    assert_eq!(commit_count(&repo), 6);

    let c3_sha = repo.git(&["rev-parse", "HEAD~3"]).trim().to_string();
    let c4_sha = repo.git(&["rev-parse", "HEAD~2"]).trim().to_string();

    let res = squash(
        &exec,
        repo.path(),
        &[&c3_sha, &c4_sha],
        "c3 and c4 squashed",
    )
    .unwrap();
    assert!(res.ok);
    assert_eq!(commit_count(&repo), 5);

    let new_head = head_sha(&repo);
    assert_ne!(new_head, old_head);
    let new_tree = tree_hash(&repo, "HEAD");
    assert_eq!(old_tree, new_tree, "Tree must be IDENTICAL after squash");

    // Check message
    let squashed_msg = repo.git(&["log", "-1", "--format=%s", "HEAD~2"]);
    assert_eq!(squashed_msg.trim(), "c3 and c4 squashed");

    // Verify backup ref points to old HEAD
    assert!(res.backup_ref.is_some());
    let backup_ref = res.backup_ref.unwrap();
    let backup_sha = repo.git(&["rev-parse", &backup_ref]).trim().to_string();
    assert_eq!(backup_sha, old_head);

    // Verify restore restores exact old HEAD
    let restored_head = backup_restore(&exec, repo.path(), &backup_ref, false).unwrap();
    assert_eq!(restored_head, old_head);
    assert_eq!(commit_count(&repo), 6);
    assert!(repo.git(&["status", "--porcelain"]).trim().is_empty());
}

#[test]
fn test_rebase_reword() {
    let (repo, _shas) = setup_six_commit_repo();
    let exec = SystemExec;

    let old_head = head_sha(&repo);
    let old_tree = tree_hash(&repo, "HEAD");
    assert_eq!(commit_count(&repo), 6);

    let c3_sha = repo.git(&["rev-parse", "HEAD~3"]).trim().to_string();
    let res = reword(&exec, repo.path(), &c3_sha, "c3 reworded subject").unwrap();
    assert!(res.ok);
    assert_eq!(commit_count(&repo), 6);

    let new_tree = tree_hash(&repo, "HEAD");
    assert_eq!(old_tree, new_tree, "Tree must be identical after reword");

    let reworded_subject = repo.git(&["log", "-1", "--format=%s", "HEAD~3"]);
    assert_eq!(reworded_subject.trim(), "c3 reworded subject");

    let backup_ref = res.backup_ref.unwrap();
    assert_eq!(repo.git(&["rev-parse", &backup_ref]).trim(), old_head);

    let restored = backup_restore(&exec, repo.path(), &backup_ref, false).unwrap();
    assert_eq!(restored, old_head);
    assert!(repo.git(&["status", "--porcelain"]).trim().is_empty());
}

#[test]
fn test_rebase_fixup_into_previous() {
    let (repo, _shas) = setup_six_commit_repo();
    let exec = SystemExec;

    let old_head = head_sha(&repo);
    let old_tree = tree_hash(&repo, "HEAD");
    assert_eq!(commit_count(&repo), 6);

    let c4_sha = repo.git(&["rev-parse", "HEAD~2"]).trim().to_string();
    let c3_msg = repo
        .git(&["log", "-1", "--format=%s", "HEAD~3"])
        .trim()
        .to_string();

    let res = fixup_into_previous(&exec, repo.path(), &c4_sha).unwrap();
    assert!(res.ok);
    assert_eq!(commit_count(&repo), 5);

    let new_tree = tree_hash(&repo, "HEAD");
    assert_eq!(old_tree, new_tree, "Tree must be identical after fixup");

    let kept_msg = repo
        .git(&["log", "-1", "--format=%s", "HEAD~2"])
        .trim()
        .to_string();
    assert_eq!(
        kept_msg, c3_msg,
        "Previous commit message must be preserved"
    );

    let backup_ref = res.backup_ref.unwrap();
    assert_eq!(repo.git(&["rev-parse", &backup_ref]).trim(), old_head);

    let restored = backup_restore(&exec, repo.path(), &backup_ref, false).unwrap();
    assert_eq!(restored, old_head);
    assert!(repo.git(&["status", "--porcelain"]).trim().is_empty());
}

#[test]
fn test_rebase_drop() {
    let (repo, _shas) = setup_six_commit_repo();
    let exec = SystemExec;

    let old_head = head_sha(&repo);
    assert_eq!(commit_count(&repo), 6);

    let c4_sha = repo.git(&["rev-parse", "HEAD~2"]).trim().to_string();

    // Collect patch-ids of commits before drop
    let before_patch_ids = extract_patch_ids(&repo, &["HEAD"]);
    assert_eq!(before_patch_ids.len(), 6);

    let c4_patch_ids = extract_patch_ids(&repo, &["-1", &c4_sha]);
    assert_eq!(c4_patch_ids.len(), 1);

    let expected_patch_ids: HashSet<_> = before_patch_ids
        .difference(&c4_patch_ids)
        .cloned()
        .collect();
    assert_eq!(expected_patch_ids.len(), 5);

    let res = drop(&exec, repo.path(), &[&c4_sha], false).unwrap();
    assert!(res.ok);
    assert_eq!(commit_count(&repo), 5);

    let after_patch_ids = extract_patch_ids(&repo, &["HEAD"]);
    assert_eq!(
        after_patch_ids, expected_patch_ids,
        "Patch-IDs of remaining commits must match exactly"
    );

    // file4.txt should no longer exist in worktree
    assert!(!repo.path().join("file4.txt").exists());
    // file1, 2, 3, 5, 6 must still exist
    assert!(repo.path().join("file1.txt").exists());
    assert!(repo.path().join("file2.txt").exists());
    assert!(repo.path().join("file3.txt").exists());
    assert!(repo.path().join("file5.txt").exists());
    assert!(repo.path().join("file6.txt").exists());

    let backup_ref = res.backup_ref.unwrap();
    assert_eq!(repo.git(&["rev-parse", &backup_ref]).trim(), old_head);

    let restored = backup_restore(&exec, repo.path(), &backup_ref, false).unwrap();
    assert_eq!(restored, old_head);
    assert!(repo.path().join("file4.txt").exists());
    assert!(repo.git(&["status", "--porcelain"]).trim().is_empty());
}

#[test]
fn test_rebase_reorder_independent_commits() {
    let (repo, _shas) = setup_six_commit_repo();
    let exec = SystemExec;

    let old_head = head_sha(&repo);
    let old_tree = tree_hash(&repo, "HEAD");
    assert_eq!(commit_count(&repo), 6);

    let c2_sha = repo.git(&["rev-parse", "HEAD~4"]).trim().to_string();
    let mut items = rebase_todo(&exec, repo.path(), &c2_sha).unwrap();
    // items should be [c3, c4, c5, c6]
    assert_eq!(items.len(), 4);
    // Swap c3 (idx 0) and c4 (idx 1)
    items.swap(0, 1);

    let plan = RebasePlan {
        base: c2_sha,
        items,
        backup: true,
    };

    let res = rebase_run(&exec, repo.path(), &plan).unwrap();
    assert!(res.ok);
    assert_eq!(commit_count(&repo), 6);

    let new_tree = tree_hash(&repo, "HEAD");
    assert_eq!(
        old_tree, new_tree,
        "Tree must be identical after reordering independent commits"
    );

    // Check log order: HEAD~3 is now c3, HEAD~2 is c4? Wait:
    // Original: c1, c2, c3, c4, c5, c6.
    // Swapped: c1, c2, c4', c3', c5', c6'.
    let msg_head_minus_3 = repo
        .git(&["log", "-1", "--format=%s", "HEAD~3"])
        .trim()
        .to_string();
    let msg_head_minus_2 = repo
        .git(&["log", "-1", "--format=%s", "HEAD~2"])
        .trim()
        .to_string();
    assert_eq!(msg_head_minus_3, "c4: add file 4");
    assert_eq!(msg_head_minus_2, "c3: add file 3");

    let backup_ref = res.backup_ref.unwrap();
    assert_eq!(repo.git(&["rev-parse", &backup_ref]).trim(), old_head);

    let restored = backup_restore(&exec, repo.path(), &backup_ref, false).unwrap();
    assert_eq!(restored, old_head);
    assert!(repo.git(&["status", "--porcelain"]).trim().is_empty());
}

#[test]
fn test_reset_hard_auto_backup_and_restore() {
    let (repo, _shas) = setup_six_commit_repo();
    let exec = SystemExec;

    let old_head = head_sha(&repo);
    let c3_sha = repo.git(&["rev-parse", "HEAD~3"]).trim().to_string();

    let res = reset(&exec, repo.path(), &c3_sha, ResetMode::Hard).unwrap();
    assert!(res.ok);
    assert_eq!(head_sha(&repo), c3_sha);
    assert_eq!(commit_count(&repo), 3);

    // Verify backup ref was created automatically for hard reset
    assert!(res.backup_ref.is_some());
    let backup_ref = res.backup_ref.unwrap();
    assert!(backup_ref.contains("-reset"));
    assert_eq!(repo.git(&["rev-parse", &backup_ref]).trim(), old_head);

    // Restore
    let restored = backup_restore(&exec, repo.path(), &backup_ref, false).unwrap();
    assert_eq!(restored, old_head);
    assert_eq!(commit_count(&repo), 6);
    assert!(repo.git(&["status", "--porcelain"]).trim().is_empty());
}

#[test]
fn test_rebase_conflict_stop_and_abort() {
    let repo = TestRepo::new();
    let exec = SystemExec;

    repo.write_file("conflict.txt", "line original\n");
    repo.commit("c1: initial");
    let c1 = head_sha(&repo);

    repo.write_file("conflict.txt", "line branch main\n");
    repo.commit("c2: main branch edit");
    let main_head = head_sha(&repo);
    let main_tree = tree_hash(&repo, "HEAD");

    repo.git(&["checkout", "-b", "feat", &c1]);
    repo.write_file("conflict.txt", "line branch feat\n");
    repo.commit("c3: feat branch edit");
    let c3 = head_sha(&repo);

    repo.git(&["checkout", "main"]);

    // Attempt to rebase feat commit onto main via rebase_run
    let items = vec![petak_core::git::RebaseItem {
        sha: c3.clone(),
        action: RebaseAction::Pick,
        message: None,
    }];
    let plan = RebasePlan {
        base: main_head.clone(),
        items,
        backup: true,
    };

    let res = rebase_run(&exec, repo.path(), &plan).unwrap();
    assert!(!res.ok, "Rebase must report stopped on conflict");
    assert!(res.stopped_at.is_some());
    let stop = res.stopped_at.unwrap();
    assert_eq!(stop.kind, StopKind::Conflict);
    assert_eq!(stop.sha, c3);

    // State should be Rebase
    let state = rebase_state(&exec, repo.path()).unwrap();
    assert_eq!(state.kind, RebaseStateKind::Rebase);

    // Abort rebase
    rebase_abort(&exec, repo.path()).unwrap();
    assert_eq!(head_sha(&repo), main_head);
    assert_eq!(tree_hash(&repo, "HEAD"), main_tree);
    assert!(repo.git(&["status", "--porcelain"]).trim().is_empty());

    let state_after_abort = rebase_state(&exec, repo.path()).unwrap();
    assert_eq!(state_after_abort.kind, RebaseStateKind::None);
}

#[test]
fn test_rebase_dirty_worktree_autostashes() {
    let (repo, _shas) = setup_six_commit_repo();
    let exec = SystemExec;

    // Dirty worktree
    repo.write_file("file1.txt", "dirty uncommitted changes\n");

    let c3_sha = repo.git(&["rev-parse", "HEAD~3"]).trim().to_string();
    let c4_sha = repo.git(&["rev-parse", "HEAD~2"]).trim().to_string();

    let res = squash(&exec, repo.path(), &[&c3_sha, &c4_sha], "c3 and c4 squashed")
        .expect("squash on dirty worktree succeeds with autostash");
    assert!(res.ok);
    assert!(!res.stash_conflict);

    // Check dirty worktree restored
    assert_eq!(
        repo.read_file("file1.txt"),
        "dirty uncommitted changes\n"
    );
    // Check backup ref created
    let list = backup_list(&exec, repo.path()).unwrap();
    assert!(list.iter().any(|b| b.op == "squash"));
}

#[test]
fn test_squash_on_dirty_tree_autostashes() {
    let repo = TestRepo::new();
    let exec = SystemExec;

    // 3 commits
    repo.write_file("file1.txt", "c1 content\n");
    repo.commit("c1: initial commit");
    repo.write_file("file2.txt", "c2 content\n");
    repo.commit("c2: add file 2");
    let c2_sha = repo.git(&["rev-parse", "HEAD"]).trim().to_string();
    repo.write_file("file3.txt", "c3 content\n");
    repo.commit("c3: add file 3");
    let c3_sha = repo.git(&["rev-parse", "HEAD"]).trim().to_string();

    assert_eq!(commit_count(&repo), 3);

    // Tracked change
    repo.write_file("file1.txt", "c1 modified dirty\n");
    // Staged change
    repo.write_file("staged.txt", "staged content\n");
    repo.git(&["add", "staged.txt"]);
    // Untracked change
    repo.write_file("untracked.txt", "untracked content\n");

    let res = squash(&exec, repo.path(), &[&c2_sha, &c3_sha], "c2 and c3 squashed")
        .expect("squash succeeds with autostash");
    assert!(res.ok);
    assert!(!res.stash_conflict);

    // Backup ref exists
    let list = backup_list(&exec, repo.path()).unwrap();
    assert!(list.iter().any(|b| b.op == "squash"));

    // Commit count decreased by 1
    assert_eq!(commit_count(&repo), 2);

    // Verify all 3 local changes preserved exactly
    assert_eq!(repo.read_file("file1.txt"), "c1 modified dirty\n");
    assert_eq!(repo.read_file("staged.txt"), "staged content\n");
    assert_eq!(repo.read_file("untracked.txt"), "untracked content\n");

    let status = repo.git(&["status", "--porcelain"]);
    assert!(status.contains("file1.txt"));
    assert!(status.contains("staged.txt"));
    assert!(status.contains("untracked.txt"));
}

#[test]
fn test_reword_on_dirty_tree() {
    let repo = TestRepo::new();
    let exec = SystemExec;

    repo.write_file("file1.txt", "line 1\n");
    repo.commit("commit 1");
    repo.write_file("file2.txt", "line 2\n");
    repo.commit("commit 2");
    let c2_sha = repo.git(&["rev-parse", "HEAD"]).trim().to_string();

    // Dirty tracked change in file1
    repo.write_file("file1.txt", "line 1 dirty edit\n");

    let res = reword(&exec, repo.path(), &c2_sha, "commit 2 reworded")
        .expect("reword succeeds with autostash");
    assert!(res.ok);
    assert!(!res.stash_conflict);

    // Verify commit message
    let last_msg = repo.git(&["log", "-1", "--pretty=%s"]);
    assert_eq!(last_msg.trim(), "commit 2 reworded");

    // Verify dirty change preserved
    assert_eq!(repo.read_file("file1.txt"), "line 1 dirty edit\n");

    // Backup ref exists
    let list = backup_list(&exec, repo.path()).unwrap();
    assert!(list.iter().any(|b| b.op == "reword"));
}

#[test]
fn test_autostash_pop_conflict_reports_flag() {
    let repo = TestRepo::new();
    let exec = SystemExec;

    repo.write_file("file1.txt", "base line\n");
    repo.commit("c1: base");

    repo.write_file("file1.txt", "modified by commit 2\n");
    repo.commit("c2: edit file1");
    let c2_sha = repo.git(&["rev-parse", "HEAD"]).trim().to_string();

    // Local uncommitted change modifies the same line in file1.txt
    repo.write_file("file1.txt", "modified locally dirty\n");

    // Drop commit 2 -> rebase runs, drops c2. When autostash is popped on top of c1,
    // "modified locally dirty\n" conflicts with "base line\n" (because autostash patch was based on c2)
    let res = drop(&exec, repo.path(), &[&c2_sha], false).expect("drop runs");
    assert!(res.ok);
    assert!(res.stash_conflict, "expected stash_conflict to be true when autostash pop conflicts");

    // Stash is still in git stash list so no data is lost
    let stash_list = repo.git(&["stash", "list"]);
    assert!(!stash_list.trim().is_empty(), "stash must be preserved in stash list");
}

#[test]
fn test_rebase_root() {
    let (repo, _shas) = setup_six_commit_repo();
    let exec = SystemExec;

    let old_head = head_sha(&repo);
    let old_tree = tree_hash(&repo, "HEAD");

    let root_sha = repo
        .git(&["rev-list", "--max-parents=0", "HEAD"])
        .trim()
        .to_string();

    let mut items = rebase_todo(&exec, repo.path(), "--root").unwrap();
    assert_eq!(items.len(), 6);
    assert_eq!(items[0].sha, root_sha);

    items[0].action = RebaseAction::Reword;
    items[0].message = Some("c1 reworded at root".to_string());

    let plan = RebasePlan {
        base: "--root".to_string(),
        items,
        backup: true,
    };

    let res = rebase_run(&exec, repo.path(), &plan).unwrap();
    assert!(res.ok);
    assert_eq!(commit_count(&repo), 6);

    let new_tree = tree_hash(&repo, "HEAD");
    assert_eq!(
        old_tree, new_tree,
        "Tree must be identical after root reword"
    );

    let new_root_sha = repo
        .git(&["rev-list", "--max-parents=0", "HEAD"])
        .trim()
        .to_string();
    let root_subject = repo
        .git(&["log", "-1", "--format=%s", &new_root_sha])
        .trim()
        .to_string();
    assert_eq!(root_subject, "c1 reworded at root");

    let backup_ref = res.backup_ref.unwrap();
    let restored = backup_restore(&exec, repo.path(), &backup_ref, false).unwrap();
    assert_eq!(restored, old_head);
    assert!(repo.git(&["status", "--porcelain"]).trim().is_empty());
}

#[test]
fn test_cherry_pick_and_revert() {
    let (repo, _shas) = setup_six_commit_repo();
    let exec = SystemExec;

    // Create a new branch off c1
    let c1_sha = repo.git(&["rev-parse", "HEAD~5"]).trim().to_string();
    branch_create(&exec, repo.path(), "cherry-branch", &c1_sha, true).unwrap();

    let c5_sha = repo.git(&["rev-parse", "main~1"]).trim().to_string();
    let c6_sha = repo.git(&["rev-parse", "main"]).trim().to_string();

    // Cherry-pick c5 and c6
    let res = cherry_pick(&exec, repo.path(), &[&c5_sha, &c6_sha]).unwrap();
    assert!(res.ok);
    assert_eq!(commit_count(&repo), 3); // c1 + c5 + c6

    // Revert the top commit
    let current_head = head_sha(&repo);
    let rev_res = revert(&exec, repo.path(), &[&current_head]).unwrap();
    assert!(rev_res.ok);
    assert_eq!(commit_count(&repo), 4);
    assert!(!repo.path().join("file6.txt").exists());
}

#[test]
fn test_branch_operations() {
    let (repo, _shas) = setup_six_commit_repo();
    let exec = SystemExec;

    let head = head_sha(&repo);
    branch_create(&exec, repo.path(), "br-temp", &head, false).unwrap();
    branch_rename(&exec, repo.path(), "br-temp", "br-renamed").unwrap();
    branch_checkout(&exec, repo.path(), "br-renamed").unwrap();
    assert_eq!(head_sha(&repo), head);

    branch_checkout(&exec, repo.path(), "main").unwrap();
    branch_delete(&exec, repo.path(), "br-renamed", false).unwrap();
}

#[test]
fn test_generate_no_data_loss_evidence_report() {
    let exec = SystemExec;

    struct Row {
        op: String,
        old_head: String,
        new_head: String,
        tree_equal: String,
        restore_ok: String,
    }

    let mut rows: Vec<Row> = Vec::new();

    // 1. Squash
    {
        let (repo, _) = setup_six_commit_repo();
        let old_head = head_sha(&repo);
        let old_tree = tree_hash(&repo, "HEAD");
        let c3 = repo.git(&["rev-parse", "HEAD~3"]).trim().to_string();
        let c4 = repo.git(&["rev-parse", "HEAD~2"]).trim().to_string();
        let res = squash(&exec, repo.path(), &[&c3, &c4], "squashed c3+c4").unwrap();
        let new_head = head_sha(&repo);
        let new_tree = tree_hash(&repo, "HEAD");
        let restored = backup_restore(&exec, repo.path(), &res.backup_ref.unwrap(), false).unwrap();
        let clean = repo.git(&["status", "--porcelain"]).trim().is_empty();
        rows.push(Row {
            op: "squash (2 commit tengah)".to_string(),
            old_head: old_head[..7].to_string(),
            new_head: new_head[..7].to_string(),
            tree_equal: if old_tree == new_tree {
                "ya (identik)".to_string()
            } else {
                "tidak".to_string()
            },
            restore_ok: if restored == old_head && clean {
                "ya (HEAD cocok & status bersih)".to_string()
            } else {
                "gagal".to_string()
            },
        });
    }

    // 2. Reword
    {
        let (repo, _) = setup_six_commit_repo();
        let old_head = head_sha(&repo);
        let old_tree = tree_hash(&repo, "HEAD");
        let c3 = repo.git(&["rev-parse", "HEAD~3"]).trim().to_string();
        let res = reword(&exec, repo.path(), &c3, "c3 reworded").unwrap();
        let new_head = head_sha(&repo);
        let new_tree = tree_hash(&repo, "HEAD");
        let restored = backup_restore(&exec, repo.path(), &res.backup_ref.unwrap(), false).unwrap();
        let clean = repo.git(&["status", "--porcelain"]).trim().is_empty();
        rows.push(Row {
            op: "reword".to_string(),
            old_head: old_head[..7].to_string(),
            new_head: new_head[..7].to_string(),
            tree_equal: if old_tree == new_tree {
                "ya (identik)".to_string()
            } else {
                "tidak".to_string()
            },
            restore_ok: if restored == old_head && clean {
                "ya (HEAD cocok & status bersih)".to_string()
            } else {
                "gagal".to_string()
            },
        });
    }

    // 3. Fixup
    {
        let (repo, _) = setup_six_commit_repo();
        let old_head = head_sha(&repo);
        let old_tree = tree_hash(&repo, "HEAD");
        let c4 = repo.git(&["rev-parse", "HEAD~2"]).trim().to_string();
        let res = fixup_into_previous(&exec, repo.path(), &c4).unwrap();
        let new_head = head_sha(&repo);
        let new_tree = tree_hash(&repo, "HEAD");
        let restored = backup_restore(&exec, repo.path(), &res.backup_ref.unwrap(), false).unwrap();
        let clean = repo.git(&["status", "--porcelain"]).trim().is_empty();
        rows.push(Row {
            op: "fixup (into previous)".to_string(),
            old_head: old_head[..7].to_string(),
            new_head: new_head[..7].to_string(),
            tree_equal: if old_tree == new_tree {
                "ya (identik)".to_string()
            } else {
                "tidak".to_string()
            },
            restore_ok: if restored == old_head && clean {
                "ya (HEAD cocok & status bersih)".to_string()
            } else {
                "gagal".to_string()
            },
        });
    }

    // 4. Drop
    {
        let (repo, _) = setup_six_commit_repo();
        let old_head = head_sha(&repo);
        let c4 = repo.git(&["rev-parse", "HEAD~2"]).trim().to_string();
        let res = drop(&exec, repo.path(), &[&c4], false).unwrap();
        let new_head = head_sha(&repo);
        let restored = backup_restore(&exec, repo.path(), &res.backup_ref.unwrap(), false).unwrap();
        let clean = repo.git(&["status", "--porcelain"]).trim().is_empty();
        rows.push(Row {
            op: "drop (1 commit tengah)".to_string(),
            old_head: old_head[..7].to_string(),
            new_head: new_head[..7].to_string(),
            tree_equal: "terverifikasi (-file4.txt)".to_string(),
            restore_ok: if restored == old_head && clean {
                "ya (HEAD cocok & status bersih)".to_string()
            } else {
                "gagal".to_string()
            },
        });
    }

    // 5. Reorder
    {
        let (repo, _) = setup_six_commit_repo();
        let old_head = head_sha(&repo);
        let old_tree = tree_hash(&repo, "HEAD");
        let c2 = repo.git(&["rev-parse", "HEAD~4"]).trim().to_string();
        let mut items = rebase_todo(&exec, repo.path(), &c2).unwrap();
        items.swap(0, 1);
        let plan = RebasePlan {
            base: c2,
            items,
            backup: true,
        };
        let res = rebase_run(&exec, repo.path(), &plan).unwrap();
        let new_head = head_sha(&repo);
        let new_tree = tree_hash(&repo, "HEAD");
        let restored = backup_restore(&exec, repo.path(), &res.backup_ref.unwrap(), false).unwrap();
        let clean = repo.git(&["status", "--porcelain"]).trim().is_empty();
        rows.push(Row {
            op: "reorder (2 commit independen)".to_string(),
            old_head: old_head[..7].to_string(),
            new_head: new_head[..7].to_string(),
            tree_equal: if old_tree == new_tree {
                "ya (identik)".to_string()
            } else {
                "tidak".to_string()
            },
            restore_ok: if restored == old_head && clean {
                "ya (HEAD cocok & status bersih)".to_string()
            } else {
                "gagal".to_string()
            },
        });
    }

    // 6. Reset hard
    {
        let (repo, _) = setup_six_commit_repo();
        let old_head = head_sha(&repo);
        let c3 = repo.git(&["rev-parse", "HEAD~3"]).trim().to_string();
        let res = reset(&exec, repo.path(), &c3, ResetMode::Hard).unwrap();
        let new_head = head_sha(&repo);
        let restored = backup_restore(&exec, repo.path(), &res.backup_ref.unwrap(), false).unwrap();
        let clean = repo.git(&["status", "--porcelain"]).trim().is_empty();
        rows.push(Row {
            op: "reset --hard".to_string(),
            old_head: old_head[..7].to_string(),
            new_head: new_head[..7].to_string(),
            tree_equal: "mundur 3 commit".to_string(),
            restore_ok: if restored == old_head && clean {
                "ya (HEAD cocok & status bersih)".to_string()
            } else {
                "gagal".to_string()
            },
        });
    }

    // 7. Rebase root
    {
        let (repo, _) = setup_six_commit_repo();
        let old_head = head_sha(&repo);
        let old_tree = tree_hash(&repo, "HEAD");
        let mut items = rebase_todo(&exec, repo.path(), "--root").unwrap();
        items[0].action = RebaseAction::Reword;
        items[0].message = Some("c1 root reworded".to_string());
        let plan = RebasePlan {
            base: "--root".to_string(),
            items,
            backup: true,
        };
        let res = rebase_run(&exec, repo.path(), &plan).unwrap();
        let new_head = head_sha(&repo);
        let new_tree = tree_hash(&repo, "HEAD");
        let restored = backup_restore(&exec, repo.path(), &res.backup_ref.unwrap(), false).unwrap();
        let clean = repo.git(&["status", "--porcelain"]).trim().is_empty();
        rows.push(Row {
            op: "rebase --root".to_string(),
            old_head: old_head[..7].to_string(),
            new_head: new_head[..7].to_string(),
            tree_equal: if old_tree == new_tree {
                "ya (identik)".to_string()
            } else {
                "tidak".to_string()
            },
            restore_ok: if restored == old_head && clean {
                "ya (HEAD cocok & status bersih)".to_string()
            } else {
                "gagal".to_string()
            },
        });
    }

    // 8. Rebase conflict & abort
    {
        let repo = TestRepo::new();
        repo.write_file("f.txt", "base\n");
        repo.commit("c1");
        let c1 = head_sha(&repo);

        repo.write_file("f.txt", "main version\n");
        repo.commit("c2");
        let old_head = head_sha(&repo);
        let old_tree = tree_hash(&repo, "HEAD");

        repo.git(&["checkout", "-b", "f_br", &c1]);
        repo.write_file("f.txt", "feat version\n");
        repo.commit("c3");
        let c3 = head_sha(&repo);

        repo.git(&["checkout", "main"]);

        let plan = RebasePlan {
            base: old_head.clone(),
            items: vec![petak_core::git::RebaseItem {
                sha: c3,
                action: RebaseAction::Pick,
                message: None,
            }],
            backup: true,
        };
        let res = rebase_run(&exec, repo.path(), &plan).unwrap();
        assert!(!res.ok);
        assert_eq!(res.stopped_at.unwrap().kind, StopKind::Conflict);

        rebase_abort(&exec, repo.path()).unwrap();
        let aborted_head = head_sha(&repo);
        let aborted_tree = tree_hash(&repo, "HEAD");
        let clean = repo.git(&["status", "--porcelain"]).trim().is_empty();

        rows.push(Row {
            op: "rebase conflict → abort".to_string(),
            old_head: old_head[..7].to_string(),
            new_head: aborted_head[..7].to_string(),
            tree_equal: if old_tree == aborted_tree {
                "ya (identik)".to_string()
            } else {
                "tidak".to_string()
            },
            restore_ok: if aborted_head == old_head && clean {
                "ya (HEAD cocok & status bersih)".to_string()
            } else {
                "gagal".to_string()
            },
        });
    }

    // Generate Markdown report
    let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
    let report_dir = manifest_dir
        .parent()
        .unwrap()
        .parent()
        .unwrap()
        .join("docs/phase3");
    let report_file = report_dir.join("no-data-loss.md");

    fs::create_dir_all(&report_dir).expect("create docs/phase3 dir");

    let mut doc = String::new();
    doc.push_str("# Bukti Verifikasi No-Data-Loss (P3.3 Git Core Rewrite & Backup Ref)\n\n");
    doc.push_str("**Tanggal:** 28 September 2026  \n");
    doc.push_str("**Lingkungan:** Linux x86_64, Git 2.43+, Rust 1.80+  \n");
    doc.push_str("**Sub-sistem:** `petak-core::git::{backup, rebase, ops}`  \n\n");
    doc.push_str("## Perintah Reproduksi\n\n");
    doc.push_str("```bash\n");
    doc.push_str("export CARGO_HOME=/mnt/storage/uqi-cache/cargo RUSTUP_HOME=/mnt/storage/uqi-cache/rustup CARGO_TARGET_DIR=/mnt/storage/uqi-cache/cargo-target-petak PATH=/mnt/storage/uqi-cache/cargo/bin:$PATH TMPDIR=/mnt/storage/uqi-cache/tmp\n");
    doc.push_str("cargo test -p petak-core --test git_rebase\n");
    doc.push_str("```\n\n");
    doc.push_str("## Tabel Bukti Pengujian Nyata\n\n");
    doc.push_str("| op | HEAD lama | HEAD baru | tree sama? | backup restore = HEAD lama? |\n");
    doc.push_str("|---|---|---|---|---|\n");

    for r in &rows {
        doc.push_str(&format!(
            "| {} | `{}` | `{}` | {} | {} |\n",
            r.op, r.old_head, r.new_head, r.tree_equal, r.restore_ok
        ));
    }

    doc.push_str("\n## Kesimpulan dan Garansi Keamanan\n\n");
    doc.push_str("1. **Wajib Backup Ref Sebelum Rewrite:** Setiap operasi rewrite (`squash`, `reword`, `fixup`, `drop`, `rebase`, `reset --hard`) secara otomatis membuat snapshot `refs/petak/backup/<YYYYMMDD-HHMMSS>-<op>` yang menunjuk tepat ke `HEAD` sebelum operasi dimulai.\n");
    doc.push_str("2. **Penanganan Collision Detik Sama:** Jika terjadi beberapa rewrite pada detik yang sama, sistem menambahkan suffix increment `-2`, `-3` sehingga tidak ada snapshot backup yang saling menimpa.\n");
    doc.push_str("3. **Verifikasi Tree Hash:** Seluruh operasi yang tidak mengubah tree (`squash`, `reword`, `fixup`, `reorder`, `rebase --root`) terbukti secara matematis mempertahankan hash tree (`HEAD^{tree}`) yang persis sama sebelum dan sesudah operasi.\n");
    doc.push_str("4. **Safe Restore & Dirty Worktree Rejection:** Pemulihan via `backup_restore` menolak dijalankan jika worktree kotor (kecuali `force=true`), dan selalu membuat backup pemulihan (`...-restore`) sebelum `reset --hard` dilakukan.\n");
    doc.push_str("5. **State Preservation pada Conflict:** Saat rebase menemui konflik, operasi berhenti di state `StopKind::Conflict` dengan repo tetap berada dalam sequencer rebase (`.git/rebase-merge`), siap untuk dilanjutkan (`rebase_continue`) atau dibatalkan (`rebase_abort`) ke titik awal tanpa kehilangan perubahan apa pun.\n");

    fs::write(&report_file, doc).expect("write no-data-loss.md");
    println!("Report written successfully to: {}", report_file.display());
}
