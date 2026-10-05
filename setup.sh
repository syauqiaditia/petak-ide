#!/usr/bin/env bash
# ==============================================================================
#  PETAK IDE — Interactive Setup & Onboarding Wizard
# ==============================================================================
#  Usage:
#    ./setup.sh
# ==============================================================================

set -uo pipefail

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
echo -e "${BOLD}${YELLOW}[1/4] Konfigurasi AI Petak Agent${NC}"
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
echo -e "\n${BOLD}${YELLOW}[2/4] Android Studio & Android SDK${NC}"
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
  echo -e "\n${CYAN}Panduan Instalasi Android SDK:${NC}"
  echo -e "1. Download Android Studio dari https://developer.android.com/studio"
  echo -e "2. Buka Android Studio, selesaikan wizard awal (SDK otomatis terpasang di ~/Library/Android/sdk atau ~/Android/Sdk)."
  echo -e "3. Alternatif minimalis (macOS via Homebrew):"
  echo -e "   ${BOLD}brew install --cask android-commandlinetools scrcpy${NC}"
  read -rp "Tekan Enter untuk melanjutkan (kamu bisa atur path nanti di Petak Settings)..."
fi

# ------------------------------------------------------------------------------
# 3. Flutter SDK
# ------------------------------------------------------------------------------
echo -e "\n${BOLD}${YELLOW}[3/4] Flutter SDK${NC}"
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
# 4. GitLab Credential & Integration
# ------------------------------------------------------------------------------
echo -e "\n${BOLD}${YELLOW}[4/4] Integrasi GitLab & Merge Requests${NC}"
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
echo -e "  - Flutter SDK:  ${FLUTTER_SDK_PATH:-"(belum diatur)"}"
echo -e "  - AI Model:     ${AI_MODEL}"
echo -e "  - GitLab URL:   ${GITLAB_URL}"
echo -e "  - GitLab Auth:  $(test -f "${HOME}/.gitlab-pat" && echo -e "${GREEN}Terkonfigurasi (~/.gitlab-pat)${NC}" || echo -e "${YELLOW}Belum ada${NC}")"

echo -e "\nIngin langsung compile dan install Petak IDE sekarang?"
echo -e "  ${BOLD}1)${NC} Ya, build aplikasi sekarang (jalankan \`./build.sh\`)"
echo -e "  ${BOLD}2)${NC} Jalankan dalam mode development (\`./build.sh --dev\`)"
echo -e "  ${BOLD}3)${NC} Tidak, saya akan build manual nanti"

read -rp "Pilihan kamu [1-3] (default: 1): " build_choice
build_choice="${build_choice:-1}"

case "${build_choice}" in
  1)
    echo -e "\nMemulai kompilasi rilis Petak IDE..."
    exec ./build.sh
    ;;
  2)
    echo -e "\nMenjalankan Petak IDE mode dev..."
    exec ./build.sh --dev
    ;;
  *)
    echo -e "\nSelesai! Kamu bisa menjalankan perintah berikut kapan saja:"
    echo -e "  - Compile rilis: ${BOLD}./build.sh${NC}"
    echo -e "  - Mode live dev: ${BOLD}./build.sh --dev${NC}"
    echo -e "  - Jalankan test: ${BOLD}./build.sh --test${NC}"
    ;;
esac
