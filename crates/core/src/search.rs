use nucleo_matcher::pattern::{CaseMatching, Normalization, Pattern};
use nucleo_matcher::{Config, Matcher, Utf32Str};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct FileMatch {
    pub path: String,
    pub score: u32,
    pub indices: Vec<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct FileIndex {
    pub root: PathBuf,
    pub files: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GrepOpts {
    pub regex: bool,
    pub case_sensitive: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Hit {
    pub path: String,
    pub line: u32,
    pub col: u32,
    pub text: String,
}

impl FileIndex {
    pub fn build<P: AsRef<Path>>(root: P) -> Self {
        let root = root.as_ref().to_path_buf();
        let walker = ignore::WalkBuilder::new(&root)
            .hidden(false)
            .parents(true)
            .require_git(false)
            .build();

        let mut files = Vec::new();
        for entry in walker.flatten() {
            if entry.file_type().map_or(false, |ft| ft.is_file()) {
                let path = entry.path();
                let has_git = path.components().any(|c| c.as_os_str() == ".git");
                if has_git {
                    continue;
                }
                if let Ok(rel) = path.strip_prefix(&root) {
                    let rel_str = rel
                        .components()
                        .map(|c| c.as_os_str().to_string_lossy())
                        .collect::<Vec<_>>()
                        .join("/");
                    if !rel_str.is_empty() {
                        files.push(rel_str);
                    }
                }
            }
        }
        files.sort();
        Self { root, files }
    }

    pub fn query(&self, q: &str, limit: usize) -> Vec<FileMatch> {
        if q.is_empty() || limit == 0 {
            return Vec::new();
        }

        let pattern = Pattern::parse(q, CaseMatching::Smart, Normalization::Smart);
        let mut matcher = Matcher::new(Config::DEFAULT.match_paths());
        let mut buf = Vec::new();
        let mut matches = Vec::new();

        for file in &self.files {
            let mut indices = Vec::new();
            let haystack = Utf32Str::new(file, &mut buf);
            if let Some(score) = pattern.indices(haystack, &mut matcher, &mut indices) {
                matches.push(FileMatch {
                    path: file.clone(),
                    score,
                    indices,
                });
            }
        }

        // Sort score desc lalu path lebih pendek
        matches.sort_by(|a, b| {
            b.score
                .cmp(&a.score)
                .then_with(|| a.path.len().cmp(&b.path.len()))
                .then_with(|| a.path.cmp(&b.path))
        });

        if matches.len() > limit {
            matches.truncate(limit);
        }

        matches
    }
}

pub fn has_rg() -> bool {
    if let Some(paths) = std::env::var_os("PATH") {
        for path in std::env::split_paths(&paths) {
            let p = path.join(if cfg!(windows) { "rg.exe" } else { "rg" });
            if p.is_file() {
                return true;
            }
        }
    }
    false
}

#[derive(Deserialize)]
struct RgMessage {
    r#type: String,
    data: Option<RgData>,
}

#[derive(Deserialize)]
struct RgData {
    path: Option<RgPath>,
    lines: Option<RgLines>,
    line_number: Option<u32>,
    submatches: Option<Vec<RgSubmatch>>,
}

#[derive(Deserialize)]
struct RgPath {
    text: Option<String>,
}

#[derive(Deserialize)]
struct RgLines {
    text: Option<String>,
}

#[derive(Deserialize)]
struct RgSubmatch {
    start: usize,
}

fn grep_rg<P: AsRef<Path>>(
    root: P,
    query: &str,
    opts: &GrepOpts,
    limit: usize,
) -> Result<Vec<Hit>, String> {
    use std::io::BufRead;
    use std::process::{Command, Stdio};

    if query.is_empty() || limit == 0 {
        return Ok(Vec::new());
    }

    let root_path = root.as_ref();
    let mut cmd = Command::new("rg");
    cmd.arg("--json");
    if !opts.regex {
        cmd.arg("-F");
    }
    if opts.case_sensitive {
        cmd.arg("-s");
    } else {
        cmd.arg("-i");
    }
    cmd.arg("--max-filesize").arg("2M");
    cmd.arg("--");
    cmd.arg(query);
    cmd.arg(".");
    cmd.current_dir(root_path);
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::null());

    let mut child = cmd.spawn().map_err(|e| e.to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Failed to open rg stdout".to_string())?;
    let reader = std::io::BufReader::new(stdout);

    let mut hits = Vec::new();
    for line in reader.lines() {
        let line = match line {
            Ok(l) => l,
            Err(_) => break,
        };

        if let Ok(msg) = serde_json::from_str::<RgMessage>(&line) {
            if msg.r#type == "match" {
                if let Some(data) = msg.data {
                    let path_text = match data.path.and_then(|p| p.text) {
                        Some(p) => p,
                        None => continue,
                    };

                    let norm_path = if let Some(stripped) = path_text.strip_prefix("./") {
                        stripped.to_string()
                    } else if let Some(stripped) = path_text.strip_prefix(".\\") {
                        stripped.replace('\\', "/")
                    } else {
                        path_text.replace('\\', "/")
                    };

                    let line_number = data.line_number.unwrap_or(1);
                    let col = data
                        .submatches
                        .as_ref()
                        .and_then(|sm| sm.first())
                        .map(|s| s.start as u32 + 1)
                        .unwrap_or(1);
                    let text = data
                        .lines
                        .and_then(|l| l.text)
                        .map(|t| t.trim().chars().take(200).collect())
                        .unwrap_or_default();

                    hits.push(Hit {
                        path: norm_path,
                        line: line_number,
                        col,
                        text,
                    });

                    if hits.len() >= limit {
                        let _ = child.kill();
                        break;
                    }
                }
            }
        }
    }

    let _ = child.wait();
    Ok(hits)
}

pub fn grep_fallback<P: AsRef<Path>>(
    root: P,
    query: &str,
    opts: &GrepOpts,
    limit: usize,
) -> Result<Vec<Hit>, String> {
    if query.is_empty() || limit == 0 {
        return Ok(Vec::new());
    }

    let pattern_str = if opts.regex {
        if opts.case_sensitive {
            query.to_string()
        } else {
            format!("(?i){}", query)
        }
    } else {
        let escaped = regex::escape(query);
        if opts.case_sensitive {
            escaped
        } else {
            format!("(?i){}", escaped)
        }
    };

    let re = regex::Regex::new(&pattern_str).map_err(|e| format!("Invalid regex: {}", e))?;

    let root_path = root.as_ref();
    let walker = ignore::WalkBuilder::new(root_path)
        .hidden(false)
        .parents(true)
        .require_git(false)
        .build();

    let mut hits = Vec::new();
    let max_size = 2 * 1024 * 1024; // 2 MB

    for entry in walker.flatten() {
        if !entry.file_type().map_or(false, |ft| ft.is_file()) {
            continue;
        }

        let path = entry.path();
        if path.components().any(|c| c.as_os_str() == ".git") {
            continue;
        }

        let metadata = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        if metadata.len() > max_size {
            continue;
        }

        let mut file = match std::fs::File::open(path) {
            Ok(f) => f,
            Err(_) => continue,
        };
        use std::io::Read;
        let mut header = [0u8; 8192];
        let bytes_read = match file.read(&mut header) {
            Ok(n) => n,
            Err(_) => continue,
        };
        if header[..bytes_read].contains(&0) {
            continue;
        }

        let content = match std::fs::read_to_string(path) {
            Ok(s) => s,
            Err(_) => continue,
        };

        let rel_path = path
            .strip_prefix(root_path)
            .unwrap_or(path)
            .components()
            .map(|c| c.as_os_str().to_string_lossy())
            .collect::<Vec<_>>()
            .join("/");

        for (line_idx, line) in content.lines().enumerate() {
            for mat in re.find_iter(line) {
                let line_num = (line_idx + 1) as u32;
                let col = line[..mat.start()].chars().count() as u32 + 1;
                let text: String = line.trim().chars().take(200).collect();

                hits.push(Hit {
                    path: rel_path.clone(),
                    line: line_num,
                    col,
                    text,
                });

                if hits.len() >= limit {
                    return Ok(hits);
                }
            }
        }
    }

    Ok(hits)
}

pub fn grep<P: AsRef<Path>>(
    root: P,
    query: &str,
    opts: GrepOpts,
    limit: usize,
) -> Result<Vec<Hit>, String> {
    if has_rg() {
        if let Ok(hits) = grep_rg(&root, query, &opts, limit) {
            return Ok(hits);
        }
    }
    grep_fallback(root, query, &opts, limit)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn test_ranking() {
        let index = FileIndex {
            root: PathBuf::from("/test"),
            files: vec![
                "lib/domain/model_data.dart".to_string(),
                "lib/main.dart".to_string(),
                "lib/other.dart".to_string(),
            ],
        };

        let matches = index.query("mainda", 10);
        assert!(!matches.is_empty(), "Should find matches for mainda");
        assert_eq!(
            matches[0].path, "lib/main.dart",
            "lib/main.dart should be ranked above lib/domain/model_data.dart"
        );

        let index2 = FileIndex {
            root: PathBuf::from("/test"),
            files: vec![
                "lib/other/user_repo_test.dart".to_string(),
                "lib/presentation/user_page.dart".to_string(),
                "lib/data/user_repository.dart".to_string(),
            ],
        };

        let matches2 = index2.query("usrrep", 10);
        assert!(!matches2.is_empty(), "Should find matches for usrrep");
        assert_eq!(
            matches2[0].path, "lib/data/user_repository.dart",
            "lib/data/user_repository.dart should be nomor 1 for usrrep"
        );

        // Empty query -> []
        let empty_matches = index.query("", 10);
        assert!(empty_matches.is_empty(), "Query kosong -> []");
    }

    #[test]
    fn test_index_respects_gitignore() {
        let dir = tempdir().unwrap();
        let root = dir.path();

        fs::write(root.join(".gitignore"), "*.log\nbuild/\n").unwrap();
        fs::create_dir_all(root.join("src")).unwrap();
        fs::write(root.join("src/main.dart"), "void main() {}").unwrap();
        fs::write(root.join("src/app.log"), "log content").unwrap();

        fs::create_dir_all(root.join("build")).unwrap();
        fs::write(root.join("build/bundle.js"), "console.log()").unwrap();

        fs::create_dir_all(root.join(".git")).unwrap();
        fs::write(root.join(".git/config"), "git config").unwrap();

        let index = FileIndex::build(root);
        assert!(
            index.files.contains(&"src/main.dart".to_string()),
            "src/main.dart should be indexed"
        );
        assert!(
            !index.files.iter().any(|f| f.ends_with(".log")),
            "*.log should be ignored by gitignore"
        );
        assert!(
            !index.files.iter().any(|f| f.starts_with("build/")),
            "build/ should be ignored by gitignore"
        );
        assert!(
            !index.files.iter().any(|f| f.split('/').any(|c| c == ".git")),
            ".git directory should be excluded from index"
        );
    }

    #[test]
    fn test_grep_literal_regex_case() {
        let dir = tempdir().unwrap();
        let root = dir.path();

        fs::write(
            root.join("sample.txt"),
            "Hello World\nfoo.bar\nfooXbar\nFOO.BAR\n",
        )
        .unwrap();

        // 1. Literal + case sensitive: "foo.bar" matches only line 2
        let hits_literal = grep(
            root,
            "foo.bar",
            GrepOpts {
                regex: false,
                case_sensitive: true,
            },
            10,
        )
        .unwrap();
        assert_eq!(hits_literal.len(), 1);
        assert_eq!(hits_literal[0].line, 2);
        assert_eq!(hits_literal[0].text, "foo.bar");

        // 2. Regex + case sensitive: "foo\\.[a-z]+" matches line 2
        let hits_regex = grep(
            root,
            r"foo\.[a-z]+",
            GrepOpts {
                regex: true,
                case_sensitive: true,
            },
            10,
        )
        .unwrap();
        assert_eq!(hits_regex.len(), 1);
        assert_eq!(hits_regex[0].line, 2);

        // 3. Case insensitive: "hello" matches "Hello World"
        let hits_ci = grep(
            root,
            "hello",
            GrepOpts {
                regex: false,
                case_sensitive: false,
            },
            10,
        )
        .unwrap();
        assert_eq!(hits_ci.len(), 1);
        assert_eq!(hits_ci[0].line, 1);

        // 4. Case sensitive: "hello" does not match "Hello World"
        let hits_cs = grep(
            root,
            "hello",
            GrepOpts {
                regex: false,
                case_sensitive: true,
            },
            10,
        )
        .unwrap();
        assert_eq!(hits_cs.len(), 0);
    }

    #[test]
    fn test_skip_binary() {
        let dir = tempdir().unwrap();
        let root = dir.path();

        // Binary file with null byte
        fs::write(root.join("test.bin"), b"target_word \x00 binary data").unwrap();
        fs::write(root.join("test.txt"), "target_word in plain text").unwrap();

        let hits = grep(
            root,
            "target_word",
            GrepOpts {
                regex: false,
                case_sensitive: true,
            },
            10,
        )
        .unwrap();

        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].path, "test.txt");
    }

    #[test]
    fn test_grep_fallback_directly() {
        let dir = tempdir().unwrap();
        let root = dir.path();

        fs::write(root.join("sub.dart"), "void main() {\n  runApp();\n}\n").unwrap();

        let hits = grep_fallback(
            root,
            "runApp",
            &GrepOpts {
                regex: false,
                case_sensitive: true,
            },
            10,
        )
        .unwrap();

        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].path, "sub.dart");
        assert_eq!(hits[0].line, 2);
        assert_eq!(hits[0].col, 3);
        assert_eq!(hits[0].text, "runApp();");
    }

    #[test]
    fn test_line_col_1_based() {
        let dir = tempdir().unwrap();
        let root = dir.path();

        fs::write(root.join("pos.txt"), "line one\n   column four\n").unwrap();

        // Search for line 1 col 1
        let hits_one = grep_fallback(
            root,
            "line",
            &GrepOpts {
                regex: false,
                case_sensitive: true,
            },
            10,
        )
        .unwrap();
        assert_eq!(hits_one.len(), 1);
        assert_eq!(hits_one[0].line, 1);
        assert_eq!(hits_one[0].col, 1);

        // Search for line 2 col 4
        let hits_four = grep_fallback(
            root,
            "column",
            &GrepOpts {
                regex: false,
                case_sensitive: true,
            },
            10,
        )
        .unwrap();
        assert_eq!(hits_four.len(), 1);
        assert_eq!(hits_four[0].line, 2);
        assert_eq!(hits_four[0].col, 4);
    }
}
