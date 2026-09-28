// Integration tests for server.rs and registry.rs using the fake_lsp example binary.

use petak_core::lsp::{Clock, Lang, Registry, Server, ServerConfig, ServerEvent};
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, Instant};

/// Find the fake_lsp binary in the target directory.
fn fake_lsp_path() -> String {
    let mut path = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    path.pop(); // crates
    path.pop(); // workspace root
    path.push("target");
    path.push("debug");
    path.push("examples");
    path.push("fake_lsp");
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

    let server = Server::start(&config, |_| {}).expect("start server");
    assert!(server.is_alive());
    assert!(server.capabilities.lock().unwrap().is_some());
    server.shutdown();
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
    let fake = fake_lsp_path();
    std::env::set_var("PETAK_LSP_DART", &fake);

    let clock = Arc::new(FakeClock::new());
    let events = Arc::new(Mutex::new(Vec::new()));
    let events_clone = Arc::clone(&events);
    let registry = Registry::new(clock.clone(), move |_lang, event| {
        events_clone.lock().unwrap().push(event);
    });

    assert_eq!(registry.server_count(), 0);

    let (_tmp, file_path) = make_temp_dart_project();

    registry
        .did_open(&file_path, Lang::Dart, "void main() {}", None)
        .unwrap();

    assert_eq!(registry.server_count(), 1);

    // Wait for diagnostics
    std::thread::sleep(Duration::from_millis(300));
    let evts = events.lock().unwrap();
    assert!(
        evts.iter().any(
            |e| matches!(e, ServerEvent::Notification { method, .. } if method == "textDocument/publishDiagnostics")
        ),
        "expected diagnostics notification"
    );

    registry.shutdown_all();
    std::env::remove_var("PETAK_LSP_DART");
}

#[test]
fn registry_idle_kill() {
    let fake = fake_lsp_path();
    std::env::set_var("PETAK_LSP_DART", &fake);

    let clock = Arc::new(FakeClock::new());
    let registry = Registry::new(clock.clone(), |_, _| {});

    let (_tmp, file_path) = make_temp_dart_project();

    registry
        .did_open(&file_path, Lang::Dart, "void main() {}", None)
        .unwrap();
    assert_eq!(registry.server_count(), 1);

    // Advance clock past idle timeout (10 minutes)
    clock.advance(Duration::from_secs(601));
    registry.tick();

    assert_eq!(registry.server_count(), 0);

    std::env::remove_var("PETAK_LSP_DART");
}

#[test]
fn registry_crash_restart_reopens_docs() {
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
    let clock = Arc::new(FakeClock::new());
    let registry = Registry::new(clock.clone(), move |_, event| {
        if matches!(event, ServerEvent::Crashed) {
            crash_count_clone.fetch_add(1, Ordering::SeqCst);
        }
    });

    let (_tmp, file_path) = make_temp_dart_project();

    // First didOpen — server will start, initialize, then crash after "initialized"
    let _ = registry.did_open(&file_path, Lang::Dart, "void main() {}", None);

    // Give server time to crash
    std::thread::sleep(Duration::from_millis(500));

    // A subsequent request should trigger auto-restart (second run won't crash)
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
    assert!(crash_count.load(Ordering::SeqCst) >= 1, "should have crashed at least once");

    registry.shutdown_all();
    std::env::remove_var("PETAK_LSP_DART");
}
