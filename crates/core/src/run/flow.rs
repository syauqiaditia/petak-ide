use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FlowStep {
    pub id: String,
    pub action: String, // "tap", "inputText", "pressKey", "assertVisible", "screenshot", "launchApp", "wait"
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub selector: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub key: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timeout_ms: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Flow {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub app_id: Option<String>,
    #[serde(default)]
    pub steps: Vec<FlowStep>,
    #[serde(default)]
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum FlowStepStatusKind {
    Pending,
    Running,
    Passed,
    Failed,
    Skipped,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FlowStepStatus {
    pub step_id: String,
    pub status: FlowStepStatusKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub screenshot_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FlowRunResult {
    pub flow_id: String,
    pub success: bool,
    pub total_steps: usize,
    pub passed_steps: usize,
    pub failed_steps: usize,
    pub duration_ms: u64,
    pub runner: String, // "maestro" or "adb_fallback"
    pub step_results: Vec<FlowStepStatus>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub failure_screenshot: Option<String>,
}

// ───────────────────────────────────────────
// Cancellation state tracking
// ───────────────────────────────────────────

static RUNNING_FLOWS: OnceLock<Mutex<HashMap<String, Arc<AtomicBool>>>> = OnceLock::new();

fn get_running_flows() -> &'static Mutex<HashMap<String, Arc<AtomicBool>>> {
    RUNNING_FLOWS.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Mark a running flow as cancelled.
pub fn cancel_flow(flow_id: &str) -> Result<bool, String> {
    let map = get_running_flows().lock().map_err(|e| e.to_string())?;
    if let Some(flag) = map.get(flow_id) {
        flag.store(true, Ordering::SeqCst);
        Ok(true)
    } else {
        Ok(false)
    }
}

pub fn is_flow_cancelled(flow_id: &str) -> bool {
    if let Ok(map) = get_running_flows().lock() {
        if let Some(flag) = map.get(flow_id) {
            return flag.load(Ordering::Relaxed);
        }
    }
    false
}

struct FlowGuard<'a>(&'a str);
impl<'a> Drop for FlowGuard<'a> {
    fn drop(&mut self) {
        if let Ok(mut map) = get_running_flows().lock() {
            map.remove(self.0);
        }
    }
}

// ───────────────────────────────────────────
// Discovery & YAML Persistence
// ───────────────────────────────────────────

pub fn validate_flow_id(flow_id: &str) -> Result<(), String> {
    if flow_id.is_empty()
        || flow_id.contains("..")
        || flow_id.contains('/')
        || flow_id.contains('\\')
        || flow_id.starts_with('.')
    {
        return Err(format!(
            "Invalid flow id '{}': cannot contain path separators or traversal",
            flow_id
        ));
    }
    Ok(())
}

fn flows_dir(root: Option<&Path>) -> PathBuf {
    match root {
        Some(r) => r.join(".petak").join("flows"),
        None => PathBuf::from(".petak").join("flows"),
    }
}

fn candidate_flow_dirs(root: Option<&Path>) -> Vec<PathBuf> {
    let base = match root {
        Some(r) => r.to_path_buf(),
        None => PathBuf::from("."),
    };
    vec![
        base.join(".petak").join("flows"),
        base.join(".maestro"),
    ]
}

/// Discover all flows in `.petak/flows/*.yaml` (and *.yml) or `.maestro/*.yaml` (and *.yml).
pub fn list_flows(root: Option<&Path>) -> Result<Vec<Flow>, String> {
    let mut flows = Vec::new();

    for dir in candidate_flow_dirs(root) {
        if !dir.exists() {
            continue;
        }

        let entries = match fs::read_dir(&dir) {
            Ok(e) => e,
            Err(_) => continue,
        };

        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() {
                if let Some(ext) = path.extension().and_then(|s| s.to_str()) {
                    if ext == "yaml" || ext == "yml" {
                        if let Ok(content) = fs::read_to_string(&path) {
                            if let Ok(flow) = serde_yaml::from_str::<Flow>(&content) {
                                if !flows.iter().any(|f: &Flow| f.id == flow.id) {
                                    flows.push(flow);
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    flows.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(flows)
}

/// Save a flow to `.petak/flows/{flow_id}.yaml`.
pub fn save_flow(root: Option<&Path>, flow: &Flow) -> Result<(), String> {
    validate_flow_id(&flow.id)?;
    let dir = flows_dir(root);
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create flows dir: {}", e))?;

    let yaml_content = serde_yaml::to_string(flow)
        .map_err(|e| format!("Failed to serialize flow to YAML: {}", e))?;

    let file_path = dir.join(format!("{}.yaml", flow.id));
    fs::write(&file_path, yaml_content)
        .map_err(|e| format!("Failed to write flow file '{}': {}", file_path.display(), e))?;

    Ok(())
}

/// Create a new flow, assign an ID from name, and save to `.petak/flows/`.
pub fn create_flow(
    root: Option<&Path>,
    name: &str,
    app_id: Option<&str>,
    steps: Vec<FlowStep>,
) -> Result<Flow, String> {
    let raw_slug: String = name
        .to_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect();
    let slug = raw_slug
        .split('-')
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    let base_id = if slug.is_empty() {
        "flow".to_string()
    } else {
        slug
    };

    let dir = flows_dir(root);
    let mut id = base_id.clone();
    if dir.join(format!("{}.yaml", id)).exists() {
        id = format!("{}-{}", base_id, chrono::Utc::now().timestamp_millis());
    }

    let flow = Flow {
        id,
        name: name.to_string(),
        description: String::new(),
        app_id: app_id.map(|s| s.to_string()),
        steps,
        tags: Vec::new(),
    };

    save_flow(root, &flow)?;
    Ok(flow)
}

// ───────────────────────────────────────────
// Dual Runner: Maestro CLI & ADB Fallback
// ───────────────────────────────────────────

fn is_maestro_available() -> bool {
    if let Ok(output) = std::process::Command::new("which").arg("maestro").output() {
        if output.status.success() && !output.stdout.is_empty() {
            return true;
        }
    }
    false
}

fn generate_maestro_yaml(flow: &Flow) -> String {
    let mut lines = Vec::new();
    if let Some(app_id) = &flow.app_id {
        lines.push(format!("appId: {}", app_id));
    } else {
        lines.push("appId: com.example.app".to_string());
    }
    lines.push("---".to_string());
    for step in &flow.steps {
        match step.action.as_str() {
            "launchApp" => {
                if let Some(app) = &step.text {
                    lines.push(format!("- launchApp:\n    appId: \"{}\"", app));
                } else if let Some(app) = &flow.app_id {
                    lines.push(format!("- launchApp:\n    appId: \"{}\"", app));
                } else {
                    lines.push("- launchApp".to_string());
                }
            }
            "tap" => {
                if let Some(sel) = &step.selector {
                    if sel.contains(',') || (sel.split_whitespace().count() == 2 && sel.chars().all(|c| c.is_ascii_digit() || c == ' ' || c == ',')) {
                        let clean = sel.replace(' ', ",");
                        lines.push(format!("- tapOn:\n    point: \"{}\"", clean));
                    } else {
                        lines.push(format!("- tapOn: \"{}\"", sel));
                    }
                } else if let Some(text) = &step.text {
                    lines.push(format!("- tapOn: \"{}\"", text));
                }
            }
            "inputText" => {
                let txt = step.text.as_deref().unwrap_or("");
                lines.push(format!("- inputText: \"{}\"", txt));
            }
            "pressKey" => {
                let key = step.key.as_deref().or(step.text.as_deref()).unwrap_or("ENTER");
                lines.push(format!("- pressKey: {}", key));
            }
            "wait" => {
                let ms = step.timeout_ms.unwrap_or(1000);
                lines.push(format!("- sleep: {}", ms));
            }
            "assertVisible" => {
                let target = step.text.as_deref().or(step.selector.as_deref()).unwrap_or("");
                lines.push(format!("- assertVisible: \"{}\"", target));
            }
            "screenshot" => {
                lines.push("- takeScreenshot: screenshot".to_string());
            }
            _ => {}
        }
    }
    lines.join("\n")
}

fn run_adb(adb: &str, device_serial: Option<&str>, args: &[&str]) -> io::Result<std::process::Output> {
    let mut cmd = std::process::Command::new(adb);
    if let Some(serial) = device_serial {
        if !serial.is_empty() {
            cmd.arg("-s").arg(serial);
        }
    }
    cmd.args(args);
    cmd.output()
}

fn take_adb_screenshot(
    adb: &str,
    device_serial: Option<&str>,
    out_path: &Path,
) -> Result<(), String> {
    if let Some(parent) = out_path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let mut cmd = std::process::Command::new(adb);
    if let Some(serial) = device_serial {
        if !serial.is_empty() {
            cmd.arg("-s").arg(serial);
        }
    }
    cmd.arg("exec-out").arg("screencap").arg("-p");
    let output = cmd.output().map_err(|e| format!("Failed to take screenshot: {}", e))?;
    if !output.status.success() {
        return Err(format!("screencap failed: {}", String::from_utf8_lossy(&output.stderr)));
    }
    fs::write(out_path, &output.stdout).map_err(|e| format!("Failed to save screenshot file: {}", e))?;
    Ok(())
}

fn dump_uiautomator(adb: &str, device_serial: Option<&str>) -> Result<String, String> {
    let out_dump = run_adb(adb, device_serial, &["shell", "uiautomator", "dump", "/sdcard/dump.xml"])
        .map_err(|e| format!("uiautomator dump command failed: {}", e))?;
    if !out_dump.status.success() {
        let err = String::from_utf8_lossy(&out_dump.stderr);
        return Err(format!("uiautomator dump error: {}", err));
    }
    let out_cat = run_adb(adb, device_serial, &["shell", "cat", "/sdcard/dump.xml"])
        .map_err(|e| format!("reading dump.xml failed: {}", e))?;
    if !out_cat.status.success() {
        let err = String::from_utf8_lossy(&out_cat.stderr);
        return Err(format!("reading dump.xml error: {}", err));
    }
    Ok(String::from_utf8_lossy(&out_cat.stdout).to_string())
}

/// Find coordinates (center x, center y) from UIAutomator dump XML matching target query.
fn find_element_center_in_dump(dump: &str, target: &str) -> Option<(u32, u32)> {
    static RE_NODE: OnceLock<Regex> = OnceLock::new();
    let re = RE_NODE.get_or_init(|| {
        Regex::new(r#"<node[^>]+bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"[^>]*>"#).unwrap()
    });

    for caps in re.captures_iter(dump) {
        if let Some(full) = caps.get(0) {
            let node_xml = full.as_str();
            if node_xml.contains(target) {
                let x1: u32 = caps.get(1)?.as_str().parse().ok()?;
                let y1: u32 = caps.get(2)?.as_str().parse().ok()?;
                let x2: u32 = caps.get(3)?.as_str().parse().ok()?;
                let y2: u32 = caps.get(4)?.as_str().parse().ok()?;
                return Some(((x1 + x2) / 2, (y1 + y2) / 2));
            }
        }
    }
    None
}

/// Execute a flow against target device using Maestro CLI if available, or ADB fallback runner.
pub async fn run_flow(
    root: Option<&Path>,
    flow_id: &str,
    device_serial: Option<&str>,
) -> Result<FlowRunResult, String> {
    run_flow_sync(root, flow_id, device_serial)
}

/// Execute a flow synchronously against target device using Maestro CLI if available, or ADB fallback runner.
pub fn run_flow_sync(
    root: Option<&Path>,
    flow_id: &str,
    device_serial: Option<&str>,
) -> Result<FlowRunResult, String> {
    validate_flow_id(flow_id)?;
    let dir = flows_dir(root);

    // Locate flow file in .petak/flows or .maestro
    let mut candidate = None;
    for d in candidate_flow_dirs(root) {
        let p1 = d.join(format!("{}.yaml", flow_id));
        if p1.exists() {
            candidate = Some(p1);
            break;
        }
        let p2 = d.join(format!("{}.yml", flow_id));
        if p2.exists() {
            candidate = Some(p2);
            break;
        }
    }

    let flow = if let Some(cand) = candidate {
        let content = fs::read_to_string(&cand)
            .map_err(|e| format!("Failed to read flow file: {}", e))?;
        serde_yaml::from_str::<Flow>(&content)
            .map_err(|e| format!("Invalid flow YAML in '{}': {}", cand.display(), e))?
    } else {
        // Fallback search across directory for matching flow.id
        let all = list_flows(root)?;
        all.into_iter()
            .find(|f| f.id == flow_id)
            .ok_or_else(|| format!("Flow with id '{}' not found", flow_id))?
    };

    // Register active flow & cancellation flag
    let cancel_flag = Arc::new(AtomicBool::new(false));
    {
        let mut map = get_running_flows().lock().map_err(|e| e.to_string())?;
        map.insert(flow_id.to_string(), Arc::clone(&cancel_flag));
    }
    let _guard = FlowGuard(flow_id);

    let start_time = Instant::now();
    let screenshots_dir = dir.join("screenshots");
    let _ = fs::create_dir_all(&screenshots_dir);

    // ───────────────────────────────────────────
    // Path 1: Maestro CLI (if installed)
    // ───────────────────────────────────────────
    if is_maestro_available() {
        let maestro_yaml = generate_maestro_yaml(&flow);
        let temp_flow_path = dir.join(format!(".tmp_maestro_{}.yaml", flow_id));
        if let Err(e) = fs::write(&temp_flow_path, &maestro_yaml) {
            return Err(format!("Failed to write temporary maestro flow: {}", e));
        }

        let mut cmd = std::process::Command::new("maestro");
        if let Some(serial) = device_serial {
            if !serial.is_empty() {
                cmd.arg("--device").arg(serial);
            }
        }
        cmd.arg("test").arg(&temp_flow_path);

        let output_res = cmd.output();
        let _ = fs::remove_file(&temp_flow_path);

        let duration_ms = start_time.elapsed().as_millis() as u64;

        match output_res {
            Ok(output) => {
                let success = output.status.success() && !cancel_flag.load(Ordering::Relaxed);
                let stdout = String::from_utf8_lossy(&output.stdout);
                let stderr = String::from_utf8_lossy(&output.stderr);
                let combined_err = if !success {
                    Some(if !stderr.trim().is_empty() {
                        stderr.trim().to_string()
                    } else if !stdout.trim().is_empty() {
                        stdout.trim().to_string()
                    } else {
                        "Maestro run failed".to_string()
                    })
                } else {
                    None
                };

                let step_results: Vec<FlowStepStatus> = flow
                    .steps
                    .iter()
                    .map(|s| FlowStepStatus {
                        step_id: s.id.clone(),
                        status: if success {
                            FlowStepStatusKind::Passed
                        } else {
                            FlowStepStatusKind::Failed
                        },
                        duration_ms: Some(duration_ms / (flow.steps.len().max(1) as u64)),
                        error: combined_err.clone(),
                        screenshot_path: None,
                    })
                    .collect();

                let total_steps = flow.steps.len();
                let passed_steps = if success { total_steps } else { 0 };
                let failed_steps = if success { 0 } else { total_steps };

                return Ok(FlowRunResult {
                    flow_id: flow_id.to_string(),
                    success,
                    total_steps,
                    passed_steps,
                    failed_steps,
                    duration_ms,
                    runner: "maestro".to_string(),
                    step_results,
                    error: combined_err,
                    failure_screenshot: None,
                });
            }
            Err(e) => {
                // If maestro fails to spawn, fallback to ADB runner
                eprintln!("Maestro CLI failed to execute: {}, falling back to ADB runner", e);
            }
        }
    }

    // ───────────────────────────────────────────
    // Path 2: Internal ADB Runner Fallback
    // ───────────────────────────────────────────
    let adb = crate::run::device::resolve_adb_binary();
    let mut step_results = Vec::new();
    let mut passed_steps = 0;
    let mut failed_steps = 0;
    let mut failure_screenshot = None;
    let mut overall_error = None;
    let total_steps = flow.steps.len();

    let mut failed = false;

    for (idx, step) in flow.steps.iter().enumerate() {
        if failed || cancel_flag.load(Ordering::Relaxed) {
            step_results.push(FlowStepStatus {
                step_id: step.id.clone(),
                status: FlowStepStatusKind::Skipped,
                duration_ms: Some(0),
                error: if cancel_flag.load(Ordering::Relaxed) && overall_error.is_none() {
                    overall_error = Some("Flow execution cancelled".to_string());
                    overall_error.clone()
                } else {
                    None
                },
                screenshot_path: None,
            });
            continue;
        }

        let step_start = Instant::now();
        let mut step_error: Option<String> = None;
        let mut step_screenshot: Option<String> = None;

        match step.action.as_str() {
            "launchApp" => {
                let app_id = step.text.as_deref().or(flow.app_id.as_deref());
                if let Some(app) = app_id {
                    let out = run_adb(
                        &adb,
                        device_serial,
                        &["shell", "monkey", "-p", app, "-c", "android.intent.category.LAUNCHER", "1"],
                    );
                    match out {
                        Ok(o) => {
                            let text = format!(
                                "{}\n{}",
                                String::from_utf8_lossy(&o.stdout),
                                String::from_utf8_lossy(&o.stderr)
                            );
                            if !o.status.success() || text.contains("** No activities found") {
                                // Try am start fallback
                                let am_out = run_adb(
                                    &adb,
                                    device_serial,
                                    &["shell", "am", "start", "-n", &format!("{}/.MainActivity", app)],
                                );
                                if let Ok(ao) = am_out {
                                    if !ao.status.success() {
                                        step_error = Some(format!("Failed to launch app: {}", text.trim()));
                                    }
                                } else {
                                    step_error = Some(format!("Failed to launch app: {}", text.trim()));
                                }
                            }
                        }
                        Err(e) => {
                            step_error = Some(format!("adb monkey command error: {}", e));
                        }
                    }
                } else {
                    step_error = Some("No appId provided for launchApp action".to_string());
                }
            }

            "tap" => {
                let mut coords: Option<(u32, u32)> = None;

                if let Some(sel) = &step.selector {
                    let parts: Vec<&str> = sel
                        .split(|c: char| c.is_whitespace() || c == ',')
                        .filter(|s| !s.is_empty())
                        .collect();
                    if parts.len() == 2 {
                        if let (Ok(x), Ok(y)) = (parts[0].parse::<u32>(), parts[1].parse::<u32>()) {
                            coords = Some((x, y));
                        }
                    }
                }

                if coords.is_none() {
                    // Try looking up selector or text in uiautomator dump
                    let query = step.selector.as_deref().or(step.text.as_deref());
                    if let Some(q) = query {
                        match dump_uiautomator(&adb, device_serial) {
                            Ok(dump) => {
                                coords = find_element_center_in_dump(&dump, q);
                                if coords.is_none() {
                                    step_error = Some(format!("Selector/text '{}' not found in UI dump for tap", q));
                                }
                            }
                            Err(e) => {
                                step_error = Some(e);
                            }
                        }
                    } else {
                        step_error = Some("No selector or text coordinates provided for tap".to_string());
                    }
                }

                if let Some((x, y)) = coords {
                    let out = run_adb(
                        &adb,
                        device_serial,
                        &["shell", "input", "tap", &x.to_string(), &y.to_string()],
                    );
                    if let Err(e) = out {
                        step_error = Some(format!("adb input tap error: {}", e));
                    }
                }
            }

            "inputText" => {
                if let Some(txt) = &step.text {
                    let escaped = txt.replace(' ', "%s");
                    let out = run_adb(&adb, device_serial, &["shell", "input", "text", &escaped]);
                    if let Err(e) = out {
                        step_error = Some(format!("adb input text error: {}", e));
                    }
                } else {
                    step_error = Some("No text provided for inputText action".to_string());
                }
            }

            "pressKey" => {
                let key = step.key.as_deref().or(step.text.as_deref()).unwrap_or("66");
                let out = run_adb(&adb, device_serial, &["shell", "input", "keyevent", key]);
                if let Err(e) = out {
                    step_error = Some(format!("adb input keyevent error: {}", e));
                }
            }

            "wait" => {
                let ms = step.timeout_ms.unwrap_or(1000);
                let chunk = Duration::from_millis(50);
                let target = Duration::from_millis(ms);
                let mut elapsed = Duration::ZERO;
                while elapsed < target {
                    if cancel_flag.load(Ordering::Relaxed) {
                        step_error = Some("Flow cancelled during wait".to_string());
                        break;
                    }
                    let s = std::cmp::min(chunk, target - elapsed);
                    std::thread::sleep(s);
                    elapsed += s;
                }
            }

            "assertVisible" => {
                let target = step.text.as_deref().or(step.selector.as_deref());
                if let Some(q) = target {
                    match dump_uiautomator(&adb, device_serial) {
                        Ok(dump) => {
                            if !dump.contains(q) {
                                step_error = Some(format!(
                                    "assertVisible failed: '{}' not found in UI dump",
                                    q
                                ));
                            }
                        }
                        Err(e) => {
                            step_error = Some(format!("assertVisible UI dump failed: {}", e));
                        }
                    }
                } else {
                    step_error = Some("assertVisible requires selector or text".to_string());
                }
            }

            "screenshot" => {
                let ts = chrono::Utc::now().timestamp_millis();
                let path = screenshots_dir.join(format!("{}_{}_{}.png", flow_id, step.id, ts));
                match take_adb_screenshot(&adb, device_serial, &path) {
                    Ok(()) => {
                        step_screenshot = Some(path.to_string_lossy().to_string());
                    }
                    Err(e) => {
                        step_error = Some(e);
                    }
                }
            }

            other => {
                step_error = Some(format!("Unsupported action '{}'", other));
            }
        }

        let step_dur = step_start.elapsed().as_millis() as u64;

        if let Some(err) = step_error {
            failed = true;
            failed_steps += 1;
            overall_error = Some(err.clone());

            // Capture automatic failure screenshot
            let ts = chrono::Utc::now().timestamp_millis();
            let fail_path = screenshots_dir.join(format!("failure_{}_{}_{}.png", flow_id, step.id, ts));
            if take_adb_screenshot(&adb, device_serial, &fail_path).is_ok() {
                let fail_str = fail_path.to_string_lossy().to_string();
                failure_screenshot = Some(fail_str.clone());
                if step_screenshot.is_none() {
                    step_screenshot = Some(fail_str);
                }
            }

            step_results.push(FlowStepStatus {
                step_id: step.id.clone(),
                status: FlowStepStatusKind::Failed,
                duration_ms: Some(step_dur),
                error: Some(err),
                screenshot_path: step_screenshot,
            });
        } else {
            passed_steps += 1;
            step_results.push(FlowStepStatus {
                step_id: step.id.clone(),
                status: FlowStepStatusKind::Passed,
                duration_ms: Some(step_dur),
                error: None,
                screenshot_path: step_screenshot,
            });
        }

        let _ = idx;
    }

    let duration_ms = start_time.elapsed().as_millis() as u64;
    let is_cancelled = cancel_flag.load(Ordering::Relaxed);
    let success = !failed && !is_cancelled;

    Ok(FlowRunResult {
        flow_id: flow_id.to_string(),
        success,
        total_steps,
        passed_steps,
        failed_steps,
        duration_ms,
        runner: "adb_fallback".to_string(),
        step_results,
        error: overall_error,
        failure_screenshot,
    })
}

// ───────────────────────────────────────────
// Automated Unit Tests
// ───────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn test_flow_yaml_serialization_roundtrip() {
        let step1 = FlowStep {
            id: "step-1".to_string(),
            action: "launchApp".to_string(),
            selector: None,
            text: Some("com.example.app".to_string()),
            key: None,
            timeout_ms: None,
            description: Some("Launch application".to_string()),
        };

        let step2 = FlowStep {
            id: "step-2".to_string(),
            action: "tap".to_string(),
            selector: Some("500 1000".to_string()),
            text: None,
            key: None,
            timeout_ms: Some(3000),
            description: None,
        };

        let flow = Flow {
            id: "test-flow-1".to_string(),
            name: "Test Flow One".to_string(),
            description: "A test automation flow".to_string(),
            app_id: Some("com.example.app".to_string()),
            steps: vec![step1, step2],
            tags: vec!["smoke".to_string(), "login".to_string()],
        };

        let yaml = serde_yaml::to_string(&flow).expect("serialize to yaml");
        assert!(yaml.contains("timeoutMs: 3000"));
        assert!(yaml.contains("appId: com.example.app"));

        let deserialized: Flow = serde_yaml::from_str(&yaml).expect("deserialize from yaml");
        assert_eq!(flow, deserialized);
    }

    #[test]
    fn test_flow_crud_in_tempdir() {
        let tmp = tempdir().expect("tempdir");
        let root = tmp.path();

        // 1. Initial list is empty
        let initial = list_flows(Some(root)).expect("list empty flows");
        assert_eq!(initial.len(), 0);

        // 2. Create flow
        let step = FlowStep {
            id: "step-login".to_string(),
            action: "launchApp".to_string(),
            selector: None,
            text: None,
            key: None,
            timeout_ms: None,
            description: None,
        };
        let created = create_flow(Some(root), "Login Flow", Some("com.test.app"), vec![step])
            .expect("create flow");
        assert_eq!(created.id, "login-flow");
        assert_eq!(created.name, "Login Flow");

        // 3. List contains the created flow
        let flows = list_flows(Some(root)).expect("list flows");
        assert_eq!(flows.len(), 1);
        assert_eq!(flows[0].id, "login-flow");

        // 4. Save modified flow
        let mut modified = flows[0].clone();
        modified.description = "Updated description".to_string();
        save_flow(Some(root), &modified).expect("save flow");

        let updated = list_flows(Some(root)).expect("list updated flows");
        assert_eq!(updated[0].description, "Updated description");

        // 5. Path traversal rejection
        let evil = Flow {
            id: "../evil".to_string(),
            name: "Evil".to_string(),
            description: String::new(),
            app_id: None,
            steps: Vec::new(),
            tags: Vec::new(),
        };
        assert!(save_flow(Some(root), &evil).is_err());
    }

    #[test]
    fn test_step_status_tracking_and_aggregation() {
        let step_results = vec![
            FlowStepStatus {
                step_id: "s1".to_string(),
                status: FlowStepStatusKind::Passed,
                duration_ms: Some(120),
                error: None,
                screenshot_path: None,
            },
            FlowStepStatus {
                step_id: "s2".to_string(),
                status: FlowStepStatusKind::Failed,
                duration_ms: Some(250),
                error: Some("Element not visible".to_string()),
                screenshot_path: Some("/tmp/screenshot.png".to_string()),
            },
            FlowStepStatus {
                step_id: "s3".to_string(),
                status: FlowStepStatusKind::Skipped,
                duration_ms: Some(0),
                error: None,
                screenshot_path: None,
            },
        ];

        let run_result = FlowRunResult {
            flow_id: "flow-abc".to_string(),
            success: false,
            total_steps: 3,
            passed_steps: 1,
            failed_steps: 1,
            duration_ms: 370,
            runner: "adb_fallback".to_string(),
            step_results,
            error: Some("Element not visible".to_string()),
            failure_screenshot: Some("/tmp/screenshot.png".to_string()),
        };

        let json = serde_json::to_string(&run_result).expect("json serialize");
        assert!(json.contains("\"passedSteps\":1"));
        assert!(json.contains("\"failedSteps\":1"));
        assert!(json.contains("\"failureScreenshot\":\"/tmp/screenshot.png\""));
        assert!(json.contains("\"status\":\"passed\""));
        assert!(json.contains("\"status\":\"failed\""));
        assert!(json.contains("\"status\":\"skipped\""));

        let deserialized: FlowRunResult = serde_json::from_str(&json).expect("json deserialize");
        assert_eq!(run_result, deserialized);
    }

    #[test]
    fn test_cancellation_flow_flag() {
        let flow_id = "test-cancel-sample";
        assert_eq!(cancel_flow(flow_id).unwrap(), false);

        // Register running flow flag
        let flag = Arc::new(AtomicBool::new(false));
        {
            let mut map = get_running_flows().lock().unwrap();
            map.insert(flow_id.to_string(), Arc::clone(&flag));
        }

        assert_eq!(is_flow_cancelled(flow_id), false);
        assert_eq!(cancel_flow(flow_id).unwrap(), true);
        assert_eq!(is_flow_cancelled(flow_id), true);
        assert_eq!(flag.load(Ordering::SeqCst), true);

        // Cleanup
        {
            let mut map = get_running_flows().lock().unwrap();
            map.remove(flow_id);
        }
        assert_eq!(cancel_flow(flow_id).unwrap(), false);
    }

    #[test]
    fn test_find_element_center_in_dump() {
        let xml = r#"<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>
<hierarchy rotation="0">
  <node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="com.test.app" bounds="[0,0][1080,2400]">
    <node index="0" text="Submit" resource-id="com.test.app:id/btn_submit" bounds="[200,800][400,900]" />
  </node>
</hierarchy>"#;

        let center = find_element_center_in_dump(xml, "Submit");
        assert_eq!(center, Some((300, 850)));

        let not_found = find_element_center_in_dump(xml, "Cancel");
        assert_eq!(not_found, None);
    }
}
