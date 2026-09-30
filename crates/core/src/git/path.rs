use std::collections::HashMap;
use std::fs;
use std::path::Path;
use serde::{Deserialize, Serialize};

use crate::exec::{git, git_with_stdin, Exec, GitError};
use crate::git::diff::{diff_staged, parse_diff};
use crate::git::log::{get_pushed_shas, get_refs_map, parse_log_output};
use crate::git::model::{BlameLine, Commit, DiffFile};

fn validate_ref_name(name: &str) -> Result<(), GitError> {
    if name.is_empty() || name.starts_with('-') {
        return Err(GitError {
            exit_code: None,
            message: format!("invalid git reference: '{}'", name),
        });
    }
    Ok(())
}

/// Diffs a file or directory against a git reference (e.g. branch, tag, commit).
pub fn diff_path_vs_ref(
    exec: &dyn Exec,
    repo: &Path,
    git_ref: &str,
    rel: &str,
) -> Result<Vec<DiffFile>, GitError> {
    validate_ref_name(git_ref)?;
    let mut args = vec!["diff", "--no-color", "--no-ext-diff", "-U3", git_ref];
    if !rel.is_empty() && rel != "." {
        args.extend_from_slice(&["--", rel]);
    }
    let stdout = git(exec, repo, &args)?;
    Ok(parse_diff(&stdout))
}

/// Diffs a file or directory in working tree against HEAD.
pub fn diff_path_head(exec: &dyn Exec, repo: &Path, rel: &str) -> Result<Vec<DiffFile>, GitError> {
    diff_path_vs_ref(exec, repo, "HEAD", rel)
}

/// Diffs staged changes for a file or directory against HEAD.
pub fn diff_path_staged(exec: &dyn Exec, repo: &Path, rel: &str) -> Result<Vec<DiffFile>, GitError> {
    diff_staged(
        exec,
        repo,
        if rel.is_empty() || rel == "." {
            None
        } else {
            Some(Path::new(rel))
        },
        false,
    )
}

/// Returns file content at a specific git ref (`git show <ref>:<rel>`).
/// Returns None if the path does not exist in that ref.
pub fn file_at_ref(exec: &dyn Exec, repo: &Path, git_ref: &str, rel: &str) -> Option<String> {
    if validate_ref_name(git_ref).is_err() {
        return None;
    }
    let norm = rel.replace('\\', "/").trim_start_matches('/').to_string();
    let spec = format!("{}:{}", git_ref, norm);
    git(exec, repo, &["show", &spec]).ok()
}

/// Lists commits that touched a file (using `--follow`) or a directory.
pub fn path_history(
    exec: &dyn Exec,
    repo: &Path,
    rel: &str,
    is_file: bool,
    limit: usize,
    skip: usize,
) -> Result<Vec<Commit>, GitError> {
    let mut args = vec![
        "log",
        "--topo-order",
        "--format=%H%x00%P%x00%an%x00%ae%x00%at%x00%s%x1e",
    ];

    if is_file {
        args.push("--follow");
    }

    let skip_str = skip.to_string();
    let limit_str = limit.to_string();

    if skip > 0 {
        args.push("--skip");
        args.push(&skip_str);
    }
    if limit > 0 {
        args.push("-n");
        args.push(&limit_str);
    }

    if !rel.is_empty() && rel != "." {
        args.push("--");
        args.push(rel);
    }

    let raw_out = match git(exec, repo, &args) {
        Ok(out) => out,
        Err(e) => {
            if e.message.contains("does not have any commits yet")
                || e.message.contains("fatal: your current branch")
                || e.message.contains("unknown revision")
            {
                return Ok(Vec::new());
            }
            return Err(e);
        }
    };

    let raw_commits = parse_log_output(&raw_out);
    let refs_map = get_refs_map(exec, repo).unwrap_or_default();
    let pushed_shas = get_pushed_shas(exec, repo).unwrap_or_default();

    let mut commits = Vec::with_capacity(raw_commits.len());
    for rc in raw_commits {
        let short_sha = rc.sha[..rc.sha.len().min(7)].to_string();
        let refs = refs_map.get(&rc.sha).cloned().unwrap_or_default();
        let pushed = pushed_shas.contains(&rc.sha);
        commits.push(Commit {
            sha: rc.sha,
            short_sha,
            parents: rc.parents,
            author_name: rc.author_name,
            author_email: rc.author_email,
            author_time: rc.author_time,
            subject: rc.subject,
            refs,
            pushed,
        });
    }

    Ok(commits)
}

/// Parses raw `git blame --porcelain` stdout.
pub fn parse_blame_porcelain(raw: &str) -> Vec<BlameLine> {
    struct Meta {
        author: String,
        time_unix: i64,
        summary: String,
    }

    let mut commit_map: HashMap<String, Meta> = HashMap::new();
    let mut lines = Vec::new();
    let mut current_sha = String::new();
    let mut current_line: u32 = 0;

    for raw_line in raw.lines() {
        if raw_line.starts_with('\t') {
            let is_zero = current_sha.chars().all(|c| c == '0');
            let meta = commit_map.get(&current_sha);
            let author = if is_zero {
                "Not committed".to_string()
            } else {
                meta.map(|m| m.author.clone())
                    .unwrap_or_else(|| "Unknown".to_string())
            };
            let summary = if is_zero {
                "Not committed".to_string()
            } else {
                meta.map(|m| m.summary.clone()).unwrap_or_default()
            };
            let time_unix = if is_zero {
                0
            } else {
                meta.map(|m| m.time_unix).unwrap_or(0)
            };

            lines.push(BlameLine {
                line: current_line,
                sha: current_sha.clone(),
                author,
                time_unix,
                summary,
            });
            continue;
        }

        let parts: Vec<&str> = raw_line.split_whitespace().collect();
        if parts.len() >= 3
            && parts[0].len() == 40
            && parts[0].chars().all(|c| c.is_ascii_hexdigit())
        {
            current_sha = parts[0].to_string();
            current_line = parts[2].parse::<u32>().unwrap_or(0);
            continue;
        }

        if let Some(author) = raw_line.strip_prefix("author ") {
            let entry = commit_map.entry(current_sha.clone()).or_insert_with(|| Meta {
                author: String::new(),
                time_unix: 0,
                summary: String::new(),
            });
            entry.author = author.to_string();
        } else if let Some(time_str) = raw_line.strip_prefix("author-time ") {
            let entry = commit_map.entry(current_sha.clone()).or_insert_with(|| Meta {
                author: String::new(),
                time_unix: 0,
                summary: String::new(),
            });
            entry.time_unix = time_str.parse::<i64>().unwrap_or(0);
        } else if let Some(summary) = raw_line.strip_prefix("summary ") {
            let entry = commit_map.entry(current_sha.clone()).or_insert_with(|| Meta {
                author: String::new(),
                time_unix: 0,
                summary: String::new(),
            });
            entry.summary = summary.to_string();
        }
    }

    lines
}

/// Returns blame annotations per line for `rel`.
/// For uncommitted or newly created files, returns lines with zero SHA and "Not committed".
pub fn blame(exec: &dyn Exec, repo: &Path, rel: &str) -> Result<Vec<BlameLine>, GitError> {
    match git(exec, repo, &["blame", "--porcelain", "--", rel]) {
        Ok(out) => Ok(parse_blame_porcelain(&out)),
        Err(e) => {
            let full_path = repo.join(rel);
            if full_path.is_file() {
                let content = fs::read_to_string(&full_path).unwrap_or_default();
                let count = content.lines().count();
                let total = if count == 0 && !content.is_empty() {
                    1
                } else {
                    count
                };
                let mut lines = Vec::with_capacity(total);
                for i in 1..=total {
                    lines.push(BlameLine {
                        line: i as u32,
                        sha: "0000000000000000000000000000000000000000".to_string(),
                        author: "Not committed".to_string(),
                        time_unix: 0,
                        summary: "Not committed".to_string(),
                    });
                }
                Ok(lines)
            } else {
                Err(e)
            }
        }
    }
}

/// Rolls back changes for `rels`:
/// - Tracked files: restored via `git restore --staged --worktree -- <rels>` (fallback checkout HEAD)
/// - Untracked files: moved to system trash via `fsops::trash` (never permanently deleted)
pub fn rollback_paths(exec: &dyn Exec, repo: &Path, rels: &[&str]) -> Result<(), GitError> {
    if rels.is_empty() {
        return Ok(());
    }

    let mut tracked = Vec::new();
    let mut untracked = Vec::new();

    for &rel in rels {
        let ls_out = git(exec, repo, &["ls-files", "--", rel]).unwrap_or_default();
        if !ls_out.trim().is_empty() {
            tracked.push(rel);
        } else {
            untracked.push(rel);
        }
    }

    if !tracked.is_empty() {
        let mut args = vec!["restore", "--staged", "--worktree", "--"];
        args.extend_from_slice(&tracked);
        if git(exec, repo, &args).is_err() {
            let mut fallback_args = vec!["checkout", "HEAD", "--"];
            fallback_args.extend_from_slice(&tracked);
            git(exec, repo, &fallback_args)?;
        }
    }

    if !untracked.is_empty() {
        crate::fsops::trash(repo, &untracked).map_err(|e| GitError {
            exit_code: None,
            message: e.to_string(),
        })?;
    }

    Ok(())
}

/// Appends `/<rel>` (or `/<rel>/` for directories) to root `.gitignore` if not already present.
/// Writes atomically using `fs::save_file`.
pub fn add_to_gitignore(repo: &Path, rel: &str) -> std::io::Result<()> {
    crate::fsops::resolve_in_root(repo, rel)?;

    let full_path = repo.join(rel);
    let is_dir = full_path.is_dir() || rel.ends_with('/');
    let trimmed = rel.trim_matches('/').replace('\\', "/");
    let pattern = if is_dir {
        format!("/{}/", trimmed)
    } else {
        format!("/{}", trimmed)
    };

    let gitignore_path = repo.join(".gitignore");
    let content = if gitignore_path.exists() {
        fs::read_to_string(&gitignore_path)?
    } else {
        String::new()
    };

    if content.lines().any(|l| l.trim() == pattern) {
        return Ok(());
    }

    let new_content = if content.is_empty() {
        format!("{}\n", pattern)
    } else if content.ends_with('\n') {
        format!("{}{}\n", content, pattern)
    } else {
        format!("{}\n{}\n", content, pattern)
    };

    crate::fs::save_file(&gitignore_path, &new_content)
}

/// Stages `rels` and commits only those paths.
/// Supports amend flag, and rolls back the index (unstages paths) if commit fails.
pub fn commit_paths(
    exec: &dyn Exec,
    repo: &Path,
    message: &str,
    rels: &[&str],
    amend: bool,
) -> Result<String, GitError> {
    if rels.is_empty() {
        return crate::git::ops::commit(exec, repo, message, amend);
    }
    crate::git::ops::stage_files(exec, repo, rels)?;
    let mut args = vec!["commit", "-F", "-"];
    if amend {
        args.push("--amend");
    }
    args.push("--");
    args.extend_from_slice(rels);

    match git_with_stdin(exec, repo, &args, Some(message.as_bytes())) {
        Ok(_) => {
            let sha = git(exec, repo, &["rev-parse", "HEAD"])?.trim().to_string();
            Ok(sha)
        }
        Err(err) => {
            // Rollback index: unstage the paths so index is restored
            let _ = crate::git::ops::unstage_files(exec, repo, rels);
            Err(err)
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CommitSelectedResult {
    pub sha: String,
}

/// Commits only selected paths using `git commit -m msg -- <paths>`.
/// Stages the specified paths and commits only those paths.
/// Returns the commit SHA.
pub fn commit_selected(
    exec: &dyn Exec,
    repo: &Path,
    message: &str,
    paths: &[&str],
) -> Result<CommitSelectedResult, GitError> {
    if paths.is_empty() {
        return Err(GitError {
            exit_code: None,
            message: "No paths specified for commit".to_string(),
        });
    }

    // Ensure selected paths are staged
    crate::git::ops::stage_files(exec, repo, paths)?;

    let mut args = vec!["commit", "-F", "-", "--"];
    args.extend_from_slice(paths);
    git_with_stdin(exec, repo, &args, Some(message.as_bytes()))?;

    let sha = git(exec, repo, &["rev-parse", "HEAD"])?.trim().to_string();
    Ok(CommitSelectedResult { sha })
}

/// Delete an untracked file, moving it to trash.
/// Errors if the file is tracked in git or does not exist.
pub fn delete_untracked(
    exec: &dyn Exec,
    repo: &Path,
    rel: &str,
) -> Result<(), GitError> {
    crate::fsops::resolve_in_root(repo, rel).map_err(|e| GitError {
        exit_code: None,
        message: e.to_string(),
    })?;

    let full_path = repo.join(rel);
    if !full_path.exists() {
        return Err(GitError {
            exit_code: None,
            message: format!("File '{}' does not exist", rel),
        });
    }

    // Verify it is not tracked in git
    let ls_out = git(exec, repo, &["ls-files", "--", rel]).unwrap_or_default();
    if !ls_out.trim().is_empty() {
        return Err(GitError {
            exit_code: None,
            message: format!("Cannot delete '{}': file is tracked by git", rel),
        });
    }

    // Trash the untracked file
    crate::fsops::trash(repo, &[rel]).map_err(|e| GitError {
        exit_code: None,
        message: e.to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_blame_porcelain_fixture() {
        let fixture = r#"5b69d0694c49efefbaf8d55b56c1365b7ced1540 1 1 2
author Alice
author-mail <alice@example.com>
author-time 1700000000
author-tz +0000
committer Alice
committer-mail <alice@example.com>
committer-time 1700000000
committer-tz +0000
summary Initial commit
filename test.txt
	First line
5b69d0694c49efefbaf8d55b56c1365b7ced1540 2 2
	Second line
0000000000000000000000000000000000000000 3 3 1
author Not Committed Yet
author-mail <not.committed.yet>
author-time 1700001000
author-tz +0000
committer Not Committed Yet
committer-mail <not.committed.yet>
committer-time 1700001000
committer-tz +0000
summary Uncommitted changes
filename test.txt
	Third line modified
"#;

        let parsed = parse_blame_porcelain(fixture);
        assert_eq!(parsed.len(), 3);

        assert_eq!(parsed[0].line, 1);
        assert_eq!(parsed[0].sha, "5b69d0694c49efefbaf8d55b56c1365b7ced1540");
        assert_eq!(parsed[0].author, "Alice");
        assert_eq!(parsed[0].time_unix, 1700000000);
        assert_eq!(parsed[0].summary, "Initial commit");

        assert_eq!(parsed[1].line, 2);
        assert_eq!(parsed[1].sha, "5b69d0694c49efefbaf8d55b56c1365b7ced1540");
        assert_eq!(parsed[1].author, "Alice");
        assert_eq!(parsed[1].summary, "Initial commit");

        assert_eq!(parsed[2].line, 3);
        assert_eq!(parsed[2].sha, "0000000000000000000000000000000000000000");
        assert_eq!(parsed[2].author, "Not committed");
        assert_eq!(parsed[2].time_unix, 0);
        assert_eq!(parsed[2].summary, "Not committed");
    }
}
