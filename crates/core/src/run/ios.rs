use std::collections::HashMap;
use std::io;
use std::path::Path;
use std::sync::OnceLock;

use regex::Regex;
use serde::Deserialize;

use crate::exec::Exec;
use crate::run::device::{Device, DeviceKind, DevicePlatform, DeviceState};

#[derive(Deserialize)]
struct SimctlOutput {
    #[serde(default)]
    devices: HashMap<String, Vec<SimctlDeviceItem>>,
}

#[derive(Deserialize)]
struct SimctlDeviceItem {
    udid: String,
    name: String,
    #[serde(default)]
    state: String,
    #[serde(default, rename = "isAvailable")]
    is_available: bool,
}

/// Validate iOS UDID (UUID format, e.g. `E1B3E035-7F2A-4B6E-9E8D-7F6335CD5E90` or `00008101-001234567890`).
pub fn is_valid_udid(udid: &str) -> bool {
    static RE: OnceLock<Regex> = OnceLock::new();
    let re = RE.get_or_init(|| Regex::new(r"^[0-9A-Fa-f-]+$").unwrap());
    !udid.is_empty() && udid.len() >= 10 && re.is_match(udid)
}

/// Parse output of `xcrun simctl list devices --json`.
/// Note: Tested via fixtures; live Mac verification pending.
pub fn parse_simctl_devices(json_str: &str) -> Result<Vec<Device>, serde_json::Error> {
    let parsed: SimctlOutput = serde_json::from_str(json_str)?;
    let mut devices = Vec::new();

    for (runtime_key, items) in parsed.devices {
        let sdk = parse_ios_runtime_sdk(&runtime_key);
        for item in items {
            if !item.is_available {
                continue;
            }

            crate::run::device::register_simulator_udid(&item.udid);

            let state = match item.state.as_str() {
                "Booted" => DeviceState::Online,
                "Shutdown" => DeviceState::Offline,
                _ => DeviceState::Booting,
            };

            let flutter_id = if state == DeviceState::Online {
                Some(item.udid.clone())
            } else {
                None
            };

            let connection = match state {
                DeviceState::Online => "connected".to_string(),
                _ => "offline".to_string(),
            };

            devices.push(Device {
                id: item.udid,
                name: item.name,
                platform: DevicePlatform::Ios,
                kind: DeviceKind::Simulator,
                state,
                sdk: sdk.clone(),
                flutter_id,
                group: Some("simulator".to_string()),
                transport: None,
                connection,
                conn_state: Some(if state == DeviceState::Online {
                    "connected_usb".to_string()
                } else {
                    "disconnected".to_string()
                }),
                tunnel_state: None,
                pairing_state: None,
            });
        }
    }

    Ok(devices)
}

fn parse_ios_runtime_sdk(runtime: &str) -> Option<String> {
    // E.g. "com.apple.CoreSimulator.SimRuntime.iOS-17-0" -> "iOS 17.0"
    if let Some(pos) = runtime.find("iOS-") {
        let ver_part = &runtime[pos + 4..];
        let ver = ver_part.replace('-', ".");
        Some(format!("iOS {}", ver))
    } else {
        runtime.find("iOS ").map(|pos| runtime[pos..].to_string())
    }
}

/// Boot an iOS simulator via `xcrun simctl boot <udid>`.
/// Note: Validates UDID and passes arguments separately.
pub fn simctl_boot(exec: &dyn Exec, udid: &str) -> io::Result<()> {
    if !is_valid_udid(udid) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("invalid iOS simulator UDID: {}", udid),
        ));
    }

    let output = exec.run(Path::new("."), "xcrun", &["simctl", "boot", udid], &[], None)?;
    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        let msg = if err.trim().is_empty() {
            String::from_utf8_lossy(&output.stdout)
        } else {
            err
        };
        return Err(io::Error::other(format!("simctl boot failed: {}", msg.trim())));
    }
    Ok(())
}

/// Shutdown an iOS simulator via `xcrun simctl shutdown <udid>`.
pub fn simctl_shutdown(exec: &dyn Exec, udid: &str) -> io::Result<()> {
    if !is_valid_udid(udid) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("invalid iOS simulator UDID: {}", udid),
        ));
    }

    let output = exec.run(Path::new("."), "xcrun", &["simctl", "shutdown", udid], &[], None)?;
    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        let msg = if err.trim().is_empty() {
            String::from_utf8_lossy(&output.stdout)
        } else {
            err
        };
        return Err(io::Error::other(format!("simctl shutdown failed: {}", msg.trim())));
    }
    Ok(())
}

/// Open macOS Simulator application (open -a Simulator).
pub fn open_simulator_app() -> io::Result<()> {
    #[cfg(target_os = "macos")]
    {
        let status = std::process::Command::new("open")
            .args(["-a", "Simulator"])
            .status()?;
        if !status.success() {
            return Err(io::Error::other("Gagal membuka aplikasi Simulator"));
        }
    }
    Ok(())
}

#[derive(Deserialize)]
struct DevicectlOutput {
    #[serde(default)]
    result: Option<DevicectlResult>,
}

#[derive(Deserialize)]
struct DevicectlResult {
    #[serde(default)]
    devices: Vec<DevicectlDeviceItem>,
}

#[derive(Deserialize)]
struct DevicectlDeviceItem {
    identifier: String,
    #[serde(default, rename = "deviceProperties")]
    device_properties: Option<DevicectlDeviceProperties>,
    #[serde(default, rename = "connectionProperties")]
    connection_properties: Option<DevicectlConnectionProperties>,
    #[serde(default)]
    visibility: Option<String>,
}

#[derive(Deserialize)]
struct DevicectlDeviceProperties {
    #[serde(default)]
    name: Option<String>,
    #[serde(default, rename = "osVersionNumber")]
    os_version_number: Option<String>,
}

#[derive(Deserialize)]
struct DevicectlConnectionProperties {
    #[serde(default, rename = "tunnelState")]
    tunnel_state: Option<String>,
    #[serde(default, rename = "pairingState")]
    pairing_state: Option<String>,
    #[serde(default, rename = "transportType")]
    transport_type: Option<String>,
}

/// Parse output of `xcrun devicectl list devices --json-output` or plain text table.
pub fn parse_devicectl_devices(input: &str) -> Result<Vec<Device>, serde_json::Error> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Ok(Vec::new());
    }

    if trimmed.starts_with('{') {
        if let Ok(parsed) = serde_json::from_str::<DevicectlOutput>(trimmed) {
            let mut devices = Vec::new();
            if let Some(res) = parsed.result {
                for item in res.devices {
                    let name = item
                        .device_properties
                        .as_ref()
                        .and_then(|p| p.name.clone())
                        .unwrap_or_else(|| item.identifier.clone());

                    let sdk = item
                        .device_properties
                        .as_ref()
                        .and_then(|p| p.os_version_number.clone())
                        .map(|v| format!("iOS {}", v));

                    let tunnel = item
                        .connection_properties
                        .as_ref()
                        .and_then(|c| c.tunnel_state.as_deref())
                        .unwrap_or("");
                    let pairing = item
                        .connection_properties
                        .as_ref()
                        .and_then(|c| c.pairing_state.as_deref())
                        .unwrap_or("");
                    let vis = item.visibility.as_deref().unwrap_or("");

                    let connection = if tunnel == "connected" {
                        "connected".to_string()
                    } else if tunnel.contains("paired") || pairing == "paired" {
                        "paired".to_string()
                    } else if tunnel == "unavailable" || vis == "unavailable" {
                        "unavailable".to_string()
                    } else {
                        "offline".to_string()
                    };

                    let state = if connection == "connected" {
                        DeviceState::Online
                    } else {
                        DeviceState::Offline
                    };

                    let flutter_id = if state == DeviceState::Online {
                        Some(item.identifier.clone())
                    } else {
                        None
                    };

                    let transport_type = item
                        .connection_properties
                        .as_ref()
                        .and_then(|c| c.transport_type.as_deref())
                        .unwrap_or("");

                    let name_lower = name.to_lowercase();
                    let transport = match transport_type.to_lowercase().as_str() {
                        "wired" | "usb" => Some("usb".to_string()),
                        "wifi" | "wireless" | "localnetwork" => Some("wifi".to_string()),
                        _ => {
                            if item.identifier.contains(':')
                                || name_lower.contains("wireless")
                                || name_lower.contains("wifi")
                            {
                                Some("wifi".to_string())
                            } else {
                                None
                            }
                        }
                    };

                    let tunnel_state = item
                        .connection_properties
                        .as_ref()
                        .and_then(|c| c.tunnel_state.clone());
                    let pairing_state = item
                        .connection_properties
                        .as_ref()
                        .and_then(|c| c.pairing_state.clone());

                    let conn_state = if connection == "connected" {
                        if transport.as_deref() == Some("wifi") {
                            Some("connected_wifi".to_string())
                        } else {
                            Some("connected_usb".to_string())
                        }
                    } else if tunnel.contains("locked") || pairing.contains("locked") {
                        Some("locked".to_string())
                    } else {
                        Some("disconnected".to_string())
                    };

                    devices.push(Device {
                        id: item.identifier,
                        name,
                        platform: DevicePlatform::Ios,
                        kind: DeviceKind::Physical,
                        state,
                        sdk,
                        flutter_id,
                        group: Some("physical".to_string()),
                        transport,
                        connection,
                        conn_state,
                        tunnel_state,
                        pairing_state,
                    });
                }
            }
            return Ok(devices);
        }
    }

    Ok(parse_devicectl_devices_table(trimmed))
}

/// Parse text table output of `xcrun devicectl list devices`.
pub fn parse_devicectl_devices_table(table_str: &str) -> Vec<Device> {
    let mut devices = Vec::new();
    for line in table_str.lines() {
        let line = line.trim();
        if line.is_empty()
            || line.starts_with("Name")
            || line.starts_with("---")
            || line.starts_with("===")
            || line.starts_with("Showing")
        {
            continue;
        }

        // State detection: connected, available (paired), unavailable
        let (connection, state) = if line.contains("available (paired)") {
            ("paired".to_string(), DeviceState::Offline)
        } else if line.contains("connected") {
            ("connected".to_string(), DeviceState::Online)
        } else if line.contains("unavailable") {
            ("unavailable".to_string(), DeviceState::Offline)
        } else if line.contains("disconnected") || line.contains("offline") {
            ("offline".to_string(), DeviceState::Offline)
        } else {
            continue;
        };

        // Find identifier: UDID pattern (contains hyphen or 40-char hex)
        let mut id_opt = None;
        let mut name_parts = Vec::new();

        for token in line.split_whitespace() {
            if is_valid_udid(token) && (token.contains('-') || token.len() == 40) {
                id_opt = Some(token.to_string());
                break;
            }
            name_parts.push(token);
        }

        let id = match id_opt {
            Some(id) => id,
            None => continue,
        };

        let name = if name_parts.is_empty() {
            id.clone()
        } else {
            name_parts.join(" ")
        };

        let flutter_id = if state == DeviceState::Online {
            Some(id.clone())
        } else {
            None
        };

        let line_lower = line.to_lowercase();
        let transport = if line_lower.contains("wireless")
            || line_lower.contains("wifi")
            || id.contains(':')
        {
            Some("wifi".to_string())
        } else if line_lower.contains("wired") || line_lower.contains("usb") {
            Some("usb".to_string())
        } else {
            None
        };

        let conn_state = if connection == "connected" {
            if transport.as_deref() == Some("wifi") {
                Some("connected_wifi".to_string())
            } else {
                Some("connected_usb".to_string())
            }
        } else if line_lower.contains("locked") {
            Some("locked".to_string())
        } else {
            Some("disconnected".to_string())
        };

        devices.push(Device {
            id,
            name,
            platform: DevicePlatform::Ios,
            kind: DeviceKind::Physical,
            state,
            sdk: None,
            flutter_id,
            group: Some("physical".to_string()),
            transport,
            connection,
            conn_state,
            tunnel_state: None,
            pairing_state: None,
        });
    }
    devices
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::process::ExitStatusExt;
    use std::process::{ExitStatus, Output};
    use std::sync::Mutex;

    struct FakeExec {
        output: Mutex<Option<Output>>,
        recorded_args: Mutex<Vec<Vec<String>>>,
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
            let mut all = vec![program.to_string()];
            all.extend(args.iter().map(|s| s.to_string()));
            self.recorded_args.lock().unwrap().push(all);

            Ok(self.output.lock().unwrap().take().unwrap_or_else(|| Output {
                status: ExitStatus::from_raw(0),
                stdout: Vec::new(),
                stderr: Vec::new(),
            }))
        }
    }

    #[test]
    fn test_parse_simctl_devices_fixture() {
        // Fixture: xcrun simctl list devices --json output
        // Marked: fixture, belum diverifikasi di Mac
        let fixture = r#"{
            "devices": {
                "com.apple.CoreSimulator.SimRuntime.iOS-17-0": [
                    {
                        "udid": "E1B3E035-7F2A-4B6E-9E8D-7F6335CD5E90",
                        "name": "iPhone 15",
                        "state": "Booted",
                        "isAvailable": true
                    },
                    {
                        "udid": "A1B2C3D4-E5F6-7890-ABCD-EF1234567890",
                        "name": "iPad Air",
                        "state": "Shutdown",
                        "isAvailable": true
                    },
                    {
                        "udid": "B1B2C3D4-E5F6-7890-ABCD-EF1234567890",
                        "name": "Old Unavailable Simulator",
                        "state": "Shutdown",
                        "isAvailable": false
                    }
                ]
            }
        }"#;

        let devices = parse_simctl_devices(fixture).unwrap();
        assert_eq!(devices.len(), 2);

        let booted = devices.iter().find(|d| d.id == "E1B3E035-7F2A-4B6E-9E8D-7F6335CD5E90").unwrap();
        assert_eq!(booted.name, "iPhone 15");
        assert_eq!(booted.state, DeviceState::Online);
        assert_eq!(booted.kind, DeviceKind::Simulator);
        assert_eq!(booted.platform, DevicePlatform::Ios);
        assert_eq!(booted.sdk, Some("iOS 17.0".to_string()));

        let shutdown = devices.iter().find(|d| d.id == "A1B2C3D4-E5F6-7890-ABCD-EF1234567890").unwrap();
        assert_eq!(shutdown.name, "iPad Air");
        assert_eq!(shutdown.state, DeviceState::Offline);
    }

    #[test]
    fn test_simctl_boot_success_and_validation() {
        assert!(is_valid_udid("E1B3E035-7F2A-4B6E-9E8D-7F6335CD5E90"));
        assert!(!is_valid_udid("invalid; rm -rf"));
        assert!(!is_valid_udid(""));

        let fake = FakeExec {
            output: Mutex::new(None),
            recorded_args: Mutex::new(Vec::new()),
        };

        simctl_boot(&fake, "E1B3E035-7F2A-4B6E-9E8D-7F6335CD5E90").unwrap();
        let calls = fake.recorded_args.lock().unwrap();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0], vec!["xcrun", "simctl", "boot", "E1B3E035-7F2A-4B6E-9E8D-7F6335CD5E90"]);
    }

    #[test]
    fn test_parse_devicectl_devices_fixture() {
        // Fixture: xcrun devicectl list devices --json-output
        // Marked: fixture, belum diverifikasi di Mac
        let fixture = r#"{
            "result": {
                "devices": [
                    {
                        "identifier": "00008101-001234567890",
                        "deviceProperties": {
                            "name": "UQi's iPhone",
                            "osVersionNumber": "17.4.1"
                        },
                        "connectionProperties": {
                            "tunnelState": "connected",
                            "transportType": "wired"
                        },
                        "visibility": "visible"
                    }
                ]
            }
        }"#;

        let devices = parse_devicectl_devices(fixture).unwrap();
        assert_eq!(devices.len(), 1);
        let dev = &devices[0];
        assert_eq!(dev.id, "00008101-001234567890");
        assert_eq!(dev.name, "UQi's iPhone");
        assert_eq!(dev.platform, DevicePlatform::Ios);
        assert_eq!(dev.kind, DeviceKind::Physical);
        assert_eq!(dev.state, DeviceState::Online);
        assert_eq!(dev.connection, "connected");
        assert_eq!(dev.transport.as_deref(), Some("usb"));
        assert_eq!(dev.sdk, Some("iOS 17.4.1".to_string()));
    }

    #[test]
    fn test_parse_devicectl_3_states_table_fixture() {
        let fixture = r#"
Name               Identifier                            State                  Model
iPhone 15 Pro      00008130-001234567890                 connected              iPhone 15 Pro
UQi                00008101-001234567890                 available (paired)     iPhone 12
Prio               00008030-001234567890                 unavailable            iPhone 11
"#;

        let devices = parse_devicectl_devices(fixture).unwrap();
        assert_eq!(devices.len(), 3);

        let d_connected = devices.iter().find(|d| d.id == "00008130-001234567890").unwrap();
        assert_eq!(d_connected.connection, "connected");
        assert_eq!(d_connected.state, DeviceState::Online);
        assert_eq!(d_connected.transport.as_deref(), None);
        assert_eq!(d_connected.flutter_id.as_deref(), Some("00008130-001234567890"));

        let d_paired = devices.iter().find(|d| d.id == "00008101-001234567890").unwrap();
        assert_eq!(d_paired.connection, "paired");
        assert_eq!(d_paired.state, DeviceState::Offline);
        assert_eq!(d_paired.flutter_id, None);

        let d_unavail = devices.iter().find(|d| d.id == "00008030-001234567890").unwrap();
        assert_eq!(d_unavail.connection, "unavailable");
        assert_eq!(d_unavail.state, DeviceState::Offline);
        assert_eq!(d_unavail.flutter_id, None);
    }

    #[test]
    fn test_parse_devicectl_3_states_json_fixture() {
        let fixture = r#"{
            "result": {
                "devices": [
                    {
                        "identifier": "00008130-001234567890",
                        "deviceProperties": { "name": "iPhone 15 Pro", "osVersionNumber": "17.4" },
                        "connectionProperties": { "tunnelState": "connected", "transportType": "wired" },
                        "visibility": "visible"
                    },
                    {
                        "identifier": "00008101-001234567890",
                        "deviceProperties": { "name": "UQi", "osVersionNumber": "17.4" },
                        "connectionProperties": { "tunnelState": "available (paired)", "pairingState": "paired", "transportType": "wifi" },
                        "visibility": "visible"
                    },
                    {
                        "identifier": "00008030-001234567890",
                        "deviceProperties": { "name": "Prio", "osVersionNumber": "17.0" },
                        "connectionProperties": { "tunnelState": "unavailable" },
                        "visibility": "unavailable"
                    }
                ]
            }
        }"#;

        let devices = parse_devicectl_devices(fixture).unwrap();
        assert_eq!(devices.len(), 3);

        let d1 = devices.iter().find(|d| d.id == "00008130-001234567890").unwrap();
        assert_eq!(d1.connection, "connected");
        assert_eq!(d1.state, DeviceState::Online);
        assert_eq!(d1.transport.as_deref(), Some("usb"));
        assert_eq!(d1.conn_state.as_deref(), Some("connected_usb"));

        let d2 = devices.iter().find(|d| d.id == "00008101-001234567890").unwrap();
        assert_eq!(d2.connection, "paired");
        assert_eq!(d2.state, DeviceState::Offline);
        assert_eq!(d2.transport.as_deref(), Some("wifi"));
        assert_eq!(d2.conn_state.as_deref(), Some("disconnected"));
        assert_eq!(d2.pairing_state.as_deref(), Some("paired"));
        assert_eq!(d2.tunnel_state.as_deref(), Some("available (paired)"));
        assert_eq!(d2.flutter_id, None);

        let d3 = devices.iter().find(|d| d.id == "00008030-001234567890").unwrap();
        assert_eq!(d3.connection, "unavailable");
        assert_eq!(d3.state, DeviceState::Offline);
        assert_eq!(d3.transport.as_deref(), None);
        assert_eq!(d3.conn_state.as_deref(), Some("disconnected"));
        assert_eq!(d3.tunnel_state.as_deref(), Some("unavailable"));
        assert_eq!(d3.flutter_id, None);
    }
}
