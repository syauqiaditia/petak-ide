use super::*;

#[tauri::command]
pub fn git_branch(root: String) -> Result<Option<String>, String> {
    Ok(petak_core::git::branch(&root))
}


#[tauri::command]
pub async fn git_status(root: String) -> Result<petak_core::git::RepoStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let exec = petak_core::exec::SystemExec;
        petak_core::git::status(&exec, std::path::Path::new(&root)).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}


#[tauri::command]
pub async fn git_diff(
    root: String,
    kind: String,
    sha: Option<String>,
    path: Option<String>,
    ignore_ws: Option<bool>,
) -> Result<Vec<petak_core::git::DiffFile>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let exec = petak_core::exec::SystemExec;
        let repo = std::path::Path::new(&root);
        let path_ref = path.as_deref().map(std::path::Path::new);
        let ignore_ws = ignore_ws.unwrap_or(false);
        match kind.as_str() {
            "worktree" => petak_core::git::diff_worktree(&exec, repo, path_ref, ignore_ws)
                .map_err(|e| e.to_string()),
            "staged" => petak_core::git::diff_staged(&exec, repo, path_ref, ignore_ws)
                .map_err(|e| e.to_string()),
            "commit" => {
                let s = sha.ok_or_else(|| "commit sha required for commit diff".to_string())?;
                petak_core::git::diff_commit(&exec, repo, &s, path_ref, ignore_ws)
                    .map_err(|e| e.to_string())
            }
            other => Err(format!("unknown diff kind: {}", other)),
        }
    })
    .await
    .map_err(|e| e.to_string())?
}


#[tauri::command]
pub async fn git_stage_files(root: String, paths: Vec<String>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let exec = petak_core::exec::SystemExec;
        let repo = std::path::Path::new(&root);
        let path_slices: Vec<&str> = paths.iter().map(|s| s.as_str()).collect();
        petak_core::git::stage_files(&exec, repo, &path_slices).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}


#[tauri::command]
pub async fn git_unstage_files(root: String, paths: Vec<String>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let exec = petak_core::exec::SystemExec;
        let repo = std::path::Path::new(&root);
        let path_slices: Vec<&str> = paths.iter().map(|s| s.as_str()).collect();
        petak_core::git::unstage_files(&exec, repo, &path_slices).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}


#[tauri::command]
pub async fn git_stage_hunk(root: String, path: String, hunk_index: usize) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let exec = petak_core::exec::SystemExec;
        let repo = std::path::Path::new(&root);
        let diffs = petak_core::git::diff_worktree(
            &exec,
            repo,
            Some(std::path::Path::new(&path)),
            false,
        )
        .map_err(|e| e.to_string())?;

        let file_diff = diffs
            .into_iter()
            .find(|d| {
                d.path() == path
                    || d.new_path.as_deref() == Some(&path)
                    || d.old_path.as_deref() == Some(&path)
            })
            .ok_or_else(|| format!("no worktree diff found for {}", path))?;

        petak_core::git::stage_hunk(&exec, repo, &file_diff, hunk_index)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}


#[tauri::command]
pub async fn git_unstage_hunk(root: String, path: String, hunk_index: usize) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let exec = petak_core::exec::SystemExec;
        let repo = std::path::Path::new(&root);
        let diffs = petak_core::git::diff_staged(
            &exec,
            repo,
            Some(std::path::Path::new(&path)),
            false,
        )
        .map_err(|e| e.to_string())?;

        let file_diff = diffs
            .into_iter()
            .find(|d| {
                d.path() == path
                    || d.new_path.as_deref() == Some(&path)
                    || d.old_path.as_deref() == Some(&path)
            })
            .ok_or_else(|| format!("no staged diff found for {}", path))?;

        petak_core::git::unstage_hunk(&exec, repo, &file_diff, hunk_index)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}


#[tauri::command]
pub async fn git_commit(root: String, message: String, amend: bool) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let exec = petak_core::exec::SystemExec;
        let repo = std::path::Path::new(&root);
        petak_core::git::commit(&exec, repo, &message, amend).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}


#[tauri::command]
pub async fn git_last_message(root: String) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let exec = petak_core::exec::SystemExec;
        let repo = std::path::Path::new(&root);
        petak_core::git::last_commit_message(&exec, repo).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}


#[tauri::command]
pub async fn git_log(
    root: String,
    filter: Option<petak_core::git::LogFilter>,
    cursor: Option<usize>,
    limit: Option<usize>,
) -> Result<petak_core::git::LogPage, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let exec = petak_core::exec::SystemExec;
        let repo = std::path::Path::new(&root);
        let filt = filter.unwrap_or_default();
        let skip = cursor.unwrap_or(0);
        let lim = limit.unwrap_or(50);
        petak_core::git::log(&exec, repo, &filt, skip, lim).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}


#[tauri::command]
pub async fn git_branches(root: String) -> Result<petak_core::git::BranchList, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let exec = petak_core::exec::SystemExec;
        let repo = std::path::Path::new(&root);
        petak_core::git::branches(&exec, repo).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}


#[tauri::command]
pub async fn git_commit_files(
    root: String,
    sha: String,
) -> Result<Vec<petak_core::git::CommitFile>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let exec = petak_core::exec::SystemExec;
        let repo = std::path::Path::new(&root);
        petak_core::git::commit_files(&exec, repo, &sha).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}


#[tauri::command]
pub async fn git_rebase_todo(
    root: String,
    base: String,
) -> Result<Vec<petak_core::git::RebaseItem>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let exec = petak_core::exec::SystemExec;
        let repo = std::path::Path::new(&root);
        petak_core::git::rebase_todo(&exec, repo, &base).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}


#[tauri::command]
pub async fn git_rebase_run(
    root: String,
    plan: petak_core::git::RebasePlan,
) -> Result<petak_core::git::OpResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let exec = petak_core::exec::SystemExec;
        let repo = std::path::Path::new(&root);
        petak_core::git::rebase_run(&exec, repo, &plan).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}


#[tauri::command]
pub async fn git_rebase_continue(root: String) -> Result<petak_core::git::OpResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let exec = petak_core::exec::SystemExec;
        let repo = std::path::Path::new(&root);
        petak_core::git::rebase_continue(&exec, repo).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}


#[tauri::command]
pub async fn git_rebase_abort(root: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let exec = petak_core::exec::SystemExec;
        let repo = std::path::Path::new(&root);
        petak_core::git::rebase_abort(&exec, repo).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}


#[tauri::command]
pub async fn git_rebase_state(root: String) -> Result<petak_core::git::RebaseState, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let exec = petak_core::exec::SystemExec;
        let repo = std::path::Path::new(&root);
        petak_core::git::rebase_state(&exec, repo).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}


#[tauri::command]
pub async fn git_reword(
    root: String,
    sha: String,
    message: String,
) -> Result<petak_core::git::OpResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let exec = petak_core::exec::SystemExec;
        let repo = std::path::Path::new(&root);
        petak_core::git::reword(&exec, repo, &sha, &message).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}


#[tauri::command]
pub async fn git_squash(
    root: String,
    shas: Vec<String>,
    message: String,
) -> Result<petak_core::git::OpResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let exec = petak_core::exec::SystemExec;
        let repo = std::path::Path::new(&root);
        let sha_slices: Vec<&str> = shas.iter().map(|s| s.as_str()).collect();
        petak_core::git::squash(&exec, repo, &sha_slices, &message).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}


#[tauri::command]
pub async fn git_fixup(root: String, sha: String) -> Result<petak_core::git::OpResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let exec = petak_core::exec::SystemExec;
        let repo = std::path::Path::new(&root);
        petak_core::git::fixup_into_previous(&exec, repo, &sha).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}


#[tauri::command]
pub async fn git_drop(
    root: String,
    shas: Vec<String>,
) -> Result<petak_core::git::OpResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let exec = petak_core::exec::SystemExec;
        let repo = std::path::Path::new(&root);
        let sha_slices: Vec<&str> = shas.iter().map(|s| s.as_str()).collect();
        petak_core::git::drop(&exec, repo, &sha_slices).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}


#[tauri::command]
pub async fn git_reset(
    root: String,
    sha: String,
    mode: petak_core::git::ResetMode,
) -> Result<petak_core::git::OpResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let exec = petak_core::exec::SystemExec;
        let repo = std::path::Path::new(&root);
        petak_core::git::reset(&exec, repo, &sha, mode).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}


#[tauri::command]
pub async fn git_cherry_pick(
    root: String,
    shas: Vec<String>,
) -> Result<petak_core::git::OpResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let exec = petak_core::exec::SystemExec;
        let repo = std::path::Path::new(&root);
        let sha_slices: Vec<&str> = shas.iter().map(|s| s.as_str()).collect();
        petak_core::git::cherry_pick(&exec, repo, &sha_slices).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}


#[tauri::command]
pub async fn git_revert(
    root: String,
    shas: Vec<String>,
) -> Result<petak_core::git::OpResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let exec = petak_core::exec::SystemExec;
        let repo = std::path::Path::new(&root);
        let sha_slices: Vec<&str> = shas.iter().map(|s| s.as_str()).collect();
        petak_core::git::revert(&exec, repo, &sha_slices).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}


#[tauri::command]
pub async fn git_merge(
    root: String,
    branch: String,
) -> Result<petak_core::git::OpResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let exec = petak_core::exec::SystemExec;
        let repo = std::path::Path::new(&root);
        petak_core::git::merge(&exec, repo, &branch).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}


#[tauri::command]
pub async fn git_rebase_onto(
    root: String,
    upstream: String,
) -> Result<petak_core::git::OpResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let exec = petak_core::exec::SystemExec;
        let repo = std::path::Path::new(&root);
        petak_core::git::rebase_onto(&exec, repo, &upstream).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}


#[tauri::command]
pub async fn git_branch_create(
    root: String,
    name: String,
    start_point: Option<String>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let exec = petak_core::exec::SystemExec;
        let repo = std::path::Path::new(&root);
        let at_sha = start_point.as_deref().unwrap_or("HEAD");
        petak_core::git::branch_create(&exec, repo, &name, at_sha, false)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}


#[tauri::command]
pub async fn git_branch_checkout(root: String, name: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let exec = petak_core::exec::SystemExec;
        let repo = std::path::Path::new(&root);
        petak_core::git::branch_checkout(&exec, repo, &name).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}


#[tauri::command]
pub async fn git_branch_delete(root: String, name: String, force: bool) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let exec = petak_core::exec::SystemExec;
        let repo = std::path::Path::new(&root);
        petak_core::git::branch_delete(&exec, repo, &name, force).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}


#[tauri::command]
pub async fn git_branch_rename(root: String, old_name: String, new_name: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let exec = petak_core::exec::SystemExec;
        let repo = std::path::Path::new(&root);
        petak_core::git::branch_rename(&exec, repo, &old_name, &new_name).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}


#[tauri::command]
pub async fn git_backup_create(root: String, op: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let exec = petak_core::exec::SystemExec;
        let repo = std::path::Path::new(&root);
        petak_core::git::backup_create(&exec, repo, &op).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}


#[tauri::command]
pub async fn git_backup_list(root: String) -> Result<Vec<petak_core::git::BackupRef>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let exec = petak_core::exec::SystemExec;
        let repo = std::path::Path::new(&root);
        petak_core::git::backup_list(&exec, repo).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}


#[tauri::command]
pub async fn git_backup_restore(root: String, name: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let exec = petak_core::exec::SystemExec;
        let repo = std::path::Path::new(&root);
        petak_core::git::backup_restore(&exec, repo, &name, false).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}


#[tauri::command]
pub async fn git_backup_delete(root: String, name: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let exec = petak_core::exec::SystemExec;
        let repo = std::path::Path::new(&root);
        petak_core::git::backup_delete(&exec, repo, &name).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}


#[tauri::command]
pub async fn git_conflicts(root: String) -> Result<Vec<petak_core::git::ConflictFile>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let exec = petak_core::exec::SystemExec;
        let repo = std::path::Path::new(&root);
        petak_core::git::conflicts(&exec, repo).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}


#[tauri::command]
pub fn git_resolve_block(
    merged: String,
    block_index: usize,
    choice: petak_core::git::ConflictChoice,
) -> Result<String, String> {
    Ok(petak_core::git::resolve_block(&merged, block_index, choice))
}


#[tauri::command]
pub async fn git_conflict_write(
    root: String,
    path: String,
    content: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let exec = petak_core::exec::SystemExec;
        let repo = std::path::Path::new(&root);
        petak_core::git::conflict_write(&exec, repo, &path, &content, true).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}


#[tauri::command]
pub async fn git_op_state(root: String) -> Result<petak_core::git::OpState, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let exec = petak_core::exec::SystemExec;
        let repo = std::path::Path::new(&root);
        petak_core::git::op_state(&exec, repo).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}


#[tauri::command]
pub async fn git_op_continue(root: String) -> Result<petak_core::git::OpResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let exec = petak_core::exec::SystemExec;
        let repo = std::path::Path::new(&root);
        petak_core::git::op_continue(&exec, repo).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}


#[tauri::command]
pub async fn git_op_abort(root: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let exec = petak_core::exec::SystemExec;
        let repo = std::path::Path::new(&root);
        petak_core::git::op_abort(&exec, repo).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}


#[tauri::command]
pub async fn git_remotes(root: String) -> Result<Vec<petak_core::git::Remote>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let exec = petak_core::exec::SystemExec;
        let repo = std::path::Path::new(&root);
        petak_core::git::remotes(&exec, repo).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}


#[tauri::command]
pub async fn git_fetch(
    root: String,
    remote: Option<String>,
    prune: Option<bool>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let exec = petak_core::exec::SystemExec;
        let repo = std::path::Path::new(&root);
        petak_core::git::fetch(&exec, repo, remote.as_deref(), prune.unwrap_or(false))
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}


#[tauri::command]
pub async fn git_pull(
    root: String,
    mode: petak_core::git::PullMode,
) -> Result<petak_core::git::OpResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let exec = petak_core::exec::SystemExec;
        let repo = std::path::Path::new(&root);
        petak_core::git::pull(&exec, repo, mode).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}


#[tauri::command]
pub async fn git_push(
    root: String,
    remote: String,
    branch: String,
    set_upstream: bool,
    force_with_lease: bool,
) -> Result<petak_core::git::OpResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let exec = petak_core::exec::SystemExec;
        let repo = std::path::Path::new(&root);
        petak_core::git::push(&exec, repo, &remote, &branch, set_upstream, force_with_lease)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}


#[tauri::command]
pub async fn git_diff_path(
    root: String,
    rel: String,
    mode: String,
) -> Result<Vec<petak_core::git::DiffFile>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let exec = petak_core::exec::SystemExec;
        let repo = std::path::Path::new(&root);
        let _ = petak_core::fsops::resolve_in_root(repo, &rel).map_err(|e| e.to_string())?;
        match mode.as_str() {
            "head" => petak_core::git::diff_path_head(&exec, repo, &rel).map_err(|e| e.to_string()),
            "staged" => petak_core::git::diff_path_staged(&exec, repo, &rel).map_err(|e| e.to_string()),
            git_ref => petak_core::git::diff_path_vs_ref(&exec, repo, git_ref, &rel).map_err(|e| e.to_string()),
        }
    })
    .await
    .map_err(|e| e.to_string())?
}


#[tauri::command]
pub async fn git_file_at_ref(
    root: String,
    git_ref: String,
    rel: String,
) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let exec = petak_core::exec::SystemExec;
        let repo = std::path::Path::new(&root);
        let _ = petak_core::fsops::resolve_in_root(repo, &rel).map_err(|e| e.to_string())?;
        Ok(petak_core::git::file_at_ref(&exec, repo, &git_ref, &rel))
    })
    .await
    .map_err(|e| e.to_string())?
}


#[tauri::command]
pub async fn git_path_history(
    root: String,
    rel: String,
    is_file: bool,
    limit: Option<usize>,
    skip: Option<usize>,
) -> Result<Vec<petak_core::git::Commit>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let exec = petak_core::exec::SystemExec;
        let repo = std::path::Path::new(&root);
        let _ = petak_core::fsops::resolve_in_root(repo, &rel).map_err(|e| e.to_string())?;
        petak_core::git::path_history(
            &exec,
            repo,
            &rel,
            is_file,
            limit.unwrap_or(0),
            skip.unwrap_or(0),
        )
        .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}


#[tauri::command]
pub async fn git_blame(
    root: String,
    rel: String,
) -> Result<Vec<petak_core::git::BlameLine>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let exec = petak_core::exec::SystemExec;
        let repo = std::path::Path::new(&root);
        let _ = petak_core::fsops::resolve_in_root(repo, &rel).map_err(|e| e.to_string())?;
        petak_core::git::blame(&exec, repo, &rel).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}


#[tauri::command]
pub async fn git_rollback(
    app: tauri::AppHandle,
    root: String,
    rels: Vec<String>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let store = lh_store_dir(&app, &root)?;
        let root_path = std::path::Path::new(&root);
        let exec = petak_core::exec::SystemExec;

        // Create backup ref if HEAD exists
        let _ = petak_core::git::backup_create(&exec, root_path, "rollback");

        // 1. Snapshot each file before rollback
        for rel in &rels {
            let target = petak_core::fsops::resolve_in_root(root_path, rel)
                .map_err(|e| e.to_string())?;
            if target.is_file() {
                snapshot_file_if_small(&store, &target, rel, "before_rollback");
            } else if target.is_dir() {
                fn snapshot_dir(store: &std::path::Path, root_path: &std::path::Path, dir: &std::path::Path) {
                    if let Ok(entries) = std::fs::read_dir(dir) {
                        for entry in entries.flatten() {
                            let p = entry.path();
                            if p.is_file() {
                                if let Ok(rel_p) = p.strip_prefix(root_path) {
                                    let rel_str = rel_p.to_string_lossy().replace('\\', "/");
                                    snapshot_file_if_small(store, &p, &rel_str, "before_rollback");
                                }
                            } else if p.is_dir() {
                                snapshot_dir(store, root_path, &p);
                            }
                        }
                    }
                }
                snapshot_dir(&store, root_path, &target);
            }
        }

        // 2. Perform rollback
        let exec = petak_core::exec::SystemExec;
        let rel_slices: Vec<&str> = rels.iter().map(|s| s.as_str()).collect();
        petak_core::git::rollback_paths(&exec, root_path, &rel_slices)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}


#[tauri::command]
pub async fn git_gitignore_add(
    root: String,
    rel: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let repo = std::path::Path::new(&root);
        let _ = petak_core::fsops::resolve_in_root(repo, &rel).map_err(|e| e.to_string())?;
        petak_core::git::add_to_gitignore(repo, &rel).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}


#[tauri::command]
pub async fn git_commit_paths(
    root: String,
    paths: Option<Vec<String>>,
    rels: Option<Vec<String>>,
    message: String,
    amend: Option<bool>,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let exec = petak_core::exec::SystemExec;
        let repo = std::path::Path::new(&root);
        let target_paths = paths.or(rels).unwrap_or_default();
        for rel in &target_paths {
            let _ = petak_core::fsops::resolve_in_root(repo, rel).map_err(|e| e.to_string())?;
        }
        let rel_slices: Vec<&str> = target_paths.iter().map(|s| s.as_str()).collect();
        petak_core::git::commit_paths(
            &exec,
            repo,
            &message,
            &rel_slices,
            amend.unwrap_or(false),
        )
        .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

// -----------------------------------------------------------------------------
// Mirror (device mirror via scrcpy)
// -----------------------------------------------------------------------------


#[tauri::command]
pub async fn git_branches_tree(root: String) -> Result<petak_core::git::BranchList, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let exec = petak_core::exec::SystemExec;
        let repo = std::path::Path::new(&root);
        petak_core::git::branches(&exec, repo).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}


#[tauri::command]
pub async fn git_checkout(
    root: String,
    branch: String,
    auto_stash: bool,
) -> Result<petak_core::git::CheckoutResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let exec = petak_core::exec::SystemExec;
        let repo = std::path::Path::new(&root);
        petak_core::git::checkout_with_stash(&exec, repo, &branch, auto_stash)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}


#[tauri::command]
pub async fn git_log_path(
    root: String,
    path: String,
    limit: Option<usize>,
) -> Result<Vec<petak_core::git::Commit>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let exec = petak_core::exec::SystemExec;
        let repo = std::path::Path::new(&root);
        let _ = petak_core::fsops::resolve_in_root(repo, &path).map_err(|e| e.to_string())?;
        let is_file = repo.join(&path).is_file();
        petak_core::git::path_history(
            &exec,
            repo,
            &path,
            is_file,
            limit.unwrap_or(100),
            0,
        )
        .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}


#[tauri::command]
pub async fn git_diff_branch(
    root: String,
    path: String,
    branch: String,
    base: Option<String>,
) -> Result<Vec<petak_core::git::DiffFile>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let exec = petak_core::exec::SystemExec;
        let repo = std::path::Path::new(&root);
        let _ = petak_core::fsops::resolve_in_root(repo, &path).map_err(|e| e.to_string())?;
        if let Some(ref base_ref) = base {
            let trimmed = base_ref.trim();
            if !trimmed.is_empty() {
                return petak_core::git::diff_between_refs(&exec, repo, trimmed, &branch, &path)
                    .map_err(|e| e.to_string());
            }
        }
        petak_core::git::diff_path_vs_ref(&exec, repo, &branch, &path)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}


#[tauri::command]
pub async fn git_compare_branch(
    root: String,
    base: String,
    target: String,
    path: Option<String>,
) -> Result<petak_core::git::CompareBranchResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let exec = petak_core::exec::SystemExec;
        let repo = std::path::Path::new(&root);
        petak_core::git::compare_branch(&exec, repo, &base, &target, path.as_deref())
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}


#[tauri::command]
pub async fn git_diff_revision(
    root: String,
    path: String,
    rev: String,
) -> Result<Vec<petak_core::git::DiffFile>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let exec = petak_core::exec::SystemExec;
        let repo = std::path::Path::new(&root);
        let _ = petak_core::fsops::resolve_in_root(repo, &path).map_err(|e| e.to_string())?;
        petak_core::git::diff_path_vs_ref(&exec, repo, &rev, &path)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}


#[tauri::command]
pub async fn git_stage(root: String, path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let exec = petak_core::exec::SystemExec;
        let repo = std::path::Path::new(&root);
        let _ = petak_core::fsops::resolve_in_root(repo, &path).map_err(|e| e.to_string())?;
        petak_core::git::stage_files(&exec, repo, &[path.as_str()])
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}


#[tauri::command]
pub async fn git_unstage(root: String, path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let exec = petak_core::exec::SystemExec;
        let repo = std::path::Path::new(&root);
        let _ = petak_core::fsops::resolve_in_root(repo, &path).map_err(|e| e.to_string())?;
        petak_core::git::unstage_files(&exec, repo, &[path.as_str()])
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

// ──────────── Batch 3 commands ────────────


#[tauri::command]
pub async fn git_stage_paths(
    app: tauri::AppHandle,
    root: Option<String>,
    paths: Vec<String>,
) -> Result<(), String> {
    let repo_root = resolve_cmd_root(&app, root)?;
    tauri::async_runtime::spawn_blocking(move || {
        let exec = petak_core::exec::SystemExec;
        let repo = std::path::Path::new(&repo_root);
        for p in &paths {
            let _ = petak_core::fsops::resolve_in_root(repo, p).map_err(|e| e.to_string())?;
        }
        let slices: Vec<&str> = paths.iter().map(|s| s.as_str()).collect();
        petak_core::git::stage_files(&exec, repo, &slices).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}


#[tauri::command]
pub async fn git_unstage_paths(
    app: tauri::AppHandle,
    root: Option<String>,
    paths: Vec<String>,
) -> Result<(), String> {
    let repo_root = resolve_cmd_root(&app, root)?;
    tauri::async_runtime::spawn_blocking(move || {
        let exec = petak_core::exec::SystemExec;
        let repo = std::path::Path::new(&repo_root);
        for p in &paths {
            let _ = petak_core::fsops::resolve_in_root(repo, p).map_err(|e| e.to_string())?;
        }
        let slices: Vec<&str> = paths.iter().map(|s| s.as_str()).collect();
        petak_core::git::unstage_files(&exec, repo, &slices).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}


#[tauri::command]
pub async fn git_commit_selected(
    app: tauri::AppHandle,
    root: Option<String>,
    message: String,
    paths: Vec<String>,
) -> Result<petak_core::git::CommitSelectedResult, String> {
    let repo_root = resolve_cmd_root(&app, root)?;
    tauri::async_runtime::spawn_blocking(move || {
        let exec = petak_core::exec::SystemExec;
        let repo = std::path::Path::new(&repo_root);
        for p in &paths {
            let _ = petak_core::fsops::resolve_in_root(repo, p).map_err(|e| e.to_string())?;
        }
        let slices: Vec<&str> = paths.iter().map(|s| s.as_str()).collect();
        petak_core::git::commit_selected(&exec, repo, &message, &slices).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}


#[tauri::command]
pub async fn git_delete_untracked(
    app: tauri::AppHandle,
    root: Option<String>,
    path: String,
) -> Result<(), String> {
    let repo_root = resolve_cmd_root(&app, root)?;
    let app_handle = app.clone();
    let root_clone = repo_root.clone();
    let path_clone = path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let root_p = std::path::Path::new(&root_clone);
        let full_p = root_p.join(&path_clone);
        if let Ok(store) = lh_store_dir(&app_handle, &root_clone) {
            snapshot_file_if_small(&store, &full_p, &path_clone, "before_delete_untracked");
        }
        let exec = petak_core::exec::SystemExec;
        petak_core::git::delete_untracked(&exec, root_p, &path_clone).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}


#[tauri::command]
pub async fn git_stash_push(
    root: String,
    message: Option<String>,
    include_untracked: Option<bool>,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let exec = petak_core::exec::SystemExec;
        let repo = std::path::Path::new(&root);
        petak_core::git::stash_push(
            &exec,
            repo,
            message.as_deref(),
            include_untracked.unwrap_or(true),
        )
        .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}


#[tauri::command]
pub async fn git_stash_list(root: String) -> Result<Vec<petak_core::git::StashEntry>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let exec = petak_core::exec::SystemExec;
        let repo = std::path::Path::new(&root);
        petak_core::git::stash_list(&exec, repo).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}


#[tauri::command]
pub async fn git_stash_apply(root: String, index: usize) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let exec = petak_core::exec::SystemExec;
        let repo = std::path::Path::new(&root);
        petak_core::git::stash_apply(&exec, repo, index).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}


#[tauri::command]
pub async fn git_stash_pop(root: String, index: Option<usize>) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let exec = petak_core::exec::SystemExec;
        let repo = std::path::Path::new(&root);
        petak_core::git::stash_pop(&exec, repo, index).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}


#[tauri::command]
pub async fn git_stash_drop(root: String, index: usize) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let exec = petak_core::exec::SystemExec;
        let repo = std::path::Path::new(&root);
        petak_core::git::stash_drop(&exec, repo, index).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

// ──────────── Batch 3 Ghost-text suggest & Settings ────────────


