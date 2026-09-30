use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

pub type PendingResponseSender = Sender<Result<Value, AcpError>>;
pub type PendingMap = Arc<Mutex<HashMap<i64, PendingResponseSender>>>;
pub type UpdateCallback = Arc<dyn Fn(Value) + Send + Sync + 'static>;

#[derive(Debug, Clone)]
pub enum AcpError {
    Io(String),
    Json(String),
    Timeout,
    ProcessExited(Option<i32>),
    RpcError {
        code: i64,
        message: String,
        data: Option<Value>,
    },
}

impl std::fmt::Display for AcpError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AcpError::Io(e) => write!(f, "IO error: {e}"),
            AcpError::Json(e) => write!(f, "JSON error: {e}"),
            AcpError::Timeout => write!(f, "ACP request timed out"),
            AcpError::ProcessExited(code) => write!(f, "ACP process exited with code {:?}", code),
            AcpError::RpcError { code, message, .. } => {
                write!(f, "ACP RPC error {code}: {message}")
            }
        }
    }
}

impl std::error::Error for AcpError {}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AgentInfo {
    pub name: String,
    pub version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AgentCapabilities {
    pub load_session: bool,
    pub prompt_image: bool,
    pub session_fork: bool,
    pub session_list: bool,
    pub session_resume: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AcpInitializeResult {
    pub protocol_version: u32,
    pub agent_info: Option<AgentInfo>,
    pub agent_capabilities: AgentCapabilities,
    pub auth_methods: Vec<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelOption {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SessionModels {
    pub current_model_id: Option<String>,
    pub available_models: Vec<ModelOption>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ModeOption {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SessionModes {
    pub current_mode_id: Option<String>,
    pub available_modes: Vec<ModeOption>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AcpSessionNewResult {
    pub session_id: String,
    pub models: Option<SessionModels>,
    pub modes: Option<SessionModes>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PromptResponse {
    pub stop_reason: String,
    pub usage: Option<Value>,
    pub meta: Option<Value>,
}

pub struct AcpClient {
    next_id: AtomicI64,
    writer: Arc<Mutex<std::process::ChildStdin>>,
    pending: PendingMap,
    alive: Arc<AtomicBool>,
    stopping: Arc<AtomicBool>,
    child: Arc<Mutex<Option<Child>>>,
    pid: Option<u32>,
    pub stderr_log: Arc<Mutex<Vec<String>>>,
    #[allow(dead_code)]
    reader_thread: Option<thread::JoinHandle<()>>,
    #[allow(dead_code)]
    stderr_thread: Option<thread::JoinHandle<()>>,
}

impl AcpClient {
    pub fn spawn<F>(
        cmd_str: &str,
        args: &[String],
        env: &HashMap<String, String>,
        cwd: Option<&Path>,
        on_update: F,
    ) -> Result<Self, AcpError>
    where
        F: Fn(Value) + Send + Sync + 'static,
    {
        let mut cmd = Command::new(cmd_str);
        cmd.args(args);
        crate::toolchain::apply_env_for_root(&mut cmd, cwd);

        // Remove child context override so Hermes kanban/profile commands work properly
        cmd.env_remove("HERMES_DELEGATED_CHILD_CONTEXT");

        for (k, v) in env {
            cmd.env(k, v);
        }

        if let Some(c) = cwd {
            cmd.current_dir(c);
        }

        cmd.stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        let mut child = cmd.spawn().map_err(|e| AcpError::Io(e.to_string()))?;
        let pid = child.id();

        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| AcpError::Io("no stdout".to_string()))?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| AcpError::Io("no stdin".to_string()))?;
        let stderr = child.stderr.take();

        let writer = Arc::new(Mutex::new(stdin));
        let pending: PendingMap = Arc::new(Mutex::new(HashMap::new()));
        let alive = Arc::new(AtomicBool::new(true));
        let stopping = Arc::new(AtomicBool::new(false));
        let child_arc = Arc::new(Mutex::new(Some(child)));
        let stderr_log = Arc::new(Mutex::new(Vec::new()));

        let pending_clone = Arc::clone(&pending);
        let alive_clone = Arc::clone(&alive);
        let stopping_clone = Arc::clone(&stopping);
        let on_update_fn: UpdateCallback = Arc::new(on_update);

        // Reader thread for stdout (NDJSON messages)
        let reader_thread = thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line_res in reader.lines() {
                let line = match line_res {
                    Ok(l) => l,
                    Err(_) => break,
                };
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }
                let msg: Value = match serde_json::from_str(trimmed) {
                    Ok(v) => v,
                    Err(_) => continue,
                };

                // Check if message is a response
                if let Some(id_val) = msg.get("id") {
                    if !id_val.is_null()
                        && (msg.get("result").is_some() || msg.get("error").is_some())
                    {
                        if let Some(id_num) = id_val.as_i64() {
                            let sender_opt = pending_clone.lock().unwrap().remove(&id_num);
                            if let Some(sender) = sender_opt {
                                if let Some(err_val) = msg.get("error") {
                                    let code =
                                        err_val.get("code").and_then(|c| c.as_i64()).unwrap_or(-1);
                                    let message = err_val
                                        .get("message")
                                        .and_then(|m| m.as_str())
                                        .unwrap_or("Unknown RPC error")
                                        .to_string();
                                    let data = err_val.get("data").cloned();
                                    let _ = sender.send(Err(AcpError::RpcError {
                                        code,
                                        message,
                                        data,
                                    }));
                                } else {
                                    let res = msg.get("result").cloned().unwrap_or(Value::Null);
                                    let _ = sender.send(Ok(res));
                                }
                            }
                        }
                        continue;
                    }
                }

                // Check for notifications
                if let Some(method) = msg.get("method").and_then(|m| m.as_str()) {
                    if method == "session/update" {
                        if let Some(params) = msg.get("params") {
                            on_update_fn(params.clone());
                        }
                    }
                }
            }

            alive_clone.store(false, Ordering::SeqCst);
            if !stopping_clone.load(Ordering::SeqCst) {
                let mut pend = pending_clone.lock().unwrap();
                for (_, tx) in pend.drain() {
                    let _ = tx.send(Err(AcpError::ProcessExited(None)));
                }
            }
        });

        // Stderr reader thread
        let stderr_log_clone = Arc::clone(&stderr_log);
        let stderr_thread = stderr.map(|err_pipe| {
            thread::spawn(move || {
                let reader = BufReader::new(err_pipe);
                for line_res in reader.lines() {
                    if let Ok(line) = line_res {
                        let mut log = stderr_log_clone.lock().unwrap();
                        if log.len() >= 100 {
                            log.remove(0);
                        }
                        log.push(line);
                    } else {
                        break;
                    }
                }
            })
        });

        Ok(Self {
            next_id: AtomicI64::new(1),
            writer,
            pending,
            alive,
            stopping,
            child: child_arc,
            pid: Some(pid),
            stderr_log,
            reader_thread: Some(reader_thread),
            stderr_thread,
        })
    }

    pub fn is_alive(&self) -> bool {
        self.alive.load(Ordering::SeqCst)
    }

    pub fn pid(&self) -> Option<u32> {
        self.pid
    }

    fn send_raw(&self, val: &Value) -> Result<(), AcpError> {
        let mut s = serde_json::to_string(val).map_err(|e| AcpError::Json(e.to_string()))?;
        s.push('\n');
        let mut writer = self
            .writer
            .lock()
            .map_err(|e| AcpError::Io(e.to_string()))?;
        writer
            .write_all(s.as_bytes())
            .map_err(|e| AcpError::Io(e.to_string()))?;
        writer.flush().map_err(|e| AcpError::Io(e.to_string()))?;
        Ok(())
    }

    pub fn send_request(
        &self,
        method: &str,
        params: Value,
        timeout: Duration,
    ) -> Result<Value, AcpError> {
        if !self.is_alive() {
            return Err(AcpError::ProcessExited(None));
        }

        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let (tx, rx) = mpsc::channel();
        {
            let mut pending = self.pending.lock().unwrap();
            pending.insert(id, tx);
        }

        let req = serde_json::json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params,
        });

        self.send_raw(&req)?;

        match rx.recv_timeout(timeout) {
            Ok(res) => res,
            Err(mpsc::RecvTimeoutError::Timeout) => {
                let mut pending = self.pending.lock().unwrap();
                pending.remove(&id);
                Err(AcpError::Timeout)
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => Err(AcpError::ProcessExited(None)),
        }
    }

    pub fn send_notification(&self, method: &str, params: Value) -> Result<(), AcpError> {
        if !self.is_alive() {
            return Err(AcpError::ProcessExited(None));
        }

        let notif = serde_json::json!({
            "jsonrpc": "2.0",
            "method": method,
            "params": params,
        });

        self.send_raw(&notif)
    }

    pub fn initialize(&self, timeout: Duration) -> Result<AcpInitializeResult, AcpError> {
        let params = serde_json::json!({
            "protocolVersion": 1,
            "clientCapabilities": {
                "fs": {
                    "readTextFile": true,
                    "writeTextFile": true
                }
            },
            "clientInfo": {
                "name": "petak",
                "version": "0.1.0"
            }
        });

        let res = self.send_request("initialize", params, timeout)?;

        let protocol_version = res
            .get("protocolVersion")
            .and_then(|v| v.as_u64())
            .unwrap_or(1) as u32;

        let agent_info = res.get("agentInfo").map(|ai| AgentInfo {
            name: ai
                .get("name")
                .and_then(|n| n.as_str())
                .unwrap_or("unknown")
                .to_string(),
            version: ai
                .get("version")
                .and_then(|v| v.as_str())
                .map(ToString::to_string),
        });

        let caps_val = res.get("agentCapabilities");
        let load_session = caps_val
            .and_then(|c| c.get("loadSession"))
            .and_then(|v| v.as_bool())
            .unwrap_or(false);

        let prompt_image = caps_val
            .and_then(|c| c.get("promptCapabilities"))
            .and_then(|p| p.get("image"))
            .and_then(|v| v.as_bool())
            .unwrap_or(false);

        let sess_caps = caps_val.and_then(|c| c.get("sessionCapabilities"));
        let session_fork = sess_caps.and_then(|s| s.get("fork")).is_some();
        let session_list = sess_caps.and_then(|s| s.get("list")).is_some();
        let session_resume = sess_caps.and_then(|s| s.get("resume")).is_some();

        let auth_methods = res
            .get("authMethods")
            .and_then(|a| a.as_array())
            .cloned()
            .unwrap_or_default();

        Ok(AcpInitializeResult {
            protocol_version,
            agent_info,
            agent_capabilities: AgentCapabilities {
                load_session,
                prompt_image,
                session_fork,
                session_list,
                session_resume,
            },
            auth_methods,
        })
    }

    pub fn session_new(
        &self,
        cwd: &str,
        timeout: Duration,
    ) -> Result<AcpSessionNewResult, AcpError> {
        let params = serde_json::json!({
            "cwd": cwd,
            "mcpServers": []
        });

        let res = self.send_request("session/new", params, timeout)?;

        let session_id = res
            .get("sessionId")
            .and_then(|s| s.as_str())
            .ok_or_else(|| AcpError::Json("missing sessionId in session/new response".to_string()))?
            .to_string();

        let models = res.get("models").map(|m| {
            let current_model_id = m
                .get("currentModelId")
                .and_then(|c| c.as_str())
                .map(ToString::to_string);
            let mut available_models = Vec::new();
            if let Some(arr) = m.get("availableModels").and_then(|a| a.as_array()) {
                for item in arr {
                    if let Some(id) = item.get("modelId").and_then(|v| v.as_str()) {
                        let name = item
                            .get("name")
                            .and_then(|v| v.as_str())
                            .unwrap_or(id)
                            .to_string();
                        let description = item
                            .get("description")
                            .and_then(|v| v.as_str())
                            .map(ToString::to_string);
                        available_models.push(ModelOption {
                            id: id.to_string(),
                            name,
                            description,
                        });
                    }
                }
            }
            SessionModels {
                current_model_id,
                available_models,
            }
        });

        let modes = res.get("modes").map(|m| {
            let current_mode_id = m
                .get("currentModeId")
                .and_then(|c| c.as_str())
                .map(ToString::to_string);
            let mut available_modes = Vec::new();
            if let Some(arr) = m.get("availableModes").and_then(|a| a.as_array()) {
                for item in arr {
                    if let Some(id) = item.get("id").and_then(|v| v.as_str()) {
                        let name = item
                            .get("name")
                            .and_then(|v| v.as_str())
                            .unwrap_or(id)
                            .to_string();
                        let description = item
                            .get("description")
                            .and_then(|v| v.as_str())
                            .map(ToString::to_string);
                        available_modes.push(ModeOption {
                            id: id.to_string(),
                            name,
                            description,
                        });
                    }
                }
            }
            SessionModes {
                current_mode_id,
                available_modes,
            }
        });

        Ok(AcpSessionNewResult {
            session_id,
            models,
            modes,
        })
    }

    pub fn session_prompt(
        &self,
        session_id: &str,
        text: &str,
        timeout: Duration,
    ) -> Result<PromptResponse, AcpError> {
        let params = serde_json::json!({
            "sessionId": session_id,
            "prompt": [
                {
                    "type": "text",
                    "text": text
                }
            ]
        });

        let res = self.send_request("session/prompt", params, timeout)?;

        let stop_reason = res
            .get("stopReason")
            .and_then(|s| s.as_str())
            .unwrap_or("end_turn")
            .to_string();

        let usage = res.get("usage").cloned();
        let meta = res.get("_meta").cloned();

        Ok(PromptResponse {
            stop_reason,
            usage,
            meta,
        })
    }

    pub fn session_cancel(&self, session_id: &str) -> Result<(), AcpError> {
        let params = serde_json::json!({
            "sessionId": session_id
        });
        self.send_notification("session/cancel", params)
    }

    pub fn kill(&self) -> Result<(), AcpError> {
        self.stopping.store(true, Ordering::SeqCst);
        let mut child_guard = self.child.lock().unwrap();
        if let Some(mut child) = child_guard.take() {
            let _ = child.kill();
            let _ = child.wait();
        }

        self.alive.store(false, Ordering::SeqCst);

        let mut pending = self.pending.lock().unwrap();
        for (_, sender) in pending.drain() {
            let _ = sender.send(Err(AcpError::ProcessExited(None)));
        }

        Ok(())
    }
}

impl Drop for AcpClient {
    fn drop(&mut self) {
        let _ = self.kill();
    }
}
