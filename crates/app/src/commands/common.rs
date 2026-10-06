use std::sync::Mutex;
use tauri::{Emitter, Manager};
use petak_core::exec::Exec;
use tauri_plugin_dialog::DialogExt;

#[derive(Default)]
pub struct CurrentProjectRoot(pub Mutex<Option<String>>);


pub fn recent_projects_file_path(app: &tauri::AppHandle) -> std::path::PathBuf {
    if let Ok(app_data) = app.path().app_data_dir() {
        app_data.join("recent_projects.json")
    } else {
        petak_core::recent::default_recent_projects_path()
            .unwrap_or_else(|| std::path::PathBuf::from("recent_projects.json"))
    }
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


#[tauri::command]
pub async fn accounts_check_token_status() -> Result<petak_core::accounts::TokenStatus, String> {
    tauri::async_runtime::spawn_blocking(petak_core::accounts::accounts_check_token_status)
        .await
        .map_err(|e| e.to_string())?
}

// ──────────── In-App Self-Updater ────────────

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheckResult {
    pub update_available: bool,
    pub current_version: String,
    pub latest_version: String,
    pub release_notes: String,
    pub release_url: String,
    pub download_url: Option<String>,
}

fn is_version_newer(latest: &str, current: &str) -> bool {
    let parse_parts = |v: &str| -> Vec<u32> {
        v.split('.')
            .filter_map(|p| p.chars().take_while(|c| c.is_ascii_digit()).collect::<String>().parse().ok())
            .collect()
    };
    let l_parts = parse_parts(latest);
    let c_parts = parse_parts(current);
    for (l, c) in l_parts.iter().zip(c_parts.iter()) {
        if l > c { return true; }
        if l < c { return false; }
    }
    l_parts.len() > c_parts.len()
}

#[tauri::command]
pub async fn app_check_update() -> Result<UpdateCheckResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let current_version = "0.8.2".to_string();
        let repo = "syauqiaditia/petak-ide";
        let url = format!("https://api.github.com/repos/{}/releases/latest", repo);

        let mut cmd = std::process::Command::new("curl");
        cmd.args(["-sL", "-H", "User-Agent: Petak-IDE", "-H", "Accept: application/vnd.github.v3+json"]);

        if let Ok(home) = std::env::var("HOME") {
            let pat_path = std::path::Path::new(&home).join(".github-pat");
            if let Ok(token) = std::fs::read_to_string(pat_path) {
                let tok = token.trim();
                if !tok.is_empty() {
                    cmd.args(["-H", &format!("Authorization: token {}", tok)]);
                }
            }
        }

        cmd.arg(&url);

        let output = cmd.output().map_err(|e| format!("Gagal menjalankan curl: {}", e))?;
        if !output.status.success() {
            return Err("Koneksi ke GitHub API gagal".to_string());
        }

        let json_str = String::from_utf8_lossy(&output.stdout);
        let val: serde_json::Value = serde_json::from_str(&json_str)
            .map_err(|e| format!("Format respon GitHub tidak valid: {}", e))?;

        let tag = val.get("tag_name")
            .and_then(|t| t.as_str())
            .unwrap_or("")
            .trim_start_matches('v')
            .to_string();

        if tag.is_empty() {
            return Ok(UpdateCheckResult {
                update_available: false,
                current_version: current_version.clone(),
                latest_version: current_version.clone(),
                release_notes: "".to_string(),
                release_url: "".to_string(),
                download_url: None,
            });
        }

        let is_newer = is_version_newer(&tag, &current_version);
        let release_url = val.get("html_url").and_then(|u| u.as_str()).unwrap_or("").to_string();
        let release_notes = val.get("body").and_then(|b| b.as_str()).unwrap_or("").to_string();

        let mut download_url = None;
        if let Some(assets) = val.get("assets").and_then(|a| a.as_array()) {
            #[cfg(target_os = "macos")]
            let target_name = "Petak-macos-app.zip";
            #[cfg(not(target_os = "macos"))]
            let target_name = "petak-linux-x86_64";

            for asset in assets {
                let name = asset.get("name").and_then(|n| n.as_str()).unwrap_or("");
                if name == target_name {
                    download_url = asset.get("browser_download_url").and_then(|u| u.as_str()).map(|s| s.to_string());
                    break;
                }
            }
        }

        Ok(UpdateCheckResult {
            update_available: is_newer,
            current_version,
            latest_version: tag,
            release_notes,
            release_url,
            download_url,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn app_apply_update(download_url: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let tmp_dir = std::env::temp_dir();

        #[cfg(target_os = "macos")]
        {
            let zip_path = tmp_dir.join("Petak-update.zip");
            let mut curl_cmd = std::process::Command::new("curl");
            curl_cmd.args(["-fSL", &download_url, "-o", zip_path.to_str().unwrap()]);

            if let Ok(home) = std::env::var("HOME") {
                let pat_path = std::path::Path::new(&home).join(".github-pat");
                if let Ok(token) = std::fs::read_to_string(pat_path) {
                    let tok = token.trim();
                    if !tok.is_empty() {
                        curl_cmd.args(["-H", &format!("Authorization: token {}", tok)]);
                    }
                }
            }

            let res = curl_cmd.status().map_err(|e| format!("Gagal mengunduh update: {}", e))?;
            if !res.success() {
                return Err("Gagal mengunduh file rilis dari GitHub".to_string());
            }

            let extract_dir = tmp_dir.join("petak-extract");
            let _ = std::fs::remove_dir_all(&extract_dir);
            std::fs::create_dir_all(&extract_dir).map_err(|e| e.to_string())?;

            let unzip_status = std::process::Command::new("unzip")
                .args(["-q", "-o", zip_path.to_str().unwrap(), "-d", extract_dir.to_str().unwrap()])
                .status()
                .map_err(|e| format!("Gagal mengekstrak update: {}", e))?;

            if !unzip_status.success() {
                return Err("Gagal mengekstrak Petak.app".to_string());
            }

            let new_app = extract_dir.join("Petak.app");
            let dest_app = std::path::Path::new("/Applications/Petak.app");

            let script = format!(
                r#"sleep 1
rm -rf "{dest}"
cp -R "{src}" "{dest}"
open "{dest}"
"#,
                dest = dest_app.display(),
                src = new_app.display()
            );

            let script_path = tmp_dir.join("petak_reopen.sh");
            std::fs::write(&script_path, script).map_err(|e| e.to_string())?;

            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let _ = std::fs::set_permissions(&script_path, std::fs::Permissions::from_mode(0o755));
            }

            let _ = std::process::Command::new("sh")
                .arg(&script_path)
                .spawn();

            std::process::exit(0);
        }

        #[cfg(not(target_os = "macos"))]
        {
            let bin_path = tmp_dir.join("petak-update-bin");
            let mut curl_cmd = std::process::Command::new("curl");
            curl_cmd.args(["-fSL", &download_url, "-o", bin_path.to_str().unwrap()]);
            let res = curl_cmd.status().map_err(|e| format!("Gagal mengunduh update: {}", e))?;
            if !res.success() {
                return Err("Gagal mengunduh file rilis".to_string());
            }

            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let _ = std::fs::set_permissions(&bin_path, std::fs::Permissions::from_mode(0o755));
            }

            let current_exe = std::env::current_exe().map_err(|e| e.to_string())?;
            let _ = std::fs::copy(&bin_path, &current_exe);

            let _ = std::process::Command::new(&current_exe).spawn();
            std::process::exit(0);
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

// ──────────── Batch 11 Wi-Fi Pairing ────────────


