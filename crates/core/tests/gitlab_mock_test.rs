mod gitlab_mock;

use gitlab_mock::MockGitLabServer;
use serde_json::Value;

#[test]
fn test_mock_server_start_and_user() {
    let server = MockGitLabServer::start();
    assert!(server.url().starts_with("http://127.0.0.1:"));

    let resp = ureq::get(&format!("{}/api/v4/user", server.url()))
        .set("PRIVATE-TOKEN", "valid-token")
        .call()
        .expect("GET /user failed");

    assert_eq!(resp.status(), 200);
    let user: Value = resp.into_json().expect("Failed to parse JSON");
    assert_eq!(user["id"], 42);
    assert_eq!(user["username"], "tester");
}

#[test]
fn test_mock_server_auth_and_scope() {
    let server = MockGitLabServer::start();

    // 1. Missing token -> 401
    let err_missing = ureq::get(&format!("{}/api/v4/user", server.url())).call();
    match err_missing {
        Err(ureq::Error::Status(401, resp)) => {
            let body: Value = resp.into_json().unwrap();
            assert_eq!(body["message"], "401 Unauthorized");
        }
        other => panic!("Expected 401, got: {:?}", other),
    }

    // 2. Invalid token -> 401
    let err_invalid = ureq::get(&format!("{}/api/v4/user", server.url()))
        .set("PRIVATE-TOKEN", "invalid-token")
        .call();
    match err_invalid {
        Err(ureq::Error::Status(401, resp)) => {
            let body: Value = resp.into_json().unwrap();
            assert_eq!(body["message"], "401 Unauthorized");
        }
        other => panic!("Expected 401, got: {:?}", other),
    }

    // 3. Read-only token info -> 200 with read_api scope
    let resp = ureq::get(&format!(
        "{}/api/v4/personal_access_tokens/self",
        server.url()
    ))
    .set("PRIVATE-TOKEN", "read-token")
    .call()
    .expect("GET PAT self failed");
    assert_eq!(resp.status(), 200);
    let pat: Value = resp.into_json().unwrap();
    assert_eq!(pat["scopes"], serde_json::json!(["read_api"]));

    // 4. Read-only token attempting write -> 403 Forbidden
    let write_err = ureq::post(&format!(
        "{}/api/v4/projects/1234/merge_requests/1/notes",
        server.url()
    ))
    .set("PRIVATE-TOKEN", "read-token")
    .send_string("trying to write with read-only token");

    match write_err {
        Err(ureq::Error::Status(403, resp)) => {
            let body: Value = resp.into_json().unwrap();
            assert!(body["message"].as_str().unwrap().contains("403 Forbidden"));
        }
        other => panic!("Expected 403, got: {:?}", other),
    }

    // 5. Full token writing -> 201 Created
    let write_ok = ureq::post(&format!(
        "{}/api/v4/projects/1234/merge_requests/1/notes",
        server.url()
    ))
    .set("PRIVATE-TOKEN", "api-token")
    .send_string("writing with api token")
    .expect("POST note failed");
    assert_eq!(write_ok.status(), 201);
}

#[test]
fn test_mock_server_pagination_and_etag() {
    let server = MockGitLabServer::start();

    // Page 1
    let resp_p1 = ureq::get(&format!(
        "{}/api/v4/projects/1234/merge_requests?page=1&per_page=2",
        server.url()
    ))
    .set("PRIVATE-TOKEN", "test-token")
    .call()
    .expect("GET page 1 failed");

    assert_eq!(resp_p1.status(), 200);
    assert_eq!(resp_p1.header("X-Page"), Some("1"));
    assert_eq!(resp_p1.header("X-Next-Page"), Some("2"));
    assert_eq!(resp_p1.header("X-Total-Pages"), Some("2"));
    assert_eq!(resp_p1.header("X-Total"), Some("3"));

    let etag = resp_p1
        .header("ETag")
        .expect("ETag header missing")
        .to_string();
    let mrs_p1: Vec<Value> = resp_p1.into_json().unwrap();
    assert_eq!(mrs_p1.len(), 2);

    // ETag 304 test
    let resp_304 = ureq::get(&format!(
        "{}/api/v4/projects/1234/merge_requests?page=1&per_page=2",
        server.url()
    ))
    .set("PRIVATE-TOKEN", "test-token")
    .set("If-None-Match", &etag)
    .call()
    .expect("GET with ETag failed");
    assert_eq!(resp_304.status(), 304);

    // Page 2
    let resp_p2 = ureq::get(&format!(
        "{}/api/v4/projects/1234/merge_requests?page=2&per_page=2",
        server.url()
    ))
    .set("PRIVATE-TOKEN", "test-token")
    .call()
    .expect("GET page 2 failed");

    assert_eq!(resp_p2.status(), 200);
    assert_eq!(resp_p2.header("X-Page"), Some("2"));
    assert_eq!(resp_p2.header("X-Next-Page"), None);
    let mrs_p2: Vec<Value> = resp_p2.into_json().unwrap();
    assert_eq!(mrs_p2.len(), 1);
}

#[test]
fn test_mock_server_rate_limit_429() {
    let server = MockGitLabServer::start();

    let err_429 = ureq::get(&format!("{}/api/v4/rate-limited", server.url()))
        .set("PRIVATE-TOKEN", "test-token")
        .call();

    match err_429 {
        Err(ureq::Error::Status(429, resp)) => {
            assert_eq!(resp.header("Retry-After"), Some("5"));
            assert_eq!(resp.header("RateLimit-Remaining"), Some("0"));
            let body: Value = resp.into_json().unwrap();
            assert!(body["message"]
                .as_str()
                .unwrap()
                .contains("429 Too Many Requests"));
        }
        other => panic!("Expected 429, got: {:?}", other),
    }

    // Also via header trigger on any endpoint
    let err_header_429 = ureq::get(&format!("{}/api/v4/user", server.url()))
        .set("PRIVATE-TOKEN", "test-token")
        .set("X-Test-Rate-Limit", "1")
        .call();

    match err_header_429 {
        Err(ureq::Error::Status(429, resp)) => {
            assert_eq!(resp.header("Retry-After"), Some("5"));
        }
        other => panic!("Expected 429 via header, got: {:?}", other),
    }
}

#[test]
fn test_mock_server_merge_failures_405_406() {
    let server = MockGitLabServer::start();

    // 405 Method Not Allowed (e.g. branch cannot be merged, draft or conflicts)
    let err_405 = ureq::put(&format!(
        "{}/api/v4/projects/1234/merge_requests/1/merge?simulate_error=405",
        server.url()
    ))
    .set("PRIVATE-TOKEN", "test-token")
    .send_string("{}");

    match err_405 {
        Err(ureq::Error::Status(405, resp)) => {
            let body: Value = resp.into_json().unwrap();
            assert!(body["message"]
                .as_str()
                .unwrap()
                .contains("405 Method Not Allowed"));
        }
        other => panic!("Expected 405, got: {:?}", other),
    }

    // 406 Not Acceptable (e.g. SHA mismatch)
    let err_406 = ureq::put(&format!(
        "{}/api/v4/projects/1234/merge_requests/1/merge?simulate_error=406",
        server.url()
    ))
    .set("PRIVATE-TOKEN", "test-token")
    .send_string("{}");

    match err_406 {
        Err(ureq::Error::Status(406, resp)) => {
            let body: Value = resp.into_json().unwrap();
            assert!(body["message"]
                .as_str()
                .unwrap()
                .contains("406 Not Acceptable"));
        }
        other => panic!("Expected 406, got: {:?}", other),
    }

    // Successful merge
    let ok_merge = ureq::put(&format!(
        "{}/api/v4/projects/1234/merge_requests/1/merge",
        server.url()
    ))
    .set("PRIVATE-TOKEN", "test-token")
    .send_string("{}")
    .expect("Merge PUT failed");

    assert_eq!(ok_merge.status(), 200);
    let merge_res: Value = ok_merge.into_json().unwrap();
    assert_eq!(merge_res["state"], "merged");
    assert!(merge_res["merge_commit_sha"].is_string());
}

#[test]
fn test_mock_server_diffs_and_fallback_changes() {
    let server = MockGitLabServer::start();

    // Normal /diffs (GitLab >=15.7/16)
    let resp_diffs = ureq::get(&format!(
        "{}/api/v4/projects/1234/merge_requests/1/diffs",
        server.url()
    ))
    .set("PRIVATE-TOKEN", "test-token")
    .call()
    .expect("GET /diffs failed");

    assert_eq!(resp_diffs.status(), 200);
    let diffs: Vec<Value> = resp_diffs.into_json().unwrap();
    assert_eq!(diffs.len(), 2);
    assert_eq!(diffs[0]["new_path"], "src/cache.rs");

    // Legacy project /diffs returns 404
    let err_diffs = ureq::get(&format!(
        "{}/api/v4/projects/legacy/merge_requests/1/diffs",
        server.url()
    ))
    .set("PRIVATE-TOKEN", "test-token")
    .call();

    match err_diffs {
        Err(ureq::Error::Status(404, _)) => {}
        other => panic!("Expected 404 on legacy /diffs, got: {:?}", other),
    }

    // Fallback to /changes
    let resp_changes = ureq::get(&format!(
        "{}/api/v4/projects/legacy/merge_requests/1/changes",
        server.url()
    ))
    .set("PRIVATE-TOKEN", "test-token")
    .call()
    .expect("GET /changes fallback failed");

    assert_eq!(resp_changes.status(), 200);
    let changes_obj: Value = resp_changes.into_json().unwrap();
    let changes_arr = changes_obj["changes"].as_array().expect("changes is array");
    assert_eq!(changes_arr.len(), 1);
    assert_eq!(changes_arr[0]["new_path"], "src/cache.rs");
}

#[test]
fn test_mock_server_pipelines_and_discussions() {
    let server = MockGitLabServer::start();

    // Pipelines
    let resp_pipelines = ureq::get(&format!(
        "{}/api/v4/projects/1234/merge_requests/1/pipelines",
        server.url()
    ))
    .set("PRIVATE-TOKEN", "test-token")
    .call()
    .expect("GET pipelines failed");
    assert_eq!(resp_pipelines.status(), 200);
    let pipelines: Vec<Value> = resp_pipelines.into_json().unwrap();
    assert_eq!(pipelines[0]["status"], "success");

    // Jobs
    let resp_jobs = ureq::get(&format!(
        "{}/api/v4/projects/1234/pipelines/9001/jobs",
        server.url()
    ))
    .set("PRIVATE-TOKEN", "test-token")
    .call()
    .expect("GET jobs failed");
    assert_eq!(resp_jobs.status(), 200);
    let jobs: Vec<Value> = resp_jobs.into_json().unwrap();
    assert_eq!(jobs.len(), 2);

    // Discussions
    let resp_disc = ureq::get(&format!(
        "{}/api/v4/projects/1234/merge_requests/1/discussions",
        server.url()
    ))
    .set("PRIVATE-TOKEN", "test-token")
    .call()
    .expect("GET discussions failed");
    assert_eq!(resp_disc.status(), 200);
    let disc: Vec<Value> = resp_disc.into_json().unwrap();
    assert_eq!(disc[0]["id"], "disc-001");

    // Resolve thread: PUT /discussions/:did
    let resp_resolve = ureq::put(&format!(
        "{}/api/v4/projects/1234/merge_requests/1/discussions/disc-001",
        server.url()
    ))
    .set("PRIVATE-TOKEN", "test-token")
    .send_string("{}")
    .expect("PUT resolve discussion failed");
    assert_eq!(resp_resolve.status(), 200);
    let resolved_body: Value = resp_resolve.into_json().unwrap();
    assert_eq!(resolved_body["resolved"], true);

    // Approvals: GET, POST approve, POST unapprove
    let resp_appr = ureq::get(&format!(
        "{}/api/v4/projects/1234/merge_requests/1/approvals",
        server.url()
    ))
    .set("PRIVATE-TOKEN", "test-token")
    .call()
    .expect("GET approvals failed");
    assert_eq!(resp_appr.status(), 200);
    let appr_data: Value = resp_appr.into_json().unwrap();
    assert_eq!(appr_data["approved"], true);

    let resp_post_appr = ureq::post(&format!(
        "{}/api/v4/projects/1234/merge_requests/1/approve",
        server.url()
    ))
    .set("PRIVATE-TOKEN", "test-token")
    .send_string("{}")
    .expect("POST approve failed");
    assert_eq!(resp_post_appr.status(), 201);

    let resp_post_unappr = ureq::post(&format!(
        "{}/api/v4/projects/1234/merge_requests/1/unapprove",
        server.url()
    ))
    .set("PRIVATE-TOKEN", "test-token")
    .send_string("{}")
    .expect("POST unapprove failed");
    assert_eq!(resp_post_unappr.status(), 201);
}
