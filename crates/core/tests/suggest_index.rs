use std::fs;
use tempfile::tempdir;

#[test]
fn test_suggest_query_basic_and_freq_filter() {
    let dir = tempdir().unwrap();
    let root = dir.path();

    let dummy_dart = r#"
import 'package:flutter/material.dart';

class MyPinWidget extends StatelessWidget {
  final TextEditingController _pinController = TextEditingController();
  final FocusNode _focusNode = FocusNode();

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        ITextFieldPin(
          controller: _pinController,
          focusNode: _focusNode,
        ),
        ITextFieldPin(
          controller: _pinController,
          focusNode: _focusNode,
        ),
        ITextFieldPin(
          controller: _pinController,
          focusNode: _focusNode,
        ),
        ITextFieldPin(
          controller: _pinController,
          focusNode: _focusNode,
        ),
        ITextFieldPin(
          controller: _pinController,
          focusNode: _focusNode,
        ),
        UniqueWidgetOnce(
          value: 42,
        ),
      ],
    );
  }
}
"#;

    fs::write(root.join("widget.dart"), dummy_dart).unwrap();

    let mut index = petak_core::suggest::SuggestIndex::new(root);
    index.build().unwrap();

    // Query "ITextF"
    let results = index.suggest_query("ITextF", Some("dart"), Some(3));
    assert!(!results.is_empty(), "expected suggest_query to return results");

    let top = &results[0];
    assert_eq!(top.text, "ieldPin(");
    assert_eq!(top.freq, 5);
    assert_eq!(top.args_template.as_deref(), Some("controller: , focusNode: ,"));

    // Frequency 1 must NOT appear
    let freq1_results = index.suggest_query("Unique", Some("dart"), Some(3));
    assert!(
        freq1_results.is_empty(),
        "freq 1 entries must not appear in suggest_query, got: {:?}",
        freq1_results
    );
}

#[test]
fn test_suggest_cap_20k_entries() {
    let dir = tempdir().unwrap();
    let root = dir.path();

    // Create a file with >20k unique identifiers repeated 2 times
    let mut code = String::with_capacity(1024 * 1024);
    code.push_str("void dummy() {\n");
    for i in 0..25_000 {
        code.push_str(&format!("  ident_{}(); ident_{}();\n", i, i));
    }
    code.push_str("}\n");

    fs::write(root.join("huge.dart"), code).unwrap();

    let mut index = petak_core::suggest::SuggestIndex::new(root);
    index.build().unwrap();

    let total_entries = index.total_indexed_entries();
    assert!(
        total_entries <= 20_000,
        "index must cap at 20,000 entries, found {}",
        total_entries
    );
}

#[test]
fn test_suggest_incremental_update() {
    let dir = tempdir().unwrap();
    let root = dir.path();

    let file_path = root.join("inc.dart");
    fs::write(
        &file_path,
        r#"
void test() {
  ITextFieldPin(controller: c1, focusNode: f1);
  ITextFieldPin(controller: c2, focusNode: f2);
}
"#,
    )
    .unwrap();

    let mut index = petak_core::suggest::SuggestIndex::new(root);
    index.build().unwrap();

    let res = index.suggest_query("ITextF", Some("dart"), Some(3));
    assert_eq!(res.len(), 1);
    assert_eq!(res[0].freq, 2);

    // Incrementally update: add 3 more calls
    fs::write(
        &file_path,
        r#"
void test() {
  ITextFieldPin(controller: c1, focusNode: f1);
  ITextFieldPin(controller: c2, focusNode: f2);
  ITextFieldPin(controller: c3, focusNode: f3);
  ITextFieldPin(controller: c4, focusNode: f4);
  ITextFieldPin(controller: c5, focusNode: f5);
}
"#,
    )
    .unwrap();

    index.update_file(&file_path).unwrap();

    let res_updated = index.suggest_query("ITextF", Some("dart"), Some(3));
    assert_eq!(res_updated.len(), 1);
    assert_eq!(res_updated[0].freq, 5);
}

#[test]
fn test_suggest_binary_persistence() {
    let dir = tempdir().unwrap();
    let root = dir.path();

    fs::write(
        root.join("pers.dart"),
        r#"
void demo() {
  ITextFieldPin(controller: c, focusNode: f);
  ITextFieldPin(controller: c, focusNode: f);
}
"#,
    )
    .unwrap();

    let app_data = tempdir().unwrap();
    let mut index = petak_core::suggest::SuggestIndex::new(root);
    index.set_app_data_dir(app_data.path().to_path_buf());
    index.build().unwrap();

    // Verify .bin file was created
    let bin_path = petak_core::suggest::index_file_path(Some(app_data.path()), root.to_str().unwrap());
    assert!(bin_path.exists(), "expected index binary at {:?}", bin_path);

    // Reload from disk
    let loaded = petak_core::suggest::SuggestIndex::load_from_disk(root, Some(app_data.path())).unwrap();
    let res = loaded.suggest_query("ITextF", Some("dart"), Some(3));
    assert_eq!(res.len(), 1);
    assert_eq!(res[0].text, "ieldPin(");
    assert_eq!(res[0].freq, 2);
    assert_eq!(res[0].args_template.as_deref(), Some("controller: , focusNode: ,"));
}

#[test]
fn test_suggest_measure_ram_2k_dummy_files() {
    let dir = tempdir().unwrap();
    let root = dir.path();

    // Generate 2,000 small Dart files
    for i in 0..2_000 {
        let content = format!(
            r#"
import 'package:flutter/material.dart';

Widget makeWidget{i}() {{
  return CustomCard{mod10}(
    title: 'Item {i}',
    onTap: () {{}},
  );
}}
"#,
            i = i,
            mod10 = i % 10
        );
        fs::write(root.join(format!("file_{}.dart", i)), content).unwrap();
    }

    let start_instant = std::time::Instant::now();
    let mut index = petak_core::suggest::SuggestIndex::new(root);
    index.build().unwrap();
    let build_duration = start_instant.elapsed();

    let mem_bytes = index.estimated_memory_bytes();
    let mem_mb = mem_bytes as f64 / (1024.0 * 1024.0);

    println!(
        "\n[RAM Benchmark] 2,000 Dart files indexed in {:?}, estimated RAM: {:.2} MB ({} bytes), entries: {}",
        build_duration,
        mem_mb,
        mem_bytes,
        index.total_indexed_entries()
    );

    assert!(
        mem_mb < 15.0,
        "index RAM must be < 15MB, measured: {:.2} MB",
        mem_mb
    );
}

#[test]
fn test_editor_ghost_text_setting() {
    let app_data = tempdir().unwrap();
    let app_data_path = app_data.path();

    // Default must be true
    assert!(petak_core::suggest::get_editor_ghost_text(Some(app_data_path)));

    // Toggle to false
    petak_core::suggest::set_editor_ghost_text(Some(app_data_path), false).unwrap();
    assert!(!petak_core::suggest::get_editor_ghost_text(Some(app_data_path)));

    // Toggle back to true
    petak_core::suggest::set_editor_ghost_text(Some(app_data_path), true).unwrap();
    assert!(petak_core::suggest::get_editor_ghost_text(Some(app_data_path)));
}
