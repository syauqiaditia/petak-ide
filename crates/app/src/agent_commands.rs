use petak_core::agent::{PromptResponse, SlotManager, SlotSummary};
use std::sync::Arc;

#[derive(Clone)]
pub struct AgentState {
    pub manager: Arc<SlotManager>,
}

impl Default for AgentState {
    fn default() -> Self {
        Self {
            manager: Arc::new(SlotManager::with_defaults(None)),
        }
    }
}

#[tauri::command]
pub async fn agent_list_slots(
    state: tauri::State<'_, AgentState>,
) -> Result<Vec<SlotSummary>, String> {
    Ok(state.manager.list_slots())
}

#[tauri::command]
pub async fn agent_start(
    state: tauri::State<'_, AgentState>,
    slot_id: String,
) -> Result<SlotSummary, String> {
    let manager = Arc::clone(&state.manager);
    tauri::async_runtime::spawn_blocking(move || manager.start_slot(&slot_id))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn agent_prompt(
    state: tauri::State<'_, AgentState>,
    slot_id: String,
    prompt: String,
) -> Result<PromptResponse, String> {
    let manager = Arc::clone(&state.manager);
    tauri::async_runtime::spawn_blocking(move || manager.prompt_slot(&slot_id, &prompt))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn agent_cancel(
    state: tauri::State<'_, AgentState>,
    slot_id: String,
) -> Result<(), String> {
    let manager = Arc::clone(&state.manager);
    tauri::async_runtime::spawn_blocking(move || manager.cancel_slot(&slot_id))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn agent_stop(
    state: tauri::State<'_, AgentState>,
    slot_id: String,
) -> Result<(), String> {
    let manager = Arc::clone(&state.manager);
    tauri::async_runtime::spawn_blocking(move || manager.stop_slot(&slot_id))
        .await
        .map_err(|e| e.to_string())?
}
