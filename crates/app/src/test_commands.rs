use petak_core::run::{
    cancel_flow, create_flow, list_flows, run_flow, Flow, FlowRunResult, FlowStep,
};
use std::path::Path;
use tauri::Manager;

fn resolve_root(app: &tauri::AppHandle, root_opt: Option<String>) -> Option<String> {
    if let Some(r) = root_opt {
        if !r.trim().is_empty() {
            return Some(r);
        }
    }
    if let Some(curr_root_state) = app.try_state::<crate::commands::CurrentProjectRoot>() {
        if let Ok(lock) = curr_root_state.0.lock() {
            if let Some(ref r) = *lock {
                return Some(r.clone());
            }
        }
    }
    None
}

#[tauri::command]
pub async fn test_list_flows(
    app: tauri::AppHandle,
    root: Option<String>,
) -> Result<Vec<Flow>, String> {
    let resolved = resolve_root(&app, root);
    tauri::async_runtime::spawn_blocking(move || {
        let path = resolved.as_ref().map(|s| Path::new(s.as_str()));
        list_flows(path)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn test_run_flow(
    app: tauri::AppHandle,
    root: Option<String>,
    flow_id: String,
    device_serial: Option<String>,
) -> Result<FlowRunResult, String> {
    let resolved = resolve_root(&app, root);
    let path = resolved.as_ref().map(|s| Path::new(s.as_str()));
    run_flow(path, &flow_id, device_serial.as_deref()).await
}

#[tauri::command]
pub async fn test_cancel_flow(
    app: tauri::AppHandle,
    flow_id: String,
) -> Result<bool, String> {
    let _ = &app;
    cancel_flow(&flow_id)
}

#[tauri::command]
pub async fn test_create_flow(
    app: tauri::AppHandle,
    root: Option<String>,
    name: String,
    app_id: Option<String>,
    steps: Vec<FlowStep>,
) -> Result<Flow, String> {
    let resolved = resolve_root(&app, root);
    tauri::async_runtime::spawn_blocking(move || {
        let path = resolved.as_ref().map(|s| Path::new(s.as_str()));
        create_flow(path, &name, app_id.as_deref(), steps)
    })
    .await
    .map_err(|e| e.to_string())?
}
