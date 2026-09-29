use std::fs;
use std::path::Path;

use crate::exec::{git, git_raw, git_raw_with_env, git_with_stdin, Exec, GitError};
use crate::git::backup::{backup_create, git_dir};
use crate::git::model::{DiffFile, DiffLineKind, OpResult, ResetMode, StopKind, StopReason};

pub fn stage_files(exec: &dyn Exec, repo: &Path, paths: &[&str]) -> Result<(), GitError> {
    if paths.is_empty() {
        return Ok(());
    }
    let mut args = vec!["add", "--"];
    args.extend_from_slice(paths);
    git(exec, repo, &args)?;
    Ok(())
}

pub fn unstage_files(exec: &dyn Exec, repo: &Path, paths: &[&str]) -> Result<(), GitError> {
    if paths.is_empty() {
        return Ok(());
    }
    let mut args = vec!["restore", "--staged", "--"];
    args.extend_from_slice(paths);
    let res = git(exec, repo, &args);
    if res.is_err() {
        // Fallback for repo without commits (initial commit / unborn branch)
        let mut rm_args = vec!["rm", "--cached", "-r", "--"];
        rm_args.extend_from_slice(paths);
        git(exec, repo, &rm_args)?;
    }
    Ok(())
}

pub fn build_hunk_patch(file_diff: &DiffFile, hunk_idx: usize) -> Result<String, GitError> {
    let hunk = file_diff.hunks.get(hunk_idx).ok_or_else(|| GitError {
        exit_code: None,
        message: format!(
            "hunk index {} out of bounds (total {})",
            hunk_idx,
            file_diff.hunks.len()
        ),
    })?;

    let old_path = file_diff
        .old_path
        .as_deref()
        .unwrap_or_else(|| file_diff.path());
    let new_path = file_diff
        .new_path
        .as_deref()
        .unwrap_or_else(|| file_diff.path());

    let mut patch = String::new();
    patch.push_str(&format!("diff --git a/{old_path} b/{new_path}\n"));
    if file_diff.old_path.is_none() {
        patch.push_str("--- /dev/null\n");
    } else {
        patch.push_str(&format!("--- a/{old_path}\n"));
    }
    if file_diff.new_path.is_none() {
        patch.push_str("+++ /dev/null\n");
    } else {
        patch.push_str(&format!("+++ b/{new_path}\n"));
    }

    patch.push_str(&hunk.header);
    if !hunk.header.ends_with('\n') {
        patch.push('\n');
    }

    for line in &hunk.lines {
        match line.kind {
            DiffLineKind::Context => {
                patch.push(' ');
                patch.push_str(&line.text);
                patch.push('\n');
            }
            DiffLineKind::Add => {
                patch.push('+');
                patch.push_str(&line.text);
                patch.push('\n');
            }
            DiffLineKind::Del => {
                patch.push('-');
                patch.push_str(&line.text);
                patch.push('\n');
            }
            DiffLineKind::NoNewline => {
                patch.push_str(&line.text);
                patch.push('\n');
            }
        }
    }

    Ok(patch)
}

pub fn stage_hunk(
    exec: &dyn Exec,
    repo: &Path,
    file_diff: &DiffFile,
    hunk_idx: usize,
) -> Result<(), GitError> {
    let patch = build_hunk_patch(file_diff, hunk_idx)?;
    git_with_stdin(
        exec,
        repo,
        &["apply", "--cached", "--unidiff-zero"],
        Some(patch.as_bytes()),
    )?;
    Ok(())
}

pub fn unstage_hunk(
    exec: &dyn Exec,
    repo: &Path,
    file_diff: &DiffFile,
    hunk_idx: usize,
) -> Result<(), GitError> {
    let patch = build_hunk_patch(file_diff, hunk_idx)?;
    git_with_stdin(
        exec,
        repo,
        &["apply", "--cached", "--reverse", "--unidiff-zero"],
        Some(patch.as_bytes()),
    )?;
    Ok(())
}

pub fn commit(
    exec: &dyn Exec,
    repo: &Path,
    message: &str,
    amend: bool,
) -> Result<String, GitError> {
    let args = if amend {
        vec!["commit", "--amend", "-F", "-"]
    } else {
        vec!["commit", "-F", "-"]
    };
    git_with_stdin(exec, repo, &args, Some(message.as_bytes()))
}

pub fn last_commit_message(exec: &dyn Exec, repo: &Path) -> Result<Option<String>, GitError> {
    match git(exec, repo, &["log", "-1", "--format=%B"]) {
        Ok(out) => Ok(Some(out.trim_end().to_string())),
        Err(e) => {
            if e.message.contains("does not have any commits yet")
                || e.message.contains("fatal: your current branch")
                || e.message.contains("unknown revision")
                || e.message.contains("bad revision")
            {
                Ok(None)
            } else {
                Err(e)
            }
        }
    }
}

pub fn reset(
    exec: &dyn Exec,
    repo: &Path,
    sha: &str,
    mode: ResetMode,
) -> Result<OpResult, GitError> {
    let backup_ref = if mode == ResetMode::Hard {
        Some(backup_create(exec, repo, "reset")?)
    } else {
        None
    };

    let flag = match mode {
        ResetMode::Soft => "--soft",
        ResetMode::Mixed => "--mixed",
        ResetMode::Hard => "--hard",
    };

    git(exec, repo, &["reset", flag, sha])?;
    let new_head = git(exec, repo, &["rev-parse", "HEAD"])?.trim().to_string();

    Ok(OpResult {
        ok: true,
        backup_ref,
        stopped_at: None,
        new_head,
        stash_conflict: false,
    })
}

pub fn cherry_pick(exec: &dyn Exec, repo: &Path, shas: &[&str]) -> Result<OpResult, GitError> {
    if shas.is_empty() {
        let new_head = git(exec, repo, &["rev-parse", "HEAD"])?.trim().to_string();
        return Ok(OpResult {
            ok: true,
            backup_ref: None,
            stopped_at: None,
            new_head,
            stash_conflict: false,
        });
    }

    let status_out = git(exec, repo, &["status", "--porcelain"])?;
    if !status_out.trim().is_empty() {
        return Err(GitError {
            exit_code: None,
            message: "cannot cherry-pick: working tree has uncommitted changes".to_string(),
        });
    }

    for sha in shas {
        let res = git_raw(exec, repo, &["cherry-pick", sha], None)?;
        if !res.status.success() {
            let status = crate::git::status::status(exec, repo)?;
            let is_conflict = status.entries.iter().any(|e| e.conflicted);
            let stopped_sha = sha.to_string();
            let new_head = git(exec, repo, &["rev-parse", "HEAD"])
                .unwrap_or_default()
                .trim()
                .to_string();

            if is_conflict {
                return Ok(OpResult {
                    ok: false,
                    backup_ref: None,
                    stopped_at: Some(StopReason {
                        kind: StopKind::Conflict,
                        sha: stopped_sha,
                    }),
                    new_head,
                    stash_conflict: false,
                });
            } else {
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
        }
    }

    let new_head = git(exec, repo, &["rev-parse", "HEAD"])?.trim().to_string();
    Ok(OpResult {
        ok: true,
        backup_ref: None,
        stopped_at: None,
        new_head,
        stash_conflict: false,
    })
}

pub fn revert(exec: &dyn Exec, repo: &Path, shas: &[&str]) -> Result<OpResult, GitError> {
    if shas.is_empty() {
        let new_head = git(exec, repo, &["rev-parse", "HEAD"])?.trim().to_string();
        return Ok(OpResult {
            ok: true,
            backup_ref: None,
            stopped_at: None,
            new_head,
            stash_conflict: false,
        });
    }

    let status_out = git(exec, repo, &["status", "--porcelain"])?;
    if !status_out.trim().is_empty() {
        return Err(GitError {
            exit_code: None,
            message: "cannot revert: working tree has uncommitted changes".to_string(),
        });
    }

    for sha in shas {
        let res = git_raw(
            exec,
            repo,
            &["-c", "core.editor=true", "revert", "--no-edit", sha],
            None,
        )?;
        if !res.status.success() {
            let status = crate::git::status::status(exec, repo)?;
            let is_conflict = status.entries.iter().any(|e| e.conflicted);
            let stopped_sha = sha.to_string();
            let new_head = git(exec, repo, &["rev-parse", "HEAD"])
                .unwrap_or_default()
                .trim()
                .to_string();

            if is_conflict {
                return Ok(OpResult {
                    ok: false,
                    backup_ref: None,
                    stopped_at: Some(StopReason {
                        kind: StopKind::Conflict,
                        sha: stopped_sha,
                    }),
                    new_head,
                    stash_conflict: false,
                });
            } else {
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
        }
    }

    let new_head = git(exec, repo, &["rev-parse", "HEAD"])?.trim().to_string();
    Ok(OpResult {
        ok: true,
        backup_ref: None,
        stopped_at: None,
        new_head,
        stash_conflict: false,
    })
}

pub fn merge(exec: &dyn Exec, repo: &Path, branch: &str) -> Result<OpResult, GitError> {
    validate_branch_name(branch)?;
    let backup_ref = Some(backup_create(exec, repo, "merge")?);

    let envs = [("GIT_EDITOR", "true")];
    let res = git_raw_with_env(
        exec,
        repo,
        &["merge", "--autostash", "--no-edit", branch],
        &envs,
        None,
    )?;

    if !res.status.success() {
        let status = crate::git::status::status(exec, repo)?;
        let is_conflict = status.entries.iter().any(|e| e.conflicted);
        let gdir = git_dir(repo);
        let merge_head = gdir.join("MERGE_HEAD");
        if is_conflict || merge_head.is_file() {
            let stopped_sha = fs::read_to_string(&merge_head)
                .unwrap_or_default()
                .trim()
                .to_string();
            let new_head = git(exec, repo, &["rev-parse", "HEAD"])
                .unwrap_or_default()
                .trim()
                .to_string();
            let sha = if stopped_sha.is_empty() {
                git(exec, repo, &["rev-parse", branch]).unwrap_or_else(|_| new_head.clone())
            } else {
                stopped_sha
            };

            return Ok(OpResult {
                ok: false,
                backup_ref,
                stopped_at: Some(StopReason {
                    kind: StopKind::Conflict,
                    sha,
                }),
                new_head,
                stash_conflict: false,
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

    let combined_out = format!(
        "{}\n{}",
        String::from_utf8_lossy(&res.stdout),
        String::from_utf8_lossy(&res.stderr)
    );
    let stash_conflict = combined_out.contains("Applying autostash resulted in conflicts");
    let new_head = git(exec, repo, &["rev-parse", "HEAD"])?.trim().to_string();
    Ok(OpResult {
        ok: true,
        backup_ref,
        stopped_at: None,
        new_head,
        stash_conflict,
    })
}

pub fn rebase_onto(exec: &dyn Exec, repo: &Path, upstream: &str) -> Result<OpResult, GitError> {
    validate_branch_name(upstream)?;
    let backup_ref = Some(backup_create(exec, repo, "rebase")?);

    let envs = [("GIT_EDITOR", "true")];
    let res = git_raw_with_env(
        exec,
        repo,
        &["rebase", "--autostash", upstream],
        &envs,
        None,
    )?;

    let gdir = git_dir(repo);
    let rebase_merge = gdir.join("rebase-merge");
    if rebase_merge.is_dir() {
        let status = crate::git::status::status(exec, repo)?;
        let is_conflict = status.entries.iter().any(|e| e.conflicted);
        let stopped_sha = fs::read_to_string(rebase_merge.join("stopped-sha"))
            .unwrap_or_default()
            .trim()
            .to_string();
        let new_head = git(exec, repo, &["rev-parse", "HEAD"])
            .unwrap_or_default()
            .trim()
            .to_string();

        return Ok(OpResult {
            ok: false,
            backup_ref,
            stopped_at: Some(StopReason {
                kind: if is_conflict {
                    StopKind::Conflict
                } else {
                    StopKind::Edit
                },
                sha: stopped_sha,
            }),
            new_head,
            stash_conflict: false,
        });
    }

    if !res.status.success() {
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

    let combined_out = format!(
        "{}\n{}",
        String::from_utf8_lossy(&res.stdout),
        String::from_utf8_lossy(&res.stderr)
    );
    let stash_conflict = combined_out.contains("Applying autostash resulted in conflicts");
    let new_head = git(exec, repo, &["rev-parse", "HEAD"])?.trim().to_string();
    Ok(OpResult {
        ok: true,
        backup_ref,
        stopped_at: None,
        new_head,
        stash_conflict,
    })
}

fn validate_branch_name(name: &str) -> Result<(), GitError> {
    if name.is_empty() || name.starts_with('-') {
        return Err(GitError {
            exit_code: None,
            message: format!("invalid branch name: '{}'", name),
        });
    }
    Ok(())
}

pub fn branch_create(
    exec: &dyn Exec,
    repo: &Path,
    name: &str,
    at_sha: &str,
    checkout: bool,
) -> Result<(), GitError> {
    validate_branch_name(name)?;
    if checkout {
        git(exec, repo, &["checkout", "-b", name, at_sha])?;
    } else {
        git(exec, repo, &["branch", "--", name, at_sha])?;
    }
    Ok(())
}

pub fn branch_checkout(exec: &dyn Exec, repo: &Path, name: &str) -> Result<(), GitError> {
    validate_branch_name(name)?;
    git(exec, repo, &["checkout", name])?;
    Ok(())
}

pub fn branch_delete(
    exec: &dyn Exec,
    repo: &Path,
    name: &str,
    force: bool,
) -> Result<(), GitError> {
    validate_branch_name(name)?;
    let flag = if force { "-D" } else { "-d" };
    git(exec, repo, &["branch", flag, "--", name])?;
    Ok(())
}

pub fn branch_rename(exec: &dyn Exec, repo: &Path, old: &str, new: &str) -> Result<(), GitError> {
    validate_branch_name(old)?;
    validate_branch_name(new)?;
    git(exec, repo, &["branch", "-m", old, "--", new])?;
    Ok(())
}
