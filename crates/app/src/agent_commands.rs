use petak_core::agent::{
    HermesDetectionResult, LlmQuotaReport, McpConfig, McpTestResult, MemoryItem,
    PendingPermissionRequest, PromptResponse, Proposal, Skill, SkillSummary, SlotConfig,
    SlotManager, SlotSummary, SupportedEngineInfo, TeamConfig, UsageReport,
};
use std::sync::Arc;
use tauri::Manager;

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

fn sync_project_root(app: &tauri::AppHandle, manager: &SlotManager) {
    if let Some(curr_root) = app.try_state::<crate::commands::CurrentProjectRoot>() {
        if let Ok(guard) = curr_root.0.lock() {
            if let Some(ref r) = *guard {
                manager.set_project_root(Some(std::path::PathBuf::from(r)));
            }
        }
    }
}

#[tauri::command]
pub async fn agent_list_slots(
    state: tauri::State<'_, AgentState>,
) -> Result<Vec<SlotSummary>, String> {
    state.manager.ensure_default_slots();
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

// ── Hermes detection ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn agent_detect_hermes(
    app: tauri::AppHandle,
    state: tauri::State<'_, AgentState>,
) -> Result<HermesDetectionResult, String> {
    sync_project_root(&app, &state.manager);
    let root = state.manager.project_root();
    tauri::async_runtime::spawn_blocking(move || {
        Ok(petak_core::agent::detect_hermes(root.as_deref()))
    })
    .await
    .map_err(|e| e.to_string())?
}

// ── Multi-Engine Detection ──────────────────────────────────────────────────

#[tauri::command]
pub async fn agent_get_supported_engines(
    app: tauri::AppHandle,
    state: tauri::State<'_, AgentState>,
) -> Result<Vec<SupportedEngineInfo>, String> {
    sync_project_root(&app, &state.manager);
    let root = state.manager.project_root();
    tauri::async_runtime::spawn_blocking(move || {
        Ok(petak_core::agent::get_supported_engines(root.as_deref()))
    })
    .await
    .map_err(|e| e.to_string())?
}

// ── Team configuration & slot management ───────────────────────────────────

#[tauri::command]
pub async fn agent_load_team(
    app: tauri::AppHandle,
    state: tauri::State<'_, AgentState>,
) -> Result<TeamConfig, String> {
    sync_project_root(&app, &state.manager);
    let manager = Arc::clone(&state.manager);
    tauri::async_runtime::spawn_blocking(move || {
        let (team, _) = manager.load_team();
        Ok(team)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn agent_save_team(
    app: tauri::AppHandle,
    state: tauri::State<'_, AgentState>,
    team: TeamConfig,
) -> Result<String, String> {
    sync_project_root(&app, &state.manager);
    let manager = Arc::clone(&state.manager);
    tauri::async_runtime::spawn_blocking(move || {
        let saved_path = manager.save_team(&team)?;
        manager.apply_team(&team)?;
        Ok(saved_path.to_string_lossy().to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn agent_add_slot(
    state: tauri::State<'_, AgentState>,
    config: SlotConfig,
) -> Result<SlotSummary, String> {
    state.manager.add_slot(config)
}

#[tauri::command]
pub async fn agent_update_slot(
    state: tauri::State<'_, AgentState>,
    config: SlotConfig,
) -> Result<SlotSummary, String> {
    state.manager.update_slot(config)
}

#[tauri::command]
pub async fn agent_remove_slot(
    state: tauri::State<'_, AgentState>,
    slot_id: String,
) -> Result<(), String> {
    state.manager.remove_slot(&slot_id)
}

// ── Permission engine ───────────────────────────────────────────────────────

#[tauri::command]
pub async fn agent_get_allowlist(
    state: tauri::State<'_, AgentState>,
) -> Result<Vec<String>, String> {
    Ok(state.manager.permission_manager().get_allowlist())
}

#[tauri::command]
pub async fn agent_set_allowlist(
    state: tauri::State<'_, AgentState>,
    allowlist: Vec<String>,
) -> Result<(), String> {
    state.manager.permission_manager().set_allowlist(allowlist);
    Ok(())
}

#[tauri::command]
pub async fn agent_list_pending_permissions(
    state: tauri::State<'_, AgentState>,
) -> Result<Vec<PendingPermissionRequest>, String> {
    Ok(state.manager.permission_manager().list_pending())
}

#[tauri::command]
pub async fn agent_respond_permission(
    state: tauri::State<'_, AgentState>,
    request_id: String,
    allow: bool,
) -> Result<(), String> {
    state
        .manager
        .permission_manager()
        .respond(&request_id, allow)
}

// ── Proposal buffer ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn agent_list_proposals(
    state: tauri::State<'_, AgentState>,
    slot_id: Option<String>,
) -> Result<Vec<Proposal>, String> {
    Ok(state
        .manager
        .proposal_buffer()
        .list_proposals(slot_id.as_deref()))
}

#[tauri::command]
pub async fn agent_accept_proposal(
    app: tauri::AppHandle,
    state: tauri::State<'_, AgentState>,
    proposal_id: String,
) -> Result<(), String> {
    sync_project_root(&app, &state.manager);
    let lh_store = state
        .manager
        .project_root()
        .and_then(|r| crate::commands::lh_store_dir(&app, &r.to_string_lossy()).ok());

    let prop_buf = state.manager.proposal_buffer();
    prop_buf.accept_proposal(&proposal_id, lh_store.as_deref())
}

#[tauri::command]
pub async fn agent_reject_proposal(
    state: tauri::State<'_, AgentState>,
    proposal_id: String,
) -> Result<(), String> {
    state
        .manager
        .proposal_buffer()
        .reject_proposal(&proposal_id)
}

#[tauri::command]
pub async fn agent_accept_hunk(
    app: tauri::AppHandle,
    state: tauri::State<'_, AgentState>,
    proposal_id: String,
    hunk_idx: usize,
) -> Result<(), String> {
    sync_project_root(&app, &state.manager);
    let lh_store = state
        .manager
        .project_root()
        .and_then(|r| crate::commands::lh_store_dir(&app, &r.to_string_lossy()).ok());

    let prop_buf = state.manager.proposal_buffer();
    prop_buf.accept_hunk(&proposal_id, hunk_idx, lh_store.as_deref())
}

// ── Usage meter ────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn agent_get_usage(
    state: tauri::State<'_, AgentState>,
    slot_id: String,
) -> Result<UsageReport, String> {
    state.manager.get_slot_usage(&slot_id)
}

// ── Quota & Usage Probe ───────────────────────────────────────────────────

#[tauri::command]
pub async fn agent_get_quota_report() -> Result<LlmQuotaReport, String> {
    tauri::async_runtime::spawn_blocking(move || Ok(petak_core::agent::probe_llm_quota()))
        .await
        .map_err(|e| e.to_string())?
}

// ── Project Memory & Self-Improvement ───────────────────────────────────────

#[tauri::command]
pub async fn agent_list_project_memory(
    app: tauri::AppHandle,
    state: tauri::State<'_, AgentState>,
) -> Result<Vec<MemoryItem>, String> {
    sync_project_root(&app, &state.manager);
    let root = state.manager.project_root();
    tauri::async_runtime::spawn_blocking(move || {
        petak_core::agent::list_project_memory(root.as_deref()).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn agent_read_project_memory(
    app: tauri::AppHandle,
    state: tauri::State<'_, AgentState>,
    filename: String,
) -> Result<String, String> {
    sync_project_root(&app, &state.manager);
    let root = state.manager.project_root();
    tauri::async_runtime::spawn_blocking(move || {
        petak_core::agent::read_project_memory(root.as_deref(), &filename)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn agent_save_project_memory(
    app: tauri::AppHandle,
    state: tauri::State<'_, AgentState>,
    filename: String,
    content: String,
) -> Result<(), String> {
    sync_project_root(&app, &state.manager);
    let root = state.manager.project_root();
    tauri::async_runtime::spawn_blocking(move || {
        petak_core::agent::save_project_memory(root.as_deref(), &filename, &content)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn agent_open_in_obsidian(
    app: tauri::AppHandle,
    state: tauri::State<'_, AgentState>,
    filename: Option<String>,
) -> Result<(), String> {
    sync_project_root(&app, &state.manager);
    let root = state.manager.project_root();
    let mem_dir = petak_core::agent::resolve_memory_dir(root.as_deref());
    let target = if let Some(f) = filename {
        mem_dir.join(f)
    } else {
        mem_dir
    };

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(target)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(target)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", target.to_string_lossy().as_ref()])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ── Model Context Protocol (MCP) ──────────────────────────────────────────

fn resolve_effective_root(
    app: &tauri::AppHandle,
    root: Option<String>,
) -> Option<std::path::PathBuf> {
    if let Some(r) = root {
        let trimmed = r.trim();
        if !trimmed.is_empty() {
            return Some(std::path::PathBuf::from(trimmed));
        }
    }
    if let Some(curr_root) = app.try_state::<crate::commands::CurrentProjectRoot>() {
        if let Ok(guard) = curr_root.0.lock() {
            if let Some(ref r) = *guard {
                return Some(std::path::PathBuf::from(r));
            }
        }
    }
    None
}

#[tauri::command]
pub async fn agent_mcp_get_config(
    app: tauri::AppHandle,
    root: Option<String>,
) -> Result<McpConfig, String> {
    let effective_root = resolve_effective_root(&app, root);
    tauri::async_runtime::spawn_blocking(move || {
        petak_core::agent::load_mcp_config(effective_root.as_deref())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn agent_mcp_save_config(
    app: tauri::AppHandle,
    root: Option<String>,
    config: McpConfig,
) -> Result<(), String> {
    let effective_root = resolve_effective_root(&app, root);
    tauri::async_runtime::spawn_blocking(move || {
        petak_core::agent::save_mcp_config(effective_root.as_deref(), &config)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn agent_mcp_test_server(
    command: String,
    args: Vec<String>,
    env: std::collections::HashMap<String, String>,
) -> Result<McpTestResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        petak_core::agent::test_mcp_server(&command, &args, &env)
    })
    .await
    .map_err(|e| e.to_string())?
}

// ── Skills Management ─────────────────────────────────────────────────────

#[tauri::command]
pub async fn agent_skills_list(
    app: tauri::AppHandle,
    root: Option<String>,
) -> Result<Vec<SkillSummary>, String> {
    let effective_root = resolve_effective_root(&app, root);
    tauri::async_runtime::spawn_blocking(move || {
        petak_core::agent::list_skills(effective_root.as_deref())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn agent_skill_get(
    app: tauri::AppHandle,
    root: Option<String>,
    name: String,
) -> Result<Skill, String> {
    let effective_root = resolve_effective_root(&app, root);
    tauri::async_runtime::spawn_blocking(move || {
        petak_core::agent::read_skill(effective_root.as_deref(), &name)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn agent_skill_save(
    app: tauri::AppHandle,
    root: Option<String>,
    name: String,
    description: String,
    content: String,
) -> Result<Skill, String> {
    let effective_root = resolve_effective_root(&app, root);
    tauri::async_runtime::spawn_blocking(move || {
        petak_core::agent::save_skill(effective_root.as_deref(), &name, &description, &content)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn agent_skill_delete(
    app: tauri::AppHandle,
    root: Option<String>,
    name: String,
) -> Result<bool, String> {
    let effective_root = resolve_effective_root(&app, root);
    tauri::async_runtime::spawn_blocking(move || {
        petak_core::agent::delete_skill(effective_root.as_deref(), &name)
    })
    .await
    .map_err(|e| e.to_string())?
}
