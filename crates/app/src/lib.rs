mod commands;

use std::sync::Mutex;
use tauri::menu::{MenuBuilder, SubmenuBuilder};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(Mutex::new(None::<notify::RecommendedWatcher>))
        .setup(|app| {
            #[cfg(target_os = "macos")]
            {
                let app_handle = app.handle();
                let menu = MenuBuilder::new(app_handle)
                    .items(&[
                        &SubmenuBuilder::new(app_handle, "Petak")
                            .about(None)
                            .separator()
                            .services()
                            .separator()
                            .hide()
                            .hide_others()
                            .show_all()
                            .separator()
                            .quit()
                            .build()?,
                        &SubmenuBuilder::new(app_handle, "File")
                            .build()?,
                        &SubmenuBuilder::new(app_handle, "Edit")
                            .undo()
                            .redo()
                            .separator()
                            .cut()
                            .copy()
                            .paste()
                            .select_all()
                            .build()?,
                        &SubmenuBuilder::new(app_handle, "Window")
                            .minimize()
                            .build()?,
                    ])
                    .build()?;
                app.set_menu(menu)?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_dir,
            commands::read_file,
            commands::save_file,
            commands::watch_root,
            commands::pick_folder,
            commands::recent_folders,
            commands::add_recent_folder,
            commands::mark_ready,
            commands::bench_log,
            commands::bench_mode,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
