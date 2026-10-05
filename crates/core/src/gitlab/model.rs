use serde::{Deserialize, Serialize};

use crate::git::diff::parse_hunk_header_counts;
use crate::git::model::{DiffFile, DiffLine, DiffLineKind, FileState, Hunk};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all(deserialize = "snake_case", serialize = "camelCase"))]
pub struct GitLabUser {
    pub id: u64,
    pub username: String,
    pub name: String,
    pub state: Option<String>,
    pub avatar_url: Option<String>,
    pub web_url: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all(deserialize = "snake_case", serialize = "camelCase"))]
pub struct DiffRefs {
    pub base_sha: Option<String>,
    pub head_sha: String,
    pub start_sha: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all(deserialize = "snake_case", serialize = "camelCase"))]
pub struct PipelineInfo {
    pub id: u64,
    pub iid: Option<u64>,
    pub project_id: Option<u64>,
    pub sha: String,
    #[serde(rename = "ref")]
    pub ref_name: String,
    pub status: String,
    pub source: Option<String>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
    pub web_url: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all(deserialize = "snake_case", serialize = "camelCase"))]
pub struct JobInfo {
    pub id: u64,
    pub name: String,
    pub stage: String,
    pub status: String,
    pub duration: Option<f64>,
    pub created_at: Option<String>,
    pub finished_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all(deserialize = "snake_case", serialize = "camelCase"))]
pub struct MergeRequest {
    pub id: u64,
    pub iid: u64,
    pub project_id: u64,
    pub title: String,
    pub description: Option<String>,
    pub state: String,
    pub created_at: String,
    pub updated_at: String,
    pub target_branch: String,
    pub source_branch: String,
    pub author: GitLabUser,
    #[serde(default)]
    pub assignees: Vec<GitLabUser>,
    #[serde(default)]
    pub reviewers: Vec<GitLabUser>,
    pub source_project_id: Option<u64>,
    pub target_project_id: Option<u64>,
    #[serde(default)]
    pub draft: bool,
    #[serde(default)]
    pub work_in_progress: bool,
    pub merge_status: Option<String>,
    pub detailed_merge_status: Option<String>,
    pub sha: String,
    #[serde(default)]
    pub has_conflicts: bool,
    pub web_url: String,
    pub diff_refs: Option<DiffRefs>,
    pub blocking_discussions_resolved: Option<bool>,
    pub should_remove_source_branch: Option<bool>,
    pub force_remove_source_branch: Option<bool>,
    pub head_pipeline: Option<PipelineInfo>,
    pub merge_commit_sha: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all(deserialize = "snake_case", serialize = "camelCase"))]
pub struct MergeRequestApprovals {
    #[serde(default)]
    pub approved: bool,
    #[serde(default)]
    pub approvals_required: u32,
    #[serde(default)]
    pub approvals_left: u32,
    #[serde(default)]
    pub user_has_approved: bool,
    #[serde(default)]
    pub user_can_approve: bool,
    #[serde(default)]
    pub approved_by: Vec<ApprovedByEntry>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all(deserialize = "snake_case", serialize = "camelCase"))]
pub struct ApprovedByEntry {
    pub user: GitLabUser,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all(deserialize = "snake_case", serialize = "camelCase"))]
pub struct NotePosition {
    pub base_sha: Option<String>,
    pub start_sha: Option<String>,
    pub head_sha: Option<String>,
    pub old_path: Option<String>,
    pub new_path: Option<String>,
    pub position_type: Option<String>,
    pub old_line: Option<u32>,
    pub new_line: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all(deserialize = "snake_case", serialize = "camelCase"))]
pub struct Note {
    pub id: u64,
    #[serde(rename = "type")]
    pub note_type: Option<String>,
    pub body: String,
    pub attachment: Option<String>,
    pub author: GitLabUser,
    pub created_at: String,
    pub updated_at: String,
    #[serde(default)]
    pub system: bool,
    #[serde(default)]
    pub resolvable: bool,
    pub resolved: Option<bool>,
    pub position: Option<NotePosition>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all(deserialize = "snake_case", serialize = "camelCase"))]
pub struct Discussion {
    pub id: String,
    #[serde(default)]
    pub individual_note: bool,
    #[serde(default)]
    pub notes: Vec<Note>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all(deserialize = "snake_case", serialize = "camelCase"))]
pub struct PersonalAccessToken {
    pub id: u64,
    pub name: String,
    #[serde(default)]
    pub revoked: bool,
    pub created_at: String,
    #[serde(default)]
    pub scopes: Vec<String>,
    pub user_id: u64,
    pub last_used_at: Option<String>,
    #[serde(default)]
    pub active: bool,
    pub expires_at: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TokenScopeMode {
    ReadOnly,
    Full,
    None,
}

impl TokenScopeMode {
    pub fn from_scopes(scopes: &[String]) -> Self {
        if scopes.iter().any(|s| s == "api") {
            Self::Full
        } else if scopes.iter().any(|s| s == "read_api") {
            Self::ReadOnly
        } else {
            Self::None
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all(deserialize = "snake_case", serialize = "camelCase"))]
pub struct GitLabProject {
    pub id: u64,
    pub description: Option<String>,
    pub name: String,
    pub name_with_namespace: Option<String>,
    pub path: String,
    pub path_with_namespace: String,
    pub default_branch: Option<String>,
    pub web_url: String,
    pub ssh_url_to_repo: Option<String>,
    pub http_url_to_repo: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all(deserialize = "snake_case", serialize = "camelCase"))]
pub struct GitLabDiffRaw {
    pub old_path: String,
    pub new_path: String,
    pub a_mode: Option<String>,
    pub b_mode: Option<String>,
    #[serde(default)]
    pub new_file: bool,
    #[serde(default)]
    pub renamed_file: bool,
    #[serde(default)]
    pub deleted_file: bool,
    pub diff: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all(deserialize = "snake_case", serialize = "camelCase"))]
pub struct GitLabChangesRaw {
    pub id: u64,
    pub iid: u64,
    pub changes: Vec<GitLabDiffRaw>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageInfo {
    pub page: u32,
    pub per_page: u32,
    pub next_page: Option<u32>,
    pub total_pages: Option<u32>,
    pub total: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaginatedList<T> {
    pub items: Vec<T>,
    pub pagination: PageInfo,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MrListQuery {
    pub state: Option<String>,
    pub scope: Option<String>,
    pub reviewer_id: Option<u64>,
    pub search: Option<String>,
    pub page: Option<u32>,
    pub per_page: Option<u32>,
}

pub fn parse_gitlab_diff_to_diff_file(raw: &GitLabDiffRaw) -> DiffFile {
    let status = if raw.new_file {
        FileState::Added
    } else if raw.deleted_file {
        FileState::Deleted
    } else if raw.renamed_file {
        FileState::Renamed
    } else {
        FileState::Modified
    };

    let file_old = if raw.new_file {
        None
    } else {
        Some(raw.old_path.clone())
    };
    let file_new = if raw.deleted_file {
        None
    } else {
        Some(raw.new_path.clone())
    };

    let mut hunks = Vec::new();
    let mut current_hunk: Option<Hunk> = None;
    let mut curr_old: u32 = 0;
    let mut curr_new: u32 = 0;

    for line in raw.diff.lines() {
        if line.starts_with("@@ -") {
            if let Some(h) = current_hunk.take() {
                hunks.push(h);
            }
            if let Some((old_start, old_lines, new_start, new_lines)) =
                parse_hunk_header_counts(line)
            {
                curr_old = old_start;
                curr_new = new_start;
                current_hunk = Some(Hunk {
                    old_start,
                    old_lines,
                    new_start,
                    new_lines,
                    header: line.to_string(),
                    lines: Vec::new(),
                });
            }
            continue;
        }

        if let Some(hunk) = current_hunk.as_mut() {
            if line.starts_with('\\') {
                hunk.lines.push(DiffLine {
                    kind: DiffLineKind::NoNewline,
                    text: line.to_string(),
                    old_no: None,
                    new_no: None,
                });
            } else if let Some(content) = line.strip_prefix('+') {
                hunk.lines.push(DiffLine {
                    kind: DiffLineKind::Add,
                    text: content.to_string(),
                    old_no: None,
                    new_no: Some(curr_new),
                });
                curr_new += 1;
            } else if let Some(content) = line.strip_prefix('-') {
                hunk.lines.push(DiffLine {
                    kind: DiffLineKind::Del,
                    text: content.to_string(),
                    old_no: Some(curr_old),
                    new_no: None,
                });
                curr_old += 1;
            } else if let Some(content) = line.strip_prefix(' ') {
                hunk.lines.push(DiffLine {
                    kind: DiffLineKind::Context,
                    text: content.to_string(),
                    old_no: Some(curr_old),
                    new_no: Some(curr_new),
                });
                curr_old += 1;
                curr_new += 1;
            } else if line.is_empty() {
                hunk.lines.push(DiffLine {
                    kind: DiffLineKind::Context,
                    text: String::new(),
                    old_no: Some(curr_old),
                    new_no: Some(curr_new),
                });
                curr_old += 1;
                curr_new += 1;
            }
        }
    }

    if let Some(h) = current_hunk.take() {
        hunks.push(h);
    }

    let is_binary = raw.diff.contains("Binary files ") && raw.diff.ends_with(" differ");

    DiffFile {
        old_path: file_old,
        new_path: file_new,
        status,
        binary: is_binary,
        hunks,
    }
}

pub fn convert_gitlab_diffs(raw_diffs: &[GitLabDiffRaw]) -> Vec<DiffFile> {
    raw_diffs
        .iter()
        .map(parse_gitlab_diff_to_diff_file)
        .collect()
}

fn default_position_type() -> String {
    "text".to_string()
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all(deserialize = "snake_case", serialize = "camelCase"))]
pub struct InlinePositionParams {
    pub base_sha: String,
    pub start_sha: String,
    pub head_sha: String,
    pub old_path: String,
    pub new_path: String,
    #[serde(default = "default_position_type")]
    pub position_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub old_line: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub new_line: Option<u32>,
}

impl InlinePositionParams {
    pub fn from_diff_refs(
        diff_refs: &DiffRefs,
        path: &str,
        old_line: Option<u32>,
        new_line: Option<u32>,
    ) -> Result<Self, String> {
        Self::with_paths(diff_refs, path, path, old_line, new_line)
    }

    pub fn with_paths(
        diff_refs: &DiffRefs,
        old_path: &str,
        new_path: &str,
        old_line: Option<u32>,
        new_line: Option<u32>,
    ) -> Result<Self, String> {
        let base_sha = diff_refs
            .base_sha
            .as_ref()
            .or(diff_refs.start_sha.as_ref())
            .ok_or_else(|| "Missing base_sha in diff_refs".to_string())?
            .clone();
        let start_sha = diff_refs
            .start_sha
            .as_ref()
            .or(diff_refs.base_sha.as_ref())
            .ok_or_else(|| "Missing start_sha in diff_refs".to_string())?
            .clone();
        let head_sha = diff_refs.head_sha.clone();

        if old_line.is_none() && new_line.is_none() {
            return Err(
                "Inline discussion position requires either old_line or new_line".to_string(),
            );
        }

        Ok(Self {
            base_sha,
            start_sha,
            head_sha,
            old_path: old_path.to_string(),
            new_path: new_path.to_string(),
            position_type: "text".to_string(),
            old_line,
            new_line,
        })
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all(deserialize = "snake_case", serialize = "camelCase"))]
pub struct CreateMrParams {
    #[serde(alias = "sourceBranch")]
    pub source_branch: String,
    #[serde(alias = "targetBranch")]
    pub target_branch: String,
    pub title: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(alias = "assigneeIds", default)]
    pub assignee_ids: Option<Vec<u64>>,
    #[serde(alias = "reviewerIds", default)]
    pub reviewer_ids: Option<Vec<u64>>,
    #[serde(alias = "removeSourceBranch", default)]
    pub remove_source_branch: Option<bool>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all(deserialize = "snake_case", serialize = "camelCase"))]
pub struct MergeRequestParams {
    pub sha: String,
    pub squash: Option<bool>,
    pub should_remove_source_branch: Option<bool>,
    pub merge_when_pipeline_succeeds: Option<bool>,
    pub squash_commit_message: Option<String>,
    pub merge_commit_message: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MergeStatusEvaluation {
    pub mergeable: bool,
    pub can_mwps: bool,
    pub reason: Option<String>,
}

pub fn evaluate_merge_status(detailed_status: Option<&str>) -> MergeStatusEvaluation {
    let status = match detailed_status {
        Some(s) if !s.trim().is_empty() => s.trim(),
        _ => {
            return MergeStatusEvaluation {
                mergeable: false,
                can_mwps: false,
                reason: Some("Status merge request tidak diketahui".to_string()),
            }
        }
    };

    match status {
        "mergeable" => MergeStatusEvaluation {
            mergeable: true,
            can_mwps: false,
            reason: None,
        },
        "ci_still_running" => MergeStatusEvaluation {
            mergeable: false,
            can_mwps: true,
            reason: Some(
                "Pipeline CI masih berjalan (dapat menggunakan opsi Merge When Pipeline Succeeds)"
                    .to_string(),
            ),
        },
        "blocked_status" => MergeStatusEvaluation {
            mergeable: false,
            can_mwps: false,
            reason: Some("Merge diblokir oleh status lain atau dependensi MR".to_string()),
        },
        "not_approved" => MergeStatusEvaluation {
            mergeable: false,
            can_mwps: false,
            reason: Some("Belum mendapatkan persetujuan (approval) yang diperlukan".to_string()),
        },
        "discussions_not_resolved" => MergeStatusEvaluation {
            mergeable: false,
            can_mwps: false,
            reason: Some(
                "Masih ada diskusi atau komentar yang belum diselesaikan (unresolved)".to_string(),
            ),
        },
        "draft_status" => MergeStatusEvaluation {
            mergeable: false,
            can_mwps: false,
            reason: Some("Merge request masih dalam status draf (Draft/WIP)".to_string()),
        },
        "conflict" => MergeStatusEvaluation {
            mergeable: false,
            can_mwps: false,
            reason: Some("Terdapat konflik perubahan file yang harus diselesaikan".to_string()),
        },
        "ci_must_pass" => MergeStatusEvaluation {
            mergeable: false,
            can_mwps: false,
            reason: Some("Pipeline CI gagal atau wajib lulus sebelum merge".to_string()),
        },
        "not_open" => MergeStatusEvaluation {
            mergeable: false,
            can_mwps: false,
            reason: Some("Merge request tidak dalam status terbuka".to_string()),
        },
        other => MergeStatusEvaluation {
            mergeable: false,
            can_mwps: false,
            reason: Some(format!("Tidak dapat merge: status {}", other)),
        },
    }
}
