// Registry: map (Lang, root) → Server. Lazy start on didOpen, idle kill after 10 min,
// crash restart with re-didOpen of open documents.

use super::pos;
use super::server::{Server, ServerConfig, ServerError, ServerEvent};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// Helper: convert Path to file:// URI, percent-encoding unsafe characters.
pub fn path_to_uri(path: &Path) -> String {
    let mut out = String::from("file://");
    for b in path.to_string_lossy().bytes() {
        match b {
            b' ' => out.push_str("%20"),
            b'%' => out.push_str("%25"),
            b'#' => out.push_str("%23"),
            b'?' => out.push_str("%3F"),
            _ => out.push(b as char),
        }
    }
    out
}

/// Helper: convert file:// URI back to PathBuf, percent-decoding characters.
pub fn uri_to_path(uri: &str) -> Option<PathBuf> {
    let stripped = uri.strip_prefix("file://")?;
    let mut bytes = Vec::new();
    let b = stripped.as_bytes();
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            if let Ok(val) = u8::from_str_radix(std::str::from_utf8(&b[i + 1..i + 3]).unwrap_or(""), 16) {
                bytes.push(val);
                i += 3;
                continue;
            }
        }
        bytes.push(b[i]);
        i += 1;
    }
    let s = String::from_utf8(bytes).ok()?;
    Some(PathBuf::from(s))
}

/// Injectable clock trait for testability.
pub trait Clock: Send + Sync {
    fn now(&self) -> Instant;
}

/// Real wall clock.
pub struct WallClock;
impl Clock for WallClock {
    fn now(&self) -> Instant {
        Instant::now()
    }
}

/// Supported languages.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Lang {
    Dart,
    Kotlin,
    Swift,
}

impl Lang {
    /// Name of the language as string.
    pub fn as_str(&self) -> &'static str {
        match self {
            Lang::Dart => "dart",
            Lang::Kotlin => "kotlin",
            Lang::Swift => "swift",
        }
    }

    /// Detect language from file extension.
    pub fn from_extension(ext: &str) -> Option<Self> {
        match ext {
            "dart" => Some(Lang::Dart),
            "kt" | "kts" => Some(Lang::Kotlin),
            "swift" => Some(Lang::Swift),
            _ => None,
        }
    }

    /// Default command and args. Can be overridden by PETAK_LSP_<LANG> env.
    pub fn default_command(&self) -> (String, Vec<String>) {
        self.default_command_for_root(None)
    }

    /// Default command and args, taking into account project root (e.g. FVM).
    pub fn default_command_for_root(&self, root: Option<&Path>) -> (String, Vec<String>) {
        match self {
            Lang::Dart => {
                let dart_bin = crate::toolchain::resolve_dart(root)
                    .map(|p| p.to_string_lossy().to_string())
                    .unwrap_or_else(|| "dart".to_string());
                (
                    dart_bin,
                    vec!["language-server".into(), "--protocol=lsp".into()],
                )
            }
            Lang::Kotlin => {
                let kotlin_bin = crate::toolchain::resolve_kotlin_ls()
                    .map(|p| p.to_string_lossy().to_string())
                    .unwrap_or_else(|| "kotlin-language-server".into());
                (kotlin_bin, vec![])
            }
            Lang::Swift => {
                let swift_bin = crate::toolchain::resolve_sourcekit_lsp()
                    .map(|p| p.to_string_lossy().to_string())
                    .unwrap_or_else(|| "xcrun".to_string());
                if swift_bin.ends_with("xcrun") {
                    ("xcrun".into(), vec!["sourcekit-lsp".into()])
                } else {
                    (swift_bin, vec![])
                }
            }
        }
    }

    fn env_override_key(&self) -> &'static str {
        match self {
            Lang::Dart => "PETAK_LSP_DART",
            Lang::Kotlin => "PETAK_LSP_KOTLIN",
            Lang::Swift => "PETAK_LSP_SWIFT",
        }
    }

    /// Get command, checking env override first.
    pub fn command(&self) -> (String, Vec<String>) {
        self.command_for_root(None)
    }

    /// Get command for project root, checking env override first.
    pub fn command_for_root(&self, root: Option<&Path>) -> (String, Vec<String>) {
        if let Ok(val) = std::env::var(self.env_override_key()) {
            let parts: Vec<&str> = val.split_whitespace().collect();
            if parts.is_empty() {
                return self.default_command_for_root(root);
            }
            let cmd = parts[0].to_string();
            let args = parts[1..].iter().map(|s| s.to_string()).collect();
            return (cmd, args);
        }
        self.default_command_for_root(root)
    }
}

/// Key for the server map.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct ServerKey {
    lang: Lang,
    root: PathBuf,
}

/// An open document tracked by the registry for crash recovery.
#[derive(Debug, Clone)]
struct OpenDoc {
    uri: String,
    language_id: String,
    version: i32,
    text: String,
}

fn did_open_params(doc: &OpenDoc) -> serde_json::Value {
    json!({
        "textDocument": {
            "uri": &doc.uri,
            "languageId": &doc.language_id,
            "version": doc.version,
            "text": &doc.text,
        }
    })
}

/// State for one managed server.
struct ManagedServer {
    server: Arc<Server>,
    last_activity: Instant,
}

/// Registry manages LSP servers per (Lang, root).
pub struct Registry {
    servers: Mutex<HashMap<ServerKey, ManagedServer>>,
    open_docs: Mutex<HashMap<ServerKey, HashMap<String, OpenDoc>>>,
    clock: Arc<dyn Clock>,
    event_callback: Arc<dyn Fn(Lang, PathBuf, ServerEvent) + Send + Sync>,
    idle_timeout: Duration,
    pending_apply_edits: Arc<Mutex<HashMap<String, ServerKey>>>,
}

impl Registry {
    pub fn new<F>(clock: Arc<dyn Clock>, on_event: F) -> Self
    where
        F: Fn(Lang, PathBuf, ServerEvent) + Send + Sync + 'static,
    {
        let idle_timeout = std::env::var("PETAK_LSP_IDLE_SECS")
            .ok()
            .and_then(|s| s.parse::<u64>().ok())
            .map(Duration::from_secs)
            .unwrap_or(Duration::from_secs(600));

        Self {
            servers: Mutex::new(HashMap::new()),
            open_docs: Mutex::new(HashMap::new()),
            clock,
            event_callback: Arc::new(on_event),
            idle_timeout,
            pending_apply_edits: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Find the project root: nearest ancestor with the lang's marker (Kotlin: a
    /// settings.gradle(.kts) anywhere up wins over the nearest build.gradle(.kts)),
    /// else `workspace_root`, else the file's directory.
    pub fn find_root(file_path: &Path, lang: Lang, workspace_root: Option<&Path>) -> PathBuf {
        let start_dir = if file_path.is_file() || file_path.extension().is_some() {
            file_path.parent().unwrap_or(file_path)
        } else {
            file_path
        };

        let has_xcodeproj = |d: &Path| {
            std::fs::read_dir(d).map_or(false, |es| {
                es.filter_map(|e| e.ok())
                    .any(|e| e.path().extension().map_or(false, |x| x == "xcodeproj"))
            })
        };

        let passes: Vec<Box<dyn Fn(&Path) -> bool>> = match lang {
            Lang::Dart => vec![Box::new(|d: &Path| d.join("pubspec.yaml").exists())],
            Lang::Kotlin => vec![
                Box::new(|d: &Path| {
                    d.join("settings.gradle").exists() || d.join("settings.gradle.kts").exists()
                }),
                Box::new(|d: &Path| {
                    d.join("build.gradle").exists() || d.join("build.gradle.kts").exists()
                }),
            ],
            Lang::Swift => vec![Box::new(move |d: &Path| {
                d.join("Package.swift").exists() || has_xcodeproj(d)
            })],
        };

        for is_match in &passes {
            if let Some(d) = start_dir.ancestors().find(|d| is_match(d)) {
                return d.to_path_buf();
            }
        }

        workspace_root
            .unwrap_or(start_dir)
            .to_path_buf()
    }

    /// Ensure the server for `key` is running and alive.
    /// If the server has stopped, was killed by idle timeout, crashed, or not started yet:
    /// automatically wakes/spawns/restarts the server and re-sends textDocument/didOpen
    /// for all tracked open documents of that (Lang, root).
    /// Resets `last_activity` timestamp to now.
    fn ensure_alive<'a>(
        &self,
        servers: &'a mut HashMap<ServerKey, ManagedServer>,
        key: &ServerKey,
    ) -> Result<(&'a mut ManagedServer, bool), ServerError> {
        let needs_start = match servers.get(key) {
            Some(managed) => !managed.server.is_alive(),
            None => true,
        };

        if needs_start {
            if let Some(old) = servers.remove(key) {
                old.server.kill();
            }

            let fresh = self.start_server(key.lang, &key.root)?;
            let docs: Vec<OpenDoc> = {
                let open_guard = self.open_docs.lock().unwrap();
                open_guard
                    .get(key)
                    .map(|map| map.values().cloned().collect())
                    .unwrap_or_default()
            };

            for doc in docs {
                let _ = fresh
                    .server
                    .notify("textDocument/didOpen", &did_open_params(&doc));
            }

            servers.insert(key.clone(), fresh);
        }

        let managed = servers.get_mut(key).unwrap();
        managed.last_activity = self.clock.now();
        Ok((managed, needs_start))
    }

    /// Open a document — lazily starts or auto-wakes the server if needed.
    pub fn did_open(
        &self,
        file_path: &Path,
        lang: Lang,
        text: &str,
        workspace_root: Option<&Path>,
    ) -> Result<(), ServerError> {
        let root = Self::find_root(file_path, lang, workspace_root);
        let key = ServerKey {
            lang,
            root: root.clone(),
        };
        let uri = path_to_uri(file_path);
        let language_id = match lang {
            Lang::Dart => "dart",
            Lang::Kotlin => "kotlin",
            Lang::Swift => "swift",
        };

        let doc = OpenDoc {
            uri: uri.clone(),
            language_id: language_id.to_string(),
            version: 1,
            text: text.to_string(),
        };

        // Track in open_docs first
        {
            let mut open_guard = self.open_docs.lock().unwrap();
            let docs_for_key = open_guard.entry(key.clone()).or_default();
            docs_for_key.insert(uri.clone(), doc.clone());
        }

        let (server, started_fresh) = {
            let mut servers = self.servers.lock().unwrap();
            let (managed, started_fresh) = self.ensure_alive(&mut servers, &key)?;
            (Arc::clone(&managed.server), started_fresh)
        };

        if !started_fresh {
            server.notify("textDocument/didOpen", &did_open_params(&doc))?;
        }

        Ok(())
    }

    /// Notify didChange for a document with incremental or full content changes.
    /// Auto-wakes the server if dead or idle, registers document in open_docs,
    /// and forwards changes cleanly.
    pub fn did_change(
        &self,
        file_path: &Path,
        lang: Lang,
        version: i32,
        changes: &[Value],
        workspace_root: Option<&Path>,
    ) -> Result<(), ServerError> {
        let root = Self::find_root(file_path, lang, workspace_root);
        let key = ServerKey { lang, root };
        let uri = path_to_uri(file_path);

        let language_id = match lang {
            Lang::Dart => "dart",
            Lang::Kotlin => "kotlin",
            Lang::Swift => "swift",
        };

        // Ensure document is registered in open_docs
        {
            let mut open_guard = self.open_docs.lock().unwrap();
            let docs_for_key = open_guard.entry(key.clone()).or_default();
            if !docs_for_key.contains_key(&uri) {
                let initial_text = std::fs::read_to_string(file_path).unwrap_or_default();
                docs_for_key.insert(
                    uri.clone(),
                    OpenDoc {
                        uri: uri.clone(),
                        language_id: language_id.to_string(),
                        version: version.saturating_sub(1),
                        text: initial_text,
                    },
                );
            }
        }

        let server = {
            let mut servers = self.servers.lock().unwrap();
            let (managed, _) = self.ensure_alive(&mut servers, &key)?;
            managed.last_activity = self.clock.now();
            Arc::clone(&managed.server)
        };

        server.notify(
            "textDocument/didChange",
            &json!({
                "textDocument": { "uri": &uri, "version": version },
                "contentChanges": changes
            }),
        )?;

        // Update document state in open_docs
        {
            let mut open_guard = self.open_docs.lock().unwrap();
            if let Some(docs_for_key) = open_guard.get_mut(&key) {
                if let Some(doc) = docs_for_key.get_mut(&uri) {
                    doc.version = version;
                    for change in changes {
                        if let Some(text_val) = change.get("text").and_then(|t| t.as_str()) {
                            if let Some(range_val) = change.get("range") {
                                if let (Some(sl), Some(sc), Some(el), Some(ec)) = (
                                    range_val.get("start").and_then(|s| s.get("line")).and_then(|l| l.as_u64()),
                                    range_val.get("start").and_then(|s| s.get("character")).and_then(|c| c.as_u64()),
                                    range_val.get("end").and_then(|e| e.get("line")).and_then(|l| l.as_u64()),
                                    range_val.get("end").and_then(|e| e.get("character")).and_then(|c| c.as_u64()),
                                ) {
                                    if let (Some(start_byte), Some(end_byte)) = (
                                        pos::lsp_to_byte_offset(&doc.text, sl as u32, sc as u32),
                                        pos::lsp_to_byte_offset(&doc.text, el as u32, ec as u32),
                                    ) {
                                        if start_byte <= end_byte && end_byte <= doc.text.len() {
                                            doc.text.replace_range(start_byte..end_byte, text_val);
                                        }
                                    }
                                }
                            } else {
                                doc.text = text_val.to_string();
                            }
                        }
                    }
                }
            }
        }

        Ok(())
    }

    /// Notify didSave for a document. Auto-wakes server if idle or stopped.
    pub fn did_save(
        &self,
        file_path: &Path,
        lang: Lang,
        text: Option<&str>,
        workspace_root: Option<&Path>,
    ) -> Result<(), ServerError> {
        let root = Self::find_root(file_path, lang, workspace_root);
        let key = ServerKey { lang, root };
        let uri = path_to_uri(file_path);

        if let Some(t) = text {
            let mut open_guard = self.open_docs.lock().unwrap();
            if let Some(docs_for_key) = open_guard.get_mut(&key) {
                if let Some(doc) = docs_for_key.get_mut(&uri) {
                    doc.text = t.to_string();
                }
            }
        }

        let server = {
            let mut servers = self.servers.lock().unwrap();
            let (managed, _) = self.ensure_alive(&mut servers, &key)?;
            managed.last_activity = self.clock.now();
            Arc::clone(&managed.server)
        };
        let mut params = json!({
            "textDocument": { "uri": &uri }
        });
        if let Some(t) = text {
            params["text"] = json!(t);
        }
        server.notify("textDocument/didSave", &params)?;
        Ok(())
    }

    /// Close a document.
    pub fn did_close(
        &self,
        file_path: &Path,
        lang: Lang,
        workspace_root: Option<&Path>,
    ) -> Result<(), ServerError> {
        let root = Self::find_root(file_path, lang, workspace_root);
        let key = ServerKey { lang, root };
        let uri = path_to_uri(file_path);

        {
            let mut open_guard = self.open_docs.lock().unwrap();
            if let Some(docs_for_key) = open_guard.get_mut(&key) {
                docs_for_key.remove(&uri);
            }
        }

        let server_opt = {
            let mut servers = self.servers.lock().unwrap();
            if let Some(managed) = servers.get_mut(&key) {
                managed.last_activity = self.clock.now();
                if managed.server.is_alive() {
                    Some(Arc::clone(&managed.server))
                } else {
                    None
                }
            } else {
                None
            }
        };
        if let Some(server) = server_opt {
            let _ = server.notify(
                "textDocument/didClose",
                &json!({ "textDocument": { "uri": &uri } }),
            );
        }
        Ok(())
    }

    /// Send an LSP request to the server for a given file.
    /// Automatically wakes the server if it has stopped or was killed by idle timeout.
    pub fn request(
        &self,
        file_path: &Path,
        lang: Lang,
        method: &str,
        params: &Value,
        workspace_root: Option<&Path>,
    ) -> Result<Value, ServerError> {
        let root = Self::find_root(file_path, lang, workspace_root);
        let key = ServerKey { lang, root };

        let server = {
            let mut servers = self.servers.lock().unwrap();
            let (managed, _) = self.ensure_alive(&mut servers, &key)?;
            managed.last_activity = self.clock.now();
            managed.server.clone()
        };

        let res = server.request(method, params);
        if let Err(ServerError::ServerDied) = res {
            let server = {
                let mut servers = self.servers.lock().unwrap();
                let (managed, _) = self.ensure_alive(&mut servers, &key)?;
                managed.last_activity = self.clock.now();
                managed.server.clone()
            };
            server.request(method, params)
        } else {
            res
        }
    }

    /// Respond to a server-initiated request (e.g. workspace/applyEdit).
    pub fn respond_to_server(
        &self,
        lang: Lang,
        root: &Path,
        id: &Value,
        result: &Value,
    ) -> Result<(), ServerError> {
        let key = ServerKey {
            lang,
            root: root.to_path_buf(),
        };
        let server = {
            let servers = self.servers.lock().unwrap();
            if let Some(managed) = servers.get(&key) {
                Arc::clone(&managed.server)
            } else {
                return Err(ServerError::ServerDied);
            }
        };
        server.respond(id, result)
    }

    /// Respond to a server-initiated applyEdit request.
    pub fn respond_apply_edit(&self, id: &Value, applied: bool) -> Result<(), ServerError> {
        let result = json!({ "applied": applied });
        let key_opt = self.pending_apply_edits.lock().unwrap().remove(&id.to_string());
        let (server_for_key, fallback_servers) = {
            let servers = self.servers.lock().unwrap();
            let matched = key_opt.as_ref().and_then(|key| servers.get(key)).map(|m| Arc::clone(&m.server));
            if matched.is_some() {
                (matched, Vec::new())
            } else {
                let fallbacks = servers
                    .values()
                    .filter(|m| m.server.is_alive())
                    .map(|m| Arc::clone(&m.server))
                    .collect::<Vec<_>>();
                (None, fallbacks)
            }
        };

        if let Some(server) = server_for_key {
            return server.respond(id, &result);
        }

        let mut sent = false;
        for server in fallback_servers {
            let _ = server.respond(id, &result);
            sent = true;
        }
        if sent {
            Ok(())
        } else {
            Err(ServerError::ServerDied)
        }
    }

    /// Called periodically by the app. Kills servers idle for > 10 minutes.
    pub fn tick(&self) {
        let now = self.clock.now();
        let mut servers = self.servers.lock().unwrap();
        let mut to_remove = Vec::new();

        for (key, managed) in servers.iter() {
            if now.duration_since(managed.last_activity) >= self.idle_timeout {
                to_remove.push(key.clone());
            }
        }

        for key in to_remove {
            if let Some(managed) = servers.remove(&key) {
                managed.server.kill();
                (self.event_callback)(
                    key.lang,
                    key.root,
                    ServerEvent::Status {
                        state: "stopped".into(),
                        reason: None,
                    },
                );
            }
        }
    }

    /// Shutdown all servers.
    pub fn shutdown_all(&self) {
        let mut servers = self.servers.lock().unwrap();
        for (key, managed) in servers.drain() {
            managed.server.kill();
            (self.event_callback)(
                key.lang,
                key.root,
                ServerEvent::Status {
                    state: "stopped".into(),
                    reason: None,
                },
            );
        }
        self.open_docs.lock().unwrap().clear();
    }

    /// Restart running servers for a specific language, or all running servers if `lang` is None.
    /// Preserves open documents and re-sends textDocument/didOpen to the new servers.
    pub fn restart(&self, lang: Option<Lang>) -> Result<(), ServerError> {
        let target_keys: Vec<ServerKey> = {
            let servers = self.servers.lock().unwrap();
            let open_guard = self.open_docs.lock().unwrap();
            let mut keys: std::collections::HashSet<ServerKey> = servers
                .keys()
                .filter(|k| lang.map_or(true, |l| k.lang == l))
                .cloned()
                .collect();
            for (k, docs) in open_guard.iter() {
                if !docs.is_empty() && lang.map_or(true, |l| k.lang == l) {
                    keys.insert(k.clone());
                }
            }
            keys.into_iter().collect()
        };

        for key in target_keys {
            let old_opt = {
                let mut servers = self.servers.lock().unwrap();
                servers.remove(&key)
            };

            if let Some(old) = old_opt {
                old.server.kill();
                (self.event_callback)(
                    key.lang,
                    key.root.clone(),
                    ServerEvent::Status {
                        state: "stopped".into(),
                        reason: None,
                    },
                );
            }

            let docs: Vec<OpenDoc> = {
                let open_guard = self.open_docs.lock().unwrap();
                open_guard
                    .get(&key)
                    .map(|map| map.values().cloned().collect())
                    .unwrap_or_default()
            };

            match self.start_server(key.lang, &key.root) {
                Ok(fresh) => {
                    for doc in docs {
                        let _ = fresh
                            .server
                            .notify("textDocument/didOpen", &did_open_params(&doc));
                    }
                    let mut servers = self.servers.lock().unwrap();
                    servers.insert(key, fresh);
                }
                Err(e) => {
                    (self.event_callback)(
                        key.lang,
                        key.root,
                        ServerEvent::Status {
                            state: "crashed".into(),
                            reason: Some(format!("failed to restart: {}", e)),
                        },
                    );
                }
            }
        }

        Ok(())
    }

    /// How many servers are currently running.
    pub fn server_count(&self) -> usize {
        self.servers.lock().unwrap().len()
    }

    /// Count tracked open documents, optionally filtered by language.
    pub fn open_docs_count(&self, lang: Option<Lang>) -> usize {
        let open_guard = self.open_docs.lock().unwrap();
        open_guard
            .iter()
            .filter(|(k, _)| lang.map_or(true, |l| k.lang == l))
            .map(|(_, docs)| docs.len())
            .sum()
    }

    fn start_server(&self, lang: Lang, root: &Path) -> Result<ManagedServer, ServerError> {
        let root_buf = root.to_path_buf();
        let (initial_state, initial_reason) = if lang == Lang::Kotlin {
            ("indexing".to_string(), Some("Indexing project (Gradle import, bisa beberapa menit)…".to_string()))
        } else {
            ("starting".to_string(), None)
        };

        (self.event_callback)(
            lang,
            root_buf.clone(),
            ServerEvent::Status {
                state: initial_state,
                reason: initial_reason,
            },
        );

        let (cmd, args) = lang.command_for_root(Some(root));
        let root_uri = path_to_uri(root);
        let mut config = ServerConfig::new(cmd, args, root_uri);

        if lang == Lang::Kotlin {
            config.init_timeout = Some(std::time::Duration::from_secs(180));
            config.stderr_log_path = Some(crate::toolchain::kotlin_ls_log_path());
            if let Some(jdk_dir) = crate::toolchain::resolve_jdk_home() {
                config.env.push(("JAVA_HOME".to_string(), jdk_dir.to_string_lossy().to_string()));
                let jdk_bin = jdk_dir.join("bin");
                let current_path = std::env::var("PATH").unwrap_or_default();
                let new_path = format!("{}:{}", jdk_bin.display(), current_path);
                config.env.push(("PATH".to_string(), new_path));
            }
        }

        let cb = Arc::clone(&self.event_callback);
        let root_clone = root_buf.clone();
        let pending_edits = Arc::clone(&self.pending_apply_edits);
        let server = match Server::start(&config, move |event| {
            if let ServerEvent::ApplyEdit { ref id, .. } = event {
                pending_edits.lock().unwrap().insert(
                    id.to_string(),
                    ServerKey {
                        lang,
                        root: root_clone.clone(),
                    },
                );
            }
            cb(lang, root_clone.clone(), event);
        }) {
            Ok(s) => s,
            Err(e) => {
                let reason = match &e {
                    ServerError::Io(_) => match lang {
                        Lang::Dart => "dart not found — set Flutter SDK in Settings".to_string(),
                        Lang::Kotlin => {
                            "Kotlin Language Server belum terpasang. Klik 'Install Kotlin Language Server' di panel Toolchains."
                                .to_string()
                        }
                        Lang::Swift => {
                            "sourcekit-lsp not found — check Xcode / Command Line Tools".to_string()
                        }
                    },
                    ServerError::Timeout => format!("{} initialize timed out", lang.as_str()),
                    ServerError::ServerDied => {
                        format!("{} server died during startup", lang.as_str())
                    }
                    ServerError::ResponseError { code, message } => {
                        format!("{} initialize error {}: {}", lang.as_str(), code, message)
                    }
                };
                (self.event_callback)(
                    lang,
                    root_buf,
                    ServerEvent::Status {
                        state: "failed".into(),
                        reason: Some(reason),
                    },
                );
                return Err(e);
            }
        };

        (self.event_callback)(
            lang,
            root_buf,
            ServerEvent::Status {
                state: "ready".into(),
                reason: None,
            },
        );

        Ok(ManagedServer {
            server: Arc::new(server),
            last_activity: self.clock.now(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_uri_roundtrip() {
        let p = PathBuf::from("/Users/developer/My Projects/main.dart");
        let uri = path_to_uri(&p);
        assert_eq!(uri, "file:///Users/developer/My%20Projects/main.dart");
        let back = uri_to_path(&uri).unwrap();
        assert_eq!(back, p);
    }

    #[test]
    fn test_find_root_dart() {
        let tmp = tempfile::tempdir().unwrap();
        let pubspec = tmp.path().join("pubspec.yaml");
        std::fs::write(&pubspec, "name: foo").unwrap();
        let file = tmp.path().join("lib").join("src").join("main.dart");
        std::fs::create_dir_all(file.parent().unwrap()).unwrap();
        std::fs::write(&file, "").unwrap();

        let ws = tmp.path().parent().unwrap();
        let root = Registry::find_root(&file, Lang::Dart, Some(ws));
        assert_eq!(root, tmp.path());
    }

    #[test]
    fn test_find_root_kotlin_settings_wins_over_build_gradle() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(tmp.path().join("settings.gradle.kts"), "").unwrap();
        let app = tmp.path().join("app");
        std::fs::create_dir_all(&app).unwrap();
        std::fs::write(app.join("build.gradle.kts"), "").unwrap();
        let file = app.join("src").join("main").join("MainActivity.kt");
        std::fs::create_dir_all(file.parent().unwrap()).unwrap();
        std::fs::write(&file, "").unwrap();

        let root = Registry::find_root(&file, Lang::Kotlin, None);
        assert_eq!(root, tmp.path());
    }

    #[test]
    fn test_find_root_kotlin_build_gradle_fallback() {
        let tmp = tempfile::tempdir().unwrap();
        let app = tmp.path().join("app");
        std::fs::create_dir_all(&app).unwrap();
        std::fs::write(app.join("build.gradle"), "").unwrap();
        let file = app.join("src").join("main").join("MainActivity.kt");
        std::fs::create_dir_all(file.parent().unwrap()).unwrap();
        std::fs::write(&file, "").unwrap();

        let root = Registry::find_root(&file, Lang::Kotlin, None);
        assert_eq!(root, app);
    }

    #[test]
    fn test_find_root_swift_package() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(tmp.path().join("Package.swift"), "").unwrap();
        let file = tmp.path().join("Sources").join("MyLib").join("Lib.swift");
        std::fs::create_dir_all(file.parent().unwrap()).unwrap();
        std::fs::write(&file, "").unwrap();

        let root = Registry::find_root(&file, Lang::Swift, None);
        assert_eq!(root, tmp.path());
    }

    #[test]
    fn test_find_root_swift_xcodeproj() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(tmp.path().join("App.xcodeproj")).unwrap();
        let file = tmp.path().join("App").join("AppDelegate.swift");
        std::fs::create_dir_all(file.parent().unwrap()).unwrap();
        std::fs::write(&file, "").unwrap();

        let root = Registry::find_root(&file, Lang::Swift, None);
        assert_eq!(root, tmp.path());
    }

    #[test]
    fn test_find_root_fallback_workspace_and_parent() {
        let tmp = tempfile::tempdir().unwrap();
        let ws = tmp.path().join("workspace");
        let file = ws.join("subdir").join("scratch.dart");
        std::fs::create_dir_all(file.parent().unwrap()).unwrap();
        std::fs::write(&file, "").unwrap();

        // Fallback to workspace_root
        let root = Registry::find_root(&file, Lang::Dart, Some(&ws));
        assert_eq!(root, ws);

        // Fallback to file parent
        let root2 = Registry::find_root(&file, Lang::Dart, None);
        assert_eq!(root2, file.parent().unwrap());
    }

    #[test]
    fn test_registry_restart_empty() {
        let registry = Registry::new(Arc::new(WallClock), |_lang, _root, _event| {});
        assert!(registry.restart(None).is_ok());
        assert!(registry.restart(Some(Lang::Kotlin)).is_ok());
        assert!(registry.restart(Some(Lang::Dart)).is_ok());
        assert_eq!(registry.server_count(), 0);
    }
}
