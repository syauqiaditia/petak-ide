#!/usr/bin/env bash
# ==============================================================================
#  PETAK IDE — Interactive Setup & Onboarding Wizard
# ==============================================================================
#  Usage:
#    ./setup.sh
# ==============================================================================

set -uo pipefail

if [[ ! -t 0 && -e /dev/tty ]]; then
  exec < /dev/tty
fi

# ANSI Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
NC='\033[0m' # No Color

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${ROOT_DIR}"

clear 2>/dev/null || true
echo -e "${BOLD}${CYAN}==============================================================${NC}"
echo -e "${BOLD}${CYAN}        PETAK IDE — Interactive Setup & Onboarding            ${NC}"
echo -e "${CYAN}    The Local-First, Token-Lean Flutter & Android IDE       ${NC}"
echo -e "${BOLD}${CYAN}==============================================================${NC}\n"

OS="$(uname -s)"
CONFIG_DIR=""
if [[ "${OS}" == "Darwin" ]]; then
  CONFIG_DIR="${HOME}/Library/Application Support/Petak"
else
  CONFIG_DIR="${HOME}/.config/petak"
fi
mkdir -p "${CONFIG_DIR}"
CONFIG_FILE="${CONFIG_DIR}/config.json"

FLUTTER_SDK_PATH=""
ANDROID_SDK_PATH=""
AI_PROVIDER="gemini"
AI_MODEL="ag/gemini-3.8-flash-high"
GITLAB_URL="https://gitlab.com"
GITLAB_TOKEN=""

# ------------------------------------------------------------------------------
# 1. AI Provider Selection
# ------------------------------------------------------------------------------
echo -e "${BOLD}${YELLOW}[1/5] Konfigurasi AI Petak Agent${NC}"
echo -e "Petak IDE dilengkapi asisten AI terintegrasi untuk review kode, perbaikan build, dan pengujian."
echo -e "Pilih provider AI yang ingin kamu gunakan:"
echo -e "  ${BOLD}1)${NC} Google Gemini / Antigravity (${GREEN}Rekomendasi: Gemini 3.8 Flash High${NC})"
echo -e "  ${BOLD}2)${NC} Anthropic Claude (Claude Code / Sonnet 3.7)"
echo -e "  ${BOLD}3)${NC} OpenAI (ChatGPT / Codex)"
echo -e "  ${BOLD}4)${NC} Local / Ollama (Offline / On-device)"
echo -e "  ${BOLD}5)${NC} Lewati sementara (Setup nanti di Settings IDE)"

read -rp "Pilihan kamu [1-5] (default: 1): " ai_choice
ai_choice="${ai_choice:-1}"

case "${ai_choice}" in
  1)
    AI_PROVIDER="gemini"
    AI_MODEL="ag/gemini-3.8-flash-high"
    echo -e "\n${CYAN}Cara mendapatkan Google Gemini API Key:${NC}"
    echo -e "1. Buka https://aistudio.google.com/app/apikey"
    echo -e "2. Klik 'Create API key' dan salin kodenya."
    read -rp "Masukkan GEMINI_API_KEY (tekan Enter jika sudah di-set di env): " gemini_key
    if [[ -n "${gemini_key}" ]]; then
      export GEMINI_API_KEY="${gemini_key}"
      echo -e "${GREEN}✓ GEMINI_API_KEY disimpan untuk sesi ini.${NC}"
    fi
    ;;
  2)
    AI_PROVIDER="claude"
    AI_MODEL="claude-3-7-sonnet"
    echo -e "\n${CYAN}Anthropic Claude:${NC}"
    echo -e "Pastikan kamu sudah login via CLI (\`claude login\`) atau siapkan ANTHROPIC_API_KEY."
    read -rp "Masukkan ANTHROPIC_API_KEY (opsional): " claude_key
    if [[ -n "${claude_key}" ]]; then
      export ANTHROPIC_API_KEY="${claude_key}"
      echo -e "${GREEN}✓ ANTHROPIC_API_KEY disimpan.${NC}"
    fi
    ;;
  3)
    AI_PROVIDER="openai"
    AI_MODEL="gpt-4o"
    echo -e "\n${CYAN}OpenAI API Key:${NC}"
    echo -e "Dapatkan dari https://platform.openai.com/api-keys"
    read -rp "Masukkan OPENAI_API_KEY (opsional): " openai_key
    if [[ -n "${openai_key}" ]]; then
      export OPENAI_API_KEY="${openai_key}"
      echo -e "${GREEN}✓ OPENAI_API_KEY disimpan.${NC}"
    fi
    ;;
  4)
    AI_PROVIDER="ollama"
    AI_MODEL="llama3"
    echo -e "\n${CYAN}Ollama Local:${NC}"
    echo -e "Pastikan service Ollama berjalan: \`ollama serve\` di port 11434."
    ;;
  *)
    AI_PROVIDER="gemini"
    AI_MODEL="ag/gemini-3.8-flash-high"
    echo -e "AI setup dilewati. Model default diatur ke ${AI_MODEL}."
    ;;
esac

# ------------------------------------------------------------------------------
# 2. Android Studio & Android SDK
# ------------------------------------------------------------------------------
echo -e "\n${BOLD}${YELLOW}[2/5] Android Studio & Android SDK${NC}"
echo -e "Android SDK diperlukan untuk mendeteksi device, scrcpy mirroring, dan menjalankan emulator."
echo -e "Apakah kamu sudah pernah menginstall Android Studio di komputer ini?"
echo -e "  ${BOLD}1)${NC} Ya, sudah pernah install Android Studio"
echo -e "  ${BOLD}2)${NC} Belum pernah install Android Studio"

read -rp "Pilihan kamu [1-2] (default: 1): " as_choice
as_choice="${as_choice:-1}"

if [[ "${as_choice}" == "1" ]]; then
  # Auto detect
  CANDIDATE_PATHS=(
    "${ANDROID_HOME:-}"
    "${ANDROID_SDK_ROOT:-}"
    "${HOME}/Library/Android/sdk"
    "${HOME}/Android/Sdk"
    "/usr/lib/android-sdk"
  )
  for p in "${CANDIDATE_PATHS[@]}"; do
    if [[ -n "${p}" && -d "${p}" ]]; then
      ANDROID_SDK_PATH="${p}"
      break
    fi
  done

  if [[ -n "${ANDROID_SDK_PATH}" ]]; then
    echo -e "${GREEN}✓ Terdeteksi Android SDK di: ${ANDROID_SDK_PATH}${NC}"
    read -rp "Gunakan path ini? [Y/n]: " use_detected_as
    if [[ "${use_detected_as}" =~ ^[Nn] ]]; then
      read -rp "Masukkan path direktori Android SDK manual: " custom_as
      ANDROID_SDK_PATH="${custom_as}"
    fi
  else
    echo -e "${YELLOW}Tidak dapat mendeteksi Android SDK otomatis.${NC}"
    read -rp "Masukkan path direktori Android SDK: " custom_as
    ANDROID_SDK_PATH="${custom_as}"
  fi
else
  echo -e "\n${CYAN}💡 Rekomendasi Petak IDE:${NC}"
  echo -e "Petak IDE tidak mewajibkan Android Studio utuh (~2 GB+)."
  echo -e "Cukup pasang paket esensial: ${BOLD}Android SDK CLI Tools, ADB, dan scrcpy (~150 MB)${NC} yang jauh lebih cepat & hemat memori."
  echo ""
  echo -e "Pilih metode setup Android SDK:"
  echo -e "  ${BOLD}1)${NC} Install otomatis paket esensial sekarang via terminal (${GREEN}Rekomendasi${NC})"
  echo -e "  ${BOLD}2)${NC} Buka link download Android Studio di browser"
  echo -e "  ${BOLD}3)${NC} Lewati (Saya akan atur nanti di Petak Settings)"

  read -rp "Pilihan kamu [1-3] (default: 1): " install_sdk_choice
  install_sdk_choice="${install_sdk_choice:-1}"

  if [[ "${install_sdk_choice}" == "1" ]]; then
    echo -e "\n${BOLD}Memulai instalasi Android SDK esensial...${NC}"
    DEFAULT_SDK_DIR=""
    if [[ "${OS}" == "Darwin" ]]; then
      DEFAULT_SDK_DIR="${HOME}/Library/Android/sdk"
      mkdir -p "${DEFAULT_SDK_DIR}"

      if command -v brew >/dev/null 2>&1; then
        echo -e "Memasang Android Platform Tools & scrcpy via Homebrew..."
        brew install android-platform-tools scrcpy || true
      else
        echo -e "Homebrew tidak ditemukan. Mengunduh Command-Line Tools resmi dari Google..."
        CMDLINE_URL="https://dl.google.com/android/repository/commandlinetools-mac-11076708_latest.zip"
        TMP_ZIP="/tmp/cmdline-tools.zip"
        curl -fSL "${CMDLINE_URL}" -o "${TMP_ZIP}"
        mkdir -p "${DEFAULT_SDK_DIR}/cmdline-tools"
        unzip -q -o "${TMP_ZIP}" -d "${DEFAULT_SDK_DIR}/cmdline-tools"
        rm -f "${TMP_ZIP}"
        if [[ -d "${DEFAULT_SDK_DIR}/cmdline-tools/cmdline-tools" ]]; then
          rm -rf "${DEFAULT_SDK_DIR}/cmdline-tools/latest"
          mv "${DEFAULT_SDK_DIR}/cmdline-tools/cmdline-tools" "${DEFAULT_SDK_DIR}/cmdline-tools/latest"
        fi
      fi
    else
      DEFAULT_SDK_DIR="${HOME}/Android/Sdk"
      mkdir -p "${DEFAULT_SDK_DIR}"

      echo -e "Mengecek paket distro Linux..."
      if command -v apt-get >/dev/null 2>&1; then
        echo -e "Menjalankan apt install untuk adb, scrcpy, dan openjdk..."
        sudo apt-get update -qq && sudo apt-get install -y -qq adb scrcpy openjdk-17-jdk || true
      fi

      if [[ ! -d "${DEFAULT_SDK_DIR}/cmdline-tools/latest" ]]; then
        echo -e "Mengunduh Android Command-Line Tools resmi dari Google..."
        CMDLINE_URL="https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip"
        TMP_ZIP="/tmp/cmdline-tools.zip"
        curl -fSL "${CMDLINE_URL}" -o "${TMP_ZIP}"
        mkdir -p "${DEFAULT_SDK_DIR}/cmdline-tools"
        unzip -q -o "${TMP_ZIP}" -d "${DEFAULT_SDK_DIR}/cmdline-tools"
        rm -f "${TMP_ZIP}"
        if [[ -d "${DEFAULT_SDK_DIR}/cmdline-tools/cmdline-tools" ]]; then
          rm -rf "${DEFAULT_SDK_DIR}/cmdline-tools/latest"
          mv "${DEFAULT_SDK_DIR}/cmdline-tools/cmdline-tools" "${DEFAULT_SDK_DIR}/cmdline-tools/latest"
        fi
      fi
    fi

    # Accept licenses and install platform-tools if sdkmanager is present
    SDKMANAGER_BIN=""
    if [[ -x "${DEFAULT_SDK_DIR}/cmdline-tools/latest/bin/sdkmanager" ]]; then
      SDKMANAGER_BIN="${DEFAULT_SDK_DIR}/cmdline-tools/latest/bin/sdkmanager"
    elif command -v sdkmanager >/dev/null 2>&1; then
      SDKMANAGER_BIN="$(command -v sdkmanager)"
    fi

    if [[ -n "${SDKMANAGER_BIN}" ]]; then
      echo -e "Menerima lisensi Android SDK & memasang platform-tools (ADB)..."
      yes | "${SDKMANAGER_BIN}" --sdk_root="${DEFAULT_SDK_DIR}" --licenses >/dev/null 2>&1 || true
      "${SDKMANAGER_BIN}" --sdk_root="${DEFAULT_SDK_DIR}" "platform-tools" >/dev/null 2>&1 || true
    fi

    ANDROID_SDK_PATH="${DEFAULT_SDK_DIR}"
    echo -e "${GREEN}✓ Android SDK berhasil disiapkan di: ${ANDROID_SDK_PATH}${NC}"
  elif [[ "${install_sdk_choice}" == "2" ]]; then
    echo -e "\nMembuka https://developer.android.com/studio..."
    if command -v open >/dev/null 2>&1; then
      open "https://developer.android.com/studio"
    elif command -v xdg-open >/dev/null 2>&1; then
      xdg-open "https://developer.android.com/studio"
    fi
    read -rp "Tekan Enter setelah selesai menginstall Android Studio..."
    if [[ "${OS}" == "Darwin" ]]; then
      ANDROID_SDK_PATH="${HOME}/Library/Android/sdk"
    else
      ANDROID_SDK_PATH="${HOME}/Android/Sdk"
    fi
  else
    echo -e "Setup Android SDK dilewati."
  fi
fi

# ------------------------------------------------------------------------------
# 3. scrcpy (Hardware-Accelerated Device Mirroring)
# ------------------------------------------------------------------------------
echo -e "\n${BOLD}${YELLOW}[3/5] scrcpy (Hardware-Accelerated Device Mirroring)${NC}"
echo -e "scrcpy digunakan Petak IDE untuk mirroring layar HP/emulator Android ke dalam editor (60 FPS, touch interaktif)."

SCRCPY_BIN=""
if command -v scrcpy >/dev/null 2>&1; then
  SCRCPY_BIN="$(command -v scrcpy)"
elif [[ -x "/opt/homebrew/bin/scrcpy" ]]; then
  SCRCPY_BIN="/opt/homebrew/bin/scrcpy"
elif [[ -x "/usr/local/bin/scrcpy" ]]; then
  SCRCPY_BIN="/usr/local/bin/scrcpy"
elif [[ -x "/usr/bin/scrcpy" ]]; then
  SCRCPY_BIN="/usr/bin/scrcpy"
fi

if [[ -n "${SCRCPY_BIN}" ]]; then
  SCRCPY_VER="$("${SCRCPY_BIN}" --version 2>&1 | head -n 1)"
  echo -e "${GREEN}✓ scrcpy terdeteksi di: ${SCRCPY_BIN} (${SCRCPY_VER})${NC}"
else
  echo -e "${YELLOW}scrcpy belum terpasang di sistem kamu.${NC}"
  echo -e "Pilih tindakan:"
  echo -e "  ${BOLD}1)${NC} Install scrcpy sekarang via terminal (${GREEN}Rekomendasi${NC})"
  echo -e "  ${BOLD}2)${NC} Lewati sementara"

  read -rp "Pilihan kamu [1-2] (default: 1): " scrcpy_choice
  scrcpy_choice="${scrcpy_choice:-1}"

  if [[ "${scrcpy_choice}" == "1" ]]; then
    echo -e "\nMemasang scrcpy..."
    if [[ "${OS}" == "Darwin" ]]; then
      if command -v brew >/dev/null 2>&1; then
        brew install scrcpy
      else
        echo -e "${RED}Homebrew belum terpasang. Pasang Homebrew dari https://brew.sh lalu jalankan: brew install scrcpy${NC}"
      fi
    else
      if command -v apt-get >/dev/null 2>&1; then
        sudo apt-get update -qq && sudo apt-get install -y scrcpy
      elif command -v dnf >/dev/null 2>&1; then
        sudo dnf install -y scrcpy
      elif command -v pacman >/dev/null 2>&1; then
        sudo pacman -S --noconfirm scrcpy
      fi
    fi

    if command -v scrcpy >/dev/null 2>&1; then
      echo -e "${GREEN}✓ scrcpy berhasil dipasang!${NC}"
    else
      echo -e "${RED}${BOLD}⚠️ PERINGATAN:${NC} scrcpy belum berhasil terpasang."
      echo -e "${YELLOW}Jika scrcpy tidak diinstall, maka TIDAK DAPAT melakukan mirroring device Android di Petak IDE.${NC}"
    fi
  else
    echo -e "\n${RED}${BOLD}⚠️ PERINGATAN:${NC} Kamu memilih melewati instalasi scrcpy."
    echo -e "${YELLOW}Jika tidak diinstall, maka kamu TIDAK DAPAT melakukan mirroring device Android di Petak IDE.${NC}"
    echo -e "${YELLOW}(Kamu bisa memasangnya kapan saja nanti dengan perintah: 'brew install scrcpy' di macOS atau 'sudo apt install scrcpy' di Linux).${NC}"
  fi
fi

# ------------------------------------------------------------------------------
# 4. Flutter SDK
# ------------------------------------------------------------------------------
echo -e "\n${BOLD}${YELLOW}[4/5] Flutter SDK${NC}"
echo -e "Apakah kamu pengguna Flutter dan sudah menginstall Flutter SDK?"
echo -e "  ${BOLD}1)${NC} Ya, Flutter sudah terinstall"
echo -e "  ${BOLD}2)${NC} Belum, saya ingin install Flutter"
echo -e "  ${BOLD}3)${NC} Bukan pengguna Flutter (hanya Android Native / Git)"

read -rp "Pilihan kamu [1-3] (default: 1): " flutter_choice
flutter_choice="${flutter_choice:-1}"

if [[ "${flutter_choice}" == "1" ]]; then
  if command -v flutter >/dev/null 2>&1; then
    FLUTTER_BIN="$(command -v flutter)"
    FLUTTER_SDK_PATH="$(cd "$(dirname "${FLUTTER_BIN}")/.." && pwd)"
    echo -e "${GREEN}✓ Terdeteksi Flutter SDK di: ${FLUTTER_SDK_PATH}${NC}"
    read -rp "Gunakan path ini? [Y/n]: " use_detected_fl
    if [[ "${use_detected_fl}" =~ ^[Nn] ]]; then
      read -rp "Masukkan path direktori Flutter SDK: " custom_fl
      FLUTTER_SDK_PATH="${custom_fl}"
    fi
  else
    # Scan standard paths
    CANDIDATES=(
      "${HOME}/SDK/flutter"
      "${HOME}/flutter"
      "${HOME}/development/flutter"
      "/opt/flutter"
    )
    for c in "${CANDIDATES[@]}"; do
      if [[ -d "${c}" ]]; then
        FLUTTER_SDK_PATH="${c}"
        break
      fi
    done

    if [[ -n "${FLUTTER_SDK_PATH}" ]]; then
      echo -e "${GREEN}✓ Ditemukan Flutter di: ${FLUTTER_SDK_PATH}${NC}"
    else
      read -rp "Masukkan path direktori Flutter SDK (contoh: ~/SDK/flutter): " custom_fl
      FLUTTER_SDK_PATH="${custom_fl}"
    fi
  fi
elif [[ "${flutter_choice}" == "2" ]]; then
  echo -e "\n${CYAN}Panduan Instalasi Flutter SDK:${NC}"
  if [[ "${OS}" == "Darwin" ]]; then
    echo -e "Jalankan di terminal:"
    echo -e "  ${BOLD}brew install --cask flutter${NC}"
  else
    echo -e "Ikuti petunjuk resmi di: https://docs.flutter.dev/get-started/install"
  fi
  read -rp "Tekan Enter untuk melanjutkan..."
else
  echo -e "Flutter SDK dilewati."
fi

# ------------------------------------------------------------------------------
# 5. Integrasi GitLab & Merge Requests
# ------------------------------------------------------------------------------
echo -e "\n${BOLD}${YELLOW}[5/5] Integrasi GitLab & Merge Requests${NC}"
echo -e "Petak IDE mendukung peninjauan Merge Request, diskusi inline, dan status pipeline GitLab."
echo -e "Apakah kamu ingin menghubungkan akun GitLab sekarang?"
echo -e "  ${BOLD}1)${NC} Sudah punya GitLab Personal Access Token (PAT)"
echo -e "  ${BOLD}2)${NC} Belum punya, butuh panduan langkah membuat PAT"
echo -e "  ${BOLD}3)${NC} Tidak menggunakan GitLab (Lewati)"

read -rp "Pilihan kamu [1-3] (default: 1): " gitlab_choice
gitlab_choice="${gitlab_choice:-1}"

if [[ "${gitlab_choice}" == "1" || "${gitlab_choice}" == "2" ]]; then
  read -rp "Masukkan GitLab Host URL (default: https://gitlab.com): " custom_gl_url
  GITLAB_URL="${custom_gl_url:-https://gitlab.com}"
  # Strip trailing slash
  GITLAB_URL="${GITLAB_URL%/}"

  if [[ "${gitlab_choice}" == "2" ]]; then
    echo -e "\n${CYAN}Langkah-langkah membuat Personal Access Token di GitLab:${NC}"
    echo -e "1. Buka browser dan login ke: ${BOLD}${GITLAB_URL}/-/user_settings/personal_access_tokens${NC}"
    echo -e "2. Masukkan Token name: ${BOLD}Petak IDE${NC}"
    echo -e "3. Centang Scopes:"
    echo -e "   [✔] ${BOLD}api${NC} (Akses penuh baca & tulis MR, diskusi, approval)"
    echo -e "   [✔] ${BOLD}read_user${NC} (Membaca profil & avatar Anda)"
    echo -e "4. Pilih Expiration date (disarankan 1 tahun ke depan)."
    echo -e "5. Klik tombol ${BOLD}Create personal access token${NC}."
    echo -e "6. Salin kode token yang diawali dengan ${BOLD}glpat-...${NC}\n"
  fi

  read -rsp "Tempel (paste) GitLab Personal Access Token (PAT): " input_token
  echo ""
  GITLAB_TOKEN="$(echo "${input_token}" | tr -d '[:space:]')"

  if [[ -n "${GITLAB_TOKEN}" ]]; then
    # Save to ~/.gitlab-pat with secure 600 permissions
    PAT_FILE="${HOME}/.gitlab-pat"
    echo "${GITLAB_TOKEN}" > "${PAT_FILE}"
    chmod 600 "${PAT_FILE}"
    echo -e "${GREEN}✓ Token GitLab aman tersimpan di: ${PAT_FILE} (permissions 0600)${NC}"
  else
    echo -e "${YELLOW}Token tidak dimasukkan. Integrasi GitLab dilewati.${NC}"
  fi
else
  echo -e "Integrasi GitLab dilewati."
fi

# ------------------------------------------------------------------------------
# 5. Write Configuration File
# ------------------------------------------------------------------------------
echo -e "\n${BOLD}${CYAN}Menyimpan konfigurasi ke ${CONFIG_FILE}...${NC}"

# Read existing JSON if valid, or construct clean JSON
cat <<EOF > "${CONFIG_FILE}"
{
  "theme": "dark",
  "themeVariant": "variant-a",
  "aiProvider": "${AI_PROVIDER}",
  "aiModel": "${AI_MODEL}",
  "flutterSdk": "${FLUTTER_SDK_PATH}",
  "androidSdk": "${ANDROID_SDK_PATH}",
  "gitlabUrl": "${GITLAB_URL}"
}
EOF

echo -e "${GREEN}✓ Konfigurasi berhasil disimpan!${NC}"

# ------------------------------------------------------------------------------
# 6. Build & Launch Option
# ------------------------------------------------------------------------------
echo -e "\n${BOLD}${GREEN}==============================================================${NC}"
echo -e "${BOLD}${GREEN}              SETUP SELESAI & SIAP DIGUNAKAN!                 ${NC}"
echo -e "${BOLD}${GREEN}==============================================================${NC}"
echo -e "Rangkuman:"
echo -e "  - Platform:     ${OS}"
echo -e "  - Config Path:  ${CONFIG_FILE}"
echo -e "  - Android SDK:  ${ANDROID_SDK_PATH:-"(belum diatur)"}"
echo -e "  - scrcpy:       $(command -v scrcpy >/dev/null 2>&1 && echo -e "${GREEN}Terpasang (${NC}$(scrcpy --version 2>&1 | head -n 1)${GREEN})${NC}" || echo -e "${RED}Tidak ada (Mirroring Android nonaktif)${NC}")"
echo -e "  - Flutter SDK:  ${FLUTTER_SDK_PATH:-"(belum diatur)"}"
echo -e "  - AI Model:     ${AI_MODEL}"
echo -e "  - GitLab URL:   ${GITLAB_URL}"
echo -e "  - GitLab Auth:  $(test -f "${HOME}/.gitlab-pat" && echo -e "${GREEN}Terkonfigurasi (~/.gitlab-pat)${NC}" || echo -e "${YELLOW}Belum ada${NC}")"

if [[ -f "${ROOT_DIR}/build.sh" ]]; then
  echo -e "\nIngin langsung compile dan install Petak IDE sekarang?"
  echo -e "  ${BOLD}1)${NC} Ya, build aplikasi sekarang (jalankan \`./build.sh\`)"
  echo -e "  ${BOLD}2)${NC} Jalankan dalam mode development (\`./build.sh --dev\`)"
  echo -e "  ${BOLD}3)${NC} Tidak, saya akan build manual nanti"

  read -rp "Pilihan kamu [1-3] (default: 1): " build_choice
  build_choice="${build_choice:-1}"

  case "${build_choice}" in
    1)
      echo -e "\nMemulai kompilasi rilis Petak IDE..."
      exec "${ROOT_DIR}/build.sh"
      ;;
    2)
      echo -e "\nMenjalankan Petak IDE mode dev..."
      exec "${ROOT_DIR}/build.sh" --dev
      ;;
    *)
      echo -e "\nSelesai! Kamu bisa menjalankan perintah berikut kapan saja:"
      echo -e "  - Compile rilis: ${BOLD}./build.sh${NC}"
      echo -e "  - Mode live dev: ${BOLD}./build.sh --dev${NC}"
      echo -e "  - Jalankan test: ${BOLD}./build.sh --test${NC}"
      ;;
  esac
elif command -v petak >/dev/null 2>&1 || [[ -d "/Applications/Petak.app" ]]; then
  echo -e "\nIngin langsung meluncurkan Petak IDE sekarang?"
  echo -e "  ${BOLD}1)${NC} Ya, buka Petak IDE sekarang (${GREEN}petak${NC})"
  echo -e "  ${BOLD}2)${NC} Buka nanti"

  read -rp "Pilihan kamu [1-2] (default: 1): " launch_choice
  launch_choice="${launch_choice:-1}"

  if [[ "${launch_choice}" == "1" ]]; then
    echo -e "\nMembuka Petak IDE..."
    if [[ "${OS}" == "Darwin" && -d "/Applications/Petak.app" ]]; then
      open -a /Applications/Petak.app
    elif command -v petak >/dev/null 2>&1; then
      petak
    fi
  else
    echo -e "\nKetik ${BOLD}petak${NC} di terminal kapan saja untuk membuka IDE."
  fi
fi
