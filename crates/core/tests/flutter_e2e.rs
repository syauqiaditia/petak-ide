use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::mpsc;
use std::time::{Duration, Instant};

use petak_core::exec::{Proc, SystemSpawn};
use petak_core::run::{
    start_emulator, watch_devices, AppState, DeviceState, FlutterRun, RunConfig, RunEvent, RunKind,
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
                "   ... still waiting for sys.boot_completed ({:.1}s elapsed)",
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
    main_dev_file: PathBuf,
}

impl Drop for CleanupGuard {
    fn drop(&mut self) {
        println!("--- Running cleanup guard ---");
        if let Some(ref dev_id) = self.device_id {
            println!(
                "Killing emulator {} via 'adb -s {} emu kill'...",
                dev_id, dev_id
            );
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
        if let Ok(content) = fs::read_to_string(&self.main_dev_file) {
            if content.contains("Petak Reloaded") {
                let reset = content.replace("Petak Reloaded", "Petak Sample");
                let _ = fs::write(&self.main_dev_file, reset);
            }
        }
        std::thread::sleep(Duration::from_secs(3));
    }
}

#[test]
#[ignore]
fn test_flutter_run_e2e_real_emulator() {
    println!("\n=== Starting test_flutter_run_e2e_real_emulator ===");

    let root_sample = PathBuf::from("/mnt/storage/uqi-cache/petak-samples/petak_flutter_sample");
    assert!(
        root_sample.exists(),
        "Sample app does not exist at /mnt/storage/uqi-cache/petak-samples/petak_flutter_sample"
    );

    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let repo_root = manifest_dir.parent().unwrap().parent().unwrap();
    let screens_dir = repo_root.join("docs/phase4/screens");
    fs::create_dir_all(&screens_dir).expect("Failed to create docs/phase4/screens directory");

    let fixture_path = manifest_dir.join("tests/fixtures/flutter_machine.txt");
    if let Some(parent) = fixture_path.parent() {
        fs::create_dir_all(parent).expect("Failed to create fixtures directory");
    }
    std::env::set_var("PETAK_RECORD_DAEMON_FILE", fixture_path.to_str().unwrap());

    let adb = resolve_adb();
    let main_dev_file = root_sample.join("lib/main_dev.dart");

    // Reset main_dev.dart to ensure initial title is 'Petak Sample'
    if let Ok(content) = fs::read_to_string(&main_dev_file) {
        if content.contains("Petak Reloaded") {
            let reset = content.replace("Petak Reloaded", "Petak Sample");
            let _ = fs::write(&main_dev_file, reset);
        }
    }

    let mut guard = CleanupGuard {
        adb: adb.clone(),
        device_id: None,
        emu: None,
        watcher: None,
        main_dev_file: main_dev_file.clone(),
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

    // 4. Start FlutterRun
    println!("4. Starting FlutterRun session on {}...", dev_id);
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
    let t_call_start = Instant::now();
    let mut runner = FlutterRun::start(&SystemSpawn, &root_sample, &cfg, &dev_id, run_tx)
        .expect("Failed to start FlutterRun");
    let spawn_duration = runner.spawn_duration();
    let call_to_spawn_ms = t_call_start.elapsed().as_millis();
    println!(
        "   FlutterRun spawned! spawn_duration: {:?}, call-to-spawn: {} ms (budget < 200 ms)",
        spawn_duration, call_to_spawn_ms
    );
    assert!(
        spawn_duration.as_millis() < 200,
        "Spawn duration {:?} exceeded 200 ms budget",
        spawn_duration
    );

    // 5. Wait for app.started and running state (allow up to 8 minutes for first build)
    println!("5. Waiting for appStarted event (build & install)...");
    let app_deadline = Instant::now() + Duration::from_secs(480);
    let mut app_started_event = None;
    let mut saw_running = false;

    while Instant::now() < app_deadline {
        match run_rx.recv_timeout(Duration::from_millis(500)) {
            Ok(ev) => match ev {
                RunEvent::State { state } => {
                    println!("   [State] {:?}", state);
                    if state == AppState::Running {
                        saw_running = true;
                    }
                }
                RunEvent::Progress {
                    message, finished, ..
                } => {
                    if !message.is_empty() {
                        println!("   [Progress] {} (finished: {})", message, finished);
                    }
                }
                RunEvent::AppStarted {
                    ref app_id,
                    ref devtools_uri,
                    ref vm_service_uri,
                    ..
                } => {
                    println!(
                        "   [AppStarted] appId: {:?}, devtoolsUri: {:?}, vmServiceUri: {:?}",
                        app_id, devtools_uri, vm_service_uri
                    );
                    app_started_event = Some(ev.clone());
                }
                RunEvent::BuildError {
                    file,
                    line,
                    col,
                    message,
                } => {
                    eprintln!("   [BuildError] {}:{}:{:?} - {}", file, line, col, message);
                }
                RunEvent::Output { stream, line } => {
                    if line.contains("PETAK_HELLO")
                        || line.contains("Syncing files")
                        || line.contains("DevTools")
                    {
                        println!("   [{:?}] {}", stream, line);
                    }
                }
                _ => {}
            },
            Err(mpsc::RecvTimeoutError::Timeout) => {
                if app_started_event.is_some() && saw_running {
                    break;
                }
                continue;
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                panic!("RunEvent channel disconnected before appStarted was received");
            }
        }
        if app_started_event.is_some() && saw_running {
            break;
        }
    }

    assert!(
        app_started_event.is_some(),
        "Timed out waiting for Flutter appStarted event"
    );
    println!("   App successfully started and running on device!");

    // Settle rendering
    std::thread::sleep(Duration::from_secs(3));

    // 6. Screenshot 1: Started
    let screen1_path = screens_dir.join("e2e-01-started.png");
    println!("6. Taking screenshot 1: {}...", screen1_path.display());
    let cap1 = Command::new(&adb)
        .args(["-s", &dev_id, "exec-out", "screencap", "-p"])
        .output()
        .expect("Failed to run screencap");
    assert!(cap1.status.success());
    fs::write(&screen1_path, &cap1.stdout).expect("Failed to write e2e-01-started.png");
    println!("   Screenshot 1 saved! Size: {} bytes", cap1.stdout.len());
    assert!(
        cap1.stdout.len() > 10000,
        "Screenshot 1 file is too small (corrupted)"
    );

    // 7. Change text in main_dev.dart: title -> 'Petak Reloaded'
    println!("7. Updating lib/main_dev.dart title to 'Petak Reloaded'...");
    let content = fs::read_to_string(&main_dev_file).expect("Failed to read main_dev.dart");
    let updated_content = content.replace(
        "home: const MyHomePage(title: 'Petak Sample'),",
        "home: const MyHomePage(title: 'Petak Reloaded'),",
    );
    assert_ne!(
        content, updated_content,
        "Replacement string not found in main_dev.dart"
    );
    fs::write(&main_dev_file, &updated_content).expect("Failed to write updated main_dev.dart");

    // 8. Hot reload (full == false)
    println!("8. Triggering hot reload (reload(false))...");
    let reload_res = runner.reload(false).expect("Hot reload failed");
    println!(
        "   Hot reload succeeded in {} ms! ok: {}, message: {:?}",
        reload_res.ms, reload_res.ok, reload_res.message
    );
    assert!(reload_res.ok, "Hot reload returned ok: false");
    assert!(
        !reload_res.full_restart,
        "Expected fullRestart == false for hot reload"
    );

    // Settle rendering
    std::thread::sleep(Duration::from_secs(3));

    // 9. Screenshot 2: Hot reload
    let screen2_path = screens_dir.join("e2e-02-hot-reload.png");
    println!("9. Taking screenshot 2: {}...", screen2_path.display());
    let cap2 = Command::new(&adb)
        .args(["-s", &dev_id, "exec-out", "screencap", "-p"])
        .output()
        .expect("Failed to run screencap");
    assert!(cap2.status.success());
    fs::write(&screen2_path, &cap2.stdout).expect("Failed to write e2e-02-hot-reload.png");
    println!("   Screenshot 2 saved! Size: {} bytes", cap2.stdout.len());
    assert!(
        cap2.stdout.len() > 10000,
        "Screenshot 2 file is too small (corrupted)"
    );

    // 10. Hot restart (full == true)
    println!("10. Triggering hot restart (reload(true))...");
    let restart_res = runner.reload(true).expect("Hot restart failed");
    println!(
        "   Hot restart succeeded in {} ms! ok: {}, message: {:?}",
        restart_res.ms, restart_res.ok, restart_res.message
    );
    assert!(restart_res.ok, "Hot restart returned ok: false");
    assert!(
        restart_res.full_restart,
        "Expected fullRestart == true for hot restart"
    );

    // 11. Stop FlutterRun
    println!("11. Stopping FlutterRun...");
    runner.stop().expect("Failed to stop FlutterRun");
    println!("   FlutterRun stopped successfully");

    println!("\n=== Real benchmark numbers ===");
    println!(
        "- Spawn duration: {:?} (call-to-spawn: {} ms)",
        spawn_duration, call_to_spawn_ms
    );
    println!("- Hot reload duration: {} ms", reload_res.ms);
    println!("- Hot restart duration: {} ms", restart_res.ms);
    println!("=== test_flutter_run_e2e_real_emulator PASSED ===\n");
}
