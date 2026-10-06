use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct McpServerConfig {
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: HashMap<String, String>,
    #[serde(default)]
    pub disabled: bool,
    #[serde(default)]
    pub auto_approve: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct McpConfig {
    #[serde(default)]
    pub mcp_servers: HashMap<String, McpServerConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct McpTestResult {
    pub ok: bool,
    pub latency_ms: Option<u64>,
    pub server_info: Option<String>,
    pub error: Option<String>,
}

pub fn resolve_mcp_path(root: Option<&Path>) -> PathBuf {
    if let Some(r) = root {
        let p = r.join(".petak").join("mcp.json");
        if p.exists() {
            return p;
        }
    }

    if let Some(home) = dirs::home_dir() {
        let global_p = home.join(".petak").join("mcp.json");
        if global_p.exists() {
            return global_p;
        }
    }

    if let Some(r) = root {
        r.join(".petak").join("mcp.json")
    } else if let Some(home) = dirs::home_dir() {
        home.join(".petak").join("mcp.json")
    } else {
        PathBuf::from(".petak").join("mcp.json")
    }
}

pub fn load_mcp_config(root: Option<&Path>) -> Result<McpConfig, String> {
    if let Some(r) = root {
        let p = r.join(".petak").join("mcp.json");
        if p.exists() {
            let content = std::fs::read_to_string(&p)
                .map_err(|e| format!("Failed to read MCP config at {p:?}: {e}"))?;
            let trimmed = content.trim();
            if trimmed.is_empty() {
                return Ok(McpConfig::default());
            }
            return serde_json::from_str::<McpConfig>(trimmed)
                .map_err(|e| format!("Failed to parse MCP config at {p:?}: {e}"));
        }
    }

    if let Some(home) = dirs::home_dir() {
        let global_p = home.join(".petak").join("mcp.json");
        if global_p.exists() {
            let content = std::fs::read_to_string(&global_p)
                .map_err(|e| format!("Failed to read MCP config at {global_p:?}: {e}"))?;
            let trimmed = content.trim();
            if trimmed.is_empty() {
                return Ok(McpConfig::default());
            }
            return serde_json::from_str::<McpConfig>(trimmed)
                .map_err(|e| format!("Failed to parse MCP config at {global_p:?}: {e}"));
        }
    }

    Ok(McpConfig::default())
}

pub fn save_mcp_config(root: Option<&Path>, config: &McpConfig) -> Result<(), String> {
    let target_path = if let Some(r) = root {
        r.join(".petak").join("mcp.json")
    } else if let Some(home) = dirs::home_dir() {
        home.join(".petak").join("mcp.json")
    } else {
        PathBuf::from(".petak").join("mcp.json")
    };

    if let Some(parent) = target_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create directory {parent:?}: {e}"))?;
    }

    let json = serde_json::to_string_pretty(config)
        .map_err(|e| format!("Failed to serialize MCP config: {e}"))?;

    crate::fs::save_file(&target_path, &json)
        .map_err(|e| format!("Failed to save MCP config to {target_path:?}: {e}"))?;

    Ok(())
}

pub fn active_acp_servers(config: &McpConfig) -> Vec<serde_json::Value> {
    let mut entries: Vec<(&String, &McpServerConfig)> = config
        .mcp_servers
        .iter()
        .filter(|(_, srv)| !srv.disabled)
        .collect();
    entries.sort_by_key(|(name, _)| *name);

    entries
        .into_iter()
        .map(|(name, srv)| {
            serde_json::json!({
                "name": name,
                "command": srv.command,
                "args": srv.args,
                "env": srv.env,
            })
        })
        .collect()
}

struct ChildGuard(Option<std::process::Child>);

impl Drop for ChildGuard {
    fn drop(&mut self) {
        if let Some(mut child) = self.0.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

pub fn test_mcp_server(
    command: &str,
    args: &[String],
    env: &HashMap<String, String>,
) -> Result<McpTestResult, String> {
    let cmd_trimmed = command.trim();
    if cmd_trimmed.is_empty() {
        return Ok(McpTestResult {
            ok: false,
            latency_ms: None,
            server_info: None,
            error: Some("Command cannot be empty".to_string()),
        });
    }

    let start = Instant::now();

    let mut cmd = std::process::Command::new(cmd_trimmed);
    cmd.args(args);
    crate::toolchain::apply_env(&mut cmd);
    cmd.envs(env);
    cmd.stdin(std::process::Stdio::piped());
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            return Ok(McpTestResult {
                ok: false,
                latency_ms: None,
                server_info: None,
                error: Some(format!("Failed to spawn process '{cmd_trimmed}': {e}")),
            });
        }
    };

    let mut stdin = child.stdin.take();
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    let mut guard = ChildGuard(Some(child));

    // Send MCP initialize handshake to stdin
    let init_msg = "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{\"protocolVersion\":\"2024-11-05\",\"capabilities\":{},\"clientInfo\":{\"name\":\"petak-probe\",\"version\":\"0.9.0\"}}}\n";
    if let Some(mut sin) = stdin.take() {
        let _ = sin.write_all(init_msg.as_bytes());
        let _ = sin.flush();
    }

    // Capture stderr in background thread
    let stderr_buf = Arc::new(Mutex::new(String::new()));
    let stderr_clone = Arc::clone(&stderr_buf);
    let stderr_handle = stderr.map(|se| {
        std::thread::spawn(move || {
            let mut buf = String::new();
            let mut r = BufReader::new(se);
            let _ = r.read_to_string(&mut buf);
            let mut lock = stderr_clone.lock().unwrap();
            *lock = buf;
        })
    });

    // Capture stdout in background thread
    let (tx, rx) = mpsc::channel::<Result<String, std::io::Error>>();
    let stdout_handle = stdout.map(|so| {
        let tx_clone = tx;
        std::thread::spawn(move || {
            let mut r = BufReader::new(so);
            let mut line = String::new();
            match r.read_line(&mut line) {
                Ok(n) if n > 0 => {
                    let _ = tx_clone.send(Ok(line));
                }
                Ok(_) => {
                    // EOF on stdout
                }
                Err(e) => {
                    let _ = tx_clone.send(Err(e));
                }
            }
        })
    });

    let timeout = Duration::from_secs(5);
    let test_res = match rx.recv_timeout(timeout) {
        Ok(Ok(line)) => {
            let latency = start.elapsed().as_millis() as u64;
            let trimmed = line.trim();
            let server_info = if let Ok(val) = serde_json::from_str::<serde_json::Value>(trimmed) {
                if let Some(info) = val.get("result").and_then(|r| r.get("serverInfo")) {
                    let name = info
                        .get("name")
                        .and_then(|n| n.as_str())
                        .unwrap_or("unknown");
                    let ver = info.get("version").and_then(|v| v.as_str()).unwrap_or("");
                    if ver.is_empty() {
                        Some(name.to_string())
                    } else {
                        Some(format!("{name} v{ver}"))
                    }
                } else if val.get("error").is_some() {
                    let err_msg = val["error"]["message"].as_str().unwrap_or(trimmed);
                    Some(format!("server responded: {err_msg}"))
                } else {
                    Some(trimmed.to_string())
                }
            } else {
                Some(trimmed.to_string())
            };

            McpTestResult {
                ok: true,
                latency_ms: Some(latency),
                server_info,
                error: None,
            }
        }
        Ok(Err(e)) => {
            let latency = start.elapsed().as_millis() as u64;
            McpTestResult {
                ok: false,
                latency_ms: Some(latency),
                server_info: None,
                error: Some(format!("Error reading stdout from MCP server: {e}")),
            }
        }
        Err(mpsc::RecvTimeoutError::Timeout) => {
            if let Some(mut child) = guard.0.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
            let latency = start.elapsed().as_millis() as u64;
            McpTestResult {
                ok: false,
                latency_ms: Some(latency.max(5000)),
                server_info: None,
                error: Some("MCP server test timed out after 5 seconds".to_string()),
            }
        }
        Err(mpsc::RecvTimeoutError::Disconnected) => {
            let latency = start.elapsed().as_millis() as u64;
            let status_opt = guard.0.as_mut().and_then(|c| c.wait().ok());
            if let Some(h) = stderr_handle {
                let _ = h.join();
            }
            let err_output = stderr_buf.lock().unwrap().trim().to_string();

            match status_opt {
                Some(st) if st.success() => McpTestResult {
                    ok: true,
                    latency_ms: Some(latency),
                    server_info: Some("Process executed successfully".to_string()),
                    error: None,
                },
                Some(st) => {
                    let detail = if err_output.is_empty() {
                        format!("Process exited with status: {st}")
                    } else {
                        format!("Process exited with status {st}: {err_output}")
                    };
                    McpTestResult {
                        ok: false,
                        latency_ms: Some(latency),
                        server_info: None,
                        error: Some(detail),
                    }
                }
                None => McpTestResult {
                    ok: false,
                    latency_ms: Some(latency),
                    server_info: None,
                    error: Some("Process terminated unexpectedly".to_string()),
                },
            }
        }
    };

    if let Some(mut child) = guard.0.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
    if let Some(h) = stdout_handle {
        let _ = h.join();
    }

    Ok(test_res)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_mcp_config_roundtrip() {
        let mut servers = HashMap::new();
        let mut env = HashMap::new();
        env.insert("GITLAB_PAT".to_string(), "secret-token".to_string());

        servers.insert(
            "gitlab".to_string(),
            McpServerConfig {
                command: "npx".to_string(),
                args: vec![
                    "-y".to_string(),
                    "@modelcontextprotocol/server-gitlab".to_string(),
                ],
                env,
                disabled: false,
                auto_approve: vec!["read_issue".to_string()],
            },
        );

        let config = McpConfig {
            mcp_servers: servers,
        };

        let json = serde_json::to_string(&config).expect("serialize mcp config");
        assert!(json.contains("\"mcpServers\""));
        assert!(json.contains("\"autoApprove\""));

        let deserialized: McpConfig = serde_json::from_str(&json).expect("deserialize mcp config");
        assert_eq!(config, deserialized);
    }

    #[test]
    fn test_active_acp_servers_filtering() {
        let mut servers = HashMap::new();
        servers.insert(
            "active_one".to_string(),
            McpServerConfig {
                command: "echo".to_string(),
                args: vec!["1".to_string()],
                env: HashMap::new(),
                disabled: false,
                auto_approve: vec![],
            },
        );
        servers.insert(
            "disabled_two".to_string(),
            McpServerConfig {
                command: "echo".to_string(),
                args: vec!["2".to_string()],
                env: HashMap::new(),
                disabled: true,
                auto_approve: vec![],
            },
        );
        servers.insert(
            "active_three".to_string(),
            McpServerConfig {
                command: "echo".to_string(),
                args: vec!["3".to_string()],
                env: HashMap::new(),
                disabled: false,
                auto_approve: vec![],
            },
        );

        let config = McpConfig {
            mcp_servers: servers,
        };
        let active = active_acp_servers(&config);
        assert_eq!(active.len(), 2);
        assert_eq!(active[0]["name"], "active_one");
        assert_eq!(active[1]["name"], "active_three");
        assert_eq!(active[0]["command"], "echo");
        assert_eq!(active[1]["command"], "echo");
    }

    #[test]
    fn test_load_and_save_mcp_config_tempdir() {
        let temp = tempfile::tempdir().expect("create tempdir");
        let root = temp.path();

        // 1. Initial load on empty dir returns default
        let initial = load_mcp_config(Some(root)).expect("load empty");
        assert!(initial.mcp_servers.is_empty());

        // 2. Save config
        let mut servers = HashMap::new();
        servers.insert(
            "fs".to_string(),
            McpServerConfig {
                command: "mcp-server-filesystem".to_string(),
                args: vec!["/tmp".to_string()],
                env: HashMap::new(),
                disabled: false,
                auto_approve: vec![],
            },
        );
        let config = McpConfig {
            mcp_servers: servers,
        };
        save_mcp_config(Some(root), &config).expect("save config");

        let p = root.join(".petak").join("mcp.json");
        assert!(p.is_file());

        // 3. Load saved config
        let loaded = load_mcp_config(Some(root)).expect("load saved");
        assert_eq!(config, loaded);
    }

    #[test]
    fn test_test_mcp_server_echo() {
        let res = test_mcp_server("echo", &["mcp-ping-ok".to_string()], &HashMap::new())
            .expect("run echo test");
        assert!(res.ok);
        assert!(res.latency_ms.is_some());
        assert!(res.server_info.as_deref().unwrap().contains("mcp-ping-ok"));
        assert!(res.error.is_none());
    }

    #[test]
    fn test_test_mcp_server_mock_jsonrpc() {
        let json_reply = r#"{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2024-11-05","serverInfo":{"name":"petak-test-server","version":"2.4.0"}}}"#;
        let args = vec!["-c".to_string(), format!("echo '{json_reply}'")];
        let res = test_mcp_server("sh", &args, &HashMap::new()).expect("run mock jsonrpc test");
        assert!(res.ok);
        assert_eq!(res.server_info.as_deref(), Some("petak-test-server v2.4.0"));
        assert!(res.error.is_none());
    }

    #[test]
    fn test_test_mcp_server_nonexistent() {
        let res = test_mcp_server("nonexistent_binary_xyz_12345", &[], &HashMap::new())
            .expect("run nonexistent test");
        assert!(!res.ok);
        assert!(res.error.is_some());
    }
}
