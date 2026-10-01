use std::io;
use std::path::Path;

use crate::exec::Exec;
use crate::run::device::resolve_adb_binary;

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct PairResult {
    pub success: bool,
    pub message: String,
}

pub fn find_adb(_exec: &dyn Exec) -> String {
    resolve_adb_binary()
}

pub fn parse_pair_output(status_success: bool, stdout: &str, stderr: &str) -> PairResult {
    let combined = if !stdout.trim().is_empty() && !stderr.trim().is_empty() {
        format!("{}\n{}", stdout.trim(), stderr.trim())
    } else if !stdout.trim().is_empty() {
        stdout.trim().to_string()
    } else {
        stderr.trim().to_string()
    };

    if !status_success {
        let msg = if combined.is_empty() {
            "adb pair failed with non-zero exit code".to_string()
        } else {
            combined
        };
        return PairResult {
            success: false,
            message: msg,
        };
    }

    let lower = combined.to_lowercase();
    if lower.contains("successfully paired to") || lower.contains("successfully paired") {
        PairResult {
            success: true,
            message: combined,
        }
    } else {
        let msg = if combined.is_empty() {
            "adb pair failed with empty output".to_string()
        } else {
            combined
        };
        PairResult {
            success: false,
            message: msg,
        }
    }
}

pub fn parse_connect_output(
    status_success: bool,
    stdout: &str,
    stderr: &str,
) -> io::Result<String> {
    let combined = if !stdout.trim().is_empty() && !stderr.trim().is_empty() {
        format!("{}\n{}", stdout.trim(), stderr.trim())
    } else if !stdout.trim().is_empty() {
        stdout.trim().to_string()
    } else {
        stderr.trim().to_string()
    };

    let lower = combined.to_lowercase();
    if !status_success
        || lower.contains("failed")
        || lower.contains("unable to connect")
        || lower.contains("cannot connect")
        || lower.contains("error")
    {
        let msg = if combined.is_empty() {
            "adb connect failed with non-zero exit code".to_string()
        } else {
            combined
        };
        return Err(io::Error::new(io::ErrorKind::Other, msg));
    }

    if lower.contains("connected to") || lower.contains("already connected to") {
        return Ok(combined);
    }

    if !combined.is_empty() {
        Ok(combined)
    } else {
        Err(io::Error::new(
            io::ErrorKind::Other,
            "adb connect returned empty response",
        ))
    }
}

pub fn adb_pair(exec: &dyn Exec, host: &str, port: u16, code: &str) -> io::Result<PairResult> {
    let adb = find_adb(exec);
    let target = format!("{}:{}", host.trim(), port);
    crate::mirror::trace::log(
        "PAIR-EXEC",
        &format!("Running adb pair {} with code len={}", target, code.trim().len()),
    );

    let output = exec.run(
        Path::new("."),
        &adb,
        &["pair", &target, code.trim()],
        &[],
        None,
    )?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let res = parse_pair_output(output.status.success(), &stdout, &stderr);
    crate::mirror::trace::log(
        "PAIR-RESULT",
        &format!("Success: {}, Message: {}", res.success, res.message),
    );
    Ok(res)
}

pub fn adb_connect(exec: &dyn Exec, host: &str, port: u16) -> io::Result<String> {
    let adb = find_adb(exec);
    let target = format!("{}:{}", host.trim(), port);
    let output = exec.run(Path::new("."), &adb, &["connect", &target], &[], None)?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    parse_connect_output(output.status.success(), &stdout, &stderr)
}

pub fn parse_mdns_services(stdout: &str, service_name: &str) -> Option<(String, u16)> {
    let service_name = service_name.trim();
    if service_name.is_empty() {
        return None;
    }

    for line in stdout.lines() {
        let line = line.trim();
        if !line.contains("_adb-tls-pairing._tcp") {
            continue;
        }

        if let Some((instance_part, remainder)) = line.split_once("_adb-tls-pairing._tcp") {
            if !instance_part.contains(service_name) {
                continue;
            }

            if let Some(addr_token) = remainder.split_whitespace().next() {
                if let Some((host, port_str)) = addr_token.rsplit_once(':') {
                    if let Ok(port) = port_str.parse::<u16>() {
                        let clean_host = host.trim_start_matches('[').trim_end_matches(']');
                        if !clean_host.is_empty() {
                            return Some((clean_host.to_string(), port));
                        }
                    }
                }
            }
        }
    }

    None
}

pub fn parse_mdns_connect_service(stdout: &str, host: &str) -> Option<u16> {
    let clean_target_host = host.trim().trim_start_matches('[').trim_end_matches(']');
    if clean_target_host.is_empty() {
        return None;
    }

    for line in stdout.lines() {
        let line = line.trim();
        if !line.contains("_adb-tls-connect._tcp") {
            continue;
        }

        if let Some((_, remainder)) = line.split_once("_adb-tls-connect._tcp") {
            if let Some(addr_token) = remainder.split_whitespace().next() {
                if let Some((line_host, port_str)) = addr_token.rsplit_once(':') {
                    let clean_line_host = line_host.trim_start_matches('[').trim_end_matches(']');
                    if clean_line_host == clean_target_host {
                        if let Ok(port) = port_str.parse::<u16>() {
                            return Some(port);
                        }
                    }
                }
            }
        }
    }

    None
}

#[cfg(target_os = "macos")]
fn dnssd_resolve_pairing(service_name: &str) -> Option<(String, u16)> {
    use std::io::{BufRead, BufReader};
    use std::process::{Command, Stdio};
    use std::sync::mpsc;
    use std::thread;
    use std::time::Duration;

    // 1. Browse for _adb-tls-pairing._tcp
    let mut child = Command::new("dns-sd")
        .args(["-B", "_adb-tls-pairing._tcp", "local"])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;

    let stdout = child.stdout.take()?;
    let (tx, rx) = mpsc::channel();
    let s_name = service_name.to_string();

    thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines().flatten() {
            if line.contains("_adb-tls-pairing._tcp") {
                if let Some(instance) = line.split_whitespace().last() {
                    if s_name.is_empty() || line.contains(&s_name) || instance.contains(&s_name) {
                        let _ = tx.send(instance.to_string());
                        break;
                    }
                }
            }
        }
    });

    let instance = rx.recv_timeout(Duration::from_millis(1500)).ok()?;
    let _ = child.kill();
    let _ = child.wait();

    // 2. Lookup instance endpoint
    let mut child_lookup = Command::new("dns-sd")
        .args(["-L", &instance, "_adb-tls-pairing._tcp", "local"])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;

    let stdout_lookup = child_lookup.stdout.take()?;
    let (tx_l, rx_l) = mpsc::channel();

    thread::spawn(move || {
        let reader = BufReader::new(stdout_lookup);
        for line in reader.lines().flatten() {
            if let Some(idx) = line.find("can be reached at ") {
                let rest = &line[idx + "can be reached at ".len()..];
                if let Some(token) = rest.split_whitespace().next() {
                    if let Some((h, p)) = token.rsplit_once(':') {
                        let clean_h = h.trim_end_matches('.');
                        if let Ok(port) = p.parse::<u16>() {
                            let _ = tx_l.send((clean_h.to_string(), port));
                            break;
                        }
                    }
                }
            }
        }
    });

    let (target_host, target_port) = rx_l.recv_timeout(Duration::from_millis(2000)).ok()?;
    let _ = child_lookup.kill();
    let _ = child_lookup.wait();

    // 3. Resolve target host to IPv4
    let clean_host = target_host.trim_end_matches('.');

    // Try standard socket resolver first (macOS mDNSResponder handles .local)
    use std::net::ToSocketAddrs;
    if let Ok(mut addrs) = format!("{}:{}", clean_host, target_port).to_socket_addrs() {
        if let Some(addr) = addrs.find(|a| a.is_ipv4()) {
            let ip = addr.ip().to_string();
            crate::mirror::trace::log(
                "DNSSD",
                &format!("Resolved IP via to_socket_addrs: {}:{}", ip, target_port),
            );
            return Some((ip, target_port));
        }
    }

    let mut child_ip = Command::new("dns-sd")
        .args(["-G", "v4", clean_host])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;

    let stdout_ip = child_ip.stdout.take()?;
    let (tx_ip, rx_ip) = mpsc::channel();

    thread::spawn(move || {
        let reader = BufReader::new(stdout_ip);
        for line in reader.lines().flatten() {
            for token in line.split_whitespace() {
                let parts: Vec<&str> = token.split('.').collect();
                if parts.len() == 4 && parts.iter().all(|p| p.parse::<u8>().is_ok()) {
                    let _ = tx_ip.send(token.to_string());
                    return;
                }
            }
        }
    });

    let ip = rx_ip.recv_timeout(Duration::from_millis(2000)).ok()?;
    let _ = child_ip.kill();
    let _ = child_ip.wait();

    Some((ip, target_port))
}

#[cfg(not(target_os = "macos"))]
fn dnssd_resolve_pairing(_service_name: &str) -> Option<(String, u16)> {
    None
}

pub fn adb_find_pairing_service(
    exec: &dyn Exec,
    service_name: &str,
) -> io::Result<Option<(String, u16)>> {
    let adb = find_adb(exec);
    if let Ok(output) = exec.run(Path::new("."), &adb, &["mdns", "services"], &[], None) {
        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            if let Some(res) = parse_mdns_services(&stdout, service_name) {
                return Ok(Some(res));
            }
        }
    }

    if let Some(res) = dnssd_resolve_pairing(service_name) {
        return Ok(Some(res));
    }

    Ok(None)
}

#[cfg(target_os = "macos")]
fn dnssd_resolve_connect(_host: &str) -> Option<u16> {
    use std::io::{BufRead, BufReader};
    use std::process::{Command, Stdio};
    use std::sync::mpsc;
    use std::thread;
    use std::time::Duration;

    let mut child = Command::new("dns-sd")
        .args(["-B", "_adb-tls-connect._tcp", "local"])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;

    let stdout = child.stdout.take()?;
    let (tx, rx) = mpsc::channel();

    thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines().flatten() {
            if line.contains("_adb-tls-connect._tcp") {
                if let Some(instance) = line.split_whitespace().last() {
                    let _ = tx.send(instance.to_string());
                    break;
                }
            }
        }
    });

    let instance = rx.recv_timeout(Duration::from_millis(1500)).ok()?;
    let _ = child.kill();
    let _ = child.wait();

    let mut child_lookup = Command::new("dns-sd")
        .args(["-L", &instance, "_adb-tls-connect._tcp", "local"])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;

    let stdout_lookup = child_lookup.stdout.take()?;
    let (tx_l, rx_l) = mpsc::channel();

    thread::spawn(move || {
        let reader = BufReader::new(stdout_lookup);
        for line in reader.lines().flatten() {
            if let Some(idx) = line.find("can be reached at ") {
                let rest = &line[idx + "can be reached at ".len()..];
                if let Some(token) = rest.split_whitespace().next() {
                    let token = token.trim_end_matches('.');
                    if let Some((_, p)) = token.rsplit_once(':') {
                        if let Ok(port) = p.parse::<u16>() {
                            let _ = tx_l.send(port);
                            break;
                        }
                    }
                }
            }
        }
    });

    let port = rx_l.recv_timeout(Duration::from_millis(1500)).ok()?;
    let _ = child_lookup.kill();
    let _ = child_lookup.wait();

    Some(port)
}

#[cfg(not(target_os = "macos"))]
fn dnssd_resolve_connect(_host: &str) -> Option<u16> {
    None
}

pub fn adb_find_connect_service(exec: &dyn Exec, host: &str) -> io::Result<Option<u16>> {
    let adb = find_adb(exec);
    if let Ok(output) = exec.run(Path::new("."), &adb, &["mdns", "services"], &[], None) {
        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            if let Some(port) = parse_mdns_connect_service(&stdout, host) {
                return Ok(Some(port));
            }
        }
    }

    if let Some(port) = dnssd_resolve_connect(host) {
        return Ok(Some(port));
    }

    Ok(None)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(unix)]
    use std::os::unix::process::ExitStatusExt;
    #[cfg(windows)]
    use std::os::windows::process::ExitStatusExt;

    #[test]
    fn test_parse_pair_output_success() {
        let stdout = "Successfully paired to 192.168.1.50:37123 [guid: adb-37123-abcdef]";
        let res = parse_pair_output(true, stdout, "");
        assert!(res.success);
        assert_eq!(res.message, stdout);

        let res2 = parse_pair_output(true, "successfully paired to 192.168.1.50:37123", "");
        assert!(res2.success);
    }

    #[test]
    fn test_parse_pair_output_failure() {
        let out1 = "Failed: Unable to start pairing client";
        let res1 = parse_pair_output(true, out1, "");
        assert!(!res1.success);
        assert_eq!(res1.message, out1);

        let out2 = "Failed: Wrong password";
        let res2 = parse_pair_output(true, out2, "");
        assert!(!res2.success);
        assert_eq!(res2.message, out2);

        let res3 = parse_pair_output(false, "", "error: connection reset by peer");
        assert!(!res3.success);
        assert_eq!(res3.message, "error: connection reset by peer");

        let res4 = parse_pair_output(false, "", "");
        assert!(!res4.success);
        assert_eq!(res4.message, "adb pair failed with non-zero exit code");
    }

    #[test]
    fn test_parse_connect_output_success() {
        let out = "connected to 192.168.1.50:5555";
        let res = parse_connect_output(true, out, "").unwrap();
        assert_eq!(res, out);

        let out_already = "already connected to 192.168.1.50:5555";
        let res_already = parse_connect_output(true, out_already, "").unwrap();
        assert_eq!(res_already, out_already);
    }

    #[test]
    fn test_parse_connect_output_failure() {
        let out1 = "failed to connect to 192.168.1.50:5555";
        let err1 = parse_connect_output(true, out1, "").unwrap_err();
        assert_eq!(err1.kind(), io::ErrorKind::Other);
        assert!(err1
            .to_string()
            .contains("failed to connect to 192.168.1.50:5555"));

        let out2 = "unable to connect to 192.168.1.50:5555: Connection refused";
        let err2 = parse_connect_output(true, out2, "").unwrap_err();
        assert!(err2.to_string().contains("unable to connect"));

        let err3 = parse_connect_output(false, "", "cannot connect to 192.168.1.50:5555");
        assert!(err3.is_err());

        let err4 = parse_connect_output(false, "", "");
        assert!(err4.is_err());
    }

    #[derive(Default)]
    struct MockAdbExec {
        pair_stdout: &'static str,
        pair_stderr: &'static str,
        pair_success: bool,
        connect_stdout: &'static str,
        connect_stderr: &'static str,
        connect_success: bool,
        mdns_stdout: &'static str,
        mdns_stderr: &'static str,
        mdns_success: bool,
    }

    impl Exec for MockAdbExec {
        fn run(
            &self,
            _cwd: &Path,
            _program: &str,
            args: &[&str],
            _env: &[(&str, &str)],
            _stdin: Option<&[u8]>,
        ) -> io::Result<std::process::Output> {
            if args.len() >= 2 && args[0] == "pair" {
                assert_eq!(args[1], "192.168.1.50:37123");
                if args.len() >= 3 {
                    assert_eq!(args[2], "654321");
                }
                let status_code = if self.pair_success { 0 } else { 1 };
                return Ok(std::process::Output {
                    status: std::process::ExitStatus::from_raw(status_code),
                    stdout: self.pair_stdout.as_bytes().to_vec(),
                    stderr: self.pair_stderr.as_bytes().to_vec(),
                });
            }

            if args.len() >= 2 && args[0] == "connect" {
                assert_eq!(args[1], "192.168.1.50:5555");
                let status_code = if self.connect_success { 0 } else { 1 };
                return Ok(std::process::Output {
                    status: std::process::ExitStatus::from_raw(status_code),
                    stdout: self.connect_stdout.as_bytes().to_vec(),
                    stderr: self.connect_stderr.as_bytes().to_vec(),
                });
            }

            if args.len() >= 2 && args[0] == "mdns" && args[1] == "services" {
                let status_code = if self.mdns_success { 0 } else { 1 };
                return Ok(std::process::Output {
                    status: std::process::ExitStatus::from_raw(status_code),
                    stdout: self.mdns_stdout.as_bytes().to_vec(),
                    stderr: self.mdns_stderr.as_bytes().to_vec(),
                });
            }

            panic!("unexpected args: {:?}", args);
        }
    }

    #[test]
    fn test_adb_pair_and_connect_mock_success() {
        let exec = MockAdbExec {
            pair_stdout: "Successfully paired to 192.168.1.50:37123 [guid: test-guid]\n",
            pair_stderr: "",
            pair_success: true,
            connect_stdout: "connected to 192.168.1.50:5555\n",
            connect_stderr: "",
            connect_success: true,
            mdns_stdout: "",
            mdns_stderr: "",
            mdns_success: true,
        };

        let pair_res = adb_pair(&exec, "192.168.1.50", 37123, "654321").unwrap();
        assert!(pair_res.success);
        assert_eq!(
            pair_res.message,
            "Successfully paired to 192.168.1.50:37123 [guid: test-guid]"
        );

        let conn_res = adb_connect(&exec, "192.168.1.50", 5555).unwrap();
        assert_eq!(conn_res, "connected to 192.168.1.50:5555");
    }

    #[test]
    fn test_adb_pair_and_connect_mock_failure() {
        let exec = MockAdbExec {
            pair_stdout: "Failed: Wrong password\n",
            pair_stderr: "",
            pair_success: true,
            connect_stdout: "failed to connect to 192.168.1.50:5555\n",
            connect_stderr: "",
            connect_success: true,
            mdns_stdout: "",
            mdns_stderr: "",
            mdns_success: true,
        };

        let pair_res = adb_pair(&exec, "192.168.1.50", 37123, "654321").unwrap();
        assert!(!pair_res.success);
        assert_eq!(pair_res.message, "Failed: Wrong password");

        let conn_res = adb_connect(&exec, "192.168.1.50", 5555);
        assert!(conn_res.is_err());
        assert!(conn_res
            .unwrap_err()
            .to_string()
            .contains("failed to connect"));
    }

    #[test]
    fn test_parse_mdns_services_standard() {
        let stdout = "\
List of discovered mdns services
studio-g@<xeYnap/          _adb-tls-pairing._tcp  192.168.86.39:55861
adb-14141FDF600081-TnSdi9  _adb-tls-connect._tcp  192.168.86.38:33015
";
        let res = parse_mdns_services(stdout, "studio-g");
        assert_eq!(res, Some(("192.168.86.39".to_string(), 55861)));
    }

    #[test]
    fn test_parse_mdns_services_tabs_multiple_devices() {
        let stdout = "\
List of discovered mdns services
studio-dev-1\t_adb-tls-pairing._tcp\t192.168.1.100:40001
adb-dev-1\t_adb-tls-connect._tcp\t192.168.1.100:30001
studio-petak-a1b2c3d4@xyz    _adb-tls-pairing._tcp    10.0.0.42:52000
adb-dev-2    _adb-tls-connect._tcp    10.0.0.42:35555
";
        let res1 = parse_mdns_services(stdout, "studio-petak-a1b2c3d4");
        assert_eq!(res1, Some(("10.0.0.42".to_string(), 52000)));

        let res2 = parse_mdns_services(stdout, "studio-dev-1");
        assert_eq!(res2, Some(("192.168.1.100".to_string(), 40001)));
    }

    #[test]
    fn test_parse_mdns_services_not_found_or_invalid() {
        let stdout = "\
List of discovered mdns services
adb-14141FDF600081-TnSdi9  _adb-tls-connect._tcp  192.168.86.38:33015
";
        assert_eq!(parse_mdns_services(stdout, "studio-petak"), None);
        assert_eq!(parse_mdns_services(stdout, ""), None);
        assert_eq!(parse_mdns_services(stdout, "   "), None);
        assert_eq!(parse_mdns_services("", "studio-g"), None);
        assert_eq!(
            parse_mdns_services("List of discovered mdns services\n", "studio-g"),
            None
        );
    }

    #[test]
    fn test_parse_mdns_connect_service() {
        let stdout = "\
List of discovered mdns services
studio-g@<xeYnap/          _adb-tls-pairing._tcp  192.168.86.39:55861
adb-14141FDF600081-TnSdi9  _adb-tls-connect._tcp  192.168.86.38:33015
adb-another-dev            _adb-tls-connect._tcp  192.168.86.39:37000
";
        assert_eq!(
            parse_mdns_connect_service(stdout, "192.168.86.38"),
            Some(33015)
        );
        assert_eq!(
            parse_mdns_connect_service(stdout, "192.168.86.39"),
            Some(37000)
        );
        assert_eq!(parse_mdns_connect_service(stdout, "192.168.86.40"), None);
        assert_eq!(parse_mdns_connect_service(stdout, ""), None);
    }

    #[test]
    fn test_adb_find_pairing_service_mock() {
        let stdout = "\
List of discovered mdns services
studio-petak-xyz@abc    _adb-tls-pairing._tcp  192.168.1.55:42000
";
        let exec = MockAdbExec {
            pair_stdout: "",
            pair_stderr: "",
            pair_success: true,
            connect_stdout: "",
            connect_stderr: "",
            connect_success: true,
            mdns_stdout: stdout,
            mdns_stderr: "",
            mdns_success: true,
        };

        let found = adb_find_pairing_service(&exec, "studio-petak-xyz").unwrap();
        assert_eq!(found, Some(("192.168.1.55".to_string(), 42000)));

        let not_found = adb_find_pairing_service(&exec, "studio-unknown").unwrap();
        assert_eq!(not_found, None);

        let exec_fail = MockAdbExec {
            pair_stdout: "",
            pair_stderr: "",
            pair_success: true,
            connect_stdout: "",
            connect_stderr: "",
            connect_success: true,
            mdns_stdout: "",
            mdns_stderr: "error: cannot start daemon",
            mdns_success: false,
        };
        let res_fail = adb_find_pairing_service(&exec_fail, "studio-petak-xyz").unwrap();
        assert_eq!(res_fail, None);
    }
}
