/// Push and start scrcpy-server on an Android device via adb.
///
/// Steps:
/// 1. adb push scrcpy-server-v4.1 /data/local/tmp/scrcpy-server.jar
/// 2. Bind local TcpListener to ephemeral port
/// 3. adb reverse localabstract:scrcpy_<scid> tcp:<port>
/// 4. adb shell CLASSPATH=/data/local/tmp/scrcpy-server.jar \
///    app_process / com.genymobile.scrcpy.Server 4.1 \
///    tunnel_forward=false audio=false control=true max_size=<max> ...
/// 5. Accept incoming connections from device — video socket first, then control socket.
use std::io;
use std::net::{TcpListener, TcpStream};
use std::path::Path;
use std::sync::mpsc::Sender;
use std::time::Duration;

use crate::exec::{Exec, Proc, ProcLine, Spawn};
use crate::run::device::{is_valid_device_id, resolve_adb_binary};

pub const SCRCPY_VERSION: &str = "4.1";
const SERVER_REMOTE_PATH: &str = "/data/local/tmp/scrcpy-server.jar";

/// Expected sha256 of scrcpy-server-v4.1
const SCRCPY_SERVER_SHA256: &str = "deacb991ed2509715160ffdc7907e47b4160eb30d1566217e9047fd5b8850cae";

/// Resolve the local path to the scrcpy-server jar.
/// Order: env PETAK_SCRCPY_SERVER -> Tauri resource dir -> app-support dir -> Homebrew/system paths.
pub fn resolve_server_jar() -> io::Result<String> {
    resolve_server_jar_internal(
        std::env::var("PETAK_SCRCPY_SERVER").ok().as_deref(),
        std::env::current_exe().ok().as_deref(),
        dirs::data_dir().as_deref(),
        &[
            Path::new("/opt/homebrew/share/scrcpy"),
            Path::new("/usr/local/share/scrcpy"),
            Path::new("/usr/share/scrcpy"),
        ],
    )
}

pub fn resolve_server_jar_internal(
    env_override: Option<&str>,
    current_exe: Option<&Path>,
    data_dir: Option<&Path>,
    system_dirs: &[&Path],
) -> io::Result<String> {
    let jar_names = [format!("scrcpy-server-v{}", SCRCPY_VERSION), "scrcpy-server".to_string()];

    // 1. Env override
    if let Some(env_path) = env_override {
        if !env_path.trim().is_empty() {
            let p = Path::new(env_path);
            if !p.is_file() {
                return Err(io::Error::new(
                    io::ErrorKind::NotFound,
                    format!("PETAK_SCRCPY_SERVER file tidak ditemukan: {}", env_path),
                ));
            }
            verify_server_jar(env_path)?;
            return Ok(env_path.to_string());
        }
    }

    // 2. Tauri resource dir (bundled in app)
    //    macOS: Petak.app/Contents/Resources/<jar>
    //    Linux: <dir>/resources/<jar>  (or next to binary)
    if let Some(exe) = current_exe {
        if let Some(macos_dir) = exe.parent() {
            for name in &jar_names {
                let resources = macos_dir.join("../Resources").join(name);
                if resources.is_file() {
                    let p = resources.to_string_lossy().to_string();
                    if verify_server_jar(&p).is_ok() {
                        return Ok(p);
                    }
                }
                let beside = macos_dir.join(name);
                if beside.is_file() {
                    let p = beside.to_string_lossy().to_string();
                    if verify_server_jar(&p).is_ok() {
                        return Ok(p);
                    }
                }
            }
        }
    }

    // 3. App-support dir: ~/Library/Application Support/Petak/scrcpy/
    //    or ~/.local/share/Petak/scrcpy/ on Linux
    if let Some(data) = data_dir {
        for name in &jar_names {
            let app_support = data.join("Petak").join("scrcpy").join(name);
            if app_support.is_file() {
                let p = app_support.to_string_lossy().to_string();
                if verify_server_jar(&p).is_ok() {
                    return Ok(p);
                }
            }
        }
    }

    // 4. System / Homebrew paths:
    //    /opt/homebrew/share/scrcpy/scrcpy-server (Apple Silicon)
    //    /usr/local/share/scrcpy/scrcpy-server (Intel Mac)
    //    /usr/share/scrcpy/scrcpy-server (Linux)
    for dir in system_dirs {
        for name in &jar_names {
            let candidate = dir.join(name);
            if candidate.is_file() {
                let p = candidate.to_string_lossy().to_string();
                if verify_server_jar(&p).is_ok() {
                    return Ok(p);
                }
            }
        }
    }

    Err(io::Error::new(
        io::ErrorKind::NotFound,
        format!(
            "scrcpy-server-v{} tidak ditemukan. Pastikan file sudah dibundle di app atau ada di ~/Library/Application Support/Petak/scrcpy/, /opt/homebrew/share/scrcpy/, /usr/local/share/scrcpy/, atau /usr/share/scrcpy/",
            SCRCPY_VERSION
        ),
    ))
}

/// Verify sha256 of a jar file.
pub fn verify_server_jar(path: &str) -> io::Result<()> {
    use sha2::{Digest, Sha256};
    let bytes = std::fs::read(path)?;
    let hash = format!("{:x}", Sha256::digest(&bytes));
    if hash != SCRCPY_SERVER_SHA256 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            format!("scrcpy-server sha256 mismatch: expected {}, got {}", SCRCPY_SERVER_SHA256, hash),
        ));
    }
    Ok(())
}

/// Push the scrcpy-server jar to the device.
pub fn push_server(exec: &dyn Exec, device: &str, local_jar: &str) -> io::Result<()> {
    if !is_valid_device_id(device) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("invalid device ID: {}", device),
        ));
    }
    let adb = resolve_adb_binary();
    let output = exec.run(
        Path::new("."),
        &adb,
        &["-s", device, "push", local_jar, SERVER_REMOTE_PATH],
        &[],
        None,
    )?;
    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        return Err(io::Error::other(format!("adb push failed: {}", err.trim())));
    }
    Ok(())
}

/// Set up adb reverse and forward the abstract socket to the local port.
pub fn setup_reverse(exec: &dyn Exec, device: &str, scid: u32, port: u16) -> io::Result<()> {
    if !is_valid_device_id(device) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("invalid device ID: {}", device),
        ));
    }
    let adb = resolve_adb_binary();
    let abstract_name = format!("localabstract:scrcpy_{:08x}", scid);
    let tcp_spec = format!("tcp:{}", port);

    let output = exec.run(
        Path::new("."),
        &adb,
        &["-s", device, "reverse", &abstract_name, &tcp_spec],
        &[],
        None,
    )?;
    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        return Err(io::Error::other(format!("adb reverse failed: {}", err.trim())));
    }
    Ok(())
}

/// Remove the adb reverse for a given scid.
pub fn remove_reverse(exec: &dyn Exec, device: &str, scid: u32) {
    let adb = resolve_adb_binary();
    let abstract_name = format!("localabstract:scrcpy_{:08x}", scid);
    let _ = exec.run(
        Path::new("."),
        &adb,
        &["-s", device, "reverse", "--remove", &abstract_name],
        &[],
        None,
    );
}

/// Set up adb forward and return the local port.
#[deprecated(note = "use setup_reverse instead to avoid race conditions")]
#[allow(dead_code)]
pub fn setup_forward(exec: &dyn Exec, device: &str, scid: u32) -> io::Result<u16> {
    let adb = resolve_adb_binary();
    let abstract_name = format!("localabstract:scrcpy_{:08x}", scid);

    // Use tcp:0 to let adb pick a free port
    let output = exec.run(
        Path::new("."),
        &adb,
        &["-s", device, "forward", "tcp:0", &abstract_name],
        &[],
        None,
    )?;
    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        return Err(io::Error::other(format!("adb forward failed: {}", err.trim())));
    }
    let port_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
    port_str.parse::<u16>().map_err(|_| {
        io::Error::new(
            io::ErrorKind::InvalidData,
            format!("could not parse port from adb forward: '{}'", port_str),
        )
    })
}

/// Remove the adb forward for a given port.
#[deprecated(note = "use remove_reverse instead")]
#[allow(dead_code)]
pub fn remove_forward(exec: &dyn Exec, device: &str, port: u16) {
    let adb = resolve_adb_binary();
    let tcp_spec = format!("tcp:{}", port);
    let _ = exec.run(
        Path::new("."),
        &adb,
        &["-s", device, "forward", "--remove", &tcp_spec],
        &[],
        None,
    );
}

/// Start the scrcpy server process on the device.
/// Returns the Proc handle to the running `adb shell` process.
pub fn start_server(
    spawn: &dyn Spawn,
    device: &str,
    scid: u32,
    max_size: u16,
    tx: Sender<ProcLine>,
) -> io::Result<Box<dyn Proc>> {
    if !is_valid_device_id(device) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("invalid device ID: {}", device),
        ));
    }
    let adb = resolve_adb_binary();
    let scid_hex = format!("{:08x}", scid);
    let max_size_str = max_size.to_string();

    let bitrate = if device.starts_with("emulator-") {
        "4000000"
    } else {
        "8000000"
    };

    let shell_cmd = format!(
        "CLASSPATH={} app_process / com.genymobile.scrcpy.Server {} \
         tunnel_forward=false audio=false control=true cleanup=false \
         send_device_meta=false send_frame_meta=true \
         send_dummy_byte=false max_fps=60 video_bit_rate={} \
         max_size={} scid={}",
        SERVER_REMOTE_PATH, SCRCPY_VERSION, bitrate, max_size_str, scid_hex
    );

    spawn.spawn(
        Path::new("."),
        &adb,
        &["-s", device, "shell", &shell_cmd],
        &[],
        tx,
    )
}

/// Accept video and control connections from the scrcpy server.
/// In reverse tunnel mode, the device connects to our local listener:
/// connection 1 = Video stream, connection 2 = Control stream.
pub fn accept_sockets(listener: &TcpListener) -> io::Result<(TcpStream, TcpStream)> {
    let timeout = Duration::from_secs(10);
    let video = accept_one(listener, timeout)?;
    let control = accept_one(listener, timeout)?;

    // Video stream: HAPUS read timeout 5 detik (None) agar tidak memicu os error 35
    // (EAGAIN/EWOULDBLOCK) saat layar HP diam/idle.
    video.set_read_timeout(None)?;

    // Control stream: pertahankan read/write timeout 5 detik
    control.set_read_timeout(Some(Duration::from_secs(5)))?;
    control.set_write_timeout(Some(Duration::from_secs(5)))?;

    Ok((video, control))
}

fn accept_one(listener: &TcpListener, timeout: Duration) -> io::Result<TcpStream> {
    listener.set_nonblocking(true)?;
    let start = std::time::Instant::now();
    loop {
        match listener.accept() {
            Ok((stream, _)) => {
                stream.set_nonblocking(false)?;
                return Ok(stream);
            }
            Err(ref e)
                if e.kind() == io::ErrorKind::WouldBlock
                    || e.kind() == io::ErrorKind::Interrupted =>
            {
                if start.elapsed() >= timeout {
                    return Err(io::Error::new(
                        io::ErrorKind::TimedOut,
                        "timed out waiting for scrcpy connection",
                    ));
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(e) => return Err(e),
        }
    }
}

/// Connect to the scrcpy server via the forwarded port.
/// The server expects the video socket first, then the control socket.
/// Each connection starts with reading a dummy byte (if send_dummy_byte=true, but we set false).
pub fn connect_sockets(port: u16) -> io::Result<(TcpStream, TcpStream)> {
    let timeout = Duration::from_secs(10);

    // Retry connection briefly — server takes a moment to bind
    let video = retry_connect(port, timeout)?;
    let control = retry_connect(port, timeout)?;

    video.set_read_timeout(None)?;
    control.set_read_timeout(Some(Duration::from_secs(5)))?;
    control.set_write_timeout(Some(Duration::from_secs(5)))?;

    Ok((video, control))
}

fn retry_connect(port: u16, timeout: Duration) -> io::Result<TcpStream> {
    let start = std::time::Instant::now();
    loop {
        match TcpStream::connect(("127.0.0.1", port)) {
            Ok(s) => return Ok(s),
            Err(e) => {
                if start.elapsed() >= timeout {
                    return Err(io::Error::new(
                        io::ErrorKind::TimedOut,
                        format!("failed to connect to scrcpy port {}: {}", port, e),
                    ));
                }
                std::thread::sleep(Duration::from_millis(100));
            }
        }
    }
}

/// Represents a running scrcpy server with its associated resources.
pub struct ScrcpyServer {
    pub device: String,
    pub scid: u32,
    pub port: u16,
    pub server_proc: Box<dyn Proc>,
    pub exec: Box<dyn Exec>,
}

impl ScrcpyServer {
    /// Kill the server process and remove the adb reverse.
    pub fn stop(&mut self) {
        let _ = self.server_proc.kill();
        remove_reverse(self.exec.as_ref(), &self.device, self.scid);
    }
}

impl Drop for ScrcpyServer {
    fn drop(&mut self) {
        self.stop();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    static TEST_ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    #[test]
    fn test_resolve_server_jar_env_nonexistent() {
        let _lock = TEST_ENV_LOCK.lock().unwrap();
        std::env::set_var("PETAK_SCRCPY_SERVER", "/nonexistent/path/server.jar");
        let result = resolve_server_jar();
        std::env::remove_var("PETAK_SCRCPY_SERVER");
        assert!(result.is_err());
        assert_eq!(result.unwrap_err().kind(), io::ErrorKind::NotFound);
    }

    #[test]
    fn test_resolve_server_jar_env_valid() {
        let _lock = TEST_ENV_LOCK.lock().unwrap();
        let mut tmp = tempfile::NamedTempFile::new().unwrap();
        let bundled = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../app/resources")
            .join(format!("scrcpy-server-v{}", SCRCPY_VERSION));
        if bundled.is_file() {
            let bytes = std::fs::read(&bundled).unwrap();
            use std::io::Write;
            tmp.write_all(&bytes).unwrap();
            let tmp_str = tmp.path().to_str().unwrap().to_string();
            std::env::set_var("PETAK_SCRCPY_SERVER", &tmp_str);
            let result = resolve_server_jar();
            std::env::remove_var("PETAK_SCRCPY_SERVER");
            assert!(result.is_ok());
            assert_eq!(result.unwrap(), tmp_str);
        }
    }

    #[test]
    fn test_resolve_server_jar_env_sha256_mismatch() {
        let _lock = TEST_ENV_LOCK.lock().unwrap();
        let mut tmp = tempfile::NamedTempFile::new().unwrap();
        use std::io::Write;
        tmp.write_all(b"corrupted jar data").unwrap();
        let tmp_str = tmp.path().to_str().unwrap().to_string();
        std::env::set_var("PETAK_SCRCPY_SERVER", &tmp_str);
        let result = resolve_server_jar();
        std::env::remove_var("PETAK_SCRCPY_SERVER");
        assert!(result.is_err());
        assert_eq!(result.unwrap_err().kind(), io::ErrorKind::InvalidData);
    }

    #[test]
    fn test_verify_server_jar_bad_path() {
        let result = verify_server_jar("/nonexistent/file");
        assert!(result.is_err());
    }

    #[test]
    fn test_resolve_server_jar_system_homebrew_apple_silicon_name_scrcpy_server() {
        let bundled = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../app/resources")
            .join(format!("scrcpy-server-v{}", SCRCPY_VERSION));
        if bundled.is_file() {
            let tmp_dir = tempfile::tempdir().unwrap();
            let brew_scrcpy = tmp_dir.path().join("opt_homebrew/share/scrcpy");
            std::fs::create_dir_all(&brew_scrcpy).unwrap();
            let target_jar = brew_scrcpy.join("scrcpy-server");
            std::fs::copy(&bundled, &target_jar).unwrap();

            let result = resolve_server_jar_internal(
                None,
                None,
                None,
                &[&brew_scrcpy],
            );
            assert!(result.is_ok());
            assert_eq!(result.unwrap(), target_jar.to_string_lossy().to_string());
        }
    }

    #[test]
    fn test_resolve_server_jar_system_homebrew_sha256_mismatch_ignored() {
        let tmp_dir = tempfile::tempdir().unwrap();
        let brew_scrcpy = tmp_dir.path().join("opt_homebrew/share/scrcpy");
        std::fs::create_dir_all(&brew_scrcpy).unwrap();
        let target_jar = brew_scrcpy.join("scrcpy-server");
        std::fs::write(&target_jar, b"invalid sha256 jar").unwrap();

        let result = resolve_server_jar_internal(
            None,
            None,
            None,
            &[&brew_scrcpy],
        );
        assert!(result.is_err());
        assert_eq!(result.unwrap_err().kind(), io::ErrorKind::NotFound);
    }

    #[test]
    fn test_scid_format() {
        let scid: u32 = 0x12345678;
        let hex = format!("{:08x}", scid);
        assert_eq!(hex, "12345678");
        let abstract_name = format!("localabstract:scrcpy_{}", hex);
        assert_eq!(abstract_name, "localabstract:scrcpy_12345678");
    }

    #[test]
    fn test_scrcpy_server_drop_cleans_resources() {
        use std::process::Output;
        use std::sync::atomic::{AtomicBool, Ordering};
        use std::sync::Arc;

        struct MockProc {
            killed: Arc<AtomicBool>,
        }
        impl Proc for MockProc {
            fn stdin_write(&mut self, _data: &[u8]) -> io::Result<()> {
                Ok(())
            }
            fn kill(&mut self) -> io::Result<()> {
                self.killed.store(true, Ordering::SeqCst);
                Ok(())
            }
            fn pid(&self) -> Option<u32> {
                Some(1234)
            }
        }

        struct MockExec {
            reverse_removed: Arc<AtomicBool>,
        }
        impl Exec for MockExec {
            fn run(
                &self,
                _cwd: &Path,
                _program: &str,
                args: &[&str],
                _env: &[(&str, &str)],
                _stdin: Option<&[u8]>,
            ) -> io::Result<Output> {
                if args.contains(&"reverse")
                    && args.contains(&"--remove")
                    && args.contains(&"localabstract:scrcpy_00001234")
                {
                    self.reverse_removed.store(true, Ordering::SeqCst);
                }
                #[cfg(unix)]
                use std::os::unix::process::ExitStatusExt;
                Ok(Output {
                    status: std::process::ExitStatus::from_raw(0),
                    stdout: Vec::new(),
                    stderr: Vec::new(),
                })
            }
        }

        let killed = Arc::new(AtomicBool::new(false));
        let reverse_removed = Arc::new(AtomicBool::new(false));

        let server = ScrcpyServer {
            device: "emulator-5554".to_string(),
            scid: 0x1234,
            port: 27183,
            server_proc: Box::new(MockProc {
                killed: killed.clone(),
            }),
            exec: Box::new(MockExec {
                reverse_removed: reverse_removed.clone(),
            }),
        };

        // When dropped (or cleared from MirrorState on app quit),
        // ScrcpyServer must kill the server proc and remove adb reverse
        drop(server);

        assert!(
            killed.load(Ordering::SeqCst),
            "server process must be killed on drop"
        );
        assert!(
            reverse_removed.load(Ordering::SeqCst),
            "adb reverse must be removed on drop"
        );
    }

    #[test]
    fn test_setup_reverse_success() {
        use std::process::Output;
        use std::sync::{Arc, Mutex};

        struct RecordingExec {
            calls: Arc<Mutex<Vec<Vec<String>>>>,
        }
        impl Exec for RecordingExec {
            fn run(
                &self,
                _cwd: &Path,
                _program: &str,
                args: &[&str],
                _env: &[(&str, &str)],
                _stdin: Option<&[u8]>,
            ) -> io::Result<Output> {
                self.calls
                    .lock()
                    .unwrap()
                    .push(args.iter().map(|s| s.to_string()).collect());
                #[cfg(unix)]
                use std::os::unix::process::ExitStatusExt;
                Ok(Output {
                    status: std::process::ExitStatus::from_raw(0),
                    stdout: Vec::new(),
                    stderr: Vec::new(),
                })
            }
        }

        let calls = Arc::new(Mutex::new(Vec::new()));
        let exec = RecordingExec {
            calls: calls.clone(),
        };

        let res = setup_reverse(&exec, "emulator-5554", 0x1234abcd, 27183);
        assert!(res.is_ok());

        let recorded = calls.lock().unwrap();
        assert_eq!(recorded.len(), 1);
        assert_eq!(
            recorded[0],
            vec![
                "-s",
                "emulator-5554",
                "reverse",
                "localabstract:scrcpy_1234abcd",
                "tcp:27183"
            ]
        );
    }

    #[test]
    fn test_setup_reverse_invalid_device() {
        use std::process::Output;
        struct DummyExec;
        impl Exec for DummyExec {
            fn run(
                &self,
                _cwd: &Path,
                _program: &str,
                _args: &[&str],
                _env: &[(&str, &str)],
                _stdin: Option<&[u8]>,
            ) -> io::Result<Output> {
                panic!("should not run for invalid device");
            }
        }
        let res = setup_reverse(&DummyExec, "device;inject", 0x1234, 27183);
        assert!(res.is_err());
        assert_eq!(res.unwrap_err().kind(), io::ErrorKind::InvalidInput);
    }

    #[test]
    fn test_setup_reverse_adb_failure() {
        use std::process::Output;
        struct FailingExec;
        impl Exec for FailingExec {
            fn run(
                &self,
                _cwd: &Path,
                _program: &str,
                _args: &[&str],
                _env: &[(&str, &str)],
                _stdin: Option<&[u8]>,
            ) -> io::Result<Output> {
                #[cfg(unix)]
                use std::os::unix::process::ExitStatusExt;
                Ok(Output {
                    status: std::process::ExitStatus::from_raw(1),
                    stdout: Vec::new(),
                    stderr: b"error: closed\n".to_vec(),
                })
            }
        }
        let res = setup_reverse(&FailingExec, "emulator-5554", 0x1234, 27183);
        assert!(res.is_err());
        assert!(res
            .unwrap_err()
            .to_string()
            .contains("adb reverse failed: error: closed"));
    }

    #[test]
    fn test_remove_reverse_success() {
        use std::process::Output;
        use std::sync::{Arc, Mutex};

        struct RecordingExec {
            calls: Arc<Mutex<Vec<Vec<String>>>>,
        }
        impl Exec for RecordingExec {
            fn run(
                &self,
                _cwd: &Path,
                _program: &str,
                args: &[&str],
                _env: &[(&str, &str)],
                _stdin: Option<&[u8]>,
            ) -> io::Result<Output> {
                self.calls
                    .lock()
                    .unwrap()
                    .push(args.iter().map(|s| s.to_string()).collect());
                #[cfg(unix)]
                use std::os::unix::process::ExitStatusExt;
                Ok(Output {
                    status: std::process::ExitStatus::from_raw(0),
                    stdout: Vec::new(),
                    stderr: Vec::new(),
                })
            }
        }

        let calls = Arc::new(Mutex::new(Vec::new()));
        let exec = RecordingExec {
            calls: calls.clone(),
        };

        remove_reverse(&exec, "emulator-5554", 0x00005678);

        let recorded = calls.lock().unwrap();
        assert_eq!(recorded.len(), 1);
        assert_eq!(
            recorded[0],
            vec![
                "-s",
                "emulator-5554",
                "reverse",
                "--remove",
                "localabstract:scrcpy_00005678"
            ]
        );
    }

    #[test]
    fn test_accept_sockets_sets_correct_timeouts() {
        use std::io::Write;
        use std::net::TcpListener;

        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();

        let handle = std::thread::spawn(move || {
            let mut s1 = TcpStream::connect(("127.0.0.1", port)).unwrap();
            let mut s2 = TcpStream::connect(("127.0.0.1", port)).unwrap();
            s1.write_all(b"video").unwrap();
            s2.write_all(b"ctrl").unwrap();
        });

        let (video, control) = accept_sockets(&listener).unwrap();
        handle.join().unwrap();

        // Video socket MUST have None read timeout (idle screen shouldn't EAGAIN)
        assert_eq!(video.read_timeout().unwrap(), None);

        // Control socket MUST have 5s read/write timeout
        assert_eq!(
            control.read_timeout().unwrap(),
            Some(Duration::from_secs(5))
        );
        assert_eq!(
            control.write_timeout().unwrap(),
            Some(Duration::from_secs(5))
        );
    }

    #[test]
    fn test_start_server_tunnel_forward_false() {
        use std::sync::{Arc, Mutex};
        struct MockSpawn {
            cmd: Arc<Mutex<String>>,
        }
        impl Spawn for MockSpawn {
            fn spawn(
                &self,
                _cwd: &Path,
                _program: &str,
                args: &[&str],
                _env: &[(&str, &str)],
                _tx: Sender<ProcLine>,
            ) -> io::Result<Box<dyn Proc>> {
                if let Some(cmd) = args.last() {
                    *self.cmd.lock().unwrap() = cmd.to_string();
                }
                struct DummyProc;
                impl Proc for DummyProc {
                    fn stdin_write(&mut self, _data: &[u8]) -> io::Result<()> {
                        Ok(())
                    }
                    fn kill(&mut self) -> io::Result<()> {
                        Ok(())
                    }
                    fn pid(&self) -> Option<u32> {
                        Some(1234)
                    }
                }
                Ok(Box::new(DummyProc))
            }
        }

        let cmd = Arc::new(Mutex::new(String::new()));
        let spawn = MockSpawn { cmd: cmd.clone() };
        let (tx, _rx) = std::sync::mpsc::channel();
        let _ = start_server(&spawn, "emulator-5554", 0x12345678, 1920, tx).unwrap();

        let command_str = cmd.lock().unwrap().clone();
        assert!(
            command_str.contains("tunnel_forward=false"),
            "shell command must include tunnel_forward=false"
        );
        assert!(
            command_str.contains("scid=12345678"),
            "shell command must include scid"
        );
        assert!(
            command_str.contains("max_size=1920"),
            "shell command must include max_size"
        );
    }
}
