use std::io::{self, BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc::{self, Receiver};
use std::sync::{Arc, Mutex};
use std::thread;

use crate::exec::Exec;
use crate::mirror::ios::input::send_simulator_input;
use crate::mirror::ios::stream::read_ios_frame_packet;
use crate::mirror::session::{MirrorInfo, MirrorStatus};
use crate::run::ios::{is_valid_udid, parse_simctl_devices, simctl_boot};

/// Handle to a running iOS Simulator mirror session.
pub struct IosSimulatorSession {
    pub udid: String,
    child: Arc<Mutex<Option<Child>>>,
    _reader_thread: Option<thread::JoinHandle<()>>,
    _stderr_thread: Option<thread::JoinHandle<()>>,
}

impl IosSimulatorSession {
    /// Boot simulator if needed, launch ScreenCaptureKit capture helper,
    /// and return `(MirrorInfo, session, frame_rx, status_rx)`.
    pub fn start(
        exec: &dyn Exec,
        udid: &str,
        max_size: u16,
    ) -> io::Result<(MirrorInfo, Self, Receiver<Vec<u8>>, Receiver<MirrorStatus>)> {
        if !is_valid_udid(udid) {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                format!("invalid iOS simulator UDID: {}", udid),
            ));
        }

        let (status_tx, status_rx) = mpsc::channel();
        let (frame_tx, frame_rx) = mpsc::channel();

        let _ = status_tx.send(MirrorStatus::Connecting);

        // 1. Check if booted, boot if necessary
        ensure_simulator_booted(exec, udid)?;

        // 2. Open Simulator.app to ensure window is on screen for ScreenCaptureKit
        let _ = exec.run(
            Path::new("."),
            "open",
            &["-a", "Simulator", "--args", "-CurrentDeviceUDID", udid],
            &[],
            None,
        );

        // 3. Resolve path to Swift capture helper
        let helper_path = resolve_swift_helper_path();

        // 4. Spawn capture process (swift petak_ios_capture.swift or precompiled binary)
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
            "simulator",
            "--udid",
            udid,
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

        let mut child = cmd.spawn().map_err(|e| {
            io::Error::new(
                io::ErrorKind::Other,
                format!(
                    "failed to spawn iOS capture helper at {:?}: {}",
                    helper_path, e
                ),
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

        // 5. Stderr monitor thread: parses JSON status events from Swift helper
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

        // 6. Frame reader thread: reads binary packets and forwards to UI
        let status_tx_clone2 = status_tx;
        let reader_thread = thread::spawn(move || {
            let mut reader = BufReader::new(stdout);
            loop {
                match read_ios_frame_packet(&mut reader) {
                    Ok(Some(packet)) => {
                        if frame_tx.send(packet).is_err() {
                            break; // UI receiver closed
                        }
                    }
                    Ok(None) => {
                        // EOF
                        let _ = status_tx_clone2.send(MirrorStatus::Disconnected {
                            reason: "iOS capture process exited".to_string(),
                        });
                        break;
                    }
                    Err(e) => {
                        let _ = status_tx_clone2.send(MirrorStatus::Disconnected {
                            reason: format!("iOS packet read error: {}", e),
                        });
                        break;
                    }
                }
            }
            // Kill child on thread exit
            if let Ok(mut guard) = child_arc2.lock() {
                if let Some(mut proc) = guard.take() {
                    let _ = proc.kill();
                }
            }
        });

        let info = MirrorInfo {
            serial: udid.to_string(),
            name: format!("iOS Simulator ({})", udid),
            width,
            height,
            codec: "h264".to_string(),
        };

        Ok((
            info,
            Self {
                udid: udid.to_string(),
                child: child_arc,
                _reader_thread: Some(reader_thread),
                _stderr_thread: Some(stderr_thread),
            },
            frame_rx,
            status_rx,
        ))
    }

    /// Inject input event to simulator.
    pub fn send_input(
        &self,
        exec: &dyn Exec,
        event: &crate::mirror::control::InputEvent,
    ) -> io::Result<()> {
        send_simulator_input(exec, &self.udid, event)
    }

    /// Stop simulator mirror session and kill child capture process.
    pub fn stop(&self) {
        if let Ok(mut guard) = self.child.lock() {
            if let Some(mut proc) = guard.take() {
                let _ = proc.kill();
            }
        }
    }
}

impl Drop for IosSimulatorSession {
    fn drop(&mut self) {
        self.stop();
    }
}

/// Ensure simulator is booted; boot via `simctl boot` if currently shutdown.
pub fn ensure_simulator_booted(exec: &dyn Exec, udid: &str) -> io::Result<()> {
    let out = exec.run(
        Path::new("."),
        "xcrun",
        &["simctl", "list", "devices", "--json"],
        &[],
        None,
    )?;

    if out.status.success() {
        let json_str = String::from_utf8_lossy(&out.stdout);
        if let Ok(devices) = parse_simctl_devices(&json_str) {
            for d in devices {
                if d.id == udid {
                    if d.state == crate::run::device::DeviceState::Online {
                        return Ok(());
                    }
                    break;
                }
            }
        }
    }

    // Try to boot
    simctl_boot(exec, udid)
}

/// Resolve the path to `petak_ios_capture.swift` or compiled binary.
pub fn resolve_swift_helper_path() -> PathBuf {
    resolve_swift_helper_path_internal(
        std::env::current_exe().ok().as_deref(),
        std::env::var("CARGO_MANIFEST_DIR").ok().as_deref(),
    )
}

pub fn resolve_swift_helper_path_internal(
    current_exe: Option<&Path>,
    manifest_dir: Option<&str>,
) -> PathBuf {
    // 1. App bundle Resources (macOS) or beside executable:
    //    .app/Contents/MacOS/Petak -> .app/Contents/Resources/petak_ios_capture.swift
    if let Some(exe) = current_exe {
        if let Some(parent) = exe.parent() {
            let res_swift = parent.join("../Resources/petak_ios_capture.swift");
            if res_swift.is_file() {
                return res_swift.canonicalize().unwrap_or(res_swift);
            }
            let res_bin = parent.join("../Resources/petak_ios_capture");
            if res_bin.is_file() {
                return res_bin.canonicalize().unwrap_or(res_bin);
            }
            let beside_swift = parent.join("petak_ios_capture.swift");
            if beside_swift.is_file() {
                return beside_swift.canonicalize().unwrap_or(beside_swift);
            }
            let beside_bin = parent.join("petak_ios_capture");
            if beside_bin.is_file() {
                return beside_bin.canonicalize().unwrap_or(beside_bin);
            }
        }
    }

    // 2. Check relative to CARGO_MANIFEST_DIR / source tree
    let manifest = manifest_dir.unwrap_or(".");
    let src_path = Path::new(manifest).join("src/mirror/ios/petak_ios_capture.swift");
    if src_path.is_file() {
        return src_path;
    }

    // 3. Check binary in /tmp or standard cache
    let bin_path = PathBuf::from("/mnt/storage/uqi-cache/bin/petak-ios-capture");
    if bin_path.is_file() {
        return bin_path;
    }

    // Default to src_path
    src_path
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Output;
    use std::sync::Mutex;

    struct FakeExec {
        calls: Mutex<Vec<Vec<String>>>,
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

            let stdout = if program == "xcrun" && args.contains(&"devices") {
                r#"{ "devices": { "iOS 17.0": [ { "udid": "E1B3E035-7F2A-4B6E-9E8D-7F6335CD5E90", "name": "iPhone 15", "state": "Shutdown", "isAvailable": true } ] } }"#.as_bytes().to_vec()
            } else {
                Vec::new()
            };

            Ok(Output {
                status,
                stdout,
                stderr: Vec::new(),
            })
        }
    }

    #[test]
    fn test_ensure_simulator_booted_calls_boot() {
        let fake = FakeExec {
            calls: Mutex::new(Vec::new()),
        };
        let udid = "E1B3E035-7F2A-4B6E-9E8D-7F6335CD5E90";
        ensure_simulator_booted(&fake, udid).unwrap();

        let calls = fake.calls.lock().unwrap();
        assert_eq!(calls.len(), 2);
        assert_eq!(
            calls[0],
            vec!["xcrun", "simctl", "list", "devices", "--json"]
        );
        assert_eq!(calls[1], vec!["xcrun", "simctl", "boot", udid]);
    }

    #[test]
    fn test_resolve_swift_helper_path() {
        let path = resolve_swift_helper_path();
        assert!(
            path.to_string_lossy().contains("petak_ios_capture.swift")
                || path.to_string_lossy().contains("petak-ios-capture")
        );
    }

    #[test]
    fn test_resolve_swift_helper_path_mac_bundle_resources() {
        let tmp_dir = tempfile::tempdir().unwrap();
        let macos_dir = tmp_dir.path().join("Contents/MacOS");
        let resources_dir = tmp_dir.path().join("Contents/Resources");
        std::fs::create_dir_all(&macos_dir).unwrap();
        std::fs::create_dir_all(&resources_dir).unwrap();

        let helper_swift = resources_dir.join("petak_ios_capture.swift");
        std::fs::write(&helper_swift, "// swift capture script").unwrap();

        let fake_exe = macos_dir.join("Petak");
        std::fs::write(&fake_exe, "").unwrap();

        let resolved = resolve_swift_helper_path_internal(Some(&fake_exe), None);
        assert_eq!(resolved, helper_swift.canonicalize().unwrap_or(helper_swift));
    }
}
