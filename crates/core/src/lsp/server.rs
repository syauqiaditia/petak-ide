// LSP server: spawn process via stdio, initialize handshake, send requests/notifications,
// route responses to pending callers, forward server notifications to a callback.

use super::rpc;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufReader, BufWriter};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

/// Events emitted by the server to the caller's callback.
#[derive(Debug, Clone)]
pub enum ServerEvent {
    /// Server sent a notification (e.g. publishDiagnostics)
    Notification { method: String, params: Value },
    /// Server wants to apply a workspace edit (workspace/applyEdit request)
    ApplyEdit { id: Value, edit: Value },
    /// Server process crashed unexpectedly
    Crashed,
    /// Server status changed (starting, ready, stopped, crashed, failed)
    Status { state: String, reason: Option<String> },
}

/// Configuration for spawning an LSP server.
#[derive(Debug, Clone)]
pub struct ServerConfig {
    pub command: String,
    pub args: Vec<String>,
    pub root_uri: String,
    pub env: Vec<(String, String)>,
    pub init_timeout: Option<Duration>,
    pub stderr_log_path: Option<std::path::PathBuf>,
}

impl ServerConfig {
    pub fn new(command: impl Into<String>, args: Vec<String>, root_uri: impl Into<String>) -> Self {
        Self {
            command: command.into(),
            args,
            root_uri: root_uri.into(),
            env: Vec::new(),
            init_timeout: None,
            stderr_log_path: None,
        }
    }
}

/// A running LSP server connection.
pub struct Server {
    next_id: AtomicI64,
    writer: Arc<Mutex<BufWriter<std::process::ChildStdin>>>,
    pending: Arc<Mutex<HashMap<i64, Sender<Result<Value, ServerError>>>>>,
    alive: Arc<AtomicBool>,
    /// Set by kill()/shutdown() so the reader doesn't report a normal stop as a crash.
    stopping: Arc<AtomicBool>,
    #[allow(dead_code)] // joined on Drop in future
    reader_thread: Option<thread::JoinHandle<()>>,
    child: Mutex<Option<Child>>,
    pub capabilities: Mutex<Option<Value>>,
}

#[derive(Debug, Clone)]
pub enum ServerError {
    Io(String),
    Timeout,
    ServerDied,
    ResponseError { code: i64, message: String },
}

impl std::fmt::Display for ServerError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ServerError::Io(e) => write!(f, "io: {e}"),
            ServerError::Timeout => write!(f, "request timed out"),
            ServerError::ServerDied => write!(f, "server process died"),
            ServerError::ResponseError { code, message } => {
                write!(f, "LSP error {code}: {message}")
            }
        }
    }
}

impl std::error::Error for ServerError {}

impl Server {
    /// Spawn the LSP server process, start the reader thread, and perform the
    /// initialize/initialized handshake.
    pub fn start<F>(config: &ServerConfig, on_event: F) -> Result<Self, ServerError>
    where
        F: Fn(ServerEvent) + Send + Sync + 'static,
    {
        let mut cmd = Command::new(&config.command);
        cmd.args(&config.args);
        crate::toolchain::apply_env(&mut cmd);
        for (k, v) in &config.env {
            cmd.env(k, v);
        }
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            cmd.process_group(0);
        }
        cmd.stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        let mut child = cmd.spawn().map_err(|e| ServerError::Io(e.to_string()))?;

        let stdout = child.stdout.take().unwrap();
        let stdin = child.stdin.take().unwrap();
        if let Some(stderr) = child.stderr.take() {
            let log_path_opt = config.stderr_log_path.clone();
            thread::spawn(move || {
                use std::io::BufRead;
                use std::io::Write;
                let mut file_opt = if let Some(ref path) = log_path_opt {
                    if let Some(parent) = path.parent() {
                        let _ = std::fs::create_dir_all(parent);
                    }
                    std::fs::OpenOptions::new()
                        .create(true)
                        .append(true)
                        .open(path)
                        .ok()
                } else {
                    None
                };

                let reader = std::io::BufReader::new(stderr);
                for line in reader.lines().flatten() {
                    eprintln!("[lsp stderr] {}", line);
                    if let Some(ref mut f) = file_opt {
                        let _ = writeln!(f, "{}", line);
                    }
                }
            });
        }
        let writer = Arc::new(Mutex::new(BufWriter::new(stdin)));

        let pending: Arc<Mutex<HashMap<i64, Sender<Result<Value, ServerError>>>>> =
            Arc::new(Mutex::new(HashMap::new()));
        let alive = Arc::new(AtomicBool::new(true));

        // Reader thread
        let pending_clone = Arc::clone(&pending);
        let alive_clone = Arc::clone(&alive);
        let on_event = Arc::new(on_event);
        let on_event_clone = Arc::clone(&on_event);
        let stopping = Arc::new(AtomicBool::new(false));
        let stopping_clone = Arc::clone(&stopping);
        let writer_clone = Arc::clone(&writer);

        let reader_thread = thread::spawn(move || {
            let mut reader = BufReader::new(stdout);
            loop {
                match rpc::decode_one(&mut reader) {
                    Ok(body) => {
                        let msg: Value = match serde_json::from_slice(&body) {
                            Ok(v) => v,
                            Err(_) => continue,
                        };
                        // Is it a response (has "id" and ("result" or "error"))?
                        if let Some(id) = msg.get("id") {
                            if msg.get("result").is_some() || msg.get("error").is_some() {
                                // Response to a pending request
                                if let Some(id_num) = id.as_i64() {
                                    let sender = pending_clone.lock().unwrap().remove(&id_num);
                                    if let Some(tx) = sender {
                                        if let Some(err) = msg.get("error") {
                                            let code = err.get("code").and_then(|c| c.as_i64()).unwrap_or(0);
                                            let message = err.get("message").and_then(|m| m.as_str()).unwrap_or("").to_string();
                                            let _ = tx.send(Err(ServerError::ResponseError { code, message }));
                                        } else {
                                            let _ = tx.send(Ok(msg["result"].clone()));
                                        }
                                    }
                                }
                                continue;
                            }
                            // Server-initiated request (has "id" + "method")
                            if let Some(method) = msg.get("method").and_then(|m| m.as_str()) {
                                if method == "workspace/applyEdit" {
                                    let edit = msg.get("params").cloned().unwrap_or(Value::Null);
                                    on_event_clone(ServerEvent::ApplyEdit {
                                        id: id.clone(),
                                        edit,
                                    });
                                    continue;
                                }
                                // Other server requests (workDoneProgress/create,
                                // registerCapability, ...): answer a default so the server
                                // doesn't block. configuration wants one entry per item.
                                let result = if method == "workspace/configuration" {
                                    let n = msg
                                        .pointer("/params/items")
                                        .and_then(|i| i.as_array())
                                        .map_or(0, |a| a.len());
                                    Value::Array(vec![Value::Null; n])
                                } else {
                                    Value::Null
                                };
                                let reply = json!({ "jsonrpc": "2.0", "id": id, "result": result });
                                let _ = rpc::write_msg(&mut *writer_clone.lock().unwrap(), &reply);
                                continue;
                            }
                        }
                        // Notification from server (no "id", has "method")
                        if let Some(method) = msg.get("method").and_then(|m| m.as_str()) {
                            let params = msg.get("params").cloned().unwrap_or(Value::Null);
                            on_event_clone(ServerEvent::Notification {
                                method: method.to_string(),
                                params,
                            });
                        }
                    }
                    Err(_) => {
                        // Stream ended (server died or shutdown)
                        alive_clone.store(false, Ordering::SeqCst);
                        // Fail all pending requests
                        let mut map = pending_clone.lock().unwrap();
                        for (_, tx) in map.drain() {
                            let _ = tx.send(Err(ServerError::ServerDied));
                        }
                        if !stopping_clone.load(Ordering::SeqCst) {
                            on_event_clone(ServerEvent::Crashed);
                        }
                        break;
                    }
                }
            }
        });

        let server = Server {
            next_id: AtomicI64::new(1),
            writer,
            pending,
            alive,
            stopping,
            reader_thread: Some(reader_thread),
            child: Mutex::new(Some(child)),
            capabilities: Mutex::new(None),
        };

        // Initialize handshake
        let init_timeout = config.init_timeout.unwrap_or(Duration::from_secs(60));
        let init_result = match server.request_with_timeout(
            "initialize",
            &client_capabilities(&config.root_uri),
            init_timeout,
        ) {
            Ok(res) => res,
            Err(e) => {
                server.kill();
                return Err(e);
            }
        };

        *server.capabilities.lock().unwrap() = Some(init_result.clone());

        // Send initialized notification
        server.notify("initialized", &json!({}))?;

        Ok(server)
    }

    /// Send a JSON-RPC request and wait for the response with a timeout.
    pub fn request_with_timeout(
        &self,
        method: &str,
        params: &Value,
        timeout: Duration,
    ) -> Result<Value, ServerError> {
        if !self.alive.load(Ordering::SeqCst) {
            return Err(ServerError::ServerDied);
        }
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let msg = json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params,
        });

        let (tx, rx) = mpsc::channel();
        self.pending.lock().unwrap().insert(id, tx);

        // Write
        {
            let mut w = self.writer.lock().unwrap();
            rpc::write_msg(&mut *w, &msg).map_err(|e| ServerError::Io(e.to_string()))?;
        }

        // Wait for response
        match rx.recv_timeout(timeout) {
            Ok(result) => result,
            Err(mpsc::RecvTimeoutError::Timeout) => {
                self.pending.lock().unwrap().remove(&id);
                Err(ServerError::Timeout)
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => Err(ServerError::ServerDied),
        }
    }

    /// Convenience: request with default 10s timeout.
    pub fn request(&self, method: &str, params: &Value) -> Result<Value, ServerError> {
        self.request_with_timeout(method, params, Duration::from_secs(10))
    }

    /// Send a JSON-RPC notification (no response expected).
    pub fn notify(&self, method: &str, params: &Value) -> Result<(), ServerError> {
        if !self.alive.load(Ordering::SeqCst) {
            return Err(ServerError::ServerDied);
        }
        let msg = json!({
            "jsonrpc": "2.0",
            "method": method,
            "params": params,
        });
        let mut w = self.writer.lock().unwrap();
        rpc::write_msg(&mut *w, &msg).map_err(|e| ServerError::Io(e.to_string()))
    }

    /// Respond to a server-initiated request (e.g. workspace/applyEdit).
    pub fn respond(&self, id: &Value, result: &Value) -> Result<(), ServerError> {
        let msg = json!({
            "jsonrpc": "2.0",
            "id": id,
            "result": result,
        });
        let mut w = self.writer.lock().unwrap();
        rpc::write_msg(&mut *w, &msg).map_err(|e| ServerError::Io(e.to_string()))
    }

    /// Check if the server process is still alive.
    pub fn is_alive(&self) -> bool {
        self.alive.load(Ordering::SeqCst)
    }

    /// Graceful shutdown: send shutdown request, then exit notification.
    pub fn shutdown(self) {
        self.stopping.store(true, Ordering::SeqCst);
        if self.alive.load(Ordering::SeqCst) {
            // Try shutdown request (ignore errors)
            let _ = self.request_with_timeout("shutdown", &Value::Null, Duration::from_secs(5));
            let _ = self.notify("exit", &Value::Null);
        }
        // Kill the process group if still running
        if let Some(mut child) = self.child.lock().unwrap().take() {
            #[cfg(unix)]
            {
                let pid = child.id() as i32;
                unsafe {
                    libc::killpg(pid, libc::SIGKILL);
                }
            }
            let _ = child.kill();
            let _ = child.wait();
        }
    }

    /// Kill the server process and its process group immediately.
    pub fn kill(&self) {
        self.stopping.store(true, Ordering::SeqCst);
        self.alive.store(false, Ordering::SeqCst);
        if let Some(mut child) = self.child.lock().unwrap().take() {
            #[cfg(unix)]
            {
                let pid = child.id() as i32;
                unsafe {
                    libc::killpg(pid, libc::SIGKILL);
                }
            }
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

impl Drop for Server {
    fn drop(&mut self) {
        self.kill();
    }
}

/// Build the client capabilities JSON for the initialize request.
fn client_capabilities(root_uri: &str) -> Value {
    let name = root_uri
        .trim_end_matches('/')
        .rsplit('/')
        .next()
        .filter(|s| !s.is_empty())
        .unwrap_or("workspace");

    json!({
        "processId": std::process::id(),
        "rootUri": root_uri,
        "workspaceFolders": [
            {
                "uri": root_uri,
                "name": name
            }
        ],
        "capabilities": {
            "textDocument": {
                "synchronization": {
                    "dynamicRegistration": false,
                    "willSave": false,
                    "willSaveWaitUntil": false,
                    "didSave": true
                },
                "publishDiagnostics": {
                    "relatedInformation": true
                },
                "completion": {
                    "completionItem": {
                        "snippetSupport": true,
                        "resolveSupport": {
                            "properties": ["documentation"]
                        }
                    },
                    "contextSupport": true
                },
                "hover": {
                    "contentFormat": ["markdown", "plaintext"]
                },
                "definition": {
                    "dynamicRegistration": false
                },
                "references": {
                    "dynamicRegistration": false
                },
                "rename": {
                    "prepareSupport": true
                },
                "codeAction": {
                    "codeActionLiteralSupport": {
                        "codeActionKind": {
                            "valueSet": [
                                "quickfix",
                                "refactor",
                                "refactor.extract",
                                "refactor.inline",
                                "refactor.rewrite",
                                "source",
                                "source.organizeImports"
                            ]
                        }
                    },
                    "resolveSupport": {
                        "properties": ["edit"]
                    }
                },
                "formatting": {
                    "dynamicRegistration": false
                }
            },
            "workspace": {
                "applyEdit": true,
                "workspaceEdit": {
                    "documentChanges": true
                }
            }
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_client_capabilities_context_support() {
        let caps = client_capabilities("file:///workspace");
        assert_eq!(
            caps["capabilities"]["textDocument"]["completion"]["contextSupport"],
            true
        );
    }
}
