use std::sync::Mutex;
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
    let is_test = std::env::var("PETAK_TEST_P23").is_ok()
        || std::env::var("PETAK_TEST_P22").is_ok()
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
