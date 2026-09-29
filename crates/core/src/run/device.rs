use std::io;
use std::path::Path;
use std::sync::mpsc::Sender;
use std::thread;

use serde::{Deserialize, Serialize};

use crate::exec::{Exec, Proc, ProcLine, Spawn};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Device {
    pub id: String,
    pub name: String,
    pub platform: DevicePlatform,
    pub kind: DeviceKind,
    pub state: DeviceState,
    pub sdk: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DevicePlatform {
    Android,
    Ios,
    Web,
    Desktop,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DeviceKind {
    Physical,
    Emulator,
    Simulator,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DeviceState {
    Online,
    Offline,
    Unauthorized,
    Booting,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Avd {
    pub name: String,
}

/// Validate device ID (regex: ^[A-Za-z0-9._:-]+$)
pub fn is_valid_device_id(id: &str) -> bool {
    !id.is_empty()
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == ':' || c == '-')
}

/// Validate AVD name (regex: ^[A-Za-z0-9._:-]+$, cannot start with '-')
pub fn is_valid_avd_name(name: &str) -> bool {
    !name.is_empty()
        && !name.starts_with('-')
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == ':' || c == '-')
}

/// Parse `adb devices -l` output into a list of devices.
pub fn parse_adb_devices(output: &str) -> Vec<Device> {
    let mut devices = Vec::new();
    for line in output.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with("List of devices attached") {
            continue;
        }

        let mut parts = line.split_whitespace();
        let id = match parts.next() {
            Some(id) if is_valid_device_id(id) => id,
            _ => continue,
        };

        let state_str = parts.next().unwrap_or("offline");
        let state = match state_str {
            "device" => DeviceState::Online,
            "offline" => DeviceState::Offline,
            "unauthorized" => DeviceState::Unauthorized,
            "bootloader" | "authorizing" => DeviceState::Booting,
            _ => DeviceState::Offline,
        };

        let kind = if id.starts_with("emulator-") {
            DeviceKind::Emulator
        } else {
            DeviceKind::Physical
        };

        // Check if model:<name> is available
        let mut model_name = None;
        for token in parts {
            if let Some(m) = token.strip_prefix("model:") {
                model_name = Some(m.replace('_', " "));
                break;
            }
        }
        let name = model_name.unwrap_or_else(|| id.to_string());

        devices.push(Device {
            id: id.to_string(),
            name,
            platform: DevicePlatform::Android,
            kind,
            state,
            sdk: None,
        });
    }
    devices
}

/// Parse `flutter devices --machine` JSON output.
pub fn parse_flutter_devices(json_str: &str) -> Result<Vec<Device>, serde_json::Error> {
    let items: Vec<serde_json::Value> = serde_json::from_str(json_str)?;
    let mut devices = Vec::new();

    for item in items {
        let id = match item.get("id").and_then(|v| v.as_str()) {
            Some(id) if is_valid_device_id(id) => id.to_string(),
            _ => continue,
        };

        let name = item
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or(&id)
            .to_string();

        let target_platform = item
            .get("targetPlatform")
            .and_then(|v| v.as_str())
            .unwrap_or("");

        let platform = if target_platform.contains("android") {
            DevicePlatform::Android
        } else if target_platform.contains("ios") {
            DevicePlatform::Ios
        } else if target_platform.contains("web") {
            DevicePlatform::Web
        } else {
            DevicePlatform::Desktop
        };

        let is_emulator = item
            .get("emulator")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);

        let kind = if is_emulator {
            if platform == DevicePlatform::Ios {
                DeviceKind::Simulator
            } else {
                DeviceKind::Emulator
            }
        } else {
            DeviceKind::Physical
        };

        let sdk = item
            .get("sdk")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        devices.push(Device {
            id,
            name,
            platform,
            kind,
            state: DeviceState::Online,
            sdk,
        });
    }

    Ok(devices)
}

/// Parse `emulator -list-avds` output.
pub fn parse_emulator_avds(output: &str) -> Vec<Avd> {
    let mut avds = Vec::new();
    for line in output.lines() {
        let trimmed = line.trim();
        if !trimmed.is_empty() && is_valid_avd_name(trimmed) {
            avds.push(Avd {
                name: trimmed.to_string(),
            });
        }
    }
    avds
}

/// Parse one frame from `adb track-devices` stream.
/// Frame format: 4-hex length prefix followed by payload.
/// "0000" signifies 0 payload bytes (empty device list).
/// Returns parsed devices and the remaining unparsed slice of input.
pub fn parse_track_devices_frame(input: &str) -> Result<(Vec<Device>, &str), String> {
    if input.len() < 4 {
        return Err("input too short for 4-hex header".to_string());
    }

    let hex_header = &input[..4];
    if hex_header == "0000" {
        let mut rest = &input[4..];
        if rest.starts_with("\r\n") {
            rest = &rest[2..];
        } else if rest.starts_with('\n') {
            rest = &rest[1..];
        }
        return Ok((Vec::new(), rest));
    }

    let len = usize::from_str_radix(hex_header, 16)
        .map_err(|e| format!("invalid hex length '{}': {}", hex_header, e))?;

    if input.len() < 4 + len {
        return Err(format!(
            "incomplete frame: expected {} payload bytes, got {}",
            len,
            input.len() - 4
        ));
    }

    let payload = &input[4..4 + len];
    let mut rest = &input[4 + len..];
    if rest.starts_with("\r\n") {
        rest = &rest[2..];
    } else if rest.starts_with('\n') {
        rest = &rest[1..];
    }

    let devices = parse_track_devices_payload(payload);
    Ok((devices, rest))
}

/// Parse payload text from `adb track-devices`.
pub fn parse_track_devices_payload(payload: &str) -> Vec<Device> {
    let mut devices = Vec::new();
    for line in payload.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        let mut parts = line.split_whitespace();
        let id = match parts.next() {
            Some(id) if is_valid_device_id(id) => id,
            _ => continue,
        };

        let state_str = parts.next().unwrap_or("offline");
        let state = match state_str {
            "device" => DeviceState::Online,
            "offline" => DeviceState::Offline,
            "unauthorized" => DeviceState::Unauthorized,
            "bootloader" | "authorizing" => DeviceState::Booting,
            _ => DeviceState::Offline,
        };

        let kind = if id.starts_with("emulator-") {
            DeviceKind::Emulator
        } else {
            DeviceKind::Physical
        };

        devices.push(Device {
            id: id.to_string(),
            name: id.to_string(),
            platform: DevicePlatform::Android,
            kind,
            state,
            sdk: None,
        });
    }
    devices
}

/// Build arguments for emulator command.
pub fn build_emulator_args(avd: &str, headless: bool) -> io::Result<Vec<String>> {
    if !is_valid_avd_name(avd) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("invalid AVD name: {}", avd),
        ));
    }

    let mut args = vec!["-avd".to_string(), avd.to_string()];
    if headless {
        args.extend([
            "-no-window".to_string(),
            "-no-audio".to_string(),
            "-gpu".to_string(),
            "swiftshader_indirect".to_string(),
        ]);
    }
    Ok(args)
}

pub fn resolve_emulator_binary() -> String {
    crate::toolchain::resolve_emulator()
}

pub fn resolve_adb_binary() -> String {
    crate::toolchain::resolve_adb()
}

/// Query the list of installed Android Virtual Devices (AVDs).
pub fn list_avds(exec: &dyn Exec) -> Vec<Avd> {
    let emu_cmd = resolve_emulator_binary();
    if let Ok(output) = exec.run(Path::new("."), &emu_cmd, &["-list-avds"], &[], None) {
        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            return parse_emulator_avds(&stdout);
        }
    }
    Vec::new()
}

/// Start an Android emulator with an AVD name and optional headless flags.
pub fn start_emulator(
    spawn: &dyn Spawn,
    avd: &str,
    headless: bool,
) -> io::Result<Box<dyn Proc>> {
    let args = build_emulator_args(avd, headless)?;
    let args_ref: Vec<&str> = args.iter().map(|s| s.as_str()).collect();

    let emu_cmd = resolve_emulator_binary();
    let (tx, _rx) = std::sync::mpsc::channel();
    spawn.spawn(Path::new("."), &emu_cmd, &args_ref, &[], tx)
}

/// Watch device connect/disconnect events using `adb track-devices`.
/// Non-polling, streaming push notifications via `adb track-devices`.
pub fn watch_devices(
    spawn: &dyn Spawn,
    tx: Sender<Vec<Device>>,
) -> io::Result<Box<dyn Proc>> {
    let adb_cmd = resolve_adb_binary();

    // Ensure adb server is running first
    let (start_tx, start_rx) = std::sync::mpsc::channel();
    if let Ok(_start_proc) = spawn.spawn(Path::new("."), &adb_cmd, &["start-server"], &[], start_tx) {
        while let Ok(line) = start_rx.recv() {
            if matches!(line, ProcLine::Exit(_)) {
                break;
            }
        }
    }

    let (proc_tx, proc_rx) = std::sync::mpsc::channel();
    let proc = spawn.spawn(Path::new("."), &adb_cmd, &["track-devices"], &[], proc_tx)?;

    thread::spawn(move || {
        let mut buffer = String::new();
        while let Ok(line) = proc_rx.recv() {
            match line {
                ProcLine::Stdout(text) => {
                    buffer.push_str(&text);
                    buffer.push('\n');
                    while let Ok((devices, rest)) = parse_track_devices_frame(&buffer) {
                        let _ = tx.send(devices);
                        buffer = rest.to_string();
                    }
                }
                ProcLine::Stderr(_) => {}
                ProcLine::Exit(_) => break,
            }
        }
    });

    Ok(proc)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validations() {
        assert!(is_valid_device_id("emulator-5554"));
        assert!(is_valid_device_id("R5CR30XYZ"));
        assert!(is_valid_device_id("192.168.1.50:5555"));
        assert!(!is_valid_device_id(""));
        assert!(!is_valid_device_id("device; rm -rf /"));
        assert!(!is_valid_device_id("dev$id"));

        assert!(is_valid_avd_name("jatim_dev"));
        assert!(is_valid_avd_name("Pixel_7_API_34"));
        assert!(!is_valid_avd_name(""));
        assert!(!is_valid_avd_name("avd; echo hacked"));
        assert!(!is_valid_avd_name("--foo"));
        assert!(!is_valid_avd_name("-avd"));
    }

    #[test]
    fn test_parse_adb_devices() {
        let fixture = "\
List of devices attached
emulator-5554          device product:sdk_gphone64_x86_64 model:sdk_gphone64_x86_64 device:emu64x transport_id:1
R5CR30XYZ              device usb:1-1 product:a52sxq model:SM_A528B device:a52sxq transport_id:2
emulator-5556          offline transport_id:4
emulator-5558          unauthorized transport_id:5
";
        let devices = parse_adb_devices(fixture);
        assert_eq!(devices.len(), 4);

        assert_eq!(devices[0].id, "emulator-5554");
        assert_eq!(devices[0].name, "sdk gphone64 x86 64");
        assert_eq!(devices[0].kind, DeviceKind::Emulator);
        assert_eq!(devices[0].state, DeviceState::Online);
        assert_eq!(devices[0].platform, DevicePlatform::Android);

        assert_eq!(devices[1].id, "R5CR30XYZ");
        assert_eq!(devices[1].name, "SM A528B");
        assert_eq!(devices[1].kind, DeviceKind::Physical);
        assert_eq!(devices[1].state, DeviceState::Online);

        assert_eq!(devices[2].id, "emulator-5556");
        assert_eq!(devices[2].kind, DeviceKind::Emulator);
        assert_eq!(devices[2].state, DeviceState::Offline);

        assert_eq!(devices[3].id, "emulator-5558");
        assert_eq!(devices[3].kind, DeviceKind::Emulator);
        assert_eq!(devices[3].state, DeviceState::Unauthorized);
    }

    #[test]
    fn test_parse_flutter_devices() {
        let json = r#"[
  {
    "name": "sdk gphone64 x86 64",
    "id": "emulator-5554",
    "isSupported": true,
    "targetPlatform": "android-x64",
    "emulator": true,
    "sdk": "Android 15 (API 35)"
  },
  {
    "name": "iPhone 15 Pro",
    "id": "71C254BC-D43C-4384-9D67-27C86A514138",
    "isSupported": true,
    "targetPlatform": "ios",
    "emulator": true,
    "sdk": "iOS 17.5"
  },
  {
    "name": "Linux",
    "id": "linux",
    "isSupported": true,
    "targetPlatform": "linux-x64",
    "emulator": false,
    "sdk": "Ubuntu 24.04"
  }
]"#;
        let devices = parse_flutter_devices(json).unwrap();
        assert_eq!(devices.len(), 3);

        assert_eq!(devices[0].id, "emulator-5554");
        assert_eq!(devices[0].kind, DeviceKind::Emulator);
        assert_eq!(devices[0].platform, DevicePlatform::Android);
        assert_eq!(devices[0].sdk, Some("Android 15 (API 35)".to_string()));

        assert_eq!(devices[1].id, "71C254BC-D43C-4384-9D67-27C86A514138");
        assert_eq!(devices[1].kind, DeviceKind::Simulator);
        assert_eq!(devices[1].platform, DevicePlatform::Ios);

        assert_eq!(devices[2].id, "linux");
        assert_eq!(devices[2].kind, DeviceKind::Physical);
        assert_eq!(devices[2].platform, DevicePlatform::Desktop);
    }

    #[test]
    fn test_parse_emulator_avds() {
        let output = "jatim_dev\nPixel_7_API_34\n\n";
        let avds = parse_emulator_avds(output);
        assert_eq!(avds.len(), 2);
        assert_eq!(avds[0].name, "jatim_dev");
        assert_eq!(avds[1].name, "Pixel_7_API_34");
    }

    #[test]
    fn test_parse_track_devices_frame() {
        // Frame 0000: empty
        let (devs, rest) = parse_track_devices_frame("0000").unwrap();
        assert!(devs.is_empty());
        assert_eq!(rest, "");

        // Frame with 1 device
        let frame1 = "0015emulator-5554\tdevice\n";
        let (devs, rest) = parse_track_devices_frame(frame1).unwrap();
        assert_eq!(devs.len(), 1);
        assert_eq!(devs[0].id, "emulator-5554");
        assert_eq!(devs[0].state, DeviceState::Online);
        assert_eq!(devs[0].kind, DeviceKind::Emulator);
        assert_eq!(rest, "");

        // Multiple frames in stream
        let stream = "00000015emulator-5554\tdevice\n0000";
        let (devs1, rest1) = parse_track_devices_frame(stream).unwrap();
        assert!(devs1.is_empty());
        assert_eq!(rest1, "0015emulator-5554\tdevice\n0000");

        let (devs2, rest2) = parse_track_devices_frame(rest1).unwrap();
        assert_eq!(devs2.len(), 1);
        assert_eq!(devs2[0].id, "emulator-5554");
        assert_eq!(rest2, "0000");

        let (devs3, rest3) = parse_track_devices_frame(rest2).unwrap();
        assert!(devs3.is_empty());
        assert_eq!(rest3, "");
    }

    #[test]
    fn test_build_emulator_args() {
        let args = build_emulator_args("jatim_dev", true).unwrap();
        assert_eq!(
            args,
            vec![
                "-avd",
                "jatim_dev",
                "-no-window",
                "-no-audio",
                "-gpu",
                "swiftshader_indirect"
            ]
        );

        let err = build_emulator_args("bad;injection", true);
        assert!(err.is_err());
        let err_flag = build_emulator_args("--foo", true);
        assert!(err_flag.is_err());
    }

    #[test]
    fn test_list_avds_mock() {
        struct MockEmuExec;
        impl Exec for MockEmuExec {
            fn run(
                &self,
                _cwd: &Path,
                _cmd: &str,
                args: &[&str],
                _env: &[(&str, &str)],
                _stdin: Option<&[u8]>,
            ) -> io::Result<std::process::Output> {
                assert_eq!(args, &["-list-avds"]);
                #[cfg(unix)]
                use std::os::unix::process::ExitStatusExt;
                #[cfg(windows)]
                use std::os::windows::process::ExitStatusExt;

                Ok(std::process::Output {
                    status: std::process::ExitStatus::from_raw(0),
                    stdout: b"Pixel_7\njatim_dev\n".to_vec(),
                    stderr: Vec::new(),
                })
            }
        }
        let avds = list_avds(&MockEmuExec);
        assert_eq!(avds.len(), 2);
        assert_eq!(avds[0].name, "Pixel_7");
        assert_eq!(avds[1].name, "jatim_dev");
    }
}
