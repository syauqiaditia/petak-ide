use std::path::{Path, PathBuf};
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
    #[serde(default)]
    pub kotlin_ls: Option<Tool>,
    #[serde(default)]
    pub sourcekit: Option<Tool>,
    #[serde(default)]
    pub effective_path: Option<String>,
    #[serde(default)]
    pub scrcpy: Option<Tool>,
}

/// Detect installed developer tools and SDKs.
pub fn detect(root: &Path, exec: &dyn Exec) -> Toolchain {
    let dummy_root = PathBuf::from(".");
    let root = if root.as_os_str().is_empty() {
        &dummy_root
    } else {
        root
    };

    let fvm = root.join(".fvmrc").exists() || root.join(".fvm/fvm_config.json").exists();

    // 1. Flutter & Dart
    let (flutter, dart) = detect_flutter_and_dart(root, exec);

    // 2. Android SDK, adb, emulator
    let (android_home, adb, emulator) = detect_android(root, exec);

    // 3. Java
    let java = detect_java(root, exec);

    // 4. xcrun (macOS only)
    let xcrun = detect_xcrun(root, exec);

    // 5. Kotlin Language Server
    let kotlin_ls = detect_kotlin_ls(root, exec);

    // 6. SourceKit-LSP
    let sourcekit = detect_sourcekit(root, exec);

    // 7. scrcpy (mirror service)
    let scrcpy = detect_scrcpy(root, exec);

    // 8. Effective PATH
    let effective_path = Some(crate::toolchain::effective_path_for_root(Some(root)));

    Toolchain {
        flutter,
        dart,
        fvm,
        android_home,
        adb,
        emulator,
        java,
        xcrun,
        kotlin_ls,
        sourcekit,
        effective_path,
        scrcpy,
    }
}

/// Parse the first JSON object from a string that may contain leading/trailing non-JSON text (e.g. Flutter analytics banners).
fn parse_first_json_object(s: &str) -> Option<serde_json::Value> {
    let start = s.find('{')?;
    let mut depth = 0;
    let mut in_string = false;
    let mut escape = false;
    for (i, ch) in s[start..].char_indices() {
        if escape {
            escape = false;
            continue;
        }
        if ch == '\\' && in_string {
            escape = true;
            continue;
        }
        if ch == '"' {
            in_string = !in_string;
            continue;
        }
        if !in_string {
            if ch == '{' {
                depth += 1;
            } else if ch == '}' {
                depth -= 1;
                if depth == 0 {
                    let json_slice = &s[start..start + i + 1];
                    return serde_json::from_str(json_slice).ok();
                }
            }
        }
    }
    None
}

fn detect_flutter_and_dart(root: &Path, exec: &dyn Exec) -> (Option<Tool>, Option<Tool>) {
    let mut candidate_cmds = Vec::new();

    if let Some(p) = crate::toolchain::resolve_flutter(Some(root)) {
        candidate_cmds.push(p.to_string_lossy().to_string());
    }
    candidate_cmds.push("flutter".to_string());

    // Standard macOS / user paths
    let home = std::env::var_os("HOME").map(PathBuf::from);
    if let Some(ref h) = home {
        // Scan ~/SDK/flutter_* versioned directories sorted descending (newest first)
        let sdk_dir = h.join("SDK");
        if sdk_dir.is_dir() {
            if let Ok(entries) = std::fs::read_dir(&sdk_dir) {
                let mut versioned: Vec<(PathBuf, String)> = Vec::new();
                for entry in entries.flatten() {
                    let name = entry.file_name().to_string_lossy().to_string();
                    if name.starts_with("flutter") {
                        versioned.push((entry.path(), name));
                    }
                }
                versioned.sort_by(|a, b| {
                    let key_a = crate::toolchain::parse_version_key(&a.1);
                    let key_b = crate::toolchain::parse_version_key(&b.1);
                    key_b.cmp(&key_a).then_with(|| b.1.cmp(&a.1))
                });
                for (path, _) in versioned {
                    let f = path.join("bin").join("flutter");
                    if f.is_file() {
                        candidate_cmds.push(f.to_string_lossy().to_string());
                    }
                }
            }
        }

        for sub in &[
            "SDK/flutter/bin/flutter",
            ".flutter/bin/flutter",
            "flutter/bin/flutter",
            "development/flutter/bin/flutter",
            "fvm/default/bin/flutter",
        ] {
            let p = h.join(sub);
            if p.is_file() {
                candidate_cmds.push(p.to_string_lossy().to_string());
            }
        }
    }

    for sys in &[
        "/opt/homebrew/bin/flutter",
        "/usr/local/bin/flutter",
    ] {
        let p = Path::new(sys);
        if p.is_file() {
            candidate_cmds.push(sys.to_string());
        }
    }

    for cmd in &candidate_cmds {
        let Ok(out) = exec.run(root, cmd, &["--version", "--machine"], &[], None) else {
            continue;
        };
        if !out.status.success() {
            continue;
        }

        let stdout_str = String::from_utf8_lossy(&out.stdout);
        let v: serde_json::Value = match parse_first_json_object(&stdout_str)
            .or_else(|| serde_json::from_slice(&out.stdout).ok())
        {
            Some(val) => val,
            None => continue,
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
            .unwrap_or_else(|| cmd.clone());

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

        return (Some(flutter_tool), Some(dart_tool));
    }

    // Fallback: if GUI PATH minimal, probe shell which flutter
    let curr_path = std::env::var("PATH").unwrap_or_default();
    if crate::toolchain::is_minimal_path(&curr_path) {
        for probed in crate::toolchain::probe_shell_which(std::time::Duration::from_secs(3)) {
            if probed.file_name().and_then(|n| n.to_str()) == Some("flutter") {
                let cmd = probed.to_string_lossy().to_string();
                if let Ok(out) = exec.run(root, &cmd, &["--version", "--machine"], &[], None) {
                    if out.status.success() {
                        let stdout_str = String::from_utf8_lossy(&out.stdout);
                        if let Some(v) = parse_first_json_object(&stdout_str)
                            .or_else(|| serde_json::from_slice(&out.stdout).ok())
                        {
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
                                .unwrap_or_else(|| cmd.clone());

                            let dart_path = flutter_root
                                .map(|r| format!("{}/bin/dart", r))
                                .unwrap_or_else(|| "dart".to_string());

                            return (
                                Some(Tool { path: flutter_path, version: flutter_version }),
                                Some(Tool { path: dart_path, version: dart_version }),
                            );
                        }
                    }
                }
            }
        }
    }

    (None, None)
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
    let mut candidates = Vec::new();

    if let Ok(home) = std::env::var("JAVA_HOME") {
        let p = Path::new(&home).join("bin").join("java");
        if p.exists() {
            candidates.push(p.to_string_lossy().to_string());
        }
    }

    if let Some(jdk_home) = crate::toolchain::resolve_jdk_home() {
        let p = jdk_home.join("bin").join("java");
        if p.exists() {
            candidates.push(p.to_string_lossy().to_string());
        }
    }

    // macOS standard JVM paths
    let mut jvm_parents = vec![PathBuf::from("/Library/Java/JavaVirtualMachines")];
    if let Some(h) = std::env::var_os("HOME").map(PathBuf::from) {
        jvm_parents.push(h.join("Library").join("Java").join("JavaVirtualMachines"));
    }
    for jvm_parent in jvm_parents {
        if jvm_parent.is_dir() {
            if let Ok(entries) = std::fs::read_dir(&jvm_parent) {
                for entry in entries.flatten() {
                    let java_bin = entry.path().join("Contents").join("Home").join("bin").join("java");
                    if java_bin.is_file() {
                        candidates.push(java_bin.to_string_lossy().to_string());
                    }
                }
            }
        }
    }

    for opt_java in &[
        "/opt/homebrew/opt/openjdk/bin/java",
        "/opt/homebrew/bin/java",
        "/usr/local/opt/openjdk/bin/java",
        "/usr/local/bin/java",
        "/usr/bin/java",
    ] {
        let p = Path::new(opt_java);
        if p.is_file() {
            candidates.push(opt_java.to_string());
        }
    }

    candidates.push("java".to_string());

    for cmd in &candidates {
        if let Ok(out) = exec.run(root, cmd, &["-version"], &[], None) {
            if out.status.success() {
                let combined = format!(
                    "{}\n{}",
                    String::from_utf8_lossy(&out.stdout),
                    String::from_utf8_lossy(&out.stderr)
                );
                let version = parse_java_version(&combined);
                return Some(Tool {
                    path: cmd.clone(),
                    version,
                });
            }
        }
    }

    // Fallback: if GUI PATH minimal, probe shell which java
    let curr_path = std::env::var("PATH").unwrap_or_default();
    if crate::toolchain::is_minimal_path(&curr_path) {
        for probed in crate::toolchain::probe_shell_which(std::time::Duration::from_secs(3)) {
            if probed.file_name().and_then(|n| n.to_str()) == Some("java") {
                let cmd = probed.to_string_lossy().to_string();
                if let Ok(out) = exec.run(root, &cmd, &["-version"], &[], None) {
                    if out.status.success() {
                        let combined = format!(
                            "{}\n{}",
                            String::from_utf8_lossy(&out.stdout),
                            String::from_utf8_lossy(&out.stderr)
                        );
                        let version = parse_java_version(&combined);
                        return Some(Tool {
                            path: cmd,
                            version,
                        });
                    }
                }
            }
        }
    }

    None
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

fn detect_kotlin_ls(root: &Path, exec: &dyn Exec) -> Option<Tool> {
    let p = crate::toolchain::resolve_kotlin_ls()?;
    let path_str = p.to_string_lossy().to_string();
    let version = match exec.run(root, &path_str, &["--version"], &[], None) {
        Ok(out) if out.status.success() => {
            let s = String::from_utf8_lossy(&out.stdout);
            s.lines().next().map(|l| l.trim().to_string())
        }
        _ => None,
    };
    Some(Tool {
        path: path_str,
        version,
    })
}

fn detect_sourcekit(root: &Path, exec: &dyn Exec) -> Option<Tool> {
    let p = crate::toolchain::resolve_sourcekit_lsp()?;
    let path_str = p.to_string_lossy().to_string();
    let version = match exec.run(root, &path_str, &["--version"], &[], None) {
        Ok(out) if out.status.success() => {
            let s = String::from_utf8_lossy(&out.stdout);
            s.lines().next().map(|l| l.trim().to_string())
        }
        _ => None,
    };
    Some(Tool {
        path: path_str,
        version,
    })
}

fn detect_scrcpy(root: &Path, exec: &dyn Exec) -> Option<Tool> {
    detect_scrcpy_internal(
        root,
        exec,
        crate::mirror::server::resolve_server_jar().ok(),
        crate::toolchain::resolve_scrcpy(),
    )
}

fn detect_scrcpy_internal(
    root: &Path,
    exec: &dyn Exec,
    resolved_server_jar: Option<String>,
    resolved_scrcpy_bin: Option<PathBuf>,
) -> Option<Tool> {
    // 1. Check if scrcpy-server jar is resolved
    if let Some(jar_path) = resolved_server_jar {
        return Some(Tool {
            path: jar_path,
            version: Some(crate::mirror::server::SCRCPY_VERSION.to_string()),
        });
    }

    // 2. Check scrcpy executable in path
    if let Some(scrcpy_bin) = resolved_scrcpy_bin {
        let path_str = scrcpy_bin.to_string_lossy().to_string();
        let version = match exec.run(root, &path_str, &["--version"], &[], None) {
            Ok(out) if out.status.success() => {
                let s = String::from_utf8_lossy(&out.stdout);
                s.lines().next().map(|l| l.trim().to_string())
            }
            _ => None,
        };
        return Some(Tool {
            path: path_str,
            version,
        });
    }

    None
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

    #[test]
    fn test_detect_scrcpy_resolved_jar_and_missing() {
        let fake = FakeToolchainExec {
            responses: Mutex::new(HashMap::new()),
        };

        // When server jar is resolved
        let tool = detect_scrcpy_internal(
            Path::new("."),
            &fake,
            Some("/opt/homebrew/share/scrcpy/scrcpy-server".to_string()),
            None,
        );
        assert!(tool.is_some());
        let scrcpy = tool.unwrap();
        assert_eq!(scrcpy.path, "/opt/homebrew/share/scrcpy/scrcpy-server");
        assert_eq!(
            scrcpy.version,
            Some(crate::mirror::server::SCRCPY_VERSION.to_string())
        );

        // When neither jar nor executable exists
        let missing = detect_scrcpy_internal(Path::new("."), &fake, None, None);
        assert!(missing.is_none());
    }

    #[test]
    fn test_parse_first_json_object_with_trailing_banner() {
        let raw = r#"{"frameworkVersion":"2.10.5","dartSdkVersion":"2.16.2","flutterRoot":"/custom/flutter"}

  ╔════════════════════════════════════════════════════════════════════════════╗
  ║                 Welcome to Flutter! - https://flutter.dev                  ║
  ╚════════════════════════════════════════════════════════════════════════════╝"#;
        let val = parse_first_json_object(raw).expect("should parse JSON despite banner");
        assert_eq!(val.get("frameworkVersion").and_then(|v| v.as_str()), Some("2.10.5"));
        assert_eq!(val.get("dartSdkVersion").and_then(|v| v.as_str()), Some("2.16.2"));
    }

    #[test]
    fn test_detect_with_empty_root_does_not_fail() {
        let mut responses = HashMap::new();
        responses.insert(
            "flutter --version --machine".to_string(),
            make_output(
                0,
                b"{\"flutterVersion\":\"3.35.7\",\"dartSdkVersion\":\"3.9.2\",\"flutterRoot\":\"/custom/flutter\"}\n\nWelcome banner",
                b"",
            ),
        );
        responses.insert(
            "java -version".to_string(),
            make_output(0, b"", b"openjdk version \"19.0.2\" 2023-01-17\n"),
        );

        let fake = FakeToolchainExec {
            responses: Mutex::new(responses),
        };

        // When root is empty string, detect must not fail with ENOENT
        let tc = detect(Path::new(""), &fake);
        assert!(tc.flutter.is_some());
        assert_eq!(tc.flutter.unwrap().version, Some("3.35.7".to_string()));
        assert!(tc.dart.is_some());
        assert_eq!(tc.dart.unwrap().version, Some("3.9.2".to_string()));
        assert!(tc.java.is_some());
        assert_eq!(tc.java.unwrap().version, Some("19.0.2".to_string()));
    }
}
