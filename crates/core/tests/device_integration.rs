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
