use petak_core::exec::SystemExec;
use petak_core::git::model::DiffFile;
use petak_core::gitlab::client::GitLabClient;
use petak_core::gitlab::model::{
    Discussion, GitLabUser, JobInfo, MergeRequest, MrListQuery, PaginatedList, PipelineInfo,
    TokenScopeMode,
};
use std::path::Path;
use tauri::Manager;

fn resolve_root(app: &tauri::AppHandle, root_opt: Option<String>) -> Result<String, String> {
    if let Some(r) = root_opt {
        if !r.trim().is_empty() {
            return Ok(r);
        }
    }
    if let Some(curr_root_state) = app.try_state::<crate::commands::CurrentProjectRoot>() {
        if let Ok(lock) = curr_root_state.0.lock() {
            if let Some(ref r) = *lock {
                return Ok(r.clone());
            }
        }
    }
    Err("Project root not specified and no project currently open".to_string())
}

#[tauri::command]
pub async fn mr_get_token_scope(
    app: tauri::AppHandle,
    root: Option<String>,
) -> Result<TokenScopeMode, String> {
    let resolved = resolve_root(&app, root)?;
    tauri::async_runtime::spawn_blocking(move || {
        let exec = SystemExec;
        let repo_path = Path::new(&resolved);
        let (client, _) =
            GitLabClient::from_repo(&exec, repo_path, None).map_err(|e| e.to_string())?;
        client.get_token_scope().map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn mr_current_user(
    app: tauri::AppHandle,
    root: Option<String>,
) -> Result<GitLabUser, String> {
    let resolved = resolve_root(&app, root)?;
    tauri::async_runtime::spawn_blocking(move || {
        let exec = SystemExec;
        let repo_path = Path::new(&resolved);
        let (client, _) =
            GitLabClient::from_repo(&exec, repo_path, None).map_err(|e| e.to_string())?;
        client.get_current_user().map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn mr_list(
    app: tauri::AppHandle,
    root: Option<String>,
    query: MrListQuery,
) -> Result<PaginatedList<MergeRequest>, String> {
    let resolved = resolve_root(&app, root)?;
    tauri::async_runtime::spawn_blocking(move || {
        let exec = SystemExec;
        let repo_path = Path::new(&resolved);
        let (client, project_path) =
            GitLabClient::from_repo(&exec, repo_path, None).map_err(|e| e.to_string())?;
        client
            .list_merge_requests(&project_path, &query)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn mr_detail(
    app: tauri::AppHandle,
    root: Option<String>,
    iid: u64,
) -> Result<MergeRequest, String> {
    let resolved = resolve_root(&app, root)?;
    tauri::async_runtime::spawn_blocking(move || {
        let exec = SystemExec;
        let repo_path = Path::new(&resolved);
        let (client, project_path) =
            GitLabClient::from_repo(&exec, repo_path, None).map_err(|e| e.to_string())?;
        client
            .get_merge_request(&project_path, iid)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn mr_pipelines(
    app: tauri::AppHandle,
    root: Option<String>,
    iid: u64,
) -> Result<Vec<PipelineInfo>, String> {
    let resolved = resolve_root(&app, root)?;
    tauri::async_runtime::spawn_blocking(move || {
        let exec = SystemExec;
        let repo_path = Path::new(&resolved);
        let (client, project_path) =
            GitLabClient::from_repo(&exec, repo_path, None).map_err(|e| e.to_string())?;
        client
            .get_pipelines(&project_path, iid)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn mr_pipeline_jobs(
    app: tauri::AppHandle,
    root: Option<String>,
    pipeline_id: u64,
) -> Result<Vec<JobInfo>, String> {
    let resolved = resolve_root(&app, root)?;
    tauri::async_runtime::spawn_blocking(move || {
        let exec = SystemExec;
        let repo_path = Path::new(&resolved);
        let (client, project_path) =
            GitLabClient::from_repo(&exec, repo_path, None).map_err(|e| e.to_string())?;
        client
            .get_pipeline_jobs(&project_path, pipeline_id)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn mr_diffs(
    app: tauri::AppHandle,
    root: Option<String>,
    iid: u64,
    head_sha: Option<String>,
) -> Result<Vec<DiffFile>, String> {
    let resolved = resolve_root(&app, root)?;
    tauri::async_runtime::spawn_blocking(move || {
        let exec = SystemExec;
        let repo_path = Path::new(&resolved);
        let (client, project_path) =
            GitLabClient::from_repo(&exec, repo_path, None).map_err(|e| e.to_string())?;
        client
            .get_diffs(&project_path, iid, head_sha.as_deref())
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn mr_discussions(
    app: tauri::AppHandle,
    root: Option<String>,
    iid: u64,
) -> Result<Vec<Discussion>, String> {
    let resolved = resolve_root(&app, root)?;
    tauri::async_runtime::spawn_blocking(move || {
        let exec = SystemExec;
        let repo_path = Path::new(&resolved);
        let (client, project_path) =
            GitLabClient::from_repo(&exec, repo_path, None).map_err(|e| e.to_string())?;
        client
            .get_discussions(&project_path, iid)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}
