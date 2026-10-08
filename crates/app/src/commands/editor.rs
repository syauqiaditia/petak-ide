use tauri::Manager;
use super::*;

pub type AppRegistry = std::sync::Arc<petak_core::lsp::Registry>;


#[tauri::command]
pub async fn lsp_restart(
    app: tauri::AppHandle,
    language: String,
) -> Result<(), String> {
    let lang = match language.to_lowercase().trim() {
        "dart" => Some(petak_core::lsp::Lang::Dart),
        "kotlin" | "kt" => Some(petak_core::lsp::Lang::Kotlin),
        "swift" => Some(petak_core::lsp::Lang::Swift),
        _ => None,
    };
    if let Some(reg) = app.try_state::<AppRegistry>() {
        reg.restart(lang).map_err(|e| e.to_string())
    } else {
        Ok(())
    }
}


#[tauri::command]
pub async fn lsp_kotlin_log_path() -> Result<String, String> {
    let path = petak_core::toolchain::kotlin_ls_log_path();
    Ok(path.to_string_lossy().to_string())
}


#[tauri::command]
pub async fn lsp_did_open(
    state: tauri::State<'_, AppRegistry>,
    path: String,
    text: String,
) -> Result<(), String> {
    let registry = state.inner().clone();
    let p_buf = std::path::PathBuf::from(&path);
    let ext = p_buf.extension().and_then(|e| e.to_str()).unwrap_or("").to_string();
    if let Some(lang) = petak_core::lsp::Lang::from_extension(&ext) {
        if lang == petak_core::lsp::Lang::Kotlin {
            // Non-blocking initialization for Kotlin: run in background task so UI does not freeze during Gradle indexing
            tauri::async_runtime::spawn_blocking(move || {
                let _ = registry.did_open(&p_buf, lang, &text, None);
            });
            return Ok(());
        }
        tauri::async_runtime::spawn_blocking(move || {
            registry
                .did_open(&p_buf, lang, &text, None)
                .map_err(|e| format!("{:?}", e))
        })
        .await
        .map_err(|e| e.to_string())??;
    }
    Ok(())
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
        use std::io::Write;
        if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open("/tmp/petak_lsp.log") {
            let _ = writeln!(f, "[LSP_COMPLETION] path={} line={} char={}", path, line, character);
        }
        let res = registry
            .request(p, lang, "textDocument/completion", &params, None);
        if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open("/tmp/petak_lsp.log") {
            let _ = writeln!(f, "[LSP_COMPLETION_RES] is_ok={}", res.is_ok());
        }
        res.map_err(|e| format!("{:?}", e))
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
        use std::io::Write;
        if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open("/tmp/petak_lsp.log") {
            let _ = writeln!(f, "[LSP_HOVER] path={} line={} char={}", path, line, character);
        }
        let res = registry
            .request(p, lang, "textDocument/hover", &params, None);
        if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open("/tmp/petak_lsp.log") {
            let _ = writeln!(f, "[LSP_HOVER_RES] is_ok={}", res.is_ok());
        }
        res.map_err(|e| format!("{:?}", e))
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

// -----------------------------------------------------------------------------
// Run, Toolchain, Devices, Logcat State & Commands
// -----------------------------------------------------------------------------


#[tauri::command]
pub async fn format_document(
    path: Option<String>,
    lang: String,
    text: String,
    range: Option<petak_core::format::FormatRange>,
) -> Result<petak_core::format::FormatResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let eff_lang = if lang.is_empty() {
            path.as_deref()
                .and_then(|p| std::path::Path::new(p).extension())
                .and_then(|e| e.to_str())
                .unwrap_or("")
                .to_string()
        } else {
            lang
        };

        petak_core::format::format_text(&eff_lang, &text, range).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}


pub fn suggest_app_data_dir(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    app.path().app_data_dir().ok().or_else(petak_core::suggest::default_app_data_dir)
}


#[tauri::command]
pub async fn suggest_index_build(
    app: tauri::AppHandle,
    root: Option<String>,
) -> Result<(), String> {
    let resolved_root = resolve_cmd_root(&app, root)?;
    let app_data = suggest_app_data_dir(&app);

    std::thread::spawn(move || {
        let root_p = std::path::Path::new(&resolved_root);
        let mut index = petak_core::suggest::SuggestIndex::load_from_disk(root_p, app_data.as_deref())
            .unwrap_or_else(|_| {
                let mut idx = petak_core::suggest::SuggestIndex::new(root_p);
                if let Some(ref dir) = app_data {
                    idx.set_app_data_dir(dir.clone());
                }
                idx
            });

        let _ = index.build();

        if let Ok(mut lock) = petak_core::suggest::global_suggest_index().write() {
            *lock = Some(index);
        }
    });

    Ok(())
}


#[tauri::command]
pub async fn suggest_index_update(
    app: tauri::AppHandle,
    path: String,
    root: Option<String>,
) -> Result<(), String> {
    let resolved_root = resolve_cmd_root(&app, root).ok();
    let app_data = suggest_app_data_dir(&app);

    std::thread::spawn(move || {
        let path_obj = std::path::Path::new(&path);
        {
            if let Ok(mut lock) = petak_core::suggest::global_suggest_index().write() {
                if let Some(ref mut idx) = *lock {
                    let _ = idx.update_file(path_obj);
                    return;
                }
            }
        }

        if let Some(ref r) = resolved_root {
            let root_p = std::path::Path::new(r);
            if let Ok(mut idx) = petak_core::suggest::SuggestIndex::load_from_disk(root_p, app_data.as_deref()) {
                let _ = idx.update_file(path_obj);
                if let Ok(mut lock) = petak_core::suggest::global_suggest_index().write() {
                    *lock = Some(idx);
                }
            }
        }
    });

    Ok(())
}


#[tauri::command]
pub async fn suggest_query(
    app: tauri::AppHandle,
    prefix: String,
    lang: Option<String>,
    limit: Option<usize>,
    root: Option<String>,
) -> Result<Vec<petak_core::suggest::SuggestItem>, String> {
    let app_data = suggest_app_data_dir(&app);
    if !petak_core::suggest::get_editor_ghost_text(app_data.as_deref()) {
        return Ok(Vec::new());
    }

    {
        if let Ok(lock) = petak_core::suggest::global_suggest_index().read() {
            if let Some(ref idx) = *lock {
                return Ok(idx.suggest_query(&prefix, lang.as_deref(), limit));
            }
        }
    }

    if let Ok(resolved_root) = resolve_cmd_root(&app, root) {
        let root_p = std::path::Path::new(&resolved_root);
        if let Ok(idx) = petak_core::suggest::SuggestIndex::load_from_disk(root_p, app_data.as_deref()) {
            let res = idx.suggest_query(&prefix, lang.as_deref(), limit);
            if let Ok(mut lock) = petak_core::suggest::global_suggest_index().write() {
                *lock = Some(idx);
            }
            return Ok(res);
        }
    }

    Ok(Vec::new())
}


#[tauri::command]
pub fn editor_ghost_text_get(app: tauri::AppHandle) -> Result<bool, String> {
    let app_data = suggest_app_data_dir(&app);
    Ok(petak_core::suggest::get_editor_ghost_text(app_data.as_deref()))
}


#[tauri::command]
pub fn editor_ghost_text_set(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    let app_data = suggest_app_data_dir(&app);
    petak_core::suggest::set_editor_ghost_text(app_data.as_deref(), enabled).map_err(|e| e.to_string())
}


