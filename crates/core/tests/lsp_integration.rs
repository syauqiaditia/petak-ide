// Integration tests for server.rs and registry.rs using the fake_lsp example binary.

use petak_core::lsp::{Clock, Lang, Registry, Server, ServerConfig, ServerEvent};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, Instant};

/// Mutex to serialize registry integration tests that modify process environment variables (PETAK_LSP_DART).
static REGISTRY_TEST_LOCK: Mutex<()> = Mutex::new(());

/// Find the fake_lsp binary in the target directory (respecting CARGO_TARGET_DIR if set).
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

// ── server.rs tests ──

#[test]
fn server_start_and_shutdown() {
    let fake = fake_lsp_path();
    let config = ServerConfig {
        command: fake,
        args: vec![],
        root_uri: "file:///tmp/test".to_string(),
    };

    let crashed = Arc::new(AtomicBool::new(false));
    let crashed_clone = Arc::clone(&crashed);
    let server = Server::start(&config, move |event| {
        if matches!(event, ServerEvent::Crashed) {
            crashed_clone.store(true, Ordering::SeqCst);
        }
    })
    .expect("start server");

    assert!(server.is_alive());
    assert!(server.capabilities.lock().unwrap().is_some());
    server.shutdown();

    std::thread::sleep(Duration::from_millis(50));
    assert!(
        !crashed.load(Ordering::SeqCst),
        "normal shutdown must not trigger Crashed event"
    );
}

#[test]
fn server_receives_diagnostics_on_did_open() {
    let fake = fake_lsp_path();
    let config = ServerConfig {
        command: fake,
        args: vec![],
        root_uri: "file:///tmp/test".to_string(),
    };

    let (tx, rx) = mpsc::channel();
    let server = Server::start(&config, move |event| {
        let _ = tx.send(event);
    })
    .expect("start server");

    server
        .notify(
            "textDocument/didOpen",
            &serde_json::json!({
                "textDocument": {
                    "uri": "file:///tmp/test/main.dart",
                    "languageId": "dart",
                    "version": 1,
                    "text": "void main() {}",
                }
            }),
        )
        .unwrap();

    let event = rx.recv_timeout(Duration::from_secs(5)).expect("receive event");
    match event {
        ServerEvent::Notification { method, params } => {
            assert_eq!(method, "textDocument/publishDiagnostics");
            let diags = params["diagnostics"].as_array().unwrap();
            assert_eq!(diags.len(), 1);
            assert_eq!(diags[0]["message"].as_str().unwrap(), "test error");
        }
        other => panic!("unexpected event: {:?}", other),
    }

    server.shutdown();
}

#[test]
fn server_request_response() {
    let fake = fake_lsp_path();
    let config = ServerConfig {
        command: fake,
        args: vec![],
        root_uri: "file:///tmp/test".to_string(),
    };

    let server = Server::start(&config, |_| {}).expect("start server");

    let result = server
        .request("textDocument/hover", &serde_json::json!({}))
        .unwrap();
    assert!(result.is_null());

    server.shutdown();
}

#[test]
fn server_responds_to_server_initiated_requests() {
    let fake = fake_lsp_path();
    let config = ServerConfig {
        command: fake,
        args: vec![],
        root_uri: "file:///tmp/test".to_string(),
    };

    let server = Server::start(&config, |_| {}).expect("start server");

    let res = server
        .request("test/server_request", &serde_json::json!({}))
        .expect("request");
    assert_eq!(
        res["progress_ok"], true,
        "workDoneProgress/create should receive null result"
    );
    assert_eq!(
        res["config_ok"], true,
        "workspace/configuration should receive array of nulls"
    );

    server.shutdown();
}

// ── registry.rs tests ──

/// Fake clock for testing idle timeouts.
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
fn registry_lazy_start() {
    let _lock = REGISTRY_TEST_LOCK.lock().unwrap();
    let fake = fake_lsp_path();
    std::env::set_var("PETAK_LSP_DART", &fake);

    let clock = Arc::new(FakeClock::new());
    let events = Arc::new(Mutex::new(Vec::new()));
    let events_clone = Arc::clone(&events);
    let registry = Registry::new(clock.clone(), move |_, _, event| {
        events_clone.lock().unwrap().push(event);
    });

    assert_eq!(registry.server_count(), 0);

    let (_tmp, file_path) = make_temp_dart_project();

    registry
        .did_open(&file_path, Lang::Dart, "void main() {}", None)
        .unwrap();

    assert_eq!(registry.server_count(), 1);

    // Wait for diagnostics
    let mut got_diags = false;
    for _ in 0..50 {
        let evts = events.lock().unwrap();
        if evts.iter().any(
            |e| matches!(e, ServerEvent::Notification { method, .. } if method == "textDocument/publishDiagnostics")
        ) {
            got_diags = true;
            break;
        }
        drop(evts);
        std::thread::sleep(Duration::from_millis(20));
    }
    assert!(got_diags, "expected diagnostics notification");

    registry.shutdown_all();
    std::env::remove_var("PETAK_LSP_DART");
}

#[test]
fn registry_idle_kill() {
    let _lock = REGISTRY_TEST_LOCK.lock().unwrap();
    let fake = fake_lsp_path();
    std::env::set_var("PETAK_LSP_DART", &fake);

    let clock = Arc::new(FakeClock::new());
    let crashed = Arc::new(AtomicBool::new(false));
    let crashed_clone = Arc::clone(&crashed);
    let registry = Registry::new(clock.clone(), move |_, _, event| {
        if matches!(event, ServerEvent::Crashed) {
            crashed_clone.store(true, Ordering::SeqCst);
        }
    });

    let (_tmp, file_path) = make_temp_dart_project();

    registry
        .did_open(&file_path, Lang::Dart, "void main() {}", None)
        .unwrap();
    assert_eq!(registry.server_count(), 1);

    // Advance clock past idle timeout (10 minutes)
    clock.advance(Duration::from_secs(601));
    registry.tick();

    assert_eq!(registry.server_count(), 0);
    std::thread::sleep(Duration::from_millis(50));
    assert!(
        !crashed.load(Ordering::SeqCst),
        "idle kill must not trigger Crashed event"
    );

    std::env::remove_var("PETAK_LSP_DART");
}

#[test]
fn registry_crash_restart_reopens_docs() {
    let _lock = REGISTRY_TEST_LOCK.lock().unwrap();
    let fake = fake_lsp_path();

    // Use a wrapper script: first invocation crashes, second works
    let tmp_dir = tempfile::tempdir().unwrap();
    let counter_file = tmp_dir.path().join("counter");
    std::fs::write(&counter_file, "0").unwrap();

    // Write a shell script that crashes on first run, works on second
    let script_path = tmp_dir.path().join("crash_once.sh");
    let script = format!(
        "#!/bin/sh\n\
        COUNT=$(cat \"{}\")\n\
        if [ \"$COUNT\" = \"0\" ]; then\n\
          echo 1 > \"{}\"\n\
          exec \"{}\" --crash-after-init\n\
        else\n\
          exec \"{}\"\n\
        fi\n",
        counter_file.display(),
        counter_file.display(),
        fake,
        fake
    );
    std::fs::write(&script_path, &script).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&script_path, std::fs::Permissions::from_mode(0o755)).unwrap();
    }

    std::env::set_var("PETAK_LSP_DART", script_path.to_string_lossy().as_ref());

    let crash_count = Arc::new(AtomicUsize::new(0));
    let crash_count_clone = Arc::clone(&crash_count);
    let diags_received = Arc::new(Mutex::new(Vec::new()));
    let diags_clone = Arc::clone(&diags_received);
    let clock = Arc::new(FakeClock::new());
    let registry = Registry::new(clock.clone(), move |_, _, event| match event {
        ServerEvent::Crashed => {
            crash_count_clone.fetch_add(1, Ordering::SeqCst);
        }
        ServerEvent::Notification { method, params }
            if method == "textDocument/publishDiagnostics" =>
        {
            diags_clone.lock().unwrap().push(params);
        }
        _ => {}
    });

    let (_tmp, file_path) = make_temp_dart_project();

    // First didOpen — server will start, initialize, then crash after "initialized"
    let _ = registry.did_open(&file_path, Lang::Dart, "void main() {}", None);

    // Give server time to crash
    for _ in 0..50 {
        if crash_count.load(Ordering::SeqCst) > 0 {
            break;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    assert_eq!(
        crash_count.load(Ordering::SeqCst),
        1,
        "should have crashed once"
    );

    // Clear diagnostics collected during initial run (if any)
    diags_received.lock().unwrap().clear();

    // A subsequent request should trigger auto-restart (second run won't crash)
    // and re-open the tracked document (which triggers textDocument/publishDiagnostics from fake_lsp)
    let result = registry.request(
        &file_path,
        Lang::Dart,
        "textDocument/hover",
        &serde_json::json!({}),
        None,
    );

    assert!(
        result.is_ok(),
        "request after crash restart should succeed: {:?}",
        result
    );

    // Assert that the document was reopened: fake_lsp sends publishDiagnostics on didOpen
    let mut got_reopen_diag = false;
    let expected_uri = format!("file://{}", file_path.display());
    for _ in 0..50 {
        let list = diags_received.lock().unwrap();
        if list
            .iter()
            .any(|p| p.get("uri").and_then(|u| u.as_str()) == Some(&expected_uri))
        {
            got_reopen_diag = true;
            break;
        }
        drop(list);
        std::thread::sleep(Duration::from_millis(20));
    }
    assert!(
        got_reopen_diag,
        "tracked doc should have been re-opened after crash restart"
    );

    registry.shutdown_all();
    std::thread::sleep(Duration::from_millis(50));
    assert_eq!(
        crash_count.load(Ordering::SeqCst),
        1,
        "shutdown_all must not increment crash count"
    );

    std::env::remove_var("PETAK_LSP_DART");
}

#[test]
fn registry_crash_restart_on_did_change() {
    let _lock = REGISTRY_TEST_LOCK.lock().unwrap();
    let fake = fake_lsp_path();

    let tmp_dir = tempfile::tempdir().unwrap();
    let counter_file = tmp_dir.path().join("counter");
    std::fs::write(&counter_file, "0").unwrap();

    let script_path = tmp_dir.path().join("crash_once.sh");
    let script = format!(
        "#!/bin/sh\n\
        COUNT=$(cat \"{}\")\n\
        if [ \"$COUNT\" = \"0\" ]; then\n\
          echo 1 > \"{}\"\n\
          exec \"{}\" --crash-after-init\n\
        else\n\
          exec \"{}\"\n\
        fi\n",
        counter_file.display(),
        counter_file.display(),
        fake,
        fake
    );
    std::fs::write(&script_path, &script).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&script_path, std::fs::Permissions::from_mode(0o755)).unwrap();
    }

    std::env::set_var("PETAK_LSP_DART", script_path.to_string_lossy().as_ref());

    let crash_count = Arc::new(AtomicUsize::new(0));
    let crash_count_clone = Arc::clone(&crash_count);
    let diags_received = Arc::new(Mutex::new(Vec::new()));
    let diags_clone = Arc::clone(&diags_received);
    let clock = Arc::new(FakeClock::new());
    let registry = Registry::new(clock.clone(), move |_, _, event| match event {
        ServerEvent::Crashed => {
            crash_count_clone.fetch_add(1, Ordering::SeqCst);
        }
        ServerEvent::Notification { method, params }
            if method == "textDocument/publishDiagnostics" =>
        {
            diags_clone.lock().unwrap().push(params);
        }
        _ => {}
    });

    let (_tmp, file_path) = make_temp_dart_project();

    // First didOpen — triggers crash after init
    let _ = registry.did_open(&file_path, Lang::Dart, "void main() {}", None);

    for _ in 0..50 {
        if crash_count.load(Ordering::SeqCst) > 0 {
            break;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    assert_eq!(crash_count.load(Ordering::SeqCst), 1);

    diags_received.lock().unwrap().clear();

    // did_change on crashed server should restart it, reopen doc, and succeed
    let change_res = registry.did_change(&file_path, Lang::Dart, 2, &[serde_json::json!({ "text": "void main() { int x = 1; }" })], None);
    assert!(change_res.is_ok(), "did_change after crash should restart and succeed");

    let mut got_reopen_diag = false;
    let expected_uri = format!("file://{}", file_path.display());
    for _ in 0..50 {
        let list = diags_received.lock().unwrap();
        if list
            .iter()
            .any(|p| p.get("uri").and_then(|u| u.as_str()) == Some(&expected_uri))
        {
            got_reopen_diag = true;
            break;
        }
        drop(list);
        std::thread::sleep(Duration::from_millis(20));
    }
    assert!(got_reopen_diag, "doc should have been re-opened on did_change restart");

    registry.shutdown_all();
    std::env::remove_var("PETAK_LSP_DART");
}
