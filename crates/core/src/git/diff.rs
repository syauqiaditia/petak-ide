use std::path::Path;
use serde::{Deserialize, Serialize};

use crate::exec::{git, git_raw, Exec, GitError};
use crate::git::model::{CommitFile, DiffFile, DiffLine, DiffLineKind, FileState, Hunk};

pub fn diff_worktree(
    exec: &dyn Exec,
    repo: &Path,
    path: Option<&Path>,
    ignore_ws: bool,
) -> Result<Vec<DiffFile>, GitError> {
    if let Some(p) = path {
        let p_str = p.to_str().unwrap_or("");
        let is_untracked = {
            let check = git(exec, repo, &["ls-files", "--error-unmatch", "--", p_str]);
            check.is_err() && repo.join(p).is_file()
        };

        if is_untracked {
            let mut args = vec!["diff", "--no-color", "--no-ext-diff", "-U3"];
            if ignore_ws {
                args.push("-w");
            }
            args.extend_from_slice(&["--no-index", "/dev/null", p_str]);
            let output = git_raw(exec, repo, &args, None)?;
            if output.status.code() == Some(0) || output.status.code() == Some(1) {
                let stdout = String::from_utf8_lossy(&output.stdout);
                let mut files = parse_diff(&stdout);
                for f in &mut files {
                    f.status = FileState::Untracked;
                    if f.new_path.is_none() {
                        f.new_path = Some(p_str.to_string());
                    }
                }
                return Ok(files);
            } else {
                let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
                return Err(GitError {
                    exit_code: output.status.code(),
                    message: stderr,
                });
            }
        }
    }

    let mut args = vec!["diff", "--no-color", "--no-ext-diff", "-U3"];
    if ignore_ws {
        args.push("-w");
    }
    let p_str;
    if let Some(p) = path {
        p_str = p.to_str().unwrap_or("").to_string();
        args.push("--");
        args.push(&p_str);
    }
    let stdout = git(exec, repo, &args)?;
    Ok(parse_diff(&stdout))
}

pub fn diff_staged(
    exec: &dyn Exec,
    repo: &Path,
    path: Option<&Path>,
    ignore_ws: bool,
) -> Result<Vec<DiffFile>, GitError> {
    let mut args = vec!["diff", "--no-color", "--no-ext-diff", "-U3", "--cached"];
    if ignore_ws {
        args.push("-w");
    }
    let p_str;
    if let Some(p) = path {
        p_str = p.to_str().unwrap_or("").to_string();
        args.push("--");
        args.push(&p_str);
    }
    let stdout = git(exec, repo, &args)?;
    Ok(parse_diff(&stdout))
}

pub fn diff_commit(
    exec: &dyn Exec,
    repo: &Path,
    sha: &str,
    path: Option<&Path>,
    ignore_ws: bool,
) -> Result<Vec<DiffFile>, GitError> {
    let mut args = vec!["show", "--format=", "--no-color", "--no-ext-diff", "-U3"];
    if ignore_ws {
        args.push("-w");
    }
    args.push(sha);
    let p_str;
    if let Some(p) = path {
        p_str = p.to_str().unwrap_or("").to_string();
        args.push("--");
        args.push(&p_str);
    }
    let stdout = git(exec, repo, &args)?;
    Ok(parse_diff(&stdout))
}

pub fn diff_stash(
    exec: &dyn Exec,
    repo: &Path,
    index: usize,
    path: Option<&Path>,
    ignore_ws: bool,
) -> Result<Vec<DiffFile>, GitError> {
    let parent = format!("stash@{{{}}}^1", index);
    let target = format!("stash@{{{}}}", index);
    let mut args = vec!["diff", "--no-color", "--no-ext-diff", "-U3"];
    if ignore_ws {
        args.push("-w");
    }
    args.push(&parent);
    args.push(&target);
    let p_str;
    if let Some(p) = path {
        p_str = p.to_str().unwrap_or("").to_string();
        args.push("--");
        args.push(&p_str);
    }
    let stdout = git(exec, repo, &args)?;
    Ok(parse_diff(&stdout))
}

pub fn commit_files(
    exec: &dyn Exec,
    repo: &Path,
    sha: &str,
) -> Result<Vec<CommitFile>, GitError> {
    let stdout = git(exec, repo, &["show", "--name-status", "--format=", sha])?;
    Ok(parse_name_status(&stdout))
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompareBranchResult {
    pub files: Vec<CompareFileEntry>,
    pub total_added: u32,
    pub total_removed: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompareFileEntry {
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub old_path: Option<String>,
    pub status: String,
    pub added: u32,
    pub removed: u32,
    pub binary: bool,
}

/// Compares two branches using `git diff --name-status -M` and `git diff --numstat -M <base>...<target> [-- <path>]`.
pub fn compare_branch(
    exec: &dyn Exec,
    repo: &Path,
    base: &str,
    target: &str,
    path: Option<&str>,
) -> Result<CompareBranchResult, GitError> {
    crate::git::path::validate_ref_name(base)?;
    crate::git::path::validate_ref_name(target)?;

    let range = format!("{}...{}", base, target);

    let mut name_status_args = vec!["diff", "--name-status", "-M", &range];
    if let Some(p) = path {
        let p_trimmed = p.trim();
        if !p_trimmed.is_empty() && p_trimmed != "." {
            name_status_args.push("--");
            name_status_args.push(p_trimmed);
        }
    }
    let name_status_out = git(exec, repo, &name_status_args)?;

    let mut numstat_args = vec!["diff", "--numstat", "-M", &range];
    if let Some(p) = path {
        let p_trimmed = p.trim();
        if !p_trimmed.is_empty() && p_trimmed != "." {
            numstat_args.push("--");
            numstat_args.push(p_trimmed);
        }
    }
    let numstat_out = git(exec, repo, &numstat_args)?;

    Ok(parse_compare_branch_output(&name_status_out, &numstat_out))
}

pub fn parse_compare_branch_output(name_status_raw: &str, numstat_raw: &str) -> CompareBranchResult {
    struct NumstatEntry {
        added: u32,
        removed: u32,
        binary: bool,
    }
    let mut numstats: Vec<NumstatEntry> = Vec::new();
    for line in numstat_raw.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let parts: Vec<&str> = trimmed.split('\t').collect();
        if parts.len() < 3 {
            continue;
        }
        let (added, removed, binary) = if parts[0] == "-" || parts[1] == "-" {
            (0, 0, true)
        } else {
            (
                parts[0].parse::<u32>().unwrap_or(0),
                parts[1].parse::<u32>().unwrap_or(0),
                false,
            )
        };
        numstats.push(NumstatEntry {
            added,
            removed,
            binary,
        });
    }

    let mut files = Vec::new();
    let mut total_added: u32 = 0;
    let mut total_removed: u32 = 0;

    let mut idx = 0;
    for line in name_status_raw.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let parts: Vec<&str> = trimmed.split('\t').collect();
        if parts.is_empty() {
            continue;
        }

        let raw_status = parts[0];
        let status_char = raw_status.chars().next().unwrap_or('M');
        let status = match status_char {
            'A' => "A".to_string(),
            'D' => "D".to_string(),
            'R' => "R".to_string(),
            'C' => "A".to_string(),
            _ => "M".to_string(),
        };

        let (path, old_path) = if status == "R" && parts.len() >= 3 {
            (parts[2].to_string(), Some(parts[1].to_string()))
        } else if parts.len() >= 2 {
            (parts[1].to_string(), None)
        } else {
            (parts[0].to_string(), None)
        };

        let (added, removed, binary) = if let Some(ns) = numstats.get(idx) {
            (ns.added, ns.removed, ns.binary)
        } else {
            (0, 0, false)
        };

        total_added += added;
        total_removed += removed;

        files.push(CompareFileEntry {
            path,
            old_path,
            status,
            added,
            removed,
            binary,
        });
        idx += 1;
    }

    CompareBranchResult {
        files,
        total_added,
        total_removed,
    }
}

/// Diffs a file between two refs using `git diff <base>...<target> -- <path>`.
pub fn diff_between_refs(
    exec: &dyn Exec,
    repo: &Path,
    base: &str,
    target: &str,
    path: &str,
) -> Result<Vec<DiffFile>, GitError> {
    crate::git::path::validate_ref_name(base)?;
    crate::git::path::validate_ref_name(target)?;

    let range = format!("{}...{}", base, target);
    let mut args = vec!["diff", "--no-color", "--no-ext-diff", "-U3", &range];
    if !path.is_empty() && path != "." {
        args.extend_from_slice(&["--", path]);
    }
    let stdout = git(exec, repo, &args)?;
    Ok(parse_diff(&stdout))
}

pub fn parse_name_status(raw: &str) -> Vec<CommitFile> {
    let mut files = Vec::new();
    for line in raw.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let parts: Vec<&str> = line.split('\t').collect();
        if parts.is_empty() {
            continue;
        }
        let code = parts[0].chars().next().unwrap_or('M');
        let status = match code {
            'A' => FileState::Added,
            'D' => FileState::Deleted,
            'R' => FileState::Renamed,
            'C' => FileState::Copied,
            'T' => FileState::TypeChanged,
            _ => FileState::Modified,
        };
        let path = if parts.len() >= 3 {
            parts[2].to_string()
        } else if parts.len() >= 2 {
            parts[1].to_string()
        } else {
            continue;
        };
        files.push(CommitFile { path, status });
    }
    files
}

pub fn parse_diff(raw: &str) -> Vec<DiffFile> {
    let mut files = Vec::new();
    let mut current_file: Option<DiffFile> = None;
    let mut current_hunk: Option<Hunk> = None;
    let mut curr_old: u32 = 0;
    let mut curr_new: u32 = 0;

    for line in raw.lines() {
        if line.starts_with("diff --git ") {
            if let Some(hunk) = current_hunk.take() {
                if let Some(file) = &mut current_file {
                    file.hunks.push(hunk);
                }
            }
            if let Some(file) = current_file.take() {
                files.push(file);
            }

            let (old_p, new_p) = parse_diff_git_header(line);
            current_file = Some(DiffFile {
                old_path: old_p,
                new_path: new_p,
                status: FileState::Modified,
                binary: false,
                hunks: Vec::new(),
            });
            continue;
        }

        let file = match current_file.as_mut() {
            Some(f) => f,
            None => continue,
        };

        if line.starts_with("new file mode ") {
            file.status = FileState::Added;
            file.old_path = None;
            continue;
        }

        if line.starts_with("deleted file mode ") {
            file.status = FileState::Deleted;
            file.new_path = None;
            continue;
        }

        if let Some(from) = line.strip_prefix("rename from ") {
            file.status = FileState::Renamed;
            file.old_path = Some(clean_diff_path(from));
            continue;
        }

        if let Some(to) = line.strip_prefix("rename to ") {
            file.status = FileState::Renamed;
            file.new_path = Some(clean_diff_path(to));
            continue;
        }

        if let Some(from) = line.strip_prefix("copy from ") {
            file.status = FileState::Copied;
            file.old_path = Some(clean_diff_path(from));
            continue;
        }

        if let Some(to) = line.strip_prefix("copy to ") {
            file.status = FileState::Copied;
            file.new_path = Some(clean_diff_path(to));
            continue;
        }

        if line.starts_with("Binary files ") && line.ends_with(" differ") {
            file.binary = true;
            continue;
        }

        if let Some(path_str) = line.strip_prefix("--- ") {
            let p = clean_diff_path(path_str);
            if p == "/dev/null" {
                file.old_path = None;
                file.status = FileState::Added;
            } else {
                let trimmed = p.strip_prefix("a/").unwrap_or(&p);
                file.old_path = Some(trimmed.to_string());
            }
            continue;
        }

        if let Some(path_str) = line.strip_prefix("+++ ") {
            let p = clean_diff_path(path_str);
            if p == "/dev/null" {
                file.new_path = None;
                file.status = FileState::Deleted;
            } else {
                let trimmed = p.strip_prefix("b/").unwrap_or(&p);
                file.new_path = Some(trimmed.to_string());
            }
            continue;
        }

        if line.starts_with("@@ -") {
            if let Some(hunk) = current_hunk.take() {
                file.hunks.push(hunk);
            }
            if let Some((old_start, old_lines, new_start, new_lines)) =
                parse_hunk_header_counts(line)
            {
                curr_old = old_start;
                curr_new = new_start;
                current_hunk = Some(Hunk {
                    old_start,
                    old_lines,
                    new_start,
                    new_lines,
                    header: line.to_string(),
                    lines: Vec::new(),
                });
            }
            continue;
        }

        if let Some(hunk) = current_hunk.as_mut() {
            if line.starts_with('\\') {
                hunk.lines.push(DiffLine {
                    kind: DiffLineKind::NoNewline,
                    text: line.to_string(),
                    old_no: None,
                    new_no: None,
                });
            } else if let Some(content) = line.strip_prefix('+') {
                hunk.lines.push(DiffLine {
                    kind: DiffLineKind::Add,
                    text: content.to_string(),
                    old_no: None,
                    new_no: Some(curr_new),
                });
                curr_new += 1;
            } else if let Some(content) = line.strip_prefix('-') {
                hunk.lines.push(DiffLine {
                    kind: DiffLineKind::Del,
                    text: content.to_string(),
                    old_no: Some(curr_old),
                    new_no: None,
                });
                curr_old += 1;
            } else if let Some(content) = line.strip_prefix(' ') {
                hunk.lines.push(DiffLine {
                    kind: DiffLineKind::Context,
                    text: content.to_string(),
                    old_no: Some(curr_old),
                    new_no: Some(curr_new),
                });
                curr_old += 1;
                curr_new += 1;
            } else if line.is_empty() {
                hunk.lines.push(DiffLine {
                    kind: DiffLineKind::Context,
                    text: String::new(),
                    old_no: Some(curr_old),
                    new_no: Some(curr_new),
                });
                curr_old += 1;
                curr_new += 1;
            }
        }
    }

    if let Some(hunk) = current_hunk.take() {
        if let Some(file) = &mut current_file {
            file.hunks.push(hunk);
        }
    }
    if let Some(file) = current_file.take() {
        files.push(file);
    }

    files
}

fn clean_diff_path(s: &str) -> String {
    let trimmed = s.trim();
    let p = if let Some(idx) = trimmed.find('\t') {
        &trimmed[..idx]
    } else {
        trimmed
    };
    p.trim_matches('"').to_string()
}

fn parse_diff_git_header(line: &str) -> (Option<String>, Option<String>) {
    let rest = match line.strip_prefix("diff --git ") {
        Some(r) => r.trim(),
        None => return (None, None),
    };

    if rest.starts_with('"') {
        if let Some(first_quote_end) = rest[1..].find('"') {
            let old_str = &rest[1..=first_quote_end];
            let after_first = rest[first_quote_end + 2..].trim();
            if after_first.starts_with('"') && after_first.ends_with('"') {
                let new_str = &after_first[1..after_first.len() - 1];
                let old_p = old_str.strip_prefix("a/").unwrap_or(old_str);
                let new_p = new_str.strip_prefix("b/").unwrap_or(new_str);
                return (Some(old_p.to_string()), Some(new_p.to_string()));
            }
        }
    }

    if let Some(idx) = rest.find(" b/") {
        let old_str = &rest[..idx];
        let new_str = &rest[idx + 3..];
        let old_p = old_str.strip_prefix("a/").unwrap_or(old_str);
        return (Some(old_p.to_string()), Some(new_str.to_string()));
    }

    (None, None)
}

pub(crate) fn parse_hunk_header_counts(line: &str) -> Option<(u32, u32, u32, u32)> {
    let start_idx = line.find("@@ -")?;
    let rest = &line[start_idx + 4..];
    let end_idx = rest.find(" @@")?;
    let range_str = &rest[..end_idx];

    let mut parts = range_str.split_whitespace();
    let old_part = parts.next()?;
    let new_part = parts.next()?.strip_prefix('+')?;

    let (old_start, old_lines) = if let Some(idx) = old_part.find(',') {
        let s = old_part[..idx].parse().ok()?;
        let l = old_part[idx + 1..].parse().ok()?;
        (s, l)
    } else {
        (old_part.parse().ok()?, 1)
    };

    let (new_start, new_lines) = if let Some(idx) = new_part.find(',') {
        let s = new_part[..idx].parse().ok()?;
        let l = new_part[idx + 1..].parse().ok()?;
        (s, l)
    } else {
        (new_part.parse().ok()?, 1)
    };

    Some((old_start, old_lines, new_start, new_lines))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_diff_modified_file_with_hunk_no_count() {
        let diff_str = r#"diff --git a/test.txt b/test.txt
index fa2da6e..6b665d6 100644
--- a/test.txt
+++ b/test.txt
@@ -1 +1 @@
-line 1
+line 1 changed
"#;
        let files = parse_diff(diff_str);
        assert_eq!(files.len(), 1);
        let f = &files[0];
        assert_eq!(f.old_path, Some("test.txt".into()));
        assert_eq!(f.new_path, Some("test.txt".into()));
        assert_eq!(f.status, FileState::Modified);
        assert!(!f.binary);
        assert_eq!(f.hunks.len(), 1);

        let h = &f.hunks[0];
        assert_eq!(h.old_start, 1);
        assert_eq!(h.old_lines, 1);
        assert_eq!(h.new_start, 1);
        assert_eq!(h.new_lines, 1);
        assert_eq!(h.lines.len(), 2);
        assert_eq!(h.lines[0].kind, DiffLineKind::Del);
        assert_eq!(h.lines[0].text, "line 1");
        assert_eq!(h.lines[0].old_no, Some(1));
        assert_eq!(h.lines[0].new_no, None);

        assert_eq!(h.lines[1].kind, DiffLineKind::Add);
        assert_eq!(h.lines[1].text, "line 1 changed");
        assert_eq!(h.lines[1].old_no, None);
        assert_eq!(h.lines[1].new_no, Some(1));
    }

    #[test]
    fn test_parse_diff_new_file() {
        let diff_str = r#"diff --git a/new.txt b/new.txt
new file mode 100644
index 0000000..9c59e24
--- /dev/null
+++ b/new.txt
@@ -0,0 +1,2 @@
+hello
+world
"#;
        let files = parse_diff(diff_str);
        assert_eq!(files.len(), 1);
        let f = &files[0];
        assert_eq!(f.old_path, None);
        assert_eq!(f.new_path, Some("new.txt".into()));
        assert_eq!(f.status, FileState::Added);
        assert_eq!(f.hunks.len(), 1);
        let h = &f.hunks[0];
        assert_eq!(h.old_start, 0);
        assert_eq!(h.old_lines, 0);
        assert_eq!(h.new_start, 1);
        assert_eq!(h.new_lines, 2);
        assert_eq!(h.lines[0].new_no, Some(1));
        assert_eq!(h.lines[1].new_no, Some(2));
    }

    #[test]
    fn test_parse_diff_deleted_file() {
        let diff_str = r#"diff --git a/del.txt b/del.txt
deleted file mode 100644
index 9c59e24..0000000
--- a/del.txt
+++ /dev/null
@@ -1,2 +0,0 @@
-hello
-world
"#;
        let files = parse_diff(diff_str);
        assert_eq!(files.len(), 1);
        let f = &files[0];
        assert_eq!(f.old_path, Some("del.txt".into()));
        assert_eq!(f.new_path, None);
        assert_eq!(f.status, FileState::Deleted);
        assert_eq!(f.hunks.len(), 1);
        let h = &f.hunks[0];
        assert_eq!(h.old_start, 1);
        assert_eq!(h.old_lines, 2);
        assert_eq!(h.new_start, 0);
        assert_eq!(h.new_lines, 0);
        assert_eq!(h.lines[0].old_no, Some(1));
        assert_eq!(h.lines[1].old_no, Some(2));
    }

    #[test]
    fn test_parse_diff_rename() {
        let diff_str = r#"diff --git a/old_name.txt b/new_name 🚀.txt
similarity index 100%
rename from old_name.txt
rename to new_name 🚀.txt
"#;
        let files = parse_diff(diff_str);
        assert_eq!(files.len(), 1);
        let f = &files[0];
        assert_eq!(f.old_path, Some("old_name.txt".into()));
        assert_eq!(f.new_path, Some("new_name 🚀.txt".into()));
        assert_eq!(f.status, FileState::Renamed);
        assert!(f.hunks.is_empty());
    }

    #[test]
    fn test_parse_diff_binary() {
        let diff_str = r#"diff --git a/bin.dat b/bin.dat
index eaf36c1..cf408f3 100644
Binary files a/bin.dat and b/bin.dat differ
"#;
        let files = parse_diff(diff_str);
        assert_eq!(files.len(), 1);
        let f = &files[0];
        assert_eq!(f.old_path, Some("bin.dat".into()));
        assert_eq!(f.new_path, Some("bin.dat".into()));
        assert!(f.binary);
        assert!(f.hunks.is_empty());
    }

    #[test]
    fn test_parse_diff_no_newline_at_eof() {
        let diff_str = r#"diff --git a/nonl.txt b/nonl.txt
index 20cbb4d..cbb96cb 100644
--- a/nonl.txt
+++ b/nonl.txt
@@ -1 +1 @@
-no newline
\ No newline at end of file
+no newline modified
\ No newline at end of file
"#;
        let files = parse_diff(diff_str);
        assert_eq!(files.len(), 1);
        let h = &files[0].hunks[0];
        assert_eq!(h.lines.len(), 4);
        assert_eq!(h.lines[0].kind, DiffLineKind::Del);
        assert_eq!(h.lines[1].kind, DiffLineKind::NoNewline);
        assert_eq!(h.lines[1].old_no, None);
        assert_eq!(h.lines[1].new_no, None);
        assert_eq!(h.lines[2].kind, DiffLineKind::Add);
        assert_eq!(h.lines[3].kind, DiffLineKind::NoNewline);
    }

    #[test]
    fn test_parse_name_status() {
        let raw = "M\tsrc/main.rs\nA\tREADME.md\nD\told.txt\nR100\told_dir/a.txt\tnew_dir/b.txt\n";
        let files = parse_name_status(raw);
        assert_eq!(files.len(), 4);
        assert_eq!(files[0].path, "src/main.rs");
        assert_eq!(files[0].status, FileState::Modified);
        assert_eq!(files[1].path, "README.md");
        assert_eq!(files[1].status, FileState::Added);
        assert_eq!(files[2].path, "old.txt");
        assert_eq!(files[2].status, FileState::Deleted);
        assert_eq!(files[3].path, "new_dir/b.txt");
        assert_eq!(files[3].status, FileState::Renamed);
    }
}
