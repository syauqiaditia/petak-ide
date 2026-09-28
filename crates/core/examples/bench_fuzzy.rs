use petak_core::search::FileIndex;
use std::path::PathBuf;
use std::time::Instant;

fn main() {
    println!("=== Petak Fuzzy Finder Benchmark (20k files) ===");

    // 1. Generate 20,000 realistic paths
    let mut files = Vec::with_capacity(20_000);
    let modules = ["auth", "home", "payment", "profile", "settings", "transfer", "notification", "chat", "card", "history"];
    let layers = ["presentation", "domain", "data", "controller", "repository"];

    // 10 modules * 5 layers * 400 files = 20,000 paths
    for m in &modules {
        for l in &layers {
            for k in 0..400 {
                files.push(format!("lib/features/{}/{}/file_{}.dart", m, l, k));
            }
        }
    }
    assert_eq!(files.len(), 20_000, "Should generate exactly 20,000 files");
    println!("Generated {} realistic paths.", files.len());

    let index = FileIndex {
        root: PathBuf::from("/mock/project"),
        files,
    };

    // 2. 20 queries of 1-6 characters
    let queries = [
        "m",       // 1 char
        "d",       // 1 char
        "fe",      // 2 chars
        "re",      // 2 chars
        "sub",     // 3 chars
        "scr",     // 3 chars
        "rep",     // 3 chars
        "dart",    // 4 chars
        "repo",    // 4 chars
        "auth",    // 4 chars
        "home",    // 4 chars
        "card",    // 4 chars
        "file8",   // 5 chars
        "model",   // 5 chars
        "notif",   // 5 chars
        "trans",   // 5 chars
        "mainda",  // 6 chars
        "usrrep",  // 6 chars
        "screen",  // 6 chars
        "domain",  // 6 chars
    ];

    // Warmup
    for q in &queries {
        let _ = index.query(q, 50);
    }

    // Measure: run 5 rounds of the 20 queries (100 query samples total)
    let mut all_samples_ms = Vec::new();
    println!("\n--- Query Benchmarks (limit 50) ---");

    for (i, q) in queries.iter().enumerate() {
        let mut query_times = Vec::new();
        let mut match_count = 0;
        for _ in 0..5 {
            let start = Instant::now();
            let matches = index.query(q, 50);
            let elapsed = start.elapsed().as_secs_f64() * 1000.0;
            query_times.push(elapsed);
            all_samples_ms.push(elapsed);
            match_count = matches.len();
        }
        query_times.sort_by(|a, b| a.partial_cmp(b).unwrap());
        let median_q = query_times[query_times.len() / 2];
        println!(
            "Query {:2} ({:6}): median = {:.3} ms (min = {:.3} ms, max = {:.3} ms, matches = {})",
            i + 1,
            format!("\"{}\"", q),
            median_q,
            query_times[0],
            query_times[query_times.len() - 1],
            match_count
        );
    }

    all_samples_ms.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let count = all_samples_ms.len();
    let median = all_samples_ms[count / 2];
    let p95_idx = ((count as f64 * 0.95).floor() as usize).min(count - 1);
    let p95 = all_samples_ms[p95_idx];
    let avg = all_samples_ms.iter().sum::<f64>() / count as f64;
    let min = all_samples_ms[0];
    let max = all_samples_ms[count - 1];

    println!("\n--- Summary Across All 20 Queries ({} samples) ---", count);
    println!("Min:    {:.3} ms", min);
    println!("Avg:    {:.3} ms", avg);
    println!("Median: {:.3} ms", median);
    println!("p95:    {:.3} ms", p95);
    println!("Max:    {:.3} ms", max);
    println!("Budget: median & p95 < 50.0 ms -> {}", if median < 50.0 && p95 < 50.0 { "PASS" } else { "FAIL" });

    // 3. Measure FileIndex::build on real Flutter project
    let sample_flutter_path = PathBuf::from("/Users/uqi/petak-sample");
    println!("\n--- Real Project FileIndex::build ---");
    if sample_flutter_path.exists() {
        // Measure 3 runs
        let mut build_times = Vec::new();
        let mut file_count = 0;
        for _ in 0..3 {
            let start = Instant::now();
            let idx = FileIndex::build(&sample_flutter_path);
            let elapsed = start.elapsed().as_secs_f64() * 1000.0;
            build_times.push(elapsed);
            file_count = idx.files.len();
        }
        build_times.sort_by(|a, b| a.partial_cmp(b).unwrap());
        println!(
            "Target: /Users/uqi/petak-sample ({} files indexed)",
            file_count
        );
        println!(
            "FileIndex::build time: median = {:.3} ms (min = {:.3} ms, max = {:.3} ms)",
            build_times[1], build_times[0], build_times[2]
        );
    } else {
        println!("Path /Users/uqi/petak-sample not found on this machine.");
    }
}
