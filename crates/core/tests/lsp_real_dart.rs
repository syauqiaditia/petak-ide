// Integration test with real Dart language server if dart is available in PATH.

use petak_core::lsp::{Clock, Lang, Registry, ServerEvent};
use serde_json::json;
use std::sync::{mpsc, Arc};
use std::time::{Duration, Instant};

struct WallClock;
impl Clock for WallClock {
    fn now(&self) -> Instant {
        Instant::now()
    }
}

fn has_dart() -> bool {
    std::process::Command::new("dart")
        .arg("--version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

#[test]
fn test_real_dart_lsp_diagnostics_and_did_change() {
    if !has_dart() {
        println!("Skipping test_real_dart_lsp_diagnostics_and_did_change: dart not in PATH");
        return;
    }

    let tmp = tempfile::tempdir().expect("create temp dir");
    let project_dir = tmp.path().to_path_buf();

    // Create a minimal Flutter/Dart project
    let pubspec = project_dir.join("pubspec.yaml");
    std::fs::write(
        &pubspec,
        "name: test_lsp\nenvironment:\n  sdk: '>=3.0.0 <4.0.0'\n",
    )
    .expect("write pubspec");

    let lib_dir = project_dir.join("lib");
    std::fs::create_dir_all(&lib_dir).expect("create lib dir");

    let main_dart = lib_dir.join("main.dart");
    let initial_broken_code = "void main() {\n  int x = \"error_str\";\n}\n";
    std::fs::write(&main_dart, initial_broken_code).expect("write main.dart");

    let (tx, rx) = mpsc::channel();
    let clock = Arc::new(WallClock);
    let registry = Registry::new(clock, move |lang, root, event| {
        let _ = tx.send((lang, root, event));
    });

    // 1. did_open
    let open_res = registry.did_open(
        &main_dart,
        Lang::Dart,
        initial_broken_code,
        Some(&project_dir),
    );
    assert!(open_res.is_ok(), "did_open failed: {:?}", open_res);

    // Wait for diagnostics (expect error about String not assignable to int)
    let start = Instant::now();
    let mut got_error = false;
    let mut error_msg = String::new();

    while start.elapsed() < Duration::from_secs(15) {
        if let Ok((_lang, _root, ServerEvent::Notification { method, params })) =
            rx.recv_timeout(Duration::from_millis(200))
        {
            if method == "textDocument/publishDiagnostics" {
                if let Some(diags) = params.get("diagnostics").and_then(|d| d.as_array()) {
                    for d in diags {
                        let severity = d.get("severity").and_then(|s| s.as_u64()).unwrap_or(0);
                        let msg = d.get("message").and_then(|m| m.as_str()).unwrap_or("");
                        if severity == 1 {
                            got_error = true;
                            error_msg = msg.to_string();
                            break;
                        }
                    }
                }
                if got_error {
                    break;
                }
            }
        }
    }

    assert!(
        got_error,
        "Expected error diagnostic from real Dart LS within 15s"
    );
    println!("Got expected Dart diagnostic: {}", error_msg);

    // 2. did_change incremental: replace line 2 `  int x = "error_str";` with `  int x = 42;`
    // Range: start: {line: 1, character: 10}, end: {line: 1, character: 21}
    let change = json!({
        "range": {
            "start": { "line": 1, "character": 10 },
            "end": { "line": 1, "character": 21 }
        },
        "text": "42"
    });

    let change_res = registry.did_change(&main_dart, Lang::Dart, 2, &[change], Some(&project_dir));
    assert!(change_res.is_ok(), "did_change failed: {:?}", change_res);

    // Wait for updated diagnostics (expect 0 errors, local variable unused warning is fine)
    let change_start = Instant::now();
    let mut cleared_errors = false;

    while change_start.elapsed() < Duration::from_secs(10) {
        if let Ok((_lang, _root, ServerEvent::Notification { method, params })) =
            rx.recv_timeout(Duration::from_millis(200))
        {
            if method == "textDocument/publishDiagnostics" {
                if let Some(diags) = params.get("diagnostics").and_then(|d| d.as_array()) {
                    let has_err = diags
                        .iter()
                        .any(|d| d.get("severity").and_then(|s| s.as_u64()).unwrap_or(0) == 1);
                    if !has_err {
                        cleared_errors = true;
                        break;
                    }
                }
            }
        }
    }

    assert!(
        cleared_errors,
        "Expected error diagnostics to be cleared after did_change incremental edit"
    );
    println!("Diagnostics cleared successfully on incremental did_change!");

    // 3. did_close
    let close_res = registry.did_close(&main_dart, Lang::Dart, Some(&project_dir));
    assert!(close_res.is_ok(), "did_close failed: {:?}", close_res);

    registry.shutdown_all();
}
