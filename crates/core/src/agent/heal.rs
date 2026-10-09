use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::SystemTime;

/// Phase representation of the autonomous self-healing loop.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SelfHealPhase {
    Idle,
    HotReloading,
    Testing,
    Passed,
    Failed,
    Paused,
}

/// Status record for a specific agent task's self-healing loop state.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SelfHealStatus {
    pub task_id: String,
    pub active_file: String,
    pub status: SelfHealPhase,
    pub attempt: u32,
    pub max_attempts: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_verified_at: Option<u64>,
}

/// Verification result returned by trigger_self_heal.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SelfHealResult {
    pub task_id: String,
    pub success: bool,
    pub attempts: u32,
    pub status: SelfHealPhase,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub diagnosis_prompt: Option<String>,
}

/// Formats the diagnostic prompt packet for the agent when verification fails.
pub fn build_diagnosis_prompt(
    task_id: &str,
    active_file: &str,
    attempt: u32,
    max_attempts: u32,
    error: &str,
) -> String {
    format!(
        "[SELF-HEALING: VERIFICATION FAILED]\nTask: {}\nFile: {}\nAttempt: {}/{}\nError: {}\nAction: Inspect the error above, fix the code in {}, and output updated patch.",
        task_id, active_file, attempt, max_attempts, error, active_file
    )
}

/// Helper to get current unix epoch timestamp in seconds.
fn current_timestamp_secs() -> u64 {
    SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Checks bracket, parenthesis, and brace balance in code files.
pub fn check_syntax_balance(content: &str) -> Result<(), String> {
    let mut stack = Vec::new();
    let mut in_single_quote = false;
    let mut in_double_quote = false;
    let mut in_line_comment = false;
    let mut in_block_comment = false;
    let mut chars = content.chars().peekable();
    let mut line = 1;
    let mut col = 0;

    while let Some(ch) = chars.next() {
        col += 1;
        if ch == '\n' {
            line += 1;
            col = 0;
            if in_line_comment {
                in_line_comment = false;
            }
            continue;
        }

        if in_line_comment {
            continue;
        }

        if in_block_comment {
            if ch == '*' && chars.peek() == Some(&'/') {
                chars.next();
                col += 1;
                in_block_comment = false;
            }
            continue;
        }

        if in_single_quote {
            if ch == '\\' {
                chars.next();
                col += 1;
            } else if ch == '\'' {
                in_single_quote = false;
            }
            continue;
        }

        if in_double_quote {
            if ch == '\\' {
                chars.next();
                col += 1;
            } else if ch == '"' {
                in_double_quote = false;
            }
            continue;
        }

        if ch == '/' {
            if chars.peek() == Some(&'/') {
                chars.next();
                col += 1;
                in_line_comment = true;
                continue;
            } else if chars.peek() == Some(&'*') {
                chars.next();
                col += 1;
                in_block_comment = true;
                continue;
            }
        }

        if ch == '\'' {
            in_single_quote = true;
            continue;
        }

        if ch == '"' {
            in_double_quote = true;
            continue;
        }

        match ch {
            '(' | '{' | '[' => {
                stack.push((ch, line, col));
            }
            ')' => {
                match stack.pop() {
                    Some(('(', _, _)) => {}
                    Some((open, l, c)) => {
                        return Err(format!(
                            "Mismatched closing ')' for opening '{}' at line {}:{}",
                            open, l, c
                        ));
                    }
                    None => {
                        return Err(format!("Unexpected closing ')' at line {}:{}", line, col));
                    }
                }
            }
            '}' => {
                match stack.pop() {
                    Some(('{', _, _)) => {}
                    Some((open, l, c)) => {
                        return Err(format!(
                            "Mismatched closing '}}' for opening '{}' at line {}:{}",
                            open, l, c
                        ));
                    }
                    None => {
                        return Err(format!("Unexpected closing '}}' at line {}:{}", line, col));
                    }
                }
            }
            ']' => {
                match stack.pop() {
                    Some(('[', _, _)) => {}
                    Some((open, l, c)) => {
                        return Err(format!(
                            "Mismatched closing ']' for opening '{}' at line {}:{}",
                            open, l, c
                        ));
                    }
                    None => {
                        return Err(format!("Unexpected closing ']' at line {}:{}", line, col));
                    }
                }
            }
            _ => {}
        }
    }

    if let Some((open, l, c)) = stack.pop() {
        return Err(format!(
            "Unclosed delimiter '{}' opened at line {}:{}",
            open, l, c
        ));
    }

    Ok(())
}

/// Validates file integrity when no flow tests are defined.
pub fn validate_file_integrity(
    project_root: Option<&Path>,
    active_file: &str,
) -> Result<(), String> {
    if active_file.trim().is_empty() {
        return Err("Active file path is empty".to_string());
    }

    let full_path = match project_root {
        Some(root) => root.join(active_file),
        None => PathBuf::from(active_file),
    };

    if !full_path.exists() {
        return Err(format!("File '{}' does not exist", active_file));
    }

    if !full_path.is_file() {
        return Err(format!("Path '{}' is not a regular file", active_file));
    }

    let content = fs::read_to_string(&full_path)
        .map_err(|e| format!("Failed to read file '{}': {}", active_file, e))?;

    if active_file.ends_with(".json") {
        serde_json::from_str::<serde_json::Value>(&content)
            .map_err(|e| format!("JSON syntax error in '{}': {}", active_file, e))?;
    } else if active_file.ends_with(".yaml") || active_file.ends_with(".yml") {
        serde_yaml::from_str::<serde_yaml::Value>(&content)
            .map_err(|e| format!("YAML syntax error in '{}': {}", active_file, e))?;
    } else if active_file.ends_with(".rs")
        || active_file.ends_with(".dart")
        || active_file.ends_with(".ts")
        || active_file.ends_with(".js")
        || active_file.ends_with(".svelte")
    {
        check_syntax_balance(&content)
            .map_err(|e| format!("Syntax balance error in '{}': {}", active_file, e))?;
    }

    Ok(())
}

/// Discovers flow test files in `.petak/flows/*.yaml` or `.maestro/*.yaml`.
pub fn find_flow_files(project_root: Option<&Path>) -> Vec<PathBuf> {
    let base = project_root.unwrap_or(Path::new("."));
    let mut files = Vec::new();
    let candidates = [base.join(".petak").join("flows"), base.join(".maestro")];

    for dir in &candidates {
        if dir.exists() && dir.is_dir() {
            if let Ok(entries) = fs::read_dir(dir) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.is_file() {
                        if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
                            if ext == "yaml" || ext == "yml" {
                                files.push(path);
                            }
                        }
                    }
                }
            }
        }
    }

    files.sort();
    files
}

/// Autonomous self-healing manager tracking state per task.
#[derive(Debug)]
pub struct SelfHealingManager {
    statuses: Mutex<HashMap<String, SelfHealStatus>>,
}

impl Default for SelfHealingManager {
    fn default() -> Self {
        Self::new()
    }
}

impl SelfHealingManager {
    pub fn new() -> Self {
        Self {
            statuses: Mutex::new(HashMap::new()),
        }
    }

    /// Retrieve the current status of a self-healing task slot.
    pub fn get_self_heal_status(&self, task_id: &str) -> Option<SelfHealStatus> {
        let map = self.statuses.lock().ok()?;
        map.get(task_id).cloned()
    }

    /// Reset status for a specific task slot.
    pub fn reset(&self, task_id: &str) {
        if let Ok(mut map) = self.statuses.lock() {
            map.remove(task_id);
        }
    }

    /// Clear all task statuses.
    pub fn clear(&self) {
        if let Ok(mut map) = self.statuses.lock() {
            map.clear();
        }
    }

    /// Execute the autonomous self-healing loop:
    /// Check bounds -> Hot Reload -> Maestro Flow / Integrity -> Diagnostics / Prompt.
    pub fn trigger_self_heal(
        &self,
        task_id: &str,
        active_file: &str,
        project_root: Option<&Path>,
    ) -> Result<SelfHealResult, String> {
        let now = current_timestamp_secs();

        // 1. Bound check & initial state transition
        {
            let mut map = self.statuses.lock().map_err(|e| e.to_string())?;
            let status = map.entry(task_id.to_string()).or_insert_with(|| SelfHealStatus {
                task_id: task_id.to_string(),
                active_file: active_file.to_string(),
                status: SelfHealPhase::Idle,
                attempt: 0,
                max_attempts: 3,
                error: None,
                last_verified_at: None,
            });

            status.active_file = active_file.to_string();

            if status.status == SelfHealPhase::Paused || status.attempt >= status.max_attempts {
                status.status = SelfHealPhase::Paused;
                return Ok(SelfHealResult {
                    task_id: task_id.to_string(),
                    success: false,
                    attempts: status.attempt,
                    status: SelfHealPhase::Paused,
                    message: format!(
                        "Self-healing paused: maximum attempts ({}/{}) reached for user intervention.",
                        status.attempt, status.max_attempts
                    ),
                    diagnosis_prompt: None,
                });
            }

            status.status = SelfHealPhase::HotReloading;
        }

        // 2. Step 1: Hot Reload
        let mut reload_error: Option<String> = None;
        if crate::run::flutter::is_flutter_runner_active() {
            match crate::run::flutter::hot_reload() {
                Ok(reload_res) => {
                    if !reload_res.ok {
                        reload_error = Some(
                            reload_res
                                .message
                                .unwrap_or_else(|| "Flutter hot reload failed".to_string()),
                        );
                    }
                }
                Err(e) => {
                    reload_error = Some(format!("Flutter hot reload error: {}", e));
                }
            }
        }

        if let Some(err) = reload_error {
            return self.handle_failure(task_id, active_file, err, now);
        }

        // 3. Step 2: Testing Phase
        {
            let mut map = self.statuses.lock().map_err(|e| e.to_string())?;
            if let Some(st) = map.get_mut(task_id) {
                st.status = SelfHealPhase::Testing;
            }
        }

        let flow_files = find_flow_files(project_root);
        if !flow_files.is_empty() {
            for flow_path in flow_files {
                let stem = flow_path
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("flow");
                match crate::run::flow::run_flow_sync(project_root, stem, None) {
                    Ok(run_result) => {
                        if !run_result.success {
                            let err_msg = run_result
                                .error
                                .unwrap_or_else(|| format!("Flow '{}' execution failed", stem));
                            return self.handle_failure(task_id, active_file, err_msg, now);
                        }
                    }
                    Err(e) => {
                        return self.handle_failure(task_id, active_file, e, now);
                    }
                }
            }
        } else {
            // File integrity validation fallback
            if let Err(e) = validate_file_integrity(project_root, active_file) {
                return self.handle_failure(task_id, active_file, e, now);
            }
        }

        // 4. Verification Passed
        {
            let mut map = self.statuses.lock().map_err(|e| e.to_string())?;
            if let Some(st) = map.get_mut(task_id) {
                st.status = SelfHealPhase::Passed;
                st.error = None;
                st.last_verified_at = Some(now);
                if st.attempt == 0 {
                    st.attempt = 1;
                }
                let attempts = st.attempt;
                return Ok(SelfHealResult {
                    task_id: task_id.to_string(),
                    success: true,
                    attempts,
                    status: SelfHealPhase::Passed,
                    message: "Self-healing verification passed successfully".to_string(),
                    diagnosis_prompt: None,
                });
            }
        }

        Err(format!("Task '{}' status missing during verification", task_id))
    }

    fn handle_failure(
        &self,
        task_id: &str,
        active_file: &str,
        error_details: String,
        timestamp: u64,
    ) -> Result<SelfHealResult, String> {
        let mut map = self.statuses.lock().map_err(|e| e.to_string())?;
        let status = map.entry(task_id.to_string()).or_insert_with(|| SelfHealStatus {
            task_id: task_id.to_string(),
            active_file: active_file.to_string(),
            status: SelfHealPhase::Failed,
            attempt: 0,
            max_attempts: 3,
            error: None,
            last_verified_at: None,
        });

        status.attempt += 1;
        let attempt = status.attempt;
        let max_attempts = status.max_attempts;
        status.error = Some(error_details.clone());
        status.last_verified_at = Some(timestamp);

        if attempt <= max_attempts {
            status.status = SelfHealPhase::Failed;
            let prompt = build_diagnosis_prompt(
                task_id,
                active_file,
                attempt,
                max_attempts,
                &error_details,
            );
            Ok(SelfHealResult {
                task_id: task_id.to_string(),
                success: false,
                attempts: attempt,
                status: SelfHealPhase::Failed,
                message: format!("Verification failed on attempt {}/{}", attempt, max_attempts),
                diagnosis_prompt: Some(prompt),
            })
        } else {
            status.status = SelfHealPhase::Paused;
            Ok(SelfHealResult {
                task_id: task_id.to_string(),
                success: false,
                attempts: attempt,
                status: SelfHealPhase::Paused,
                message: format!(
                    "Self-healing paused: maximum attempts ({}/{}) reached for user intervention.",
                    attempt, max_attempts
                ),
                diagnosis_prompt: None,
            })
        }
    }
}

/// Type alias for SelfHealingManager
pub type SelfHealingLoop = SelfHealingManager;

static GLOBAL_HEAL_MANAGER: OnceLock<SelfHealingManager> = OnceLock::new();

pub fn get_heal_manager() -> &'static SelfHealingManager {
    GLOBAL_HEAL_MANAGER.get_or_init(SelfHealingManager::new)
}

/// Standalone entry point for triggering self-healing loop.
pub fn trigger_self_heal(
    task_id: &str,
    active_file: &str,
    project_root: Option<&Path>,
) -> Result<SelfHealResult, String> {
    get_heal_manager().trigger_self_heal(task_id, active_file, project_root)
}

/// Standalone entry point for querying task self-healing status.
pub fn get_self_heal_status(task_id: &str) -> Option<SelfHealStatus> {
    get_heal_manager().get_self_heal_status(task_id)
}

/// Standalone helper to reset task self-healing status.
pub fn reset_self_heal(task_id: &str) {
    get_heal_manager().reset(task_id);
}
