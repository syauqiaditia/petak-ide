/// Push and start scrcpy-server on an Android device via adb.
///
/// Steps:
/// 1. adb push scrcpy-server-v4.1 /data/local/tmp/scrcpy-server.jar
/// 2. adb forward tcp:<port> localabstract:scrcpy_<scid>
/// 3. adb shell CLASSPATH=/data/local/tmp/scrcpy-server.jar \
///    app_process / com.genymobile.scrcpy.Server 4.1 \
///    tunnel_forward=true audio=false control=true max_size=<max> ...
/// 4. Connect to localhost:<port> — video socket first, then control socket.
use std::io;
use std::net::TcpStream;
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
/// Order: env PETAK_SCRCPY_SERVER -> Tauri resource dir -> app-support dir.
pub fn resolve_server_jar() -> io::Result<String> {
    let jar_name = format!("scrcpy-server-v{}", SCRCPY_VERSION);

    // 1. Env override
    if let Ok(env_path) = std::env::var("PETAK_SCRCPY_SERVER") {
        if !env_path.trim().is_empty() {
            let p = Path::new(&env_path);
            if !p.is_file() {
                return Err(io::Error::new(
                    io::ErrorKind::NotFound,
                    format!("PETAK_SCRCPY_SERVER file tidak ditemukan: {}", env_path),
                ));
            }
            verify_server_jar(&env_path)?;
            return Ok(env_path);
        }
    }

    // 2. Tauri resource dir (bundled in app)
    //    At runtime the resource is next to the binary:
    //    macOS: Petak.app/Contents/Resources/<jar>
    //    Linux: <dir>/resources/<jar>  (or next to binary)
    if let Ok(exe) = std::env::current_exe() {
        // macOS bundle: exe is at .app/Contents/MacOS/Petak
        if let Some(macos_dir) = exe.parent() {
            let resources = macos_dir.join("../Resources").join(&jar_name);
            if resources.is_file() {
                let p = resources.to_string_lossy().to_string();
                verify_server_jar(&p)?;
                return Ok(p);
            }
            // Linux / dev: resources/ next to exe
            let beside = macos_dir.join(&jar_name);
            if beside.is_file() {
                let p = beside.to_string_lossy().to_string();
                verify_server_jar(&p)?;
                return Ok(p);
            }
        }
    }

    // 3. App-support dir: ~/Library/Application Support/Petak/scrcpy/
    //    or ~/.local/share/Petak/scrcpy/ on Linux
    if let Some(data) = dirs::data_dir() {
        let app_support = data.join("Petak").join("scrcpy").join(&jar_name);
        if app_support.is_file() {
            let p = app_support.to_string_lossy().to_string();
            verify_server_jar(&p)?;
            return Ok(p);
        }
    }

    Err(io::Error::new(
        io::ErrorKind::NotFound,
        format!(
            "scrcpy-server-v{} tidak ditemukan. Pastikan file sudah dibundle di app atau ada di ~/Library/Application Support/Petak/scrcpy/",
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

/// Set up adb forward and return the local port.
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

    let shell_cmd = format!(
        "CLASSPATH={} app_process / com.genymobile.scrcpy.Server {} \
         tunnel_forward=true audio=false control=true cleanup=false \
         send_device_meta=false send_frame_meta=true \
         send_dummy_byte=false \
         max_size={} scid={}",
        SERVER_REMOTE_PATH, SCRCPY_VERSION, max_size_str, scid_hex
    );

    spawn.spawn(
        Path::new("."),
        &adb,
        &["-s", device, "shell", &shell_cmd],
        &[],
        tx,
    )
}

/// Connect to the scrcpy server via the forwarded port.
/// The server expects the video socket first, then the control socket.
/// Each connection starts with reading a dummy byte (if send_dummy_byte=true, but we set false).
pub fn connect_sockets(port: u16) -> io::Result<(TcpStream, TcpStream)> {
    let timeout = Duration::from_secs(10);

    // Retry connection briefly — server takes a moment to bind
    let video = retry_connect(port, timeout)?;
    let control = retry_connect(port, timeout)?;

    video.set_read_timeout(Some(Duration::from_secs(5)))?;
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
    /// Kill the server process and remove the adb forward.
    pub fn stop(&mut self) {
        let _ = self.server_proc.kill();
        remove_forward(self.exec.as_ref(), &self.device, self.port);
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

    #[test]
    fn test_resolve_server_jar_env_nonexistent() {
        std::env::set_var("PETAK_SCRCPY_SERVER", "/nonexistent/path/server.jar");
        let result = resolve_server_jar();
        std::env::remove_var("PETAK_SCRCPY_SERVER");
        assert!(result.is_err());
        assert_eq!(result.unwrap_err().kind(), io::ErrorKind::NotFound);
    }

    #[test]
    fn test_resolve_server_jar_env_valid() {
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
            forward_removed: Arc<AtomicBool>,
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
                if args.contains(&"forward") && args.contains(&"--remove") {
                    self.forward_removed.store(true, Ordering::SeqCst);
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
        let forward_removed = Arc::new(AtomicBool::new(false));

        let server = ScrcpyServer {
            device: "emulator-5554".to_string(),
            scid: 0x1234,
            port: 27183,
            server_proc: Box::new(MockProc {
                killed: killed.clone(),
            }),
            exec: Box::new(MockExec {
                forward_removed: forward_removed.clone(),
            }),
        };

        // When dropped (or cleared from MirrorState on app quit),
        // ScrcpyServer must kill the server proc and remove adb forward
        drop(server);

        assert!(
            killed.load(Ordering::SeqCst),
            "server process must be killed on drop"
        );
        assert!(
            forward_removed.load(Ordering::SeqCst),
            "adb forward must be removed on drop"
        );
    }
}
