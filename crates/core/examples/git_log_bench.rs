use std::path::Path;
use std::time::Instant;

use petak_core::exec::SystemExec;
use petak_core::git::{log, LogFilter};

fn main() {
    let default_path = std::env::var("PETAK_GIT_10K_REPO").unwrap_or_else(|_| {
        let tmp = std::env::var("TMPDIR").unwrap_or_else(|_| "/tmp".to_string());
        let p = format!("{}/petak-git10k", tmp.trim_end_matches('/'));
        if Path::new(&p).exists() {
            p
        } else if Path::new("/mnt/storage/uqi-cache/tmp/petak-git10k").exists() {
            "/mnt/storage/uqi-cache/tmp/petak-git10k".to_string()
        } else {
            p
        }
    });
    let arg_path = std::env::args().nth(1);
    let repo_path_buf = arg_path.map(std::path::PathBuf::from).unwrap_or_else(|| std::path::PathBuf::from(default_path));
    let repo_path = repo_path_buf.as_path();
    if !repo_path.exists() {
        eprintln!(
            "Error: dummy repo {} not found. Please run 'bash scripts/gen-git-10k.sh' first.",
            repo_path.display()
        );
        std::process::exit(1);
    }

    let exec = SystemExec;
    let filter = LogFilter::default();

    println!("=== Benchmarking Git Log (Page 1: 500 commits) on 10k repo ===");
    println!("Repo: {}", repo_path.display());

    // Warmup run
    let warmup_start = Instant::now();
    let warmup_res = log(&exec, repo_path, &filter, 0, 500).expect("log page 1 failed");
    let warmup_dur = warmup_start.elapsed();
    println!(
        "Warmup: {:?} (commits: {}, graph rows: {})",
        warmup_dur,
        warmup_res.commits.len(),
        warmup_res.graph.len()
    );

    // 5 measured runs
    let mut times = Vec::new();
    for i in 1..=5 {
        let t0 = Instant::now();
        let res = log(&exec, repo_path, &filter, 0, 500).expect("log page 1 failed");
        let elapsed = t0.elapsed();
        times.push(elapsed);
        println!(
            "Run #{}: {:?} (commits: {}, graph rows: {})",
            i,
            elapsed,
            res.commits.len(),
            res.graph.len()
        );
    }

    times.sort();
    let min = times[0];
    let median = times[times.len() / 2];
    let max = times[times.len() - 1];

    println!("\n=== Benchmark Summary ===");
    println!("Min:    {:?}", min);
    println!("Median: {:?}", median);
    println!("Max:    {:?}", max);
    println!("Target: < 500 ms");

    if median.as_millis() < 500 {
        println!("Result: PASSED (well within budget)");
    } else {
        println!("Result: FAILED (exceeded 500 ms budget)");
        std::process::exit(1);
    }
}
