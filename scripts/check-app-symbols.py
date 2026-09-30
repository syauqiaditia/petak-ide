#!/usr/bin/env python3
"""
scripts/check-app-symbols.py

Scans crates/app/src/ to ensure all `petak_core::...` symbol paths, imports,
and enum variants (e.g., RunEvent::X, DevicePlatform::X, etc.) actually exist
in crates/core.

Prevents build breaks on macOS caused by crates/app not being cargo-checkable on Linux.
"""

import os
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
CORE_SRC = REPO_ROOT / "crates" / "core" / "src"
APP_SRC = REPO_ROOT / "crates" / "app" / "src"

def extract_balanced_block(text, start_idx):
    """Given text and index of opening '{', returns text inside balanced '{' and '}'."""
    depth = 0
    in_string = False
    escape = False
    start = -1
    for i in range(start_idx, len(text)):
        ch = text[i]
        if escape:
            escape = False
            continue
        if ch == '\\':
            escape = True
            continue
        if ch == '"':
            in_string = not in_string
            continue
        if in_string:
            continue
        if ch == '{':
            if depth == 0:
                start = i + 1
            depth += 1
        elif ch == '}':
            depth -= 1
            if depth == 0:
                return text[start:i], i
    return "", len(text)

def collect_core_definitions():
    """
    Parses crates/core/src/ to collect:
    1. All defined public/exported symbols (modules, structs, enums, functions, types, traits).
    2. All enum variants for every enum in crates/core.
    3. Associated functions/methods on enums/structs.
    4. Re-exports (`pub use ...`).
    """
    defined_symbols = set()
    enum_variants = {} # enum_name -> set(variant_names)
    enum_methods = {}  # type_name -> set(method_names)

    # Built-in re-exports in lib.rs & external crates
    defined_symbols.update([
        "notify", "sha2", "Digest", "Sha256", "RecommendedWatcher", "FileIndex"
    ])

    for root, _, files in os.walk(CORE_SRC):
        for f in files:
            if not f.endswith(".rs"):
                continue
            path = Path(root) / f
            text = path.read_text(encoding="utf-8", errors="replace")

            # 1. Modules: pub mod x; or mod x;
            for m in re.finditer(r'\b(?:pub\s+)?mod\s+([a-zA-Z0-9_]+)\s*;', text):
                defined_symbols.add(m.group(1))

            # 2. Structs, functions, type aliases, traits, consts
            for m in re.finditer(r'\bpub(?:\([^)]+\))?\s+(?:struct|fn|type|trait|const|static)\s+([a-zA-Z0-9_]+)', text):
                defined_symbols.add(m.group(1))

            # 3. Enums: pub enum EnumName { ... } with balanced braces
            enum_hdr_re = re.compile(r'\bpub(?:\([^)]+\))?\s+enum\s+([a-zA-Z0-9_]+)\s*\{')
            for m in enum_hdr_re.finditer(text):
                enum_name = m.group(1)
                defined_symbols.add(enum_name)
                body, _ = extract_balanced_block(text, m.end() - 1)
                
                variants = set()
                # Clean comments
                clean_body = re.sub(r'//.*', '', body)
                clean_body = re.sub(r'/\*.*?\*/', '', clean_body, flags=re.DOTALL)
                
                # Split top-level commas in enum body
                depth = 0
                current = []
                for ch in clean_body:
                    if ch in '{[(':
                        depth += 1
                    elif ch in '}])':
                        depth -= 1
                    elif ch == ',' and depth == 0:
                        chunk = "".join(current).strip()
                        current = []
                        # Remove attributes
                        chunk = re.sub(r'#\[[^\]]*\]', '', chunk).strip()
                        var_m = re.match(r'^([a-zA-Z0-9_]+)', chunk)
                        if var_m:
                            variants.add(var_m.group(1))
                        continue
                    current.append(ch)
                if current:
                    chunk = "".join(current).strip()
                    chunk = re.sub(r'#\[[^\]]*\]', '', chunk).strip()
                    var_m = re.match(r'^([a-zA-Z0-9_]+)', chunk)
                    if var_m:
                        variants.add(var_m.group(1))

                if enum_name in enum_variants:
                    enum_variants[enum_name].update(variants)
                else:
                    enum_variants[enum_name] = variants

            # 4. Methods on impl Type { pub fn method ... }
            impl_re = re.compile(r'\bimpl(?:\s*<[^>]+>)?\s+([a-zA-Z0-9_]+)(?:\s*<[^>]+>)?\s*\{')
            for m in impl_re.finditer(text):
                type_name = m.group(1)
                body, _ = extract_balanced_block(text, m.end() - 1)
                methods = set()
                for fn_m in re.finditer(r'\bpub(?:\([^)]+\))?\s+fn\s+([a-zA-Z0-9_]+)', body):
                    methods.add(fn_m.group(1))
                if type_name in enum_methods:
                    enum_methods[type_name].update(methods)
                else:
                    enum_methods[type_name] = methods

            # 5. Pub use re-exports: pub use path::{A, B}; or pub use path::A;
            for m in re.finditer(r'\bpub\s+use\s+([^;]+);', text):
                use_clause = m.group(1).strip()
                if "{" in use_clause:
                    m_braces = re.search(r'\{([^}]+)\}', use_clause)
                    if m_braces:
                        for item in m_braces.group(1).split(','):
                            item = item.strip()
                            if " as " in item:
                                item = item.split(" as ")[1].strip()
                            if item:
                                defined_symbols.add(item)
                else:
                    last_part = use_clause.split("::")[-1].strip()
                    if last_part and last_part != "*":
                        defined_symbols.add(last_part)

    # Add standard submodules from lib.rs
    lib_rs = CORE_SRC / "lib.rs"
    if lib_rs.is_file():
        lib_text = lib_rs.read_text(encoding="utf-8", errors="replace")
        for m in re.finditer(r'\bpub\s+mod\s+([a-zA-Z0-9_]+)\s*;', lib_text):
            defined_symbols.add(m.group(1))

    return defined_symbols, enum_variants, enum_methods

def scan_app_src(defined_symbols, enum_variants, enum_methods):
    errors = []

    # Regex patterns
    # 1. petak_core::a::b::Symbol
    petak_core_path_re = re.compile(r'\bpetak_core(?:::([a-zA-Z0-9_]+))+')
    # 2. use petak_core::...
    use_petak_core_re = re.compile(r'\buse\s+petak_core::([^;]+);')
    # 3. Enum::Variant (for known enums)
    known_enums = [e for e in enum_variants.keys() if len(enum_variants[e]) > 0]
    known_enums_pattern = re.compile(r'\b(' + '|'.join(map(re.escape, known_enums)) + r')::([a-zA-Z0-9_]+)') if known_enums else None

    std_types = {"Result", "Option", "Path", "PathBuf", "String", "Vec", "Arc", "Mutex", "Sender", "Receiver"}

    for root, _, files in os.walk(APP_SRC):
        for f in files:
            if not f.endswith(".rs"):
                continue
            path = Path(root) / f
            rel_path = path.relative_to(REPO_ROOT)
            lines = path.read_text(encoding="utf-8", errors="replace").splitlines()

            for line_no, line in enumerate(lines, start=1):
                clean_line = re.sub(r'//.*', '', line)

                # Check use petak_core::...
                for m in use_petak_core_re.finditer(clean_line):
                    target = m.group(1).strip()
                    if "{" in target:
                        m_brace = re.search(r'\{([^}]+)\}', target)
                        if m_brace:
                            for item in m_brace.group(1).split(','):
                                item = item.strip()
                                if not item:
                                    continue
                                sym = item.split(" as ")[0].strip()
                                if sym and sym not in defined_symbols:
                                    errors.append((str(rel_path), line_no, f"Imported symbol '{sym}' not found in petak_core"))
                    else:
                        parts = [p.strip() for p in target.split("::")]
                        last = parts[-1]
                        if last and last != "*" and last not in defined_symbols:
                            errors.append((str(rel_path), line_no, f"Imported symbol '{last}' not found in petak_core"))

                # Check petak_core::... inline paths
                for m in petak_core_path_re.finditer(clean_line):
                    full = m.group(0)
                    parts = full.split("::")[1:] # skip 'petak_core'
                    final_symbol = parts[-1]
                    if len(parts) >= 2 and parts[-2] in enum_variants:
                        enum_name = parts[-2]
                        # Could be a variant OR an associated method
                        valid_variants = enum_variants.get(enum_name, set())
                        valid_methods = enum_methods.get(enum_name, set())
                        if final_symbol not in valid_variants and final_symbol not in valid_methods:
                            errors.append((str(rel_path), line_no, f"Variant/method '{final_symbol}' does not exist on enum '{enum_name}' in petak_core"))
                    elif final_symbol not in defined_symbols and final_symbol not in std_types:
                        is_variant = any(final_symbol in v for v in enum_variants.values())
                        is_method = any(final_symbol in m for m in enum_methods.values())
                        if not is_variant and not is_method:
                            errors.append((str(rel_path), line_no, f"Symbol '{final_symbol}' in '{full}' not found in petak_core"))

                # Check KnownEnum::Variant
                if known_enums_pattern:
                    for m in known_enums_pattern.finditer(clean_line):
                        enum_name = m.group(1)
                        member_name = m.group(2)
                        valid_variants = enum_variants.get(enum_name, set())
                        valid_methods = enum_methods.get(enum_name, set())
                        if member_name not in valid_variants and member_name not in valid_methods:
                            errors.append((str(rel_path), line_no, f"Variant '{member_name}' does not exist on enum '{enum_name}' in petak_core"))

    return errors

def main():
    if not CORE_SRC.is_dir() or not APP_SRC.is_dir():
        print(f"Error: crates/core/src or crates/app/src not found under {REPO_ROOT}", file=sys.stderr)
        sys.exit(1)

    defined_symbols, enum_variants, enum_methods = collect_core_definitions()
    errors = scan_app_src(defined_symbols, enum_variants, enum_methods)

    if errors:
        print(f"FAILED: Found {len(errors)} unresolved petak_core symbol/variant references in crates/app/src/:", file=sys.stderr)
        for rel_path, line_no, msg in errors:
            print(f"  {rel_path}:{line_no}: {msg}", file=sys.stderr)
        sys.exit(1)
    else:
        print(f"SUCCESS: crates/app/src symbols verified ({len(defined_symbols)} symbols, {len(enum_variants)} enums).")
        sys.exit(0)

if __name__ == "__main__":
    main()
