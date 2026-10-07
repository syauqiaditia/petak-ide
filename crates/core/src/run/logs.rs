use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::mpsc::Sender;
use std::sync::OnceLock;
use std::thread;
use std::time::{Duration, Instant};

use regex::Regex;
use serde::{Deserialize, Serialize};

use crate::exec::{Proc, ProcLine, Spawn};
use crate::run::device::{is_valid_device_id, resolve_adb_binary};
use crate::run::flutter::{OutputStream, RunEvent};

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum LogLevel {
    V,
    D,
    I,
    W,
    E,
    F,
}

impl LogLevel {
    pub fn from_char(c: char) -> Option<Self> {
        match c {
            'V' | 'v' => Some(Self::V),
            'D' | 'd' => Some(Self::D),
            'I' | 'i' => Some(Self::I),
            'W' | 'w' => Some(Self::W),
            'E' | 'e' => Some(Self::E),
            'F' | 'f' => Some(Self::F),
            _ => None,
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::V => "V",
            Self::D => "D",
            Self::I => "I",
            Self::W => "W",
            Self::E => "E",
            Self::F => "F",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogLine {
    pub ts: String,
    pub pid: u32,
    pub tid: u32,
    pub level: LogLevel,
    pub tag: String,
    pub msg: String,
}

impl LogLine {
    pub fn output_stream(&self) -> OutputStream {
        match self.level {
            LogLevel::E | LogLevel::F => OutputStream::Stderr,
            _ => OutputStream::Stdout,
        }
    }

    pub fn to_run_event(&self) -> RunEvent {
        RunEvent::Output {
            stream: self.output_stream(),
            line: format!("{} [{}/{}] {}", self.ts, self.level.as_str(), self.tag, self.msg),
        }
    }
}

/// Format a raw device log line or logcat threadtime line as a `RunEvent::Output`.
/// Preserves ANSI escape sequences and maps error levels to OutputStream::Stderr.
pub fn format_device_log_as_run_event(line: &str) -> RunEvent {
    if let Some(log_line) = parse_logcat_line(line) {
        log_line.to_run_event()
    } else {
        let is_stderr = line.contains(" E/")
            || line.contains(" F/")
            || line.starts_with("[STDERR]")
            || line.starts_with("Error:")
            || line.starts_with("FATAL EXCEPTION");
        let stream = if is_stderr {
            OutputStream::Stderr
        } else {
            OutputStream::Stdout
        };
        RunEvent::Output {
            stream,
            line: line.to_string(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StackLink {
    pub file: String,
    pub line: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub col: Option<u32>,
}

/// Parse a logcat line formatted with `-v threadtime`:
/// `MM-DD HH:MM:SS.mmm  PID  TID L TAG: msg`
pub fn parse_logcat_line(line: &str) -> Option<LogLine> {
    let trimmed = line.trim();
    if trimmed.is_empty() || trimmed.starts_with("---------") {
        return None;
    }

    // Fast path: threadtime timestamp is 18 chars: "MM-DD HH:MM:SS.mmm"
    if line.len() >= 24 {
        let b = line.as_bytes();
        if b[2] == b'-' && b[5] == b' ' && b[8] == b':' && b[11] == b':' && b[14] == b'.' {
            let ts = line[..18].to_string();
            let rest = &line[18..];

            let mut parts = rest.split_whitespace();
            let pid_str = parts.next()?;
            let tid_str = parts.next()?;
            let level_str = parts.next()?;

            if let (Ok(pid), Ok(tid), Some(level_char)) = (
                pid_str.parse::<u32>(),
                tid_str.parse::<u32>(),
                level_str.chars().next(),
            ) {
                if let Some(level) = LogLevel::from_char(level_char) {
                    // Position after level_str in rest
                    if let Some(level_idx) = rest.find(level_str) {
                        let after_level = &rest[level_idx + level_str.len()..];
                        if let Some(colon_pos) = after_level.find(':') {
                            let tag = after_level[..colon_pos].trim().to_string();
                            let raw_msg = &after_level[colon_pos + 1..];
                            let msg = raw_msg.strip_prefix(' ').unwrap_or(raw_msg).to_string();
                            return Some(LogLine {
                                ts,
                                pid,
                                tid,
                                level,
                                tag,
                                msg,
                            });
                        } else {
                            let tag = after_level.trim().to_string();
                            return Some(LogLine {
                                ts,
                                pid,
                                tid,
                                level,
                                tag,
                                msg: String::new(),
                            });
                        }
                    }
                }
            }
        }
    }

    // Fallback regex for non-standard whitespace padding
    static RE: OnceLock<Regex> = OnceLock::new();
    let re = RE.get_or_init(|| {
        Regex::new(r"^(\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d{3})\s+(\d+)\s+(\d+)\s+([VDIWEF])\s+([^:]*?)\s*:\s?(.*)$").unwrap()
    });

    let caps = re.captures(trimmed)?;
    let ts = caps.get(1)?.as_str().to_string();
    let pid: u32 = caps.get(2)?.as_str().parse().ok()?;
    let tid: u32 = caps.get(3)?.as_str().parse().ok()?;
    let level_char = caps.get(4)?.as_str().chars().next()?;
    let level = LogLevel::from_char(level_char)?;
    let tag = caps.get(5)?.as_str().trim().to_string();
    let msg = caps.get(6)?.as_str().to_string();

    Some(LogLine {
        ts,
        pid,
        tid,
        level,
        tag,
        msg,
    })
}

/// Filter log lines by minimum level, tag substring, and message/tag text substring.
pub fn filter(
    lines: &[LogLine],
    level_min: Option<LogLevel>,
    tag: Option<&str>,
    text: Option<&str>,
) -> Vec<LogLine> {
    let tag_lower = tag.map(|t| t.to_lowercase());
    let text_lower = text.map(|t| t.to_lowercase());

    lines
        .iter()
        .filter(|line| {
            if let Some(min) = level_min {
                if line.level < min {
                    return false;
                }
            }
            if let Some(ref t) = tag_lower {
                if !t.is_empty() && !line.tag.to_lowercase().contains(t) {
                    return false;
                }
            }
            if let Some(ref q) = text_lower {
                if !q.is_empty()
                    && !line.msg.to_lowercase().contains(q)
                    && !line.tag.to_lowercase().contains(q)
                {
                    return false;
                }
            }
            true
        })
        .cloned()
        .collect()
}

/// Scan a root directory to find a target file, skipping build, .dart_tool, .gradle, target, .git.
fn find_file_in_root(root: &Path, filename: &str) -> Option<PathBuf> {
    if !root.exists() {
        return None;
    }

    // Direct check first
    let direct = root.join(filename);
    if direct.exists() {
        return Some(direct);
    }

    let target_name = Path::new(filename)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(filename);

    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let entries = match fs::read_dir(&dir) {
            Ok(e) => e,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let p = entry.path();
            let name = match p.file_name().and_then(|n| n.to_str()) {
                Some(n) => n,
                None => continue,
            };

            if p.is_dir() {
                if name == "build"
                    || name == ".dart_tool"
                    || name == ".gradle"
                    || name == ".git"
                    || name == "target"
                    || name == ".idea"
                    || name == ".vscode"
                {
                    continue;
                }
                stack.push(p);
            } else if p.is_file() {
                if name == target_name {
                    return Some(p);
                }
            }
        }
    }
    None
}

/// Extract clickable stack trace links from a log message.
/// Supports Dart (package:..., file:///..., lib/...) and Java/Kotlin (at a.b.C.m(Foo.kt:42)).
pub fn stack_links(msg: &str, root: &Path) -> Vec<StackLink> {
    let mut links = Vec::new();

    // 1. Dart package: `package:<pkg>/<subpath>.dart:line:col` or `...:line`
    static RE_DART_PKG: OnceLock<Regex> = OnceLock::new();
    let re_pkg = RE_DART_PKG.get_or_init(|| {
        Regex::new(r"package:[a-zA-Z0-9_-]+/([a-zA-Z0-9_/-]+\.dart):(\d+)(?::(\d+))?").unwrap()
    });
    for caps in re_pkg.captures_iter(msg) {
        if let (Some(subpath_match), Some(line_match)) = (caps.get(1), caps.get(2)) {
            let subpath = subpath_match.as_str();
            let line: u32 = match line_match.as_str().parse() {
                Ok(l) => l,
                Err(_) => continue,
            };
            let col: Option<u32> = caps.get(3).and_then(|c| c.as_str().parse().ok());

            // Check root/lib/<subpath> first
            let direct = root.join("lib").join(subpath);
            let resolved = if direct.exists() {
                Some(direct)
            } else {
                find_file_in_root(root, subpath)
            };

            if let Some(p) = resolved {
                links.push(StackLink {
                    file: p.to_string_lossy().to_string(),
                    line,
                    col,
                });
            }
        }
    }

    // 2. Dart file uri: `file:///<path>:line:col`
    static RE_FILE_URI: OnceLock<Regex> = OnceLock::new();
    let re_file = RE_FILE_URI.get_or_init(|| {
        Regex::new(r"file://(/[^\s:()]+):(\d+)(?::(\d+))?").unwrap()
    });
    for caps in re_file.captures_iter(msg) {
        if let (Some(path_match), Some(line_match)) = (caps.get(1), caps.get(2)) {
            let raw_path = path_match.as_str();
            let line: u32 = match line_match.as_str().parse() {
                Ok(l) => l,
                Err(_) => continue,
            };
            let col: Option<u32> = caps.get(3).and_then(|c| c.as_str().parse().ok());

            let p = PathBuf::from(raw_path);
            if p.exists() {
                links.push(StackLink {
                    file: p.to_string_lossy().to_string(),
                    line,
                    col,
                });
            }
        }
    }

    // 3. Dart relative `lib/...dart:line:col`
    static RE_LIB_REL: OnceLock<Regex> = OnceLock::new();
    let re_lib = RE_LIB_REL.get_or_init(|| {
        Regex::new(r"(?:^|[\s(])(lib/[a-zA-Z0-9_/-]+\.dart):(\d+)(?::(\d+))?").unwrap()
    });
    for caps in re_lib.captures_iter(msg) {
        if let (Some(rel_match), Some(line_match)) = (caps.get(1), caps.get(2)) {
            let rel = rel_match.as_str();
            let line: u32 = match line_match.as_str().parse() {
                Ok(l) => l,
                Err(_) => continue,
            };
            let col: Option<u32> = caps.get(3).and_then(|c| c.as_str().parse().ok());

            let target = root.join(rel);
            if target.exists() {
                links.push(StackLink {
                    file: target.to_string_lossy().to_string(),
                    line,
                    col,
                });
            }
        }
    }

    // 4. Java/Kotlin stack trace: `at a.b.C.m(Foo.kt:42)` or `at a.b.C.m(Foo.java:42)`
    static RE_JVM_STACK: OnceLock<Regex> = OnceLock::new();
    let re_jvm = RE_JVM_STACK.get_or_init(|| {
        Regex::new(r"\bat\s+[a-zA-Z0-9_$.]+\(([^:)]+\.(?:kt|java)):(\d+)(?::(\d+))?\)").unwrap()
    });
    for caps in re_jvm.captures_iter(msg) {
        if let (Some(file_match), Some(line_match)) = (caps.get(1), caps.get(2)) {
            let filename = file_match.as_str();
            let line: u32 = match line_match.as_str().parse() {
                Ok(l) => l,
                Err(_) => continue,
            };
            let col: Option<u32> = caps.get(3).and_then(|c| c.as_str().parse().ok());

            if let Some(p) = find_file_in_root(root, filename) {
                links.push(StackLink {
                    file: p.to_string_lossy().to_string(),
                    line,
                    col,
                });
            }
        }
    }

    links
}

/// Manage background logcat streaming for a specific device and PID,
/// batching lines (<=50ms or 500 lines) before sending through `tx`.
pub struct Logcat {
    proc: Box<dyn Proc>,
    _worker: Option<thread::JoinHandle<()>>,
}

impl Logcat {
    pub fn start(
        spawn: &dyn Spawn,
        device: &str,
        pid: Option<u32>,
        tx: Sender<Vec<LogLine>>,
    ) -> io::Result<Self> {
        if !is_valid_device_id(device) {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                format!("invalid device ID: {}", device),
            ));
        }

        let adb_cmd = resolve_adb_binary();
        let (proc_tx, proc_rx) = std::sync::mpsc::channel();
        let pid_arg = pid.map(|p| format!("--pid={}", p));

        let mut args = vec!["-s", device, "logcat", "-v", "threadtime"];
        if let Some(ref arg) = pid_arg {
            args.push(arg.as_str());
        }

        let proc = spawn.spawn(
            Path::new("."),
            &adb_cmd,
            &args,
            &[],
            proc_tx,
        )?;

        let worker = thread::spawn(move || {
            let mut batch = Vec::with_capacity(500);
            let mut last_flush = Instant::now();
            let flush_interval = Duration::from_millis(50);

            loop {
                let remaining = flush_interval.saturating_sub(last_flush.elapsed());
                let timeout = if remaining.is_zero() {
                    Duration::from_millis(5)
                } else {
                    remaining
                };

                match proc_rx.recv_timeout(timeout) {
                    Ok(ProcLine::Stdout(line)) => {
                        if let Some(parsed) = parse_logcat_line(&line) {
                            batch.push(parsed);
                        }
                        if batch.len() >= 500 || last_flush.elapsed() >= flush_interval {
                            if !batch.is_empty() {
                                if tx.send(std::mem::take(&mut batch)).is_err() {
                                    break;
                                }
                                last_flush = Instant::now();
                            }
                        }
                    }
                    Ok(ProcLine::Stderr(_)) => {}
                    Ok(ProcLine::Exit(_)) => {
                        if !batch.is_empty() {
                            let _ = tx.send(batch);
                        }
                        break;
                    }
                    Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                        if !batch.is_empty() && last_flush.elapsed() >= flush_interval {
                            if tx.send(std::mem::take(&mut batch)).is_err() {
                                break;
                            }
                            last_flush = Instant::now();
                        }
                    }
                    Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                        if !batch.is_empty() {
                            let _ = tx.send(batch);
                        }
                        break;
                    }
                }
            }
        });

        Ok(Self {
            proc,
            _worker: Some(worker),
        })
    }

    /// Start background logcat streaming directly to a RunEvent channel.
    pub fn start_streaming_events(
        spawn: &dyn Spawn,
        device: &str,
        pid: Option<u32>,
        tx: Sender<RunEvent>,
    ) -> io::Result<Self> {
        if !is_valid_device_id(device) {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                format!("invalid device ID: {}", device),
            ));
        }

        let adb_cmd = resolve_adb_binary();
        let (proc_tx, proc_rx) = std::sync::mpsc::channel();
        let pid_arg = pid.map(|p| format!("--pid={}", p));

        let mut args = vec!["-s", device, "logcat", "-v", "threadtime"];
        if let Some(ref arg) = pid_arg {
            args.push(arg.as_str());
        }

        let proc = spawn.spawn(
            Path::new("."),
            &adb_cmd,
            &args,
            &[],
            proc_tx,
        )?;

        let worker = thread::spawn(move || {
            while let Ok(line) = proc_rx.recv() {
                match line {
                    ProcLine::Stdout(text) => {
                        let event = format_device_log_as_run_event(&text);
                        if tx.send(event).is_err() {
                            break;
                        }
                    }
                    ProcLine::Stderr(text) => {
                        let event = RunEvent::Output {
                            stream: OutputStream::Stderr,
                            line: text,
                        };
                        if tx.send(event).is_err() {
                            break;
                        }
                    }
                    ProcLine::Exit(_) => break,
                }
            }
        });

        Ok(Self {
            proc,
            _worker: Some(worker),
        })
    }

    pub fn stop(&mut self) -> io::Result<()> {
        self.proc.kill()
    }
}

impl Drop for Logcat {
    fn drop(&mut self) {
        let _ = self.stop();
    }
}

#[derive(Deserialize)]
struct IosNdjsonLine {
    #[serde(default)]
    timestamp: Option<String>,
    #[serde(rename = "processID", default)]
    process_id: Option<u32>,
    #[serde(rename = "threadID", default)]
    thread_id: Option<u32>,
    #[serde(rename = "messageType", default)]
    message_type: Option<String>,
    #[serde(default)]
    subsystem: Option<String>,
    #[serde(default)]
    category: Option<String>,
    #[serde(rename = "eventMessage", default)]
    event_message: Option<String>,
}

/// Parse one JSON line from macOS `log stream --style ndjson`.
/// Note: fixture-tested, not yet verified on live Mac.
pub fn parse_ios_log_line(line: &str) -> Option<LogLine> {
    let trimmed = line.trim();
    if trimmed.is_empty() || !trimmed.starts_with('{') {
        return None;
    }
    let parsed: IosNdjsonLine = serde_json::from_str(trimmed).ok()?;
    let level = match parsed.message_type.as_deref() {
        Some("Fault") => LogLevel::F,
        Some("Error") => LogLevel::E,
        Some("Debug") => LogLevel::D,
        _ => LogLevel::I,
    };
    let tag = parsed
        .subsystem
        .filter(|s| !s.is_empty())
        .or(parsed.category.filter(|c| !c.is_empty()))
        .unwrap_or_else(|| "ios".to_string());

    Some(LogLine {
        ts: parsed.timestamp.unwrap_or_default(),
        pid: parsed.process_id.unwrap_or(0),
        tid: parsed.thread_id.unwrap_or(0),
        level,
        tag,
        msg: parsed.event_message.unwrap_or_default(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn test_parse_logcat_threadtime_basic() {
        let line = "09-29 10:15:30.123  1234  5678 I PETAK: PETAK_HELLO world";
        let parsed = parse_logcat_line(line).expect("Should parse threadtime log line");
        assert_eq!(parsed.ts, "09-29 10:15:30.123");
        assert_eq!(parsed.pid, 1234);
        assert_eq!(parsed.tid, 5678);
        assert_eq!(parsed.level, LogLevel::I);
        assert_eq!(parsed.tag, "PETAK");
        assert_eq!(parsed.msg, "PETAK_HELLO world");
    }

    #[test]
    fn test_parse_logcat_threadtime_various_levels() {
        let lines = [
            ("09-29 10:15:30.100  100  200 V VerboseTag: verbose msg", LogLevel::V),
            ("09-29 10:15:30.200  100  200 D DebugTag: debug msg", LogLevel::D),
            ("09-29 10:15:30.300  100  200 I InfoTag: info msg", LogLevel::I),
            ("09-29 10:15:30.400  100  200 W WarnTag: warn msg", LogLevel::W),
            ("09-29 10:15:30.500  100  200 E ErrorTag: error msg", LogLevel::E),
            ("09-29 10:15:30.600  100  200 F FatalTag: fatal msg", LogLevel::F),
        ];

        for (raw, expected_lvl) in lines {
            let p = parse_logcat_line(raw).unwrap();
            assert_eq!(p.level, expected_lvl);
        }
    }

    #[test]
    fn test_parse_logcat_ignores_boundary_headers() {
        assert!(parse_logcat_line("--------- beginning of main").is_none());
        assert!(parse_logcat_line("--------- beginning of system").is_none());
        assert!(parse_logcat_line("").is_none());
    }

    #[test]
    fn test_filter_logs() {
        let lines = vec![
            LogLine {
                ts: "09-29 10:00:00.000".into(),
                pid: 1,
                tid: 1,
                level: LogLevel::D,
                tag: "Flutter".into(),
                msg: "App launched".into(),
            },
            LogLine {
                ts: "09-29 10:00:01.000".into(),
                pid: 1,
                tid: 1,
                level: LogLevel::I,
                tag: "PETAK".into(),
                msg: "User logged in".into(),
            },
            LogLine {
                ts: "09-29 10:00:02.000".into(),
                pid: 1,
                tid: 1,
                level: LogLevel::W,
                tag: "PETAK".into(),
                msg: "Slow query detected".into(),
            },
            LogLine {
                ts: "09-29 10:00:03.000".into(),
                pid: 1,
                tid: 1,
                level: LogLevel::E,
                tag: "Network".into(),
                msg: "Connection refused".into(),
            },
        ];

        // Filter min level W -> should get W and E
        let w_and_above = filter(&lines, Some(LogLevel::W), None, None);
        assert_eq!(w_and_above.len(), 2);
        assert_eq!(w_and_above[0].level, LogLevel::W);
        assert_eq!(w_and_above[1].level, LogLevel::E);

        // Filter tag "petak"
        let tag_petak = filter(&lines, None, Some("petak"), None);
        assert_eq!(tag_petak.len(), 2);

        // Filter text "query"
        let text_query = filter(&lines, None, None, Some("query"));
        assert_eq!(text_query.len(), 1);
        assert_eq!(text_query[0].tag, "PETAK");
    }

    #[test]
    fn test_benchmark_10k_synthetic_log_lines() {
        let synthetic_lines: Vec<String> = (0..10_000)
            .map(|i| format!("09-29 10:15:{:02}.{:03}  {:5}  {:5} I PetakTag: Message {}", i / 1000 % 60, i % 1000, 1000 + i % 500, 2000 + i % 500, i))
            .collect();

        let start = Instant::now();
        let mut parsed_count = 0;
        for line in &synthetic_lines {
            if let Some(_l) = parse_logcat_line(line) {
                parsed_count += 1;
            }
        }
        let elapsed = start.elapsed();
        println!("==> 10,000 synthetic logcat lines parsed in {:.2?} ({} lines parsed)", elapsed, parsed_count);
        assert_eq!(parsed_count, 10_000);
        // Performance sanity check: 10k lines should easily parse in under 50ms
        assert!(elapsed < Duration::from_millis(100), "10k lines parsing took too long: {:?}", elapsed);
    }

    #[test]
    fn test_stack_links_dart_and_kotlin() {
        let dir = tempdir().unwrap();
        let root = dir.path();

        // Create sample dart and kotlin files
        let lib_dir = root.join("lib");
        fs::create_dir_all(&lib_dir).unwrap();
        let main_dart = lib_dir.join("main.dart");
        fs::write(&main_dart, "// dart main").unwrap();

        let kotlin_dir = root.join("app/src/main/kotlin/com/example");
        fs::create_dir_all(&kotlin_dir).unwrap();
        let main_kt = kotlin_dir.join("MainActivity.kt");
        fs::write(&main_kt, "// kotlin main").unwrap();

        // 1. Dart package:
        let msg_dart = "Unhandled exception: error at package:my_app/main.dart:45:10";
        let links1 = stack_links(msg_dart, root);
        assert_eq!(links1.len(), 1);
        assert_eq!(links1[0].file, main_dart.to_string_lossy().to_string());
        assert_eq!(links1[0].line, 45);
        assert_eq!(links1[0].col, Some(10));

        // 2. Dart lib/
        let msg_lib = "at (lib/main.dart:12:3)";
        let links2 = stack_links(msg_lib, root);
        assert_eq!(links2.len(), 1);
        assert_eq!(links2[0].file, main_dart.to_string_lossy().to_string());
        assert_eq!(links2[0].line, 12);
        assert_eq!(links2[0].col, Some(3));

        // 3. JVM stack trace:
        let msg_jvm = "java.lang.NullPointerException\n  at com.example.MainActivity.onCreate(MainActivity.kt:88)";
        let links3 = stack_links(msg_jvm, root);
        assert_eq!(links3.len(), 1);
        assert_eq!(links3[0].file, main_kt.to_string_lossy().to_string());
        assert_eq!(links3[0].line, 88);
        assert_eq!(links3[0].col, None);
    }

    #[test]
    fn test_parse_ios_log_line_fixture() {
        // Fixture: ndjson format from `log stream --style ndjson`
        // Marked: fixture, belum diverifikasi di Mac
        let fixture = r#"{"timestamp":"2026-09-29 10:15:30.123456+0700","processID":4321,"threadID":8765,"messageType":"Error","subsystem":"id.petak.sample","category":"default","eventMessage":"Failed to connect to socket"}"#;
        let parsed = parse_ios_log_line(fixture).expect("Should parse iOS ndjson line");
        assert_eq!(parsed.pid, 4321);
        assert_eq!(parsed.tid, 8765);
        assert_eq!(parsed.level, LogLevel::E);
        assert_eq!(parsed.tag, "id.petak.sample");
        assert_eq!(parsed.msg, "Failed to connect to socket");
    }
}
