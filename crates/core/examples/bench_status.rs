use std::fs;
use std::process::Command;
use std::time::Instant;

use petak_core::exec::SystemExec;
use petak_core::git::status;

fn main() {
    println!("Preparing benchmark repository with ~5,000 files in $TMPDIR...");
    let temp_dir = tempfile::tempdir().expect("create tempdir");
    let repo_path = temp_dir.path();

    let run_git = |args: &[&str]| {
        let output = Command::new("git")
            .current_dir(repo_path)
            .args(args)
            .env("LC_ALL", "C")
            .env("GIT_TERMINAL_PROMPT", "0")
            .output()
            .unwrap_or_else(|e| panic!("failed git {:?}: {}", args, e));
        if !output.status.success() {
            panic!(
                "git {:?} failed: {}",
                args,
                String::from_utf8_lossy(&output.stderr)
            );
        }
    };

    run_git(&["init", "-b", "main"]);
    run_git(&["config", "--local", "user.name", "Petak Test"]);
    run_git(&["config", "--local", "user.email", "test@petak.local"]);

    // Generate 50 folders with 100 files each = 5,000 files
    let num_folders = 50;
    let files_per_folder = 100;
    for d in 0..num_folders {
        let dir_path = repo_path.join(format!("dir_{d}"));
        fs::create_dir_all(&dir_path).unwrap();
        for f in 0..files_per_folder {
            let file_path = dir_path.join(format!("file_{f}.txt"));
            fs::write(file_path, format!("initial line in dir_{d} file_{f}\n")).unwrap();
        }
    }

    println!("Staging and committing 5,000 files...");
    run_git(&["add", "."]);
    run_git(&["commit", "-m", "commit 5000 files"]);

    println!("Modifying 200 files + creating 50 untracked files...");
    // Modify 200 files: dir_0 (100 files) and dir_1 (100 files)
    for d in 0..2 {
        let dir_path = repo_path.join(format!("dir_{d}"));
        for f in 0..files_per_folder {
            let file_path = dir_path.join(format!("file_{f}.txt"));
            fs::write(file_path, format!("modified line in dir_{d} file_{f}\n")).unwrap();
        }
    }

    // Create 50 untracked files in dir_2
    let dir_2 = repo_path.join("dir_2");
    for f in 0..50 {
        let file_path = dir_2.join(format!("untracked_{f}.txt"));
        fs::write(file_path, format!("untracked line {f}\n")).unwrap();
    }

    let exec = SystemExec;

    // Warmup
    let warmup_status = status(&exec, repo_path).expect("warmup status");
    println!(
        "Warmup done. Total status entries detected: {} (branch: {})",
        warmup_status.entries.len(),
        warmup_status.branch.head
    );
    assert_eq!(warmup_status.entries.len(), 250);

    // Measure 10 runs
    let iterations = 10;
    let mut times_ms = Vec::with_capacity(iterations);
    for i in 1..=iterations {
        let start = Instant::now();
        let s = status(&exec, repo_path).expect("status run");
        let elapsed = start.elapsed();
        let ms = elapsed.as_secs_f64() * 1000.0;
        times_ms.push(ms);
        println!("Run {i}: {:.2} ms (entries: {})", ms, s.entries.len());
    }

    times_ms.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let min = times_ms.first().copied().unwrap();
    let max = times_ms.last().copied().unwrap();
    let median = times_ms[times_ms.len() / 2];
    let avg = times_ms.iter().sum::<f64>() / (times_ms.len() as f64);

    println!("\n=== BENCHMARK RESULT ===");
    println!("Repo size: 5,000 files, 200 modified, 50 untracked");
    println!("Min:    {:.2} ms", min);
    println!("Median: {:.2} ms", median);
    println!("Avg:    {:.2} ms", avg);
    println!("Max:    {:.2} ms", max);
    println!(
        "Budget target: < 200 ms -> {}",
        if median < 200.0 { "PASSED" } else { "FAILED" }
    );
}
