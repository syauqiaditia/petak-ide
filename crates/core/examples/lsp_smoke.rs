// lsp_smoke: smoke test that spawns the Dart language server against a real Flutter project,
// waits for diagnostics, and prints timing. Run on Mac:
//   cargo run -p petak-core --example lsp_smoke -- <file.dart>

use petak_core::lsp::{Lang, Server, ServerConfig, ServerEvent};
use std::env;
use std::path::Path;
use std::sync::mpsc;
use std::time::{Duration, Instant};

fn main() {
    let args: Vec<String> = env::args().collect();
    if args.len() < 2 {
        eprintln!("Usage: lsp_smoke <file.dart>");
        eprintln!("  Opens the file with the Dart language server and waits for diagnostics.");
        std::process::exit(1);
    }

    let file_path = Path::new(&args[1]).canonicalize().unwrap_or_else(|e| {
        eprintln!("Cannot resolve path {}: {}", args[1], e);
        std::process::exit(1);
    });

    let ext = file_path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("");
    let lang = Lang::from_extension(ext).unwrap_or_else(|| {
        eprintln!("Unsupported extension: .{ext}");
        std::process::exit(1);
    });

    // Find project root
    let root = petak_core::lsp::Registry::find_root(&file_path, lang);
    println!("File:    {}", file_path.display());
    println!("Root:    {}", root.display());
    println!("Lang:    {:?}", lang);

    let (cmd, cmd_args) = lang.command();
    println!("Server:  {} {}", cmd, cmd_args.join(" "));

    let root_uri = format!("file://{}", root.display());
    let config = ServerConfig {
        command: cmd,
        args: cmd_args,
        root_uri,
    };

    let (tx, rx) = mpsc::channel();
    let start = Instant::now();

    let server = Server::start(&config, move |event| {
        let _ = tx.send(event);
    })
    .unwrap_or_else(|e| {
        eprintln!("Failed to start server: {}", e);
        std::process::exit(1);
    });

    let init_time = start.elapsed();
    println!("Init:    {:.0?}", init_time);

    // Read file content
    let text = std::fs::read_to_string(&file_path).unwrap_or_else(|e| {
        eprintln!("Cannot read {}: {}", file_path.display(), e);
        std::process::exit(1);
    });

    let uri = format!("file://{}", file_path.display());
    let language_id = match lang {
        Lang::Dart => "dart",
        Lang::Kotlin => "kotlin",
        Lang::Swift => "swift",
    };

    server
        .notify(
            "textDocument/didOpen",
            &serde_json::json!({
                "textDocument": {
                    "uri": uri,
                    "languageId": language_id,
                    "version": 1,
                    "text": text,
                }
            }),
        )
        .unwrap();

    println!("didOpen sent, waiting for diagnostics (timeout 30s)...");

    let diag_start = Instant::now();
    let mut total_diags = 0;
    let mut first_diag_time: Option<Duration> = None;
    let timeout = Duration::from_secs(30);

    loop {
        match rx.recv_timeout(Duration::from_millis(100)) {
            Ok(ServerEvent::Notification { method, params }) => {
                if method == "textDocument/publishDiagnostics" {
                    if let Some(diags) = params["diagnostics"].as_array() {
                        if !diags.is_empty() && first_diag_time.is_none() {
                            first_diag_time = Some(diag_start.elapsed());
                        }
                        total_diags = diags.len();
                        println!(
                            "  diagnostics: {} items ({:.0?} since didOpen)",
                            diags.len(),
                            diag_start.elapsed()
                        );
                        for (_i, d) in diags.iter().enumerate().take(5) {
                            let msg = d["message"].as_str().unwrap_or("?");
                            let sev = d["severity"].as_u64().unwrap_or(0);
                            let line = d["range"]["start"]["line"].as_u64().unwrap_or(0);
                            let sev_str = match sev {
                                1 => "ERROR",
                                2 => "WARN",
                                3 => "INFO",
                                4 => "HINT",
                                _ => "?",
                            };
                            println!("    [{sev_str}] L{}: {}", line + 1, msg);
                        }
                        if diags.len() > 5 {
                            println!("    ... and {} more", diags.len() - 5);
                        }
                        // Got non-empty diagnostics, done
                        if !diags.is_empty() {
                            break;
                        }
                    }
                }
            }
            Ok(_) => {} // ignore other events
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                eprintln!("Server disconnected!");
                break;
            }
        }
        if diag_start.elapsed() > timeout {
            eprintln!("Timeout waiting for diagnostics.");
            break;
        }
    }

    println!("\n=== Results ===");
    println!("Total diagnostics:     {}", total_diags);
    if let Some(t) = first_diag_time {
        println!("Time to first diag:    {:.0?}", t);
    } else {
        println!("Time to first diag:    (none received)");
    }
    println!("Init time:             {:.0?}", init_time);

    server.shutdown();
}
