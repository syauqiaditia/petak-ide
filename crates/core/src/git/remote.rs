use std::collections::BTreeMap;
use std::path::Path;

use crate::exec::{git, git_raw, git_raw_with_env, Exec, GitError};
use crate::git::conflict::op_state;
use crate::git::model::{OpResult, PullMode, RebaseStateKind, Remote, StopKind, StopReason};

/// Lists all configured git remotes and their fetch / push URLs.
pub fn remotes(exec: &dyn Exec, repo: &Path) -> Result<Vec<Remote>, GitError> {
    let out = git(exec, repo, &["remote", "-v"])?;
    let mut map: BTreeMap<String, (Option<String>, Option<String>)> = BTreeMap::new();
    let mut order = Vec::new();

    for line in out.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        // Line format: "<name>\t<url> (<type>)" or "<name> <url> (<type>)"
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.is_empty() {
            continue;
        }

        let name = parts[0].to_string();
        let url = parts.get(1).map(|s| s.to_string());
        let kind = parts.get(2).copied().unwrap_or("");

        let entry = map.entry(name.clone()).or_insert_with(|| {
            order.push(name);
            (None, None)
        });

        if kind.contains("fetch") {
            entry.0 = url;
        } else if kind.contains("push") {
            entry.1 = url;
        } else if entry.0.is_none() {
            entry.0 = url;
        }
    }

    let mut result = Vec::new();
    for name in order {
        if let Some((fetch_url, push_url)) = map.remove(&name) {
            result.push(Remote {
                name,
                fetch_url,
                push_url,
            });
        }
    }

    Ok(result)
}

/// Fetches updates from a remote or all remotes, optionally pruning deleted branches.
pub fn fetch(
    exec: &dyn Exec,
    repo: &Path,
    remote: Option<&str>,
    prune: bool,
) -> Result<(), GitError> {
    let mut args = vec!["fetch"];
    if let Some(r) = remote {
        if r == "all" || r == "--all" {
            args.push("--all");
        } else {
            args.push(r);
        }
    } else {
        args.push("--all");
    }

    if prune {
        args.push("--prune");
    }

    git(exec, repo, &args)?;
    Ok(())
}

/// Pulls from upstream using either rebase or merge strategy.
/// Uses `--autostash` by default (identical to Android Studio / IntelliJ "Update Project").
pub fn pull(exec: &dyn Exec, repo: &Path, mode: PullMode) -> Result<OpResult, GitError> {
    let mut args = vec![
        "-c",
        "core.editor=true",
        "-c",
        "rebase.autoStash=true",
        "pull",
        "--autostash",
        "--no-edit",
    ];
    match mode {
        PullMode::Rebase => args.push("--rebase"),
        PullMode::Merge => args.push("--no-rebase"),
    }

    let envs = [("GIT_EDITOR", "true")];
    let res = git_raw_with_env(exec, repo, &args, &envs, None)?;

    if !res.status.success() {
        let status = crate::git::status::status(exec, repo)?;
        let is_conflict = status.entries.iter().any(|e| e.conflicted);
        let op = op_state(exec, repo)?;

        if is_conflict || op.kind != RebaseStateKind::None {
            let head = git(exec, repo, &["rev-parse", "HEAD"])
                .unwrap_or_default()
                .trim()
                .to_string();
            let stopped_sha = op.current_commit.unwrap_or_else(|| head.clone());
            return Ok(OpResult {
                ok: false,
                backup_ref: None,
                stopped_at: Some(StopReason {
                    kind: StopKind::Conflict,
                    sha: stopped_sha,
                }),
                new_head: head,
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

    let new_head = git(exec, repo, &["rev-parse", "HEAD"])?.trim().to_string();
    Ok(OpResult {
        ok: true,
        backup_ref: None,
        stopped_at: None,
        new_head,
        stash_conflict: false,
    })
}

/// Pushes branch commits to a remote, optionally setting upstream or forcing with lease.
pub fn push(
    exec: &dyn Exec,
    repo: &Path,
    remote: &str,
    branch: &str,
    set_upstream: bool,
    force_with_lease: bool,
) -> Result<OpResult, GitError> {
    let mut args = vec!["push"];
    if set_upstream {
        args.push("-u");
    }
    if force_with_lease {
        args.push("--force-with-lease");
    }
    args.push(remote);
    args.push(branch);

    let res = git_raw(exec, repo, &args, None)?;

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

    let new_head = git(exec, repo, &["rev-parse", "HEAD"])?.trim().to_string();
    Ok(OpResult {
        ok: true,
        backup_ref: None,
        stopped_at: None,
        new_head,
        stash_conflict: false,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    struct MockExec {
        stdout: String,
    }

    impl Exec for MockExec {
        fn run(
            &self,
            _cwd: &Path,
            _program: &str,
            _args: &[&str],
            _env: &[(&str, &str)],
            _stdin: Option<&[u8]>,
        ) -> std::io::Result<std::process::Output> {
            #[cfg(unix)]
            use std::os::unix::process::ExitStatusExt;
            Ok(std::process::Output {
                status: std::process::ExitStatus::from_raw(0),
                stdout: self.stdout.as_bytes().to_vec(),
                stderr: Vec::new(),
            })
        }
    }

    #[test]
    fn test_parse_remotes_output() {
        let mock_output = "origin\tgit@github.com:foo/bar.git (fetch)\n\
                           origin\tgit@github.com:foo/bar.git (push)\n\
                           upstream\thttps://github.com/baz/bar.git (fetch)\n\
                           upstream\thttps://github.com/baz/bar.git (push)\n";
        let exec = MockExec {
            stdout: mock_output.to_string(),
        };
        let list = remotes(&exec, Path::new("/dummy")).unwrap();
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].name, "origin");
        assert_eq!(
            list[0].fetch_url,
            Some("git@github.com:foo/bar.git".to_string())
        );
        assert_eq!(
            list[0].push_url,
            Some("git@github.com:foo/bar.git".to_string())
        );
        assert_eq!(list[1].name, "upstream");
        assert_eq!(
            list[1].fetch_url,
            Some("https://github.com/baz/bar.git".to_string())
        );
    }
}
