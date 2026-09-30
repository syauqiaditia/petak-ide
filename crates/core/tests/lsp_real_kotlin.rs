// Integration test with real Kotlin language server if available.

use petak_core::lsp::{Clock, Lang, Registry, ServerEvent};
use serde_json::json;
use std::path::Path;
use std::sync::{mpsc, Arc};
use std::time::{Duration, Instant};

struct WallClock;
impl Clock for WallClock {
    fn now(&self) -> Instant {
        Instant::now()
    }
}

fn has_kotlin_ls() -> bool {
    petak_core::toolchain::resolve_kotlin_ls().is_some()
}

#[test]
fn test_real_kotlin_lsp_diagnostics_completion() {
    if !has_kotlin_ls() {
        println!("Skipping test_real_kotlin_lsp_diagnostics_completion: kotlin-language-server not found");
        return;
    }

    let fixture_dir = Path::new("/mnt/storage/uqi-projects/petak/spike/fixtures/kotlin");
    if !fixture_dir.exists() {
        println!("Skipping: kotlin fixture dir not found");
        return;
    }

    let file_path = fixture_dir.join("src/main/kotlin/Main.kt");
    let code = match std::fs::read_to_string(&file_path) {
        Ok(c) => c,
        Err(_) => {
            println!("Skipping: Main.kt not found");
            return;
        }
    };

    let (tx, rx) = mpsc::channel();
    let clock = Arc::new(WallClock);
    let registry = Registry::new(clock, move |lang, root, event| {
        let _ = tx.send((lang, root, event));
    });

    let open_res = registry.did_open(&file_path, Lang::Kotlin, &code, Some(fixture_dir));
    assert!(open_res.is_ok(), "did_open kotlin failed: {:?}", open_res);

    // Wait for diagnostics (type mismatch)
    let start = Instant::now();
    let mut got_diag = false;
    let mut diags_list = vec![];
    while start.elapsed() < Duration::from_secs(15) {
        if let Ok((_lang, _root, ServerEvent::Notification { method, params })) =
            rx.recv_timeout(Duration::from_millis(200))
        {
            if method == "textDocument/publishDiagnostics" {
                if let Some(diags) = params.get("diagnostics").and_then(|d| d.as_array()) {
                    if !diags.is_empty() {
                        got_diag = true;
                        diags_list = diags.clone();
                        break;
                    }
                }
            }
        }
    }

    assert!(got_diag, "Expected Kotlin diagnostics within 15s");
    println!("Received Kotlin diagnostics: {}", diags_list.len());

    // Request completion at line 1, character 4
    let uri = petak_core::lsp::registry::path_to_uri(&file_path);
    let comp_params = json!({
        "textDocument": { "uri": &uri },
        "position": { "line": 1, "character": 4 }
    });
    let comp_res = registry
        .request(&file_path, Lang::Kotlin, "textDocument/completion", &comp_params, Some(fixture_dir))
        .expect("kotlin completion request");

    let comp_items = if let Some(items) = comp_res.as_array() {
        items.clone()
    } else if let Some(items) = comp_res.get("items").and_then(|i| i.as_array()) {
        items.clone()
    } else {
        vec![]
    };
    assert!(!comp_items.is_empty(), "Expected Kotlin completion items");
    println!("Received {} Kotlin completion items", comp_items.len());

    // Request code action at line 0, character 0
    let ca_params = json!({
        "textDocument": { "uri": &uri },
        "range": {
            "start": { "line": 0, "character": 0 },
            "end": { "line": 0, "character": 10 }
        },
        "context": {
            "diagnostics": diags_list
        }
    });
    let ca_res = registry
        .request(&file_path, Lang::Kotlin, "textDocument/codeAction", &ca_params, Some(fixture_dir))
        .expect("kotlin codeAction request");

    println!("Kotlin codeAction response: {:?}", ca_res);

    registry.shutdown_all();
}

#[test]
fn test_real_kotlin_lsp_mainactivity_diagnostics() {
    if !has_kotlin_ls() {
        println!("Skipping: kotlin-language-server not found");
        return;
    }

    let sample_dir = Path::new("/mnt/storage/uqi-cache/petak-samples/petak_native_sample");
    if !sample_dir.exists() {
        println!("Skipping: petak_native_sample not found");
        return;
    }

    let file_path = sample_dir.join("app/src/main/kotlin/id/petak/petak_native_sample/MainActivity.kt");
    let code = match std::fs::read_to_string(&file_path) {
        Ok(c) => c,
        Err(_) => {
            println!("Skipping: MainActivity.kt not found");
            return;
        }
    };

    let (tx, rx) = mpsc::channel();
    let clock = Arc::new(WallClock);
    let registry = Registry::new(clock, move |lang, root, event| {
        let _ = tx.send((lang, root, event));
    });

    let open_res = registry.did_open(&file_path, Lang::Kotlin, &code, Some(sample_dir));
    assert!(open_res.is_ok(), "did_open kotlin failed: {:?}", open_res);

    let start = Instant::now();
    let mut got_ready = false;
    let mut got_diag = false;
    let mut diags_count = 0;

    while start.elapsed() < Duration::from_secs(20) {
        if let Ok((_lang, _root, event)) = rx.recv_timeout(Duration::from_millis(200)) {
            match event {
                ServerEvent::Status { state, .. } => {
                    println!("LSP Status: {}", state);
                    if state == "ready" {
                        got_ready = true;
                    }
                }
                ServerEvent::Notification { method, params } => {
                    if method == "textDocument/publishDiagnostics" {
                        got_diag = true;
                        if let Some(arr) = params.get("diagnostics").and_then(|d| d.as_array()) {
                            diags_count = arr.len();
                            println!("MainActivity.kt diagnostics count: {}", diags_count);
                        }
                        break;
                    }
                }
                _ => {}
            }
        }
    }

    println!("MainActivity.kt verification: got_ready={}, got_diag={}, diags_count={}", got_ready, got_diag, diags_count);
    assert!(got_ready || got_diag, "Expected Kotlin LSP Ready or diagnostics for MainActivity.kt");

    registry.shutdown_all();
}
