use std::sync::Mutex;
use tauri::{Emitter, Manager};
use petak_core::exec::Exec;
use tauri_plugin_dialog::DialogExt;
use super::*;

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


pub fn snapshot_file_if_small(store: &std::path::Path, full_path: &std::path::Path, rel: &str, kind: &str) {
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
pub fn read_file_base64(path: String) -> Result<String, String> {
    petak_core::fs::read_file_base64(&path).map_err(|e| e.to_string())
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


pub fn resolve_cmd_root(app: &tauri::AppHandle, root_opt: Option<String>) -> Result<String, String> {
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


