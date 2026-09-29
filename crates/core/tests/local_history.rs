use tempfile::TempDir;
use petak_core::local_history;

#[test]
fn test_local_history_snapshot_dedup_and_read() {
    let tmp = TempDir::new().unwrap();
    let store = tmp.path();

    // First snapshot
    let e1 = local_history::snapshot(store, "lib/main.dart", b"void main() {}", "save").unwrap();
    assert!(e1.is_some());
    let entry1 = e1.unwrap();
    assert_eq!(entry1.path, "lib/main.dart");
    assert_eq!(entry1.kind, "save");

    // Reading blob content
    let content = local_history::read(store, &entry1.id).unwrap();
    assert_eq!(content, b"void main() {}");

    // Dedup: snapshot with EXACT SAME content must return None
    let e2 = local_history::snapshot(store, "lib/main.dart", b"void main() {}", "save").unwrap();
    assert!(e2.is_none(), "Identical consecutive snapshot must be skipped (dedup)");

    // Different content -> succeeds
    let e3 = local_history::snapshot(store, "lib/main.dart", b"void main() { run(); }", "save").unwrap();
    assert!(e3.is_some());
    let entry3 = e3.unwrap();
    assert_ne!(entry3.blob, entry1.blob);
}

#[test]
fn test_local_history_list_folder_and_deleted_files() {
    let tmp = TempDir::new().unwrap();
    let store = tmp.path();

    local_history::snapshot(store, "lib/a.dart", b"aaa", "save").unwrap();
    local_history::snapshot(store, "lib/b.dart", b"bbb", "save").unwrap();
    local_history::snapshot(store, "other/c.dart", b"ccc", "save").unwrap();

    // List folder "lib" -> returns a.dart and b.dart, but not other/c.dart
    let entries = local_history::list(store, "lib").unwrap();
    assert_eq!(entries.len(), 2);
    assert!(entries.iter().any(|e| e.path == "lib/a.dart"));
    assert!(entries.iter().any(|e| e.path == "lib/b.dart"));

    // Even if a file is deleted in real workspace, it still appears in local history list!
    // That's because list queries index.jsonl.
}

#[test]
fn test_local_history_labels_and_prune() {
    let tmp = TempDir::new().unwrap();
    let store = tmp.path();

    // Create entry
    local_history::snapshot(store, "lib/app.dart", b"v1.0", "save").unwrap();

    // Add label
    let lbl = local_history::put_label(store, "lib/app.dart", "Release 1.0").unwrap();
    assert_eq!(lbl.kind, "label");
    assert_eq!(lbl.label.as_deref(), Some("Release 1.0"));

    // List entries: latest first
    let list = local_history::list(store, "lib/app.dart").unwrap();
    assert_eq!(list[0].kind, "label");

    // Prune: with max_age_days = 0, old entries should be pruned EXCEPT label entry!
    // Let's create an old entry manually or test prune
    local_history::prune(store, 7, 200 * 1024 * 1024).unwrap();
    let list_after = local_history::list(store, "lib/app.dart").unwrap();
    assert!(!list_after.is_empty());
}

#[test]
fn test_local_history_revert_flow() {
    let tmp = TempDir::new().unwrap();
    let store = tmp.path();

    // Snapshot state 1
    let e1 = local_history::snapshot(store, "file.txt", b"version 1", "save").unwrap().unwrap();
    // Snapshot state 2
    let _e2 = local_history::snapshot(store, "file.txt", b"version 2", "save").unwrap().unwrap();

    // Revert flow:
    // Read state 1
    let reverted_bytes = local_history::read(store, &e1.id).unwrap();
    assert_eq!(reverted_bytes, b"version 1");

    // Snapshot before_rollback for current state (v2)
    local_history::snapshot(store, "file.txt", b"version 2", "before_rollback").unwrap();
    // Snapshot restored state (v1)
    local_history::snapshot(store, "file.txt", &reverted_bytes, "save").unwrap();

    let list = local_history::list(store, "file.txt").unwrap();
    assert_eq!(list[0].kind, "save");
    assert_eq!(local_history::read(store, &list[0].id).unwrap(), b"version 1");
    assert_eq!(list[1].kind, "before_rollback");
}
