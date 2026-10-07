use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

/// Information about a Git worktree allocated for an agent task lane.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WorktreeInfo {
    /// Task identifier (e.g. "t_1c07ce3a" or custom slug).
    pub task_id: String,
    /// Absolute path to the worktree directory.
    pub path: String,
    /// Isolated branch name (e.g. "wt/smart-context-core").
    pub branch: String,
    /// Origin reference branch (default "main").
    pub base_branch: String,
    /// Current commit SHA at worktree HEAD.
    pub head_sha: String,
    /// Whether uncommitted changes exist in the worktree (`git status -s`).
    pub is_dirty: bool,
    /// Unix timestamp when the worktree was created.
    pub created_at: u64,
}

/// Metadata record stored in `.petak/worktrees.json`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WorktreeMetaRecord {
    pub task_id: String,
    pub branch: String,
    pub base_branch: String,
    pub created_at: u64,
    pub path: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct WorktreeMetadataStore {
    pub worktrees: HashMap<String, WorktreeMetaRecord>,
}

/// WorktreeManager wrapper around Git worktree operations.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorktreeManager {
    project_root: PathBuf,
}

impl WorktreeManager {
    pub fn new(project_root: impl Into<PathBuf>) -> Self {
        Self {
            project_root: project_root.into(),
        }
    }

    pub fn project_root(&self) -> &Path {
        &self.project_root
    }

    pub fn list(&self) -> Result<Vec<WorktreeInfo>, String> {
        list_worktrees(&self.project_root)
    }

    pub fn create(
        &self,
        task_id: &str,
        branch: &str,
        base_branch: Option<&str>,
    ) -> Result<WorktreeInfo, String> {
        create_worktree(&self.project_root, task_id, branch, base_branch)
    }

    pub fn diff(&self, task_id: &str) -> Result<String, String> {
        get_worktree_diff(&self.project_root, task_id)
    }

    pub fn remove(&self, task_id: &str, delete_branch: bool) -> Result<(), String> {
        remove_worktree(&self.project_root, task_id, delete_branch)
    }
}

// ── Validation Helpers ────────────────────────────────────────────────────────

pub fn sanitize_task_id(task_id: &str) -> Result<String, String> {
    let trimmed = task_id.trim();
    if trimmed.is_empty() {
        return Err("task_id cannot be empty".to_string());
    }
    if trimmed.contains("..") || trimmed.contains('/') || trimmed.contains('\\') {
        return Err("Invalid task_id: path traversal characters detected".to_string());
    }
    if trimmed.starts_with('.') || trimmed.starts_with('-') {
        return Err("Invalid task_id: cannot start with '.' or '-'".to_string());
    }
    if !trimmed
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-' || c == '.')
    {
        return Err("Invalid task_id: contains illegal characters".to_string());
    }
    Ok(trimmed.to_string())
}

pub fn sanitize_branch_name(branch: &str) -> Result<String, String> {
    let trimmed = branch.trim();
    if trimmed.is_empty() {
        return Err("branch name cannot be empty".to_string());
    }
    if trimmed.contains("..") || trimmed.contains('\\') || trimmed.contains("//") {
        return Err("Invalid branch name: traversal sequence detected".to_string());
    }
    if trimmed.starts_with('/')
        || trimmed.ends_with('/')
        || trimmed.starts_with('-')
        || trimmed.ends_with(".lock")
    {
        return Err("Invalid branch name format".to_string());
    }
    for c in trimmed.chars() {
        if c.is_ascii_control() || c.is_ascii_whitespace() || "~^:?*[@{}]".contains(c) {
            return Err(format!("Invalid branch name: illegal character '{}'", c));
        }
    }
    Ok(trimmed.to_string())
}

// ── Git Command Helpers ───────────────────────────────────────────────────────

fn run_git(cwd: &Path, args: &[&str]) -> Result<String, String> {
    let mut cmd = Command::new("git");
    cmd.current_dir(cwd);
    cmd.args(args);
    cmd.env("LC_ALL", "C");
    cmd.env("GIT_TERMINAL_PROMPT", "0");
    crate::toolchain::apply_env_for_root(&mut cmd, Some(cwd));

    let output = cmd
        .output()
        .map_err(|e| format!("Failed to execute git {:?}: {}", args, e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let msg = if !stderr.is_empty() { stderr } else { stdout };
        return Err(format!("git {:?} failed: {}", args, msg));
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

fn run_git_status(cwd: &Path) -> Result<bool, String> {
    let mut cmd = Command::new("git");
    cmd.current_dir(cwd);
    cmd.args(["status", "-s"]);
    cmd.env("LC_ALL", "C");
    cmd.env("GIT_TERMINAL_PROMPT", "0");
    crate::toolchain::apply_env_for_root(&mut cmd, Some(cwd));

    let output = cmd
        .output()
        .map_err(|e| format!("Failed to execute git status: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(format!("git status failed: {}", stderr));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    Ok(!stdout.trim().is_empty())
}

fn ensure_worktrees_git_exclude(project_root: &Path) {
    let git_dir = if let Ok(out) = run_git(project_root, &["rev-parse", "--git-dir"]) {
        let trimmed = out.trim();
        let p = PathBuf::from(trimmed);
        if p.is_absolute() {
            p
        } else {
            project_root.join(p)
        }
    } else {
        project_root.join(".git")
    };

    let exclude_path = git_dir.join("info").join("exclude");
    if let Ok(content) = fs::read_to_string(&exclude_path) {
        if !content
            .lines()
            .any(|l| l.trim() == ".worktrees" || l.trim() == ".worktrees/")
        {
            let mut new_content = content;
            if !new_content.ends_with('\n') && !new_content.is_empty() {
                new_content.push('\n');
            }
            new_content.push_str(".worktrees/\n");
            let _ = fs::write(&exclude_path, new_content);
        }
    } else {
        let _ = fs::create_dir_all(git_dir.join("info"));
        let _ = fs::write(&exclude_path, ".worktrees/\n");
    }
}

// ── Metadata Store Helpers ────────────────────────────────────────────────────

fn meta_file_path(project_root: &Path) -> PathBuf {
    project_root.join(".petak").join("worktrees.json")
}

fn load_metadata(project_root: &Path) -> WorktreeMetadataStore {
    let path = meta_file_path(project_root);
    if let Ok(content) = fs::read_to_string(&path) {
        serde_json::from_str(&content).unwrap_or_default()
    } else {
        WorktreeMetadataStore::default()
    }
}

fn save_metadata(project_root: &Path, store: &WorktreeMetadataStore) {
    let dir = project_root.join(".petak");
    let _ = fs::create_dir_all(&dir);
    let path = meta_file_path(project_root);
    if let Ok(json) = serde_json::to_string_pretty(store) {
        let _ = fs::write(path, json);
    }
}

fn record_worktree(project_root: &Path, meta: WorktreeMetaRecord) {
    let mut store = load_metadata(project_root);
    store.worktrees.insert(meta.task_id.clone(), meta);
    save_metadata(project_root, &store);
}

fn remove_worktree_meta(project_root: &Path, task_id: &str) {
    let mut store = load_metadata(project_root);
    store.worktrees.remove(task_id);
    save_metadata(project_root, &store);
}

// ── Porcelain Output Parser ───────────────────────────────────────────────────

#[derive(Debug, Default, Clone)]
struct RawWorktree {
    path: String,
    head: String,
    branch: String,
}

fn parse_porcelain_worktrees(output: &str) -> Vec<RawWorktree> {
    let mut list = Vec::new();
    let mut current = RawWorktree::default();
    let mut in_entry = false;

    for line in output.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            if in_entry && !current.path.is_empty() {
                list.push(std::mem::take(&mut current));
                in_entry = false;
            }
            continue;
        }

        if let Some(rest) = trimmed.strip_prefix("worktree ") {
            if in_entry && !current.path.is_empty() {
                list.push(std::mem::take(&mut current));
            }
            current.path = rest.trim().to_string();
            in_entry = true;
        } else if let Some(rest) = trimmed.strip_prefix("HEAD ") {
            current.head = rest.trim().to_string();
        } else if let Some(rest) = trimmed.strip_prefix("branch ") {
            let b = rest.trim();
            current.branch = b.strip_prefix("refs/heads/").unwrap_or(b).to_string();
        } else if trimmed == "detached" && current.branch.is_empty() {
            current.branch = "HEAD".to_string();
        }
    }

    if in_entry && !current.path.is_empty() {
        list.push(current);
    }

    list
}

// ── Core Operations ───────────────────────────────────────────────────────────

/// Lists active worktrees associated with the given project root.
pub fn list_worktrees(project_root: &Path) -> Result<Vec<WorktreeInfo>, String> {
    let output = run_git(project_root, &["worktree", "list", "--porcelain"])?;
    let raw_list = parse_porcelain_worktrees(&output);
    let store = load_metadata(project_root);

    let canon_root = fs::canonicalize(project_root).unwrap_or_else(|_| project_root.to_path_buf());

    let mut result = Vec::new();

    for (idx, raw) in raw_list.into_iter().enumerate() {
        let wt_path = PathBuf::from(&raw.path);
        let canon_wt = fs::canonicalize(&wt_path).unwrap_or_else(|_| wt_path.clone());

        // Skip the main repository working tree
        if idx == 0 || canon_wt == canon_root {
            continue;
        }

        let is_dirty = run_git_status(&wt_path).unwrap_or(false);

        // Find metadata or infer attributes
        let folder_name = wt_path
            .file_name()
            .and_then(|f| f.to_str())
            .unwrap_or("unknown");

        let matched_meta = store
            .worktrees
            .values()
            .find(|m| m.path == raw.path || m.branch == raw.branch || m.task_id == folder_name)
            .cloned();

        let (task_id, base_branch, created_at) = if let Some(meta) = matched_meta {
            (meta.task_id, meta.base_branch, meta.created_at)
        } else {
            let inferred_task = if raw.branch.starts_with("wt/") {
                raw.branch
                    .strip_prefix("wt/")
                    .unwrap_or(&raw.branch)
                    .to_string()
            } else {
                folder_name.to_string()
            };
            let inferred_created = fs::metadata(&wt_path)
                .ok()
                .and_then(|m| m.created().or_else(|_| m.modified()).ok())
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0);
            (inferred_task, "main".to_string(), inferred_created)
        };

        result.push(WorktreeInfo {
            task_id,
            path: raw.path,
            branch: raw.branch,
            base_branch,
            head_sha: raw.head,
            is_dirty,
            created_at,
        });
    }

    Ok(result)
}

/// Creates a new isolated Git worktree for an agent task.
pub fn create_worktree(
    project_root: &Path,
    task_id: &str,
    branch: &str,
    base_branch: Option<&str>,
) -> Result<WorktreeInfo, String> {
    let task_id = sanitize_task_id(task_id)?;
    let branch = sanitize_branch_name(branch)?;
    let base = match base_branch {
        Some(b) if !b.trim().is_empty() => sanitize_branch_name(b)?,
        _ => "main".to_string(),
    };

    let worktrees_dir = project_root.join(".worktrees");
    fs::create_dir_all(&worktrees_dir)
        .map_err(|e| format!("Failed to create .worktrees directory: {}", e))?;

    let wt_path = worktrees_dir.join(&task_id);
    if wt_path.exists() {
        return Err(format!(
            "Worktree path already exists: {}",
            wt_path.display()
        ));
    }

    let wt_path_str = wt_path.to_string_lossy().to_string();

    ensure_worktrees_git_exclude(project_root);

    // Run git worktree add -b <branch> <path> <base_branch_or_main>
    let add_res = run_git(
        project_root,
        &["worktree", "add", "-b", &branch, &wt_path_str, &base],
    );

    if let Err(e) = add_res {
        if e.contains("already exists") {
            // If the branch already exists, attach worktree to existing branch
            run_git(project_root, &["worktree", "add", &wt_path_str, &branch])?;
        } else {
            return Err(e);
        }
    }

    if !wt_path.exists() {
        return Err(format!(
            "Worktree directory was not created at {}",
            wt_path.display()
        ));
    }

    let head_sha = match run_git(&wt_path, &["rev-parse", "HEAD"]) {
        Ok(out) => out.trim().to_string(),
        Err(e) => return Err(format!("Failed to retrieve worktree HEAD: {}", e)),
    };

    let is_dirty = run_git_status(&wt_path).unwrap_or(false);
    let created_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    let info = WorktreeInfo {
        task_id: task_id.clone(),
        path: wt_path_str.clone(),
        branch: branch.clone(),
        base_branch: base.clone(),
        head_sha,
        is_dirty,
        created_at,
    };

    record_worktree(
        project_root,
        WorktreeMetaRecord {
            task_id,
            branch,
            base_branch: base,
            created_at,
            path: wt_path_str,
        },
    );

    Ok(info)
}

/// Retrieves unified diff of changes in the worktree compared to its base branch.
pub fn get_worktree_diff(project_root: &Path, task_id: &str) -> Result<String, String> {
    let sanitized_id = sanitize_task_id(task_id)?;
    let worktrees = list_worktrees(project_root)?;
    let target = worktrees
        .into_iter()
        .find(|w| w.task_id == sanitized_id)
        .or_else(|| {
            let p = project_root.join(".worktrees").join(&sanitized_id);
            if p.exists() {
                let is_dirty = run_git_status(&p).unwrap_or(false);
                let head_sha = run_git(&p, &["rev-parse", "HEAD"])
                    .unwrap_or_default()
                    .trim()
                    .to_string();
                Some(WorktreeInfo {
                    task_id: sanitized_id.clone(),
                    path: p.to_string_lossy().to_string(),
                    branch: format!("wt/{}", sanitized_id),
                    base_branch: "main".to_string(),
                    head_sha,
                    is_dirty,
                    created_at: 0,
                })
            } else {
                None
            }
        })
        .ok_or_else(|| format!("Worktree not found for task_id: {}", sanitized_id))?;

    let wt_path = Path::new(&target.path);
    if !wt_path.exists() {
        return Err(format!(
            "Worktree directory does not exist at {}",
            target.path
        ));
    }

    let base = if target.base_branch.is_empty() {
        "main"
    } else {
        &target.base_branch
    };

    // 1. Get base diff
    let mut diff = if let Ok(mb_out) = run_git(wt_path, &["merge-base", base, "HEAD"]) {
        let mb = mb_out.trim();
        if !mb.is_empty() {
            run_git(wt_path, &["diff", mb]).unwrap_or_default()
        } else {
            run_git(wt_path, &["diff", &format!("{}...HEAD", base)]).unwrap_or_default()
        }
    } else {
        run_git(wt_path, &["diff", &format!("{}...HEAD", base)]).unwrap_or_default()
    };

    // 2. Also check uncommitted diff vs HEAD for tracked files
    if let Ok(uncommitted) = run_git(wt_path, &["diff", "HEAD"]) {
        let uncommitted_trimmed = uncommitted.trim();
        if !uncommitted_trimmed.is_empty() && !diff.contains(uncommitted_trimmed) {
            if !diff.is_empty() && !diff.ends_with('\n') {
                diff.push('\n');
            }
            diff.push_str(uncommitted_trimmed);
            diff.push('\n');
        }
    }

    // 3. Include untracked files from git status --porcelain
    if let Ok(status_out) = run_git(wt_path, &["status", "--porcelain"]) {
        for line in status_out.lines() {
            let trimmed = line.trim();
            if let Some(rel) = trimmed.strip_prefix("?? ") {
                let rel = rel.trim();
                let file_path = wt_path.join(rel);
                if file_path.is_file() {
                    if let Ok(content) = fs::read_to_string(&file_path) {
                        if !diff.is_empty() && !diff.ends_with('\n') {
                            diff.push('\n');
                        }
                        let lines: Vec<&str> = content.lines().collect();
                        let count = lines.len();
                        diff.push_str(&format!(
                            "diff --git a/{rel} b/{rel}\nnew file mode 100644\n--- /dev/null\n+++ b/{rel}\n@@ -0,0 +1,{count} @@\n"
                        ));
                        for l in lines {
                            diff.push('+');
                            diff.push_str(l);
                            diff.push('\n');
                        }
                    }
                }
            }
        }
    }

    Ok(diff)
}

/// Removes a worktree and optionally deletes its temporary branch.
pub fn remove_worktree(
    project_root: &Path,
    task_id: &str,
    delete_branch: bool,
) -> Result<(), String> {
    let sanitized_id = sanitize_task_id(task_id)?;
    let worktrees = list_worktrees(project_root)?;
    let target = worktrees
        .into_iter()
        .find(|w| w.task_id == sanitized_id)
        .or_else(|| {
            let p = project_root.join(".worktrees").join(&sanitized_id);
            if p.exists() {
                Some(WorktreeInfo {
                    task_id: sanitized_id.clone(),
                    path: p.to_string_lossy().to_string(),
                    branch: format!("wt/{}", sanitized_id),
                    base_branch: "main".to_string(),
                    head_sha: String::new(),
                    is_dirty: false,
                    created_at: 0,
                })
            } else {
                None
            }
        })
        .ok_or_else(|| format!("Worktree not found for task_id: {}", sanitized_id))?;

    let canon_root = fs::canonicalize(project_root).unwrap_or_else(|_| project_root.to_path_buf());
    let wt_path = PathBuf::from(&target.path);
    let canon_wt = fs::canonicalize(&wt_path).unwrap_or_else(|_| wt_path.clone());

    if canon_wt == canon_root {
        return Err("Cannot remove main project worktree".to_string());
    }
    if target.branch == "main" || target.branch == "master" {
        return Err("Cannot remove worktree attached to main or master branch".to_string());
    }

    // Execute git worktree remove --force <path>
    let _ = run_git(
        project_root,
        &["worktree", "remove", "--force", &target.path],
    );

    // Cleanup filesystem if leftover
    if wt_path.exists() {
        let _ = fs::remove_dir_all(&wt_path);
    }

    // Prune git worktree records
    let _ = run_git(project_root, &["worktree", "prune"]);

    // If requested, delete temporary branch
    if delete_branch
        && !target.branch.is_empty()
        && target.branch != "main"
        && target.branch != "master"
    {
        let _ = run_git(project_root, &["branch", "-D", &target.branch]);
    }

    remove_worktree_meta(project_root, &sanitized_id);

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sanitization_rules() {
        assert!(sanitize_task_id("t_1c07ce3a").is_ok());
        assert!(sanitize_task_id("task-123").is_ok());
        assert!(sanitize_task_id("../../etc").is_err());
        assert!(sanitize_task_id("/root/hack").is_err());
        assert!(sanitize_task_id("-invalid").is_err());
        assert!(sanitize_task_id(".hidden").is_err());

        assert!(sanitize_branch_name("wt/smart-context-core").is_ok());
        assert!(sanitize_branch_name("feat/123-test").is_ok());
        assert!(sanitize_branch_name("../main").is_err());
        assert!(sanitize_branch_name("wt//double").is_err());
        assert!(sanitize_branch_name("wt/test~1").is_err());
        assert!(sanitize_branch_name("wt/test^2").is_err());
    }

    #[test]
    fn test_porcelain_parser() {
        let sample = r#"
worktree /mnt/repo
HEAD 1111111111111111111111111111111111111111
branch refs/heads/main

worktree /mnt/repo/.worktrees/t_123
HEAD 2222222222222222222222222222222222222222
branch refs/heads/wt/task-1
"#;
        let parsed = parse_porcelain_worktrees(sample);
        assert_eq!(parsed.len(), 2);
        assert_eq!(parsed[0].path, "/mnt/repo");
        assert_eq!(parsed[0].branch, "main");
        assert_eq!(parsed[1].path, "/mnt/repo/.worktrees/t_123");
        assert_eq!(parsed[1].branch, "wt/task-1");
    }
}
