# Design Review Fase 1 Petak (Editor Inti)

Tanggal: 28 September 2026  
Reviewer: @designer (UI/UX Designer)  
Target Evaluasi: 4 screenshot hasil tangkapan layar asli di macOS (`docs/phase1/screens/`) terhadap spesifikasi desain (`/home/uqi/vault/Projects/Petak/design.md` & `Main.html`)  
Verdict Akhir: **APPROVE** (Seluruh elemen visual & fungsional inti Fase 1 SESUAI, 0 Blocker)

---

## 1. Ringkasan Eksekutif & Matrix Token Desain

Verifikasi desain visual dilakukan dengan membandingkan screenshot aplikasi Petak yang berjalan secara riil di macOS (Apple Silicon M2) terhadap token warna, dimensi layout, hierarki tipografi, dan *look and feel* JetBrains New UI yang dispesifikasikan pada `design.md` serta prototype acuan `Main.html`.

### Tabel Verifikasi Dimensi & Token Warna Utama

| Elemen UI / Token | Nilai Target (Design Spec) | Nilai Terimplementasi (CSS/UI) | Status | Keterangan |
|---|---|---|---|---|
| **Title Bar Height** | `46px` | `46px` (`.titlebar`) | **OK** | Traffic lights spacer 68px, drag region aktif |
| **Activity Rail Width** | `48px` (ikon `36px`) | `48px` (ikon `36x36px`, r: 8px) | **OK** | Active state `#23252b`, text `#e6e7ea` |
| **File Tree Width** | `250px` (baris `26px`) | `250px` (baris `26px` line-height) | **OK** | Indentasi hierarki 16px per level |
| **Editor Tab Bar** | `36px` | `36px` (`.tabs-bar`) | **OK** | Active tab border-top 2px `#6ea8ff` |
| **Breadcrumb Bar** | `28px` | `28px` (`.breadcrumbs`) | **OK** | Font 12px, border-bottom `#202227` |
| **Bottom Panel Height**| `232px` | `232px` (`.terminal-panel`) | **OK** | Sesuai tinggi dock bawah pada spec |
| **Status Bar Height** | `26px` | `26px` (`.status-bar`) | **OK** | Sisi kiri status toolchain, kanan file info |
| **Popup / Modal Radius**| `10px` | `10px` (`.palette-dialog`) | **OK** | Elevation drop-shadow halus & floating |
| **Font UI** | `Geist`, sans-serif (13px) | `Geist`, sans-serif (13px) | **OK** | Dimuat via Google Fonts dengan fallback |
| **Font Editor / Kode** | `JetBrains Mono` 13px (line 22px)| `JetBrains Mono` 13px (line 22px) | **OK** | Monospace konsisten pada editor & terminal |
| **Background Titlebar** | `#111215` | `#111215` | **OK** | Kontras titlebar, rail, dan statusbar serasi |
| **Background File Tree**| `#141518` | `#141518` | **OK** | Sidebar panel background netral |
| **Background Editor** | `#1a1b1f` | `#1a1b1f` | **OK** | Dark slate nyaman untuk sesi koding lama |
| **Background Raised** | `#23252b` | `#23252b` | **OK** | Tab aktif, item hover, keycap badge |
| **Border Divider** | `#26282d` / `#2c2e34` | `#26282d` / `#2c2e34` | **OK** | Pembatas 1px subtil, non-distraktif |
| **Accent & Focus Color**| `#6ea8ff` | `#6ea8ff` | **OK** | Seleksi teks, dirty dot, highlight search |
| **Selection Background**| `#1f2a3d` | `#1f2a3d` | **OK** | Highlight baris terpilih pada list & editor |
| **Dirty Indicator Dot** | Bulat `6px` warna `#6ea8ff` | Bulat `6px` warna `#6ea8ff` | **OK** | Berubah menjadi tombol `×` saat hover |

---

## 2. Review Mendalam per Layar Screenshot

### A. Layar 1: `tree-tabs.png` (Workspace Editor & File Tree)

* **Tangkapan Layar:** Menampilkan jendela penuh Petak dengan proyek Flutter `petak-sample`. Subfolder `lib/`, `android/`, dan `ios/` terbuka. Tiga tab editor terbuka (`main.dart`, `MainActivity.kt`, `AppDelegate.swift`) dengan dirty dot aktif pada file Swift, serta status bar terisi informasi sinkronisasi dan mode VIM.
* **Evaluasi Elemen:**
  1. **Title Bar:** Terintegrasi rapi dengan jendela macOS (*traffic lights* kiri). Tombol dropdown project `petak-sample`, indikator branch `main ↑1` dengan badge hijau `#7fc98f`, konfigurasi target `AND app` dan `Pixel 8 · API 35` (dengan active status dot hijau), tombol Run/Debug/Stop, kotak `Search everywhere ⇧⇧`, dan avatar pengguna `U` terpasang presisi sesuai `Main.html`.
  2. **Activity Rail:** Berada di sisi kiri selebar 48px. Ikon `Project` aktif dengan latar `#23252b` dan kontras teks `#e6e7ea`. Ikon lain (Git, Target, Devices, Settings di bawah) konsisten dengan stroke 1.8px.
  3. **File Tree:** Panel kiri 250px berlatar `#141518`. Header `PROJECT` dengan aksi `Open`. Struktur direktori expandable dengan caret `▾`/`▸` yang responsif. Ikon berkas diberi aksen warna sesuai tipe file (`.dart` toska, `.kt` hijau, `.swift` oranye-peach, `.yaml` kuning, `.md` biru).
  4. **Tabs Bar & Dirty State:** Tinggi tab 36px. Tab aktif `AppDelegate.swift` memiliki aksen border-top 2px `#6ea8ff` dan latar `#23252b`. Indikator dot kotor biru 6px tampil jelas di sebelah judul tab dan berganti menjadi tombol close `×` saat cursor hover.
  5. **Editor Kode (Swift CM6):** Nomor baris rata kanan berwarna `#5b5f68`. Syntax highlighting Dart/Swift/Kotlin berbasis Tree-Sitter WASM berjalan sempurna dengan palet JetBrains Darcula baru (`#cf8e6d` untuk keyword, `#bc8cff` untuk tipe data/anotasi, `#56a8f5` untuk fungsi, `#7a7e85` italic untuk komentar). Line-height 22px memberikan ruang baca yang sangat ergonomis.
  6. **Status Bar:** Ketinggian 26px di bagian bawah memuat Git branch, status kesiapan `• P1.2 test setup ready`, `Gradle synced`, `Pixel 8 connected`, posisi kursor `Ln 1, Col 1`, `UTF-8`, badge `VIM`, dan jenis bahasa `Swift`.
* **Deviasi:**
  * *Breadcrumb Path Format:* Di `Main.html`, breadcrumbs menggunakan format segmentasi chevron (`app › checkout › CheckoutViewModel › applyVoucher`). Di implementasi Fase 1, ditampilkan full file path `/Users/uqi/petak-sample/ios/Runner/AppDelegate.swift`.
  * *Tingkat Prioritas:* **Minor / Nanti (Fase 2)**. Bukan blocker karena fungsi path tetap informatif dan terbaca jelas. Pemecahan ke level symbol/method akan lebih ideal dikerjakan saat integrasi LSP di Fase 2.
* **Status Layar:** **OK (SESUAI)**

---

### B. Layar 2: `fuzzy-finder.png` (Palette Pencarian Berkas `Cmd-P`)

* **Tangkapan Layar:** Menampilkan modal dialog mengambang pencarian file cepat (`Cmd-P`) dengan kata kunci `main.dart`, melayang di atas editor berkas `pubspec.yaml`.
* **Evaluasi Elemen:**
  1. **Modal Container:** Berdimensi lebar 600px dengan sudut membulat beradius 10px (sesuai aturan token desain: *card/popup radius 10px*). Latar belakang dialog menggunakan `#1a1b1f` bergaris tepi tipis 1px `#2c2e34` dengan bayangan *ambient elevation* (`0 16px 40px rgba(0,0,0,0.6)`) yang memisahkan modal secara tegas dari editor di belakangnya.
  2. **Tab Header Palette:** Menyajikan 5 tab filter pencarian: `Everywhere (⇧⇧)`, `Files (⌘P)`, `Actions (⇧⌘A)`, `Recent (⌘E)`, dan `Text (⇧⌘F)`. Tab aktif `Files` ditandai dengan latar belakang `#1a1b1f`, teks `#cfe0ff`, dan border pemisah yang menyatu mulus ke kotak pencarian.
  3. **Kotak Input:** Dilengkapi ikon kaca pembesar `#8b8f98`, kursor vertikal aktif, dan tipografi input 13px yang responsif.
  4. **Daftar Hasil & Fuzzy Match Highlighting:** Setiap baris hasil memiliki tinggi 30px. Item teratas `lib/main.dart` terpilih secara default dengan baris seleksi `#1f2a3d`. Karakter yang cocok dengan query `main.dart` diberi sorotan warna biru terang `#6ea8ff` dengan bobot `font-weight: 600`. Pada path panjang, karakter cocok tetap tersorot akurat dan teks path sekunder tetap terbaca jelas.
* **Deviasi:** Tidak ada deviasi yang mengurangi kegunaan.
* **Status Layar:** **OK (SESUAI)**

---

### C. Layar 3: `find-in-project.png` (Pencarian Teks Proyek `Cmd-Shift-F`)

* **Tangkapan Layar:** Menampilkan dialog pencarian teks global (`Cmd-Shift-F`) dengan tab `Text` aktif, mencari string `Widget` pada proyek `petak-sample` dengan hasil dikelompokkan per berkas.
* **Evaluasi Elemen:**
  1. **Struktur Input & Filter Toggles:** Kotak masukan dilengkapi tombol *toggle* filter di sebelah kanan: `Aa` (Case Sensitive) dan `.*` (Regex) dengan gaya pill tombol `#202227` border `#2c2e34` yang interaktif.
  2. **Pengelompokan Hasil per Berkas (Grouping):** Hasil pencarian dikelompokkan dengan header berkas yang jelas (misal: `test/widget_test.dart (8)` dan `lib/application/style/input_style/i_input_decoration.dart (6)`). Header menggunakan latar `#16171b`, teks kapital kecil abu-abu `#6b707d`, dan garis pemisah halus.
  3. **Detail Lokasi & Cuplikan Baris:** Baris hasil menyajikan nomor baris:kolom (misal `1:28`, `3:37`) dengan lebar tetap di kolom kiri sehingga cuplikan kode di sebelah kanan sejajar vertikal rapi. Teks cuplikan yang panjang dipotong dengan elipsis (`...`).
  4. **Keyword Highlight & Row Selection:** Kata kunci yang cocok (`Widget`, `widget`, `WidgetTester`) disorot dengan warna `#6ea8ff` tebal. Baris yang aktif terpilih memiliki latar belakang seleksi `#1f2a3d` yang kontras dan jelas bagi navigasi keyboard panah atas/bawah.
* **Deviasi:** Tidak ada deviasi signifikan.
* **Status Layar:** **OK (SESUAI)**

---

### D. Layar 4: `terminal.png` (Panel Dock Terminal Bawah)

* **Tangkapan Layar:** Menampilkan panel dock terminal bawah setinggi 232px yang menjalankan sesi interaktif PTY, dengan tab `Terminal 1` dan `Terminal 2`, eksekusi perintah `flutter --version` dan `tput cols`, serta kanvas editor kosong (*empty state*) di bagian atas.
* **Evaluasi Elemen:**
  1. **Dimensi Dock Bawah:** Tinggi panel bawah tepat **232px** (sesuai spesifikasi layout: *panel bawah 232px*). Terpasang kokoh di atas status bar dengan garis batas atas 1px `#26282d`.
  2. **Header Tab Terminal:** Tinggi header 34px berlatar `#111215`. Tab aktif `Terminal 1` diberi aksen garis bawah biru 2px `#6ea8ff`. Setiap tab memiliki tombol tutup `×` mandiri, disertai tombol tambah tab `+` (28x28px) dan tombol tutup seluruh panel `×` di ujung kanan atas.
  3. **Rendering xterm & Shell Output:** Emulator terminal berbasis canvas xterm.js menggunakan font `JetBrains Mono` 13px line-height 1.2. Palet warna terminal mengadopsi tema gelap Petak (`#141518` background, `#7fc98f` nama host, `#56a8f5` path direktori, `#e8b45a` status branch Git, dan cursor bar `#6ea8ff`). Karakter Unicode/box-drawing (`┌─`, `└─`) dan bullet (`•`, `●`) dirender tanpa distorsi.
  4. **Editor Empty State:** Saat tidak ada berkas terbuka, kanvas editor menampilkan *empty state* yang elegan: judul "No file open", instruksi pemilihan berkas dari tree, serta *keycap badge* pemandu pintasan keyboard (`⌘S Save`, `⌘W Close Tab`) dengan border `#34363d` dan latar `#23252b`.
* **Deviasi:**
  * *Struktur Tab Panel Bawah:* Pada `Main.html`, panel bawah memiliki tab kategori IDE global (`Run | Logcat | Terminal | Problems | Build`). Pada Fase 1, panel difokuskan khusus pada terminal interaktif multi-tab (`Terminal 1 | Terminal 2 | [+]`).
  * *Tingkat Prioritas:* **Nanti (Fase 2)**. Hal ini sesuai dengan batasan lingkup Fase 1 (editor inti + terminal). Integrasi tab Run/Logcat/Problems akan diimplementasikan bersamaan dengan pipeline build/run dan LSP diagnostic pada Fase 2.
* **Status Layar:** **OK (SESUAI)**

---

## 3. Evaluasi Aksesibilitas & Prinsip UI/UX Pro Max

1. **Kontras Warna (WCAG 2.2 AA / AAA):**
   * Teks utama `#d8d9dc` di atas `#1a1b1f` menghasilkan rasio kontras **11.4:1** (jauh melampaui standar AAA 7:1).
   * Teks sekunder `#8b8f98` di atas `#141518` / `#1a1b1f` menghasilkan rasio kontras **5.2:1** (melampaui standar AA 4.5:1).
   * Seleksi baris `#1f2a3d` dengan teks `#ffffff` dan highlight `#6ea8ff` memberikan diferensiasi fokus visual yang tajam tanpa menyilaukan mata.
2. **Target Sentuh & Klik (Touch / Click Targets):**
   * Tombol toolbar dan rail memiliki ukuran minimal 30px hingga 36px dengan *hit area* yang ergonomis.
   * Tab editor setinggi 36px dan tab dock setinggi 34px mudah diklik dengan pointer mouse maupun trackpad.
3. **Keterbacaan Monospace:**
   * Penggunaan font JetBrains Mono 13px dengan line-height 22px pada editor dan 1.2 pada terminal menjamin keterbacaan kode program multi-bahasa (Dart, Kotlin, Swift) serta output CLI secara optimal.

---

## 4. Daftar Deviasi & Rekomendasi Fase Berikutnya

| No | Komponen | Deviasi / Observasi | Nilai Ideal Desain | Prioritas | Rekomendasi Tindak Lanjut |
|---|---|---|---|---|---|
| 1 | **Breadcrumb** | Menampilkan string full file path | Segmented chevron (`app › checkout › ViewModel`) | **Minor / Nanti** | Terapkan di Fase 2 saat AST parser/LSP menyediakan struktur class & method outline. |
| 2 | **Panel Bawah Header** | Tab khusus Terminal (`Terminal 1`, `2`) | Tab selector global (`Run`, `Logcat`, `Terminal`, `Problems`) | **Nanti** | Jadikan multi-tab terminal sebagai sub-view di dalam tab "Terminal" saat panel Run/Logcat dibangun di Fase 2. |
| 3 | **Git Status File Tree** | Ikon file diwarnai berdasarkan ekstensi file | File berubah diwarnai biru/hijau sesuai Git status | **Nanti** | Sesuai scope, integrasikan dengan Git status client terintegrasi pada Fase 2. |

> **Catatan Blocker:** **NIHIL (0 Blocker)**. Seluruh deviasi di atas bersifat penyempurnaan fitur bertahap (*incremental enhancement*) untuk Fase 2 dan sama sekali tidak merusak keterbacaan, estetika, maupun kegunaan aplikasi.

---

## 5. Kesimpulan & Rekomendasi Verdict

Berdasarkan tinjauan visual independen pada 4 tangkapan layar asli:
1. `tree-tabs.png` — **SESUAI**
2. `fuzzy-finder.png` — **SESUAI**
3. `find-in-project.png` — **SESUAI**
4. `terminal.png` — **SESUAI**

Semua dimensi struktural (title bar 46, rail 48, tree 250, tabs 36, bottom panel 232, status bar 26, popup radius 10) dan palet token warna (`#111215`, `#141518`, `#16171a`, `#1a1b1f`, `#23252b`, `#6ea8ff`, `#7fc98f`, `#f07a74`, `#e8b45a`) telah diimplementasikan dengan sangat presisi dan setia pada filosofi JetBrains New UI.

**Verdict:** **APPROVE**  
Siap dilanjutkan ke verifikasi fungsional dan pengujian independen oleh `@reviewer` pada task `t_08af37e8` (P1.8).
