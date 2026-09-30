# Panduan Uji Manual GitLab MR Viewer di Petak IDE (Fase 5)

Dokumen ini adalah checklist pengujian manual untuk **UQi** dalam menguji fitur **GitLab Merge Request (MR) Viewer** di Petak IDE menggunakan GitLab kantor (`code.istar.id`).

> ⚠️ **Aturan Keselamatan Utama:**
> 1. Pengujian dimulai dari **Tahap 1: Mode Baca (Read-Only)** menggunakan token `read_api`. Mode ini **100% aman** karena Petak mengunci semua tombol tulis sehingga tidak ada risiko mengubah data atau branch di GitLab kantor.
> 2. **Tahap 2: Mode Tulis (Scope `api`)** bersifat **terpisah dan opsional**. Hanya dilakukan jika UQi ingin mencoba fitur interaktif seperti komentar atau approval, dan disarankan dicoba pada MR dummy / pengujian pribadi terlebih dahulu.
> 3. Agen bot dilarang keras menyentuh GitLab kantor secara langsung; seluruh pengujian pada dokumen ini dilakukan secara manual oleh UQi melalui antarmuka GUI Petak.

---

## Bagian 1: Persiapan Token Read-Only (Scope `read_api`)

Petak membaca kredensial GitLab secara aman melalui Git Credential Helper bawaan sistem (Apple Keychain di Mac atau helper Git). Token tidak pernah disimpan dalam file teks biasa ataupun di-hardcode.

### 1.1 Cara Membuat PAT (Personal Access Token) di GitLab Kantor
1. Buka browser dan login ke GitLab kantor di `https://code.istar.id`.
2. Klik avatar profil Anda di pojok kanan atas, lalu pilih **Preferences** (atau **Edit Profile**).
3. Di bilah menu sebelah kiri, klik **Access Tokens**.
4. Isi formulir pembuatan token baru:
   - **Token name:** Isi nama penanda, misalnya `petak-mr-readonly`.
   - **Expiration date:** Pilih tanggal kedaluwarsa yang pendek (misal **3 hari** atau **7 hari** ke depan).
   - **Role:** Pilih **Developer** (atau Maintainer sesuai peran Anda di proyek).
   - **Select scopes:** Centang **HANYA `read_api`** (kotak lain biarkan kosong!).
5. Klik tombol **Create personal access token**.
6. Salin string token yang muncul (berawalan `glpat-...`).  
   *(Catatan: Token ini hanya ditampilkan sekali oleh GitLab, simpan sementara di clipboard).*

### 1.2 Cara Mendaftarkan Token ke Git Credential (Satu Kali)
Agar Petak dapat mengenali token tersebut untuk host `code.istar.id`, daftarkan token ke Git Credential Helper dengan menjalankan perintah berikut di Terminal Mac / laptop Anda:

```bash
printf "protocol=https\nhost=code.istar.id\nusername=oauth2\npassword=<TEMPEL_TOKEN_GLPAT_ANDA_DI_SINI>\n\n" | git credential approve
```
*(Ganti `<TEMPEL_TOKEN_GLPAT_ANDA_DI_SINI>` dengan token yang baru saja Anda salin).*

**Cara memastikan token sudah terdaftar dengan benar:**
Jalankan perintah ini di Terminal:
```bash
printf "protocol=https\nhost=code.istar.id\n\n" | git credential fill
```
Jika muncul output yang memuat baris `password=glpat-...`, berarti Git Credential sudah siap dan Petak akan langsung mendeteksinya otomatis saat proyek dibuka.

---

## Bagian 2: Checklist Uji Manual — Tahap 1: Mode Baca (Read-Only)

Buka proyek `jatim-ist-mb-flutter` (atau repo kantor mana pun yang memiliki remote Git ke `code.istar.id`) di Petak IDE.

### Checklist Uji GUI:

- [ ] **1. Membuka Panel GitLab MR**
  - **Apa yang diklik:** Di bilah samping paling kiri (Rail), klik ikon **Merge Requests** (ikon ketiga dari atas, di bawah ikon Git, atau tekan shortcut `⌘5`).
  - **Hasil yang diharapkan:** Area tengah IDE berganti menampilkan tampilan **GitLab MR Viewer** (terdiri dari kolom daftar MR di kiri dan area detail di kanan). Tidak ada jeda panjang (smooth & lazy loaded).

- [ ] **2. Verifikasi Indikator Mode Baca**
  - **Apa yang dilihat:** Di sub-header MR (di samping tab filter atau di atas detail MR), perhatikan adanya badge berwarna biru-abu:
    ```
    [ Mode Lihat Saja · Scope: read_api ]
    ```
  - **Hasil yang diharapkan:** Petak mengenali bahwa token Anda hanya memiliki izin baca (`read_api`) dan langsung mengaktifkan pengaman mode baca.

- [ ] **3. Menjelajah dan Menyaring Daftar MR (MrList)**
  - **Apa yang diklik:**
    - Klik tab **Open:** Menampilkan seluruh MR yang sedang aktif/terbuka.
    - Klik tab **Mine:** Hanya menampilkan MR yang dibuat oleh Anda sendiri.
    - Klik tab **Assigned to me:** Hanya menampilkan MR yang menugaskan Anda sebagai assignee.
    - Klik tab **Review requested:** Hanya menampilkan MR yang meminta review dari Anda.
    - Ketik beberapa huruf di kotak pencarian **"Cari MR..."** (misal nomor `!12` atau kata kunci judul atau nama branch).
  - **Hasil yang diharapkan:** Daftar kartu MR di sisi kiri langsung terfilter seketika sesuai tab yang dipilih atau kata kunci yang diketik.

- [ ] **4. Melihat Ringkasan & Detail MR (Tab Overview)**
  - **Apa yang diklik:** Klik salah satu kartu MR di daftar kiri.
  - **Hasil yang diharapkan:**
    - Panel kanan memuat informasi lengkap: judul MR, nomor `!IID`, status pill (`Open`), nama pembuat (author), target branch, serta waktu pembaruan.
    - **Widget Pipeline CI/CD:** Menampilkan status pipeline terakhir (misal centang hijau `Passed`, indikator biru `Running`, atau silang merah `Failed`) beserta daftar job penting.
    - **Widget Approvals:** Menampilkan status persetujuan rekan tim (berapa reviewer yang sudah approve).
    - **Deskripsi MR:** Deskripsi tertulis rapi dalam format Markdown yang aman dan bersih.

- [ ] **5. Meninjau Perubahan Kode (Tab Changes / Diff)**
  - **Apa yang diklik:** Di panel kanan detail MR, klik sub-tab **Changes** (Perubahan Berkas).
  - **Hasil yang diharapkan:**
    - Di sisi kiri tab muncul daftar berkas yang berubah lengkap dengan angka baris hijau (`+N`) dan merah (`-M`).
    - Klik salah satu nama berkas: tampilan diff (`DiffView`) langsung muncul dengan pembanding warna yang jelas.
    - Anda dapat beralih antara tampilan **Side-by-Side** (dua kolom) atau **Unified** (satu kolom baris bergantian).

- [ ] **6. Membaca Diskusi & Komentar Tim (Tab Discussions)**
  - **Apa yang diklik:** Klik sub-tab **Discussions** (Diskusi & Catatan).
  - **Hasil yang diharapkan:**
    - Seluruh percakapan ulasan tim tampil dalam bentuk kartu-kartu diskusi yang terkelompok.
    - Komentar yang ditujukan pada baris kode tertentu menampilkan potongan baris kode terkait.
    - Terlihat status apakah thread tersebut sudah diselesaikan (*Resolved* dengan centang hijau) atau belum (*Unresolved* dengan bulatan kuning).

- [ ] **7. Verifikasi Proteksi Tombol Tulis (Wajib Disabled)**
  - **Apa yang dicek/diklik:**
    - Arahkan kursor (*hover*) ke tombol balas komentar di tab *Discussions*.
    - Arahkan kursor ke tombol centang **Resolve Discussion**.
    - Arahkan kursor ke tombol **Approve / Unapprove**.
    - Arahkan kursor ke tombol **Lakukan Merge...** di bilah bawah (*MrMergeBar*).
  - **Hasil yang diharapkan:**
    - Semua tombol tersebut tampil **redup/nonaktif (disabled)** dengan kursor berbentuk tanda dilarang (`not-allowed`).
    - Muncul tooltip pesan peringatan yang jelas:
      *"Aksi dinonaktifkan: token membutuhkan scope 'api' untuk mengirim data ke GitLab."*
    - Klik pada tombol-tombol tersebut tidak memicu pengiriman data apa pun ke server.

- [ ] **8. Uji Fitur Checkout Branch Lokal**
  - **Apa yang diklik:** Di header detail MR, klik tombol **Checkout Branch**.
  - **Hasil yang diharapkan:**
    - Petak menjalankan perintah Git lokal (`git switch` ke branch MR).
    - Status bar Git di Petak menunjukkan branch lokal Anda telah berpindah ke branch MR tersebut untuk ditinjau/dijalankan secara lokal di mesin Anda.

---

## Bagian 3: Checklist Uji Manual — Tahap 2: Mode Tulis (Scope `api`) [OPSIONAL]

> ⚠️ **PERINGATAN:** Tahap ini sepenuhnya **OPSIONAL**. Gunakan hanya jika Anda ingin menguji integrasi aksi tulis, dan prioritaskan untuk mengujinya pada **MR uji coba pribadi** (dummy branch), **bukan** pada MR utama rilis produksi.

### 3.1 Menyiapkan Token Scope `api`
1. Buka kembali `https://code.istar.id` -> **Preferences** -> **Access Tokens**.
2. Buat token baru dengan scope **`api`** (role Developer, masa aktif 1-2 hari).
3. Daftarkan ke Git Credential:
   ```bash
   printf "protocol=https\nhost=code.istar.id\nusername=oauth2\npassword=<TOKEN_API_BARU>\n\n" | git credential approve
   ```
4. Buka kembali Petak atau klik tombol **Refresh** di panel MR.

### Checklist Uji GUI Mode Tulis:

- [ ] **1. Verifikasi Status Mode Penuh**
  - **Hasil yang diharapkan:** Badge `[ Mode Lihat Saja ]` menghilang, dan tombol-tombol aksi tulis kini berwarna tegas dan siap diklik.

- [ ] **2. Mengirim Komentar Ulasan Baru**
  - **Apa yang diklik:** Di tab *Discussions*, ketik pesan singkat di kotak input bawah (misal: *"Uji coba komentar ulasan via Petak IDE"*), lalu klik tombol **Kirim Komentar**.
  - **Hasil yang diharapkan:** Komentar baru langsung muncul di daftar thread Petak dan dapat dicek di web browser GitLab kantor.

- [ ] **3. Memberi Komentar Inline pada Baris Diff**
  - **Apa yang diklik:** Di tab *Changes*, hover pada salah satu nomor baris diff kode, klik ikon `+`, ketik catatan ulasan, lalu simpan.
  - **Hasil yang diharapkan:** Komentar inline tersimpan tepat pada commit SHA dan baris berkas yang bersangkutan.

- [ ] **4. Menyelesaikan Diskusi (Resolve Thread)**
  - **Apa yang diklik:** Klik tombol centang / **Resolve** pada salah satu thread ulasan yang belum selesai.
  - **Hasil yang diharapkan:** Status thread berganti menjadi hijau (*Resolved*).

- [ ] **5. Memberi & Membatalkan Persetujuan (Approve / Unapprove)**
  - **Apa yang diklik:** Klik tombol **Approve** di bar aksi bawah.
  - **Hasil yang diharapkan:** Jumlah persetujuan bertambah dan nama/avatar Anda muncul di daftar approver. Klik **Unapprove** untuk mengembalikan status.

- [ ] **6. Pengujian Modal Konfirmasi Merge & Verifikasi SHA**
  - **Apa yang diklik:** Klik tombol hijau **Lakukan Merge...** di *MrMergeBar*.
  - **Hasil yang diharapkan:**
    - Muncul jendela modal konfirmasi merge dengan rincian mutlak:
      * Menampilkan target branch dan source branch.
      * Menampilkan **Head Commit SHA lengkap (40 karakter)** untuk memastikan commit yang dimerge persis sama dengan yang Anda tinjau.
      * Opsi pilihan centang *Squash commits* dan *Hapus source branch*.
    - Tombol batal berfungsi menutup modal tanpa ada aksi merge yang dikirim.
    - *(Jika menguji konfirmasi sampai tuntas pada branch dummy pribadi, merge berhasil dan status MR berubah menjadi `Merged`).*

---

## Bagian 4: Laporan Status Fase 5 (Ringkasan Implementasi)

Berikut adalah status pencapaian teknis Fase 5 saat ini:

### 1. Apa yang Sudah Selesai & Berjalan di Server (`uqiflutter1`):

#### Track B — GitLab Merge Request Viewer (G0 s/d G3):
- **G0 (HTTP Client & Mock Server):**
  - Klien HTTP `ureq` + `native-tls` terpilih dan terintegrasi di `crates/core`.
  - Binary app tetap ramping di bawah batas ketat 20 MB (delta ukuran <0.1 MB).
  - Mock server GitLab lokal berbasis `tiny_http` dengan fixture respons lengkap (pagination, etag 304, error 401/403/405/406/409/429).
- **G1 (GitLab Read Client):**
  - Rust core `gitlab/client.rs`: integrasi `git credential fill`, deteksi otomatis token & scope (`read_api` vs `api`).
  - Cache in-memory LRU dengan dukungan `ETag` (hemat bandwidth & CPU).
  - Penanganan batas laju (Rate Limit 429) dengan pembacaan header `Retry-After`.
  - Pengambilan data paginasi lazy untuk MR list, detail, diffs/changes, pipeline jobs, dan discussions.
- **G2 (GitLab Write Client & Git Ops):**
  - Rust core write endpoints: penambahan note, inline discussion, resolve discussion, approve/unapprove, dan merge.
  - Pengaman mutlak: verifikasi Commit SHA wajib disertakan pada permintaan merge untuk mencegah race condition.
  - Penerjemahan kode status HTTP GitLab (405, 406, 409) ke dalam pesan error bahasa manusia yang mudah dipahami.
  - Fungsi `checkout_mr` berbasis refspec `merge-requests/:iid/head:mr-:iid` tanpa perlu API tulis.
  - 22 tes unit/integrasi Rust (`gitlab_client_test`, `gitlab_mock_test`, `gitlab_write_test`) **100% lolos**.
- **G3 (Antarmuka Pengguna / UI Svelte 5):**
  - Komponen antarmuka `MrView`, `MrList`, `MrDetail`, `MrFiles`, `MrThread`, `MrMergeBar`.
  - Menggunakan kembali (*reuse*) komponen diff yang sudah ada (`DiffView.svelte`), nol duplikasi viewer diff.
  - Mode DEMO offline bawaan untuk peninjauan antarmuka tanpa token.
  - Sanitasi ketat terhadap teks Markdown pada deskripsi dan komentar (mencegah XSS dan kebocoran token/IP via gambar eksternal).
  - Integrasi Rail kiri Petak (ikon MR tepat di bawah Git) sesuai spesifikasi desain.
  - 69 tes unit JavaScript/TypeScript (`npm run test`) **100% lolos**.
  - Ukuran bundel produksi Svelte sangat optimal (MrView chunk hanya ~12 kB gzip, jauh di bawah budget 100 kB).

#### Track A — AI Agents & ACP (A0 s/d A3):
- **A0 (Riset Dependensi & Deteksi Hermes):**
  - Verifikasi toolchain Hermes ACP (`hermes acp`) per profil dan health check.
- **A1 (ACP Client & Slot Lifecycle):**
  - Implementasi protokol ACP JSON-RPC di Rust (`agent/acp.rs`), lifecycle slot agen (`slot.rs`), lazy process spawning, dan pengujian dengan fake agent.
- **A2 & A3 (Hermes Integration & Permission Engine):**
  - Deteksi profil Hermes dan badge status kanban task.
  - Format penyimpanan konfigurasi tim multi-agen `.petak/team.json`.
  - Mesin izin eksekusi 4-tingkat (`Read`, `Ask`, `Auto`, `Full`) di `agent/perm.rs`.
  - Sistem penampung usulan perubahan kode (*Proposed Edits Buffer*) di `agent/proposal.rs` yang mewajibkan ulasan diff sebelum file ditulis ke disk.

---

### 2. Apa yang Membutuhkan Verifikasi di Mac UQi (Techlead Only):

Sesuai aturan kerja tim, pengujian dan eksekusi pada mesin Mac UQi (`100.100.1.1`) dilakukan secara khusus oleh **Techlead**:

1. **Build & Bundling Native macOS:**
   - Kompilasi biner aplikasi Petak native untuk arsitektur Apple Silicon macOS (`cargo tauri build`).
2. **Pengujian Kredensial macOS Keychain:**
   - Memastikan pemanggilan `git credential fill` di macOS memunculkan prompt izin Keychain sekali, dan selanjutnya terbaca mulus oleh Petak tanpa hambatan sandbox.
3. **Audit Performa di macOS:**
   - Mengukur durasi *cold start* aplikasi (wajib tetap di bawah batas budget **≤646 ms**).
   - Mengukur penggunaan memori (*idle RAM*) aplikasi dengan panel MR aktif (target total <150 MB).
4. **Verifikasi Agen Claude Code & Hermes Native Mac:**
   - Menguji spawn proses agen Claude Code (`@agentclientprotocol/claude-agent-acp`) dan Hermes ACP pada lingkungan macOS.
5. **Verifikasi Tampilan UI Retina:**
   - Memastikan ketajaman ikon MR di Rail, perataan teks, dan kehalusan scroll pada tampilan diff side-by-side di layar Retina MacBook.
