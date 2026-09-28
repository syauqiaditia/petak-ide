// Registry: map (Lang, root) → Server. Lazy start on didOpen, idle kill after 10 min,
// crash restart with re-didOpen of open documents.

use super::server::{Server, ServerConfig, ServerError, ServerEvent};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

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
        match self {
            Lang::Dart => ("dart".into(), vec!["language-server".into(), "--protocol=lsp".into()]),
            Lang::Kotlin => ("kotlin-language-server".into(), vec![]),
            Lang::Swift => ("xcrun".into(), vec!["sourcekit-lsp".into()]),
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
        if let Ok(val) = std::env::var(self.env_override_key()) {
            let parts: Vec<&str> = val.split_whitespace().collect();
            if parts.is_empty() {
                return self.default_command();
            }
            let cmd = parts[0].to_string();
            let args = parts[1..].iter().map(|s| s.to_string()).collect();
            return (cmd, args);
        }
        self.default_command()
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

/// State for one managed server.
struct ManagedServer {
    server: Server,
    last_activity: Instant,
    open_docs: HashMap<String, OpenDoc>, // uri -> doc
}

/// Registry manages LSP servers per (Lang, root).
pub struct Registry {
    servers: Mutex<HashMap<ServerKey, ManagedServer>>,
    clock: Arc<dyn Clock>,
    event_callback: Arc<dyn Fn(Lang, ServerEvent) + Send + Sync>,
    idle_timeout: Duration,
}

impl Registry {
    pub fn new<F>(clock: Arc<dyn Clock>, on_event: F) -> Self
    where
        F: Fn(Lang, ServerEvent) + Send + Sync + 'static,
    {
        Self {
            servers: Mutex::new(HashMap::new()),
            clock,
            event_callback: Arc::new(on_event),
            idle_timeout: Duration::from_secs(600), // 10 minutes
        }
    }

    /// Find the project root for a given file path and language.
    pub fn find_root(file_path: &Path, lang: Lang) -> PathBuf {
        let mut dir = if file_path.is_file() {
            file_path.parent().map(|p| p.to_path_buf())
        } else {
            Some(file_path.to_path_buf())
        };

        while let Some(d) = dir {
            let found = match lang {
                Lang::Dart => d.join("pubspec.yaml").exists(),
                Lang::Kotlin => {
                    d.join("settings.gradle").exists()
                        || d.join("settings.gradle.kts").exists()
                        || d.join("build.gradle").exists()
                        || d.join("build.gradle.kts").exists()
                }
                Lang::Swift => {
                    d.join("Package.swift").exists()
                        || std::fs::read_dir(&d)
                            .map(|entries| {
                                entries
                                    .filter_map(|e| e.ok())
                                    .any(|e| {
                                        e.path()
                                            .extension()
                                            .map(|ext| ext == "xcodeproj")
                                            .unwrap_or(false)
                                    })
                            })
                            .unwrap_or(false)
                }
            };
            if found {
                return d;
            }
            dir = d.parent().map(|p| p.to_path_buf());
        }

        // Fallback: use file's directory
        file_path
            .parent()
            .unwrap_or(file_path)
            .to_path_buf()
    }

    /// Open a document — lazily starts the server if needed.
    pub fn did_open(
        &self,
        file_path: &Path,
        lang: Lang,
        text: &str,
        workspace_root: Option<&Path>,
    ) -> Result<(), ServerError> {
        let root = workspace_root
            .map(|p| p.to_path_buf())
            .unwrap_or_else(|| Self::find_root(file_path, lang));
        let key = ServerKey {
            lang,
            root: root.clone(),
        };
        let uri = format!("file://{}", file_path.display());
        let language_id = match lang {
            Lang::Dart => "dart",
            Lang::Kotlin => "kotlin",
            Lang::Swift => "swift",
        };

        let mut servers = self.servers.lock().unwrap();

        // Ensure server is running
        if !servers.contains_key(&key) || !servers.get(&key).unwrap().server.is_alive() {
            // Start or restart
            servers.remove(&key);
            let managed = self.start_server(lang, &root)?;
            servers.insert(key.clone(), managed);
        }

        let managed = servers.get_mut(&key).unwrap();
        managed.last_activity = self.clock.now();

        // Send didOpen
        managed.server.notify(
            "textDocument/didOpen",
            &json!({
                "textDocument": {
                    "uri": uri,
                    "languageId": language_id,
                    "version": 1,
                    "text": text,
                }
            }),
        )?;

        // Track open doc for crash recovery
        managed.open_docs.insert(
            uri.clone(),
            OpenDoc {
                uri,
                language_id: language_id.to_string(),
                version: 1,
                text: text.to_string(),
            },
        );

        Ok(())
    }

    /// Notify didChange for a document.
    pub fn did_change(
        &self,
        file_path: &Path,
        lang: Lang,
        version: i32,
        text: &str,
        workspace_root: Option<&Path>,
    ) -> Result<(), ServerError> {
        let root = workspace_root
            .map(|p| p.to_path_buf())
            .unwrap_or_else(|| Self::find_root(file_path, lang));
        let key = ServerKey { lang, root };
        let uri = format!("file://{}", file_path.display());

        let mut servers = self.servers.lock().unwrap();
        if let Some(managed) = servers.get_mut(&key) {
            managed.last_activity = self.clock.now();
            managed.server.notify(
                "textDocument/didChange",
                &json!({
                    "textDocument": { "uri": &uri, "version": version },
                    "contentChanges": [{ "text": text }]
                }),
            )?;
            // Update tracked text
            if let Some(doc) = managed.open_docs.get_mut(&uri) {
                doc.version = version;
                doc.text = text.to_string();
            }
        }
        Ok(())
    }

    /// Close a document.
    pub fn did_close(&self, file_path: &Path, lang: Lang, workspace_root: Option<&Path>) -> Result<(), ServerError> {
        let root = workspace_root
            .map(|p| p.to_path_buf())
            .unwrap_or_else(|| Self::find_root(file_path, lang));
        let key = ServerKey { lang, root };
        let uri = format!("file://{}", file_path.display());

        let mut servers = self.servers.lock().unwrap();
        if let Some(managed) = servers.get_mut(&key) {
            managed.last_activity = self.clock.now();
            let _ = managed.server.notify(
                "textDocument/didClose",
                &json!({ "textDocument": { "uri": &uri } }),
            );
            managed.open_docs.remove(&uri);
        }
        Ok(())
    }

    /// Send an LSP request to the server for a given file.
    pub fn request(
        &self,
        file_path: &Path,
        lang: Lang,
        method: &str,
        params: &Value,
        workspace_root: Option<&Path>,
    ) -> Result<Value, ServerError> {
        let root = workspace_root
            .map(|p| p.to_path_buf())
            .unwrap_or_else(|| Self::find_root(file_path, lang));
        let key = ServerKey { lang, root: root.clone() };

        let mut servers = self.servers.lock().unwrap();

        // Auto-restart on crash
        if let Some(managed) = servers.get(&key) {
            if !managed.server.is_alive() {
                // Server crashed — restart and re-open docs
                let docs: Vec<OpenDoc> = managed.open_docs.values().cloned().collect();
                servers.remove(&key);
                let mut new_managed = self.start_server(lang, &root)?;
                // Re-open documents
                for doc in &docs {
                    let _ = new_managed.server.notify(
                        "textDocument/didOpen",
                        &json!({
                            "textDocument": {
                                "uri": &doc.uri,
                                "languageId": &doc.language_id,
                                "version": doc.version,
                                "text": &doc.text,
                            }
                        }),
                    );
                    new_managed.open_docs.insert(doc.uri.clone(), doc.clone());
                }
                servers.insert(key.clone(), new_managed);
            }
        }

        if let Some(managed) = servers.get_mut(&key) {
            managed.last_activity = self.clock.now();
            managed.server.request(method, params)
        } else {
            Err(ServerError::ServerDied)
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
        let servers = self.servers.lock().unwrap();
        if let Some(managed) = servers.get(&key) {
            managed.server.respond(id, result)
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
            }
        }
    }

    /// Shutdown all servers.
    pub fn shutdown_all(&self) {
        let mut servers = self.servers.lock().unwrap();
        for (_, managed) in servers.drain() {
            managed.server.kill();
        }
    }

    /// How many servers are currently running.
    pub fn server_count(&self) -> usize {
        self.servers.lock().unwrap().len()
    }

    fn start_server(&self, lang: Lang, root: &Path) -> Result<ManagedServer, ServerError> {
        let (cmd, args) = lang.command();
        let root_uri = format!("file://{}", root.display());
        let config = ServerConfig {
            command: cmd,
            args,
            root_uri,
        };

        let cb = Arc::clone(&self.event_callback);
        let server = Server::start(&config, move |event| {
            cb(lang, event);
        })?;

        Ok(ManagedServer {
            server,
            last_activity: self.clock.now(),
            open_docs: HashMap::new(),
        })
    }
}
