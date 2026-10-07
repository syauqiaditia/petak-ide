mod agent_commands;
mod commands;
mod menu;
mod mr_commands;
mod test_commands;

use std::sync::Mutex;
use tauri::{Emitter, Manager};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(Mutex::new(None::<notify::RecommendedWatcher>))
        .manage(Mutex::new(None::<petak_core::search::FileIndex>))
        .manage(commands::TermSessions::default())
        .manage(commands::TermCounter::new(1))
        .manage(commands::RunState::default())
        .manage(commands::MirrorState::default())
        .manage(commands::CurrentProjectRoot::default())
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed | tauri::WindowEvent::CloseRequested { .. } = event
            {
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
                if let Some(run_state) = window.try_state::<commands::RunState>() {
                    run_state.shutdown_all();
                }
                if let Some(mirror_state) = window.try_state::<commands::MirrorState>() {
                    if let Ok(mut sessions) = mirror_state.sessions.lock() {
                        sessions.clear();
                    }
                }
                if let Some(agent_state) = window.try_state::<commands::AgentState>() {
                    agent_state.manager.shutdown_all();
                }
            }
        })
        .on_menu_event(|app_handle, event| {
            let item_id = event.id().as_ref();
            if let Some(window) = app_handle.get_webview_window("main") {
                let _ = window.emit("menu-action", item_id);
            } else {
                let _ = app_handle.emit("menu-action", item_id);
            }
        })
        .setup(|app| {
            let app_handle = app.handle().clone();
            let app_handle_for_events = app_handle.clone();
            let registry = std::sync::Arc::new(petak_core::lsp::Registry::new(
                std::sync::Arc::new(petak_core::lsp::WallClock),
                move |lang, root, event| match event {
                    petak_core::lsp::ServerEvent::Notification { method, params } => {
                        if method == "textDocument/publishDiagnostics" {
                            if let Some(uri_val) = params.get("uri").and_then(|u| u.as_str()) {
                                let path = petak_core::lsp::registry::uri_to_path(uri_val)
                                    .map(|p| p.to_string_lossy().to_string())
                                    .unwrap_or_else(|| uri_val.to_string());
                                let diagnostics = params
                                    .get("diagnostics")
                                    .cloned()
                                    .unwrap_or(serde_json::json!([]));
                                let _ = app_handle_for_events.emit(
                                    "lsp-diagnostics",
                                    serde_json::json!({
                                        "path": path,
                                        "diagnostics": diagnostics,
                                    }),
                                );
                            }
                        }
                    }
                    petak_core::lsp::ServerEvent::Status { state, reason } => {
                        let _ = app_handle_for_events.emit(
                            "lsp-status",
                            serde_json::json!({
                                "lang": lang.as_str(),
                                "root": root.to_string_lossy().to_string(),
                                "state": state,
                                "reason": reason,
                            }),
                        );
                    }
                    petak_core::lsp::ServerEvent::Crashed => {
                        let _ = app_handle_for_events.emit(
                            "lsp-status",
                            serde_json::json!({
                                "lang": lang.as_str(),
                                "root": root.to_string_lossy().to_string(),
                                "state": "crashed",
                                "reason": Some("server process died unexpectedly"),
                            }),
                        );
                    }
                    petak_core::lsp::ServerEvent::ApplyEdit { id, edit } => {
                        let _ = app_handle_for_events.emit(
                            "lsp-apply-edit",
                            serde_json::json!({
                                "id": id,
                                "edit": edit,
                            }),
                        );
                    }
                },
            ));

            app.manage(registry.clone());

            let reg_tick = registry.clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(std::time::Duration::from_secs(30));
                reg_tick.tick();
            });

            let agent_state = commands::AgentState::default();
            let agent_mgr = agent_state.manager.clone();
            let app_handle_for_agent = app_handle.clone();
            agent_mgr.add_listener(move |event| {
                let _ = app_handle_for_agent.emit("agent-event", event);
            });
            app.manage(agent_state);

            let agent_tick_mgr = agent_mgr.clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(std::time::Duration::from_secs(30));
                agent_tick_mgr.tick_idle_reap();
            });

            #[cfg(target_os = "macos")]
            {
                let app_handle = app.handle();
                let menu = menu::build_app_menu(app_handle)?;
                app.set_menu(menu)?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_dir,
            commands::read_file,
            commands::read_file_base64,
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
            commands::git_merge,
            commands::git_rebase_onto,
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
            commands::test_env,
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
            commands::toolchain_detect,
            commands::toolchain_get_config,
            commands::toolchain_save_config,
            commands::devices_list,
            commands::devices_watch,
            commands::avd_list,
            commands::emulator_start,
            commands::run_configs_load,
            commands::run_configs_save,
            commands::run_start,
            commands::run_reload,
            commands::run_stop,
            commands::logcat_start,
            commands::logcat_stop,
            commands::gradle_sync,
            commands::gradle_status,
            commands::gradle_stop,
            commands::open_url,
            commands::fs_create_file,
            commands::fs_create_dir,
            commands::fs_rename,
            commands::fs_move,
            commands::fs_copy,
            commands::fs_copy_external,
            commands::fs_get_clipboard_files,
            commands::fs_duplicate,
            commands::fs_trash,
            commands::os_reveal,
            commands::os_open_default,
            commands::lh_list,
            commands::lh_read,
            commands::lh_revert,
            commands::lh_label,
            commands::lh_snapshot,
            commands::git_diff_path,
            commands::git_file_at_ref,
            commands::git_path_history,
            commands::git_blame,
            commands::git_rollback,
            commands::git_gitignore_add,
            commands::git_commit_paths,
            commands::mirror_start,
            commands::mirror_stop,
            commands::mirror_log,
            commands::mirror_input,
            commands::mirror_screenshot,
            // Batch 2
            commands::devices_snapshot,
            commands::avd_start,
            commands::avd_stop,
            commands::sim_boot,
            commands::sim_shutdown,
            commands::kotlin_ls_status,
            commands::kotlin_ls_install,
            commands::lsp_kotlin_log_path,
            commands::git_branches_tree,
            commands::git_checkout,
            commands::git_log_path,
            commands::git_diff_branch,
            commands::git_compare_branch,
            commands::git_diff_revision,
            commands::git_stage,
            commands::git_unstage,
            // Batch 3
            commands::recent_projects_list,
            commands::recent_projects_add,
            commands::recent_projects_remove,
            commands::git_stage_paths,
            commands::git_unstage_paths,
            commands::git_commit_selected,
            commands::git_delete_untracked,
            commands::git_stash_push,
            commands::git_stash_list,
            commands::git_stash_apply,
            commands::git_stash_pop,
            commands::git_stash_drop,
            commands::git_stash_files,
            commands::git_stash_apply_file,
            commands::git_stash_file_diff,
            commands::git_stash_diff,
            // Batch 3 - Ghost-text & Settings
            commands::suggest_index_build,
            commands::suggest_index_update,
            commands::suggest_query,
            commands::setting_get,
            commands::setting_set,
            commands::editor_ghost_text_get,
            commands::editor_ghost_text_set,
            // Batch 4
            commands::avd_wipe,
            commands::avd_delete,
            commands::sim_open_app,
            commands::kls_install,
            commands::format_document,
            commands::mirror_permission_status,
            commands::open_screen_recording_settings,
            commands::mirror_camera_permission,
            commands::open_privacy_camera,
            // Phase 5 - Agents
            commands::agent_list_slots,
            commands::agent_start,
            commands::agent_prompt,
            commands::agent_cancel,
            commands::agent_stop,
            commands::agent_detect_hermes,
            commands::agent_get_supported_engines,
            commands::agent_load_team,
            commands::agent_save_team,
            commands::agent_add_slot,
            commands::agent_update_slot,
            commands::agent_remove_slot,
            commands::agent_get_allowlist,
            commands::agent_set_allowlist,
            commands::agent_respond_permission,
            commands::agent_list_pending_permissions,
            commands::agent_list_proposals,
            commands::agent_accept_proposal,
            commands::agent_reject_proposal,
            commands::agent_accept_hunk,
            commands::agent_get_usage,
            commands::agent_get_quota_report,
            commands::agent_list_project_memory,
            commands::agent_read_project_memory,
            commands::agent_save_project_memory,
            commands::agent_open_in_obsidian,
            commands::agent_mcp_get_config,
            commands::agent_mcp_save_config,
            commands::agent_mcp_test_server,
            commands::agent_skills_list,
            commands::agent_skill_get,
            commands::agent_skill_save,
            commands::agent_skill_delete,
            // Phase 5 - GitLab MR
            commands::mr_get_token_scope,
            commands::mr_current_user,
            commands::mr_list,
            commands::mr_detail,
            commands::mr_approvals,
            commands::mr_pipelines,
            commands::mr_pipeline_jobs,
            commands::mr_diffs,
            commands::mr_discussions,
            commands::mr_create_note,
            commands::mr_create_inline_discussion,
            commands::mr_reply_discussion,
            commands::mr_resolve_discussion,
            commands::mr_approve,
            commands::mr_unapprove,
            commands::mr_merge,
            commands::mr_cancel_mwps,
            commands::mr_checkout,
            commands::mr_evaluate_merge_status,
            commands::mr_create,
            commands::mr_rebase,
            // Batch 5
            commands::lsp_restart,
            commands::devices_refresh,
            commands::run_restart_daemon,
            commands::run_restart_connection,
            commands::run_hot_restart,
            commands::accounts_get,
            commands::accounts_save,
            commands::accounts_test,
            commands::accounts_clear,
            commands::accounts_check_token_status,
            commands::app_check_update,
            commands::app_apply_update,
            commands::mirror_open,
            // Batch 11
            commands::adb_pair,
            commands::adb_connect,
            // Batch 12
            commands::adb_find_pairing_service,
            // Automation & Testing
            commands::test_list_flows,
            commands::test_run_flow,
            commands::test_cancel_flow,
            commands::test_create_flow,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
