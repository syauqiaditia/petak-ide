use std::io;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::Sender;
use std::sync::Arc;
use std::thread;
use std::time::Duration;
use tempfile::tempdir;

use petak_core::exec::{Proc, ProcLine, Spawn};
use petak_core::run::{
    format_device_log_as_run_event, FlutterRun, LogLevel, LogLine, OutputStream, RunConfig,
    RunEvent, RunKind,
};

struct MockProc {
    pid: u32,
    killed: Arc<AtomicBool>,
}

impl Proc for MockProc {
    fn stdin_write(&mut self, _bytes: &[u8]) -> io::Result<()> {
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
    lines: Vec<ProcLine>,
    killed: Arc<AtomicBool>,
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
        let lines = self.lines.clone();
        thread::spawn(move || {
            for line in lines {
                let _ = tx.send(line);
                thread::sleep(Duration::from_millis(5));
            }
        });

        Ok(Box::new(MockProc {
            pid: 12345,
            killed: Arc::clone(&self.killed),
        }))
    }
}

fn test_run_config() -> RunConfig {
    RunConfig {
        name: "test".to_string(),
        kind: RunKind::Flutter,
        target: None,
        flavor: None,
        dart_defines: vec![],
        additional_args: None,
        module: None,
        variant: None,
        application_id: None,
        activity: None,
    }
}

#[test]
fn test_flutter_output_streaming_non_daemon_stdout_with_ansi() {
    let dir = tempdir().unwrap();
    let killed = Arc::new(AtomicBool::new(false));

    let ansi_line1 = "\x1b[32mLaunching lib/main.dart on emulator-5554 in debug mode...\x1b[0m";
    let ansi_line2 = "\x1b[34m[INFO]\x1b[0m Syncing files to device emulator-5554...";
    let lines = vec![
        ProcLine::Stdout(r#"[{"event":"app.start","params":{"appId":"mock_app"}}]"#.to_string()),
        ProcLine::Stdout(ansi_line1.to_string()),
        ProcLine::Stdout(ansi_line2.to_string()),
        ProcLine::Stdout(r#"[{"event":"app.started","params":{"appId":"mock_app"}}]"#.to_string()),
    ];

    let spawn = MockSpawn {
        lines,
        killed: Arc::clone(&killed),
    };

    let (event_tx, event_rx) = std::sync::mpsc::channel();
    let cfg = test_run_config();

    let _runner = FlutterRun::start(&spawn, dir.path(), &cfg, "emulator-5554", event_tx)
        .expect("FlutterRun::start should succeed");

    let mut captured_outputs = Vec::new();
    let deadline = std::time::Instant::now() + Duration::from_secs(2);
    while std::time::Instant::now() < deadline {
        if let Ok(RunEvent::Output { stream, line }) =
            event_rx.recv_timeout(Duration::from_millis(50))
        {
            captured_outputs.push((stream, line));
            if captured_outputs.len() >= 2 {
                break;
            }
        }
    }

    assert_eq!(captured_outputs.len(), 2);
    assert_eq!(captured_outputs[0].0, OutputStream::Stdout);
    assert_eq!(captured_outputs[0].1, ansi_line1);
    assert!(captured_outputs[0].1.contains("\x1b[32m"));

    assert_eq!(captured_outputs[1].0, OutputStream::Stdout);
    assert_eq!(captured_outputs[1].1, ansi_line2);
    assert!(captured_outputs[1].1.contains("\x1b[34m"));
}

#[test]
fn test_flutter_output_streaming_app_log_with_ansi_and_stderr() {
    let dir = tempdir().unwrap();
    let killed = Arc::new(AtomicBool::new(false));

    let dart_print_log = "\x1b[36m[BANK JATIM LOG]\x1b[0m User session refreshed token #12345";
    let dart_error_log = "\x1b[31m[ERROR]\x1b[0m Unhandled Exception: ServerException(500)";

    let lines = vec![
        ProcLine::Stdout(r#"[{"event":"app.start","params":{"appId":"mock_app"}}]"#.to_string()),
        ProcLine::Stdout(serde_json::to_string(&serde_json::json!([{
            "event": "app.log",
            "params": {
                "appId": "mock_app",
                "log": format!("{}\n", dart_print_log),
            }
        }])).unwrap()),
        ProcLine::Stdout(serde_json::to_string(&serde_json::json!([{
            "event": "app.log",
            "params": {
                "appId": "mock_app",
                "log": format!("{}\n", dart_error_log),
                "error": true,
            }
        }])).unwrap()),
    ];

    let spawn = MockSpawn {
        lines,
        killed: Arc::clone(&killed),
    };

    let (event_tx, event_rx) = std::sync::mpsc::channel();
    let cfg = test_run_config();

    let _runner = FlutterRun::start(&spawn, dir.path(), &cfg, "emulator-5554", event_tx)
        .expect("FlutterRun::start should succeed");

    let mut captured_outputs = Vec::new();
    let deadline = std::time::Instant::now() + Duration::from_secs(2);
    while std::time::Instant::now() < deadline {
        if let Ok(RunEvent::Output { stream, line }) =
            event_rx.recv_timeout(Duration::from_millis(50))
        {
            captured_outputs.push((stream, line));
            if captured_outputs.len() >= 2 {
                break;
            }
        }
    }

    assert_eq!(captured_outputs.len(), 2);
    // Regular app.log -> Stdout
    assert_eq!(captured_outputs[0].0, OutputStream::Stdout);
    assert!(captured_outputs[0].1.contains(dart_print_log));
    assert!(captured_outputs[0].1.contains("\x1b[36m"));

    // Error app.log -> Stderr
    assert_eq!(captured_outputs[1].0, OutputStream::Stderr);
    assert!(captured_outputs[1].1.contains(dart_error_log));
    assert!(captured_outputs[1].1.contains("\x1b[31m"));
}

#[test]
fn test_flutter_output_streaming_stderr_proc_lines() {
    let dir = tempdir().unwrap();
    let killed = Arc::new(AtomicBool::new(false));

    let err1 = "\x1b[31mFAILURE: Build failed with an exception.\x1b[0m";
    let err2 = "* What went wrong: Execution failed for task ':app:compileFlutterBuildDebug'.";

    let lines = vec![
        ProcLine::Stderr(err1.to_string()),
        ProcLine::Stderr(err2.to_string()),
    ];

    let spawn = MockSpawn {
        lines,
        killed: Arc::clone(&killed),
    };

    let (event_tx, event_rx) = std::sync::mpsc::channel();
    let cfg = test_run_config();

    let _runner = FlutterRun::start(&spawn, dir.path(), &cfg, "emulator-5554", event_tx)
        .expect("FlutterRun::start should succeed");

    let mut captured_outputs = Vec::new();
    let deadline = std::time::Instant::now() + Duration::from_secs(2);
    while std::time::Instant::now() < deadline {
        if let Ok(RunEvent::Output { stream, line }) =
            event_rx.recv_timeout(Duration::from_millis(50))
        {
            captured_outputs.push((stream, line));
            if captured_outputs.len() >= 2 {
                break;
            }
        }
    }

    assert_eq!(captured_outputs.len(), 2);
    assert_eq!(captured_outputs[0].0, OutputStream::Stderr);
    assert_eq!(captured_outputs[0].1, err1);
    assert!(captured_outputs[0].1.contains("\x1b[31m"));

    assert_eq!(captured_outputs[1].0, OutputStream::Stderr);
    assert_eq!(captured_outputs[1].1, err2);
}

#[test]
fn test_device_log_conversion_and_streaming() {
    // 1. Threadtime logcat info
    let info_line = "10-07 14:00:00.123  1001  2002 I JConnect: Welcome to Bank Jatim";
    let event_info = format_device_log_as_run_event(info_line);
    if let RunEvent::Output { stream, line } = event_info {
        assert_eq!(stream, OutputStream::Stdout);
        assert!(line.contains("[I/JConnect] Welcome to Bank Jatim"));
    } else {
        panic!("expected RunEvent::Output");
    }

    // 2. Threadtime logcat error -> OutputStream::Stderr
    let err_line = "10-07 14:00:01.456  1001  2002 E JConnect: Network connection timeout";
    let event_err = format_device_log_as_run_event(err_line);
    if let RunEvent::Output { stream, line } = event_err {
        assert_eq!(stream, OutputStream::Stderr);
        assert!(line.contains("[E/JConnect] Network connection timeout"));
    } else {
        panic!("expected RunEvent::Output");
    }

    // 3. Raw ANSI device output line
    let raw_ansi = "\x1b[33m[DEVICE WARN] Battery level low (15%)\x1b[0m";
    let event_raw = format_device_log_as_run_event(raw_ansi);
    if let RunEvent::Output { stream, line } = event_raw {
        assert_eq!(stream, OutputStream::Stdout);
        assert_eq!(line, raw_ansi);
        assert!(line.contains("\x1b[33m"));
    } else {
        panic!("expected RunEvent::Output");
    }

    // 4. LogLine helper
    let log_line = LogLine {
        ts: "10-07 14:00:02.000".to_string(),
        pid: 1001,
        tid: 2002,
        level: LogLevel::F,
        tag: "FatalCrash".to_string(),
        msg: "SIGSEGV in libflutter.so".to_string(),
    };
    assert_eq!(log_line.output_stream(), OutputStream::Stderr);
    let event = log_line.to_run_event();
    if let RunEvent::Output { stream, line } = event {
        assert_eq!(stream, OutputStream::Stderr);
        assert!(line.contains("[F/FatalCrash] SIGSEGV"));
    } else {
        panic!("expected RunEvent::Output");
    }
}
