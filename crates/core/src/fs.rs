use std::fs;
use std::io::{self, Write};
use std::path::Path;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Entry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
}

pub fn list_dir<P: AsRef<Path>>(path: P) -> io::Result<Vec<Entry>> {
    let path = path.as_ref();
    let metadata = fs::metadata(path)?;
    if !metadata.is_dir() {
        return Err(io::Error::new(io::ErrorKind::Other, "Not a directory"));
    }

    let walker = ignore::WalkBuilder::new(path)
        .max_depth(Some(1))
        .hidden(false)
        .parents(true)
        .require_git(false)
        .build();

    let mut entries = Vec::new();
    for result in walker {
        let entry = result.map_err(|e| io::Error::new(io::ErrorKind::Other, e))?;
        if entry.depth() == 0 {
            continue;
        }

        let file_name = entry.file_name().to_string_lossy().to_string();
        if file_name == ".git" {
            continue;
        }

        let is_dir = entry.file_type().map_or(false, |ft| ft.is_dir());
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

pub fn read_file_base64<P: AsRef<Path>>(path: P) -> io::Result<String> {
    use base64::Engine;
    let bytes = fs::read(path)?;
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

pub fn save_file<P: AsRef<Path>>(path: P, content: &str) -> io::Result<()> {
    save_file_bytes(path, content.as_bytes())
}

pub fn save_file_bytes<P: AsRef<Path>>(path: P, bytes: &[u8]) -> io::Result<()> {
    let target = path.as_ref();
    let parent = target.parent().unwrap_or_else(|| Path::new("."));
    let parent = if parent.as_os_str().is_empty() {
        Path::new(".")
    } else {
        parent
    };

    if !parent.exists() {
        return Err(io::Error::new(
            io::ErrorKind::NotFound,
            "Parent directory does not exist",
        ));
    }

    let file_name = target
        .file_name()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "Path has no file name"))?
        .to_string_lossy();

    let tmp_path = parent.join(format!(".{}.petak-tmp", file_name));

    let original_perms = fs::metadata(target).ok().map(|m| m.permissions());

    let write_res = (|| -> io::Result<()> {
        let mut file = fs::File::create(&tmp_path)?;
        if let Some(ref perms) = original_perms {
            let _ = file.set_permissions(perms.clone());
        }
        file.write_all(bytes)?;
        file.sync_all()?;
        Ok(())
    })();

    if let Err(e) = write_res {
        let _ = fs::remove_file(&tmp_path);
        return Err(e);
    }

    if let Err(e) = fs::rename(&tmp_path, target) {
        let _ = fs::remove_file(&tmp_path);
        return Err(e);
    }

    if let Some(perms) = original_perms {
        let _ = fs::set_permissions(target, perms);
    }

    Ok(())
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
        fs::create_dir(root.join("assets")).unwrap();

        // Create files
        File::create(root.join("Cargo.toml")).unwrap();
        File::create(root.join("README.md")).unwrap();

        let entries = list_dir(root).unwrap();

        // .git should be ignored
        let names: Vec<&str> = entries.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, vec!["assets", "src", "Cargo.toml", "README.md"]);

        assert!(entries[0].is_dir);
        assert!(entries[1].is_dir);
        assert!(!entries[2].is_dir);
        assert!(!entries[3].is_dir);
    }

    #[test]
    fn test_list_dir_respects_gitignore() {
        let temp_dir = tempfile::tempdir().unwrap();
        let root = temp_dir.path();

        // .gitignore with build/ and *.log
        let mut gitignore = File::create(root.join(".gitignore")).unwrap();
        writeln!(gitignore, "build/\n*.log").unwrap();

        // Create folders and files
        fs::create_dir(root.join("src")).unwrap();
        fs::create_dir(root.join("build")).unwrap();
        fs::create_dir(root.join(".git")).unwrap();
        File::create(root.join("a.log")).unwrap();
        File::create(root.join("main.rs")).unwrap();

        let entries = list_dir(root).unwrap();
        let names: Vec<&str> = entries.iter().map(|e| e.name.as_str()).collect();

        // build and a.log ignored; .gitignore itself appears; .git ignored
        assert_eq!(names, vec!["src", ".gitignore", "main.rs"]);
    }

    #[test]
    fn test_list_dir_parent_gitignore_applied_to_subfolder() {
        let temp_dir = tempfile::tempdir().unwrap();
        let root = temp_dir.path();

        // Parent .gitignore ignores *.tmp and ignored_dir/
        let mut gitignore = File::create(root.join(".gitignore")).unwrap();
        writeln!(gitignore, "*.tmp\nignored_dir/").unwrap();

        let sub = root.join("sub");
        fs::create_dir(&sub).unwrap();
        fs::create_dir(sub.join("ignored_dir")).unwrap();
        fs::create_dir(sub.join("normal_dir")).unwrap();
        File::create(sub.join("file.rs")).unwrap();
        File::create(sub.join("file.tmp")).unwrap();

        let entries = list_dir(&sub).unwrap();
        let names: Vec<&str> = entries.iter().map(|e| e.name.as_str()).collect();

        assert_eq!(names, vec!["normal_dir", "file.rs"]);
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

    #[test]
    fn test_save_file_writes_new_content() {
        let temp_dir = tempfile::tempdir().unwrap();
        let file_path = temp_dir.path().join("saved.txt");

        // Write new file
        save_file(&file_path, "hello world").unwrap();
        assert_eq!(read_file(&file_path).unwrap(), "hello world");

        // Overwrite existing file
        save_file(&file_path, "updated content").unwrap();
        assert_eq!(read_file(&file_path).unwrap(), "updated content");

        // Save raw binary bytes (including non-utf8)
        let bin_bytes = vec![0x00, 0xFF, 0xFE, 0x80, 0xAA];
        save_file_bytes(&file_path, &bin_bytes).unwrap();
        assert_eq!(fs::read(&file_path).unwrap(), bin_bytes);
    }

    #[test]
    fn test_save_file_nonexistent_folder_fails_cleanly() {
        let temp_dir = tempfile::tempdir().unwrap();
        let non_existent = temp_dir.path().join("non_existent_folder").join("file.txt");

        let res = save_file(&non_existent, "fail content");
        assert!(res.is_err());

        // Ensure no .petak-tmp left anywhere in temp_dir
        for entry in fs::read_dir(temp_dir.path()).unwrap() {
            let entry = entry.unwrap();
            let name = entry.file_name().to_string_lossy().to_string();
            assert!(!name.ends_with(".petak-tmp"), "Found leftover tmp file: {}", name);
        }
    }

    #[test]
    fn test_save_file_failure_leaves_original_intact() {
        let temp_dir = tempfile::tempdir().unwrap();
        let file_path = temp_dir.path().join("original.txt");
        let original_content = "original untouched content";
        fs::write(&file_path, original_content).unwrap();

        // Block tmp file creation by creating a directory with the tmp file name
        let tmp_path = temp_dir.path().join(".original.txt.petak-tmp");
        fs::create_dir(&tmp_path).unwrap();

        // Attempting to save_file should fail because tmp_path is a directory
        let res = save_file(&file_path, "new corrupted content");
        assert!(res.is_err());

        // Original file must still be intact
        assert_eq!(read_file(&file_path).unwrap(), original_content);
    }

    #[test]
    fn test_read_file_base64() {
        let temp_dir = tempfile::tempdir().unwrap();
        let file_path = temp_dir.path().join("test_binary.bin");
        let sample_bytes = vec![0x00, 0xFF, 0xFE, 0x80, 0xAA, 0x42, b'H', b'e', b'l', b'l', b'o'];
        fs::write(&file_path, &sample_bytes).unwrap();

        let encoded = read_file_base64(&file_path).unwrap();
        use base64::Engine;
        assert_eq!(
            encoded,
            base64::engine::general_purpose::STANDARD.encode(&sample_bytes)
        );

        let decoded = base64::engine::general_purpose::STANDARD
            .decode(&encoded)
            .unwrap();
        assert_eq!(decoded, sample_bytes);
    }
}
