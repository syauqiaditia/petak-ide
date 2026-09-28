use std::path::{Path, PathBuf};
use std::time::SystemTime;

use crate::exec::{git, git_raw, Exec, GitError};
use crate::git::model::BackupRef;

pub fn git_dir(repo: &Path) -> PathBuf {
    let dot_git = repo.join(".git");
    if dot_git.is_file() {
        if let Ok(content) = std::fs::read_to_string(&dot_git) {
            if let Some(path_str) = content.trim().strip_prefix("gitdir:") {
                let p = Path::new(path_str.trim());
                if p.is_relative() {
                    return repo.join(p);
                } else {
                    return p.to_path_buf();
                }
            }
        }
    }
    dot_git
}

fn current_utc_timestamp() -> String {
    let now = SystemTime::now();
    let secs = match now.duration_since(SystemTime::UNIX_EPOCH) {
        Ok(d) => d.as_secs(),
        Err(_) => 0,
    };
    let days = (secs / 86400) as i64;
    let rem_secs = (secs % 86400) as u32;
    let hours = rem_secs / 3600;
    let mins = (rem_secs % 3600) / 60;
    let s = rem_secs % 60;

    // Howard Hinnant's algorithm for civil date
    let z = days + 719468;
    let era = (if z >= 0 { z } else { z - 146096 }) / 146097;
    let doe = (z - era * 146097) as u32;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = (yoe as i64) + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };

    format!("{:04}{:02}{:02}-{:02}{:02}{:02}", y, m, d, hours, mins, s)
}

pub fn backup_create(exec: &dyn Exec, repo: &Path, op: &str) -> Result<String, GitError> {
    let head_sha = git(exec, repo, &["rev-parse", "HEAD"])?.trim().to_string();
    if head_sha.is_empty() {
        return Err(GitError {
            exit_code: None,
            message: "cannot create backup ref: HEAD is empty".to_string(),
        });
    }

    let ts = current_utc_timestamp();
    let mut candidate = format!("refs/petak/backup/{}-{}", ts, op);
    let mut counter = 2;
    while git_raw(
        exec,
        repo,
        &["rev-parse", "--verify", "--quiet", &candidate],
        None,
    )
    .map(|o| o.status.success())
    .unwrap_or(false)
    {
        candidate = format!("refs/petak/backup/{}-{}-{}", ts, op, counter);
        counter += 1;
    }

    git(exec, repo, &["update-ref", &candidate, &head_sha])?;
    Ok(candidate)
}

pub fn backup_list(exec: &dyn Exec, repo: &Path) -> Result<Vec<BackupRef>, GitError> {
    let out = git(
        exec,
        repo,
        &[
            "for-each-ref",
            "--format=%(refname)%00%(objectname)%00%(subject)",
            "--sort=-refname",
            "refs/petak/backup",
        ],
    )?;

    let mut list = Vec::new();
    for line in out.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let parts: Vec<&str> = line.split('\0').collect();
        if parts.len() < 3 {
            continue;
        }
        let refname = parts[0];
        let sha = parts[1];
        let subject = parts[2];

        let remainder = refname
            .strip_prefix("refs/petak/backup/")
            .unwrap_or(refname);
        // remainder format: YYYYMMDD-HHMMSS-<op>[-N]
        let (created_at, op) = if remainder.len() >= 16
            && remainder.as_bytes()[8] == b'-'
            && remainder.as_bytes()[15] == b'-'
        {
            let ts = &remainder[0..15];
            let iso = format!(
                "{}-{}-{}T{}:{}:{}Z",
                &ts[0..4],
                &ts[4..6],
                &ts[6..8],
                &ts[9..11],
                &ts[11..13],
                &ts[13..15]
            );
            let op_part = &remainder[16..];
            let base_op = if let Some((base, num)) = op_part.rsplit_once('-') {
                if num.chars().all(|c| c.is_ascii_digit()) {
                    base.to_string()
                } else {
                    op_part.to_string()
                }
            } else {
                op_part.to_string()
            };
            (iso, base_op)
        } else {
            (String::new(), remainder.to_string())
        };

        list.push(BackupRef {
            name: refname.to_string(),
            sha: sha.to_string(),
            created_at,
            op,
            subject: subject.to_string(),
        });
    }

    Ok(list)
}

pub fn backup_restore(
    exec: &dyn Exec,
    repo: &Path,
    name: &str,
    force: bool,
) -> Result<String, GitError> {
    let full_ref = if name.starts_with("refs/petak/backup/") {
        name.to_string()
    } else if name.starts_with("refs/") {
        name.to_string()
    } else {
        format!("refs/petak/backup/{}", name)
    };

    let target_sha = git(exec, repo, &["rev-parse", "--verify", &full_ref])?
        .trim()
        .to_string();

    if !force {
        let status_out = git(exec, repo, &["status", "--porcelain"])?;
        if !status_out.trim().is_empty() {
            return Err(GitError {
                exit_code: None,
                message: "cannot restore backup: worktree has uncommitted changes (use force to overwrite)".to_string(),
            });
        }
    }

    // Backup current HEAD before restoring
    backup_create(exec, repo, "restore")?;

    git(exec, repo, &["reset", "--hard", &target_sha])?;
    let new_head = git(exec, repo, &["rev-parse", "HEAD"])?.trim().to_string();
    Ok(new_head)
}

pub fn backup_delete(exec: &dyn Exec, repo: &Path, name: &str) -> Result<(), GitError> {
    let full_ref = if name.starts_with("refs/petak/backup/") {
        name.to_string()
    } else if name.starts_with("refs/") {
        name.to_string()
    } else {
        format!("refs/petak/backup/{}", name)
    };

    git(exec, repo, &["update-ref", "-d", &full_ref])?;
    Ok(())
}
