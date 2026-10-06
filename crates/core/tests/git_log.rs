mod common;

use common::gitrepo::TestRepo;
use petak_core::exec::SystemExec;
use petak_core::git::{branches, log, LogFilter, RefKind};
use std::process::Command;

#[test]
fn test_git_log_and_branches_integration() {
    let repo = TestRepo::new();
    let exec = SystemExec;

    // 1. Initial commit (will be pushed to bare remote)
    repo.write_file("base.txt", "hello base\n");
    repo.commit("initial commit");

    // Get sha of commit 1
    let initial_sha = repo.git(&["rev-parse", "HEAD"]).trim().to_string();

    // 2. Set up bare remote in a temp dir
    let bare_dir = tempfile::tempdir().expect("bare repo tempdir");
    let bare_status = Command::new("git")
        .current_dir(bare_dir.path())
        .args(&["init", "--bare"])
        .env("LC_ALL", "C")
        .output()
        .expect("git init --bare");
    assert!(bare_status.status.success());

    let bare_url = format!("file://{}", bare_dir.path().display());
    repo.git(&["remote", "add", "origin", &bare_url]);
    repo.git(&["push", "-u", "origin", "main"]);

    // 3. Add tag v1.0.0 pointing to initial commit
    repo.git(&["tag", "v1.0.0"]);

    // 4. Second commit on main by Dimas (unpushed)
    repo.write_file("dimas.txt", "dimas work\n");
    repo.git(&[
        "-c",
        "user.name=Dimas",
        "-c",
        "user.email=dimas@petak.local",
        "add",
        "dimas.txt",
    ]);
    repo.git(&[
        "-c",
        "user.name=Dimas",
        "-c",
        "user.email=dimas@petak.local",
        "commit",
        "-m",
        "feat: dimas commit",
    ]);
    let dimas_sha = repo.git(&["rev-parse", "HEAD"]).trim().to_string();

    // Add a backup ref on Dimas commit to ensure it's ignored from badges
    repo.git(&["update-ref", "refs/petak/backup/20260928-01", &dimas_sha]);

    // 5. Create feature branch and commit by Alice (unpushed)
    repo.git(&["checkout", "-b", "feature"]);
    repo.write_file("alice.txt", "alice feature\n");
    repo.git(&[
        "-c",
        "user.name=Alice",
        "-c",
        "user.email=alice@petak.local",
        "add",
        "alice.txt",
    ]);
    repo.git(&[
        "-c",
        "user.name=Alice",
        "-c",
        "user.email=alice@petak.local",
        "commit",
        "-m",
        "feat: alice feature 🚀",
    ]);
    let alice_sha = repo.git(&["rev-parse", "HEAD"]).trim().to_string();

    // 6. Create a stash to ensure stashes are excluded from git log graph
    repo.write_file("stash_test.txt", "wip stash\n");
    repo.git(&["stash", "push", "-u", "-m", "wip test stash"]);

    // -------------------------------------------------------------
    // Test branches()
    // -------------------------------------------------------------
    let bl = branches(&exec, repo.path()).expect("branches should succeed");

    // Local branches
    let main_branch = bl
        .local
        .iter()
        .find(|b| b.name == "main")
        .expect("main branch");
    assert_eq!(main_branch.sha, dimas_sha);
    assert_eq!(main_branch.upstream.as_deref(), Some("origin/main"));
    assert_eq!(main_branch.ahead, 1);
    assert_eq!(main_branch.behind, 0);
    assert!(!main_branch.is_current);

    let feat_branch = bl
        .local
        .iter()
        .find(|b| b.name == "feature")
        .expect("feature branch");
    assert_eq!(feat_branch.sha, alice_sha);
    assert!(feat_branch.is_current);
    assert_eq!(feat_branch.upstream, None);

    // Remote branches
    let remote_main = bl
        .remote
        .iter()
        .find(|b| b.name == "origin/main")
        .expect("origin/main");
    assert_eq!(remote_main.sha, initial_sha);

    // Tags
    let tag = bl
        .tags
        .iter()
        .find(|t| t.name == "v1.0.0")
        .expect("v1.0.0 tag");
    assert_eq!(tag.sha, initial_sha);

    // -------------------------------------------------------------
    // Test log() default filter (all branches)
    // -------------------------------------------------------------
    let page = log(&exec, repo.path(), &LogFilter::default(), 0, 500).expect("log should succeed");
    assert_eq!(page.commits.len(), 3);
    assert_eq!(page.graph.len(), 3);

    // Commit 0: Alice's commit
    let c0 = &page.commits[0];
    assert_eq!(c0.sha, alice_sha);
    assert_eq!(c0.author_name, "Alice");
    assert_eq!(c0.subject, "feat: alice feature 🚀");
    assert!(!c0.pushed, "Alice commit should not be pushed");
    // Check refs: HEAD and feature
    assert!(c0
        .refs
        .iter()
        .any(|r| r.kind == RefKind::Head && r.is_current));
    assert!(c0
        .refs
        .iter()
        .any(|r| r.kind == RefKind::Branch && r.name == "feature" && r.is_current));

    // Commit 1: Dimas's commit
    let c1 = &page.commits[1];
    assert_eq!(c1.sha, dimas_sha);
    assert_eq!(c1.author_name, "Dimas");
    assert!(!c1.pushed, "Dimas commit should not be pushed");
    assert!(c1
        .refs
        .iter()
        .any(|r| r.kind == RefKind::Branch && r.name == "main"));
    // Ensure refs/petak/backup/20260928-01 is ignored
    assert!(!c1.refs.iter().any(|r| r.name.contains("backup")));

    // Commit 2: Initial commit
    let c2 = &page.commits[2];
    assert_eq!(c2.sha, initial_sha);
    assert!(c2.pushed, "Initial commit should be pushed");
    assert!(c2
        .refs
        .iter()
        .any(|r| r.kind == RefKind::Remote && r.name == "origin/main"));
    assert!(c2
        .refs
        .iter()
        .any(|r| r.kind == RefKind::Tag && r.name == "v1.0.0"));

    // -------------------------------------------------------------
    // Test filter by author
    // -------------------------------------------------------------
    let author_filter = LogFilter {
        author: Some("Alice".to_string()),
        ..Default::default()
    };
    let author_page = log(&exec, repo.path(), &author_filter, 0, 500).unwrap();
    assert_eq!(author_page.commits.len(), 1);
    assert_eq!(author_page.commits[0].author_name, "Alice");

    // -------------------------------------------------------------
    // Test filter by path
    // -------------------------------------------------------------
    let path_filter = LogFilter {
        path: Some("dimas.txt".to_string()),
        ..Default::default()
    };
    let path_page = log(&exec, repo.path(), &path_filter, 0, 500).unwrap();
    assert_eq!(path_page.commits.len(), 1);
    assert_eq!(path_page.commits[0].sha, dimas_sha);

    // -------------------------------------------------------------
    // Test filter by text (commit message)
    // -------------------------------------------------------------
    let text_filter = LogFilter {
        text: Some("alice feature".to_string()),
        ..Default::default()
    };
    let text_page = log(&exec, repo.path(), &text_filter, 0, 500).unwrap();
    assert_eq!(text_page.commits.len(), 1);
    assert_eq!(text_page.commits[0].sha, alice_sha);

    // -------------------------------------------------------------
    // Test filter by sha prefix (hex >= 4 chars)
    // -------------------------------------------------------------
    let sha_prefix = &dimas_sha[..6];
    let sha_filter = LogFilter {
        text: Some(sha_prefix.to_string()),
        ..Default::default()
    };
    let sha_page = log(&exec, repo.path(), &sha_filter, 0, 500).unwrap();
    assert_eq!(sha_page.commits.len(), 1);
    assert_eq!(sha_page.commits[0].sha, dimas_sha);
}
