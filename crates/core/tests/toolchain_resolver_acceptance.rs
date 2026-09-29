use petak_core::lsp::{Clock, Lang, Registry, ServerEvent};
use petak_core::toolchain::{
    compute_effective_path_with, probe_shell_path, resolve_dart_in_path, ToolchainConfig,
};
use std::sync::{mpsc, Arc};
use std::time::{Duration, Instant};

struct TestClock(Instant);
impl Clock for TestClock {
    fn now(&self) -> Instant {
        self.0
    }
}

#[test]
fn test_resolver_fake_home_sdk_and_fvmrc_and_override() {
    let tmp_home = tempfile::tempdir().unwrap();
    let tmp_proj = tempfile::tempdir().unwrap();

    // 1. Fake SDK in ~/SDK/flutter_3.35.7
    let sdk_flutter_bin = tmp_home
        .path()
        .join("SDK")
        .join("flutter_3.35.7")
        .join("bin");
    let sdk_dart_bin = sdk_flutter_bin
        .join("cache")
        .join("dart-sdk")
        .join("bin");
    std::fs::create_dir_all(&sdk_dart_bin).unwrap();
    std::fs::write(sdk_flutter_bin.join("flutter"), "#!/bin/sh\n").unwrap();
    std::fs::write(sdk_dart_bin.join("dart"), "#!/bin/sh\n").unwrap();

    // 2. Project with .fvmrc pointing to 3.30.0
    std::fs::write(
        tmp_proj.path().join(".fvmrc"),
        r#"{"flutter": "3.30.0"}"#,
    )
    .unwrap();
    let fvm_ver_bin = tmp_home
        .path()
        .join("fvm")
        .join("versions")
        .join("3.30.0")
        .join("bin");
    let fvm_dart_bin = fvm_ver_bin.join("cache").join("dart-sdk").join("bin");
    std::fs::create_dir_all(&fvm_dart_bin).unwrap();
    std::fs::write(fvm_ver_bin.join("flutter"), "#!/bin/sh\n").unwrap();
    std::fs::write(fvm_dart_bin.join("dart"), "#!/bin/sh\n").unwrap();

    // Without override: project FVM (3.30.0) should take precedence over global SDK (3.35.7)
    let path = compute_effective_path_with(
        Some(tmp_home.path()),
        Some(tmp_proj.path()),
        Duration::from_millis(50),
        None,
    );
    let fvm_idx = path.find(&fvm_ver_bin.to_string_lossy().to_string()).unwrap();
    let sdk_idx = path
        .find(&sdk_flutter_bin.to_string_lossy().to_string())
        .unwrap();
    assert!(fvm_idx < sdk_idx, "Project FVM must precede global SDK");

    // With config override: override wins above all
    let custom_dir = tempfile::tempdir().unwrap();
    let custom_bin = custom_dir.path().join("bin");
    std::fs::create_dir_all(&custom_bin).unwrap();
    let cfg = ToolchainConfig {
        flutter_sdk: Some(custom_dir.path().to_string_lossy().to_string()),
        android_sdk: None,
        kotlin_language_server: None,
    };
    let path_with_override = compute_effective_path_with(
        Some(tmp_home.path()),
        Some(tmp_proj.path()),
        Duration::from_millis(50),
        Some(&cfg),
    );
    assert!(path_with_override.starts_with(&custom_bin.to_string_lossy().to_string()));
}

#[test]
fn test_shell_probe_timeout_does_not_hang() {
    let start = Instant::now();
    let _ = probe_shell_path(Duration::from_millis(150));
    assert!(
        start.elapsed() < Duration::from_secs(2),
        "Shell probe must obey timeout and not hang"
    );
}

#[test]
fn test_env_minimal_path_lsp_dart_finds_dart() {
    // When PATH is minimal (e.g. /usr/bin:/bin as launched by Finder/open),
    // effective_path() or candidate paths must find Dart.
    let _path_minimal = "/usr/bin:/bin";
    let tmp_home = tempfile::tempdir().unwrap();
    let sdk_flutter_bin = tmp_home
        .path()
        .join("SDK")
        .join("flutter_3.35.7")
        .join("bin");
    let sdk_dart_bin = sdk_flutter_bin
        .join("cache")
        .join("dart-sdk")
        .join("bin");
    std::fs::create_dir_all(&sdk_dart_bin).unwrap();
    std::fs::write(sdk_dart_bin.join("dart"), "#!/bin/sh\n").unwrap();

    let effective = compute_effective_path_with(
        Some(tmp_home.path()),
        None,
        Duration::from_millis(50),
        None,
    );

    // Verify Dart is found in effective PATH
    let dart = resolve_dart_in_path(&effective, None, &ToolchainConfig::default());
    assert!(
        dart.is_some(),
        "Dart must be resolved even when process PATH is minimal"
    );
    assert_eq!(dart.unwrap(), sdk_dart_bin.join("dart"));
}

#[test]
fn test_dart_missing_fails_cleanly_with_failed_status_and_reason() {
    // Override command to a non-existent binary to simulate missing Dart
    std::env::set_var("PETAK_LSP_DART", "__nonexistent_dart_binary_404__");

    let clock = Arc::new(TestClock(Instant::now()));
    let (tx, rx) = mpsc::channel();
    let registry = Registry::new(clock, move |lang, root, event| {
        let _ = tx.send((lang, root, event));
    });

    let tmp = tempfile::tempdir().unwrap();
    let main_dart = tmp.path().join("main.dart");
    std::fs::write(&main_dart, "void main() {}").unwrap();

    let result = registry.did_open(&main_dart, Lang::Dart, "void main() {}", Some(tmp.path()));
    assert!(result.is_err(), "did_open must fail when dart is missing");

    // Collect emitted events
    let mut saw_failed = false;
    let mut failure_reason = String::new();

    while let Ok((lang, _root, event)) = rx.recv_timeout(Duration::from_millis(500)) {
        if lang == Lang::Dart {
            if let ServerEvent::Status { state, reason } = event {
                if state == "failed" {
                    saw_failed = true;
                    if let Some(r) = reason {
                        failure_reason = r;
                    }
                }
            }
        }
    }

    assert!(
        saw_failed,
        "Registry must emit state='failed' when server fails to start"
    );
    assert!(
        failure_reason.contains("not found") || failure_reason.contains("Settings"),
        "Failure reason must be informative: '{}'",
        failure_reason
    );

    // Clean up env override
    std::env::remove_var("PETAK_LSP_DART");
}
