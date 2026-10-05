# Contributing to Petak IDE

Thank you for your interest in contributing to **Petak IDE**! Petak is built with Rust (backend core & Tauri 2) and Svelte 5 (reactive frontend).

---

## 🛠️ Development Setup

### 1. Prerequisites
- **Node.js**: v20 or newer (`node -v`)
- **Rust**: Stable Rust toolchain (`rustc --version`, `cargo --version`)
- **Python 3**: For symbol checking and test verification

### 2. Quickstart
```bash
# Clone the repository
git clone https://github.com/syauqiaditia/petak-ide.git
cd petak

# Run the interactive onboarding wizard
./setup.sh

# Or start live development directly (hot-reload)
./build.sh --dev
```

---

## 🧪 Testing & Quality Gates

Every pull request must pass the automated test suites:

```bash
# 1. Typecheck and symbol integrity
python3 scripts/check-app-symbols.py
npm run check

# 2. Run frontend UI and logic tests (279+ tests)
npm test

# 3. Run backend Rust core unit & integration tests (296+ tests)
cargo test -p petak-core --lib
```

---

## 📐 Architecture Overview

- `crates/core/`: Pure Rust business logic without Tauri dependency (Git engine, LSP client, scrcpy streamer, device management, AI multi-agent orchestration).
- `crates/app/`: Tauri 2 desktop application layer, IPC command bindings, macOS system menu bar, native window management.
- `ui/`: Svelte 5 reactive frontend (Runes `$state`, `$derived`, `$effect`), CodeMirror 6 editor, split Git VCS panels, GitLab MR inspector, embedded device mirror canvas.

---

## 📜 Pull Request Process

1. Fork the repo and create your branch from `main`.
2. Keep changes focused and minimal.
3. Ensure no hardcoded paths or environment secrets are introduced.
4. Verify all tests pass (`./build.sh --test`).
5. Open a Pull Request with a clear description of the problem solved.
