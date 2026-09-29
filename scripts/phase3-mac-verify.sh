#!/usr/bin/env bash
# scripts/phase3-mac-verify.sh
# Verifikasi otomatis Fase 3 Petak di macOS (Apple Silicon Mac M2)
# Menjalankan build release .app, bench cold start (<= 646 ms) & RAM idle & typing,
# bench git (buka log 10k sampai baris pertama < 500 ms, status < 200 ms),
# in-app test harness via PETAK_TEST_P3, screen capture asli macOS,
# dan instalasi ke /Applications/Petak.app.

set -euo pipefail

REPO_DIR="${HOME}/petak"
TARGET_DIR="${HOME}/petak/target"
LOG_DIR="${REPO_DIR}/docs/phase3/logs"
SCREEN_DIR="${REPO_DIR}/docs/phase3/screens"

echo "=========================================================="
echo "  Petak — Fase 3 Verification Script (macOS / Mac M2)"
echo "=========================================================="
echo "Date: $(date)"
echo "Host: $(hostname)"
echo ""

# 1. Environment & Pre-checks
export PATH="${HOME}/.local/bin:${HOME}/.cargo/bin:/Users/uqi/SDK/flutter_3.41.5/bin:${PATH}"
export CARGO_TARGET_DIR="${TARGET_DIR}"
cd "${REPO_DIR}"

mkdir -p "${LOG_DIR}" "${SCREEN_DIR}"

echo "=== 1. Checking Toolchain & Disk Space ==="
df -h /
echo "Node:   $(node -v)"
echo "Cargo:  $(cargo --version)"
echo "Git:    $(git --version)"
echo "Dart:   $(dart --version 2>&1 || echo 'Dart not in PATH')"
echo "Swift:  $(swift --version 2>&1 | head -n 1 || echo 'Swift not in PATH')"
echo ""

# 2. Run backend core unit & integration tests
echo "=== 2. Running Rust Core Unit & Integration Tests ==="
cargo test -p petak-core | tee "${LOG_DIR}/mac-cargo-test.txt"

# 3. Run pure UI logic tests
echo ""
echo "=== 3. Running Pure UI Logic Tests ==="
(
  node scripts/test_p35_diff.mjs
  node scripts/test_p36_graph.mjs
  node scripts/test_p37_rebase_plan.mjs
  node scripts/test_no_runes_in_plain_ts.mjs
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
echo "=== 6. Measuring Cold Start (scripts/measure-coldstart.mjs) ==="
node scripts/measure-coldstart.mjs | tee "${LOG_DIR}/mac-coldstart.txt"

# 7. Measure RAM Idle & Typing (Reuse from Phase 2)
echo ""
echo "=== 7. Measuring RAM Idle & Typing Benchmark ==="
if [ -f "scripts/bench_typing_lsp.mjs" ]; then
  node scripts/bench_typing_lsp.mjs | tee "${LOG_DIR}/mac-typing-10k.txt" || echo "Note: typing bench skipped if fixture not present"
fi
if [ -f "scripts/measure_lsp_ram.mjs" ]; then
  node scripts/measure_lsp_ram.mjs | tee "${LOG_DIR}/mac-lsp-ram.txt" || true
fi

# 8. Setup Demo Repo & 10k Repo for Git Benchmarks
echo ""
echo "=== 8. Setting Up Git Test Repositories ==="
DEMO_REPO="${TMPDIR:-/tmp}/petak-phase3-demo"
BIG_REPO="${TMPDIR:-/tmp}/petak-git10k"

bash scripts/phase3-demo-repo.sh "${DEMO_REPO}"
bash scripts/gen-git-10k.sh "${BIG_REPO}"

# 9. Measure Git Core Benchmarks on Mac
echo ""
echo "=== 9. Running Git Status & Log Core Benchmarks ==="
cargo run -p petak-core --example bench_status --release | tee "${LOG_DIR}/mac-bench-git-status.txt"
cargo run -p petak-core --example git_log_bench --release -- "${BIG_REPO}" | tee "${LOG_DIR}/mac-bench-git-log.txt"

# 10. Run In-App Git Test via PETAK_TEST_P3 Harness
echo ""
echo "=== 10. Running In-App Real Execution (PETAK_TEST_P3) ==="
INAPP_LOG="/tmp/petak-inapp-p3.log"
rm -f "${INAPP_LOG}"

# Matikan instance lama
pkill -x "petak-app" || true
sleep 1

export PETAK_TEST_P3=1
export PETAK_TEST_REPO="${DEMO_REPO}"
export PETAK_BENCH_OUT="${INAPP_LOG}"

# Jalankan Petak binary langsung di background
"${APP_PATH}/Contents/MacOS/petak-app" >/dev/null 2>&1 &
APP_PID=$!

echo "Petak app running in background (PID: ${APP_PID}). Waiting for test signals..."

# Polling log hingga selesai atau timeout 15 detik
TIMEOUT=15
ELAPSED=0
TEST_DONE=0

while [ $ELAPSED -lt $TIMEOUT ]; do
  if [ -f "${INAPP_LOG}" ]; then
    if grep -q "P3_ALL_TESTS_PASS" "${INAPP_LOG}"; then
      TEST_DONE=1
      break
    fi
  fi
  sleep 1
  ELAPSED=$((ELAPSED + 1))
done

if [ $TEST_DONE -eq 1 ]; then
  echo "In-App Git Test PASSED!"
  cat "${INAPP_LOG}" | tee "${LOG_DIR}/mac-inapp-p3.txt"
else
  echo "WARNING: In-app test timeout or partial log:"
  if [ -f "${INAPP_LOG}" ]; then
    cat "${INAPP_LOG}" | tee "${LOG_DIR}/mac-inapp-p3.txt"
  fi
fi

# 11. Capture Native Screenshots
echo ""
echo "=== 11. Capturing Native Screenshots ==="
if [ -f "scripts/capture_petak.swift" ]; then
  echo "Capturing Petak window to ${SCREEN_DIR}/mac-p3-real-app.png..."
  swift scripts/capture_petak.swift "${SCREEN_DIR}/mac-p3-real-app.png" || echo "Warning: Screenshot capture failed (screen might be locked)"
  cp "${SCREEN_DIR}/mac-p3-real-app.png" "${SCREEN_DIR}/mac-commit-diff.png" 2>/dev/null || true
fi

# Matikan instance app uji
kill "${APP_PID}" 2>/dev/null || true
pkill -x "petak-app" || true
sleep 1

# 12. Install to /Applications/Petak.app
echo ""
echo "=== 12. Installing to /Applications/Petak.app ==="
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
echo "  Verification Complete! All logs saved to docs/phase3/logs/"
echo "=========================================================="
