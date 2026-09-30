use std::fs;
use std::io;
use std::path::PathBuf;
use serde::{Deserialize, Serialize};

use crate::toolchain::{config_path, load_config, save_config};

#[allow(dead_code)]
const KEYCHAIN_SERVICE: &str = "petak";
#[allow(dead_code)]
const KEYCHAIN_ACCOUNT: &str = "petak_gitlab_token";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AccountInfo {
    pub url: String,
    pub has_token: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AccountTestResult {
    pub ok: bool,
    pub user: String,
}

fn token_file_path() -> Option<PathBuf> {
    config_path().and_then(|p| p.parent().map(|d| d.join(".gitlab_token")))
}

/// Save token securely.
/// On macOS, uses macOS Keychain via `security` CLI with file fallback.
/// On Linux/other, stores in config directory file with 0600 permissions.
pub fn save_secure_token(token: &str) -> io::Result<()> {
    #[cfg(target_os = "macos")]
    {
        let status = std::process::Command::new("security")
            .args([
                "add-generic-password",
                "-a",
                KEYCHAIN_SERVICE,
                "-s",
                KEYCHAIN_ACCOUNT,
                "-w",
                token,
                "-U",
            ])
            .status();

        if let Ok(st) = status {
            if st.success() {
                return Ok(());
            }
        }
    }

    // Fallback: file with 0600 permissions
    let path = token_file_path().ok_or_else(|| {
        io::Error::new(io::ErrorKind::NotFound, "Could not determine config directory")
    })?;

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }

    fs::write(&path, token.trim())?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&path, fs::Permissions::from_mode(0o600));
    }

    Ok(())
}

/// Load token securely. Never log or return the token to untrusted callers.
pub fn load_secure_token() -> io::Result<Option<String>> {
    #[cfg(target_os = "macos")]
    {
        if let Ok(out) = std::process::Command::new("security")
            .args([
                "find-generic-password",
                "-a",
                KEYCHAIN_SERVICE,
                "-s",
                KEYCHAIN_ACCOUNT,
                "-w",
            ])
            .output()
        {
            if out.status.success() {
                let token = String::from_utf8_lossy(&out.stdout).trim().to_string();
                if !token.is_empty() {
                    return Ok(Some(token));
                }
            }
        }
    }

    if let Some(path) = token_file_path() {
        if path.is_file() {
            let content = fs::read_to_string(&path)?;
            let token = content.trim().to_string();
            if !token.is_empty() {
                return Ok(Some(token));
            }
        }
    }

    Ok(None)
}

/// Delete token from secure storage.
pub fn delete_secure_token() -> io::Result<()> {
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("security")
            .args([
                "delete-generic-password",
                "-a",
                KEYCHAIN_SERVICE,
                "-s",
                KEYCHAIN_ACCOUNT,
            ])
            .status();
    }

    if let Some(path) = token_file_path() {
        if path.exists() {
            let _ = fs::remove_file(&path);
        }
    }

    Ok(())
}

/// Get current GitLab accounts info (URL and hasToken flag).
/// Token is NEVER returned to the webview/log.
pub fn accounts_get() -> AccountInfo {
    let cfg = load_config();
    let url = cfg
        .gitlab_url
        .unwrap_or_else(|| "https://gitlab.com".to_string());
    let has_token = load_secure_token()
        .map(|t| t.is_some())
        .unwrap_or(false);
    AccountInfo { url, has_token }
}

/// Save GitLab account settings (URL and PAT).
pub fn accounts_save(url: &str, token: &str) -> Result<(), String> {
    let clean_url = url.trim().trim_end_matches('/').to_string();
    if clean_url.is_empty() {
        return Err("URL GitLab tidak boleh kosong".to_string());
    }

    save_secure_token(token.trim()).map_err(|e| format!("Gagal menyimpan token: {}", e))?;

    let mut cfg = load_config();
    cfg.gitlab_url = Some(clean_url);
    save_config(&cfg).map_err(|e| format!("Gagal menyimpan konfigurasi: {}", e))?;

    Ok(())
}

/// Clear GitLab account settings and delete saved token.
pub fn accounts_clear() -> Result<(), String> {
    delete_secure_token().map_err(|e| format!("Gagal menghapus token: {}", e))?;

    let mut cfg = load_config();
    cfg.gitlab_url = None;
    save_config(&cfg).map_err(|e| format!("Gagal memperbarui konfigurasi: {}", e))?;

    Ok(())
}

/// Test connection to GitLab using stored URL and stored token.
pub fn accounts_test() -> Result<AccountTestResult, String> {
    let cfg = load_config();
    let url = cfg
        .gitlab_url
        .unwrap_or_else(|| "https://gitlab.com".to_string());

    let token = load_secure_token()
        .map_err(|e| format!("Gagal membaca token: {}", e))?
        .ok_or_else(|| "Token GitLab belum tersimpan. Masukkan token terlebih dahulu.".to_string())?;

    accounts_test_with_url_and_token(&url, &token)
}

/// Test connection with specific URL and token (used directly and in mock tests).
pub fn accounts_test_with_url_and_token(url: &str, token: &str) -> Result<AccountTestResult, String> {
    let clean_url = url.trim().trim_end_matches('/');
    let endpoint = format!("{}/api/v4/user", clean_url);

    let agent = ureq::AgentBuilder::new()
        .timeout(std::time::Duration::from_secs(10))
        .build();

    let response = agent
        .get(&endpoint)
        .set("PRIVATE-TOKEN", token)
        .call();

    match response {
        Ok(resp) => {
            let body = resp
                .into_string()
                .map_err(|e| format!("Gagal membaca respons dari GitLab: {}", e))?;
            let val: serde_json::Value =
                serde_json::from_str(&body).map_err(|e| format!("Respons JSON tidak valid: {}", e))?;
            let username = val["username"]
                .as_str()
                .or_else(|| val["name"].as_str())
                .unwrap_or("user")
                .to_string();
            Ok(AccountTestResult {
                ok: true,
                user: username,
            })
        }
        Err(ureq::Error::Status(401, _)) => {
            Err("Autentikasi gagal: Token GitLab tidak valid atau sudah kadaluarsa (HTTP 401)".to_string())
        }
        Err(ureq::Error::Status(403, _)) => {
            Err("Akses ditolak: Token tidak memiliki izin yang cukup (HTTP 403)".to_string())
        }
        Err(ureq::Error::Status(status, resp)) => {
            let err_body = resp.into_string().unwrap_or_default();
            Err(format!("GitLab mengembalikan HTTP {}: {}", status, err_body))
        }
        Err(ureq::Error::Transport(e)) => {
            Err(format!("Gagal terhubung ke GitLab: {}", e))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::thread;

    #[test]
    fn test_accounts_token_storage_lifecycle() {
        let test_token = "glpat-test-secret-token-xyz123";
        save_secure_token(test_token).unwrap();

        let loaded = load_secure_token().unwrap();
        assert_eq!(loaded.as_deref(), Some(test_token));

        delete_secure_token().unwrap();
        let after_delete = load_secure_token().unwrap();
        assert_eq!(after_delete, None);
    }

    #[test]
    fn test_accounts_test_mock_server_success() {
        let server = tiny_http::Server::http("127.0.0.1:0").unwrap();
        let port = server.server_addr().to_ip().unwrap().port();
        let mock_url = format!("http://127.0.0.1:{}", port);

        let handle = thread::spawn(move || {
            let request = server.recv().unwrap();
            assert_eq!(request.url(), "/api/v4/user");
            let token_header = request
                .headers()
                .iter()
                .find(|h| h.field.equiv("PRIVATE-TOKEN"))
                .map(|h| h.value.as_str().to_string());
            assert_eq!(token_header.as_deref(), Some("valid-glpat-token"));

            let response = tiny_http::Response::from_string(
                r#"{"id":42,"username":"syauqi","name":"Muhammad Syauqi"}"#,
            )
            .with_status_code(200)
            .with_header(
                tiny_http::Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..]).unwrap(),
            );
            request.respond(response).unwrap();
        });

        let res = accounts_test_with_url_and_token(&mock_url, "valid-glpat-token").unwrap();
        assert!(res.ok);
        assert_eq!(res.user, "syauqi");

        handle.join().unwrap();
    }

    #[test]
    fn test_accounts_test_mock_server_401() {
        let server = tiny_http::Server::http("127.0.0.1:0").unwrap();
        let port = server.server_addr().to_ip().unwrap().port();
        let mock_url = format!("http://127.0.0.1:{}", port);

        let handle = thread::spawn(move || {
            let request = server.recv().unwrap();
            let response = tiny_http::Response::from_string(r#"{"message":"401 Unauthorized"}"#)
                .with_status_code(401);
            request.respond(response).unwrap();
        });

        let err = accounts_test_with_url_and_token(&mock_url, "bad-token").unwrap_err();
        assert!(err.contains("401") || err.contains("Autentikasi gagal"));

        handle.join().unwrap();
    }
}
