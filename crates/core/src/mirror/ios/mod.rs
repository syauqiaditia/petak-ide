pub mod fallback;
pub mod input;
pub mod physical;
pub mod screenshot;
pub mod simulator;
pub mod stream;

use std::io;
use std::sync::mpsc::Receiver;

use crate::exec::Exec;
use crate::mirror::control::InputEvent;
use crate::mirror::session::{MirrorInfo, MirrorStatus};
use crate::run::ios::is_valid_udid;

pub use fallback::SimctlScreenshotFallback;
pub use physical::IosPhysicalSession;
pub use screenshot::take_ios_screenshot;
pub use simulator::IosSimulatorSession;
pub use stream::read_ios_frame_packet;

/// Check if a device identifier represents an iOS device (Simulator or physical iPhone).
pub fn is_ios_device(id: &str) -> bool {
    let clean_id = id.strip_prefix("ios:").unwrap_or(id);

    if clean_id.starts_with("emulator-") || clean_id.contains(':') {
        return false;
    }

    if is_valid_udid(clean_id) {
        // Standard iOS UUID (36 chars with hyphens), modern UDID (25 chars with hyphen),
        // or legacy 40-char hex string
        return clean_id.contains('-') || clean_id.len() == 40;
    }

    id.starts_with("ios:")
}

/// Check if an iOS device identifier is an iOS Simulator.
pub fn is_ios_simulator(id: &str) -> bool {
    let clean_id = id.strip_prefix("ios:").unwrap_or(id);
    crate::run::device::classify_device_kind(clean_id, None, None) == "ios-simulator"
}

/// Unified session handle for iOS mirror sessions (Simulator or Physical).
pub enum IosSessionHandle {
    Simulator(IosSimulatorSession),
    Physical(IosPhysicalSession),
}

impl IosSessionHandle {
    pub fn send_input(&self, exec: &dyn Exec, event: &InputEvent) -> io::Result<()> {
        match self {
            Self::Simulator(sim) => sim.send_input(exec, event),
            Self::Physical(phys) => phys.send_input(event),
        }
    }

    pub fn stop(&self) {
        match self {
            Self::Simulator(sim) => sim.stop(),
            Self::Physical(phys) => phys.stop(),
        }
    }
}

/// Start an iOS mirror session for either a Simulator or physical iPhone.
pub fn start_ios_mirror(
    serial: &str,
    max_size: u16,
    exec: &dyn Exec,
) -> io::Result<(
    MirrorInfo,
    IosSessionHandle,
    Receiver<Vec<u8>>,
    Receiver<MirrorStatus>,
)> {
    let clean_id = serial.strip_prefix("ios:").unwrap_or(serial);

    if is_ios_simulator(clean_id) {
        let (info, sim_session, frame_rx, status_rx) =
            IosSimulatorSession::start(exec, clean_id, max_size)?;
        Ok((
            info,
            IosSessionHandle::Simulator(sim_session),
            frame_rx,
            status_rx,
        ))
    } else {
        // Physical iPhone: NEVER call simctl boot.
        match IosPhysicalSession::start(exec, clean_id, max_size) {
            Ok((info, phys_session, frame_rx, status_rx)) => Ok((
                info,
                IosSessionHandle::Physical(phys_session),
                frame_rx,
                status_rx,
            )),
            Err(_e) => {
                let err_obj = serde_json::json!({
                    "platform": "ios-physical",
                    "code": "physical_capture_failed",
                    "message": "Mirror iPhone fisik membutuhkan kabel USB tertancap, iPhone dalam keadaan tidak terkunci (unlocked) & Trust komputer ini, serta izin Screen Recording di macOS."
                });
                Err(io::Error::new(io::ErrorKind::Other, err_obj.to_string()))
            }
        }
    }
}

/// Take screenshot of an iOS device.
pub fn take_screenshot(exec: &dyn Exec, device: &str, path: Option<&str>) -> io::Result<String> {
    let clean_id = device.strip_prefix("ios:").unwrap_or(device);
    let is_sim = is_ios_simulator(clean_id);
    take_ios_screenshot(exec, clean_id, path, is_sim)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_ios_device_detection() {
        // Register simulator UDID
        crate::run::device::register_simulator_udid("E1B3E035-7F2A-4B6E-9E8D-7F6335CD5E90");

        // iOS Simulator UUID
        assert!(is_ios_device("E1B3E035-7F2A-4B6E-9E8D-7F6335CD5E90"));
        assert!(is_ios_simulator("E1B3E035-7F2A-4B6E-9E8D-7F6335CD5E90"));

        // Physical CoreDevice UUID (Bug 3 UQi's iPhone) is NOT a simulator!
        assert!(is_ios_device("BC639450-E28F-50F8-90A1-581C383E0230"));
        assert!(!is_ios_simulator("BC639450-E28F-50F8-90A1-581C383E0230"));

        // iOS Physical iPhone UDID with hyphen
        assert!(is_ios_device("00008101-001234567890"));
        assert!(!is_ios_simulator("00008101-001234567890"));

        // iOS 40-char hex
        assert!(is_ios_device("2b6f0cc904d137be2e1730235f5664094b831186"));
        assert!(!is_ios_simulator(
            "2b6f0cc904d137be2e1730235f5664094b831186"
        ));

        // Explicit ios: prefix
        assert!(is_ios_device("ios:my-device-1234"));

        // Android devices (must return false)
        assert!(!is_ios_device("emulator-5554"));
        assert!(!is_ios_device("emulator-5556"));
        assert!(!is_ios_device("192.168.1.100:5555"));
        assert!(!is_ios_device("R58M1234567"));
        assert!(!is_ios_device("HT4B12345678"));
    }
}
