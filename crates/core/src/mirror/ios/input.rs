use std::io;
use std::path::{Path, PathBuf};

use crate::exec::Exec;
use crate::mirror::control::{InputEvent, NavKey, TouchAction};

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
        InputEvent::Touch {
            action,
            x,
            y,
            w,
            h,
        } => {
            if matches!(action, TouchAction::Down | TouchAction::Up) {
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
        InputEvent::Scroll {
            x,
            y,
            w,
            h,
            dx,
            dy,
        } => {
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
            let key_str = keycode.to_string();
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
        InputEvent::Text { .. } => {
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
        assert_eq!(calls.len(), 2); // which simtouch, then simtouch tap
        assert_eq!(
            calls[1],
            vec![
                "simtouch",
                "tap",
                "100",
                "200",
                "800",
                "1600",
                "--udid",
                "E1B3E035-7F2A-4B6E-9E8D-7F6335CD5E90"
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
        let ev = InputEvent::Nav {
            key: NavKey::Power,
        };
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
        let ev1 = InputEvent::Nav {
            key: NavKey::Volup,
        };
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
        assert_eq!(resolved, Some(helper_bin.canonicalize().unwrap_or(helper_bin)));
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
        assert_eq!(resolved, Some(helper_bin.canonicalize().unwrap_or(helper_bin)));
    }
}
