#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SRC="$ROOT_DIR/crates/core/src/mirror/ios/simtouch.m"
OUT_DIR="${1:-$ROOT_DIR/target/release}"
mkdir -p "$OUT_DIR"
TARGET="$OUT_DIR/simtouch"
echo "[build-simtouch] Compiling simtouch.m -> $TARGET"
clang -framework Foundation -framework CoreGraphics \
  -F/Library/Developer/PrivateFrameworks \
  -framework CoreSimulator \
  -rpath /Library/Developer/PrivateFrameworks \
  -rpath /Applications/Xcode.app/Contents/Developer/Library/PrivateFrameworks \
  -fno-objc-arc -O2 \
  "$SRC" -o "$TARGET"
echo "[build-simtouch] Done: $TARGET"
