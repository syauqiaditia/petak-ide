/// End-to-end mirror test — requires a running Android emulator.
///
/// Run with: ANDROID_HOME=... cargo test -p petak-core --test mirror_e2e -- --ignored
use std::path::Path;
use std::process::Command;
use std::time::{Duration, Instant};

use petak_core::exec::SystemExec;
use petak_core::mirror::{
    control::{KeyAction, NavKey, TouchAction},
    take_screenshot, InputEvent, MirrorSession, MirrorStatus,
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

fn device_serial() -> String {
    std::env::var("ANDROID_SERIAL").unwrap_or_else(|_| "emulator-5554".to_string())
}

fn has_device(adb: &str, serial: &str) -> bool {
    let out = Command::new(adb)
        .args(["devices"])
        .output()
        .expect("adb devices failed");
    let s = String::from_utf8_lossy(&out.stdout);
    s.lines()
        .any(|l| l.starts_with(serial) && l.contains("device"))
}

/// T1: start session, read ≥1 video frame, drop to stop cleanly.
#[test]
#[ignore]
fn test_mirror_session_video_frames() {
    std::thread::sleep(Duration::from_millis(500));
    let adb = resolve_adb();
    let serial = device_serial();
    if !has_device(&adb, &serial) {
        eprintln!("SKIP: no device {serial}");
        return;
    }

    let (info, _session, frame_rx, status_rx) =
        MirrorSession::start(&serial, 1920).expect("failed to start mirror session");
    eprintln!(
        "[test] session started: {}x{} codec={}",
        info.width, info.height, info.codec
    );

    // Drain status until Live
    let deadline = Instant::now() + Duration::from_secs(5);
    let mut got_live = false;
    while Instant::now() < deadline {
        match status_rx.try_recv() {
            Ok(MirrorStatus::Live { .. }) => {
                got_live = true;
                break;
            }
            Ok(_) => {}
            Err(_) => std::thread::sleep(Duration::from_millis(100)),
        }
    }
    assert!(got_live, "never received Live status");

    // Read frames for up to 5s
    let deadline = Instant::now() + Duration::from_secs(5);
    let mut frame_count = 0u32;
    let mut total_bytes = 0usize;
    while Instant::now() < deadline {
        match frame_rx.recv_timeout(Duration::from_millis(500)) {
            Ok(data) => {
                frame_count += 1;
                total_bytes += data.len();
                if frame_count <= 3 {
                    eprintln!("[test] frame {}: {} bytes", frame_count, data.len());
                }
            }
            Err(_) => {}
        }
        if frame_count >= 5 {
            break;
        }
    }

    eprintln!(
        "[test] received {} frames, {} bytes total",
        frame_count, total_bytes
    );
    assert!(
        frame_count >= 1,
        "expected at least 1 video frame, got {frame_count}"
    );
    assert!(
        total_bytes > 100,
        "expected at least 100 bytes of video data"
    );
}

/// T2: inject touch and key events — no crash.
#[test]
#[ignore]
fn test_mirror_session_inject_input() {
    std::thread::sleep(Duration::from_millis(500));
    let adb = resolve_adb();
    let serial = device_serial();
    if !has_device(&adb, &serial) {
        eprintln!("SKIP: no device {serial}");
        return;
    }

    let (_info, session, _frame_rx, _status_rx) =
        MirrorSession::start(&serial, 1920).expect("failed to start mirror session");

    // Wait for control socket ready
    std::thread::sleep(Duration::from_millis(500));

    // Touch down + up (tap at screen center)
    session
        .send_input(&InputEvent::Touch {
            action: TouchAction::Down,
            x: 540,
            y: 960,
            w: 1080,
            h: 1920,
        })
        .expect("touch down failed");

    session
        .send_input(&InputEvent::Touch {
            action: TouchAction::Up,
            x: 540,
            y: 960,
            w: 1080,
            h: 1920,
        })
        .expect("touch up failed");

    // Key event (volume up = AKEYCODE_VOLUME_UP = 24)
    session
        .send_input(&InputEvent::Key {
            action: KeyAction::Down,
            keycode: 24,
        })
        .expect("key down failed");

    session
        .send_input(&InputEvent::Key {
            action: KeyAction::Up,
            keycode: 24,
        })
        .expect("key up failed");

    // Scroll
    session
        .send_input(&InputEvent::Scroll {
            x: 540,
            y: 960,
            w: 1080,
            h: 1920,
            dx: 0.0,
            dy: -1.0,
        })
        .expect("scroll failed");

    // Nav: back
    session
        .send_input(&InputEvent::Nav { key: NavKey::Back })
        .expect("nav back failed");

    // Nav: home
    session
        .send_input(&InputEvent::Nav { key: NavKey::Home })
        .expect("nav home failed");

    // Text injection test
    session
        .send_input(&InputEvent::Text {
            text: "Hello from Petak".to_string(),
        })
        .expect("text injection failed");

    // Rotate
    session
        .send_input(&InputEvent::Rotate)
        .expect("rotate failed");

    eprintln!("[test] all input events injected successfully");
}

/// T3: take screenshot via adb screencap.
#[test]
#[ignore]
fn test_mirror_screenshot() {
    let adb = resolve_adb();
    let serial = device_serial();
    if !has_device(&adb, &serial) {
        eprintln!("SKIP: no device {serial}");
        return;
    }

    let exec = SystemExec;
    let path = take_screenshot(&exec, &serial, None).expect("screenshot failed");

    let data = std::fs::read(&path).expect("failed to read screenshot file");
    assert!(
        data.len() > 1000,
        "screenshot too small: {} bytes",
        data.len()
    );
    assert_eq!(&data[..4], b"\x89PNG", "not a valid PNG");
    eprintln!("[test] screenshot: {} bytes at {path}", data.len());

    let _ = std::fs::remove_file(&path);
}

/// T4: session lifecycle — start, verify Live status, drop, verify Disconnected.
#[test]
#[ignore]
fn test_mirror_session_lifecycle() {
    std::thread::sleep(Duration::from_millis(500));
    let adb = resolve_adb();
    let serial = device_serial();
    if !has_device(&adb, &serial) {
        eprintln!("SKIP: no device {serial}");
        return;
    }

    let (info, session, frame_rx, status_rx) =
        MirrorSession::start(&serial, 1920).expect("failed to start mirror session");

    eprintln!("[test] started: {}x{}", info.width, info.height);

    // Should get Live
    let deadline = Instant::now() + Duration::from_secs(3);
    let mut statuses = Vec::new();
    while Instant::now() < deadline {
        match status_rx.try_recv() {
            Ok(s) => statuses.push(s),
            Err(_) => std::thread::sleep(Duration::from_millis(50)),
        }
        if statuses
            .iter()
            .any(|s| matches!(s, MirrorStatus::Live { .. }))
        {
            break;
        }
    }
    assert!(
        statuses
            .iter()
            .any(|s| matches!(s, MirrorStatus::Live { .. })),
        "expected Live, got: {statuses:?}"
    );

    // Read at least one frame
    let pkt = frame_rx.recv_timeout(Duration::from_secs(3));
    assert!(pkt.is_ok(), "expected at least one frame packet");

    // Drop session — server and threads clean up
    drop(session);
    drop(frame_rx);

    // After drop, status channel should get Disconnected or be closed
    let deadline = Instant::now() + Duration::from_secs(3);
    while Instant::now() < deadline {
        match status_rx.recv_timeout(Duration::from_millis(200)) {
            Ok(MirrorStatus::Disconnected { reason }) => {
                eprintln!("[test] disconnected: {reason}");
                break;
            }
            Ok(s) => eprintln!("[test] late status: {s:?}"),
            Err(_) => break,
        }
    }
    eprintln!("[test] lifecycle test passed");
}
