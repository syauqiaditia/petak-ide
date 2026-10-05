use petak_core::exec::SystemExec;
use petak_core::git::model::DiffFile;
use petak_core::git::ops::checkout_mr;
use petak_core::gitlab::client::GitLabClient;
use petak_core::gitlab::model::{
    evaluate_merge_status, CreateMrParams, Discussion, GitLabUser, InlinePositionParams, JobInfo, MergeRequest,
    MergeRequestParams, MergeStatusEvaluation, MrListQuery, Note, PaginatedList, PipelineInfo,
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
        match client.get_token_scope() {
            Ok(scope) => Ok(scope),
            Err(petak_core::gitlab::GitLabError::Unauthorized(_)) => Ok(petak_core::gitlab::TokenScopeMode::None),
            Err(e) => Err(e.to_string()),
        }
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

#[tauri::command]
pub async fn mr_create_note(
    app: tauri::AppHandle,
    root: Option<String>,
    iid: u64,
    body: String,
) -> Result<Note, String> {
    let resolved = resolve_root(&app, root)?;
    tauri::async_runtime::spawn_blocking(move || {
        let exec = SystemExec;
        let repo_path = Path::new(&resolved);
        let (client, project_path) =
            GitLabClient::from_repo(&exec, repo_path, None).map_err(|e| e.to_string())?;
        client
            .create_note(&project_path, iid, &body)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn mr_create_inline_discussion(
    app: tauri::AppHandle,
    root: Option<String>,
    iid: u64,
    body: String,
    position: InlinePositionParams,
) -> Result<Discussion, String> {
    let resolved = resolve_root(&app, root)?;
    tauri::async_runtime::spawn_blocking(move || {
        let exec = SystemExec;
        let repo_path = Path::new(&resolved);
        let (client, project_path) =
            GitLabClient::from_repo(&exec, repo_path, None).map_err(|e| e.to_string())?;
        client
            .create_inline_discussion(&project_path, iid, &body, &position)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn mr_reply_discussion(
    app: tauri::AppHandle,
    root: Option<String>,
    iid: u64,
    discussion_id: String,
    body: String,
) -> Result<Note, String> {
    let resolved = resolve_root(&app, root)?;
    tauri::async_runtime::spawn_blocking(move || {
        let exec = SystemExec;
        let repo_path = Path::new(&resolved);
        let (client, project_path) =
            GitLabClient::from_repo(&exec, repo_path, None).map_err(|e| e.to_string())?;
        client
            .reply_discussion(&project_path, iid, &discussion_id, &body)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn mr_resolve_discussion(
    app: tauri::AppHandle,
    root: Option<String>,
    iid: u64,
    discussion_id: String,
    resolved: bool,
) -> Result<Discussion, String> {
    let app_resolved = resolve_root(&app, root)?;
    tauri::async_runtime::spawn_blocking(move || {
        let exec = SystemExec;
        let repo_path = Path::new(&app_resolved);
        let (client, project_path) =
            GitLabClient::from_repo(&exec, repo_path, None).map_err(|e| e.to_string())?;
        client
            .resolve_discussion(&project_path, iid, &discussion_id, resolved)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn mr_approve(
    app: tauri::AppHandle,
    root: Option<String>,
    iid: u64,
    sha: Option<String>,
) -> Result<serde_json::Value, String> {
    let resolved = resolve_root(&app, root)?;
    tauri::async_runtime::spawn_blocking(move || {
        let exec = SystemExec;
        let repo_path = Path::new(&resolved);
        let (client, project_path) =
            GitLabClient::from_repo(&exec, repo_path, None).map_err(|e| e.to_string())?;
        client
            .approve_merge_request(&project_path, iid, sha.as_deref())
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn mr_unapprove(
    app: tauri::AppHandle,
    root: Option<String>,
    iid: u64,
) -> Result<serde_json::Value, String> {
    let resolved = resolve_root(&app, root)?;
    tauri::async_runtime::spawn_blocking(move || {
        let exec = SystemExec;
        let repo_path = Path::new(&resolved);
        let (client, project_path) =
            GitLabClient::from_repo(&exec, repo_path, None).map_err(|e| e.to_string())?;
        client
            .unapprove_merge_request(&project_path, iid)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn mr_merge(
    app: tauri::AppHandle,
    root: Option<String>,
    iid: u64,
    params: MergeRequestParams,
) -> Result<MergeRequest, String> {
    let resolved = resolve_root(&app, root)?;
    tauri::async_runtime::spawn_blocking(move || {
        let exec = SystemExec;
        let repo_path = Path::new(&resolved);
        let (client, project_path) =
            GitLabClient::from_repo(&exec, repo_path, None).map_err(|e| e.to_string())?;
        client
            .merge_merge_request(&project_path, iid, &params)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn mr_cancel_mwps(
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
            .cancel_merge_when_pipeline_succeeds(&project_path, iid)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn mr_checkout(
    app: tauri::AppHandle,
    root: Option<String>,
    iid: u64,
    remote: Option<String>,
) -> Result<String, String> {
    let resolved = resolve_root(&app, root)?;
    tauri::async_runtime::spawn_blocking(move || {
        let exec = SystemExec;
        let repo_path = Path::new(&resolved);
        checkout_mr(&exec, repo_path, remote.as_deref(), iid).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn mr_evaluate_merge_status(status: Option<String>) -> MergeStatusEvaluation {
    evaluate_merge_status(status.as_deref())
}

#[tauri::command]
pub async fn mr_create(
    app: tauri::AppHandle,
    root: Option<String>,
    params: petak_core::gitlab::model::CreateMrParams,
) -> Result<MergeRequest, String> {
    let resolved = resolve_root(&app, root)?;
    tauri::async_runtime::spawn_blocking(move || {
        let exec = SystemExec;
        let repo_path = Path::new(&resolved);
        let (client, project_path) =
            GitLabClient::from_repo(&exec, repo_path, None).map_err(|e| e.to_string())?;
        client
            .create_merge_request(&project_path, &params)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn mr_rebase(
    app: tauri::AppHandle,
    root: Option<String>,
    iid: u64,
) -> Result<serde_json::Value, String> {
    let resolved = resolve_root(&app, root)?;
    tauri::async_runtime::spawn_blocking(move || {
        let exec = SystemExec;
        let repo_path = Path::new(&resolved);
        let (client, project_path) =
            GitLabClient::from_repo(&exec, repo_path, None).map_err(|e| e.to_string())?;
        client
            .rebase_merge_request(&project_path, iid)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}
