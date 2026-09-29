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
        .map_err(io::Error::other)?;

    fs::write(path, json)?;

    Ok(folders)
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RecentProject {
    pub name: String,
    pub path: String,
    pub last_opened: u64,
    pub exists: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StoredRecentProject {
    pub name: String,
    pub path: String,
    pub last_opened: u64,
}

pub fn default_recent_projects_path() -> Option<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        std::env::var_os("HOME").map(|h| {
            PathBuf::from(h)
                .join("Library")
                .join("Application Support")
                .join("Petak")
                .join("recent_projects.json")
        })
    }
    #[cfg(not(target_os = "macos"))]
    {
        if let Some(xdg) = std::env::var_os("XDG_CONFIG_HOME") {
            Some(PathBuf::from(xdg).join("Petak").join("recent_projects.json"))
        } else {
            std::env::var_os("HOME").map(|h| {
                PathBuf::from(h)
                    .join(".config")
                    .join("Petak")
                    .join("recent_projects.json")
            })
        }
    }
}

/// Read recent projects list from JSON file, checking if each path exists on disk.
/// Returns at most 10 items, newest first.
pub fn recent_projects_list<P: AsRef<Path>>(file: P) -> io::Result<Vec<RecentProject>> {
    let path = file.as_ref();
    if !path.exists() {
        return Ok(Vec::new());
    }
    let data = fs::read_to_string(path)?;
    let stored: Vec<StoredRecentProject> = serde_json::from_str(&data).unwrap_or_default();

    let mut result = Vec::with_capacity(stored.len());
    for item in stored {
        let exists = Path::new(&item.path).exists();
        result.push(RecentProject {
            name: item.name,
            path: item.path,
            last_opened: item.last_opened,
            exists,
        });
    }

    result.sort_by_key(|r| std::cmp::Reverse(r.last_opened));
    result.truncate(10);
    Ok(result)
}

/// Add or update a project path in the recent projects store.
/// Caps at 10 items, dedupes by path, and sets newest timestamp at front.
pub fn recent_projects_add<P: AsRef<Path>>(
    file: P,
    project_path: &str,
) -> io::Result<Vec<RecentProject>> {
    let path = file.as_ref();
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);

    let name = Path::new(project_path)
        .file_name()
        .and_then(|n| n.to_str())
        .filter(|s| !s.is_empty())
        .unwrap_or(project_path)
        .to_string();

    let existing = if path.exists() {
        let data = fs::read_to_string(path)?;
        let items: Vec<StoredRecentProject> = serde_json::from_str(&data).unwrap_or_default();
        items
    } else {
        Vec::new()
    };

    let mut updated: Vec<StoredRecentProject> = Vec::new();
    updated.push(StoredRecentProject {
        name,
        path: project_path.to_string(),
        last_opened: now,
    });

    for item in existing {
        if item.path != project_path {
            updated.push(item);
        }
    }

    updated.truncate(10);

    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent)?;
        }
    }

    let json = serde_json::to_string_pretty(&updated)
        .map_err(io::Error::other)?;
    fs::write(path, json)?;

    recent_projects_list(path)
}

/// Remove a project path from the recent projects store.
pub fn recent_projects_remove<P: AsRef<Path>>(
    file: P,
    project_path: &str,
) -> io::Result<Vec<RecentProject>> {
    let path = file.as_ref();
    if !path.exists() {
        return Ok(Vec::new());
    }

    let data = fs::read_to_string(path)?;
    let mut stored: Vec<StoredRecentProject> = serde_json::from_str(&data).unwrap_or_default();
    stored.retain(|item| item.path != project_path);

    let json = serde_json::to_string_pretty(&stored)
        .map_err(io::Error::other)?;
    fs::write(path, json)?;

    recent_projects_list(path)
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

    #[test]
    fn test_recent_projects_store_cap_10_remove_exists() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("recent_projects.json");

        // 1. Initially empty
        let initial = recent_projects_list(&file).unwrap();
        assert!(initial.is_empty());

        // 2. Add non-existent path => exists is false
        let non_existent = "/tmp/petak_test_nonexistent_dir_123456";
        recent_projects_add(&file, non_existent).unwrap();

        // 3. Add existing directory => exists is true
        let existing_dir = dir.path().join("my_flutter_app");
        fs::create_dir_all(&existing_dir).unwrap();
        recent_projects_add(&file, existing_dir.to_str().unwrap()).unwrap();

        let list = recent_projects_list(&file).unwrap();
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].name, "my_flutter_app");
        assert_eq!(list[0].path, existing_dir.to_str().unwrap());
        assert!(list[0].exists);

        assert_eq!(list[1].path, non_existent);
        assert!(!list[1].exists);

        // 4. Add 15 paths to test cap of 10 and newest-first ordering
        for i in 1..=15 {
            recent_projects_add(&file, &format!("/project/proj_{}", i)).unwrap();
        }

        let capped = recent_projects_list(&file).unwrap();
        assert_eq!(capped.len(), 10);
        assert_eq!(capped[0].name, "proj_15");
        assert_eq!(capped[0].path, "/project/proj_15");
        assert_eq!(capped[9].name, "proj_6");
        assert_eq!(capped[9].path, "/project/proj_6");

        // 5. Remove an entry
        let after_remove = recent_projects_remove(&file, "/project/proj_15").unwrap();
        assert_eq!(after_remove.len(), 9);
        assert!(!after_remove.iter().any(|p| p.path == "/project/proj_15"));
        assert_eq!(after_remove[0].name, "proj_14");

        // 6. Deduplication and move to front
        recent_projects_add(&file, "/project/proj_10").unwrap();
        let deduped = recent_projects_list(&file).unwrap();
        assert_eq!(deduped.len(), 9);
        assert_eq!(deduped[0].path, "/project/proj_10");
    }
}
