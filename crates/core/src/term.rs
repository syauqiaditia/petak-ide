use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use std::io::{Read, Write};
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::thread;

pub struct TermSession {
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    master: Arc<Mutex<Box<dyn MasterPty + Send>>>,
    child: Arc<Mutex<Box<dyn Child + Send>>>,
}

impl TermSession {
    pub fn open(
        cwd: Option<&Path>,
        cols: u16,
        rows: u16,
        on_output: impl Fn(Vec<u8>) + Send + 'static,
        on_exit: impl FnOnce() + Send + 'static,
    ) -> std::io::Result<Self> {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
        Self::open_with_shell(&shell, cwd, cols, rows, on_output, on_exit)
    }

    pub fn open_with_shell(
        shell: &str,
        cwd: Option<&Path>,
        cols: u16,
        rows: u16,
        on_output: impl Fn(Vec<u8>) + Send + 'static,
        on_exit: impl FnOnce() + Send + 'static,
    ) -> std::io::Result<Self> {
        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))?;

        let mut cmd = CommandBuilder::new(shell);
        cmd.arg("-l");
        if let Some(dir) = cwd {
            cmd.cwd(dir);
        }
        cmd.env("TERM", "xterm-256color");
        crate::toolchain::apply_env_pty(&mut cmd);

        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))?;

        drop(pair.slave);

        let writer = pair
            .master
            .take_writer()
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))?;

        let mut reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))?;

        let on_exit_cell = Arc::new(Mutex::new(Some(on_exit)));
        thread::spawn(move || {
            let mut buf = [0u8; 8192];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        on_output(buf[..n].to_vec());
                    }
                    Err(_) => break,
                }
            }
            if let Ok(mut guard) = on_exit_cell.lock() {
                if let Some(cb) = guard.take() {
                    cb();
                }
            }
        });

        Ok(Self {
            writer: Arc::new(Mutex::new(writer)),
            master: Arc::new(Mutex::new(pair.master)),
            child: Arc::new(Mutex::new(child)),
        })
    }

    pub fn write(&self, data: &[u8]) -> std::io::Result<()> {
        let mut writer = self
            .writer
            .lock()
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))?;
        writer.write_all(data)?;
        writer.flush()
    }

    pub fn resize(&self, cols: u16, rows: u16) -> std::io::Result<()> {
        let master = self
            .master
            .lock()
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))?;
        master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))
    }

    pub fn kill(&self) -> std::io::Result<()> {
        let mut child = self
            .child
            .lock()
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))?;
        child
            .kill()
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))
    }
}

impl Drop for TermSession {
    fn drop(&mut self) {
        let _ = self.kill();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc::channel;
    use std::time::{Duration, Instant};

    #[test]
    fn test_term_session_echo_and_resize() {
        let (tx, rx) = channel();
        let session = TermSession::open_with_shell(
            "/bin/sh",
            None,
            80,
            24,
            move |bytes| {
                let _ = tx.send(bytes);
            },
            || {},
        )
        .expect("failed to open term session");

        session.write(b"echo petak_ok\n").expect("failed to write");

        let start = Instant::now();
        let mut output = String::new();
        while start.elapsed() < Duration::from_secs(2) {
            if let Ok(bytes) = rx.recv_timeout(Duration::from_millis(100)) {
                output.push_str(&String::from_utf8_lossy(&bytes));
                if output.contains("petak_ok") {
                    break;
                }
            }
        }

        assert!(
            output.contains("petak_ok"),
            "Expected 'petak_ok' in output within 2s, got: {}",
            output
        );

        assert!(session.resize(100, 30).is_ok());

        let _ = session.kill();
    }
}
