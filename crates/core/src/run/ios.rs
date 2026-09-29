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

            let state = match item.state.as_str() {
                "Booted" => DeviceState::Online,
                "Shutdown" => DeviceState::Offline,
                _ => DeviceState::Booting,
            };

            devices.push(Device {
                id: item.udid,
                name: item.name,
                platform: DevicePlatform::Ios,
                kind: DeviceKind::Simulator,
                state,
                sdk: sdk.clone(),
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
}

/// Parse output of `xcrun devicectl list devices --json-output`.
/// Note: Tested via fixtures; live Mac verification pending.
pub fn parse_devicectl_devices(json_str: &str) -> Result<Vec<Device>, serde_json::Error> {
    let parsed: DevicectlOutput = serde_json::from_str(json_str)?;
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

            let is_connected = item
                .connection_properties
                .as_ref()
                .and_then(|c| c.tunnel_state.as_deref())
                == Some("connected")
                || item.visibility.as_deref() == Some("visible");

            let state = if is_connected {
                DeviceState::Online
            } else {
                DeviceState::Offline
            };

            devices.push(Device {
                id: item.identifier,
                name,
                platform: DevicePlatform::Ios,
                kind: DeviceKind::Physical,
                state,
                sdk,
            });
        }
    }

    Ok(devices)
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
                            "tunnelState": "connected"
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
        assert_eq!(dev.sdk, Some("iOS 17.4.1".to_string()));
    }
}
