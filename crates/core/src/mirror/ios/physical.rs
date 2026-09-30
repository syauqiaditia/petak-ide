use std::io::{self, BufRead, BufReader};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc::{self, Receiver};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use crate::exec::Exec;
use crate::mirror::control::InputEvent;
use crate::mirror::ios::input::send_physical_input;
use crate::mirror::ios::simulator::resolve_swift_helper_path;
use crate::mirror::ios::stream::read_ios_frame_packet;
use crate::mirror::session::{MirrorInfo, MirrorStatus};
use crate::run::ios::is_valid_udid;

/// Handle to a running physical iPhone mirror session.
/// Strictly view-only via CoreMediaIO / AVFoundation.
pub struct IosPhysicalSession {
    pub identifier: String,
    child: Arc<Mutex<Option<Child>>>,
    _reader_thread: Option<thread::JoinHandle<()>>,
    _stderr_thread: Option<thread::JoinHandle<()>>,
}

impl IosPhysicalSession {
    /// Start physical iPhone capture via CoreMediaIO/AVFoundation.
    /// Returns `(MirrorInfo, session, frame_rx, status_rx)`.
    pub fn start(
        _exec: &dyn Exec,
        identifier: &str,
        max_size: u16,
    ) -> io::Result<(MirrorInfo, Self, Receiver<Vec<u8>>, Receiver<MirrorStatus>)> {
        if !is_valid_udid(identifier) {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                format!("invalid physical iOS device identifier: {}", identifier),
            ));
        }

        let (status_tx, status_rx) = mpsc::channel();
        let (frame_tx, frame_rx) = mpsc::channel();

        let _ = status_tx.send(MirrorStatus::Connecting);

        let helper_path = resolve_swift_helper_path();
        let width = 1179.min(max_size as u32);
        let height = 2556.min((max_size as f32 * 2.16) as u32);

        let mut cmd = if helper_path.extension().and_then(|s| s.to_str()) == Some("swift") {
            let mut c = Command::new("swift");
            c.arg(&helper_path);
            c
        } else {
            Command::new(&helper_path)
        };
        crate::toolchain::apply_env(&mut cmd);

        cmd.args(&[
            "--mode",
            "physical",
            "--udid",
            identifier,
            "--width",
            &width.to_string(),
            "--height",
            &height.to_string(),
            "--fps",
            "60",
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .stdin(Stdio::null());

        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            cmd.process_group(0);
        }

        let mut child = cmd.spawn().map_err(|e| {
            io::Error::new(
                io::ErrorKind::Other,
                format!("failed to spawn physical iOS capture helper: {}", e),
            )
        })?;

        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| io::Error::new(io::ErrorKind::Other, "failed to open capture stdout"))?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| io::Error::new(io::ErrorKind::Other, "failed to open capture stderr"))?;

        let child_arc = Arc::new(Mutex::new(Some(child)));
        let child_arc2 = Arc::clone(&child_arc);

        let has_live_frame = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let hlf_status = Arc::clone(&has_live_frame);
        let hlf_reader = Arc::clone(&has_live_frame);

        // 15-second watchdog timer on awaiting capture stream
        let watchdog_tx = status_tx.clone();
        let watchdog_child = Arc::clone(&child_arc);
        let hlf_watchdog = Arc::clone(&has_live_frame);
        thread::spawn(move || {
            thread::sleep(Duration::from_secs(15));
            if !hlf_watchdog.load(std::sync::atomic::Ordering::SeqCst) {
                let _ = watchdog_tx.send(MirrorStatus::Failed {
                    reason: "Awaiting AVFoundation screen capture stream timed out (15s)".to_string(),
                });
                if let Ok(mut guard) = watchdog_child.lock() {
                    if let Some(mut proc) = guard.take() {
                        #[cfg(unix)]
                        {
                            let pid = proc.id() as i32;
                            unsafe {
                                libc::killpg(pid, libc::SIGKILL);
                            }
                        }
                        let _ = proc.kill();
                        let _ = proc.wait();
                    }
                }
            }
        });

        // Stderr monitor thread
        let status_tx_clone = status_tx.clone();
        let stderr_thread = thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines() {
                if let Ok(l) = line {
                    let trimmed = l.trim();
                    if trimmed.starts_with('{') && trimmed.ends_with('}') {
                        if let Ok(val) = serde_json::from_str::<serde_json::Value>(trimmed) {
                            if let Some(status_str) = val.get("status").and_then(|v| v.as_str()) {
                                match status_str {
                                    "live" => {
                                        hlf_status.store(true, std::sync::atomic::Ordering::SeqCst);
                                        let w = val
                                            .get("width")
                                            .and_then(|v| v.as_u64())
                                            .unwrap_or(width as u64)
                                            as u32;
                                        let h = val
                                            .get("height")
                                            .and_then(|v| v.as_u64())
                                            .unwrap_or(height as u64)
                                            as u32;
                                        let _ = status_tx_clone.send(MirrorStatus::Live {
                                            width: w,
                                            height: h,
                                        });
                                    }
                                    "needs_usb" => {
                                        let message = val
                                            .get("message")
                                            .and_then(|v| v.as_str())
                                            .unwrap_or("Mirror iPhone butuh kabel USB. Colok iPhone, buka kunci layar, pilih Trust")
                                            .to_string();
                                        let _ = status_tx_clone.send(MirrorStatus::NeedsUsb { message });
                                    }
                                    "failed" => {
                                        let reason = val
                                            .get("reason")
                                            .or_else(|| val.get("message"))
                                            .and_then(|v| v.as_str())
                                            .unwrap_or("Awaiting capture stream timed out")
                                            .to_string();
                                        let _ = status_tx_clone.send(MirrorStatus::Failed { reason });
                                    }
                                    "disconnected" => {
                                        let reason = val
                                            .get("reason")
                                            .and_then(|v| v.as_str())
                                            .unwrap_or("stream closed")
                                            .to_string();
                                        let _ = status_tx_clone
                                            .send(MirrorStatus::Disconnected { reason });
                                    }
                                    "error" => {
                                        let message = val
                                            .get("message")
                                            .and_then(|v| v.as_str())
                                            .unwrap_or("capture error")
                                            .to_string();
                                        let _ =
                                            status_tx_clone.send(MirrorStatus::Error { message });
                                    }
                                    _ => {}
                                }
                            }
                        }
                    }
                }
            }
        });

        // Frame reader thread
        let status_tx_clone2 = status_tx;
        let reader_thread = thread::spawn(move || {
            let mut reader = BufReader::new(stdout);
            loop {
                match read_ios_frame_packet(&mut reader) {
                    Ok(Some(packet)) => {
                        hlf_reader.store(true, std::sync::atomic::Ordering::SeqCst);
                        if frame_tx.send(packet).is_err() {
                            break;
                        }
                    }
                    Ok(None) => {
                        let _ = status_tx_clone2.send(MirrorStatus::Disconnected {
                            reason: "physical iOS capture process exited".to_string(),
                        });
                        break;
                    }
                    Err(e) => {
                        let _ = status_tx_clone2.send(MirrorStatus::Disconnected {
                            reason: format!("physical iOS packet read error: {}", e),
                        });
                        break;
                    }
                }
            }
            if let Ok(mut guard) = child_arc2.lock() {
                if let Some(mut proc) = guard.take() {
                    #[cfg(unix)]
                    {
                        let pid = proc.id() as i32;
                        unsafe {
                            libc::killpg(pid, libc::SIGKILL);
                        }
                    }
                    let _ = proc.kill();
                    let _ = proc.wait();
                }
            }
        });

        let info = MirrorInfo {
            serial: identifier.to_string(),
            name: format!("iPhone ({})", identifier),
            width,
            height,
            codec: "h264".to_string(),
        };

        Ok((
            info,
            Self {
                identifier: identifier.to_string(),
                child: child_arc,
                _reader_thread: Some(reader_thread),
                _stderr_thread: Some(stderr_thread),
            },
            frame_rx,
            status_rx,
        ))
    }

    /// Physical iPhone input: strictly view-only.
    pub fn send_input(&self, event: &InputEvent) -> io::Result<()> {
        send_physical_input(event)
    }

    /// Stop physical mirror session.
    pub fn stop(&self) {
        if let Ok(mut guard) = self.child.lock() {
            if let Some(mut proc) = guard.take() {
                #[cfg(unix)]
                {
                    let pid = proc.id() as i32;
                    unsafe {
                        libc::killpg(pid, libc::SIGKILL);
                    }
                }
                let _ = proc.kill();
                let _ = proc.wait();
            }
        }
    }
}

impl Drop for IosPhysicalSession {
    fn drop(&mut self) {
        self.stop();
    }
}
