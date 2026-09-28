use std::path::Path;

use crate::exec::{git, git_with_stdin, Exec, GitError};
use crate::git::model::{DiffFile, DiffLineKind};

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
