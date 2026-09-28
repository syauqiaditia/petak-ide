use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
pub struct RecentData {
    pub folders: Vec<String>,
}

pub fn default_recent_path() -> Option<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        std::env::var_os("HOME").map(|h| {
            PathBuf::from(h)
                .join("Library")
                .join("Application Support")
                .join("Petak")
                .join("recent.json")
        })
    }
    #[cfg(not(target_os = "macos"))]
    {
        if let Some(xdg) = std::env::var_os("XDG_CONFIG_HOME") {
            Some(PathBuf::from(xdg).join("Petak").join("recent.json"))
        } else {
            std::env::var_os("HOME").map(|h| {
                PathBuf::from(h)
                    .join(".config")
                    .join("Petak")
                    .join("recent.json")
            })
        }
    }
}

pub fn load_recent<P: AsRef<Path>>(file: P) -> io::Result<Vec<String>> {
    let path = file.as_ref();
    if !path.exists() {
        return Ok(Vec::new());
    }
    let data = fs::read_to_string(path)?;
    let parsed: RecentData = serde_json::from_str(&data).unwrap_or_default();
    Ok(parsed.folders)
}

pub fn push_recent<P: AsRef<Path>>(file: P, folder: &str) -> io::Result<Vec<String>> {
    let path = file.as_ref();
    let mut folders = load_recent(path).unwrap_or_default();

    // Dedupe
    folders.retain(|f| f != folder);

    // Insert newest at front
    folders.insert(0, folder.to_string());

    // Max 10
    folders.truncate(10);

    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent)?;
        }
    }

    let payload = RecentData {
        folders: folders.clone(),
    };
    let json = serde_json::to_string_pretty(&payload)
        .map_err(|e| io::Error::new(io::ErrorKind::Other, e))?;

    fs::write(path, json)?;

    Ok(folders)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn test_load_nonexistent() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("recent.json");
        let list = load_recent(&file).unwrap();
        assert!(list.is_empty());
    }

    #[test]
    fn test_push_and_dedupe() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("recent.json");

        push_recent(&file, "/path/a").unwrap();
        push_recent(&file, "/path/b").unwrap();
        push_recent(&file, "/path/c").unwrap();

        let list = load_recent(&file).unwrap();
        assert_eq!(list, vec!["/path/c", "/path/b", "/path/a"]);

        // Push /path/b again: should dedupe and move to front
        let updated = push_recent(&file, "/path/b").unwrap();
        assert_eq!(updated, vec!["/path/b", "/path/c", "/path/a"]);
        assert_eq!(load_recent(&file).unwrap(), vec!["/path/b", "/path/c", "/path/a"]);
    }

    #[test]
    fn test_max_10() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("recent.json");

        for i in 1..=15 {
            push_recent(&file, &format!("/folder/{}", i)).unwrap();
        }

        let list = load_recent(&file).unwrap();
        assert_eq!(list.len(), 10);
        assert_eq!(list[0], "/folder/15");
        assert_eq!(list[9], "/folder/6");
    }
}
