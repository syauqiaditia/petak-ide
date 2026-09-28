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

#[test]
fn test_real_dart_lsp_p23_features() {
    if !has_dart() {
        println!("Skipping test_real_dart_lsp_p23_features: dart not in PATH");
        return;
    }

    let tmp = tempfile::tempdir().expect("create temp dir");
    let project_dir = tmp.path().to_path_buf();

    let pubspec = project_dir.join("pubspec.yaml");
    std::fs::write(
        &pubspec,
        "name: test_p23\nenvironment:\n  sdk: '>=3.0.0 <4.0.0'\n",
    )
    .expect("write pubspec");

    let lib_dir = project_dir.join("lib");
    std::fs::create_dir_all(&lib_dir).expect("create lib dir");

    let file_path = lib_dir.join("feature.dart");
    let code = "int mySpecialNumber = 42;\nvoid main() {\n  print(mySpecialNumber);\n}\n";
    std::fs::write(&file_path, code).expect("write feature.dart");

    let (tx, rx) = mpsc::channel();
    let clock = Arc::new(WallClock);
    let registry = Registry::new(clock, move |_lang, _root, event| {
        let _ = tx.send(event);
    });

    let uri = petak_core::lsp::registry::path_to_uri(&file_path);

    // 1. Open
    registry
        .did_open(&file_path, Lang::Dart, code, Some(&project_dir))
        .expect("did_open");

    // Wait for analysis (diagnostics notification)
    let start = Instant::now();
    while start.elapsed() < Duration::from_secs(15) {
        if let Ok(ServerEvent::Notification { method, .. }) = rx.recv_timeout(Duration::from_millis(200)) {
            if method == "textDocument/publishDiagnostics" {
                break;
            }
        }
    }

    // 2. Completion: at line 2 character 8 ("  print(my")
    // Let's insert a partial identifier to complete
    let comp_change = json!({
        "range": {
            "start": { "line": 2, "character": 8 },
            "end": { "line": 2, "character": 24 }
        },
        "text": "mySpe"
    });
    registry
        .did_change(&file_path, Lang::Dart, 2, &[comp_change], Some(&project_dir))
        .expect("did_change");

    let comp_params = json!({
        "textDocument": { "uri": &uri },
        "position": { "line": 2, "character": 13 }
    });
    let comp_res = registry
        .request(&file_path, Lang::Dart, "textDocument/completion", &comp_params, Some(&project_dir))
        .expect("completion request");

    let comp_items = if let Some(items) = comp_res.as_array() {
        items.clone()
    } else if let Some(items) = comp_res.get("items").and_then(|i| i.as_array()) {
        items.clone()
    } else {
        vec![]
    };

    assert!(
        !comp_items.is_empty(),
        "Expected completion items from Dart LS, got: {:?}",
        comp_res
    );
    let found_target = comp_items
        .iter()
        .any(|item| item.get("label").and_then(|l| l.as_str()) == Some("mySpecialNumber"));
    assert!(
        found_target,
        "Expected mySpecialNumber in completion items: {:?}",
        comp_items
            .iter()
            .take(10)
            .filter_map(|i| i.get("label"))
            .collect::<Vec<_>>()
    );
    println!("Dart LSP completion verified successfully!");

    // 3. Hover at line 0, character 5 ("mySpecialNumber")
    let hover_params = json!({
        "textDocument": { "uri": &uri },
        "position": { "line": 0, "character": 5 }
    });
    let hover_res = registry
        .request(&file_path, Lang::Dart, "textDocument/hover", &hover_params, Some(&project_dir))
        .expect("hover request");
    assert!(
        hover_res.get("contents").is_some(),
        "Expected hover contents, got: {:?}",
        hover_res
    );
    println!("Dart LSP hover verified successfully!");

    // 4. Definition: at line 0, character 5
    let def_params = json!({
        "textDocument": { "uri": &uri },
        "position": { "line": 0, "character": 5 }
    });
    let def_res = registry
        .request(&file_path, Lang::Dart, "textDocument/definition", &def_params, Some(&project_dir))
        .expect("definition request");
    assert!(
        !def_res.is_null(),
        "Expected definition result, got: {:?}",
        def_res
    );
    println!("Dart LSP definition verified successfully!");

    // 5. Formatting: format unformatted code
    let unformatted = "void testFormat(){int   a=1;   }\n";
    let unformatted_file = lib_dir.join("unformatted.dart");
    std::fs::write(&unformatted_file, unformatted).expect("write unformatted.dart");
    let unformatted_uri = petak_core::lsp::registry::path_to_uri(&unformatted_file);
    registry
        .did_open(&unformatted_file, Lang::Dart, unformatted, Some(&project_dir))
        .expect("did_open unformatted");

    let format_params = json!({
        "textDocument": { "uri": &unformatted_uri },
        "options": { "tabSize": 2, "insertSpaces": true }
    });
    let format_res = registry
        .request(&unformatted_file, Lang::Dart, "textDocument/formatting", &format_params, Some(&project_dir))
        .expect("format request");

    let edits = format_res.as_array().expect("formatting edits array");
    assert!(
        !edits.is_empty(),
        "Expected formatting edits from Dart LS, got: {:?}",
        format_res
    );
    println!("Dart LSP formatting verified successfully with {} edits!", edits.len());

    // 6. Rename: rename mySpecialNumber at line 0, character 5 to renamedNumber
    let rename_params = json!({
        "textDocument": { "uri": &uri },
        "position": { "line": 0, "character": 5 },
        "newName": "renamedNumber"
    });
    let rename_res = registry
        .request(&file_path, Lang::Dart, "textDocument/rename", &rename_params, Some(&project_dir))
        .expect("rename request");

    assert!(
        rename_res.get("changes").is_some() || rename_res.get("documentChanges").is_some(),
        "Expected workspace changes in rename response: {:?}",
        rename_res
    );
    println!("Dart LSP rename verified successfully!");

    registry.shutdown_all();
}

#[test]
fn test_real_dart_lsp_p24_code_actions() {
    if !has_dart() {
        println!("Skipping test_real_dart_lsp_p24_code_actions: dart not in PATH");
        return;
    }

    let tmp = tempfile::tempdir().expect("create temp dir");
    let project_dir = tmp.path().to_path_buf();

    let pubspec = project_dir.join("pubspec.yaml");
    std::fs::write(
        &pubspec,
        "name: test_lsp_p24\nenvironment:\n  sdk: '>=3.0.0 <4.0.0'\n",
    )
    .expect("write pubspec");

    let lib_dir = project_dir.join("lib");
    std::fs::create_dir_all(&lib_dir).expect("create lib dir");

    let (tx, rx) = mpsc::channel();
    let clock = Arc::new(WallClock);
    let registry = Registry::new(clock, move |lang, root, event| {
        let _ = tx.send((lang, root, event));
    });

    // 1. Test "Remove unused import" quickfix
    let unused_code = "import 'dart:math';\nvoid main() {}\n";
    let unused_file = lib_dir.join("unused.dart");
    std::fs::write(&unused_file, unused_code).expect("write unused.dart");
    let unused_uri = petak_core::lsp::registry::path_to_uri(&unused_file);

    registry
        .did_open(&unused_file, Lang::Dart, unused_code, Some(&project_dir))
        .expect("did_open unused");

    // Wait for diagnostics on unused_import
    let start = Instant::now();
    let mut unused_diags = vec![];
    while start.elapsed() < Duration::from_secs(10) {
        if let Ok((_lang, _root, ServerEvent::Notification { method, params })) =
            rx.recv_timeout(Duration::from_millis(150))
        {
            if method == "textDocument/publishDiagnostics" {
                if let Some(uri) = params.get("uri").and_then(|u| u.as_str()) {
                    if uri == unused_uri {
                        if let Some(diags) = params.get("diagnostics").and_then(|d| d.as_array()) {
                            if !diags.is_empty() {
                                unused_diags = diags.clone();
                                break;
                            }
                        }
                    }
                }
            }
        }
    }

    let ca_params = json!({
        "textDocument": { "uri": &unused_uri },
        "range": {
            "start": { "line": 0, "character": 7 },
            "end": { "line": 0, "character": 18 }
        },
        "context": {
            "diagnostics": unused_diags
        }
    });

    let ca_res = registry
        .request(&unused_file, Lang::Dart, "textDocument/codeAction", &ca_params, Some(&project_dir))
        .expect("codeAction request");

    let actions = ca_res.as_array().expect("code actions array");
    let remove_import = actions.iter().find(|a| {
        a.get("title")
            .and_then(|t| t.as_str())
            .map(|t| t.contains("Remove unused import"))
            .unwrap_or(false)
    });
    assert!(
        remove_import.is_some(),
        "Expected 'Remove unused import' code action, got: {:?}",
        actions
    );
    println!("Verified 'Remove unused import' code action!");

    // 2. Test "Import library" for missing import
    let missing_code = "void main() {\n  Random r = Random();\n}\n";
    let missing_file = lib_dir.join("missing.dart");
    std::fs::write(&missing_file, missing_code).expect("write missing.dart");
    let missing_uri = petak_core::lsp::registry::path_to_uri(&missing_file);

    registry
        .did_open(&missing_file, Lang::Dart, missing_code, Some(&project_dir))
        .expect("did_open missing");

    let start = Instant::now();
    let mut missing_diags = vec![];
    while start.elapsed() < Duration::from_secs(10) {
        if let Ok((_lang, _root, ServerEvent::Notification { method, params })) =
            rx.recv_timeout(Duration::from_millis(150))
        {
            if method == "textDocument/publishDiagnostics" {
                if let Some(uri) = params.get("uri").and_then(|u| u.as_str()) {
                    if uri == missing_uri {
                        if let Some(diags) = params.get("diagnostics").and_then(|d| d.as_array()) {
                            if !diags.is_empty() {
                                missing_diags = diags.clone();
                                break;
                            }
                        }
                    }
                }
            }
        }
    }

    let ca_missing_params = json!({
        "textDocument": { "uri": &missing_uri },
        "range": {
            "start": { "line": 1, "character": 2 },
            "end": { "line": 1, "character": 8 }
        },
        "context": {
            "diagnostics": missing_diags
        }
    });

    let ca_missing_res = registry
        .request(&missing_file, Lang::Dart, "textDocument/codeAction", &ca_missing_params, Some(&project_dir))
        .expect("codeAction missing import request");

    let missing_actions = ca_missing_res.as_array().expect("missing code actions array");
    let add_import = missing_actions.iter().find(|a| {
        a.get("title")
            .and_then(|t| t.as_str())
            .map(|t| t.contains("Import library 'dart:math'"))
            .unwrap_or(false)
    });
    assert!(
        add_import.is_some(),
        "Expected \"Import library 'dart:math'\" code action, got: {:?}",
        missing_actions
    );
    println!("Verified 'Import library dart:math' code action!");

    // 3. Test Flutter wrap actions if flutter hello_world project exists
    let flutter_example = std::path::PathBuf::from("/mnt/storage/flutter-uqi/examples/hello_world");
    if flutter_example.exists() {
        let flutter_main = flutter_example.join("lib/main.dart");
        let flutter_code = std::fs::read_to_string(&flutter_main).expect("read flutter main.dart");
        let flutter_uri = petak_core::lsp::registry::path_to_uri(&flutter_main);

        registry
            .did_open(&flutter_main, Lang::Dart, &flutter_code, Some(&flutter_example))
            .expect("did_open flutter main");

        std::thread::sleep(Duration::from_millis(1500));

        let ca_flutter_params = json!({
            "textDocument": { "uri": &flutter_uri },
            "range": {
                "start": { "line": 8, "character": 11 },
                "end": { "line": 8, "character": 11 }
            },
            "context": {
                "diagnostics": []
            }
        });

        let ca_flutter_res = registry
            .request(&flutter_main, Lang::Dart, "textDocument/codeAction", &ca_flutter_params, Some(&flutter_example))
            .expect("flutter codeAction request");

        let flutter_actions = ca_flutter_res.as_array().expect("flutter code actions array");
        let titles: Vec<&str> = flutter_actions
            .iter()
            .filter_map(|a| a.get("title").and_then(|t| t.as_str()))
            .collect();
        println!("Flutter code actions available: {:?}", titles);

        assert!(
            titles.iter().any(|t| t.contains("Wrap with Padding")),
            "Expected 'Wrap with Padding', got: {:?}",
            titles
        );
        assert!(
            titles.iter().any(|t| t.contains("Wrap with Center")),
            "Expected 'Wrap with Center', got: {:?}",
            titles
        );
        assert!(
            titles.iter().any(|t| t.contains("Wrap with Column")),
            "Expected 'Wrap with Column', got: {:?}",
            titles
        );
        assert!(
            titles.iter().any(|t| t.contains("Wrap with widget")),
            "Expected 'Wrap with widget', got: {:?}",
            titles
        );

        let padding_action = flutter_actions
            .iter()
            .find(|a| a.get("title").and_then(|t| t.as_str()).map(|t| t.contains("Wrap with Padding")).unwrap_or(false))
            .unwrap();
        let edit = padding_action.get("edit").expect("edit field in Wrap with Padding");
        let doc_changes = edit.get("documentChanges").expect("documentChanges in edit");
        let new_text = doc_changes[0]["edits"][0]["newText"].as_str().expect("newText");
        assert!(
            new_text.contains("Padding(") && new_text.contains("EdgeInsets.all(8.0)"),
            "Expected Padding edit with EdgeInsets, got: {}",
            new_text
        );
        println!("Verified Flutter Wrap with Padding edit content!");
    }

    registry.shutdown_all();
}
