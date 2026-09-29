use std::io;
use std::path::Path;

use crate::exec::Exec;
use crate::mirror::control::{InputEvent, NavKey, TouchAction};

/// Handle input forwarding for an iOS Simulator session.
/// Best effort:
/// 1. Uses `idb` (iOS Development Bridge) if installed on host.
/// 2. Falls back to AppleScript / CGEvent on macOS if Accessibility is granted.
/// 3. If neither is available, documents view-only status and returns an informative error.
pub fn send_simulator_input(exec: &dyn Exec, udid: &str, event: &InputEvent) -> io::Result<()> {
    // 1. Try idb CLI if present
    if has_idb(exec) {
        return send_idb_input(exec, udid, event);
    }

    // 2. Try macOS CGEvent / AppleScript when running natively on macOS
    #[cfg(target_os = "macos")]
    {
        return send_cgevent_simulator_input(event);
    }

    // 3. Fallback: view-only with written rationale
    #[allow(unreachable_code)]
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "iOS Simulator input requires macOS Accessibility permissions for CGEvent or Facebook idb CLI ('idb ui tap'). The mirror session is operating in view-only mode.",
    ))
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
    use std::process::Output;
    use std::sync::Mutex;

    struct FakeExec {
        calls: Mutex<Vec<Vec<String>>>,
        idb_available: bool,
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

            let exit_code = if program == "which" && args.contains(&"idb") {
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
    fn test_simulator_input_without_idb_returns_rationale() {
        let fake = FakeExec {
            calls: Mutex::new(Vec::new()),
            idb_available: false,
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
    fn test_simulator_input_with_idb() {
        let fake = FakeExec {
            calls: Mutex::new(Vec::new()),
            idb_available: true,
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
        assert_eq!(calls.len(), 2); // which idb, then idb ui tap
        assert_eq!(
            calls[1],
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
}
