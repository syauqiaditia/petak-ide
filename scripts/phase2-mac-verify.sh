#!/usr/bin/env bash
# scripts/phase2-mac-verify.sh
# Verifikasi otomatis Fase 2 Petak di macOS (Apple Silicon Mac M2)
# Menjalankan build release, coldstart benchmark, live LSP benchmark (Dart & Swift),
# screen capture asli macOS, dan instalasi ke /Applications/Petak.app.

set -euo pipefail

REPO_DIR="${HOME}/petak"
TARGET_DIR="${HOME}/petak/target"
LOG_DIR="${REPO_DIR}/docs/phase2/logs"
SCREEN_DIR="${REPO_DIR}/docs/phase2/screens"

echo "=========================================================="
echo "  Petak — Fase 2 Verification Script (macOS / Mac M2)"
echo "=========================================================="
echo "Date: $(date)"
echo "Host: $(hostname)"
echo ""

# 1. Environment & Pre-checks
export PATH="${HOME}/.local/bin:${HOME}/.cargo/bin:${PATH}"
export CARGO_TARGET_DIR="${TARGET_DIR}"
cd "${REPO_DIR}"

mkdir -p "${LOG_DIR}" "${SCREEN_DIR}"

echo "=== 1. Checking Toolchain & Disk Space ==="
df -h /
echo "Node: $(node -v)"
echo "Cargo: $(cargo --version)"
echo "Flutter: $(flutter --version 2>&1 | head -n 1 || echo 'Flutter not in PATH')"
echo "Dart: $(dart --version 2>&1 || echo 'Dart not in PATH')"
echo "Swift: $(swift --version 2>&1 | head -n 1 || echo 'Swift not in PATH')"
echo "SourceKit-LSP: $(xcrun --find sourcekit-lsp 2>&1 || echo 'sourcekit-lsp not found')"
echo ""

# 2. Run backend core unit & integration tests
echo "=== 2. Running Rust Core Unit & Integration Tests ==="
cargo test -p petak-core | tee "${LOG_DIR}/mac-cargo-test.txt"

# 3. Clean and Build Release Tauri .app
echo ""
echo "=== 3. Building Release Bundle (npm run tauri -- build) ==="
npm run tauri -- build | tee "${LOG_DIR}/mac-build.txt"

APP_PATH="${TARGET_DIR}/release/bundle/macos/Petak.app"
if [ ! -d "${APP_PATH}" ]; then
  echo "ERROR: Petak.app bundle not found at ${APP_PATH}"
  exit 1
fi
APP_SIZE=$(du -sh "${APP_PATH}" | awk '{print $1}')
echo "Petak.app built successfully! Size: ${APP_SIZE} (Budget: < 20 MB)"

# 4. Clean heavy cargo build artifacts to protect Mac SSD space
echo ""
echo "=== 4. Cleaning Heavy Build Artifacts ==="
rm -rf "${TARGET_DIR}/release/build" "${TARGET_DIR}/release/deps" "${TARGET_DIR}/debug" || true
df -h /

# 5. Measure Cold Start
echo ""
echo "=== 5. Measuring Cold Start (measure-coldstart.mjs) ==="
node scripts/measure-coldstart.mjs | tee "${LOG_DIR}/mac-coldstart.txt"

# 6. Measure Live LSP Benchmarks
echo ""
echo "=== 6. Measuring Live LSP Diagnostics, Completion & RAM ==="
node scripts/bench_dart_diagnostics.mjs | tee "${LOG_DIR}/mac-dart-first-diagnostics.txt"
node scripts/bench_dart_completion.mjs | tee "${LOG_DIR}/mac-completion-latency.txt"
node scripts/bench_typing_lsp.mjs | tee "${LOG_DIR}/mac-typing-10k.txt"
node scripts/measure_lsp_ram.mjs | tee "${LOG_DIR}/mac-lsp-ram.txt"
node scripts/bench_idle_kill.mjs | tee "${LOG_DIR}/mac-idle-kill.txt"

# Measure Swift sourcekit-lsp RAM if available
if command -v xcrun &>/dev/null && xcrun --find sourcekit-lsp &>/dev/null; then
  echo "Measuring Swift sourcekit-lsp..."
  SK_BIN=$(xcrun --find sourcekit-lsp)
  "${SK_BIN}" &
  SK_PID=$!
  sleep 2
  SK_RSS=$(ps -o rss= -p "${SK_PID}" || echo "0")
  kill "${SK_PID}" 2>/dev/null || true
  echo "Swift sourcekit-lsp RSS: $(( SK_RSS / 1024 )) MB (${SK_RSS} KB)" | tee -a "${LOG_DIR}/mac-lsp-ram.txt"
fi

# 7. Capture native macOS app screenshots if unlocked
echo ""
echo "=== 7. Capturing Native Screenshots ==="
if [ -f "scripts/capture_petak.swift" ]; then
  echo "Running capture_petak.swift on active window..."
  swift scripts/capture_petak.swift || echo "Warning: Screen capture failed (Mac screen might be locked)"
fi

# 8. Install to /Applications/Petak.app
echo ""
echo "=== 8. Installing to /Applications/Petak.app ==="
if pgrep -x "petak-app" >/dev/null; then
  echo "WARNING: petak-app is currently running. Skipping ditto to avoid file corruption."
  echo "Please quit Petak manually, then run: ditto \"${APP_PATH}\" /Applications/Petak.app"
else
  echo "Copying ${APP_PATH} -> /Applications/Petak.app..."
  ditto "${APP_PATH}" "/Applications/Petak.app"
  echo "Petak.app installed to /Applications successfully!"
fi

echo ""
echo "=========================================================="
echo "  Verification Complete! All logs saved to docs/phase2/logs/"
echo "=========================================================="
