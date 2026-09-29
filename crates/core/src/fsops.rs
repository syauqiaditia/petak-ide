use std::fs;
use std::io;
use std::path::{Component, Path, PathBuf};

/// Validates file or directory segment name:
/// Reject empty, '.', '..', '/', '\', NUL byte, or >255 bytes.
pub fn validate_name(name: &str) -> io::Result<()> {
    if name.is_empty() {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, "Name cannot be empty"));
    }
    if name == "." || name == ".." {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, "Name cannot be '.' or '..'"));
    }
    if name.contains('/') || name.contains('\\') {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Name cannot contain path separators ('/' or '\\')",
        ));
    }
    if name.contains('\0') {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Name cannot contain NUL byte",
        ));
    }
    if name.len() > 255 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Name cannot exceed 255 bytes",
        ));
    }
    Ok(())
}

/// Resolves a relative path safely within root:
/// Reject absolute paths, '..' components escaping root, and symlinks escaping root.
pub fn resolve_in_root(root: &Path, rel: &str) -> io::Result<PathBuf> {
    if rel.starts_with('/') || rel.starts_with('\\') || Path::new(rel).is_absolute() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Absolute path is not allowed",
        ));
    }

    let canonical_root = root.canonicalize()?;
    let mut normalized_rel = PathBuf::new();

    for comp in Path::new(rel).components() {
        match comp {
            Component::Normal(c) => normalized_rel.push(c),
            Component::CurDir => {}
            Component::ParentDir => {
                if !normalized_rel.pop() {
                    return Err(io::Error::new(
                        io::ErrorKind::PermissionDenied,
                        "Path escapes root via '..'",
                    ));
                }
            }
            Component::RootDir | Component::Prefix(_) => {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidInput,
                    "Absolute path is not allowed",
                ));
            }
        }
    }

    let tentative = canonical_root.join(&normalized_rel);

    // Find nearest existing ancestor
    let mut curr = tentative.as_path();
    while !curr.exists() && !curr.is_symlink() {
        if let Some(parent) = curr.parent() {
            curr = parent;
        } else {
            break;
        }
    }

    let canonical_ancestor = curr.canonicalize()?;
    if !canonical_ancestor.starts_with(&canonical_root) {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "Symlink escapes root",
        ));
    }

    let remainder = tentative.strip_prefix(curr).unwrap_or(Path::new(""));
    let resolved = if remainder.as_os_str().is_empty() {
        canonical_ancestor
    } else {
        canonical_ancestor.join(remainder)
    };
    if !resolved.starts_with(&canonical_root) {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "Resolved path escapes root",
        ));
    }

    // If resolved itself exists or is symlink, check target
    if resolved.is_symlink() {
        let target = resolved.canonicalize()?;
        if !target.starts_with(&canonical_root) {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "Symlink target escapes root",
            ));
        }
    }

    Ok(resolved)
}

/// Creates a new file at `rel` within `root` with optional template ("dart" | "kotlin" | "swift").
/// Automatically creates parent directories. Fails with AlreadyExists if file already exists.
pub fn create_file(root: &Path, rel: &str, template: Option<&str>) -> io::Result<PathBuf> {
    for seg in rel.split(['/', '\\']) {
        if !seg.is_empty() {
            validate_name(seg)?;
        }
    }

    let target = resolve_in_root(root, rel)?;
    if target.exists() || target.is_symlink() {
        return Err(io::Error::new(
            io::ErrorKind::AlreadyExists,
            "File already exists",
        ));
    }

    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)?;
    }

    let content = match template {
        Some("dart") => String::new(),
        Some("swift") => "import Foundation\n".to_string(),
        Some("kotlin") => {
            let segs: Vec<&str> = rel.split(['/', '\\']).filter(|s| !s.is_empty()).collect();
            let mut pkg_parts = Vec::new();
            let mut found_src = false;
            for i in 0..segs.len() {
                if i + 2 < segs.len()
                    && segs[i] == "src"
                    && (segs[i + 1] == "main" || segs[i + 1] == "test")
                    && (segs[i + 2] == "kotlin" || segs[i + 2] == "java")
                {
                    for item in segs.iter().take(segs.len().saturating_sub(1)).skip(i + 3) {
                        pkg_parts.push(*item);
                    }
                    found_src = true;
                    break;
                }
            }
            if !found_src && segs.len() > 1 {
                for item in segs.iter().take(segs.len() - 1) {
                    pkg_parts.push(*item);
                }
            }
            let class_name = Path::new(segs.last().unwrap_or(&""))
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("NewClass");

            if pkg_parts.is_empty() {
                format!("class {}\n", class_name)
            } else {
                format!("package {}\n\nclass {}\n", pkg_parts.join("."), class_name)
            }
        }
        _ => String::new(),
    };

    crate::fs::save_file(&target, &content)?;
    Ok(target)
}

/// Creates a new directory at `rel` within `root`.
/// Automatically creates parent directories. Fails with AlreadyExists if directory exists.
pub fn create_dir(root: &Path, rel: &str) -> io::Result<PathBuf> {
    for seg in rel.split(['/', '\\']) {
        if !seg.is_empty() {
            validate_name(seg)?;
        }
    }

    let target = resolve_in_root(root, rel)?;
    if target.exists() {
        return Err(io::Error::new(
            io::ErrorKind::AlreadyExists,
            "Directory already exists",
        ));
    }

    fs::create_dir_all(&target)?;
    Ok(target)
}

/// Renames `from` to `to` within `root`. Never overwrites existing targets.
/// Supports case-insensitive filesystem renames (e.g. `a.dart` -> `A.dart`) safely.
pub fn rename(root: &Path, from: &str, to: &str) -> io::Result<()> {
    let src = resolve_in_root(root, from)?;
    if !src.exists() && !src.is_symlink() {
        return Err(io::Error::new(
            io::ErrorKind::NotFound,
            "Source path does not exist",
        ));
    }

    let to_rel = if !to.contains('/') && !to.contains('\\') {
        if let Some(parent) = Path::new(from).parent() {
            if parent.as_os_str().is_empty() {
                to.to_string()
            } else {
                parent.join(to).to_string_lossy().to_string()
            }
        } else {
            to.to_string()
        }
    } else {
        to.to_string()
    };

    for seg in to_rel.split(['/', '\\']) {
        if !seg.is_empty() {
            validate_name(seg)?;
        }
    }

    let dst = resolve_in_root(root, &to_rel)?;
    if src == dst {
        return Ok(());
    }

    let is_case_only = src.to_string_lossy().to_lowercase() == dst.to_string_lossy().to_lowercase();
    if is_case_only {
        let parent = src.parent().unwrap_or(root);
        let tmp_name = format!(
            ".petak-rename-case-tmp-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        );
        let tmp_path = parent.join(tmp_name);
        fs::rename(&src, &tmp_path)?;
        if let Err(e) = fs::rename(&tmp_path, &dst) {
            let _ = fs::rename(&tmp_path, &src);
            return Err(e);
        }
        return Ok(());
    }

    if dst.exists() || dst.is_symlink() {
        return Err(io::Error::new(
            io::ErrorKind::AlreadyExists,
            "Target already exists",
        ));
    }

    if let Some(parent) = dst.parent() {
        fs::create_dir_all(parent)?;
    }

    fs::rename(&src, &dst)?;
    Ok(())
}

/// Moves `srcs` into `dest_dir` within `root`.
/// Prevents moving a directory into itself or its descendant. Never overwrites.
pub fn move_into(root: &Path, srcs: &[&str], dest_dir: &str) -> io::Result<Vec<String>> {
    let canonical_root = root.canonicalize()?;
    let dest_path = resolve_in_root(root, dest_dir)?;
    if !dest_path.is_dir() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Destination is not a directory",
        ));
    }

    let canonical_dest = dest_path.canonicalize()?;
    let mut moved = Vec::new();

    for src_rel in srcs {
        let src_path = resolve_in_root(root, src_rel)?;
        if !src_path.exists() && !src_path.is_symlink() {
            return Err(io::Error::new(
                io::ErrorKind::NotFound,
                format!("Source '{}' does not exist", src_rel),
            ));
        }

        if src_path.is_dir() {
            let canonical_src = src_path.canonicalize()?;
            if canonical_dest == canonical_src || canonical_dest.starts_with(&canonical_src) {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidInput,
                    "Cannot move directory into itself or its subdirectory",
                ));
            }
        }

        let file_name = src_path
            .file_name()
            .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "Invalid source file name"))?;
        let target_path = dest_path.join(file_name);

        if target_path.exists() || target_path.is_symlink() {
            return Err(io::Error::new(
                io::ErrorKind::AlreadyExists,
                format!("Target '{}' already exists", target_path.display()),
            ));
        }

        fs::rename(&src_path, &target_path)?;
        let rel_moved = target_path
            .strip_prefix(&canonical_root)
            .unwrap_or(&target_path)
            .to_string_lossy()
            .replace('\\', "/");
        moved.push(rel_moved);
    }

    Ok(moved)
}

fn next_copy_target(dest_dir: &Path, file_name: &str) -> PathBuf {
    let original = dest_dir.join(file_name);
    if !original.exists() && !original.is_symlink() {
        return original;
    }

    let p = Path::new(file_name);
    let stem = p.file_stem().and_then(|s| s.to_str()).unwrap_or(file_name);
    let ext = p.extension().and_then(|e| e.to_str());

    let candidate1 = match ext {
        Some(e) => format!("{} copy.{}", stem, e),
        None => format!("{} copy", stem),
    };
    let target1 = dest_dir.join(&candidate1);
    if !target1.exists() && !target1.is_symlink() {
        return target1;
    }

    let mut n = 2;
    loop {
        let candidate = match ext {
            Some(e) => format!("{} copy {}.{}", stem, n, e),
            None => format!("{} copy {}", stem, n),
        };
        let target = dest_dir.join(&candidate);
        if !target.exists() && !target.is_symlink() {
            return target;
        }
        n += 1;
    }
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> io::Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let ft = entry.file_type()?;
        let child_src = entry.path();
        let child_dst = dst.join(entry.file_name());
        if ft.is_dir() {
            copy_dir_recursive(&child_src, &child_dst)?;
        } else {
            fs::copy(&child_src, &child_dst)?;
        }
    }
    Ok(())
}

/// Recursively copies `srcs` into `dest_dir`.
/// If destination name conflicts, renames to `name copy.ext`, `name copy 2.ext`, etc.
pub fn copy_into(root: &Path, srcs: &[&str], dest_dir: &str) -> io::Result<Vec<String>> {
    let canonical_root = root.canonicalize()?;
    let dest_path = resolve_in_root(root, dest_dir)?;
    if !dest_path.is_dir() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Destination is not a directory",
        ));
    }

    let mut copied = Vec::new();

    for src_rel in srcs {
        let src_path = resolve_in_root(root, src_rel)?;
        if !src_path.exists() && !src_path.is_symlink() {
            return Err(io::Error::new(
                io::ErrorKind::NotFound,
                format!("Source '{}' does not exist", src_rel),
            ));
        }

        let file_name = src_path
            .file_name()
            .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "Invalid source file name"))?
            .to_string_lossy();

        let target_path = next_copy_target(&dest_path, &file_name);
        if src_path.is_dir() {
            copy_dir_recursive(&src_path, &target_path)?;
        } else {
            fs::copy(&src_path, &target_path)?;
        }

        let rel_copied = target_path
            .strip_prefix(&canonical_root)
            .unwrap_or(&target_path)
            .to_string_lossy()
            .replace('\\', "/");
        copied.push(rel_copied);
    }

    Ok(copied)
}

/// Duplicates a file or directory at `rel` within its parent directory.
/// Resolves naming collisions with `copy`, `copy 2`, etc.
pub fn duplicate(root: &Path, rel: &str) -> io::Result<PathBuf> {
    let src_path = resolve_in_root(root, rel)?;
    if !src_path.exists() && !src_path.is_symlink() {
        return Err(io::Error::new(
            io::ErrorKind::NotFound,
            "Source path does not exist",
        ));
    }

    let parent = src_path.parent().ok_or_else(|| {
        io::Error::new(io::ErrorKind::InvalidInput, "Cannot duplicate root directory")
    })?;
    let file_name = src_path
        .file_name()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "Invalid file name"))?
        .to_string_lossy();

    let target_path = next_copy_target(parent, &file_name);
    if src_path.is_dir() {
        copy_dir_recursive(&src_path, &target_path)?;
    } else {
        fs::copy(&src_path, &target_path)?;
    }

    Ok(target_path)
}

/// Moves files/directories at `rels` to trash using `trash` crate.
pub fn trash(root: &Path, rels: &[&str]) -> io::Result<()> {
    for rel in rels {
        let p = resolve_in_root(root, rel)?;
        if p.exists() || p.is_symlink() {
            trash::delete(&p).map_err(|e| io::Error::other(e.to_string()))?;
        }
    }
    Ok(())
}
