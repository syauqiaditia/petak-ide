use std::sync::Mutex;
use petak_core::exec::Exec;
use tauri::{Emitter, Manager};
use tauri_plugin_dialog::DialogExt;

#[derive(Default)]
pub struct CurrentProjectRoot(pub Mutex<Option<String>>);

pub fn lh_store_dir(app: &tauri::AppHandle, root: &str) -> Result<std::path::PathBuf, String> {
    use petak_core::sha2::Digest;
    let canonical = std::path::Path::new(root)
        .canonicalize()
        .map_err(|e| e.to_string())?;
    let mut hasher = petak_core::sha2::Sha256::new();
    hasher.update(canonical.to_string_lossy().as_bytes());
    let hash = format!("{:x}", hasher.finalize());
    let prefix16 = &hash[..16];
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    let store = app_data.join("local-history").join(prefix16);
    std::fs::create_dir_all(&store).map_err(|e| e.to_string())?;
    Ok(store)
}

fn snapshot_file_if_small(store: &std::path::Path, full_path: &std::path::Path, rel: &str, kind: &str) {
    if let Ok(meta) = std::fs::metadata(full_path) {
        if meta.is_file() && meta.len() <= 2 * 1024 * 1024 {
            if let Ok(content) = std::fs::read(full_path) {
                let _ = petak_core::local_history::snapshot(store, rel, &content, kind);
            }
        }
    }
}

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
pub fn save_file(app: tauri::AppHandle, path: String, content: String) -> Result<(), String> {
    petak_core::fs::save_file(&path, &content).map_err(|e| e.to_string())?;

    let app_handle = app.clone();
    let file_path = path.clone();
    let content_bytes = content.into_bytes();

    std::thread::spawn(move || {
        if content_bytes.len() <= 2 * 1024 * 1024 {
            let root_opt = app_handle
                .try_state::<CurrentProjectRoot>()
                .and_then(|s| s.0.lock().ok().and_then(|r| r.clone()));

            let root = if let Some(r) = root_opt {
                r
            } else {
                let p = std::path::Path::new(&file_path);
                let mut curr = p.parent();
                let mut found_root = None;
                while let Some(dir) = curr {
                    if dir.join(".git").exists() {
                        found_root = Some(dir.to_string_lossy().to_string());
                        break;
                    }
                    curr = dir.parent();
                }
                match found_root {
                    Some(r) => r,
                    None => return,
                }
            };

            if let Ok(store) = lh_store_dir(&app_handle, &root) {
                let root_p = std::path::Path::new(&root);
                let p = std::path::Path::new(&file_path);
                let rel = if let Ok(r) = p.strip_prefix(root_p) {
                    r.to_string_lossy().to_string()
                } else {
                    file_path.clone()
                };
                let _ = petak_core::local_history::snapshot(&store, &rel, &content_bytes, "save");
            }
        }
    });

    if path.ends_with(".dart") {
        let path_obj = std::path::PathBuf::from(path);
        std::thread::spawn(move || {
            if let Ok(mut lock) = petak_core::suggest::global_suggest_index().write() {
                if let Some(ref mut idx) = *lock {
                    let _ = idx.update_file(&path_obj);
                }
            }
        });
    }

    Ok(())
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

    if let Some(curr_root_state) = app.try_state::<CurrentProjectRoot>() {
        if let Ok(mut lock) = curr_root_state.0.lock() {
            *lock = Some(root.clone());
        }
    }

    let app_for_prune = app.clone();
    let root_for_prune = root.clone();
    std::thread::spawn(move || {
        if let Ok(store) = lh_store_dir(&app_for_prune, &root_for_prune) {
            let _ = petak_core::local_history::prune(&store, 7, 200 * 1024 * 1024);
        }
        let file = recent_projects_file_path(&app_for_prune);
        let _ = petak_core::recent::recent_projects_add(&file, &root_for_prune);
    });

    let app_handle = app.clone();
    let root_path = root.clone();
    let watcher = tauri::async_runtime::spawn_blocking(move || {
        let app_handle_for_events = app_handle.clone();
        let app_handle_for_snap = app_handle.clone();
        let root_for_snap = root_path.clone();

        let (tx, rx) = std::sync::mpsc::channel::<Vec<String>>();

        std::thread::spawn(move || {
            if let Ok(store) = lh_store_dir(&app_handle_for_snap, &root_for_snap) {
                let root_p = std::path::Path::new(&root_for_snap);
                while let Ok(paths) = rx.recv() {
                    for p_str in paths {
                        let p = std::path::Path::new(&p_str);
                        if let Ok(rel) = p.strip_prefix(root_p) {
                            let rel_str = rel.to_string_lossy().to_string();
                            if petak_core::fsops::is_ignored_path(root_p, &rel_str) {
                                continue;
                            }
                            snapshot_file_if_small(&store, p, &rel_str, "external");
                        }
                        if p_str.ends_with(".dart") {
                            if let Ok(mut lock) = petak_core::suggest::global_suggest_index().write() {
                                if let Some(ref mut idx) = *lock {
                                    let _ = idx.update_file(p);
                                }
                            }
                        }
                    }
                }
            }
        });

        petak_core::watch::watch(std::path::Path::new(&root_path), move |paths| {
            let _ = app_handle_for_events.emit("fs-changed", FsChangedPayload { paths: paths.clone() });
            let _ = tx.send(paths);
        })
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())?;

    let app_for_bg_suggest = app.clone();
    let root_for_bg_suggest = root.clone();
    std::thread::spawn(move || {
        let _ = suggest_index_build(app_for_bg_suggest, Some(root_for_bg_suggest));
    });

    let mut lock = state.lock().map_err(|e| e.to_string())?;
    *lock = Some(watcher);
    Ok(())
}

pub fn recent_projects_file_path(app: &tauri::AppHandle) -> std::path::PathBuf {
    if let Ok(app_data) = app.path().app_data_dir() {
        app_data.join("recent_projects.json")
    } else {
        petak_core::recent::default_recent_projects_path()
            .unwrap_or_else(|| std::path::PathBuf::from("recent_projects.json"))
    }
}

#[tauri::command]
pub async fn pick_folder(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let folder = app.dialog().file().blocking_pick_folder();
    if let Some(ref p) = folder {
        let p_str = p.to_string();
        let file = recent_projects_file_path(&app);
        let _ = petak_core::recent::recent_projects_add(&file, &p_str);
    }
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
pub fn test_env(name: String) -> Option<String> {
    #[cfg(debug_assertions)]
    {
        if name.starts_with("PETAK_") {
            return std::env::var(&name).ok();
        }
    }
    None
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
pub async fn lsp_restart(
    app: tauri::AppHandle,
    language: String,
) -> Result<(), String> {
    let lang = match language.to_lowercase().trim() {
        "dart" => Some(petak_core::lsp::Lang::Dart),
        "kotlin" | "kt" => Some(petak_core::lsp::Lang::Kotlin),
        "swift" => Some(petak_core::lsp::Lang::Swift),
        _ => None,
    };
    if let Some(reg) = app.try_state::<AppRegistry>() {
        reg.restart(lang).map_err(|e| e.to_string())
    } else {
        Ok(())
    }
}

#[tauri::command]
pub async fn lsp_kotlin_log_path() -> Result<String, String> {
    let path = petak_core::toolchain::kotlin_ls_log_path();
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn lsp_did_open(
    state: tauri::State<'_, AppRegistry>,
    path: String,
    text: String,
) -> Result<(), String> {
    let registry = state.inner().clone();
    let p_buf = std::path::PathBuf::from(&path);
    let ext = p_buf.extension().and_then(|e| e.to_str()).unwrap_or("").to_string();
    if let Some(lang) = petak_core::lsp::Lang::from_extension(&ext) {
        if lang == petak_core::lsp::Lang::Kotlin {
            // Non-blocking initialization for Kotlin: run in background task so UI does not freeze during Gradle indexing
            tauri::async_runtime::spawn_blocking(move || {
                let _ = registry.did_open(&p_buf, lang, &text, None);
            });
            return Ok(());
        }
        tauri::async_runtime::spawn_blocking(move || {
            registry
                .did_open(&p_buf, lang, &text, None)
                .map_err(|e| format!("{:?}", e))
        })
        .await
        .map_err(|e| e.to_string())??;
    }
    Ok(())
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
                            let mut c = std::process::Command::new(&adb);
                            petak_core::toolchain::apply_env(&mut c);
                            let _ = c.args(["-s", &device_id, "shell", "am", "force-stop", &aid])
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

    // Background 3s periodic poll for changes (covers iOS devicectl & simctl)
    let app_poll = app.clone();
    std::thread::spawn(move || {
        let mut last_snap: Option<Vec<petak_core::run::DeviceInfo>> = None;
        loop {
            std::thread::sleep(std::time::Duration::from_secs(3));
            let exec = petak_core::exec::SystemExec;
            let current = petak_core::run::devices_snapshot(&exec);
            let changed = match &last_snap {
                Some(prev) => prev != &current.devices,
                None => true,
            };
            if changed {
                last_snap = Some(current.devices.clone());
                let _ = app_poll.emit("devices-changed", &current.devices);
            }
        }
    });
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
pub async fn toolchain_get_config() -> Result<petak_core::toolchain::ToolchainConfig, String> {
    Ok(petak_core::toolchain::load_config())
}

#[tauri::command]
pub async fn toolchain_save_config(config: petak_core::toolchain::ToolchainConfig) -> Result<(), String> {
    petak_core::toolchain::save_config(&config).map_err(|e| e.to_string())
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
pub async fn devices_refresh(
    app: tauri::AppHandle,
    state: tauri::State<'_, RunState>,
) -> Result<Vec<petak_core::run::DeviceInfo>, String> {
    ensure_device_watcher(&app, &state);

    let devs = tauri::async_runtime::spawn_blocking(move || {
        let exec = petak_core::exec::SystemExec;
        let snap = petak_core::run::devices_snapshot(&exec);
        snap.devices
    })
    .await
    .map_err(|e| e.to_string())?;

    let _ = app.emit("devices-changed", &devs);
    Ok(devs)
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
    app: tauri::AppHandle,
    state: tauri::State<'_, RunState>,
    avd: String,
    headless: Option<bool>,
) -> Result<(), String> {
    let is_headless = headless.unwrap_or(true);
    avd_start(app, state, avd, None, None, Some(is_headless)).await
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
            let check_dev_id = device_id.clone();
            let runnable_id = tauri::async_runtime::spawn_blocking(move || {
                let exec = petak_core::exec::SystemExec;
                let snapshot = petak_core::run::devices_snapshot(&exec);
                let runnable = petak_core::run::check_device_runnable(&snapshot, &check_dev_id)?;
                Ok::<String, String>(runnable.flutter_id.clone().unwrap_or(check_dev_id))
            })
            .await
            .map_err(|e| e.to_string())??;

            let spawn = petak_core::exec::SystemSpawn;
            let root_path = std::path::PathBuf::from(&root);
            let dev_id = runnable_id;
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
                        let mut c = std::process::Command::new(&adb);
                        petak_core::toolchain::apply_env(&mut c);
                        let _ = c.args(["-s", &device_id, "shell", "am", "force-stop", &aid])
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
pub async fn run_hot_restart(
    state: tauri::State<'_, RunState>,
    run_id: u32,
) -> Result<petak_core::run::ReloadResult, String> {
    run_reload(state, run_id, true).await
}

#[tauri::command]
pub async fn run_restart_connection(
    app: tauri::AppHandle,
    state: tauri::State<'_, RunState>,
) -> Result<(), String> {
    if let Ok(mut guard) = state.inner.device_watcher.lock() {
        if let Some(mut proc) = guard.take() {
            let _ = proc.kill();
        }
    }
    ensure_device_watcher(&app, &state);
    let _ = devices_refresh(app, state).await;
    Ok(())
}

#[tauri::command]
pub async fn run_restart_daemon(
    app: tauri::AppHandle,
    state: tauri::State<'_, RunState>,
    run_id: Option<u32>,
) -> Result<(), String> {
    let runs_to_stop: Vec<(u32, ActiveRun)> = {
        let mut guard = state.inner.runs.lock().map_err(|e| e.to_string())?;
        if let Some(id) = run_id {
            guard.remove(&id).map(|r| vec![(id, r)]).unwrap_or_default()
        } else {
            guard.drain().collect()
        }
    };

    for (id, run) in runs_to_stop {
        match run {
            ActiveRun::Flutter(fr) => {
                let _ = tauri::async_runtime::spawn_blocking(move || {
                    if let Ok(mut flutter) = fr.lock() {
                        let _ = flutter.stop();
                    }
                })
                .await;
            }
            ActiveRun::Gradle { proc, device_id, app_id } => {
                let _ = tauri::async_runtime::spawn_blocking(move || {
                    if let Some(p) = proc {
                        if let Ok(mut pr) = p.lock() {
                            let _ = pr.kill();
                        }
                    }
                    if let Some(aid) = app_id {
                        let adb = petak_core::run::resolve_adb_binary();
                        let mut c = std::process::Command::new(&adb);
                        petak_core::toolchain::apply_env(&mut c);
                        let _ = c.args(["-s", &device_id, "shell", "am", "force-stop", &aid])
                            .status();
                    }
                })
                .await;
            }
        }
        let _ = app.emit(
            "run-event",
            RunEventPayload {
                run_id: id,
                event: petak_core::run::RunEvent::Stopped { code: Some(0) },
            },
        );
    }

    run_restart_connection(app, state).await
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

#[tauri::command]
pub fn fs_create_file(root: String, rel: String, template: Option<String>) -> Result<String, String> {
    petak_core::fsops::create_file(std::path::Path::new(&root), &rel, template.as_deref())
        .map(|p| p.to_string_lossy().to_string())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn fs_create_dir(root: String, rel: String) -> Result<String, String> {
    petak_core::fsops::create_dir(std::path::Path::new(&root), &rel)
        .map(|p| p.to_string_lossy().to_string())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn fs_rename(app: tauri::AppHandle, root: String, from: String, to: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root_path = std::path::Path::new(&root);
        if let Ok(store) = lh_store_dir(&app, &root) {
            if let Ok(src_path) = petak_core::fsops::resolve_in_root(root_path, &from) {
                snapshot_file_if_small(&store, &src_path, &from, "before_rename");
            }
        }
        petak_core::fsops::rename(root_path, &from, &to).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn fs_move(root: String, srcs: Vec<String>, dest: String) -> Result<Vec<String>, String> {
    let src_refs: Vec<&str> = srcs.iter().map(|s| s.as_str()).collect();
    petak_core::fsops::move_into(std::path::Path::new(&root), &src_refs, &dest).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn fs_copy(root: String, srcs: Vec<String>, dest: String) -> Result<Vec<String>, String> {
    let src_refs: Vec<&str> = srcs.iter().map(|s| s.as_str()).collect();
    petak_core::fsops::copy_into(std::path::Path::new(&root), &src_refs, &dest).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn fs_duplicate(root: String, rel: String) -> Result<String, String> {
    petak_core::fsops::duplicate(std::path::Path::new(&root), &rel)
        .map(|p| p.to_string_lossy().to_string())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn fs_trash(app: tauri::AppHandle, root: String, rels: Vec<String>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root_path = std::path::Path::new(&root);
        if let Ok(store) = lh_store_dir(&app, &root) {
            for rel in &rels {
                if let Ok(p) = petak_core::fsops::resolve_in_root(root_path, rel) {
                    snapshot_file_if_small(&store, &p, rel, "before_delete");
                }
            }
        }
        let rel_refs: Vec<&str> = rels.iter().map(|s| s.as_str()).collect();
        petak_core::fsops::trash(root_path, &rel_refs).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn os_reveal(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("-R")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        let p = std::path::Path::new(&path);
        let target = if p.is_dir() { p } else { p.parent().unwrap_or(p) };
        std::process::Command::new("xdg-open")
            .arg(target)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg("/select,")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn os_open_default(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/c", "start", "", &path])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn lh_list(app: tauri::AppHandle, root: String, rel: String) -> Result<Vec<petak_core::local_history::Entry>, String> {
    let store = lh_store_dir(&app, &root)?;
    petak_core::local_history::list(&store, &rel).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn lh_read(app: tauri::AppHandle, root: String, id: String) -> Result<String, String> {
    let store = lh_store_dir(&app, &root)?;
    let bytes = petak_core::local_history::read(&store, &id).map_err(|e| e.to_string())?;
    Ok(String::from_utf8_lossy(&bytes).to_string())
}

#[tauri::command]
pub async fn lh_revert(app: tauri::AppHandle, root: String, id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let store = lh_store_dir(&app, &root)?;
        let entries = petak_core::local_history::list(&store, "")
            .map_err(|e| e.to_string())?;
        let entry = entries
            .into_iter()
            .find(|e| e.id == id)
            .ok_or_else(|| format!("Entry '{}' not found", id))?;

        let root_path = std::path::Path::new(&root);
        let target = petak_core::fsops::resolve_in_root(root_path, &entry.path).map_err(|e| e.to_string())?;
        let new_bytes = petak_core::local_history::read(&store, &id).map_err(|e| e.to_string())?;

        // 1. Snapshot kondisi sekarang dulu
        if target.exists() {
            if let Ok(current_bytes) = std::fs::read(&target) {
                let _ = petak_core::local_history::snapshot(&store, &entry.path, &current_bytes, "before_rollback");
            }
        }

        // 2. Tulis atomic (bytes mentah)
        petak_core::fs::save_file_bytes(&target, &new_bytes).map_err(|e| e.to_string())?;

        // 3. Snapshot new content as save
        let _ = petak_core::local_history::snapshot(&store, &entry.path, &new_bytes, "save");

        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn lh_label(app: tauri::AppHandle, root: String, rel: String, label: String) -> Result<petak_core::local_history::Entry, String> {
    let store = lh_store_dir(&app, &root)?;
    petak_core::local_history::put_label(&store, &rel, &label).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn lh_snapshot(app: tauri::AppHandle, root: String, rel: String, kind: String) -> Result<Option<petak_core::local_history::Entry>, String> {
    let store = lh_store_dir(&app, &root)?;
    let root_path = std::path::Path::new(&root);
    let target = petak_core::fsops::resolve_in_root(root_path, &rel).map_err(|e| e.to_string())?;
    if let Ok(meta) = std::fs::metadata(&target) {
        if meta.is_file() && meta.len() <= 2 * 1024 * 1024 {
            let bytes = std::fs::read(&target).map_err(|e| e.to_string())?;
            return petak_core::local_history::snapshot(&store, &rel, &bytes, &kind).map_err(|e| e.to_string());
        }
    }
    Ok(None)
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

pub struct MirrorState {
    pub sessions: Mutex<std::collections::HashMap<String, petak_core::mirror::session::MirrorSession>>,
}

impl Default for MirrorState {
    fn default() -> Self {
        Self {
            sessions: Mutex::new(std::collections::HashMap::new()),
        }
    }
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MirrorFramePayload {
    pub serial: String,
    pub data: Vec<u8>,
}

fn is_direct_adb_serial(s: &str) -> bool {
    let trimmed = s.trim();
    trimmed.starts_with("emulator-")
        || trimmed.starts_with("usb:")
        || trimmed.starts_with("adb-")
        || trimmed.contains("._adb-tls")
        || trimmed.contains(':')
}

#[tauri::command]
pub async fn mirror_start(
    app: tauri::AppHandle,
    state: tauri::State<'_, MirrorState>,
    serial: String,
    max_size: Option<u16>,
) -> Result<petak_core::mirror::session::MirrorInfo, String> {
    let exec = petak_core::exec::SystemExec;
    let resolved_serial = if is_direct_adb_serial(&serial) {
        serial.clone()
    } else {
        petak_core::run::resolve_running_avd_serial(&exec, &serial)
            .unwrap_or_else(|| serial.clone())
    };
    let serial_for_start = resolved_serial.clone();
    let max = max_size.unwrap_or(1920);

    let (info, session, frame_rx, status_rx) =
        tauri::async_runtime::spawn_blocking(move || {
            petak_core::mirror::session::MirrorSession::start(&serial_for_start, max)
                .map_err(|e| e.to_string())
        })
        .await
        .map_err(|e| e.to_string())??;

    // Status event forwarder
    let app_status = app.clone();
    let serial_for_status = serial.clone();
    let actual_status_serial = resolved_serial.clone();
    std::thread::spawn(move || {
        while let Ok(status) = status_rx.recv() {
            let _ = app_status.emit(
                "mirror-status",
                serde_json::json!({ "serial": serial_for_status, "status": status }),
            );
            if actual_status_serial != serial_for_status {
                let _ = app_status.emit(
                    "mirror-status",
                    serde_json::json!({ "serial": actual_status_serial, "status": status }),
                );
            }
        }
    });

    // Frame forwarder
    let app_frame = app.clone();
    let serial_for_frame = serial.clone();
    let actual_frame_serial = resolved_serial.clone();
    std::thread::spawn(move || {
        let mut last_config: Option<Vec<u8>> = None;
        while let Ok(packet) = frame_rx.recv() {
            let is_config = !packet.is_empty() && packet[0] == 0;
            let is_key = !packet.is_empty() && packet[0] == 1;

            if is_config {
                last_config = Some(packet.clone());
            } else if is_key {
                if let Some(cfg) = &last_config {
                    let _ = app_frame.emit(
                        "mirror-frame",
                        MirrorFramePayload {
                            serial: serial_for_frame.clone(),
                            data: cfg.clone(),
                        },
                    );
                    if actual_frame_serial != serial_for_frame {
                        let _ = app_frame.emit(
                            "mirror-frame",
                            MirrorFramePayload {
                                serial: actual_frame_serial.clone(),
                                data: cfg.clone(),
                            },
                        );
                    }
                }
            }

            let _ = app_frame.emit(
                "mirror-frame",
                MirrorFramePayload {
                    serial: serial_for_frame.clone(),
                    data: packet.clone(),
                },
            );
            if actual_frame_serial != serial_for_frame {
                let _ = app_frame.emit(
                    "mirror-frame",
                    MirrorFramePayload {
                        serial: actual_frame_serial.clone(),
                        data: packet,
                    },
                );
            }
        }
    });

    if let Ok(mut sessions) = state.sessions.lock() {
        sessions.insert(serial.clone(), session);
    }

    Ok(info)
}

#[tauri::command]
pub async fn mirror_stop(
    state: tauri::State<'_, MirrorState>,
    serial: String,
) -> Result<(), String> {
    let mut sessions = state.sessions.lock().map_err(|e| e.to_string())?;
    let target = serial.trim();
    if target == "all" || target.is_empty() {
        sessions.clear();
        return Ok(());
    }

    let removed = if let Some(s) = sessions.remove(target) {
        Some(s)
    } else {
        let exec = petak_core::exec::SystemExec;
        let alt = if is_direct_adb_serial(target) {
            None
        } else {
            petak_core::run::resolve_running_avd_serial(&exec, target)
        };
        let found_key = alt.as_ref().and_then(|a| {
            if sessions.contains_key(a) {
                Some(a.clone())
            } else {
                None
            }
        }).or_else(|| {
            sessions.keys().find(|k| {
                *k == target
                    || k.eq_ignore_ascii_case(target)
                    || (!target.is_empty() && (k.starts_with(target) || target.starts_with(k.as_str())))
                    || (!is_direct_adb_serial(k) && petak_core::run::resolve_running_avd_serial(&exec, k).as_deref() == Some(target))
                    || alt.as_deref() == Some(k.as_str())
            }).cloned()
        });
        found_key.and_then(|k| sessions.remove(&k))
    };
    // Drop kills the server process + removes forward
    drop(removed);
    Ok(())
}

#[tauri::command]
pub async fn mirror_input(
    state: tauri::State<'_, MirrorState>,
    serial: String,
    event: Option<petak_core::mirror::control::InputEvent>,
    ev: Option<petak_core::mirror::control::InputEvent>,
) -> Result<(), String> {
    let input_ev = event.or(ev).ok_or_else(|| "missing input event".to_string())?;
    let sessions = state.sessions.lock().map_err(|e| e.to_string())?;
    if let Some(session) = sessions.get(&serial) {
        session.send_input(&input_ev).map_err(|e| e.to_string())
    } else {
        let exec = petak_core::exec::SystemExec;
        let alt = if is_direct_adb_serial(&serial) {
            None
        } else {
            petak_core::run::resolve_running_avd_serial(&exec, &serial)
        };
        let found = alt.as_ref().and_then(|a| sessions.get(a)).or_else(|| {
            sessions.iter().find(|(k, _)| {
                *k == &serial
                    || k.eq_ignore_ascii_case(&serial)
                    || (!serial.is_empty() && (k.starts_with(&serial) || serial.starts_with(k.as_str())))
                    || (!is_direct_adb_serial(k) && petak_core::run::resolve_running_avd_serial(&exec, k).as_deref() == Some(&serial))
            }).map(|(_, v)| v)
        });
        if let Some(session) = found {
            session.send_input(&input_ev).map_err(|e| e.to_string())
        } else {
            Err(format!("No mirror session for {}", serial))
        }
    }
}

#[tauri::command]
pub async fn mirror_screenshot(
    serial: String,
    path: Option<String>,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let exec = petak_core::exec::SystemExec;
        let resolved = if is_direct_adb_serial(&serial) {
            serial
        } else {
            petak_core::run::resolve_running_avd_serial(&exec, &serial).unwrap_or(serial)
        };
        petak_core::mirror::session::take_screenshot(&exec, &resolved, path.as_deref())
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn mirror_open(
    app: tauri::AppHandle,
    state: tauri::State<'_, MirrorState>,
    device_id: String,
    max_size: Option<u16>,
) -> Result<petak_core::mirror::session::MirrorInfo, String> {
    mirror_start(app, state, device_id, max_size).await
}

fn append_emulator_log(line: &str) {
    petak_core::run::append_emulator_log(line);
}

// ──────────── Batch 2 commands ────────────

#[tauri::command]
pub async fn devices_snapshot() -> Result<petak_core::run::DevicesSnapshot, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let exec = petak_core::exec::SystemExec;
        Ok(petak_core::run::devices_snapshot(&exec))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn avd_start(
    app: tauri::AppHandle,
    state: tauri::State<'_, RunState>,
    name: String,
    cold: Option<bool>,
    wipe_data: Option<bool>,
    headless: Option<bool>,
) -> Result<(), String> {
    let _state_inner = state.inner.clone();
    let app_clone = app.clone();
    let avd_name = name.clone();
    let is_cold = cold.unwrap_or(false);
    let is_wipe = wipe_data.unwrap_or(false);

    tauri::async_runtime::spawn_blocking(move || {
        let is_headless = headless.unwrap_or(true);

        append_emulator_log(&format!("Starting AVD '{}' (cold={}, wipe={}, headless={})", avd_name, is_cold, is_wipe, is_headless));

        // 1. Emit booting status
        let _ = app_clone.emit(
            "emulator-status",
            serde_json::json!({
                "id": avd_name,
                "state": "booting"
            }),
        );

        let emu_bin = petak_core::run::resolve_emulator_binary();
        append_emulator_log(&format!("Resolved emulator binary: {}", emu_bin));

        // 2. Spawn detached process
        let mut child = match petak_core::run::spawn_emulator_detached(
            &avd_name,
            is_cold,
            is_wipe,
            is_headless,
        ) {
            Ok(c) => {
                append_emulator_log(&format!("Successfully spawned detached emulator PID: {:?}", c.id()));
                c
            }
            Err(e) => {
                let err_msg = format!("Gagal menjalankan emulator: {}", e);
                append_emulator_log(&format!("Failed to spawn emulator '{}': {}", avd_name, err_msg));
                let _ = app_clone.emit(
                    "emulator-status",
                    serde_json::json!({
                        "id": avd_name,
                        "state": "failed",
                        "error": err_msg
                    }),
                );
                return Err(err_msg);
            }
        };

        // 3. Monitor child stderr and boot status in background thread
        let app_mon = app_clone.clone();
        let mon_avd = avd_name.clone();
        std::thread::spawn(move || {
            use std::io::BufRead;
            let mut stderr_lines: std::collections::VecDeque<String> =
                std::collections::VecDeque::with_capacity(30);
            let mut booted = false;
            let mut found_serial: Option<String> = None;
            let start_time = std::time::Instant::now();

            if let Some(stderr) = child.stderr.take() {
                let reader = std::io::BufReader::new(stderr);
                let (tx_line, rx_line) = std::sync::mpsc::channel();
                std::thread::spawn(move || {
                    for line in reader.lines().flatten() {
                        if tx_line.send(line).is_err() {
                            break;
                        }
                    }
                });

                while start_time.elapsed() < std::time::Duration::from_secs(120) {
                    while let Ok(line) = rx_line.try_recv() {
                        append_emulator_log(&format!("[stderr] {}", line));
                        if stderr_lines.len() >= 30 {
                            stderr_lines.pop_front();
                        }
                        stderr_lines.push_back(line);
                    }

                    // Check if child exited prematurely
                    if let Ok(Some(status)) = child.try_wait() {
                        if !status.success()
                            || start_time.elapsed() < std::time::Duration::from_secs(10)
                        {
                            let collected: Vec<String> = stderr_lines.into_iter().collect();
                            let err_text = if collected.is_empty() { format!("Emulator exited with {}", status) } else { collected.join("\n") };
                            append_emulator_log(&format!("Emulator child exited with failure {}: {}", status, err_text));
                            let _ = app_mon.emit(
                                "emulator-status",
                                serde_json::json!({
                                    "id": mon_avd,
                                    "state": "failed",
                                    "error": err_text
                                }),
                            );
                            return;
                        }
                    }

                    // Poll adb devices to find the emulator serial
                    let adb = petak_core::run::resolve_adb_binary();
                    if let Ok(out) = std::process::Command::new(&adb).args(["devices"]).output() {
                        let text = String::from_utf8_lossy(&out.stdout);
                        for l in text.lines() {
                            let parts: Vec<&str> = l.split_whitespace().collect();
                            if parts.len() >= 2 && parts[0].starts_with("emulator-") && parts[1] == "device" {
                                let serial = parts[0];
                                found_serial = Some(serial.to_string());
                                if let Some(pid) = petak_core::run::get_emulator_pid(&mon_avd) {
                                    petak_core::run::record_emulator_pid(serial, pid);
                                }

                                // Check boot completed
                                if let Ok(boot_out) = std::process::Command::new(&adb)
                                    .args(["-s", serial, "shell", "getprop", "sys.boot_completed"])
                                    .output()
                                {
                                    let val = String::from_utf8_lossy(&boot_out.stdout).trim().to_string();
                                    if val == "1" {
                                        booted = true;
                                        break;
                                    }
                                }
                            }
                        }
                    }

                    if booted {
                        break;
                    }

                    std::thread::sleep(std::time::Duration::from_millis(1500));
                }
            }

            if booted || found_serial.is_some() || start_time.elapsed() >= std::time::Duration::from_secs(15) {
                append_emulator_log(&format!("AVD '{}' is running (serial: {:?})", mon_avd, found_serial));
                let mut status_payload = serde_json::json!({
                    "id": mon_avd,
                    "state": "running"
                });
                let mut ready_payload = serde_json::json!({
                    "id": mon_avd,
                    "kind": "android-avd"
                });
                if let Some(ref ser) = found_serial {
                    if let Some(obj) = status_payload.as_object_mut() {
                        obj.insert("serial".to_string(), serde_json::Value::String(ser.clone()));
                    }
                    if let Some(obj) = ready_payload.as_object_mut() {
                        obj.insert("serial".to_string(), serde_json::Value::String(ser.clone()));
                    }
                }
                let _ = app_mon.emit("emulator-status", status_payload);
                let _ = app_mon.emit("device-ready", ready_payload);
            } else {
                let collected: Vec<String> = stderr_lines.into_iter().collect();
                let err_text = if collected.is_empty() { "Timeout menunggu emulator booting".to_string() } else { collected.join("\n") };
                append_emulator_log(&format!("AVD '{}' failed/timed out: {}", mon_avd, err_text));
                let _ = app_mon.emit(
                    "emulator-status",
                    serde_json::json!({
                        "id": mon_avd,
                        "state": "failed",
                        "error": err_text
                    }),
                );
            }
        });

        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn avd_stop(name: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let exec = petak_core::exec::SystemExec;
        petak_core::run::avd_stop(&exec, &name).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn avd_wipe(name: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        petak_core::run::avd_wipe(&name).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn avd_delete(name: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        petak_core::run::avd_delete(&name).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn sim_boot(app: tauri::AppHandle, udid: String) -> Result<(), String> {
    let app_clone = app.clone();
    let udid_clone = udid.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _ = app_clone.emit(
            "emulator-status",
            serde_json::json!({
                "id": udid_clone,
                "state": "booting"
            }),
        );
        let exec = petak_core::exec::SystemExec;
        petak_core::run::simctl_boot(&exec, &udid_clone).map_err(|e| e.to_string())?;
        let _ = app_clone.emit(
            "emulator-status",
            serde_json::json!({
                "id": udid_clone,
                "state": "running"
            }),
        );
        let _ = app_clone.emit(
            "device-ready",
            serde_json::json!({
                "id": udid_clone,
                "kind": "ios-sim"
            }),
        );
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn sim_shutdown(app: tauri::AppHandle, udid: String) -> Result<(), String> {
    let app_clone = app.clone();
    let udid_clone = udid.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let exec = petak_core::exec::SystemExec;
        let res = petak_core::run::simctl_shutdown(&exec, &udid_clone).map_err(|e| e.to_string());
        let _ = app_clone.emit(
            "emulator-status",
            serde_json::json!({
                "id": udid_clone,
                "state": "stopped"
            }),
        );
        res
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn sim_open_app() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        petak_core::run::open_simulator_app().map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn kotlin_ls_status() -> Result<petak_core::toolchain::KotlinLsStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        Ok(petak_core::toolchain::kotlin_ls_status())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn kotlin_ls_install(app: tauri::AppHandle) -> Result<(), String> {
    let app_clone = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        petak_core::toolchain::kotlin_ls_install(|stage, percent, message| {
            let _ = app_clone.emit(
                "kotlin-ls-progress",
                serde_json::json!({
                    "stage": stage,
                    "percent": percent,
                    "message": message,
                }),
            );
            let _ = app_clone.emit(
                "kls-install-progress",
                serde_json::json!({
                    "stage": stage,
                    "pct": percent,
                    "message": message,
                    "error": if stage == "error" { Some(message) } else { None },
                }),
            );
        })
    })
    .await
    .map_err(|e| e.to_string())??;

    if let Some(reg) = app.try_state::<AppRegistry>() {
        let _ = reg.restart(Some(petak_core::lsp::Lang::Kotlin));
    }
    Ok(())
}

#[tauri::command]
pub async fn kls_install(app: tauri::AppHandle) -> Result<(), String> {
    kotlin_ls_install(app).await
}

#[tauri::command]
pub async fn format_document(
    path: Option<String>,
    lang: String,
    text: String,
    range: Option<petak_core::format::FormatRange>,
) -> Result<petak_core::format::FormatResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let eff_lang = if lang.is_empty() {
            path.as_deref()
                .and_then(|p| std::path::Path::new(p).extension())
                .and_then(|e| e.to_str())
                .unwrap_or("")
                .to_string()
        } else {
            lang
        };

        petak_core::format::format_text(&eff_lang, &text, range).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn mirror_permission_status(
    device_id: Option<String>,
) -> Result<petak_core::mirror::MirrorPermissionStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        Ok(petak_core::mirror::check_screen_capture_permission(
            device_id.as_deref(),
        ))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn open_screen_recording_settings() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        petak_core::mirror::open_screen_recording_settings().map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn mirror_camera_permission() -> Result<petak_core::mirror::CameraPermissionStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        Ok(petak_core::mirror::check_camera_permission())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn open_privacy_camera() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        petak_core::mirror::open_privacy_camera().map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

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

fn resolve_cmd_root(app: &tauri::AppHandle, root_opt: Option<String>) -> Result<String, String> {
    if let Some(r) = root_opt {
        if !r.trim().is_empty() {
            return Ok(r);
        }
    }
    if let Some(curr_root_state) = app.try_state::<CurrentProjectRoot>() {
        if let Ok(lock) = curr_root_state.0.lock() {
            if let Some(ref r) = *lock {
                return Ok(r.clone());
            }
        }
    }
    Err("Project root not specified and no project currently open".to_string())
}

#[tauri::command]
pub async fn recent_projects_list(
    app: tauri::AppHandle,
) -> Result<Vec<petak_core::recent::RecentProject>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let file = recent_projects_file_path(&app);
        petak_core::recent::recent_projects_list(&file).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn recent_projects_add(
    app: tauri::AppHandle,
    path: String,
) -> Result<Vec<petak_core::recent::RecentProject>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let file = recent_projects_file_path(&app);
        petak_core::recent::recent_projects_add(&file, &path).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn recent_projects_remove(
    app: tauri::AppHandle,
    path: String,
) -> Result<Vec<petak_core::recent::RecentProject>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let file = recent_projects_file_path(&app);
        petak_core::recent::recent_projects_remove(&file, &path).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

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

pub fn suggest_app_data_dir(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    app.path().app_data_dir().ok().or_else(petak_core::suggest::default_app_data_dir)
}

#[tauri::command]
pub async fn suggest_index_build(
    app: tauri::AppHandle,
    root: Option<String>,
) -> Result<(), String> {
    let resolved_root = resolve_cmd_root(&app, root)?;
    let app_data = suggest_app_data_dir(&app);

    std::thread::spawn(move || {
        let root_p = std::path::Path::new(&resolved_root);
        let mut index = petak_core::suggest::SuggestIndex::load_from_disk(root_p, app_data.as_deref())
            .unwrap_or_else(|_| {
                let mut idx = petak_core::suggest::SuggestIndex::new(root_p);
                if let Some(ref dir) = app_data {
                    idx.set_app_data_dir(dir.clone());
                }
                idx
            });

        let _ = index.build();

        if let Ok(mut lock) = petak_core::suggest::global_suggest_index().write() {
            *lock = Some(index);
        }
    });

    Ok(())
}

#[tauri::command]
pub async fn suggest_index_update(
    app: tauri::AppHandle,
    path: String,
    root: Option<String>,
) -> Result<(), String> {
    let resolved_root = resolve_cmd_root(&app, root).ok();
    let app_data = suggest_app_data_dir(&app);

    std::thread::spawn(move || {
        let path_obj = std::path::Path::new(&path);
        {
            if let Ok(mut lock) = petak_core::suggest::global_suggest_index().write() {
                if let Some(ref mut idx) = *lock {
                    let _ = idx.update_file(path_obj);
                    return;
                }
            }
        }

        if let Some(ref r) = resolved_root {
            let root_p = std::path::Path::new(r);
            if let Ok(mut idx) = petak_core::suggest::SuggestIndex::load_from_disk(root_p, app_data.as_deref()) {
                let _ = idx.update_file(path_obj);
                if let Ok(mut lock) = petak_core::suggest::global_suggest_index().write() {
                    *lock = Some(idx);
                }
            }
        }
    });

    Ok(())
}

#[tauri::command]
pub async fn suggest_query(
    app: tauri::AppHandle,
    prefix: String,
    lang: Option<String>,
    limit: Option<usize>,
    root: Option<String>,
) -> Result<Vec<petak_core::suggest::SuggestItem>, String> {
    let app_data = suggest_app_data_dir(&app);
    if !petak_core::suggest::get_editor_ghost_text(app_data.as_deref()) {
        return Ok(Vec::new());
    }

    {
        if let Ok(lock) = petak_core::suggest::global_suggest_index().read() {
            if let Some(ref idx) = *lock {
                return Ok(idx.suggest_query(&prefix, lang.as_deref(), limit));
            }
        }
    }

    if let Ok(resolved_root) = resolve_cmd_root(&app, root) {
        let root_p = std::path::Path::new(&resolved_root);
        if let Ok(idx) = petak_core::suggest::SuggestIndex::load_from_disk(root_p, app_data.as_deref()) {
            let res = idx.suggest_query(&prefix, lang.as_deref(), limit);
            if let Ok(mut lock) = petak_core::suggest::global_suggest_index().write() {
                *lock = Some(idx);
            }
            return Ok(res);
        }
    }

    Ok(Vec::new())
}

#[tauri::command]
pub fn setting_get(
    app: tauri::AppHandle,
    key: String,
) -> Result<Option<serde_json::Value>, String> {
    let app_data = suggest_app_data_dir(&app);
    Ok(petak_core::suggest::get_setting(app_data.as_deref(), &key))
}

#[tauri::command]
pub fn setting_set(
    app: tauri::AppHandle,
    key: String,
    value: serde_json::Value,
) -> Result<(), String> {
    let app_data = suggest_app_data_dir(&app);
    petak_core::suggest::set_setting(app_data.as_deref(), &key, value).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn editor_ghost_text_get(app: tauri::AppHandle) -> Result<bool, String> {
    let app_data = suggest_app_data_dir(&app);
    Ok(petak_core::suggest::get_editor_ghost_text(app_data.as_deref()))
}

#[tauri::command]
pub fn editor_ghost_text_set(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    let app_data = suggest_app_data_dir(&app);
    petak_core::suggest::set_editor_ghost_text(app_data.as_deref(), enabled).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn accounts_get() -> Result<petak_core::accounts::AccountInfo, String> {
    Ok(petak_core::accounts::accounts_get())
}

#[tauri::command]
pub fn accounts_save(url: String, token: String) -> Result<(), String> {
    petak_core::accounts::accounts_save(&url, &token)
}

#[tauri::command]
pub async fn accounts_test() -> Result<petak_core::accounts::AccountTestResult, String> {
    tauri::async_runtime::spawn_blocking(petak_core::accounts::accounts_test)
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn accounts_clear() -> Result<(), String> {
    petak_core::accounts::accounts_clear()
}

pub use crate::agent_commands::*;
#[path = "mr_commands.rs"] pub mod mr_commands; pub use mr_commands::*;

use tauri::ipc::Response;

pub fn test_channel_compilation(ch: tauri::ipc::Channel<Response>) {
    let _ = ch.send(Response::new(vec![1, 2, 3]));
}
