use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::fs;
use std::io::{self, Write};
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Entry {
    pub id: String,
    pub path: String,
    pub ts_ms: u64,
    pub blob: String,
    pub kind: String,
    pub label: Option<String>,
}

fn load_entries(store: &Path) -> io::Result<Vec<Entry>> {
    let index_path = store.join("index.jsonl");
    if !index_path.exists() {
        return Ok(Vec::new());
    }
    let content = fs::read_to_string(&index_path)?;
    let mut entries = Vec::new();
    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        if let Ok(entry) = serde_json::from_str::<Entry>(line) {
            entries.push(entry);
        }
    }
    Ok(entries)
}

/// Takes a snapshot of `rel` with `content` and `kind`.
/// Skips if the previous entry for this path has the identical blob hash (dedup).
pub fn snapshot(
    store: &Path,
    rel: &str,
    content: &[u8],
    kind: &str,
) -> io::Result<Option<Entry>> {
    let norm_rel = rel
        .replace('\\', "/")
        .trim_start_matches('/')
        .to_string();

    let mut hasher = Sha256::new();
    hasher.update(content);
    let blob = format!("{:x}", hasher.finalize());

    let entries = load_entries(store)?;
    if let Some(last) = entries.iter().rfind(|e| e.path == norm_rel) {
        let is_content_dup =
            (kind == "save" || kind == "external") && (last.kind == "save" || last.kind == "external");
        if last.blob == blob && (is_content_dup || last.kind == kind) {
            return Ok(None);
        }
    }

    let blobs_dir = store.join("blobs");
    fs::create_dir_all(&blobs_dir)?;
    let blob_path = blobs_dir.join(&blob);
    if !blob_path.exists() {
        let tmp_path = blobs_dir.join(format!(".{}.tmp", blob));
        fs::write(&tmp_path, content)?;
        let _ = fs::rename(&tmp_path, &blob_path);
    }

    let ts_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;
    let id = format!("{}_{}", ts_ms, &blob[..std::cmp::min(12, blob.len())]);

    let entry = Entry {
        id,
        path: norm_rel,
        ts_ms,
        blob,
        kind: kind.to_string(),
        label: None,
    };

    let index_path = store.join("index.jsonl");
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&index_path)?;
    let line = serde_json::to_string(&entry)
        .map_err(io::Error::other)?;
    writeln!(file, "{}", line)?;

    Ok(Some(entry))
}

/// Returns a list of entries matching `rel_prefix`, newest first.
/// Prefix folder queries include historical entries for files that have since been deleted.
pub fn list(store: &Path, rel_prefix: &str) -> io::Result<Vec<Entry>> {
    let prefix = rel_prefix
        .replace('\\', "/")
        .trim_start_matches('/')
        .trim_end_matches('/')
        .to_string();

    let entries = load_entries(store)?;
    let mut indexed: Vec<(usize, Entry)> = entries
        .into_iter()
        .enumerate()
        .filter(|(_, e)| {
            if prefix.is_empty() || prefix == "." {
                true
            } else {
                e.path == prefix || e.path.starts_with(&format!("{}/", prefix))
            }
        })
        .collect();

    // Sort newest first; if same millisecond, later appended entry is newer
    indexed.sort_by(|(idx_a, a), (idx_b, b)| {
        b.ts_ms.cmp(&a.ts_ms).then_with(|| idx_b.cmp(idx_a))
    });

    Ok(indexed.into_iter().map(|(_, e)| e).collect())
}

/// Reads the blob bytes for a specific history entry `id`.
pub fn read(store: &Path, id: &str) -> io::Result<Vec<u8>> {
    let entries = load_entries(store)?;
    let entry = entries
        .into_iter()
        .find(|e| e.id == id)
        .ok_or_else(|| {
            io::Error::new(
                io::ErrorKind::NotFound,
                format!("History entry '{}' not found", id),
            )
        })?;

    let blob_path = store.join("blobs").join(&entry.blob);
    fs::read(blob_path)
}

/// Adds a user or system label to the given file path in Local History.
pub fn put_label(store: &Path, rel: &str, label: &str) -> io::Result<Entry> {
    let norm_rel = rel
        .replace('\\', "/")
        .trim_start_matches('/')
        .to_string();

    let entries = load_entries(store)?;
    let blob = entries
        .iter()
        .rfind(|e| e.path == norm_rel)
        .map(|e| e.blob.clone())
        .unwrap_or_else(|| {
            let hasher = Sha256::new();
            format!("{:x}", hasher.finalize())
        });

    let blobs_dir = store.join("blobs");
    fs::create_dir_all(&blobs_dir)?;
    let blob_path = blobs_dir.join(&blob);
    if !blob_path.exists() {
        let _ = fs::write(&blob_path, b"");
    }

    let ts_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;
    let id = format!("{}_{}", ts_ms, &blob[..std::cmp::min(12, blob.len())]);

    let entry = Entry {
        id,
        path: norm_rel,
        ts_ms,
        blob,
        kind: "label".to_string(),
        label: Some(label.to_string()),
    };

    let index_path = store.join("index.jsonl");
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&index_path)?;
    let line = serde_json::to_string(&entry)
        .map_err(io::Error::other)?;
    writeln!(file, "{}", line)?;

    Ok(entry)
}

/// Prunes old entries (> max_age_days) and enforces max_bytes storage limit.
/// Label entries are preserved across age pruning.
/// Cleans up unreferenced (orphan) blob files.
pub fn prune(store: &Path, max_age_days: u64, max_bytes: u64) -> io::Result<()> {
    let mut entries = load_entries(store)?;
    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;
    let max_age_ms = max_age_days * 24 * 60 * 60 * 1000;

    // Filter by age (label entries preserved)
    entries.retain(|e| e.kind == "label" || now_ms.saturating_sub(e.ts_ms) <= max_age_ms);

    // Calculate total blob bytes
    let blobs_dir = store.join("blobs");
    if blobs_dir.exists() {
        let mut total_bytes: u64 = 0;
        let mut blob_sizes = std::collections::HashMap::new();

        if let Ok(dir_entries) = fs::read_dir(&blobs_dir) {
            for entry in dir_entries.flatten() {
                if let Ok(meta) = entry.metadata() {
                    let size = meta.len();
                    total_bytes += size;
                    blob_sizes.insert(entry.file_name().to_string_lossy().to_string(), size);
                }
            }
        }

        // If exceeding max_bytes, drop oldest non-label entries
        if total_bytes > max_bytes {
            // Sort by oldest first
            let mut sorted_indices: Vec<usize> = (0..entries.len()).collect();
            sorted_indices.sort_by(|&a, &b| entries[a].ts_ms.cmp(&entries[b].ts_ms));

            let mut to_remove = HashSet::new();
            for idx in sorted_indices {
                if entries[idx].kind == "label" {
                    continue;
                }
                let blob = &entries[idx].blob;
                if let Some(sz) = blob_sizes.get(blob) {
                    if total_bytes > max_bytes {
                        total_bytes = total_bytes.saturating_sub(*sz);
                        to_remove.insert(idx);
                    }
                }
            }

            let mut remaining = Vec::new();
            for (idx, e) in entries.into_iter().enumerate() {
                if !to_remove.contains(&idx) {
                    remaining.push(e);
                }
            }
            entries = remaining;
        }
    }

    // Orphan blobs cleanup: remove any blob not referenced by surviving entries
    let referenced_blobs: HashSet<&str> = entries.iter().map(|e| e.blob.as_str()).collect();
    if blobs_dir.exists() {
        if let Ok(dir_entries) = fs::read_dir(&blobs_dir) {
            for entry in dir_entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                if !referenced_blobs.contains(name.as_str()) && !name.starts_with('.') {
                    let _ = fs::remove_file(entry.path());
                }
            }
        }
    }

    // Atomically rewrite index.jsonl
    let index_path = store.join("index.jsonl");
    let tmp_path = store.join(".index.jsonl.tmp");
    {
        let mut file = fs::File::create(&tmp_path)?;
        for entry in &entries {
            let line = serde_json::to_string(entry)
                .map_err(io::Error::other)?;
            writeln!(file, "{}", line)?;
        }
        file.sync_all()?;
    }
    fs::rename(&tmp_path, &index_path)?;

    Ok(())
}
