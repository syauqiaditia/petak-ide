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
    pub kind: String, // "claude-code" | "hermes" | "acp-custom"
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
                        command: None,
                        hermes_profile: Some("default".to_string()),
                        model: Some("ag/gemini-3.8-flash-high".to_string()),
                        fallback_model: Some("gemini-2.5-pro".to_string()),
                        permission: "ask".to_string(),
                        cwd: ".".to_string(),
                    },
                    SlotConfig {
                        id: "manager".to_string(),
                        label: "Manager".to_string(),
                        kind: "hermes".to_string(),
                        command: None,
                        hermes_profile: Some("manager".to_string()),
                        model: Some("claude-3-7-sonnet".to_string()),
                        fallback_model: Some("gemini-2.5-pro".to_string()),
                        permission: "ask".to_string(),
                        cwd: ".".to_string(),
                    },
                    SlotConfig {
                        id: "techlead".to_string(),
                        label: "Techlead".to_string(),
                        kind: "hermes".to_string(),
                        command: None,
                        hermes_profile: Some("techlead".to_string()),
                        model: Some("claude-3-7-sonnet".to_string()),
                        fallback_model: Some("gemini-2.5-pro".to_string()),
                        permission: "ask".to_string(),
                        cwd: ".".to_string(),
                    },
                    SlotConfig {
                        id: "senior".to_string(),
                        label: "Senior".to_string(),
                        kind: "hermes".to_string(),
                        command: None,
                        hermes_profile: Some("senior".to_string()),
                        model: Some("claude-3-7-sonnet".to_string()),
                        fallback_model: Some("gemini-2.5-pro".to_string()),
                        permission: "ask".to_string(),
                        cwd: ".".to_string(),
                    },
                    SlotConfig {
                        id: "senior2".to_string(),
                        label: "Senior2".to_string(),
                        kind: "hermes".to_string(),
                        command: None,
                        hermes_profile: Some("senior2".to_string()),
                        model: Some("gemini-2.5-pro".to_string()),
                        fallback_model: None,
                        permission: "ask".to_string(),
                        cwd: ".".to_string(),
                    },
                    SlotConfig {
                        id: "reviewer".to_string(),
                        label: "Reviewer".to_string(),
                        kind: "hermes".to_string(),
                        command: None,
                        hermes_profile: Some("reviewer".to_string()),
                        model: Some("gemini-2.5-pro".to_string()),
                        fallback_model: None,
                        permission: "ask".to_string(),
                        cwd: ".".to_string(),
                    },
                    SlotConfig {
                        id: "designer".to_string(),
                        label: "Designer".to_string(),
                        kind: "hermes".to_string(),
                        command: None,
                        hermes_profile: Some("designer".to_string()),
                        model: Some("claude-3-7-sonnet".to_string()),
                        fallback_model: None,
                        permission: "ask".to_string(),
                        cwd: ".".to_string(),
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

    pub fn add_slot(&self, config: SlotConfig) -> Result<SlotSummary, String> {
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

    pub fn update_slot(&self, config: SlotConfig) -> Result<SlotSummary, String> {
        let mut slots = self.slots.write().unwrap();
        let slot = slots
            .get_mut(&config.id)
            .ok_or_else(|| format!("Slot '{}' tidak ditemukan", config.id))?;

        let old_config = slot.config.clone();
        slot.config = config.clone();

        // If runtime command or profile changed and client is active, stop it
        if (old_config.kind != config.kind
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
                    command: None,
                    hermes_profile: Some(slot_id.to_string()),
                    model: Some("ag/gemini-3.8-flash-high".to_string()),
                    fallback_model: Some("gemini-2.5-pro".to_string()),
                    permission: "ask".to_string(),
                    cwd: ".".to_string(),
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

                            match perm_mgr.request_permission(
                                &slot_id_for_req,
                                &sess_id,
                                mode,
                                &tool_call,
                                Duration::from_secs(120),
                            ) {
                                Ok(true) => Some(Ok(serde_json::json!({
                                    "outcome": { "outcome": "approved" }
                                }))),
                                Ok(false) => Some(Ok(serde_json::json!({
                                    "outcome": { "outcome": "denied" }
                                }))),
                                Err(e) => Some(Err((-32000, e))),
                            }
                        }
                        "fs/read_text_file" => {
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

    pub fn prompt_slot(&self, slot_id: &str, text: &str) -> Result<PromptResponse, String> {
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

        let prompt_result = client.session_prompt(&session_id, text, Duration::from_secs(120));

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

fn resolve_slot_command(config: &SlotConfig) -> (String, Vec<String>, HashMap<String, String>) {
    let mut env = HashMap::new();

    if let Some(ref custom_cmd) = config.command {
        let parts: Vec<String> = custom_cmd
            .split_whitespace()
            .map(ToString::to_string)
            .collect();
        if let Some((first, rest)) = parts.split_first() {
            return (first.clone(), rest.to_vec(), env);
        }
    }

    match config.kind.as_str() {
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
        _ => {
            // Default fallback
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
        status: slot.status.clone(),
        session_id: slot.session_id.clone(),
        active_pid,
        capabilities: slot.capabilities.clone(),
        history_len: slot.history.len(),
        last_activity_secs_ago,
        config: slot.config.clone(),
    }
}
