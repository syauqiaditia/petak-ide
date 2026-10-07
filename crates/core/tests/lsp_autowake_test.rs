// Integration tests for LSP auto-wake on document touch (did_open, did_change, requests)
// and restoration of tracked open documents.

use petak_core::lsp::{Clock, Lang, Registry, ServerEvent};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// Mutex to serialize registry integration tests that modify process environment variables (PETAK_LSP_DART).
static REGISTRY_TEST_LOCK: Mutex<()> = Mutex::new(());

fn fake_lsp_path() -> String {
    let target_dir = std::env::var("CARGO_TARGET_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| {
            let mut path = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
            path.pop(); // crates
            path.pop(); // workspace root
            path.push("target");
            path
        });
    let path = target_dir.join("debug").join("examples").join("fake_lsp");
    if !path.exists() {
        let _ = std::process::Command::new("cargo")
            .args(["build", "-p", "petak-core", "--example", "fake_lsp"])
            .status();
    }
    assert!(
        path.exists(),
        "fake_lsp not built: run `cargo build --example fake_lsp` first. Path: {}",
        path.display()
    );
    path.to_string_lossy().to_string()
}

struct FakeClock {
    now: Mutex<Instant>,
}

impl FakeClock {
    fn new() -> Self {
        Self {
            now: Mutex::new(Instant::now()),
        }
    }

    fn advance(&self, duration: Duration) {
        let mut now = self.now.lock().unwrap();
        *now += duration;
    }
}

impl Clock for FakeClock {
    fn now(&self) -> Instant {
        *self.now.lock().unwrap()
    }
}

fn make_temp_dart_project() -> (tempfile::TempDir, PathBuf) {
    let tmp = tempfile::tempdir().unwrap();
    std::fs::write(tmp.path().join("pubspec.yaml"), "name: test\n").unwrap();
    let file_path = tmp.path().join("lib").join("main.dart");
    std::fs::create_dir_all(file_path.parent().unwrap()).unwrap();
    std::fs::write(&file_path, "void main() {}").unwrap();
    (tmp, file_path)
}

#[test]
fn test_lsp_autowake_on_did_change_after_idle_timeout() {
    let _lock = REGISTRY_TEST_LOCK.lock().unwrap();
    let fake = fake_lsp_path();
    std::env::set_var("PETAK_LSP_DART", &fake);

    let diags_received = Arc::new(Mutex::new(Vec::new()));
    let diags_clone = Arc::clone(&diags_received);
    let clock = Arc::new(FakeClock::new());
    let registry = Registry::new(clock.clone(), move |_, _, event| {
        if let ServerEvent::Notification { method, params } = event {
            if method == "textDocument/publishDiagnostics" {
                diags_clone.lock().unwrap().push(params);
            }
        }
    });

    let (_tmp, file_path) = make_temp_dart_project();

    // 1. Open document -> server starts
    registry
        .did_open(&file_path, Lang::Dart, "void main() {}", None)
        .expect("did_open should succeed");
    assert_eq!(registry.server_count(), 1);
    assert_eq!(registry.open_docs_count(Some(Lang::Dart)), 1);

    // Wait for initial publishDiagnostics
    let expected_uri = format!("file://{}", file_path.display());
    let mut got_initial_diag = false;
    for _ in 0..50 {
        if diags_received.lock().unwrap().iter().any(|p| p.get("uri").and_then(|u| u.as_str()) == Some(&expected_uri)) {
            got_initial_diag = true;
            break;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    assert!(got_initial_diag, "should receive diagnostics on did_open");

    // 2. Advance clock past idle timeout (10 min = 600s) -> tick kills server
    clock.advance(Duration::from_secs(601));
    registry.tick();
    assert_eq!(registry.server_count(), 0, "server should be idle killed after 10 min");
    assert_eq!(registry.open_docs_count(Some(Lang::Dart)), 1, "open document should still be tracked");

    // Clear diagnostics
    diags_received.lock().unwrap().clear();

    // 3. User edits document -> did_change must auto-wake server and forward change cleanly
    let change = serde_json::json!({
        "text": "void main() { print('woken'); }"
    });
    let change_res = registry.did_change(&file_path, Lang::Dart, 2, &[change], None);
    assert!(
        change_res.is_ok(),
        "did_change must succeed and auto-wake without ServerDied: {:?}",
        change_res
    );
    assert_eq!(registry.server_count(), 1, "server must be resurrected");

    // 4. Verify fake_lsp published diagnostics because didOpen was re-sent during auto-wake
    let mut got_wake_diag = false;
    for _ in 0..50 {
        if diags_received.lock().unwrap().iter().any(|p| p.get("uri").and_then(|u| u.as_str()) == Some(&expected_uri)) {
            got_wake_diag = true;
            break;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    assert!(got_wake_diag, "document must have been re-opened upon auto-wake");

    registry.shutdown_all();
    std::env::remove_var("PETAK_LSP_DART");
}

#[test]
fn test_lsp_autowake_on_request_after_idle_timeout() {
    let _lock = REGISTRY_TEST_LOCK.lock().unwrap();
    let fake = fake_lsp_path();
    std::env::set_var("PETAK_LSP_DART", &fake);

    let clock = Arc::new(FakeClock::new());
    let registry = Registry::new(clock.clone(), |_, _, _| {});

    let (_tmp, file_path) = make_temp_dart_project();

    // 1. Open document
    registry
        .did_open(&file_path, Lang::Dart, "void main() {}", None)
        .expect("did_open should succeed");
    assert_eq!(registry.server_count(), 1);

    // 2. Idle timeout tick
    clock.advance(Duration::from_secs(601));
    registry.tick();
    assert_eq!(registry.server_count(), 0);

    // 3. Invoke request (hover) on idle-killed server -> must auto-wake without error
    let hover_params = serde_json::json!({
        "textDocument": { "uri": format!("file://{}", file_path.display()) },
        "position": { "line": 0, "character": 5 }
    });
    let hover_res = registry.request(&file_path, Lang::Dart, "textDocument/hover", &hover_params, None);
    assert!(
        hover_res.is_ok(),
        "request on idle server must auto-wake and succeed: {:?}",
        hover_res
    );
    assert_eq!(registry.server_count(), 1, "server must be running again");

    registry.shutdown_all();
    std::env::remove_var("PETAK_LSP_DART");
}

#[test]
fn test_lsp_autowake_multiple_open_docs_restored() {
    let _lock = REGISTRY_TEST_LOCK.lock().unwrap();
    let fake = fake_lsp_path();
    std::env::set_var("PETAK_LSP_DART", &fake);

    let diags_received = Arc::new(Mutex::new(Vec::new()));
    let diags_clone = Arc::clone(&diags_received);
    let clock = Arc::new(FakeClock::new());
    let registry = Registry::new(clock.clone(), move |_, _, event| {
        if let ServerEvent::Notification { method, params } = event {
            if method == "textDocument/publishDiagnostics" {
                diags_clone.lock().unwrap().push(params);
            }
        }
    });

    let (tmp, file_path1) = make_temp_dart_project();
    let file_path2 = tmp.path().join("lib").join("helper.dart");
    std::fs::write(&file_path2, "class Helper {}").unwrap();

    // 1. Open both docs
    registry
        .did_open(&file_path1, Lang::Dart, "void main() {}", None)
        .unwrap();
    registry
        .did_open(&file_path2, Lang::Dart, "class Helper {}", None)
        .unwrap();
    assert_eq!(registry.server_count(), 1);
    assert_eq!(registry.open_docs_count(Some(Lang::Dart)), 2);

    // 2. Idle timeout tick
    clock.advance(Duration::from_secs(601));
    registry.tick();
    assert_eq!(registry.server_count(), 0);
    assert_eq!(registry.open_docs_count(Some(Lang::Dart)), 2, "both docs must still be tracked");

    diags_received.lock().unwrap().clear();

    // 3. Touch only file_path2 via did_change
    let change = serde_json::json!({
        "text": "class Helper { void assist() {} }"
    });
    let change_res = registry.did_change(&file_path2, Lang::Dart, 2, &[change], None);
    assert!(change_res.is_ok(), "did_change must succeed");
    assert_eq!(registry.server_count(), 1);

    // 4. Verify BOTH file_path1 and file_path2 were re-opened
    let uri1 = format!("file://{}", file_path1.display());
    let uri2 = format!("file://{}", file_path2.display());

    let mut got_uri1 = false;
    let mut got_uri2 = false;
    for _ in 0..50 {
        let list = diags_received.lock().unwrap();
        if list.iter().any(|p| p.get("uri").and_then(|u| u.as_str()) == Some(&uri1)) {
            got_uri1 = true;
        }
        if list.iter().any(|p| p.get("uri").and_then(|u| u.as_str()) == Some(&uri2)) {
            got_uri2 = true;
        }
        if got_uri1 && got_uri2 {
            break;
        }
        drop(list);
        std::thread::sleep(Duration::from_millis(20));
    }

    assert!(got_uri1, "file1 must be restored on auto-wake");
    assert!(got_uri2, "file2 must be restored on auto-wake");

    registry.shutdown_all();
    std::env::remove_var("PETAK_LSP_DART");
}

#[test]
fn test_lsp_autowake_idle_timer_reset_on_activity() {
    let _lock = REGISTRY_TEST_LOCK.lock().unwrap();
    let fake = fake_lsp_path();
    std::env::set_var("PETAK_LSP_DART", &fake);

    let clock = Arc::new(FakeClock::new());
    let registry = Registry::new(clock.clone(), |_, _, _| {});

    let (_tmp, file_path) = make_temp_dart_project();

    // 1. Open document at t=0
    registry
        .did_open(&file_path, Lang::Dart, "void main() {}", None)
        .unwrap();
    assert_eq!(registry.server_count(), 1);

    // 2. Advance clock to t=500 (idle timeout is 600s)
    clock.advance(Duration::from_secs(500));

    // 3. User types a change at t=500 -> activity timestamp reset
    let change = serde_json::json!({ "text": "void main() { int a = 1; }" });
    registry
        .did_change(&file_path, Lang::Dart, 2, &[change], None)
        .unwrap();

    // 4. Advance clock by 300s (total elapsed t=800, but only 300s since t=500 activity)
    clock.advance(Duration::from_secs(300));
    registry.tick();

    assert_eq!(
        registry.server_count(),
        1,
        "server must NOT be killed because activity at t=500 reset the idle timer"
    );

    // 5. Advance clock past 600s from last activity (301s more -> 601s since t=500)
    clock.advance(Duration::from_secs(301));
    registry.tick();

    assert_eq!(
        registry.server_count(),
        0,
        "server should now be killed after 601s of idle"
    );

    registry.shutdown_all();
    std::env::remove_var("PETAK_LSP_DART");
}

#[test]
fn test_lsp_autowake_on_touch_without_prior_open() {
    let _lock = REGISTRY_TEST_LOCK.lock().unwrap();
    let fake = fake_lsp_path();
    std::env::set_var("PETAK_LSP_DART", &fake);

    let clock = Arc::new(FakeClock::new());
    let registry = Registry::new(clock.clone(), |_, _, _| {});

    let (_tmp, file_path) = make_temp_dart_project();

    // Server not started yet
    assert_eq!(registry.server_count(), 0);

    // Directly call did_change on untouched file
    let change = serde_json::json!({ "text": "void main() { int x = 42; }" });
    let res = registry.did_change(&file_path, Lang::Dart, 1, &[change], None);
    assert!(res.is_ok(), "did_change without prior did_open must wake server and succeed");
    assert_eq!(registry.server_count(), 1);
    assert_eq!(registry.open_docs_count(Some(Lang::Dart)), 1);

    registry.shutdown_all();
    std::env::remove_var("PETAK_LSP_DART");
}
