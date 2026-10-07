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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MemorySnippet {
    pub domain: String,
    pub source_file: String,
    pub title: String,
    pub content: String,
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

pub fn detect_domain_from_path(file_path: &Path) -> &'static str {
    let ext = file_path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    match ext.as_str() {
        "dart" => "flutter",
        "rs" => "rust",
        "svelte" => "svelte",
        "ts" | "tsx" | "js" | "jsx" => "typescript",
        _ => "general",
    }
}

fn detect_snippet_domain(title: &str, body: &str, default_domain: &'static str) -> String {
    let lower_title = title.to_ascii_lowercase();
    let lower_body = body.to_ascii_lowercase();

    if lower_title.contains("flutter") || lower_title.contains("dart") {
        return "flutter".to_string();
    }
    if lower_title.contains("rust") || lower_title.contains("cargo") {
        return "rust".to_string();
    }
    if lower_title.contains("svelte") {
        return "svelte".to_string();
    }
    if lower_title.contains("typescript")
        || lower_title.contains("javascript")
        || lower_title.contains(" ts ")
        || lower_title.contains(" js ")
    {
        return "typescript".to_string();
    }
    if lower_title.contains("general") {
        return "general".to_string();
    }

    if lower_body.contains("domain: flutter")
        || lower_body.contains("[flutter]")
        || lower_body.contains("tag: flutter")
    {
        return "flutter".to_string();
    }
    if lower_body.contains("domain: rust")
        || lower_body.contains("[rust]")
        || lower_body.contains("tag: rust")
    {
        return "rust".to_string();
    }
    if lower_body.contains("domain: svelte")
        || lower_body.contains("[svelte]")
        || lower_body.contains("tag: svelte")
    {
        return "svelte".to_string();
    }
    if lower_body.contains("domain: typescript")
        || lower_body.contains("[typescript]")
        || lower_body.contains("tag: typescript")
    {
        return "typescript".to_string();
    }

    let has_flutter = lower_body.contains("flutter") || lower_body.contains("dart");
    let has_rust = lower_body.contains("rust") || lower_body.contains("cargo");
    let has_svelte = lower_body.contains("svelte");
    let has_ts = lower_body.contains("typescript");

    let count = has_flutter as u32 + has_rust as u32 + has_svelte as u32 + has_ts as u32;
    if count == 1 {
        if has_flutter {
            return "flutter".to_string();
        }
        if has_rust {
            return "rust".to_string();
        }
        if has_svelte {
            return "svelte".to_string();
        }
        if has_ts {
            return "typescript".to_string();
        }
    }

    if default_domain != "general" {
        return default_domain.to_string();
    }

    "general".to_string()
}

fn detect_domain_from_name(filename: &str) -> &'static str {
    let lower_name = filename.to_ascii_lowercase();
    if lower_name.contains("flutter") || lower_name.contains("dart") {
        "flutter"
    } else if lower_name.contains("rust") || lower_name.contains("cargo") {
        "rust"
    } else if lower_name.contains("svelte") {
        "svelte"
    } else if lower_name.contains("typescript")
        || lower_name.contains("javascript")
        || lower_name.contains("ts_")
        || lower_name.contains("js_")
    {
        "typescript"
    } else {
        "general"
    }
}

fn parse_domain_memory_snippets(filename: &str, content: &str) -> Vec<MemorySnippet> {
    let mut snippets = Vec::new();
    let file_domain = detect_domain_from_name(filename);

    let mut current_title: Option<String> = None;
    let mut current_body_lines: Vec<&str> = Vec::new();

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("# ") || trimmed.starts_with("## ") || trimmed.starts_with("### ") {
            if let Some(title) = current_title.take() {
                let body = current_body_lines.join("\n").trim().to_string();
                if !body.is_empty() {
                    let domain = detect_snippet_domain(&title, &body, file_domain);
                    snippets.push(MemorySnippet {
                        domain,
                        source_file: filename.to_string(),
                        title,
                        content: body,
                    });
                }
                current_body_lines.clear();
            }
            let title = trimmed.trim_start_matches('#').trim().to_string();
            current_title = Some(title);
        } else {
            current_body_lines.push(line);
        }
    }

    if let Some(title) = current_title {
        let body = current_body_lines.join("\n").trim().to_string();
        if !body.is_empty() {
            let domain = detect_snippet_domain(&title, &body, file_domain);
            snippets.push(MemorySnippet {
                domain,
                source_file: filename.to_string(),
                title,
                content: body,
            });
        }
    } else {
        let body = content.trim().to_string();
        if !body.is_empty() {
            let title = extract_title(content, filename);
            let domain = detect_snippet_domain(&title, &body, file_domain);
            snippets.push(MemorySnippet {
                domain,
                source_file: filename.to_string(),
                title,
                content: body,
            });
        }
    }

    snippets
}

pub fn get_domain_relevant_memory(
    project_root: Option<&Path>,
    active_file: Option<&str>,
) -> Vec<MemorySnippet> {
    let target_domain = active_file
        .map(|f| detect_domain_from_path(Path::new(f)))
        .unwrap_or("general");

    let dir = resolve_memory_dir(project_root);
    if !dir.exists() {
        return Vec::new();
    }

    let mut files_to_read = Vec::new();
    let priority_names = ["conventions.md", "gotchas.md", "lessons.md", "rules.md"];
    for name in &priority_names {
        if dir.join(name).is_file() {
            files_to_read.push(name.to_string());
        }
    }

    if let Ok(entries) = fs::read_dir(&dir) {
        for entry in entries.flatten() {
            if let Ok(ft) = entry.file_type() {
                if ft.is_file() {
                    let fname = entry.file_name().to_string_lossy().to_string();
                    if fname.to_ascii_lowercase().ends_with(".md")
                        && !files_to_read.iter().any(|f| f.eq_ignore_ascii_case(&fname))
                    {
                        if validate_memory_filename(&fname).is_ok() {
                            files_to_read.push(fname);
                        }
                    }
                }
            }
        }
    }

    let mut snippets = Vec::new();

    for fname in files_to_read {
        if validate_memory_filename(&fname).is_err() {
            continue;
        }
        let file_path = dir.join(&fname);
        let Ok(content) = fs::read_to_string(&file_path) else {
            continue;
        };

        let file_snippets = parse_domain_memory_snippets(&fname, &content);
        for snippet in file_snippets {
            let matches_domain = if target_domain == "general" {
                snippet.domain == "general"
            } else {
                snippet.domain == target_domain || snippet.domain == "general"
            };
            if matches_domain {
                snippets.push(snippet);
            }
        }
    }

    snippets.sort_by(|a, b| {
        let a_priority = if a.domain == target_domain { 0 } else { 1 };
        let b_priority = if b.domain == target_domain { 0 } else { 1 };
        a_priority
            .cmp(&b_priority)
            .then_with(|| a.source_file.cmp(&b.source_file))
            .then_with(|| a.title.cmp(&b.title))
    });

    snippets
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

    #[test]
    fn test_detect_domain_from_path() {
        assert_eq!(
            detect_domain_from_path(Path::new("lib/main.dart")),
            "flutter"
        );
        assert_eq!(detect_domain_from_path(Path::new("src/main.rs")), "rust");
        assert_eq!(
            detect_domain_from_path(Path::new("ui/App.svelte")),
            "svelte"
        );
        assert_eq!(
            detect_domain_from_path(Path::new("src/index.ts")),
            "typescript"
        );
        assert_eq!(
            detect_domain_from_path(Path::new("src/index.tsx")),
            "typescript"
        );
        assert_eq!(
            detect_domain_from_path(Path::new("src/index.js")),
            "typescript"
        );
        assert_eq!(
            detect_domain_from_path(Path::new("src/index.jsx")),
            "typescript"
        );
        assert_eq!(
            detect_domain_from_path(Path::new("scripts/test.py")),
            "general"
        );
        assert_eq!(detect_domain_from_path(Path::new("README.md")), "general");
    }

    #[test]
    fn test_domain_memory_filtering() {
        let tmp = tempdir().unwrap();
        let root = tmp.path();

        let mem_dir = root.join(".petak").join("memory");
        fs::create_dir_all(&mem_dir).unwrap();

        let rules_md = r#"
# Flutter Conventions
Always use const constructors and Riverpod providers.

# Rust Rules
Never use unwrap or panic in production code.

# General Guidelines
Always write tests before code commits.
"#;
        fs::write(mem_dir.join("rules.md"), rules_md).unwrap();

        // 1. Query for .dart file -> matches flutter and general, excludes rust
        let flutter_snippets =
            get_domain_relevant_memory(Some(root), Some("lib/features/home.dart"));
        assert_eq!(flutter_snippets.len(), 2);
        assert!(flutter_snippets
            .iter()
            .any(|s| s.domain == "flutter" && s.title == "Flutter Conventions"));
        assert!(flutter_snippets
            .iter()
            .any(|s| s.domain == "general" && s.title == "General Guidelines"));
        assert!(!flutter_snippets.iter().any(|s| s.domain == "rust"));

        // 2. Query for .rs file -> matches rust and general, excludes flutter
        let rust_snippets = get_domain_relevant_memory(Some(root), Some("crates/core/src/lib.rs"));
        assert_eq!(rust_snippets.len(), 2);
        assert!(rust_snippets
            .iter()
            .any(|s| s.domain == "rust" && s.title == "Rust Rules"));
        assert!(rust_snippets
            .iter()
            .any(|s| s.domain == "general" && s.title == "General Guidelines"));
        assert!(!rust_snippets.iter().any(|s| s.domain == "flutter"));

        // 3. Query with no active file (None) -> returns general rules
        let general_snippets = get_domain_relevant_memory(Some(root), None);
        assert_eq!(general_snippets.len(), 1);
        assert_eq!(general_snippets[0].title, "General Guidelines");
    }

    #[test]
    fn test_domain_memory_path_traversal() {
        let tmp = tempdir().unwrap();
        let root = tmp.path();

        // Passing path traversal in active_file shouldn't panic or escape
        let snippets = get_domain_relevant_memory(Some(root), Some("../../../etc/passwd"));
        assert!(snippets.is_empty());
    }
}
