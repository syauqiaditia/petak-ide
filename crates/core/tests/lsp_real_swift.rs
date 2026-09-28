// Integration test with real Swift sourcekit-lsp (macOS only; skipped elsewhere).

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

fn has_sourcekit_lsp() -> bool {
    std::process::Command::new("xcrun")
        .args(["--find", "sourcekit-lsp"])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

#[test]
fn test_real_swift_lsp_diagnostics_completion() {
    if !has_sourcekit_lsp() {
        println!("Skipping test_real_swift_lsp_diagnostics_completion: sourcekit-lsp not found");
        return;
    }

    let fixture_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../spike/fixtures/swift");
    let fixture_dir = fixture_dir.canonicalize().expect("swift fixture dir");
    let file_path = fixture_dir.join("Sources/x/main.swift");
    let code = std::fs::read_to_string(&file_path).expect("read main.swift");

    let (tx, rx) = mpsc::channel();
    let registry = Registry::new(Arc::new(WallClock), move |lang, root, event| {
        let _ = tx.send((lang, root, event));
    });

    registry
        .did_open(&file_path, Lang::Swift, &code, Some(&fixture_dir))
        .expect("did_open swift");

    // Fixture assigns String to Int -> expect an error diagnostic.
    let start = Instant::now();
    let mut diags = vec![];
    while start.elapsed() < Duration::from_secs(60) && diags.is_empty() {
        if let Ok((_, _, ServerEvent::Notification { method, params })) =
            rx.recv_timeout(Duration::from_millis(200))
        {
            if method == "textDocument/publishDiagnostics" {
                if let Some(d) = params.get("diagnostics").and_then(|d| d.as_array()) {
                    diags = d.clone();
                }
            }
        }
    }
    println!("Swift first diagnostics after {:?}: {:?}", start.elapsed(), diags);
    assert!(!diags.is_empty(), "Expected Swift diagnostics within 60s");

    // Completion after "pri" on the print(count) line (line 3).
    let uri = petak_core::lsp::registry::path_to_uri(&file_path);
    let t0 = Instant::now();
    let comp = registry
        .request(
            &file_path,
            Lang::Swift,
            "textDocument/completion",
            &json!({ "textDocument": { "uri": &uri }, "position": { "line": 3, "character": 3 } }),
            Some(&fixture_dir),
        )
        .expect("swift completion request");
    let items = comp
        .as_array()
        .cloned()
        .or_else(|| comp.get("items").and_then(|i| i.as_array()).cloned())
        .unwrap_or_default();
    println!("Swift completion: {} items in {:?}", items.len(), t0.elapsed());
    assert!(!items.is_empty(), "Expected Swift completion items");

    registry.shutdown_all();
}
