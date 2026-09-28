use std::fs;
use std::path::Path;
use std::process::Command;
use tempfile::TempDir;

pub struct TestRepo {
    pub dir: TempDir,
}

impl TestRepo {
    pub fn new() -> Self {
        let dir = tempfile::tempdir().expect("create tempdir for test repo");
        let repo = Self { dir };
        repo.git(&["init", "-b", "main"]);
        repo.git(&["config", "--local", "user.name", "Petak Test"]);
        repo.git(&["config", "--local", "user.email", "test@petak.local"]);
        repo
    }

    pub fn path(&self) -> &Path {
        self.dir.path()
    }

    pub fn git(&self, args: &[&str]) -> String {
        let output = Command::new("git")
            .current_dir(self.path())
            .args(args)
            .env("LC_ALL", "C")
            .env("GIT_TERMINAL_PROMPT", "0")
            .output()
            .unwrap_or_else(|e| panic!("failed to run git {:?}: {}", args, e));
        if !output.status.success() {
            panic!(
                "git {:?} failed (code {:?}): {}",
                args,
                output.status.code(),
                String::from_utf8_lossy(&output.stderr)
            );
        }
        String::from_utf8_lossy(&output.stdout).to_string()
    }

    #[allow(dead_code)]
    pub fn git_raw(&self, args: &[&str]) -> std::process::Output {
        Command::new("git")
            .current_dir(self.path())
            .args(args)
            .env("LC_ALL", "C")
            .env("GIT_TERMINAL_PROMPT", "0")
            .output()
            .unwrap_or_else(|e| panic!("failed to run git {:?}: {}", args, e))
    }

    pub fn write_file(&self, rel_path: &str, content: &str) {
        let full = self.path().join(rel_path);
        if let Some(parent) = full.parent() {
            fs::create_dir_all(parent).expect("create parent dirs");
        }
        fs::write(full, content).expect("write file");
    }

    pub fn commit(&self, msg: &str) -> String {
        self.git(&["add", "-A"]);
        self.git(&["commit", "-m", msg])
    }
}
