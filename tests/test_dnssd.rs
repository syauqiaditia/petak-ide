
use std::process::{Command, Stdio};
use std::io::{BufRead, BufReader};
use std::sync::mpsc;
use std::thread;
use std::time::Duration;

fn run_dnssd_line<F>(args: &[&str], timeout_ms: u64, matcher: F) -> Option<String>
where
    F: Fn(&str) -> bool + Send + 'static,
{
    let mut child = Command::new("dns-sd")
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;

    let stdout = child.stdout.take()?;
    let (tx, rx) = mpsc::channel();

    thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines() {
            if let Ok(l) = line {
                if matcher(&l) {
                    let _ = tx.send(l);
                    break;
                }
            } else {
                break;
            }
        }
    });

    let res = rx.recv_timeout(Duration::from_millis(timeout_ms)).ok();
    let _ = child.kill();
    let _ = child.wait();
    res
}

fn main() {
    println!("Testing dns-sd wrapper");
}
