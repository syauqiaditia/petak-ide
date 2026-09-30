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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub flutter_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub group: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub transport: Option<String>,
    #[serde(default = "default_device_connection")]
    pub connection: String,
}

pub fn default_device_connection() -> String {
    "connected".to_string()
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
        let (state, connection) = match state_str {
            "device" => (DeviceState::Online, "connected".to_string()),
            "offline" => (DeviceState::Offline, "offline".to_string()),
            "unauthorized" => (DeviceState::Unauthorized, "offline".to_string()),
            "bootloader" | "authorizing" => (DeviceState::Booting, "offline".to_string()),
            _ => (DeviceState::Offline, "offline".to_string()),
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

        let group = if kind == DeviceKind::Emulator {
            "emulator"
        } else {
            "physical"
        };
        let transport = if kind == DeviceKind::Physical {
            let line_lower = line.to_lowercase();
            if id.contains(':') || line_lower.contains("wireless") || line_lower.contains("wifi") {
                Some("wifi".to_string())
            } else if line_lower.contains("usb:") || line_lower.contains(" usb ") {
                Some("usb".to_string())
            } else {
                Some("unknown".to_string())
            }
        } else {
            None
        };
        let flutter_id = if state == DeviceState::Online && connection == "connected" {
            Some(id.to_string())
        } else {
            None
        };

        devices.push(Device {
            id: id.to_string(),
            name,
            platform: DevicePlatform::Android,
            kind,
            state,
            sdk: None,
            flutter_id,
            group: Some(group.to_string()),
            transport,
            connection,
        });
    }
    devices
}

/// Parse `flutter devices --machine` JSON output.
pub fn parse_flutter_devices(json_str: &str) -> Result<Vec<Device>, serde_json::Error> {
    let trimmed = json_str.trim();
    if trimmed.is_empty() {
        return Ok(Vec::new());
    }
    let items: Vec<serde_json::Value> = serde_json::from_str(trimmed)?;
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

        let is_offline = item
            .get("isSupported")
            .and_then(|v| v.as_bool())
            .map(|s| !s)
            .unwrap_or(false)
            || item
                .get("state")
                .and_then(|v| v.as_str())
                .map(|s| s.eq_ignore_ascii_case("offline"))
                .unwrap_or(false)
            || item
                .get("status")
                .and_then(|v| v.as_str())
                .map(|s| s.eq_ignore_ascii_case("offline"))
                .unwrap_or(false)
            || item
                .get("isOffline")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);

        let state = if is_offline {
            DeviceState::Offline
        } else {
            DeviceState::Online
        };

        let connection = if is_offline {
            "offline".to_string()
        } else {
            "connected".to_string()
        };

        let flutter_id = if state == DeviceState::Online {
            Some(id.clone())
        } else {
            None
        };

        let group = match (platform, kind) {
            (DevicePlatform::Web, _) => "web".to_string(),
            (DevicePlatform::Desktop, _) => "desktop".to_string(),
            (_, DeviceKind::Emulator) => "emulator".to_string(),
            (_, DeviceKind::Simulator) => "simulator".to_string(),
            (_, DeviceKind::Physical) => "physical".to_string(),
        };

        let transport = if kind == DeviceKind::Physical {
            let lower_name = name.to_lowercase();
            let lower_id = id.to_lowercase();
            if lower_name.contains("wireless") || lower_name.contains("wifi") || id.contains(':') {
                Some("wifi".to_string())
            } else if let Some(t) = item.get("transport").and_then(|v| v.as_str()) {
                let t_lower = t.to_lowercase();
                if t_lower.contains("wifi") || t_lower.contains("wireless") {
                    Some("wifi".to_string())
                } else if t_lower.contains("usb") || t_lower.contains("wire") {
                    Some("usb".to_string())
                } else {
                    Some(t_lower)
                }
            } else if lower_name.contains("usb") || lower_id.contains("usb") {
                Some("usb".to_string())
            } else {
                Some("unknown".to_string())
            }
        } else {
            None
        };

        devices.push(Device {
            id,
            name,
            platform,
            kind,
            state,
            sdk,
            flutter_id,
            group: Some(group),
            transport,
            connection,
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
        let (state, connection) = match state_str {
            "device" => (DeviceState::Online, "connected".to_string()),
            "offline" => (DeviceState::Offline, "offline".to_string()),
            "unauthorized" => (DeviceState::Unauthorized, "offline".to_string()),
            "bootloader" | "authorizing" => (DeviceState::Booting, "offline".to_string()),
            _ => (DeviceState::Offline, "offline".to_string()),
        };

        let kind = if id.starts_with("emulator-") {
            DeviceKind::Emulator
        } else {
            DeviceKind::Physical
        };

        let group = if kind == DeviceKind::Emulator {
            "emulator"
        } else {
            "physical"
        };
        let transport = if kind == DeviceKind::Physical {
            let line_lower = line.to_lowercase();
            if id.contains(':') || line_lower.contains("wireless") || line_lower.contains("wifi") {
                Some("wifi".to_string())
            } else if line_lower.contains("usb:") || line_lower.contains(" usb ") {
                Some("usb".to_string())
            } else {
                Some("unknown".to_string())
            }
        } else {
            None
        };
        let flutter_id = if state == DeviceState::Online && connection == "connected" {
            Some(id.to_string())
        } else {
            None
        };

        devices.push(Device {
            id: id.to_string(),
            name: id.to_string(),
            platform: DevicePlatform::Android,
            kind,
            state,
            sdk: None,
            flutter_id,
            group: Some(group.to_string()),
            transport,
            connection,
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

/// Resolve Android AVD directory (~/.android/avd or $ANDROID_AVD_HOME).
pub fn resolve_android_avd_home() -> Option<std::path::PathBuf> {
    if let Ok(h) = std::env::var("ANDROID_AVD_HOME") {
        let p = std::path::PathBuf::from(h);
        if p.exists() {
            return Some(p);
        }
    }
    if let Some(home) = dirs::home_dir() {
        let p = home.join(".android").join("avd");
        if p.exists() {
            return Some(p);
        }
    }
    None
}

/// Wipe data of an Android AVD.
pub fn avd_wipe(avd: &str) -> io::Result<()> {
    if !is_valid_avd_name(avd) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("invalid AVD name: {}", avd),
        ));
    }
    if let Some(avd_home) = resolve_android_avd_home() {
        let avd_dir = avd_home.join(format!("{}.avd", avd));
        if avd_dir.is_dir() {
            let _ = std::fs::remove_file(avd_dir.join("userdata-qemu.img"));
            let _ = std::fs::remove_file(avd_dir.join("userdata.img.qcow2"));
            let _ = std::fs::remove_dir_all(avd_dir.join("snapshots"));
        }
    }
    Ok(())
}

/// Delete an Android AVD (removes <avd>.avd directory and <avd>.ini file).
pub fn avd_delete(avd: &str) -> io::Result<()> {
    if !is_valid_avd_name(avd) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("invalid AVD name: {}", avd),
        ));
    }
    if let Some(avd_home) = resolve_android_avd_home() {
        let avd_dir = avd_home.join(format!("{}.avd", avd));
        let ini_file = avd_home.join(format!("{}.ini", avd));
        if avd_dir.exists() {
            let _ = std::fs::remove_dir_all(&avd_dir);
        }
        if ini_file.exists() {
            let _ = std::fs::remove_file(&ini_file);
        }
    }
    Ok(())
}

/// Spawn emulator process detached with piped stderr to monitor boot errors.
pub fn spawn_emulator_detached(
    avd: &str,
    cold: bool,
    wipe_data: bool,
    headless: bool,
) -> io::Result<std::process::Child> {
    if !is_valid_avd_name(avd) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("invalid AVD name: {}", avd),
        ));
    }

    let emu_cmd = resolve_emulator_binary();
    let mut cmd = std::process::Command::new(&emu_cmd);
    cmd.args(["-avd", avd]);

    if cold {
        cmd.arg("-no-snapshot-load");
    }
    if wipe_data {
        cmd.arg("-wipe-data");
    }
    if headless {
        cmd.args(["-no-window", "-no-audio", "-gpu", "swiftshader_indirect"]);
    }

    if let Some(sdk) = crate::toolchain::resolve_android_home() {
        cmd.env("ANDROID_HOME", &sdk);
        cmd.env("ANDROID_SDK_ROOT", &sdk);
    }
    if let Some(avd_home) = resolve_android_avd_home() {
        cmd.env("ANDROID_AVD_HOME", &avd_home);
    }
    cmd.env("PATH", crate::toolchain::effective_path());

    cmd.stdin(std::process::Stdio::null());
    cmd.stdout(std::process::Stdio::null());
    cmd.stderr(std::process::Stdio::piped());

    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0);
    }

    cmd.spawn()
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

/// Single device entry in unified devices snapshot.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotDevice {
    pub id: String,
    pub name: String,
    pub platform: String,
    pub state: String,
    pub flutter_id: Option<String>,
    pub group: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub transport: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sdk: Option<String>,
    #[serde(default = "default_device_connection")]
    pub connection: String,
}

/// Snapshot of all devices, grouped for the UI.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DevicesSnapshot {
    pub emulators: Vec<EmulatorInfo>,
    pub physical: Vec<PhysicalDevice>,
    #[serde(default)]
    pub devices: Vec<SnapshotDevice>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmulatorInfo {
    pub id: String,
    pub name: String,
    pub kind: String,  // "android-avd" | "ios-sim"
    pub state: String, // "running" | "stopped" | "booting"
    pub device_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub flutter_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub group: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub transport: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PhysicalDevice {
    pub id: String,
    pub name: String,
    pub platform: String,  // "android" | "ios"
    pub transport: String, // "usb" | "wifi" | "unknown"
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub state: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub flutter_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub group: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sdk: Option<String>,
    #[serde(default = "default_device_connection")]
    pub connection: String,
}

/// Merge devices from multiple sources (`flutter devices --machine`, adb, simctl, devicectl, avds)
/// with deduplication and state normalization.
pub fn merge_devices(
    flutter_devs: &[Device],
    adb_devs: &[Device],
    avds: &[Avd],
    simctl_devs: &[Device],
    devicectl_devs: &[Device],
    running_avd_names: &std::collections::HashMap<String, String>,
) -> DevicesSnapshot {
    let mut unified: Vec<SnapshotDevice> = Vec::new();

    // 1. Flutter devices
    for dev in flutter_devs {
        let platform_str = match dev.platform {
            DevicePlatform::Android => "android",
            DevicePlatform::Ios => "ios",
            DevicePlatform::Web => "web",
            DevicePlatform::Desktop => "desktop",
        };
        let state_str = match dev.state {
            DeviceState::Online => "online",
            DeviceState::Offline => "offline",
            DeviceState::Booting => "booting",
            DeviceState::Unauthorized => "offline",
        };
        let group_str = dev.group.clone().unwrap_or_else(|| match (dev.platform, dev.kind) {
            (DevicePlatform::Web, _) => "web".to_string(),
            (DevicePlatform::Desktop, _) => "desktop".to_string(),
            (_, DeviceKind::Emulator) => "emulator".to_string(),
            (_, DeviceKind::Simulator) => "simulator".to_string(),
            (_, DeviceKind::Physical) => "physical".to_string(),
        });
        let flutter_id = if state_str == "online" {
            Some(dev.id.clone())
        } else {
            None
        };

        unified.push(SnapshotDevice {
            id: dev.id.clone(),
            name: dev.name.clone(),
            platform: platform_str.to_string(),
            state: state_str.to_string(),
            flutter_id,
            group: group_str,
            transport: dev.transport.clone(),
            sdk: dev.sdk.clone(),
            connection: dev.connection.clone(),
        });
    }

    // 2. ADB devices
    for dev in adb_devs {
        if let Some(existing) = unified.iter_mut().find(|d| d.id == dev.id) {
            existing.connection = dev.connection.clone();
            match dev.state {
                DeviceState::Offline | DeviceState::Unauthorized => {
                    existing.state = "offline".to_string();
                    existing.flutter_id = None;
                }
                DeviceState::Booting => {
                    existing.state = "booting".to_string();
                    existing.flutter_id = None;
                }
                DeviceState::Online => {
                    existing.state = "online".to_string();
                    if existing.flutter_id.is_none() {
                        existing.flutter_id = Some(dev.id.clone());
                    }
                }
            }
            if existing.name == existing.id && dev.name != dev.id {
                existing.name = dev.name.clone();
            }
            if existing.transport.is_none() {
                existing.transport = dev.transport.clone();
            }
        } else {
            let is_emu = dev.id.starts_with("emulator-") || dev.kind == DeviceKind::Emulator;
            let group_str = if is_emu { "emulator" } else { "physical" };
            let state_str = match dev.state {
                DeviceState::Online => "online",
                DeviceState::Booting => "booting",
                _ => "offline",
            };
            let flutter_id = if state_str == "online" && dev.connection == "connected" {
                Some(dev.id.clone())
            } else {
                None
            };
            let transport = if !is_emu {
                if let Some(ref t) = dev.transport {
                    Some(t.clone())
                } else if dev.id.contains(':')
                    || dev.name.to_lowercase().contains("wireless")
                    || dev.name.to_lowercase().contains("wifi")
                {
                    Some("wifi".to_string())
                } else {
                    Some("unknown".to_string())
                }
            } else {
                None
            };
            unified.push(SnapshotDevice {
                id: dev.id.clone(),
                name: dev.name.clone(),
                platform: "android".to_string(),
                state: state_str.to_string(),
                flutter_id,
                group: group_str.to_string(),
                transport,
                sdk: dev.sdk.clone(),
                connection: dev.connection.clone(),
            });
        }
    }

    // 3. AVDs
    for avd in avds {
        let emu_id_opt = running_avd_names.get(&avd.name);
        if let Some(emu_id) = emu_id_opt {
            if let Some(existing) = unified.iter_mut().find(|d| d.id == *emu_id) {
                existing.name = avd.name.clone();
                existing.state = "online".to_string();
                existing.flutter_id = Some(emu_id.clone());
                existing.connection = "connected".to_string();
            } else {
                unified.push(SnapshotDevice {
                    id: emu_id.clone(),
                    name: avd.name.clone(),
                    platform: "android".to_string(),
                    state: "online".to_string(),
                    flutter_id: Some(emu_id.clone()),
                    group: "emulator".to_string(),
                    transport: None,
                    sdk: None,
                    connection: "connected".to_string(),
                });
            }
        } else if !unified.iter().any(|d| d.id == avd.name || d.name == avd.name) {
            unified.push(SnapshotDevice {
                id: avd.name.clone(),
                name: avd.name.clone(),
                platform: "android".to_string(),
                state: "offline".to_string(),
                flutter_id: None,
                group: "emulator".to_string(),
                transport: None,
                sdk: None,
                connection: "offline".to_string(),
            });
        }
    }

    // 4. iOS Simulators (simctl)
    for sim in simctl_devs {
        if let Some(existing) = unified.iter_mut().find(|d| d.id == sim.id) {
            existing.connection = sim.connection.clone();
            match sim.state {
                DeviceState::Online => {
                    existing.state = "online".to_string();
                    existing.flutter_id = Some(sim.id.clone());
                }
                DeviceState::Booting => {
                    existing.state = "booting".to_string();
                    existing.flutter_id = None;
                }
                _ => {
                    existing.state = "offline".to_string();
                    existing.flutter_id = None;
                }
            }
        } else {
            let state_str = match sim.state {
                DeviceState::Online => "online",
                DeviceState::Booting => "booting",
                _ => "offline",
            };
            let flutter_id = if state_str == "online" {
                Some(sim.id.clone())
            } else {
                None
            };
            unified.push(SnapshotDevice {
                id: sim.id.clone(),
                name: sim.name.clone(),
                platform: "ios".to_string(),
                state: state_str.to_string(),
                flutter_id,
                group: "simulator".to_string(),
                transport: None,
                sdk: sim.sdk.clone(),
                connection: sim.connection.clone(),
            });
        }
    }

    // 5. iOS Physical (devicectl)
    for dev in devicectl_devs {
        let is_connected = dev.connection == "connected";
        let state_str = if is_connected {
            "online".to_string()
        } else {
            "offline".to_string()
        };
        let flutter_id = if is_connected {
            Some(dev.id.clone())
        } else {
            None
        };

        if let Some(existing) = unified.iter_mut().find(|d| d.id == dev.id) {
            existing.connection = dev.connection.clone();
            existing.state = state_str;
            existing.flutter_id = flutter_id;
            if let Some(ref t) = dev.transport {
                existing.transport = Some(t.clone());
            }
            existing.group = "physical".to_string();
            existing.platform = "ios".to_string();
        } else {
            unified.push(SnapshotDevice {
                id: dev.id.clone(),
                name: dev.name.clone(),
                platform: "ios".to_string(),
                state: state_str,
                flutter_id,
                group: "physical".to_string(),
                transport: dev.transport.clone(),
                sdk: dev.sdk.clone(),
                connection: dev.connection.clone(),
            });
        }
    }

    // Build emulators and physical lists for UI backwards compatibility
    let mut emulators = Vec::new();
    let mut physical = Vec::new();

    // Add AVDs (running and stopped)
    for avd in avds {
        let emu_id_opt = running_avd_names.get(&avd.name);
        let is_running = emu_id_opt.is_some();
        let dev_id = emu_id_opt.cloned();
        emulators.push(EmulatorInfo {
            id: avd.name.clone(),
            name: avd.name.clone(),
            kind: "android-avd".to_string(),
            state: if is_running { "running".to_string() } else { "stopped".to_string() },
            device_id: dev_id.clone(),
            flutter_id: dev_id,
            group: Some("emulator".to_string()),
            transport: None,
        });
    }

    // Any remaining running android emulators not covered in avds
    for d in &unified {
        if d.group == "emulator" && !emulators.iter().any(|e| e.name == d.name || e.id == d.name) {
            emulators.push(EmulatorInfo {
                id: d.id.clone(),
                name: d.name.clone(),
                kind: "android-avd".to_string(),
                state: if d.state == "online" {
                    "running".to_string()
                } else if d.state == "booting" {
                    "booting".to_string()
                } else {
                    "stopped".to_string()
                },
                device_id: if d.state == "online" {
                    Some(d.id.clone())
                } else {
                    None
                },
                flutter_id: d.flutter_id.clone(),
                group: Some("emulator".to_string()),
                transport: d.transport.clone(),
            });
        }
    }

    // iOS simulators from unified
    for d in &unified {
        if d.group == "simulator" {
            emulators.push(EmulatorInfo {
                id: d.id.clone(),
                name: d.name.clone(),
                kind: "ios-sim".to_string(),
                state: if d.state == "online" {
                    "running".to_string()
                } else if d.state == "booting" {
                    "booting".to_string()
                } else {
                    "stopped".to_string()
                },
                device_id: if d.state == "online" {
                    Some(d.id.clone())
                } else {
                    None
                },
                flutter_id: d.flutter_id.clone(),
                group: Some("simulator".to_string()),
                transport: d.transport.clone(),
            });
        }
    }

    // Physical devices from unified
    for d in &unified {
        if d.group == "physical" {
            physical.push(PhysicalDevice {
                id: d.id.clone(),
                name: d.name.clone(),
                platform: d.platform.clone(),
                transport: d.transport.clone().unwrap_or_else(|| "unknown".to_string()),
                state: Some(d.state.clone()),
                flutter_id: d.flutter_id.clone(),
                group: Some("physical".to_string()),
                sdk: d.sdk.clone(),
                connection: d.connection.clone(),
            });
        }
    }

    DevicesSnapshot {
        emulators,
        physical,
        devices: unified,
    }
}

/// Build a unified devices snapshot from all sources (`flutter devices --machine`, adb, simctl, devicectl).
pub fn devices_snapshot(exec: &dyn Exec) -> DevicesSnapshot {
    let adb = resolve_adb_binary();

    // 1. Flutter devices
    let flutter_devices = if let Ok(out) = exec.run(
        Path::new("."),
        "flutter",
        &["devices", "--machine"],
        &[],
        None,
    ) {
        if out.status.success() {
            parse_flutter_devices(&String::from_utf8_lossy(&out.stdout)).unwrap_or_default()
        } else {
            Vec::new()
        }
    } else {
        Vec::new()
    };

    // 2. Android AVDs (emulator -list-avds) and running emulators (adb devices)
    let avds = list_avds(exec);
    let running_android =
        if let Ok(out) = exec.run(Path::new("."), &adb, &["devices", "-l"], &[], None) {
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
    for dev in &running_android {
        if dev.kind == DeviceKind::Emulator && dev.state == DeviceState::Online {
            if let Some(avd_name) = get_running_avd_name(exec, &adb, &dev.id) {
                avd_to_device_id.insert(avd_name, dev.id.clone());
            }
        }
    }

    // 3. iOS Simulators (xcrun simctl)
    let simctl_devices = if let Ok(out) = exec.run(
        Path::new("."),
        "xcrun",
        &["simctl", "list", "devices", "available", "--json"],
        &[],
        None,
    ) {
        if out.status.success() {
            let json_str = String::from_utf8_lossy(&out.stdout);
            crate::run::ios::parse_simctl_devices(&json_str).unwrap_or_default()
        } else {
            Vec::new()
        }
    } else {
        Vec::new()
    };

    // 4. Physical iOS devices (xcrun devicectl)
    let devicectl_devices = if let Ok(out) = exec.run(
        Path::new("."),
        "xcrun",
        &["devicectl", "list", "devices", "--json-output", "-"],
        &[],
        None,
    ) {
        if out.status.success() {
            let json_str = String::from_utf8_lossy(&out.stdout);
            crate::run::ios::parse_devicectl_devices(&json_str).unwrap_or_default()
        } else {
            Vec::new()
        }
    } else {
        Vec::new()
    };

    merge_devices(
        &flutter_devices,
        &running_android,
        &avds,
        &simctl_devices,
        &devicectl_devices,
        &avd_to_device_id,
    )
}

/// Validate whether a device ID can be used for `flutter run -d <device_id>`.
/// Rejects non-online devices or devices with flutter_id == None with clear Indonesian error.
pub fn check_device_runnable<'a>(
    snapshot: &'a DevicesSnapshot,
    device_id: &str,
) -> Result<&'a SnapshotDevice, String> {
    if let Some(dev) = snapshot
        .devices
        .iter()
        .find(|d| d.id == device_id || d.flutter_id.as_deref() == Some(device_id))
    {
        if dev.connection == "paired" {
            return Err(format!(
                "Perangkat '{}' ({}) berstatus Paired (tidak terhubung). Hubungkan via kabel USB atau aktifkan koneksi jaringan.",
                dev.name, dev.id
            ));
        }
        if dev.connection == "unavailable"
            || dev.connection == "offline"
            || dev.state != "online"
            || dev.flutter_id.is_none()
        {
            let status_msg = if dev.connection != "connected" {
                &dev.connection
            } else {
                &dev.state
            };
            return Err(format!(
                "Perangkat '{}' ({}) sedang {} (tidak online). Pilih perangkat yang aktif untuk menjalankan aplikasi.",
                dev.name, dev.id, status_msg
            ));
        }
        Ok(dev)
    } else {
        Err(format!(
            "Perangkat dengan ID '{}' tidak ditemukan atau sedang offline. Pilih perangkat online dari daftar.",
            device_id
        ))
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

    #[test]
    fn test_parse_flutter_devices_screenshot_fixture() {
        let fixture = r#"[
  {
    "name": "emulator-5554",
    "id": "emulator-5554",
    "isSupported": false,
    "targetPlatform": "android-arm64",
    "emulator": true,
    "sdk": "unknown"
  },
  {
    "name": "UQi (wireless)",
    "id": "00008110-00012CCE0C09401E",
    "isSupported": true,
    "targetPlatform": "ios",
    "emulator": false,
    "sdk": "iOS 26.5 23F77"
  },
  {
    "name": "iPhone 17 Pro",
    "id": "DF9AF706-ED11-4FEC-91C5-588C843400FE",
    "isSupported": true,
    "targetPlatform": "ios",
    "emulator": true,
    "sdk": "com.apple.CoreSimulator.SimRuntime.iOS-26-4"
  },
  {
    "name": "macOS",
    "id": "macos",
    "isSupported": true,
    "targetPlatform": "darwin-arm64",
    "emulator": false,
    "sdk": "macOS 26.5.2 25F84 darwin-arm64"
  }
]"#;

        let devs = parse_flutter_devices(fixture).expect("should parse fixture");
        assert_eq!(devs.len(), 4);

        // 1. Offline emulator
        let emu = devs.iter().find(|d| d.id == "emulator-5554").unwrap();
        assert_eq!(emu.state, DeviceState::Offline);
        assert_eq!(emu.flutter_id, None);
        assert_eq!(emu.group.as_deref(), Some("emulator"));
        assert_eq!(emu.kind, DeviceKind::Emulator);
        assert_eq!(emu.platform, DevicePlatform::Android);

        // 2. Physical wireless iPhone "UQi"
        let uqi = devs.iter().find(|d| d.id == "00008110-00012CCE0C09401E").unwrap();
        assert_eq!(uqi.name, "UQi (wireless)");
        assert_eq!(uqi.state, DeviceState::Online);
        assert_eq!(uqi.flutter_id.as_deref(), Some("00008110-00012CCE0C09401E"));
        assert_eq!(uqi.group.as_deref(), Some("physical"));
        assert_eq!(uqi.transport.as_deref(), Some("wifi"));
        assert_eq!(uqi.platform, DevicePlatform::Ios);

        // 3. iPhone 17 Pro Simulator
        let sim = devs.iter().find(|d| d.id == "DF9AF706-ED11-4FEC-91C5-588C843400FE").unwrap();
        assert_eq!(sim.name, "iPhone 17 Pro");
        assert_eq!(sim.state, DeviceState::Online);
        assert_eq!(sim.flutter_id.as_deref(), Some("DF9AF706-ED11-4FEC-91C5-588C843400FE"));
        assert_eq!(sim.group.as_deref(), Some("simulator"));
        assert_eq!(sim.platform, DevicePlatform::Ios);

        // 4. macOS Desktop
        let mac = devs.iter().find(|d| d.id == "macos").unwrap();
        assert_eq!(mac.name, "macOS");
        assert_eq!(mac.state, DeviceState::Online);
        assert_eq!(mac.group.as_deref(), Some("desktop"));
        assert_eq!(mac.flutter_id.as_deref(), Some("macos"));
        assert_eq!(mac.platform, DevicePlatform::Desktop);
    }

    #[test]
    fn test_merge_devices_dedupe() {
        let flutter_fixture = r#"[
  {
    "name": "UQi (wireless)",
    "id": "00008110-00012CCE0C09401E",
    "isSupported": true,
    "targetPlatform": "ios",
    "emulator": false,
    "sdk": "iOS 26.5 23F77"
  },
  {
    "name": "iPhone 17 Pro",
    "id": "DF9AF706-ED11-4FEC-91C5-588C843400FE",
    "isSupported": true,
    "targetPlatform": "ios",
    "emulator": true,
    "sdk": "com.apple.CoreSimulator.SimRuntime.iOS-26-4"
  }
]"#;
        let flutter_devs = parse_flutter_devices(flutter_fixture).unwrap();

        // ADB has emulator-5554 offline
        let adb_fixture = "List of devices attached\nemulator-5554 offline\n";
        let adb_devs = parse_adb_devices(adb_fixture);

        // AVDs has stopped Pixel_7
        let avds = vec![Avd { name: "Pixel_7".to_string() }];

        // Simctl also has iPhone 17 Pro (duplicate of flutter devices)
        let simctl_devs = vec![Device {
            id: "DF9AF706-ED11-4FEC-91C5-588C843400FE".to_string(),
            name: "iPhone 17 Pro".to_string(),
            platform: DevicePlatform::Ios,
            kind: DeviceKind::Simulator,
            state: DeviceState::Online,
            sdk: Some("iOS 26.4".to_string()),
            flutter_id: Some("DF9AF706-ED11-4FEC-91C5-588C843400FE".to_string()),
            group: Some("simulator".to_string()),
            transport: None,
            connection: "connected".to_string(),
        }];

        // Devicectl also has UQi (duplicate of flutter devices)
        let devicectl_devs = vec![Device {
            id: "00008110-00012CCE0C09401E".to_string(),
            name: "UQi (wireless)".to_string(),
            platform: DevicePlatform::Ios,
            kind: DeviceKind::Physical,
            state: DeviceState::Online,
            sdk: Some("iOS 26.5".to_string()),
            flutter_id: Some("00008110-00012CCE0C09401E".to_string()),
            group: Some("physical".to_string()),
            transport: Some("wifi".to_string()),
            connection: "connected".to_string(),
        }];

        let running_avds = std::collections::HashMap::new();

        let snapshot = merge_devices(
            &flutter_devs,
            &adb_devs,
            &avds,
            &simctl_devs,
            &devicectl_devs,
            &running_avds,
        );

        // Total deduplicated devices: UQi, iPhone 17 Pro, emulator-5554, Pixel_7 => 4
        assert_eq!(snapshot.devices.len(), 4);

        // Deduplication verified: UQi occurs exactly once
        let uqi_matches: Vec<_> = snapshot.devices.iter().filter(|d| d.id == "00008110-00012CCE0C09401E").collect();
        assert_eq!(uqi_matches.len(), 1);
        assert_eq!(uqi_matches[0].group, "physical");
        assert_eq!(uqi_matches[0].transport.as_deref(), Some("wifi"));
        assert_eq!(uqi_matches[0].state, "online");
        assert_eq!(uqi_matches[0].connection, "connected");
        assert_eq!(uqi_matches[0].flutter_id.as_deref(), Some("00008110-00012CCE0C09401E"));

        // Deduplication verified: iPhone 17 Pro occurs exactly once
        let sim_matches: Vec<_> = snapshot.devices.iter().filter(|d| d.id == "DF9AF706-ED11-4FEC-91C5-588C843400FE").collect();
        assert_eq!(sim_matches.len(), 1);
        assert_eq!(sim_matches[0].group, "simulator");
        assert_eq!(sim_matches[0].state, "online");
        assert_eq!(sim_matches[0].connection, "connected");

        // emulator-5554 is offline
        let emu = snapshot.devices.iter().find(|d| d.id == "emulator-5554").unwrap();
        assert_eq!(emu.state, "offline");
        assert_eq!(emu.connection, "offline");
        assert_eq!(emu.flutter_id, None);

        // Pixel_7 is offline
        let p7 = snapshot.devices.iter().find(|d| d.id == "Pixel_7").unwrap();
        assert_eq!(p7.state, "offline");
        assert_eq!(p7.connection, "offline");
        assert_eq!(p7.flutter_id, None);
    }

    #[test]
    fn test_check_device_runnable() {
        let snapshot = DevicesSnapshot {
            emulators: vec![],
            physical: vec![],
            devices: vec![
                SnapshotDevice {
                    id: "emulator-5554".to_string(),
                    name: "emulator-5554".to_string(),
                    platform: "android".to_string(),
                    state: "offline".to_string(),
                    flutter_id: None,
                    group: "emulator".to_string(),
                    transport: None,
                    sdk: None,
                    connection: "offline".to_string(),
                },
                SnapshotDevice {
                    id: "00008110-00012CCE0C09401E".to_string(),
                    name: "UQi (wireless)".to_string(),
                    platform: "ios".to_string(),
                    state: "online".to_string(),
                    flutter_id: Some("00008110-00012CCE0C09401E".to_string()),
                    group: "physical".to_string(),
                    transport: Some("wifi".to_string()),
                    sdk: Some("iOS 26.5".to_string()),
                    connection: "connected".to_string(),
                },
                SnapshotDevice {
                    id: "00008101-001234567890".to_string(),
                    name: "UQi (paired)".to_string(),
                    platform: "ios".to_string(),
                    state: "offline".to_string(),
                    flutter_id: None,
                    group: "physical".to_string(),
                    transport: Some("wifi".to_string()),
                    sdk: Some("iOS 17.4".to_string()),
                    connection: "paired".to_string(),
                },
            ],
        };

        // Offline device must be rejected with Indonesian error
        let err1 = check_device_runnable(&snapshot, "emulator-5554").unwrap_err();
        assert!(err1.contains("tidak online") || err1.contains("offline"));
        assert!(err1.contains("emulator-5554"));

        // Nonexistent device must be rejected with Indonesian error
        let err2 = check_device_runnable(&snapshot, "nonexistent-id").unwrap_err();
        assert!(err2.contains("tidak ditemukan") || err2.contains("offline"));

        // Paired device must be rejected with Indonesian error mentioning Paired and USB/network
        let err3 = check_device_runnable(&snapshot, "00008101-001234567890").unwrap_err();
        assert!(err3.contains("Paired"));
        assert!(err3.contains("kabel USB"));

        // Online device must be accepted
        let ok_dev = check_device_runnable(&snapshot, "00008110-00012CCE0C09401E").unwrap();
        assert_eq!(ok_dev.id, "00008110-00012CCE0C09401E");
        assert_eq!(ok_dev.flutter_id.as_deref(), Some("00008110-00012CCE0C09401E"));
    }

    #[test]
    fn test_adb_offline_and_unauthorized_state_and_connection() {
        let fixture = "List of devices attached\n\
R5CR30XYZ              unauthorized usb:1-1 product:a52sxq model:SM_A528B device:a52sxq transport_id:2\n\
192.168.1.105:5555     offline product:pixel device:oriole transport_id:3\n\
R58M1234567            device usb:1-2 product:s23 model:SM_S911B device:dm1q transport_id:4\n";

        let devs = parse_adb_devices(fixture);
        assert_eq!(devs.len(), 3);

        let unauth = devs.iter().find(|d| d.id == "R5CR30XYZ").unwrap();
        assert_eq!(unauth.state, DeviceState::Unauthorized);
        assert_eq!(unauth.connection, "offline");
        assert_eq!(unauth.flutter_id, None);
        assert_eq!(unauth.transport.as_deref(), Some("usb"));

        let offline_wifi = devs.iter().find(|d| d.id == "192.168.1.105:5555").unwrap();
        assert_eq!(offline_wifi.state, DeviceState::Offline);
        assert_eq!(offline_wifi.connection, "offline");
        assert_eq!(offline_wifi.flutter_id, None);
        assert_eq!(offline_wifi.transport.as_deref(), Some("wifi"));

        let online = devs.iter().find(|d| d.id == "R58M1234567").unwrap();
        assert_eq!(online.state, DeviceState::Online);
        assert_eq!(online.connection, "connected");
        assert_eq!(online.flutter_id.as_deref(), Some("R58M1234567"));
        assert_eq!(online.transport.as_deref(), Some("usb"));
    }

    #[test]
    fn test_spawn_emulator_stderr_and_failure() {
        let tmp = tempfile::tempdir().unwrap();
        let fake_emu = tmp.path().join("emulator");
        #[cfg(unix)]
        {
            std::fs::write(
                &fake_emu,
                "#!/bin/sh\n>&2 echo 'PANIC: Missing GPU driver'\n>&2 echo 'PANIC: Emulator exited'\nexit 1\n",
            )
            .unwrap();
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&fake_emu, std::fs::Permissions::from_mode(0o755)).unwrap();

            let mut cmd = std::process::Command::new(&fake_emu);
            cmd.args(["-avd", "Pixel_7"]);
            cmd.stderr(std::process::Stdio::piped());
            let child = cmd.spawn().unwrap();
            let out = child.wait_with_output().unwrap();
            assert!(!out.status.success());
            let stderr = String::from_utf8_lossy(&out.stderr);
            assert!(stderr.contains("PANIC: Missing GPU driver"));
        }
    }

    #[test]
    fn test_avd_wipe_and_delete() {
        let tmp = tempfile::tempdir().unwrap();
        let avd_dir = tmp.path().join("Test_AVD.avd");
        let ini_file = tmp.path().join("Test_AVD.ini");
        std::fs::create_dir_all(&avd_dir).unwrap();
        std::fs::write(&ini_file, "path=Test_AVD.avd\n").unwrap();
        std::fs::write(avd_dir.join("userdata-qemu.img"), "dummy").unwrap();

        std::env::set_var("ANDROID_AVD_HOME", tmp.path());

        // Wipe should remove userdata
        avd_wipe("Test_AVD").unwrap();
        assert!(!avd_dir.join("userdata-qemu.img").exists());
        assert!(avd_dir.exists());

        // Delete should remove dir and ini
        avd_delete("Test_AVD").unwrap();
        assert!(!avd_dir.exists());
        assert!(!ini_file.exists());
    }
}
