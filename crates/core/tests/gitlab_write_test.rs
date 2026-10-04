mod gitlab_mock;

use gitlab_mock::MockGitLabServer;
use petak_core::exec::{git, SystemExec};
use petak_core::git::ops::checkout_mr;
use petak_core::gitlab::client::{translate_gitlab_error, GitLabClient, GitLabError};
use petak_core::gitlab::model::{
    evaluate_merge_status, CreateMrParams, DiffRefs, InlinePositionParams, MergeRequestParams,
};
use std::fs;
use std::path::Path;

#[test]
fn test_write_endpoints_mock_success() {
    let server = MockGitLabServer::start();
    let client = GitLabClient::new(server.url().to_string(), Some("api-token".to_string()));

    // 1. General note
    let note = client
        .create_note("1234", 1, "Ini komentar umum dari reviewer")
        .expect("create_note failed");
    assert_eq!(note.id, 302);
    assert_eq!(note.body, "mock note created");
    assert_eq!(note.author.username, "tester");

    // 2. Inline discussion
    let diff_refs = DiffRefs {
        base_sha: Some("1111111111111111111111111111111111111111".to_string()),
        start_sha: Some("1111111111111111111111111111111111111111".to_string()),
        head_sha: "2222222222222222222222222222222222222222".to_string(),
    };
    let pos = InlinePositionParams::from_diff_refs(&diff_refs, "src/main.rs", None, Some(15))
        .expect("build pos failed");

    let disc = client
        .create_inline_discussion("1234", 1, "Tolong perbaiki baris ini", &pos)
        .expect("create_inline_discussion failed");
    assert_eq!(disc.id, "disc-002");

    // 3. Reply to discussion
    let reply = client
        .reply_discussion("1234", 1, "disc-001", "Sudah diperbaiki pada commit terbaru")
        .expect("reply_discussion failed");
    assert_eq!(reply.id, 302);

    // 4. Resolve discussion
    let resolved = client
        .resolve_discussion("1234", 1, "disc-001", true)
        .expect("resolve_discussion failed");
    assert_eq!(resolved.id, "disc-001");

    // 5. Approve MR (with sha)
    let appr = client
        .approve_merge_request(
            "1234",
            1,
            Some("2222222222222222222222222222222222222222"),
        )
        .expect("approve failed");
    assert_eq!(appr["approved"], true);

    // 6. Unapprove MR
    let unappr = client
        .unapprove_merge_request("1234", 1)
        .expect("unapprove failed");
    assert_eq!(unappr["approved"], false);

    // 7. Merge MR with all params
    let params = MergeRequestParams {
        sha: "2222222222222222222222222222222222222222".to_string(),
        squash: Some(true),
        should_remove_source_branch: Some(true),
        merge_when_pipeline_succeeds: Some(false),
        squash_commit_message: Some("Squash commit message".to_string()),
        merge_commit_message: Some("Merge branch into main".to_string()),
    };
    let merge_res = client
        .merge_merge_request("1234", 1, &params)
        .expect("merge failed");
    assert_eq!(merge_res.iid, 1);
    assert_eq!(merge_res.state, "merged");

    // 8. Cancel MWPS
    let cancel_res = client
        .cancel_merge_when_pipeline_succeeds("1234", 1)
        .expect("cancel MWPS failed");
    assert_eq!(cancel_res.iid, 1);

    // 9. Create MR
    let create_params = CreateMrParams {
        source_branch: "feature/login".to_string(),
        target_branch: "main".to_string(),
        title: "Feature: Add user login".to_string(),
        description: Some("Implements authentication".to_string()),
        assignee_ids: Some(vec![101]),
        reviewer_ids: Some(vec![202]),
        remove_source_branch: Some(true),
    };
    let created_mr = client
        .create_merge_request("1234", &create_params)
        .expect("create MR failed");
    assert_eq!(created_mr.source_branch, "feature/login");
    assert_eq!(created_mr.target_branch, "main");
    assert_eq!(created_mr.title, "Feature: Add user login");

    // 10. Rebase MR
    let rebase_res = client
        .rebase_merge_request("1234", 1)
        .expect("rebase MR failed");
    assert_eq!(rebase_res["rebase_in_progress"], true);
}

#[test]
fn test_create_mr_validation() {
    let client = GitLabClient::new("http://localhost:1".to_string(), Some("token".to_string()));

    let empty_source = CreateMrParams {
        source_branch: "".to_string(),
        target_branch: "main".to_string(),
        title: "Test".to_string(),
        ..Default::default()
    };
    assert!(matches!(
        client.create_merge_request("123", &empty_source),
        Err(GitLabError::Validation(_))
    ));

    let empty_target = CreateMrParams {
        source_branch: "feature".to_string(),
        target_branch: "".to_string(),
        title: "Test".to_string(),
        ..Default::default()
    };
    assert!(matches!(
        client.create_merge_request("123", &empty_target),
        Err(GitLabError::Validation(_))
    ));

    let empty_title = CreateMrParams {
        source_branch: "feature".to_string(),
        target_branch: "main".to_string(),
        title: "   ".to_string(),
        ..Default::default()
    };
    assert!(matches!(
        client.create_merge_request("123", &empty_title),
        Err(GitLabError::Validation(_))
    ));
}

#[test]
fn test_inline_position_construction_and_validation() {
    let diff_refs = DiffRefs {
        base_sha: Some("base_sha_abc".to_string()),
        start_sha: Some("start_sha_abc".to_string()),
        head_sha: "head_sha_def".to_string(),
    };

    // 1. Valid new line position
    let pos_new = InlinePositionParams::from_diff_refs(&diff_refs, "crates/core/src/lib.rs", None, Some(42))
        .expect("construct valid pos_new");
    assert_eq!(pos_new.base_sha, "base_sha_abc");
    assert_eq!(pos_new.start_sha, "start_sha_abc");
    assert_eq!(pos_new.head_sha, "head_sha_def");
    assert_eq!(pos_new.old_path, "crates/core/src/lib.rs");
    assert_eq!(pos_new.new_path, "crates/core/src/lib.rs");
    assert_eq!(pos_new.position_type, "text");
    assert_eq!(pos_new.old_line, None);
    assert_eq!(pos_new.new_line, Some(42));

    // 2. Valid old line position (deletion)
    let pos_old = InlinePositionParams::from_diff_refs(&diff_refs, "crates/core/src/lib.rs", Some(10), None)
        .expect("construct valid pos_old");
    assert_eq!(pos_old.old_line, Some(10));
    assert_eq!(pos_old.new_line, None);

    // 3. Valid rename path
    let pos_rename = InlinePositionParams::with_paths(
        &diff_refs,
        "old/path/lib.rs",
        "new/path/lib.rs",
        Some(10),
        Some(12),
    )
    .expect("construct valid rename");
    assert_eq!(pos_rename.old_path, "old/path/lib.rs");
    assert_eq!(pos_rename.new_path, "new/path/lib.rs");

    // 4. Reject when both lines are None
    let pos_err = InlinePositionParams::from_diff_refs(&diff_refs, "file.txt", None, None);
    assert!(pos_err.is_err());
    assert!(pos_err.unwrap_err().contains("requires either old_line or new_line"));
}

#[test]
fn test_scope_read_api_rejects_write() {
    let server = MockGitLabServer::start();
    // Using read-token which only has read_api scope
    let client = GitLabClient::new(server.url().to_string(), Some("read-token".to_string()));

    // Verify token scope is indeed ReadOnly
    let scope = client.get_token_scope().expect("get scope");
    assert_eq!(scope, petak_core::gitlab::model::TokenScopeMode::ReadOnly);

    // 1. Note umum
    let err_note = client.create_note("1234", 1, "test");
    assert!(matches!(err_note, Err(GitLabError::InsufficientScope(_))));

    // 2. Inline discussion
    let diff_refs = DiffRefs {
        base_sha: Some("111".to_string()),
        start_sha: Some("111".to_string()),
        head_sha: "222".to_string(),
    };
    let pos = InlinePositionParams::from_diff_refs(&diff_refs, "test.rs", None, Some(1)).unwrap();
    let err_inline = client.create_inline_discussion("1234", 1, "test", &pos);
    assert!(matches!(err_inline, Err(GitLabError::InsufficientScope(_))));

    // 3. Reply discussion
    let err_reply = client.reply_discussion("1234", 1, "disc-1", "test");
    assert!(matches!(err_reply, Err(GitLabError::InsufficientScope(_))));

    // 4. Resolve discussion
    let err_resolve = client.resolve_discussion("1234", 1, "disc-1", true);
    assert!(matches!(err_resolve, Err(GitLabError::InsufficientScope(_))));

    // 5. Approve
    let err_approve = client.approve_merge_request("1234", 1, Some("222"));
    assert!(matches!(err_approve, Err(GitLabError::InsufficientScope(_))));

    // 6. Unapprove
    let err_unapprove = client.unapprove_merge_request("1234", 1);
    assert!(matches!(err_unapprove, Err(GitLabError::InsufficientScope(_))));

    // 7. Merge
    let params = MergeRequestParams {
        sha: "222".to_string(),
        ..Default::default()
    };
    let err_merge = client.merge_merge_request("1234", 1, &params);
    assert!(matches!(err_merge, Err(GitLabError::InsufficientScope(_))));

    // 8. Cancel MWPS
    let err_cancel = client.cancel_merge_when_pipeline_succeeds("1234", 1);
    assert!(matches!(err_cancel, Err(GitLabError::InsufficientScope(_))));
}

#[test]
fn test_merge_without_sha_rejected() {
    let server = MockGitLabServer::start();
    let client = GitLabClient::new(server.url().to_string(), Some("api-token".to_string()));

    // 1. Empty string
    let params_empty = MergeRequestParams {
        sha: "".to_string(),
        ..Default::default()
    };
    let err_empty = client.merge_merge_request("1234", 1, &params_empty);
    assert!(matches!(err_empty, Err(GitLabError::Validation(_))));

    // 2. Whitespace only
    let params_spaces = MergeRequestParams {
        sha: "   \t\n ".to_string(),
        ..Default::default()
    };
    let err_spaces = client.merge_merge_request("1234", 1, &params_spaces);
    assert!(matches!(err_spaces, Err(GitLabError::Validation(_))));
}

#[test]
fn test_error_translation_405_406_409() {
    // 1. Unit translation test
    let t_405 = translate_gitlab_error(405, r#"{"message":"Branch cannot be merged"}"#);
    assert!(t_405.contains("405 Method Not Allowed"));
    assert!(t_405.contains("Branch cannot be merged"));
    assert!(t_405.contains("Pastikan branch target tidak terkunci"));

    let t_406 = translate_gitlab_error(406, r#"{"message":"Branch already merged or SHA mismatch"}"#);
    assert!(t_406.contains("406 Not Acceptable"));
    assert!(t_406.contains("Permintaan tidak dapat diterima"));

    let t_409 = translate_gitlab_error(409, r#"{"message":"SHA does not match HEAD of source branch"}"#);
    assert!(t_409.contains("409 Conflict"));
    assert!(t_409.contains("Konflik merge atau SHA commit telah berubah"));

    // 2. HTTP test via mock server
    let server = MockGitLabServer::start();
    let client = GitLabClient::new(server.url().to_string(), Some("api-token".to_string()));

    // Simulated 405 (e.g. MR 2 which is draft)
    let params = MergeRequestParams {
        sha: "2222222222222222222222222222222222222222".to_string(),
        ..Default::default()
    };
    let err_405 = client.merge_merge_request("1234", 2, &params);
    match err_405 {
        Err(GitLabError::Http { status, message }) => {
            assert_eq!(status, 405);
            assert!(message.contains("405 Method Not Allowed"));
            assert!(message.contains("Pastikan branch target"));
        }
        other => panic!("Expected 405, got {:?}", other),
    }

    // Simulated 406 (MR 3)
    let err_406 = client.merge_merge_request("1234", 3, &params);
    match err_406 {
        Err(GitLabError::Http { status, message }) => {
            assert_eq!(status, 406);
            assert!(message.contains("406 Not Acceptable"));
            assert!(message.contains("Permintaan tidak dapat diterima"));
        }
        other => panic!("Expected 406, got {:?}", other),
    }

    // Simulated 409 (MR 4)
    let err_409 = client.merge_merge_request("1234", 4, &params);
    match err_409 {
        Err(GitLabError::Http { status, message }) => {
            assert_eq!(status, 409);
            assert!(message.contains("409 Conflict"));
            assert!(message.contains("Konflik merge atau SHA commit telah berubah"));
        }
        other => panic!("Expected 409, got {:?}", other),
    }
}

#[test]
fn test_evaluate_merge_status_mapping() {
    // 1. mergeable
    let m = evaluate_merge_status(Some("mergeable"));
    assert!(m.mergeable);
    assert!(!m.can_mwps);
    assert_eq!(m.reason, None);

    // 2. ci_still_running
    let ci = evaluate_merge_status(Some("ci_still_running"));
    assert!(!ci.mergeable);
    assert!(ci.can_mwps);
    assert!(ci.reason.as_ref().unwrap().contains("CI masih berjalan"));

    // 3. blocked_status
    let bl = evaluate_merge_status(Some("blocked_status"));
    assert!(!bl.mergeable);
    assert!(!bl.can_mwps);
    assert!(bl.reason.as_ref().unwrap().contains("diblokir"));

    // 4. not_approved
    let na = evaluate_merge_status(Some("not_approved"));
    assert!(!na.mergeable);
    assert!(!na.can_mwps);
    assert!(na.reason.as_ref().unwrap().contains("persetujuan"));

    // 5. discussions_not_resolved
    let disc = evaluate_merge_status(Some("discussions_not_resolved"));
    assert!(!disc.mergeable);
    assert!(!disc.can_mwps);
    assert!(disc.reason.as_ref().unwrap().contains("diskusi"));

    // 6. draft_status
    let draft = evaluate_merge_status(Some("draft_status"));
    assert!(!draft.mergeable);
    assert!(!draft.can_mwps);
    assert!(draft.reason.as_ref().unwrap().contains("draf"));

    // 7. conflict
    let conf = evaluate_merge_status(Some("conflict"));
    assert!(!conf.mergeable);
    assert!(!conf.can_mwps);
    assert!(conf.reason.as_ref().unwrap().contains("konflik"));

    // 8. Unknown / None
    let none = evaluate_merge_status(None);
    assert!(!none.mergeable);
    assert!(!none.can_mwps);
    assert!(none.reason.is_some());
}

#[test]
fn test_cache_invalidation_after_write() {
    let server = MockGitLabServer::start();
    let client = GitLabClient::new(server.url().to_string(), Some("api-token".to_string()));

    // 1. Detail MR (populates cache)
    let mr1 = client.get_merge_request("1234", 1).expect("get MR");
    assert_eq!(mr1.iid, 1);

    // 2. Write note
    client
        .create_note("1234", 1, "test write")
        .expect("write note");

    // 3. Cache was invalidated: get_merge_request should fetch fresh and succeed
    let mr2 = client.get_merge_request("1234", 1).expect("get MR after write");
    assert_eq!(mr2.iid, 1);
}

#[test]
fn test_checkout_mr_in_dummy_repo() {
    let exec = SystemExec;

    // Use a temp directory on HDD /mnt/storage if available, else system temp
    let hdd_tmp = Path::new("/mnt/storage/uqi-cache/tmp");
    let temp_dir = if hdd_tmp.exists() || fs::create_dir_all(hdd_tmp).is_ok() {
        tempfile::tempdir_in(hdd_tmp).unwrap_or_else(|_| tempfile::tempdir().unwrap())
    } else {
        tempfile::tempdir().unwrap()
    };
    let temp_path = temp_dir.path();

    let remote_dir = temp_path.join("remote.git");
    let local_dir = temp_path.join("local");

    // 1. Initialize bare remote repo
    git(&exec, temp_path, &["init", "--bare", remote_dir.to_str().unwrap()]).expect("init bare remote");

    // 2. Clone to a seed workdir to create initial commits and push to remote
    let seed_dir = temp_path.join("seed");
    git(&exec, temp_path, &["clone", remote_dir.to_str().unwrap(), seed_dir.to_str().unwrap()])
        .expect("clone seed");
    git(&exec, &seed_dir, &["config", "--local", "user.email", "test@example.com"]).unwrap();
    git(&exec, &seed_dir, &["config", "--local", "user.name", "Tester"]).unwrap();

    git(&exec, &seed_dir, &["checkout", "-B", "main"]).unwrap();
    fs::write(seed_dir.join("README.md"), "Initial commit").unwrap();
    git(&exec, &seed_dir, &["add", "README.md"]).unwrap();
    git(&exec, &seed_dir, &["commit", "-m", "Initial commit"]).unwrap();
    git(&exec, &seed_dir, &["push", "-u", "origin", "main"]).unwrap();

    // Create a feature branch for MR 99
    git(&exec, &seed_dir, &["checkout", "-b", "feature/mr99"]).unwrap();
    fs::write(seed_dir.join("mr99.txt"), "MR 99 content").unwrap();
    git(&exec, &seed_dir, &["add", "mr99.txt"]).unwrap();
    git(&exec, &seed_dir, &["commit", "-m", "MR 99 commit"]).unwrap();

    // Push refspec directly to remote as merge-requests/99/head
    git(&exec, &seed_dir, &["push", "origin", "HEAD:refs/merge-requests/99/head"]).unwrap();

    // 3. Clone remote to local repo
    git(&exec, temp_path, &["clone", remote_dir.to_str().unwrap(), local_dir.to_str().unwrap()])
        .expect("clone local");
    git(&exec, &local_dir, &["config", "--local", "user.email", "test@example.com"]).unwrap();
    git(&exec, &local_dir, &["config", "--local", "user.name", "Tester"]).unwrap();

    // 4. Test clean checkout_mr
    let checked_out_branch = checkout_mr(&exec, &local_dir, Some("origin"), 99)
        .expect("checkout_mr on clean tree should succeed");
    assert_eq!(checked_out_branch, "mr-99");

    // Verify current branch and file
    let current_branch = git(&exec, &local_dir, &["branch", "--show-current"]).unwrap();
    assert_eq!(current_branch.trim(), "mr-99");
    assert!(local_dir.join("mr99.txt").exists());

    // 5. Test dirty working tree rejects checkout_mr without auto-stash
    // Switch back to main first
    git(&exec, &local_dir, &["checkout", "main"]).unwrap();
    // Modify README.md without committing
    fs::write(local_dir.join("README.md"), "Uncommitted changes making tree dirty").unwrap();

    let dirty_err = checkout_mr(&exec, &local_dir, Some("origin"), 99);
    assert!(dirty_err.is_err());
    let err_msg = dirty_err.unwrap_err().message;
    assert!(err_msg.contains("Working tree kotor"));
    assert!(err_msg.contains("tanpa auto-stash"));

    // Verify current branch remains main and uncommitted changes are untouched
    let branch_after = git(&exec, &local_dir, &["branch", "--show-current"]).unwrap();
    assert_eq!(branch_after.trim(), "main");
    let content = fs::read_to_string(local_dir.join("README.md")).unwrap();
    assert_eq!(content, "Uncommitted changes making tree dirty");
}
