use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const ROLE_MANAGER: &str = "manager";
pub const ROLE_SENIOR: &str = "senior";
pub const ROLE_SENIOR2: &str = "senior2";
pub const ROLE_TECHLEAD: &str = "techlead";
pub const ROLE_REVIEWER: &str = "reviewer";
pub const ROLE_CUSTOM: &str = "custom";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AgentRole {
    Manager,
    Senior,
    Senior2,
    Techlead,
    Reviewer,
    Custom,
}

impl AgentRole {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Manager => ROLE_MANAGER,
            Self::Senior => ROLE_SENIOR,
            Self::Senior2 => ROLE_SENIOR2,
            Self::Techlead => ROLE_TECHLEAD,
            Self::Reviewer => ROLE_REVIEWER,
            Self::Custom => ROLE_CUSTOM,
        }
    }

    pub fn from_str_opt(s: &str) -> Self {
        match s.trim().to_lowercase().as_str() {
            "manager" => Self::Manager,
            "senior" => Self::Senior,
            "senior2" => Self::Senior2,
            "techlead" => Self::Techlead,
            "reviewer" => Self::Reviewer,
            _ => Self::Custom,
        }
    }
}

pub fn default_role_whitelist(role: &str) -> Vec<String> {
    match role.trim().to_lowercase().as_str() {
        ROLE_MANAGER => vec![
            "read_file".to_string(),
            "list_directory".to_string(),
            "search_files".to_string(),
            "kanban_create".to_string(),
            "kanban_list".to_string(),
            "kanban_show".to_string(),
        ],
        ROLE_SENIOR => vec![
            "read_file".to_string(),
            "write_file".to_string(),
            "patch".to_string(),
            "search_files".to_string(),
            "terminal".to_string(),
            "git_worktree".to_string(),
        ],
        ROLE_SENIOR2 => vec![
            "read_file".to_string(),
            "write_file".to_string(),
            "patch".to_string(),
            "search_files".to_string(),
            "terminal".to_string(),
            "flutter_run".to_string(),
        ],
        ROLE_TECHLEAD => vec![
            "git_merge".to_string(),
            "git_checkout".to_string(),
            "review_diff".to_string(),
            "device_control".to_string(),
            "terminal".to_string(),
            "kanban_unblock".to_string(),
        ],
        ROLE_REVIEWER => vec![
            "read_file".to_string(),
            "search_files".to_string(),
            "git_diff".to_string(),
            "run_test".to_string(),
            "kanban_complete".to_string(),
            "kanban_request_changes".to_string(),
        ],
        _ => vec!["read_file".to_string(), "search_files".to_string()],
    }
}

pub fn default_role_blacklist(role: &str) -> Vec<String> {
    match role.trim().to_lowercase().as_str() {
        ROLE_MANAGER => vec![
            "write_file".to_string(),
            "patch".to_string(),
            "terminal".to_string(),
            "kanban_complete".to_string(),
        ],
        ROLE_SENIOR | ROLE_SENIOR2 => vec!["kanban_complete".to_string()],
        ROLE_TECHLEAD => vec!["write_file".to_string(), "patch".to_string()],
        ROLE_REVIEWER => vec![
            "write_file".to_string(),
            "patch".to_string(),
            "terminal".to_string(),
        ],
        _ => vec![
            "write_file".to_string(),
            "patch".to_string(),
            "terminal".to_string(),
            "kanban_complete".to_string(),
        ],
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RoleScopeInfo {
    pub role: String,
    pub label: String,
    pub description: String,
    pub whitelist: Vec<String>,
    pub blacklist: Vec<String>,
}

pub fn get_all_role_scopes() -> Vec<RoleScopeInfo> {
    vec![
        RoleScopeInfo {
            role: ROLE_MANAGER.to_string(),
            label: "Manager".to_string(),
            description: "Perencanaan & koordinasi kanban, read-only kode".to_string(),
            whitelist: default_role_whitelist(ROLE_MANAGER),
            blacklist: default_role_blacklist(ROLE_MANAGER),
        },
        RoleScopeInfo {
            role: ROLE_SENIOR.to_string(),
            label: "Senior (Rust / Core)".to_string(),
            description: "Implementasi backend, build/test terminal, git worktree".to_string(),
            whitelist: default_role_whitelist(ROLE_SENIOR),
            blacklist: default_role_blacklist(ROLE_SENIOR),
        },
        RoleScopeInfo {
            role: ROLE_SENIOR2.to_string(),
            label: "Senior 2 (UI / Svelte)".to_string(),
            description: "Implementasi frontend & flutter run, terminal build".to_string(),
            whitelist: default_role_whitelist(ROLE_SENIOR2),
            blacklist: default_role_blacklist(ROLE_SENIOR2),
        },
        RoleScopeInfo {
            role: ROLE_TECHLEAD.to_string(),
            label: "Techlead".to_string(),
            description: "Integrasi Git branch/merge, review diff, device control, unblock kanban"
                .to_string(),
            whitelist: default_role_whitelist(ROLE_TECHLEAD),
            blacklist: default_role_blacklist(ROLE_TECHLEAD),
        },
        RoleScopeInfo {
            role: ROLE_REVIEWER.to_string(),
            label: "Reviewer".to_string(),
            description: "Audit QA independen, test runner, approval & handoff kanban".to_string(),
            whitelist: default_role_whitelist(ROLE_REVIEWER),
            blacklist: default_role_blacklist(ROLE_REVIEWER),
        },
        RoleScopeInfo {
            role: ROLE_CUSTOM.to_string(),
            label: "Custom".to_string(),
            description: "Wewenang kustom dengan override whitelist mandiri".to_string(),
            whitelist: default_role_whitelist(ROLE_CUSTOM),
            blacklist: default_role_blacklist(ROLE_CUSTOM),
        },
    ]
}

pub fn normalize_tool_name(tool: &str) -> &str {
    match tool.trim() {
        "fs/write_text_file" | "write_text_file" => "write_file",
        "fs/read_text_file" | "read_text_file" => "read_file",
        "fs/list_directory" => "list_directory",
        "bash" | "sh" | "terminal_exec" => "terminal",
        other => other,
    }
}

pub fn tool_matches(configured: &str, requested: &str) -> bool {
    let conf = configured.trim();
    let req = requested.trim();
    if conf.eq_ignore_ascii_case(req) {
        return true;
    }
    let norm_conf = normalize_tool_name(conf);
    let norm_req = normalize_tool_name(req);
    norm_conf.eq_ignore_ascii_case(norm_req)
}

pub fn extract_tool_name(tool_call: &Value) -> Option<String> {
    if let Some(s) = tool_call.as_str() {
        return Some(s.to_string());
    }

    if let Some(name) = tool_call.get("name").and_then(|v| v.as_str()) {
        return Some(name.to_string());
    }
    if let Some(tool) = tool_call.get("tool").and_then(|v| v.as_str()) {
        return Some(tool.to_string());
    }
    if let Some(tool) = tool_call.get("toolName").and_then(|v| v.as_str()) {
        return Some(tool.to_string());
    }
    if let Some(tool) = tool_call.get("tool_name").and_then(|v| v.as_str()) {
        return Some(tool.to_string());
    }
    if let Some(m) = tool_call.get("method").and_then(|v| v.as_str()) {
        return Some(m.to_string());
    }
    if let Some(title) = tool_call.get("title").and_then(|v| v.as_str()) {
        let trimmed = title.trim();
        if !trimmed.is_empty() {
            return Some(trimmed.to_string());
        }
    }
    if let Some(args) = tool_call.get("arguments") {
        if let Some(cmd) = args.get("command").and_then(|v| v.as_str()) {
            if !cmd.trim().is_empty() {
                return Some("terminal".to_string());
            }
        }
    }
    if let Some(params) = tool_call.get("params") {
        if let Some(cmd) = params.get("command").and_then(|v| v.as_str()) {
            if !cmd.trim().is_empty() {
                return Some("terminal".to_string());
            }
        }
    }
    if let Some(cmd) = tool_call.get("command").and_then(|v| v.as_str()) {
        if !cmd.trim().is_empty() {
            return Some("terminal".to_string());
        }
    }

    None
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoleToolScope {
    pub role: String,
    pub whitelist: Vec<String>,
    pub blacklist: Vec<String>,
    #[serde(
        rename = "customWhitelist",
        alias = "custom_whitelist",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub custom_whitelist: Option<Vec<String>>,
}

impl RoleToolScope {
    pub fn for_role(role: &str, custom_whitelist: Option<Vec<String>>) -> Self {
        let norm_role = if role.trim().is_empty() {
            ROLE_CUSTOM.to_string()
        } else {
            role.trim().to_lowercase()
        };
        let mut blacklist = default_role_blacklist(&norm_role);
        let whitelist = if let Some(ref custom) = custom_whitelist {
            blacklist.retain(|b| !custom.iter().any(|c| tool_matches(b, c)));
            custom.clone()
        } else {
            default_role_whitelist(&norm_role)
        };
        Self {
            role: norm_role,
            whitelist,
            blacklist,
            custom_whitelist,
        }
    }

    pub fn from_slot_config(config: &super::slot::SlotConfig) -> Self {
        let role = config.role.as_deref().unwrap_or_else(|| {
            let id_lower = config.id.to_lowercase();
            if matches!(
                id_lower.as_str(),
                "manager" | "senior" | "senior2" | "techlead" | "reviewer"
            ) {
                config.id.as_str()
            } else {
                ROLE_CUSTOM
            }
        });
        Self::for_role(role, config.custom_whitelist.clone())
    }

    pub fn is_blacklisted(&self, tool: &str) -> bool {
        let trimmed = tool.trim();
        self.blacklist.iter().any(|b| tool_matches(b, trimmed))
    }

    pub fn is_whitelisted(&self, tool: &str) -> bool {
        let trimmed = tool.trim();
        self.whitelist.iter().any(|w| tool_matches(w, trimmed))
    }

    pub fn is_tool_allowed(&self, tool: &str) -> bool {
        let trimmed = tool.trim();
        if self.is_blacklisted(trimmed) {
            return false;
        }
        self.is_whitelisted(trimmed)
    }

    pub fn check_permission(&self, tool: &str) -> Result<(), String> {
        let trimmed = tool.trim();
        if self.is_tool_allowed(trimmed) {
            Ok(())
        } else {
            let norm = normalize_tool_name(trimmed);
            Err(format!(
                "ToolExecutionDenied: Role {} does not have permission to execute {}",
                self.role, norm
            ))
        }
    }

    pub fn check_tool_call(&self, tool_call: &Value) -> Result<(), String> {
        if let Some(name) = extract_tool_name(tool_call) {
            self.check_permission(&name)
        } else {
            Err(format!(
                "ToolExecutionDenied: Role {} does not have permission to execute unknown tool",
                self.role
            ))
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolPolicy {
    pub scope: RoleToolScope,
}

impl ToolPolicy {
    pub fn new(role: &str, custom_whitelist: Option<Vec<String>>) -> Self {
        Self {
            scope: RoleToolScope::for_role(role, custom_whitelist),
        }
    }

    pub fn from_slot_config(config: &super::slot::SlotConfig) -> Self {
        Self {
            scope: RoleToolScope::from_slot_config(config),
        }
    }

    pub fn is_allowed(&self, tool: &str) -> bool {
        self.scope.is_tool_allowed(tool)
    }

    pub fn check(&self, tool: &str) -> Result<(), String> {
        self.scope.check_permission(tool)
    }

    pub fn role(&self) -> &str {
        &self.scope.role
    }

    pub fn whitelist(&self) -> &[String] {
        &self.scope.whitelist
    }

    pub fn blacklist(&self) -> &[String] {
        &self.scope.blacklist
    }
}

pub fn filter_tool_schemas(tools: &[Value], scope: &RoleToolScope) -> Vec<Value> {
    tools
        .iter()
        .filter(|t| {
            if let Some(name) = extract_tool_name(t) {
                scope.is_tool_allowed(&name)
            } else {
                false
            }
        })
        .cloned()
        .collect()
}

pub fn filter_advertised_tools(tools: &[Value], scope: &RoleToolScope) -> Vec<Value> {
    filter_tool_schemas(tools, scope)
}

pub fn filter_tools_list_response(resp: &Value, scope: &RoleToolScope) -> Value {
    if let Some(arr) = resp.get("tools").and_then(|t| t.as_array()) {
        let filtered = filter_tool_schemas(arr, scope);
        let mut obj = resp.clone();
        if let Some(map) = obj.as_object_mut() {
            map.insert("tools".to_string(), Value::Array(filtered));
        }
        obj
    } else if let Some(arr) = resp.as_array() {
        Value::Array(filter_tool_schemas(arr, scope))
    } else {
        resp.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_role_whitelist_and_blacklist_evaluation() {
        // 1. Manager: read/plan only
        let mgr_scope = RoleToolScope::for_role(ROLE_MANAGER, None);
        assert!(mgr_scope.is_tool_allowed("read_file"));
        assert!(mgr_scope.is_tool_allowed("list_directory"));
        assert!(mgr_scope.is_tool_allowed("search_files"));
        assert!(mgr_scope.is_tool_allowed("kanban_create"));
        assert!(mgr_scope.is_tool_allowed("kanban_list"));
        assert!(mgr_scope.is_tool_allowed("kanban_show"));
        // Blacklisted
        assert!(!mgr_scope.is_tool_allowed("write_file"));
        assert!(!mgr_scope.is_tool_allowed("patch"));
        assert!(!mgr_scope.is_tool_allowed("terminal"));
        assert!(!mgr_scope.is_tool_allowed("kanban_complete"));
        // Not in whitelist
        assert!(!mgr_scope.is_tool_allowed("git_merge"));

        // 2. Senior (Rust): write/patch/terminal/git_worktree, cannot complete kanban
        let snr_scope = RoleToolScope::for_role(ROLE_SENIOR, None);
        assert!(snr_scope.is_tool_allowed("read_file"));
        assert!(snr_scope.is_tool_allowed("write_file"));
        assert!(snr_scope.is_tool_allowed("patch"));
        assert!(snr_scope.is_tool_allowed("search_files"));
        assert!(snr_scope.is_tool_allowed("terminal"));
        assert!(snr_scope.is_tool_allowed("git_worktree"));
        assert!(!snr_scope.is_tool_allowed("kanban_complete"));
        assert!(!snr_scope.is_tool_allowed("device_control"));

        // 3. Senior 2 (UI): write/patch/flutter_run, cannot complete kanban
        let snr2_scope = RoleToolScope::for_role(ROLE_SENIOR2, None);
        assert!(snr2_scope.is_tool_allowed("read_file"));
        assert!(snr2_scope.is_tool_allowed("write_file"));
        assert!(snr2_scope.is_tool_allowed("patch"));
        assert!(snr2_scope.is_tool_allowed("search_files"));
        assert!(snr2_scope.is_tool_allowed("terminal"));
        assert!(snr2_scope.is_tool_allowed("flutter_run"));
        assert!(!snr2_scope.is_tool_allowed("kanban_complete"));
        assert!(!snr2_scope.is_tool_allowed("git_worktree"));

        // 4. Techlead: merge/checkout/review/device_control/kanban_unblock, no dirty editing
        let tl_scope = RoleToolScope::for_role(ROLE_TECHLEAD, None);
        assert!(tl_scope.is_tool_allowed("git_merge"));
        assert!(tl_scope.is_tool_allowed("git_checkout"));
        assert!(tl_scope.is_tool_allowed("review_diff"));
        assert!(tl_scope.is_tool_allowed("device_control"));
        assert!(tl_scope.is_tool_allowed("terminal"));
        assert!(tl_scope.is_tool_allowed("kanban_unblock"));
        assert!(!tl_scope.is_tool_allowed("write_file"));
        assert!(!tl_scope.is_tool_allowed("patch"));

        // 5. Reviewer: read/search/diff/run_test/kanban_complete/kanban_request_changes, no edit/terminal
        let rev_scope = RoleToolScope::for_role(ROLE_REVIEWER, None);
        assert!(rev_scope.is_tool_allowed("read_file"));
        assert!(rev_scope.is_tool_allowed("search_files"));
        assert!(rev_scope.is_tool_allowed("git_diff"));
        assert!(rev_scope.is_tool_allowed("run_test"));
        assert!(rev_scope.is_tool_allowed("kanban_complete"));
        assert!(rev_scope.is_tool_allowed("kanban_request_changes"));
        assert!(!rev_scope.is_tool_allowed("write_file"));
        assert!(!rev_scope.is_tool_allowed("patch"));
        assert!(!rev_scope.is_tool_allowed("terminal"));

        // 6. Custom / default
        let custom_scope = RoleToolScope::for_role("custom", None);
        assert!(custom_scope.is_tool_allowed("read_file"));
        assert!(custom_scope.is_tool_allowed("search_files"));
        assert!(!custom_scope.is_tool_allowed("write_file"));
        assert!(!custom_scope.is_tool_allowed("terminal"));
        assert!(!custom_scope.is_tool_allowed("kanban_complete"));
    }

    #[test]
    fn test_rpc_denial_error_format() {
        let mgr = RoleToolScope::for_role("manager", None);
        let err = mgr.check_permission("write_file").unwrap_err();
        assert_eq!(
            err,
            "ToolExecutionDenied: Role manager does not have permission to execute write_file"
        );

        let snr = RoleToolScope::for_role("senior", None);
        let err2 = snr.check_permission("kanban_complete").unwrap_err();
        assert_eq!(
            err2,
            "ToolExecutionDenied: Role senior does not have permission to execute kanban_complete"
        );

        let tl = RoleToolScope::for_role("techlead", None);
        let err3 = tl.check_permission("patch").unwrap_err();
        assert_eq!(
            err3,
            "ToolExecutionDenied: Role techlead does not have permission to execute patch"
        );

        let rev = RoleToolScope::for_role("reviewer", None);
        let err4 = rev.check_permission("terminal").unwrap_err();
        assert_eq!(
            err4,
            "ToolExecutionDenied: Role reviewer does not have permission to execute terminal"
        );
    }

    #[test]
    fn test_custom_whitelist_override() {
        // Override manager role to permit write_file
        let mgr_override = RoleToolScope::for_role(
            "manager",
            Some(vec!["read_file".to_string(), "write_file".to_string()]),
        );
        assert!(mgr_override.is_tool_allowed("read_file"));
        assert!(mgr_override.is_tool_allowed("write_file"));
        assert!(!mgr_override.is_tool_allowed("terminal"));
        assert!(!mgr_override.is_tool_allowed("patch"));

        // Custom role with specific tools
        let custom_override = RoleToolScope::for_role(
            "custom",
            Some(vec!["flutter_run".to_string(), "read_file".to_string()]),
        );
        assert!(custom_override.is_tool_allowed("flutter_run"));
        assert!(custom_override.is_tool_allowed("read_file"));
        assert!(!custom_override.is_tool_allowed("write_file"));
        assert!(!custom_override.is_tool_allowed("search_files"));
    }

    #[test]
    fn test_schema_filtering_and_token_pruning() {
        let tools = vec![
            serde_json::json!({ "name": "read_file", "description": "Read file contents", "inputSchema": { "type": "object", "properties": { "path": { "type": "string" } } } }),
            serde_json::json!({ "name": "write_file", "description": "Write file contents to disk", "inputSchema": { "type": "object", "properties": { "path": { "type": "string" }, "content": { "type": "string" } } } }),
            serde_json::json!({ "name": "patch", "description": "Apply targeted find-and-replace patch", "inputSchema": { "type": "object", "properties": { "path": { "type": "string" }, "patch": { "type": "string" } } } }),
            serde_json::json!({ "name": "terminal", "description": "Execute shell command in terminal", "inputSchema": { "type": "object", "properties": { "command": { "type": "string" } } } }),
            serde_json::json!({ "name": "git_worktree", "description": "Manage git worktree", "inputSchema": { "type": "object" } }),
            serde_json::json!({ "name": "git_merge", "description": "Merge git branch", "inputSchema": { "type": "object" } }),
            serde_json::json!({ "name": "git_checkout", "description": "Checkout git branch", "inputSchema": { "type": "object" } }),
            serde_json::json!({ "name": "review_diff", "description": "Review git diff", "inputSchema": { "type": "object" } }),
            serde_json::json!({ "name": "device_control", "description": "Control emulator or phone device", "inputSchema": { "type": "object" } }),
            serde_json::json!({ "name": "kanban_unblock", "description": "Unblock kanban task", "inputSchema": { "type": "object" } }),
            serde_json::json!({ "name": "kanban_create", "description": "Create kanban task", "inputSchema": { "type": "object" } }),
            serde_json::json!({ "name": "kanban_list", "description": "List kanban tasks", "inputSchema": { "type": "object" } }),
            serde_json::json!({ "name": "kanban_show", "description": "Show kanban task detail", "inputSchema": { "type": "object" } }),
            serde_json::json!({ "name": "kanban_complete", "description": "Complete kanban task", "inputSchema": { "type": "object" } }),
            serde_json::json!({ "name": "run_test", "description": "Run test suite", "inputSchema": { "type": "object" } }),
            serde_json::json!({ "name": "flutter_run", "description": "Run flutter app", "inputSchema": { "type": "object" } }),
        ];

        let original_count = tools.len();
        let original_bytes = serde_json::to_string(&tools).unwrap().len();

        let mgr_scope = RoleToolScope::for_role(ROLE_MANAGER, None);
        let filtered = filter_tool_schemas(&tools, &mgr_scope);

        let filtered_count = filtered.len();
        let filtered_bytes = serde_json::to_string(&filtered).unwrap().len();

        // Manager allowed: read_file, kanban_create, kanban_list, kanban_show (4 out of 16)
        assert_eq!(filtered_count, 4);

        let count_reduction_pct =
            (original_count - filtered_count) as f64 / original_count as f64 * 100.0;
        let bytes_reduction_pct =
            (original_bytes - filtered_bytes) as f64 / original_bytes as f64 * 100.0;

        assert!(
            count_reduction_pct >= 60.0,
            "Count reduction {count_reduction_pct}% must be >= 60%"
        );
        assert!(
            bytes_reduction_pct >= 60.0,
            "Token/bytes reduction {bytes_reduction_pct}% must be >= 60%"
        );

        // Test filter_tools_list_response wrapper
        let resp = serde_json::json!({ "tools": tools });
        let filtered_resp = filter_tools_list_response(&resp, &mgr_scope);
        assert_eq!(
            filtered_resp["tools"].as_array().unwrap().len(),
            filtered_count
        );
    }
}
