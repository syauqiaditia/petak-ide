use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::sync::OnceLock;
use std::thread;
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct ToolchainConfig {
    #[serde(alias = "flutterSdk", default)]
    pub flutter_sdk: Option<String>,
    #[serde(alias = "androidSdk", default)]
    pub android_sdk: Option<String>,
    #[serde(alias = "kotlinLanguageServer", default)]
    pub kotlin_language_server: Option<String>,
}

/// Global lazy cache for the effective PATH.
static EFFECTIVE_PATH: OnceLock<String> = OnceLock::new();

/// Return the cached effective PATH, computing it lazily on the first call.
pub fn effective_path() -> &'static str {
    EFFECTIVE_PATH.get_or_init(|| {
        let start = Instant::now();
        let home = std::env::var_os("HOME").map(PathBuf::from);
        let config = load_config();
        let path = compute_effective_path_with(
            home.as_deref(),
            None,
            Duration::from_secs(3),
            Some(&config),
        );
        let elapsed = start.elapsed();
        let dart = resolve_dart_in_path(&path, None, &config);
        eprintln!("[toolchain] resolved effective PATH in {:?}: {}", elapsed, path);
        eprintln!("[toolchain] selected dart binary: {:?}", dart);
        path
    })
}

/// Return an effective PATH customized for a specific project root (e.g. project-local FVM).
pub fn effective_path_for_root(project_root: Option<&Path>) -> String {
    let base = effective_path();
    let Some(root) = project_root else {
        return base.to_string();
    };

    let home = std::env::var_os("HOME").map(PathBuf::from);
    let mut proj_dirs = Vec::new();
    collect_project_flutter_paths(root, home.as_deref(), &mut proj_dirs);

    if proj_dirs.is_empty() {
        return base.to_string();
    }

    let mut parts: Vec<String> = proj_dirs
        .into_iter()
        .map(|p| p.to_string_lossy().to_string())
        .collect();

    for p in std::env::split_paths(base) {
        parts.push(p.to_string_lossy().to_string());
    }

    dedup_and_join_paths(&parts)
}

/// Apply effective PATH and resolved toolchain environment variables to a `std::process::Command`.
pub fn apply_env(cmd: &mut Command) {
    apply_env_for_root(cmd, None);
}

/// Apply effective PATH and resolved toolchain environment variables for a specific project root.
pub fn apply_env_for_root(cmd: &mut Command, root: Option<&Path>) {
    let path = if let Some(r) = root {
        effective_path_for_root(Some(r))
    } else {
        effective_path().to_string()
    };
    cmd.env("PATH", &path);

    if let Some(android_home) = resolve_android_home() {
        cmd.env("ANDROID_HOME", &android_home);
        cmd.env("ANDROID_SDK_ROOT", &android_home);
    }
    if let Some(flutter_root) = resolve_flutter_root(root) {
        cmd.env("FLUTTER_ROOT", &flutter_root);
    }
}

/// Apply effective PATH and toolchain environment variables to a `portable_pty::CommandBuilder`.
pub fn apply_env_pty(cmd: &mut portable_pty::CommandBuilder) {
    let path = effective_path();
    cmd.env("PATH", path);

    if let Some(android_home) = resolve_android_home() {
        cmd.env("ANDROID_HOME", &android_home);
        cmd.env("ANDROID_SDK_ROOT", &android_home);
    }
    if let Some(flutter_root) = resolve_flutter_root(None) {
        cmd.env("FLUTTER_ROOT", &flutter_root);
    }
}

/// Find the config.json file path.
pub fn config_path() -> Option<PathBuf> {
    if let Ok(override_file) = std::env::var("PETAK_CONFIG_FILE") {
        if !override_file.is_empty() {
            return Some(PathBuf::from(override_file));
        }
    }

    let home = std::env::var_os("HOME").map(PathBuf::from)?;

    #[cfg(target_os = "macos")]
    {
        Some(
            home.join("Library")
                .join("Application Support")
                .join("Petak")
                .join("config.json"),
        )
    }

    #[cfg(not(target_os = "macos"))]
    {
        // First check standard Mac Application Support path if it exists on Linux (for test/dev parity)
        let mac_compat = home
            .join("Library")
            .join("Application Support")
            .join("Petak")
            .join("config.json");
        if mac_compat.exists() {
            return Some(mac_compat);
        }

        if let Some(xdg) = std::env::var_os("XDG_CONFIG_HOME") {
            Some(PathBuf::from(xdg).join("Petak").join("config.json"))
        } else {
            Some(home.join(".config").join("Petak").join("config.json"))
        }
    }
}

/// Load configuration from config.json.
pub fn load_config() -> ToolchainConfig {
    if let Some(path) = config_path() {
        if path.exists() {
            if let Ok(content) = std::fs::read_to_string(&path) {
                if let Ok(cfg) = serde_json::from_str::<ToolchainConfig>(&content) {
                    return cfg;
                }
            }
        }
    }
    ToolchainConfig::default()
}

/// Save configuration to config.json.
pub fn save_config(config: &ToolchainConfig) -> std::io::Result<()> {
    let path = config_path().ok_or_else(|| {
        std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "Could not determine config directory",
        )
    })?;

    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    let content = serde_json::to_string_pretty(config)
        .map_err(|e| std::io::Error::other(e.to_string()))?;
    std::fs::write(&path, content)?;
    Ok(())
}

/// Probe the interactive shell PATH with a strict timeout to prevent hangs.
pub fn probe_shell_path(timeout: Duration) -> Option<String> {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| {
        #[cfg(target_os = "macos")]
        {
            "/bin/zsh".to_string()
        }
        #[cfg(not(target_os = "macos"))]
        {
            if Path::new("/bin/bash").exists() {
                "/bin/bash".to_string()
            } else {
                "/bin/sh".to_string()
            }
        }
    });

    let is_fish = shell.ends_with("fish");
    let cmd_str = if is_fish {
        "printf '__PETAK_PATH_START__%s__PETAK_PATH_END__' (string join : $PATH)"
    } else {
        "printf '__PETAK_PATH_START__%s__PETAK_PATH_END__' \"$PATH\""
    };

    let args: Vec<&str> = if is_fish {
        vec!["-c", cmd_str]
    } else {
        vec!["-ilc", cmd_str]
    };

    let mut child = match Command::new(&shell)
        .args(&args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
    {
        Ok(c) => c,
        Err(_) => return None,
    };

    let stdout = child.stdout.take()?;
    let (tx, rx) = mpsc::channel();

    thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        let mut full_output = String::new();
        let mut buf = String::new();
        while let Ok(n) = reader.read_line(&mut buf) {
            if n == 0 {
                break;
            }
            full_output.push_str(&buf);
            buf.clear();
        }
        let _ = tx.send(full_output);
    });

    match rx.recv_timeout(timeout) {
        Ok(output) => {
            let _ = child.wait();
            if let Some(start_idx) = output.find("__PETAK_PATH_START__") {
                let rest = &output[start_idx + "__PETAK_PATH_START__".len()..];
                if let Some(end_idx) = rest.find("__PETAK_PATH_END__") {
                    let path = rest[..end_idx].trim();
                    if !path.is_empty() {
                        return Some(path.to_string());
                    }
                }
            }
            // Fallback if marker not properly captured
            for line in output.lines().rev() {
                let trimmed = line.trim();
                if trimmed.contains('/') && (trimmed.contains(':') || trimmed.contains("bin")) {
                    return Some(trimmed.to_string());
                }
            }
            None
        }
        Err(_) => {
            // Timeout: kill the child process immediately
            let _ = child.kill();
            let _ = child.wait();
            None
        }
    }
}

/// Compute effective PATH deterministically, suitable for both production and unit tests.
pub fn compute_effective_path_with(
    home: Option<&Path>,
    project_root: Option<&Path>,
    shell_timeout: Duration,
    config: Option<&ToolchainConfig>,
) -> String {
    let empty_cfg = ToolchainConfig::default();
    let cfg = config.unwrap_or(&empty_cfg);

    let mut candidate_dirs: Vec<PathBuf> = Vec::new();

    // 1. Config overrides win first
    if let Some(ref f_sdk) = cfg.flutter_sdk {
        let p = Path::new(f_sdk);
        let bin = p.join("bin");
        if bin.exists() {
            candidate_dirs.push(bin);
        }
        let dart_bin = p.join("bin").join("cache").join("dart-sdk").join("bin");
        if dart_bin.exists() {
            candidate_dirs.push(dart_bin);
        }
    }

    if let Some(ref a_sdk) = cfg.android_sdk {
        let p = Path::new(a_sdk);
        let pt = p.join("platform-tools");
        if pt.exists() {
            candidate_dirs.push(pt);
        }
        let emu = p.join("emulator");
        if emu.exists() {
            candidate_dirs.push(emu);
        }
        let cmdline = p.join("cmdline-tools").join("latest").join("bin");
        if cmdline.exists() {
            candidate_dirs.push(cmdline);
        }
    }

    if let Some(ref k_ls) = cfg.kotlin_language_server {
        let p = Path::new(k_ls);
        if p.is_dir() {
            candidate_dirs.push(p.to_path_buf());
        } else if let Some(parent) = p.parent() {
            candidate_dirs.push(parent.to_path_buf());
        }
    }

    // 2. Project-level Flutter versions (.fvmrc / .fvm)
    if let Some(root) = project_root {
        collect_project_flutter_paths(root, home, &mut candidate_dirs);
    }

    // 3. Common Flutter & Dart locations
    if let Ok(flutter_root) = std::env::var("FLUTTER_ROOT") {
        let p = PathBuf::from(flutter_root);
        let bin = p.join("bin");
        if bin.exists() {
            candidate_dirs.push(bin);
        }
        let dart_bin = p.join("bin").join("cache").join("dart-sdk").join("bin");
        if dart_bin.exists() {
            candidate_dirs.push(dart_bin);
        }
    }

    if let Some(h) = home {
        // ~/fvm/default/bin
        let fvm_default = h.join("fvm").join("default").join("bin");
        if fvm_default.exists() {
            candidate_dirs.push(fvm_default.clone());
            let dart_sdk = fvm_default.join("cache").join("dart-sdk").join("bin");
            if dart_sdk.exists() {
                candidate_dirs.push(dart_sdk);
            }
        }

        // ~/SDK/*/bin (glob flutter_*)
        let sdk_dir = h.join("SDK");
        if sdk_dir.is_dir() {
            if let Ok(entries) = std::fs::read_dir(&sdk_dir) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    let name = entry.file_name().to_string_lossy().to_string();
                    if name.contains("flutter") {
                        let bin = path.join("bin");
                        if bin.exists() {
                            candidate_dirs.push(bin.clone());
                            let dart_bin = bin.join("cache").join("dart-sdk").join("bin");
                            if dart_bin.exists() {
                                candidate_dirs.push(dart_bin);
                            }
                        }
                    }
                }
            }
        }

        // ~/development/flutter/bin
        let dev_flutter = h.join("development").join("flutter").join("bin");
        if dev_flutter.exists() {
            candidate_dirs.push(dev_flutter.clone());
            let dart_bin = dev_flutter.join("cache").join("dart-sdk").join("bin");
            if dart_bin.exists() {
                candidate_dirs.push(dart_bin);
            }
        }

        // ~/.puro
        let puro_env = h.join(".puro").join("envs").join("default").join("bin");
        if puro_env.exists() {
            candidate_dirs.push(puro_env);
        }
        let puro_bin = h.join(".puro").join("bin");
        if puro_bin.exists() {
            candidate_dirs.push(puro_bin);
        }

        // ~/.pub-cache/bin
        let pub_cache_bin = h.join(".pub-cache").join("bin");
        if pub_cache_bin.exists() {
            candidate_dirs.push(pub_cache_bin);
        }
    }

    if let Ok(pub_cache) = std::env::var("PUB_CACHE") {
        let p = PathBuf::from(pub_cache).join("bin");
        if p.exists() {
            candidate_dirs.push(p);
        }
    }

    // Host storage locations (server Linux parity)
    let server_flutter = Path::new("/mnt/storage/flutter-uqi/bin");
    if server_flutter.exists() {
        candidate_dirs.push(server_flutter.to_path_buf());
        let dart = server_flutter.join("cache").join("dart-sdk").join("bin");
        if dart.exists() {
            candidate_dirs.push(dart);
        }
    }

    // 4. Android SDK locations
    collect_android_paths(home, cfg, &mut candidate_dirs);

    // 5. SourceKit-LSP locations
    collect_sourcekit_paths(&mut candidate_dirs);

    // 6. Kotlin Language Server locations
    collect_kotlin_ls_paths(home, &mut candidate_dirs);

    // 7. System & Homebrew locations
    for sys in &[
        "/opt/homebrew/bin",
        "/usr/local/bin",
        "/usr/bin",
        "/bin",
        "/usr/sbin",
        "/sbin",
    ] {
        let p = PathBuf::from(sys);
        if p.exists() {
            candidate_dirs.push(p);
        }
    }

    // Convert candidate dirs to path strings
    let mut all_parts: Vec<String> = candidate_dirs
        .into_iter()
        .map(|p| p.to_string_lossy().to_string())
        .collect();

    // 8. Probe shell PATH
    if let Some(shell_path) = probe_shell_path(shell_timeout) {
        for p in std::env::split_paths(&shell_path) {
            all_parts.push(p.to_string_lossy().to_string());
        }
    }

    // 9. Current process PATH
    if let Ok(curr_path) = std::env::var("PATH") {
        for p in std::env::split_paths(&curr_path) {
            all_parts.push(p.to_string_lossy().to_string());
        }
    }

    dedup_and_join_paths(&all_parts)
}

fn collect_project_flutter_paths(root: &Path, home: Option<&Path>, dirs: &mut Vec<PathBuf>) {
    // Check .fvmrc
    if let Some(version) = parse_fvm_version(root) {
        if let Some(h) = home {
            let ver_bin = h.join("fvm").join("versions").join(&version).join("bin");
            if ver_bin.exists() {
                dirs.push(ver_bin.clone());
                let dart_bin = ver_bin.join("cache").join("dart-sdk").join("bin");
                if dart_bin.exists() {
                    dirs.push(dart_bin);
                }
            }
        }
    }

    // Check .fvm/flutter_sdk/bin
    let proj_fvm = root.join(".fvm").join("flutter_sdk").join("bin");
    if proj_fvm.exists() {
        dirs.push(proj_fvm.clone());
        let dart_bin = proj_fvm.join("cache").join("dart-sdk").join("bin");
        if dart_bin.exists() {
            dirs.push(dart_bin);
        }
    }
}

fn parse_fvm_version(root: &Path) -> Option<String> {
    let fvmrc = root.join(".fvmrc");
    if fvmrc.exists() {
        if let Ok(content) = std::fs::read_to_string(&fvmrc) {
            if let Ok(val) = serde_json::from_str::<serde_json::Value>(&content) {
                if let Some(v) = val.get("flutter").and_then(|v| v.as_str()) {
                    return Some(v.to_string());
                }
            }
            let trimmed = content.trim().trim_matches('"');
            if !trimmed.is_empty() && !trimmed.starts_with('{') {
                return Some(trimmed.to_string());
            }
        }
    }

    let fvm_cfg = root.join(".fvm").join("fvm_config.json");
    if fvm_cfg.exists() {
        if let Ok(content) = std::fs::read_to_string(&fvm_cfg) {
            if let Ok(val) = serde_json::from_str::<serde_json::Value>(&content) {
                if let Some(v) = val.get("flutter").and_then(|v| v.as_str()) {
                    return Some(v.to_string());
                }
            }
        }
    }

    None
}

fn collect_android_paths(home: Option<&Path>, cfg: &ToolchainConfig, dirs: &mut Vec<PathBuf>) {
    let mut candidate_roots = Vec::new();

    if let Some(ref a_sdk) = cfg.android_sdk {
        candidate_roots.push(PathBuf::from(a_sdk));
    }
    if let Ok(p) = std::env::var("ANDROID_HOME") {
        candidate_roots.push(PathBuf::from(p));
    }
    if let Ok(p) = std::env::var("ANDROID_SDK_ROOT") {
        candidate_roots.push(PathBuf::from(p));
    }
    if let Some(h) = home {
        candidate_roots.push(h.join("Library").join("Android").join("sdk"));
        candidate_roots.push(h.join("Android").join("Sdk"));
    }
    candidate_roots.push(PathBuf::from("/mnt/storage/caches/android-sdk-uqi"));

    for root in candidate_roots {
        if root.exists() {
            let pt = root.join("platform-tools");
            if pt.exists() {
                dirs.push(pt);
            }
            let emu = root.join("emulator");
            if emu.exists() {
                dirs.push(emu);
            }
            let cmdline = root.join("cmdline-tools").join("latest").join("bin");
            if cmdline.exists() {
                dirs.push(cmdline);
            }
        }
    }
}

fn collect_sourcekit_paths(dirs: &mut Vec<PathBuf>) {
    #[cfg(target_os = "macos")]
    {
        if let Ok(output) = Command::new("xcrun")
            .args(["--find", "sourcekit-lsp"])
            .output()
        {
            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout);
                let p = Path::new(stdout.trim());
                if let Some(parent) = p.parent() {
                    dirs.push(parent.to_path_buf());
                }
            }
        }
    }

    for p in &[
        "/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/bin",
        "/Library/Developer/CommandLineTools/usr/bin",
    ] {
        let pb = PathBuf::from(p);
        if pb.exists() {
            dirs.push(pb);
        }
    }
}

fn collect_kotlin_ls_paths(home: Option<&Path>, dirs: &mut Vec<PathBuf>) {
    let candidates = [
        PathBuf::from("/opt/homebrew/bin"),
    ];

    for c in &candidates {
        if c.exists() {
            dirs.push(c.clone());
        }
    }

    // App-support dir: ~/Library/Application Support/Petak/lsp/server/bin (macOS)
    // or ~/.local/share/Petak/lsp/server/bin (Linux)
    if let Some(data) = dirs::data_dir() {
        let app_support = data.join("Petak").join("lsp").join("server").join("bin");
        if app_support.exists() {
            dirs.push(app_support);
        }
    }

    if let Some(h) = home {
        let local_share = h
            .join(".local")
            .join("share")
            .join("kotlin-language-server")
            .join("bin");
        if local_share.exists() {
            dirs.push(local_share);
        }
    }
}

fn dedup_and_join_paths(paths: &[String]) -> String {
    let mut seen = HashSet::new();
    let mut unique = Vec::new();

    for p in paths {
        let trimmed = p.trim();
        if trimmed.is_empty() {
            continue;
        }
        if seen.insert(trimmed.to_string()) {
            unique.push(PathBuf::from(trimmed));
        }
    }

    std::env::join_paths(unique)
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|_| paths.join(":"))
}

/// Resolve the Dart binary. Prefers project Flutter / SDK dart over global.
pub fn resolve_dart(project_root: Option<&Path>) -> Option<PathBuf> {
    let path = if let Some(r) = project_root {
        effective_path_for_root(Some(r))
    } else {
        effective_path().to_string()
    };
    let config = load_config();
    resolve_dart_in_path(&path, project_root, &config)
}

pub fn resolve_dart_in_path(
    path_env: &str,
    project_root: Option<&Path>,
    config: &ToolchainConfig,
) -> Option<PathBuf> {
    // 1. Config override
    if let Some(ref f_sdk) = config.flutter_sdk {
        let p = Path::new(f_sdk);
        let dart = p.join("bin").join("cache").join("dart-sdk").join("bin").join("dart");
        if dart.is_file() {
            return Some(dart);
        }
        let dart2 = p.join("bin").join("dart");
        if dart2.is_file() {
            return Some(dart2);
        }
    }

    // 2. Project fvmrc / fvm
    if let Some(root) = project_root {
        let mut dirs = Vec::new();
        let home = std::env::var_os("HOME").map(PathBuf::from);
        collect_project_flutter_paths(root, home.as_deref(), &mut dirs);
        for d in dirs {
            let dart = d.join("cache").join("dart-sdk").join("bin").join("dart");
            if dart.is_file() {
                return Some(dart);
            }
            let dart2 = d.join("dart");
            if dart2.is_file() {
                return Some(dart2);
            }
        }
    }

    // 3. Search in path_env
    for dir in std::env::split_paths(path_env) {
        // If dir is a flutter bin dir, check if bin/cache/dart-sdk/bin/dart exists
        let cached_dart = dir.join("cache").join("dart-sdk").join("bin").join("dart");
        if cached_dart.is_file() {
            return Some(cached_dart);
        }
        let dart = dir.join("dart");
        if dart.is_file() {
            return Some(dart);
        }
    }

    None
}

/// Resolve Flutter binary.
pub fn resolve_flutter(project_root: Option<&Path>) -> Option<PathBuf> {
    let path = if let Some(r) = project_root {
        effective_path_for_root(Some(r))
    } else {
        effective_path().to_string()
    };

    let config = load_config();
    if let Some(ref f_sdk) = config.flutter_sdk {
        let p = Path::new(f_sdk).join("bin").join("flutter");
        if p.is_file() {
            return Some(p);
        }
    }

    for dir in std::env::split_paths(&path) {
        let f = dir.join("flutter");
        if f.is_file() {
            return Some(f);
        }
    }

    None
}

/// Resolve ADB executable.
pub fn resolve_adb() -> String {
    let path = effective_path();
    let config = load_config();

    if let Some(ref a_sdk) = config.android_sdk {
        let adb = Path::new(a_sdk).join("platform-tools").join("adb");
        if adb.is_file() {
            return adb.to_string_lossy().to_string();
        }
    }

    for dir in std::env::split_paths(&path) {
        let adb = dir.join("adb");
        if adb.is_file() {
            return adb.to_string_lossy().to_string();
        }
    }

    "adb".to_string()
}

/// Resolve Emulator executable.
pub fn resolve_emulator() -> String {
    let path = effective_path();
    let config = load_config();

    if let Some(ref a_sdk) = config.android_sdk {
        let emu = Path::new(a_sdk).join("emulator").join("emulator");
        if emu.is_file() {
            return emu.to_string_lossy().to_string();
        }
    }

    for dir in std::env::split_paths(&path) {
        let emu = dir.join("emulator");
        if emu.is_file() {
            return emu.to_string_lossy().to_string();
        }
    }

    "emulator".to_string()
}

/// Resolve Kotlin Language Server binary.
pub fn resolve_kotlin_ls() -> Option<PathBuf> {
    let path = effective_path();
    let config = load_config();

    if let Some(ref k_ls) = config.kotlin_language_server {
        let p = PathBuf::from(k_ls);
        if p.is_file() {
            return Some(p);
        }
        let bin = p.join("bin").join("kotlin-language-server");
        if bin.is_file() {
            return Some(bin);
        }
        let bin2 = p.join("kotlin-language-server");
        if bin2.is_file() {
            return Some(bin2);
        }
    }

    for dir in std::env::split_paths(&path) {
        let kls = dir.join("kotlin-language-server");
        if kls.is_file() {
            return Some(kls);
        }
    }

    None
}

/// Resolve SourceKit-LSP binary.
pub fn resolve_sourcekit_lsp() -> Option<PathBuf> {
    let path = effective_path();

    for dir in std::env::split_paths(&path) {
        let sk = dir.join("sourcekit-lsp");
        if sk.is_file() {
            return Some(sk);
        }
    }

    None
}

/// Resolve ANDROID_HOME directory.
pub fn resolve_android_home() -> Option<String> {
    let config = load_config();
    if let Some(ref a_sdk) = config.android_sdk {
        if Path::new(a_sdk).exists() {
            return Some(a_sdk.clone());
        }
    }

    if let Ok(h) = std::env::var("ANDROID_HOME") {
        if Path::new(&h).exists() {
            return Some(h);
        }
    }

    if let Ok(h) = std::env::var("ANDROID_SDK_ROOT") {
        if Path::new(&h).exists() {
            return Some(h);
        }
    }

    let home = std::env::var_os("HOME").map(PathBuf::from)?;
    let mac = home.join("Library").join("Android").join("sdk");
    if mac.exists() {
        return Some(mac.to_string_lossy().to_string());
    }

    let linux = home.join("Android").join("Sdk");
    if linux.exists() {
        return Some(linux.to_string_lossy().to_string());
    }

    let server = Path::new("/mnt/storage/caches/android-sdk-uqi");
    if server.exists() {
        return Some(server.to_string_lossy().to_string());
    }

    None
}

/// Resolve FLUTTER_ROOT directory.
pub fn resolve_flutter_root(project_root: Option<&Path>) -> Option<String> {
    let config = load_config();
    if let Some(ref f_sdk) = config.flutter_sdk {
        if Path::new(f_sdk).exists() {
            return Some(f_sdk.clone());
        }
    }

    if let Some(f_bin) = resolve_flutter(project_root) {
        if let Some(bin_dir) = f_bin.parent() {
            if let Some(root_dir) = bin_dir.parent() {
                return Some(root_dir.to_string_lossy().to_string());
            }
        }
    }

    std::env::var("FLUTTER_ROOT").ok()
}

/// Kotlin LS status info
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KotlinLsStatus {
    pub installed: bool,
    pub version: Option<String>,
    pub java_ok: bool,
    pub java_version: Option<String>,
    pub message: String,
}

/// Check Kotlin Language Server and Java status.
pub fn kotlin_ls_status() -> KotlinLsStatus {
    let kls_path = resolve_kotlin_ls();
    let installed = kls_path.is_some();

    let version = kls_path.as_ref().and_then(|p| {
        let out = std::process::Command::new(p)
            .arg("--version")
            .output()
            .ok()?;
        let s = String::from_utf8_lossy(&out.stdout);
        let s2 = String::from_utf8_lossy(&out.stderr);
        let combined = format!("{}{}", s.trim(), s2.trim());
        if combined.is_empty() {
            None
        } else {
            Some(combined.trim().to_string())
        }
    });

    let (java_ok, java_version) = check_java();

    let message = if !installed {
        "Kotlin Language Server belum terpasang. Klik Install di panel Toolchains.".to_string()
    } else if !java_ok {
        "JDK belum terinstall. Kotlin LS butuh Java (JDK 11+). Install JDK dulu sebelum pakai Kotlin LS.".to_string()
    } else {
        "Kotlin Language Server siap dipakai.".to_string()
    };

    KotlinLsStatus {
        installed,
        version,
        java_ok,
        java_version,
        message,
    }
}

/// Check if Java is available and its version.
fn check_java() -> (bool, Option<String>) {
    let path = effective_path();
    for dir in std::env::split_paths(&path) {
        let java = dir.join("java");
        if java.is_file() {
            if let Ok(out) = std::process::Command::new(&java).arg("-version").output() {
                let stderr = String::from_utf8_lossy(&out.stderr);
                // java -version outputs to stderr, e.g. "openjdk version \"21.0.3\""
                let ver = stderr
                    .lines()
                    .next()
                    .unwrap_or("")
                    .trim()
                    .to_string();
                return (true, Some(ver));
            }
        }
    }
    (false, None)
}

/// Install Kotlin Language Server from GitHub releases.
/// Downloads server.zip, extracts to app-support dir, chmod +x, verify.
/// Calls `progress` callback with (stage, percent, message).
pub fn kotlin_ls_install<F>(progress: F) -> Result<(), String>
where
    F: Fn(&str, Option<f32>, &str),
{
    let data = dirs::data_dir().ok_or("Tidak bisa menentukan data directory")?;
    let install_dir = data.join("Petak").join("lsp").join("server");

    progress("downloading", Some(0.0), "Mengunduh Kotlin Language Server...");

    // Use curl to download latest release
    // ponytail: use shell curl, no HTTP lib dependency
    let api_out = std::process::Command::new("curl")
        .args([
            "-sL",
            "-H",
            "Accept: application/vnd.github+json",
            "https://api.github.com/repos/fwcd/kotlin-language-server/releases/latest",
        ])
        .output()
        .map_err(|e| format!("curl gagal: {}", e))?;

    let api_json: serde_json::Value =
        serde_json::from_slice(&api_out.stdout).map_err(|e| format!("JSON parse gagal: {}", e))?;

    let assets = api_json["assets"]
        .as_array()
        .ok_or("Tidak ada assets di release")?;

    let zip_url = assets
        .iter()
        .find(|a| {
            a["name"]
                .as_str()
                .map(|n| n.starts_with("server") && n.ends_with(".zip"))
                .unwrap_or(false)
        })
        .and_then(|a| a["browser_download_url"].as_str())
        .ok_or("Tidak menemukan server.zip di release assets")?;

    let tag = api_json["tag_name"].as_str().unwrap_or("unknown");

    progress(
        "downloading",
        Some(10.0),
        &format!("Mengunduh {} versi {}...", zip_url.split('/').next_back().unwrap_or("server.zip"), tag),
    );

    let tmp_dir = tempfile::tempdir().map_err(|e| format!("tmpdir gagal: {}", e))?;
    let zip_path = tmp_dir.path().join("server.zip");

    let dl = std::process::Command::new("curl")
        .args(["-sL", "-o"])
        .arg(&zip_path)
        .arg(zip_url)
        .status()
        .map_err(|e| format!("Download gagal: {}", e))?;

    if !dl.success() {
        return Err("Download server.zip gagal".to_string());
    }

    progress("extracting", Some(50.0), "Mengekstrak server.zip...");

    // Remove old install if exists
    if install_dir.exists() {
        let _ = std::fs::remove_dir_all(&install_dir);
    }
    std::fs::create_dir_all(&install_dir).map_err(|e| format!("Mkdir gagal: {}", e))?;

    let unzip = std::process::Command::new("unzip")
        .args(["-q", "-o"])
        .arg(&zip_path)
        .arg("-d")
        .arg(&install_dir)
        .status()
        .map_err(|e| format!("Unzip gagal: {}", e))?;

    if !unzip.success() {
        return Err("Unzip server.zip gagal".to_string());
    }

    progress("verifying", Some(80.0), "Memverifikasi instalasi...");

    // The zip extracts to server/ subdir. Find the bin.
    let bin_path = install_dir.join("bin").join("kotlin-language-server");
    let bin_alt = install_dir
        .join("server")
        .join("bin")
        .join("kotlin-language-server");
    let actual_bin = if bin_path.is_file() {
        bin_path
    } else if bin_alt.is_file() {
        bin_alt
    } else {
        return Err(format!(
            "kotlin-language-server binary tidak ditemukan setelah extract di {}",
            install_dir.display()
        ));
    };

    // chmod +x
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&actual_bin, std::fs::Permissions::from_mode(0o755));
    }

    // Verify it runs
    let verify = std::process::Command::new(&actual_bin)
        .arg("--version")
        .output();
    match verify {
        Ok(out) if out.status.success() || !out.stderr.is_empty() => {
            // OK — some versions print to stderr
        }
        Ok(out) => {
            let msg = String::from_utf8_lossy(&out.stderr);
            return Err(format!(
                "kotlin-language-server --version gagal: {}",
                msg.trim()
            ));
        }
        Err(e) => {
            return Err(format!("Gagal menjalankan kotlin-language-server: {}", e));
        }
    }

    progress(
        "done",
        Some(100.0),
        &format!("Kotlin Language Server {} berhasil diinstall.", tag),
    );

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_dedup_and_join_paths() {
        let input = vec![
            "/usr/bin".to_string(),
            "/bin".to_string(),
            "/usr/bin".to_string(),
            "/custom/bin".to_string(),
            "".to_string(),
        ];
        let joined = dedup_and_join_paths(&input);
        let parts: Vec<&str> = joined.split(':').collect();
        assert_eq!(parts, vec!["/usr/bin", "/bin", "/custom/bin"]);
    }

    #[test]
    fn test_fake_home_with_sdk_flutter() {
        let tmp = tempfile::tempdir().unwrap();
        let sdk_flutter_bin = tmp
            .path()
            .join("SDK")
            .join("flutter_3.35.7")
            .join("bin");
        std::fs::create_dir_all(&sdk_flutter_bin).unwrap();
        let dart_bin = sdk_flutter_bin
            .join("cache")
            .join("dart-sdk")
            .join("bin");
        std::fs::create_dir_all(&dart_bin).unwrap();

        std::fs::write(sdk_flutter_bin.join("flutter"), "#!/bin/sh\n").unwrap();
        std::fs::write(dart_bin.join("dart"), "#!/bin/sh\n").unwrap();

        let path = compute_effective_path_with(
            Some(tmp.path()),
            None,
            Duration::from_millis(50),
            None,
        );

        assert!(path.contains(&sdk_flutter_bin.to_string_lossy().to_string()));
        assert!(path.contains(&dart_bin.to_string_lossy().to_string()));

        let resolved_dart = resolve_dart_in_path(&path, None, &ToolchainConfig::default());
        assert_eq!(resolved_dart, Some(dart_bin.join("dart")));
    }

    #[test]
    fn test_fvmrc_project() {
        let tmp_home = tempfile::tempdir().unwrap();
        let tmp_proj = tempfile::tempdir().unwrap();

        // Create .fvmrc
        std::fs::write(
            tmp_proj.path().join(".fvmrc"),
            "{\"flutter\": \"3.35.7\"}",
        )
        .unwrap();

        let fvm_ver_bin = tmp_home
            .path()
            .join("fvm")
            .join("versions")
            .join("3.35.7")
            .join("bin");
        std::fs::create_dir_all(&fvm_ver_bin).unwrap();
        std::fs::write(fvm_ver_bin.join("flutter"), "#!/bin/sh\n").unwrap();

        let path = compute_effective_path_with(
            Some(tmp_home.path()),
            Some(tmp_proj.path()),
            Duration::from_millis(50),
            None,
        );

        assert!(path.contains(&fvm_ver_bin.to_string_lossy().to_string()));
    }

    #[test]
    fn test_config_override_wins() {
        let tmp_home = tempfile::tempdir().unwrap();
        let custom_dir = tempfile::tempdir().unwrap();
        let custom_bin = custom_dir.path().join("bin");
        std::fs::create_dir_all(&custom_bin).unwrap();
        std::fs::write(custom_bin.join("flutter"), "#!/bin/sh\n").unwrap();

        let cfg = ToolchainConfig {
            flutter_sdk: Some(custom_dir.path().to_string_lossy().to_string()),
            android_sdk: None,
            kotlin_language_server: None,
        };

        let path = compute_effective_path_with(
            Some(tmp_home.path()),
            None,
            Duration::from_millis(50),
            Some(&cfg),
        );

        // Custom bin must appear first
        let first_entry = path.split(':').next().unwrap();
        assert_eq!(first_entry, custom_bin.to_string_lossy());
    }

    #[test]
    fn test_shell_probe_timeout_does_not_hang() {
        let start = Instant::now();
        // Shell probe with short timeout returns quickly
        let _ = probe_shell_path(Duration::from_millis(200));
        assert!(start.elapsed() < Duration::from_secs(2));
    }
}
