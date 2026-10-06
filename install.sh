#!/usr/bin/env bash
# ==============================================================================
#  PETAK IDE — One-Line Standalone Installer & Updater
# ==============================================================================
#  Usage:
#    curl -fsSL https://raw.githubusercontent.com/syauqiaditia/petak-ide/main/install.sh | bash
# ==============================================================================

set -euo pipefail

REPO="syauqiaditia/petak-ide"
GITHUB_API="https://api.github.com/repos/${REPO}/releases/latest"

# ANSI Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
NC='\033[0m' # No Color

echo -e "${BOLD}${CYAN}==============================================================${NC}"
echo -e "${BOLD}${CYAN}            PETAK IDE — Fast Desktop Installer                ${NC}"
echo -e "${CYAN}   The Local-First, Token-Lean Flutter & Mobile IDE           ${NC}"
echo -e "${BOLD}${CYAN}==============================================================${NC}\n"

OS="$(uname -s)"
ARCH="$(uname -m)"

if [[ "${OS}" != "Darwin" && "${OS}" != "Linux" ]]; then
  echo -e "${RED}Error: Petak IDE saat ini mendukung macOS dan Linux.${NC}"
  exit 1
fi

echo -e "Platform: ${GREEN}${OS} (${ARCH})${NC}"

# 1. Fetch latest release info
echo -e "Mengecek rilis terbaru dari GitHub (${REPO})..."

CURL_AUTH=()
if [[ -n "${GITHUB_TOKEN:-}" ]]; then
  CURL_AUTH=(-H "Authorization: token ${GITHUB_TOKEN}")
elif [[ -f "${HOME}/.github-pat" ]]; then
  PAT_VAL="$(cat "${HOME}/.github-pat" | tr -d '[:space:]')"
  if [[ -n "${PAT_VAL}" ]]; then
    CURL_AUTH=(-H "Authorization: token ${PAT_VAL}")
  fi
fi

RELEASE_JSON="$(curl -sL "${CURL_AUTH[@]}" -H "User-Agent: Petak-Installer" -H "Accept: application/vnd.github.v3+json" "${GITHUB_API}")"

TAG_NAME="$(echo "${RELEASE_JSON}" | grep -m1 '"tag_name":' | cut -d '"' -f 4 || true)"
if [[ -z "${TAG_NAME}" ]]; then
  echo -e "${YELLOW}Gagal mengambil rilis terbaru via API. Menggunakan fallback tag v0.8.1...${NC}"
  TAG_NAME="v0.8.1"
fi

VERSION="${TAG_NAME#v}"
echo -e "Versi rilis ditemukan: ${BOLD}${GREEN}${TAG_NAME}${NC}"

TMP_DIR="$(mktemp -d /tmp/petak-install.XXXXXX)"
trap 'rm -rf "${TMP_DIR}"' EXIT

INSTALL_DIR="${HOME}/.local/bin"
mkdir -p "${INSTALL_DIR}"

if [[ "${OS}" == "Darwin" ]]; then
  ASSET_NAME="Petak-macos-app.zip"
  DOWNLOAD_URL="https://github.com/${REPO}/releases/download/${TAG_NAME}/${ASSET_NAME}"

  echo -e "\nMengunduh ${ASSET_NAME}..."
  curl -fSL "${CURL_AUTH[@]}" "${DOWNLOAD_URL}" -o "${TMP_DIR}/${ASSET_NAME}"

  echo -e "Mengekstrak ke /Applications/Petak.app..."
  # Kill running Petak if updating
  pkill -f Petak || true
  sleep 1

  unzip -q -o "${TMP_DIR}/${ASSET_NAME}" -d "${TMP_DIR}"
  rm -rf /Applications/Petak.app
  cp -R "${TMP_DIR}/Petak.app" /Applications/

  # Create CLI launcher
  CLI_SCRIPT="${INSTALL_DIR}/petak"
  cat <<'EOF' > "${CLI_SCRIPT}"
#!/usr/bin/env bash
# Petak IDE CLI Launcher & Updater

set -euo pipefail

case "${1:-}" in
  update|--update)
    echo "Memeriksa pembaruan Petak IDE..."
    curl -fsSL https://raw.githubusercontent.com/syauqiaditia/petak-ide/main/install.sh | bash
    exit 0
    ;;
  version|-v|--version)
    echo "Petak IDE (macOS Desktop)"
    if [[ -d "/Applications/Petak.app" ]]; then
      defaults read /Applications/Petak.app/Contents/Info.plist CFBundleShortVersionString 2>/dev/null || echo "v0.8.1"
    fi
    exit 0
    ;;
  help|-h|--help)
    echo "Petak IDE CLI"
    echo "Usage:"
    echo "  petak               Buka Petak IDE"
    echo "  petak <dir>         Buka folder project di Petak IDE"
    echo "  petak update        Perbarui Petak IDE ke rilis terbaru"
    echo "  petak version       Tampilkan versi terpasang"
    exit 0
    ;;
  *)
    if [[ -n "${1:-}" && -d "${1:-}" ]]; then
      TARGET_PATH="$(cd "$1" && pwd)"
      open -a /Applications/Petak.app --args "${TARGET_PATH}"
    else
      open -a /Applications/Petak.app
    fi
    ;;
esac
EOF
  chmod +x "${CLI_SCRIPT}"

else
  # Linux installation
  ASSET_NAME="petak-linux-x86_64"
  DOWNLOAD_URL="https://github.com/${REPO}/releases/download/${TAG_NAME}/${ASSET_NAME}"

  echo -e "\nMengunduh ${ASSET_NAME}..."
  curl -fSL "${CURL_AUTH[@]}" "${DOWNLOAD_URL}" -o "${INSTALL_DIR}/petak-app"
  chmod +x "${INSTALL_DIR}/petak-app"

  # Create CLI launcher
  CLI_SCRIPT="${INSTALL_DIR}/petak"
  cat <<'EOF' > "${CLI_SCRIPT}"
#!/usr/bin/env bash
# Petak IDE CLI Launcher & Updater

set -euo pipefail

case "${1:-}" in
  update|--update)
    echo "Memeriksa pembaruan Petak IDE..."
    curl -fsSL https://raw.githubusercontent.com/syauqiaditia/petak-ide/main/install.sh | bash
    exit 0
    ;;
  version|-v|--version)
    echo "Petak IDE (Linux Binary)"
    "${HOME}/.local/bin/petak-app" --version 2>/dev/null || echo "v0.8.1"
    exit 0
    ;;
  help|-h|--help)
    echo "Petak IDE CLI"
    echo "Usage:"
    echo "  petak               Buka Petak IDE"
    echo "  petak <dir>         Buka folder project di Petak IDE"
    echo "  petak update        Perbarui Petak IDE ke rilis terbaru"
    echo "  petak version       Tampilkan versi terpasang"
    exit 0
    ;;
  *)
    if [[ -n "${1:-}" && -d "${1:-}" ]]; then
      TARGET_PATH="$(cd "$1" && pwd)"
      exec "${HOME}/.local/bin/petak-app" "${TARGET_PATH}"
    else
      exec "${HOME}/.local/bin/petak-app"
    fi
    ;;
esac
EOF
  chmod +x "${CLI_SCRIPT}"
fi

# Ensure ~/.local/bin is in PATH
SHELL_RC=""
if [[ -f "${HOME}/.zshrc" ]]; then
  SHELL_RC="${HOME}/.zshrc"
elif [[ -f "${HOME}/.bashrc" ]]; then
  SHELL_RC="${HOME}/.bashrc"
fi

if [[ -n "${SHELL_RC}" ]] && ! grep -q '\.local/bin' "${SHELL_RC}"; then
  echo 'export PATH="${HOME}/.local/bin:${PATH}"' >> "${SHELL_RC}"
fi

echo -e "\n${BOLD}${GREEN}==============================================================${NC}"
echo -e "${BOLD}${GREEN}       PETAK IDE ${TAG_NAME} BERHASIL DIPASANG!               ${NC}"
echo -e "${BOLD}${GREEN}==============================================================${NC}"
if [[ "${OS}" == "Darwin" ]]; then
  echo -e "Aplikasi terpasang di: ${BOLD}/Applications/Petak.app${NC}"
else
  echo -e "Aplikasi terpasang di: ${BOLD}${INSTALL_DIR}/petak-app${NC}"
fi
echo -e "CLI Launcher:          ${BOLD}${INSTALL_DIR}/petak${NC}"
echo -e "\nCara Penggunaan:"
echo -e "  - Buka IDE:             ${BOLD}${CYAN}petak${NC} (atau buka dari Launchpad / Applications)"
echo -e "  - Buka folder project:  ${BOLD}${CYAN}petak ~/MyProject${NC}"
echo -e "  - Perbarui aplikasi:    ${BOLD}${CYAN}petak update${NC}"
echo -e "\nSelamat berkarya dengan Petak IDE! 🚀"
