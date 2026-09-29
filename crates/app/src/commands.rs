use std::sync::Mutex;
use petak_core::exec::Exec;
use tauri::Emitter;
use tauri_plugin_dialog::DialogExt;

#[derive(Clone, serde::Serialize)]
struct FsChangedPayload {
    paths: Vec<String>,
}

#[tauri::command]
pub fn list_dir(path: String) -> Result<Vec<petak_core::fs::Entry>, String> {
    petak_core::fs::list_dir(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn read_file(path: String) -> Result<String, String> {
    petak_core::fs::read_file(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_file(path: String, content: String) -> Result<(), String> {
    petak_core::fs::save_file(&path, &content).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn watch_root(
    app: tauri::AppHandle,
    state: tauri::State<'_, Mutex<Option<notify::RecommendedWatcher>>>,
    root: String,
) -> Result<(), String> {
    {
        let mut lock = state.lock().map_err(|e| e.to_string())?;
        *lock = None;
    }

    let app_handle = app.clone();
    let root_path = root.clone();
    let watcher = tauri::async_runtime::spawn_blocking(move || {
        petak_core::watch::watch(std::path::Path::new(&root_path), move |paths| {
            let _ = app_handle.emit("fs-changed", FsChangedPayload { paths });
        })
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())?;

    let mut lock = state.lock().map_err(|e| e.to_string())?;
    *lock = Some(watcher);
    Ok(())
}

#[tauri::command]
pub async fn pick_folder(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let folder = app.dialog().file().blocking_pick_folder();
    Ok(folder.map(|p| p.to_string()))
}

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
pub fn recent_folders() -> Result<Vec<String>, String> {
    let recent_path = petak_core::recent::default_recent_path()
        .ok_or_else(|| "Could not determine recent folders path".to_string())?;
    petak_core::recent::load_recent(&recent_path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn add_recent_folder(path: String) -> Result<Vec<String>, String> {
    let recent_path = petak_core::recent::default_recent_path()
        .ok_or_else(|| "Could not determine recent folders path".to_string())?;
    petak_core::recent::push_recent(&recent_path, &path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn mark_ready(ts_ms: u64) {
    println!("PETAK_READY {}", ts_ms);
}

#[tauri::command]
pub fn bench_log(line: String) -> Result<(), String> {
    let out_var = std::env::var("PETAK_BENCH_OUT").ok();
    let is_bench = std::env::var("PETAK_BENCH").is_ok();
    let is_test = std::env::var("PETAK_TEST_P3").is_ok()
        || std::env::var("PETAK_TEST_P24").is_ok()
        || std::env::var("PETAK_TEST_P23").is_ok()
        || std::env::var("PETAK_TEST_P15").is_ok()
        || std::env::var("PETAK_TEST_P14").is_ok()
        || std::env::var("PETAK_TEST_P12").is_ok()
        || std::env::var("PETAK_TEST").is_ok();

    if out_var.is_none() && !is_bench && !is_test {
        return Ok(());
    }

    use std::io::Write;
    let path = out_var.unwrap_or_else(|| "/tmp/petak-bench.log".to_string());
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| e.to_string())?;
    writeln!(file, "{}", line).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn bench_mode() -> bool {
    std::env::var("PETAK_BENCH").is_ok()
}

#[tauri::command]
pub fn test_mode() -> Option<String> {
    if std::env::var("PETAK_TEST_P3").is_ok() {
        return Some("P3".to_string());
    }
    if std::env::var("PETAK_TEST_P24").is_ok() {
        return Some("P24".to_string());
    }
    if std::env::var("PETAK_TEST_P23").is_ok() {
        return Some("P23".to_string());
    }
    if std::env::var("PETAK_TEST_P22").is_ok() {
        return Some("P22".to_string());
    }
    if std::env::var("PETAK_TEST_P15").is_ok() {
        return Some("P15".to_string());
    }
    if std::env::var("PETAK_TEST_P14").is_ok() {
        return Some("P14".to_string());
    }
    if std::env::var("PETAK_TEST_P12").is_ok() {
        return Some("P12".to_string());
    }
    if std::env::var("PETAK_TEST").is_ok() {
        return Some("P12".to_string());
    }
    None
}

#[tauri::command]
pub fn test_repo_path() -> Option<String> {
    std::env::var("PETAK_TEST_REPO").ok()
}

#[tauri::command]
pub async fn index_build(
    state: tauri::State<'_, Mutex<Option<petak_core::search::FileIndex>>>,
    root: String,
) -> Result<(), String> {
    let index = tauri::async_runtime::spawn_blocking(move || {
        petak_core::search::FileIndex::build(&root)
    })
    .await
    .map_err(|e| e.to_string())?;

    let mut lock = state.lock().map_err(|e| e.to_string())?;
    *lock = Some(index);
    Ok(())
}

#[tauri::command]
pub fn find_files(
    state: tauri::State<'_, Mutex<Option<petak_core::search::FileIndex>>>,
    q: String,
    limit: usize,
) -> Result<Vec<petak_core::search::FileMatch>, String> {
    let lock = state.lock().map_err(|e| e.to_string())?;
    match &*lock {
        Some(index) => Ok(index.query(&q, limit)),
        None => Ok(Vec::new()),
    }
}

#[tauri::command]
pub async fn grep(
    root: String,
    query: String,
    regex: bool,
    case_sensitive: bool,
    limit: usize,
) -> Result<Vec<petak_core::search::Hit>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        petak_core::search::grep(
            &root,
            &query,
            petak_core::search::GrepOpts {
                regex,
                case_sensitive,
            },
            limit,
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

pub type TermSessions = Mutex<std::collections::HashMap<u32, petak_core::term::TermSession>>;
pub type TermCounter = std::sync::atomic::AtomicU32;

#[derive(Clone, serde::Serialize)]
pub struct TermOutputPayload {
    pub id: u32,
    pub data: String,
}

#[derive(Clone, serde::Serialize)]
pub struct TermExitPayload {
    pub id: u32,
}

#[tauri::command]
pub fn term_open(
    app: tauri::AppHandle,
    state: tauri::State<'_, TermSessions>,
    counter: tauri::State<'_, TermCounter>,
    cwd: Option<String>,
    cols: u16,
    rows: u16,
) -> Result<u32, String> {
    let id = counter.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    let app_handle = app.clone();

    let remainder_buf = std::sync::Arc::new(Mutex::new(Vec::<u8>::new()));
    let remainder_clone = remainder_buf.clone();

    let on_output = move |bytes: Vec<u8>| {
        if let Ok(mut rem_guard) = remainder_clone.lock() {
            let mut combined = std::mem::take(&mut *rem_guard);
            combined.extend_from_slice(&bytes);

            match std::str::from_utf8(&combined) {
                Ok(valid) => {
                    let _ = app_handle.emit(
                        "term-output",
                        TermOutputPayload {
                            id,
                            data: valid.to_string(),
                        },
                    );
                }
                Err(e) => {
                    let valid_len = e.valid_up_to();
                    if valid_len > 0 {
                        let valid_str = String::from_utf8_lossy(&combined[..valid_len]).to_string();
                        let _ = app_handle.emit(
                            "term-output",
                            TermOutputPayload {
                                id,
                                data: valid_str,
                            },
                        );
                    }
                    if e.error_len().is_none() {
                        *rem_guard = combined[valid_len..].to_vec();
                    } else {
                        let rest = String::from_utf8_lossy(&combined[valid_len..]).to_string();
                        let _ = app_handle.emit(
                            "term-output",
                            TermOutputPayload {
                                id,
                                data: rest,
                            },
                        );
                    }
                }
            }
        }
    };

    let app_handle_exit = app.clone();
    let on_exit = move || {
        let _ = app_handle_exit.emit("term-exit", TermExitPayload { id });
    };

    let cwd_path = cwd.as_deref().filter(|s| !s.is_empty()).map(std::path::Path::new);
    let session = petak_core::term::TermSession::open(cwd_path, cols, rows, on_output, on_exit)
        .map_err(|e| e.to_string())?;

    let mut sessions = state.lock().map_err(|e| e.to_string())?;
    sessions.insert(id, session);
    Ok(id)
}

#[tauri::command]
pub fn term_write(
    state: tauri::State<'_, TermSessions>,
    id: u32,
    data: String,
) -> Result<(), String> {
    let sessions = state.lock().map_err(|e| e.to_string())?;
    if let Some(session) = sessions.get(&id) {
        session.write(data.as_bytes()).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn term_resize(
    state: tauri::State<'_, TermSessions>,
    id: u32,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let sessions = state.lock().map_err(|e| e.to_string())?;
    if let Some(session) = sessions.get(&id) {
        session.resize(cols, rows).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn term_close(
    state: tauri::State<'_, TermSessions>,
    id: u32,
) -> Result<(), String> {
    let mut sessions = state.lock().map_err(|e| e.to_string())?;
    if let Some(session) = sessions.remove(&id) {
        let _ = session.kill();
    }
    Ok(())
}

#[tauri::command]
pub fn resize_window(window: tauri::Window, width: f64, height: f64) -> Result<(), String> {
    window
        .set_size(tauri::Size::Logical(tauri::LogicalSize { width, height }))
        .map_err(|e| e.to_string())
}

pub type AppRegistry = std::sync::Arc<petak_core::lsp::Registry>;

#[tauri::command]
pub async fn lsp_did_open(
    state: tauri::State<'_, AppRegistry>,
    path: String,
    text: String,
) -> Result<(), String> {
    let registry = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let p = std::path::Path::new(&path);
        let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("");
        if let Some(lang) = petak_core::lsp::Lang::from_extension(ext) {
            registry
                .did_open(p, lang, &text, None)
                .map_err(|e| format!("{:?}", e))?;
        }
        Ok::<(), String>(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn lsp_did_change(
    state: tauri::State<'_, AppRegistry>,
    path: String,
    version: i32,
    changes: Vec<serde_json::Value>,
) -> Result<(), String> {
    let registry = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let p = std::path::Path::new(&path);
        let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("");
        if let Some(lang) = petak_core::lsp::Lang::from_extension(ext) {
            let _ = registry.did_change(p, lang, version, &changes, None);
        }
    });
    Ok(())
}

#[tauri::command]
pub async fn lsp_did_save(
    state: tauri::State<'_, AppRegistry>,
    path: String,
    text: Option<String>,
) -> Result<(), String> {
    let registry = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let p = std::path::Path::new(&path);
        let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("");
        if let Some(lang) = petak_core::lsp::Lang::from_extension(ext) {
            let _ = registry.did_save(p, lang, text.as_deref(), None);
        }
    });
    Ok(())
}

#[tauri::command]
pub async fn lsp_did_close(
    state: tauri::State<'_, AppRegistry>,
    path: String,
) -> Result<(), String> {
    let registry = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let p = std::path::Path::new(&path);
        let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("");
        if let Some(lang) = petak_core::lsp::Lang::from_extension(ext) {
            let _ = registry.did_close(p, lang, None);
        }
    });
    Ok(())
}

#[tauri::command]
pub async fn lsp_completion(
    state: tauri::State<'_, AppRegistry>,
    path: String,
    line: u32,
    character: u32,
) -> Result<serde_json::Value, String> {
    let registry = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let p = std::path::Path::new(&path);
        let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("");
        let lang = petak_core::lsp::Lang::from_extension(ext)
            .ok_or_else(|| "unsupported language".to_string())?;
        let uri = petak_core::lsp::registry::path_to_uri(p);
        let params = serde_json::json!({
            "textDocument": { "uri": uri },
            "position": { "line": line, "character": character }
        });
        registry
            .request(p, lang, "textDocument/completion", &params, None)
            .map_err(|e| format!("{:?}", e))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn lsp_completion_resolve(
    state: tauri::State<'_, AppRegistry>,
    path: String,
    item: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let registry = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let p = std::path::Path::new(&path);
        let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("");
        let lang = petak_core::lsp::Lang::from_extension(ext)
            .ok_or_else(|| "unsupported language".to_string())?;
        registry
            .request(p, lang, "completionItem/resolve", &item, None)
            .map_err(|e| format!("{:?}", e))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn lsp_hover(
    state: tauri::State<'_, AppRegistry>,
    path: String,
    line: u32,
    character: u32,
) -> Result<serde_json::Value, String> {
    let registry = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let p = std::path::Path::new(&path);
        let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("");
        let lang = petak_core::lsp::Lang::from_extension(ext)
            .ok_or_else(|| "unsupported language".to_string())?;
        let uri = petak_core::lsp::registry::path_to_uri(p);
        let params = serde_json::json!({
            "textDocument": { "uri": uri },
            "position": { "line": line, "character": character }
        });
        registry
            .request(p, lang, "textDocument/hover", &params, None)
            .map_err(|e| format!("{:?}", e))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn lsp_definition(
    state: tauri::State<'_, AppRegistry>,
    path: String,
    line: u32,
    character: u32,
) -> Result<serde_json::Value, String> {
    let registry = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let p = std::path::Path::new(&path);
        let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("");
        let lang = petak_core::lsp::Lang::from_extension(ext)
            .ok_or_else(|| "unsupported language".to_string())?;
        let uri = petak_core::lsp::registry::path_to_uri(p);
        let params = serde_json::json!({
            "textDocument": { "uri": uri },
            "position": { "line": line, "character": character }
        });
        registry
            .request(p, lang, "textDocument/definition", &params, None)
            .map_err(|e| format!("{:?}", e))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn lsp_references(
    state: tauri::State<'_, AppRegistry>,
    path: String,
    line: u32,
    character: u32,
) -> Result<serde_json::Value, String> {
    let registry = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let p = std::path::Path::new(&path);
        let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("");
        let lang = petak_core::lsp::Lang::from_extension(ext)
            .ok_or_else(|| "unsupported language".to_string())?;
        let uri = petak_core::lsp::registry::path_to_uri(p);
        let params = serde_json::json!({
            "textDocument": { "uri": uri },
            "position": { "line": line, "character": character },
            "context": { "includeDeclaration": true }
        });
        registry
            .request(p, lang, "textDocument/references", &params, None)
            .map_err(|e| format!("{:?}", e))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn lsp_prepare_rename(
    state: tauri::State<'_, AppRegistry>,
    path: String,
    line: u32,
    character: u32,
) -> Result<serde_json::Value, String> {
    let registry = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let p = std::path::Path::new(&path);
        let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("");
        let lang = petak_core::lsp::Lang::from_extension(ext)
            .ok_or_else(|| "unsupported language".to_string())?;
        let uri = petak_core::lsp::registry::path_to_uri(p);
        let params = serde_json::json!({
            "textDocument": { "uri": uri },
            "position": { "line": line, "character": character }
        });
        registry
            .request(p, lang, "textDocument/prepareRename", &params, None)
            .map_err(|e| format!("{:?}", e))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn lsp_rename(
    state: tauri::State<'_, AppRegistry>,
    path: String,
    line: u32,
    character: u32,
    new_name: String,
) -> Result<serde_json::Value, String> {
    let registry = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let p = std::path::Path::new(&path);
        let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("");
        let lang = petak_core::lsp::Lang::from_extension(ext)
            .ok_or_else(|| "unsupported language".to_string())?;
        let uri = petak_core::lsp::registry::path_to_uri(p);
        let params = serde_json::json!({
            "textDocument": { "uri": uri },
            "position": { "line": line, "character": character },
            "newName": new_name
        });
        registry
            .request(p, lang, "textDocument/rename", &params, None)
            .map_err(|e| format!("{:?}", e))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn lsp_format(
    state: tauri::State<'_, AppRegistry>,
    path: String,
) -> Result<serde_json::Value, String> {
    let registry = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let p = std::path::Path::new(&path);
        let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("");
        let lang = petak_core::lsp::Lang::from_extension(ext)
            .ok_or_else(|| "unsupported language".to_string())?;
        let uri = petak_core::lsp::registry::path_to_uri(p);
        let params = serde_json::json!({
            "textDocument": { "uri": uri },
            "options": {
                "tabSize": 2,
                "insertSpaces": true
            }
        });
        registry
            .request(p, lang, "textDocument/formatting", &params, None)
            .map_err(|e| format!("{:?}", e))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn lsp_apply_workspace_edit_disk(
    path: String,
    edits: Vec<petak_core::lsp::edit::TextEdit>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let p = std::path::Path::new(&path);
        petak_core::lsp::edit::apply_to_file(p, &edits)
            .map_err(|e| format!("{:?}", e))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn lsp_code_actions(
    state: tauri::State<'_, AppRegistry>,
    path: String,
    range: serde_json::Value,
    diagnostics: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let registry = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let p = std::path::Path::new(&path);
        let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("");
        let lang = petak_core::lsp::Lang::from_extension(ext)
            .ok_or_else(|| "unsupported language".to_string())?;
        let uri = petak_core::lsp::registry::path_to_uri(p);
        let params = serde_json::json!({
            "textDocument": { "uri": uri },
            "range": range,
            "context": {
                "diagnostics": diagnostics
            }
        });
        registry
            .request(p, lang, "textDocument/codeAction", &params, None)
            .map_err(|e| format!("{:?}", e))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn lsp_code_action_resolve(
    state: tauri::State<'_, AppRegistry>,
    path: String,
    action: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let registry = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let p = std::path::Path::new(&path);
        let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("");
        let lang = petak_core::lsp::Lang::from_extension(ext)
            .ok_or_else(|| "unsupported language".to_string())?;
        registry
            .request(p, lang, "codeAction/resolve", &action, None)
            .map_err(|e| format!("{:?}", e))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn lsp_execute_command(
    state: tauri::State<'_, AppRegistry>,
    path: String,
    command: String,
    arguments: Option<Vec<serde_json::Value>>,
) -> Result<serde_json::Value, String> {
    let registry = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let p = std::path::Path::new(&path);
        let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("");
        let lang = petak_core::lsp::Lang::from_extension(ext)
            .ok_or_else(|| "unsupported language".to_string())?;
        let mut params = serde_json::json!({
            "command": command,
        });
        if let Some(args) = arguments {
            params["arguments"] = serde_json::Value::Array(args);
        }
        registry
            .request(p, lang, "workspace/executeCommand", &params, None)
            .map_err(|e| format!("{:?}", e))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn lsp_apply_edit_result(
    state: tauri::State<'_, AppRegistry>,
    id: serde_json::Value,
    applied: bool,
) -> Result<(), String> {
    let registry = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        registry
            .respond_apply_edit(&id, applied)
            .map_err(|e| format!("{:?}", e))
    })
    .await
    .map_err(|e| e.to_string())?
}

// -----------------------------------------------------------------------------
// Run, Toolchain, Devices, Logcat State & Commands
// -----------------------------------------------------------------------------

pub enum ActiveRun {
    Flutter(std::sync::Arc<Mutex<petak_core::run::FlutterRun>>),
    Gradle {
        device_id: String,
        app_id: Option<String>,
        proc: Option<std::sync::Arc<Mutex<Box<dyn petak_core::exec::Proc>>>>,
    },
}

pub struct RunStateInner {
    pub next_run_id: std::sync::atomic::AtomicU32,
    pub runs: Mutex<std::collections::HashMap<u32, ActiveRun>>,
    pub logcat: Mutex<Option<petak_core::run::Logcat>>,
    pub device_watcher: Mutex<Option<Box<dyn petak_core::exec::Proc>>>,
    pub cached_devices: Mutex<Vec<petak_core::run::Device>>,
    pub spawned_emulators: Mutex<Vec<Box<dyn petak_core::exec::Proc>>>,
}

#[derive(Clone)]
pub struct RunState {
    pub inner: std::sync::Arc<RunStateInner>,
}

impl Default for RunState {
    fn default() -> Self {
        Self {
            inner: std::sync::Arc::new(RunStateInner {
                next_run_id: std::sync::atomic::AtomicU32::new(1),
                runs: Mutex::new(std::collections::HashMap::new()),
                logcat: Mutex::new(None),
                device_watcher: Mutex::new(None),
                cached_devices: Mutex::new(Vec::new()),
                spawned_emulators: Mutex::new(Vec::new()),
            }),
        }
    }
}

impl RunState {
    pub fn shutdown_all(&self) {
        if let Ok(mut runs) = self.inner.runs.lock() {
            for (_, run) in runs.drain() {
                match run {
                    ActiveRun::Flutter(fr) => {
                        if let Ok(mut f) = fr.lock() {
                            let _ = f.stop();
                        }
                    }
                    ActiveRun::Gradle { proc, device_id, app_id } => {
                        if let Some(p) = proc {
                            if let Ok(mut pr) = p.lock() {
                                let _ = pr.kill();
                            }
                        }
                        if let Some(aid) = app_id {
                            let adb = petak_core::run::resolve_adb_binary();
                            let _ = std::process::Command::new(&adb)
                                .args(["-s", &device_id, "shell", "am", "force-stop", &aid])
                                .status();
                        }
                    }
                }
            }
        }

        if let Ok(mut lc) = self.inner.logcat.lock() {
            if let Some(mut logcat) = lc.take() {
                let _ = logcat.stop();
            }
        }

        if let Ok(mut watcher) = self.inner.device_watcher.lock() {
            if let Some(mut proc) = watcher.take() {
                let _ = proc.kill();
            }
        }

        if let Ok(mut emus) = self.inner.spawned_emulators.lock() {
            for mut emu in emus.drain(..) {
                let _ = emu.kill();
            }
        }
    }
}

fn ensure_device_watcher(app: &tauri::AppHandle, state: &RunState) {
    let mut watcher_guard = match state.inner.device_watcher.lock() {
        Ok(g) => g,
        Err(_) => return,
    };
    if watcher_guard.is_some() {
        return;
    }

    let (tx, rx) = std::sync::mpsc::channel::<Vec<petak_core::run::Device>>();
    let spawn = petak_core::exec::SystemSpawn;
    match petak_core::run::watch_devices(&spawn, tx) {
        Ok(proc) => {
            *watcher_guard = Some(proc);
            drop(watcher_guard);

            let app_handle = app.clone();
            let state_clone = state.clone();
            std::thread::spawn(move || {
                while let Ok(devices) = rx.recv() {
                    if let Ok(mut cached) = state_clone.inner.cached_devices.lock() {
                        *cached = devices.clone();
                    }
                    let _ = app_handle.emit("devices-changed", devices);
                }
            });
        }
        Err(e) => {
            eprintln!("Warning: could not start device watcher: {}", e);
        }
    }
}

#[tauri::command]
pub async fn toolchain_detect(root: String) -> Result<petak_core::run::Toolchain, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let exec = petak_core::exec::SystemExec;
        Ok(petak_core::run::detect(std::path::Path::new(&root), &exec))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn devices_list(
    app: tauri::AppHandle,
    state: tauri::State<'_, RunState>,
) -> Result<Vec<petak_core::run::Device>, String> {
    ensure_device_watcher(&app, &state);

    let cached = state
        .inner
        .cached_devices
        .lock()
        .map(|c| c.clone())
        .unwrap_or_default();

    if !cached.is_empty() {
        return Ok(cached);
    }

    tauri::async_runtime::spawn_blocking(move || {
        let exec = petak_core::exec::SystemExec;
        let adb = petak_core::run::resolve_adb_binary();
        if let Ok(out) = exec.run(std::path::Path::new("."), &adb, &["devices", "-l"], &[], None) {
            if out.status.success() {
                let stdout = String::from_utf8_lossy(&out.stdout);
                return petak_core::run::parse_adb_devices(&stdout);
            }
        }
        Vec::new()
    })
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn devices_watch(
    app: tauri::AppHandle,
    state: tauri::State<'_, RunState>,
) -> Result<(), String> {
    ensure_device_watcher(&app, &state);
    if let Ok(cached) = state.inner.cached_devices.lock() {
        if !cached.is_empty() {
            let _ = app.emit("devices-changed", cached.clone());
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn avd_list() -> Result<Vec<petak_core::run::Avd>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let exec = petak_core::exec::SystemExec;
        Ok(petak_core::run::list_avds(&exec))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn emulator_start(
    state: tauri::State<'_, RunState>,
    avd: String,
    headless: Option<bool>,
) -> Result<(), String> {
    let state_inner = state.inner.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let is_headless = headless.unwrap_or_else(|| {
            #[cfg(unix)]
            {
                std::env::var("DISPLAY").is_err() && std::env::var("WAYLAND_DISPLAY").is_err()
            }
            #[cfg(not(unix))]
            {
                false
            }
        });
        let spawn = petak_core::exec::SystemSpawn;
        let proc = petak_core::run::start_emulator(&spawn, &avd, is_headless)
            .map_err(|e| e.to_string())?;

        if let Ok(mut emus) = state_inner.spawned_emulators.lock() {
            emus.push(proc);
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn run_configs_load(root: String) -> Result<petak_core::run::RunConfigFile, String> {
    tauri::async_runtime::spawn_blocking(move || {
        petak_core::run::load_run_config(std::path::Path::new(&root))
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn run_configs_save(
    root: String,
    file: petak_core::run::RunConfigFile,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        petak_core::run::save_run_config(std::path::Path::new(&root), &file)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunEventPayload {
    pub run_id: u32,
    pub event: petak_core::run::RunEvent,
}

#[tauri::command]
pub async fn run_start(
    app: tauri::AppHandle,
    state: tauri::State<'_, RunState>,
    root: String,
    config: petak_core::run::RunConfig,
    device_id: String,
) -> Result<u32, String> {
    let run_id = state
        .inner
        .next_run_id
        .fetch_add(1, std::sync::atomic::Ordering::SeqCst);

    let (event_tx, event_rx) = std::sync::mpsc::channel();
    let app_handle = app.clone();

    std::thread::spawn(move || {
        while let Ok(event) = event_rx.recv() {
            let _ = app_handle.emit(
                "run-event",
                RunEventPayload {
                    run_id,
                    event,
                },
            );
        }
    });

    match config.kind {
        petak_core::run::RunKind::Flutter => {
            let spawn = petak_core::exec::SystemSpawn;
            let root_path = std::path::PathBuf::from(&root);
            let dev_id = device_id.clone();
            let cfg = config.clone();

            let flutter_run = tauri::async_runtime::spawn_blocking(move || {
                petak_core::run::FlutterRun::start(&spawn, &root_path, &cfg, &dev_id, event_tx)
                    .map_err(|e| e.to_string())
            })
            .await
            .map_err(|e| e.to_string())??;

            if let Ok(mut runs) = state.inner.runs.lock() {
                runs.insert(
                    run_id,
                    ActiveRun::Flutter(std::sync::Arc::new(Mutex::new(flutter_run))),
                );
            }
            Ok(run_id)
        }
        petak_core::run::RunKind::Gradle => {
            let root_path = std::path::PathBuf::from(&root);
            let module = config.module.clone().unwrap_or_else(|| ":app".to_string());
            let variant = config.variant.clone().unwrap_or_else(|| "debug".to_string());
            let dev_id = device_id.clone();

            let resolved_app_id = config
                .application_id
                .clone()
                .or_else(|| petak_core::run::find_application_id(&root_path));
            let resolved_activity = config
                .activity
                .clone()
                .or_else(|| petak_core::run::find_launcher_activity(&root_path));

            if let Ok(mut runs) = state.inner.runs.lock() {
                runs.insert(
                    run_id,
                    ActiveRun::Gradle {
                        device_id: dev_id.clone(),
                        app_id: resolved_app_id.clone(),
                        proc: None,
                    },
                );
            }

            std::thread::spawn(move || {
                let spawn = petak_core::exec::SystemSpawn;
                let exec = petak_core::exec::SystemExec;

                let _ = event_tx.send(petak_core::run::RunEvent::State {
                    state: petak_core::run::AppState::Installing,
                });

                match petak_core::run::install(&spawn, &root_path, &module, &variant, event_tx.clone()) {
                    Ok(()) => {
                        let _ = event_tx.send(petak_core::run::RunEvent::Output {
                            stream: petak_core::run::OutputStream::Stdout,
                            line: "Gradle install finished. Launching activity...".to_string(),
                        });

                        match petak_core::run::launch(
                            &exec,
                            &dev_id,
                            resolved_app_id.as_deref(),
                            resolved_activity.as_deref(),
                            Some(&root_path),
                        ) {
                            Ok(()) => {
                                let pid = resolved_app_id
                                    .as_deref()
                                    .and_then(|id| petak_core::run::pidof(&exec, &dev_id, id).ok().flatten());

                                let _ = event_tx.send(petak_core::run::RunEvent::AppStarted {
                                    app_id: resolved_app_id.clone(),
                                    devtools_uri: None,
                                    vm_service_uri: None,
                                    pid,
                                });

                                let _ = event_tx.send(petak_core::run::RunEvent::State {
                                    state: petak_core::run::AppState::Running,
                                });
                            }
                            Err(e) => {
                                let _ = event_tx.send(petak_core::run::RunEvent::Output {
                                    stream: petak_core::run::OutputStream::Stderr,
                                    line: format!("Failed to launch Android activity: {}", e),
                                });
                                let _ = event_tx.send(petak_core::run::RunEvent::Stopped {
                                    code: Some(1),
                                });
                            }
                        }
                    }
                    Err(e) => {
                        let _ = event_tx.send(petak_core::run::RunEvent::Output {
                            stream: petak_core::run::OutputStream::Stderr,
                            line: format!("Gradle install failed: {}", e),
                        });
                        let _ = event_tx.send(petak_core::run::RunEvent::Stopped {
                            code: Some(1),
                        });
                    }
                }
            });

            Ok(run_id)
        }
    }
}

#[tauri::command]
pub async fn run_reload(
    state: tauri::State<'_, RunState>,
    run_id: u32,
    full: bool,
) -> Result<petak_core::run::ReloadResult, String> {
    let run_handle = {
        let guard = state.inner.runs.lock().map_err(|e| e.to_string())?;
        match guard.get(&run_id) {
            Some(ActiveRun::Flutter(fr)) => fr.clone(),
            Some(ActiveRun::Gradle { .. }) => {
                return Err("Hot reload is only supported for Flutter applications".to_string());
            }
            None => return Err(format!("Run session {} not found", run_id)),
        }
    };

    tauri::async_runtime::spawn_blocking(move || {
        let mut flutter = run_handle.lock().map_err(|e| e.to_string())?;
        flutter.reload(full).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn run_stop(
    state: tauri::State<'_, RunState>,
    run_id: u32,
) -> Result<(), String> {
    let run_opt = {
        let mut guard = state.inner.runs.lock().map_err(|e| e.to_string())?;
        guard.remove(&run_id)
    };

    if let Some(run) = run_opt {
        match run {
            ActiveRun::Flutter(fr) => {
                tauri::async_runtime::spawn_blocking(move || {
                    let mut flutter = fr.lock().map_err(|e| e.to_string())?;
                    flutter.stop().map_err(|e| e.to_string())
                })
                .await
                .map_err(|e| e.to_string())??;
            }
            ActiveRun::Gradle { proc, device_id, app_id } => {
                tauri::async_runtime::spawn_blocking(move || {
                    if let Some(p) = proc {
                        if let Ok(mut pr) = p.lock() {
                            let _ = pr.kill();
                        }
                    }
                    if let Some(aid) = app_id {
                        let adb = petak_core::run::resolve_adb_binary();
                        let _ = std::process::Command::new(&adb)
                            .args(["-s", &device_id, "shell", "am", "force-stop", &aid])
                            .status();
                    }
                    Ok::<(), String>(())
                })
                .await
                .map_err(|e| e.to_string())??;
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn logcat_start(
    app: tauri::AppHandle,
    state: tauri::State<'_, RunState>,
    device_id: String,
    app_id: Option<String>,
) -> Result<(), String> {
    {
        let mut lc_guard = state.inner.logcat.lock().map_err(|e| e.to_string())?;
        if let Some(mut existing) = lc_guard.take() {
            let _ = existing.stop();
        }
    }

    let dev_id = device_id.clone();
    let app_handle = app.clone();
    let state_inner = state.inner.clone();

    tauri::async_runtime::spawn_blocking(move || {
        let pid = if let Some(ref aid) = app_id {
            if let Ok(p) = aid.parse::<u32>() {
                Some(p)
            } else if !aid.trim().is_empty() {
                let exec = petak_core::exec::SystemExec;
                let mut resolved = None;
                for _ in 0..5 {
                    if let Ok(Some(p)) = petak_core::run::pidof(&exec, &dev_id, aid) {
                        resolved = Some(p);
                        break;
                    }
                    std::thread::sleep(std::time::Duration::from_millis(150));
                }
                resolved
            } else {
                None
            }
        } else {
            None
        };

        let (tx, rx) = std::sync::mpsc::channel::<Vec<petak_core::run::LogLine>>();
        let spawn = petak_core::exec::SystemSpawn;
        let logcat = petak_core::run::Logcat::start(&spawn, &dev_id, pid, tx)
            .map_err(|e| e.to_string())?;

        if let Ok(mut lc_guard) = state_inner.logcat.lock() {
            *lc_guard = Some(logcat);
        }

        std::thread::spawn(move || {
            while let Ok(batch) = rx.recv() {
                let _ = app_handle.emit("logcat-batch", batch);
            }
        });

        Ok::<(), String>(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn logcat_stop(state: tauri::State<'_, RunState>) -> Result<(), String> {
    let mut lc_guard = state.inner.logcat.lock().map_err(|e| e.to_string())?;
    if let Some(mut lc) = lc_guard.take() {
        let _ = lc.stop();
    }
    Ok(())
}

#[tauri::command]
pub async fn gradle_sync(root: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let exec = petak_core::exec::SystemExec;
        petak_core::run::sync(&exec, std::path::Path::new(&root))
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn gradle_status(
    app: tauri::AppHandle,
    root: String,
) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let exec = petak_core::exec::SystemExec;
        let running = petak_core::run::gradle_daemon_running(&exec, std::path::Path::new(&root))
            .map_err(|e| e.to_string())?;
        let _ = app.emit("gradle-daemon", serde_json::json!({ "running": running }));
        Ok(running)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn gradle_stop(
    app: tauri::AppHandle,
    root: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let exec = petak_core::exec::SystemExec;
        petak_core::run::gradle_stop(&exec, std::path::Path::new(&root))
            .map_err(|e| e.to_string())?;
        let _ = app.emit("gradle-daemon", serde_json::json!({ "running": false }));
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn open_url(url: String) -> Result<(), String> {
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err("Invalid URL: only http and https protocols are allowed".to_string());
    }

    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(target_os = "macos")]
        let mut cmd = std::process::Command::new("open");
        #[cfg(target_os = "windows")]
        let mut cmd = {
            let mut c = std::process::Command::new("cmd");
            c.args(["/c", "start", ""]);
            c
        };
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        let mut cmd = std::process::Command::new("xdg-open");

        cmd.arg(&url);
        cmd.spawn()
            .map_err(|e| format!("Failed to open URL: {}", e))?;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}
