#!/usr/bin/env bash
# scripts/phase3-demo-repo.sh
# Membuat repository dummy Git siap-tes di temporary directory untuk verifikasi Petak Fase 3.
#
# Memenuhi spesifikasi:
# - >= 12 commit, >= 2 branch, tags, 1 merge commit
# - Remote bare lokal `file://` dengan beberapa commit ter-push
# - Branch `feature/conflict-branch` siap conflict saat merge/rebase ke `main`
# - Working directory berisi file staged, unstaged (multi-hunk), dan untracked
# - Konfigurasi identitas hanya lokal (--local)
# - Opsi `--big` untuk menghasilkan repo 10.000+ commit (via gen-git-10k.sh)

set -euo pipefail

BIG_MODE=0
DEST=""

for arg in "$@"; do
  if [ "$arg" = "--big" ]; then
    BIG_MODE=1
  elif [ -z "$DEST" ]; then
    DEST="$arg"
  fi
done

if [ -z "$DEST" ]; then
  DEFAULT_TMP="${TMPDIR:-/tmp}"
  if [ -d "/mnt/storage/uqi-cache/tmp" ] && [ ! -d "/Users" ]; then
    DEFAULT_TMP="/mnt/storage/uqi-cache/tmp"
  fi
  DEST="${DEFAULT_TMP}/petak-phase3-demo"
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

if [ "$BIG_MODE" -eq 1 ]; then
  echo "=== Mode --big aktif: Memanggil gen-git-10k.sh ==="
  bash "${SCRIPT_DIR}/gen-git-10k.sh" "$DEST"
  exit 0
fi

REMOTE_DIR="${DEST}-remote.git"

echo "=========================================================="
echo "  Petak — Membuat Repo Demo Fase 3 (Git Test Fixture)"
echo "=========================================================="
echo "Target Working Repo: ${DEST}"
echo "Target Bare Remote:  ${REMOTE_DIR}"
echo ""

# Bersihkan direktori lama jika ada
rm -rf "${DEST}" "${REMOTE_DIR}"
mkdir -p "${DEST}" "${REMOTE_DIR}"

# 1. Inisialisasi Bare Remote
git init --bare "${REMOTE_DIR}" >/dev/null

# 2. Inisialisasi Working Repo
cd "${DEST}"
git init -b main >/dev/null

# Konfigurasi identitas LOKAL saja (jangan sentuh global)
git config --local user.name "Petak Demo"
git config --local user.email "demo@petak.local"
git config --local commit.gpgsign false

# Hubungkan remote origin
git remote add origin "file://${REMOTE_DIR}"

# Buat struktur file dasar
mkdir -p src

# Commit 1
cat << 'EOF' > README.md
# Petak Demo Project

Proyek demonstrasi untuk pengujian visual & fungsional Git Petak (Fase 3).
Fitur yang didukung:
- Stage/unstage per file & hunk
- Interactive rebase (squash, reword, drop, fixup)
- Resolusi merge conflict 3 kolom
- Branch & remote sync (ahead/behind)
EOF

cat << 'EOF' > src/app.ts
export function startApp(): void {
  console.log("Petak Demo App initialized v0.1");
}
EOF

git add README.md src/app.ts
git commit -m "initial commit" >/dev/null

# Commit 2
cat << 'EOF' > src/layout.ts
export interface LayoutConfig {
  theme: string;
  sidebarWidth: number;
}
EOF
git add src/layout.ts
git commit -m "feat: add core application layout" >/dev/null

# Commit 3
cat << 'EOF' > src/auth.ts
export function login(username: string): boolean {
  return username.length > 0;
}
EOF
git add src/auth.ts
git commit -m "feat(auth): implement user authentication" >/dev/null

# Commit 4
cat << 'EOF' >> src/auth.ts
export function validateSessionToken(token: string): boolean {
  return token.startsWith("sess_");
}
EOF
git add src/auth.ts
git commit -m "feat(auth): validate auth session and tokens" >/dev/null

# Commit 5
cat << 'EOF' > src/profile.ts
export function renderAvatar(userId: string): string {
  return `https://avatar.petak.local/${userId}.png`;
}
EOF
git add src/profile.ts
git commit -m "feat(profile): display user avatar and settings" >/dev/null

# Commit 6
cat << 'EOF' > src/config.json
{
  "appName": "PetakDemo",
  "version": "0.1.0",
  "theme": "light",
  "apiTimeout": 5000,
  "features": {
    "qris": true,
    "voucher": true
  }
}
EOF
git add src/config.json
git commit -m "chore(config): initialize app config and routes" >/dev/null

# Buat tag v0.1.0
git tag -a v0.1.0 -m "Release v0.1.0"

# Push main awal ke bare remote (tracking branch origin/main)
git push -u origin main >/dev/null 2>&1

# 3. Branch feature/voucher (untuk demo squash & reword di interactive rebase)
git checkout -b feature/voucher >/dev/null 2>&1

cat << 'EOF' > src/voucher.ts
export function applyVoucher(code: string, amount: number): number {
  if (code === "PETAK2026") return amount * 0.9;
  return amount;
}
EOF
git add src/voucher.ts
git commit -m "feat(voucher): add voucher input field" >/dev/null

cat << 'EOF' >> src/voucher.ts
export function isVoucherValid(code: string): boolean {
  return code.length >= 6;
}
EOF
git add src/voucher.ts
git commit -m "wip: voucher validation logic" >/dev/null

cat << 'EOF' >> src/voucher.ts
export const VOUCHER_PADDING = 16;
EOF
git add src/voucher.ts
git commit -m "wip checkout: adjust voucher layout and padding" >/dev/null

# 4. Branch feature/payment (untuk demo merge commit)
git checkout main >/dev/null 2>&1
git checkout -b feature/payment >/dev/null 2>&1

cat << 'EOF' > src/payment.ts
export function processQrisPayment(amount: number): string {
  return `QRIS_PAYMENT_OK_${amount}`;
}
EOF
git add src/payment.ts
git commit -m "feat(payment): add QRIS payment provider" >/dev/null

cat << 'EOF' > src/receipt.ts
export function generateReceipt(txId: string): string {
  return `RECEIPT_${txId}.pdf`;
}
EOF
git add src/receipt.ts
git commit -m "feat(payment): generate digital receipt PDF" >/dev/null

# 5. Lanjut di main & Merge feature/payment
git checkout main >/dev/null 2>&1

cat << 'EOF' > src/cart.ts
export function calculateTotal(items: number[]): number {
  return items.reduce((a, b) => a + b, 0);
}
EOF
git add src/cart.ts
git commit -m "feat(cart): implement shopping cart calculation" >/dev/null

cat << 'EOF' >> src/cart.ts
export function applyPromotion(total: number): number {
  return total > 100000 ? total - 10000 : total;
}
EOF
git add src/cart.ts
git commit -m "feat(cart): add promotional discount calculation" >/dev/null

# Merge branch feature/payment ke main
git merge --no-ff feature/payment -m "Merge branch 'feature/payment' into main" >/dev/null 2>&1

# Tag v0.2.0
git tag -a v0.2.0 -m "Release v0.2.0"

# Push cabang & tag ke remote
git push origin main feature/voucher feature/payment --tags >/dev/null 2>&1

# 6. Branch feature/conflict-branch (siap konflik dengan commit di main pada src/config.json)
git checkout -b feature/conflict-branch >/dev/null 2>&1

cat << 'EOF' > src/config.json
{
  "appName": "PetakDemo",
  "version": "0.2.0-conflict",
  "theme": "dracula-purple",
  "apiTimeout": 3000,
  "features": {
    "qris": true,
    "voucher": true
  }
}
EOF
git add src/config.json
git commit -m "feat(config): use dracula dark theme and 3s timeout" >/dev/null

# Kembali ke main, buat perubahan kontras pada baris yang sama di src/config.json
git checkout main >/dev/null 2>&1

cat << 'EOF' > src/config.json
{
  "appName": "PetakDemo",
  "version": "0.2.0-main",
  "theme": "nord-frost-blue",
  "apiTimeout": 8000,
  "features": {
    "qris": true,
    "voucher": true
  }
}
EOF
git add src/config.json
git commit -m "feat(config): switch default theme to nord and 8s timeout" >/dev/null

# 7. Commit tambahan di main yang BELUM di-push (ahead of origin/main)
cat << 'EOF' > src/analytics.ts
export function trackEvent(name: string, props: Record<string, any>): void {
  console.log(`[Analytics] ${name}`, props);
}
EOF
git add src/analytics.ts
git commit -m "feat(analytics): record user checkout conversion events" >/dev/null

cat << 'EOF' >> src/layout.ts
export const DEFAULT_SIDEBAR_WIDTH = 260;
export const BORDER_RADIUS = 6;
EOF
git add src/layout.ts
git commit -m "refactor(ui): polish card shadows and border radius" >/dev/null

# 8. Modifikasi Working Directory (Staged, Unstaged multi-hunk, dan Untracked)
# a. Staged change
cat << 'EOF' >> src/app.ts
export function stopApp(): void {
  console.log("Petak Demo App stopped cleanly");
}
EOF
git add src/app.ts

# b. Unstaged changes di README.md (2 hunk terpisah)
sed -i '1s/^/# [PETAK DEMO WORKTREE EDIT]\n/' README.md
cat << 'EOF' >> README.md

## Panduan Pengujian Singkat
Jalankan Petak, buka folder ini, lalu pilih tab Git di sidebar!
EOF

# c. Untracked file
cat << 'EOF' > notes-todo.md
# TODO Pengujian Manual
1. Cek stage & unstage hunk di README.md
2. Cek ahead count (+2) di status bar
3. Coba squash 2 commit di branch feature/voucher
4. Coba merge atau rebase feature/conflict-branch untuk melihat ConflictView 3-kolom
EOF

echo "✓ Selesai membuat repo demo!"
echo "  Path:   ${DEST}"
echo "  Remote: ${REMOTE_DIR}"
echo ""
echo "=== Status Working Tree ==="
git status -s
echo ""
echo "=== Git Graph Riwayat (20 commit terakhir) ==="
git log --graph --oneline --all --decorate -n 20
