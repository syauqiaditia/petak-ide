/// mirror_stream — example/test tool for the mirror module.
///
/// Usage: mirror_stream <serial>
///
/// stdout: binary stream of [u32be len][packet] where packet = [u8 kind][u64be pts][payload]
/// stdin: one JSON InputEvent per line (see contract)
///
/// Exits when the video stream ends or stdin closes.
use std::io::{self, BufRead, BufReader, Write};
use std::sync::{Arc, Mutex};
use std::thread;

use petak_core::mirror::control::InputEvent;
use petak_core::mirror::session::MirrorSession;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 2 {
        eprintln!("Usage: mirror_stream <serial> [max_size]");
        std::process::exit(1);
    }

    let serial = &args[1];
    let max_size: u16 = args.get(2).and_then(|s| s.parse().ok()).unwrap_or(1920);

    eprintln!(
        "[mirror_stream] starting mirror for {} (max_size={})",
        serial, max_size
    );

    let (info, session, frame_rx, status_rx) = match MirrorSession::start(serial, max_size) {
        Ok(v) => v,
        Err(e) => {
            eprintln!("[mirror_stream] failed to start: {}", e);
            std::process::exit(1);
        }
    };

    eprintln!(
        "[mirror_stream] connected: {}x{} codec={}",
        info.width, info.height, info.codec
    );

    // Status printer thread
    thread::spawn(move || {
        while let Ok(status) = status_rx.recv() {
            eprintln!("[mirror_stream] status: {:?}", status);
        }
    });

    // Wrap session in Arc<Mutex> for shared access (Proc is Send but not Sync)
    let session = Arc::new(Mutex::new(session));

    // Stdin reader → input sender thread
    let session_input = Arc::clone(&session);
    thread::spawn(move || {
        let stdin = io::stdin();
        let reader = BufReader::new(stdin.lock());
        for line in reader.lines() {
            let line = match line {
                Ok(l) => l,
                Err(_) => break,
            };
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }
            match serde_json::from_str::<InputEvent>(trimmed) {
                Ok(ev) => {
                    let sess = session_input.lock().unwrap();
                    if let Err(e) = sess.send_input(&ev) {
                        eprintln!("[mirror_stream] send_input error: {}", e);
                        break;
                    }
                }
                Err(e) => {
                    eprintln!("[mirror_stream] invalid input: {}: {}", e, trimmed);
                }
            }
        }
    });

    // Main thread: read frames and write to stdout as [u32be len][packet]
    let stdout = io::stdout();
    let mut out = stdout.lock();

    while let Ok(packet) = frame_rx.recv() {
        let len = packet.len() as u32;
        if out.write_all(&len.to_be_bytes()).is_err() {
            break;
        }
        if out.write_all(&packet).is_err() {
            break;
        }
        if out.flush().is_err() {
            break;
        }
    }

    eprintln!("[mirror_stream] stream ended");
}
