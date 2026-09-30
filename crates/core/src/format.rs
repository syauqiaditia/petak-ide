use std::ffi::OsStr;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FormatResult {
    pub formatted: String,
    pub tool: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FormatRange {
    pub start_line: usize,
    pub end_line: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum FormatError {
    NotFound { tool: String, install_hint: String },
    ExecutionFailed { tool: String, message: String },
    UnsupportedLanguage { lang: String },
}

impl std::fmt::Display for FormatError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NotFound { tool, install_hint } => {
                write!(f, "Formatter '{tool}' tidak ditemukan. {install_hint}")
            }
            Self::ExecutionFailed { tool, message } => {
                write!(f, "Gagal menjalankan formatter '{tool}': {message}")
            }
            Self::UnsupportedLanguage { lang } => {
                write!(f, "Bahasa '{lang}' tidak didukung untuk pemformatan kode")
            }
        }
    }
}

impl std::error::Error for FormatError {}

/// Format text using the appropriate formatter for `lang`.
pub fn format_text(
    lang: &str,
    text: &str,
    range: Option<FormatRange>,
) -> Result<FormatResult, FormatError> {
    format_text_with_path(lang, text, range, None)
}

/// Format text with optional custom PATH (useful for testing fallback paths).
pub fn format_text_with_path(
    lang: &str,
    text: &str,
    _range: Option<FormatRange>,
    custom_path: Option<&OsStr>,
) -> Result<FormatResult, FormatError> {
    let normalized = lang.trim().to_lowercase();
    match normalized.as_str() {
        "json" => format_json(text),
        "dart" => format_dart(text, custom_path),
        "swift" => format_swift(text, custom_path),
        "kotlin" | "kt" => format_kotlin(text, custom_path),
        "yaml" | "yml" | "html" | "css" | "javascript" | "js" | "typescript" | "ts"
        | "markdown" | "md" => format_prettier(&normalized, text, custom_path),
        _ => Err(FormatError::UnsupportedLanguage {
            lang: lang.to_string(),
        }),
    }
}

/// Format JSON using built-in serde_json (indent 2).
fn format_json(text: &str) -> Result<FormatResult, FormatError> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Ok(FormatResult {
            formatted: String::new(),
            tool: "serde_json".to_string(),
        });
    }

    let val: serde_json::Value =
        serde_json::from_str(trimmed).map_err(|e| FormatError::ExecutionFailed {
            tool: "serde_json".to_string(),
            message: format!("Format JSON tidak valid: {}", e),
        })?;

    let mut formatted =
        serde_json::to_string_pretty(&val).map_err(|e| FormatError::ExecutionFailed {
            tool: "serde_json".to_string(),
            message: e.to_string(),
        })?;

    if text.ends_with('\n') {
        formatted.push('\n');
    }

    Ok(FormatResult {
        formatted,
        tool: "serde_json".to_string(),
    })
}

/// Helper to search a binary name in effective PATH or custom PATH.
fn find_binary(name: &str, custom_path: Option<&OsStr>) -> Option<PathBuf> {
    let path_val = if let Some(cp) = custom_path {
        cp.to_os_string()
    } else {
        std::ffi::OsString::from(crate::toolchain::effective_path())
    };

    for dir in std::env::split_paths(&path_val) {
        if dir.as_os_str().is_empty() {
            continue;
        }
        let candidate = dir.join(name);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

/// Format Dart code via `dart format` (stdin).
fn format_dart(text: &str, custom_path: Option<&OsStr>) -> Result<FormatResult, FormatError> {
    let dart_bin = if let Some(cp) = custom_path {
        find_binary("dart", Some(cp))
    } else {
        crate::toolchain::resolve_dart(None).or_else(|| find_binary("dart", None))
    };

    let bin = dart_bin.ok_or_else(|| FormatError::NotFound {
        tool: "dart format".to_string(),
        install_hint: "Install Dart SDK atau Flutter SDK untuk memformat file Dart.".to_string(),
    })?;

    run_formatter_stdin(&bin, &["format", "-o", "show"], text, "dart format")
}

/// Format Swift code via swift-format / swiftformat / xcrun swift-format.
fn format_swift(text: &str, custom_path: Option<&OsStr>) -> Result<FormatResult, FormatError> {
    if let Some(bin) = find_binary("swift-format", custom_path) {
        return run_formatter_stdin(&bin, &[], text, "swift-format");
    }

    if let Some(bin) = find_binary("swiftformat", custom_path) {
        return run_formatter_stdin(&bin, &["--quiet"], text, "swiftformat");
    }

    #[cfg(target_os = "macos")]
    {
        if let Some(xcrun) = find_binary("xcrun", custom_path) {
            if let Ok(res) =
                run_formatter_stdin(&xcrun, &["swift-format"], text, "xcrun swift-format")
            {
                return Ok(res);
            }
        }
    }

    Err(FormatError::NotFound {
        tool: "swift-format".to_string(),
        install_hint: "Pasang swift-format ('brew install swift-format') atau swiftformat ('brew install swiftformat').".to_string(),
    })
}

/// Format Kotlin code via ktlint or ktfmt if detected.
fn format_kotlin(text: &str, custom_path: Option<&OsStr>) -> Result<FormatResult, FormatError> {
    if let Some(bin) = find_binary("ktlint", custom_path) {
        return run_formatter_stdin(&bin, &["--format", "--stdin"], text, "ktlint");
    }

    if let Some(bin) = find_binary("ktfmt", custom_path) {
        return run_formatter_stdin(&bin, &["-"], text, "ktfmt");
    }

    Err(FormatError::NotFound {
        tool: "ktlint / ktfmt".to_string(),
        install_hint: "Kotlin formatting didukung via LSP (fwcd). Untuk standalone, pasang ktlint ('brew install ktlint') atau ktfmt.".to_string(),
    })
}

/// Format YAML, HTML, CSS, JS, TS, MD via Prettier (npx / prettier).
fn format_prettier(
    lang: &str,
    text: &str,
    custom_path: Option<&OsStr>,
) -> Result<FormatResult, FormatError> {
    let dummy_ext = match lang {
        "yaml" | "yml" => "dummy.yaml",
        "html" => "dummy.html",
        "css" => "dummy.css",
        "javascript" | "js" => "dummy.js",
        "typescript" | "ts" => "dummy.ts",
        "markdown" | "md" => "dummy.md",
        _ => "dummy.txt",
    };

    if let Some(bin) = find_binary("prettier", custom_path) {
        return run_formatter_stdin(&bin, &["--stdin-filepath", dummy_ext], text, "prettier");
    }

    if let Some(bin) = find_binary("npx", custom_path) {
        return run_formatter_stdin(
            &bin,
            &["--no-install", "prettier", "--stdin-filepath", dummy_ext],
            text,
            "npx prettier",
        );
    }

    Err(FormatError::NotFound {
        tool: "prettier".to_string(),
        install_hint: "Pasang Prettier via npm: 'npm install -g prettier'.".to_string(),
    })
}

/// Pipe text to child stdin and capture stdout.
fn run_formatter_stdin(
    bin: &Path,
    args: &[&str],
    text: &str,
    tool_name: &str,
) -> Result<FormatResult, FormatError> {
    let mut cmd = Command::new(bin);
    cmd.args(args);
    cmd.stdin(Stdio::piped());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| FormatError::ExecutionFailed {
        tool: tool_name.to_string(),
        message: format!("Gagal menjalankan {}: {}", tool_name, e),
    })?;

    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.write_all(text.as_bytes());
    }

    let output = child
        .wait_with_output()
        .map_err(|e| FormatError::ExecutionFailed {
            tool: tool_name.to_string(),
            message: e.to_string(),
        })?;

    if output.status.success() {
        let formatted = String::from_utf8_lossy(&output.stdout).to_string();
        Ok(FormatResult {
            formatted,
            tool: tool_name.to_string(),
        })
    } else {
        let err = String::from_utf8_lossy(&output.stderr);
        Err(FormatError::ExecutionFailed {
            tool: tool_name.to_string(),
            message: err.trim().to_string(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::OsString;

    #[test]
    fn test_format_json_pretty() {
        let input = r#"{"name":"Petak","version":"1.0","tags":[1,2,3]}"#;
        let res = format_text("json", input, None).expect("JSON formatting should succeed");
        assert_eq!(res.tool, "serde_json");
        let expected = "{\n  \"name\": \"Petak\",\n  \"tags\": [\n    1,\n    2,\n    3\n  ],\n  \"version\": \"1.0\"\n}";
        assert_eq!(res.formatted.trim(), expected);
    }

    #[test]
    fn test_format_json_invalid() {
        let input = "{ bad json ";
        let err = format_text("json", input, None).unwrap_err();
        match err {
            FormatError::ExecutionFailed { tool, message } => {
                assert_eq!(tool, "serde_json");
                assert!(message.contains("tidak valid") || message.contains("line"));
            }
            _ => panic!("Expected ExecutionFailed for bad JSON"),
        }
    }

    #[test]
    fn test_unsupported_language() {
        let err = format_text("brainfuck", "++--", None).unwrap_err();
        assert_eq!(
            err,
            FormatError::UnsupportedLanguage {
                lang: "brainfuck".to_string()
            }
        );
    }

    #[test]
    fn test_fallback_tools_not_found_on_empty_path() {
        let empty_path = OsString::from("");

        // Dart
        let err_dart =
            format_text_with_path("dart", "void main(){}", None, Some(&empty_path)).unwrap_err();
        assert!(
            matches!(err_dart, FormatError::NotFound { ref tool, .. } if tool == "dart format")
        );

        // Swift
        let err_swift =
            format_text_with_path("swift", "func foo(){}", None, Some(&empty_path)).unwrap_err();
        assert!(
            matches!(err_swift, FormatError::NotFound { ref tool, .. } if tool == "swift-format")
        );

        // Kotlin
        let err_kt =
            format_text_with_path("kotlin", "fun main(){}", None, Some(&empty_path)).unwrap_err();
        assert!(
            matches!(err_kt, FormatError::NotFound { ref tool, .. } if tool == "ktlint / ktfmt")
        );

        // YAML / Prettier
        let err_yaml = format_text_with_path("yaml", "a: 1", None, Some(&empty_path)).unwrap_err();
        assert!(matches!(err_yaml, FormatError::NotFound { ref tool, .. } if tool == "prettier"));

        // Markdown / Prettier
        let err_md =
            format_text_with_path("markdown", "# Title", None, Some(&empty_path)).unwrap_err();
        assert!(matches!(err_md, FormatError::NotFound { ref tool, .. } if tool == "prettier"));
    }

    #[test]
    fn test_fake_formatter_script() {
        let tmp = tempfile::tempdir().unwrap();
        let fake_bin = tmp.path().join("swift-format");
        #[cfg(unix)]
        {
            std::fs::write(&fake_bin, "#!/bin/sh\necho '// formatted swift'\n").unwrap();
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&fake_bin, std::fs::Permissions::from_mode(0o755)).unwrap();

            let res = format_text_with_path(
                "swift",
                "func test() {}",
                None,
                Some(tmp.path().as_os_str()),
            )
            .unwrap();
            assert_eq!(res.tool, "swift-format");
            assert!(res.formatted.contains("// formatted swift"));
        }
    }
}
