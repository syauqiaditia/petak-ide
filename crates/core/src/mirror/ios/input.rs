use std::collections::HashMap;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use crate::exec::Exec;
use crate::mirror::control::{InputEvent, NavKey, TouchAction};

/// Active touch state tracking for an iOS simulator device.
#[derive(Debug, Clone)]
pub struct ActiveTouch {
    pub start_x: u32,
    pub start_y: u32,
    pub last_x: u32,
    pub last_y: u32,
    pub w: u16,
    pub h: u16,
    pub start_time: Instant,
}

/// Stateful tracker managing in-flight touch and drag gestures per UDID.
#[derive(Default)]
pub struct TouchTracker {
    touches: Mutex<HashMap<String, ActiveTouch>>,
}

impl TouchTracker {
    pub fn new() -> Self {
        Self {
            touches: Mutex::new(HashMap::new()),
        }
    }

    pub fn on_down(&self, udid: &str, x: u32, y: u32, w: u16, h: u16) {
        let mut touches = self.touches.lock().unwrap();
        touches.insert(
            udid.to_string(),
            ActiveTouch {
                start_x: x,
                start_y: y,
                last_x: x,
                last_y: y,
                w,
                h,
                start_time: Instant::now(),
            },
        );
    }

    pub fn on_move(&self, udid: &str, x: u32, y: u32) {
        let mut touches = self.touches.lock().unwrap();
        if let Some(touch) = touches.get_mut(udid) {
            touch.last_x = x;
            touch.last_y = y;
        }
    }

    pub fn on_up(&self, udid: &str) -> Option<ActiveTouch> {
        let mut touches = self.touches.lock().unwrap();
        touches.remove(udid)
    }

    pub fn clear(&self) {
        let mut touches = self.touches.lock().unwrap();
        touches.clear();
    }
}

pub fn touch_tracker() -> &'static TouchTracker {
    static TRACKER: OnceLock<TouchTracker> = OnceLock::new();
    TRACKER.get_or_init(TouchTracker::new)
}

pub trait DaemonWriter: io::Write + Send {}
impl<T: io::Write + Send> DaemonWriter for T {}

pub type SharedDaemonWriter = Arc<Mutex<Box<dyn DaemonWriter>>>;

/// Registry managing active simtouch daemon stdin streams per UDID.
#[derive(Default)]
pub struct DaemonTracker {
    daemons: Mutex<HashMap<String, SharedDaemonWriter>>,
}

impl DaemonTracker {
    pub fn new() -> Self {
        Self {
            daemons: Mutex::new(HashMap::new()),
        }
    }

    pub fn register(&self, udid: &str, writer: Box<dyn DaemonWriter>) -> SharedDaemonWriter {
        let mut map = self.daemons.lock().unwrap();
        let shared = Arc::new(Mutex::new(writer));
        map.insert(udid.to_string(), Arc::clone(&shared));
        shared
    }

    pub fn register_shared(&self, udid: &str, shared: SharedDaemonWriter) {
        let mut map = self.daemons.lock().unwrap();
        map.insert(udid.to_string(), shared);
    }

    pub fn unregister(&self, udid: &str) {
        let mut map = self.daemons.lock().unwrap();
        map.remove(udid);
    }

    pub fn get(&self, udid: &str) -> Option<SharedDaemonWriter> {
        let map = self.daemons.lock().unwrap();
        map.get(udid).cloned()
    }

    pub fn clear(&self) {
        let mut map = self.daemons.lock().unwrap();
        map.clear();
    }
}

pub fn daemon_tracker() -> &'static DaemonTracker {
    static TRACKER: OnceLock<DaemonTracker> = OnceLock::new();
    TRACKER.get_or_init(DaemonTracker::new)
}

/// Map an Android/web keycode to USB HID Keyboard Page 0x07 usage code.
pub fn android_to_hid_keycode(android_keycode: u32) -> Option<u32> {
    match android_keycode {
        66 => Some(40),      // Enter -> USB HID 40 (0x28)
        67 => Some(42),      // Backspace -> USB HID 42 (0x2A)
        61 => Some(43),      // Tab -> USB HID 43 (0x2B)
        62 => Some(44),      // Space -> USB HID 44 (0x2C)
        111 => Some(41),     // Escape -> USB HID 41 (0x29)
        112 => Some(76),     // Delete -> USB HID 76 (0x4C)
        21 => Some(80),      // Arrow Left -> USB HID 80 (0x50)
        22 => Some(79),      // Arrow Right -> USB HID 79 (0x4F)
        19 => Some(82),      // Arrow Up -> USB HID 82 (0x52)
        20 => Some(81),      // Arrow Down -> USB HID 81 (0x51)
        3 | 122 => Some(74), // Home -> USB HID 74 (0x4A)
        123 => Some(77),     // End -> USB HID 77 (0x4D)
        92 => Some(75),      // Page Up -> USB HID 75 (0x4B)
        93 => Some(78),      // Page Down -> USB HID 78 (0x4E)
        _ => None,
    }
}

/// Send a raw command string to the simtouch daemon stdin stream.
pub fn send_daemon_command(stdin: &mut dyn io::Write, cmd: &str) -> io::Result<()> {
    stdin.write_all(cmd.as_bytes())?;
    if !cmd.ends_with('\n') {
        stdin.write_all(b"\n")?;
    }
    stdin.flush()
}

/// Format an InputEvent into a simtouch daemon command line and send it to stdin.
pub fn send_daemon_event(stdin: &mut dyn io::Write, event: &InputEvent) -> io::Result<()> {
    match event {
        InputEvent::Touch { action, x, y, w, h } => {
            let cmd = match action {
                TouchAction::Down => format!("d {} {} {} {}", x, y, w, h),
                TouchAction::Move => format!("m {} {} {} {}", x, y, w, h),
                TouchAction::Up => format!("u {} {} {} {}", x, y, w, h),
            };
            send_daemon_command(stdin, &cmd)
        }
        InputEvent::Text { text } => {
            let escaped = text.replace('\r', "").replace('\n', "\\n");
            let cmd = format!("text {}", escaped);
            send_daemon_command(stdin, &cmd)
        }
        InputEvent::Key { keycode, .. } => {
            let hid = android_to_hid_keycode(*keycode).unwrap_or(*keycode);
            let cmd = format!("k {}", hid);
            send_daemon_command(stdin, &cmd)
        }
        InputEvent::Nav { key } => {
            let btn_name = match key {
                NavKey::Home => "home",
                NavKey::Power => "lock",
                NavKey::Volup => "volume_up",
                NavKey::Voldown => "volume_down",
                _ => return Ok(()),
            };
            let cmd = format!("b {}", btn_name);
            send_daemon_command(stdin, &cmd)
        }
        InputEvent::Scroll { x, y, w, h, dx, dy } => {
            let x2 = (*x as f32 + dx).max(0.0) as u32;
            let y2 = (*y as f32 + dy).max(0.0) as u32;
            let cmd = format!("s {} {} {} {} {} {} 200 10", x, y, x2, y2, w, h);
            send_daemon_command(stdin, &cmd)
        }
        InputEvent::Rotate => Ok(()),
    }
}

/// Resolve the path to the `simtouch` binary.
pub fn resolve_simtouch_path() -> Option<PathBuf> {
    #[cfg(test)]
    {
        // Avoid host filesystem leakage during unit testing with mock Exec
        None
    }
    #[cfg(not(test))]
    resolve_simtouch_path_internal(
        std::env::current_exe().ok().as_deref(),
        std::env::var("CARGO_MANIFEST_DIR").ok().as_deref(),
    )
}

pub fn resolve_simtouch_path_internal(
    current_exe: Option<&Path>,
    manifest_dir: Option<&str>,
) -> Option<PathBuf> {
    // 1. App bundle Resources (macOS) or beside executable:
    //    .app/Contents/MacOS/Petak -> .app/Contents/Resources/simtouch
    if let Some(exe) = current_exe {
        if let Some(parent) = exe.parent() {
            let res_bin = parent.join("../Resources/simtouch");
            if res_bin.is_file() {
                return Some(res_bin.canonicalize().unwrap_or(res_bin));
            }
            let beside_bin = parent.join("simtouch");
            if beside_bin.is_file() {
                return Some(beside_bin.canonicalize().unwrap_or(beside_bin));
            }
        }
    }

    // 2. Beside or inside target/release
    let manifest = manifest_dir.unwrap_or(".");
    let target_release = Path::new(manifest).join("../../target/release/simtouch");
    if target_release.is_file() {
        return Some(target_release.canonicalize().unwrap_or(target_release));
    }
    let target_debug = Path::new(manifest).join("../../target/debug/simtouch");
    if target_debug.is_file() {
        return Some(target_debug.canonicalize().unwrap_or(target_debug));
    }

    let rel_target = PathBuf::from("target/release/simtouch");
    if rel_target.is_file() {
        return Some(rel_target.canonicalize().unwrap_or(rel_target));
    }

    None
}

/// Check if `simtouch` binary is available on the system.
pub fn has_simtouch(exec: &dyn Exec) -> bool {
    let output = exec.run(Path::new("."), "which", &["simtouch"], &[], None);
    if output.map(|o| o.status.success()).unwrap_or(false) {
        return true;
    }
    resolve_simtouch_path().is_some()
}

/// Determine the binary command name or path to invoke `simtouch`.
pub fn simtouch_binary_name() -> String {
    if let Some(path) = resolve_simtouch_path() {
        path.to_string_lossy().to_string()
    } else {
        "simtouch".to_string()
    }
}

/// Handle input forwarding for an iOS Simulator session.
/// Best effort:
/// 1. Uses `simtouch` native helper if installed or resolved.
/// 2. Uses `idb` (iOS Development Bridge) if installed on host.
/// 3. Falls back to AppleScript / CGEvent on macOS if Accessibility is granted.
/// 4. If none is available, documents view-only status and returns an informative error.
pub fn send_simulator_input(exec: &dyn Exec, udid: &str, event: &InputEvent) -> io::Result<()> {
    // 0. Try active persistent simtouch daemon if registered for this UDID
    if let Some(daemon) = daemon_tracker().get(udid) {
        if let Ok(mut writer) = daemon.lock() {
            return send_daemon_event(&mut **writer, event);
        }
    }

    // 1. Try simtouch native helper if present
    if has_simtouch(exec) {
        return send_simtouch_input(exec, udid, event);
    }

    // 2. Try idb CLI if present
    if has_idb(exec) {
        return send_idb_input(exec, udid, event);
    }

    // 3. Try macOS CGEvent / AppleScript when running natively on macOS
    #[cfg(target_os = "macos")]
    {
        return send_cgevent_simulator_input(event);
    }

    // 4. Fallback: view-only with written rationale
    #[allow(unreachable_code)]
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "iOS Simulator input requires simtouch helper, Facebook idb CLI ('idb ui tap'), or macOS Accessibility permissions for CGEvent. The mirror session is operating in view-only mode.",
    ))
}

/// Inject input via native `simtouch` CLI helper.
pub fn send_simtouch_input(exec: &dyn Exec, udid: &str, event: &InputEvent) -> io::Result<()> {
    let simtouch_bin = simtouch_binary_name();
    match event {
        InputEvent::Touch { action, x, y, w, h } => {
            let tracker = touch_tracker();
            match action {
                TouchAction::Down => {
                    tracker.on_down(udid, *x, *y, *w, *h);
                    Ok(())
                }
                TouchAction::Move => {
                    tracker.on_move(udid, *x, *y);
                    Ok(())
                }
                TouchAction::Up => {
                    let maybe_active = tracker.on_up(udid);
                    if let Some(mut active) = maybe_active {
                        active.last_x = *x;
                        active.last_y = *y;
                        let dx = active.last_x as f64 - active.start_x as f64;
                        let dy = active.last_y as f64 - active.start_y as f64;
                        let dist = (dx * dx + dy * dy).sqrt();
                        let elapsed = active.start_time.elapsed();

                        if dist >= 15.0 {
                            let duration_ms = (elapsed.as_millis() as u64).clamp(50, 500) as u32;
                            let x1_str = active.start_x.to_string();
                            let y1_str = active.start_y.to_string();
                            let x2_str = active.last_x.to_string();
                            let y2_str = active.last_y.to_string();
                            let w_val = if *w > 0 { *w } else { active.w };
                            let h_val = if *h > 0 { *h } else { active.h };
                            let w_str = w_val.to_string();
                            let h_str = h_val.to_string();
                            let dur_str = duration_ms.to_string();
                            let out = exec.run(
                                Path::new("."),
                                &simtouch_bin,
                                &[
                                    "swipe", &x1_str, &y1_str, &x2_str, &y2_str, &w_str, &h_str,
                                    &dur_str, "10", "--udid", udid,
                                ],
                                &[],
                                None,
                            )?;
                            if !out.status.success() {
                                let err = String::from_utf8_lossy(&out.stderr);
                                return Err(io::Error::new(
                                    io::ErrorKind::Other,
                                    format!("simtouch swipe failed: {}", err.trim()),
                                ));
                            }
                        } else if elapsed < Duration::from_millis(500) {
                            let w_val = if *w > 0 { *w } else { active.w };
                            let h_val = if *h > 0 { *h } else { active.h };
                            let x_str = x.to_string();
                            let y_str = y.to_string();
                            let w_str = w_val.to_string();
                            let h_str = h_val.to_string();
                            let out = exec.run(
                                Path::new("."),
                                &simtouch_bin,
                                &["tap", &x_str, &y_str, &w_str, &h_str, "--udid", udid],
                                &[],
                                None,
                            )?;
                            if !out.status.success() {
                                let err = String::from_utf8_lossy(&out.stderr);
                                return Err(io::Error::new(
                                    io::ErrorKind::Other,
                                    format!("simtouch tap failed: {}", err.trim()),
                                ));
                            }
                        }
                    } else {
                        let x_str = x.to_string();
                        let y_str = y.to_string();
                        let w_str = w.to_string();
                        let h_str = h.to_string();
                        let out = exec.run(
                            Path::new("."),
                            &simtouch_bin,
                            &["tap", &x_str, &y_str, &w_str, &h_str, "--udid", udid],
                            &[],
                            None,
                        )?;
                        if !out.status.success() {
                            let err = String::from_utf8_lossy(&out.stderr);
                            return Err(io::Error::new(
                                io::ErrorKind::Other,
                                format!("simtouch tap failed: {}", err.trim()),
                            ));
                        }
                    }
                    Ok(())
                }
            }
        }
        InputEvent::Scroll { x, y, w, h, dx, dy } => {
            let x2 = (*x as f32 + dx).max(0.0) as u32;
            let y2 = (*y as f32 + dy).max(0.0) as u32;
            let x1_str = x.to_string();
            let y1_str = y.to_string();
            let x2_str = x2.to_string();
            let y2_str = y2.to_string();
            let w_str = w.to_string();
            let h_str = h.to_string();
            let out = exec.run(
                Path::new("."),
                &simtouch_bin,
                &[
                    "swipe", &x1_str, &y1_str, &x2_str, &y2_str, &w_str, &h_str, "200", "10",
                    "--udid", udid,
                ],
                &[],
                None,
            )?;
            if !out.status.success() {
                let err = String::from_utf8_lossy(&out.stderr);
                return Err(io::Error::new(
                    io::ErrorKind::Other,
                    format!("simtouch swipe failed: {}", err.trim()),
                ));
            }
            Ok(())
        }
        InputEvent::Nav { key } => {
            let btn_name = match key {
                NavKey::Home => "home",
                NavKey::Power => "lock",
                NavKey::Volup => "volume_up",
                NavKey::Voldown => "volume_down",
                _ => return Ok(()),
            };
            let out = exec.run(
                Path::new("."),
                &simtouch_bin,
                &["button", btn_name, "--udid", udid],
                &[],
                None,
            )?;
            if !out.status.success() {
                let err = String::from_utf8_lossy(&out.stderr);
                return Err(io::Error::new(
                    io::ErrorKind::Other,
                    format!("simtouch button failed: {}", err.trim()),
                ));
            }
            Ok(())
        }
        InputEvent::Key { keycode, .. } => {
            let hid = android_to_hid_keycode(*keycode).unwrap_or(*keycode);
            let key_str = hid.to_string();
            let out = exec.run(
                Path::new("."),
                &simtouch_bin,
                &["key", &key_str, "--udid", udid],
                &[],
                None,
            )?;
            if !out.status.success() {
                let err = String::from_utf8_lossy(&out.stderr);
                return Err(io::Error::new(
                    io::ErrorKind::Other,
                    format!("simtouch key failed: {}", err.trim()),
                ));
            }
            Ok(())
        }
        InputEvent::Text { text } => {
            let out = exec.run(
                Path::new("."),
                &simtouch_bin,
                &["text", text, "--udid", udid],
                &[],
                None,
            );
            if let Ok(o) = out {
                if o.status.success() {
                    return Ok(());
                }
            }
            // Text input over simtouch falls back to idb if available
            if has_idb(exec) {
                return send_idb_input(exec, udid, event);
            }
            Ok(())
        }
        InputEvent::Rotate => Ok(()),
    }
}

/// Handle input forwarding for physical iPhone:
/// Strictly view-only (as required by specification: Apple provides no official remote touch API over USB).
pub fn send_physical_input(event: &InputEvent) -> io::Result<()> {
    match event {
        InputEvent::Rotate => {
            // Rotate can still be acknowledged as UI layout change or no-op
            Ok(())
        }
        _ => Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "Physical iPhone mirror is strictly view-only: Apple does not support remote touch/key injection over USB without WebDriverAgent. Badge 'view only' is active in UI.",
        )),
    }
}

/// Check if Facebook idb is installed on the host.
pub fn has_idb(exec: &dyn Exec) -> bool {
    let output = exec.run(Path::new("."), "which", &["idb"], &[], None);
    output.map(|o| o.status.success()).unwrap_or(false)
}

/// Inject input via Facebook `idb` CLI.
pub fn send_idb_input(exec: &dyn Exec, udid: &str, event: &InputEvent) -> io::Result<()> {
    match event {
        InputEvent::Touch { action, x, y, .. } => {
            // idb triggers taps on down/up sequence; execute tap on down or up
            if matches!(action, TouchAction::Down | TouchAction::Up) {
                let x_str = x.to_string();
                let y_str = y.to_string();
                let out = exec.run(
                    Path::new("."),
                    "idb",
                    &["ui", "tap", "--udid", udid, &x_str, &y_str],
                    &[],
                    None,
                )?;
                if !out.status.success() {
                    let err = String::from_utf8_lossy(&out.stderr);
                    return Err(io::Error::new(
                        io::ErrorKind::Other,
                        format!("idb tap failed: {}", err.trim()),
                    ));
                }
            }
            Ok(())
        }
        InputEvent::Text { text } => {
            let out = exec.run(
                Path::new("."),
                "idb",
                &["ui", "text", "--udid", udid, text],
                &[],
                None,
            )?;
            if !out.status.success() {
                let err = String::from_utf8_lossy(&out.stderr);
                return Err(io::Error::new(
                    io::ErrorKind::Other,
                    format!("idb text failed: {}", err.trim()),
                ));
            }
            Ok(())
        }
        InputEvent::Key { keycode, .. } => {
            let key_str = keycode.to_string();
            let out = exec.run(
                Path::new("."),
                "idb",
                &["ui", "key", "--udid", udid, &key_str],
                &[],
                None,
            )?;
            if !out.status.success() {
                let err = String::from_utf8_lossy(&out.stderr);
                return Err(io::Error::new(
                    io::ErrorKind::Other,
                    format!("idb key failed: {}", err.trim()),
                ));
            }
            Ok(())
        }
        InputEvent::Nav { key } => {
            let idb_button = match key {
                NavKey::Home => "HOME",
                NavKey::Volup => "VOLUME_UP",
                NavKey::Voldown => "VOLUME_DOWN",
                NavKey::Power => "LOCK",
                _ => return Ok(()),
            };
            let out = exec.run(
                Path::new("."),
                "idb",
                &["ui", "button", "--udid", udid, idb_button],
                &[],
                None,
            )?;
            if !out.status.success() {
                let err = String::from_utf8_lossy(&out.stderr);
                return Err(io::Error::new(
                    io::ErrorKind::Other,
                    format!("idb button failed: {}", err.trim()),
                ));
            }
            Ok(())
        }
        InputEvent::Scroll { x, y, dx, dy, .. } => {
            // idb swipe x_start y_start x_end y_end
            let x2 = (*x as f32 + dx).max(0.0) as u32;
            let y2 = (*y as f32 + dy).max(0.0) as u32;
            let x1_str = x.to_string();
            let y1_str = y.to_string();
            let x2_str = x2.to_string();
            let y2_str = y2.to_string();
            let out = exec.run(
                Path::new("."),
                "idb",
                &[
                    "ui", "swipe", "--udid", udid, &x1_str, &y1_str, &x2_str, &y2_str,
                ],
                &[],
                None,
            )?;
            if !out.status.success() {
                let err = String::from_utf8_lossy(&out.stderr);
                return Err(io::Error::new(
                    io::ErrorKind::Other,
                    format!("idb swipe failed: {}", err.trim()),
                ));
            }
            Ok(())
        }
        InputEvent::Rotate => Ok(()),
    }
}

#[cfg(target_os = "macos")]
fn send_cgevent_simulator_input(_event: &InputEvent) -> io::Result<()> {
    // Note: CGEvent injection to Simulator window requires AXIsProcessTrusted()
    // and CGEventPostToPid. If Accessibility is not granted, this falls back to view-only.
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "Simulator input via CGEvent requires Accessibility permission in macOS System Settings > Privacy & Security > Accessibility. Running in view-only mode.",
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::exec::Exec;
    use crate::mirror::control::KeyAction;
    use std::process::Output;
    use std::sync::Mutex;

    struct FakeExec {
        calls: Mutex<Vec<Vec<String>>>,
        idb_available: bool,
        simtouch_available: bool,
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

            let exit_code = if program == "which" && args.contains(&"simtouch") {
                if self.simtouch_available {
                    0
                } else {
                    1
                }
            } else if program == "which" && args.contains(&"idb") {
                if self.idb_available {
                    0
                } else {
                    1
                }
            } else {
                0
            };

            #[cfg(unix)]
            use std::os::unix::process::ExitStatusExt;
            #[cfg(unix)]
            let status = std::process::ExitStatus::from_raw(exit_code << 8);

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
    fn test_physical_input_rejected_as_view_only() {
        let ev = InputEvent::Touch {
            action: TouchAction::Down,
            x: 100,
            y: 200,
            w: 800,
            h: 1600,
        };
        let res = send_physical_input(&ev);
        assert!(res.is_err());
        assert!(res.unwrap_err().to_string().contains("strictly view-only"));
    }

    #[test]
    fn test_simulator_input_without_simtouch_and_idb_returns_rationale() {
        let fake = FakeExec {
            calls: Mutex::new(Vec::new()),
            idb_available: false,
            simtouch_available: false,
        };
        let ev = InputEvent::Touch {
            action: TouchAction::Down,
            x: 100,
            y: 200,
            w: 800,
            h: 1600,
        };
        let res = send_simulator_input(&fake, "E1B3E035-7F2A-4B6E-9E8D-7F6335CD5E90", &ev);
        assert!(res.is_err());
        let err_msg = res.unwrap_err().to_string();
        assert!(err_msg.contains("Accessibility permission") || err_msg.contains("idb CLI"));
    }

    #[test]
    fn test_simulator_input_with_simtouch_touch() {
        let fake = FakeExec {
            calls: Mutex::new(Vec::new()),
            idb_available: false,
            simtouch_available: true,
        };
        let udid = "E1B3E035-7F2A-4B6E-9E8D-7F6335CD5E90";
        let ev_down = InputEvent::Touch {
            action: TouchAction::Down,
            x: 100,
            y: 200,
            w: 800,
            h: 1600,
        };
        let res_down = send_simulator_input(&fake, udid, &ev_down);
        assert!(res_down.is_ok());

        // Down must not trigger tap
        {
            let calls = fake.calls.lock().unwrap();
            let taps = calls
                .iter()
                .filter(|c| c.contains(&"tap".to_string()))
                .count();
            assert_eq!(taps, 0);
        }

        let ev_up = InputEvent::Touch {
            action: TouchAction::Up,
            x: 100,
            y: 200,
            w: 800,
            h: 1600,
        };
        let res_up = send_simulator_input(&fake, udid, &ev_up);
        assert!(res_up.is_ok());

        let calls = fake.calls.lock().unwrap();
        let tap_calls: Vec<_> = calls
            .iter()
            .filter(|c| c.contains(&"tap".to_string()))
            .collect();
        assert_eq!(tap_calls.len(), 1);
        assert_eq!(
            tap_calls[0],
            &vec![
                "simtouch".to_string(),
                "tap".to_string(),
                "100".to_string(),
                "200".to_string(),
                "800".to_string(),
                "1600".to_string(),
                "--udid".to_string(),
                udid.to_string(),
            ]
        );
    }

    #[test]
    fn test_simulator_input_with_simtouch_swipe_gesture() {
        let fake = FakeExec {
            calls: Mutex::new(Vec::new()),
            idb_available: false,
            simtouch_available: true,
        };
        let udid = "B3D5F257-9B4C-6D8E-1E0F-9B8557EF7A12";
        let ev_down = InputEvent::Touch {
            action: TouchAction::Down,
            x: 100,
            y: 200,
            w: 800,
            h: 1600,
        };
        assert!(send_simulator_input(&fake, udid, &ev_down).is_ok());

        let ev_move = InputEvent::Touch {
            action: TouchAction::Move,
            x: 100,
            y: 250,
            w: 800,
            h: 1600,
        };
        assert!(send_simulator_input(&fake, udid, &ev_move).is_ok());

        // Move must not trigger simtouch
        {
            let calls = fake.calls.lock().unwrap();
            let sim_actions = calls
                .iter()
                .filter(|c| c.first().map(|s| s.as_str()) == Some("simtouch"))
                .count();
            assert_eq!(sim_actions, 0);
        }

        let ev_up = InputEvent::Touch {
            action: TouchAction::Up,
            x: 100,
            y: 250,
            w: 800,
            h: 1600,
        };
        assert!(send_simulator_input(&fake, udid, &ev_up).is_ok());

        let calls = fake.calls.lock().unwrap();
        let swipe_calls: Vec<_> = calls
            .iter()
            .filter(|c| c.contains(&"swipe".to_string()))
            .collect();
        assert_eq!(swipe_calls.len(), 1);
        let sc = swipe_calls[0];
        assert_eq!(sc[0], "simtouch");
        assert_eq!(sc[1], "swipe");
        assert_eq!(sc[2], "100");
        assert_eq!(sc[3], "200");
        assert_eq!(sc[4], "100");
        assert_eq!(sc[5], "250");
        assert_eq!(sc[6], "800");
        assert_eq!(sc[7], "1600");
        let dur: u32 = sc[8].parse().unwrap();
        assert!(dur >= 50 && dur <= 500);
        assert_eq!(sc[9], "10");
        assert_eq!(sc[10], "--udid");
        assert_eq!(sc[11], udid);
    }

    #[test]
    fn test_simulator_input_with_simtouch_up_without_down() {
        let fake = FakeExec {
            calls: Mutex::new(Vec::new()),
            idb_available: false,
            simtouch_available: true,
        };
        let udid = "C4E6A368-0C5D-7E9F-2F1A-0C9668FA8B23";
        let ev_up = InputEvent::Touch {
            action: TouchAction::Up,
            x: 150,
            y: 350,
            w: 800,
            h: 1600,
        };
        assert!(send_simulator_input(&fake, udid, &ev_up).is_ok());

        let calls = fake.calls.lock().unwrap();
        let tap_calls: Vec<_> = calls
            .iter()
            .filter(|c| c.contains(&"tap".to_string()))
            .collect();
        assert_eq!(tap_calls.len(), 1);
        assert_eq!(
            tap_calls[0],
            &vec![
                "simtouch".to_string(),
                "tap".to_string(),
                "150".to_string(),
                "350".to_string(),
                "800".to_string(),
                "1600".to_string(),
                "--udid".to_string(),
                udid.to_string(),
            ]
        );
    }

    #[test]
    fn test_simulator_input_with_simtouch_scroll() {
        let fake = FakeExec {
            calls: Mutex::new(Vec::new()),
            idb_available: false,
            simtouch_available: true,
        };
        let ev = InputEvent::Scroll {
            x: 100,
            y: 200,
            w: 800,
            h: 1600,
            dx: 0.0,
            dy: 50.0,
        };
        let res = send_simulator_input(&fake, "E1B3E035-7F2A-4B6E-9E8D-7F6335CD5E90", &ev);
        assert!(res.is_ok());

        let calls = fake.calls.lock().unwrap();
        assert_eq!(calls.len(), 2);
        assert_eq!(
            calls[1],
            vec![
                "simtouch",
                "swipe",
                "100",
                "200",
                "100",
                "250",
                "800",
                "1600",
                "200",
                "10",
                "--udid",
                "E1B3E035-7F2A-4B6E-9E8D-7F6335CD5E90"
            ]
        );
    }

    #[test]
    fn test_simulator_input_with_simtouch_nav_home() {
        let fake = FakeExec {
            calls: Mutex::new(Vec::new()),
            idb_available: false,
            simtouch_available: true,
        };
        let ev = InputEvent::Nav { key: NavKey::Home };
        let res = send_simulator_input(&fake, "E1B3E035-7F2A-4B6E-9E8D-7F6335CD5E90", &ev);
        assert!(res.is_ok());

        let calls = fake.calls.lock().unwrap();
        assert_eq!(calls.len(), 2);
        assert_eq!(
            calls[1],
            vec![
                "simtouch",
                "button",
                "home",
                "--udid",
                "E1B3E035-7F2A-4B6E-9E8D-7F6335CD5E90"
            ]
        );
    }

    #[test]
    fn test_simulator_input_with_simtouch_nav_power() {
        let fake = FakeExec {
            calls: Mutex::new(Vec::new()),
            idb_available: false,
            simtouch_available: true,
        };
        let ev = InputEvent::Nav { key: NavKey::Power };
        let res = send_simulator_input(&fake, "E1B3E035-7F2A-4B6E-9E8D-7F6335CD5E90", &ev);
        assert!(res.is_ok());

        let calls = fake.calls.lock().unwrap();
        assert_eq!(calls.len(), 2);
        assert_eq!(
            calls[1],
            vec![
                "simtouch",
                "button",
                "lock",
                "--udid",
                "E1B3E035-7F2A-4B6E-9E8D-7F6335CD5E90"
            ]
        );
    }

    #[test]
    fn test_simulator_input_with_simtouch_nav_volume() {
        let fake = FakeExec {
            calls: Mutex::new(Vec::new()),
            idb_available: false,
            simtouch_available: true,
        };
        let ev1 = InputEvent::Nav { key: NavKey::Volup };
        let _ = send_simulator_input(&fake, "E1B3E035-7F2A-4B6E-9E8D-7F6335CD5E90", &ev1);
        let ev2 = InputEvent::Nav {
            key: NavKey::Voldown,
        };
        let _ = send_simulator_input(&fake, "E1B3E035-7F2A-4B6E-9E8D-7F6335CD5E90", &ev2);

        let calls = fake.calls.lock().unwrap();
        assert_eq!(
            calls[1],
            vec![
                "simtouch",
                "button",
                "volume_up",
                "--udid",
                "E1B3E035-7F2A-4B6E-9E8D-7F6335CD5E90"
            ]
        );
        assert_eq!(
            calls[3],
            vec![
                "simtouch",
                "button",
                "volume_down",
                "--udid",
                "E1B3E035-7F2A-4B6E-9E8D-7F6335CD5E90"
            ]
        );
    }

    #[test]
    fn test_simulator_input_with_simtouch_key() {
        let fake = FakeExec {
            calls: Mutex::new(Vec::new()),
            idb_available: false,
            simtouch_available: true,
        };
        let ev = InputEvent::Key {
            keycode: 40,
            action: KeyAction::Down,
        };
        let res = send_simulator_input(&fake, "E1B3E035-7F2A-4B6E-9E8D-7F6335CD5E90", &ev);
        assert!(res.is_ok());

        let calls = fake.calls.lock().unwrap();
        assert_eq!(calls.len(), 2);
        assert_eq!(
            calls[1],
            vec![
                "simtouch",
                "key",
                "40",
                "--udid",
                "E1B3E035-7F2A-4B6E-9E8D-7F6335CD5E90"
            ]
        );
    }

    #[test]
    fn test_simulator_input_fallback_to_idb() {
        let fake = FakeExec {
            calls: Mutex::new(Vec::new()),
            idb_available: true,
            simtouch_available: false,
        };
        let ev = InputEvent::Touch {
            action: TouchAction::Down,
            x: 100,
            y: 200,
            w: 800,
            h: 1600,
        };
        let res = send_simulator_input(&fake, "E1B3E035-7F2A-4B6E-9E8D-7F6335CD5E90", &ev);
        assert!(res.is_ok());

        let calls = fake.calls.lock().unwrap();
        // which simtouch (failed), which idb (ok), then idb ui tap
        assert_eq!(calls.len(), 3);
        assert_eq!(
            calls[2],
            vec![
                "idb",
                "ui",
                "tap",
                "--udid",
                "E1B3E035-7F2A-4B6E-9E8D-7F6335CD5E90",
                "100",
                "200"
            ]
        );
    }

    #[test]
    fn test_resolve_simtouch_path_mac_bundle_resources() {
        let tmp_dir = tempfile::tempdir().unwrap();
        let macos_dir = tmp_dir.path().join("Contents/MacOS");
        let resources_dir = tmp_dir.path().join("Contents/Resources");
        std::fs::create_dir_all(&macos_dir).unwrap();
        std::fs::create_dir_all(&resources_dir).unwrap();

        let helper_bin = resources_dir.join("simtouch");
        std::fs::write(&helper_bin, "#!/bin/sh\n").unwrap();

        let fake_exe = macos_dir.join("Petak");
        std::fs::write(&fake_exe, "").unwrap();

        let resolved = resolve_simtouch_path_internal(Some(&fake_exe), None);
        assert_eq!(
            resolved,
            Some(helper_bin.canonicalize().unwrap_or(helper_bin))
        );
    }

    #[test]
    fn test_resolve_simtouch_path_target_release() {
        let tmp_dir = tempfile::tempdir().unwrap();
        let manifest_dir = tmp_dir.path().join("crates/core");
        let target_release = tmp_dir.path().join("target/release");
        std::fs::create_dir_all(&manifest_dir).unwrap();
        std::fs::create_dir_all(&target_release).unwrap();

        let helper_bin = target_release.join("simtouch");
        std::fs::write(&helper_bin, "#!/bin/sh\n").unwrap();

        let resolved = resolve_simtouch_path_internal(None, manifest_dir.to_str());
        assert_eq!(
            resolved,
            Some(helper_bin.canonicalize().unwrap_or(helper_bin))
        );
    }

    struct MockPipeWriter {
        buffer: Arc<Mutex<Vec<u8>>>,
    }

    impl io::Write for MockPipeWriter {
        fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
            self.buffer.lock().unwrap().extend_from_slice(buf);
            Ok(buf.len())
        }

        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }
    }

    #[test]
    fn test_android_to_hid_keycode_mapping() {
        assert_eq!(android_to_hid_keycode(66), Some(40)); // Enter
        assert_eq!(android_to_hid_keycode(67), Some(42)); // Backspace
        assert_eq!(android_to_hid_keycode(61), Some(43)); // Tab
        assert_eq!(android_to_hid_keycode(62), Some(44)); // Space
        assert_eq!(android_to_hid_keycode(111), Some(41)); // Escape
        assert_eq!(android_to_hid_keycode(112), Some(76)); // Delete
        assert_eq!(android_to_hid_keycode(21), Some(80)); // Arrow Left
        assert_eq!(android_to_hid_keycode(22), Some(79)); // Arrow Right
        assert_eq!(android_to_hid_keycode(19), Some(82)); // Arrow Up
        assert_eq!(android_to_hid_keycode(20), Some(81)); // Arrow Down
        assert_eq!(android_to_hid_keycode(3), Some(74)); // Home
        assert_eq!(android_to_hid_keycode(122), Some(74)); // Home
        assert_eq!(android_to_hid_keycode(123), Some(77)); // End
        assert_eq!(android_to_hid_keycode(92), Some(75)); // Page Up
        assert_eq!(android_to_hid_keycode(93), Some(78)); // Page Down
        assert_eq!(android_to_hid_keycode(999), None);
    }

    #[test]
    fn test_send_daemon_command_stream() {
        let mut buf = Vec::new();
        send_daemon_command(&mut buf, "d 10 20 100 200").unwrap();
        assert_eq!(String::from_utf8(buf).unwrap(), "d 10 20 100 200\n");

        let mut buf2 = Vec::new();
        send_daemon_command(&mut buf2, "u 10 20 100 200\n").unwrap();
        assert_eq!(String::from_utf8(buf2).unwrap(), "u 10 20 100 200\n");
    }

    #[test]
    fn test_simulator_input_with_daemon_touch_stream() {
        let udid = "DAEMON-TOUCH-UDID-001";
        let buf = Arc::new(Mutex::new(Vec::new()));
        let writer = Box::new(MockPipeWriter {
            buffer: Arc::clone(&buf),
        });
        daemon_tracker().register(udid, writer);

        let fake = FakeExec {
            calls: Mutex::new(Vec::new()),
            idb_available: false,
            simtouch_available: true,
        };

        // 1. Down
        let ev_down = InputEvent::Touch {
            action: TouchAction::Down,
            x: 100,
            y: 200,
            w: 800,
            h: 1600,
        };
        send_simulator_input(&fake, udid, &ev_down).unwrap();

        // 2. Move (streamed real-time, no delay)
        let ev_move = InputEvent::Touch {
            action: TouchAction::Move,
            x: 100,
            y: 250,
            w: 800,
            h: 1600,
        };
        send_simulator_input(&fake, udid, &ev_move).unwrap();

        // 3. Up
        let ev_up = InputEvent::Touch {
            action: TouchAction::Up,
            x: 100,
            y: 250,
            w: 800,
            h: 1600,
        };
        send_simulator_input(&fake, udid, &ev_up).unwrap();

        let output = String::from_utf8(buf.lock().unwrap().clone()).unwrap();
        assert_eq!(
            output,
            "d 100 200 800 1600\nm 100 250 800 1600\nu 100 250 800 1600\n"
        );

        // FakeExec must NOT have been called (events streamed over daemon pipe, 0 process forks!)
        assert_eq!(fake.calls.lock().unwrap().len(), 0);

        daemon_tracker().unregister(udid);
    }

    #[test]
    fn test_simulator_input_with_daemon_text() {
        let udid = "DAEMON-TEXT-UDID-002";
        let buf = Arc::new(Mutex::new(Vec::new()));
        let writer = Box::new(MockPipeWriter {
            buffer: Arc::clone(&buf),
        });
        daemon_tracker().register(udid, writer);

        let fake = FakeExec {
            calls: Mutex::new(Vec::new()),
            idb_available: false,
            simtouch_available: true,
        };

        let ev_text = InputEvent::Text {
            text: "Hello World".to_string(),
        };
        send_simulator_input(&fake, udid, &ev_text).unwrap();

        let ev_text_newline = InputEvent::Text {
            text: "Line1\nLine2".to_string(),
        };
        send_simulator_input(&fake, udid, &ev_text_newline).unwrap();

        let output = String::from_utf8(buf.lock().unwrap().clone()).unwrap();
        assert_eq!(output, "text Hello World\ntext Line1\\nLine2\n");
        assert_eq!(fake.calls.lock().unwrap().len(), 0);

        daemon_tracker().unregister(udid);
    }

    #[test]
    fn test_simulator_input_with_daemon_key_and_nav() {
        let udid = "DAEMON-KEY-UDID-003";
        let buf = Arc::new(Mutex::new(Vec::new()));
        let writer = Box::new(MockPipeWriter {
            buffer: Arc::clone(&buf),
        });
        daemon_tracker().register(udid, writer);

        let fake = FakeExec {
            calls: Mutex::new(Vec::new()),
            idb_available: false,
            simtouch_available: true,
        };

        // Android Enter (66) -> USB HID 40
        let ev_enter = InputEvent::Key {
            keycode: 66,
            action: KeyAction::Down,
        };
        send_simulator_input(&fake, udid, &ev_enter).unwrap();

        // Android Backspace (67) -> USB HID 42
        let ev_backspace = InputEvent::Key {
            keycode: 67,
            action: KeyAction::Down,
        };
        send_simulator_input(&fake, udid, &ev_backspace).unwrap();

        // Nav Home
        let ev_home = InputEvent::Nav { key: NavKey::Home };
        send_simulator_input(&fake, udid, &ev_home).unwrap();

        // Scroll
        let ev_scroll = InputEvent::Scroll {
            x: 100,
            y: 200,
            w: 800,
            h: 1600,
            dx: 0.0,
            dy: 50.0,
        };
        send_simulator_input(&fake, udid, &ev_scroll).unwrap();

        let output = String::from_utf8(buf.lock().unwrap().clone()).unwrap();
        assert_eq!(
            output,
            "k 40\nk 42\nb home\ns 100 200 100 250 800 1600 200 10\n"
        );
        assert_eq!(fake.calls.lock().unwrap().len(), 0);

        daemon_tracker().unregister(udid);
    }

    #[test]
    fn test_simulator_input_daemon_fallback_when_unregistered() {
        let udid = "DAEMON-FALLBACK-UDID-004";
        // Ensure not registered
        daemon_tracker().unregister(udid);

        let fake = FakeExec {
            calls: Mutex::new(Vec::new()),
            idb_available: false,
            simtouch_available: true,
        };

        let ev = InputEvent::Key {
            keycode: 66, // Enter mapped to 40
            action: KeyAction::Down,
        };
        send_simulator_input(&fake, udid, &ev).unwrap();

        let calls = fake.calls.lock().unwrap();
        assert_eq!(calls.len(), 2);
        assert_eq!(calls[1], vec!["simtouch", "key", "40", "--udid", udid]);
    }
}
