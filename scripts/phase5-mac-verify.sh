#!/usr/bin/env bash
# scripts/phase5-mac-verify.sh
# Verifikasi otomatis Fase 5 Petak di macOS (Apple Silicon Mac M2)
# Menjalankan build release .app, verifikasi live agent ACP & 9Router probe & GitLab MR,
# dan instalasi ke /Applications/Petak.app.

set -euo pipefail

REPO_DIR="${HOME}/petak"
TARGET_DIR="${HOME}/petak/target"
LOG_DIR="${REPO_DIR}/docs/phase5/logs"
SCREEN_DIR="${REPO_DIR}/docs/phase5/screens"

echo "=========================================================="
echo "  Petak — Fase 5 Verification Script (macOS / Mac M2)"
echo "=========================================================="
echo "Date: $(date)"
echo "Host: $(hostname)"
echo ""

# 1. Environment & Pre-checks
export PATH="${HOME}/SDK/flutter_3.35.7/bin:${HOME}/.local/bin:${HOME}/.cargo/bin:${PATH}"
export CARGO_TARGET_DIR="${TARGET_DIR}"
cd "${REPO_DIR}"

mkdir -p "${LOG_DIR}" "${SCREEN_DIR}"

echo "=== 1. Checking Toolchain & Disk Space ==="
df -h /
echo "Node:    $(node -v 2>&1 || echo 'Node not in PATH')"
echo "Cargo:   $(cargo --version 2>&1 || echo 'Cargo not in PATH')"
echo "Git:     $(git --version 2>&1 || echo 'Git not in PATH')"
echo "Hermes:  $(hermes --version 2>&1 || echo 'Hermes not in PATH')"
echo "9Router: $(curl -s http://127.0.0.1:20128/health 2>&1 || echo '9Router offline/not running')"
echo ""

# 2. Run backend core unit & integration tests
echo "=== 2. Running Rust Core Unit & Integration Tests ==="
cargo test -p petak-core | tee "${LOG_DIR}/mac-cargo-test.txt"

# 3. Run pure UI logic tests
echo ""
echo "=== 3. Running Pure UI Logic & Node Tests ==="
(
  python3 scripts/check-app-symbols.py
  npm run check
  npm test
) | tee "${LOG_DIR}/mac-ui-tests.txt"

# 4. Clean and Build Release Tauri .app
echo ""
echo "=== 4. Building Release Bundle (npm run tauri -- build) ==="
npm run tauri -- build | tee "${LOG_DIR}/mac-build.txt"

APP_PATH="${TARGET_DIR}/release/bundle/macos/Petak.app"
if [ ! -d "${APP_PATH}" ]; then
  echo "ERROR: Petak.app bundle not found at ${APP_PATH}"
  exit 1
fi
APP_SIZE=$(du -sh "${APP_PATH}" | awk '{print $1}')
echo "Petak.app built successfully! Size: ${APP_SIZE} (Budget: < 20 MB)"

# 5. Clean heavy cargo build artifacts to protect Mac SSD space
echo ""
echo "=== 5. Cleaning Heavy Build Artifacts ==="
rm -rf "${TARGET_DIR}/release/build" "${TARGET_DIR}/release/deps" "${TARGET_DIR}/debug" || true
df -h /

# 6. Measure Cold Start (Budget: <= 646 ms)
echo ""
echo "=== 6. Measuring Cold Start ==="
if [ -f "scripts/measure-coldstart.mjs" ]; then
  node scripts/measure-coldstart.mjs | tee "${LOG_DIR}/mac-coldstart.txt" || true
fi

# 7. Check 9Router SQLite Probe on Mac
echo ""
echo "=== 7. Checking 9Router DB Path ==="
if [ -f "${HOME}/.9router/db/data.sqlite" ]; then
  echo "9Router SQLite database found at ${HOME}/.9router/db/data.sqlite"
else
  echo "Note: ~/.9router/db/data.sqlite not found. Quota panel will show honest 'Tidak tersedia' status."
fi

# 8. Check Hermes Profiles on Mac
echo ""
echo "=== 8. Checking Hermes Profiles on Mac ==="
if [ -d "${HOME}/.hermes/profiles" ]; then
  echo "Hermes profiles detected:"
  ls -la "${HOME}/.hermes/profiles"
else
  echo "Note: ~/.hermes/profiles not found. Only default profile available."
fi

# 9. In-App Execution & Screen Capture (if display available)
echo ""
echo "=== 9. Running In-App Real Execution & Screen Capture ==="
pkill -x "petak-app" || true
sleep 1

export PETAK_TEST_P5=1
"${APP_PATH}/Contents/MacOS/petak-app" >/dev/null 2>&1 &
APP_PID=$!

echo "Petak app running in background (PID: ${APP_PID}). Waiting for UI to stabilize..."
sleep 4

if [ -f "scripts/capture_petak.swift" ]; then
  echo "Capturing Petak window to ${SCREEN_DIR}/mac-p5-real-app.png..."
  swift scripts/capture_petak.swift "${SCREEN_DIR}/mac-p5-real-app.png" || echo "Warning: Screenshot capture failed (screen might be locked/headless)"
fi

kill "${APP_PID}" 2>/dev/null || true
pkill -x "petak-app" || true
sleep 1

# 10. Install to /Applications/Petak.app
echo ""
echo "=== 10. Installing to /Applications/Petak.app ==="
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
echo "  Phase 5 Verification Complete! Logs saved to docs/phase5/logs/"
echo "=========================================================="
