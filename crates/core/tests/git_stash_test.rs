use petak_core::exec::{git, SystemExec};
use petak_core::git::stash::{stash_apply, stash_drop, stash_list, stash_pop, stash_push};
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

        let s = Self { dir };
        s.write_file("init.txt", "initial\n");
        git(&exec, s.path(), &["add", "init.txt"]).unwrap();
        git(&exec, s.path(), &["commit", "-m", "init commit"]).unwrap();
        s
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

    fn read_file(&self, rel: &str) -> String {
        fs::read_to_string(self.path().join(rel)).unwrap()
    }
}

#[test]
fn test_git_stash_lifecycle_dummy_repo() {
    let repo = TestRepo::new();
    let exec = SystemExec;

    // 1. Initial stash list must be empty
    let list0 = stash_list(&exec, repo.path()).unwrap();
    assert!(list0.is_empty(), "Initially stash list should be empty");

    // 2. Modify tracked file + add untracked file
    repo.write_file("init.txt", "modified tracked content\n");
    repo.write_file("new_untracked.txt", "untracked fresh\n");

    // Stash push with message and include_untracked = true
    let push_msg = stash_push(&exec, repo.path(), Some("my wip stash"), true).unwrap();
    assert!(!push_msg.is_empty());

    // Both files should be reverted/clean
    assert_eq!(repo.read_file("init.txt"), "initial\n");
    assert!(!repo.path().join("new_untracked.txt").exists());

    // 3. Check stash_list
    let list1 = stash_list(&exec, repo.path()).unwrap();
    assert_eq!(list1.len(), 1);
    assert_eq!(list1[0].index, 0);
    assert_eq!(list1[0].branch, "main");
    assert_eq!(list1[0].message, "my wip stash");
    assert!(!list1[0].date.is_empty());

    // 4. Stash apply: restores changes, leaves stash in list
    stash_apply(&exec, repo.path(), 0).unwrap();
    assert_eq!(repo.read_file("init.txt"), "modified tracked content\n");
    assert!(repo.path().join("new_untracked.txt").exists());
    let list_after_apply = stash_list(&exec, repo.path()).unwrap();
    assert_eq!(list_after_apply.len(), 1, "apply should keep entry in list");

    // Re-stash to test pop
    git(&exec, repo.path(), &["checkout", "--", "init.txt"]).unwrap();
    git(&exec, repo.path(), &["clean", "-fd"]).unwrap();

    // 5. Stash pop: restores changes and drops the stash
    stash_pop(&exec, repo.path(), Some(0)).unwrap();
    assert_eq!(repo.read_file("init.txt"), "modified tracked content\n");
    assert!(repo.path().join("new_untracked.txt").exists());
    let list_after_pop = stash_list(&exec, repo.path()).unwrap();
    assert!(list_after_pop.is_empty(), "pop should remove entry from list");

    // 6. Test stash drop
    repo.write_file("init.txt", "to drop\n");
    stash_push(&exec, repo.path(), Some("to be dropped"), false).unwrap();
    let list_before_drop = stash_list(&exec, repo.path()).unwrap();
    assert_eq!(list_before_drop.len(), 1);
    stash_drop(&exec, repo.path(), 0).unwrap();
    let list_after_drop = stash_list(&exec, repo.path()).unwrap();
    assert!(list_after_drop.is_empty(), "drop should delete stash@{{0}}");
}

#[test]
fn test_git_stash_file_cherry_pick_and_diff() {
    let repo = TestRepo::new();
    let exec = SystemExec;

    // Create 2 modified files
    repo.write_file("file_a.txt", "content a\n");
    git(&exec, repo.path(), &["add", "file_a.txt"]).unwrap();
    git(&exec, repo.path(), &["commit", "-m", "commit a"]).unwrap();

    repo.write_file("file_b.txt", "content b\n");
    git(&exec, repo.path(), &["add", "file_b.txt"]).unwrap();
    git(&exec, repo.path(), &["commit", "-m", "commit b"]).unwrap();

    // Modify both
    repo.write_file("file_a.txt", "modified a\n");
    repo.write_file("file_b.txt", "modified b\n");

    // Stash them
    petak_core::git::stash_push(&exec, repo.path(), Some("stash two files"), false).unwrap();
    assert_eq!(repo.read_file("file_a.txt"), "content a\n");
    assert_eq!(repo.read_file("file_b.txt"), "content b\n");

    // 1. Check stash_files
    let files = petak_core::git::stash_files(&exec, repo.path(), 0).unwrap();
    assert_eq!(files.len(), 2);
    assert!(files.iter().any(|f| f.path == "file_a.txt"));
    assert!(files.iter().any(|f| f.path == "file_b.txt"));

    // 2. Check diff
    let diff_a = petak_core::git::stash_file_diff(&exec, repo.path(), 0, "file_a.txt").unwrap();
    assert!(diff_a.contains("modified a"));

    // 3. Cherry pick ONLY file_a.txt
    petak_core::git::stash_apply_file(&exec, repo.path(), 0, "file_a.txt").unwrap();
    assert_eq!(repo.read_file("file_a.txt"), "modified a\n");
    assert_eq!(repo.read_file("file_b.txt"), "content b\n"); // file_b remains untouched!
}
