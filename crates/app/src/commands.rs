use tauri_plugin_dialog::DialogExt;

#[tauri::command]
pub fn list_dir(path: String) -> Result<Vec<petak_core::fs::Entry>, String> {
    petak_core::fs::list_dir(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn read_file(path: String) -> Result<String, String> {
    petak_core::fs::read_file(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pick_folder(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let folder = app.dialog().file().blocking_pick_folder();
    Ok(folder.map(|p| p.to_string()))
}

#[tauri::command]
pub fn mark_ready(ts_ms: u64) {
    println!("PETAK_READY {}", ts_ms);
}

#[tauri::command]
pub fn bench_log(line: String) -> Result<(), String> {
    use std::io::Write;
    let path = std::env::var("PETAK_BENCH_OUT").unwrap_or_else(|_| "/tmp/petak-bench.log".to_string());
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
