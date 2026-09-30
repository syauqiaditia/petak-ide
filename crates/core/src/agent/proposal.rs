use crate::git::model::{DiffLine, DiffLineKind, Hunk};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{self, Sender};
use std::sync::{Mutex, RwLock};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ProposalStatus {
    Pending,
    Accepted,
    Rejected,
    Stale,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Proposal {
    pub id: String,
    pub slot_id: String,
    pub session_id: String,
    pub path: String,
    pub old_content: String,
    pub new_content: String,
    pub status: ProposalStatus,
    pub timestamp: u64,
    pub hunks: Vec<Hunk>,
}

/// Computes hunks between old_text and new_text using line-based diff.
pub fn compute_hunks(old_text: &str, new_text: &str) -> Vec<Hunk> {
    if old_text == new_text {
        return Vec::new();
    }

    let old_lines: Vec<&str> = if old_text.is_empty() {
        Vec::new()
    } else {
        old_text.lines().collect()
    };

    let new_lines: Vec<&str> = if new_text.is_empty() {
        Vec::new()
    } else {
        new_text.lines().collect()
    };

    // Fast LCS-based line diff
    let n = old_lines.len();
    let m = new_lines.len();

    // DP table for LCS
    let mut dp = vec![vec![0u32; m + 1]; n + 1];
    for i in 0..n {
        for j in 0..m {
            if old_lines[i] == new_lines[j] {
                dp[i + 1][j + 1] = dp[i][j] + 1;
            } else {
                dp[i + 1][j + 1] = dp[i + 1][j].max(dp[i][j + 1]);
            }
        }
    }

    // Backtrack to build diff ops: (DiffLineKind, text, old_no, new_no)
    let mut ops = Vec::new();
    let mut i = n;
    let mut j = m;

    while i > 0 || j > 0 {
        if i > 0 && j > 0 && old_lines[i - 1] == new_lines[j - 1] {
            ops.push((
                DiffLineKind::Context,
                old_lines[i - 1].to_string(),
                Some(i as u32),
                Some(j as u32),
            ));
            i -= 1;
            j -= 1;
        } else if j > 0 && (i == 0 || dp[i][j - 1] >= dp[i - 1][j]) {
            ops.push((
                DiffLineKind::Add,
                new_lines[j - 1].to_string(),
                None,
                Some(j as u32),
            ));
            j -= 1;
        } else if i > 0 && (j == 0 || dp[i][j - 1] < dp[i - 1][j]) {
            ops.push((
                DiffLineKind::Del,
                old_lines[i - 1].to_string(),
                Some(i as u32),
                None,
            ));
            i -= 1;
        }
    }

    ops.reverse();

    // Group into hunks with context
    let mut hunks = Vec::new();
    let mut idx = 0;
    let total_ops = ops.len();

    while idx < total_ops {
        // Find next change
        while idx < total_ops && ops[idx].0 == DiffLineKind::Context {
            idx += 1;
        }
        if idx >= total_ops {
            break;
        }

        // Include up to 3 context lines before
        let start_ctx = idx.saturating_sub(3);

        // Find end of changes (allow up to 6 context lines between changes within the same hunk)
        let mut end_idx = idx;
        let mut lookahead = idx;
        while lookahead < total_ops {
            if ops[lookahead].0 != DiffLineKind::Context {
                end_idx = lookahead;
            } else if lookahead - end_idx > 6 {
                break;
            }
            lookahead += 1;
        }

        // Include up to 3 context lines after
        let end_ctx = (end_idx + 4).min(total_ops);

        // Build hunk
        let slice = &ops[start_ctx..end_ctx];
        let mut hunk_lines = Vec::new();
        let mut old_start = 0;
        let mut old_count = 0;
        let mut new_start = 0;
        let mut new_count = 0;

        for (kind, text, old_no, new_no) in slice {
            if *kind == DiffLineKind::Context || *kind == DiffLineKind::Del {
                if old_start == 0 {
                    old_start = old_no.unwrap_or(1);
                }
                old_count += 1;
            }
            if *kind == DiffLineKind::Context || *kind == DiffLineKind::Add {
                if new_start == 0 {
                    new_start = new_no.unwrap_or(1);
                }
                new_count += 1;
            }

            hunk_lines.push(DiffLine {
                kind: *kind,
                text: text.clone(),
                old_no: *old_no,
                new_no: *new_no,
            });
        }

        if old_start == 0 {
            old_start = 1;
        }
        if new_start == 0 {
            new_start = 1;
        }

        let header = format!("@@ -{old_start},{old_count} +{new_start},{new_count} @@");
        hunks.push(Hunk {
            old_start,
            old_lines: old_count,
            new_start,
            new_lines: new_count,
            header,
            lines: hunk_lines,
        });

        idx = end_ctx;
    }

    hunks
}

/// Applies a single hunk to the text.
pub fn apply_hunk_to_text(old_text: &str, hunk: &Hunk) -> Result<String, String> {
    let old_lines: Vec<&str> = if old_text.is_empty() {
        Vec::new()
    } else {
        old_text.lines().collect()
    };

    let start_idx = if hunk.old_start == 0 {
        0
    } else {
        (hunk.old_start - 1) as usize
    };

    let mut result_lines = Vec::new();
    if start_idx <= old_lines.len() {
        result_lines.extend_from_slice(&old_lines[..start_idx]);
    } else {
        return Err(format!(
            "Hunk start line {} out of bounds (file has {} lines)",
            hunk.old_start,
            old_lines.len()
        ));
    }

    // Insert new lines from hunk
    for line in &hunk.lines {
        match line.kind {
            DiffLineKind::Context | DiffLineKind::Add => {
                result_lines.push(line.text.as_str());
            }
            DiffLineKind::Del | DiffLineKind::NoNewline => {}
        }
    }

    // Append remaining old lines
    let end_idx = (start_idx + hunk.old_lines as usize).min(old_lines.len());
    if end_idx <= old_lines.len() {
        result_lines.extend_from_slice(&old_lines[end_idx..]);
    }

    let mut out = result_lines.join("\n");
    if old_text.ends_with('\n') || (old_text.is_empty() && !out.is_empty()) {
        out.push('\n');
    }
    Ok(out)
}

pub struct ProposalBuffer {
    proposals: RwLock<HashMap<String, Proposal>>,
    responders: Mutex<HashMap<String, Sender<Result<(), String>>>>,
    order: RwLock<Vec<String>>,
    project_root: Mutex<Option<PathBuf>>,
    next_id: AtomicU64,
}

impl Default for ProposalBuffer {
    fn default() -> Self {
        Self::new(None)
    }
}

impl ProposalBuffer {
    pub fn new(project_root: Option<PathBuf>) -> Self {
        Self {
            proposals: RwLock::new(HashMap::new()),
            responders: Mutex::new(HashMap::new()),
            order: RwLock::new(Vec::new()),
            project_root: Mutex::new(project_root),
            next_id: AtomicU64::new(1),
        }
    }

    pub fn set_project_root(&self, root: Option<PathBuf>) {
        let mut pr = self.project_root.lock().unwrap();
        *pr = root;
    }

    pub fn project_root(&self) -> Option<PathBuf> {
        self.project_root.lock().unwrap().clone()
    }

    /// Creates a proposal from agent fs/write_text_file.
    pub fn create_proposal(
        &self,
        slot_id: &str,
        session_id: &str,
        path: &str,
        new_content: &str,
    ) -> (Proposal, mpsc::Receiver<Result<(), String>>) {
        let root_opt = self.project_root();
        let old_content = if let Some(ref root) = root_opt {
            if let Ok(resolved) = crate::fsops::resolve_in_root(root, path) {
                crate::fs::read_file(&resolved).unwrap_or_default()
            } else {
                String::new()
            }
        } else {
            String::new()
        };

        let hunks = compute_hunks(&old_content, new_content);
        let id_num = self.next_id.fetch_add(1, Ordering::SeqCst);
        let prop_id = format!("prop_{id_num}");

        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);

        let proposal = Proposal {
            id: prop_id.clone(),
            slot_id: slot_id.to_string(),
            session_id: session_id.to_string(),
            path: path.to_string(),
            old_content,
            new_content: new_content.to_string(),
            status: ProposalStatus::Pending,
            timestamp: now,
            hunks,
        };

        let (tx, rx) = mpsc::channel();
        {
            let mut props = self.proposals.write().unwrap();
            let mut order = self.order.write().unwrap();
            props.insert(prop_id.clone(), proposal.clone());
            order.push(prop_id.clone());

            let mut responders = self.responders.lock().unwrap();
            responders.insert(prop_id, tx);
        }

        (proposal, rx)
    }

    /// Accept entire proposal: write new_content to disk via fsops + local_history.
    pub fn accept_proposal(
        &self,
        proposal_id: &str,
        lh_store: Option<&Path>,
    ) -> Result<(), String> {
        let (path_str, old_content, new_content) = {
            let mut props = self.proposals.write().unwrap();
            let prop = props
                .get_mut(proposal_id)
                .ok_or_else(|| format!("Proposal '{proposal_id}' tidak ditemukan"))?;

            if prop.status != ProposalStatus::Pending {
                return Err(format!(
                    "Proposal '{proposal_id}' sudah tidak berstatus pending"
                ));
            }

            (
                prop.path.clone(),
                prop.old_content.clone(),
                prop.new_content.clone(),
            )
        };

        let root = self
            .project_root()
            .ok_or_else(|| "Project root tidak diatur".to_string())?;

        let resolved = crate::fsops::resolve_in_root(&root, &path_str)
            .map_err(|e| format!("Path tidak valid: {e}"))?;

        // Stale check: verify current disk content matches proposal old_content
        let current_disk = crate::fs::read_file(&resolved).unwrap_or_default();
        if current_disk != old_content {
            let mut props = self.proposals.write().unwrap();
            if let Some(prop) = props.get_mut(proposal_id) {
                prop.status = ProposalStatus::Stale;
            }
            if let Some(tx) = self.responders.lock().unwrap().remove(proposal_id) {
                let _ = tx.send(Err(
                    "Proposal kadaluarsa: file di disk telah berubah".to_string()
                ));
            }
            return Err("Proposal kadaluarsa: file di disk telah berubah".to_string());
        }

        // Write file
        crate::fs::save_file(&resolved, &new_content)
            .map_err(|e| format!("Gagal menyimpan file: {e}"))?;

        // Record in local history if store provided
        if let Some(store) = lh_store {
            let _ = crate::local_history::snapshot(
                store,
                &path_str,
                new_content.as_bytes(),
                "agent_proposal",
            );
        }

        // Mark accepted and respond to agent
        {
            let mut props = self.proposals.write().unwrap();
            if let Some(prop) = props.get_mut(proposal_id) {
                prop.status = ProposalStatus::Accepted;
            }
        }

        if let Some(tx) = self.responders.lock().unwrap().remove(proposal_id) {
            let _ = tx.send(Ok(()));
        }

        Ok(())
    }

    /// Reject proposal: do not write to disk, reply error to agent.
    pub fn reject_proposal(&self, proposal_id: &str) -> Result<(), String> {
        {
            let mut props = self.proposals.write().unwrap();
            let prop = props
                .get_mut(proposal_id)
                .ok_or_else(|| format!("Proposal '{proposal_id}' tidak ditemukan"))?;

            if prop.status != ProposalStatus::Pending {
                return Err(format!(
                    "Proposal '{proposal_id}' sudah tidak berstatus pending"
                ));
            }

            prop.status = ProposalStatus::Rejected;
        }

        if let Some(tx) = self.responders.lock().unwrap().remove(proposal_id) {
            let _ = tx.send(Err("ditolak user".to_string()));
        }

        Ok(())
    }

    /// Accept single hunk of a proposal.
    pub fn accept_hunk(
        &self,
        proposal_id: &str,
        hunk_idx: usize,
        lh_store: Option<&Path>,
    ) -> Result<(), String> {
        let (path_str, old_content, new_content, hunk_to_apply) = {
            let props = self.proposals.read().unwrap();
            let prop = props
                .get(proposal_id)
                .ok_or_else(|| format!("Proposal '{proposal_id}' tidak ditemukan"))?;

            if prop.status != ProposalStatus::Pending {
                return Err(format!(
                    "Proposal '{proposal_id}' sudah tidak berstatus pending"
                ));
            }

            let hunk = prop
                .hunks
                .get(hunk_idx)
                .ok_or_else(|| format!("Indeks hunk {} tidak valid", hunk_idx))?
                .clone();

            (
                prop.path.clone(),
                prop.old_content.clone(),
                prop.new_content.clone(),
                hunk,
            )
        };

        let root = self
            .project_root()
            .ok_or_else(|| "Project root tidak diatur".to_string())?;

        let resolved = crate::fsops::resolve_in_root(&root, &path_str)
            .map_err(|e| format!("Path tidak valid: {e}"))?;

        // Stale check
        let current_disk = crate::fs::read_file(&resolved).unwrap_or_default();
        if current_disk != old_content {
            let mut props = self.proposals.write().unwrap();
            if let Some(prop) = props.get_mut(proposal_id) {
                prop.status = ProposalStatus::Stale;
            }
            if let Some(tx) = self.responders.lock().unwrap().remove(proposal_id) {
                let _ = tx.send(Err(
                    "Proposal kadaluarsa: file di disk telah berubah".to_string()
                ));
            }
            return Err("Proposal kadaluarsa: file di disk telah berubah".to_string());
        }

        // Apply hunk to old_content
        let applied_content = apply_hunk_to_text(&old_content, &hunk_to_apply)?;

        // Write applied content to disk
        crate::fs::save_file(&resolved, &applied_content)
            .map_err(|e| format!("Gagal menyimpan file: {e}"))?;

        if let Some(store) = lh_store {
            let _ = crate::local_history::snapshot(
                store,
                &path_str,
                applied_content.as_bytes(),
                "agent_proposal_hunk",
            );
        }

        // Update proposal with applied content and recomputed hunks
        let remaining_hunks = compute_hunks(&applied_content, &new_content);
        let is_complete = remaining_hunks.is_empty();

        {
            let mut props = self.proposals.write().unwrap();
            if let Some(prop) = props.get_mut(proposal_id) {
                prop.old_content = applied_content;
                prop.hunks = remaining_hunks;
                if is_complete {
                    prop.status = ProposalStatus::Accepted;
                }
            }
        }

        if is_complete {
            if let Some(tx) = self.responders.lock().unwrap().remove(proposal_id) {
                let _ = tx.send(Ok(()));
            }
        }

        Ok(())
    }

    pub fn list_proposals(&self, slot_id: Option<&str>) -> Vec<Proposal> {
        let props = self.proposals.read().unwrap();
        let order = self.order.read().unwrap();

        let mut res = Vec::new();
        for id in order.iter() {
            if let Some(prop) = props.get(id) {
                if let Some(s_id) = slot_id {
                    if prop.slot_id != s_id {
                        continue;
                    }
                }
                res.push(prop.clone());
            }
        }
        res
    }

    pub fn get_proposal(&self, proposal_id: &str) -> Option<Proposal> {
        let props = self.proposals.read().unwrap();
        props.get(proposal_id).cloned()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_compute_hunks_and_apply() {
        let old = "line 1\nline 2\nline 3\n";
        let new = "line 1\nline 2 modified\nline 3\nline 4\n";

        let hunks = compute_hunks(old, new);
        assert!(!hunks.is_empty());

        let applied = apply_hunk_to_text(old, &hunks[0]).unwrap();
        assert_eq!(applied, new);
    }

    #[test]
    fn test_proposal_accept_reject_and_stale() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().to_path_buf();
        let file_path = root.join("test.txt");

        std::fs::write(&file_path, "initial content\n").unwrap();

        let buf = ProposalBuffer::new(Some(root.clone()));

        // 1. Create proposal
        let (prop, rx) = buf.create_proposal("slot1", "sess1", "test.txt", "updated content\n");
        assert_eq!(prop.status, ProposalStatus::Pending);

        // 2. Reject proposal
        buf.reject_proposal(&prop.id).unwrap();
        let res = rx.recv().unwrap();
        assert_eq!(res.unwrap_err(), "ditolak user");
        assert_eq!(
            std::fs::read_to_string(&file_path).unwrap(),
            "initial content\n"
        );

        // 3. Create second proposal
        let (prop2, rx2) = buf.create_proposal("slot1", "sess1", "test.txt", "second content\n");

        // Simulate file modified on disk behind our back
        std::fs::write(&file_path, "externally modified\n").unwrap();

        // 4. Try to accept: must fail with stale detection
        let accept_err = buf.accept_proposal(&prop2.id, None);
        assert!(accept_err.is_err());
        assert!(accept_err.unwrap_err().contains("kadaluarsa"));

        let agent_res = rx2.recv().unwrap();
        assert!(agent_res.unwrap_err().contains("kadaluarsa"));

        // File remains externally modified
        assert_eq!(
            std::fs::read_to_string(&file_path).unwrap(),
            "externally modified\n"
        );
    }
}
