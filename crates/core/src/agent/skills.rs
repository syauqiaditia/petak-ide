use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

pub const CORE_SKILLS: &[&str] = &["ponytail", "caveman"];

pub const PONYTAIL_FALLBACK_DESC: &str =
    "Forces the laziest solution that actually works, simplest, shortest, most minimal.";
pub const PONYTAIL_FALLBACK_CONTENT: &str = r#"---
name: ponytail
description: Forces the laziest solution that actually works, simplest, shortest, most minimal.
---

# Ponytail
Lazy senior developer discipline: minimal diff, standard library first, no speculative abstractions.
"#;

pub const CAVEMAN_FALLBACK_DESC: &str =
    "Terse caveman communication style: drop filler, pleasantries, articles. Technical substance stays exact.";
pub const CAVEMAN_FALLBACK_CONTENT: &str = r#"---
name: caveman
description: Terse caveman communication style: drop filler, pleasantries, articles. Technical substance stays exact.
---

# Caveman
Terse caveman communication style. Drop filler, pleasantries, hedging, and articles. Technical substance stays exact.
"#;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SkillMetadata {
    pub name: String,
    pub description: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        alias = "argument-hint",
        alias = "argument_hint"
    )]
    pub argument_hint: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub license: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SkillSummary {
    pub name: String,
    pub description: String,
    pub is_core: bool,
    pub scope: String, // "system" | "project"
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Skill {
    pub name: String,
    pub description: String,
    pub content: String,
    pub is_core: bool,
    pub scope: String, // "system" | "project"
    pub path: String,
}

pub fn is_core_skill(name: &str) -> bool {
    let trimmed = name.trim();
    CORE_SKILLS.iter().any(|&c| c.eq_ignore_ascii_case(trimmed))
}

pub fn validate_skill_name(name: &str) -> Result<(), String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("Skill name cannot be empty".to_string());
    }
    if trimmed != name {
        return Err("Skill name cannot contain leading or trailing whitespace".to_string());
    }
    if name.contains('/') || name.contains('\\') || name.contains("..") {
        return Err("Path traversal characters not allowed in skill name".to_string());
    }
    for c in name.chars() {
        if !c.is_ascii_alphanumeric() && c != '-' && c != '_' {
            return Err(format!(
                "Invalid character '{}' in skill name; only alphanumeric, hyphens, and underscores allowed",
                c
            ));
        }
    }
    Ok(())
}

pub fn scaffold_skills_dir(project_root: Option<&Path>) -> Result<PathBuf, String> {
    let root = project_root
        .ok_or_else(|| "Project root is required to scaffold skills directory".to_string())?;
    let dir = root.join(".petak").join("skills");
    if !dir.exists() {
        std::fs::create_dir_all(&dir)
            .map_err(|e| format!("Failed to create skills directory at {:?}: {}", dir, e))?;
    }
    Ok(dir)
}

pub fn parse_frontmatter(raw: &str) -> (Option<SkillMetadata>, String) {
    let trimmed = raw.trim_start();
    if !trimmed.starts_with("---") {
        return (None, raw.to_string());
    }
    let after_open = &trimmed[3..];
    let after_open = match after_open.strip_prefix("\r\n") {
        Some(rest) => rest,
        None => match after_open.strip_prefix('\n') {
            Some(rest) => rest,
            None => return (None, raw.to_string()),
        },
    };

    let mut yaml_lines = Vec::new();
    let mut found_close = false;
    let mut body_lines = Vec::new();

    for line in after_open.lines() {
        if !found_close {
            if line.trim() == "---" || line.trim() == "..." {
                found_close = true;
            } else {
                yaml_lines.push(line);
            }
        } else {
            body_lines.push(line);
        }
    }

    if !found_close {
        return (None, raw.to_string());
    }

    let yaml_str = yaml_lines.join("\n");
    let body = body_lines.join("\n");

    if let Ok(meta) = serde_yaml::from_str::<SkillMetadata>(&yaml_str) {
        return (Some(meta), body);
    }

    // Lenient fallback for dynamic YAML mapping
    if let Ok(val) = serde_yaml::from_str::<serde_yaml::Value>(&yaml_str) {
        if let serde_yaml::Value::Mapping(map) = val {
            let name = map
                .get(&serde_yaml::Value::String("name".to_string()))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let description = map
                .get(&serde_yaml::Value::String("description".to_string()))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let category = map
                .get(&serde_yaml::Value::String("category".to_string()))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let argument_hint = map
                .get(&serde_yaml::Value::String("argument-hint".to_string()))
                .or_else(|| map.get(&serde_yaml::Value::String("argument_hint".to_string())))
                .or_else(|| map.get(&serde_yaml::Value::String("argumentHint".to_string())))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let license = map
                .get(&serde_yaml::Value::String("license".to_string()))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());

            if !name.is_empty() || !description.is_empty() {
                return (
                    Some(SkillMetadata {
                        name,
                        description,
                        category,
                        argument_hint,
                        license,
                    }),
                    body,
                );
            }
        }
    }

    (None, body)
}

pub fn format_skill_content(name: &str, description: &str, content: &str) -> String {
    let trimmed = content.trim_start();
    if trimmed.starts_with("---") {
        let (meta_opt, body) = parse_frontmatter(content);
        if let Some(mut meta) = meta_opt {
            if meta.name.is_empty() {
                meta.name = name.to_string();
            }
            if meta.description.is_empty() && !description.is_empty() {
                meta.description = description.to_string();
            }
            let mut yaml = format!("---\nname: {}\ndescription: {}", meta.name, meta.description);
            if let Some(ref cat) = meta.category {
                yaml.push_str(&format!("\ncategory: {}", cat));
            }
            if let Some(ref hint) = meta.argument_hint {
                yaml.push_str(&format!("\nargument-hint: \"{}\"", hint));
            }
            if let Some(ref lic) = meta.license {
                yaml.push_str(&format!("\nlicense: {}", lic));
            }
            yaml.push_str("\n---\n\n");
            yaml.push_str(body.trim_start());
            if !yaml.ends_with('\n') {
                yaml.push('\n');
            }
            return yaml;
        }
    }

    format!(
        "---\nname: {}\ndescription: {}\n---\n\n{}\n",
        name,
        description,
        content.trim()
    )
}

pub fn list_skills(project_root: Option<&Path>) -> Result<Vec<SkillSummary>, String> {
    if let Some(root) = project_root {
        let _ = scaffold_skills_dir(Some(root));
    }

    let mut map: std::collections::HashMap<String, SkillSummary> = std::collections::HashMap::new();

    // 1. Core skills ("ponytail" and "caveman")
    for &core in CORE_SKILLS {
        let mut desc = if core == "ponytail" {
            PONYTAIL_FALLBACK_DESC.to_string()
        } else {
            CAVEMAN_FALLBACK_DESC.to_string()
        };
        let mut path_str = dirs::home_dir()
            .map(|h| {
                h.join(".hermes")
                    .join("skills")
                    .join(core)
                    .join("SKILL.md")
                    .to_string_lossy()
                    .to_string()
            })
            .unwrap_or_else(|| format!("~/.hermes/skills/{}/SKILL.md", core));

        if let Some(home) = dirs::home_dir() {
            let p = home.join(".hermes").join("skills").join(core).join("SKILL.md");
            if p.exists() {
                path_str = p.to_string_lossy().to_string();
                if let Ok(raw) = std::fs::read_to_string(&p) {
                    let (meta_opt, _) = parse_frontmatter(&raw);
                    if let Some(m) = meta_opt {
                        if !m.description.is_empty() {
                            desc = m.description;
                        }
                    }
                }
            }
        }

        map.insert(
            core.to_string(),
            SkillSummary {
                name: core.to_string(),
                description: desc,
                is_core: true,
                scope: "system".to_string(),
                path: path_str,
            },
        );
    }

    // 2. Project skills: {project_root}/.petak/skills/<name>/SKILL.md
    if let Some(root) = project_root {
        let project_skills_dir = root.join(".petak").join("skills");
        if project_skills_dir.exists() {
            if let Ok(entries) = std::fs::read_dir(&project_skills_dir) {
                for entry in entries.flatten() {
                    if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                        let name = entry.file_name().to_string_lossy().to_string();
                        // Project skills cannot overwrite core skills
                        if is_core_skill(&name) {
                            continue;
                        }
                        let skill_file = entry.path().join("SKILL.md");
                        if skill_file.exists() {
                            let mut desc = String::new();
                            if let Ok(raw) = std::fs::read_to_string(&skill_file) {
                                let (meta_opt, _) = parse_frontmatter(&raw);
                                if let Some(m) = meta_opt {
                                    desc = m.description;
                                }
                            }
                            map.insert(
                                name.clone(),
                                SkillSummary {
                                    name,
                                    description: desc,
                                    is_core: false,
                                    scope: "project".to_string(),
                                    path: skill_file.to_string_lossy().to_string(),
                                },
                            );
                        }
                    }
                }
            }
        }
    }

    // 3. System skills: ~/.hermes/skills/
    if let Some(home) = dirs::home_dir() {
        let system_skills_dir = home.join(".hermes").join("skills");
        if system_skills_dir.exists() {
            let mut check_skill_dir = |dir_path: &Path, skill_name: &str| {
                if is_core_skill(skill_name) {
                    return;
                }
                if map.contains_key(skill_name) {
                    return;
                }
                let skill_file = dir_path.join("SKILL.md");
                if skill_file.exists() {
                    let mut desc = String::new();
                    let mut final_name = skill_name.to_string();
                    if let Ok(raw) = std::fs::read_to_string(&skill_file) {
                        let (meta_opt, _) = parse_frontmatter(&raw);
                        if let Some(m) = meta_opt {
                            if !m.description.is_empty() {
                                desc = m.description;
                            }
                            if !m.name.is_empty() {
                                final_name = m.name;
                            }
                        }
                    }
                    if is_core_skill(&final_name) || map.contains_key(&final_name) {
                        return;
                    }
                    map.insert(
                        final_name.clone(),
                        SkillSummary {
                            name: final_name,
                            description: desc,
                            is_core: false,
                            scope: "system".to_string(),
                            path: skill_file.to_string_lossy().to_string(),
                        },
                    );
                }
            };

            if let Ok(entries) = std::fs::read_dir(&system_skills_dir) {
                for entry in entries.flatten() {
                    if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                        let path = entry.path();
                        let dir_name = entry.file_name().to_string_lossy().to_string();
                        if path.join("SKILL.md").exists() {
                            check_skill_dir(&path, &dir_name);
                        } else if let Ok(sub_entries) = std::fs::read_dir(&path) {
                            for sub_entry in sub_entries.flatten() {
                                if sub_entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                                    let sub_path = sub_entry.path();
                                    let sub_name =
                                        sub_entry.file_name().to_string_lossy().to_string();
                                    if sub_path.join("SKILL.md").exists() {
                                        check_skill_dir(&sub_path, &sub_name);
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    let mut result: Vec<SkillSummary> = map.into_values().collect();
    result.sort_by(|a, b| match (b.is_core, a.is_core) {
        (true, false) => std::cmp::Ordering::Greater,
        (false, true) => std::cmp::Ordering::Less,
        _ => a.name.cmp(&b.name),
    });

    Ok(result)
}

pub fn read_skill(project_root: Option<&Path>, name: &str) -> Result<Skill, String> {
    validate_skill_name(name)?;

    // 1. Core skills protection / built-in definition
    if is_core_skill(name) {
        let canonical_name = if name.eq_ignore_ascii_case("ponytail") {
            "ponytail"
        } else {
            "caveman"
        };

        if let Some(home) = dirs::home_dir() {
            let p = home.join(".hermes").join("skills").join(canonical_name).join("SKILL.md");
            if p.exists() {
                if let Ok(raw) = std::fs::read_to_string(&p) {
                    let (meta_opt, _) = parse_frontmatter(&raw);
                    let desc = meta_opt
                        .map(|m| m.description)
                        .filter(|d| !d.is_empty())
                        .unwrap_or_else(|| {
                            if canonical_name == "ponytail" {
                                PONYTAIL_FALLBACK_DESC.to_string()
                            } else {
                                CAVEMAN_FALLBACK_DESC.to_string()
                            }
                        });
                    return Ok(Skill {
                        name: canonical_name.to_string(),
                        description: desc,
                        content: raw,
                        is_core: true,
                        scope: "system".to_string(),
                        path: p.to_string_lossy().to_string(),
                    });
                }
            }
        }

        let (desc, content) = if canonical_name == "ponytail" {
            (PONYTAIL_FALLBACK_DESC, PONYTAIL_FALLBACK_CONTENT)
        } else {
            (CAVEMAN_FALLBACK_DESC, CAVEMAN_FALLBACK_CONTENT)
        };
        let virtual_path = dirs::home_dir()
            .map(|h| {
                h.join(".hermes")
                    .join("skills")
                    .join(canonical_name)
                    .join("SKILL.md")
                    .to_string_lossy()
                    .to_string()
            })
            .unwrap_or_else(|| format!("~/.hermes/skills/{}/SKILL.md", canonical_name));

        return Ok(Skill {
            name: canonical_name.to_string(),
            description: desc.to_string(),
            content: content.to_string(),
            is_core: true,
            scope: "system".to_string(),
            path: virtual_path,
        });
    }

    // 2. Project skill: {project_root}/.petak/skills/<name>/SKILL.md
    if let Some(root) = project_root {
        let p = root.join(".petak").join("skills").join(name).join("SKILL.md");
        if p.exists() {
            let raw = std::fs::read_to_string(&p)
                .map_err(|e| format!("Failed to read project skill at {:?}: {}", p, e))?;
            let (meta_opt, _) = parse_frontmatter(&raw);
            let desc = meta_opt.map(|m| m.description).unwrap_or_default();
            return Ok(Skill {
                name: name.to_string(),
                description: desc,
                content: raw,
                is_core: false,
                scope: "project".to_string(),
                path: p.to_string_lossy().to_string(),
            });
        }
    }

    // 3. System skill from ~/.hermes/skills/
    if let Some(home) = dirs::home_dir() {
        let base = home.join(".hermes").join("skills");
        let p = base.join(name).join("SKILL.md");
        if p.exists() {
            let raw = std::fs::read_to_string(&p)
                .map_err(|e| format!("Failed to read system skill at {:?}: {}", p, e))?;
            let (meta_opt, _) = parse_frontmatter(&raw);
            let desc = meta_opt.map(|m| m.description).unwrap_or_default();
            return Ok(Skill {
                name: name.to_string(),
                description: desc,
                content: raw,
                is_core: false,
                scope: "system".to_string(),
                path: p.to_string_lossy().to_string(),
            });
        }

        if let Ok(entries) = std::fs::read_dir(&base) {
            for entry in entries.flatten() {
                if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                    let sub_p = entry.path().join(name).join("SKILL.md");
                    if sub_p.exists() {
                        let raw = std::fs::read_to_string(&sub_p).map_err(|e| {
                            format!("Failed to read system skill at {:?}: {}", sub_p, e)
                        })?;
                        let (meta_opt, _) = parse_frontmatter(&raw);
                        let desc = meta_opt.map(|m| m.description).unwrap_or_default();
                        return Ok(Skill {
                            name: name.to_string(),
                            description: desc,
                            content: raw,
                            is_core: false,
                            scope: "system".to_string(),
                            path: sub_p.to_string_lossy().to_string(),
                        });
                    }
                }
            }
        }
    }

    Err(format!("Skill '{}' not found", name))
}

pub fn save_skill(
    project_root: Option<&Path>,
    name: &str,
    description: &str,
    content: &str,
) -> Result<Skill, String> {
    if is_core_skill(name) {
        return Err("Core skill cannot be modified or overwritten".to_string());
    }
    validate_skill_name(name)?;
    let root = project_root.ok_or_else(|| "Project root is required to save skill".to_string())?;
    let skills_dir = scaffold_skills_dir(Some(root))?;
    let skill_dir = skills_dir.join(name);
    if !skill_dir.exists() {
        std::fs::create_dir_all(&skill_dir)
            .map_err(|e| format!("Failed to create skill directory at {:?}: {}", skill_dir, e))?;
    }
    let skill_file = skill_dir.join("SKILL.md");
    let final_content = format_skill_content(name, description, content);
    std::fs::write(&skill_file, &final_content)
        .map_err(|e| format!("Failed to write skill file {:?}: {}", skill_file, e))?;

    Ok(Skill {
        name: name.to_string(),
        description: description.to_string(),
        content: final_content,
        is_core: false,
        scope: "project".to_string(),
        path: skill_file.to_string_lossy().to_string(),
    })
}

pub fn delete_skill(project_root: Option<&Path>, name: &str) -> Result<bool, String> {
    if is_core_skill(name) {
        return Err("Core skill cannot be deleted".to_string());
    }
    validate_skill_name(name)?;
    let root =
        project_root.ok_or_else(|| "Project root is required to delete skill".to_string())?;
    let skill_dir = root.join(".petak").join("skills").join(name);
    if skill_dir.exists() {
        std::fs::remove_dir_all(&skill_dir)
            .map_err(|e| format!("Failed to delete skill directory {:?}: {}", skill_dir, e))?;
        Ok(true)
    } else {
        Ok(false)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn test_core_skills_protection() {
        let dir = tempdir().unwrap();
        let root = dir.path();

        // Core skills delete must return error
        assert_eq!(
            delete_skill(Some(root), "ponytail").unwrap_err(),
            "Core skill cannot be deleted"
        );
        assert_eq!(
            delete_skill(Some(root), "caveman").unwrap_err(),
            "Core skill cannot be deleted"
        );
        assert_eq!(
            delete_skill(Some(root), "PONYTAIL").unwrap_err(),
            "Core skill cannot be deleted"
        );

        // Core skills save/overwrite must fail
        assert!(save_skill(Some(root), "ponytail", "desc", "content").is_err());
        assert!(save_skill(Some(root), "caveman", "desc", "content").is_err());

        // Core skills read always returns valid built-in fallback
        let p_skill = read_skill(Some(root), "ponytail").unwrap();
        assert_eq!(p_skill.name, "ponytail");
        assert!(p_skill.is_core);
        assert_eq!(p_skill.scope, "system");
        assert!(!p_skill.content.is_empty());

        let c_skill = read_skill(Some(root), "caveman").unwrap();
        assert_eq!(c_skill.name, "caveman");
        assert!(c_skill.is_core);
        assert_eq!(c_skill.scope, "system");
        assert!(!c_skill.content.is_empty());
    }

    #[test]
    fn test_crud_lifecycle() {
        let dir = tempdir().unwrap();
        let root = dir.path();

        // 1. Save new skill
        let saved = save_skill(
            Some(root),
            "custom-helper",
            "A test helper skill",
            "# Custom Helper\nInstructions here.",
        )
        .unwrap();

        assert_eq!(saved.name, "custom-helper");
        assert_eq!(saved.description, "A test helper skill");
        assert_eq!(saved.scope, "project");
        assert!(!saved.is_core);

        // 2. Read skill
        let read = read_skill(Some(root), "custom-helper").unwrap();
        assert_eq!(read.name, "custom-helper");
        assert_eq!(read.description, "A test helper skill");
        assert_eq!(read.scope, "project");
        assert!(read.content.contains("# Custom Helper"));

        // 3. List skills includes core + project
        let list = list_skills(Some(root)).unwrap();
        assert!(list.iter().any(|s| s.name == "ponytail" && s.is_core));
        assert!(list.iter().any(|s| s.name == "caveman" && s.is_core));
        assert!(list
            .iter()
            .any(|s| s.name == "custom-helper" && !s.is_core && s.scope == "project"));

        // 4. Delete skill
        let deleted = delete_skill(Some(root), "custom-helper").unwrap();
        assert!(deleted);

        // 5. Read again fails
        assert!(read_skill(Some(root), "custom-helper").is_err());
    }

    #[test]
    fn test_frontmatter_parsing_and_generation() {
        let raw = r#"---
name: my-skill
description: Useful utility skill
category: devops
argument-hint: "[fast|slow]"
license: MIT
---

# Body Header
This is body text.
"#;
        let (meta, body) = parse_frontmatter(raw);
        let meta = meta.expect("should parse frontmatter");
        assert_eq!(meta.name, "my-skill");
        assert_eq!(meta.description, "Useful utility skill");
        assert_eq!(meta.category.as_deref(), Some("devops"));
        assert_eq!(meta.argument_hint.as_deref(), Some("[fast|slow]"));
        assert_eq!(meta.license.as_deref(), Some("MIT"));
        assert!(body.contains("# Body Header"));

        // Format content
        let formatted = format_skill_content("new-skill", "New description", "Pure markdown body");
        assert!(formatted.starts_with("---\nname: new-skill\ndescription: New description\n---"));
        assert!(formatted.contains("Pure markdown body"));

        let (meta2, body2) = parse_frontmatter(&formatted);
        let meta2 = meta2.expect("should re-parse generated frontmatter");
        assert_eq!(meta2.name, "new-skill");
        assert_eq!(meta2.description, "New description");
        assert!(body2.contains("Pure markdown body"));
    }

    #[test]
    fn test_path_traversal_prevention() {
        let dir = tempdir().unwrap();
        let root = dir.path();

        assert!(validate_skill_name("../evil").is_err());
        assert!(validate_skill_name("evil/../name").is_err());
        assert!(validate_skill_name("evil\\name").is_err());
        assert!(validate_skill_name("name/subdir").is_err());
        assert!(validate_skill_name("name with spaces").is_err());
        assert!(validate_skill_name("").is_err());
        assert!(validate_skill_name("valid_name-123").is_ok());

        assert!(save_skill(Some(root), "../evil", "desc", "content").is_err());
        assert!(read_skill(Some(root), "../evil").is_err());
        assert!(delete_skill(Some(root), "../evil").is_err());
    }

    #[test]
    fn test_auto_scaffold_creation() {
        let dir = tempdir().unwrap();
        let root = dir.path();
        let skills_path = root.join(".petak").join("skills");
        assert!(!skills_path.exists());

        let res = scaffold_skills_dir(Some(root)).unwrap();
        assert_eq!(res, skills_path);
        assert!(skills_path.exists());
        assert!(skills_path.is_dir());

        // Calling again is idempotent
        let res2 = scaffold_skills_dir(Some(root)).unwrap();
        assert_eq!(res2, skills_path);
    }
}
