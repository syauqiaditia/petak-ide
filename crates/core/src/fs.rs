use std::fs;
use std::io;
use std::path::Path;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Entry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
}

const IGNORED_NAMES: &[&str] = &[".git", "node_modules", "build", "target"];

pub fn list_dir<P: AsRef<Path>>(path: P) -> io::Result<Vec<Entry>> {
    let mut entries = Vec::new();
    let read_dir = fs::read_dir(path)?;

    for entry_result in read_dir {
        let entry = entry_result?;
        let file_name = entry.file_name().to_string_lossy().to_string();
        if IGNORED_NAMES.contains(&file_name.as_str()) {
            continue;
        }

        let file_type = entry.file_type()?;
        let is_dir = file_type.is_dir();
        let path_str = entry.path().to_string_lossy().to_string();

        entries.push(Entry {
            name: file_name,
            path: path_str,
            is_dir,
        });
    }

    // Sort: directories first (sorted alphabetically), then files (sorted alphabetically)
    entries.sort_by(|a, b| {
        match (a.is_dir, b.is_dir) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
        }
    });

    Ok(entries)
}

pub fn read_file<P: AsRef<Path>>(path: P) -> io::Result<String> {
    fs::read_to_string(path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::{self, File};
    use std::io::Write;

    #[test]
    fn test_list_dir_sorting_and_filtering() {
        let temp_dir = tempfile::tempdir().unwrap();
        let root = temp_dir.path();

        // Create folders
        fs::create_dir(root.join("src")).unwrap();
        fs::create_dir(root.join(".git")).unwrap();
        fs::create_dir(root.join("node_modules")).unwrap();
        fs::create_dir(root.join("target")).unwrap();
        fs::create_dir(root.join("build")).unwrap();
        fs::create_dir(root.join("assets")).unwrap();

        // Create files
        File::create(root.join("Cargo.toml")).unwrap();
        File::create(root.join("README.md")).unwrap();

        let entries = list_dir(root).unwrap();

        // .git, node_modules, target, build should be ignored
        let names: Vec<&str> = entries.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, vec!["assets", "src", "Cargo.toml", "README.md"]);

        assert!(entries[0].is_dir);
        assert!(entries[1].is_dir);
        assert!(!entries[2].is_dir);
        assert!(!entries[3].is_dir);
    }

    #[test]
    fn test_read_file() {
        let temp_dir = tempfile::tempdir().unwrap();
        let file_path = temp_dir.path().join("hello.txt");
        let content = "Hello from Petak!";
        let mut file = File::create(&file_path).unwrap();
        file.write_all(content.as_bytes()).unwrap();

        let read = read_file(&file_path).unwrap();
        assert_eq!(read, content);
    }
}
