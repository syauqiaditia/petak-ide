mod commands;

use std::sync::Mutex;
use tauri::menu::{MenuBuilder, SubmenuBuilder};
use tauri::{Emitter, Manager};

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
                if let Some(reg) = window.try_state::<commands::AppRegistry>() {
                    reg.shutdown_all();
                }
            }
        })
        .setup(|app| {
            let app_handle = app.handle().clone();
            let app_handle_for_events = app_handle.clone();
            let registry = std::sync::Arc::new(petak_core::lsp::Registry::new(
                std::sync::Arc::new(petak_core::lsp::WallClock),
                move |lang, root, event| {
                    match event {
                        petak_core::lsp::ServerEvent::Notification { method, params } => {
                            if method == "textDocument/publishDiagnostics" {
                                if let Some(uri_val) = params.get("uri").and_then(|u| u.as_str()) {
                                    let path = petak_core::lsp::registry::uri_to_path(uri_val)
                                        .map(|p| p.to_string_lossy().to_string())
                                        .unwrap_or_else(|| uri_val.to_string());
                                    let diagnostics = params.get("diagnostics").cloned().unwrap_or(serde_json::json!([]));
                                    let _ = app_handle_for_events.emit("lsp-diagnostics", serde_json::json!({
                                        "path": path,
                                        "diagnostics": diagnostics,
                                    }));
                                }
                            }
                        }
                        petak_core::lsp::ServerEvent::Status { state } => {
                            let _ = app_handle_for_events.emit("lsp-status", serde_json::json!({
                                "lang": lang.as_str(),
                                "root": root.to_string_lossy().to_string(),
                                "state": state,
                            }));
                        }
                        petak_core::lsp::ServerEvent::Crashed => {
                            let _ = app_handle_for_events.emit("lsp-status", serde_json::json!({
                                "lang": lang.as_str(),
                                "root": root.to_string_lossy().to_string(),
                                "state": "crashed",
                            }));
                        }
                        petak_core::lsp::ServerEvent::ApplyEdit { id, edit } => {
                            let _ = app_handle_for_events.emit("lsp-apply-edit", serde_json::json!({
                                "id": id,
                                "edit": edit,
                            }));
                        }
                    }
                },
            ));

            app.manage(registry.clone());

            let reg_tick = registry.clone();
            std::thread::spawn(move || {
                loop {
                    std::thread::sleep(std::time::Duration::from_secs(30));
                    reg_tick.tick();
                }
            });

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
            commands::git_status,
            commands::git_diff,
            commands::git_stage_files,
            commands::git_unstage_files,
            commands::git_stage_hunk,
            commands::git_unstage_hunk,
            commands::git_commit,
            commands::git_last_message,
            commands::git_log,
            commands::git_branches,
            commands::git_commit_files,
            commands::git_rebase_todo,
            commands::git_rebase_run,
            commands::git_rebase_continue,
            commands::git_rebase_abort,
            commands::git_rebase_state,
            commands::git_reword,
            commands::git_squash,
            commands::git_fixup,
            commands::git_drop,
            commands::git_reset,
            commands::git_cherry_pick,
            commands::git_revert,
            commands::git_branch_create,
            commands::git_branch_checkout,
            commands::git_branch_delete,
            commands::git_branch_rename,
            commands::git_backup_create,
            commands::git_backup_list,
            commands::git_backup_restore,
            commands::git_backup_delete,
            commands::git_conflicts,
            commands::git_resolve_block,
            commands::git_conflict_write,
            commands::git_op_state,
            commands::git_op_continue,
            commands::git_op_abort,
            commands::git_remotes,
            commands::git_fetch,
            commands::git_pull,
            commands::git_push,
            commands::recent_folders,
            commands::add_recent_folder,
            commands::mark_ready,
            commands::bench_log,
            commands::bench_mode,
            commands::test_mode,
            commands::test_repo_path,
            commands::index_build,
            commands::find_files,
            commands::grep,
            commands::term_open,
            commands::term_write,
            commands::term_resize,
            commands::term_close,
            commands::resize_window,
            commands::lsp_did_open,
            commands::lsp_did_change,
            commands::lsp_did_save,
            commands::lsp_did_close,
            commands::lsp_completion,
            commands::lsp_completion_resolve,
            commands::lsp_hover,
            commands::lsp_definition,
            commands::lsp_references,
            commands::lsp_prepare_rename,
            commands::lsp_rename,
            commands::lsp_format,
            commands::lsp_apply_workspace_edit_disk,
            commands::lsp_code_actions,
            commands::lsp_code_action_resolve,
            commands::lsp_execute_command,
            commands::lsp_apply_edit_result,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
