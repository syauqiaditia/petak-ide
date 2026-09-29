use std::path::Path;
use serde::{Deserialize, Serialize};

use crate::exec::Exec;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Tool {
    pub path: String,
    pub version: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Toolchain {
    pub flutter: Option<Tool>,
    pub dart: Option<Tool>,
    pub fvm: bool,
    pub android_home: Option<String>,
    pub adb: Option<Tool>,
    pub emulator: Option<Tool>,
    pub java: Option<Tool>,
    pub xcrun: Option<Tool>,
}

/// Detect installed developer tools and SDKs.
pub fn detect(root: &Path, exec: &dyn Exec) -> Toolchain {
    let fvm = root.join(".fvmrc").exists() || root.join(".fvm/fvm_config.json").exists();

    // 1. Flutter & Dart
    let (flutter, dart) = detect_flutter_and_dart(root, exec);

    // 2. Android SDK, adb, emulator
    let (android_home, adb, emulator) = detect_android(root, exec);

    // 3. Java
    let java = detect_java(root, exec);

    // 4. xcrun (macOS only)
    let xcrun = detect_xcrun(root, exec);

    Toolchain {
        flutter,
        dart,
        fvm,
        android_home,
        adb,
        emulator,
        java,
        xcrun,
    }
}

fn detect_flutter_and_dart(root: &Path, exec: &dyn Exec) -> (Option<Tool>, Option<Tool>) {
    let output = match exec.run(root, "flutter", &["--version", "--machine"], &[], None) {
        Ok(out) if out.status.success() => out,
        _ => return (None, None),
    };

    let v: serde_json::Value = match serde_json::from_slice(&output.stdout) {
        Ok(val) => val,
        Err(_) => return (None, None),
    };

    let flutter_version = v
        .get("flutterVersion")
        .or_else(|| v.get("frameworkVersion"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let dart_version = v
        .get("dartSdkVersion")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let flutter_root = v
        .get("flutterRoot")
        .and_then(|v| v.as_str());

    let flutter_path = flutter_root
        .map(|r| format!("{}/bin/flutter", r))
        .unwrap_or_else(|| "flutter".to_string());

    let dart_path = flutter_root
        .map(|r| format!("{}/bin/dart", r))
        .unwrap_or_else(|| "dart".to_string());

    let flutter_tool = Tool {
        path: flutter_path,
        version: flutter_version,
    };

    let dart_tool = Tool {
        path: dart_path,
        version: dart_version,
    };

    (Some(flutter_tool), Some(dart_tool))
}

fn detect_android(root: &Path, exec: &dyn Exec) -> (Option<String>, Option<Tool>, Option<Tool>) {
    let android_home = std::env::var("ANDROID_HOME")
        .ok()
        .or_else(|| std::env::var("ANDROID_SDK_ROOT").ok())
        .or_else(|| {
            // Check default user home sdk location
            let home = std::env::var("HOME").ok()?;
            let linux_path = Path::new(&home).join("Android/Sdk");
            if linux_path.exists() {
                Some(linux_path.to_string_lossy().to_string())
            } else {
                let mac_path = Path::new(&home).join("Library/Android/sdk");
                if mac_path.exists() {
                    Some(mac_path.to_string_lossy().to_string())
                } else {
                    None
                }
            }
        });

    let (adb_candidate, emu_candidate) = match &android_home {
        Some(home) => {
            let adb_p = Path::new(home).join("platform-tools").join("adb");
            let emu_p = Path::new(home).join("emulator").join("emulator");
            (
                if adb_p.exists() { Some(adb_p.to_string_lossy().to_string()) } else { None },
                if emu_p.exists() { Some(emu_p.to_string_lossy().to_string()) } else { None },
            )
        }
        None => (None, None),
    };

    // Detect adb
    let adb = {
        let cmd = adb_candidate.as_deref().unwrap_or("adb");
        match exec.run(root, cmd, &["version"], &[], None) {
            Ok(out) if out.status.success() => {
                let stdout = String::from_utf8_lossy(&out.stdout);
                let version = parse_adb_version(&stdout);
                Some(Tool {
                    path: cmd.to_string(),
                    version,
                })
            }
            _ => None,
        }
    };

    // Detect emulator
    let emulator = {
        let cmd = emu_candidate.as_deref().unwrap_or("emulator");
        match exec.run(root, cmd, &["-version"], &[], None) {
            Ok(out) if out.status.success() => {
                let stdout = String::from_utf8_lossy(&out.stdout);
                let version = parse_emulator_version(&stdout);
                Some(Tool {
                    path: cmd.to_string(),
                    version,
                })
            }
            _ => None,
        }
    };

    (android_home, adb, emulator)
}

fn parse_adb_version(text: &str) -> Option<String> {
    // "Android Debug Bridge version 1.0.41\nVersion 37.0.1-15733141"
    for line in text.lines() {
        if let Some(rest) = line.strip_prefix("Android Debug Bridge version ") {
            return Some(rest.trim().to_string());
        }
    }
    None
}

fn parse_emulator_version(text: &str) -> Option<String> {
    // "Android emulator version 37.1.11.0 (build_id 15917651)"
    for line in text.lines() {
        if let Some(rest) = line.strip_prefix("Android emulator version ") {
            let ver = rest.split_whitespace().next().unwrap_or(rest);
            return Some(ver.trim().to_string());
        }
    }
    None
}

fn detect_java(root: &Path, exec: &dyn Exec) -> Option<Tool> {
    let java_cmd = match std::env::var("JAVA_HOME") {
        Ok(home) => {
            let p = Path::new(&home).join("bin").join("java");
            if p.exists() {
                p.to_string_lossy().to_string()
            } else {
                "java".to_string()
            }
        }
        Err(_) => "java".to_string(),
    };

    match exec.run(root, &java_cmd, &["-version"], &[], None) {
        Ok(out) if out.status.success() => {
            let combined = format!(
                "{}\n{}",
                String::from_utf8_lossy(&out.stdout),
                String::from_utf8_lossy(&out.stderr)
            );
            let version = parse_java_version(&combined);
            Some(Tool {
                path: java_cmd,
                version,
            })
        }
        _ => None,
    }
}

fn parse_java_version(text: &str) -> Option<String> {
    // openjdk version "21.0.12.1" 2026-08-18
    // java version "17.0.2" 2022-01-18 LTS
    for line in text.lines() {
        if line.contains("version \"") {
            if let Some(start) = line.find('"') {
                if let Some(end) = line[start + 1..].find('"') {
                    return Some(line[start + 1..start + 1 + end].to_string());
                }
            }
        }
    }
    None
}

fn detect_xcrun(root: &Path, exec: &dyn Exec) -> Option<Tool> {
    if !cfg!(target_os = "macos") {
        return None;
    }

    match exec.run(root, "xcrun", &["--version"], &[], None) {
        Ok(out) if out.status.success() => {
            let stdout = String::from_utf8_lossy(&out.stdout);
            let version = stdout
                .lines()
                .find(|l| l.starts_with("xcrun version "))
                .and_then(|l| l.strip_prefix("xcrun version "))
                .map(|s| s.trim_end_matches('.').trim().to_string());
            Some(Tool {
                path: "xcrun".to_string(),
                version,
            })
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::io;
    use std::process::{ExitStatus, Output};
    use std::sync::Mutex;

    struct FakeToolchainExec {
        responses: Mutex<HashMap<String, Output>>,
    }

    impl Exec for FakeToolchainExec {
        fn run(
            &self,
            _cwd: &Path,
            program: &str,
            args: &[&str],
            _env: &[(&str, &str)],
            _stdin: Option<&[u8]>,
        ) -> io::Result<Output> {
            let prog_name = Path::new(program)
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or(program);
            let key = format!("{} {}", prog_name, args.join(" "));
            let map = self.responses.lock().unwrap();
            if let Some(out) = map.get(&key) {
                Ok(out.clone())
            } else {
                Err(io::Error::new(io::ErrorKind::NotFound, "command not found"))
            }
        }
    }

    fn make_output(code: i32, stdout: &[u8], stderr: &[u8]) -> Output {
        #[cfg(unix)]
        use std::os::unix::process::ExitStatusExt;
        Output {
            status: ExitStatus::from_raw(code << 8),
            stdout: stdout.to_vec(),
            stderr: stderr.to_vec(),
        }
    }

    #[test]
    fn test_detect_fake_exec() {
        let temp_dir = tempfile::tempdir().unwrap();
        // Create .fvmrc
        std::fs::write(temp_dir.path().join(".fvmrc"), "{\"flutter\": \"3.35.7\"}").unwrap();

        let mut responses = HashMap::new();
        responses.insert(
            "flutter --version --machine".to_string(),
            make_output(
                0,
                b"{\"flutterVersion\":\"3.35.7\",\"dartSdkVersion\":\"3.9.2\",\"flutterRoot\":\"/custom/flutter\"}",
                b"",
            ),
        );
        responses.insert(
            "java -version".to_string(),
            make_output(0, b"", b"openjdk version \"21.0.1\" 2024-10-15\n"),
        );
        responses.insert(
            "adb version".to_string(),
            make_output(0, b"Android Debug Bridge version 1.0.41\nVersion 37.0.1\n", b""),
        );
        responses.insert(
            "emulator -version".to_string(),
            make_output(0, b"Android emulator version 35.1.4.0 (build_id 1234)\n", b""),
        );

        let fake = FakeToolchainExec {
            responses: Mutex::new(responses),
        };

        let tc = detect(temp_dir.path(), &fake);
        assert!(tc.fvm);
        assert_eq!(
            tc.flutter,
            Some(Tool {
                path: "/custom/flutter/bin/flutter".to_string(),
                version: Some("3.35.7".to_string()),
            })
        );
        assert_eq!(
            tc.dart,
            Some(Tool {
                path: "/custom/flutter/bin/dart".to_string(),
                version: Some("3.9.2".to_string()),
            })
        );
        assert_eq!(tc.java.unwrap().version, Some("21.0.1".to_string()));
        assert_eq!(tc.adb.unwrap().version, Some("1.0.41".to_string()));
        assert_eq!(tc.emulator.unwrap().version, Some("35.1.4.0".to_string()));
        #[cfg(not(target_os = "macos"))]
        assert_eq!(tc.xcrun, None);
    }

    #[test]
    fn test_detect_real_toolchain_on_server() {
        let exec = crate::exec::SystemExec;
        let root = Path::new(".");
        let tc = detect(root, &exec);

        // On server: flutter, java, and android sdk are present
        assert!(tc.flutter.is_some(), "flutter should be detected on server");
        assert!(tc.dart.is_some(), "dart should be detected on server");
        assert!(tc.java.is_some(), "java should be detected on server");
        assert!(tc.android_home.is_some(), "android_home should be detected on server");
        assert!(tc.adb.is_some(), "adb should be detected on server");
        assert!(tc.emulator.is_some(), "emulator should be detected on server");
        #[cfg(not(target_os = "macos"))]
        assert!(tc.xcrun.is_none());
    }
}
