use std::path::Path;
use std::process::Command;
use std::sync::mpsc;
use std::time::{Duration, Instant};

use petak_core::exec::SystemSpawn;
use petak_core::run::{start_emulator, watch_devices, DeviceState};

#[test]
#[ignore]
fn test_device_watch_real_emulator() {
    println!("\n=== Starting test_device_watch_real_emulator ===");

    // 1. Start watch_devices
    let (tx, rx) = mpsc::channel();
    let mut watcher = watch_devices(&SystemSpawn, tx).expect("Failed to start watch_devices");
    println!("1. watch_devices started successfully");

    // 2. Start jatim_dev headless
    println!("2. Starting emulator 'jatim_dev' headless...");
    let start_time = Instant::now();
    let mut emu = start_emulator(&SystemSpawn, "jatim_dev", true).expect("Failed to start emulator");
    println!("   Emulator process spawned with pid: {:?}", emu.pid());

    // 3. Wait for online emulator event
    println!("3. Waiting for emulator online event from watch_devices...");
    let mut target_device_id = None;
    let deadline = Instant::now() + Duration::from_secs(90);

    while Instant::now() < deadline {
        match rx.recv_timeout(Duration::from_millis(500)) {
            Ok(devices) => {
                println!("   Received devices event: {:?}", devices);
                if let Some(dev) = devices.iter().find(|d| d.id.starts_with("emulator-") && d.state == DeviceState::Online) {
                    println!("   Found online emulator: id={}, name={}, state={:?}", dev.id, dev.name, dev.state);
                    target_device_id = Some(dev.id.clone());
                    break;
                }
            }
            Err(mpsc::RecvTimeoutError::Timeout) => continue,
            Err(mpsc::RecvTimeoutError::Disconnected) => panic!("watch_devices channel disconnected unexpectedly"),
        }
    }

    let dev_id = target_device_id.expect("Timed out waiting for emulator to become online");
    println!("   Emulator became online in {:.2}s: {}", start_time.elapsed().as_secs_f32(), dev_id);

    // 4. Kill the emulator via adb emu kill
    println!("4. Killing emulator {} via 'adb -s {} emu kill'...", dev_id, dev_id);
    let adb_path = if let Ok(home) = std::env::var("ANDROID_HOME") {
        let p = Path::new(&home).join("platform-tools").join("adb");
        if p.exists() {
            p.to_string_lossy().to_string()
        } else {
            "adb".to_string()
        }
    } else {
        "adb".to_string()
    };

    let kill_status = Command::new(&adb_path)
        .args(["-s", &dev_id, "emu", "kill"])
        .status()
        .expect("Failed to run adb emu kill");
    println!("   adb emu kill exit status: {:?}", kill_status);

    // 5. Wait for emulator disappeared event
    println!("5. Waiting for emulator disappeared event from watch_devices...");
    let kill_deadline = Instant::now() + Duration::from_secs(30);
    let mut emulator_gone = false;

    while Instant::now() < kill_deadline {
        match rx.recv_timeout(Duration::from_millis(500)) {
            Ok(devices) => {
                println!("   Received devices event after kill: {:?}", devices);
                let still_online = devices.iter().any(|d| d.id == dev_id && d.state == DeviceState::Online);
                if !still_online {
                    println!("   Emulator {} is no longer online (devices: {:?})", dev_id, devices);
                    emulator_gone = true;
                    break;
                }
            }
            Err(mpsc::RecvTimeoutError::Timeout) => continue,
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }

    // Clean up
    let _ = emu.kill();
    let _ = watcher.kill();

    assert!(emulator_gone, "Emulator {} did not disappear after adb emu kill", dev_id);
    println!("=== test_device_watch_real_emulator PASSED ===");
}

#[test]
#[ignore]
fn test_spawn_emulator_detached_real_server() {
    println!("\n=== Starting test_spawn_emulator_detached_real_server ===");

    let log_path = petak_core::run::emulator_log_path().expect("emulator_log_path exists");
    println!("Emulator log path: {:?}", log_path);

    println!("Spawning detached headless emulator 'jatim_dev'...");
    let start_time = Instant::now();
    let mut child = petak_core::run::spawn_emulator_detached("jatim_dev", false, false, true)
        .expect("spawn_emulator_detached failed");

    let pid = child.id();
    println!("Detached emulator spawned successfully with PID: {:?}", pid);
    assert!(pid > 0);

    // Verify log file was written
    assert!(log_path.exists(), "emulator.log must exist");
    let initial_log = std::fs::read_to_string(&log_path).unwrap_or_default();
    assert!(initial_log.contains("spawn_emulator_detached"));

    // Poll adb devices for up to 90s
    let adb = petak_core::run::resolve_adb_binary();
    let mut found_serial = None;
    let deadline = Instant::now() + Duration::from_secs(90);

    while Instant::now() < deadline {
        if let Ok(out) = Command::new(&adb).args(["devices"]).output() {
            let stdout = String::from_utf8_lossy(&out.stdout);
            for line in stdout.lines() {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() >= 2 && parts[0].starts_with("emulator-") && parts[1] == "device" {
                    println!("Found running emulator in adb: {}", parts[0]);
                    found_serial = Some(parts[0].to_string());
                    break;
                }
            }
        }
        if found_serial.is_some() {
            break;
        }
        std::thread::sleep(Duration::from_millis(1000));
    }

    let serial = found_serial.expect("Timed out waiting for emulator to appear in adb devices");
    println!("Emulator appeared in adb in {:.2}s: {}", start_time.elapsed().as_secs_f32(), serial);

    // Stop emulator cleanly
    println!("Stopping emulator {}...", serial);
    let _ = Command::new(&adb).args(["-s", &serial, "emu", "kill"]).status();
    let _ = child.kill();
    std::thread::sleep(Duration::from_secs(3));

    println!("=== test_spawn_emulator_detached_real_server PASSED ===");
}
