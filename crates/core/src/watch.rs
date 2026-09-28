use notify::{Event, RecommendedWatcher, RecursiveMode, Watcher};
use std::path::Path;

pub fn watch(
    root: &Path,
    on_change: impl Fn(Vec<String>) + Send + 'static,
) -> notify::Result<RecommendedWatcher> {
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<Event>| {
        if let Ok(event) = res {
            let paths: Vec<String> = event
                .paths
                .into_iter()
                .filter(|p| {
                    let in_git = p.components().any(|c| c.as_os_str() == ".git");
                    let is_tmp = p
                        .file_name()
                        .and_then(|n| n.to_str())
                        .map_or(false, |s| s.ends_with(".petak-tmp"));
                    !in_git && !is_tmp
                })
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
}
