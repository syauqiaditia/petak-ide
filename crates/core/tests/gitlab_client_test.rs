mod gitlab_mock;

use gitlab_mock::MockGitLabServer;
use petak_core::exec::Exec;
use petak_core::git::model::{DiffLineKind, FileState};
use petak_core::gitlab::client::{
    parse_remote_url, resolve_token_from_git_credential, GitLabCache, GitLabClient, GitLabError,
};
use petak_core::gitlab::model::{MrListQuery, TokenScopeMode};
use std::io;
use std::path::Path;
use std::process::{ExitStatus, Output};
use std::sync::{Arc, Mutex};

#[test]
fn test_client_auth_and_scope_detection() {
    let server = MockGitLabServer::start();

    // 1. Full token -> TokenScopeMode::Full
    let client_full = GitLabClient::new(server.url().to_string(), Some("api-token".to_string()));
    let scope_full = client_full.get_token_scope().expect("scope check failed");
    assert_eq!(scope_full, TokenScopeMode::Full);

    // 2. Read-only token -> TokenScopeMode::ReadOnly
    let client_read = GitLabClient::new(server.url().to_string(), Some("read-token".to_string()));
    let scope_read = client_read
        .get_token_scope()
        .expect("read scope check failed");
    assert_eq!(scope_read, TokenScopeMode::ReadOnly);

    // 3. Invalid token -> GitLabError::Unauthorized
    let client_invalid =
        GitLabClient::new(server.url().to_string(), Some("invalid-token".to_string()));
    let err_invalid = client_invalid.get_token_scope();
    match err_invalid {
        Err(GitLabError::Unauthorized(_)) => {}
        other => panic!("Expected Unauthorized, got {:?}", other),
    }

    // 4. Missing token -> GitLabError::Unauthorized
    let client_none = GitLabClient::new(server.url().to_string(), None);
    let err_none = client_none.get_token_scope();
    match err_none {
        Err(GitLabError::Unauthorized(_)) => {}
        other => panic!("Expected Unauthorized, got {:?}", other),
    }
}

#[test]
fn test_client_pagination_and_etag_caching() {
    let server = MockGitLabServer::start();
    let cache = Arc::new(Mutex::new(GitLabCache::new(2 * 1024 * 1024)));
    let client = GitLabClient::with_cache(
        server.url().to_string(),
        Some("test-token".to_string()),
        cache.clone(),
    );

    // Page 1
    let query_p1 = MrListQuery {
        page: Some(1),
        per_page: Some(2),
        ..Default::default()
    };
    let res_p1 = client
        .list_merge_requests("1234", &query_p1)
        .expect("list page 1 failed");
    assert_eq!(res_p1.items.len(), 2);
    assert_eq!(res_p1.pagination.page, 1);
    assert_eq!(res_p1.pagination.per_page, 2);
    assert_eq!(res_p1.pagination.next_page, Some(2));
    assert_eq!(res_p1.pagination.total_pages, Some(2));
    assert_eq!(res_p1.pagination.total, Some(3));
    assert_eq!(res_p1.items[0].iid, 1);
    assert_eq!(res_p1.items[1].iid, 2);

    // Page 2
    let query_p2 = MrListQuery {
        page: Some(2),
        per_page: Some(2),
        ..Default::default()
    };
    let res_p2 = client
        .list_merge_requests("1234", &query_p2)
        .expect("list page 2 failed");
    assert_eq!(res_p2.items.len(), 1);
    assert_eq!(res_p2.pagination.page, 2);
    assert_eq!(res_p2.pagination.next_page, None);
    assert_eq!(res_p2.items[0].iid, 3);

    // Re-request Page 1: returns from cache / ETag 304 without error
    let res_p1_cached = client
        .list_merge_requests("1234", &query_p1)
        .expect("list cached page 1 failed");
    assert_eq!(res_p1_cached.items.len(), 2);
    assert_eq!(res_p1_cached.items[0].title, res_p1.items[0].title);

    // Invalidate cache
    client.invalidate_cache();
    let res_p1_after_inv = client
        .list_merge_requests("1234", &query_p1)
        .expect("list page 1 after invalidate failed");
    assert_eq!(res_p1_after_inv.items.len(), 2);
}

#[test]
fn test_client_rate_limiting_429() {
    let server = MockGitLabServer::start();
    let client = GitLabClient::new(server.url().to_string(), Some("test-token".to_string()));

    // When hitting rate-limited endpoint, returns GitLabError::RateLimited with Retry-After header
    let res = client.get_raw_url(&format!("{}/api/v4/rate-limited", server.url()));
    match res {
        Err(GitLabError::RateLimited {
            retry_after,
            message,
        }) => {
            assert_eq!(retry_after, 5);
            assert!(message.contains("429 Too Many Requests"));
        }
        other => panic!("Expected RateLimited 429, got: {:?}", other),
    }
}

#[test]
fn test_client_detail_pipelines_jobs_discussions() {
    let server = MockGitLabServer::start();
    let client = GitLabClient::new(server.url().to_string(), Some("test-token".to_string()));

    // 1. Detail
    let mr = client
        .get_merge_request("1234", 1)
        .expect("get_merge_request failed");
    assert_eq!(mr.id, 501);
    assert_eq!(mr.iid, 1);
    assert_eq!(mr.detailed_merge_status.as_deref(), Some("mergeable"));
    assert_eq!(mr.author.username, "tester");
    assert_eq!(mr.target_branch, "main");
    assert_eq!(mr.source_branch, "feat/cache");
    assert!(mr.head_pipeline.is_some());
    let hp = mr.head_pipeline.as_ref().unwrap();
    assert_eq!(hp.id, 9001);
    assert_eq!(hp.status, "success");
    assert_eq!(hp.ref_name, "feat/cache");
    assert!(mr.diff_refs.is_some());
    let dr = mr.diff_refs.as_ref().unwrap();
    assert_eq!(dr.head_sha, "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678");

    // 2. Pipelines
    let pipelines = client.get_pipelines("1234", 1).expect("pipelines failed");
    assert_eq!(pipelines.len(), 1);
    assert_eq!(pipelines[0].id, 9001);
    assert_eq!(pipelines[0].status, "success");

    // 3. Jobs
    let jobs = client
        .get_pipeline_jobs("1234", 9001)
        .expect("pipeline jobs failed");
    assert_eq!(jobs.len(), 2);
    assert_eq!(jobs[0].name, "cargo-test");
    assert_eq!(jobs[0].stage, "test");
    assert_eq!(jobs[0].status, "success");
    assert_eq!(jobs[1].name, "cargo-clippy");
    assert_eq!(jobs[1].stage, "lint");

    // 4. Discussions
    let discussions = client
        .get_discussions("1234", 1)
        .expect("discussions failed");
    assert_eq!(discussions.len(), 1);
    assert_eq!(discussions[0].id, "disc-001");
    assert_eq!(discussions[0].notes.len(), 1);
    let note = &discussions[0].notes[0];
    assert_eq!(note.id, 301);
    assert_eq!(note.note_type.as_deref(), Some("DiffNote"));
    assert!(note.body.contains("cache capacity"));
    assert_eq!(note.author.username, "reviewer1");
    assert!(note.position.is_some());
    let pos = note.position.as_ref().unwrap();
    assert_eq!(pos.new_path.as_deref(), Some("src/cache.rs"));
    assert_eq!(pos.new_line, Some(6));

    // 5. Current User
    let user = client.get_current_user().expect("get_current_user failed");
    assert_eq!(user.id, 42);
    assert_eq!(user.username, "tester");
    assert_eq!(user.name, "Dev Tester");
}

#[test]
fn test_client_diffs_and_fallback_changes() {
    let server = MockGitLabServer::start();
    let client = GitLabClient::new(server.url().to_string(), Some("test-token".to_string()));

    // 1. Modern GitLab project: uses /diffs
    let diffs = client
        .get_diffs("1234", 1, Some("a1b2c3d4e5f60718293a4b5c6d7e8f9012345678"))
        .expect("get_diffs normal failed");
    assert_eq!(diffs.len(), 2);

    let cache_file = &diffs[0];
    assert_eq!(cache_file.new_path.as_deref(), Some("src/cache.rs"));
    assert_eq!(cache_file.status, FileState::Added);
    assert_eq!(cache_file.hunks.len(), 1);
    let hunk0 = &cache_file.hunks[0];
    assert_eq!(hunk0.old_start, 0);
    assert_eq!(hunk0.new_start, 1);
    assert_eq!(hunk0.new_lines, 15);
    assert_eq!(hunk0.lines[0].kind, DiffLineKind::Add);
    assert_eq!(hunk0.lines[0].text, "pub struct Cache {");
    assert_eq!(hunk0.lines[0].new_no, Some(1));

    let lib_file = &diffs[1];
    assert_eq!(lib_file.new_path.as_deref(), Some("src/lib.rs"));
    assert_eq!(lib_file.status, FileState::Modified);
    assert_eq!(lib_file.hunks.len(), 1);
    let hunk1 = &lib_file.hunks[0];
    assert_eq!(hunk1.lines[0].kind, DiffLineKind::Add);
    assert_eq!(hunk1.lines[0].text, "pub mod cache;");
    assert_eq!(hunk1.lines[1].kind, DiffLineKind::Context);
    assert_eq!(hunk1.lines[1].text, "pub mod config;");

    // 2. Legacy GitLab project: /diffs returns 404, falls back to /changes
    let fallback_diffs = client
        .get_diffs("legacy", 1, None)
        .expect("get_diffs fallback failed");
    assert_eq!(fallback_diffs.len(), 1);
    assert_eq!(fallback_diffs[0].new_path.as_deref(), Some("src/cache.rs"));
    assert_eq!(fallback_diffs[0].status, FileState::Added);
}

#[test]
fn test_remote_url_parsing_and_project_id_resolution() {
    let server = MockGitLabServer::start();
    let client = GitLabClient::new(server.url().to_string(), Some("test-token".to_string()));

    // 1. Remote URL parsing: HTTPS
    let (base1, host1, proj1) =
        parse_remote_url("https://gitlab.example.local/opensource/sample-project.git")
            .expect("HTTPS parse failed");
    assert_eq!(base1, "https://gitlab.example.local");
    assert_eq!(host1, "gitlab.example.local");
    assert_eq!(proj1, "opensource/sample-project");

    // 2. Remote URL parsing: SSH SCP syntax
    let (base2, host2, proj2) =
        parse_remote_url("git@gitlab.example.local:opensource/sample-project.git")
            .expect("SSH parse failed");
    assert_eq!(base2, "https://gitlab.example.local");
    assert_eq!(host2, "gitlab.example.local");
    assert_eq!(proj2, "opensource/sample-project");

    // 3. Remote URL parsing: SSH URI with custom port
    let (base3, host3, proj3) = parse_remote_url("ssh://git@code.istar.id:2222/jatim/jconnect.git")
        .expect("SSH URI parse failed");
    assert_eq!(base3, "https://code.istar.id");
    assert_eq!(host3, "code.istar.id");
    assert_eq!(proj3, "jatim/jconnect");

    // 4. Remote URL parsing: HTTP local test URL
    let (base4, host4, proj4) = parse_remote_url("http://127.0.0.1:8080/group/subgroup/project")
        .expect("HTTP local parse failed");
    assert_eq!(base4, "http://127.0.0.1:8080");
    assert_eq!(host4, "127.0.0.1:8080");
    assert_eq!(proj4, "group/subgroup/project");

    // 5. Project ID resolution
    let pid_numeric = client
        .resolve_project_id("1234")
        .expect("numeric project id resolution failed");
    assert_eq!(pid_numeric, 1234);

    let pid_path = client
        .resolve_project_id("opensource/sample-project")
        .expect("path project id resolution failed");
    assert_eq!(pid_path, 1234);
}

struct MockCredentialExec {
    stdout: Vec<u8>,
    exit_code: i32,
}

#[cfg(unix)]
use std::os::unix::process::ExitStatusExt;

impl Exec for MockCredentialExec {
    fn run(
        &self,
        _cwd: &Path,
        _program: &str,
        _args: &[&str],
        _env: &[(&str, &str)],
        _stdin: Option<&[u8]>,
    ) -> io::Result<Output> {
        Ok(Output {
            #[cfg(unix)]
            status: ExitStatus::from_raw(self.exit_code << 8),
            #[cfg(not(unix))]
            status: ExitStatus::default(),
            stdout: self.stdout.clone(),
            stderr: Vec::new(),
        })
    }
}

#[test]
fn test_git_credential_fill_mock() {
    let mock_exec = MockCredentialExec {
        stdout: b"protocol=https\nhost=gitlab.example.local\nusername=oauth2\npassword=glpat-secret-1234567890\n\n".to_vec(),
        exit_code: 0,
    };

    let token =
        resolve_token_from_git_credential(&mock_exec, Path::new("."), "gitlab.example.local")
            .expect("resolve_token_from_git_credential failed");

    assert_eq!(token, "glpat-secret-1234567890");

    // Failure case: empty token
    let mock_fail = MockCredentialExec {
        stdout: b"protocol=https\nhost=gitlab.example.local\n\n".to_vec(),
        exit_code: 0,
    };
    let err = resolve_token_from_git_credential(&mock_fail, Path::new("."), "gitlab.example.local");
    assert!(matches!(err, Err(GitLabError::AuthTokenNotFound(_))));
}
