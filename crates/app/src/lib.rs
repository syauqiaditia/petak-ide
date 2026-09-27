mod commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::list_dir,
            commands::read_file,
            commands::pick_folder,
            commands::mark_ready,
            commands::bench_log,
            commands::bench_mode,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
