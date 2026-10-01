/// MirrorSession: lifecycle management for one device mirror.
///
/// Lazy: no threads/processes until `start()`. Clean: Drop kills server, removes reverse.
/// Video frames are sent to the caller via an mpsc channel.
use std::io;
use std::net::TcpStream;
use std::sync::mpsc::{self, Receiver};
use std::sync::{Arc, Mutex};
use std::thread;

use serde::{Deserialize, Serialize};

use crate::exec::{Exec, Spawn, SystemExec, SystemSpawn};
use crate::mirror::control::{self, InputEvent};
use crate::mirror::protocol::{self, encode_frame_packet};
use crate::mirror::server;

/// Info returned after mirror_start.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MirrorInfo {
    pub serial: String,
    pub name: String,
    pub width: u32,
    pub height: u32,
    pub codec: String,
}

/// Status events sent on the status channel.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum MirrorStatus {
    Connecting,
    Live { width: u32, height: u32 },
    Rotated { width: u32, height: u32 },
    Disconnected { reason: String },
    Error { message: String },
    #[serde(rename = "needs_usb", alias = "NeedsUsb")]
    NeedsUsb { message: String },
    #[serde(rename = "failed", alias = "Failed")]
    Failed { reason: String },
}

enum SessionBackend {
    Android {
        control_stream: Arc<Mutex<Option<TcpStream>>>,
        // Handle to server resources — Drop kills server
        _server: server::ScrcpyServer,
        // Handle to video reader thread
        _video_thread: Option<thread::JoinHandle<()>>,
    },
    Ios(crate::mirror::ios::IosSessionHandle),
}

/// A running mirror session for one device.
pub struct MirrorSession {
    #[allow(dead_code)]
    device: String,
    backend: SessionBackend,
}

impl MirrorSession {
    /// Start mirroring the given device.
    /// Returns (MirrorInfo, session, frame_rx, status_rx).
    ///
    /// `frame_rx` receives encoded frame packets (contract binary: [u8 kind][u64 pts][payload]).
    /// `status_rx` receives MirrorStatus events.
    pub fn start(
        serial: &str,
        max_size: u16,
    ) -> io::Result<(MirrorInfo, Self, Receiver<Vec<u8>>, Receiver<MirrorStatus>)> {
        Self::start_with(
            serial,
            max_size,
            Box::new(SystemExec),
            Box::new(SystemSpawn),
        )
    }

    /// Start with injected Exec/Spawn (for testing).
    pub fn start_with(
        serial: &str,
        max_size: u16,
        exec: Box<dyn Exec>,
        spawn: Box<dyn Spawn>,
    ) -> io::Result<(MirrorInfo, Self, Receiver<Vec<u8>>, Receiver<MirrorStatus>)> {
        if crate::mirror::ios::is_ios_device(serial) {
            let (info, handle, frame_rx, status_rx) =
                crate::mirror::ios::start_ios_mirror(serial, max_size, exec.as_ref())?;
            return Ok((
                info,
                MirrorSession {
                    device: serial.to_string(),
                    backend: SessionBackend::Ios(handle),
                },
                frame_rx,
                status_rx,
            ));
        }

        let (status_tx, status_rx) = mpsc::channel();
        let (frame_tx, frame_rx) = mpsc::channel();

        let _ = status_tx.send(MirrorStatus::Connecting);

        // 0. Clean up any previous scrcpy server process on device to avoid port/display contention
        let adb_cleanup = crate::run::resolve_adb_binary();
        let _ = exec.run(
            std::path::Path::new("."),
            &adb_cleanup,
            &["-s", serial, "shell", "pkill -f com.genymobile.scrcpy.Server || true"],
            &[],
            None,
        );

        // 1. Resolve and push server jar
        let jar_path = match server::resolve_server_jar() {
            Ok(p) => p,
            Err(e) => {
                let err_obj = serde_json::json!({
                    "platform": "android",
                    "code": "server_jar_missing",
                    "message": format!("Scrcpy server jar tidak ditemukan: {}", e)
                });
                return Err(io::Error::new(io::ErrorKind::Other, err_obj.to_string()));
            }
        };
        if let Err(e) = server::push_server(exec.as_ref(), serial, &jar_path) {
            let err_obj = serde_json::json!({
                "platform": "android",
                "code": "adb_push_failed",
                "message": format!("Gagal mengirim scrcpy-server ke device {}: {}", serial, e)
            });
            return Err(io::Error::new(io::ErrorKind::Other, err_obj.to_string()));
        }

        // 2. Bind local TcpListener for reverse tunnel
        let listener = match std::net::TcpListener::bind("127.0.0.1:0") {
            Ok(l) => l,
            Err(e) => {
                let err_obj = serde_json::json!({
                    "platform": "android",
                    "code": "listener_bind_failed",
                    "message": format!("Gagal bind local TcpListener untuk reverse tunnel {}: {}", serial, e)
                });
                return Err(io::Error::new(io::ErrorKind::Other, err_obj.to_string()));
            }
        };
        let port = match listener.local_addr() {
            Ok(addr) => addr.port(),
            Err(e) => {
                let err_obj = serde_json::json!({
                    "platform": "android",
                    "code": "listener_port_failed",
                    "message": format!("Gagal membaca port TcpListener untuk reverse tunnel {}: {}", serial, e)
                });
                return Err(io::Error::new(io::ErrorKind::Other, err_obj.to_string()));
            }
        };

        // 3. Generate random scid
        let scid: u32 = rand_scid();

        // 4. Setup adb reverse
        if let Err(e) = server::setup_reverse(exec.as_ref(), serial, scid, port) {
            let err_obj = serde_json::json!({
                "platform": "android",
                "code": "adb_reverse_failed",
                "message": format!("Gagal setup adb reverse untuk {}: {}", serial, e)
            });
            return Err(io::Error::new(io::ErrorKind::Other, err_obj.to_string()));
        }

        // 5. Start server process
        let (proc_tx, _proc_rx) = mpsc::channel();
        let server_proc = match server::start_server(spawn.as_ref(), serial, scid, max_size, proc_tx) {
            Ok(p) => p,
            Err(e) => {
                server::remove_reverse(exec.as_ref(), serial, scid);
                let err_obj = serde_json::json!({
                    "platform": "android",
                    "code": "scrcpy_start_failed",
                    "message": format!("Gagal menjalankan scrcpy-server di device {}: {}", serial, e)
                });
                return Err(io::Error::new(io::ErrorKind::Other, err_obj.to_string()));
            }
        };

        let scrcpy_server = server::ScrcpyServer {
            device: serial.to_string(),
            scid,
            port,
            server_proc,
            exec,
        };

        // 6. Accept video + control sockets (device connects back via adb reverse)
        let (video_stream, control_stream) = match server::accept_sockets(&listener) {
            Ok(s) => s,
            Err(e) => {
                let err_obj = serde_json::json!({
                    "platform": "android",
                    "code": "scrcpy_connect_failed",
                    "message": format!("Gagal menerima video/control socket dari scrcpy-server: {}", e)
                });
                return Err(io::Error::new(io::ErrorKind::Other, err_obj.to_string()));
            }
        };

        // 6. Read codec meta
        let mut video_reader = io::BufReader::new(video_stream);
        let meta = match protocol::read_codec_meta(&mut video_reader) {
            Ok(m) => m,
            Err(e) => {
                let err_obj = serde_json::json!({
                    "platform": "android",
                    "code": "codec_meta_failed",
                    "message": format!("Gagal membaca metadata codec dari scrcpy-server: {}", e)
                });
                return Err(io::Error::new(io::ErrorKind::Other, err_obj.to_string()));
            }
        };

        let info = MirrorInfo {
            serial: serial.to_string(),
            name: serial.to_string(), // scrcpy v4.1 with send_device_meta=false
            width: meta.width,
            height: meta.height,
            codec: "h264".to_string(),
        };

        let _ = status_tx.send(MirrorStatus::Live {
            width: meta.width,
            height: meta.height,
        });

        let control_arc = Arc::new(Mutex::new(Some(control_stream)));
        let control_arc2 = Arc::clone(&control_arc);

        // 7. Spawn video reader thread
        let video_thread = thread::spawn(move || {
            loop {
                match protocol::read_video_packet(&mut video_reader) {
                    Ok(Some(pkt)) => {
                        // Check for rotation: config packet may indicate new SPS with
                        // different dimensions. We detect this by checking if we get a
                        // new config packet — the actual w/h detection is done by the
                        // UI decoder, but we signal Rotated status.
                        // ponytail: skip SPS parsing, let UI detect dimensions from codec.
                        // We just relay the packet.
                        let encoded = encode_frame_packet(&pkt);
                        if frame_tx.send(encoded).is_err() {
                            break; // receiver dropped
                        }
                    }
                    Ok(None) => {
                        // EOF
                        let _ = status_tx.send(MirrorStatus::Disconnected {
                            reason: "video stream ended".to_string(),
                        });
                        break;
                    }
                    Err(e) => {
                        let _ = status_tx.send(MirrorStatus::Disconnected {
                            reason: format!("video read error: {}", e),
                        });
                        break;
                    }
                }
            }
            // Clean up control socket when video ends
            if let Ok(mut guard) = control_arc2.lock() {
                *guard = None;
            }
        });

        Ok((
            info,
            MirrorSession {
                device: serial.to_string(),
                backend: SessionBackend::Android {
                    control_stream: control_arc,
                    _server: scrcpy_server,
                    _video_thread: Some(video_thread),
                },
            },
            frame_rx,
            status_rx,
        ))
    }

    /// Send an input event to the device.
    pub fn send_input(&self, ev: &InputEvent) -> io::Result<()> {
        match &self.backend {
            SessionBackend::Android { control_stream, .. } => {
                let mut guard = control_stream.lock().unwrap();
                if let Some(stream) = guard.as_mut() {
                    control::serialize(ev, stream)
                } else {
                    Err(io::Error::new(
                        io::ErrorKind::NotConnected,
                        "control socket closed",
                    ))
                }
            }
            SessionBackend::Ios(handle) => {
                let exec = crate::exec::SystemExec;
                handle.send_input(&exec, ev)
            }
        }
    }

    /// Take a screenshot via adb screencap or xcrun simctl/devicectl.
    pub fn screenshot(exec: &dyn Exec, serial: &str, path: Option<&str>) -> io::Result<String> {
        take_screenshot(exec, serial, path)
    }
}

/// Take a screenshot via `adb exec-out screencap -p` (Android) or `simctl/devicectl` (iOS).
pub fn take_screenshot(exec: &dyn Exec, device: &str, path: Option<&str>) -> io::Result<String> {
    if crate::mirror::ios::is_ios_device(device) {
        return crate::mirror::ios::take_screenshot(exec, device, path);
    }
    use crate::run::device::{is_valid_device_id, resolve_adb_binary};

    if !is_valid_device_id(device) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("invalid device ID: {}", device),
        ));
    }

    let adb = resolve_adb_binary();
    let output = exec.run(
        std::path::Path::new("."),
        &adb,
        &["-s", device, "exec-out", "screencap", "-p"],
        &[],
        None,
    )?;

    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        return Err(io::Error::new(
            io::ErrorKind::Other,
            format!("screencap failed: {}", err.trim()),
        ));
    }

    let out_path = path.map(|p| p.to_string()).unwrap_or_else(|| {
        let ts = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis();
        format!("/tmp/petak-screenshot-{}.png", ts)
    });

    std::fs::write(&out_path, &output.stdout)?;
    Ok(out_path)
}

/// Generate a random 31-bit scid (positive i32).
fn rand_scid() -> u32 {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut h = DefaultHasher::new();
    std::time::Instant::now().hash(&mut h);
    std::thread::current().id().hash(&mut h);
    (h.finish() as u32) & 0x7FFF_FFFF
}
