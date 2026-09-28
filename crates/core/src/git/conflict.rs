use std::collections::BTreeSet;
use std::fs;
use std::path::Path;

use crate::exec::{git, git_raw_with_env, Exec, GitError};
use crate::git::backup::git_dir;
use crate::git::model::{
    Choice, ConflictBlock, ConflictChoice, ConflictFile, ConflictSide, OpResult, RebaseState,
    RebaseStateKind, StopKind, StopReason,
};
use crate::git::rebase::{rebase_abort, rebase_continue, rebase_state};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ParserState {
    Normal,
    InOurs,
    InBase,
    InTheirs,
}

/// Parses conflict blocks from a merged file containing conflict markers.
pub fn parse_conflict_blocks(merged: &str) -> Vec<ConflictBlock> {
    let is_crlf = merged.contains("\r\n");
    let lines: Vec<&str> = if is_crlf {
        merged.split("\r\n").collect()
    } else {
        merged.split('\n').collect()
    };
    let has_trailing = merged.ends_with('\n');
    let valid_lines: &[&str] = if has_trailing && !lines.is_empty() && lines.last() == Some(&"") {
        &lines[..lines.len() - 1]
    } else {
        &lines[..]
    };

    let mut blocks = Vec::new();
    let mut state = ParserState::Normal;
    let mut start_line = 0;
    let mut ours = Vec::new();
    let mut base: Option<Vec<String>> = None;
    let mut theirs = Vec::new();

    for (idx, line) in valid_lines.iter().enumerate() {
        match state {
            ParserState::Normal => {
                if line.starts_with("<<<<<<<") {
                    start_line = idx;
                    ours.clear();
                    base = None;
                    theirs.clear();
                    state = ParserState::InOurs;
                }
            }
            ParserState::InOurs => {
                if line.starts_with("|||||||") {
                    base = Some(Vec::new());
                    state = ParserState::InBase;
                } else if line.starts_with("=======") {
                    state = ParserState::InTheirs;
                } else if line.starts_with("<<<<<<<") {
                    start_line = idx;
                    ours.clear();
                    base = None;
                    theirs.clear();
                } else {
                    ours.push(line.to_string());
                }
            }
            ParserState::InBase => {
                if line.starts_with("=======") {
                    state = ParserState::InTheirs;
                } else if line.starts_with("<<<<<<<") {
                    start_line = idx;
                    ours.clear();
                    base = None;
                    theirs.clear();
                    state = ParserState::InOurs;
                } else if let Some(b) = &mut base {
                    b.push(line.to_string());
                }
            }
            ParserState::InTheirs => {
                if line.starts_with(">>>>>>>") {
                    blocks.push(ConflictBlock {
                        start_line,
                        end_line: idx,
                        ours: ours.clone(),
                        base: base.clone(),
                        theirs: theirs.clone(),
                    });
                    state = ParserState::Normal;
                } else if line.starts_with("<<<<<<<") {
                    start_line = idx;
                    ours.clear();
                    base = None;
                    theirs.clear();
                    state = ParserState::InOurs;
                } else {
                    theirs.push(line.to_string());
                }
            }
        }
    }

    blocks
}

/// Pure resolution of a conflict block by index.
pub fn resolve_block(merged: &str, block_idx: usize, choice: Choice) -> String {
    let blocks = parse_conflict_blocks(merged);
    let Some(block) = blocks.get(block_idx) else {
        return merged.to_string();
    };

    let is_crlf = merged.contains("\r\n");
    let eol = if is_crlf { "\r\n" } else { "\n" };
    let has_trailing_newline = merged.ends_with('\n');

    let lines: Vec<&str> = if is_crlf {
        merged.split("\r\n").collect()
    } else {
        merged.split('\n').collect()
    };

    let valid_lines: &[&str] =
        if has_trailing_newline && !lines.is_empty() && lines.last() == Some(&"") {
            &lines[..lines.len() - 1]
        } else {
            &lines[..]
        };

    let mut replacement = Vec::new();
    match choice {
        ConflictChoice::Ours => {
            replacement.extend(block.ours.iter().map(|s| s.as_str()));
        }
        ConflictChoice::Theirs => {
            replacement.extend(block.theirs.iter().map(|s| s.as_str()));
        }
        ConflictChoice::Both => {
            replacement.extend(block.ours.iter().map(|s| s.as_str()));
            replacement.extend(block.theirs.iter().map(|s| s.as_str()));
        }
        ConflictChoice::BothTheirsFirst => {
            replacement.extend(block.theirs.iter().map(|s| s.as_str()));
            replacement.extend(block.ours.iter().map(|s| s.as_str()));
        }
    }

    let mut out_lines: Vec<&str> = Vec::new();
    if block.start_line <= valid_lines.len() {
        out_lines.extend_from_slice(&valid_lines[..block.start_line]);
    }
    out_lines.extend_from_slice(&replacement);
    if block.end_line + 1 <= valid_lines.len() {
        out_lines.extend_from_slice(&valid_lines[block.end_line + 1..]);
    }

    if out_lines.is_empty() {
        return String::new();
    }

    let mut result = out_lines.join(eol);
    if has_trailing_newline {
        result.push_str(eol);
    }
    result
}

/// Writes resolved conflict content to the file and optionally stages it with `git add`.
pub fn conflict_write(
    exec: &dyn Exec,
    repo: &Path,
    path: &str,
    content: &str,
    mark_resolved: bool,
) -> Result<(), GitError> {
    let file_path = if Path::new(path).is_absolute() {
        Path::new(path).to_path_buf()
    } else {
        repo.join(path)
    };

    if let Some(parent) = file_path.parent() {
        fs::create_dir_all(parent).map_err(|e| GitError {
            exit_code: None,
            message: format!("failed to create directory {}: {}", parent.display(), e),
        })?;
    }

    fs::write(&file_path, content.as_bytes()).map_err(|e| GitError {
        exit_code: None,
        message: format!("failed to write {}: {}", file_path.display(), e),
    })?;

    if mark_resolved {
        git(exec, repo, &["add", "--", path])?;
    }

    Ok(())
}

/// Lists all conflicted files and their three-way versions + parsed conflict blocks.
pub fn conflicts(exec: &dyn Exec, repo: &Path) -> Result<Vec<ConflictFile>, GitError> {
    let mut conflicted_paths = BTreeSet::new();

    if let Ok(st) = crate::git::status::status(exec, repo) {
        for entry in st.entries {
            if entry.conflicted {
                conflicted_paths.insert(entry.path);
            }
        }
    }

    if let Ok(ls_out) = git(exec, repo, &["ls-files", "-u", "-z"]) {
        for entry in ls_out.split('\0') {
            if entry.is_empty() {
                continue;
            }
            if let Some((_, path)) = entry.split_once('\t') {
                if !path.is_empty() {
                    conflicted_paths.insert(path.to_string());
                }
            }
        }
    }

    let mut result = Vec::new();

    for path in conflicted_paths {
        let (ours, deleted_in_ours) = match git(exec, repo, &["show", &format!(":2:{}", path)]) {
            Ok(content) => (content, false),
            Err(_) => (String::new(), true),
        };

        let (theirs, deleted_in_theirs) = match git(exec, repo, &["show", &format!(":3:{}", path)])
        {
            Ok(content) => (content, false),
            Err(_) => (String::new(), true),
        };

        let base = match git(exec, repo, &["show", &format!(":1:{}", path)]) {
            Ok(content) => Some(content),
            Err(_) => None,
        };

        let deleted_in = if deleted_in_ours {
            Some(ConflictSide::Ours)
        } else if deleted_in_theirs {
            Some(ConflictSide::Theirs)
        } else {
            None
        };

        let file_path = repo.join(&path);
        let merged = fs::read_to_string(&file_path).unwrap_or_default();
        let blocks = parse_conflict_blocks(&merged);

        result.push(ConflictFile {
            path,
            ours,
            theirs,
            base,
            merged,
            blocks,
            deleted_in,
        });
    }

    Ok(result)
}

/// Returns the current operation state (merge, rebase, cherry-pick, revert, or none).
pub fn op_state(exec: &dyn Exec, repo: &Path) -> Result<RebaseState, GitError> {
    rebase_state(exec, repo)
}

/// Continues the current in-progress operation (rebase, merge, cherry-pick, or revert).
pub fn op_continue(exec: &dyn Exec, repo: &Path) -> Result<OpResult, GitError> {
    let state = op_state(exec, repo)?;
    match state.kind {
        RebaseStateKind::Rebase => rebase_continue(exec, repo),
        RebaseStateKind::Merge => {
            let envs = [("GIT_EDITOR", "true")];
            let res = git_raw_with_env(exec, repo, &["commit", "--no-edit"], &envs, None)?;
            if !res.status.success() {
                let status = crate::git::status::status(exec, repo)?;
                let is_conflict = status.entries.iter().any(|e| e.conflicted);
                if is_conflict {
                    let head = git(exec, repo, &["rev-parse", "HEAD"])
                        .unwrap_or_default()
                        .trim()
                        .to_string();
                    return Ok(OpResult {
                        ok: false,
                        backup_ref: None,
                        stopped_at: Some(StopReason {
                            kind: StopKind::Conflict,
                            sha: head.clone(),
                        }),
                        new_head: head,
                    });
                }
                let stderr = String::from_utf8_lossy(&res.stderr).trim().to_string();
                return Err(GitError {
                    exit_code: res.status.code(),
                    message: if stderr.is_empty() {
                        String::from_utf8_lossy(&res.stdout).trim().to_string()
                    } else {
                        stderr
                    },
                });
            }
            let new_head = git(exec, repo, &["rev-parse", "HEAD"])?.trim().to_string();
            Ok(OpResult {
                ok: true,
                backup_ref: None,
                stopped_at: None,
                new_head,
            })
        }
        RebaseStateKind::CherryPick => {
            let envs = [("GIT_EDITOR", "true")];
            let res = git_raw_with_env(
                exec,
                repo,
                &["-c", "core.editor=true", "cherry-pick", "--continue"],
                &envs,
                None,
            )?;
            if !res.status.success() {
                let status = crate::git::status::status(exec, repo)?;
                let is_conflict = status.entries.iter().any(|e| e.conflicted);
                let gdir = git_dir(repo);
                let cp_head = gdir.join("CHERRY_PICK_HEAD");
                if is_conflict || cp_head.is_file() {
                    let cp_sha = fs::read_to_string(&cp_head)
                        .unwrap_or_default()
                        .trim()
                        .to_string();
                    let head = git(exec, repo, &["rev-parse", "HEAD"])
                        .unwrap_or_default()
                        .trim()
                        .to_string();
                    let sha = if cp_sha.is_empty() {
                        head.clone()
                    } else {
                        cp_sha
                    };
                    return Ok(OpResult {
                        ok: false,
                        backup_ref: None,
                        stopped_at: Some(StopReason {
                            kind: StopKind::Conflict,
                            sha,
                        }),
                        new_head: head,
                    });
                }
                let stderr = String::from_utf8_lossy(&res.stderr).trim().to_string();
                return Err(GitError {
                    exit_code: res.status.code(),
                    message: if stderr.is_empty() {
                        String::from_utf8_lossy(&res.stdout).trim().to_string()
                    } else {
                        stderr
                    },
                });
            }
            let new_head = git(exec, repo, &["rev-parse", "HEAD"])?.trim().to_string();
            Ok(OpResult {
                ok: true,
                backup_ref: None,
                stopped_at: None,
                new_head,
            })
        }
        RebaseStateKind::Revert => {
            let envs = [("GIT_EDITOR", "true")];
            let res = git_raw_with_env(
                exec,
                repo,
                &["-c", "core.editor=true", "revert", "--continue"],
                &envs,
                None,
            )?;
            if !res.status.success() {
                let status = crate::git::status::status(exec, repo)?;
                let is_conflict = status.entries.iter().any(|e| e.conflicted);
                let gdir = git_dir(repo);
                let rev_head = gdir.join("REVERT_HEAD");
                if is_conflict || rev_head.is_file() {
                    let rev_sha = fs::read_to_string(&rev_head)
                        .unwrap_or_default()
                        .trim()
                        .to_string();
                    let head = git(exec, repo, &["rev-parse", "HEAD"])
                        .unwrap_or_default()
                        .trim()
                        .to_string();
                    let sha = if rev_sha.is_empty() {
                        head.clone()
                    } else {
                        rev_sha
                    };
                    return Ok(OpResult {
                        ok: false,
                        backup_ref: None,
                        stopped_at: Some(StopReason {
                            kind: StopKind::Conflict,
                            sha,
                        }),
                        new_head: head,
                    });
                }
                let stderr = String::from_utf8_lossy(&res.stderr).trim().to_string();
                return Err(GitError {
                    exit_code: res.status.code(),
                    message: if stderr.is_empty() {
                        String::from_utf8_lossy(&res.stdout).trim().to_string()
                    } else {
                        stderr
                    },
                });
            }
            let new_head = git(exec, repo, &["rev-parse", "HEAD"])?.trim().to_string();
            Ok(OpResult {
                ok: true,
                backup_ref: None,
                stopped_at: None,
                new_head,
            })
        }
        RebaseStateKind::None => Err(GitError {
            exit_code: None,
            message: "no operation in progress to continue".to_string(),
        }),
    }
}

/// Aborts the current in-progress operation (rebase, merge, cherry-pick, or revert).
pub fn op_abort(exec: &dyn Exec, repo: &Path) -> Result<(), GitError> {
    let state = op_state(exec, repo)?;
    match state.kind {
        RebaseStateKind::Rebase => rebase_abort(exec, repo),
        RebaseStateKind::Merge => {
            git(exec, repo, &["merge", "--abort"])?;
            Ok(())
        }
        RebaseStateKind::CherryPick => {
            git(exec, repo, &["cherry-pick", "--abort"])?;
            Ok(())
        }
        RebaseStateKind::Revert => {
            git(exec, repo, &["revert", "--abort"])?;
            Ok(())
        }
        RebaseStateKind::None => Err(GitError {
            exit_code: None,
            message: "no operation in progress to abort".to_string(),
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_single_block() {
        let content = "prefix line\n<<<<<<< HEAD\nours line 1\nours line 2\n=======\ntheirs line 1\n>>>>>>> feature\nsuffix line\n";
        let blocks = parse_conflict_blocks(content);
        assert_eq!(blocks.len(), 1);
        let b = &blocks[0];
        assert_eq!(b.start_line, 1);
        assert_eq!(b.end_line, 6);
        assert_eq!(b.ours, vec!["ours line 1", "ours line 2"]);
        assert_eq!(b.base, None);
        assert_eq!(b.theirs, vec!["theirs line 1"]);
    }

    #[test]
    fn test_parse_multiple_blocks() {
        let content = "<<<<<<< HEAD\no1\n=======\nt1\n>>>>>>> a\nmiddle\n<<<<<<< HEAD\no2\n=======\nt2\n>>>>>>> b\n";
        let blocks = parse_conflict_blocks(content);
        assert_eq!(blocks.len(), 2);
        assert_eq!(blocks[0].start_line, 0);
        assert_eq!(blocks[0].end_line, 4);
        assert_eq!(blocks[0].ours, vec!["o1"]);
        assert_eq!(blocks[0].theirs, vec!["t1"]);

        assert_eq!(blocks[1].start_line, 6);
        assert_eq!(blocks[1].end_line, 10);
        assert_eq!(blocks[1].ours, vec!["o2"]);
        assert_eq!(blocks[1].theirs, vec!["t2"]);
    }

    #[test]
    fn test_parse_diff3_base() {
        let content = "<<<<<<< HEAD\nours line\n||||||| merged common ancestors\nbase line 1\nbase line 2\n=======\ntheirs line\n>>>>>>> feat\n";
        let blocks = parse_conflict_blocks(content);
        assert_eq!(blocks.len(), 1);
        let b = &blocks[0];
        assert_eq!(b.start_line, 0);
        assert_eq!(b.end_line, 7);
        assert_eq!(b.ours, vec!["ours line"]);
        assert_eq!(
            b.base,
            Some(vec!["base line 1".to_string(), "base line 2".to_string()])
        );
        assert_eq!(b.theirs, vec!["theirs line"]);
    }

    #[test]
    fn test_parse_and_resolve_crlf() {
        let content = "line 1\r\n<<<<<<< HEAD\r\nours text\r\n=======\r\ntheirs text\r\n>>>>>>> feat\r\nline 2\r\n";
        let blocks = parse_conflict_blocks(content);
        assert_eq!(blocks.len(), 1);
        assert_eq!(blocks[0].ours, vec!["ours text"]);
        assert_eq!(blocks[0].theirs, vec!["theirs text"]);

        let resolved_ours = resolve_block(content, 0, ConflictChoice::Ours);
        assert_eq!(resolved_ours, "line 1\r\nours text\r\nline 2\r\n");

        let resolved_theirs = resolve_block(content, 0, ConflictChoice::Theirs);
        assert_eq!(resolved_theirs, "line 1\r\ntheirs text\r\nline 2\r\n");
    }

    #[test]
    fn test_parse_and_resolve_no_trailing_newline() {
        let content = "line 1\n<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> feat";
        let blocks = parse_conflict_blocks(content);
        assert_eq!(blocks.len(), 1);
        assert_eq!(blocks[0].ours, vec!["ours"]);
        assert_eq!(blocks[0].theirs, vec!["theirs"]);

        let res = resolve_block(content, 0, ConflictChoice::Ours);
        assert_eq!(res, "line 1\nours");
        assert!(!res.ends_with('\n'));
    }

    #[test]
    fn test_custom_marker_length() {
        let content = "<<<<<<<<<<< HEAD\nours line\n||||||||||| base\nbase\n===========\ntheirs line\n>>>>>>>>>>> feat\n";
        let blocks = parse_conflict_blocks(content);
        assert_eq!(blocks.len(), 1);
        assert_eq!(blocks[0].ours, vec!["ours line"]);
        assert_eq!(blocks[0].base, Some(vec!["base".to_string()]));
        assert_eq!(blocks[0].theirs, vec!["theirs line"]);
    }

    #[test]
    fn test_resolve_choices() {
        let content = "header\n<<<<<<< HEAD\nO1\nO2\n=======\nT1\nT2\n>>>>>>> branch\nfooter\n";

        let ours = resolve_block(content, 0, ConflictChoice::Ours);
        assert_eq!(ours, "header\nO1\nO2\nfooter\n");

        let theirs = resolve_block(content, 0, ConflictChoice::Theirs);
        assert_eq!(theirs, "header\nT1\nT2\nfooter\n");

        let both = resolve_block(content, 0, ConflictChoice::Both);
        assert_eq!(both, "header\nO1\nO2\nT1\nT2\nfooter\n");

        let both_rev = resolve_block(content, 0, ConflictChoice::BothTheirsFirst);
        assert_eq!(both_rev, "header\nT1\nT2\nO1\nO2\nfooter\n");
    }

    #[test]
    fn test_resolve_out_of_bounds_returns_original() {
        let content = "no markers here\n";
        let res = resolve_block(content, 0, ConflictChoice::Ours);
        assert_eq!(res, content);
    }
}
