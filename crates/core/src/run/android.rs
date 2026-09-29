use std::fs;
use std::io;
use std::path::Path;
use std::sync::mpsc::Sender;
use std::sync::OnceLock;

use regex::Regex;

use crate::exec::{Exec, ProcLine, Spawn};
use crate::run::device::{is_valid_device_id, resolve_adb_binary};
use crate::run::flutter::{parse_build_error, AppState, OutputStream, RunEvent};

/// Validate Android application ID (package name) according to `^[A-Za-z0-9_.]+$`.
pub fn is_valid_app_id(app_id: &str) -> bool {
    static RE: OnceLock<Regex> = OnceLock::new();
    let re = RE.get_or_init(|| Regex::new(r"^[A-Za-z0-9_.]+$").unwrap());
    !app_id.is_empty() && re.is_match(app_id)
}

/// Validate Gradle module path (e.g. `:app` or `:features:login`) according to `^:[A-Za-z0-9_:-]+$`.
pub fn is_valid_gradle_module(module: &str) -> bool {
    static RE: OnceLock<Regex> = OnceLock::new();
    let re = RE.get_or_init(|| Regex::new(r"^:[A-Za-z0-9_:-]+$").unwrap());
    !module.is_empty() && re.is_match(module)
}

/// Validate Gradle build variant (e.g. `debug`, `release`, `devDebug`) according to `^[A-Za-z0-9]+$`.
pub fn is_valid_gradle_variant(variant: &str) -> bool {
    static RE: OnceLock<Regex> = OnceLock::new();
    let re = RE.get_or_init(|| Regex::new(r"^[A-Za-z0-9]+$").unwrap());
    !variant.is_empty() && re.is_match(variant)
}

/// Helper to resolve gradle wrapper executable path or fallback to system gradle.
pub fn resolve_gradlew(root: &Path) -> String {
    let gradlew = root.join("gradlew");
    if gradlew.exists() {
        gradlew.to_string_lossy().to_string()
    } else {
        "gradle".to_string()
    }
}

/// Query running PID of an Android application on a device using `adb shell pidof`.
pub fn pidof(exec: &dyn Exec, device: &str, app_id: &str) -> io::Result<Option<u32>> {
    if !is_valid_device_id(device) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("invalid device ID: {}", device),
        ));
    }
    if !is_valid_app_id(app_id) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("invalid application ID: {}", app_id),
        ));
    }

    let adb = resolve_adb_binary();
    let output = exec.run(
        Path::new("."),
        &adb,
        &["-s", device, "shell", "pidof", app_id],
        &[],
        None,
    )?;

    if !output.status.success() {
        return Ok(None);
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    for token in stdout.split_whitespace() {
        if let Ok(pid) = token.parse::<u32>() {
            return Ok(Some(pid));
        }
    }

    Ok(None)
}

/// Extract applicationId from `app/build.gradle(.kts)` or `build.gradle(.kts)`.
pub fn find_application_id(root: &Path) -> Option<String> {
    let candidates = [
        root.join("app/build.gradle.kts"),
        root.join("app/build.gradle"),
        root.join("build.gradle.kts"),
        root.join("build.gradle"),
    ];

    static RE_APP_ID: OnceLock<Regex> = OnceLock::new();
    let re_app = RE_APP_ID.get_or_init(|| {
        Regex::new(r#"(?:applicationId|namespace)\s*(?:=|\s)\s*["']([^"']+)["']"#).unwrap()
    });

    for path in &candidates {
        if let Ok(content) = fs::read_to_string(path) {
            for caps in re_app.captures_iter(&content) {
                if let Some(id) = caps.get(1) {
                    let s = id.as_str().trim();
                    if is_valid_app_id(s) {
                        return Some(s.to_string());
                    }
                }
            }
        }
    }
    None
}

/// Extract launcher activity name from `AndroidManifest.xml`.
pub fn find_launcher_activity(root: &Path) -> Option<String> {
    let candidates = [
        root.join("app/src/main/AndroidManifest.xml"),
        root.join("src/main/AndroidManifest.xml"),
    ];

    static RE_ACTIVITY: OnceLock<Regex> = OnceLock::new();
    let re_act = RE_ACTIVITY.get_or_init(|| {
        Regex::new(r#"(?s)<activity\b([^>]*)>(.*?)</activity>"#).unwrap()
    });
    static RE_NAME: OnceLock<Regex> = OnceLock::new();
    let re_name = RE_NAME.get_or_init(|| {
        Regex::new(r#"android:name\s*=\s*["']([^"']+)["']"#).unwrap()
    });

    for path in &candidates {
        if let Ok(content) = fs::read_to_string(path) {
            for caps in re_act.captures_iter(&content) {
                let attrs = caps.get(1).map(|m| m.as_str()).unwrap_or("");
                let body = caps.get(2).map(|m| m.as_str()).unwrap_or("");
                if body.contains("android.intent.action.MAIN")
                    && body.contains("android.intent.category.LAUNCHER")
                {
                    if let Some(ncaps) = re_name.captures(attrs) {
                        if let Some(name) = ncaps.get(1) {
                            return Some(name.as_str().to_string());
                        }
                    }
                }
            }
        }
    }
    None
}

/// Launch an activity using `adb shell am start -n appId/activity`.
/// If appId or activity is not provided, reads fallback from `root`.
pub fn launch(
    exec: &dyn Exec,
    device: &str,
    app_id: Option<&str>,
    activity: Option<&str>,
    root: Option<&Path>,
) -> io::Result<()> {
    if !is_valid_device_id(device) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("invalid device ID: {}", device),
        ));
    }

    let resolved_app_id = match app_id {
        Some(id) if !id.trim().is_empty() => id.trim().to_string(),
        _ => {
            if let Some(r) = root {
                find_application_id(r).ok_or_else(|| {
                    io::Error::new(
                        io::ErrorKind::NotFound,
                        "Could not resolve applicationId from gradle files",
                    )
                })?
            } else {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidInput,
                    "applicationId was not provided and no root path provided for fallback",
                ));
            }
        }
    };

    if !is_valid_app_id(&resolved_app_id) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("invalid application ID: {}", resolved_app_id),
        ));
    }

    let resolved_activity = match activity {
        Some(act) if !act.trim().is_empty() => act.trim().to_string(),
        _ => {
            if let Some(r) = root {
                find_launcher_activity(r).ok_or_else(|| {
                    io::Error::new(
                        io::ErrorKind::NotFound,
                        "Could not resolve launcher activity from AndroidManifest.xml",
                    )
                })?
            } else {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidInput,
                    "launcher activity was not provided and no root path provided for fallback",
                ));
            }
        }
    };

    let comp_activity = if resolved_activity.starts_with('.') || resolved_activity.contains('.') {
        resolved_activity
    } else {
        format!(".{}", resolved_activity)
    };
    let component = format!("{}/{}", resolved_app_id, comp_activity);

    let adb = resolve_adb_binary();
    let output = exec.run(
        Path::new("."),
        &adb,
        &["-s", device, "shell", "am", "start", "-n", &component],
        &[],
        None,
    )?;

    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        let out = String::from_utf8_lossy(&output.stdout);
        let msg = if !err.trim().is_empty() { err } else { out };
        return Err(io::Error::new(
            io::ErrorKind::Other,
            format!("Failed to launch activity: {}", msg.trim()),
        ));
    }

    let out = String::from_utf8_lossy(&output.stdout);
    if out.contains("Error:") {
        return Err(io::Error::new(
            io::ErrorKind::Other,
            format!("am start reported error: {}", out.trim()),
        ));
    }

    Ok(())
}

/// Run `./gradlew tasks --offline -q` to sync and inspect gradle project tasks.
pub fn sync(exec: &dyn Exec, root: &Path) -> io::Result<String> {
    let gradlew = resolve_gradlew(root);
    let output = exec.run(root, &gradlew, &["tasks", "--offline", "-q"], &[], None)?;
    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        return Err(io::Error::new(
            io::ErrorKind::Other,
            format!("gradle sync failed: {}", err.trim()),
        ));
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

/// Parse output of `./gradlew --status` to check if any daemon is running.
pub fn parse_gradle_status(output: &str) -> bool {
    for line in output.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("PID") || trimmed.contains("No Gradle daemons") {
            continue;
        }
        let parts: Vec<&str> = trimmed.split_whitespace().collect();
        if parts.len() >= 2 {
            if parts[0].chars().all(|c| c.is_ascii_digit()) {
                let status = parts[1].to_uppercase();
                if status == "IDLE" || status == "BUSY" {
                    return true;
                }
            }
        }
    }
    false
}

/// Query on-demand if a Gradle daemon is currently running using `./gradlew --status`.
pub fn gradle_daemon_running(exec: &dyn Exec, root: &Path) -> io::Result<bool> {
    let gradlew = resolve_gradlew(root);
    let output = exec.run(root, &gradlew, &["--status"], &[], None)?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    Ok(parse_gradle_status(&stdout))
}

/// Stop running Gradle daemons using `./gradlew --stop`.
pub fn gradle_stop(exec: &dyn Exec, root: &Path) -> io::Result<()> {
    let gradlew = resolve_gradlew(root);
    let output = exec.run(root, &gradlew, &["--stop"], &[], None)?;
    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        return Err(io::Error::new(
            io::ErrorKind::Other,
            format!("gradle --stop failed: {}", err.trim()),
        ));
    }
    Ok(())
}

/// Install native Android APK via `./gradlew <module>:install<Variant>`
/// streaming output and build errors as `RunEvent`s.
pub fn install(
    spawn: &dyn Spawn,
    root: &Path,
    module: &str,
    variant: &str,
    tx: Sender<RunEvent>,
) -> io::Result<()> {
    if !is_valid_gradle_module(module) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("invalid Gradle module: {}", module),
        ));
    }
    if !is_valid_gradle_variant(variant) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("invalid Gradle variant: {}", variant),
        ));
    }

    // Capitalize first letter of variant (e.g. debug -> Debug)
    let mut cap_variant = String::with_capacity(variant.len());
    let mut chars = variant.chars();
    if let Some(first) = chars.next() {
        cap_variant.extend(first.to_uppercase());
        cap_variant.extend(chars);
    }

    let task_name = format!("{}:install{}", module.trim_end_matches(':'), cap_variant);
    let gradlew = resolve_gradlew(root);

    let _ = tx.send(RunEvent::State {
        state: AppState::Installing,
    });

    let (proc_tx, proc_rx) = std::sync::mpsc::channel();
    let mut _proc = spawn.spawn(root, &gradlew, &[&task_name], &[], proc_tx)?;

    let mut exit_code = None;
    while let Ok(line) = proc_rx.recv() {
        match line {
            ProcLine::Stdout(text) => {
                if let Some(err) = parse_build_error(&text) {
                    let _ = tx.send(RunEvent::BuildError {
                        file: err.file,
                        line: err.line,
                        col: err.col,
                        message: err.message,
                    });
                }
                let _ = tx.send(RunEvent::Output {
                    stream: OutputStream::Stdout,
                    line: text,
                });
            }
            ProcLine::Stderr(text) => {
                if let Some(err) = parse_build_error(&text) {
                    let _ = tx.send(RunEvent::BuildError {
                        file: err.file,
                        line: err.line,
                        col: err.col,
                        message: err.message,
                    });
                }
                let _ = tx.send(RunEvent::Output {
                    stream: OutputStream::Stderr,
                    line: text,
                });
            }
            ProcLine::Exit(code) => {
                exit_code = code;
                let _ = tx.send(RunEvent::Stopped { code });
                break;
            }
        }
    }

    match exit_code {
        Some(0) => Ok(()),
        Some(code) => Err(io::Error::new(
            io::ErrorKind::Other,
            format!("gradle install failed with exit code {}", code),
        )),
        None => Err(io::Error::new(
            io::ErrorKind::Interrupted,
            "gradle install process terminated without exit code",
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::process::ExitStatusExt;
    use std::process::{ExitStatus, Output};
    use std::sync::Mutex;
    use tempfile::tempdir;

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
    fn test_validations() {
        assert!(is_valid_app_id("id.petak.sample"));
        assert!(is_valid_app_id("com.example_app.sub"));
        assert!(!is_valid_app_id("id; rm -rf /"));
        assert!(!is_valid_app_id(""));

        assert!(is_valid_gradle_module(":app"));
        assert!(is_valid_gradle_module(":features:login"));
        assert!(!is_valid_gradle_module("app"));
        assert!(!is_valid_gradle_module(":app; rm"));

        assert!(is_valid_gradle_variant("debug"));
        assert!(is_valid_gradle_variant("Release"));
        assert!(is_valid_gradle_variant("freeDebug"));
        assert!(!is_valid_gradle_variant("debug-flavor"));
        assert!(!is_valid_gradle_variant("debug;"));
    }

    #[test]
    fn test_pidof_parsing() {
        let fake = FakeExec {
            output: Mutex::new(Some(Output {
                status: ExitStatus::from_raw(0),
                stdout: b"12345\n".to_vec(),
                stderr: Vec::new(),
            })),
            recorded_args: Mutex::new(Vec::new()),
        };

        let pid = pidof(&fake, "emulator-5554", "id.petak.sample").unwrap();
        assert_eq!(pid, Some(12345));

        let calls = fake.recorded_args.lock().unwrap();
        assert_eq!(calls.len(), 1);
        assert!(calls[0].contains(&"emulator-5554".to_string()));
        assert!(calls[0].contains(&"id.petak.sample".to_string()));
    }

    #[test]
    fn test_pidof_not_running() {
        let fake = FakeExec {
            output: Mutex::new(Some(Output {
                status: ExitStatus::from_raw(1 << 8), // exit 1
                stdout: Vec::new(),
                stderr: Vec::new(),
            })),
            recorded_args: Mutex::new(Vec::new()),
        };

        let pid = pidof(&fake, "emulator-5554", "id.petak.sample").unwrap();
        assert_eq!(pid, None);
    }

    #[test]
    fn test_find_application_id_and_launcher_activity() {
        let dir = tempdir().unwrap();
        let root = dir.path();

        let app_dir = root.join("app");
        fs::create_dir_all(&app_dir).unwrap();

        let build_gradle = app_dir.join("build.gradle.kts");
        fs::write(
            &build_gradle,
            r#"
            android {
                namespace = "id.petak.petak_native_sample"
                defaultConfig {
                    applicationId = "id.petak.petak_native_sample"
                }
            }
            "#,
        )
        .unwrap();

        let manifest_dir = app_dir.join("src/main");
        fs::create_dir_all(&manifest_dir).unwrap();
        let manifest = manifest_dir.join("AndroidManifest.xml");
        fs::write(
            &manifest,
            r#"
            <manifest xmlns:android="http://schemas.android.com/apk/res/android">
                <application>
                    <activity android:name=".MainActivity" android:exported="true">
                        <intent-filter>
                            <action android:name="android.intent.action.MAIN" />
                            <category android:name="android.intent.category.LAUNCHER" />
                        </intent-filter>
                    </activity>
                </application>
            </manifest>
            "#,
        )
        .unwrap();

        assert_eq!(
            find_application_id(root),
            Some("id.petak.petak_native_sample".to_string())
        );
        assert_eq!(
            find_launcher_activity(root),
            Some(".MainActivity".to_string())
        );

        // Test launch with fallback
        let fake = FakeExec {
            output: Mutex::new(Some(Output {
                status: ExitStatus::from_raw(0),
                stdout: b"Starting: Intent { cmp=id.petak.petak_native_sample/.MainActivity }\n"
                    .to_vec(),
                stderr: Vec::new(),
            })),
            recorded_args: Mutex::new(Vec::new()),
        };

        launch(&fake, "emulator-5554", None, None, Some(root)).unwrap();
        let calls = fake.recorded_args.lock().unwrap();
        assert_eq!(calls.len(), 1);
        assert!(calls[0].contains(&"id.petak.petak_native_sample/.MainActivity".to_string()));
    }

    #[test]
    fn test_parse_gradle_status() {
        let status_running = r#"
   PID STATUS   INFO
 12345 IDLE     8.12
 12346 BUSY     8.12
        "#;
        assert!(parse_gradle_status(status_running));

        let status_none = "No Gradle daemons are running";
        assert!(!parse_gradle_status(status_none));
    }
}
