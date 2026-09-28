use std::io;
use std::path::Path;
use std::process::Output;

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
}
