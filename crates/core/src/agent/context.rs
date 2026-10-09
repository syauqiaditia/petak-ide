use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use std::sync::OnceLock;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SymbolOutline {
    pub name: String,
    pub kind: String, // function, struct, class, enum, method, interface
    pub line: u32,
    pub signature: String,
    pub children: Vec<SymbolOutline>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticSnippet {
    pub line: u32,
    pub message: String,
    pub severity: String, // error, warning, info
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PrunedContextResult {
    pub file_path: String,
    pub total_lines: u32,
    pub pruned_lines: u32,
    pub estimated_tokens_saved: u32,
    pub symbol_outline: Vec<SymbolOutline>,
    pub diagnostics: Vec<DiagnosticSnippet>,
    pub compact_summary: String,
}

static RUST_FN_RE: OnceLock<regex::Regex> = OnceLock::new();
static RUST_STRUCT_RE: OnceLock<regex::Regex> = OnceLock::new();
static RUST_ENUM_RE: OnceLock<regex::Regex> = OnceLock::new();
static RUST_TRAIT_RE: OnceLock<regex::Regex> = OnceLock::new();
static RUST_IMPL_RE: OnceLock<regex::Regex> = OnceLock::new();

static DART_CLASS_RE: OnceLock<regex::Regex> = OnceLock::new();
static DART_ENUM_RE: OnceLock<regex::Regex> = OnceLock::new();
static DART_METHOD_RE: OnceLock<regex::Regex> = OnceLock::new();
static DART_FUNC_RE: OnceLock<regex::Regex> = OnceLock::new();

static TS_CLASS_RE: OnceLock<regex::Regex> = OnceLock::new();
static TS_INTERFACE_RE: OnceLock<regex::Regex> = OnceLock::new();
static TS_TYPE_RE: OnceLock<regex::Regex> = OnceLock::new();
static TS_ENUM_RE: OnceLock<regex::Regex> = OnceLock::new();
static TS_FN_RE: OnceLock<regex::Regex> = OnceLock::new();
static TS_ARROW_RE: OnceLock<regex::Regex> = OnceLock::new();
static TS_METHOD_RE: OnceLock<regex::Regex> = OnceLock::new();

static PY_CLASS_RE: OnceLock<regex::Regex> = OnceLock::new();
static PY_FN_RE: OnceLock<regex::Regex> = OnceLock::new();
static PY_METHOD_RE: OnceLock<regex::Regex> = OnceLock::new();

static GENERIC_RE: OnceLock<regex::Regex> = OnceLock::new();
static DIAG_RE: OnceLock<regex::Regex> = OnceLock::new();

fn clean_signature(line: &str) -> String {
    let s = line.trim();
    let s = s.trim_end_matches('{').trim();
    let s = s.trim_end_matches(';').trim();
    let s = s.trim_end_matches(':').trim();
    s.to_string()
}

fn is_control_flow_keyword(name: &str) -> bool {
    matches!(
        name,
        "if" | "else"
            | "while"
            | "for"
            | "switch"
            | "case"
            | "return"
            | "catch"
            | "try"
            | "finally"
            | "break"
            | "continue"
    )
}

pub fn parse_rust_outline(content: &str) -> Vec<SymbolOutline> {
    let mut symbols: Vec<SymbolOutline> = Vec::new();
    let mut current_impl: Option<String> = None;
    let mut current_impl_children: Vec<SymbolOutline> = Vec::new();

    let fn_re = RUST_FN_RE.get_or_init(|| {
        regex::Regex::new(
            r"^(?:pub(?:\([^)]+\))?\s+)?(?:async\s+)?(?:const\s+)?fn\s+([a-zA-Z0-9_]+)",
        )
        .unwrap()
    });
    let struct_re = RUST_STRUCT_RE.get_or_init(|| {
        regex::Regex::new(r"^(?:pub(?:\([^)]+\))?\s+)?struct\s+([a-zA-Z0-9_]+)").unwrap()
    });
    let enum_re = RUST_ENUM_RE.get_or_init(|| {
        regex::Regex::new(r"^(?:pub(?:\([^)]+\))?\s+)?enum\s+([a-zA-Z0-9_]+)").unwrap()
    });
    let trait_re = RUST_TRAIT_RE.get_or_init(|| {
        regex::Regex::new(r"^(?:pub(?:\([^)]+\))?\s+)?trait\s+([a-zA-Z0-9_]+)").unwrap()
    });
    let impl_re = RUST_IMPL_RE.get_or_init(|| {
        regex::Regex::new(r"^impl(?:<[^>]+>)?\s+(?:(?:[a-zA-Z0-9_:]+)\s+for\s+)?([a-zA-Z0-9_]+)")
            .unwrap()
    });

    let mut brace_depth: usize = 0;
    let mut impl_brace_start: usize = 0;

    for (idx, line) in content.lines().enumerate() {
        let line_num = (idx + 1) as u32;
        let trimmed = line.trim();

        if trimmed.is_empty() || trimmed.starts_with("//") || trimmed.starts_with("/*") {
            continue;
        }

        let has_kw = trimmed.contains("fn ")
            || trimmed.contains("struct ")
            || trimmed.contains("enum ")
            || trimmed.contains("trait ")
            || trimmed.starts_with("impl");

        if !has_kw && current_impl.is_none() {
            for ch in trimmed.chars() {
                if ch == '{' {
                    brace_depth += 1;
                } else if ch == '}' {
                    brace_depth = brace_depth.saturating_sub(1);
                }
            }
            continue;
        }

        if current_impl.is_none() && trimmed.starts_with("impl") {
            if let Some(caps) = impl_re.captures(trimmed) {
                let type_name = caps.get(1).unwrap().as_str().to_string();
                current_impl = Some(type_name);
                impl_brace_start = brace_depth;
            }
        }

        if let Some(caps) = fn_re.captures(trimmed) {
            let name = caps.get(1).unwrap().as_str().to_string();
            let sig = clean_signature(trimmed);
            let kind = if current_impl.is_some() {
                "method"
            } else {
                "function"
            };
            let sym = SymbolOutline {
                name,
                kind: kind.to_string(),
                line: line_num,
                signature: sig,
                children: Vec::new(),
            };
            if current_impl.is_some() {
                current_impl_children.push(sym);
            } else {
                symbols.push(sym);
            }
        } else if current_impl.is_none() {
            if let Some(caps) = struct_re.captures(trimmed) {
                let name = caps.get(1).unwrap().as_str().to_string();
                symbols.push(SymbolOutline {
                    name,
                    kind: "struct".to_string(),
                    line: line_num,
                    signature: clean_signature(trimmed),
                    children: Vec::new(),
                });
            } else if let Some(caps) = enum_re.captures(trimmed) {
                let name = caps.get(1).unwrap().as_str().to_string();
                symbols.push(SymbolOutline {
                    name,
                    kind: "enum".to_string(),
                    line: line_num,
                    signature: clean_signature(trimmed),
                    children: Vec::new(),
                });
            } else if let Some(caps) = trait_re.captures(trimmed) {
                let name = caps.get(1).unwrap().as_str().to_string();
                symbols.push(SymbolOutline {
                    name,
                    kind: "interface".to_string(),
                    line: line_num,
                    signature: clean_signature(trimmed),
                    children: Vec::new(),
                });
            }
        }

        for ch in trimmed.chars() {
            if ch == '{' {
                brace_depth += 1;
            } else if ch == '}' {
                brace_depth = brace_depth.saturating_sub(1);
                if current_impl.is_some() && brace_depth <= impl_brace_start {
                    if let Some(impl_target) = current_impl.take() {
                        if let Some(existing) = symbols.iter_mut().find(|s| s.name == impl_target) {
                            existing.children.append(&mut current_impl_children);
                        } else {
                            symbols.push(SymbolOutline {
                                name: impl_target.clone(),
                                kind: "struct".to_string(),
                                line: line_num,
                                signature: format!("impl {}", impl_target),
                                children: std::mem::take(&mut current_impl_children),
                            });
                        }
                        current_impl_children.clear();
                    }
                }
            }
        }
    }

    if let Some(impl_target) = current_impl {
        if let Some(existing) = symbols.iter_mut().find(|s| s.name == impl_target) {
            existing.children.append(&mut current_impl_children);
        } else {
            symbols.push(SymbolOutline {
                name: impl_target.clone(),
                kind: "struct".to_string(),
                line: 1,
                signature: format!("impl {}", impl_target),
                children: current_impl_children,
            });
        }
    }

    symbols
}

pub fn parse_dart_outline(content: &str) -> Vec<SymbolOutline> {
    let mut symbols: Vec<SymbolOutline> = Vec::new();
    let class_re = DART_CLASS_RE
        .get_or_init(|| regex::Regex::new(r"^(?:abstract\s+)?class\s+([a-zA-Z0-9_]+)").unwrap());
    let enum_re =
        DART_ENUM_RE.get_or_init(|| regex::Regex::new(r"^enum\s+([a-zA-Z0-9_]+)").unwrap());
    let method_re = DART_METHOD_RE.get_or_init(|| {
        regex::Regex::new(r"^(?:(?:static|final|const|late)\s+)?(?:[a-zA-Z0-9_<>,?\s]+\s+)?([a-zA-Z0-9_]+)\s*\([^)]*\)\s*(?:async\s*)?(?:=>|\{)").unwrap()
    });
    let func_re = DART_FUNC_RE.get_or_init(|| {
        regex::Regex::new(r"^(?:(?:static|final|const)\s+)?(?:[a-zA-Z0-9_<>,?\s]+\s+)?([a-zA-Z0-9_]+)\s*\([^)]*\)\s*(?:async\s*)?(?:=>|\{)").unwrap()
    });

    let mut current_class: Option<usize> = None;
    let mut brace_depth: usize = 0;
    let mut class_brace_start: usize = 0;

    for (idx, line) in content.lines().enumerate() {
        let line_num = (idx + 1) as u32;
        let trimmed = line.trim();

        if trimmed.starts_with("//") || trimmed.starts_with("/*") || trimmed.is_empty() {
            continue;
        }

        if current_class.is_none() {
            if let Some(caps) = class_re.captures(trimmed) {
                let name = caps.get(1).unwrap().as_str().to_string();
                let sig = clean_signature(trimmed);
                let idx = symbols.len();
                symbols.push(SymbolOutline {
                    name,
                    kind: "class".to_string(),
                    line: line_num,
                    signature: sig,
                    children: Vec::new(),
                });
                current_class = Some(idx);
                class_brace_start = brace_depth;
            } else if let Some(caps) = enum_re.captures(trimmed) {
                let name = caps.get(1).unwrap().as_str().to_string();
                symbols.push(SymbolOutline {
                    name,
                    kind: "enum".to_string(),
                    line: line_num,
                    signature: clean_signature(trimmed),
                    children: Vec::new(),
                });
            } else if let Some(caps) = func_re.captures(trimmed) {
                let name = caps.get(1).unwrap().as_str();
                if !is_control_flow_keyword(name) {
                    symbols.push(SymbolOutline {
                        name: name.to_string(),
                        kind: "function".to_string(),
                        line: line_num,
                        signature: clean_signature(trimmed),
                        children: Vec::new(),
                    });
                }
            }
        } else if let Some(caps) = method_re.captures(trimmed) {
            let name = caps.get(1).unwrap().as_str();
            if !is_control_flow_keyword(name) {
                if let Some(c_idx) = current_class {
                    symbols[c_idx].children.push(SymbolOutline {
                        name: name.to_string(),
                        kind: "method".to_string(),
                        line: line_num,
                        signature: clean_signature(trimmed),
                        children: Vec::new(),
                    });
                }
            }
        }

        for ch in trimmed.chars() {
            if ch == '{' {
                brace_depth += 1;
            } else if ch == '}' {
                brace_depth = brace_depth.saturating_sub(1);
                if current_class.is_some() && brace_depth <= class_brace_start {
                    current_class = None;
                }
            }
        }
    }
    symbols
}

pub fn parse_ts_outline(content: &str) -> Vec<SymbolOutline> {
    let mut symbols: Vec<SymbolOutline> = Vec::new();
    let class_re = TS_CLASS_RE.get_or_init(|| {
        regex::Regex::new(r"^(?:export\s+)?(?:default\s+)?class\s+([a-zA-Z0-9_]+)").unwrap()
    });
    let interface_re = TS_INTERFACE_RE
        .get_or_init(|| regex::Regex::new(r"^(?:export\s+)?interface\s+([a-zA-Z0-9_]+)").unwrap());
    let type_re = TS_TYPE_RE
        .get_or_init(|| regex::Regex::new(r"^(?:export\s+)?type\s+([a-zA-Z0-9_]+)").unwrap());
    let enum_re = TS_ENUM_RE
        .get_or_init(|| regex::Regex::new(r"^(?:export\s+)?enum\s+([a-zA-Z0-9_]+)").unwrap());
    let fn_re = TS_FN_RE.get_or_init(|| {
        regex::Regex::new(r"^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([a-zA-Z0-9_]+)")
            .unwrap()
    });
    let arrow_re = TS_ARROW_RE.get_or_init(|| {
        regex::Regex::new(r"^(?:export\s+)?const\s+([a-zA-Z0-9_]+)\s*=\s*(?:async\s*)?\([^)]*\)")
            .unwrap()
    });
    let method_re = TS_METHOD_RE.get_or_init(|| {
        regex::Regex::new(
            r"^(?:(?:public|private|protected|static|async)\s+)*([a-zA-Z0-9_]+)\s*\([^)]*\)",
        )
        .unwrap()
    });

    let mut current_class: Option<usize> = None;
    let mut brace_depth: usize = 0;
    let mut class_brace_start: usize = 0;

    for (idx, line) in content.lines().enumerate() {
        let line_num = (idx + 1) as u32;
        let trimmed = line.trim();

        if trimmed.starts_with("//") || trimmed.starts_with("/*") || trimmed.is_empty() {
            continue;
        }

        if current_class.is_none() {
            if let Some(caps) = class_re.captures(trimmed) {
                let name = caps.get(1).unwrap().as_str().to_string();
                let sig = clean_signature(trimmed);
                let idx = symbols.len();
                symbols.push(SymbolOutline {
                    name,
                    kind: "class".to_string(),
                    line: line_num,
                    signature: sig,
                    children: Vec::new(),
                });
                current_class = Some(idx);
                class_brace_start = brace_depth;
            } else if let Some(caps) = interface_re.captures(trimmed) {
                let name = caps.get(1).unwrap().as_str().to_string();
                symbols.push(SymbolOutline {
                    name,
                    kind: "interface".to_string(),
                    line: line_num,
                    signature: clean_signature(trimmed),
                    children: Vec::new(),
                });
            } else if let Some(caps) = type_re.captures(trimmed) {
                let name = caps.get(1).unwrap().as_str().to_string();
                symbols.push(SymbolOutline {
                    name,
                    kind: "struct".to_string(),
                    line: line_num,
                    signature: clean_signature(trimmed),
                    children: Vec::new(),
                });
            } else if let Some(caps) = enum_re.captures(trimmed) {
                let name = caps.get(1).unwrap().as_str().to_string();
                symbols.push(SymbolOutline {
                    name,
                    kind: "enum".to_string(),
                    line: line_num,
                    signature: clean_signature(trimmed),
                    children: Vec::new(),
                });
            } else if let Some(caps) = fn_re.captures(trimmed) {
                let name = caps.get(1).unwrap().as_str().to_string();
                symbols.push(SymbolOutline {
                    name,
                    kind: "function".to_string(),
                    line: line_num,
                    signature: clean_signature(trimmed),
                    children: Vec::new(),
                });
            } else if let Some(caps) = arrow_re.captures(trimmed) {
                let name = caps.get(1).unwrap().as_str().to_string();
                symbols.push(SymbolOutline {
                    name,
                    kind: "function".to_string(),
                    line: line_num,
                    signature: clean_signature(trimmed),
                    children: Vec::new(),
                });
            }
        } else if let Some(caps) = method_re.captures(trimmed) {
            let name = caps.get(1).unwrap().as_str();
            if !is_control_flow_keyword(name) && name != "constructor" {
                if let Some(c_idx) = current_class {
                    symbols[c_idx].children.push(SymbolOutline {
                        name: name.to_string(),
                        kind: "method".to_string(),
                        line: line_num,
                        signature: clean_signature(trimmed),
                        children: Vec::new(),
                    });
                }
            }
        }

        for ch in trimmed.chars() {
            if ch == '{' {
                brace_depth += 1;
            } else if ch == '}' {
                brace_depth = brace_depth.saturating_sub(1);
                if current_class.is_some() && brace_depth <= class_brace_start {
                    current_class = None;
                }
            }
        }
    }
    symbols
}

pub fn parse_python_outline(content: &str) -> Vec<SymbolOutline> {
    let mut symbols: Vec<SymbolOutline> = Vec::new();
    let class_re =
        PY_CLASS_RE.get_or_init(|| regex::Regex::new(r"^class\s+([a-zA-Z0-9_]+)").unwrap());
    let fn_re =
        PY_FN_RE.get_or_init(|| regex::Regex::new(r"^(?:async\s+)?def\s+([a-zA-Z0-9_]+)").unwrap());
    let method_re = PY_METHOD_RE
        .get_or_init(|| regex::Regex::new(r"^\s+(?:async\s+)?def\s+([a-zA-Z0-9_]+)").unwrap());

    let mut current_class: Option<usize> = None;

    for (idx, line) in content.lines().enumerate() {
        let line_num = (idx + 1) as u32;
        let is_indented = line.starts_with(' ') || line.starts_with('\t');
        let trimmed = line.trim();

        if trimmed.starts_with('#') || trimmed.is_empty() {
            continue;
        }

        if !is_indented {
            current_class = None;
            if let Some(caps) = class_re.captures(trimmed) {
                let name = caps.get(1).unwrap().as_str().to_string();
                let idx = symbols.len();
                symbols.push(SymbolOutline {
                    name,
                    kind: "class".to_string(),
                    line: line_num,
                    signature: clean_signature(trimmed),
                    children: Vec::new(),
                });
                current_class = Some(idx);
            } else if let Some(caps) = fn_re.captures(trimmed) {
                let name = caps.get(1).unwrap().as_str().to_string();
                symbols.push(SymbolOutline {
                    name,
                    kind: "function".to_string(),
                    line: line_num,
                    signature: clean_signature(trimmed),
                    children: Vec::new(),
                });
            }
        } else if let Some(c_idx) = current_class {
            if let Some(caps) = method_re.captures(line) {
                let name = caps.get(1).unwrap().as_str().to_string();
                symbols[c_idx].children.push(SymbolOutline {
                    name,
                    kind: "method".to_string(),
                    line: line_num,
                    signature: clean_signature(trimmed),
                    children: Vec::new(),
                });
            }
        }
    }
    symbols
}

pub fn parse_generic_outline(content: &str) -> Vec<SymbolOutline> {
    let mut symbols: Vec<SymbolOutline> = Vec::new();
    let generic_re = GENERIC_RE.get_or_init(|| {
        regex::Regex::new(
            r"^(?:pub\s+|export\s+)?(?:def|fn|function|class|struct|enum|interface)\s+([a-zA-Z0-9_]+)",
        )
        .unwrap()
    });

    for (idx, line) in content.lines().enumerate() {
        let line_num = (idx + 1) as u32;
        let trimmed = line.trim();
        if let Some(caps) = generic_re.captures(trimmed) {
            let name = caps.get(1).unwrap().as_str().to_string();
            let kind = if trimmed.contains("class") {
                "class"
            } else if trimmed.contains("struct") {
                "struct"
            } else if trimmed.contains("enum") {
                "enum"
            } else if trimmed.contains("interface") {
                "interface"
            } else {
                "function"
            };
            symbols.push(SymbolOutline {
                name,
                kind: kind.to_string(),
                line: line_num,
                signature: clean_signature(trimmed),
                children: Vec::new(),
            });
        }
    }
    symbols
}

pub fn extract_diagnostics(content: &str) -> Vec<DiagnosticSnippet> {
    let mut diags = Vec::new();
    let diag_re = DIAG_RE.get_or_init(|| {
        regex::Regex::new(
            r"(?i)(?://|#|/\*)\s*(TODO|FIXME|BUG|NOTE|ERROR|WARN|WARNING|XXX):\s*(.*)",
        )
        .unwrap()
    });

    for (idx, line) in content.lines().enumerate() {
        let trimmed = line.trim();
        if !trimmed.contains("TODO")
            && !trimmed.contains("todo")
            && !trimmed.contains("FIXME")
            && !trimmed.contains("fixme")
            && !trimmed.contains("BUG")
            && !trimmed.contains("bug")
            && !trimmed.contains("NOTE")
            && !trimmed.contains("note")
            && !trimmed.contains("ERROR")
            && !trimmed.contains("error")
            && !trimmed.contains("WARN")
            && !trimmed.contains("warn")
            && !trimmed.contains("XXX")
            && !trimmed.contains("xxx")
        {
            continue;
        }

        let line_num = (idx + 1) as u32;
        if let Some(caps) = diag_re.captures(line) {
            let tag = caps.get(1).unwrap().as_str().to_uppercase();
            let raw_msg = caps.get(2).unwrap().as_str().trim_end_matches("*/").trim();
            let severity = match tag.as_str() {
                "ERROR" => "error",
                "FIXME" | "BUG" | "WARN" | "WARNING" | "XXX" => "warning",
                _ => "info",
            };
            let message = if raw_msg.is_empty() {
                format!("{}: {}", tag, line.trim())
            } else {
                format!("{}: {}", tag, raw_msg)
            };
            diags.push(DiagnosticSnippet {
                line: line_num,
                message,
                severity: severity.to_string(),
            });
        }
    }
    diags
}

fn build_compact_summary(
    file_path: &str,
    total_lines: u32,
    symbols: &[SymbolOutline],
    diagnostics: &[DiagnosticSnippet],
    line_focus: Option<u32>,
    symbol_focus: Option<&str>,
) -> String {
    let mut summary = String::new();
    summary.push_str(&format!(
        "// Outline: {} ({} lines, {} symbols)\n",
        file_path,
        total_lines,
        symbols.len()
    ));

    if let Some(l) = line_focus {
        summary.push_str(&format!("// Focused Line: {}\n", l));
    }
    if let Some(s) = symbol_focus {
        summary.push_str(&format!("// Focused Symbol: {}\n", s));
    }

    summary.push_str("// Symbols:\n");
    for sym in symbols {
        summary.push_str(&format!(
            "- [{}] {} (line {})\n",
            sym.kind, sym.signature, sym.line
        ));
        for child in &sym.children {
            summary.push_str(&format!(
                "  - [{}] {} (line {})\n",
                child.kind, child.signature, child.line
            ));
        }
    }

    if !diagnostics.is_empty() {
        summary.push_str(&format!("// Diagnostics ({}):\n", diagnostics.len()));
        for d in diagnostics {
            summary.push_str(&format!(
                "- [line {}] [{}] {}\n",
                d.line, d.severity, d.message
            ));
        }
    }

    summary
}

pub fn prune_file_context(
    file_path: &Path,
    line: Option<u32>,
    symbol: Option<String>,
) -> Result<PrunedContextResult, String> {
    if !file_path.exists() {
        return Err(format!("File not found: {}", file_path.display()));
    }

    let content = fs::read_to_string(file_path).map_err(|e| e.to_string())?;
    let total_lines = content.lines().count() as u32;

    let ext = file_path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();

    let all_symbols = match ext.as_str() {
        "dart" => parse_dart_outline(&content),
        "rs" => parse_rust_outline(&content),
        "ts" | "tsx" | "js" | "jsx" | "svelte" => parse_ts_outline(&content),
        "py" => parse_python_outline(&content),
        _ => parse_generic_outline(&content),
    };

    let diagnostics = extract_diagnostics(&content);

    let symbols = if let Some(ref sym) = symbol {
        let sym_lower = sym.to_lowercase();
        let exact: Vec<SymbolOutline> = all_symbols
            .iter()
            .filter(|s| {
                s.name.eq_ignore_ascii_case(&sym_lower)
                    || s.children
                        .iter()
                        .any(|c| c.name.eq_ignore_ascii_case(&sym_lower))
            })
            .cloned()
            .collect();
        if !exact.is_empty() {
            exact
        } else {
            let filtered: Vec<SymbolOutline> = all_symbols
                .iter()
                .filter(|s| {
                    s.name.to_lowercase().contains(&sym_lower)
                        || s.children
                            .iter()
                            .any(|c| c.name.to_lowercase().contains(&sym_lower))
                })
                .cloned()
                .collect();
            if filtered.is_empty() {
                all_symbols
            } else {
                filtered
            }
        }
    } else {
        all_symbols
    };

    let file_path_str = file_path.to_string_lossy().to_string();
    let compact_summary = build_compact_summary(
        &file_path_str,
        total_lines,
        &symbols,
        &diagnostics,
        line,
        symbol.as_deref(),
    );

    let summary_lines = compact_summary.lines().count() as u32;
    let pruned_lines = total_lines.saturating_sub(summary_lines);

    // Estimate tokens: standard 3.8-4 chars per token
    let orig_tokens = ((content.len() as f64 / 3.8).round() as u32).max(total_lines * 6);
    let summary_tokens = (compact_summary.len() as f64 / 3.8).round() as u32;
    let estimated_tokens_saved = orig_tokens.saturating_sub(summary_tokens);

    Ok(PrunedContextResult {
        file_path: file_path_str,
        total_lines,
        pruned_lines,
        estimated_tokens_saved,
        symbol_outline: symbols,
        diagnostics,
        compact_summary,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::time::Instant;

    #[test]
    fn test_outline_extraction_rust() {
        let rust_code = r#"
// TODO: add concurrency support
pub struct EngineConfig {
    pub timeout: u64,
}

impl EngineConfig {
    pub fn new() -> Self {
        Self { timeout: 30 }
    }

    pub async fn run(&self) -> bool {
        true
    }
}

pub enum State {
    Idle,
    Running,
}

pub fn initialize_system() -> Result<(), String> {
    // FIXME: check permissions
    Ok(())
}
"#;
        let mut tmp = tempfile::Builder::new().suffix(".rs").tempfile().unwrap();
        tmp.write_all(rust_code.as_bytes()).unwrap();

        let res = prune_file_context(tmp.path(), None, None).unwrap();
        assert_eq!(res.symbol_outline.len(), 3);
        assert_eq!(res.symbol_outline[0].name, "EngineConfig");
        assert_eq!(res.symbol_outline[0].kind, "struct");
        assert_eq!(res.symbol_outline[0].children.len(), 2);
        assert_eq!(res.symbol_outline[0].children[0].name, "new");
        assert_eq!(res.symbol_outline[0].children[0].kind, "method");

        assert_eq!(res.symbol_outline[1].name, "State");
        assert_eq!(res.symbol_outline[1].kind, "enum");

        assert_eq!(res.symbol_outline[2].name, "initialize_system");
        assert_eq!(res.symbol_outline[2].kind, "function");

        assert_eq!(res.diagnostics.len(), 2);
        assert_eq!(res.diagnostics[0].severity, "info");
        assert_eq!(res.diagnostics[1].severity, "warning");
    }

    #[test]
    fn test_outline_extraction_dart() {
        let dart_code = r#"
// TODO: refactor state management
enum AuthStatus {
  authenticated,
  unauthenticated,
}

class UserProfileScreen extends StatelessWidget {
  const UserProfileScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Container();
  }

  void logout() {
    // FIXME: clear secure storage
  }
}

void globalHelper() {
  print("help");
}
"#;
        let mut tmp = tempfile::Builder::new().suffix(".dart").tempfile().unwrap();
        tmp.write_all(dart_code.as_bytes()).unwrap();

        let res = prune_file_context(tmp.path(), None, None).unwrap();
        assert_eq!(res.symbol_outline.len(), 3);
        assert_eq!(res.symbol_outline[0].name, "AuthStatus");
        assert_eq!(res.symbol_outline[0].kind, "enum");

        assert_eq!(res.symbol_outline[1].name, "UserProfileScreen");
        assert_eq!(res.symbol_outline[1].kind, "class");
        assert_eq!(res.symbol_outline[1].children.len(), 2);
        assert_eq!(res.symbol_outline[1].children[0].name, "build");
        assert_eq!(res.symbol_outline[1].children[0].kind, "method");
        assert_eq!(res.symbol_outline[1].children[1].name, "logout");

        assert_eq!(res.symbol_outline[2].name, "globalHelper");
        assert_eq!(res.symbol_outline[2].kind, "function");

        assert_eq!(res.diagnostics.len(), 2);
    }

    #[test]
    fn test_outline_extraction_typescript() {
        let ts_code = r#"
export interface UserPayload {
  id: string;
  name: string;
}

export type UserRole = "admin" | "editor" | "viewer";

export class UserService {
  constructor() {}

  async getUser(id: string): Promise<UserPayload> {
    return { id, name: "Test" };
  }
}

export const fetchUsers = async () => {
  return [];
};
"#;
        let mut tmp = tempfile::Builder::new().suffix(".ts").tempfile().unwrap();
        tmp.write_all(ts_code.as_bytes()).unwrap();

        let res = prune_file_context(tmp.path(), None, None).unwrap();
        assert_eq!(res.symbol_outline.len(), 4);
        assert_eq!(res.symbol_outline[0].name, "UserPayload");
        assert_eq!(res.symbol_outline[0].kind, "interface");

        assert_eq!(res.symbol_outline[1].name, "UserRole");
        assert_eq!(res.symbol_outline[1].kind, "struct");

        assert_eq!(res.symbol_outline[2].name, "UserService");
        assert_eq!(res.symbol_outline[2].kind, "class");
        assert_eq!(res.symbol_outline[2].children.len(), 1);
        assert_eq!(res.symbol_outline[2].children[0].name, "getUser");

        assert_eq!(res.symbol_outline[3].name, "fetchUsers");
        assert_eq!(res.symbol_outline[3].kind, "function");
    }

    #[test]
    fn test_token_savings_calculation() {
        let mut long_file = String::new();
        long_file.push_str("// Large service file\n");
        long_file.push_str("pub struct DataPipeline {\n    pub buffer: Vec<u8>,\n}\n\n");
        long_file.push_str("impl DataPipeline {\n");
        for i in 0..60 {
            long_file.push_str(&format!("    pub fn step_{}(&mut self) {{\n", i));
            long_file.push_str("        let val = 42 * 100;\n");
            long_file.push_str("        self.buffer.push(val as u8);\n");
            long_file.push_str("        println!(\"processing intermediate buffer step\");\n");
            long_file.push_str("    }\n\n");
        }
        long_file.push_str("}\n");

        let mut tmp = tempfile::Builder::new().suffix(".rs").tempfile().unwrap();
        tmp.write_all(long_file.as_bytes()).unwrap();

        let res = prune_file_context(tmp.path(), None, None).unwrap();
        assert!(res.total_lines > 250);
        assert!(res.pruned_lines > 0);

        let orig_est_tokens =
            ((long_file.len() as f64 / 3.8).round() as u32).max(res.total_lines * 6);
        let reduction_pct = (res.estimated_tokens_saved as f64) / (orig_est_tokens as f64) * 100.0;

        // Assert token reduction target 60-80% (or above for repetitive code)
        assert!(
            reduction_pct >= 60.0,
            "Expected >= 60% reduction, got {:.2}%",
            reduction_pct
        );
        assert!(res.estimated_tokens_saved > 0);
    }

    #[test]
    fn test_latency_constraint() {
        let mut large_file = String::new();
        for i in 0..500 {
            large_file.push_str(&format!(
                "pub fn compute_entry_{}(x: i32) -> i32 {{\n    x * 2 + 1\n}}\n",
                i
            ));
        }

        let mut tmp = tempfile::Builder::new().suffix(".rs").tempfile().unwrap();
        tmp.write_all(large_file.as_bytes()).unwrap();

        // Warm up OnceLock
        let _ = prune_file_context(tmp.path(), None, None);

        let start = Instant::now();
        let res =
            prune_file_context(tmp.path(), Some(42), Some("compute_entry_10".to_string())).unwrap();
        let elapsed = start.elapsed();

        assert_eq!(res.symbol_outline.len(), 1);
        assert_eq!(res.symbol_outline[0].name, "compute_entry_10");
        assert!(
            elapsed.as_millis() < 50,
            "Latency exceeded 50ms: {} ms",
            elapsed.as_millis()
        );
    }
}
