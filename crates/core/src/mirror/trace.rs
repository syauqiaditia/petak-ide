use std::fs::OpenOptions;
use std::io::Write;
use std::time::SystemTime;

pub fn log(tag: &str, msg: &str) {
    let now = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default();
    let millis = now.as_millis();
    let secs = millis / 1000;
    let ms = millis % 1000;

    let line = format!("[{}.{:03}] [{}] {}\n", secs, ms, tag, msg);

    if let Ok(mut f) = OpenOptions::new()
        .create(true)
        .append(true)
        .open("/tmp/petak_mirror.log")
    {
        let _ = f.write_all(line.as_bytes());
    }
}
