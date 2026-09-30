use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct KanbanBadge {
    pub running: usize,
    pub ready: usize,
    pub blocked: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HermesProfileInfo {
    pub name: String,
    pub model: Option<String>,
    pub is_active: bool,
    pub kanban: Option<KanbanBadge>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HermesDetectionResult {
    pub installed: bool,
    pub path: Option<PathBuf>,
    pub version: Option<String>,
    pub check_ok: bool,
    pub profiles: Vec<HermesProfileInfo>,
}

/// Resolve the Hermes executable in PATH (using toolchain environment).
pub fn resolve_hermes(project_root: Option<&Path>) -> Option<PathBuf> {
    let path_env = if let Some(r) = project_root {
        crate::toolchain::effective_path_for_root(Some(r))
    } else {
        crate::toolchain::effective_path().to_string()
    };

    let bin_name = if cfg!(windows) {
        "hermes.exe"
    } else {
        "hermes"
    };

    for dir in std::env::split_paths(&path_env) {
        let candidate = dir.join(bin_name);
        if candidate.is_file() {
            return Some(candidate);
        }
    }

    None
}

/// Helper to configure command execution with clean environment (removing delegation context).
fn prepare_hermes_cmd(bin: &Path, args: &[&str], project_root: Option<&Path>) -> Command {
    let mut cmd = Command::new(bin);
    cmd.args(args);
    cmd.env_remove("HERMES_DELEGATED_CHILD_CONTEXT");
    crate::toolchain::apply_env_for_root(&mut cmd, project_root);
    if let Some(r) = project_root {
        cmd.current_dir(r);
    }
    cmd
}

/// Check hermes version via `hermes acp --version` or fallback `hermes --version`.
pub fn check_hermes_version(hermes_bin: &Path, project_root: Option<&Path>) -> Option<String> {
    if let Ok(output) = prepare_hermes_cmd(hermes_bin, &["acp", "--version"], project_root).output()
    {
        if output.status.success() {
            let ver = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !ver.is_empty() {
                return Some(ver);
            }
        }
    }

    if let Ok(output) = prepare_hermes_cmd(hermes_bin, &["--version"], project_root).output() {
        if output.status.success() {
            let ver = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !ver.is_empty() {
                return Some(ver);
            }
        }
    }

    None
}

/// Check hermes acp health via `hermes acp --check`.
pub fn check_hermes_acp(hermes_bin: &Path, project_root: Option<&Path>) -> bool {
    if let Ok(output) = prepare_hermes_cmd(hermes_bin, &["acp", "--check"], project_root).output() {
        if output.status.success() {
            let out_str = String::from_utf8_lossy(&output.stdout);
            return out_str.contains("OK") || out_str.contains("Hermes ACP check OK");
        }
    }
    false
}

/// Parse text table output from `hermes profile list`.
pub fn parse_profile_list_table(text: &str) -> Vec<HermesProfileInfo> {
    let mut profiles = Vec::new();

    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        // Skip headers and divider lines
        if trimmed.contains("Profile") && trimmed.contains("Model") {
            continue;
        }
        if trimmed.starts_with('─') || trimmed.starts_with('-') || trimmed.contains("──────")
        {
            continue;
        }

        let is_active = line.contains('◆');
        let clean_line = line.replace('◆', " ");
        let cols: Vec<&str> = clean_line.split_whitespace().collect();

        if cols.is_empty() {
            continue;
        }

        let name = cols[0].to_string();
        let model = if cols.len() > 1 && cols[1] != "—" && cols[1] != "-" {
            Some(cols[1].to_string())
        } else {
            None
        };

        profiles.push(HermesProfileInfo {
            name,
            model,
            is_active,
            kanban: None,
        });
    }

    profiles
}

/// Fallback: read ~/.hermes/profiles/*/config.yaml when CLI cannot be spawned or fails.
pub fn fallback_read_profiles() -> Vec<HermesProfileInfo> {
    let mut profiles = Vec::new();
    let home = match std::env::var_os("HOME") {
        Some(h) => PathBuf::from(h),
        None => return profiles,
    };

    let profiles_dir = home.join(".hermes").join("profiles");
    if let Ok(entries) = std::fs::read_dir(&profiles_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                if let Some(folder_name) = path.file_name().and_then(|n| n.to_str()) {
                    let cfg_file = path.join("config.yaml");
                    let model = read_model_from_yaml(&cfg_file);
                    profiles.push(HermesProfileInfo {
                        name: folder_name.to_string(),
                        model,
                        is_active: false,
                        kanban: None,
                    });
                }
            }
        }
    }

    // Sort profiles alphabetically
    profiles.sort_by(|a, b| a.name.cmp(&b.name));

    // Also check default profile at ~/.hermes/config.yaml if not present
    if !profiles.iter().any(|p| p.name == "default") {
        let default_cfg = home.join(".hermes").join("config.yaml");
        if default_cfg.is_file() {
            let model = read_model_from_yaml(&default_cfg);
            profiles.insert(
                0,
                HermesProfileInfo {
                    name: "default".to_string(),
                    model,
                    is_active: false,
                    kanban: None,
                },
            );
        }
    }

    profiles
}

fn read_model_from_yaml(path: &Path) -> Option<String> {
    let content = std::fs::read_to_string(path).ok()?;
    let mut in_model_block = false;
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("model:") {
            // Check if inline: model: "xyz"
            let rest = trimmed.trim_start_matches("model:").trim();
            if !rest.is_empty() && !rest.starts_with('#') {
                return Some(rest.trim_matches(['"', '\'']).to_string());
            }
            in_model_block = true;
            continue;
        }

        if in_model_block {
            if trimmed.starts_with("default:") {
                let rest = trimmed.trim_start_matches("default:").trim();
                if !rest.is_empty() {
                    return Some(rest.trim_matches(['"', '\'']).to_string());
                }
            } else if !line.starts_with(' ') && !line.starts_with('\t') {
                in_model_block = false;
            }
        }
    }
    None
}

/// Parse JSON array from `hermes kanban list --json`.
pub fn parse_kanban_json(json_str: &str) -> HashMap<String, KanbanBadge> {
    let mut badges: HashMap<String, KanbanBadge> = HashMap::new();

    let arr: Vec<Value> = match serde_json::from_str(json_str) {
        Ok(v) => v,
        Err(_) => return badges,
    };

    for item in arr {
        let assignee = match item.get("assignee").and_then(|v| v.as_str()) {
            Some(a) if !a.is_empty() => a.to_string(),
            _ => continue,
        };

        let status = match item.get("status").and_then(|v| v.as_str()) {
            Some(s) => s.to_lowercase(),
            None => continue,
        };

        let badge = badges.entry(assignee).or_default();
        match status.as_str() {
            "running" => badge.running += 1,
            "ready" => badge.ready += 1,
            "blocked" => badge.blocked += 1,
            _ => {}
        }
    }

    badges
}

/// Parse text lines from `hermes kanban list`.
/// Format: `<icon> <id>  <status:8>  <assignee:20>  <title>`
pub fn parse_kanban_text(text: &str) -> HashMap<String, KanbanBadge> {
    let mut badges: HashMap<String, KanbanBadge> = HashMap::new();

    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        let parts: Vec<&str> = trimmed.split_whitespace().collect();
        // Needs at least icon, id, status, assignee
        if parts.len() < 4 {
            continue;
        }

        let status = parts[2].to_lowercase();
        let assignee = parts[3].to_string();

        let badge = badges.entry(assignee).or_default();
        match status.as_str() {
            "running" => badge.running += 1,
            "ready" => badge.ready += 1,
            "blocked" => badge.blocked += 1,
            _ => {}
        }
    }

    badges
}

/// Full Hermes detection routine. Read-only, only runs when triggered by UI (panel open or Refresh).
pub fn detect_hermes(project_root: Option<&Path>) -> HermesDetectionResult {
    let hermes_bin = match resolve_hermes(project_root) {
        Some(b) => b,
        None => {
            return HermesDetectionResult {
                installed: false,
                path: None,
                version: None,
                check_ok: false,
                profiles: Vec::new(),
            };
        }
    };

    let version = check_hermes_version(&hermes_bin, project_root);
    let check_ok = check_hermes_acp(&hermes_bin, project_root);

    // Profile list: try --json first, else parse table, else fallback
    let mut profiles = Vec::new();
    let json_attempt =
        prepare_hermes_cmd(&hermes_bin, &["profile", "list", "--json"], project_root).output();
    let json_success = if let Ok(ref out) = json_attempt {
        if out.status.success() {
            if let Ok(parsed) = serde_json::from_slice::<Vec<Value>>(&out.stdout) {
                for item in parsed {
                    if let Some(name) = item.get("name").and_then(|v| v.as_str()) {
                        let model = item
                            .get("model")
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string());
                        let is_active = item
                            .get("is_active")
                            .and_then(|v| v.as_bool())
                            .unwrap_or(false);
                        profiles.push(HermesProfileInfo {
                            name: name.to_string(),
                            model,
                            is_active,
                            kanban: None,
                        });
                    }
                }
                true
            } else {
                false
            }
        } else {
            false
        }
    } else {
        false
    };

    if !json_success {
        let table_attempt =
            prepare_hermes_cmd(&hermes_bin, &["profile", "list"], project_root).output();
        if let Ok(out) = table_attempt {
            if out.status.success() {
                profiles = parse_profile_list_table(&String::from_utf8_lossy(&out.stdout));
            }
        }
    }

    if profiles.is_empty() {
        profiles = fallback_read_profiles();
    }

    // Kanban list (read-only): try --json first, else parse text
    let mut kanban_map = HashMap::new();
    let kanban_json_attempt =
        prepare_hermes_cmd(&hermes_bin, &["kanban", "list", "--json"], project_root).output();
    let mut kanban_success = false;

    if let Ok(out) = kanban_json_attempt {
        if out.status.success() {
            let txt = String::from_utf8_lossy(&out.stdout);
            kanban_map = parse_kanban_json(&txt);
            kanban_success = true;
        }
    }

    if !kanban_success {
        if let Ok(out) = prepare_hermes_cmd(&hermes_bin, &["kanban", "list"], project_root).output()
        {
            if out.status.success() {
                let txt = String::from_utf8_lossy(&out.stdout);
                kanban_map = parse_kanban_text(&txt);
            }
        }
    }

    // Attach kanban badges to profiles
    for p in &mut profiles {
        if let Some(b) = kanban_map.get(&p.name) {
            p.kanban = Some(b.clone());
        }
    }

    HermesDetectionResult {
        installed: true,
        path: Some(hermes_bin),
        version,
        check_ok,
        profiles,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_profile_list_fixture() {
        let fixture_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("tests")
            .join("fixtures")
            .join("hermes")
            .join("profile_list.txt");
        let content = std::fs::read_to_string(fixture_path).expect("read profile_list.txt");
        let profiles = parse_profile_list_table(&content);

        assert_eq!(profiles.len(), 7);

        let default_prof = profiles.iter().find(|p| p.name == "default").unwrap();
        assert_eq!(default_prof.model.as_deref(), Some("claude-opus-5"));
        assert!(!default_prof.is_active);

        let senior_prof = profiles.iter().find(|p| p.name == "senior").unwrap();
        assert_eq!(
            senior_prof.model.as_deref(),
            Some("ag/gemini-3.8-flash-high")
        );
        assert!(senior_prof.is_active);

        let techlead_prof = profiles.iter().find(|p| p.name == "techlead").unwrap();
        assert_eq!(
            techlead_prof.model.as_deref(),
            Some("ag/claude-opus-4-6-thinkin")
        );
        assert!(!techlead_prof.is_active);
    }

    #[test]
    fn test_parse_kanban_json_fixture() {
        let fixture_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("tests")
            .join("fixtures")
            .join("hermes")
            .join("kanban_list.json");
        let content = std::fs::read_to_string(fixture_path).expect("read kanban_list.json");
        let badges = parse_kanban_json(&content);

        let techlead_badge = badges.get("techlead").expect("techlead badge");
        assert_eq!(techlead_badge.blocked, 1);
        assert_eq!(techlead_badge.running, 0);

        let senior_badge = badges.get("senior").expect("senior badge");
        assert_eq!(senior_badge.running, 1);

        let reviewer_badge = badges.get("reviewer");
        // reviewer only had done tasks, which are not running/ready/blocked
        if let Some(b) = reviewer_badge {
            assert_eq!(b.running, 0);
            assert_eq!(b.ready, 0);
            assert_eq!(b.blocked, 0);
        }
    }

    #[test]
    fn test_parse_kanban_text_fixture() {
        let fixture_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("tests")
            .join("fixtures")
            .join("hermes")
            .join("kanban_list.txt");
        let content = std::fs::read_to_string(fixture_path).expect("read kanban_list.txt");
        let badges = parse_kanban_text(&content);

        let techlead_badge = badges.get("techlead").expect("techlead badge");
        assert_eq!(techlead_badge.blocked, 1);

        let senior_badge = badges.get("senior").expect("senior badge");
        assert_eq!(senior_badge.running, 1);
    }
}
