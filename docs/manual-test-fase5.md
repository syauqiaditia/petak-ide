# Panduan Pengujian Manual Petak Fase 5 (Multi-Agent ACP, Quota 9Router, Project Memory, & GitLab MR)

Panduan checklist pengujian manual untuk **UQi** pada Petak IDE Fase 5.

---

## Persiapan: Build Petak.app di Mac M2 (P5.M)

Jalankan perintah ini di Terminal Mac M2 saat Mac sudah online dan terhubung:

```bash
cd ~/petak
git pull origin feat/phase5-agent

# Jalankan skrip verifikasi otomatis dan build release:
bash scripts/phase5-mac-verify.sh

# Atau build manual langsung:
npm run tauri build
```

Setelah build selesai, aplikasi terpasang di `/Applications/Petak.app`.

---

## 1. Pengujian Live Agent ACP stdio & Hermes Profiles

Pengujian integrasi multi-agent menggunakan proses stdio nyata (`acp.rs`, `slot.rs`) dan profil lokal Hermes.

- [ ] **1.1 Buka Panel AI Agents (`⌘6` atau Rail Kiri)**
  - Klik ikon **AI Agents** (ikon bintang `✨`) di Rail kiri atau tekan shortcut.
  - Panel **AI Agents** terbuka di sisi kanan.
  - Periksa sub-tab yang tersedia: **Chat**, **Edits**, **Quota**, **Memory**.

- [ ] **1.2 Deteksi Profil Hermes Otomatis**
  - Periksa tab agen di bilah atas panel:
    * Slot agen utama (misal `default` atau `senior`).
    * Klik tombol gear / konfig tim (`team.json`): pastikan profil Hermes lokal (`~/.hermes/profiles/default`, `senior`, `techlead`) terdeteksi di dropdown profil.
  - Pilih slot profil **senior** atau **techlead**.

- [ ] **1.3 Chat & Live Stream Respon**
  - Ketik pesan sederhana di input chat, misalnya: `Halo agen, jelaskan arsitektur Petak secara singkat`.
  - Klik tombol Kirim (atau tekan `Enter`).
  - **Hasil yang diharapkan:**
    * Status indikator agen berubah dari hijau (Ready) menjadi biru berkedip (Busy).
    * Teks respon muncul mengalir secara live (streaming ACP stdio).
    * Token usage dan status eksekusi diperbarui di footer chat.

- [ ] **1.4 Toggle Disiplin Ponytail & Caveman**
  - Di bar opsi prompt / disiplin agen:
    * Aktifkan toggle **PONYTAIL**: prompt otomatis diberi aturan minimalis, anti over-engineering, solusi paling ringkas.
    * Aktifkan toggle **CAVEMAN**: respon agen bergaya ringkas/terse tanpa basa-basi.
  - Kirim prompt singkat dan perhatikan gaya respon agen yang menyesuaikan arahan disiplin.

- [ ] **1.5 Intercept Perubahan Kode (ProposedEdits)**
  - Minta agen mengedit kode (misal `Tambahkan komentar TODO di baris pertama file README.md`).
  - **Hasil yang diharapkan:**
    * Agen TIDAK langsung menimpa file di disk tanpa persetujuan.
    * Muncul badge notifikasi di sub-tab **Edits**.
    * Buka sub-tab **Edits**: perubahan ditampilkan dalam bentuk diff (`DiffView.svelte`).
    * Tersedia tombol **Terima (Accept)** dan **Tolak (Reject)** per-hunk atau per-berkas.
    * Klik **Terima**: perubahan diterapkan ke berkas asli.

- [ ] **1.6 Fitur "Fix with Agent" dari Problems / Logcat**
  - Buat sengaja syntax error di sebuah file (misal hapus tanda titik koma atau kurung kurawal).
  - Buka tab **Problems** di panel bawah.
  - Klik tombol **Fix with Agent** pada baris error tersebut.
  - **Hasil yang diharapkan:**
    * Modal draft prompt muncul secara transparan memuat konteks error, nama file, dan baris kode terkait.
    * Prompt dapat diedit manual sebelum dikirim ke slot agen yang dipilih.

---

## 2. Pengujian Tab Quota & Usage (9Router Probe)

Pengujian pelaporan kuota LLM secara jujur tanpa data fiktif (`quota.rs`, `QuotaUsageView.svelte`).

- [ ] **2.1 Buka Sub-tab Quota**
  - Pada panel AI Agents, klik sub-tab **Quota**.

- [ ] **2.2 Deteksi Database 9Router & Proxy**
  - Jika service 9Router aktif (`http://127.0.0.1:20128`):
    * Badge hijau: `● Proxy 9Router Aktif (127.0.0.1:20128)`.
  - Jika database `~/.9router/db/data.sqlite` belum dibuat atau kosong:
    * Muncul banner informasi jujur: `Database kuota 9Router tidak ditemukan di ~/.9router/db/data.sqlite. Menampilkan status tanpa angka fiktif.`
    * Angka kuota bertuliskan `Tidak tersedia` (tidak ada angka karangan/fiktif).
  - Jika database terisi:
    * Tampil ringkasan token hari ini (Prompt, Completion, Total) dan estimasi biaya USD.
    * Tabel breakdown per-provider (OpenAI, Anthropic, OpenRouter, MiniMax, dsb.) dengan status kuota dan sisa kuota aktual.

- [ ] **2.3 Tombol Segarkan Data (Refresh)**
  - Klik tombol **Segarkan Data** (ikon 🔄).
  - Indikator berputar halus dan data ter-update seketika tanpa flicker.

---

## 3. Pengujian Project Memory Markdown

Pengujian sistem memori proyek lokal (`memory.rs`, `MemoryView.svelte`).

- [ ] **3.1 Buka Sub-tab Memory**
  - Pada panel AI Agents, klik sub-tab **Memory**.
  - Tampilan terbagi dua kolom: daftar berkas memori di kiri dan editor Markdown di kanan.

- [ ] **3.2 Membaca Memori Proyek (`.petak/memory/`)**
  - Klik salah satu file memori (misal `lessons.md` atau `architecture.md`).
  - Isi berkas tampil di editor dengan penomoran baris dan format monospace bersih.

- [ ] **3.3 Membuat Catatan Memori Baru**
  - Klik tombol **+ Berkas Baru**.
  - Masukkan nama berkas (misal `aturan-tim.md`).
  - Ketik beberapa baris catatan aturan atau keputusan teknis.
  - Klik **Simpan Perubahan** (`⌘S` atau tombol Simpan).
  - **Hasil yang diharapkan:**
    * Muncul toast hijau konfirmasi `Tersimpan`.
    * Berkas tersimpan nyata di folder `.petak/memory/aturan-tim.md`.

- [ ] **3.4 Keamanan Sanitasi Path Traversal**
  - Coba buat berkas dengan nama mengandung `../` atau karakter ilegal.
  - Sistem otomatis membersihkan (men-sanitize) nama berkas menjadi aman dan menolak path traversal ke luar folder `.petak/memory/`.

---

## 4. Pengujian GitLab MR Live Viewer

Pengujian peninjau Merge Request live kantor via REST v4 (`client.rs`, `MrView.svelte`).

- [ ] **4.1 Pendaftaran Token Read-Only (`read_api`)**
  - Buat PAT di `https://code.istar.id` dengan scope **HANYA `read_api`** (role Developer, masa aktif 3-7 hari).
  - Daftarkan ke credential helper via terminal:
    ```bash
    printf "protocol=https\nhost=code.istar.id\nusername=oauth2\npassword=<TOKEN_ANDA>\n\n" | git credential approve
    ```

- [ ] **4.2 Buka Panel GitLab MR (`⌘5` atau Rail Kiri)**
  - Klik ikon **Merge Requests** di Rail kiri (di bawah ikon Git).
  - Tampilan MR Viewer terbuka: daftar MR di kiri, detail di kanan.
  - Periksa adanya badge pengaman:
    ```
    [ Mode Lihat Saja · Scope: read_api ]
    ```

- [ ] **4.3 Filter & Pencarian MR**
  - Uji tab **Open**, **Mine**, **Assigned to me**, dan **Review requested**.
  - Ketik kata kunci di kolom pencarian (judul MR, branch, atau nomor `!IID`).
  - Daftar MR tersaring secara instan.

- [ ] **4.4 Detail MR & Tab Perubahan (Changes)**
  - Klik salah satu MR.
  - Tab **Overview**: cek status pipeline CI/CD, approvals, dan deskripsi markdown.
  - Tab **Changes**: klik nama file yang diubah → tampil diff Side-by-Side dan Unified.
  - Tab **Discussions**: daftar komentar ulasan kode tampil rapi terkelompok.

- [ ] **4.5 Proteksi Tombol Tulis**
  - Arahkan kursor ke tombol **Approve**, **Merge**, **Reply**, dan **Resolve**.
  - Seluruh tombol tampil **disabled** dengan tooltip:
    * *"Aksi dinonaktifkan: token membutuhkan scope 'api' untuk mengirim data ke GitLab."*

- [ ] **4.6 Tombol Checkout Branch**
  - Klik tombol **Checkout Branch** pada detail MR.
  - Branch lokal langsung berpindah ke branch MR terkait untuk review atau pengetesan lokal.
