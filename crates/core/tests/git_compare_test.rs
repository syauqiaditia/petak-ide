use petak_core::exec::{git, SystemExec};
use petak_core::git::diff::{compare_branch, diff_between_refs};
use std::fs;
use std::path::Path;

struct TestRepo {
    dir: tempfile::TempDir,
}

impl TestRepo {
    fn new() -> Self {
        let dir = tempfile::tempdir().unwrap();
        let exec = SystemExec;
        git(&exec, dir.path(), &["init"]).unwrap();
        git(&exec, dir.path(), &["config", "user.name", "Test User"]).unwrap();
        git(&exec, dir.path(), &["config", "user.email", "test@example.com"]).unwrap();
        git(&exec, dir.path(), &["checkout", "-b", "main"]).unwrap();
        Self { dir }
    }

    fn path(&self) -> &Path {
        self.dir.path()
    }

    fn write_file(&self, rel: &str, content: &str) {
        let full = self.path().join(rel);
        if let Some(parent) = full.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(full, content).unwrap();
    }

    fn write_bytes(&self, rel: &str, bytes: &[u8]) {
        let full = self.path().join(rel);
        if let Some(parent) = full.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(full, bytes).unwrap();
    }
}

#[test]
fn test_compare_branch_multiple_files_rename_delete_binary_and_path_filter() {
    let repo = TestRepo::new();
    let exec = SystemExec;

    // Base commit on main
    repo.write_file("file_mod.txt", "line 1\nline 2\nline 3\n");
    repo.write_file("file_to_del.txt", "will be deleted\n");
    repo.write_file("old_name.txt", "content of rename file\nline b\n");
    repo.write_file("folder/sub_mod.txt", "sub line 1\n");
    repo.write_bytes("image.png", &[0x89, 0x50, 0x4E, 0x47, 0x00, 0x01, 0x02]);

    git(&exec, repo.path(), &["add", "."]).unwrap();
    git(&exec, repo.path(), &["commit", "-m", "base commit"]).unwrap();

    // Create and checkout feature branch
    git(&exec, repo.path(), &["checkout", "-b", "feature"]).unwrap();

    // 1. Modify file_mod.txt (add 2 lines, remove 1)
    repo.write_file("file_mod.txt", "line 1\nline 2 modified\nline 3\nline 4 added\n");

    // 2. Delete file_to_del.txt
    fs::remove_file(repo.path().join("file_to_del.txt")).unwrap();

    // 3. Rename old_name.txt to new_name.txt
    fs::remove_file(repo.path().join("old_name.txt")).unwrap();
    repo.write_file("new_name.txt", "content of rename file\nline b\n");

    // 4. Add new file
    repo.write_file("file_added.txt", "fresh line 1\nfresh line 2\n");

    // 5. Modify file in folder/
    repo.write_file("folder/sub_mod.txt", "sub line 1\nsub line 2 added\n");

    // 6. Modify binary file
    repo.write_bytes("image.png", &[0x89, 0x50, 0x4E, 0x47, 0xFF, 0xFE, 0xFD, 0x00]);

    git(&exec, repo.path(), &["add", "-A"]).unwrap();
    git(&exec, repo.path(), &["commit", "-m", "feature changes"]).unwrap();

    // Test compare_branch across all files
    let result = compare_branch(&exec, repo.path(), "main", "feature", None).unwrap();

    // Must return ALL 6 changed files (proving the 'only 1 file' bug is completely resolved!)
    assert_eq!(
        result.files.len(),
        6,
        "Expected all 6 files to be listed, got: {:?}",
        result.files.iter().map(|f| &f.path).collect::<Vec<_>>()
    );

    // Check added file
    let added_entry = result.files.iter().find(|f| f.path == "file_added.txt").unwrap();
    assert_eq!(added_entry.status, "A");
    assert_eq!(added_entry.added, 2);
    assert_eq!(added_entry.removed, 0);
    assert!(!added_entry.binary);

    // Check deleted file
    let del_entry = result.files.iter().find(|f| f.path == "file_to_del.txt").unwrap();
    assert_eq!(del_entry.status, "D");
    assert_eq!(del_entry.added, 0);
    assert_eq!(del_entry.removed, 1);

    // Check renamed file
    let ren_entry = result.files.iter().find(|f| f.path == "new_name.txt").unwrap();
    assert_eq!(ren_entry.status, "R");
    assert_eq!(ren_entry.old_path.as_deref(), Some("old_name.txt"));

    // Check binary file
    let bin_entry = result.files.iter().find(|f| f.path == "image.png").unwrap();
    assert!(bin_entry.binary, "image.png must be flagged as binary");
    assert_eq!(bin_entry.added, 0);
    assert_eq!(bin_entry.removed, 0);

    // Check totals
    assert!(result.total_added > 0);
    assert!(result.total_removed > 0);

    // Test path filtering: only return files inside "folder"
    let folder_res = compare_branch(&exec, repo.path(), "main", "feature", Some("folder")).unwrap();
    assert_eq!(folder_res.files.len(), 1);
    assert_eq!(folder_res.files[0].path, "folder/sub_mod.txt");

    // Test diff_between_refs for single file
    let file_diffs = diff_between_refs(&exec, repo.path(), "main", "feature", "file_mod.txt").unwrap();
    assert_eq!(file_diffs.len(), 1);
    assert_eq!(file_diffs[0].path(), "file_mod.txt");
    assert!(!file_diffs[0].hunks.is_empty());
}
