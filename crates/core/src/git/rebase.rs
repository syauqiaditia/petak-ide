use std::fs;
use std::path::Path;

use crate::exec::{git, git_raw_with_env, Exec, GitError};
use crate::git::backup::{backup_create, git_dir};
use crate::git::model::{
    OpResult, RebaseAction, RebaseItem, RebasePlan, RebaseState, RebaseStateKind, StopKind,
    StopReason,
};

pub fn rebase_todo(exec: &dyn Exec, repo: &Path, base: &str) -> Result<Vec<RebaseItem>, GitError> {
    let out = if base == "--root" {
        git(
            exec,
            repo,
            &["log", "--reverse", "--format=%H%x00%s", "HEAD"],
        )?
    } else {
        let rev_range = format!("{}..HEAD", base);
        git(
            exec,
            repo,
            &["log", "--reverse", "--format=%H%x00%s", &rev_range],
        )?
    };

    let mut items = Vec::new();
    for line in out.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let parts: Vec<&str> = line.split('\0').collect();
        if parts.is_empty() {
            continue;
        }
        let sha = parts[0].to_string();
        let message = if parts.len() > 1 {
            Some(parts[1].to_string())
        } else {
            None
        };
        items.push(RebaseItem {
            sha,
            action: RebaseAction::Pick,
            message,
        });
    }

    Ok(items)
}

pub fn rebase_run(exec: &dyn Exec, repo: &Path, plan: &RebasePlan) -> Result<OpResult, GitError> {
    rebase_run_with_op(exec, repo, plan, "rebase")
}

pub fn rebase_run_with_op(
    exec: &dyn Exec,
    repo: &Path,
    plan: &RebasePlan,
    op_name: &str,
) -> Result<OpResult, GitError> {
    let status_out = git(exec, repo, &["status", "--porcelain"])?;
    if !status_out.trim().is_empty() {
        return Err(GitError {
            exit_code: None,
            message: "cannot rebase: working tree has uncommitted changes".to_string(),
        });
    }

    let backup_ref = if plan.backup {
        Some(backup_create(exec, repo, op_name)?)
    } else {
        None
    };

    if plan.items.is_empty() {
        let new_head = git(exec, repo, &["rev-parse", "HEAD"])?.trim().to_string();
        return Ok(OpResult {
            ok: true,
            backup_ref,
            stopped_at: None,
            new_head,
        });
    }

    let gdir = git_dir(repo);
    let petak_rebase = gdir.join("petak-rebase");
    let _ = fs::remove_dir_all(&petak_rebase);
    fs::create_dir_all(&petak_rebase).map_err(|e| GitError {
        exit_code: None,
        message: format!("failed to create rebase work dir: {}", e),
    })?;

    let mut todo_content = String::new();
    for (idx, item) in plan.items.iter().enumerate() {
        match item.action {
            RebaseAction::Pick => {
                todo_content.push_str(&format!("pick {}\n", item.sha));
            }
            RebaseAction::Reword => {
                todo_content.push_str(&format!("pick {}\n", item.sha));
                if let Some(msg) = &item.message {
                    let msg_path = petak_rebase.join(format!("msg_{}.txt", idx));
                    fs::write(&msg_path, msg).map_err(|e| GitError {
                        exit_code: None,
                        message: format!("failed to write reword message file: {}", e),
                    })?;
                    let msg_esc = msg_path.display().to_string().replace('\'', "'\\''");
                    todo_content.push_str(&format!("exec git commit --amend -F '{}'\n", msg_esc));
                }
            }
            RebaseAction::Edit => {
                todo_content.push_str(&format!("edit {}\n", item.sha));
            }
            RebaseAction::Squash => {
                if let Some(msg) = &item.message {
                    todo_content.push_str(&format!("fixup {}\n", item.sha));
                    let msg_path = petak_rebase.join(format!("msg_{}.txt", idx));
                    fs::write(&msg_path, msg).map_err(|e| GitError {
                        exit_code: None,
                        message: format!("failed to write squash message file: {}", e),
                    })?;
                    let msg_esc = msg_path.display().to_string().replace('\'', "'\\''");
                    todo_content.push_str(&format!("exec git commit --amend -F '{}'\n", msg_esc));
                } else {
                    todo_content.push_str(&format!("squash {}\n", item.sha));
                }
            }
            RebaseAction::Fixup => {
                todo_content.push_str(&format!("fixup {}\n", item.sha));
                if let Some(msg) = &item.message {
                    let msg_path = petak_rebase.join(format!("msg_{}.txt", idx));
                    fs::write(&msg_path, msg).map_err(|e| GitError {
                        exit_code: None,
                        message: format!("failed to write fixup message file: {}", e),
                    })?;
                    let msg_esc = msg_path.display().to_string().replace('\'', "'\\''");
                    todo_content.push_str(&format!("exec git commit --amend -F '{}'\n", msg_esc));
                }
            }
            RebaseAction::Drop => {
                todo_content.push_str(&format!("drop {}\n", item.sha));
            }
        }
    }

    let todo_file = petak_rebase.join("todo.txt");
    fs::write(&todo_file, &todo_content).map_err(|e| GitError {
        exit_code: None,
        message: format!("failed to write rebase todo file: {}", e),
    })?;

    let seq_editor = format!(
        "cp '{}'",
        todo_file.display().to_string().replace('\'', "'\\''")
    );

    let mut args = vec![
        "-c",
        "rebase.autoSquash=false",
        "-c",
        "rebase.autoStash=false",
        "rebase",
        "-i",
    ];
    if plan.base == "--root" {
        args.push("--root");
    } else {
        args.push(&plan.base);
    }

    let envs = [
        ("GIT_SEQUENCE_EDITOR", seq_editor.as_str()),
        ("GIT_EDITOR", "true"),
    ];

    let res = git_raw_with_env(exec, repo, &args, &envs, None)?;

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
        });
    }

    if !res.status.success() {
        let _ = fs::remove_dir_all(&petak_rebase);
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

    let _ = fs::remove_dir_all(&petak_rebase);
    let new_head = git(exec, repo, &["rev-parse", "HEAD"])?.trim().to_string();
    Ok(OpResult {
        ok: true,
        backup_ref,
        stopped_at: None,
        new_head,
    })
}

pub fn rebase_continue(exec: &dyn Exec, repo: &Path) -> Result<OpResult, GitError> {
    let gdir = git_dir(repo);
    let envs = [("GIT_EDITOR", "true")];
    let res = git_raw_with_env(exec, repo, &["rebase", "--continue"], &envs, None)?;

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
            backup_ref: None,
            stopped_at: Some(StopReason {
                kind: if is_conflict {
                    StopKind::Conflict
                } else {
                    StopKind::Edit
                },
                sha: stopped_sha,
            }),
            new_head,
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

    let _ = fs::remove_dir_all(gdir.join("petak-rebase"));
    let new_head = git(exec, repo, &["rev-parse", "HEAD"])?.trim().to_string();
    Ok(OpResult {
        ok: true,
        backup_ref: None,
        stopped_at: None,
        new_head,
    })
}

pub fn rebase_abort(exec: &dyn Exec, repo: &Path) -> Result<(), GitError> {
    let gdir = git_dir(repo);
    let _ = fs::remove_dir_all(gdir.join("petak-rebase"));
    git(exec, repo, &["rebase", "--abort"])?;
    Ok(())
}

pub fn rebase_state(exec: &dyn Exec, repo: &Path) -> Result<RebaseState, GitError> {
    let _ = exec;
    let gdir = git_dir(repo);

    let rebase_merge = gdir.join("rebase-merge");
    let rebase_apply = gdir.join("rebase-apply");

    if rebase_merge.is_dir() {
        let head_name = fs::read_to_string(rebase_merge.join("head-name"))
            .ok()
            .map(|s| {
                s.trim()
                    .strip_prefix("refs/heads/")
                    .unwrap_or(s.trim())
                    .to_string()
            });
        let onto_name = fs::read_to_string(rebase_merge.join("onto"))
            .ok()
            .map(|s| s.trim().to_string());
        let current_commit = fs::read_to_string(rebase_merge.join("stopped-sha"))
            .ok()
            .map(|s| s.trim().to_string());

        let msgnum: Option<u32> = fs::read_to_string(rebase_merge.join("msgnum"))
            .ok()
            .and_then(|s| s.trim().parse().ok());
        let end: Option<u32> = fs::read_to_string(rebase_merge.join("end"))
            .ok()
            .and_then(|s| s.trim().parse().ok());

        let step = match (msgnum, end) {
            (Some(m), Some(e)) => Some((m, e)),
            _ => None,
        };

        return Ok(RebaseState {
            kind: RebaseStateKind::Rebase,
            step,
            head_name,
            onto_name,
            current_commit,
        });
    }

    if rebase_apply.is_dir() {
        let current_commit = fs::read_to_string(rebase_apply.join("original-commit"))
            .ok()
            .map(|s| s.trim().to_string());
        let next: Option<u32> = fs::read_to_string(rebase_apply.join("next"))
            .ok()
            .and_then(|s| s.trim().parse().ok());
        let last: Option<u32> = fs::read_to_string(rebase_apply.join("last"))
            .ok()
            .and_then(|s| s.trim().parse().ok());
        let step = match (next, last) {
            (Some(n), Some(l)) => Some((n, l)),
            _ => None,
        };
        return Ok(RebaseState {
            kind: RebaseStateKind::Rebase,
            step,
            head_name: crate::git::branch(repo),
            onto_name: None,
            current_commit,
        });
    }

    let merge_head = gdir.join("MERGE_HEAD");
    if merge_head.is_file() {
        let commit = fs::read_to_string(&merge_head)
            .ok()
            .map(|s| s.trim().to_string());
        let merge_msg = fs::read_to_string(gdir.join("MERGE_MSG")).unwrap_or_default();
        let onto = if let Some(rest) = merge_msg.strip_prefix("Merge branch '") {
            rest.split('\'').next().map(|s| s.to_string())
        } else if let Some(rest) = merge_msg.strip_prefix("Merge commit '") {
            rest.split('\'').next().map(|s| s.to_string())
        } else {
            None
        };
        let onto_name = onto.or_else(|| commit.clone());

        return Ok(RebaseState {
            kind: RebaseStateKind::Merge,
            step: None,
            head_name: crate::git::branch(repo),
            onto_name,
            current_commit: commit,
        });
    }

    let cp_head = gdir.join("CHERRY_PICK_HEAD");
    if cp_head.is_file() {
        let commit = fs::read_to_string(&cp_head)
            .ok()
            .map(|s| s.trim().to_string());
        return Ok(RebaseState {
            kind: RebaseStateKind::CherryPick,
            step: None,
            head_name: crate::git::branch(repo),
            onto_name: commit.clone(),
            current_commit: commit,
        });
    }

    let revert_head = gdir.join("REVERT_HEAD");
    if revert_head.is_file() {
        let commit = fs::read_to_string(&revert_head)
            .ok()
            .map(|s| s.trim().to_string());
        return Ok(RebaseState {
            kind: RebaseStateKind::Revert,
            step: None,
            head_name: crate::git::branch(repo),
            onto_name: commit.clone(),
            current_commit: commit,
        });
    }

    Ok(RebaseState {
        kind: RebaseStateKind::None,
        step: None,
        head_name: None,
        onto_name: None,
        current_commit: None,
    })
}

pub fn reword(
    exec: &dyn Exec,
    repo: &Path,
    sha: &str,
    message: &str,
) -> Result<OpResult, GitError> {
    let full_sha = git(exec, repo, &["rev-parse", sha])?.trim().to_string();
    let parent = git(exec, repo, &["rev-parse", &format!("{}^@", full_sha)])?;
    let has_parent = !parent.trim().is_empty();
    let base = if has_parent {
        format!("{}^", full_sha)
    } else {
        "--root".to_string()
    };

    let mut items = rebase_todo(exec, repo, &base)?;
    for item in &mut items {
        if item.sha == full_sha {
            item.action = RebaseAction::Reword;
            item.message = Some(message.to_string());
        } else {
            item.action = RebaseAction::Pick;
            item.message = None;
        }
    }

    let plan = RebasePlan {
        base,
        items,
        backup: true,
    };
    rebase_run_with_op(exec, repo, &plan, "reword")
}

pub fn squash(
    exec: &dyn Exec,
    repo: &Path,
    shas: &[&str],
    message: &str,
) -> Result<OpResult, GitError> {
    if shas.len() < 2 {
        return Err(GitError {
            exit_code: None,
            message: "cannot squash fewer than 2 commits".to_string(),
        });
    }

    let mut resolved_shas = Vec::new();
    for s in shas {
        let full = git(exec, repo, &["rev-parse", s])?.trim().to_string();
        resolved_shas.push(full);
    }

    let log_shas_raw = git(exec, repo, &["log", "--reverse", "--format=%H", "HEAD"])?;
    let all_shas: Vec<&str> = log_shas_raw
        .lines()
        .map(|l| l.trim())
        .filter(|l| !l.is_empty())
        .collect();

    let mut ordered = Vec::new();
    for s in &all_shas {
        if resolved_shas.contains(&s.to_string()) {
            ordered.push(s.to_string());
        }
    }

    if ordered.len() != resolved_shas.len() {
        return Err(GitError {
            exit_code: None,
            message: "some commits to squash were not found in current history".to_string(),
        });
    }

    let oldest_sha = &ordered[0];
    let parent = git(exec, repo, &["rev-parse", &format!("{}^@", oldest_sha)])?;
    let has_parent = !parent.trim().is_empty();
    let base = if has_parent {
        format!("{}^", oldest_sha)
    } else {
        "--root".to_string()
    };

    let mut items = rebase_todo(exec, repo, &base)?;
    let last_squash_sha = ordered.last().unwrap().clone();

    for item in &mut items {
        if item.sha == *oldest_sha {
            item.action = RebaseAction::Pick;
            item.message = None;
        } else if ordered.contains(&item.sha) {
            item.action = RebaseAction::Squash;
            if item.sha == last_squash_sha {
                item.message = Some(message.to_string());
            } else {
                item.message = None;
            }
        } else {
            item.action = RebaseAction::Pick;
            item.message = None;
        }
    }

    let plan = RebasePlan {
        base,
        items,
        backup: true,
    };
    rebase_run_with_op(exec, repo, &plan, "squash")
}

pub fn fixup_into_previous(exec: &dyn Exec, repo: &Path, sha: &str) -> Result<OpResult, GitError> {
    let full_sha = git(exec, repo, &["rev-parse", sha])?.trim().to_string();
    let parent_out = git(exec, repo, &["rev-parse", &format!("{}^@", full_sha)])?;
    if parent_out.trim().is_empty() {
        return Err(GitError {
            exit_code: None,
            message: "cannot fixup root commit into previous commit".to_string(),
        });
    }
    let prev_sha = parent_out.lines().next().unwrap().trim().to_string();

    let grand_parent_out = git(exec, repo, &["rev-parse", &format!("{}^@", prev_sha)])?;
    let has_grand_parent = !grand_parent_out.trim().is_empty();
    let base = if has_grand_parent {
        format!("{}^", prev_sha)
    } else {
        "--root".to_string()
    };

    let mut items = rebase_todo(exec, repo, &base)?;
    for item in &mut items {
        if item.sha == full_sha {
            item.action = RebaseAction::Fixup;
            item.message = None;
        } else {
            item.action = RebaseAction::Pick;
            item.message = None;
        }
    }

    let plan = RebasePlan {
        base,
        items,
        backup: true,
    };
    rebase_run_with_op(exec, repo, &plan, "fixup")
}

pub fn drop(exec: &dyn Exec, repo: &Path, shas: &[&str]) -> Result<OpResult, GitError> {
    if shas.is_empty() {
        let new_head = git(exec, repo, &["rev-parse", "HEAD"])?.trim().to_string();
        return Ok(OpResult {
            ok: true,
            backup_ref: None,
            stopped_at: None,
            new_head,
        });
    }

    let mut resolved_shas = Vec::new();
    for s in shas {
        let full = git(exec, repo, &["rev-parse", s])?.trim().to_string();
        resolved_shas.push(full);
    }

    let log_shas_raw = git(exec, repo, &["log", "--reverse", "--format=%H", "HEAD"])?;
    let all_shas: Vec<&str> = log_shas_raw
        .lines()
        .map(|l| l.trim())
        .filter(|l| !l.is_empty())
        .collect();

    let mut ordered = Vec::new();
    for s in &all_shas {
        if resolved_shas.contains(&s.to_string()) {
            ordered.push(s.to_string());
        }
    }

    if ordered.is_empty() {
        return Err(GitError {
            exit_code: None,
            message: "none of the commits to drop were found in current history".to_string(),
        });
    }

    let oldest_sha = &ordered[0];
    let parent = git(exec, repo, &["rev-parse", &format!("{}^@", oldest_sha)])?;
    let has_parent = !parent.trim().is_empty();
    let base = if has_parent {
        format!("{}^", oldest_sha)
    } else {
        "--root".to_string()
    };

    let mut items = rebase_todo(exec, repo, &base)?;
    for item in &mut items {
        if ordered.contains(&item.sha) {
            item.action = RebaseAction::Drop;
        } else {
            item.action = RebaseAction::Pick;
        }
        item.message = None;
    }

    let plan = RebasePlan {
        base,
        items,
        backup: true,
    };
    rebase_run_with_op(exec, repo, &plan, "drop")
}
