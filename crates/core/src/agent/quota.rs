use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProviderQuotaInfo {
    pub id: String,
    pub provider: String,
    pub name: Option<String>,
    pub is_active: bool,
    pub last_error: Option<String>,
    pub rate_limited_until: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LlmQuotaReport {
    pub proxy_online: bool,
    pub db_found: bool,
    pub today_date: String,
    pub today_requests: u64,
    pub today_prompt_tokens: u64,
    pub today_completion_tokens: u64,
    pub today_cost: f64,
    pub providers: Vec<ProviderQuotaInfo>,
    pub status_message: String,
}

pub fn civil_from_days(days: i64) -> (i32, u32, u32) {
    let z = days + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = (z - era * 146097) as u32;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = (yoe as i64) + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    (y as i32, m, d)
}

pub fn get_today_date_string() -> String {
    let now = SystemTime::now();
    let duration = now.duration_since(UNIX_EPOCH).unwrap_or_default();
    let days = (duration.as_secs() / 86400) as i64;
    let (y, m, d) = civil_from_days(days);
    format!("{:04}-{:02}-{:02}", y, m, d)
}

pub fn check_proxy_online(proxy_url: Option<&str>) -> bool {
    let url = proxy_url.unwrap_or("http://127.0.0.1:20128/v1/models");
    match ureq::get(url).timeout(Duration::from_millis(1000)).call() {
        Ok(resp) => resp.status() == 200,
        Err(ureq::Error::Status(code, _)) => code < 500,
        Err(_) => false,
    }
}

pub fn find_sqlite3_bin() -> Option<PathBuf> {
    if let Ok(path) = std::env::var("PATH") {
        for dir in std::env::split_paths(&path) {
            let candidate = dir.join("sqlite3");
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    for candidate in &[
        "/usr/bin/sqlite3",
        "/usr/local/bin/sqlite3",
        "/opt/homebrew/bin/sqlite3",
    ] {
        let p = PathBuf::from(candidate);
        if p.is_file() {
            return Some(p);
        }
    }
    None
}

fn run_sqlite_json_query(
    sqlite_bin: &Path,
    db_path: &Path,
    sql: &str,
) -> Option<serde_json::Value> {
    let output = Command::new(sqlite_bin)
        .arg("-json")
        .arg(db_path)
        .arg(sql)
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }
    let text = std::str::from_utf8(&output.stdout).ok()?.trim();
    if text.is_empty() {
        return None;
    }
    serde_json::from_str(text).ok()
}

pub fn default_quota_report(proxy_online: bool) -> LlmQuotaReport {
    LlmQuotaReport {
        proxy_online,
        db_found: false,
        today_date: get_today_date_string(),
        today_requests: 0,
        today_prompt_tokens: 0,
        today_completion_tokens: 0,
        today_cost: 0.0,
        providers: Vec::new(),
        status_message: "Tidak tersedia".to_string(),
    }
}

pub fn probe_llm_quota() -> LlmQuotaReport {
    probe_llm_quota_internal(None, None)
}

pub fn probe_llm_quota_internal(
    db_override: Option<&Path>,
    proxy_url_override: Option<&str>,
) -> LlmQuotaReport {
    let proxy_online = check_proxy_online(proxy_url_override);

    let db_path = match db_override {
        Some(p) => p.to_path_buf(),
        None => match dirs::home_dir() {
            Some(home) => home.join(".9router").join("db").join("data.sqlite"),
            None => return default_quota_report(proxy_online),
        },
    };

    if !db_path.exists() {
        return default_quota_report(proxy_online);
    }

    let sqlite_bin = match find_sqlite3_bin() {
        Some(bin) => bin,
        None => return default_quota_report(proxy_online),
    };

    // Check if tables exist and have data
    let count_json = run_sqlite_json_query(
        &sqlite_bin,
        &db_path,
        "SELECT (\
            (SELECT count(*) FROM sqlite_master WHERE type='table' AND name='usageDaily') + \
            (SELECT count(*) FROM sqlite_master WHERE type='table' AND name='providerConnections') + \
            (SELECT count(*) FROM sqlite_master WHERE type='table' AND name='providerNodes')\
         ) as table_count;",
    );

    let table_count = count_json
        .as_ref()
        .and_then(|v| v.as_array())
        .and_then(|arr| arr.first())
        .and_then(|obj| obj.get("table_count"))
        .and_then(|v| v.as_i64())
        .unwrap_or(0);

    if table_count == 0 {
        return default_quota_report(proxy_online);
    }

    let mut today_date = get_today_date_string();
    let mut today_requests: u64 = 0;
    let mut today_prompt_tokens: u64 = 0;
    let mut today_completion_tokens: u64 = 0;
    let mut today_cost: f64 = 0.0;

    let usage_json = run_sqlite_json_query(
        &sqlite_bin,
        &db_path,
        "SELECT dateKey, data FROM usageDaily WHERE dateKey = date('now') OR dateKey = date('now', 'localtime') ORDER BY dateKey DESC LIMIT 1;",
    );

    if let Some(serde_json::Value::Array(rows)) = usage_json {
        if let Some(row) = rows.first() {
            if let Some(dk) = row.get("dateKey").and_then(|v| v.as_str()) {
                today_date = dk.to_string();
            }
            if let Some(data_str) = row.get("data").and_then(|v| v.as_str()) {
                if let Ok(data_obj) = serde_json::from_str::<serde_json::Value>(data_str) {
                    today_requests = data_obj
                        .get("requests")
                        .and_then(|v| v.as_u64())
                        .unwrap_or(0);
                    today_prompt_tokens = data_obj
                        .get("promptTokens")
                        .or_else(|| data_obj.get("prompt_tokens"))
                        .and_then(|v| v.as_u64())
                        .unwrap_or(0);
                    today_completion_tokens = data_obj
                        .get("completionTokens")
                        .or_else(|| data_obj.get("completion_tokens"))
                        .and_then(|v| v.as_u64())
                        .unwrap_or(0);
                    today_cost = data_obj.get("cost").and_then(|v| v.as_f64()).unwrap_or(0.0);
                }
            }
        }
    }

    let mut providers: Vec<ProviderQuotaInfo> = Vec::new();
    let mut seen_ids: HashSet<String> = HashSet::new();

    let conn_json = run_sqlite_json_query(
        &sqlite_bin,
        &db_path,
        "SELECT id, provider, name, isActive, data FROM providerConnections;",
    );

    if let Some(serde_json::Value::Array(rows)) = conn_json {
        for row in rows {
            let id = match row.get("id").and_then(|v| v.as_str()) {
                Some(i) if !i.is_empty() => i.to_string(),
                _ => continue,
            };
            seen_ids.insert(id.clone());
            let provider = row
                .get("provider")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let name = row
                .get("name")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .map(|s| s.to_string());
            let is_active = row
                .get("isActive")
                .and_then(|v| v.as_bool().or_else(|| v.as_i64().map(|n| n != 0)))
                .unwrap_or(true);

            let mut last_error = None;
            let mut rate_limited_until = None;

            if let Some(data_str) = row.get("data").and_then(|v| v.as_str()) {
                if let Ok(data_obj) = serde_json::from_str::<serde_json::Value>(data_str) {
                    last_error = data_obj
                        .get("lastError")
                        .or_else(|| data_obj.get("last_error"))
                        .and_then(|v| v.as_str())
                        .filter(|s| !s.is_empty())
                        .map(|s| s.to_string());
                    rate_limited_until = data_obj
                        .get("rateLimitedUntil")
                        .or_else(|| data_obj.get("rate_limited_until"))
                        .and_then(|v| v.as_str())
                        .filter(|s| !s.is_empty())
                        .map(|s| s.to_string());
                }
            }

            providers.push(ProviderQuotaInfo {
                id,
                provider,
                name,
                is_active,
                last_error,
                rate_limited_until,
            });
        }
    }

    let nodes_json = run_sqlite_json_query(
        &sqlite_bin,
        &db_path,
        "SELECT id, type, name, data FROM providerNodes;",
    );

    if let Some(serde_json::Value::Array(rows)) = nodes_json {
        for row in rows {
            let id = match row.get("id").and_then(|v| v.as_str()) {
                Some(i) if !i.is_empty() && !seen_ids.contains(i) => i.to_string(),
                _ => continue,
            };
            seen_ids.insert(id.clone());
            let provider = row
                .get("type")
                .or_else(|| row.get("provider"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let name = row
                .get("name")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .map(|s| s.to_string());

            let mut is_active = true;
            let mut last_error = None;
            let mut rate_limited_until = None;

            if let Some(data_str) = row.get("data").and_then(|v| v.as_str()) {
                if let Ok(data_obj) = serde_json::from_str::<serde_json::Value>(data_str) {
                    is_active = data_obj
                        .get("isActive")
                        .or_else(|| data_obj.get("is_active"))
                        .and_then(|v| v.as_bool().or_else(|| v.as_i64().map(|n| n != 0)))
                        .unwrap_or(true);
                    last_error = data_obj
                        .get("lastError")
                        .or_else(|| data_obj.get("last_error"))
                        .and_then(|v| v.as_str())
                        .filter(|s| !s.is_empty())
                        .map(|s| s.to_string());
                    rate_limited_until = data_obj
                        .get("rateLimitedUntil")
                        .or_else(|| data_obj.get("rate_limited_until"))
                        .and_then(|v| v.as_str())
                        .filter(|s| !s.is_empty())
                        .map(|s| s.to_string());
                }
            }

            providers.push(ProviderQuotaInfo {
                id,
                provider,
                name,
                is_active,
                last_error,
                rate_limited_until,
            });
        }
    }

    let rows_count_json = run_sqlite_json_query(
        &sqlite_bin,
        &db_path,
        "SELECT (\
            (SELECT count(*) FROM usageDaily) + \
            (SELECT count(*) FROM providerConnections) + \
            (SELECT count(*) FROM providerNodes)\
         ) as total;",
    );

    let total_rows = rows_count_json
        .as_ref()
        .and_then(|v| v.as_array())
        .and_then(|arr| arr.first())
        .and_then(|obj| obj.get("total"))
        .and_then(|v| v.as_i64())
        .unwrap_or(0);

    if total_rows == 0 {
        return default_quota_report(proxy_online);
    }

    let status_message = if proxy_online {
        format!("9Router aktif ({} requests hari ini)", today_requests)
    } else {
        "Proxy 9Router offline".to_string()
    };

    LlmQuotaReport {
        proxy_online,
        db_found: true,
        today_date,
        today_requests,
        today_prompt_tokens,
        today_completion_tokens,
        today_cost,
        providers,
        status_message,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn test_civil_from_days() {
        assert_eq!(civil_from_days(0), (1970, 1, 1));
        // 2026-10-04 is day 20730
        let (y, m, d) = civil_from_days(20730);
        assert_eq!((y, m, d), (2026, 10, 4));
    }

    #[test]
    fn test_default_quota_report() {
        let rep = default_quota_report(false);
        assert!(!rep.proxy_online);
        assert!(!rep.db_found);
        assert_eq!(rep.today_requests, 0);
        assert_eq!(rep.today_prompt_tokens, 0);
        assert_eq!(rep.today_completion_tokens, 0);
        assert_eq!(rep.today_cost, 0.0);
        assert!(rep.providers.is_empty());
        assert_eq!(rep.status_message, "Tidak tersedia");
    }

    #[test]
    fn test_probe_nonexistent_db() {
        let tmp = tempdir().unwrap();
        let fake_db = tmp.path().join("nonexistent.sqlite");
        let rep = probe_llm_quota_internal(Some(&fake_db), Some("http://127.0.0.1:99999"));
        assert!(!rep.db_found);
        assert_eq!(rep.status_message, "Tidak tersedia");
    }

    #[test]
    fn test_probe_sqlite_mock_database() {
        let sqlite_bin = match find_sqlite3_bin() {
            Some(b) => b,
            None => return, // Skip test if sqlite3 is not installed on system
        };

        let tmp = tempdir().unwrap();
        let db_path = tmp.path().join("mock.sqlite");

        // Create tables and sample data
        let init_sql = r#"
            CREATE TABLE usageDaily (dateKey TEXT PRIMARY KEY, data TEXT NOT NULL);
            CREATE TABLE providerConnections (id TEXT PRIMARY KEY, provider TEXT NOT NULL, name TEXT, isActive INTEGER, data TEXT NOT NULL);
            CREATE TABLE providerNodes (id TEXT PRIMARY KEY, type TEXT, name TEXT, data TEXT NOT NULL);

            INSERT INTO usageDaily VALUES (
                date('now'),
                '{"requests":42,"promptTokens":1000,"completionTokens":500,"cost":0.15}'
            );

            INSERT INTO providerConnections VALUES (
                'conn-1',
                'antigravity',
                'test@example.com',
                1,
                '{"lastError":null,"rateLimitedUntil":null}'
            );
        "#;

        let status = Command::new(&sqlite_bin)
            .arg(&db_path)
            .arg(init_sql)
            .status()
            .unwrap();
        assert!(status.success());

        let rep = probe_llm_quota_internal(Some(&db_path), Some("http://127.0.0.1:99999"));
        assert!(rep.db_found);
        assert_eq!(rep.today_requests, 42);
        assert_eq!(rep.today_prompt_tokens, 1000);
        assert_eq!(rep.today_completion_tokens, 500);
        assert_eq!(rep.today_cost, 0.15);
        assert_eq!(rep.providers.len(), 1);
        assert_eq!(rep.providers[0].id, "conn-1");
        assert_eq!(rep.providers[0].provider, "antigravity");
        assert_eq!(rep.providers[0].name.as_deref(), Some("test@example.com"));
        assert!(rep.providers[0].is_active);
    }

    #[test]
    fn test_probe_real_9router_if_present() {
        if let Some(home) = dirs::home_dir() {
            let real_db = home.join(".9router").join("db").join("data.sqlite");
            if real_db.exists() {
                let rep = probe_llm_quota();
                assert!(rep.db_found);
                assert!(!rep.providers.is_empty());
            }
        }
    }
}
