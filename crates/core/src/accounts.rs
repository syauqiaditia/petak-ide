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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TokenStatus {
    pub ok: bool,
    pub user: String,
    pub scopes: Vec<String>,
    pub expires_at: Option<String>,
    pub days_until_expiry: Option<i64>,
    pub is_expiring_soon: bool,
    pub is_expired: bool,
    pub scope_valid: bool,
    pub message: String,
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

    // Fallback: check standard ~/.gitlab-pat or ~/.gitlab_token
    if let Some(home) = dirs::home_dir() {
        for name in &[".gitlab-pat", ".gitlab_token"] {
            let p = home.join(name);
            if p.is_file() {
                if let Ok(content) = fs::read_to_string(&p) {
                    let token = content.trim().to_string();
                    if !token.is_empty() {
                        return Ok(Some(token));
                    }
                }
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
    let status = accounts_check_token_with_url_and_token(url, token)?;
    Ok(AccountTestResult {
        ok: status.ok,
        user: status.user,
    })
}

/// Full token validation: scopes, expiry, fallback to /api/v4/user if /personal_access_tokens/self 404.
pub fn accounts_check_token_with_url_and_token(url: &str, token: &str) -> Result<TokenStatus, String> {
    let clean_url = url.trim().trim_end_matches('/');
    let agent = ureq::AgentBuilder::new()
        .timeout(std::time::Duration::from_secs(10))
        .build();

    // Try /personal_access_tokens/self first
    let self_endpoint = format!("{}/api/v4/personal_access_tokens/self", clean_url);
    let self_resp = agent.get(&self_endpoint).set("PRIVATE-TOKEN", token).call();

    match self_resp {
        Ok(resp) => {
            let body = resp.into_string()
                .map_err(|e| format!("Gagal membaca respons: {}", e))?;
            let val: serde_json::Value = serde_json::from_str(&body)
                .map_err(|e| format!("Respons JSON tidak valid: {}", e))?;
            parse_token_self_response(&val)
        }
        Err(ureq::Error::Status(404, _)) => {
            // Fallback: old GitLab without /personal_access_tokens/self
            let user_endpoint = format!("{}/api/v4/user", clean_url);
            let user_resp = agent.get(&user_endpoint).set("PRIVATE-TOKEN", token).call();
            match user_resp {
                Ok(resp) => {
                    let body = resp.into_string()
                        .map_err(|e| format!("Gagal membaca respons: {}", e))?;
                    let val: serde_json::Value = serde_json::from_str(&body)
                        .map_err(|e| format!("Respons JSON tidak valid: {}", e))?;
                    let username = val["username"].as_str()
                        .or_else(|| val["name"].as_str())
                        .unwrap_or("user")
                        .to_string();
                    Ok(TokenStatus {
                        ok: true,
                        user: username,
                        scopes: vec![],
                        expires_at: None,
                        days_until_expiry: None,
                        is_expiring_soon: false,
                        is_expired: false,
                        scope_valid: true, // can't check scopes via /user fallback
                        message: "Koneksi berhasil (scope/expiry tidak tersedia pada versi GitLab ini)".to_string(),
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

fn parse_token_self_response(val: &serde_json::Value) -> Result<TokenStatus, String> {
    let user = val["name"].as_str()
        .unwrap_or("user")
        .to_string();

    let scopes: Vec<String> = val["scopes"]
        .as_array()
        .map(|arr| arr.iter().filter_map(|v| v.as_str().map(String::from)).collect())
        .unwrap_or_default();

    let scope_valid = scopes.iter().any(|s| s == "read_api" || s == "api");

    let expires_at = val["expires_at"].as_str().map(String::from);

    let (days_until_expiry, is_expired, is_expiring_soon) = if let Some(ref exp_str) = expires_at {
        if let Ok(exp_date) = chrono::NaiveDate::parse_from_str(exp_str, "%Y-%m-%d") {
            let today = chrono::Utc::now().date_naive();
            let days = (exp_date - today).num_days();
            (Some(days), days < 0, days >= 0 && days <= 14)
        } else {
            (None, false, false)
        }
    } else {
        (None, false, false)
    };

    let message = if is_expired {
        "Token GitLab sudah kadaluarsa".to_string()
    } else if !scope_valid {
        "Token tidak memiliki scope read_api atau api".to_string()
    } else if is_expiring_soon {
        format!("Token GitLab akan kadaluarsa dalam {} hari", days_until_expiry.unwrap_or(0))
    } else {
        "Token valid".to_string()
    };

    let ok = scope_valid && !is_expired;

    Ok(TokenStatus {
        ok,
        user,
        scopes,
        expires_at,
        days_until_expiry,
        is_expiring_soon,
        is_expired,
        scope_valid,
        message,
    })
}

/// Check token status using stored URL & token from secure storage.
pub fn accounts_check_token_status() -> Result<TokenStatus, String> {
    let cfg = load_config();
    let url = cfg.gitlab_url.unwrap_or_else(|| "https://gitlab.com".to_string());
    let token = load_secure_token()
        .map_err(|e| format!("Gagal membaca token: {}", e))?
        .ok_or_else(|| "Token GitLab belum tersimpan. Masukkan token terlebih dahulu.".to_string())?;
    accounts_check_token_with_url_and_token(&url, &token)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::thread;

    fn json_header() -> tiny_http::Header {
        tiny_http::Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..]).unwrap()
    }

    #[test]
    fn test_accounts_token_storage_lifecycle() {
        let test_token = "«redacted:glpat-…»";
        save_secure_token(test_token).unwrap();

        let loaded = load_secure_token().unwrap();
        assert_eq!(loaded.as_deref(), Some(test_token));

        delete_secure_token().unwrap();
        let after_delete = load_secure_token().unwrap();
        assert_eq!(after_delete, None);
    }

    #[test]
    fn test_accounts_test_mock_server_success() {
        // Now hits /personal_access_tokens/self first
        let server = tiny_http::Server::http("127.0.0.1:0").unwrap();
        let port = server.server_addr().to_ip().unwrap().port();
        let mock_url = format!("http://127.0.0.1:{}", port);

        let handle = thread::spawn(move || {
            let request = server.recv().unwrap();
            assert_eq!(request.url(), "/api/v4/personal_access_tokens/self");
            let token_header = request
                .headers()
                .iter()
                .find(|h| h.field.equiv("PRIVATE-TOKEN"))
                .map(|h| h.value.as_str().to_string());
            assert_eq!(token_header.as_deref(), Some("valid-glpat-token"));

            let response = tiny_http::Response::from_string(
                r#"{"id":1,"name":"developer","scopes":["api","read_user"],"expires_at":"2028-12-31"}"#,
            )
            .with_status_code(200)
            .with_header(json_header());
            request.respond(response).unwrap();
        });

        let res = accounts_test_with_url_and_token(&mock_url, "valid-glpat-token").unwrap();
        assert!(res.ok);
        assert_eq!(res.user, "developer");

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

    #[test]
    fn test_token_status_valid_scope_safe_expiry() {
        let server = tiny_http::Server::http("127.0.0.1:0").unwrap();
        let port = server.server_addr().to_ip().unwrap().port();
        let mock_url = format!("http://127.0.0.1:{}", port);

        let handle = thread::spawn(move || {
            let request = server.recv().unwrap();
            assert_eq!(request.url(), "/api/v4/personal_access_tokens/self");
            let response = tiny_http::Response::from_string(
                r#"{"id":1,"name":"developer","scopes":["api","read_user"],"expires_at":"2028-12-31"}"#,
            )
            .with_status_code(200)
            .with_header(json_header());
            request.respond(response).unwrap();
        });

        let status = accounts_check_token_with_url_and_token(&mock_url, "tok").unwrap();
        assert!(status.ok);
        assert!(status.scope_valid);
        assert!(!status.is_expired);
        assert!(!status.is_expiring_soon);
        assert!(status.days_until_expiry.unwrap() > 14);
        assert_eq!(status.message, "Token valid");

        handle.join().unwrap();
    }

    #[test]
    fn test_token_status_expiring_soon() {
        let server = tiny_http::Server::http("127.0.0.1:0").unwrap();
        let port = server.server_addr().to_ip().unwrap().port();
        let mock_url = format!("http://127.0.0.1:{}", port);

        // expires in 5 days from now
        let soon = (chrono::Utc::now().date_naive() + chrono::Duration::days(5))
            .format("%Y-%m-%d")
            .to_string();

        let handle = thread::spawn(move || {
            let request = server.recv().unwrap();
            let body = format!(
                r#"{{"id":1,"name":"dev","scopes":["read_api"],"expires_at":"{}"}}"#,
                soon
            );
            let response = tiny_http::Response::from_string(body)
                .with_status_code(200)
                .with_header(json_header());
            request.respond(response).unwrap();
        });

        let status = accounts_check_token_with_url_and_token(&mock_url, "tok").unwrap();
        assert!(status.ok);
        assert!(status.is_expiring_soon);
        assert!(!status.is_expired);
        assert!(status.message.contains("kadaluarsa dalam"));

        handle.join().unwrap();
    }

    #[test]
    fn test_token_status_expired() {
        let server = tiny_http::Server::http("127.0.0.1:0").unwrap();
        let port = server.server_addr().to_ip().unwrap().port();
        let mock_url = format!("http://127.0.0.1:{}", port);

        let handle = thread::spawn(move || {
            let request = server.recv().unwrap();
            let response = tiny_http::Response::from_string(
                r#"{"id":1,"name":"dev","scopes":["api"],"expires_at":"2020-01-01"}"#,
            )
            .with_status_code(200)
            .with_header(json_header());
            request.respond(response).unwrap();
        });

        let status = accounts_check_token_with_url_and_token(&mock_url, "tok").unwrap();
        assert!(!status.ok);
        assert!(status.is_expired);
        assert_eq!(status.message, "Token GitLab sudah kadaluarsa");

        handle.join().unwrap();
    }

    #[test]
    fn test_token_status_invalid_scope() {
        let server = tiny_http::Server::http("127.0.0.1:0").unwrap();
        let port = server.server_addr().to_ip().unwrap().port();
        let mock_url = format!("http://127.0.0.1:{}", port);

        let handle = thread::spawn(move || {
            let request = server.recv().unwrap();
            let response = tiny_http::Response::from_string(
                r#"{"id":1,"name":"dev","scopes":["read_user"],"expires_at":"2028-12-31"}"#,
            )
            .with_status_code(200)
            .with_header(json_header());
            request.respond(response).unwrap();
        });

        let status = accounts_check_token_with_url_and_token(&mock_url, "tok").unwrap();
        assert!(!status.ok);
        assert!(!status.scope_valid);
        assert_eq!(status.message, "Token tidak memiliki scope read_api atau api");

        handle.join().unwrap();
    }

    #[test]
    fn test_token_status_fallback_user_endpoint() {
        let server = tiny_http::Server::http("127.0.0.1:0").unwrap();
        let port = server.server_addr().to_ip().unwrap().port();
        let mock_url = format!("http://127.0.0.1:{}", port);

        let handle = thread::spawn(move || {
            // First request: /personal_access_tokens/self -> 404
            let req1 = server.recv().unwrap();
            assert_eq!(req1.url(), "/api/v4/personal_access_tokens/self");
            let resp1 = tiny_http::Response::from_string(r#"{"error":"Not Found"}"#)
                .with_status_code(404);
            req1.respond(resp1).unwrap();

            // Second request: /user -> 200
            let req2 = server.recv().unwrap();
            assert_eq!(req2.url(), "/api/v4/user");
            let resp2 = tiny_http::Response::from_string(
                r#"{"id":42,"username":"developer","name":"Lead Developer"}"#,
            )
            .with_status_code(200)
            .with_header(json_header());
            req2.respond(resp2).unwrap();
        });

        let status = accounts_check_token_with_url_and_token(&mock_url, "tok").unwrap();
        assert!(status.ok);
        assert_eq!(status.user, "developer");
        assert!(status.scope_valid); // assumed valid on fallback
        assert!(status.scopes.is_empty());
        assert!(status.message.contains("scope/expiry tidak tersedia"));

        handle.join().unwrap();
    }
}
