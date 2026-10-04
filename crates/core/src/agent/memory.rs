use serde::{Deserialize, Serialize};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MemoryItem {
    pub filename: String,
    pub title: String,
    pub size: u64,
    pub updated_at: u64,
}

pub fn resolve_memory_dir(project_root: Option<&Path>) -> PathBuf {
    // 1. If {project_root}/.petak/memory exists (even as a symlink), prioritize it!
    if let Some(root) = project_root {
        let petak_mem = root.join(".petak").join("memory");
        if petak_mem.exists() {
            return petak_mem;
        }
    }

    // 2. Check Obsidian vault configuration or auto-detect standard vault paths
    let vault_candidate = if let Some(root) = project_root {
        let (team, _) = super::team::load_team(Some(root));
        team.obsidian_vault_path.map(PathBuf::from)
    } else {
        None
    };

    let vault_path = vault_candidate
        .or_else(|| {
            let (g_team, _) = super::team::load_team(None);
            g_team.obsidian_vault_path.map(PathBuf::from)
        })
        .or_else(|| {
            let candidates = [
                dirs::home_dir().map(|h| h.join("Documents/Coding/UQi/vault")),
                dirs::home_dir().map(|h| h.join("vault")),
                dirs::home_dir().map(|h| h.join("Documents/vault")),
            ];
            for c in candidates.into_iter().flatten() {
                if c.is_dir() {
                    return Some(c);
                }
            }
            None
        });

    if let (Some(vault), Some(root)) = (vault_path, project_root) {
        let p_name = root.file_name().and_then(|s| s.to_str()).unwrap_or("");
        let candidates = if p_name.contains("jatim") || p_name.contains("jconnect") {
            vec!["JConnect", "jatim-ist-mb-flutter", p_name]
        } else if p_name.contains("petak") {
            vec!["Petak", "petak", p_name]
        } else {
            vec![p_name]
        };

        for cand in candidates {
            let p_dir = vault.join("Projects").join(cand);
            if p_dir.is_dir() {
                let mem_sub = p_dir.join("Memory");
                if mem_sub.is_dir() {
                    return mem_sub;
                }
                return p_dir;
            }
        }
    }

    // 3. Fallback to default .petak/memory
    if let Some(root) = project_root {
        root.join(".petak").join("memory")
    } else if let Some(home) = dirs::home_dir() {
        home.join(".petak").join("memory")
    } else {
        PathBuf::from(".petak").join("memory")
    }
}

pub fn validate_memory_filename(filename: &str) -> Result<&str, io::Error> {
    let trimmed = filename.trim();
    if trimmed.is_empty() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Memory filename cannot be empty",
        ));
    }
    if trimmed.contains('/') || trimmed.contains('\\') || trimmed.contains("..") {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Path traversal detected in filename",
        ));
    }
    if !trimmed.to_ascii_lowercase().ends_with(".md") {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Filename must have .md extension",
        ));
    }
    let path = Path::new(trimmed);
    if path.file_name().and_then(|s| s.to_str()) != Some(trimmed) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Invalid filename component",
        ));
    }
    Ok(trimmed)
}

pub fn extract_title(content: &str, filename: &str) -> String {
    for line in content.lines() {
        let t = line.trim();
        if let Some(heading) = t.strip_prefix("# ") {
            let heading_clean = heading.trim();
            if !heading_clean.is_empty() {
                return heading_clean.to_string();
            }
        }
    }
    if let Some(stripped) = filename.strip_suffix(".md") {
        stripped.to_string()
    } else {
        filename.to_string()
    }
}

pub fn list_project_memory(project_root: Option<&Path>) -> Result<Vec<MemoryItem>, io::Error> {
    let dir = resolve_memory_dir(project_root);
    if !dir.exists() {
        return Ok(Vec::new());
    }

    let mut items = Vec::new();
    let entries = fs::read_dir(&dir)?;
    for entry in entries {
        let entry = entry?;
        let file_type = entry.file_type()?;
        if !file_type.is_file() {
            continue;
        }
        let fname = entry.file_name().to_string_lossy().to_string();
        if !fname.to_ascii_lowercase().ends_with(".md") {
            continue;
        }

        let metadata = entry.metadata()?;
        let size = metadata.len();
        let updated_at = metadata
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0);

        let content = fs::read_to_string(entry.path()).unwrap_or_default();
        let title = extract_title(&content, &fname);

        items.push(MemoryItem {
            filename: fname,
            title,
            size,
            updated_at,
        });
    }

    items.sort_by(|a, b| {
        b.updated_at
            .cmp(&a.updated_at)
            .then_with(|| a.filename.cmp(&b.filename))
    });
    Ok(items)
}

pub fn read_project_memory(
    project_root: Option<&Path>,
    filename: &str,
) -> Result<String, io::Error> {
    let safe_name = validate_memory_filename(filename)?;
    let dir = resolve_memory_dir(project_root);
    let path = dir.join(safe_name);
    fs::read_to_string(path)
}

pub fn save_project_memory(
    project_root: Option<&Path>,
    filename: &str,
    content: &str,
) -> Result<(), io::Error> {
    let safe_name = validate_memory_filename(filename)?;
    let dir = resolve_memory_dir(project_root);
    if !dir.exists() {
        fs::create_dir_all(&dir)?;
    }
    let path = dir.join(safe_name);
    fs::write(path, content)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn test_validate_memory_filename() {
        assert!(validate_memory_filename("lesson1.md").is_ok());
        assert!(validate_memory_filename("my-project-rules.md").is_ok());

        assert!(validate_memory_filename("").is_err());
        assert!(validate_memory_filename("foo.txt").is_err());
        assert!(validate_memory_filename("../escape.md").is_err());
        assert!(validate_memory_filename("subdir/test.md").is_err());
        assert!(validate_memory_filename("subdir\\test.md").is_err());
        assert!(validate_memory_filename("..\\test.md").is_err());
    }

    #[test]
    fn test_extract_title() {
        let content_with_h1 = "# Core Architecture Rules\n\nSome content here";
        assert_eq!(
            extract_title(content_with_h1, "rules.md"),
            "Core Architecture Rules"
        );

        let content_without_h1 = "No header here, just text";
        assert_eq!(extract_title(content_without_h1, "rules.md"), "rules");
    }

    #[test]
    fn test_memory_lifecycle() {
        let tmp = tempdir().unwrap();
        let root = tmp.path();

        // 1. Initial list empty
        let initial = list_project_memory(Some(root)).unwrap();
        assert!(initial.is_empty());

        // 2. Save file
        save_project_memory(
            Some(root),
            "lesson1.md",
            "# Rule 1: Always Test\nWrite tests first.",
        )
        .unwrap();

        // 3. Read file
        let read = read_project_memory(Some(root), "lesson1.md").unwrap();
        assert_eq!(read, "# Rule 1: Always Test\nWrite tests first.");

        // 4. List files
        let list = list_project_memory(Some(root)).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].filename, "lesson1.md");
        assert_eq!(list[0].title, "Rule 1: Always Test");
        assert!(list[0].size > 0);

        // 5. Save second file
        save_project_memory(Some(root), "notes.md", "Plain notes without header").unwrap();
        let list2 = list_project_memory(Some(root)).unwrap();
        assert_eq!(list2.len(), 2);
    }

    #[test]
    fn test_memory_path_traversal_rejected() {
        let tmp = tempdir().unwrap();
        let root = tmp.path();

        let err = save_project_memory(Some(root), "../evil.md", "bad content");
        assert!(err.is_err());

        let err_read = read_project_memory(Some(root), "../evil.md");
        assert!(err_read.is_err());
    }
}
