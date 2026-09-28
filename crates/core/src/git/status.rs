use std::path::Path;

use crate::exec::{git, Exec, GitError};
use crate::git::model::{BranchInfo, FileState, RepoStatus, StatusEntry};

pub fn status(exec: &dyn Exec, repo: &Path) -> Result<RepoStatus, GitError> {
    let args = [
        "status",
        "--porcelain=v2",
        "-z",
        "--branch",
        "--untracked-files=all",
    ];
    let output = git(exec, repo, &args)?;
    Ok(parse_status(&output))
}

pub fn parse_status(raw: &str) -> RepoStatus {
    let parts: Vec<&str> = raw.split('\0').collect();

    let mut branch = BranchInfo {
        head: String::new(),
        upstream: None,
        ahead: 0,
        behind: 0,
        detached: false,
    };
    let mut oid = String::new();
    let mut entries = Vec::new();

    let mut i = 0;
    while i < parts.len() {
        let part = parts[i];
        i += 1;
        if part.is_empty() {
            continue;
        }

        if let Some(header) = part.strip_prefix("# ") {
            if let Some(val) = header.strip_prefix("branch.head ") {
                let val = val.trim();
                if val == "(detached)" {
                    branch.detached = true;
                } else {
                    branch.head = val.to_string();
                }
            } else if let Some(val) = header.strip_prefix("branch.oid ") {
                oid = val.trim().to_string();
            } else if let Some(val) = header.strip_prefix("branch.upstream ") {
                branch.upstream = Some(val.trim().to_string());
            } else if let Some(val) = header.strip_prefix("branch.ab ") {
                for token in val.split_whitespace() {
                    if let Some(s) = token.strip_prefix('+') {
                        branch.ahead = s.parse().unwrap_or(0);
                    } else if let Some(s) = token.strip_prefix('-') {
                        branch.behind = s.parse().unwrap_or(0);
                    }
                }
            }
            continue;
        }

        // Ordinary changed entry: 1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>
        if part.starts_with("1 ") {
            let fields: Vec<&str> = part.splitn(9, ' ').collect();
            if fields.len() == 9 {
                let xy = fields[1];
                let path = fields[8].to_string();
                let mut chars = xy.chars();
                let index_char = chars.next().unwrap_or('.');
                let worktree_char = chars.next().unwrap_or('.');
                entries.push(StatusEntry {
                    path,
                    orig_path: None,
                    index: parse_file_state(index_char),
                    worktree: parse_file_state(worktree_char),
                    conflicted: false,
                });
            }
            continue;
        }

        // Renamed or copied entry: 2 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <X><score> <path>\0<origPath>\0
        if part.starts_with("2 ") {
            let fields: Vec<&str> = part.splitn(10, ' ').collect();
            if fields.len() == 10 {
                let xy = fields[1];
                let path = fields[9].to_string();
                let mut chars = xy.chars();
                let index_char = chars.next().unwrap_or('.');
                let worktree_char = chars.next().unwrap_or('.');
                let orig_path = if i < parts.len() {
                    let orig = parts[i].to_string();
                    i += 1;
                    Some(orig)
                } else {
                    None
                };
                entries.push(StatusEntry {
                    path,
                    orig_path,
                    index: parse_file_state(index_char),
                    worktree: parse_file_state(worktree_char),
                    conflicted: false,
                });
            }
            continue;
        }

        // Unmerged entry: u <XY> <sub> <m1> <m2> <m3> <mW> <h1> <h2> <h3> <path>
        if part.starts_with("u ") {
            let fields: Vec<&str> = part.splitn(11, ' ').collect();
            if fields.len() == 11 {
                let xy = fields[1];
                let path = fields[10].to_string();
                let mut chars = xy.chars();
                let index_char = chars.next().unwrap_or('U');
                let worktree_char = chars.next().unwrap_or('U');
                entries.push(StatusEntry {
                    path,
                    orig_path: None,
                    index: parse_file_state(index_char),
                    worktree: parse_file_state(worktree_char),
                    conflicted: true,
                });
            }
            continue;
        }

        // Untracked item: ? <path>
        if let Some(path) = part.strip_prefix("? ") {
            entries.push(StatusEntry {
                path: path.to_string(),
                orig_path: None,
                index: FileState::Untracked,
                worktree: FileState::Untracked,
                conflicted: false,
            });
            continue;
        }

        // Ignored item: ! <path>
        if let Some(path) = part.strip_prefix("! ") {
            entries.push(StatusEntry {
                path: path.to_string(),
                orig_path: None,
                index: FileState::Ignored,
                worktree: FileState::Ignored,
                conflicted: false,
            });
            continue;
        }
    }

    if branch.detached {
        if !oid.is_empty() && oid != "(initial)" {
            branch.head = oid.chars().take(7).collect();
        } else if branch.head.is_empty() {
            branch.head = "(detached)".to_string();
        }
    } else if branch.head.is_empty() {
        if !oid.is_empty() && oid != "(initial)" {
            branch.head = oid.chars().take(7).collect();
        } else {
            branch.head = "HEAD".to_string();
        }
    }

    RepoStatus { branch, entries }
}

fn parse_file_state(c: char) -> FileState {
    match c {
        '.' => FileState::Unmodified,
        'M' => FileState::Modified,
        'A' => FileState::Added,
        'D' => FileState::Deleted,
        'R' => FileState::Renamed,
        'C' => FileState::Copied,
        'T' => FileState::TypeChanged,
        'U' => FileState::Modified,
        '?' => FileState::Untracked,
        '!' => FileState::Ignored,
        _ => FileState::Modified,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_status_branch_attached_with_tracking() {
        let fixture = concat!(
            "# branch.oid 1234567890abcdef1234567890abcdef12345678\0",
            "# branch.head feat/phase3-git\0",
            "# branch.upstream origin/feat/phase3-git\0",
            "# branch.ab +3 -1\0"
        );
        let res = parse_status(fixture);
        assert_eq!(res.branch.head, "feat/phase3-git");
        assert_eq!(res.branch.upstream, Some("origin/feat/phase3-git".into()));
        assert_eq!(res.branch.ahead, 3);
        assert_eq!(res.branch.behind, 1);
        assert!(!res.branch.detached);
        assert!(res.entries.is_empty());
    }

    #[test]
    fn test_parse_status_branch_detached() {
        let fixture = concat!(
            "# branch.oid b3335a79d64cd1c5bf20f6d708652f4824e4801\0",
            "# branch.head (detached)\0"
        );
        let res = parse_status(fixture);
        assert_eq!(res.branch.head, "b3335a7");
        assert!(res.branch.detached);
        assert_eq!(res.branch.upstream, None);
        assert_eq!(res.branch.ahead, 0);
        assert_eq!(res.branch.behind, 0);
    }

    #[test]
    fn test_parse_status_unborn_head() {
        let fixture = concat!("# branch.oid (initial)\0", "# branch.head main\0");
        let res = parse_status(fixture);
        assert_eq!(res.branch.head, "main");
        assert!(!res.branch.detached);
    }

    #[test]
    fn test_parse_status_entries_all_types() {
        let fixture = concat!(
            "# branch.oid 1234567890\0",
            "# branch.head main\0",
            "1 .M N... 100644 100644 100644 ce01 ce02 file with space.txt\0",
            "1 M. N... 100644 100644 100644 ce01 ce02 staged_only.txt\0",
            "1 A. N... 000000 100644 100644 0000 ce02 added.txt\0",
            "1 .D N... 100644 100644 000000 ce01 0000 deleted.txt\0",
            "2 R. N... 100644 100644 100644 ce01 ce02 R100 renamed 🚀.txt\0orig 🚀.txt\0",
            "u UU N... 100644 100644 100644 100644 ce01 ce02 ce03 conflict.txt\0",
            "? new untracked 🚀.txt\0",
            "! target/build/\0"
        );
        let res = parse_status(fixture);
        assert_eq!(res.entries.len(), 8);

        // 1 .M
        assert_eq!(res.entries[0].path, "file with space.txt");
        assert_eq!(res.entries[0].index, FileState::Unmodified);
        assert_eq!(res.entries[0].worktree, FileState::Modified);
        assert!(!res.entries[0].conflicted);

        // 1 M.
        assert_eq!(res.entries[1].path, "staged_only.txt");
        assert_eq!(res.entries[1].index, FileState::Modified);
        assert_eq!(res.entries[1].worktree, FileState::Unmodified);

        // 1 A.
        assert_eq!(res.entries[2].path, "added.txt");
        assert_eq!(res.entries[2].index, FileState::Added);
        assert_eq!(res.entries[2].worktree, FileState::Unmodified);

        // 1 .D
        assert_eq!(res.entries[3].path, "deleted.txt");
        assert_eq!(res.entries[3].index, FileState::Unmodified);
        assert_eq!(res.entries[3].worktree, FileState::Deleted);

        // 2 R.
        assert_eq!(res.entries[4].path, "renamed 🚀.txt");
        assert_eq!(res.entries[4].orig_path, Some("orig 🚀.txt".to_string()));
        assert_eq!(res.entries[4].index, FileState::Renamed);
        assert_eq!(res.entries[4].worktree, FileState::Unmodified);

        // u UU
        assert_eq!(res.entries[5].path, "conflict.txt");
        assert!(res.entries[5].conflicted);
        assert_eq!(res.entries[5].index, FileState::Modified);
        assert_eq!(res.entries[5].worktree, FileState::Modified);

        // ?
        assert_eq!(res.entries[6].path, "new untracked 🚀.txt");
        assert_eq!(res.entries[6].index, FileState::Untracked);
        assert_eq!(res.entries[6].worktree, FileState::Untracked);

        // !
        assert_eq!(res.entries[7].path, "target/build/");
        assert_eq!(res.entries[7].index, FileState::Ignored);
        assert_eq!(res.entries[7].worktree, FileState::Ignored);
    }
}
