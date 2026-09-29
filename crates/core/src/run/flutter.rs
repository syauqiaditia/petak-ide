use std::collections::HashMap;
use std::io;
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::Sender;
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant};

use regex::Regex;
use serde::{Deserialize, Serialize};

use crate::exec::{Proc, ProcLine, Spawn};
use crate::run::config::RunConfig;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum RunEvent {
    #[serde(rename_all = "camelCase")]
    State { state: AppState },
    #[serde(rename_all = "camelCase")]
    Output { stream: OutputStream, line: String },
    #[serde(rename_all = "camelCase")]
    AppStarted {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        app_id: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        devtools_uri: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        vm_service_uri: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pid: Option<u32>,
    },
    #[serde(rename_all = "camelCase")]
    Progress {
        id: String,
        message: String,
        finished: bool,
    },
    #[serde(rename_all = "camelCase")]
    Reloaded {
        full_restart: bool,
        ok: bool,
        ms: u64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        message: Option<String>,
    },
    #[serde(rename_all = "camelCase")]
    BuildError {
        file: String,
        line: u32,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        col: Option<u32>,
        message: String,
    },
    #[serde(rename_all = "camelCase")]
    Stopped {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        code: Option<i32>,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AppState {
    Building,
    Installing,
    Running,
    Reloading,
    Stopped,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum OutputStream {
    Stdout,
    Stderr,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildError {
    pub file: String,
    pub line: u32,
    pub col: Option<u32>,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReloadResult {
    pub full_restart: bool,
    pub ok: bool,
    pub ms: u64,
    pub message: Option<String>,
}

#[derive(Debug)]
pub enum FlutterRunError {
    Io(io::Error),
    InvalidDeviceId(String),
    InvalidTarget(String),
    InvalidFlavor(String),
    AppNotStarted,
    ProcessTerminated,
    Timeout(String),
    CommandFailed(String),
}

impl std::fmt::Display for FlutterRunError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Io(e) => write!(f, "I/O error: {}", e),
            Self::InvalidDeviceId(msg) => write!(f, "Invalid device ID: {}", msg),
            Self::InvalidTarget(msg) => write!(f, "Invalid target path: {}", msg),
            Self::InvalidFlavor(msg) => write!(f, "Invalid flavor: {}", msg),
            Self::AppNotStarted => write!(f, "Flutter app is not started yet (no appId)"),
            Self::ProcessTerminated => write!(f, "Flutter process has terminated"),
            Self::Timeout(msg) => write!(f, "Operation timed out: {}", msg),
            Self::CommandFailed(msg) => write!(f, "Command failed: {}", msg),
        }
    }
}

impl std::error::Error for FlutterRunError {}

impl From<io::Error> for FlutterRunError {
    fn from(e: io::Error) -> Self {
        Self::Io(e)
    }
}

static DART_ERROR_RE: OnceLock<Regex> = OnceLock::new();
static KOTLIN_ERROR_RE: OnceLock<Regex> = OnceLock::new();
static DEVTOOLS_URL_RE: OnceLock<Regex> = OnceLock::new();

fn dart_error_re() -> &'static Regex {
    DART_ERROR_RE.get_or_init(|| Regex::new(r"^(.+\.dart):(\d+):(\d+):\s*Error:\s*(.*)$").unwrap())
}

fn kotlin_error_re() -> &'static Regex {
    KOTLIN_ERROR_RE
        .get_or_init(|| Regex::new(r"^e:\s*(?:file://)?(.+\.kt):(\d+):(\d+)\s*(.*)$").unwrap())
}

fn devtools_url_re() -> &'static Regex {
    DEVTOOLS_URL_RE
        .get_or_init(|| Regex::new(r"https?://(?:127\.0\.0\.1|localhost):\d+[^\s]*").unwrap())
}

/// Parse Dart or Kotlin build errors from a compiler output line.
pub fn parse_build_error(line: &str) -> Option<BuildError> {
    let trimmed = line.trim();
    if let Some(caps) = dart_error_re().captures(trimmed) {
        let file = caps[1].to_string();
        let line = caps[2].parse::<u32>().ok()?;
        let col = caps[3].parse::<u32>().ok();
        let message = caps[4].to_string();
        return Some(BuildError {
            file,
            line,
            col,
            message,
        });
    }

    if let Some(caps) = kotlin_error_re().captures(trimmed) {
        let file = caps[1].to_string();
        let line = caps[2].parse::<u32>().ok()?;
        let col = caps[3].parse::<u32>().ok();
        let message = caps[4].to_string();
        return Some(BuildError {
            file,
            line,
            col,
            message,
        });
    }

    None
}

/// Extract DevTools URL from a text message or log line.
pub fn extract_devtools_url(text: &str) -> Option<String> {
    if text.contains("DevTools") || text.contains("devtools") || text.contains("?uri=") {
        if let Some(m) = devtools_url_re().find(text) {
            return Some(m.as_str().to_string());
        }
    }
    None
}

#[derive(Debug, Clone, PartialEq)]
pub enum FlutterDaemonMessage {
    Event {
        event: String,
        params: serde_json::Value,
    },
    Response {
        id: u64,
        result: Option<serde_json::Value>,
        error: Option<serde_json::Value>,
    },
    NonJson(String),
}

/// Parse a single stdout line from `flutter run --machine`.
pub fn parse_flutter_daemon_line(line: &str) -> FlutterDaemonMessage {
    let trimmed = line.trim();
    if trimmed.starts_with('[') && trimmed.ends_with(']') {
        if let Ok(vec) = serde_json::from_str::<Vec<serde_json::Value>>(trimmed) {
            if let Some(first) = vec.into_iter().next() {
                if let Some(event) = first.get("event").and_then(|v| v.as_str()) {
                    let params = first
                        .get("params")
                        .cloned()
                        .unwrap_or(serde_json::Value::Null);
                    return FlutterDaemonMessage::Event {
                        event: event.to_string(),
                        params,
                    };
                }
                if let Some(id) = first.get("id").and_then(|v| v.as_u64()) {
                    let result = first.get("result").cloned();
                    let error = first.get("error").cloned();
                    return FlutterDaemonMessage::Response { id, result, error };
                }
            }
        }
    }
    FlutterDaemonMessage::NonJson(line.to_string())
}

struct SharedState {
    app_id: Mutex<Option<String>>,
    vm_service_uri: Mutex<Option<String>>,
    devtools_uri: Mutex<Option<String>>,
    pid: Mutex<Option<u32>>,
    is_running: AtomicBool,
    current_state: Mutex<AppState>,
    pending_reloads: Mutex<HashMap<u64, (bool, Instant, Sender<ReloadResult>)>>,
    pending_stops: Mutex<HashMap<u64, Sender<()>>>,
    exit_notifiers: Mutex<Vec<Sender<Option<i32>>>>,
}

pub struct FlutterRun {
    proc: Arc<Mutex<Box<dyn Proc>>>,
    shared: Arc<SharedState>,
    next_id: Arc<AtomicU64>,
    spawn_duration: Duration,
    tx: Sender<RunEvent>,
}

fn update_state(shared: &SharedState, tx: &Sender<RunEvent>, state: AppState) {
    let mut guard = shared.current_state.lock().unwrap();
    if *guard != state {
        *guard = state;
        let _ = tx.send(RunEvent::State { state });
    }
}

fn emit_app_started(shared: &SharedState, tx: &Sender<RunEvent>) {
    let aid = shared.app_id.lock().unwrap().clone();
    let dt = shared.devtools_uri.lock().unwrap().clone();
    let vms = shared.vm_service_uri.lock().unwrap().clone();
    let pid = *shared.pid.lock().unwrap();

    let _ = tx.send(RunEvent::AppStarted {
        app_id: aid,
        devtools_uri: dt,
        vm_service_uri: vms,
        pid,
    });
}

fn check_auxiliary(shared: &SharedState, tx: &Sender<RunEvent>, text: &str) {
    if let Some(dt_url) = extract_devtools_url(text) {
        let mut guard = shared.devtools_uri.lock().unwrap();
        if guard.as_deref() != Some(&dt_url) {
            *guard = Some(dt_url);
            drop(guard);
            emit_app_started(shared, tx);
        }
    }

    for line in text.lines() {
        if let Some(err) = parse_build_error(line) {
            let _ = tx.send(RunEvent::BuildError {
                file: err.file,
                line: err.line,
                col: err.col,
                message: err.message,
            });
        }
    }
}

impl FlutterRun {
    /// Start a Flutter app session via `flutter run --machine`.
    pub fn start(
        spawn: &dyn Spawn,
        root: &Path,
        cfg: &RunConfig,
        device_id: &str,
        tx: Sender<RunEvent>,
    ) -> Result<Self, FlutterRunError> {
        // 1. Validate device_id
        if !crate::run::device::is_valid_device_id(device_id) {
            return Err(FlutterRunError::InvalidDeviceId(format!(
                "Invalid device ID: '{}'",
                device_id
            )));
        }

        // 2. Validate flavor
        if let Some(ref flavor) = cfg.flavor {
            if !crate::run::config::is_valid_flavor(flavor) {
                return Err(FlutterRunError::InvalidFlavor(format!(
                    "Invalid flavor: '{}'",
                    flavor
                )));
            }
        }

        // 3. Validate target
        if let Some(ref target) = cfg.target {
            crate::run::config::validate_target(root, target)
                .map_err(|e| FlutterRunError::InvalidTarget(e.to_string()))?;
        }

        // 4. Build command arguments
        let mut args: Vec<String> = vec![
            "run".to_string(),
            "-d".to_string(),
            device_id.to_string(),
            "--machine".to_string(),
        ];
        if let Some(ref target) = cfg.target {
            args.push("-t".to_string());
            args.push(target.clone());
        }
        if let Some(ref flavor) = cfg.flavor {
            args.push("--flavor".to_string());
            args.push(flavor.clone());
        }
        for def in &cfg.dart_defines {
            args.push("--dart-define".to_string());
            args.push(def.clone());
        }

        let args_ref: Vec<&str> = args.iter().map(|s| s.as_str()).collect();

        // 5. Measure spawn time (< 200 ms budget)
        let t0 = Instant::now();
        let (proc_tx, proc_rx) = std::sync::mpsc::channel();
        let proc = spawn.spawn(root, "flutter", &args_ref, &[], proc_tx)?;
        let spawn_duration = t0.elapsed();

        let pid = proc.pid();
        let proc = Arc::new(Mutex::new(proc));

        let shared = Arc::new(SharedState {
            app_id: Mutex::new(None),
            vm_service_uri: Mutex::new(None),
            devtools_uri: Mutex::new(None),
            pid: Mutex::new(pid),
            is_running: AtomicBool::new(true),
            current_state: Mutex::new(AppState::Building),
            pending_reloads: Mutex::new(HashMap::new()),
            pending_stops: Mutex::new(HashMap::new()),
            exit_notifiers: Mutex::new(Vec::new()),
        });

        let _ = tx.send(RunEvent::State {
            state: AppState::Building,
        });

        let shared_worker = Arc::clone(&shared);
        let tx_worker = tx.clone();

        let record_path = std::env::var("PETAK_RECORD_DAEMON_FILE").ok();
        let mut record_file = record_path.and_then(|p| {
            if let Some(parent) = Path::new(&p).parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            std::fs::OpenOptions::new()
                .create(true)
                .write(true)
                .truncate(true)
                .open(&p)
                .ok()
        });

        thread::spawn(move || {
            while let Ok(line) = proc_rx.recv() {
                if let Some(ref mut f) = record_file {
                    use std::io::Write;
                    match &line {
                        ProcLine::Stdout(s) => {
                            let _ = writeln!(f, "{}", s);
                        }
                        ProcLine::Stderr(s) => {
                            let _ = writeln!(f, "[STDERR] {}", s);
                        }
                        ProcLine::Exit(c) => {
                            let _ = writeln!(f, "[EXIT] {:?}", c);
                        }
                    }
                }
                match line {
                    ProcLine::Stdout(text) => {
                        let msg = parse_flutter_daemon_line(&text);
                        match msg {
                            FlutterDaemonMessage::Event { event, params } => match event.as_str() {
                                "app.start" => {
                                    if let Some(id) = params.get("appId").and_then(|v| v.as_str()) {
                                        let mut aid = shared_worker.app_id.lock().unwrap();
                                        *aid = Some(id.to_string());
                                    }
                                    update_state(&shared_worker, &tx_worker, AppState::Building);
                                }
                                "app.started" => {
                                    if let Some(id) = params.get("appId").and_then(|v| v.as_str()) {
                                        let mut aid = shared_worker.app_id.lock().unwrap();
                                        *aid = Some(id.to_string());
                                    }
                                    update_state(&shared_worker, &tx_worker, AppState::Running);
                                    emit_app_started(&shared_worker, &tx_worker);
                                }
                                "app.debugPort" => {
                                    let ws_uri = params.get("wsUri").and_then(|v| v.as_str());
                                    if let Some(ws) = ws_uri {
                                        let mut vms = shared_worker.vm_service_uri.lock().unwrap();
                                        *vms = Some(ws.to_string());
                                    }
                                    emit_app_started(&shared_worker, &tx_worker);
                                }
                                "app.devTools" | "app.dtd" | "app.webDevToolsUrl" => {
                                    let dt = params
                                        .get("uri")
                                        .or_else(|| params.get("url"))
                                        .or_else(|| params.get("devToolsUrl"))
                                        .and_then(|v| v.as_str());
                                    if let Some(uri) = dt {
                                        let mut dtu = shared_worker.devtools_uri.lock().unwrap();
                                        *dtu = Some(uri.to_string());
                                    }
                                    emit_app_started(&shared_worker, &tx_worker);
                                }
                                "app.progress" => {
                                    let id = params
                                        .get("id")
                                        .and_then(|v| v.as_str())
                                        .unwrap_or("")
                                        .to_string();
                                    let message = params
                                        .get("message")
                                        .and_then(|v| v.as_str())
                                        .unwrap_or("")
                                        .to_string();
                                    let finished = params
                                        .get("finished")
                                        .and_then(|v| v.as_bool())
                                        .unwrap_or(false);

                                    let msg_lower = message.to_lowercase();
                                    if !finished
                                        && (msg_lower.contains("installing")
                                            || msg_lower.contains("built build/"))
                                    {
                                        update_state(
                                            &shared_worker,
                                            &tx_worker,
                                            AppState::Installing,
                                        );
                                    }

                                    let _ = tx_worker.send(RunEvent::Progress {
                                        id,
                                        message,
                                        finished,
                                    });
                                }
                                "app.log" => {
                                    let log = params
                                        .get("log")
                                        .and_then(|v| v.as_str())
                                        .unwrap_or("")
                                        .to_string();
                                    let _ = tx_worker.send(RunEvent::Output {
                                        stream: OutputStream::Stdout,
                                        line: log.clone(),
                                    });
                                    check_auxiliary(&shared_worker, &tx_worker, &log);
                                }
                                "daemon.logMessage" => {
                                    let message = params
                                        .get("message")
                                        .and_then(|v| v.as_str())
                                        .unwrap_or("")
                                        .to_string();
                                    let _ = tx_worker.send(RunEvent::Output {
                                        stream: OutputStream::Stdout,
                                        line: message.clone(),
                                    });
                                    check_auxiliary(&shared_worker, &tx_worker, &message);
                                }
                                "app.stop" => {
                                    update_state(&shared_worker, &tx_worker, AppState::Stopped);
                                }
                                _ => {}
                            },
                            FlutterDaemonMessage::Response { id, result, error } => {
                                let reload_entry = {
                                    let mut reloads = shared_worker.pending_reloads.lock().unwrap();
                                    reloads.remove(&id)
                                };
                                if let Some((full_restart, start_time, responder)) = reload_entry {
                                    let ms = start_time.elapsed().as_millis() as u64;
                                    let (ok, message) = if let Some(err) = error {
                                        let msg = err
                                            .get("message")
                                            .and_then(|m| m.as_str())
                                            .unwrap_or("reload error")
                                            .to_string();
                                        (false, Some(msg))
                                    } else if let Some(res) = result {
                                        let code =
                                            res.get("code").and_then(|c| c.as_i64()).unwrap_or(0);
                                        let msg = res
                                            .get("message")
                                            .and_then(|m| m.as_str())
                                            .map(|s| s.to_string());
                                        (code == 0, msg)
                                    } else {
                                        (true, None)
                                    };

                                    update_state(&shared_worker, &tx_worker, AppState::Running);
                                    let _ = tx_worker.send(RunEvent::Reloaded {
                                        full_restart,
                                        ok,
                                        ms,
                                        message: message.clone(),
                                    });
                                    let _ = responder.send(ReloadResult {
                                        full_restart,
                                        ok,
                                        ms,
                                        message,
                                    });
                                }

                                let stop_entry = {
                                    let mut stops = shared_worker.pending_stops.lock().unwrap();
                                    stops.remove(&id)
                                };
                                if let Some(responder) = stop_entry {
                                    let _ = responder.send(());
                                }
                            }
                            FlutterDaemonMessage::NonJson(raw) => {
                                let _ = tx_worker.send(RunEvent::Output {
                                    stream: OutputStream::Stdout,
                                    line: raw.clone(),
                                });
                                check_auxiliary(&shared_worker, &tx_worker, &raw);
                            }
                        }
                    }
                    ProcLine::Stderr(err_line) => {
                        let _ = tx_worker.send(RunEvent::Output {
                            stream: OutputStream::Stderr,
                            line: err_line.clone(),
                        });
                        check_auxiliary(&shared_worker, &tx_worker, &err_line);
                    }
                    ProcLine::Exit(code) => {
                        shared_worker.is_running.store(false, Ordering::SeqCst);
                        update_state(&shared_worker, &tx_worker, AppState::Stopped);
                        let _ = tx_worker.send(RunEvent::Stopped { code });

                        let notifiers = {
                            let mut guard = shared_worker.exit_notifiers.lock().unwrap();
                            std::mem::take(&mut *guard)
                        };
                        for notifier in notifiers {
                            let _ = notifier.send(code);
                        }
                        break;
                    }
                }
            }
        });

        Ok(Self {
            proc,
            shared,
            next_id: Arc::new(AtomicU64::new(1)),
            spawn_duration,
            tx,
        })
    }

    /// Trigger hot reload (`full == false`) or hot restart (`full == true`).
    pub fn reload(&mut self, full: bool) -> Result<ReloadResult, FlutterRunError> {
        if !self.shared.is_running.load(Ordering::SeqCst) {
            return Err(FlutterRunError::ProcessTerminated);
        }

        let app_id = {
            let aid = self.shared.app_id.lock().unwrap();
            aid.clone().ok_or(FlutterRunError::AppNotStarted)?
        };

        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let (resp_tx, resp_rx) = std::sync::mpsc::channel();

        let now = Instant::now();
        {
            let mut pending = self.shared.pending_reloads.lock().unwrap();
            pending.insert(id, (full, now, resp_tx));
        }

        update_state(&self.shared, &self.tx, AppState::Reloading);

        let cmd = format!(
            r#"[{{ "id": {}, "method": "app.restart", "params": {{ "appId": "{}", "fullRestart": {}, "pause": false }} }}]"#,
            id, app_id, full
        ) + "\n";

        {
            let mut proc = self.proc.lock().unwrap();
            proc.stdin_write(cmd.as_bytes())?;
        }

        match resp_rx.recv_timeout(Duration::from_secs(60)) {
            Ok(res) => Ok(res),
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                let mut pending = self.shared.pending_reloads.lock().unwrap();
                pending.remove(&id);
                Err(FlutterRunError::Timeout(format!(
                    "Timed out waiting for reload response (id: {})",
                    id
                )))
            }
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                Err(FlutterRunError::ProcessTerminated)
            }
        }
    }

    /// Stop the running Flutter app gracefully, killing it if it takes > 5s.
    pub fn stop(&mut self) -> Result<(), FlutterRunError> {
        if !self.shared.is_running.load(Ordering::SeqCst) {
            return Ok(());
        }

        let (exit_tx, exit_rx) = std::sync::mpsc::channel();
        {
            let mut notifiers = self.shared.exit_notifiers.lock().unwrap();
            notifiers.push(exit_tx);
        }

        if !self.shared.is_running.load(Ordering::SeqCst) {
            return Ok(());
        }

        let maybe_app_id = self.shared.app_id.lock().unwrap().clone();

        if let Some(app_id) = maybe_app_id {
            let id = self.next_id.fetch_add(1, Ordering::SeqCst);
            let cmd = format!(
                r#"[{{ "id": {}, "method": "app.stop", "params": {{ "appId": "{}" }} }}]"#,
                id, app_id
            ) + "\n";
            let _ = self.proc.lock().unwrap().stdin_write(cmd.as_bytes());
        } else {
            let _ = self.proc.lock().unwrap().kill();
        }

        match exit_rx.recv_timeout(Duration::from_secs(5)) {
            Ok(_) => Ok(()),
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                let mut proc = self.proc.lock().unwrap();
                proc.kill()?;
                let _ = exit_rx.recv_timeout(Duration::from_secs(3));
                Ok(())
            }
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => Ok(()),
        }
    }

    pub fn spawn_duration(&self) -> Duration {
        self.spawn_duration
    }

    pub fn pid(&self) -> Option<u32> {
        *self.shared.pid.lock().unwrap()
    }

    pub fn is_running(&self) -> bool {
        self.shared.is_running.load(Ordering::SeqCst)
    }

    pub fn app_id(&self) -> Option<String> {
        self.shared.app_id.lock().unwrap().clone()
    }
}

impl Drop for FlutterRun {
    fn drop(&mut self) {
        if self.shared.is_running.load(Ordering::SeqCst) {
            let _ = self.stop();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_flutter_daemon_line_event_app_start() {
        let line = r#"[{"event":"app.start","params":{"appId":"38988a03","deviceId":"emulator-5554","directory":"/path/to/app","supportsRestart":true}}]"#;
        let msg = parse_flutter_daemon_line(line);
        match msg {
            FlutterDaemonMessage::Event { event, params } => {
                assert_eq!(event, "app.start");
                assert_eq!(params["appId"], "38988a03");
                assert_eq!(params["deviceId"], "emulator-5554");
            }
            _ => panic!("Expected event, got {:?}", msg),
        }
    }

    #[test]
    fn test_parse_flutter_daemon_line_event_app_debug_port() {
        let line = r#"[{"event":"app.debugPort","params":{"appId":"38988a03","port":43211,"wsUri":"ws://127.0.0.1:43211/xyz=/ws"}}]"#;
        let msg = parse_flutter_daemon_line(line);
        match msg {
            FlutterDaemonMessage::Event { event, params } => {
                assert_eq!(event, "app.debugPort");
                assert_eq!(params["wsUri"], "ws://127.0.0.1:43211/xyz=/ws");
                assert_eq!(params["port"], 43211);
            }
            _ => panic!("Expected event, got {:?}", msg),
        }
    }

    #[test]
    fn test_parse_flutter_daemon_line_response_reload() {
        let line =
            r#"[{"id":1,"result":{"code":0,"message":"Reloaded 1 of 659 libraries in 321ms."}}]"#;
        let msg = parse_flutter_daemon_line(line);
        match msg {
            FlutterDaemonMessage::Response { id, result, error } => {
                assert_eq!(id, 1);
                assert!(error.is_none());
                let res = result.unwrap();
                assert_eq!(res["code"], 0);
                assert!(res["message"].as_str().unwrap().contains("321ms"));
            }
            _ => panic!("Expected response, got {:?}", msg),
        }
    }

    #[test]
    fn test_parse_flutter_daemon_line_response_stop() {
        let line = r#"[{"id":2,"result":true}]"#;
        let msg = parse_flutter_daemon_line(line);
        match msg {
            FlutterDaemonMessage::Response { id, result, error } => {
                assert_eq!(id, 2);
                assert!(error.is_none());
                assert_eq!(result.unwrap(), true);
            }
            _ => panic!("Expected response, got {:?}", msg),
        }
    }

    #[test]
    fn test_parse_build_error_dart() {
        let line = "lib/main.dart:42:15: Error: Expected ';' after this.";
        let err = parse_build_error(line).expect("Should parse dart error");
        assert_eq!(err.file, "lib/main.dart");
        assert_eq!(err.line, 42);
        assert_eq!(err.col, Some(15));
        assert_eq!(err.message, "Expected ';' after this.");
    }

    #[test]
    fn test_parse_build_error_kotlin() {
        let line1 =
            "e: file:///app/src/main/kotlin/MainActivity.kt:15:23 Unresolved reference: foo";
        let err1 = parse_build_error(line1).expect("Should parse kotlin file:// error");
        assert_eq!(err1.file, "/app/src/main/kotlin/MainActivity.kt");
        assert_eq!(err1.line, 15);
        assert_eq!(err1.col, Some(23));
        assert_eq!(err1.message, "Unresolved reference: foo");

        let line2 = "e: /app/src/main/kotlin/MainActivity.kt:20:10 Type mismatch";
        let err2 = parse_build_error(line2).expect("Should parse kotlin plain error");
        assert_eq!(err2.file, "/app/src/main/kotlin/MainActivity.kt");
        assert_eq!(err2.line, 20);
        assert_eq!(err2.col, Some(10));
        assert_eq!(err2.message, "Type mismatch");
    }

    #[test]
    fn test_extract_devtools_url() {
        let line = "The Flutter DevTools debugger and profiler on emulator-5554 is available at: http://127.0.0.1:9100?uri=http://127.0.0.1:43211/xyz=";
        let url = extract_devtools_url(line).expect("Should extract devtools url");
        assert_eq!(url, "http://127.0.0.1:9100?uri=http://127.0.0.1:43211/xyz=");

        let line2 = "Some random text without devtools url";
        assert!(extract_devtools_url(line2).is_none());
    }

    #[test]
    fn test_validation_rejects_bad_args() {
        use tempfile::tempdir;
        let dir = tempdir().unwrap();
        let (tx, _rx) = std::sync::mpsc::channel();

        // 1. Invalid device ID
        let cfg = RunConfig {
            name: "test".to_string(),
            kind: crate::run::config::RunKind::Flutter,
            target: None,
            flavor: None,
            dart_defines: vec![],
            module: None,
            variant: None,
            application_id: None,
            activity: None,
        };
        let res = FlutterRun::start(
            &crate::exec::SystemSpawn,
            dir.path(),
            &cfg,
            "device; rm -rf /",
            tx.clone(),
        );
        assert!(matches!(res, Err(FlutterRunError::InvalidDeviceId(_))));

        // 2. Invalid flavor
        let cfg_bad_flavor = RunConfig {
            flavor: Some("dev;rm".to_string()),
            ..cfg.clone()
        };
        let res2 = FlutterRun::start(
            &crate::exec::SystemSpawn,
            dir.path(),
            &cfg_bad_flavor,
            "emulator-5554",
            tx.clone(),
        );
        assert!(matches!(res2, Err(FlutterRunError::InvalidFlavor(_))));

        // 3. Invalid target
        let cfg_bad_target = RunConfig {
            target: Some("../secret.dart".to_string()),
            ..cfg
        };
        let res3 = FlutterRun::start(
            &crate::exec::SystemSpawn,
            dir.path(),
            &cfg_bad_target,
            "emulator-5554",
            tx,
        );
        assert!(matches!(res3, Err(FlutterRunError::InvalidTarget(_))));
    }

    struct MockProc {
        pid: u32,
        stdin_lines: Arc<Mutex<Vec<String>>>,
        killed: Arc<AtomicBool>,
    }

    impl Proc for MockProc {
        fn stdin_write(&mut self, data: &[u8]) -> io::Result<()> {
            let s = String::from_utf8_lossy(data).to_string();
            self.stdin_lines.lock().unwrap().push(s);
            Ok(())
        }

        fn kill(&mut self) -> io::Result<()> {
            self.killed.store(true, Ordering::SeqCst);
            Ok(())
        }

        fn pid(&self) -> Option<u32> {
            Some(self.pid)
        }
    }

    struct MockSpawn {
        lines_to_emit: Vec<ProcLine>,
        stdin_received: Arc<Mutex<Vec<String>>>,
        killed: Arc<AtomicBool>,
        tx_bridge: Arc<Mutex<Option<Sender<ProcLine>>>>,
    }

    impl Spawn for MockSpawn {
        fn spawn(
            &self,
            _cwd: &Path,
            _program: &str,
            _args: &[&str],
            _env: &[(&str, &str)],
            tx: Sender<ProcLine>,
        ) -> io::Result<Box<dyn Proc>> {
            *self.tx_bridge.lock().unwrap() = Some(tx.clone());

            let lines = self.lines_to_emit.clone();
            thread::spawn(move || {
                for line in lines {
                    let _ = tx.send(line);
                    thread::sleep(Duration::from_millis(5));
                }
            });

            Ok(Box::new(MockProc {
                pid: 12345,
                stdin_lines: Arc::clone(&self.stdin_received),
                killed: Arc::clone(&self.killed),
            }))
        }
    }

    #[test]
    fn test_flutter_run_mock_lifecycle_reload_and_stop() {
        use tempfile::tempdir;
        let dir = tempdir().unwrap();

        let initial_lines = vec![
            ProcLine::Stdout(r#"[{"event":"app.start","params":{"appId":"mock_app","deviceId":"emulator-5554"}}]"#.to_string()),
            ProcLine::Stdout(r#"[{"event":"app.progress","params":{"id":"1","message":"Installing app...","finished":false}}]"#.to_string()),
            ProcLine::Stdout(r#"[{"event":"app.debugPort","params":{"appId":"mock_app","port":43211,"wsUri":"ws://127.0.0.1:43211/ws"}}]"#.to_string()),
            ProcLine::Stdout(r#"[{"event":"app.started","params":{"appId":"mock_app"}}]"#.to_string()),
            ProcLine::Stdout("The Flutter DevTools debugger and profiler on emulator-5554 is available at: http://127.0.0.1:9100?uri=ws://127.0.0.1:43211/ws".to_string()),
            ProcLine::Stdout(r#"[{"event":"app.log","params":{"appId":"mock_app","log":"PETAK_HELLO\n"}}]"#.to_string()),
        ];

        let stdin_received = Arc::new(Mutex::new(Vec::new()));
        let killed = Arc::new(AtomicBool::new(false));
        let tx_bridge = Arc::new(Mutex::new(None));

        let mock_spawn = MockSpawn {
            lines_to_emit: initial_lines,
            stdin_received: Arc::clone(&stdin_received),
            killed: Arc::clone(&killed),
            tx_bridge: Arc::clone(&tx_bridge),
        };

        let (event_tx, event_rx) = std::sync::mpsc::channel();
        let cfg = RunConfig {
            name: "test".to_string(),
            kind: crate::run::config::RunKind::Flutter,
            target: None,
            flavor: None,
            dart_defines: vec![],
            module: None,
            variant: None,
            application_id: None,
            activity: None,
        };

        let mut runner =
            FlutterRun::start(&mock_spawn, dir.path(), &cfg, "emulator-5554", event_tx)
                .expect("start should succeed");

        assert_eq!(runner.pid(), Some(12345));

        // Wait for appStarted event
        let mut app_started = false;
        let mut saw_log = false;
        let deadline = Instant::now() + Duration::from_secs(3);
        while Instant::now() < deadline {
            if let Ok(ev) = event_rx.recv_timeout(Duration::from_millis(100)) {
                match ev {
                    RunEvent::AppStarted {
                        app_id,
                        vm_service_uri,
                        ..
                    } => {
                        if app_id == Some("mock_app".to_string()) && vm_service_uri.is_some() {
                            app_started = true;
                        }
                    }
                    RunEvent::Output { line, .. } => {
                        if line.contains("PETAK_HELLO") {
                            saw_log = true;
                        }
                    }
                    _ => {}
                }
                if app_started && saw_log {
                    break;
                }
            }
        }

        assert!(app_started, "AppStarted should be received");
        assert!(saw_log, "Stdout log should be received");

        // Spawn a thread to send reload response to tx_bridge
        let bridge_clone = Arc::clone(&tx_bridge);
        thread::spawn(move || {
            thread::sleep(Duration::from_millis(30));
            if let Some(ref tx) = *bridge_clone.lock().unwrap() {
                let _ = tx.send(ProcLine::Stdout(
                    r#"[{"id":1,"result":{"code":0,"message":"Reloaded 1 of 659 libraries in 45ms."}}]"#.to_string(),
                ));
            }
        });

        let reload_res = runner.reload(false).expect("reload should succeed");
        assert!(reload_res.ok);
        assert_eq!(reload_res.full_restart, false);
        assert!(reload_res.message.unwrap().contains("45ms"));

        // Check stdin command was sent
        let stdin = stdin_received.lock().unwrap();
        assert!(stdin.iter().any(|cmd| cmd.contains("app.restart")));
        drop(stdin);

        // Test stop
        let bridge_clone_stop = Arc::clone(&tx_bridge);
        thread::spawn(move || {
            thread::sleep(Duration::from_millis(30));
            if let Some(ref tx) = *bridge_clone_stop.lock().unwrap() {
                let _ = tx.send(ProcLine::Stdout(r#"[{"id":2,"result":true}]"#.to_string()));
                let _ = tx.send(ProcLine::Exit(Some(0)));
            }
        });

        runner.stop().expect("stop should succeed");
        assert!(!runner.is_running());
    }

    #[test]
    fn test_parse_real_daemon_fixture() {
        let fixture_content = include_str!("../../tests/fixtures/flutter_machine.txt");
        let mut event_count = 0;
        let mut response_count = 0;
        let mut non_json_count = 0;
        let mut saw_app_start = false;
        let mut saw_app_started = false;
        let mut saw_debug_port = false;
        let mut saw_app_stop = false;

        for line in fixture_content.lines() {
            if line.starts_with("[EXIT]") {
                continue;
            }
            match parse_flutter_daemon_line(line) {
                FlutterDaemonMessage::Event { event, params } => {
                    event_count += 1;
                    match event.as_str() {
                        "app.start" => {
                            saw_app_start = true;
                            assert_eq!(params["appId"], "dea87405-e74b-4fc4-b809-f37b75d2ff49");
                            assert_eq!(params["deviceId"], "emulator-5554");
                        }
                        "app.started" => {
                            saw_app_started = true;
                            assert_eq!(params["appId"], "dea87405-e74b-4fc4-b809-f37b75d2ff49");
                        }
                        "app.debugPort" => {
                            saw_debug_port = true;
                            assert_eq!(params["port"], 40507);
                            assert!(params["wsUri"].as_str().unwrap().contains("40507"));
                        }
                        "app.stop" => {
                            saw_app_stop = true;
                            assert_eq!(params["appId"], "dea87405-e74b-4fc4-b809-f37b75d2ff49");
                        }
                        _ => {}
                    }
                }
                FlutterDaemonMessage::Response { id, result, error } => {
                    response_count += 1;
                    assert!(error.is_none());
                    if id == 1 {
                        assert_eq!(result.unwrap()["code"], 0);
                    }
                }
                FlutterDaemonMessage::NonJson(raw) => {
                    non_json_count += 1;
                    assert!(!raw.is_empty());
                }
            }
        }

        assert!(saw_app_start, "Should have parsed app.start");
        assert!(saw_app_started, "Should have parsed app.started");
        assert!(saw_debug_port, "Should have parsed app.debugPort");
        assert!(saw_app_stop, "Should have parsed app.stop");
        assert!(
            event_count > 10,
            "Expected > 10 events, got {}",
            event_count
        );
        assert_eq!(
            response_count, 3,
            "Expected 3 responses (reload, restart, stop)"
        );
        assert!(
            non_json_count > 10,
            "Expected > 10 non-JSON logs, got {}",
            non_json_count
        );
    }
}
