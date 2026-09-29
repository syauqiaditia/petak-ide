use std::io;
use std::path::Path;
use std::time::SystemTime;

use crate::exec::Exec;
use crate::run::ios::is_valid_udid;

/// Take a screenshot of an iOS Simulator or connected physical iPhone.
/// Output file path is written as a PNG file.
pub fn take_ios_screenshot(
    exec: &dyn Exec,
    device: &str,
    path: Option<&str>,
    is_simulator: bool,
) -> io::Result<String> {
    if !is_valid_udid(device) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("invalid iOS device UDID: {}", device),
        ));
    }

    let out_path = path.map(|p| p.to_string()).unwrap_or_else(|| {
        let ts = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap()
            .as_millis();
        format!("/tmp/petak-ios-screenshot-{}-{}.png", device, ts)
    });

    if is_simulator {
        // xcrun simctl io <udid> screenshot <out_path>
        let output = exec.run(
            Path::new("."),
            "xcrun",
            &["simctl", "io", device, "screenshot", &out_path],
            &[],
            None,
        )?;
        if !output.status.success() {
            let err = String::from_utf8_lossy(&output.stderr);
            return Err(io::Error::new(
                io::ErrorKind::Other,
                format!("simctl screenshot failed: {}", err.trim()),
            ));
        }
    } else {
        // Physical device: xcrun devicectl device capture screenshot --device <device> <out_path>
        let output = exec.run(
            Path::new("."),
            "xcrun",
            &[
                "devicectl",
                "device",
                "capture",
                "screenshot",
                "--device",
                device,
                &out_path,
            ],
            &[],
            None,
        )?;
        if !output.status.success() {
            let err = String::from_utf8_lossy(&output.stderr);
            return Err(io::Error::new(
                io::ErrorKind::Other,
                format!("devicectl screenshot failed: {}", err.trim()),
            ));
        }
    }

    Ok(out_path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Output;
    use std::sync::Mutex;

    struct FakeExec {
        calls: Mutex<Vec<Vec<String>>>,
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

            #[cfg(unix)]
            use std::os::unix::process::ExitStatusExt;
            #[cfg(unix)]
            let status = std::process::ExitStatus::from_raw(0);

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
    fn test_simulator_screenshot() {
        let fake = FakeExec {
            calls: Mutex::new(Vec::new()),
        };
        let udid = "E1B3E035-7F2A-4B6E-9E8D-7F6335CD5E90";
        let out = take_ios_screenshot(&fake, udid, Some("/tmp/sim.png"), true).unwrap();
        assert_eq!(out, "/tmp/sim.png");

        let calls = fake.calls.lock().unwrap();
        assert_eq!(calls.len(), 1);
        assert_eq!(
            calls[0],
            vec![
                "xcrun",
                "simctl",
                "io",
                "E1B3E035-7F2A-4B6E-9E8D-7F6335CD5E90",
                "screenshot",
                "/tmp/sim.png"
            ]
        );
    }

    #[test]
    fn test_physical_device_screenshot() {
        let fake = FakeExec {
            calls: Mutex::new(Vec::new()),
        };
        let udid = "00008101-001234567890";
        let out = take_ios_screenshot(&fake, udid, Some("/tmp/phone.png"), false).unwrap();
        assert_eq!(out, "/tmp/phone.png");

        let calls = fake.calls.lock().unwrap();
        assert_eq!(calls.len(), 1);
        assert_eq!(
            calls[0],
            vec![
                "xcrun",
                "devicectl",
                "device",
                "capture",
                "screenshot",
                "--device",
                "00008101-001234567890",
                "/tmp/phone.png"
            ]
        );
    }
}
