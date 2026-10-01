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
    let output = exec.run(
        Path::new("."),
        &adb,
        &["pair", &target, code.trim()],
        &[],
        None,
    )?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    Ok(parse_pair_output(output.status.success(), &stdout, &stderr))
}

pub fn adb_connect(exec: &dyn Exec, host: &str, port: u16) -> io::Result<String> {
    let adb = find_adb(exec);
    let target = format!("{}:{}", host.trim(), port);
    let output = exec.run(Path::new("."), &adb, &["connect", &target], &[], None)?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    parse_connect_output(output.status.success(), &stdout, &stderr)
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

    struct MockAdbExec {
        pair_stdout: &'static str,
        pair_stderr: &'static str,
        pair_success: bool,
        connect_stdout: &'static str,
        connect_stderr: &'static str,
        connect_success: bool,
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
            if args.len() >= 3 && args[0] == "pair" {
                assert_eq!(args[1], "192.168.1.50:37123");
                assert_eq!(args[2], "654321");
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
}
