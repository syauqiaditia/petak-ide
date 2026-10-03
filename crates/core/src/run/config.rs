use serde::{Deserialize, Serialize};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunConfigFile {
    pub selected: String,
    pub configs: Vec<RunConfig>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RunKind {
    Flutter,
    Gradle,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunConfig {
    pub name: String,
    pub kind: RunKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub flavor: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub dart_defines: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub additional_args: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub module: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub variant: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub application_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub activity: Option<String>,
}

#[derive(Debug)]
pub enum RunConfigError {
    Io(io::Error),
    InvalidJson(String),
    InvalidTarget(String),
    InvalidFlavor(String),
    NotFound(String),
}

impl std::fmt::Display for RunConfigError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Io(e) => write!(f, "I/O error: {}", e),
            Self::InvalidJson(msg) => write!(f, "Invalid JSON in run config: {}", msg),
            Self::InvalidTarget(msg) => write!(f, "Invalid run config target: {}", msg),
            Self::InvalidFlavor(msg) => write!(f, "Invalid run config flavor: {}", msg),
            Self::NotFound(msg) => write!(f, "Run config not found: {}", msg),
        }
    }
}

impl std::error::Error for RunConfigError {}

impl From<io::Error> for RunConfigError {
    fn from(e: io::Error) -> Self {
        Self::Io(e)
    }
}

/// Validate flavor format: must be `^[A-Za-z0-9_]+$`.
pub fn is_valid_flavor(flavor: &str) -> bool {
    !flavor.is_empty()
        && flavor
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_')
}

/// Validate that a target path is relative, does not escape root, and exists.
pub fn validate_target(root: &Path, target: &str) -> Result<PathBuf, RunConfigError> {
    let p = Path::new(target);
    if p.is_absolute() {
        return Err(RunConfigError::InvalidTarget(format!(
            "Target path must be relative to root, got absolute path: {}",
            target
        )));
    }

    for component in p.components() {
        if matches!(component, std::path::Component::ParentDir) {
            return Err(RunConfigError::InvalidTarget(format!(
                "Target path cannot contain '..' components: {}",
                target
            )));
        }
    }

    let full = root.join(target);
    if !full.exists() {
        return Err(RunConfigError::InvalidTarget(format!(
            "Target file does not exist: {}",
            full.display()
        )));
    }

    Ok(full)
}

/// Auto-detect run configurations when `.petak/run.json` does not exist.
/// Does not write to disk.
pub fn auto_detect_run_configs(root: &Path) -> RunConfigFile {
    // 1. Check for Flutter
    let pubspec_path = root.join("pubspec.yaml");
    if pubspec_path.exists() {
        let is_flutter = if let Ok(content) = fs::read_to_string(&pubspec_path) {
            content.contains("flutter:")
                || content.contains("sdk: flutter")
                || content.contains("package:flutter")
        } else {
            false
        };

        if is_flutter {
            let lib_dir = root.join("lib");
            let mut configs = Vec::new();

            if lib_dir.is_dir() {
                if let Ok(entries) = fs::read_dir(&lib_dir) {
                    let mut dart_files: Vec<String> = entries
                        .filter_map(|e| e.ok())
                        .filter(|e| e.file_type().map(|ft| ft.is_file()).unwrap_or(false))
                        .map(|e| e.file_name().to_string_lossy().to_string())
                        .filter(|name| {
                            name.ends_with(".dart")
                                && (name == "main.dart" || name.starts_with("main_"))
                        })
                        .collect();

                    dart_files.sort();

                    for file_name in dart_files {
                        let name = if file_name == "main.dart" {
                            "main".to_string()
                        } else if let Some(stripped) = file_name
                            .strip_prefix("main_")
                            .and_then(|s| s.strip_suffix(".dart"))
                        {
                            stripped.to_string()
                        } else {
                            file_name
                                .strip_suffix(".dart")
                                .unwrap_or(&file_name)
                                .to_string()
                        };

                        configs.push(RunConfig {
                            name,
                            kind: RunKind::Flutter,
                            target: Some(format!("lib/{}", file_name)),
                            flavor: None,
                            dart_defines: Vec::new(),
                            additional_args: None,
                            module: None,
                            variant: None,
                            application_id: None,
                            activity: None,
                        });
                    }
                }
            }

            if configs.is_empty() {
                configs.push(RunConfig {
                    name: "main".to_string(),
                    kind: RunKind::Flutter,
                    target: Some("lib/main.dart".to_string()),
                    flavor: None,
                    dart_defines: Vec::new(),
                    additional_args: None,
                    module: None,
                    variant: None,
                    application_id: None,
                    activity: None,
                });
            }

            let selected = if configs.iter().any(|c| c.name == "main") {
                "main".to_string()
            } else {
                configs.first().map(|c| c.name.clone()).unwrap_or_default()
            };

            return RunConfigFile { selected, configs };
        }
    }

    // 2. Check for Android Gradle
    let has_gradle = root.join("build.gradle").exists()
        || root.join("build.gradle.kts").exists()
        || root.join("settings.gradle").exists()
        || root.join("settings.gradle.kts").exists()
        || root.join("gradlew").exists();

    if has_gradle {
        let configs = vec![RunConfig {
            name: "app".to_string(),
            kind: RunKind::Gradle,
            target: None,
            flavor: None,
            dart_defines: Vec::new(),
            additional_args: None,
            module: Some(":app".to_string()),
            variant: Some("debug".to_string()),
            application_id: None,
            activity: None,
        }];
        return RunConfigFile {
            selected: "app".to_string(),
            configs,
        };
    }

    // 3. Fallback: empty
    RunConfigFile {
        selected: String::new(),
        configs: Vec::new(),
    }
}

/// Load run configuration from `.petak/run.json`, or auto-detect if the file does not exist.
pub fn load_run_config(root: &Path) -> Result<RunConfigFile, RunConfigError> {
    let run_json_path = root.join(".petak").join("run.json");
    if run_json_path.exists() {
        let content = fs::read_to_string(&run_json_path)?;
        match serde_json::from_str::<RunConfigFile>(&content) {
            Ok(cfg) => Ok(cfg),
            Err(e) => Err(RunConfigError::InvalidJson(format!(
                "Failed to parse {}: {}",
                run_json_path.display(),
                e
            ))),
        }
    } else {
        Ok(auto_detect_run_configs(root))
    }
}

/// Save run configuration to `.petak/run.json`.
pub fn save_run_config(root: &Path, config: &RunConfigFile) -> Result<(), RunConfigError> {
    let petak_dir = root.join(".petak");
    fs::create_dir_all(&petak_dir)?;
    let run_json_path = petak_dir.join("run.json");
    let json = serde_json::to_string_pretty(config)
        .map_err(|e| RunConfigError::InvalidJson(e.to_string()))?;
    fs::write(&run_json_path, json)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn test_auto_detect_flutter_two_configs() {
        let dir = tempdir().unwrap();
        let root = dir.path();

        // pubspec with flutter dependency
        let pubspec = r#"
name: my_flutter_app
description: A test flutter app
dependencies:
  flutter:
    sdk: flutter
"#;
        fs::write(root.join("pubspec.yaml"), pubspec).unwrap();

        let lib_dir = root.join("lib");
        fs::create_dir_all(&lib_dir).unwrap();
        fs::write(lib_dir.join("main.dart"), "// main").unwrap();
        fs::write(lib_dir.join("main_dev.dart"), "// dev").unwrap();

        let cfg_file = load_run_config(root).expect("auto-detect should succeed");

        // Should detect 2 configs: main and dev
        assert_eq!(cfg_file.configs.len(), 2);
        assert_eq!(cfg_file.selected, "main");

        let main_cfg = cfg_file.configs.iter().find(|c| c.name == "main").unwrap();
        assert_eq!(main_cfg.kind, RunKind::Flutter);
        assert_eq!(main_cfg.target, Some("lib/main.dart".to_string()));

        let dev_cfg = cfg_file.configs.iter().find(|c| c.name == "dev").unwrap();
        assert_eq!(dev_cfg.kind, RunKind::Flutter);
        assert_eq!(dev_cfg.target, Some("lib/main_dev.dart".to_string()));

        // File should not be written to disk yet
        assert!(!root.join(".petak").join("run.json").exists());
    }

    #[test]
    fn test_auto_detect_android_gradle_one_config() {
        let dir = tempdir().unwrap();
        let root = dir.path();

        fs::write(root.join("settings.gradle"), "include ':app'").unwrap();
        fs::create_dir_all(root.join("app")).unwrap();
        fs::write(root.join("app").join("build.gradle"), "// gradle").unwrap();

        let cfg_file = load_run_config(root).expect("auto-detect should succeed");

        assert_eq!(cfg_file.configs.len(), 1);
        assert_eq!(cfg_file.selected, "app");

        let app_cfg = &cfg_file.configs[0];
        assert_eq!(app_cfg.name, "app");
        assert_eq!(app_cfg.kind, RunKind::Gradle);
        assert_eq!(app_cfg.module, Some(":app".to_string()));
        assert_eq!(app_cfg.variant, Some("debug".to_string()));
    }

    #[test]
    fn test_load_invalid_json_returns_clear_error() {
        let dir = tempdir().unwrap();
        let root = dir.path();

        let petak_dir = root.join(".petak");
        fs::create_dir_all(&petak_dir).unwrap();
        fs::write(petak_dir.join("run.json"), "{ broken json: [ }").unwrap();

        let result = load_run_config(root);
        assert!(result.is_err(), "Should fail on broken json");

        match result {
            Err(RunConfigError::InvalidJson(msg)) => {
                assert!(msg.contains("run.json"));
                assert!(msg.contains("Failed to parse"));
            }
            other => panic!("Expected RunConfigError::InvalidJson, got {:?}", other),
        }
    }

    #[test]
    fn test_save_and_reload_run_config() {
        let dir = tempdir().unwrap();
        let root = dir.path();

        let config_file = RunConfigFile {
            selected: "custom".to_string(),
            configs: vec![RunConfig {
                name: "custom".to_string(),
                kind: RunKind::Flutter,
                target: Some("lib/main.dart".to_string()),
                flavor: Some("dev".to_string()),
                dart_defines: vec!["API_URL=https://dev.example.com".to_string()],
                additional_args: None,
                module: None,
                variant: None,
                application_id: None,
                activity: None,
            }],
        };

        save_run_config(root, &config_file).expect("save should succeed");
        assert!(root.join(".petak").join("run.json").exists());

        let loaded = load_run_config(root).expect("load should succeed");
        assert_eq!(loaded, config_file);
    }

    #[test]
    fn test_run_config_additional_args_serialization() {
        let json_with_args = r#"{
            "name": "custom_args",
            "kind": "flutter",
            "additionalArgs": "--verbose --web-port 8080"
        }"#;

        let parsed: RunConfig = serde_json::from_str(json_with_args).unwrap();
        assert_eq!(
            parsed.additional_args,
            Some("--verbose --web-port 8080".to_string())
        );

        let serialized = serde_json::to_string(&parsed).unwrap();
        assert!(serialized.contains(r#""additionalArgs":"--verbose --web-port 8080""#));

        // When additional_args is None, it should not appear in serialized JSON (skip_serializing_if)
        let config_none = RunConfig {
            name: "no_args".to_string(),
            kind: RunKind::Flutter,
            target: None,
            flavor: None,
            dart_defines: vec![],
            additional_args: None,
            module: None,
            variant: None,
            application_id: None,
            activity: None,
        };
        let serialized_none = serde_json::to_string(&config_none).unwrap();
        assert!(!serialized_none.contains("additionalArgs"));
    }

    #[test]
    fn test_validations() {
        let dir = tempdir().unwrap();
        let root = dir.path();
        let lib_dir = root.join("lib");
        fs::create_dir_all(&lib_dir).unwrap();
        fs::write(lib_dir.join("main.dart"), "// dart").unwrap();

        // Target validation
        assert!(validate_target(root, "lib/main.dart").is_ok());
        assert!(validate_target(root, "/absolute/path").is_err());
        assert!(validate_target(root, "lib/../secret.dart").is_err());
        assert!(validate_target(root, "lib/nonexistent.dart").is_err());

        // Flavor validation
        assert!(is_valid_flavor("dev"));
        assert!(is_valid_flavor("flavor_1"));
        assert!(is_valid_flavor("DevFlavor2"));
        assert!(!is_valid_flavor(""));
        assert!(!is_valid_flavor("flavor-with-hyphen"));
        assert!(!is_valid_flavor("flavor with space"));
        assert!(!is_valid_flavor("dev;rm -rf /"));
    }
}
