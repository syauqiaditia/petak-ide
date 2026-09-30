use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use std::time::Duration;
use tiny_http::{Header, Method, Response, Server, StatusCode};

pub struct MockGitLabServer {
    url: String,
    running: Arc<AtomicBool>,
    server_handle: Option<JoinHandle<()>>,
}

impl MockGitLabServer {
    pub fn start() -> Self {
        let server = Server::http("127.0.0.1:0").expect("Failed to bind tiny_http server");
        let addr = server.server_addr();
        let url = format!("http://{}", addr);

        let running = Arc::new(AtomicBool::new(true));
        let running_clone = running.clone();

        let fixtures_dir = find_fixtures_dir();

        let server_handle = thread::spawn(move || {
            while running_clone.load(Ordering::SeqCst) {
                match server.recv_timeout(Duration::from_millis(50)) {
                    Ok(Some(request)) => {
                        handle_request(request, &fixtures_dir);
                    }
                    Ok(None) => {}
                    Err(_) => break,
                }
            }
        });

        Self {
            url,
            running,
            server_handle: Some(server_handle),
        }
    }

    pub fn url(&self) -> &str {
        &self.url
    }
}

impl Drop for MockGitLabServer {
    fn drop(&mut self) {
        self.running.store(false, Ordering::SeqCst);
        if let Some(handle) = self.server_handle.take() {
            let _ = handle.join();
        }
    }
}

fn find_fixtures_dir() -> PathBuf {
    let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
    let candidates = [
        manifest_dir.join("../fixtures/gitlab"),
        manifest_dir.join("fixtures/gitlab"),
        manifest_dir.join("../../fixtures/gitlab"),
        PathBuf::from("fixtures/gitlab"),
    ];

    for path in &candidates {
        if path.exists() && path.is_dir() {
            return path.clone();
        }
    }

    // Default fallback
    manifest_dir.join("../fixtures/gitlab")
}

fn read_fixture(fixtures_dir: &Path, filename: &str) -> String {
    let path = fixtures_dir.join(filename);
    fs::read_to_string(&path)
        .unwrap_or_else(|_| panic!("Failed to read fixture: {}", path.display()))
}

fn header_value(request: &tiny_http::Request, name: &str) -> Option<String> {
    for h in request.headers() {
        if h.field.as_str().as_str().eq_ignore_ascii_case(name) {
            return Some(h.value.as_str().to_string());
        }
    }
    None
}

fn parse_query(query: &str) -> HashMap<String, String> {
    let mut params = HashMap::new();
    for pair in query.split('&') {
        if pair.is_empty() {
            continue;
        }
        let mut parts = pair.splitn(2, '=');
        let key = parts.next().unwrap_or("");
        let val = parts.next().unwrap_or("");
        params.insert(key.to_string(), val.to_string());
    }
    params
}

fn handle_request(mut request: tiny_http::Request, fixtures_dir: &Path) {
    let raw_url = request.url().to_string();
    let (path, query_str) = match raw_url.find('?') {
        Some(idx) => (&raw_url[..idx], &raw_url[idx + 1..]),
        None => (raw_url.as_str(), ""),
    };
    let query = parse_query(query_str);

    // 1. Rate-limit simulation (429 + Retry-After)
    if path == "/api/v4/rate-limited"
        || path == "/api/v4/test/rate-limited"
        || header_value(&request, "X-Simulate-429").is_some()
        || header_value(&request, "X-Test-Rate-Limit").is_some()
        || query.get("simulate_rate_limit").map(|v| v.as_str()) == Some("1")
    {
        let body = read_fixture(fixtures_dir, "error_429.json");
        let resp = Response::from_string(body)
            .with_status_code(StatusCode(429))
            .with_header(
                Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..]).unwrap(),
            )
            .with_header(Header::from_bytes(&b"Retry-After"[..], &b"5"[..]).unwrap())
            .with_header(Header::from_bytes(&b"RateLimit-Remaining"[..], &b"0"[..]).unwrap())
            .with_header(Header::from_bytes(&b"RateLimit-Reset"[..], &b"1790730000"[..]).unwrap());
        let _ = request.respond(resp);
        return;
    }

    // 2. Authentication check (401 Unauthorized)
    let token = header_value(&request, "PRIVATE-TOKEN");
    if token.as_deref() == Some("invalid-token")
        || token.is_none()
        || query.get("simulate_auth_error").map(|v| v.as_str()) == Some("401")
    {
        let body = read_fixture(fixtures_dir, "error_401.json");
        let resp = Response::from_string(body)
            .with_status_code(StatusCode(401))
            .with_header(
                Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..]).unwrap(),
            );
        let _ = request.respond(resp);
        return;
    }

    let token_val = token.unwrap();

    // 3. Scope validation for write operations (403 Forbidden)
    let is_write_method = matches!(
        request.method(),
        Method::Post | Method::Put | Method::Delete
    );
    if is_write_method
        && (token_val == "read-token"
            || token_val == "read_api"
            || query.get("simulate_scope_error").map(|v| v.as_str()) == Some("403"))
    {
        let body = read_fixture(fixtures_dir, "error_403.json");
        let resp = Response::from_string(body)
            .with_status_code(StatusCode(403))
            .with_header(
                Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..]).unwrap(),
            );
        let _ = request.respond(resp);
        return;
    }

    // 4. Dispatch endpoints
    let if_none_match = header_value(&request, "If-None-Match");

    // GET /api/v4/personal_access_tokens/self
    if path == "/api/v4/personal_access_tokens/self" {
        let etag = "\"pat-self-v1\"";
        if if_none_match.as_deref() == Some(etag) {
            let resp = Response::empty(StatusCode(304))
                .with_header(Header::from_bytes(&b"ETag"[..], etag.as_bytes()).unwrap());
            let _ = request.respond(resp);
            return;
        }

        let fixture = if token_val == "read-token" {
            "personal_access_tokens_self_read_only.json"
        } else {
            "personal_access_tokens_self.json"
        };
        let body = read_fixture(fixtures_dir, fixture);
        let resp = Response::from_string(body)
            .with_status_code(StatusCode(200))
            .with_header(
                Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..]).unwrap(),
            )
            .with_header(Header::from_bytes(&b"ETag"[..], etag.as_bytes()).unwrap());
        let _ = request.respond(resp);
        return;
    }

    // GET /api/v4/user
    if path == "/api/v4/user" {
        let etag = "\"user-v1\"";
        if if_none_match.as_deref() == Some(etag) {
            let resp = Response::empty(StatusCode(304))
                .with_header(Header::from_bytes(&b"ETag"[..], etag.as_bytes()).unwrap());
            let _ = request.respond(resp);
            return;
        }

        let body = read_fixture(fixtures_dir, "user.json");
        let resp = Response::from_string(body)
            .with_status_code(StatusCode(200))
            .with_header(
                Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..]).unwrap(),
            )
            .with_header(Header::from_bytes(&b"ETag"[..], etag.as_bytes()).unwrap());
        let _ = request.respond(resp);
        return;
    }

    // GET /api/v4/projects/:id (without /merge_requests or /pipelines)
    if path.starts_with("/api/v4/projects/")
        && !path.contains("/merge_requests")
        && !path.contains("/pipelines")
    {
        let etag = "\"project-v1\"";
        if if_none_match.as_deref() == Some(etag) {
            let resp = Response::empty(StatusCode(304))
                .with_header(Header::from_bytes(&b"ETag"[..], etag.as_bytes()).unwrap());
            let _ = request.respond(resp);
            return;
        }

        let body = read_fixture(fixtures_dir, "project.json");
        let resp = Response::from_string(body)
            .with_status_code(StatusCode(200))
            .with_header(
                Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..]).unwrap(),
            )
            .with_header(Header::from_bytes(&b"ETag"[..], etag.as_bytes()).unwrap());
        let _ = request.respond(resp);
        return;
    }

    // Diff endpoint: /diffs with 404 fallback support
    if path.ends_with("/diffs") {
        if path.contains("/legacy/")
            || query.get("simulate_fallback").map(|v| v.as_str()) == Some("1")
            || query.get("not_found").map(|v| v.as_str()) == Some("1")
        {
            let resp = Response::from_string("{\"message\": \"404 Not Found\"}")
                .with_status_code(StatusCode(404))
                .with_header(
                    Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..]).unwrap(),
                );
            let _ = request.respond(resp);
            return;
        }

        let etag = "\"diffs-mr1-v1\"";
        if if_none_match.as_deref() == Some(etag) {
            let resp = Response::empty(StatusCode(304))
                .with_header(Header::from_bytes(&b"ETag"[..], etag.as_bytes()).unwrap());
            let _ = request.respond(resp);
            return;
        }

        let body = read_fixture(fixtures_dir, "diffs_mr1.json");
        let resp = Response::from_string(body)
            .with_status_code(StatusCode(200))
            .with_header(
                Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..]).unwrap(),
            )
            .with_header(Header::from_bytes(&b"ETag"[..], etag.as_bytes()).unwrap());
        let _ = request.respond(resp);
        return;
    }

    // Fallback diffs: /changes
    if path.ends_with("/changes") {
        let etag = "\"changes-mr1-v1\"";
        if if_none_match.as_deref() == Some(etag) {
            let resp = Response::empty(StatusCode(304))
                .with_header(Header::from_bytes(&b"ETag"[..], etag.as_bytes()).unwrap());
            let _ = request.respond(resp);
            return;
        }

        let body = read_fixture(fixtures_dir, "changes_mr1.json");
        let resp = Response::from_string(body)
            .with_status_code(StatusCode(200))
            .with_header(
                Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..]).unwrap(),
            )
            .with_header(Header::from_bytes(&b"ETag"[..], etag.as_bytes()).unwrap());
        let _ = request.respond(resp);
        return;
    }

    // Pipelines endpoint
    if path.ends_with("/pipelines") {
        let body = read_fixture(fixtures_dir, "pipelines_mr1.json");
        let resp = Response::from_string(body)
            .with_status_code(StatusCode(200))
            .with_header(
                Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..]).unwrap(),
            );
        let _ = request.respond(resp);
        return;
    }

    // Pipeline jobs endpoint
    if path.contains("/pipelines/") && path.ends_with("/jobs") {
        let body = read_fixture(fixtures_dir, "pipeline_jobs_9001.json");
        let resp = Response::from_string(body)
            .with_status_code(StatusCode(200))
            .with_header(
                Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..]).unwrap(),
            );
        let _ = request.respond(resp);
        return;
    }

    // Discussions endpoint: GET or POST
    if path.ends_with("/discussions") {
        if request.method() == &Method::Post {
            let resp = Response::from_string(
                "{\"id\": \"disc-002\", \"individual_note\": false, \"notes\": []}",
            )
            .with_status_code(StatusCode(201))
            .with_header(
                Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..]).unwrap(),
            );
            let _ = request.respond(resp);
            return;
        }

        let body = read_fixture(fixtures_dir, "discussions_mr1.json");
        let resp = Response::from_string(body)
            .with_status_code(StatusCode(200))
            .with_header(
                Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..]).unwrap(),
            );
        let _ = request.respond(resp);
        return;
    }

    // Notes endpoint: POST
    if path.ends_with("/notes") {
        let resp = Response::from_string("{\"id\": 302, \"body\": \"mock note created\"}")
            .with_status_code(StatusCode(201))
            .with_header(
                Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..]).unwrap(),
            );
        let _ = request.respond(resp);
        return;
    }

    // Discussion thread resolve: PUT /discussions/:did
    if path.contains("/discussions/") && request.method() == &Method::Put {
        let resp = Response::from_string("{\"id\": \"disc-001\", \"resolved\": true}")
            .with_status_code(StatusCode(200))
            .with_header(
                Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..]).unwrap(),
            );
        let _ = request.respond(resp);
        return;
    }

    // Approvals: GET, POST approve, POST unapprove
    if path.ends_with("/approvals") {
        let body = read_fixture(fixtures_dir, "approvals_mr1.json");
        let resp = Response::from_string(body)
            .with_status_code(StatusCode(200))
            .with_header(
                Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..]).unwrap(),
            );
        let _ = request.respond(resp);
        return;
    }

    if path.ends_with("/approve") {
        let resp = Response::from_string("{\"approved\": true}")
            .with_status_code(StatusCode(201))
            .with_header(
                Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..]).unwrap(),
            );
        let _ = request.respond(resp);
        return;
    }

    if path.ends_with("/unapprove") {
        let resp = Response::from_string("{\"approved\": false}")
            .with_status_code(StatusCode(201))
            .with_header(
                Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..]).unwrap(),
            );
        let _ = request.respond(resp);
        return;
    }

    // Merge endpoint: PUT /projects/:id/merge_requests/:iid/merge
    if path.ends_with("/merge") && request.method() == &Method::Put {
        // Read body to inspect simulated errors or params
        let mut body_str = String::new();
        let _ = request.as_reader().read_to_string(&mut body_str);

        let simulate_405 = query.get("simulate_error").map(|v| v.as_str()) == Some("405")
            || body_str.contains("\"simulate_error\":\"405\"")
            || header_value(&request, "X-Simulate-Error").as_deref() == Some("405")
            || path.contains("/merge_requests/2/"); // MR 2 is draft

        let simulate_406 = query.get("simulate_error").map(|v| v.as_str()) == Some("406")
            || body_str.contains("\"simulate_error\":\"406\"")
            || header_value(&request, "X-Simulate-Error").as_deref() == Some("406")
            || query.get("sha").map(|v| v.as_str()) == Some("mismatched_sha");

        if simulate_405 {
            let body = read_fixture(fixtures_dir, "error_405.json");
            let resp = Response::from_string(body)
                .with_status_code(StatusCode(405))
                .with_header(
                    Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..]).unwrap(),
                );
            let _ = request.respond(resp);
            return;
        }

        if simulate_406 {
            let body = read_fixture(fixtures_dir, "error_406.json");
            let resp = Response::from_string(body)
                .with_status_code(StatusCode(406))
                .with_header(
                    Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..]).unwrap(),
                );
            let _ = request.respond(resp);
            return;
        }

        let body = read_fixture(fixtures_dir, "merge_result_success.json");
        let resp = Response::from_string(body)
            .with_status_code(StatusCode(200))
            .with_header(
                Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..]).unwrap(),
            );
        let _ = request.respond(resp);
        return;
    }

    // Cancel MWPS: POST /cancel_merge_when_pipeline_succeeds
    if path.ends_with("/cancel_merge_when_pipeline_succeeds") {
        let resp = Response::from_string("{\"message\": \"cancelled\"}")
            .with_status_code(StatusCode(200))
            .with_header(
                Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..]).unwrap(),
            );
        let _ = request.respond(resp);
        return;
    }

    // Merge request list: GET /projects/:id/merge_requests
    if path.ends_with("/merge_requests") {
        let page = query.get("page").map(|v| v.as_str()).unwrap_or("1");
        let etag = format!("\"mr-list-page-{}\"", page);

        if if_none_match.as_deref() == Some(&etag) {
            let resp = Response::empty(StatusCode(304))
                .with_header(Header::from_bytes(&b"ETag"[..], etag.as_bytes()).unwrap());
            let _ = request.respond(resp);
            return;
        }

        if page == "2" {
            let body = read_fixture(fixtures_dir, "merge_requests_page2.json");
            let resp = Response::from_string(body)
                .with_status_code(StatusCode(200))
                .with_header(
                    Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..]).unwrap(),
                )
                .with_header(Header::from_bytes(&b"ETag"[..], etag.as_bytes()).unwrap())
                .with_header(Header::from_bytes(&b"X-Page"[..], &b"2"[..]).unwrap())
                .with_header(Header::from_bytes(&b"X-Per-Page"[..], &b"2"[..]).unwrap())
                .with_header(Header::from_bytes(&b"X-Total-Pages"[..], &b"2"[..]).unwrap())
                .with_header(Header::from_bytes(&b"X-Total"[..], &b"3"[..]).unwrap());
            let _ = request.respond(resp);
        } else {
            let body = read_fixture(fixtures_dir, "merge_requests_page1.json");
            let resp = Response::from_string(body)
                .with_status_code(StatusCode(200))
                .with_header(
                    Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..]).unwrap(),
                )
                .with_header(Header::from_bytes(&b"ETag"[..], etag.as_bytes()).unwrap())
                .with_header(Header::from_bytes(&b"X-Page"[..], &b"1"[..]).unwrap())
                .with_header(Header::from_bytes(&b"X-Per-Page"[..], &b"2"[..]).unwrap())
                .with_header(Header::from_bytes(&b"X-Next-Page"[..], &b"2"[..]).unwrap())
                .with_header(Header::from_bytes(&b"X-Total-Pages"[..], &b"2"[..]).unwrap())
                .with_header(Header::from_bytes(&b"X-Total"[..], &b"3"[..]).unwrap());
            let _ = request.respond(resp);
        }
        return;
    }

    // Merge request detail: GET /projects/:id/merge_requests/:iid
    if path.contains("/merge_requests/") {
        let etag = "\"mr-detail-1-v1\"";
        if if_none_match.as_deref() == Some(etag) {
            let resp = Response::empty(StatusCode(304))
                .with_header(Header::from_bytes(&b"ETag"[..], etag.as_bytes()).unwrap());
            let _ = request.respond(resp);
            return;
        }

        let body = read_fixture(fixtures_dir, "merge_request_detail_1.json");
        let resp = Response::from_string(body)
            .with_status_code(StatusCode(200))
            .with_header(
                Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..]).unwrap(),
            )
            .with_header(Header::from_bytes(&b"ETag"[..], etag.as_bytes()).unwrap());
        let _ = request.respond(resp);
        return;
    }

    // Catch-all 404
    let resp = Response::from_string("{\"message\": \"404 Not Found\"}")
        .with_status_code(StatusCode(404))
        .with_header(Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..]).unwrap());
    let _ = request.respond(resp);
}
