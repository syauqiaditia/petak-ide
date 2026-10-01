
use std::time::{Duration, Instant};
use std::sync::{Arc, Mutex};
use petak_core::mirror::control::{InputEvent, TouchAction};
use petak_core::mirror::session::MirrorSession;

#[test]
#[ignore]
fn benchmark_profile() {
    let serial = "emulator-5554";
    // Test max_size=960
    let (info, session, frame_rx, _status_rx) =
        MirrorSession::start(serial, 960).expect("failed to start mirror session");

    std::thread::sleep(Duration::from_millis(400));
    let session_arc = Arc::new(Mutex::new(session));
    let session_clone = Arc::clone(&session_arc);
    let stop_flag = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let stop_flag_thread = Arc::clone(&stop_flag);

    let input_handle = std::thread::spawn(move || {
        let mut y = 300u32;
        let mut step = 50i32;
        while !stop_flag_thread.load(std::sync::atomic::Ordering::Relaxed) {
            if let Ok(sess) = session_clone.lock() {
                let _ = sess.send_input(&InputEvent::Touch {
                    action: TouchAction::Down,
                    x: 200,
                    y,
                    w: info.width as u16,
                    h: info.height as u16,
                });
            }
            for _ in 0..10 {
                y = (y as i32 + step).clamp(100, info.height as i32 - 100) as u32;
                if let Ok(sess) = session_clone.lock() {
                    let _ = sess.send_input(&InputEvent::Touch {
                        action: TouchAction::Move,
                        x: 200,
                        y,
                        w: info.width as u16,
                        h: info.height as u16,
                    });
                }
                std::thread::sleep(Duration::from_millis(16));
            }
            if let Ok(sess) = session_clone.lock() {
                let _ = sess.send_input(&InputEvent::Touch {
                    action: TouchAction::Up,
                    x: 200,
                    y,
                    w: info.width as u16,
                    h: info.height as u16,
                });
            }
            step = -step;
            std::thread::sleep(Duration::from_millis(20));
        }
    });

    let mut frame_count = 0usize;
    let mut total_bytes = 0usize;
    let start = Instant::now();
    let bench_duration = Duration::from_secs(5);

    while Instant::now().duration_since(start) < bench_duration {
        if let Ok(pkt) = frame_rx.recv_timeout(Duration::from_millis(100)) {
            frame_count += 1;
            total_bytes += pkt.len();
        }
    }

    let elapsed = start.elapsed().as_secs_f64();
    let fps = frame_count as f64 / elapsed;

    stop_flag.store(true, std::sync::atomic::Ordering::Relaxed);
    let _ = input_handle.join();

    eprintln!("==================================================");
    eprintln!("EMULATOR ACTIVE BENCHMARK RESULT (max_size=960):");
    eprintln!("  Resolution: {}x{}", info.width, info.height);
    eprintln!("  Total Frames: {}", frame_count);
    eprintln!("  Elapsed: {:.2}s", elapsed);
    eprintln!("  FPS: {:.1} FPS", fps);
    eprintln!("  Bitrate: {:.1} KB/s", (total_bytes as f64 / 1024.0) / elapsed);
    eprintln!("==================================================");
}
