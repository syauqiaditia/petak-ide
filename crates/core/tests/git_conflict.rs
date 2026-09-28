mod common;

use common::gitrepo::TestRepo;
use petak_core::exec::SystemExec;
use petak_core::git::{
    conflict_write, conflicts, op_abort, op_continue, op_state, resolve_block, Choice,
    ConflictSide, RebaseStateKind,
};

#[test]
fn test_merge_conflict_conflicts_resolve_continue_and_abort() {
    let r = TestRepo::new();
    r.write_file("file.txt", "line 1\nline 2\nline 3\n");
    r.commit("initial commit");

    // Create branch feature
    r.git(&["checkout", "-b", "feature"]);
    r.write_file("file.txt", "line 1\nline 2 from feature\nline 3\n");
    r.commit("feature edit");

    // Checkout main and edit same line
    r.git(&["checkout", "main"]);
    r.write_file("file.txt", "line 1\nline 2 from main\nline 3\n");
    r.commit("main edit");
    let main_sha = r.git(&["rev-parse", "HEAD"]).trim().to_string();
    let main_tree = r.git(&["rev-parse", "HEAD^{tree}"]).trim().to_string();

    // Trigger conflict
    let merge_res = r.git_raw(&["merge", "feature"]);
    assert!(!merge_res.status.success(), "merge should have conflict");

    // 1. Verify op_state
    let state = op_state(&SystemExec, r.path()).expect("read op_state");
    assert_eq!(state.kind, RebaseStateKind::Merge);
    assert_eq!(state.head_name.as_deref(), Some("main"));
    assert!(state.onto_name.is_some());

    // 2. Verify conflicts()
    let conf_files = conflicts(&SystemExec, r.path()).expect("read conflicts");
    assert_eq!(conf_files.len(), 1);
    let cf = &conf_files[0];
    assert_eq!(cf.path, "file.txt");
    assert!(cf.ours.contains("line 2 from main"));
    assert!(cf.theirs.contains("line 2 from feature"));
    assert!(cf.base.as_ref().unwrap().contains("line 2\n"));
    assert!(cf.merged.contains("<<<<<<<"));
    assert_eq!(cf.blocks.len(), 1);
    assert_eq!(cf.deleted_in, None);

    // 3. Test op_abort restores exact HEAD sha and tree
    op_abort(&SystemExec, r.path()).expect("op_abort");
    let aborted_state = op_state(&SystemExec, r.path()).expect("read op_state after abort");
    assert_eq!(aborted_state.kind, RebaseStateKind::None);
    let after_abort_sha = r.git(&["rev-parse", "HEAD"]).trim().to_string();
    let after_abort_tree = r.git(&["rev-parse", "HEAD^{tree}"]).trim().to_string();
    assert_eq!(after_abort_sha, main_sha);
    assert_eq!(after_abort_tree, main_tree);
    let status_out = r.git(&["status", "--porcelain"]);
    assert!(status_out.trim().is_empty());

    // 4. Trigger merge conflict again to test resolve and continue
    let merge_res2 = r.git_raw(&["merge", "feature"]);
    assert!(!merge_res2.status.success());

    let conf_files2 = conflicts(&SystemExec, r.path()).expect("read conflicts 2");
    assert_eq!(conf_files2.len(), 1);
    let resolved = resolve_block(&conf_files2[0].merged, 0, Choice::Both);
    assert!(!resolved.contains("<<<<<<<"));
    assert!(resolved.contains("line 2 from main"));
    assert!(resolved.contains("line 2 from feature"));

    // Write resolved file and mark resolved (git add)
    conflict_write(&SystemExec, r.path(), "file.txt", &resolved, true)
        .expect("conflict_write mark_resolved");

    // Conflicts list should now be empty because it was staged
    let conf_files3 = conflicts(&SystemExec, r.path()).expect("read conflicts 3");
    assert_eq!(conf_files3.len(), 0);

    // Continue merge
    let cont_res = op_continue(&SystemExec, r.path()).expect("op_continue merge");
    assert!(cont_res.ok);
    assert!(cont_res.stopped_at.is_none());

    let final_state = op_state(&SystemExec, r.path()).expect("read op_state final");
    assert_eq!(final_state.kind, RebaseStateKind::None);

    let final_parents = r.git(&["rev-parse", "HEAD^@"]);
    let parent_count = final_parents.lines().count();
    assert_eq!(parent_count, 2, "merge commit should have 2 parents");

    let disk_content = std::fs::read_to_string(r.path().join("file.txt")).unwrap();
    assert_eq!(disk_content, resolved);
}

#[test]
fn test_rebase_conflict_resolve_continue_and_abort() {
    let r = TestRepo::new();
    r.write_file("file.txt", "base content\n");
    r.commit("initial commit");

    // Create branch feature
    r.git(&["checkout", "-b", "feature"]);
    r.write_file("file.txt", "feature content\n");
    r.commit("feature commit");

    // On main
    r.git(&["checkout", "main"]);
    r.write_file("file.txt", "main content\n");
    r.commit("main commit");

    // Checkout feature and rebase onto main -> conflict
    r.git(&["checkout", "feature"]);
    let feat_sha = r.git(&["rev-parse", "HEAD"]).trim().to_string();
    let rebase_res = r.git_raw(&["rebase", "main"]);
    assert!(!rebase_res.status.success());

    // 1. Verify op_state
    let state = op_state(&SystemExec, r.path()).expect("op_state");
    assert_eq!(state.kind, RebaseStateKind::Rebase);

    // 2. Verify conflicts()
    let conf_files = conflicts(&SystemExec, r.path()).expect("conflicts");
    assert_eq!(conf_files.len(), 1);

    // 3. Test op_abort
    op_abort(&SystemExec, r.path()).expect("op_abort rebase");
    let after_abort_sha = r.git(&["rev-parse", "HEAD"]).trim().to_string();
    assert_eq!(after_abort_sha, feat_sha);
    assert_eq!(
        op_state(&SystemExec, r.path()).unwrap().kind,
        RebaseStateKind::None
    );

    // 4. Rebase again, resolve, continue
    let rebase_res2 = r.git_raw(&["rebase", "main"]);
    assert!(!rebase_res2.status.success());

    let conf_files2 = conflicts(&SystemExec, r.path()).expect("conflicts 2");
    let resolved = resolve_block(&conf_files2[0].merged, 0, Choice::Theirs);
    conflict_write(&SystemExec, r.path(), "file.txt", &resolved, true).unwrap();

    let cont_res = op_continue(&SystemExec, r.path()).expect("op_continue rebase");
    assert!(cont_res.ok);
    assert_eq!(
        op_state(&SystemExec, r.path()).unwrap().kind,
        RebaseStateKind::None
    );
}

#[test]
fn test_cherry_pick_conflict_resolve_continue_and_abort() {
    let r = TestRepo::new();
    r.write_file("file.txt", "common base\n");
    r.commit("initial commit");

    r.git(&["checkout", "-b", "feature"]);
    r.write_file("file.txt", "cherry content\n");
    r.commit("feature to pick");
    let cp_sha = r.git(&["rev-parse", "HEAD"]).trim().to_string();

    r.git(&["checkout", "main"]);
    r.write_file("file.txt", "main different content\n");
    r.commit("main commit");
    let main_sha = r.git(&["rev-parse", "HEAD"]).trim().to_string();

    // Cherry-pick that causes conflict
    let cp_res = r.git_raw(&["cherry-pick", &cp_sha]);
    assert!(!cp_res.status.success());

    let state = op_state(&SystemExec, r.path()).expect("op_state");
    assert_eq!(state.kind, RebaseStateKind::CherryPick);

    let conf_files = conflicts(&SystemExec, r.path()).expect("conflicts");
    assert_eq!(conf_files.len(), 1);

    // Test abort
    op_abort(&SystemExec, r.path()).expect("op_abort cherry-pick");
    assert_eq!(r.git(&["rev-parse", "HEAD"]).trim(), main_sha);
    assert_eq!(
        op_state(&SystemExec, r.path()).unwrap().kind,
        RebaseStateKind::None
    );

    // Cherry-pick again, resolve, continue
    let _ = r.git_raw(&["cherry-pick", &cp_sha]);
    let conf_files2 = conflicts(&SystemExec, r.path()).expect("conflicts 2");
    let resolved = resolve_block(&conf_files2[0].merged, 0, Choice::Both);
    conflict_write(&SystemExec, r.path(), "file.txt", &resolved, true).unwrap();

    let cont_res = op_continue(&SystemExec, r.path()).expect("op_continue cherry-pick");
    assert!(cont_res.ok);
    assert_eq!(
        op_state(&SystemExec, r.path()).unwrap().kind,
        RebaseStateKind::None
    );
}

#[test]
fn test_conflict_deleted_in_ours() {
    let r = TestRepo::new();
    r.write_file("del_file.txt", "base file to delete\n");
    r.write_file("keep.txt", "keep me\n");
    r.commit("initial commit");

    // Feature modifies del_file.txt
    r.git(&["checkout", "-b", "feature"]);
    r.write_file("del_file.txt", "modified in feature\n");
    r.commit("modify del_file");

    // Main deletes del_file.txt
    r.git(&["checkout", "main"]);
    r.git(&["rm", "del_file.txt"]);
    r.commit("delete del_file");

    // Merge feature into main -> delete/modify conflict
    let merge_res = r.git_raw(&["merge", "feature"]);
    assert!(!merge_res.status.success());

    let conf_files = conflicts(&SystemExec, r.path()).expect("conflicts");
    assert_eq!(conf_files.len(), 1);
    let cf = &conf_files[0];
    assert_eq!(cf.path, "del_file.txt");
    assert_eq!(cf.deleted_in, Some(ConflictSide::Ours));
    assert!(cf.ours.is_empty());
    assert!(cf.theirs.contains("modified in feature"));
    assert!(cf.base.as_ref().unwrap().contains("base file to delete"));

    // Abort cleanly
    op_abort(&SystemExec, r.path()).expect("op_abort");
    assert_eq!(
        op_state(&SystemExec, r.path()).unwrap().kind,
        RebaseStateKind::None
    );
}
