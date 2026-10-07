use super::acp::{AcpClient, AcpError, ModelOption, PromptResponse};
use super::perm::{PermissionManager, PermissionMode};
use super::proposal::ProposalBuffer;
use super::team::TeamConfig;
use super::usage::{parse_usage, UsageReport};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, RwLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

pub const DEFAULT_MAX_ACTIVE_SLOTS: usize = 3;
pub const DEFAULT_IDLE_TIMEOUT: Duration = Duration::from_secs(600); // 10 minutes

fn default_permission() -> String {
    "ask".to_string()
}

fn default_cwd() -> String {
    "project".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SlotConfig {
    pub id: String,
    pub label: String,
    #[serde(default)]
    pub kind: String, // "claude-code" | "hermes" | "antigravity" | "openai" (or "codex") | "acp-custom"
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub engine: Option<String>,
    #[serde(default)]
    pub command: Option<String>,
    #[serde(rename = "hermesProfile", default)]
    pub hermes_profile: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(rename = "fallbackModel", default)]
    pub fallback_model: Option<String>,
    #[serde(default = "default_permission")]
    pub permission: String, // "read" | "ask" | "auto" | "full"
    #[serde(default = "default_cwd")]
    pub cwd: String, // "project"
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub role: Option<String>,
    #[serde(
        rename = "customWhitelist",
        alias = "custom_whitelist",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub custom_whitelist: Option<Vec<String>>,
}

impl SlotConfig {
    pub fn effective_engine(&self) -> &str {
        if let Some(ref e) = self.engine {
            if !e.is_empty() {
                return e.as_str();
            }
        }
        if !self.kind.is_empty() {
            return self.kind.as_str();
        }
        "hermes"
    }

    pub fn engine(&self) -> &str {
        self.effective_engine()
    }

    pub fn effective_role(&self) -> Option<&str> {
        self.role.as_deref()
    }

    pub fn role_scope(&self) -> Option<super::policy::RoleToolScope> {
        if let Some(ref r) = self.role {
            Some(super::policy::RoleToolScope::for_role(r, self.custom_whitelist.clone()))
        } else if self.custom_whitelist.is_some() {
            Some(super::policy::RoleToolScope::for_role("custom", self.custom_whitelist.clone()))
        } else {
            None
        }
    }

    pub fn normalize(&mut self) {
        if self.engine.is_none() && !self.kind.is_empty() {
            self.engine = Some(self.kind.clone());
        }
        if self.kind.is_empty() {
            self.kind = self.effective_engine().to_string();
        }
        if let Some(ref r) = self.role {
            if r.trim().is_empty() {
                self.role = None;
            } else {
                self.role = Some(r.trim().to_lowercase());
            }
        }
        if let Some(ref mut list) = self.custom_whitelist {
            list.retain(|s| !s.trim().is_empty());
            for item in list.iter_mut() {
                *item = item.trim().to_string();
            }
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SlotStatus {
    Idle,
    Starting,
    Ready,
    Busy,
    Stopped,
    Crashed,
    Failed { reason: String },
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SlotCapabilities {
    pub load_session: bool,
    pub supports_set_model: bool,
    pub current_model: Option<String>,
    pub available_models: Vec<ModelOption>,
    pub supports_usage: bool,
    pub last_usage: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub id: String,
    pub timestamp: u64,
    pub role: String, // "user" | "agent" | "system"
    pub content: String,
    pub stop_reason: Option<String>,
    pub metadata: Option<Value>,
}

#[derive(Debug, Clone)]
pub struct RingBuffer<T> {
    capacity: usize,
    items: VecDeque<T>,
}

impl<T> RingBuffer<T> {
    pub fn new(capacity: usize) -> Self {
        Self {
            capacity: capacity.max(1),
            items: VecDeque::with_capacity(capacity),
        }
    }

    pub fn push(&mut self, item: T) {
        if self.items.len() >= self.capacity {
            self.items.pop_front();
        }
        self.items.push_back(item);
    }

    pub fn to_vec(&self) -> Vec<T>
    where
        T: Clone,
    {
        self.items.iter().cloned().collect()
    }

    pub fn len(&self) -> usize {
        self.items.len()
    }

    pub fn is_empty(&self) -> bool {
        self.items.is_empty()
    }

    pub fn last_mut(&mut self) -> Option<&mut T> {
        self.items.back_mut()
    }
}

pub struct Slot {
    pub config: SlotConfig,
    pub status: SlotStatus,
    pub client: Option<Arc<AcpClient>>,
    pub session_id: Option<String>,
    pub capabilities: SlotCapabilities,
    pub history: RingBuffer<ChatMessage>,
    pub last_activity: Instant,
}

impl Slot {
    pub fn new(config: SlotConfig) -> Self {
        Self {
            config,
            status: SlotStatus::Idle,
            client: None,
            session_id: None,
            capabilities: SlotCapabilities::default(),
            history: RingBuffer::new(100),
            last_activity: Instant::now(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SlotSummary {
    pub id: String,
    pub label: String,
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub engine: Option<String>,
    pub status: SlotStatus,
    pub session_id: Option<String>,
    pub active_pid: Option<u32>,
    pub capabilities: SlotCapabilities,
    pub history_len: usize,
    pub last_activity_secs_ago: Option<u64>,
    pub config: SlotConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum SlotEvent {
    StatusChanged {
        slot_id: String,
        status: SlotStatus,
    },
    Update {
        slot_id: String,
        session_id: String,
        update: Value,
    },
    Reaped {
        slot_id: String,
    },
    PermissionRequested {
        slot_id: String,
        request_id: String,
        tool_call: Value,
    },
    ProposalCreated {
        slot_id: String,
        proposal_id: String,
        path: String,
    },
}

pub type SlotEventCallback = Arc<dyn Fn(SlotEvent) + Send + Sync + 'static>;

pub struct SlotManager {
    slots: RwLock<HashMap<String, Slot>>,
    order: RwLock<Vec<String>>,
    project_root: Mutex<Option<PathBuf>>,
    max_active_slots: usize,
    idle_timeout: Duration,
    listeners: Mutex<Vec<SlotEventCallback>>,
    perm_manager: Arc<PermissionManager>,
    proposal_buffer: Arc<ProposalBuffer>,
}

impl SlotManager {
    pub fn new(
        project_root: Option<PathBuf>,
        max_active_slots: usize,
        idle_timeout: Duration,
    ) -> Self {
        let perm_manager = Arc::new(PermissionManager::default());
        let proposal_buffer = Arc::new(ProposalBuffer::new(project_root.clone()));

        Self {
            slots: RwLock::new(HashMap::new()),
            order: RwLock::new(Vec::new()),
            project_root: Mutex::new(project_root),
            max_active_slots: if max_active_slots == 0 {
                DEFAULT_MAX_ACTIVE_SLOTS
            } else {
                max_active_slots
            },
            idle_timeout,
            listeners: Mutex::new(Vec::new()),
            perm_manager,
            proposal_buffer,
        }
    }

    pub fn with_defaults(project_root: Option<PathBuf>) -> Self {
        Self::new(project_root, DEFAULT_MAX_ACTIVE_SLOTS, DEFAULT_IDLE_TIMEOUT)
    }

    pub fn ensure_default_slots(&self) {
        let is_empty = {
            let slots = self.slots.read().unwrap();
            slots.is_empty()
        };

        if is_empty {
            let (team, _) = self.load_team();
            if !team.slots.is_empty() {
                let _ = self.apply_team(&team);
            } else {
                let default_configs = vec![
                    SlotConfig {
                        id: "default".to_string(),
                        label: "Petak Agent".to_string(),
                        kind: "hermes".to_string(),
                        engine: Some("hermes".to_string()),
                        command: None,
                        hermes_profile: Some("default".to_string()),
                        model: Some("ag/gemini-3.8-flash-high".to_string()),
                        fallback_model: Some("gemini-2.5-pro".to_string()),
                        permission: "ask".to_string(),
                        cwd: ".".to_string(),
                        role: Some("custom".to_string()),
                        custom_whitelist: None,
                    },
                    SlotConfig {
                        id: "manager".to_string(),
                        label: "Manager".to_string(),
                        kind: "hermes".to_string(),
                        engine: Some("hermes".to_string()),
                        command: None,
                        hermes_profile: Some("manager".to_string()),
                        model: Some("ag/gemini-3.8-flash-high".to_string()),
                        fallback_model: Some("gemini-2.5-pro".to_string()),
                        permission: "ask".to_string(),
                        cwd: ".".to_string(),
                        role: Some("manager".to_string()),
                        custom_whitelist: None,
                    },
                    SlotConfig {
                        id: "techlead".to_string(),
                        label: "Techlead".to_string(),
                        kind: "hermes".to_string(),
                        engine: Some("hermes".to_string()),
                        command: None,
                        hermes_profile: Some("techlead".to_string()),
                        model: Some("ag/gemini-3.8-flash-high".to_string()),
                        fallback_model: Some("gemini-2.5-pro".to_string()),
                        permission: "ask".to_string(),
                        cwd: ".".to_string(),
                        role: Some("techlead".to_string()),
                        custom_whitelist: None,
                    },
                    SlotConfig {
                        id: "senior".to_string(),
                        label: "Senior".to_string(),
                        kind: "hermes".to_string(),
                        engine: Some("hermes".to_string()),
                        command: None,
                        hermes_profile: Some("senior".to_string()),
                        model: Some("ag/gemini-3.8-flash-high".to_string()),
                        fallback_model: Some("gemini-2.5-pro".to_string()),
                        permission: "ask".to_string(),
                        cwd: ".".to_string(),
                        role: Some("senior".to_string()),
                        custom_whitelist: None,
                    },
                    SlotConfig {
                        id: "senior2".to_string(),
                        label: "Senior2".to_string(),
                        kind: "hermes".to_string(),
                        engine: Some("hermes".to_string()),
                        command: None,
                        hermes_profile: Some("senior2".to_string()),
                        model: Some("ag/gemini-3.8-flash-high".to_string()),
                        fallback_model: None,
                        permission: "ask".to_string(),
                        cwd: ".".to_string(),
                        role: Some("senior2".to_string()),
                        custom_whitelist: None,
                    },
                    SlotConfig {
                        id: "reviewer".to_string(),
                        label: "Reviewer".to_string(),
                        kind: "hermes".to_string(),
                        engine: Some("hermes".to_string()),
                        command: None,
                        hermes_profile: Some("reviewer".to_string()),
                        model: Some("ag/gemini-3.8-flash-high".to_string()),
                        fallback_model: None,
                        permission: "ask".to_string(),
                        cwd: ".".to_string(),
                        role: Some("reviewer".to_string()),
                        custom_whitelist: None,
                    },
                    SlotConfig {
                        id: "designer".to_string(),
                        label: "Designer".to_string(),
                        kind: "hermes".to_string(),
                        engine: Some("hermes".to_string()),
                        command: None,
                        hermes_profile: Some("designer".to_string()),
                        model: Some("ag/gemini-3.8-flash-high".to_string()),
                        fallback_model: None,
                        permission: "ask".to_string(),
                        cwd: ".".to_string(),
                        role: Some("custom".to_string()),
                        custom_whitelist: None,
                    },
                ];

                for cfg in default_configs {
                    let _ = self.add_slot(cfg);
                }
            }
        }
    }

    pub fn set_project_root(&self, root: Option<PathBuf>) {
        {
            let mut pr = self.project_root.lock().unwrap();
            *pr = root.clone();
        }
        self.proposal_buffer.set_project_root(root);
        self.ensure_default_slots();
    }

    pub fn project_root(&self) -> Option<PathBuf> {
        self.project_root.lock().unwrap().clone()
    }

    pub fn add_listener<F>(&self, callback: F)
    where
        F: Fn(SlotEvent) + Send + Sync + 'static,
    {
        let mut listeners = self.listeners.lock().unwrap();
        listeners.push(Arc::new(callback));
    }

    fn emit(&self, event: SlotEvent) {
        let listeners = {
            let guard = self.listeners.lock().unwrap();
            guard.clone()
        };
        for listener in listeners {
            listener(event.clone());
        }
    }

    pub fn add_slot(&self, mut config: SlotConfig) -> Result<SlotSummary, String> {
        config.normalize();
        let mut slots = self.slots.write().unwrap();
        let mut order = self.order.write().unwrap();

        let id = config.id.clone();
        if !order.contains(&id) {
            order.push(id.clone());
        }

        let slot = Slot::new(config);
        let summary = slot_to_summary(&slot);
        slots.insert(id, slot);
        Ok(summary)
    }

    pub fn remove_slot(&self, slot_id: &str) -> Result<(), String> {
        let mut slots = self.slots.write().unwrap();
        let mut order = self.order.write().unwrap();

        if let Some(mut slot) = slots.remove(slot_id) {
            if let Some(client) = slot.client.take() {
                let _ = client.kill();
            }
            order.retain(|id| id != slot_id);
            Ok(())
        } else {
            Err(format!("Slot '{}' not found", slot_id))
        }
    }

    pub fn update_slot(&self, mut config: SlotConfig) -> Result<SlotSummary, String> {
        config.normalize();
        let mut slots = self.slots.write().unwrap();
        let slot = slots
            .get_mut(&config.id)
            .ok_or_else(|| format!("Slot '{}' tidak ditemukan", config.id))?;

        let old_config = slot.config.clone();
        slot.config = config.clone();

        // If runtime command or profile changed and client is active, stop it
        if (old_config.effective_engine() != config.effective_engine()
            || old_config.command != config.command
            || old_config.hermes_profile != config.hermes_profile)
            && slot.client.is_some()
        {
            if let Some(client) = slot.client.take() {
                let _ = client.kill();
            }
            slot.session_id = None;
            slot.status = SlotStatus::Idle;
            self.emit(SlotEvent::StatusChanged {
                slot_id: config.id.clone(),
                status: SlotStatus::Idle,
            });
        }

        Ok(slot_to_summary(slot))
    }

    pub fn apply_team(&self, team: &TeamConfig) -> Result<(), String> {
        let new_ids: Vec<String> = team.slots.iter().map(|s| s.id.clone()).collect();

        // 1. Remove slots no longer in team
        let current_ids: Vec<String> = {
            let order = self.order.read().unwrap();
            order.clone()
        };
        for id in current_ids {
            if !new_ids.contains(&id) {
                let _ = self.remove_slot(&id);
            }
        }

        // 2. Add or update slots
        for slot_cfg in &team.slots {
            let exists = {
                let slots = self.slots.read().unwrap();
                slots.contains_key(&slot_cfg.id)
            };
            if exists {
                self.update_slot(slot_cfg.clone())?;
            } else {
                self.add_slot(slot_cfg.clone())?;
            }
        }

        // 3. Update order
        let mut order = self.order.write().unwrap();
        *order = new_ids;

        Ok(())
    }

    pub fn load_team(&self) -> (TeamConfig, PathBuf) {
        let root = self.project_root();
        crate::agent::team::load_team(root.as_deref())
    }

    pub fn save_team(&self, team: &TeamConfig) -> Result<PathBuf, String> {
        let root = self.project_root();
        crate::agent::team::save_team(root.as_deref(), team)
    }

    pub fn permission_manager(&self) -> Arc<PermissionManager> {
        Arc::clone(&self.perm_manager)
    }

    pub fn proposal_buffer(&self) -> Arc<ProposalBuffer> {
        Arc::clone(&self.proposal_buffer)
    }

    pub fn get_slot_usage(&self, slot_id: &str) -> Result<UsageReport, String> {
        let slots = self.slots.read().unwrap();
        let slot = slots
            .get(slot_id)
            .ok_or_else(|| format!("Slot '{slot_id}' tidak ditemukan"))?;

        Ok(parse_usage(slot.capabilities.last_usage.as_ref(), None))
    }

    pub fn list_slots(&self) -> Vec<SlotSummary> {
        let slots = self.slots.read().unwrap();
        let order = self.order.read().unwrap();

        let mut res = Vec::new();
        for id in order.iter() {
            if let Some(slot) = slots.get(id) {
                res.push(slot_to_summary(slot));
            }
        }
        res
    }

    pub fn get_slot_history(&self, slot_id: &str) -> Result<Vec<ChatMessage>, String> {
        let slots = self.slots.read().unwrap();
        let slot = slots
            .get(slot_id)
            .ok_or_else(|| format!("Slot '{slot_id}' not found"))?;
        Ok(slot.history.to_vec())
    }

    fn enforce_slot_limit(&self, except_slot_id: &str) -> Result<(), String> {
        let mut slots = self.slots.write().unwrap();
        let active_count = slots.values().filter(|s| s.client.is_some()).count();

        if active_count >= self.max_active_slots {
            // Find oldest Ready (non-Busy) slot to reap
            let mut candidates: Vec<(String, Instant)> = slots
                .iter()
                .filter(|(id, s)| {
                    s.client.is_some()
                        && s.status == SlotStatus::Ready
                        && id.as_str() != except_slot_id
                })
                .map(|(id, s)| (id.clone(), s.last_activity))
                .collect();

            candidates.sort_by_key(|(_, t)| *t);

            if let Some((oldest_id, _)) = candidates.first() {
                if let Some(slot) = slots.get_mut(oldest_id) {
                    if let Some(client) = slot.client.take() {
                        let _ = client.kill();
                    }
                    slot.status = SlotStatus::Stopped;
                    self.emit(SlotEvent::StatusChanged {
                        slot_id: oldest_id.clone(),
                        status: SlotStatus::Stopped,
                    });
                    self.emit(SlotEvent::Reaped {
                        slot_id: oldest_id.clone(),
                    });
                    return Ok(());
                }
            }

            return Err(format!(
                "Batas slot aktif ({}) tercapai dan semua slot aktif sedang bekerja",
                self.max_active_slots
            ));
        }

        Ok(())
    }

    pub fn start_slot(&self, slot_id: &str) -> Result<SlotSummary, String> {
        // Auto-register slot if it doesn't exist yet
        {
            let slots = self.slots.read().unwrap();
            if !slots.contains_key(slot_id) {
                drop(slots);
                let label = if slot_id == "default" {
                    "Petak Agent".to_string()
                } else {
                    let mut chars = slot_id.chars();
                    match chars.next() {
                        None => String::new(),
                        Some(f) => f.to_uppercase().collect::<String>() + chars.as_str(),
                    }
                };
                let cfg = SlotConfig {
                    id: slot_id.to_string(),
                    label,
                    kind: "hermes".to_string(),
                    engine: Some("hermes".to_string()),
                    command: None,
                    hermes_profile: Some(slot_id.to_string()),
                    model: Some("ag/gemini-3.8-flash-high".to_string()),
                    fallback_model: Some("gemini-2.5-pro".to_string()),
                    permission: "ask".to_string(),
                    cwd: ".".to_string(),
                    role: Some(slot_id.to_string()),
                    custom_whitelist: None,
                };
                let _ = self.add_slot(cfg);
            }
        }

        {
            let slots = self.slots.read().unwrap();
            let slot = slots
                .get(slot_id)
                .ok_or_else(|| format!("Slot '{slot_id}' not found"))?;
            if slot.status == SlotStatus::Ready && slot.client.is_some() {
                return Ok(slot_to_summary(slot));
            }
        }

        self.enforce_slot_limit(slot_id)?;

        let (config, cwd_path) = {
            let mut slots = self.slots.write().unwrap();
            let slot = slots
                .get_mut(slot_id)
                .ok_or_else(|| format!("Slot '{slot_id}' not found"))?;
            slot.status = SlotStatus::Starting;
            self.emit(SlotEvent::StatusChanged {
                slot_id: slot_id.to_string(),
                status: SlotStatus::Starting,
            });

            let proj_root = self.project_root.lock().unwrap().clone();
            (slot.config.clone(), proj_root)
        };

        let result = self.spawn_and_handshake(&config, cwd_path.as_deref());

        let mut slots = self.slots.write().unwrap();
        let slot = match slots.get_mut(slot_id) {
            Some(s) => s,
            None => return Err(format!("Slot '{slot_id}' was removed during start")),
        };

        match result {
            Ok((client, session_id, caps)) => {
                slot.client = Some(Arc::new(client));
                slot.session_id = Some(session_id);
                slot.capabilities = caps;
                slot.status = SlotStatus::Ready;
                slot.last_activity = Instant::now();

                self.emit(SlotEvent::StatusChanged {
                    slot_id: slot_id.to_string(),
                    status: SlotStatus::Ready,
                });

                Ok(slot_to_summary(slot))
            }
            Err(e) => {
                slot.status = SlotStatus::Failed {
                    reason: e.to_string(),
                };
                self.emit(SlotEvent::StatusChanged {
                    slot_id: slot_id.to_string(),
                    status: slot.status.clone(),
                });
                Err(format!("Gagal memulai slot '{slot_id}': {e}"))
            }
        }
    }

    fn spawn_and_handshake(
        &self,
        config: &SlotConfig,
        project_root: Option<&Path>,
    ) -> Result<(AcpClient, String, SlotCapabilities), AcpError> {
        let (cmd_str, args, env) = resolve_slot_command(config);

        let cwd_str = project_root
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|| ".".to_string());

        let slot_id = config.id.clone();
        let listeners = {
            let guard = self.listeners.lock().unwrap();
            guard.clone()
        };

        let perm_mgr = Arc::clone(&self.perm_manager);
        let prop_buf = Arc::clone(&self.proposal_buffer);
        let proj_root_buf = project_root.map(|p| p.to_path_buf());
        let slot_permission_str = config.permission.clone();
        let slot_id_for_req = slot_id.clone();
        let listeners_for_req = listeners.clone();
        let slot_role_scope = config.role_scope();

        let client = AcpClient::spawn_with_handler(
            &cmd_str,
            &args,
            &env,
            project_root,
            move |update_val| {
                let session_id = update_val
                    .get("sessionId")
                    .and_then(|s| s.as_str())
                    .unwrap_or("")
                    .to_string();
                let actual_update = update_val
                    .get("update")
                    .cloned()
                    .unwrap_or(update_val.clone());

                for listener in &listeners {
                    listener(SlotEvent::Update {
                        slot_id: slot_id.clone(),
                        session_id: session_id.clone(),
                        update: actual_update.clone(),
                    });
                }
            },
            Some(
                move |method: &str, params: Value| -> Option<Result<Value, (i64, String)>> {
                    match method {
                        "session/request_permission" => {
                            let mode = PermissionMode::from_str_opt(&slot_permission_str);
                            let tool_call = params
                                .get("toolCall")
                                .cloned()
                                .unwrap_or_else(|| params.clone());
                            let sess_id = params
                                .get("sessionId")
                                .and_then(|s| s.as_str())
                                .unwrap_or("")
                                .to_string();

                            match perm_mgr.request_permission_with_role(
                                &slot_id_for_req,
                                &sess_id,
                                mode,
                                &tool_call,
                                slot_role_scope.as_ref(),
                                Duration::from_secs(120),
                            ) {
                                Ok(true) => Some(Ok(serde_json::json!({
                                    "outcome": { "outcome": "approved" }
                                }))),
                                Ok(false) => Some(Ok(serde_json::json!({
                                    "outcome": { "outcome": "denied" }
                                }))),
                                Err(e) => Some(Err((-32003, e))),
                            }
                        }
                        "fs/read_text_file" => {
                            if let Some(ref scope) = slot_role_scope {
                                if let Err(e) = scope.check_permission("read_file") {
                                    return Some(Err((-32003, e)));
                                }
                            }
                            let path = match params.get("path").and_then(|p| p.as_str()) {
                                Some(p) => p,
                                None => {
                                    return Some(Err((
                                        -32602,
                                        "Missing 'path' parameter".to_string(),
                                    )))
                                }
                            };
                            let resolved = if let Some(ref root) = proj_root_buf {
                                match crate::fsops::resolve_in_root(root, path) {
                                    Ok(r) => r,
                                    Err(e) => {
                                        return Some(Err((
                                            -32000,
                                            format!("Path traversal error: {e}"),
                                        )))
                                    }
                                }
                            } else {
                                PathBuf::from(path)
                            };
                            match crate::fs::read_file(&resolved) {
                                Ok(content) => Some(Ok(serde_json::json!({ "content": content }))),
                                Err(e) => Some(Err((-32000, format!("Gagal membaca file: {e}")))),
                            }
                        }
                        "fs/write_text_file" => {
                            if let Some(ref scope) = slot_role_scope {
                                if let Err(e) = scope.check_permission("write_file") {
                                    return Some(Err((-32003, e)));
                                }
                            }
                            let mode = PermissionMode::from_str_opt(&slot_permission_str);
                            if mode == PermissionMode::Read {
                                return Some(Err((
                                    -32000,
                                    "Mode read-only: penulisan file ditolak".to_string(),
                                )));
                            }
                            let path = match params.get("path").and_then(|p| p.as_str()) {
                                Some(p) => p,
                                None => {
                                    return Some(Err((
                                        -32602,
                                        "Missing 'path' parameter".to_string(),
                                    )))
                                }
                            };
                            let content = match params.get("content").and_then(|c| c.as_str()) {
                                Some(c) => c,
                                None => {
                                    return Some(Err((
                                        -32602,
                                        "Missing 'content' parameter".to_string(),
                                    )))
                                }
                            };
                            let sess_id = params
                                .get("sessionId")
                                .and_then(|s| s.as_str())
                                .unwrap_or("")
                                .to_string();

                            let (prop, rx) =
                                prop_buf.create_proposal(&slot_id_for_req, &sess_id, path, content);

                            for listener in &listeners_for_req {
                                listener(SlotEvent::ProposalCreated {
                                    slot_id: slot_id_for_req.clone(),
                                    proposal_id: prop.id.clone(),
                                    path: path.to_string(),
                                });
                            }

                            match rx.recv_timeout(Duration::from_secs(180)) {
                                Ok(Ok(())) => Some(Ok(serde_json::json!({}))),
                                Ok(Err(e)) => Some(Err((-32000, e))),
                                Err(_) => Some(Err((
                                    -32000,
                                    "Proposal dibatalkan atau waktu tunggu habis".to_string(),
                                ))),
                            }
                        }
                        "tools/call" => {
                            let tool_name = params
                                .get("name")
                                .or_else(|| params.get("tool"))
                                .and_then(|v| v.as_str())
                                .unwrap_or("");
                            if let Some(ref scope) = slot_role_scope {
                                if let Err(e) = scope.check_permission(tool_name) {
                                    return Some(Err((-32003, e)));
                                }
                            }
                            None
                        }
                        _ => None,
                    }
                },
            ),
        )?;

        // 1. Initialize handshake (timeout 15s)
        let init_res = client.initialize(Duration::from_secs(15))?;

        // 2. Session/new handshake (timeout 15s)
        let mcp_servers = super::mcp::load_mcp_config(project_root)
            .map(|cfg| super::mcp::active_acp_servers(&cfg))
            .unwrap_or_default();
        let sess_res = client.session_new(&cwd_str, &mcp_servers, Duration::from_secs(15))?;

        // Extract capabilities
        let mut caps = SlotCapabilities {
            load_session: init_res.agent_capabilities.load_session,
            supports_set_model: false,
            current_model: None,
            available_models: Vec::new(),
            supports_usage: false,
            last_usage: None,
        };

        if let Some(models) = sess_res.models {
            caps.supports_set_model = true;
            caps.current_model = models.current_model_id;
            caps.available_models = models.available_models;
        }

        Ok((client, sess_res.session_id, caps))
    }

    pub fn prompt_slot_with_watchdog(
        &self,
        slot_id: &str,
        text: &str,
        idle_timeout: Duration,
    ) -> Result<PromptResponse, String> {
        // Lazy spawn: ensure slot is started and ready
        self.start_slot(slot_id)?;

        let (client, session_id) = {
            let mut slots = self.slots.write().unwrap();
            let slot = slots
                .get_mut(slot_id)
                .ok_or_else(|| format!("Slot '{slot_id}' not found"))?;

            if slot.status == SlotStatus::Busy {
                return Err(format!(
                    "Slot '{slot_id}' sedang sibuk memproses prompt lain"
                ));
            }

            slot.status = SlotStatus::Busy;
            slot.last_activity = Instant::now();

            let now = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0);

            slot.history.push(ChatMessage {
                id: format!("usr_{}", now),
                timestamp: now,
                role: "user".to_string(),
                content: text.to_string(),
                stop_reason: None,
                metadata: None,
            });

            self.emit(SlotEvent::StatusChanged {
                slot_id: slot_id.to_string(),
                status: SlotStatus::Busy,
            });

            let client = slot
                .client
                .as_ref()
                .cloned()
                .ok_or_else(|| "Client process missing".to_string())?;
            let session_id = slot
                .session_id
                .clone()
                .ok_or_else(|| "Session ID missing".to_string())?;

            (client, session_id)
        };

        let prompt_result = client.session_prompt_with_watchdog(&session_id, text, idle_timeout);

        let mut slots = self.slots.write().unwrap();
        let slot = match slots.get_mut(slot_id) {
            Some(s) => s,
            None => return Err(format!("Slot '{slot_id}' removed during prompt execution")),
        };

        slot.last_activity = Instant::now();
        slot.status = SlotStatus::Ready;

        self.emit(SlotEvent::StatusChanged {
            slot_id: slot_id.to_string(),
            status: SlotStatus::Ready,
        });

        match prompt_result {
            Ok(resp) => {
                let now = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .map(|d| d.as_millis() as u64)
                    .unwrap_or(0);

                if let Some(ref u) = resp.usage {
                    slot.capabilities.supports_usage = true;
                    slot.capabilities.last_usage = Some(u.clone());
                }

                slot.history.push(ChatMessage {
                    id: format!("agt_{}", now),
                    timestamp: now,
                    role: "agent".to_string(),
                    content: String::new(),
                    stop_reason: Some(resp.stop_reason.clone()),
                    metadata: resp.meta.clone(),
                });

                Ok(resp)
            }
            Err(AcpError::Timeout) => {
                let recovery_msg = "⚠️ Perintah terminal macet dibatalkan otomatis karena tidak ada aktivitas selama 5 menit. Mencoba pemulihan...";
                let now = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .map(|d| d.as_millis() as u64)
                    .unwrap_or(0);

                slot.history.push(ChatMessage {
                    id: format!("agt_{}", now),
                    timestamp: now,
                    role: "agent".to_string(),
                    content: recovery_msg.to_string(),
                    stop_reason: Some("timeout".to_string()),
                    metadata: None,
                });

                slot.status = SlotStatus::Ready;
                self.emit(SlotEvent::StatusChanged {
                    slot_id: slot_id.to_string(),
                    status: SlotStatus::Ready,
                });

                self.emit(SlotEvent::Update {
                    slot_id: slot_id.to_string(),
                    session_id: session_id.clone(),
                    update: serde_json::json!({
                        "sessionUpdate": "agent_message_chunk",
                        "content": {
                            "type": "text",
                            "text": recovery_msg
                        }
                    }),
                });

                Err(recovery_msg.to_string())
            }
            Err(e) => {
                if !client.is_alive() {
                    slot.status = SlotStatus::Crashed;
                    self.emit(SlotEvent::StatusChanged {
                        slot_id: slot_id.to_string(),
                        status: SlotStatus::Crashed,
                    });
                }
                Err(format!("Prompt gagal: {e}"))
            }
        }
    }

    pub fn prompt_slot(&self, slot_id: &str, text: &str) -> Result<PromptResponse, String> {
        self.prompt_slot_with_watchdog(slot_id, text, Duration::from_secs(300))
    }

    pub fn cancel_slot(&self, slot_id: &str) -> Result<(), String> {
        let slots = self.slots.read().unwrap();
        let slot = slots
            .get(slot_id)
            .ok_or_else(|| format!("Slot '{slot_id}' not found"))?;

        if let (Some(client), Some(session_id)) = (&slot.client, &slot.session_id) {
            client
                .session_cancel(session_id)
                .map_err(|e| e.to_string())?;
            Ok(())
        } else {
            Err(format!("Slot '{slot_id}' tidak memiliki proses/sesi aktif"))
        }
    }

    pub fn stop_slot(&self, slot_id: &str) -> Result<(), String> {
        let mut slots = self.slots.write().unwrap();
        let slot = slots
            .get_mut(slot_id)
            .ok_or_else(|| format!("Slot '{slot_id}' not found"))?;

        if let Some(client) = slot.client.take() {
            let _ = client.kill();
        }
        slot.status = SlotStatus::Stopped;
        slot.session_id = None;

        self.emit(SlotEvent::StatusChanged {
            slot_id: slot_id.to_string(),
            status: SlotStatus::Stopped,
        });

        Ok(())
    }

    pub fn restart_slot(&self, slot_id: &str) -> Result<SlotSummary, String> {
        let _ = self.stop_slot(slot_id);
        self.start_slot(slot_id)
    }

    pub fn tick_idle_reap(&self) -> Vec<String> {
        let mut reaped = Vec::new();
        let mut to_kill = Vec::new();

        {
            let mut slots = self.slots.write().unwrap();
            for (id, slot) in slots.iter_mut() {
                if slot.status == SlotStatus::Ready
                    && slot.last_activity.elapsed() >= self.idle_timeout
                {
                    if let Some(client) = slot.client.take() {
                        to_kill.push(client);
                    }
                    slot.status = SlotStatus::Stopped;
                    reaped.push(id.clone());
                }
            }
        }

        for client in to_kill {
            let _ = client.kill();
        }

        for id in &reaped {
            self.emit(SlotEvent::StatusChanged {
                slot_id: id.clone(),
                status: SlotStatus::Stopped,
            });
            self.emit(SlotEvent::Reaped {
                slot_id: id.clone(),
            });
        }

        reaped
    }

    pub fn shutdown_all(&self) {
        let mut slots = self.slots.write().unwrap();
        for slot in slots.values_mut() {
            if let Some(client) = slot.client.take() {
                let _ = client.kill();
            }
            slot.status = SlotStatus::Stopped;
        }
    }
}

impl Drop for SlotManager {
    fn drop(&mut self) {
        self.shutdown_all();
    }
}

pub fn load_openai_api_key() -> Option<String> {
    if let Ok(key) = std::env::var("OPENAI_API_KEY") {
        let trimmed = key.trim();
        if !trimmed.is_empty() {
            return Some(trimmed.to_string());
        }
    }

    #[cfg(target_os = "macos")]
    {
        for svc in &["petak", "openai", "OpenAI"] {
            for acct in &["openai_api_key", "OPENAI_API_KEY", "petak_openai_key"] {
                if let Ok(out) = std::process::Command::new("security")
                    .args(["find-generic-password", "-a", acct, "-s", svc, "-w"])
                    .output()
                {
                    if out.status.success() {
                        let token = String::from_utf8_lossy(&out.stdout).trim().to_string();
                        if !token.is_empty() {
                            return Some(token);
                        }
                    }
                }
            }
        }
    }

    if let Some(config_dir) = dirs::config_dir() {
        let p = config_dir.join("petak").join(".openai_key");
        if p.is_file() {
            if let Ok(content) = std::fs::read_to_string(&p) {
                let trimmed = content.trim().to_string();
                if !trimmed.is_empty() {
                    return Some(trimmed);
                }
            }
        }
    }

    if let Some(home) = dirs::home_dir() {
        for name in &[".openai_api_key", ".openai_key"] {
            let p = home.join(name);
            if p.is_file() {
                if let Ok(content) = std::fs::read_to_string(&p) {
                    let trimmed = content.trim().to_string();
                    if !trimmed.is_empty() {
                        return Some(trimmed);
                    }
                }
            }
        }
    }

    None
}

pub fn resolve_slot_command(
    config: &SlotConfig,
) -> (String, Vec<String>, HashMap<String, String>) {
    let mut env = HashMap::new();
    let engine = config.effective_engine();

    // Populate engine-specific environment defaults
    match engine {
        "antigravity" => {
            env.insert(
                "OPENAI_BASE_URL".to_string(),
                "http://127.0.0.1:20128/v1".to_string(),
            );
            env.insert(
                "ANTHROPIC_BASE_URL".to_string(),
                "http://127.0.0.1:20128/v1".to_string(),
            );
            env.insert(
                "ROUTER_PROXY_URL".to_string(),
                "http://127.0.0.1:20128/v1".to_string(),
            );
        }
        "openai" | "codex" => {
            if let Some(key) = load_openai_api_key() {
                env.insert("OPENAI_API_KEY".to_string(), key);
            }
        }
        _ => {}
    }

    if let Some(ref custom_cmd) = config.command {
        let parts: Vec<String> = custom_cmd
            .split_whitespace()
            .map(ToString::to_string)
            .collect();
        if let Some((first, rest)) = parts.split_first() {
            return (first.clone(), rest.to_vec(), env);
        }
    }

    match engine {
        "hermes" => {
            let hermes_bin = super::hermes::resolve_hermes(None)
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_else(|| "hermes".to_string());
            let mut args = Vec::new();
            if let Some(ref prof) = config.hermes_profile {
                if prof != "default" {
                    args.push("-p".to_string());
                    args.push(prof.clone());
                }

                if let Some(home) = std::env::var_os("HOME") {
                    let home_p = PathBuf::from(home);
                    let profile_dir = home_p.join(".hermes").join("profiles").join(prof);
                    if profile_dir.exists() {
                        env.insert(
                            "HERMES_HOME".to_string(),
                            profile_dir.to_string_lossy().to_string(),
                        );
                    }
                }
            }
            args.push("acp".to_string());
            (hermes_bin, args, env)
        }
        "claude-code" => {
            let args = vec!["@agentclientprotocol/claude-agent-acp".to_string()];
            ("npx".to_string(), args, env)
        }
        "antigravity" => {
            let args = vec![
                "acp".to_string(),
                "--proxy".to_string(),
                "http://127.0.0.1:20128/v1".to_string(),
            ];
            ("antigravity".to_string(), args, env)
        }
        "openai" => {
            let args = vec!["acp".to_string()];
            ("openai".to_string(), args, env)
        }
        "codex" => {
            let args = vec!["acp".to_string()];
            ("codex".to_string(), args, env)
        }
        "acp-custom" => {
            ("hermes".to_string(), vec!["acp".to_string()], env)
        }
        _ => {
            ("hermes".to_string(), vec!["acp".to_string()], env)
        }
    }
}

fn slot_to_summary(slot: &Slot) -> SlotSummary {
    let active_pid = slot.client.as_ref().and_then(|c| c.pid());
    let last_activity_secs_ago = Some(slot.last_activity.elapsed().as_secs());

    SlotSummary {
        id: slot.config.id.clone(),
        label: slot.config.label.clone(),
        kind: slot.config.kind.clone(),
        engine: Some(slot.config.effective_engine().to_string()),
        status: slot.status.clone(),
        session_id: slot.session_id.clone(),
        active_pid,
        capabilities: slot.capabilities.clone(),
        history_len: slot.history.len(),
        last_activity_secs_ago,
        config: slot.config.clone(),
    }
}

// ── Multi-Engine Detection, Model Whitelist & Probes ─────────────────────────

pub const CLAUDE_CODE_MODELS: &[&str] = &[
    "claude-3-7-sonnet",
    "claude-3-5-sonnet",
    "claude-3-opus",
];

pub const ANTIGRAVITY_MODELS: &[&str] = &[
    "ag/gemini-3.8-flash-high",
    "ag/claude-opus-4.1",
    "ag/claude-opus-4-6-thinking",
];

pub const OPENAI_MODELS: &[&str] = &[
    "gpt-4o",
    "o3-mini",
    "o1",
];

fn find_bin_in_path(bin_name: &str, path_env: &str) -> bool {
    let exe_name = if cfg!(windows) {
        format!("{bin_name}.exe")
    } else {
        bin_name.to_string()
    };
    for dir in std::env::split_paths(path_env) {
        if dir.join(&exe_name).is_file() {
            return true;
        }
        if cfg!(windows) {
            if dir.join(format!("{bin_name}.cmd")).is_file()
                || dir.join(format!("{bin_name}.bat")).is_file()
            {
                return true;
            }
        }
    }
    false
}

pub fn probe_hermes(project_root: Option<&Path>) -> (bool, String) {
    let detection = super::hermes::detect_hermes(project_root);
    if detection.installed {
        let count = detection.profiles.len();
        (
            true,
            format!(
                "Hermes CLI installed ({} profile{} found)",
                count,
                if count == 1 { "" } else { "s" }
            ),
        )
    } else if !detection.profiles.is_empty() {
        let count = detection.profiles.len();
        (
            true,
            format!(
                "Hermes profiles found ({} profile{}), CLI not in PATH",
                count,
                if count == 1 { "" } else { "s" }
            ),
        )
    } else {
        (false, "Hermes CLI and profiles not found".to_string())
    }
}

pub fn probe_claude_code(project_root: Option<&Path>) -> (bool, String) {
    let path_env = if let Some(r) = project_root {
        crate::toolchain::effective_path_for_root(Some(r))
    } else {
        crate::toolchain::effective_path().to_string()
    };

    let claude_found = find_bin_in_path("claude", &path_env);
    let npx_found = find_bin_in_path("npx", &path_env);

    if claude_found && npx_found {
        (true, "claude CLI and npx found in PATH".to_string())
    } else if claude_found {
        (true, "claude CLI found in PATH".to_string())
    } else if npx_found {
        (true, "npx found in PATH".to_string())
    } else {
        (false, "Neither claude CLI nor npx found in PATH".to_string())
    }
}

pub fn probe_antigravity() -> (bool, String) {
    let online = super::quota::check_proxy_online(Some("http://127.0.0.1:20128"));
    if online {
        (
            true,
            "9Router proxy online at http://127.0.0.1:20128".to_string(),
        )
    } else {
        (
            false,
            "9Router proxy offline (http://127.0.0.1:20128 unreachable)".to_string(),
        )
    }
}

pub fn probe_openai() -> (bool, String) {
    if let Some(_key) = load_openai_api_key() {
        (
            true,
            "API key detected in environment or keychain".to_string(),
        )
    } else {
        (
            false,
            "OPENAI_API_KEY not found in environment or keychain".to_string(),
        )
    }
}

pub fn probe_custom() -> (bool, String) {
    (true, "Custom ACP command configured per slot".to_string())
}

pub fn get_allowed_models_for_engine(
    engine: &str,
    project_root: Option<&Path>,
) -> Vec<String> {
    let eng = engine.to_ascii_lowercase();
    match eng.as_str() {
        "claude-code" => CLAUDE_CODE_MODELS.iter().map(|s| s.to_string()).collect(),
        "antigravity" => ANTIGRAVITY_MODELS.iter().map(|s| s.to_string()).collect(),
        "openai" | "codex" => OPENAI_MODELS.iter().map(|s| s.to_string()).collect(),
        "hermes" => {
            let detection = super::hermes::detect_hermes(project_root);
            let mut models: Vec<String> = detection
                .profiles
                .into_iter()
                .filter_map(|p| p.model)
                .collect();
            models.sort();
            models.dedup();
            if models.is_empty() {
                models = vec![
                    "ag/gemini-3.8-flash-high".to_string(),
                    "ag/claude-opus-4-6-thinking".to_string(),
                ];
            }
            models
        }
        "acp-custom" | "custom" => vec![],
        _ => vec![],
    }
}

pub fn validate_engine_model(engine: &str, model: &str) -> bool {
    validate_engine_model_for_root(engine, model, None)
}

pub fn validate_engine_model_for_root(
    engine: &str,
    model: &str,
    project_root: Option<&Path>,
) -> bool {
    let eng = engine.to_ascii_lowercase();
    match eng.as_str() {
        "claude-code" => CLAUDE_CODE_MODELS.iter().any(|m| m.eq_ignore_ascii_case(model)),
        "antigravity" => ANTIGRAVITY_MODELS.iter().any(|m| m.eq_ignore_ascii_case(model)),
        "openai" | "codex" => OPENAI_MODELS.iter().any(|m| m.eq_ignore_ascii_case(model)),
        "hermes" => {
            let allowed = get_allowed_models_for_engine("hermes", project_root);
            allowed.iter().any(|m| m.eq_ignore_ascii_case(model))
        }
        "acp-custom" | "custom" => true,
        _ => false,
    }
}

pub fn is_model_allowed_for_engine(
    engine: &str,
    model: &str,
    project_root: Option<&Path>,
) -> bool {
    validate_engine_model_for_root(engine, model, project_root)
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SupportedEngineInfo {
    pub id: String,
    pub name: String,
    pub detected: bool,
    pub status: String,
    #[serde(alias = "allowedModels")]
    pub allowed_models: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none", alias = "defaultModel")]
    pub default_model: Option<String>,
}

pub fn get_supported_engines(project_root: Option<&Path>) -> Vec<SupportedEngineInfo> {
    let (hermes_detected, hermes_status) = probe_hermes(project_root);
    let (claude_detected, claude_status) = probe_claude_code(project_root);
    let (antigravity_detected, antigravity_status) = probe_antigravity();
    let (openai_detected, openai_status) = probe_openai();
    let (custom_detected, custom_status) = probe_custom();

    vec![
        SupportedEngineInfo {
            id: "hermes".to_string(),
            name: "Hermes Agent".to_string(),
            detected: hermes_detected,
            status: hermes_status,
            allowed_models: get_allowed_models_for_engine("hermes", project_root),
            default_model: Some("ag/gemini-3.8-flash-high".to_string()),
        },
        SupportedEngineInfo {
            id: "claude-code".to_string(),
            name: "Claude Code".to_string(),
            detected: claude_detected,
            status: claude_status,
            allowed_models: get_allowed_models_for_engine("claude-code", project_root),
            default_model: Some("claude-3-7-sonnet".to_string()),
        },
        SupportedEngineInfo {
            id: "antigravity".to_string(),
            name: "Antigravity".to_string(),
            detected: antigravity_detected,
            status: antigravity_status,
            allowed_models: get_allowed_models_for_engine("antigravity", project_root),
            default_model: Some("ag/gemini-3.8-flash-high".to_string()),
        },
        SupportedEngineInfo {
            id: "openai".to_string(),
            name: "OpenAI Codex".to_string(),
            detected: openai_detected,
            status: openai_status,
            allowed_models: get_allowed_models_for_engine("openai", project_root),
            default_model: Some("gpt-4o".to_string()),
        },
        SupportedEngineInfo {
            id: "acp-custom".to_string(),
            name: "Custom ACP".to_string(),
            detected: custom_detected,
            status: custom_status,
            allowed_models: vec![],
            default_model: None,
        },
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_resolve_slot_command_for_all_supported_engines() {
        // 1. Hermes
        let hermes_cfg = SlotConfig {
            id: "h1".to_string(),
            label: "Hermes Bot".to_string(),
            kind: "hermes".to_string(),
            engine: Some("hermes".to_string()),
            command: None,
            hermes_profile: Some("senior".to_string()),
            model: Some("ag/gemini-3.8-flash-high".to_string()),
            fallback_model: None,
            permission: "ask".to_string(),
            cwd: ".".to_string(),
            role: None,
            custom_whitelist: None,
        };
        let (cmd, args, _env) = resolve_slot_command(&hermes_cfg);
        assert!(cmd.contains("hermes"));
        assert!(args.contains(&"-p".to_string()));
        assert!(args.contains(&"senior".to_string()));
        assert!(args.contains(&"acp".to_string()));

        // 2. Claude Code
        let claude_cfg = SlotConfig {
            id: "c1".to_string(),
            label: "Claude Bot".to_string(),
            kind: "claude-code".to_string(),
            engine: Some("claude-code".to_string()),
            command: None,
            hermes_profile: None,
            model: Some("claude-3-7-sonnet".to_string()),
            fallback_model: None,
            permission: "ask".to_string(),
            cwd: ".".to_string(),
            role: None,
            custom_whitelist: None,
        };
        let (cmd, args, _env) = resolve_slot_command(&claude_cfg);
        assert_eq!(cmd, "npx");
        assert_eq!(args, vec!["@agentclientprotocol/claude-agent-acp"]);

        // 3. Antigravity
        let ag_cfg = SlotConfig {
            id: "ag1".to_string(),
            label: "Antigravity Bot".to_string(),
            kind: "antigravity".to_string(),
            engine: Some("antigravity".to_string()),
            command: None,
            hermes_profile: None,
            model: Some("ag/gemini-3.8-flash-high".to_string()),
            fallback_model: None,
            permission: "ask".to_string(),
            cwd: ".".to_string(),
            role: None,
            custom_whitelist: None,
        };
        let (cmd, args, env) = resolve_slot_command(&ag_cfg);
        assert_eq!(cmd, "antigravity");
        assert!(args.contains(&"acp".to_string()));
        assert!(args.contains(&"http://127.0.0.1:20128/v1".to_string()));
        assert_eq!(
            env.get("ROUTER_PROXY_URL"),
            Some(&"http://127.0.0.1:20128/v1".to_string())
        );
        assert_eq!(
            env.get("OPENAI_BASE_URL"),
            Some(&"http://127.0.0.1:20128/v1".to_string())
        );
        assert_eq!(
            env.get("ANTHROPIC_BASE_URL"),
            Some(&"http://127.0.0.1:20128/v1".to_string())
        );

        // 4. OpenAI
        let openai_cfg = SlotConfig {
            id: "oa1".to_string(),
            label: "OpenAI Bot".to_string(),
            kind: "openai".to_string(),
            engine: Some("openai".to_string()),
            command: None,
            hermes_profile: None,
            model: Some("gpt-4o".to_string()),
            fallback_model: None,
            permission: "ask".to_string(),
            cwd: ".".to_string(),
            role: None,
            custom_whitelist: None,
        };
        let (cmd, args, _env) = resolve_slot_command(&openai_cfg);
        assert_eq!(cmd, "openai");
        assert_eq!(args, vec!["acp"]);

        // 5. Codex alias
        let codex_cfg = SlotConfig {
            id: "cdx1".to_string(),
            label: "Codex Bot".to_string(),
            kind: "codex".to_string(),
            engine: Some("codex".to_string()),
            command: None,
            hermes_profile: None,
            model: Some("o3-mini".to_string()),
            fallback_model: None,
            permission: "ask".to_string(),
            cwd: ".".to_string(),
            role: None,
            custom_whitelist: None,
        };
        let (cmd, args, _env) = resolve_slot_command(&codex_cfg);
        assert_eq!(cmd, "codex");
        assert_eq!(args, vec!["acp"]);

        // 6. Custom command
        let custom_cfg = SlotConfig {
            id: "cust1".to_string(),
            label: "Custom Bot".to_string(),
            kind: "acp-custom".to_string(),
            engine: Some("acp-custom".to_string()),
            command: Some("custom-agent --port 9090".to_string()),
            hermes_profile: None,
            model: None,
            fallback_model: None,
            permission: "ask".to_string(),
            cwd: ".".to_string(),
            role: None,
            custom_whitelist: None,
        };
        let (cmd, args, _env) = resolve_slot_command(&custom_cfg);
        assert_eq!(cmd, "custom-agent");
        assert_eq!(args, vec!["--port", "9090"]);
    }

    #[test]
    fn test_model_validation_per_engine() {
        // Claude Code
        assert!(validate_engine_model("claude-code", "claude-3-7-sonnet"));
        assert!(validate_engine_model("claude-code", "claude-3-5-sonnet"));
        assert!(validate_engine_model("claude-code", "claude-3-opus"));
        assert!(!validate_engine_model("claude-code", "gpt-4o"));
        assert!(!validate_engine_model("claude-code", "ag/gemini-3.8-flash-high"));

        // Antigravity
        assert!(validate_engine_model("antigravity", "ag/gemini-3.8-flash-high"));
        assert!(validate_engine_model("antigravity", "ag/claude-opus-4.1"));
        assert!(validate_engine_model("antigravity", "ag/claude-opus-4-6-thinking"));
        assert!(!validate_engine_model("antigravity", "claude-3-7-sonnet"));
        assert!(!validate_engine_model("antigravity", "gpt-4o"));

        // OpenAI & Codex
        assert!(validate_engine_model("openai", "gpt-4o"));
        assert!(validate_engine_model("openai", "o3-mini"));
        assert!(validate_engine_model("openai", "o1"));
        assert!(validate_engine_model("codex", "gpt-4o"));
        assert!(validate_engine_model("codex", "o3-mini"));
        assert!(!validate_engine_model("openai", "claude-3-7-sonnet"));
        assert!(!validate_engine_model("codex", "ag/gemini-3.8-flash-high"));

        // Hermes
        assert!(validate_engine_model("hermes", "ag/gemini-3.8-flash-high"));
        assert!(!validate_engine_model("hermes", "unregistered-unknown-model"));

        // Custom & unknown
        assert!(validate_engine_model("acp-custom", "anything-custom-allowed"));
        assert!(!validate_engine_model("unknown-engine", "gpt-4o"));
    }

    #[test]
    fn test_get_supported_engines_contains_all_targets() {
        let engines = get_supported_engines(None);
        assert_eq!(engines.len(), 5);

        let ids: Vec<&str> = engines.iter().map(|e| e.id.as_str()).collect();
        assert_eq!(
            ids,
            vec!["hermes", "claude-code", "antigravity", "openai", "acp-custom"]
        );

        let ag = engines.iter().find(|e| e.id == "antigravity").unwrap();
        assert_eq!(ag.name, "Antigravity");
        assert!(ag.allowed_models.contains(&"ag/gemini-3.8-flash-high".to_string()));

        let claude = engines.iter().find(|e| e.id == "claude-code").unwrap();
        assert_eq!(claude.name, "Claude Code");
        assert!(claude.allowed_models.contains(&"claude-3-7-sonnet".to_string()));

        let openai = engines.iter().find(|e| e.id == "openai").unwrap();
        assert_eq!(openai.name, "OpenAI Codex");
        assert!(openai.allowed_models.contains(&"gpt-4o".to_string()));
    }
}
