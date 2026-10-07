use petak_core::agent::{
    filter_advertised_tools, filter_tool_schemas, filter_tools_list_response,
    get_all_role_scopes, RoleToolScope, SlotConfig, SlotManager,
    ROLE_CUSTOM, ROLE_MANAGER, ROLE_REVIEWER, ROLE_SENIOR, ROLE_SENIOR2, ROLE_TECHLEAD,
};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;

fn fake_agent_script_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("fixtures")
        .join("fake_agent.mjs")
}

fn make_fake_role_slot(id: &str, label: &str, role: &str) -> SlotConfig {
    let script = fake_agent_script_path();
    SlotConfig {
        id: id.to_string(),
        label: label.to_string(),
        kind: "acp-custom".to_string(),
        engine: Some("acp-custom".to_string()),
        command: Some(format!("node {}", script.to_string_lossy())),
        hermes_profile: None,
        model: Some("fake-model-alpha".to_string()),
        fallback_model: Some("fake-model-beta".to_string()),
        permission: "full".to_string(),
        cwd: "project".to_string(),
        role: Some(role.to_string()),
        custom_whitelist: None,
    }
}

#[test]
fn test_all_roles_whitelist_and_blacklist_matrix() {
    // 1. Manager
    let mgr = RoleToolScope::for_role(ROLE_MANAGER, None);
    assert_eq!(mgr.role, "manager");
    assert!(mgr.is_tool_allowed("read_file"));
    assert!(mgr.is_tool_allowed("list_directory"));
    assert!(mgr.is_tool_allowed("search_files"));
    assert!(mgr.is_tool_allowed("kanban_create"));
    assert!(mgr.is_tool_allowed("kanban_list"));
    assert!(mgr.is_tool_allowed("kanban_show"));
    assert!(!mgr.is_tool_allowed("write_file"));
    assert!(!mgr.is_tool_allowed("patch"));
    assert!(!mgr.is_tool_allowed("terminal"));
    assert!(!mgr.is_tool_allowed("kanban_complete"));
    assert!(!mgr.is_tool_allowed("git_merge"));

    // 2. Senior
    let snr = RoleToolScope::for_role(ROLE_SENIOR, None);
    assert_eq!(snr.role, "senior");
    assert!(snr.is_tool_allowed("read_file"));
    assert!(snr.is_tool_allowed("write_file"));
    assert!(snr.is_tool_allowed("patch"));
    assert!(snr.is_tool_allowed("search_files"));
    assert!(snr.is_tool_allowed("terminal"));
    assert!(snr.is_tool_allowed("git_worktree"));
    assert!(!snr.is_tool_allowed("kanban_complete"));
    assert!(!snr.is_tool_allowed("git_merge"));

    // 3. Senior2
    let snr2 = RoleToolScope::for_role(ROLE_SENIOR2, None);
    assert_eq!(snr2.role, "senior2");
    assert!(snr2.is_tool_allowed("read_file"));
    assert!(snr2.is_tool_allowed("write_file"));
    assert!(snr2.is_tool_allowed("patch"));
    assert!(snr2.is_tool_allowed("search_files"));
    assert!(snr2.is_tool_allowed("terminal"));
    assert!(snr2.is_tool_allowed("flutter_run"));
    assert!(!snr2.is_tool_allowed("kanban_complete"));
    assert!(!snr2.is_tool_allowed("git_worktree"));

    // 4. Techlead
    let tl = RoleToolScope::for_role(ROLE_TECHLEAD, None);
    assert_eq!(tl.role, "techlead");
    assert!(tl.is_tool_allowed("git_merge"));
    assert!(tl.is_tool_allowed("git_checkout"));
    assert!(tl.is_tool_allowed("review_diff"));
    assert!(tl.is_tool_allowed("device_control"));
    assert!(tl.is_tool_allowed("terminal"));
    assert!(tl.is_tool_allowed("kanban_unblock"));
    assert!(!tl.is_tool_allowed("write_file"));
    assert!(!tl.is_tool_allowed("patch"));

    // 5. Reviewer
    let rev = RoleToolScope::for_role(ROLE_REVIEWER, None);
    assert_eq!(rev.role, "reviewer");
    assert!(rev.is_tool_allowed("read_file"));
    assert!(rev.is_tool_allowed("search_files"));
    assert!(rev.is_tool_allowed("git_diff"));
    assert!(rev.is_tool_allowed("run_test"));
    assert!(rev.is_tool_allowed("kanban_complete"));
    assert!(rev.is_tool_allowed("kanban_request_changes"));
    assert!(!rev.is_tool_allowed("write_file"));
    assert!(!rev.is_tool_allowed("patch"));
    assert!(!rev.is_tool_allowed("terminal"));

    // 6. Custom / default fallback
    let custom = RoleToolScope::for_role(ROLE_CUSTOM, None);
    assert_eq!(custom.role, "custom");
    assert!(custom.is_tool_allowed("read_file"));
    assert!(custom.is_tool_allowed("search_files"));
    assert!(!custom.is_tool_allowed("write_file"));
    assert!(!custom.is_tool_allowed("patch"));
    assert!(!custom.is_tool_allowed("terminal"));
    assert!(!custom.is_tool_allowed("kanban_complete"));
}

#[test]
fn test_rpc_denial_authoritative_error_format() {
    let mgr = RoleToolScope::for_role("manager", None);
    let err_mgr = mgr.check_permission("write_file").unwrap_err();
    assert_eq!(
        err_mgr,
        "ToolExecutionDenied: Role manager does not have permission to execute write_file"
    );

    let snr = RoleToolScope::for_role("senior", None);
    let err_snr = snr.check_permission("kanban_complete").unwrap_err();
    assert_eq!(
        err_snr,
        "ToolExecutionDenied: Role senior does not have permission to execute kanban_complete"
    );

    let tl = RoleToolScope::for_role("techlead", None);
    let err_tl = tl.check_permission("patch").unwrap_err();
    assert_eq!(
        err_tl,
        "ToolExecutionDenied: Role techlead does not have permission to execute patch"
    );

    let rev = RoleToolScope::for_role("reviewer", None);
    let err_rev = rev.check_permission("terminal").unwrap_err();
    assert_eq!(
        err_rev,
        "ToolExecutionDenied: Role reviewer does not have permission to execute terminal"
    );

    // Testing ACP method name alias mapping
    let err_mgr_acp = mgr.check_permission("fs/write_text_file").unwrap_err();
    assert_eq!(
        err_mgr_acp,
        "ToolExecutionDenied: Role manager does not have permission to execute write_file"
    );
}

#[test]
fn test_custom_whitelist_advanced_override() {
    // Override manager role to permit write_file and terminal
    let mgr_custom = RoleToolScope::for_role(
        "manager",
        Some(vec![
            "read_file".to_string(),
            "write_file".to_string(),
            "terminal".to_string(),
        ]),
    );
    assert!(mgr_custom.is_tool_allowed("read_file"));
    assert!(mgr_custom.is_tool_allowed("write_file"));
    assert!(mgr_custom.is_tool_allowed("terminal"));
    assert!(!mgr_custom.is_tool_allowed("patch"));
    assert!(!mgr_custom.is_tool_allowed("kanban_complete"));

    // Custom role with specific whitelist
    let custom = RoleToolScope::for_role(
        "custom",
        Some(vec![
            "flutter_run".to_string(),
            "device_control".to_string(),
        ]),
    );
    assert!(custom.is_tool_allowed("flutter_run"));
    assert!(custom.is_tool_allowed("device_control"));
    assert!(!custom.is_tool_allowed("read_file"));
}

#[test]
fn test_schema_token_pruning_gte_60_percent() {
    let full_tools = vec![
        serde_json::json!({
            "name": "read_file",
            "description": "Read file contents at path",
            "parameters": { "type": "object", "properties": { "path": { "type": "string" } } }
        }),
        serde_json::json!({
            "name": "write_file",
            "description": "Write entire file contents to disk at path",
            "parameters": { "type": "object", "properties": { "path": { "type": "string" }, "content": { "type": "string" } } }
        }),
        serde_json::json!({
            "name": "patch",
            "description": "Apply fuzzy find-and-replace edit to file",
            "parameters": { "type": "object", "properties": { "path": { "type": "string" }, "old": { "type": "string" }, "new": { "type": "string" } } }
        }),
        serde_json::json!({
            "name": "terminal",
            "description": "Execute arbitrary shell command in session",
            "parameters": { "type": "object", "properties": { "command": { "type": "string" } } }
        }),
        serde_json::json!({
            "name": "git_worktree",
            "description": "Create and switch to git worktree branch",
            "parameters": { "type": "object" }
        }),
        serde_json::json!({
            "name": "git_merge",
            "description": "Merge branch into target base branch",
            "parameters": { "type": "object" }
        }),
        serde_json::json!({
            "name": "git_checkout",
            "description": "Checkout git branch or commit",
            "parameters": { "type": "object" }
        }),
        serde_json::json!({
            "name": "review_diff",
            "description": "Review unified diff between branches",
            "parameters": { "type": "object" }
        }),
        serde_json::json!({
            "name": "device_control",
            "description": "Control device or headless android emulator",
            "parameters": { "type": "object" }
        }),
        serde_json::json!({
            "name": "kanban_unblock",
            "description": "Unblock blocked kanban task with resolution",
            "parameters": { "type": "object" }
        }),
        serde_json::json!({
            "name": "kanban_create",
            "description": "Create new kanban task card",
            "parameters": { "type": "object" }
        }),
        serde_json::json!({
            "name": "kanban_list",
            "description": "List all active kanban cards",
            "parameters": { "type": "object" }
        }),
        serde_json::json!({
            "name": "kanban_show",
            "description": "Show detailed task body and worker context",
            "parameters": { "type": "object" }
        }),
        serde_json::json!({
            "name": "kanban_complete",
            "description": "Mark task done and publish deliverables",
            "parameters": { "type": "object" }
        }),
        serde_json::json!({
            "name": "kanban_request_changes",
            "description": "Request changes on review handoff",
            "parameters": { "type": "object" }
        }),
        serde_json::json!({
            "name": "run_test",
            "description": "Run test suite cargo/maestro/vitest",
            "parameters": { "type": "object" }
        }),
        serde_json::json!({
            "name": "flutter_run",
            "description": "Run flutter app on target device emulator",
            "parameters": { "type": "object" }
        }),
    ];

    let orig_count = full_tools.len();
    let orig_bytes = serde_json::to_string(&full_tools).unwrap().len();

    // 1. Manager filtering
    let mgr_scope = RoleToolScope::for_role(ROLE_MANAGER, None);
    let mgr_filtered = filter_tool_schemas(&full_tools, &mgr_scope);
    let mgr_bytes = serde_json::to_string(&mgr_filtered).unwrap().len();

    let count_pruned_pct = (orig_count - mgr_filtered.len()) as f64 / orig_count as f64 * 100.0;
    let bytes_pruned_pct = (orig_bytes - mgr_bytes) as f64 / orig_bytes as f64 * 100.0;

    assert!(
        count_pruned_pct >= 60.0,
        "Manager count pruned {count_pruned_pct}% must be >= 60%"
    );
    assert!(
        bytes_pruned_pct >= 60.0,
        "Manager bytes/tokens pruned {bytes_pruned_pct}% must be >= 60%"
    );

    // 2. Reviewer filtering
    let rev_scope = RoleToolScope::for_role(ROLE_REVIEWER, None);
    let rev_filtered = filter_advertised_tools(&full_tools, &rev_scope);
    let rev_bytes = serde_json::to_string(&rev_filtered).unwrap().len();

    let rev_bytes_pruned_pct = (orig_bytes - rev_bytes) as f64 / orig_bytes as f64 * 100.0;
    assert!(
        rev_bytes_pruned_pct >= 60.0,
        "Reviewer bytes/tokens pruned {rev_bytes_pruned_pct}% must be >= 60%"
    );

    // 3. MCP tools/list response filtering
    let listing = serde_json::json!({
        "tools": full_tools
    });
    let filtered_listing = filter_tools_list_response(&listing, &mgr_scope);
    let arr = filtered_listing["tools"].as_array().unwrap();
    assert_eq!(arr.len(), mgr_filtered.len());
}

#[test]
fn test_policy_lookup_overhead_sub_millisecond() {
    let scope = RoleToolScope::for_role(ROLE_SENIOR, None);
    let tools = vec!["read_file", "write_file", "patch", "terminal", "kanban_complete", "unknown_tool"];

    let iterations = 10_000;
    let start = Instant::now();
    for _ in 0..iterations {
        for t in &tools {
            let _ = scope.is_tool_allowed(t);
        }
    }
    let elapsed = start.elapsed();
    let per_check = elapsed.as_secs_f64() / (iterations * tools.len()) as f64 * 1000.0;

    // Must be well under 1.0 ms (typically < 0.001 ms)
    assert!(
        per_check < 1.0,
        "Policy check latency must be < 1 ms, got {per_check:.6} ms"
    );
}

#[test]
fn test_get_all_role_scopes_metadata() {
    let scopes = get_all_role_scopes();
    assert_eq!(scopes.len(), 6);
    let roles: Vec<&str> = scopes.iter().map(|s| s.role.as_str()).collect();
    assert_eq!(
        roles,
        vec!["manager", "senior", "senior2", "techlead", "reviewer", "custom"]
    );
    for s in scopes {
        assert!(!s.label.is_empty());
        assert!(!s.description.is_empty());
        assert!(!s.whitelist.is_empty());
    }
}

#[test]
fn test_rpc_layer_enforcement_with_fake_agent() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().to_path_buf();
    let manager = Arc::new(SlotManager::with_defaults(Some(root.clone())));

    // 1. Manager slot: attempts terminal command and write_file
    let mgr_slot = make_fake_role_slot("slot-mgr", "Manager Slot", "manager");
    manager.add_slot(mgr_slot).unwrap();

    // Manager prompts dangerous command -> bash tool -> should be denied by role policy!
    let resp = manager
        .prompt_slot("slot-mgr", "perm:rm -rf /")
        .unwrap();
    let meta = resp.meta.unwrap();
    let perm_err = meta.get("permError").unwrap();
    let err_code = perm_err.get("code").and_then(|c| c.as_i64()).unwrap();
    let err_msg = perm_err.get("message").and_then(|m| m.as_str()).unwrap();
    assert_eq!(err_code, -32003);
    assert_eq!(
        err_msg,
        "ToolExecutionDenied: Role manager does not have permission to execute terminal"
    );

    // Manager attempts fs/write_text_file -> should be denied by role policy!
    let resp_write = manager
        .prompt_slot("slot-mgr", "write:test.txt:content")
        .unwrap();
    let meta_write = resp_write.meta.unwrap();
    let write_err = meta_write.get("writeError").unwrap();
    let w_code = write_err.get("code").and_then(|c| c.as_i64()).unwrap();
    let w_msg = write_err.get("message").and_then(|m| m.as_str()).unwrap();
    assert_eq!(w_code, -32003);
    assert_eq!(
        w_msg,
        "ToolExecutionDenied: Role manager does not have permission to execute write_file"
    );

    // 2. Senior slot: attempts terminal command (cargo test) -> allowed!
    let snr_slot = make_fake_role_slot("slot-snr", "Senior Slot", "senior");
    manager.add_slot(snr_slot).unwrap();

    let resp_snr = manager
        .prompt_slot("slot-snr", "perm:cargo test")
        .unwrap();
    let meta_snr = resp_snr.meta.unwrap();
    let perm_res = meta_snr
        .get("permResult")
        .and_then(|r| r.get("outcome"))
        .and_then(|o| o.get("outcome"))
        .and_then(|s| s.as_str());
    assert_eq!(perm_res, Some("approved"));
}
