#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SRC="$ROOT_DIR/crates/core/src/mirror/ios/simtouch.m"
OUT_DIR="${1:-$ROOT_DIR/target/release}"
mkdir -p "$OUT_DIR"
TARGET="$OUT_DIR/simtouch"
echo "[build-simtouch] Compiling simtouch.m -> $TARGET"
if [ "$(uname)" = "Darwin" ]; then
  clang -framework Foundation -framework CoreGraphics \
    -F/Library/Developer/PrivateFrameworks \
    -framework CoreSimulator \
    -rpath /Library/Developer/PrivateFrameworks \
    -rpath /Applications/Xcode.app/Contents/Developer/Library/PrivateFrameworks \
    -fno-objc-arc -O2 \
    "$SRC" -o "$TARGET"
  echo "[build-simtouch] Done: $TARGET"
else
  echo "Warning: clang build failed or not supported on Linux host (requires macOS host with Xcode frameworks)"
fi

SWIFT_SRC="$ROOT_DIR/crates/core/src/mirror/ios/petak_ios_capture.swift"
SWIFT_TARGET="$OUT_DIR/petak_ios_capture"
if [ -f "$SWIFT_SRC" ]; then
  echo "[build-simtouch] Compiling petak_ios_capture.swift -> $SWIFT_TARGET"
  swiftc -O \
    -framework ScreenCaptureKit \
    -framework VideoToolbox \
    -framework CoreMedia \
    -framework CoreGraphics \
    -framework Foundation \
    -framework AppKit \
    -target arm64-apple-macos14.0 \
    "$SWIFT_SRC" -o "$SWIFT_TARGET" || echo "Warning: swiftc build failed or not supported on Linux host"
fi
