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
        exec: &dyn Exec,
        identifier: &str,
        max_size: u16,
    ) -> io::Result<(MirrorInfo, Self, Receiver<Vec<u8>>, Receiver<MirrorStatus>)> {
        Self::start_with_name(exec, identifier, None, max_size)
    }

    /// Start physical iPhone capture via CoreMediaIO/AVFoundation with optional device name.
    /// Returns `(MirrorInfo, session, frame_rx, status_rx)`.
    pub fn start_with_name(
        exec: &dyn Exec,
        identifier: &str,
        device_name: Option<&str>,
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
        let (width, height) = compute_physical_dimensions(max_size);

        // Resolve device name if not explicitly passed
        let mut resolved_name = device_name
            .filter(|s| !s.trim().is_empty())
            .map(|s| s.trim().to_string());
        if resolved_name.is_none() {
            if let Ok(out) = exec.run(
                std::path::Path::new("."),
                "xcrun",
                &["devicectl", "list", "devices", "--json-output", "-"],
                &[],
                None,
            ) {
                let json_str = String::from_utf8_lossy(&out.stdout);
                if let Ok(devices) = crate::run::ios::parse_devicectl_devices(&json_str) {
                    if let Some(d) = devices.into_iter().find(|d| d.id == identifier) {
                        if !d.name.trim().is_empty() {
                            resolved_name = Some(d.name.trim().to_string());
                        }
                    }
                }
            }
        }

        let mut cmd = if helper_path.extension().and_then(|s| s.to_str()) == Some("swift") {
            let mut c = Command::new("swift");
            c.arg(&helper_path);
            c
        } else {
            Command::new(&helper_path)
        };
        crate::toolchain::apply_env(&mut cmd);

        let mut args = vec![
            "--mode".to_string(),
            "physical".to_string(),
            "--udid".to_string(),
            identifier.to_string(),
        ];
        if let Some(ref name) = resolved_name {
            args.push("--device-name".to_string());
            args.push(name.clone());
        }
        let w_str = width.to_string();
        let h_str = height.to_string();
        args.extend_from_slice(&[
            "--width".to_string(),
            w_str,
            "--height".to_string(),
            h_str,
            "--fps".to_string(),
            "60".to_string(),
        ]);

        cmd.args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .stdin(Stdio::null());

        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            cmd.process_group(0);
        }

        // Clean up stale physical capture processes to prevent USB frame bandwidth contention
        let _ = Command::new("pkill")
            .args(["-f", "petak_ios_capture.*--mode.*physical"])
            .status();

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

        let recent_stderr = Arc::new(Mutex::new(Vec::<String>::new()));
        let recent_stderr_writer = Arc::clone(&recent_stderr);
        let recent_stderr_reader = Arc::clone(&recent_stderr);

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
                    if trimmed.is_empty() {
                        continue;
                    }
                    crate::run::device::append_emulator_log(&format!("[ios-capture-stderr] {}", trimmed));

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
                    } else {
                        // Non-JSON line: save to recent_stderr buffer (keep last 30 lines)
                        if let Ok(mut buf) = recent_stderr_writer.lock() {
                            if buf.len() >= 30 {
                                buf.remove(0);
                            }
                            buf.push(trimmed.to_string());
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
                        // EOF on stdout: Process has exited or closed its stdout.
                        // Give stderr thread a moment to drain remaining lines.
                        thread::sleep(Duration::from_millis(50));

                        let exit_status = if let Ok(mut guard) = child_arc2.lock() {
                            if let Some(ref mut proc) = *guard {
                                proc.try_wait().ok().flatten()
                            } else {
                                None
                            }
                        } else {
                            None
                        };

                        let stderr_summary = if let Ok(buf) = recent_stderr_reader.lock() {
                            if buf.is_empty() {
                                None
                            } else {
                                Some(buf.join("\n"))
                            }
                        } else {
                            None
                        };

                        if let Some(status) = exit_status {
                            if !status.success() {
                                let reason = stderr_summary.unwrap_or_else(|| {
                                    format!("physical iOS capture helper failed with {}", status)
                                });
                                let _ = status_tx_clone2.send(MirrorStatus::Error { message: reason });
                                break;
                            }
                        }

                        if let Some(err_lines) = stderr_summary {
                            let _ = status_tx_clone2.send(MirrorStatus::Error { message: err_lines });
                        } else {
                            let _ = status_tx_clone2.send(MirrorStatus::Disconnected {
                                reason: "physical iOS capture process exited".to_string(),
                            });
                        }
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

        let display_name = if let Some(ref name) = resolved_name {
            format!("{} ({})", name, identifier)
        } else {
            format!("iPhone ({})", identifier)
        };

        let info = MirrorInfo {
            serial: identifier.to_string(),
            name: display_name,
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

/// Compute optimal adaptive dimensions for physical iPhone mirroring.
/// Enforces max bound (1080p / 960p), preserves ~2.16 (19.5:9) aspect ratio,
/// and guarantees even dimensions for H.264 encoding.
pub fn compute_physical_dimensions(max_size: u16) -> (u32, u32) {
    let max_dim = if max_size == 0 {
        1080
    } else {
        (max_size as u32).min(1080)
    };
    let height = (max_dim & !1).max(2);
    let width = ((((height as f32) / 2.16).round() as u32) & !1).max(2);
    (width, height)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::exec::SystemExec;

    #[test]
    fn test_invalid_udid_rejected() {
        let exec = SystemExec;
        let res = IosPhysicalSession::start(&exec, "invalid-not-a-udid", 1080);
        assert!(res.is_err());
        let err = res.err().unwrap();
        assert_eq!(err.kind(), io::ErrorKind::InvalidInput);
    }

    #[test]
    fn test_compute_physical_dimensions() {
        // Default / 1080p target
        let (w1080, h1080) = compute_physical_dimensions(1080);
        assert_eq!(h1080, 1080);
        assert_eq!(w1080, 500);
        assert_eq!(w1080 % 2, 0);
        assert_eq!(h1080 % 2, 0);

        // 960p target
        let (w960, h960) = compute_physical_dimensions(960);
        assert_eq!(h960, 960);
        assert_eq!(w960, 444);
        assert_eq!(w960 % 2, 0);
        assert_eq!(h960 % 2, 0);

        // Zero / unconstrained defaults to 1080p
        let (w0, h0) = compute_physical_dimensions(0);
        assert_eq!(h0, 1080);
        assert_eq!(w0, 500);

        // Values over 1080 clamped to 1080p
        let (w_over, h_over) = compute_physical_dimensions(2556);
        assert_eq!(h_over, 1080);
        assert_eq!(w_over, 500);
    }
}
