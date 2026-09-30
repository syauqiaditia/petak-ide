use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{self, Sender};
use std::sync::{Mutex, RwLock};
use std::time::Duration;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PermissionMode {
    Read,
    Ask,
    Auto,
    Full,
}

impl PermissionMode {
    pub fn from_str_opt(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "read" => Self::Read,
            "auto" => Self::Auto,
            "full" => Self::Full,
            _ => Self::Ask,
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Read => "read",
            Self::Ask => "ask",
            Self::Auto => "auto",
            Self::Full => "full",
        }
    }
}

pub fn default_allowlist() -> Vec<String> {
    vec![
        "flutter".to_string(),
        "dart".to_string(),
        "gradlew".to_string(),
        "./gradlew".to_string(),
        "npm test".to_string(),
        "npm run".to_string(),
        "cargo test".to_string(),
        "cargo check".to_string(),
        "pod install".to_string(),
        "pytest".to_string(),
    ]
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingPermissionRequest {
    pub request_id: String,
    pub slot_id: String,
    pub session_id: String,
    pub tool_call: Value,
    pub created_at: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PermissionDecision {
    Approved,
    Denied { reason: String },
    AskUser,
}

pub struct PermissionManager {
    allowlist: RwLock<Vec<String>>,
    pending: Mutex<HashMap<String, (PendingPermissionRequest, Sender<bool>)>>,
    next_id: AtomicU64,
}

impl Default for PermissionManager {
    fn default() -> Self {
        Self::new(default_allowlist())
    }
}

impl PermissionManager {
    pub fn new(allowlist: Vec<String>) -> Self {
        Self {
            allowlist: RwLock::new(allowlist),
            pending: Mutex::new(HashMap::new()),
            next_id: AtomicU64::new(1),
        }
    }

    pub fn get_allowlist(&self) -> Vec<String> {
        let guard = self.allowlist.read().unwrap();
        guard.clone()
    }

    pub fn set_allowlist(&self, list: Vec<String>) {
        let mut guard = self.allowlist.write().unwrap();
        *guard = list;
    }

    pub fn is_command_allowed(&self, cmd: &str) -> bool {
        let trimmed = cmd.trim();
        let guard = self.allowlist.read().unwrap();
        for allowed in guard.iter() {
            let a = allowed.trim();
            if a.is_empty() {
                continue;
            }
            if trimmed == a || trimmed.starts_with(&format!("{a} ")) || trimmed.starts_with(a) {
                return true;
            }
        }
        false
    }

    pub fn extract_command(tool_call: &Value) -> Option<String> {
        if let Some(s) = tool_call.as_str() {
            return Some(s.to_string());
        }

        // Try arguments.command, params.command, command, title
        if let Some(args) = tool_call.get("arguments") {
            if let Some(cmd) = args.get("command").and_then(|v| v.as_str()) {
                return Some(cmd.to_string());
            }
        }
        if let Some(params) = tool_call.get("params") {
            if let Some(cmd) = params.get("command").and_then(|v| v.as_str()) {
                return Some(cmd.to_string());
            }
        }
        if let Some(cmd) = tool_call.get("command").and_then(|v| v.as_str()) {
            return Some(cmd.to_string());
        }
        if let Some(title) = tool_call.get("title").and_then(|v| v.as_str()) {
            return Some(title.to_string());
        }

        None
    }

    pub fn evaluate(&self, mode: PermissionMode, tool_call: &Value) -> PermissionDecision {
        match mode {
            PermissionMode::Read => PermissionDecision::Denied {
                reason: "Mode read-only: eksekusi perintah ditolak".to_string(),
            },
            PermissionMode::Full => PermissionDecision::Approved,
            PermissionMode::Auto => {
                if let Some(cmd) = Self::extract_command(tool_call) {
                    if self.is_command_allowed(&cmd) {
                        return PermissionDecision::Approved;
                    }
                }
                PermissionDecision::AskUser
            }
            PermissionMode::Ask => PermissionDecision::AskUser,
        }
    }

    /// Handles a permission request synchronously, waiting for user response if needed.
    pub fn request_permission(
        &self,
        slot_id: &str,
        session_id: &str,
        mode: PermissionMode,
        tool_call: &Value,
        timeout: Duration,
    ) -> Result<bool, String> {
        match self.evaluate(mode, tool_call) {
            PermissionDecision::Approved => Ok(true),
            PermissionDecision::Denied { reason } => Err(reason),
            PermissionDecision::AskUser => {
                let id = self.next_id.fetch_add(1, Ordering::SeqCst);
                let req_id = format!("perm_{id}");
                let now = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_secs())
                    .unwrap_or(0);

                let req = PendingPermissionRequest {
                    request_id: req_id.clone(),
                    slot_id: slot_id.to_string(),
                    session_id: session_id.to_string(),
                    tool_call: tool_call.clone(),
                    created_at: now,
                };

                let (tx, rx) = mpsc::channel();
                {
                    let mut pend = self.pending.lock().unwrap();
                    pend.insert(req_id.clone(), (req, tx));
                }

                match rx.recv_timeout(timeout) {
                    Ok(allowed) => Ok(allowed),
                    Err(mpsc::RecvTimeoutError::Timeout) => {
                        let mut pend = self.pending.lock().unwrap();
                        pend.remove(&req_id);
                        Err("Permintaan izin kedaluwarsa (timeout)".to_string())
                    }
                    Err(mpsc::RecvTimeoutError::Disconnected) => {
                        let mut pend = self.pending.lock().unwrap();
                        pend.remove(&req_id);
                        Err("Koneksi permintaan izin terputus".to_string())
                    }
                }
            }
        }
    }

    pub fn respond(&self, request_id: &str, allow: bool) -> Result<(), String> {
        let mut pend = self.pending.lock().unwrap();
        if let Some((_, tx)) = pend.remove(request_id) {
            let _ = tx.send(allow);
            Ok(())
        } else {
            Err(format!("Permintaan izin '{request_id}' tidak ditemukan"))
        }
    }

    pub fn list_pending(&self) -> Vec<PendingPermissionRequest> {
        let pend = self.pending.lock().unwrap();
        pend.values().map(|(r, _)| r.clone()).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_permission_modes() {
        let mgr = PermissionManager::default();

        let allowed_tc = serde_json::json!({
            "command": "cargo test"
        });
        let blocked_tc = serde_json::json!({
            "command": "rm -rf /"
        });

        // 1. Read mode: denies everything
        assert!(matches!(
            mgr.evaluate(PermissionMode::Read, &allowed_tc),
            PermissionDecision::Denied { .. }
        ));

        // 2. Full mode: approves everything
        assert_eq!(
            mgr.evaluate(PermissionMode::Full, &blocked_tc),
            PermissionDecision::Approved
        );

        // 3. Auto mode: approves allowed commands, asks for others
        assert_eq!(
            mgr.evaluate(PermissionMode::Auto, &allowed_tc),
            PermissionDecision::Approved
        );
        assert_eq!(
            mgr.evaluate(PermissionMode::Auto, &blocked_tc),
            PermissionDecision::AskUser
        );

        // 4. Ask mode: always asks
        assert_eq!(
            mgr.evaluate(PermissionMode::Ask, &allowed_tc),
            PermissionDecision::AskUser
        );
    }

    #[test]
    fn test_ask_mode_respond() {
        let mgr = std::sync::Arc::new(PermissionManager::default());
        let mgr_clone = std::sync::Arc::clone(&mgr);

        let handle = std::thread::spawn(move || {
            let tc = serde_json::json!({"command": "some special tool"});
            mgr_clone.request_permission(
                "s1",
                "sess1",
                PermissionMode::Ask,
                &tc,
                Duration::from_secs(5),
            )
        });

        // Wait until pending request appears
        let mut req_id = String::new();
        for _ in 0..50 {
            let list = mgr.list_pending();
            if let Some(r) = list.first() {
                req_id = r.request_id.clone();
                break;
            }
            std::thread::sleep(Duration::from_millis(10));
        }

        assert!(!req_id.is_empty());
        mgr.respond(&req_id, true).unwrap();

        let result = handle.join().unwrap().unwrap();
        assert!(result);
    }
}
