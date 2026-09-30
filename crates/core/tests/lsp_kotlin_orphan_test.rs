use petak_core::lsp::{Server, ServerConfig, ServerError};
use std::process::Command;
use std::time::Duration;

#[test]
fn test_kotlin_ls_process_group_kill_no_orphan_on_timeout() {
    let kls_bin = match petak_core::toolchain::resolve_kotlin_ls() {
        Some(p) => p,
        None => {
            println!("Skipping test: Kotlin LS binary not found");
            return;
        }
    };

    let tmp = tempfile::tempdir().expect("tempdir");
    let proj_root = tmp.path();
    let kt_dir = proj_root.join("src/main/kotlin");
    std::fs::create_dir_all(&kt_dir).expect("create_dir_all");
    std::fs::write(
        kt_dir.join("Hello.kt"),
        "fun main() { println(\"hello\") }\n",
    )
    .expect("write Hello.kt");

    // Artificial tiny timeout (1 millisecond) so initialize always times out
    let mut config = ServerConfig::new(
        kls_bin.to_string_lossy(),
        vec![],
        format!("file://{}", proj_root.display()),
    );
    config.init_timeout = Some(Duration::from_millis(1));
    config.stderr_log_path = Some(petak_core::toolchain::kotlin_ls_log_path());

    if let Some(jdk_dir) = petak_core::toolchain::resolve_jdk_home() {
        config.env.push(("JAVA_HOME".to_string(), jdk_dir.to_string_lossy().to_string()));
    }

    let start_res = Server::start(&config, |_event| {});
    assert!(
        start_res.is_err(),
        "Expected timeout error due to 1ms init_timeout"
    );

    match start_res.err().unwrap() {
        ServerError::Timeout => println!("Successfully captured expected ServerError::Timeout"),
        other => panic!("Expected ServerError::Timeout, got {:?}", other),
    }

    // Give OS a moment to reap processes
    std::thread::sleep(Duration::from_millis(500));

    // Verify with pgrep that no kotlin language server or java process associated with this dummy project is running
    let pgrep_out = Command::new("pgrep")
        .args(&["-f", &format!("{}", proj_root.display())])
        .output();

    if let Ok(out) = pgrep_out {
        let pids = String::from_utf8_lossy(&out.stdout).trim().to_string();
        assert!(
            pids.is_empty(),
            "Orphan process found for dummy project: PIDs {}",
            pids
        );
    }
}
