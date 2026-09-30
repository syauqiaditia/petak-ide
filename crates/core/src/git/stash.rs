use std::path::Path;
use serde::{Deserialize, Serialize};

use crate::exec::{git, Exec, GitError};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StashEntry {
    pub index: usize,
    pub message: String,
    pub branch: String,
    pub date: String,
}

/// Push changes to git stash.
pub fn stash_push(
    exec: &dyn Exec,
    repo: &Path,
    message: Option<&str>,
    include_untracked: bool,
) -> Result<String, GitError> {
    let mut args = vec!["stash", "push"];
    if include_untracked {
        args.push("-u");
    }
    if let Some(msg) = message {
        if !msg.trim().is_empty() {
            args.push("-m");
            args.push(msg.trim());
        }
    }
    git(exec, repo, &args)
}

/// List all git stash entries with structured fields.
pub fn stash_list(exec: &dyn Exec, repo: &Path) -> Result<Vec<StashEntry>, GitError> {
    let out = git(exec, repo, &["stash", "list", "--format=%gd\x1f%gs\x1f%ci"])?;
    Ok(parse_stash_list(&out))
}

pub fn parse_stash_list(raw: &str) -> Vec<StashEntry> {
    let mut entries = Vec::new();
    for line in raw.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let parts: Vec<&str> = trimmed.split('\x1f').collect();
        if parts.is_empty() {
            continue;
        }

        // Index from stash@{0}
        let ref_selector = parts[0];
        let index = if let (Some(start), Some(end)) = (ref_selector.find('{'), ref_selector.find('}')) {
            ref_selector[start + 1..end].parse::<usize>().unwrap_or(entries.len())
        } else {
            entries.len()
        };

        // Subject from parts[1]
        let subject = if parts.len() > 1 { parts[1].trim() } else { "" };
        let (branch, message) = parse_stash_subject(subject);

        // Date from parts[2]
        let date = if parts.len() > 2 {
            parts[2].trim().to_string()
        } else {
            String::new()
        };

        entries.push(StashEntry {
            index,
            message,
            branch,
            date,
        });
    }
    entries
}

fn parse_stash_subject(subject: &str) -> (String, String) {
    if let Some(rest) = subject.strip_prefix("WIP on ") {
        if let Some((b, m)) = rest.split_once(": ") {
            return (b.to_string(), m.to_string());
        }
        return (rest.to_string(), String::new());
    } else if let Some(rest) = subject.strip_prefix("On ") {
        if let Some((b, m)) = rest.split_once(": ") {
            return (b.to_string(), m.to_string());
        }
        return (rest.to_string(), String::new());
    }
    (String::new(), subject.to_string())
}

/// Apply a git stash entry by index without dropping it.
pub fn stash_apply(exec: &dyn Exec, repo: &Path, index: usize) -> Result<String, GitError> {
    let selector = format!("stash@{{{}}}", index);
    git(exec, repo, &["stash", "apply", &selector])
}

/// Pop a git stash entry by index (or latest if None).
pub fn stash_pop(exec: &dyn Exec, repo: &Path, index: Option<usize>) -> Result<String, GitError> {
    if let Some(i) = index {
        let selector = format!("stash@{{{}}}", i);
        git(exec, repo, &["stash", "pop", &selector])
    } else {
        git(exec, repo, &["stash", "pop"])
    }
}

/// Drop a git stash entry by index.
pub fn stash_drop(exec: &dyn Exec, repo: &Path, index: usize) -> Result<String, GitError> {
    let selector = format!("stash@{{{}}}", index);
    git(exec, repo, &["stash", "drop", &selector])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_stash_list_formats() {
        let raw = "stash@{0}\x1fWIP on feat/phase4-run: 4ddbde6 Merge wt\x1f2026-09-30 02:10:18 +0000\n\
                   stash@{1}\x1fOn feat/phase4-run: wip-p4-fix\x1f2026-09-29 03:43:27 +0000\n\
                   stash@{2}\x1fcustom message without on\x1f2026-09-28 10:00:00 +0000\n";

        let entries = parse_stash_list(raw);
        assert_eq!(entries.len(), 3);

        assert_eq!(entries[0].index, 0);
        assert_eq!(entries[0].branch, "feat/phase4-run");
        assert_eq!(entries[0].message, "4ddbde6 Merge wt");
        assert_eq!(entries[0].date, "2026-09-30 02:10:18 +0000");

        assert_eq!(entries[1].index, 1);
        assert_eq!(entries[1].branch, "feat/phase4-run");
        assert_eq!(entries[1].message, "wip-p4-fix");

        assert_eq!(entries[2].index, 2);
        assert_eq!(entries[2].branch, "");
        assert_eq!(entries[2].message, "custom message without on");
    }
}
