pub mod acp;
pub mod hermes;
pub mod perm;
pub mod proposal;
pub mod slot;
pub mod team;
pub mod usage;

pub use acp::{
    AcpClient, AcpError, AcpInitializeResult, AcpSessionNewResult, ModelOption, PromptResponse,
    RequestCallback, UpdateCallback,
};
pub use hermes::{
    check_hermes_acp, check_hermes_version, detect_hermes, fallback_read_profiles,
    parse_kanban_json, parse_kanban_text, parse_profile_list_table, resolve_hermes,
    HermesDetectionResult, HermesProfileInfo, KanbanBadge,
};
pub use perm::{
    default_allowlist, PendingPermissionRequest, PermissionDecision, PermissionManager,
    PermissionMode,
};
pub use proposal::{apply_hunk_to_text, compute_hunks, Proposal, ProposalBuffer, ProposalStatus};
pub use slot::{
    ChatMessage, RingBuffer, Slot, SlotCapabilities, SlotConfig, SlotEvent, SlotManager,
    SlotStatus, SlotSummary, DEFAULT_IDLE_TIMEOUT, DEFAULT_MAX_ACTIVE_SLOTS,
};
pub use team::{global_team_path, load_team, project_team_path, save_team, TeamConfig};
pub use usage::{parse_usage, UsageReport};
