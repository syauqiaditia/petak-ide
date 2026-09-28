mod common;

use std::fs;
use std::process::Command;

use common::gitrepo::TestRepo;
use petak_core::exec::SystemExec;
use petak_core::git::{fetch, pull, push, remotes, status, PullMode, StopKind};

#[test]
fn test_remotes_list() {
    let r = TestRepo::new();
    r.git(&["remote", "add", "origin", "https://example.com/repo.git"]);
    r.git(&[
        "remote",
        "add",
        "upstream",
        "git@github.com:petak/upstream.git",
    ]);

    let list = remotes(&SystemExec, r.path()).expect("remotes");
    assert_eq!(list.len(), 2);
    assert_eq!(list[0].name, "origin");
    assert_eq!(
        list[0].fetch_url.as_deref(),
        Some("https://example.com/repo.git")
    );
    assert_eq!(list[1].name, "upstream");
    assert_eq!(
        list[1].fetch_url.as_deref(),
        Some("git@github.com:petak/upstream.git")
    );
}

#[test]
fn test_remote_fetch_pull_push_and_force_with_lease_flow() {
    // 1. Create bare repo tempdir
    let bare = tempfile::tempdir().expect("bare repo tempdir");
    let status_init = Command::new("git")
        .current_dir(bare.path())
        .args(["init", "--bare", "-b", "main"])
        .env("LC_ALL", "C")
        .status()
        .expect("git init --bare");
    assert!(status_init.success());
    let bare_url = format!("file://{}", bare.path().display());

    // 2. Repo 1 (r1): push -u
    let r1 = TestRepo::new();
    r1.write_file("file.txt", "v1 in r1\n");
    r1.commit("initial commit");
    r1.git(&["remote", "add", "origin", &bare_url]);

    let push_res =
        push(&SystemExec, r1.path(), "origin", "main", true, false).expect("push -u origin main");
    assert!(push_res.ok);

    let st1 = status(&SystemExec, r1.path()).expect("status r1");
    assert_eq!(st1.branch.upstream.as_deref(), Some("origin/main"));
    assert_eq!(st1.branch.ahead, 0);
    assert_eq!(st1.branch.behind, 0);

    // 3. Repo 2 (r2): clone, commit, push
    let r2_dir = tempfile::tempdir().expect("r2 tempdir");
    let clone_status = Command::new("git")
        .args(["clone", &bare_url, r2_dir.path().to_str().unwrap()])
        .env("LC_ALL", "C")
        .status()
        .expect("git clone");
    assert!(clone_status.success());

    // Configure r2 identity
    let _ = Command::new("git")
        .current_dir(r2_dir.path())
        .args(["config", "--local", "user.name", "Petak R2"])
        .status();
    let _ = Command::new("git")
        .current_dir(r2_dir.path())
        .args(["config", "--local", "user.email", "r2@petak.local"])
        .status();

    fs::write(r2_dir.path().join("file2.txt"), "file2 from r2\n").expect("write file2 in r2");
    let _ = Command::new("git")
        .current_dir(r2_dir.path())
        .args(["add", "-A"])
        .status();
    let _ = Command::new("git")
        .current_dir(r2_dir.path())
        .args(["commit", "-m", "r2 commit"])
        .status();
    let r2_push_status = Command::new("git")
        .current_dir(r2_dir.path())
        .args(["push", "origin", "main"])
        .env("LC_ALL", "C")
        .status()
        .expect("r2 push");
    assert!(r2_push_status.success());

    // 4. Repo 1 (r1): fetch -> behind=1, pull --rebase -> sinkron
    fetch(&SystemExec, r1.path(), Some("origin"), false).expect("fetch origin");
    let st1_after_fetch = status(&SystemExec, r1.path()).expect("status r1 after fetch");
    assert_eq!(st1_after_fetch.branch.behind, 1);

    let pull_res = pull(&SystemExec, r1.path(), PullMode::Rebase).expect("pull --rebase into r1");
    assert!(pull_res.ok);
    let st1_after_pull = status(&SystemExec, r1.path()).expect("status r1 after pull");
    assert_eq!(st1_after_pull.branch.behind, 0);
    assert_eq!(st1_after_pull.branch.ahead, 0);
    assert!(r1.path().join("file2.txt").is_file());

    // 5. Divergence: r2 commits and pushes, r1 commits without fetching
    fs::write(r2_dir.path().join("file_r2_div.txt"), "r2 diverged\n").expect("write r2 div");
    let _ = Command::new("git")
        .current_dir(r2_dir.path())
        .args(["add", "-A"])
        .status();
    let _ = Command::new("git")
        .current_dir(r2_dir.path())
        .args(["commit", "-m", "r2 diverged commit"])
        .status();
    let _ = Command::new("git")
        .current_dir(r2_dir.path())
        .args(["push", "origin", "main"])
        .status();

    r1.write_file("file_r1_div.txt", "r1 diverged\n");
    r1.commit("r1 diverged commit");

    // Push biasa ditolak (error jelas, bukan panic)
    let push_err = push(&SystemExec, r1.path(), "origin", "main", false, false)
        .expect_err("normal push must be rejected on diverged branch");
    assert!(
        push_err.message.contains("rejected")
            || push_err.message.contains("fetch first")
            || push_err.message.contains("non-fast-forward"),
        "error message should be clear: {}",
        push_err.message
    );

    // 6. Force-with-lease test
    // Case A: Before fetching in r1, remote lease is already stale!
    let stale_lease_err = push(&SystemExec, r1.path(), "origin", "main", false, true)
        .expect_err("force-with-lease must fail when tracking ref is stale");
    assert!(
        stale_lease_err.message.contains("rejected") || stale_lease_err.message.contains("stale"),
        "stale lease error: {}",
        stale_lease_err.message
    );

    // Now fetch so r1 knows the current remote state
    fetch(&SystemExec, r1.path(), Some("origin"), false).expect("fetch in r1");

    // Now force_with_lease should succeed!
    let force_res = push(&SystemExec, r1.path(), "origin", "main", false, true)
        .expect("force_with_lease should succeed after fetch");
    assert!(force_res.ok);

    // Case B: Lease basi lagi (r2 advances remote again after r1's push)
    fs::write(r2_dir.path().join("r2_stale.txt"), "r2 moves again\n").unwrap();
    let _ = Command::new("git")
        .current_dir(r2_dir.path())
        .args(["add", "-A"])
        .status();
    let _ = Command::new("git")
        .current_dir(r2_dir.path())
        .args(["commit", "-m", "r2 stale commit"])
        .status();
    let r2_force_status = Command::new("git")
        .current_dir(r2_dir.path())
        .args(["push", "--force", "origin", "main"])
        .status()
        .expect("r2 push --force");
    assert!(r2_force_status.success());

    // In r1, make another commit WITHOUT fetching, and try force-with-lease
    r1.write_file("r1_another.txt", "r1 another commit\n");
    r1.commit("r1 another commit");

    let lease_stale_again_err = push(&SystemExec, r1.path(), "origin", "main", false, true)
        .expect_err("force-with-lease must be rejected when remote moved ahead");
    assert!(
        lease_stale_again_err.message.contains("rejected")
            || lease_stale_again_err.message.contains("stale"),
        "stale lease again error: {}",
        lease_stale_again_err.message
    );
}

#[test]
fn test_pull_conflict_stops_at_conflict() {
    let bare = tempfile::tempdir().expect("bare tempdir");
    let _ = Command::new("git")
        .current_dir(bare.path())
        .args(["init", "--bare", "-b", "main"])
        .env("LC_ALL", "C")
        .status();
    let bare_url = format!("file://{}", bare.path().display());

    // r1: initial commit pushed
    let r1 = TestRepo::new();
    r1.write_file("conflict.txt", "common line\n");
    r1.commit("init");
    r1.git(&["remote", "add", "origin", &bare_url]);
    push(&SystemExec, r1.path(), "origin", "main", true, false).unwrap();

    // r2: clones, edits conflict.txt, pushes
    let r2_dir = tempfile::tempdir().expect("r2 tempdir");
    let _ = Command::new("git")
        .args(["clone", &bare_url, r2_dir.path().to_str().unwrap()])
        .env("LC_ALL", "C")
        .status();
    let _ = Command::new("git")
        .current_dir(r2_dir.path())
        .args(["config", "--local", "user.name", "Tester 2"])
        .status();
    let _ = Command::new("git")
        .current_dir(r2_dir.path())
        .args(["config", "--local", "user.email", "t2@local"])
        .status();
    fs::write(r2_dir.path().join("conflict.txt"), "line from r2\n").unwrap();
    let _ = Command::new("git")
        .current_dir(r2_dir.path())
        .args(["add", "-A"])
        .status();
    let _ = Command::new("git")
        .current_dir(r2_dir.path())
        .args(["commit", "-m", "r2 change"])
        .status();
    let _ = Command::new("git")
        .current_dir(r2_dir.path())
        .args(["push", "origin", "main"])
        .status();

    // r1: conflicting commit locally
    r1.write_file("conflict.txt", "line from r1\n");
    r1.commit("r1 change");

    // Fetch in r1
    fetch(&SystemExec, r1.path(), Some("origin"), false).unwrap();

    // Pull merge -> should stop at conflict
    let pull_res = pull(&SystemExec, r1.path(), PullMode::Merge).expect("pull returns OpResult");
    assert!(!pull_res.ok);
    assert!(pull_res.stopped_at.is_some());
    assert_eq!(pull_res.stopped_at.unwrap().kind, StopKind::Conflict);

    // Abort cleanly
    petak_core::git::op_abort(&SystemExec, r1.path()).expect("op_abort after pull conflict");
    let st = status(&SystemExec, r1.path()).unwrap();
    assert!(st.entries.iter().all(|e| !e.conflicted));
}
