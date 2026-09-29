use std::io::{self, BufRead, BufReader, Write};
use std::path::Path;
use std::process::{Child, ChildStdin, Command, Output, Stdio};
use std::sync::mpsc::Sender;
use std::sync::{Arc, Mutex};
use std::thread;

pub trait Spawn: Send + Sync {
    fn spawn(
        &self,
        cwd: &Path,
        program: &str,
        args: &[&str],
        env: &[(&str, &str)],
        tx: Sender<ProcLine>,
    ) -> io::Result<Box<dyn Proc>>;
}

pub trait Proc: Send {
    fn stdin_write(&mut self, data: &[u8]) -> io::Result<()>;
    fn kill(&mut self) -> io::Result<()>;
    fn pid(&self) -> Option<u32>;
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProcLine {
    Stdout(String),
    Stderr(String),
    Exit(Option<i32>),
}

#[derive(Debug, Default, Clone, Copy)]
pub struct SystemSpawn;

pub struct SystemProc {
    pid: u32,
    stdin: Option<ChildStdin>,
    child: Arc<Mutex<Option<Child>>>,
}

impl Proc for SystemProc {
    fn stdin_write(&mut self, data: &[u8]) -> io::Result<()> {
        if let Some(stdin) = &mut self.stdin {
            stdin.write_all(data)?;
            stdin.flush()?;
            Ok(())
        } else {
            Err(io::Error::new(io::ErrorKind::BrokenPipe, "stdin is closed"))
        }
    }

    fn kill(&mut self) -> io::Result<()> {
        let mut guard = self.child.lock().unwrap();
        if let Some(child) = guard.as_mut() {
            match child.kill() {
                Ok(()) => Ok(()),
                Err(e) if e.kind() == io::ErrorKind::InvalidInput || e.raw_os_error() == Some(3) => {
                    Ok(())
                }
                Err(e) => Err(e),
            }
        } else {
            Ok(())
        }
    }

    fn pid(&self) -> Option<u32> {
        Some(self.pid)
    }
}

impl Spawn for SystemSpawn {
    fn spawn(
        &self,
        cwd: &Path,
        program: &str,
        args: &[&str],
        env: &[(&str, &str)],
        tx: Sender<ProcLine>,
    ) -> io::Result<Box<dyn Proc>> {
        let mut cmd = Command::new(program);
        cmd.current_dir(cwd).args(args);
        for (k, v) in env {
            cmd.env(k, v);
        }
        cmd.stdin(Stdio::piped());
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());

        let mut child = cmd.spawn()?;
        let pid = child.id();
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();
        let stdin = child.stdin.take();

        let child_arc = Arc::new(Mutex::new(Some(child)));
        let child_for_waiter = Arc::clone(&child_arc);

        let tx_out = tx.clone();
        let stdout_handle = thread::spawn(move || {
            if let Some(stdout) = stdout {
                let mut reader = BufReader::new(stdout);
                loop {
                    let mut line = String::new();
                    match reader.read_line(&mut line) {
                        Ok(0) => break, // EOF
                        Ok(_) => {
                            let trimmed = line.trim_end_matches(&['\r', '\n'][..]).to_string();
                            if tx_out.send(ProcLine::Stdout(trimmed)).is_err() {
                                // Channel dropped: drain remaining so child doesn't get SIGPIPE
                                let mut raw = reader.into_inner();
                                let _ = std::io::copy(&mut raw, &mut std::io::sink());
                                break;
                            }
                        }
                        Err(_) => break,
                    }
                }
            }
        });

        let tx_err = tx.clone();
        let stderr_handle = thread::spawn(move || {
            if let Some(stderr) = stderr {
                let mut reader = BufReader::new(stderr);
                loop {
                    let mut line = String::new();
                    match reader.read_line(&mut line) {
                        Ok(0) => break, // EOF
                        Ok(_) => {
                            let trimmed = line.trim_end_matches(&['\r', '\n'][..]).to_string();
                            if tx_err.send(ProcLine::Stderr(trimmed)).is_err() {
                                let mut raw = reader.into_inner();
                                let _ = std::io::copy(&mut raw, &mut std::io::sink());
                                break;
                            }
                        }
                        Err(_) => break,
                    }
                }
            }
        });

        let tx_exit = tx;
        thread::spawn(move || {
            let _ = stdout_handle.join();
            let _ = stderr_handle.join();

            let exit_code = if let Some(mut child) = child_for_waiter.lock().unwrap().take() {
                child.wait().ok().and_then(|s| s.code())
            } else {
                None
            };
            let _ = tx_exit.send(ProcLine::Exit(exit_code));
        });

        Ok(Box::new(SystemProc {
            pid,
            stdin,
            child: child_arc,
        }))
    }
}

pub trait Exec: Send + Sync {
    fn run(
        &self,
        cwd: &Path,
        program: &str,
        args: &[&str],
        env: &[(&str, &str)],
        stdin: Option<&[u8]>,
    ) -> io::Result<Output>;
}

#[derive(Debug, Default, Clone, Copy)]
pub struct SystemExec;

impl Exec for SystemExec {
    fn run(
        &self,
        cwd: &Path,
        program: &str,
        args: &[&str],
        env: &[(&str, &str)],
        stdin: Option<&[u8]>,
    ) -> io::Result<Output> {
        use std::io::Write;
        use std::process::{Command, Stdio};

        let mut cmd = Command::new(program);
        cmd.current_dir(cwd).args(args);
        for (k, v) in env {
            cmd.env(k, v);
        }
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());

        if let Some(input) = stdin {
            cmd.stdin(Stdio::piped());
            let mut child = cmd.spawn()?;
            if let Some(mut child_stdin) = child.stdin.take() {
                let _ = child_stdin.write_all(input);
                drop(child_stdin);
            }
            child.wait_with_output()
        } else {
            cmd.stdin(Stdio::null());
            cmd.output()
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GitError {
    pub exit_code: Option<i32>,
    pub message: String,
}

impl std::fmt::Display for GitError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self.exit_code {
            Some(code) => write!(f, "git error (code {}): {}", code, self.message),
            None => write!(f, "git error: {}", self.message),
        }
    }
}

impl std::error::Error for GitError {}

pub fn git(exec: &dyn Exec, repo: &Path, args: &[&str]) -> Result<String, GitError> {
    git_with_stdin(exec, repo, args, None)
}

pub fn git_with_stdin(
    exec: &dyn Exec,
    repo: &Path,
    args: &[&str],
    stdin: Option<&[u8]>,
) -> Result<String, GitError> {
    let output = git_raw(exec, repo, args, stdin)?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let message = if stderr.is_empty() {
            String::from_utf8_lossy(&output.stdout).trim().to_string()
        } else {
            stderr
        };
        return Err(GitError {
            exit_code: output.status.code(),
            message,
        });
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

pub fn git_raw(
    exec: &dyn Exec,
    repo: &Path,
    args: &[&str],
    stdin: Option<&[u8]>,
) -> Result<Output, GitError> {
    git_raw_with_env(exec, repo, args, &[], stdin)
}

pub fn git_raw_with_env(
    exec: &dyn Exec,
    repo: &Path,
    args: &[&str],
    extra_env: &[(&str, &str)],
    stdin: Option<&[u8]>,
) -> Result<Output, GitError> {
    let repo_str = repo.to_str().unwrap_or(".");
    let mut full_args = vec!["-C", repo_str, "-c", "core.quotepath=off"];
    full_args.extend_from_slice(args);
    let mut envs = vec![("LC_ALL", "C"), ("GIT_TERMINAL_PROMPT", "0")];
    envs.extend_from_slice(extra_env);
    exec.run(repo, "git", &full_args, &envs, stdin)
        .map_err(|e| GitError {
            exit_code: None,
            message: e.to_string(),
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    struct FakeExec {
        output: Mutex<Option<Output>>,
        recorded_stdin: Mutex<Vec<u8>>,
    }

    impl Exec for FakeExec {
        fn run(
            &self,
            _cwd: &Path,
            _program: &str,
            _args: &[&str],
            _env: &[(&str, &str)],
            stdin: Option<&[u8]>,
        ) -> io::Result<Output> {
            if let Some(bytes) = stdin {
                self.recorded_stdin.lock().unwrap().extend_from_slice(bytes);
            }
            Ok(self.output.lock().unwrap().take().unwrap_or_else(|| {
                #[cfg(unix)]
                use std::os::unix::process::ExitStatusExt;
                Output {
                    status: std::process::ExitStatus::from_raw(0),
                    stdout: b"success\n".to_vec(),
                    stderr: Vec::new(),
                }
            }))
        }
    }

    #[test]
    fn test_exec_git_success() {
        let fake = FakeExec {
            output: Mutex::new(None),
            recorded_stdin: Mutex::new(Vec::new()),
        };
        let out = git(&fake, Path::new("/dummy"), &["status"]).unwrap();
        assert_eq!(out, "success\n");
    }

    #[test]
    fn test_exec_git_failure() {
        #[cfg(unix)]
        use std::os::unix::process::ExitStatusExt;
        let fake = FakeExec {
            output: Mutex::new(Some(Output {
                status: std::process::ExitStatus::from_raw(1 << 8), // exit code 1
                stdout: Vec::new(),
                stderr: b"fatal: not a git repo\n".to_vec(),
            })),
            recorded_stdin: Mutex::new(Vec::new()),
        };
        let err = git(&fake, Path::new("/dummy"), &["status"]).unwrap_err();
        assert_eq!(err.exit_code, Some(1));
        assert_eq!(err.message, "fatal: not a git repo");
    }

    #[test]
    fn test_exec_git_stdin() {
        let fake = FakeExec {
            output: Mutex::new(None),
            recorded_stdin: Mutex::new(Vec::new()),
        };
        git_with_stdin(
            &fake,
            Path::new("/dummy"),
            &["commit", "-F", "-"],
            Some(b"my commit"),
        )
        .unwrap();
        assert_eq!(*fake.recorded_stdin.lock().unwrap(), b"my commit");
    }

    #[test]
    fn test_system_spawn_stdout_stderr_exit() {
        let spawn = SystemSpawn;
        let (tx, rx) = std::sync::mpsc::channel();
        let _proc = spawn
            .spawn(
                Path::new("."),
                "sh",
                &["-c", "echo a; echo b >&2; exit 3"],
                &[],
                tx,
            )
            .unwrap();

        let mut lines = Vec::new();
        while let Ok(line) = rx.recv() {
            let is_exit = matches!(line, ProcLine::Exit(_));
            lines.push(line);
            if is_exit {
                break;
            }
        }

        assert!(lines.contains(&ProcLine::Stdout("a".to_string())));
        assert!(lines.contains(&ProcLine::Stderr("b".to_string())));
        assert_eq!(lines.last(), Some(&ProcLine::Exit(Some(3))));
    }

    #[test]
    fn test_system_spawn_stdin_and_kill() {
        let spawn = SystemSpawn;
        let (tx, rx) = std::sync::mpsc::channel();
        let mut proc = spawn
            .spawn(Path::new("."), "sleep", &["5"], &[], tx)
            .unwrap();
        assert!(proc.pid().is_some());
        proc.kill().unwrap();

        let mut exit_found = false;
        while let Ok(line) = rx.recv_timeout(std::time::Duration::from_secs(2)) {
            if matches!(line, ProcLine::Exit(_)) {
                exit_found = true;
                break;
            }
        }
        assert!(exit_found);
    }
}
