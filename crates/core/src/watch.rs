use notify::{Event, RecommendedWatcher, RecursiveMode, Watcher};
use std::path::Path;

pub fn is_allowed_git_path(subpath: &Path) -> bool {
    let s = subpath.to_string_lossy().replace('\\', "/");
    if s.is_empty() {
        return false;
    }
    // ignore *.lock files (e.g. index.lock, refs/.../branch.lock)
    if s.ends_with(".lock") || s.split('/').any(|seg| seg.ends_with(".lock")) {
        return false;
    }
    // ignore objects and logs
    if s == "objects" || s.starts_with("objects/") || s == "logs" || s.starts_with("logs/") {
        return false;
    }
    s == "HEAD"
        || s == "index"
        || s == "refs"
        || s.starts_with("refs/")
        || s == "MERGE_HEAD"
        || s == "rebase-merge"
        || s.starts_with("rebase-merge/")
        || s == "rebase-apply"
        || s.starts_with("rebase-apply/")
        || s == "CHERRY_PICK_HEAD"
        || s == "REVERT_HEAD"
}

pub fn should_emit_path(p: &Path) -> bool {
    let is_tmp = p
        .file_name()
        .and_then(|n| n.to_str())
        .map_or(false, |s| s.ends_with(".petak-tmp"));
    if is_tmp {
        return false;
    }

    let mut in_git = false;
    let mut git_subpath = std::path::PathBuf::new();
    for comp in p.components() {
        if in_git {
            git_subpath.push(comp);
        } else if comp.as_os_str() == ".git" {
            in_git = true;
        }
    }

    if in_git {
        is_allowed_git_path(&git_subpath)
    } else {
        true
    }
}

pub fn watch(
    root: &Path,
    on_change: impl Fn(Vec<String>) + Send + 'static,
) -> notify::Result<RecommendedWatcher> {
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<Event>| {
        if let Ok(event) = res {
            let paths: Vec<String> = event
                .paths
                .into_iter()
                .filter(|p| should_emit_path(p))
                .map(|p| p.to_string_lossy().to_string())
                .collect();

            if !paths.is_empty() {
                on_change(paths);
            }
        }
    })?;

    watcher.watch(root, RecursiveMode::Recursive)?;
    Ok(watcher)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::File;
    use std::io::Write;
    use std::sync::mpsc;
    use std::time::Duration;

    #[test]
    fn test_watch_detects_file_write() {
        let temp_dir = tempfile::tempdir().unwrap();
        let (tx, rx) = mpsc::channel();

        let _watcher = watch(temp_dir.path(), move |paths| {
            let _ = tx.send(paths);
        })
        .unwrap();

        // Write a file in tempdir
        let file_path = temp_dir.path().join("test.txt");
        let mut file = File::create(&file_path).unwrap();
        file.write_all(b"hello world").unwrap();
        file.sync_all().unwrap();

        // Wait for callback within 2 seconds
        let received = rx.recv_timeout(Duration::from_secs(2));
        assert!(received.is_ok(), "Expected watcher callback within 2 seconds");
        let paths = received.unwrap();
        assert!(!paths.is_empty(), "Paths should not be empty");
    }

    #[test]
    fn test_watch_ignores_git_and_temp_files() {
        let temp_dir = tempfile::tempdir().unwrap();
        let (tx, rx) = mpsc::channel();

        let git_dir = temp_dir.path().join(".git");
        std::fs::create_dir_all(&git_dir).unwrap();

        let _watcher = watch(temp_dir.path(), move |paths| {
            let _ = tx.send(paths);
        })
        .unwrap();

        // Write to .git/config, .git/objects/obj, .git/logs/HEAD, .git/index.lock, and a .petak-tmp file
        let git_file = git_dir.join("config");
        let mut f1 = File::create(&git_file).unwrap();
        f1.write_all(b"[core]\n").unwrap();
        f1.sync_all().unwrap();

        let obj_dir = git_dir.join("objects");
        std::fs::create_dir_all(&obj_dir).unwrap();
        let mut f_obj = File::create(obj_dir.join("obj")).unwrap();
        f_obj.write_all(b"blob").unwrap();
        f_obj.sync_all().unwrap();

        let lock_file = git_dir.join("index.lock");
        let mut f_lock = File::create(&lock_file).unwrap();
        f_lock.write_all(b"locked").unwrap();
        f_lock.sync_all().unwrap();

        let tmp_file = temp_dir.path().join(".main.rs.petak-tmp");
        let mut f2 = File::create(&tmp_file).unwrap();
        f2.write_all(b"temporary").unwrap();
        f2.sync_all().unwrap();

        // Now write a valid file
        let valid_file = temp_dir.path().join("main.rs");
        let mut f3 = File::create(&valid_file).unwrap();
        f3.write_all(b"fn main() {}").unwrap();
        f3.sync_all().unwrap();

        // Should receive the valid file event
        let start = std::time::Instant::now();
        let mut received_valid = false;
        while start.elapsed() < Duration::from_secs(2) {
            if let Ok(paths) = rx.recv_timeout(Duration::from_millis(500)) {
                for p in paths {
                    assert!(!p.contains(".git"), "Watcher leaked ignored .git path: {}", p);
                    assert!(!p.ends_with(".petak-tmp"), "Watcher leaked .petak-tmp path: {}", p);
                    if p.ends_with("main.rs") {
                        received_valid = true;
                    }
                }
                if received_valid {
                    break;
                }
            }
        }
        assert!(received_valid, "Expected to receive event for main.rs");
    }

    #[test]
    fn test_watch_filter_git_paths_unit() {
        assert!(is_allowed_git_path(Path::new("HEAD")));
        assert!(is_allowed_git_path(Path::new("index")));
        assert!(is_allowed_git_path(Path::new("refs/heads/main")));
        assert!(is_allowed_git_path(Path::new("refs/tags/v1.0")));
        assert!(is_allowed_git_path(Path::new("MERGE_HEAD")));
        assert!(is_allowed_git_path(Path::new("rebase-merge/done")));
        assert!(is_allowed_git_path(Path::new("rebase-apply/patch")));

        // Ignored paths
        assert!(!is_allowed_git_path(Path::new("config")));
        assert!(!is_allowed_git_path(Path::new("objects/4b/825dc")));
        assert!(!is_allowed_git_path(Path::new("logs/HEAD")));
        assert!(!is_allowed_git_path(Path::new("logs/refs/heads/main")));
        assert!(!is_allowed_git_path(Path::new("index.lock")));
        assert!(!is_allowed_git_path(Path::new("HEAD.lock")));
        assert!(!is_allowed_git_path(Path::new("refs/heads/main.lock")));
        assert!(!is_allowed_git_path(Path::new("")));

        // should_emit_path checks
        let base = Path::new("/workspace");
        assert!(should_emit_path(&base.join(".git/HEAD")));
        assert!(should_emit_path(&base.join(".git/index")));
        assert!(should_emit_path(&base.join(".git/refs/heads/feature")));
        assert!(!should_emit_path(&base.join(".git/index.lock")));
        assert!(!should_emit_path(&base.join(".git/objects/123")));
        assert!(!should_emit_path(&base.join(".git/logs/HEAD")));
        assert!(!should_emit_path(&base.join(".git/config")));
        assert!(!should_emit_path(&base.join("src/.main.rs.petak-tmp")));
        assert!(should_emit_path(&base.join("src/main.rs")));
    }

    #[test]
    fn test_watch_allows_important_git_files() {
        let temp_dir = tempfile::tempdir().unwrap();
        let (tx, rx) = mpsc::channel();

        let git_dir = temp_dir.path().join(".git");
        let refs_dir = git_dir.join("refs").join("heads");
        std::fs::create_dir_all(&refs_dir).unwrap();

        let _watcher = watch(temp_dir.path(), move |paths| {
            let _ = tx.send(paths);
        })
        .unwrap();

        // Write to .git/HEAD
        let head_file = git_dir.join("HEAD");
        let mut f_head = File::create(&head_file).unwrap();
        f_head.write_all(b"ref: refs/heads/main\n").unwrap();
        f_head.sync_all().unwrap();

        let start = std::time::Instant::now();
        let mut received_head = false;
        while start.elapsed() < Duration::from_secs(2) {
            if let Ok(paths) = rx.recv_timeout(Duration::from_millis(500)) {
                for p in paths {
                    if p.ends_with("HEAD") {
                        received_head = true;
                        break;
                    }
                }
                if received_head {
                    break;
                }
            }
        }
        assert!(received_head, "Expected to receive event for .git/HEAD");
    }
}
