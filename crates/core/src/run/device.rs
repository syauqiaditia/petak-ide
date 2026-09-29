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

/// Start an AVD. `cold` = true wipes the snapshot for a cold boot.
pub fn avd_start(
    spawn: &dyn Spawn,
    avd: &str,
    cold: bool,
    headless: bool,
) -> io::Result<Box<dyn Proc>> {
    if !is_valid_avd_name(avd) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("invalid AVD name: {}", avd),
        ));
    }
    let emu_cmd = resolve_emulator_binary();
    let mut args = vec!["-avd".to_string(), avd.to_string()];
    if cold {
        args.push("-no-snapshot-load".to_string());
    }
    if headless {
        args.extend([
            "-no-window".to_string(),
            "-no-audio".to_string(),
            "-gpu".to_string(),
            "swiftshader_indirect".to_string(),
        ]);
    }
    let args_ref: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    let (tx, _rx) = std::sync::mpsc::channel();
    spawn.spawn(Path::new("."), &emu_cmd, &args_ref, &[], tx)
}

/// Query the running AVD name for an emulator device ID using `adb -s <id> emu avd name`.
pub fn get_running_avd_name(exec: &dyn Exec, adb: &str, device_id: &str) -> Option<String> {
    let out = exec
        .run(
            Path::new("."),
            adb,
            &["-s", device_id, "emu", "avd", "name"],
            &[],
            None,
        )
        .ok()?;

    if !out.status.success() {
        return None;
    }

    let stdout = String::from_utf8_lossy(&out.stdout);
    for line in stdout.lines() {
        let trimmed = line.trim();
        if !trimmed.is_empty()
            && trimmed != "OK"
            && !trimmed.starts_with("KO")
            && !trimmed.contains("Authentication required")
        {
            return Some(trimmed.to_string());
        }
    }
    None
}

/// Stop a running AVD by finding its emulator device and killing it.
pub fn avd_stop(exec: &dyn Exec, avd: &str) -> io::Result<()> {
    if !is_valid_avd_name(avd) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("invalid AVD name: {}", avd),
        ));
    }
    let adb = resolve_adb_binary();

    // List devices to find running emulators
    let output = exec.run(Path::new("."), &adb, &["devices"], &[], None)?;
    let stdout = String::from_utf8_lossy(&output.stdout);

    let mut running_emulators = Vec::new();
    for line in stdout.lines() {
        let line = line.trim();
        if let Some(device_id) = line.split_whitespace().next() {
            if device_id.starts_with("emulator-") && line.contains("device") {
                running_emulators.push(device_id.to_string());
            }
        }
    }

    // Match specific emulator by querying AVD name
    for emu_id in &running_emulators {
        if let Some(name) = get_running_avd_name(exec, &adb, emu_id) {
            if name == avd {
                let _ = exec.run(
                    Path::new("."),
                    &adb,
                    &["-s", emu_id, "emu", "kill"],
                    &[],
                    None,
                );
                return Ok(());
            }
        }
    }

    // Fallback: if only 1 emulator is running and get_running_avd_name was None (e.g. unmocked/console auth),
    // we can stop that single emulator. If multiple emulators are running, never kill blindly.
    if running_emulators.len() == 1 {
        let emu_id = &running_emulators[0];
        if get_running_avd_name(exec, &adb, emu_id).is_none() {
            let _ = exec.run(
                Path::new("."),
                &adb,
                &["-s", emu_id, "emu", "kill"],
                &[],
                None,
            );
        }
    }

    Ok(())
}

/// Snapshot of all devices, grouped for the UI.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DevicesSnapshot {
    pub emulators: Vec<EmulatorInfo>,
    pub physical: Vec<PhysicalDevice>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmulatorInfo {
    pub id: String,
    pub name: String,
    pub kind: String,  // "android-avd" | "ios-sim"
    pub state: String, // "running" | "stopped" | "booting"
    pub device_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PhysicalDevice {
    pub id: String,
    pub name: String,
    pub platform: String,  // "android" | "ios"
    pub transport: String, // "usb" | "wifi"
}

/// Build a unified devices snapshot from all sources.
pub fn devices_snapshot(exec: &dyn Exec) -> DevicesSnapshot {
    let mut emulators = Vec::new();
    let mut physical = Vec::new();

    let adb = resolve_adb_binary();

    // 1. Android AVDs (emulator -list-avds) and running emulators (adb devices)
    let avds = list_avds(exec);
    let running_android = if let Ok(out) =
        exec.run(Path::new("."), &adb, &["devices", "-l"], &[], None)
    {
        if out.status.success() {
            parse_adb_devices(&String::from_utf8_lossy(&out.stdout))
        } else {
            Vec::new()
        }
    } else {
        Vec::new()
    };

    // Map running emulator IDs to their names
    let mut avd_to_device_id = std::collections::HashMap::new();
    let mut unmatched_emu_ids = Vec::new();

    for dev in &running_android {
        if dev.kind == DeviceKind::Emulator && dev.state == DeviceState::Online {
            if let Some(avd_name) = get_running_avd_name(exec, &adb, &dev.id) {
                avd_to_device_id.insert(avd_name, dev.id.clone());
            } else {
                unmatched_emu_ids.push(dev.id.clone());
            }
        }
    }

    for avd in &avds {
        // Match specific running emulator by AVD name first
        let device_id = if let Some(id) = avd_to_device_id.remove(&avd.name) {
            Some(id)
        } else if avd_to_device_id.is_empty() && !unmatched_emu_ids.is_empty() {
            // Fallback if emu avd name query not available: consume at most one emulator per AVD
            unmatched_emu_ids.pop()
        } else {
            None
        };

        let is_running = device_id.is_some();
        emulators.push(EmulatorInfo {
            id: avd.name.clone(),
            name: avd.name.clone(),
            kind: "android-avd".to_string(),
            state: if is_running {
                "running".to_string()
            } else {
                "stopped".to_string()
            },
            device_id,
        });
    }

    // Any remaining running emulators that weren't in the avds list
    for (avd_name, dev_id) in avd_to_device_id {
        emulators.push(EmulatorInfo {
            id: avd_name.clone(),
            name: avd_name,
            kind: "android-avd".to_string(),
            state: "running".to_string(),
            device_id: Some(dev_id),
        });
    }

    for dev_id in unmatched_emu_ids {
        emulators.push(EmulatorInfo {
            id: dev_id.clone(),
            name: dev_id.clone(),
            kind: "android-avd".to_string(),
            state: "running".to_string(),
            device_id: Some(dev_id),
        });
    }

    // Physical Android devices
    for dev in &running_android {
        if dev.kind == DeviceKind::Physical && dev.state == DeviceState::Online {
            let transport = if dev.id.contains(':') {
                "wifi"
            } else {
                "usb"
            };
            physical.push(PhysicalDevice {
                id: dev.id.clone(),
                name: dev.name.clone(),
                platform: "android".to_string(),
                transport: transport.to_string(),
            });
        }
    }

    // 2. iOS Simulators (xcrun simctl)
    if let Ok(out) = exec.run(
        Path::new("."),
        "xcrun",
        &["simctl", "list", "devices", "available", "--json"],
        &[],
        None,
    ) {
        if out.status.success() {
            let json_str = String::from_utf8_lossy(&out.stdout);
            if let Ok(sims) = crate::run::ios::parse_simctl_devices(&json_str) {
                for sim in sims {
                    let state = match sim.state {
                        DeviceState::Online => "running",
                        DeviceState::Booting => "booting",
                        _ => "stopped",
                    };
                    emulators.push(EmulatorInfo {
                        id: sim.id.clone(),
                        name: sim.name,
                        kind: "ios-sim".to_string(),
                        state: state.to_string(),
                        device_id: if state == "running" {
                            Some(sim.id)
                        } else {
                            None
                        },
                    });
                }
            }
        }
    }

    // 3. Physical iOS devices (xcrun devicectl)
    if let Ok(out) = exec.run(
        Path::new("."),
        "xcrun",
        &["devicectl", "list", "devices", "--json-output", "-"],
        &[],
        None,
    ) {
        if out.status.success() {
            let json_str = String::from_utf8_lossy(&out.stdout);
            if let Ok(devs) = crate::run::ios::parse_devicectl_devices(&json_str) {
                for dev in devs {
                    if dev.state == DeviceState::Online {
                        physical.push(PhysicalDevice {
                            id: dev.id,
                            name: dev.name,
                            platform: "ios".to_string(),
                            transport: "usb".to_string(),
                        });
                    }
                }
            }
        }
    }

    DevicesSnapshot {
        emulators,
        physical,
    }
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

    #[test]
    fn test_devices_snapshot_multi_avd() {
        struct MockSnapshotExec;
        impl Exec for MockSnapshotExec {
            fn run(
                &self,
                _cwd: &Path,
                cmd: &str,
                args: &[&str],
                _env: &[(&str, &str)],
                _stdin: Option<&[u8]>,
            ) -> io::Result<std::process::Output> {
                #[cfg(unix)]
                use std::os::unix::process::ExitStatusExt;

                if args == &["-list-avds"] {
                    return Ok(std::process::Output {
                        status: std::process::ExitStatus::from_raw(0),
                        stdout: b"Pixel_7\njatim_dev\nTablet\n".to_vec(),
                        stderr: Vec::new(),
                    });
                }
                if args == &["devices", "-l"] {
                    return Ok(std::process::Output {
                        status: std::process::ExitStatus::from_raw(0),
                        stdout: b"List of devices attached\nemulator-5554 device product:sdk_gphone64 model:Pixel_7 device:emu64x transport_id:1\n".to_vec(),
                        stderr: Vec::new(),
                    });
                }
                if args == &["-s", "emulator-5554", "emu", "avd", "name"] {
                    return Ok(std::process::Output {
                        status: std::process::ExitStatus::from_raw(0),
                        stdout: b"Pixel_7\r\nOK\r\n".to_vec(),
                        stderr: Vec::new(),
                    });
                }
                if cmd == "xcrun" {
                    return Err(io::Error::other("xcrun not found"));
                }
                Ok(std::process::Output {
                    status: std::process::ExitStatus::from_raw(0),
                    stdout: Vec::new(),
                    stderr: Vec::new(),
                })
            }
        }

        let snap = devices_snapshot(&MockSnapshotExec);
        let avds: Vec<_> = snap.emulators.into_iter().filter(|e| e.kind == "android-avd").collect();
        assert_eq!(avds.len(), 3);

        let pixel7 = avds.iter().find(|e| e.name == "Pixel_7").unwrap();
        assert_eq!(pixel7.state, "running");
        assert_eq!(pixel7.device_id, Some("emulator-5554".to_string()));

        let jatim = avds.iter().find(|e| e.name == "jatim_dev").unwrap();
        assert_eq!(jatim.state, "stopped");
        assert_eq!(jatim.device_id, None);

        let tablet = avds.iter().find(|e| e.name == "Tablet").unwrap();
        assert_eq!(tablet.state, "stopped");
        assert_eq!(tablet.device_id, None);
    }

    #[test]
    fn test_avd_stop_specific_emulator() {
        use std::sync::atomic::{AtomicBool, Ordering};
        use std::sync::Arc;

        struct MockStopExec {
            killed_5554: Arc<AtomicBool>,
            killed_5556: Arc<AtomicBool>,
        }
        impl Exec for MockStopExec {
            fn run(
                &self,
                _cwd: &Path,
                _cmd: &str,
                args: &[&str],
                _env: &[(&str, &str)],
                _stdin: Option<&[u8]>,
            ) -> io::Result<std::process::Output> {
                #[cfg(unix)]
                use std::os::unix::process::ExitStatusExt;

                if args == &["devices"] {
                    return Ok(std::process::Output {
                        status: std::process::ExitStatus::from_raw(0),
                        stdout: b"List of devices attached\nemulator-5554 device\nemulator-5556 device\n".to_vec(),
                        stderr: Vec::new(),
                    });
                }
                if args == &["-s", "emulator-5554", "emu", "avd", "name"] {
                    return Ok(std::process::Output {
                        status: std::process::ExitStatus::from_raw(0),
                        stdout: b"Pixel_7\r\nOK\r\n".to_vec(),
                        stderr: Vec::new(),
                    });
                }
                if args == &["-s", "emulator-5556", "emu", "avd", "name"] {
                    return Ok(std::process::Output {
                        status: std::process::ExitStatus::from_raw(0),
                        stdout: b"jatim_dev\r\nOK\r\n".to_vec(),
                        stderr: Vec::new(),
                    });
                }
                if args == &["-s", "emulator-5554", "emu", "kill"] {
                    self.killed_5554.store(true, Ordering::SeqCst);
                    return Ok(std::process::Output {
                        status: std::process::ExitStatus::from_raw(0),
                        stdout: b"OK\r\n".to_vec(),
                        stderr: Vec::new(),
                    });
                }
                if args == &["-s", "emulator-5556", "emu", "kill"] {
                    self.killed_5556.store(true, Ordering::SeqCst);
                    return Ok(std::process::Output {
                        status: std::process::ExitStatus::from_raw(0),
                        stdout: b"OK\r\n".to_vec(),
                        stderr: Vec::new(),
                    });
                }
                Ok(std::process::Output {
                    status: std::process::ExitStatus::from_raw(0),
                    stdout: Vec::new(),
                    stderr: Vec::new(),
                })
            }
        }

        let killed_5554 = Arc::new(AtomicBool::new(false));
        let killed_5556 = Arc::new(AtomicBool::new(false));
        let exec = MockStopExec {
            killed_5554: killed_5554.clone(),
            killed_5556: killed_5556.clone(),
        };

        // Stop only "jatim_dev"
        let res = avd_stop(&exec, "jatim_dev");
        assert!(res.is_ok());
        // emulator-5556 was running jatim_dev, so it must be killed
        assert!(killed_5556.load(Ordering::SeqCst));
        // emulator-5554 was running Pixel_7, so it must NOT be killed!
        assert!(!killed_5554.load(Ordering::SeqCst));
    }
}
