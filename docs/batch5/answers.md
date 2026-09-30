# Jawaban Pertanyaan UQi (Batch 5)

## Q1: "Git merge ini bisa approve merge?"

Tombol **Approve** dan **"Lakukan Merge…"** saat ini baru tampil dalam mode **DEMO (disabled)** dan belum diuji langsung ke server GitLab nyata.

Agar fitur Approve dan Merge ini bisa berjalan sungguhan ke GitLab:
1. **Penyimpanan PAT & URL (Akun GitLab)**:
   - Di Batch 5, sisi Rust sudah menyediakan kontrak `accounts_get`, `accounts_save`, `accounts_test`, dan `accounts_clear`.
   - Token PAT disimpan secara aman di **macOS Keychain** (via command `security` sistem) atau file berizin `0600` di direktori config sebagai fallback di Linux, dan **tidak pernah dikembalikan ke webview ataupun dicetak di log**.
   - Senior2 sedang mengimplementasikan UI input di **Settings > Accounts** (URL GitLab + input PAT + tombol Test koneksi).
2. **Scope Token PAT yang Dibutuhkan**:
   - `read_api`: Cukup untuk melihat daftar MR, detail, diff, status pipeline, dan membaca thread diskusi.
   - `api`: Wajib jika ingin melakukan aksi perubahan, termasuk tombol **Approve**, **Unapprove**, menulis komentar/inline note, resolve thread, serta **Merge**. Token dengan scope `read_api` saja akan ditolak saat mencoba merge.
3. **Hak Akses User di Project GitLab**:
   - User pemilik token harus memiliki role minimal **Developer** (atau **Maintainer** tergantung proteksi branch target).
4. **Batasan & Syarat Merge di GitLab**:
   - **Approval Rules**: Harus memenuhi jumlah minimum persetujuan yang disyaratkan repo.
   - **Status Pipeline CI**: Pipeline CI head commit harus sukses/hijau (kecuali mode MWPS).
   - **Merge When Pipeline Succeeds (MWPS)**: Jika pipeline masih berjalan, opsi merge otomatis setelah pipeline sukses bisa diaktifkan.

---

## Q2: "Kotlin LSP gagal installing ini perkara apa?"

Waktu kemarin installer dijalankan, file zip Kotlin Language Server sebenarnya sudah berhasil diunduh dan diekstrak utuh (~89MB), namun isi foldernya bersarang ganda (`server/server/bin`) sehingga Petak mencarinya di tempat yang salah (`server/bin`) dan menganggapnya belum terpasang. Sekarang Petak sudah diperbarui agar memeriksa kedua struktur folder tersebut sekaligus dan langsung menyimpan lokasi file eksekusinya ke setelan aplikasi. Setelah instalasi selesai, Petak juga otomatis me-restart layanan Kotlin LSP tanpa perlu buka ulang aplikasi.
