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
    let is_test = std::env::var("PETAK_TEST_P15").is_ok()
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
    std::env::var("PETAK_TEST_P15")
        .ok()
        .or_else(|| std::env::var("PETAK_TEST_P14").ok())
        .or_else(|| std::env::var("PETAK_TEST").ok())
        .or_else(|| std::env::var("PETAK_TEST_P12").ok())
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
