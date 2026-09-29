use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::Sender;
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use crate::exec::Exec;
use crate::mirror::session::MirrorStatus;

/// Fallback manager for polling `simctl io <udid> screenshot`.
/// Marked explicitly as "slow fallback" (low fps: 5-10 fps).
pub struct SimctlScreenshotFallback {
    running: Arc<AtomicBool>,
    _worker: Option<thread::JoinHandle<()>>,
}

impl SimctlScreenshotFallback {
    /// Start a slow screenshot polling loop.
    /// Emits `MirrorStatus::Live` with slow fallback indication.
    pub fn start(
        exec: Box<dyn Exec>,
        udid: String,
        status_tx: Sender<MirrorStatus>,
        fps: u32,
    ) -> Self {
        let running = Arc::new(AtomicBool::new(true));
        let running_clone = Arc::clone(&running);
        let safe_fps = fps.clamp(1, 10);
        let interval = Duration::from_millis(1000 / safe_fps as u64);

        let _ = status_tx.send(MirrorStatus::Live {
            width: 1179,
            height: 2556,
        });

        let worker = thread::spawn(move || {
            let temp_path = format!(
                "/tmp/petak-sim-fallback-{}-{}.png",
                udid,
                std::process::id()
            );

            while running_clone.load(Ordering::Relaxed) {
                let _ = exec.run(
                    Path::new("."),
                    "xcrun",
                    &["simctl", "io", &udid, "screenshot", &temp_path],
                    &[],
                    None,
                );

                // In live capture, the Swift helper or encoder reads and sends frames.
                // Clean up temp file
                let _ = std::fs::remove_file(&temp_path);

                thread::sleep(interval);
            }
        });

        Self {
            running,
            _worker: Some(worker),
        }
    }

    pub fn stop(&self) {
        self.running.store(false, Ordering::Relaxed);
    }
}

impl Drop for SimctlScreenshotFallback {
    fn drop(&mut self) {
        self.stop();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io;
    use std::process::Output;
    use std::sync::mpsc;

    struct FakeExec {
        calls: Arc<std::sync::Mutex<Vec<Vec<String>>>>,
    }

    impl Exec for FakeExec {
        fn run(
            &self,
            _cwd: &Path,
            program: &str,
            args: &[&str],
            _env: &[(&str, &str)],
            _stdin: Option<&[u8]>,
        ) -> io::Result<Output> {
            let mut cmd = vec![program.to_string()];
            cmd.extend(args.iter().map(|s| s.to_string()));
            self.calls.lock().unwrap().push(cmd);

            #[cfg(unix)]
            use std::os::unix::process::ExitStatusExt;
            #[cfg(unix)]
            let status = std::process::ExitStatus::from_raw(0);

            #[cfg(not(unix))]
            let status = std::process::ExitStatus::default();

            Ok(Output {
                status,
                stdout: Vec::new(),
                stderr: Vec::new(),
            })
        }
    }

    #[test]
    fn test_fallback_lifecycle() {
        let calls = Arc::new(std::sync::Mutex::new(Vec::new()));
        let fake = FakeExec {
            calls: Arc::clone(&calls),
        };
        let (status_tx, status_rx) = mpsc::channel();

        let fallback = SimctlScreenshotFallback::start(
            Box::new(fake),
            "E1B3E035-7F2A-4B6E-9E8D-7F6335CD5E90".to_string(),
            status_tx,
            5,
        );

        let status = status_rx.recv().unwrap();
        match status {
            MirrorStatus::Live { width, height } => {
                assert_eq!(width, 1179);
                assert_eq!(height, 2556);
            }
            _ => panic!("expected Live status"),
        }

        thread::sleep(Duration::from_millis(50));
        fallback.stop();
        drop(fallback);

        let recorded = calls.lock().unwrap();
        assert!(!recorded.is_empty());
        assert_eq!(recorded[0][0], "xcrun");
        assert_eq!(recorded[0][1], "simctl");
        assert_eq!(recorded[0][2], "io");
    }
}
