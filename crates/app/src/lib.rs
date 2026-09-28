mod commands;

use std::sync::Mutex;
use tauri::menu::{MenuBuilder, SubmenuBuilder};
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(Mutex::new(None::<notify::RecommendedWatcher>))
        .manage(Mutex::new(None::<petak_core::search::FileIndex>))
        .manage(commands::TermSessions::default())
        .manage(commands::TermCounter::new(1))
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed | tauri::WindowEvent::CloseRequested { .. } = event {
                if let Some(state) = window.try_state::<commands::TermSessions>() {
                    if let Ok(mut sessions) = state.lock() {
                        for (_, session) in sessions.drain() {
                            let _ = session.kill();
                        }
                    }
                }
            }
        })
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
            commands::git_branch,
            commands::recent_folders,
            commands::add_recent_folder,
            commands::mark_ready,
            commands::bench_log,
            commands::bench_mode,
            commands::test_mode,
            commands::index_build,
            commands::find_files,
            commands::grep,
            commands::term_open,
            commands::term_write,
            commands::term_resize,
            commands::term_close,
            commands::resize_window,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
