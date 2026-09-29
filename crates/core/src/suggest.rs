use std::collections::{HashMap, HashSet};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock, RwLock};
use std::time::SystemTime;

use serde::{Deserialize, Serialize};
use sha2::Digest;

pub const MAX_INDEX_ENTRIES: usize = 20_000;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SuggestItem {
    pub text: String,
    pub freq: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub args_template: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CallSiteInfo {
    pub name: String,
    pub named_args: Vec<String>,
}

#[derive(Debug, Clone, Default)]
pub struct FileSymbols {
    pub calls: Vec<CallSiteInfo>,
    pub idents: HashMap<String, u32>,
    pub mtime: u64,
}

#[derive(Debug, Clone, Default)]
pub struct CallAggregate {
    pub count: u32,
    pub arg_counts: HashMap<String, u32>,
    pub arg_order: Vec<String>,
}

pub struct SuggestIndex {
    pub root: PathBuf,
    pub app_data: Option<PathBuf>,
    pub files: HashMap<PathBuf, FileSymbols>,
    pub calls: HashMap<String, CallAggregate>,
    pub idents: HashMap<String, u32>,
}

impl SuggestIndex {
    pub fn new<P: AsRef<Path>>(root: P) -> Self {
        Self {
            root: root.as_ref().to_path_buf(),
            app_data: None,
            files: HashMap::new(),
            calls: HashMap::new(),
            idents: HashMap::new(),
        }
    }

    pub fn set_app_data_dir(&mut self, dir: PathBuf) {
        self.app_data = Some(dir);
    }

    pub fn total_indexed_entries(&self) -> usize {
        let calls_count = self.calls.values().filter(|c| c.count >= 2).count();
        let idents_count = self
            .idents
            .iter()
            .filter(|(k, &v)| v >= 2 && !self.calls.contains_key(&format!("{}(", k)))
            .count();
        calls_count + idents_count
    }

    pub fn estimated_memory_bytes(&self) -> usize {
        let mut bytes = std::mem::size_of::<Self>();
        for (p, syms) in &self.files {
            bytes += p.as_os_str().len() + std::mem::size_of::<FileSymbols>();
            for c in &syms.calls {
                bytes += c.name.len() + std::mem::size_of::<CallSiteInfo>();
                for a in &c.named_args {
                    bytes += a.len() + std::mem::size_of::<String>();
                }
            }
            for id in syms.idents.keys() {
                bytes += id.len() + std::mem::size_of::<(String, u32)>();
            }
        }
        for (name, agg) in &self.calls {
            bytes += name.len() + std::mem::size_of::<CallAggregate>();
            for a in agg.arg_counts.keys() {
                bytes += a.len() + std::mem::size_of::<(String, u32)>();
            }
            for o in &agg.arg_order {
                bytes += o.len() + std::mem::size_of::<String>();
            }
        }
        for id in self.idents.keys() {
            bytes += id.len() + std::mem::size_of::<(String, u32)>();
        }
        bytes
    }

    pub fn build(&mut self) -> io::Result<()> {
        let root = self.root.clone();
        if !root.exists() {
            return Ok(());
        }

        let mut walker = ignore::WalkBuilder::new(&root);
        walker.hidden(true).parents(false).git_ignore(true);

        for entry_res in walker.build() {
            let entry = match entry_res {
                Ok(e) => e,
                Err(_) => continue,
            };
            let path = entry.path();
            if path.is_file() && path.extension().is_some_and(|ext| ext == "dart") {
                let _ = self.index_single_file(path);
            }
        }

        self.enforce_cap();
        let _ = self.save_to_disk();
        Ok(())
    }

    pub fn update_file(&mut self, path: &Path) -> io::Result<()> {
        if let Some(old) = self.files.remove(path) {
            for c in old.calls {
                if let Some(agg) = self.calls.get_mut(&c.name) {
                    agg.count = agg.count.saturating_sub(1);
                    for a in c.named_args {
                        if let Some(cnt) = agg.arg_counts.get_mut(&a) {
                            *cnt = cnt.saturating_sub(1);
                        }
                    }
                }
            }
            for (id, count) in old.idents {
                if let Some(cnt) = self.idents.get_mut(&id) {
                    *cnt = cnt.saturating_sub(count);
                }
            }
        }

        if path.exists() {
            let _ = self.index_single_file(path);
        }

        self.calls.retain(|_, v| v.count > 0);
        self.idents.retain(|_, &mut v| v > 0);

        self.enforce_cap();
        let _ = self.save_to_disk();
        Ok(())
    }

    fn index_single_file(&mut self, path: &Path) -> io::Result<()> {
        let content = match fs::read_to_string(path) {
            Ok(c) => c,
            Err(_) => return Ok(()),
        };

        let mtime = fs::metadata(path)
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0);

        let mut symbols = scan_dart_source(&content);
        symbols.mtime = mtime;

        for c in &symbols.calls {
            let agg = self.calls.entry(c.name.clone()).or_default();
            agg.count += 1;
            for a in &c.named_args {
                let cnt = agg.arg_counts.entry(a.clone()).or_default();
                *cnt += 1;
                if !agg.arg_order.contains(a) {
                    agg.arg_order.push(a.clone());
                }
            }
        }

        for (id, count) in &symbols.idents {
            *self.idents.entry(id.clone()).or_default() += count;
        }

        self.files.insert(path.to_path_buf(), symbols);
        Ok(())
    }

    fn enforce_cap(&mut self) {
        let total = self.total_indexed_entries();
        if total <= MAX_INDEX_ENTRIES {
            return;
        }

        let mut all_entries: Vec<(bool, String, u32)> = Vec::with_capacity(total);
        for (name, agg) in &self.calls {
            if agg.count >= 2 {
                all_entries.push((true, name.clone(), agg.count));
            }
        }
        for (id, &cnt) in &self.idents {
            if cnt >= 2 && !self.calls.contains_key(&format!("{}(", id)) {
                all_entries.push((false, id.clone(), cnt));
            }
        }

        all_entries.sort_by_key(|a| std::cmp::Reverse(a.2));
        if all_entries.len() > MAX_INDEX_ENTRIES {
            let keep_set: HashSet<String> = all_entries[..MAX_INDEX_ENTRIES]
                .iter()
                .map(|e| e.1.clone())
                .collect();

            self.calls.retain(|k, _| keep_set.contains(k));
            self.idents.retain(|k, _| keep_set.contains(k));
        }
    }

    pub fn suggest_query(
        &self,
        prefix: &str,
        lang: Option<&str>,
        limit: Option<usize>,
    ) -> Vec<SuggestItem> {
        let lang = lang.unwrap_or("dart");
        if lang != "dart" {
            return Vec::new();
        }

        if !get_editor_ghost_text(self.app_data.as_deref()) {
            return Vec::new();
        }

        if prefix.trim().is_empty() {
            return Vec::new();
        }

        let max_results = limit.unwrap_or(3);
        let mut candidates = Vec::new();

        for (call_name, agg) in &self.calls {
            if agg.count < 2 {
                continue;
            }
            if let Some(suffix) = call_name.strip_prefix(prefix) {
                let args_template = format_args_template(agg);
                candidates.push(SuggestItem {
                    text: suffix.to_string(),
                    freq: agg.count as usize,
                    args_template,
                });
            }
        }

        for (ident, &count) in &self.idents {
            if count < 2 {
                continue;
            }
            let call_key = format!("{}(", ident);
            if self.calls.contains_key(&call_key) {
                continue;
            }
            if let Some(suffix) = ident.strip_prefix(prefix) {
                if !suffix.is_empty() {
                    candidates.push(SuggestItem {
                        text: suffix.to_string(),
                        freq: count as usize,
                        args_template: None,
                    });
                }
            }
        }

        candidates.sort_by(|a, b| {
            b.freq
                .cmp(&a.freq)
                .then_with(|| a.text.len().cmp(&b.text.len()))
        });

        candidates.truncate(max_results);
        candidates
    }

    pub fn save_to_disk(&self) -> io::Result<()> {
        let bin_path = index_file_path(self.app_data.as_deref(), &self.root.to_string_lossy());
        if let Some(parent) = bin_path.parent() {
            fs::create_dir_all(parent)?;
        }

        let mut buf = Vec::with_capacity(64 * 1024);
        buf.extend_from_slice(b"PKIX");
        buf.extend_from_slice(&1u16.to_le_bytes());

        buf.extend_from_slice(&(self.files.len() as u32).to_le_bytes());
        for (path, syms) in &self.files {
            let path_str = path.to_string_lossy();
            let path_bytes = path_str.as_bytes();
            buf.extend_from_slice(&(path_bytes.len() as u16).to_le_bytes());
            buf.extend_from_slice(path_bytes);
            buf.extend_from_slice(&syms.mtime.to_le_bytes());

            buf.extend_from_slice(&(syms.calls.len() as u32).to_le_bytes());
            for c in &syms.calls {
                let c_bytes = c.name.as_bytes();
                buf.extend_from_slice(&(c_bytes.len() as u16).to_le_bytes());
                buf.extend_from_slice(c_bytes);

                buf.extend_from_slice(&(c.named_args.len() as u16).to_le_bytes());
                for a in &c.named_args {
                    let a_bytes = a.as_bytes();
                    buf.extend_from_slice(&(a_bytes.len() as u16).to_le_bytes());
                    buf.extend_from_slice(a_bytes);
                }
            }

            buf.extend_from_slice(&(syms.idents.len() as u32).to_le_bytes());
            for (id, cnt) in &syms.idents {
                let id_bytes = id.as_bytes();
                buf.extend_from_slice(&(id_bytes.len() as u16).to_le_bytes());
                buf.extend_from_slice(id_bytes);
                buf.extend_from_slice(&cnt.to_le_bytes());
            }
        }

        fs::write(&bin_path, buf)?;
        Ok(())
    }

    pub fn load_from_disk<P: AsRef<Path>>(root: P, app_data: Option<&Path>) -> io::Result<Self> {
        let root_ref = root.as_ref();
        let bin_path = index_file_path(app_data, &root_ref.to_string_lossy());
        if !bin_path.exists() {
            return Err(io::Error::new(
                io::ErrorKind::NotFound,
                "index file not found",
            ));
        }

        let data = fs::read(&bin_path)?;
        if data.len() < 6 || &data[0..4] != b"PKIX" {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "invalid index magic",
            ));
        }

        let mut cursor = 6;
        let read_u16 = |cur: &mut usize| -> io::Result<u16> {
            if *cur + 2 > data.len() {
                return Err(io::Error::new(io::ErrorKind::UnexpectedEof, "eof"));
            }
            let val = u16::from_le_bytes([data[*cur], data[*cur + 1]]);
            *cur += 2;
            Ok(val)
        };
        let read_u32 = |cur: &mut usize| -> io::Result<u32> {
            if *cur + 4 > data.len() {
                return Err(io::Error::new(io::ErrorKind::UnexpectedEof, "eof"));
            }
            let val = u32::from_le_bytes([data[*cur], data[*cur + 1], data[*cur + 2], data[*cur + 3]]);
            *cur += 4;
            Ok(val)
        };
        let read_u64 = |cur: &mut usize| -> io::Result<u64> {
            if *cur + 8 > data.len() {
                return Err(io::Error::new(io::ErrorKind::UnexpectedEof, "eof"));
            }
            let val = u64::from_le_bytes([
                data[*cur],
                data[*cur + 1],
                data[*cur + 2],
                data[*cur + 3],
                data[*cur + 4],
                data[*cur + 5],
                data[*cur + 6],
                data[*cur + 7],
            ]);
            *cur += 8;
            Ok(val)
        };
        let read_string = |cur: &mut usize, len: usize| -> io::Result<String> {
            if *cur + len > data.len() {
                return Err(io::Error::new(io::ErrorKind::UnexpectedEof, "eof"));
            }
            let s = String::from_utf8_lossy(&data[*cur..*cur + len]).to_string();
            *cur += len;
            Ok(s)
        };

        let file_count = read_u32(&mut cursor)?;
        let mut files = HashMap::with_capacity(file_count as usize);
        let mut calls: HashMap<String, CallAggregate> = HashMap::new();
        let mut idents: HashMap<String, u32> = HashMap::new();

        for _ in 0..file_count {
            let path_len = read_u16(&mut cursor)? as usize;
            let path_str = read_string(&mut cursor, path_len)?;
            let path = PathBuf::from(path_str);
            let mtime = read_u64(&mut cursor)?;

            let num_calls = read_u32(&mut cursor)?;
            let mut file_calls = Vec::with_capacity(num_calls as usize);
            for _ in 0..num_calls {
                let name_len = read_u16(&mut cursor)? as usize;
                let name = read_string(&mut cursor, name_len)?;

                let num_args = read_u16(&mut cursor)? as usize;
                let mut named_args = Vec::with_capacity(num_args);
                for _ in 0..num_args {
                    let a_len = read_u16(&mut cursor)? as usize;
                    let arg = read_string(&mut cursor, a_len)?;
                    named_args.push(arg);
                }

                let agg = calls.entry(name.clone()).or_default();
                agg.count += 1;
                for a in &named_args {
                    *agg.arg_counts.entry(a.clone()).or_default() += 1;
                    if !agg.arg_order.contains(a) {
                        agg.arg_order.push(a.clone());
                    }
                }

                file_calls.push(CallSiteInfo { name, named_args });
            }

            let num_idents = read_u32(&mut cursor)?;
            let mut file_idents = HashMap::with_capacity(num_idents as usize);
            for _ in 0..num_idents {
                let id_len = read_u16(&mut cursor)? as usize;
                let id = read_string(&mut cursor, id_len)?;
                let count = read_u32(&mut cursor)?;
                *idents.entry(id.clone()).or_default() += count;
                file_idents.insert(id, count);
            }

            files.insert(
                path,
                FileSymbols {
                    calls: file_calls,
                    idents: file_idents,
                    mtime,
                },
            );
        }

        let mut idx = Self {
            root: root_ref.to_path_buf(),
            app_data: app_data.map(|p| p.to_path_buf()),
            files,
            calls,
            idents,
        };
        idx.enforce_cap();
        Ok(idx)
    }
}

fn format_args_template(agg: &CallAggregate) -> Option<String> {
    if agg.arg_order.is_empty() {
        return None;
    }

    let mut eligible: Vec<(&String, u32, usize)> = Vec::new();
    for (idx, arg) in agg.arg_order.iter().enumerate() {
        if let Some(&cnt) = agg.arg_counts.get(arg) {
            if cnt >= 2 {
                eligible.push((arg, cnt, idx));
            }
        }
    }

    if eligible.is_empty() {
        return None;
    }

    eligible.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.2.cmp(&b.2)));

    let mut parts = Vec::with_capacity(eligible.len());
    for (arg, _, _) in eligible {
        parts.push(format!("{}: ,", arg));
    }

    Some(parts.join(" "))
}

pub fn scan_dart_source(src: &str) -> FileSymbols {
    let bytes = src.as_bytes();
    let len = bytes.len();
    let mut pos = 0;

    let mut calls = Vec::new();
    let mut idents: HashMap<String, u32> = HashMap::new();

    struct Frame {
        name: String,
        named_args: Vec<String>,
        paren_depth: usize,
        brace_depth: usize,
        at_arg_start: bool,
    }

    let mut stack: Vec<Frame> = Vec::new();

    let is_ident_start = |b: u8| -> bool {
        b.is_ascii_alphabetic() || b == b'_' || b == b'$'
    };
    let is_ident_continue = |b: u8| -> bool {
        b.is_ascii_alphanumeric() || b == b'_' || b == b'$'
    };

    while pos < len {
        let b = bytes[pos];

        // 1. Whitespace
        if b.is_ascii_whitespace() {
            pos += 1;
            continue;
        }

        // 2. Line comment
        if b == b'/' && pos + 1 < len && bytes[pos + 1] == b'/' {
            pos += 2;
            while pos < len && bytes[pos] != b'\n' {
                pos += 1;
            }
            continue;
        }

        // 3. Block comment
        if b == b'/' && pos + 1 < len && bytes[pos + 1] == b'*' {
            pos += 2;
            while pos + 1 < len && !(bytes[pos] == b'*' && bytes[pos + 1] == b'/') {
                pos += 1;
            }
            pos = (pos + 2).min(len);
            continue;
        }

        // 4. Raw string prefix: r'...' or r"..."
        if (b == b'r' || b == b'R')
            && pos + 1 < len
            && (bytes[pos + 1] == b'\'' || bytes[pos + 1] == b'"')
        {
            pos += 1;
            let q = bytes[pos];
            if pos + 2 < len && bytes[pos + 1] == q && bytes[pos + 2] == q {
                pos += 3;
                while pos + 2 < len && !(bytes[pos] == q && bytes[pos + 1] == q && bytes[pos + 2] == q) {
                    pos += 1;
                }
                pos = (pos + 3).min(len);
            } else {
                pos += 1;
                while pos < len && bytes[pos] != q && bytes[pos] != b'\n' {
                    pos += 1;
                }
                if pos < len && bytes[pos] == q {
                    pos += 1;
                }
            }
            continue;
        }

        // 5. Normal strings: single or triple quote
        if b == b'\'' || b == b'"' {
            let q = b;
            if pos + 2 < len && bytes[pos + 1] == q && bytes[pos + 2] == q {
                pos += 3;
                while pos + 2 < len && !(bytes[pos] == q && bytes[pos + 1] == q && bytes[pos + 2] == q) {
                    if bytes[pos] == b'\\' {
                        pos += 2;
                    } else {
                        pos += 1;
                    }
                }
                pos = (pos + 3).min(len);
            } else {
                pos += 1;
                while pos < len && bytes[pos] != q && bytes[pos] != b'\n' {
                    if bytes[pos] == b'\\' {
                        pos += 2;
                    } else {
                        pos += 1;
                    }
                }
                if pos < len && bytes[pos] == q {
                    pos += 1;
                }
            }
            continue;
        }

        // 6. Parentheses and Braces
        if b == b'(' {
            if let Some(top) = stack.last_mut() {
                top.paren_depth += 1;
            }
            pos += 1;
            continue;
        }

        if b == b')' {
            if let Some(top) = stack.last_mut() {
                if top.paren_depth == 0 {
                    let finished = stack.pop().unwrap();
                    calls.push(CallSiteInfo {
                        name: format!("{}(", finished.name),
                        named_args: finished.named_args,
                    });
                } else {
                    top.paren_depth -= 1;
                }
            }
            pos += 1;
            continue;
        }

        if b == b'{' || b == b'[' {
            if let Some(top) = stack.last_mut() {
                top.brace_depth += 1;
            }
            pos += 1;
            continue;
        }

        if b == b'}' || b == b']' {
            if let Some(top) = stack.last_mut() {
                top.brace_depth = top.brace_depth.saturating_sub(1);
            }
            pos += 1;
            continue;
        }

        if b == b',' {
            if let Some(top) = stack.last_mut() {
                if top.paren_depth == 0 && top.brace_depth == 0 {
                    top.at_arg_start = true;
                }
            }
            pos += 1;
            continue;
        }

        // 7. Identifiers and Calls
        if is_ident_start(b) {
            let start = pos;
            while pos < len && is_ident_continue(bytes[pos]) {
                pos += 1;
            }
            let mut name = String::from_utf8_lossy(&bytes[start..pos]).to_string();

            // Check if dotted (e.g. EdgeInsets.symmetric or Foo.bar)
            let mut lookahead = pos;
            while lookahead < len && bytes[lookahead].is_ascii_whitespace() {
                lookahead += 1;
            }
            if lookahead < len && bytes[lookahead] == b'.' {
                lookahead += 1;
                while lookahead < len && bytes[lookahead].is_ascii_whitespace() {
                    lookahead += 1;
                }
                if lookahead < len && is_ident_start(bytes[lookahead]) {
                    let sub_start = lookahead;
                    while lookahead < len && is_ident_continue(bytes[lookahead]) {
                        lookahead += 1;
                    }
                    let sub_name = String::from_utf8_lossy(&bytes[sub_start..lookahead]);
                    name = format!("{}.{}", name, sub_name);
                    pos = lookahead;
                }
            }

            // Check if this identifier is a named argument at arg_start: `ident:`
            let mut is_named_arg = false;
            if let Some(top) = stack.last_mut() {
                if top.paren_depth == 0 && top.brace_depth == 0 && top.at_arg_start {
                    let mut colon_scan = pos;
                    while colon_scan < len && bytes[colon_scan].is_ascii_whitespace() {
                        colon_scan += 1;
                    }
                    if colon_scan < len
                        && bytes[colon_scan] == b':'
                        && (colon_scan + 1 >= len || bytes[colon_scan + 1] != b':')
                        && name != "case"
                        && name != "default"
                    {
                        top.named_args.push(name.clone());
                        top.at_arg_start = false;
                        pos = colon_scan + 1;
                        is_named_arg = true;
                    }
                }
            }

            if is_named_arg {
                if !is_dart_keyword(&name) {
                    *idents.entry(name).or_default() += 1;
                }
                continue;
            }

            // If not a named arg, check if it's followed by `(` (or `<...>(`)
            let mut after_ident = pos;
            while after_ident < len && bytes[after_ident].is_ascii_whitespace() {
                after_ident += 1;
            }

            // Skip generic `<...>` if any
            if after_ident < len && bytes[after_ident] == b'<' {
                let mut depth = 1;
                let mut scan = after_ident + 1;
                while scan < len && depth > 0 {
                    if bytes[scan] == b'<' {
                        depth += 1;
                    } else if bytes[scan] == b'>' {
                        depth -= 1;
                    } else if bytes[scan] == b'\n' || bytes[scan] == b';' || bytes[scan] == b'{' {
                        break;
                    }
                    scan += 1;
                }
                if depth == 0 {
                    let mut after_gen = scan;
                    while after_gen < len && bytes[after_gen].is_ascii_whitespace() {
                        after_gen += 1;
                    }
                    if after_gen < len && bytes[after_gen] == b'(' {
                        after_ident = after_gen;
                    }
                }
            }

            if after_ident < len && bytes[after_ident] == b'(' && !is_control_flow_keyword(&name) {
                // It is a call!
                pos = after_ident + 1;
                if let Some(top) = stack.last_mut() {
                    top.at_arg_start = false;
                }
                stack.push(Frame {
                    name: name.clone(),
                    named_args: Vec::new(),
                    paren_depth: 0,
                    brace_depth: 0,
                    at_arg_start: true,
                });
            } else {
                if let Some(top) = stack.last_mut() {
                    top.at_arg_start = false;
                }
            }

            if !is_dart_keyword(&name) {
                *idents.entry(name).or_default() += 1;
            }
            continue;
        }

        pos += 1;
    }

    while let Some(finished) = stack.pop() {
        calls.push(CallSiteInfo {
            name: format!("{}(", finished.name),
            named_args: finished.named_args,
        });
    }

    FileSymbols {
        calls,
        idents,
        mtime: 0,
    }
}

fn is_control_flow_keyword(s: &str) -> bool {
    matches!(s, "if" | "while" | "for" | "switch" | "catch")
}

fn is_dart_keyword(s: &str) -> bool {
    matches!(
        s,
        "if" | "else"
            | "while"
            | "do"
            | "for"
            | "in"
            | "switch"
            | "case"
            | "default"
            | "break"
            | "continue"
            | "return"
            | "try"
            | "catch"
            | "finally"
            | "throw"
            | "rethrow"
            | "class"
            | "extends"
            | "with"
            | "implements"
            | "abstract"
            | "interface"
            | "mixin"
            | "extension"
            | "enum"
            | "typedef"
            | "import"
            | "export"
            | "part"
            | "as"
            | "show"
            | "hide"
            | "library"
            | "const"
            | "final"
            | "var"
            | "late"
            | "static"
            | "void"
            | "dynamic"
            | "true"
            | "false"
            | "null"
            | "this"
            | "super"
            | "new"
            | "is"
            | "assert"
            | "async"
            | "await"
            | "yield"
            | "required"
            | "covariant"
            | "external"
            | "factory"
            | "get"
            | "set"
            | "operator"
    )
}

pub fn default_app_data_dir() -> Option<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        std::env::var_os("HOME").map(|h| {
            PathBuf::from(h)
                .join("Library")
                .join("Application Support")
                .join("Petak")
        })
    }
    #[cfg(not(target_os = "macos"))]
    {
        if let Some(xdg) = std::env::var_os("XDG_DATA_HOME") {
            Some(PathBuf::from(xdg).join("Petak"))
        } else if let Some(xdg_conf) = std::env::var_os("XDG_CONFIG_HOME") {
            Some(PathBuf::from(xdg_conf).join("Petak"))
        } else {
            std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".config").join("Petak"))
        }
    }
}

pub fn index_file_path(app_data: Option<&Path>, root: &str) -> PathBuf {
    let canonical = Path::new(root)
        .canonicalize()
        .unwrap_or_else(|_| PathBuf::from(root));
    let mut hasher = sha2::Sha256::new();
    hasher.update(canonical.to_string_lossy().as_bytes());
    let hash = format!("{:x}", hasher.finalize());

    if let Some(dir) = app_data {
        dir.join("index").join(format!("{}.bin", hash))
    } else if let Some(env_dir) = std::env::var_os("PETAK_INDEX_DIR") {
        PathBuf::from(env_dir).join(format!("{}.bin", hash))
    } else if let Some(default_dir) = default_app_data_dir() {
        default_dir.join("index").join(format!("{}.bin", hash))
    } else {
        PathBuf::from("index").join(format!("{}.bin", hash))
    }
}

// ──────────── Settings: editor.ghostText ────────────

fn settings_file_path(app_data: Option<&Path>) -> PathBuf {
    if let Some(dir) = app_data {
        dir.join("settings.json")
    } else if let Some(default_dir) = default_app_data_dir() {
        default_dir.join("settings.json")
    } else {
        PathBuf::from("settings.json")
    }
}

pub fn get_setting(app_data: Option<&Path>, key: &str) -> Option<serde_json::Value> {
    let path = settings_file_path(app_data);
    if !path.exists() {
        return None;
    }
    let data = fs::read_to_string(&path).ok()?;
    let obj: serde_json::Map<String, serde_json::Value> = serde_json::from_str(&data).ok()?;
    obj.get(key).cloned()
}

pub fn set_setting(
    app_data: Option<&Path>,
    key: &str,
    val: serde_json::Value,
) -> io::Result<()> {
    let path = settings_file_path(app_data);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }

    let mut obj: serde_json::Map<String, serde_json::Value> = if path.exists() {
        fs::read_to_string(&path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    } else {
        serde_json::Map::new()
    };

    obj.insert(key.to_string(), val);
    let json = serde_json::to_string_pretty(&obj)
        .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
    fs::write(&path, json)?;
    Ok(())
}

pub fn get_editor_ghost_text(app_data: Option<&Path>) -> bool {
    match get_setting(app_data, "editor.ghostText") {
        Some(serde_json::Value::Bool(b)) => b,
        _ => true,
    }
}

pub fn set_editor_ghost_text(app_data: Option<&Path>, enabled: bool) -> io::Result<()> {
    set_setting(app_data, "editor.ghostText", serde_json::Value::Bool(enabled))
}

// ──────────── Global Manager for Tauri App ────────────

static GLOBAL_SUGGEST_INDEX: OnceLock<Arc<RwLock<Option<SuggestIndex>>>> = OnceLock::new();

pub fn global_suggest_index() -> &'static Arc<RwLock<Option<SuggestIndex>>> {
    GLOBAL_SUGGEST_INDEX.get_or_init(|| Arc::new(RwLock::new(None)))
}
