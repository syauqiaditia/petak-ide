use super::slot::SlotConfig;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TeamConfig {
    pub version: u32,
    pub slots: Vec<SlotConfig>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub obsidian_vault_path: Option<String>,
}

impl Default for TeamConfig {
    fn default() -> Self {
        Self {
            version: 1,
            slots: Vec::new(),
            obsidian_vault_path: None,
        }
    }
}

pub fn project_team_path(project_root: &Path) -> PathBuf {
    project_root.join(".petak").join("team.json")
}

pub fn global_team_path() -> Option<PathBuf> {
    dirs::config_dir().map(|d| d.join("petak").join("team.json"))
}

/// Load team configuration from .petak/team.json if present, fallback to ~/.config/petak/team.json.
/// Returns (TeamConfig, target_path_used_or_preferred).
pub fn load_team(project_root: Option<&Path>) -> (TeamConfig, PathBuf) {
    if let Some(root) = project_root {
        let p_path = project_team_path(root);
        if p_path.is_file() {
            if let Ok(content) = std::fs::read_to_string(&p_path) {
                if let Ok(cfg) = serde_json::from_str::<TeamConfig>(&content) {
                    return (cfg, p_path);
                }
            }
        }
    }

    if let Some(g_path) = global_team_path() {
        if g_path.is_file() {
            if let Ok(content) = std::fs::read_to_string(&g_path) {
                if let Ok(cfg) = serde_json::from_str::<TeamConfig>(&content) {
                    return (cfg, g_path);
                }
            }
        }
    }

    // Default target path: project if given, otherwise global fallback
    let fallback_path = match project_root {
        Some(r) => project_team_path(r),
        None => global_team_path().unwrap_or_else(|| PathBuf::from("team.json")),
    };

    (TeamConfig::default(), fallback_path)
}

/// Save team configuration to project .petak/team.json (if root is Some), else global.
pub fn save_team(project_root: Option<&Path>, team: &TeamConfig) -> Result<PathBuf, String> {
    let target = match project_root {
        Some(r) => project_team_path(r),
        None => {
            global_team_path().ok_or_else(|| "Could not determine config directory".to_string())?
        }
    };

    save_team_to_path(&target, team)?;
    Ok(target)
}

pub fn save_team_to_path(path: &Path, team: &TeamConfig) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create directory {parent:?}: {e}"))?;
    }

    let json = serde_json::to_string_pretty(team)
        .map_err(|e| format!("Failed to serialize team config: {e}"))?;

    crate::fs::save_file(path, &json)
        .map_err(|e| format!("Failed to save team config to {path:?}: {e}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_team_roundtrip_and_defaults() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path();

        // 1. Initial load on empty root returns default with .petak/team.json target path
        let (initial, path) = load_team(Some(root));
        assert_eq!(initial.version, 1);
        assert!(initial.slots.is_empty());
        assert_eq!(path, project_team_path(root));

        // 2. Save custom team config
        let slot = SlotConfig {
            id: "s1".to_string(),
            label: "Techlead".to_string(),
            kind: "claude-code".to_string(),
            command: None,
            hermes_profile: None,
            model: Some("opus".to_string()),
            fallback_model: Some("sonnet".to_string()),
            permission: "ask".to_string(),
            cwd: "project".to_string(),
        };

        let team = TeamConfig {
            version: 1,
            slots: vec![slot.clone()],
            obsidian_vault_path: None,
        };

        let saved_path = save_team(Some(root), &team).unwrap();
        assert_eq!(saved_path, project_team_path(root));
        assert!(saved_path.is_file());

        // 3. Reload from project root
        let (reloaded, _) = load_team(Some(root));
        assert_eq!(reloaded.version, 1);
        assert_eq!(reloaded.slots.len(), 1);
        assert_eq!(reloaded.slots[0], slot);
    }
}
