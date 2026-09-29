use std::fs;
#[cfg(unix)]
use std::os::unix::fs::symlink;
use tempfile::TempDir;
use petak_core::fsops;

#[test]
fn test_validate_name() {
    assert!(fsops::validate_name("").is_err(), "Empty name must fail");
    assert!(fsops::validate_name(".").is_err(), "'.' must fail");
    assert!(fsops::validate_name("..").is_err(), "'..' must fail");
    assert!(fsops::validate_name("a/b").is_err(), "Slash must fail");
    assert!(fsops::validate_name("a\\b").is_err(), "Backslash must fail");
    assert!(fsops::validate_name("a\0b").is_err(), "NUL byte must fail");
    let long_name = "a".repeat(256);
    assert!(fsops::validate_name(&long_name).is_err(), ">255 bytes must fail");

    assert!(fsops::validate_name("valid_name.dart").is_ok());
    assert!(fsops::validate_name("a".repeat(255).as_str()).is_ok());
}

#[test]
fn test_path_guards() {
    let tmp = TempDir::new().unwrap();
    let root = tmp.path();

    // Absolute path
    assert!(fsops::resolve_in_root(root, "/etc/passwd").is_err());
    #[cfg(windows)]
    assert!(fsops::resolve_in_root(root, "C:\\Windows").is_err());

    // Escaping root via ..
    assert!(fsops::resolve_in_root(root, "../x").is_err());
    assert!(fsops::resolve_in_root(root, "foo/../../x").is_err());
    assert!(fsops::resolve_in_root(root, "..").is_err());

    // Symlink outside root
    #[cfg(unix)]
    {
        let outside_dir = TempDir::new().unwrap();
        let outside_file = outside_dir.path().join("secret.txt");
        fs::write(&outside_file, "secret").unwrap();

        let symlink_path = root.join("symlink_out");
        symlink(outside_dir.path(), &symlink_path).unwrap();

        assert!(fsops::resolve_in_root(root, "symlink_out").is_err());
        assert!(fsops::resolve_in_root(root, "symlink_out/secret.txt").is_err());
    }

    // Normal safe path
    let resolved = fsops::resolve_in_root(root, "src/main.dart").unwrap();
    assert!(resolved.starts_with(root.canonicalize().unwrap()));
}

#[test]
fn test_create_file_nested_and_templates() {
    let tmp = TempDir::new().unwrap();
    let root = tmp.path();

    // Create nested dart file (template dart -> empty)
    let p1 = fsops::create_file(root, "lib/src/main.dart", Some("dart")).unwrap();
    assert!(p1.exists());
    assert_eq!(fs::read_to_string(&p1).unwrap(), "");

    // Error if already exists
    assert!(fsops::create_file(root, "lib/src/main.dart", None).is_err());

    // Swift template
    let p2 = fsops::create_file(root, "ios/App/AppDelegate.swift", Some("swift")).unwrap();
    assert!(p2.exists());
    assert_eq!(fs::read_to_string(&p2).unwrap(), "import Foundation\n");

    // Kotlin template
    let p3 = fsops::create_file(root, "android/app/src/main/kotlin/com/example/app/MainActivity.kt", Some("kotlin")).unwrap();
    assert!(p3.exists());
    let kt_content = fs::read_to_string(&p3).unwrap();
    assert!(kt_content.contains("package com.example.app"));
    assert!(kt_content.contains("class MainActivity"));
}

#[test]
fn test_create_dir_and_rename_no_overwrite() {
    let tmp = TempDir::new().unwrap();
    let root = tmp.path();

    let d1 = fsops::create_dir(root, "nested/folder").unwrap();
    assert!(d1.exists());
    assert!(d1.is_dir());

    // Rename file
    fsops::create_file(root, "a.dart", None).unwrap();
    fsops::create_file(root, "b.dart", None).unwrap();

    // Rename to existing must fail and leave both files intact
    assert!(fsops::rename(root, "a.dart", "b.dart").is_err());
    assert!(root.join("a.dart").exists());
    assert!(root.join("b.dart").exists());

    // Rename to non-existing must succeed
    assert!(fsops::rename(root, "a.dart", "c.dart").is_ok());
    assert!(!root.join("a.dart").exists());
    assert!(root.join("c.dart").exists());

    // Case-only rename
    assert!(fsops::rename(root, "c.dart", "C.dart").is_ok());
    assert!(root.join("C.dart").exists());
}

#[test]
fn test_move_into_and_prevent_self_nesting() {
    let tmp = TempDir::new().unwrap();
    let root = tmp.path();

    fsops::create_dir(root, "folder_a").unwrap();
    fsops::create_dir(root, "folder_b").unwrap();
    fsops::create_file(root, "folder_a/item.txt", None).unwrap();

    // Move folder into itself or its child must fail
    assert!(fsops::move_into(root, &["folder_a"], "folder_a").is_err());
    fsops::create_dir(root, "folder_a/sub").unwrap();
    assert!(fsops::move_into(root, &["folder_a"], "folder_a/sub").is_err());

    // Moving file into folder_b succeeds
    let moved = fsops::move_into(root, &["folder_a/item.txt"], "folder_b").unwrap();
    assert_eq!(moved.len(), 1);
    assert!(!root.join("folder_a/item.txt").exists());
    assert!(root.join("folder_b/item.txt").exists());
}

#[test]
fn test_copy_into_and_duplicate_collision_naming() {
    let tmp = TempDir::new().unwrap();
    let root = tmp.path();

    fsops::create_file(root, "doc.txt", None).unwrap();
    fs::write(root.join("doc.txt"), "hello doc").unwrap();

    // Duplicate doc.txt -> "doc copy.txt"
    let dup1 = fsops::duplicate(root, "doc.txt").unwrap();
    assert_eq!(dup1.file_name().unwrap(), "doc copy.txt");
    assert_eq!(fs::read_to_string(&dup1).unwrap(), "hello doc");

    // Duplicate doc.txt again -> "doc copy 2.txt"
    let dup2 = fsops::duplicate(root, "doc.txt").unwrap();
    assert_eq!(dup2.file_name().unwrap(), "doc copy 2.txt");

    // Copy into another dir
    fsops::create_dir(root, "target_dir").unwrap();
    let copied = fsops::copy_into(root, &["doc.txt"], "target_dir").unwrap();
    assert_eq!(copied.len(), 1);
    assert!(root.join("target_dir/doc.txt").exists());

    // Copy again into target_dir -> collision resolution
    let copied2 = fsops::copy_into(root, &["doc.txt"], "target_dir").unwrap();
    assert_eq!(copied2.len(), 1);
    assert!(root.join("target_dir/doc copy.txt").exists());
}

#[test]
fn test_trash() {
    let tmp = TempDir::new().unwrap();
    let root = tmp.path();

    fsops::create_file(root, "to_delete.txt", None).unwrap();
    assert!(root.join("to_delete.txt").exists());

    let res = fsops::trash(root, &["to_delete.txt"]);
    match res {
        Ok(_) => {
            assert!(!root.join("to_delete.txt").exists(), "File should be removed from original location after trash");
        }
        Err(e) => {
            // In headless CI/Linux without XDG desktop trash support, trash might return error
            eprintln!("Trash returned error in this environment: {}", e);
        }
    }
}
