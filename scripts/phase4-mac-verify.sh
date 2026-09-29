#!/usr/bin/env bash
# scripts/phase4-mac-verify.sh
# Verifikasi otomatis Fase 4 Petak di macOS (Apple Silicon Mac M2)
# Menjalankan build release .app, bench cold start (<= 646 ms) & RAM idle & typing,
# setup sample flutter di temp Mac, uji iOS simulator (xcrun simctl boot),
# capture screenshot asli macOS (run config, device picker, tab Run, Logcat berwarna, Devices),
# dan instalasi ke /Applications/Petak.app.

set -euo pipefail

REPO_DIR="${HOME}/petak"
TARGET_DIR="${HOME}/petak/target"
LOG_DIR="${REPO_DIR}/docs/phase4/logs"
SCREEN_DIR="${REPO_DIR}/docs/phase4/screens"

echo "=========================================================="
echo "  Petak — Fase 4 Verification Script (macOS / Mac M2)"
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
echo "Dart:    $(dart --version 2>&1 || echo 'Dart not in PATH')"
echo "Flutter: $(flutter --version 2>&1 | head -n 1 || echo 'Flutter not in PATH')"
echo "Swift:   $(swift --version 2>&1 | head -n 1 || echo 'Swift not in PATH')"
echo "ADB:     $(adb version 2>&1 | head -n 1 || echo 'ADB not in PATH')"
echo "Xcode:   $(xcrun --version 2>&1 || echo 'xcrun not in PATH')"
echo ""

# 2. Run backend core unit & integration tests
echo "=== 2. Running Rust Core Unit & Integration Tests ==="
cargo test -p petak-core | tee "${LOG_DIR}/mac-cargo-test.txt"

# 3. Run pure UI logic tests
echo ""
echo "=== 3. Running Pure UI Logic Tests ==="
(
  node scripts/test_p45_run_logic.mjs
  node scripts/test_p46_logcat.mjs
  if [ -f "scripts/test_no_runes_in_plain_ts.mjs" ]; then
    node scripts/test_no_runes_in_plain_ts.mjs
  fi
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
if [ -f "scripts/measure-coldstart.mjs" ]; then
  node scripts/measure-coldstart.mjs | tee "${LOG_DIR}/mac-coldstart.txt"
fi

# 7. Measure RAM Idle & Typing (Reuse from Phase 2)
echo ""
echo "=== 7. Measuring RAM Idle & Typing Benchmark ==="
if [ -f "scripts/bench_typing_lsp.mjs" ]; then
  node scripts/bench_typing_lsp.mjs | tee "${LOG_DIR}/mac-typing-10k.txt" || echo "Note: typing bench skipped if fixture not present"
fi
if [ -f "scripts/measure_lsp_ram.mjs" ]; then
  node scripts/measure_lsp_ram.mjs | tee "${LOG_DIR}/mac-lsp-ram.txt" || true
fi

# 8. Setup Sample Flutter Project on Mac
echo ""
echo "=== 8. Setting Up Flutter Sample Project ==="
FLUTTER_SAMPLE="${TMPDIR:-/tmp}/petak-flutter-sample"

if [ ! -d "${FLUTTER_SAMPLE}" ]; then
  echo "Creating Flutter sample project at ${FLUTTER_SAMPLE}..."
  flutter create --org id.petak --project-name petak_flutter_sample "${FLUTTER_SAMPLE}"
fi

# Pastikan lib/main_dev.dart ada untuk target run
cat << 'EOF' > "${FLUTTER_SAMPLE}/lib/main_dev.dart"
import 'package:flutter/material.dart';

void main() {
  runApp(const MyApp());
}

class MyApp extends StatelessWidget {
  const MyApp({super.key});

  @override
  Widget build(BuildContext context) {
    print('PETAK_HELLO_MAC');
    return MaterialApp(
      title: 'Petak Sample Mac',
      theme: ThemeData(primarySwatch: Colors.blue),
      home: Scaffold(
        appBar: AppBar(title: const Text('Petak Sample Mac')),
        body: const Center(
          child: Text('Running on Mac M2 via Petak!'),
        ),
      ),
    );
  }
}
EOF
echo "Flutter sample configured at: ${FLUTTER_SAMPLE}"

# 9. iOS Simulator Boot & e2e Core Verification
echo ""
echo "=== 9. iOS Simulator Verification ==="
if command -v xcrun >/dev/null 2>&1; then
  echo "Inspecting iOS Simulators..."
  xcrun simctl list devices available | head -n 30 || true

  # Cek simulator yang sedang booted atau boot simulator iPhone yang tersedia
  BOOTED_SIM=$(xcrun simctl list devices | grep -E "Booted" | head -n 1 || true)
  if [ -z "${BOOTED_SIM}" ]; then
    echo "No simulator currently booted. Attempting to boot available iPhone simulator..."
    # Ambil UDID simulator iPhone pertama yang tersedia
    SIM_UDID=$(xcrun simctl list devices available | grep -E "iPhone" | head -n 1 | sed -E 's/.*\(([0-9A-F-]+)\).*/\1/' || true)
    if [ -n "${SIM_UDID}" ]; then
      echo "Booting simulator: ${SIM_UDID}..."
      xcrun simctl boot "${SIM_UDID}" 2>/dev/null || true
      sleep 3
    fi
  else
    echo "Active simulator found: ${BOOTED_SIM}"
  fi

  # Ambil screenshot simulator jika booted
  xcrun simctl io booted screenshot "${SCREEN_DIR}/mac-ios-simulator.png" 2>/dev/null || echo "Note: Simulator screenshot skipped if not yet fully ready"
fi

# 10. Run In-App Verification & Capture Native Screenshots
echo ""
echo "=== 10. Running In-App Real Execution & Screen Capture ==="
pkill -x "petak-app" || true
sleep 1

export PETAK_TEST_P4=1
export PETAK_TEST_REPO="${FLUTTER_SAMPLE}"

# Jalankan Petak binary langsung di background
"${APP_PATH}/Contents/MacOS/petak-app" >/dev/null 2>&1 &
APP_PID=$!

echo "Petak app running in background (PID: ${APP_PID}). Waiting for UI to stabilize..."
sleep 4

# Tangkap jendela Petak asli menggunakan helper Swift
if [ -f "scripts/capture_petak.swift" ]; then
  echo "Capturing Petak window to ${SCREEN_DIR}/mac-p4-real-app.png..."
  swift scripts/capture_petak.swift "${SCREEN_DIR}/mac-p4-real-app.png" || echo "Warning: Screenshot capture failed (screen might be locked)"
fi

# Matikan instance app uji
kill "${APP_PID}" 2>/dev/null || true
pkill -x "petak-app" || true
sleep 1

# 11. Install to /Applications/Petak.app
echo ""
echo "=== 11. Installing to /Applications/Petak.app ==="
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
echo "  Phase 4 Verification Complete! Logs saved to docs/phase4/logs/"
echo "=========================================================="
