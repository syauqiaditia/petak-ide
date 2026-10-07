pub mod acp;
pub mod context;
pub mod hermes;
pub mod mcp;
pub mod memory;
pub mod perm;
pub mod policy;
pub mod proposal;
pub mod quota;
pub mod skills;
pub mod slot;
pub mod team;
pub mod usage;
pub mod worktree;

pub use acp::{
    AcpClient, AcpError, AcpInitializeResult, AcpSessionNewResult, ModelOption, PromptResponse,
    RequestCallback, UpdateCallback,
};
pub use context::{prune_file_context, DiagnosticSnippet, PrunedContextResult, SymbolOutline};
pub use hermes::{
    check_hermes_acp, check_hermes_version, detect_hermes, fallback_read_profiles,
    parse_kanban_json, parse_kanban_text, parse_profile_list_table, resolve_hermes,
    HermesDetectionResult, HermesProfileInfo, KanbanBadge,
};
pub use mcp::{
    active_acp_servers, load_mcp_config, resolve_mcp_path, save_mcp_config, test_mcp_server,
    McpConfig, McpServerConfig, McpTestResult,
};
pub use memory::{
    detect_domain_from_path, extract_title, get_domain_relevant_memory, list_project_memory,
    read_project_memory, resolve_memory_dir, save_project_memory, validate_memory_filename,
    MemoryItem, MemorySnippet,
};
pub use perm::{
    default_allowlist, PendingPermissionRequest, PermissionDecision, PermissionManager,
    PermissionMode,
};
pub use policy::{
    default_role_blacklist, default_role_whitelist, extract_tool_name, filter_advertised_tools,
    filter_tool_schemas, filter_tools_list_response, get_all_role_scopes, normalize_tool_name,
    tool_matches, AgentRole, RoleScopeInfo, RoleToolScope, ToolPolicy, ROLE_CUSTOM, ROLE_MANAGER,
    ROLE_REVIEWER, ROLE_SENIOR, ROLE_SENIOR2, ROLE_TECHLEAD,
};
pub use proposal::{apply_hunk_to_text, compute_hunks, Proposal, ProposalBuffer, ProposalStatus};
pub use quota::{
    check_proxy_online, default_quota_report, probe_llm_quota, probe_llm_quota_internal,
    LlmQuotaReport, ProviderQuotaInfo,
};
pub use skills::{
    delete_skill, is_core_skill, list_skills, read_skill, save_skill, scaffold_skills_dir,
    validate_skill_name, Skill, SkillMetadata, SkillSummary, CORE_SKILLS,
};
pub use slot::{
    get_allowed_models_for_engine, get_supported_engines, is_model_allowed_for_engine,
    load_openai_api_key, probe_antigravity, probe_claude_code, probe_custom, probe_hermes,
    probe_openai, resolve_slot_command, validate_engine_model, validate_engine_model_for_root,
    ChatMessage, RingBuffer, Slot, SlotCapabilities, SlotConfig, SlotEvent, SlotManager,
    SlotStatus, SlotSummary, SupportedEngineInfo, ANTIGRAVITY_MODELS, CLAUDE_CODE_MODELS,
    DEFAULT_IDLE_TIMEOUT, DEFAULT_MAX_ACTIVE_SLOTS, OPENAI_MODELS,
};
pub use team::{global_team_path, load_team, project_team_path, save_team, TeamConfig};
pub use usage::{parse_usage, UsageReport};
pub use worktree::{
    create_worktree, get_worktree_diff, list_worktrees, remove_worktree, sanitize_branch_name,
    sanitize_task_id, WorktreeInfo, WorktreeManager,
};
