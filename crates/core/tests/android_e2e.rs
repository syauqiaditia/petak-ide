use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::mpsc;
use std::time::{Duration, Instant};

use petak_core::exec::{Proc, SystemExec, SystemSpawn};
use petak_core::run::{
    gradle_stop, install, launch, pidof, start_emulator, watch_devices, AppState, DeviceState,
    FlutterRun, Logcat, RunConfig, RunEvent, RunKind,
};

fn resolve_adb() -> String {
    if let Ok(home) = std::env::var("ANDROID_HOME") {
        let p = Path::new(&home).join("platform-tools").join("adb");
        if p.exists() {
            return p.to_string_lossy().to_string();
        }
    }
    "adb".to_string()
}

fn wait_for_boot_complete(adb: &str, device_id: &str, timeout: Duration) -> bool {
    let start = Instant::now();
    let mut last_print = Instant::now();
    while start.elapsed() < timeout {
        let output = Command::new(adb)
            .args(["-s", device_id, "shell", "getprop", "sys.boot_completed"])
            .output();
        if let Ok(out) = output {
            let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if s == "1" {
                return true;
            }
        }
        if last_print.elapsed() >= Duration::from_secs(5) {
            println!(
                "   ... waiting for sys.boot_completed ({:.1}s elapsed)",
                start.elapsed().as_secs_f32()
            );
            last_print = Instant::now();
        }
        std::thread::sleep(Duration::from_millis(1000));
    }
    false
}

struct CleanupGuard {
    adb: String,
    device_id: Option<String>,
    emu: Option<Box<dyn Proc>>,
    watcher: Option<Box<dyn Proc>>,
    native_root: PathBuf,
    flutter_android_root: PathBuf,
}

impl Drop for CleanupGuard {
    fn drop(&mut self) {
        println!("--- Running cleanup guard for android_e2e ---");
        let _ = gradle_stop(&SystemExec, &self.native_root);
        let _ = gradle_stop(&SystemExec, &self.flutter_android_root);

        if let Some(ref dev_id) = self.device_id {
            println!("Stopping emulator {} via 'adb -s {} emu kill'...", dev_id, dev_id);
            let _ = Command::new(&self.adb)
                .args(["-s", dev_id, "emu", "kill"])
                .status();
        }
        if let Some(mut emu) = self.emu.take() {
            let _ = emu.kill();
        }
        if let Some(mut watcher) = self.watcher.take() {
            let _ = watcher.kill();
        }
        std::thread::sleep(Duration::from_secs(3));
    }
}

#[test]
#[ignore]
fn test_android_and_flutter_logcat_e2e_real_emulator() {
    println!("\n=== Starting test_android_and_flutter_logcat_e2e_real_emulator ===");

    let root_native = PathBuf::from("/mnt/storage/uqi-cache/petak-samples/petak_native_sample");
    assert!(
        root_native.exists(),
        "Native sample does not exist at /mnt/storage/uqi-cache/petak-samples/petak_native_sample"
    );

    let root_flutter = PathBuf::from("/mnt/storage/uqi-cache/petak-samples/petak_flutter_sample");
    assert!(
        root_flutter.exists(),
        "Flutter sample does not exist at /mnt/storage/uqi-cache/petak-samples/petak_flutter_sample"
    );

    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let repo_root = manifest_dir.parent().unwrap().parent().unwrap();
    let screens_dir = repo_root.join("docs/phase4/screens");
    fs::create_dir_all(&screens_dir).expect("Failed to create docs/phase4/screens directory");

    let adb = resolve_adb();

    let mut guard = CleanupGuard {
        adb: adb.clone(),
        device_id: None,
        emu: None,
        watcher: None,
        native_root: root_native.clone(),
        flutter_android_root: root_flutter.join("android"),
    };

    // 1. Start device watcher
    let (watch_tx, watch_rx) = mpsc::channel();
    let watcher = watch_devices(&SystemSpawn, watch_tx).expect("Failed to start watch_devices");
    guard.watcher = Some(watcher);
    println!("1. watch_devices started successfully");

    // 2. Start emulator 'jatim_dev' headless
    println!("2. Starting emulator 'jatim_dev' headless...");
    let emu_start_time = Instant::now();
    let emu = start_emulator(&SystemSpawn, "jatim_dev", true).expect("Failed to start emulator");
    guard.emu = Some(emu);
    println!("   Emulator process spawned!");

    // 3. Wait for emulator to come online
    println!("3. Waiting for emulator online event from watch_devices...");
    let deadline = Instant::now() + Duration::from_secs(90);
    let mut device_id = None;

    while Instant::now() < deadline {
        match watch_rx.recv_timeout(Duration::from_millis(500)) {
            Ok(devices) => {
                if let Some(dev) = devices
                    .iter()
                    .find(|d| d.id.starts_with("emulator-") && d.state == DeviceState::Online)
                {
                    println!(
                        "   Found online emulator: id={}, state={:?}",
                        dev.id, dev.state
                    );
                    device_id = Some(dev.id.clone());
                    break;
                }
            }
            Err(mpsc::RecvTimeoutError::Timeout) => continue,
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                panic!("watch_devices channel disconnected unexpectedly")
            }
        }
    }

    let dev_id = device_id.expect("Timed out waiting for emulator to become online");
    guard.device_id = Some(dev_id.clone());
    println!(
        "   Emulator became online in {:.2}s: {}",
        emu_start_time.elapsed().as_secs_f32(),
        dev_id
    );

    // Wait for boot completed
    println!("   Waiting for sys.boot_completed=1 on {}...", dev_id);
    assert!(
        wait_for_boot_complete(&adb, &dev_id, Duration::from_secs(180)),
        "Emulator did not finish boot within 180s"
    );
    println!("   Emulator boot completed!");

    // ========================================================
    // PART 1: Android Native Sample (Gradle install + launch + pidof + logcat)
    // ========================================================
    println!("\n--- PART 1: Android Native Sample ---");
    println!("4. Installing native sample via gradle install...");
    let (install_tx, install_rx) = mpsc::channel();
    let install_thread = {
        let root = root_native.clone();
        std::thread::spawn(move || {
            install(&SystemSpawn, &root, ":app", "Debug", install_tx)
        })
    };

    while let Ok(ev) = install_rx.recv_timeout(Duration::from_millis(200)) {
        match ev {
            RunEvent::State { state } => println!("   [Install State] {:?}", state),
            RunEvent::Output { stream, line } => {
                if line.contains("Task :app:") || line.contains("BUILD SUCCESSFUL") {
                    println!("   [Install {:?}] {}", stream, line);
                }
            }
            RunEvent::BuildError { file, line, message, .. } => {
                eprintln!("   [Install Error] {}:{} - {}", file, line, message);
            }
            RunEvent::Stopped { code } => {
                println!("   [Install Stopped] exit code: {:?}", code);
                break;
            }
            _ => {}
        }
    }
    install_thread.join().unwrap().expect("Native gradle install failed");
    println!("   Native APK installed successfully!");

    println!("5. Launching native sample activity...");
    launch(
        &SystemExec,
        &dev_id,
        Some("id.petak.petak_native_sample"),
        Some(".MainActivity"),
        Some(&root_native),
    )
    .expect("Failed to launch native activity");
    println!("   Native activity launch command sent!");

    // Poll for PID of id.petak.petak_native_sample
    println!("6. Querying native PID via pidof...");
    let pid_deadline = Instant::now() + Duration::from_secs(15);
    let mut native_pid = None;
    while Instant::now() < pid_deadline {
        if let Ok(Some(pid)) = pidof(&SystemExec, &dev_id, "id.petak.petak_native_sample") {
            native_pid = Some(pid);
            break;
        }
        std::thread::sleep(Duration::from_millis(500));
    }
    let n_pid = native_pid.expect("Could not find PID for id.petak.petak_native_sample");
    println!("   Native sample running with PID: {}", n_pid);

    // Start Logcat stream filtered by pid
    println!("7. Streaming logcat for native PID {}...", n_pid);
    let (native_log_tx, native_log_rx) = mpsc::channel();
    let mut native_logcat = Logcat::start(&SystemSpawn, &dev_id, Some(n_pid), native_log_tx)
        .expect("Failed to start Logcat for native sample");

    let log_deadline = Instant::now() + Duration::from_secs(20);
    let mut native_hello_found = false;
    let mut captured_native_line = String::new();

    while Instant::now() < log_deadline {
        match native_log_rx.recv_timeout(Duration::from_millis(500)) {
            Ok(batch) => {
                for line in batch {
                    if line.msg.contains("PETAK_NATIVE_HELLO") || line.tag.contains("PETAK") {
                        println!(
                            "   [Captured Native Log] ts={} pid={} tid={} [{}] tag={} msg={}",
                            line.ts, line.pid, line.tid, line.level.as_str(), line.tag, line.msg
                        );
                        captured_native_line = format!(
                            "{} {} {} {} {}: {}",
                            line.ts, line.pid, line.tid, line.level.as_str(), line.tag, line.msg
                        );
                        if line.msg.contains("PETAK_NATIVE_HELLO") {
                            native_hello_found = true;
                            break;
                        }
                    }
                }
                if native_hello_found {
                    break;
                }
            }
            Err(mpsc::RecvTimeoutError::Timeout) => continue,
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }

    assert!(
        native_hello_found,
        "Failed to capture PETAK_NATIVE_HELLO logcat output for PID {}",
        n_pid
    );
    println!("   Successfully captured PETAK_NATIVE_HELLO in logcat by PID!");

    // Settle rendering and capture screenshot
    std::thread::sleep(Duration::from_secs(2));
    let screen_native_path = screens_dir.join("e2e-03-native.png");
    println!("8. Taking native screenshot: {}...", screen_native_path.display());
    let cap_native = Command::new(&adb)
        .args(["-s", &dev_id, "exec-out", "screencap", "-p"])
        .output()
        .expect("Failed to screencap native");
    assert!(cap_native.status.success());
    fs::write(&screen_native_path, &cap_native.stdout).expect("Failed to write e2e-03-native.png");
    println!("   Screenshot saved! Size: {} bytes", cap_native.stdout.len());
    assert!(
        cap_native.stdout.len() > 10000,
        "Native screenshot is too small (corrupted)"
    );

    let _ = native_logcat.stop();

    // ========================================================
    // PART 2: Flutter Sample (FlutterRun + pidof + logcat)
    // ========================================================
    println!("\n--- PART 2: Flutter Sample ---");
    println!("9. Starting FlutterRun for flutter sample on {}...", dev_id);
    let cfg = RunConfig {
        name: "dev".to_string(),
        kind: RunKind::Flutter,
        target: Some("lib/main_dev.dart".to_string()),
        flavor: None,
        dart_defines: vec![],
        module: None,
        variant: None,
        application_id: None,
        activity: None,
    };

    let (run_tx, run_rx) = mpsc::channel();
    let mut runner = FlutterRun::start(&SystemSpawn, &root_flutter, &cfg, &dev_id, run_tx)
        .expect("Failed to start FlutterRun");

    println!("   Waiting for Flutter app to start (appStarted)...");
    let flutter_app_deadline = Instant::now() + Duration::from_secs(360);
    let mut flutter_app_started = false;
    while Instant::now() < flutter_app_deadline {
        match run_rx.recv_timeout(Duration::from_millis(500)) {
            Ok(ev) => match ev {
                RunEvent::State { state } => {
                    println!("   [Flutter State] {:?}", state);
                    if state == AppState::Running {
                        flutter_app_started = true;
                    }
                }
                RunEvent::AppStarted { ref app_id, .. } => {
                    println!("   [Flutter AppStarted] appId: {:?}", app_id);
                    flutter_app_started = true;
                }
                RunEvent::Output { stream, line } => {
                    if line.contains("Syncing files") || line.contains("PETAK_HELLO") {
                        println!("   [Flutter {:?}] {}", stream, line);
                    }
                }
                _ => {}
            },
            Err(mpsc::RecvTimeoutError::Timeout) => {
                if flutter_app_started {
                    break;
                }
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
        if flutter_app_started {
            break;
        }
    }
    assert!(flutter_app_started, "Flutter app did not start in time");

    // Settle flutter app
    std::thread::sleep(Duration::from_secs(3));

    // Query PID for id.petak.petak_flutter_sample
    println!("10. Querying flutter PID via pidof...");
    let flutter_pid_deadline = Instant::now() + Duration::from_secs(15);
    let mut flutter_pid = None;
    while Instant::now() < flutter_pid_deadline {
        if let Ok(Some(pid)) = pidof(&SystemExec, &dev_id, "id.petak.petak_flutter_sample") {
            flutter_pid = Some(pid);
            break;
        }
        std::thread::sleep(Duration::from_millis(500));
    }
    let f_pid = flutter_pid.expect("Could not find PID for id.petak.petak_flutter_sample");
    println!("   Flutter sample running with PID: {}", f_pid);

    // Start Logcat stream for flutter pid
    println!("11. Streaming logcat for flutter PID {}...", f_pid);
    let (flutter_log_tx, flutter_log_rx) = mpsc::channel();
    let mut flutter_logcat = Logcat::start(&SystemSpawn, &dev_id, Some(f_pid), flutter_log_tx)
        .expect("Failed to start Logcat for flutter sample");

    let flutter_log_deadline = Instant::now() + Duration::from_secs(20);
    let mut flutter_hello_found = false;
    let mut captured_flutter_line = String::new();

    while Instant::now() < flutter_log_deadline {
        match flutter_log_rx.recv_timeout(Duration::from_millis(500)) {
            Ok(batch) => {
                for line in batch {
                    if line.msg.contains("PETAK_HELLO") || line.tag.contains("flutter") {
                        println!(
                            "   [Captured Flutter Log] ts={} pid={} tid={} [{}] tag={} msg={}",
                            line.ts, line.pid, line.tid, line.level.as_str(), line.tag, line.msg
                        );
                        if line.msg.contains("PETAK_HELLO") {
                            captured_flutter_line = format!(
                                "{} {} {} {} {}: {}",
                                line.ts, line.pid, line.tid, line.level.as_str(), line.tag, line.msg
                            );
                            flutter_hello_found = true;
                            break;
                        }
                    }
                }
                if flutter_hello_found {
                    break;
                }
            }
            Err(mpsc::RecvTimeoutError::Timeout) => continue,
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }

    assert!(
        flutter_hello_found,
        "Failed to capture PETAK_HELLO in logcat for Flutter PID {}",
        f_pid
    );
    println!("   Successfully captured PETAK_HELLO in logcat by PID!");

    // Stop Flutter app
    println!("12. Stopping FlutterRun session...");
    let _ = runner.stop();
    let _ = flutter_logcat.stop();

    println!("\n=== Real Logcat Lines Captured ===");
    println!("Native logcat line: {}", captured_native_line);
    println!("Flutter logcat line: {}", captured_flutter_line);
    println!("=== test_android_and_flutter_logcat_e2e_real_emulator PASSED ===\n");
}
