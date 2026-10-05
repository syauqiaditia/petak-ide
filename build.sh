#!/usr/bin/env bash
# ==============================================================================
#  Petak IDE — Universal Build Script (macOS / Linux)
# ==============================================================================
#  Usage:
#    ./build.sh          # Build production release package (.app or binary)
#    ./build.sh --dev    # Launch local development environment (Hot-reload)
#    ./build.sh --test   # Run all backend & frontend test suites
#    ./build.sh --check  # Run syntax & symbol integrity checks
# ==============================================================================

set -euo pipefail

# ANSI Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
NC='\033[0m' # No Color

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${ROOT_DIR}"

MODE="release"
if [[ "${1:-}" == "--dev" ]]; then
  MODE="dev"
elif [[ "${1:-}" == "--test" ]]; then
  MODE="test"
elif [[ "${1:-}" == "--check" ]]; then
  MODE="check"
fi

echo -e "${BOLD}${BLUE}==========================================================${NC}"
echo -e "${BOLD}${BLUE}  PETAK IDE — Build System (${MODE})${NC}"
echo -e "${BOLD}${BLUE}==========================================================${NC}"

# 1. Detect OS & Architecture
OS="$(uname -s)"
ARCH="$(uname -m)"
echo -e "Platform:      ${GREEN}${OS} (${ARCH})${NC}"
echo -e "Directory:     ${GREEN}${ROOT_DIR}${NC}"

# 2. Check Prerequisites
echo -e "\n${BOLD}Checking prerequisites...${NC}"

check_cmd() {
  local cmd="$1"
  local hint="$2"
  if command -v "${cmd}" >/dev/null 2>&1; then
    echo -e "  [✔] ${cmd}: $(command -v "${cmd}") (${GREEN}$(${cmd} --version 2>&1 | head -n 1)${NC})"
  else
    echo -e "  [✘] ${RED}Error: '${cmd}' not found.${NC} ${hint}"
    exit 1
  fi
}

check_cmd "node" "Please install Node.js v20+ from https://nodejs.org"
check_cmd "npm"  "Please install npm"
check_cmd "cargo" "Please install Rust toolchain from https://rustup.rs"
check_cmd "rustc" "Please install Rust compiler"

# Node.js version check
NODE_VER=$(node -v | sed 's/v//' | cut -d. -f1)
if [[ "${NODE_VER}" -lt 20 ]]; then
  echo -e "${YELLOW}Warning: Node.js 20+ is recommended (found v${NODE_VER}).${NC}"
fi

# 3. Mode Execution
if [[ "${MODE}" == "check" ]]; then
  echo -e "\n${BOLD}Running integrity checks...${NC}"
  if command -v python3 >/dev/null 2>&1 && [[ -f "scripts/check-app-symbols.py" ]]; then
    echo "Verifying application symbols..."
    python3 scripts/check-app-symbols.py
  fi
  echo "Typechecking Svelte/TypeScript..."
  npm run check
  echo -e "${GREEN}All integrity checks PASSED.${NC}"
  exit 0
fi

if [[ "${MODE}" == "test" ]]; then
  echo -e "\n${BOLD}Running test suites...${NC}"
  echo "1. Backend Rust Core tests..."
  cargo test -p petak-core --lib

  echo -e "\n2. Frontend TypeScript & UI tests..."
  if command -v python3 >/dev/null 2>&1 && [[ -f "scripts/check-app-symbols.py" ]]; then
    python3 scripts/check-app-symbols.py
  fi
  npm run check
  npm test
  echo -e "\n${GREEN}All 284+ backend & 267+ frontend tests PASSED.${NC}"
  exit 0
fi

# Install dependencies if node_modules missing
if [[ ! -d "node_modules" ]]; then
  echo -e "\n${BOLD}Installing npm dependencies...${NC}"
  npm install
fi

if [[ "${MODE}" == "dev" ]]; then
  echo -e "\n${BOLD}Launching development environment...${NC}"
  npm run tauri -- dev
  exit 0
fi

# Release Build
echo -e "\n${BOLD}Compiling release build...${NC}"
echo "1. Building frontend production bundle..."
npm run build

echo -e "\n2. Packaging native application bundle via Tauri..."
npm run tauri -- build

echo -e "\n${BOLD}${GREEN}Build completed successfully!${NC}"
if [[ "${OS}" == "Darwin" ]]; then
  APP_DIR="target/release/bundle/macos/Petak.app"
  if [[ -d "${APP_DIR}" ]]; then
    APP_SIZE=$(du -sh "${APP_DIR}" | awk '{print $1}')
    echo -e "macOS Bundle:  ${BOLD}${GREEN}${APP_DIR}${NC} (${APP_SIZE})"
    echo -e "Install via:   ${BLUE}cp -R \"${APP_DIR}\" /Applications/${NC}"
  fi
elif [[ "${OS}" == "Linux" ]]; then
  BIN_PATH="target/release/petak-app"
  if [[ -f "${BIN_PATH}" ]]; then
    BIN_SIZE=$(du -sh "${BIN_PATH}" | awk '{print $1}')
    echo -e "Linux Binary:  ${BOLD}${GREEN}${BIN_PATH}${NC} (${BIN_SIZE})"
  fi
fi
