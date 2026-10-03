# Petak — UI/UX Design Specification: Standalone Welcome, Edit Configurations Dialog, GitLab MR Actions & Minimalist Coder SVG Icons (Batch 23)

**Target:** Standalone Welcome Dashboard, Run/Debug Configurations Dialog, GitLab MR Modal & Actions, Tool Windows Rail Button & Coder SVG Icons  
**Status:** Ready for Implementation & Review (Handoff to @senior2 & @reviewer)  
**Author:** @designer (UI/UX Designer)  
**Date:** 3 Oktober 2026  
**Parent Task / Ref:** `t_4b7a7006` (Petak b23 DESIGNER) & `TASK-b23.md` (Batch 23 Finishing Mandate)  
**Aset SVG Disediakan:** `ui/icons/*.svg` dan `ui/icons/index.ts`  

---

## 1. Ringkasan Eksekutif & Sasaran Desain Batch 23

Sesuai arahan teknis UQi pada `TASK-b23.md`, sebelum melangkah ke tahap *Agentic Orchestrator*, Petak IDE memerlukan 8 penyempurnaan utama agar kenyamanan dan estetika antarmuka pengembang mobile setara atau melebihi standar JetBrains / Android Studio dan Xcode.

Tugas desainer dalam Batch 23 difokuskan pada 4 pilar arsitektur visual:
1. **Standalone Welcome Dashboard:** Pengalaman pembuka IDE yang bersih (*clean 2-column view*, bergaya Xcode/Android Studio), tanpa kontaminasi frame editor, dock Device Mirror, toolbar run, atau status bar ketika belum ada proyek yang dibuka.
2. **Run/Debug Configurations Dialog ("Edit Configurations..."):** Modal dialog 2-kolom bergaya JetBrains untuk mengelola target run Flutter (`dev`, `prod`, `main_uat`, dll) secara visual dan menyimpannya secara deterministik ke `.petak/run.json`.
3. **GitLab Merge Request: Form Create & Aksi MR (Approve, Merge, Rebase):** Antarmuka lengkap pembuatan MR baru serta pembaruan pada detail MR dengan tombol aksi stateful (*Approve*, *Merge*, *Rebase*) dan navigasi 3 tab (*Discussion*, *Commits*, *Changes*).
4. **Tool Windows Rail Button & Koleksi Custom Minimalist Coder SVG Icons:** Mengganti ikon matahari (theme toggle) di rail kiri dengan ikon "Tool Windows" / multi-window docking layout, serta memproduksi koleksi ikon SVG kustom bernuansa *coder* (Android Emulator, iOS Simulator, Physical USB, Physical Wi-Fi, dan toolchains).

### Prinsip Desain Ponytail & UI Pro Max
- **Zero-Bloat & Pure Svelte 5:** Tidak ada ketergantungan pustaka komponen UI eksternal. Semua dialog dan komponen menggunakan CSS murni berbasis token Petak yang sudah ada.
- **Visual Consistency:** Mengacu pada tema JetBrains Dark OLED (`#111215`, `#16171a`, `#1c1d22`, `#26282d`, aksen `#6ea8ff` / `#3574f0`).
- **Aksesibilitas & Tipografi (WCAG AAA):** Kontras teks utama > 7:1, teks sekunder > 4.5:1. Seluruh kontrol interaktif memiliki target sentuh/klik minimal 32–44px, status fokus keyboard yang tegas (`focus-visible: ring-2 #3574f0`), serta tooltip informatif.

---

## 2. Fitur 1: Standalone Welcome Dashboard

### 2.1 Aturan Isolasi Shell IDE (Shell Isolation Rules)
Ketika kondisi `!currentFolderPath || isDashboardOpen` bernilai `true`:
1. **DILARANG** me-render `<Rail />` navigasi kiri (48px).
2. **DILARANG** me-render tombol Run, Hot Reload, selector Device, selector Run Config, tombol Sync Gradle, dan toggle Device Mirror di `<TitleBar />`.
3. **DILARANG** me-render `<StatusBar />` bawah (26px).
4. **DILARANG** me-render dock Device Mirror (`<DeviceMirrorPanel />`) di sisi kanan.
5. Window body sepenuhnya dialokasikan untuk `<DashboardView />` dengan TitleBar native minimalis (traffic lights macOS, logo Petak, versi, dan tombol Exit/Close Dashboard jika dibuka dari editor).

### 2.2 Wireframe ASCII Layout (2 Kolom Mandiri)

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ [● ● ●]  Petak IDE — Welcome                                                [ 🇮🇩 ID | 🇬🇧 EN ] [ 🌙 | ☀️ ]│
├────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                                        │
│   KOLOM KIRI (Brand & Quick Actions, 400px)         KOLOM KANAN (Recent Projects, Flex 1, 620px)       │
│                                                                                                        │
│   ┌──────────────────────────────────────────┐     ┌────────────────────────────────────────────────┐  │
│   │ [Logo Petak 48px Animasi Breathing]      │     │ RECENT PROJECTS (5)          [🔍 Cari Proyek…] │  │
│   │ PETAK v0.8.0-b23                         │     ├────────────────────────────────────────────────┤  │
│   │ Native Flutter & Mobile Engineering IDE  │     │ 💙 jatim-ist-mb-flutter 📌          [14m lalu] │  │
│   └──────────────────────────────────────────┘     │    /mnt/storage/projects/...   [canary/dev]  ✕ │  │
│                                                    │ ────────────────────────────────────────────── │  │
│   ┌──────────────────────────────────────────┐     │ ⚡ petak-p4m                        [2j lalu]  │  │
│   │ 📂 Buka Folder…                  (⌘O)    │     │    /mnt/storage/uqi-projects/petak   [main]  ✕ │  │
│   │    Buka workspace lokal dari disk        │     │ ────────────────────────────────────────────── │  │
│   ├──────────────────────────────────────────┤     │ 🎮 hermes-office                    [Kemarin]  │  │
│   │ ✨ Buat Proyek Flutter…           (⌘N)    │     │    /mnt/storage/projects/...         [dev]  ✕ │  │
│   │    Template Flutter app & native module  │     │ ────────────────────────────────────────────── │  │
│   ├──────────────────────────────────────────┤     │ 📦 graphify-jconnect                [3h lalu]  │  │
│   │ 📥 Clone Repositori Git…         (⌘⇧O)   │     │    /mnt/storage/projects/...      [master]  ✕ │  │
│   │    Clone dari GitLab Jatim / GitHub      │     │ ────────────────────────────────────────────── │  │
│   └──────────────────────────────────────────┘     │ 🔧 jatim-pos-android                [5h lalu]  │  │
│                                                    │    /mnt/storage/projects/...      [release]  ✕ │  │
│   ┌──────────────────────────────────────────┐     └────────────────────────────────────────────────┘  │
│   │ TOOLCHAIN HEALTH SUMMARY                 │                                                         │
│   │ 🟢 Flutter 3.24.3  🟢 SDK 34  🟢 JDK 17  │     Navigasi Keyboard:                                  │
│   │ 4 dari 5 tools siap · [Buka Doctor →]    │     • [↑ / ↓] Pilih proyek dalam daftar                 │
│   └──────────────────────────────────────────┘     • [Enter] Buka proyek yang dipilih                  │
│                                                    • [⌘F] Fokus ke kolom pencarian                     │
│   ┌──────────────────────────────────────────┐     • [Esc] Hapus query filter                          │
│   │ Pengaturan Cepat: Buka Proyek Terakhir [v]│                                                         │
│   └──────────────────────────────────────────┘                                                         │
└────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### 2.3 Rincian Komponen & Interaksi Kolom Kiri
- **Header Brand:**
  - Logo Petak 4-cell dengan CSS keyframe *breathing glow* (tinggi/lebar 48px).
  - Teks Judul: "PETAK", font 22px bold `#f0f1f4`, font Geist/System.
  - Badge Versi: `v0.8.0 (Batch 23)`, warna `#8b8f98`, background `#1a1b1f`, padding 2px 8px, border-radius 12px.
  - Subtitle: "Native Flutter & Mobile Engineering IDE Ringan & Cepat", 13px `#8b8f98`.
- **Tiga Kartu Quick Action:**
  1. `Buka Folder…` (`⌘O`): Memicu dialog pemilih direktori native `api.pickFolder()`.
  2. `Buat Proyek Flutter…` (`⌘N`): Membuka panduan / modal pembentukan proyek Flutter baru (`flutter create`).
  3. `Clone Repositori Git…` (`⌘⇧O`): Membuka dialog clone repository dari GitLab Bank Jatim (`code.istar.id`) atau GitHub.
  - *Gaya Kartu:* Background `#1c1d22`, border `1px solid #26282d`, radius `10px`, hover background `#23252b`, transition `0.15s ease`.
- **Toolchain Health Summary Card:**
  - Menampilkan ringkasan live dari `toolchainStore` (Flutter, Dart, Android SDK, JDK, scrcpy).
  - Indikator hijau `● Ready` jika semua tools utama terdeteksi, atau kuning `⚡ N Tindakan` jika ada toolchain yang belum siap.
  - Tombol aksi: "Buka Petak Doctor →" membuka modal diagnostik lengkap dengan fitur "Pindai Ulang".

### 2.4 Rincian Komponen & Interaksi Kolom Kanan (Recent Projects)
- **Header & Search Bar:**
  - Judul: "Recent Projects" dengan counter total riwayat.
  - Input Pencarian: Placeholder *"Filter proyek terakhir… (↑↓ Enter, ⌘F)"*, background `#141518`, border `1px solid #2c2e34`, tinggi `34px`, border-radius `6px`.
  - Icon Search di sisi kiri input, icon clear (`✕`) di sisi kanan saat ada teks.
- **Item Proyek:**
  - Baris 1: Icon jenis framework (Flutter blue bird / Android), Nama Proyek (14px semi-bold `#e6e7ea`), Badge Git Branch (`canary/dev` pill ungu/abu), dan Timestamp relatif (`14m lalu`).
  - Baris 2: Monospace path lengkap direktori (`/mnt/storage/projects/...`), font 11px `#8b8f98`, truncate tengah jika terlalu panjang.
  - Tombol Hover `✕`: Menghapus entri proyek dari riwayat recent (`api.recentProjectsRemove()`) tanpa menghapus file di disk.
  - *Status Seleksi:* Navigasi panah `↑` dan `↓` memberikan border kiri aktif `3px solid #3574f0` dan background `#22242b`. Tekan `Enter` langsung membuka proyek.

---

## 3. Fitur 2: Run/Debug Configurations Dialog ("Edit Configurations...")

### 3.1 Pintu Masuk / Trigger UI
1. **Dropdown Item:** Di bagian bawah menu dropdown `RunConfigPicker.svelte`, setelah daftar konfigurasi, terdapat garis pemisah dan tombol:
   ```
   ──────────────────────────────────
   ⚙️ Edit Configurations…    (⌘⇧E)
   ```
2. **TitleBar Quick Icon:** Tombol ikon gear mini di sebelah kanan selector konfigurasi di TitleBar.

### 3.2 Wireframe ASCII Modal Dialog (840px × 560px)

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│  Run/Debug Configurations                                                          [✕] │
├──────────────────────────────┬─────────────────────────────────────────────────────────┤
│  [+] [-] [📋 Copy]           │ Name: [ dev                                           ] │
│ ──────────────────────────── │                                                         │
│ ▼ Flutter (3)                │ Target / Dart Entrypoint:                               │
│   ● dev                      │ [ lib/main_dev.dart                          ] [📂 Browse]│
│   ○ prod                     │   ✓ File ditemukan di workspace                         │
│   ○ main_uat                 │                                                         │
│                              │ Additional Run Args:                                    │
│ ▼ Gradle / Android (1)       │ [ --flavor dev --dart-define=ENV=dev                  ] │
│   ○ app:assembleDebug        │   Contoh: --flavor dev, -t lib/main.dart, --verbose     │
│                              │                                                         │
│                              │ Build Flavor:                                           │
│                              │ [ dev                                                 ] │
│                              │                                                         │
│                              │ Working Directory (Opsional):                           │
│                              │ [ /mnt/storage/projects/jatim-ist-mb-flutter  ] [📂]   │
│                              │                                                         │
│                              │ ▼ Opsi Lanjutan (Environment & Engine)                  │
│                              │   [ ] Attach to existing Flutter process                │
│                              │   [ ] Enable verbose logging (-v)                       │
├──────────────────────────────┴─────────────────────────────────────────────────────────┤
│ 💾 Disimpan di .petak/run.json                             [ Batal ] [ Terapkan ] [ OK ] │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

### 3.3 Spesifikasi Kolom Kiri (Master Configuration Tree, Lebar 260px)
- **Toolbar Atas:**
  - `+` (Add): Dropdown menu untuk memilih tipe konfigurasi baru:
    - *Flutter Application*
    - *Android / Gradle Task*
  - `-` (Remove): Menghapus konfigurasi yang sedang dipilih (dengan konfirmasi aman jika hanya tersisa 1).
  - `📋` (Copy / Duplicate): Menduplikasi konfigurasi yang dipilih dengan akhiran `_copy`.
- **Daftar Konfigurasi (Grouped List):**
  - Kategori *Flutter*: Icon Flutter SVG kecil (14px) + label "Flutter" + counter jumlah.
  - Kategori *Gradle / Android*: Icon Android Bugdroid SVG kecil (14px) + label "Gradle / Android".
  - Tiap item memiliki:
    - Dot radio indicator (terisi untuk yang sedang aktif di runner).
    - Nama konfigurasi (`dev`, `prod`, `uat`).
    - Badge sub-teks entrypoint (mis. `main_dev.dart`).
- **Styling Item Terpilih:**
  - Background: `#1e2433` (subtle blue dark tint).
  - Border kiri: `3px solid #3574f0`.
  - Warna teks: `#ffffff` bold.

### 3.4 Spesifikasi Kolom Kanan (Detail Form Editor, Flex 1)
- **Field 1: Name**
  - Tipe: Text Input.
  - Label: `Name` (wajib diisi, tidak boleh duplikat dalam grup yang sama).
- **Field 2: Dart Entrypoint**
  - Tipe: Text Input + Tombol "Browse…" (`📂`).
  - Label: `Dart Entrypoint`.
  - Placeholder: `lib/main.dart`.
  - Validasi Live: Pengecekan apakah file ada di filesystem proyek. Jika ada: teks hijau `✓ File ditemukan di workspace`. Jika tidak ada: teks kuning/merah `⚠ File tidak ditemukan pada direktori proyek`.
- **Field 3: Additional Run Args**
  - Tipe: Text Input Monospace.
  - Label: `Additional Run Arguments`.
  - Placeholder: `--flavor dev --dart-define=ENV=dev`.
  - Helper note: *Parameter CLI yang diteruskan langsung ke perintah `flutter run`*.
- **Field 4: Build Flavor**
  - Tipe: Text Input.
  - Label: `Build Flavor (Opsional)`.
  - Placeholder: `dev`, `prod`, `staging`.
- **Footer Aksi Modal:**
  - Kiri: Teks muted dengan icon file: `Disimpan di .petak/run.json`.
  - Kanan:
    - Tombol `Batal` (`Esc`): Menutup modal tanpa menyimpan perubahan sementara.
    - Tombol `Terapkan` (`Apply`): Menyimpan ke `.petak/run.json` dan memperbarui `runStore` tanpa menutup modal.
    - Tombol `OK` (`Enter`): Menyimpan konfigurasi, memilihnya sebagai konfigurasi aktif di TitleBar runner, dan menutup modal.

### 3.5 Format Standar `.petak/run.json`
```json
{
  "version": 1,
  "default": "dev",
  "configurations": [
    {
      "name": "dev",
      "kind": "flutter",
      "entrypoint": "lib/main_dev.dart",
      "args": "--flavor dev --dart-define=ENV=dev",
      "flavor": "dev",
      "workingDir": ""
    },
    {
      "name": "prod",
      "kind": "flutter",
      "entrypoint": "lib/main_prod.dart",
      "args": "--flavor prod",
      "flavor": "prod",
      "workingDir": ""
    },
    {
      "name": "main_uat",
      "kind": "flutter",
      "entrypoint": "lib/main_uat.dart",
      "args": "--flavor uat",
      "flavor": "uat",
      "workingDir": ""
    }
  ]
}
```

---

## 4. Fitur 3: GitLab Create MR Form & MR Actions

### 4.1 Form Create Merge Request (`MrCreateModal.svelte`)

#### Wireframe ASCII Modal Buat MR (680px × 640px)
```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│  Buat Merge Request (GitLab)                                                       [✕] │
├────────────────────────────────────────────────────────────────────────────────────────┤
│  CABANG (BRANCHES)                                                                     │
│  Sumber (Source):                  Target:                                             │
│  [ 🌿 feat/phase4-run          ▼ ]  ➔  [ 🌿 main                                  ▼ ] │
│  ℹ️ 3 commit lebih maju dari main · Siap di-merge otomatis (tanpa konflik)             │
│                                                                                        │
│  JUDUL MERGE REQUEST                                                                   │
│  [ feat: implement b23 finishing welcome, run config & coder svg icons               ] │
│                                                                                        │
│  DESKRIPSI (MARKDOWN)                         [ Tulis ]  [ Pratinjau (Preview) ]       │
│  ┌──────────────────────────────────────────────────────────────────────────────────┐  │
│  │ ## Ringkasan Perubahan                                                           │  │
│  │ - Implementasi standalone welcome dashboard                                      │  │
│  │ - Penambahan dialog Edit Configurations ala JetBrains                            │  │
│  │ - Penambahan tombol aksi Approve, Merge, dan Rebase pada MR                      │  │
│  │                                                                                  │  │
│  │ ## Verifikasi                                                                    │  │
│  │ - [x] Automated tests PASS                                                       │  │
│  │ - [x] Verifikasi layout & kontras token                                          │  │
│  └──────────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                        │
│  PENUGASAN (METADATA)                                                                  │
│  Assignee:                             Reviewer:                                       │
│  [ 👤 syauqi.aditia (Saya)         ▼ ]  [ 👤 reviewer (QA Bot)                     ▼ ] │
│                                                                                        │
│  OPSI PENGGABUNGAN                                                                     │
│  [x] Hapus branch sumber setelah merge request disetujui (Delete source branch)        │
│  [x] Squash commit saat merge request disetujui (Squash commits)                       │
├────────────────────────────────────────────────────────────────────────────────────────┤
│                                                        [ Batal ]  [ 🚀 Buat MR (⌘Enter) ]│
└────────────────────────────────────────────────────────────────────────────────────────┘
```

#### Komponen & Interaksi Form Create MR:
1. **Branch Selector Row:**
   - Source branch: Dropdown yang otomatis terisi dengan *current active branch*.
   - Target branch: Dropdown cabang target (default: `main` atau `master`).
   - Indikator Status Cabang: Menguji apakah cabang divergen atau up-to-date. Menampilkan chip hijau `Siap di-merge` atau chip merah `Ada potensi konflik`.
2. **Title Field:**
   - Text input satu baris. Otomatis diisi dengan pesan commit terakhir dari branch sumber.
3. **Description Markdown Editor:**
   - Tab navigasi atas: `Tulis` (monospaced textarea) dan `Pratinjau` (rendered markdown dengan sanitasi tag HTML).
   - Menyediakan tombol cepat snippet template: `[+ Ringkasan]`, `[+ Checklist]`.
4. **Assignee & Reviewer Pickers:**
   - Dropdown dengan avatar inisial dan username tim.
5. **Aksi Tombol Submit:**
   - Tombol primer "Buat Merge Request" (`⌘Enter`).
   - Ketika proses pembuatan berlangsung: Tombol menampilkan spinner animasi dan status teks "Membuat MR…".

---

### 4.2 Pembaruan MR Details: Aksi Approve, Merge, Rebase & 3 Tab

#### Header Aksi MR (Action Bar)
Pada bagian atas ulasan MR (`MrDetail.svelte`), terdapat baris aksi primer yang terhubung langsung dengan backend GitLab REST API:

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ !42  feat: implement b23 finishing specs & icons                 [Open]  [Pipeline ✓]  │
│ Dibuka oleh @syauqi.aditia · 2 jam lalu · Target: main ➔ Sumber: feat/phase4-run       │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ [ ✓ Setujui (Approve) ]   [ 🔀 Merge Sekarang ▼ ]   [ 🔄 Rebase ]   [ 📥 Checkout (⌘⇧C) ]│
│ (1/2 Persetujuan)         • Pipeline lulus          • Up to date                       │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

#### Status & Logika Tombol Aksi:
1. **Tombol Approve (`onApprove` / `onUnapprove`):**
   - **State Belum Menyetujui:**
     - Tampilan: Tombol outline hijau dengan ikon centang perisai (`mr-approve.svg`), border `1px solid #7fc98f`, teks `#7fc98f`, background `#1a261e`.
     - Label: `✓ Setujui (Approve)`.
   - **State Sudah Menyetujui:**
     - Tampilan: Tombol solid hijau tegas, background `#238636`, teks `#ffffff`.
     - Label: `✓ Disetujui (Approved)`.
     - Hover State: Beralih sementara ke warna merah halus `#f07a74` dengan label `✕ Batalkan Persetujuan`.
   - **Approval Counter Pill:** Menampilkan informasi kuorum approval tim (misal `1/2 Approvals`).
2. **Tombol Merge (`onExecuteMerge`):**
   - Tombol utama dengan split dropdown.
   - **State Mergeable:**
     - Pipeline CI lolos (`success`): Tombol hijau solid `[ 🔀 Merge Sekarang ]`.
     - Pipeline CI masih berjalan (`running`): Tombol biru `[ ⏳ Merge saat Pipeline Lolos (MWPS) ]`.
   - **State Blocked (Guardrail):**
     - Jika token bernilai `read_api` (bukan `api`): Tombol dinonaktifkan dengan tooltip *"Diperlukan Personal Access Token dengan cakupan 'api' untuk melakukan merge"*.
     - Jika status `conflict` atau `cannot_be_merged`: Tombol merah/abu dinonaktifkan dengan teks *"Terhalang Konflik"*.
     - Jika status `draft`: Tombol dinonaktifkan dengan label *"MR Masih Berstatus Draft"*.
   - **Dropdown Options:**
     - *Merge standard*
     - *Squash and merge*
     - *Hapus branch sumber*
3. **Tombol Rebase (`onRebase`):**
   - Tombol aksi sekunder dengan icon panah melingkar (`mr-rebase.svg`).
   - Jika branch sumber tertinggal: Muncul badge kuning *"Tertinggal N commit dari main"*, tombol aktif.
   - Jika branch sudah up-to-date: Teks muted *"Sudah sejajar (Up to date)"*, tombol disabled.

#### Navigasi Tiga Tab (3-Tab Architecture)
Ulasan MR disusun ke dalam 3 tab yang terpisah jelas:
```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│  [ 💬 Discussion (4) ]     [ 📦 Commits (3) ]     [ 📝 Changes (12 berkas, +340 -28) ]  │
└────────────────────────────────────────────────────────────────────────────────────────┘
```
1. **Tab 1: Discussion (Overview):**
   - Ringkasan deskripsi MR dalam format markdown yang rapi.
   - Daftar thread review, inline comments pada baris kode, dan riwayat aktivitas tim.
   - Kotak balasan cepat (*Quick Reply*) di bagian bawah tiap thread.
2. **Tab 2: Commits:**
   - Tabel timeline commit yang termasuk dalam MR.
   - Menampilkan: Avatar author, pesan commit (1 baris), waktu relatif, dan pill SHA commit (7 karakter, misal `81d365a`) yang dapat diklik untuk menyalin SHA ke clipboard.
3. **Tab 3: Changes:**
   - Layout 2 kolom: Daftar berkas berubah di sisi kiri (tree/list dengan badge `M`, `A`, `D` dan angka `+N -M`), dan *Synchronized Side-by-Side Diff Viewer* di sisi kanan.

---

## 5. Fitur 4: Tool Windows Quick Menu (Rail Kiri)

### 5.1 Alasan Perubahan Desain
Tombol matahari (theme toggle) yang sebelumnya diletakkan di bagian bawah Rail kiri (`Rail.svelte`) kurang fungsional untuk alur kerja developer profesional, karena pengaturan tema sudah tersedia di Welcome Dashboard dan Settings (`⌘,`). 

Tombol ini digantikan oleh tombol **"Tool Windows"** dengan ikon *multi-docking drawer layout* (`tool-windows.svg`).

### 5.2 Wireframe Interaksi Popover Tool Windows

```
┌──────┬───────────────────────────────────────────┐
│ Rail │  Menu Popover Tool Windows (Lebar 220px)   │
├──────┤                                           │
│ [📁] │  PANEL UTAMA                              │
│ [🌿] │  [1] 📁 Project Explorer         (⌘1)     │
│ [🔀] │  [2] 🌿 Git Source Control       (⌘2)     │
│ [✨] │  [3] 🔀 GitLab Merge Requests    (⌘5)     │
│ [📱] │  [4] ✨ AI Agents Panel          (⌘6)     │
│      │  [5] 📱 Device Mirror Dock       (⌘⇧D)    │
│      │ ───────────────────────────────────────── │
│      │  PANEL BAWAH                              │
│ [🗔] │  [T] 💻 Terminal                 (⌃`)     │  <-- Klik tombol Tool Windows di rail
│ [⚙️] │  [R] ⚡ Run / Build Output       (⌘4)     │      membuka menu flyout cepat ini
└──────┤  [L] 📋 Logcat Device Logs                │
       │  [P] ⚠️ Problems & Diagnostics            │
       └───────────────────────────────────────────┘
```

### 5.3 Spesifikasi Interaksi:
- **Shortcut:** `⌘0` atau klik ikon Tool Windows pada rail.
- **Perilaku Toggle:** Memilih salah satu item langsung membuka/menutup panel yang bersangkutan, dan otomatis menutup popover menu.
- **Aria Label & Keyboard Access:**
  - Tombol Rail: `aria-label="Tool Windows Quick Menu"`, `aria-haspopup="true"`.
  - Menu Items: Dapat dinavigasikan menggunakan panah `↑`/`↓` dan `Enter` atau menekan tombol angka/huruf pintasan langsung (`1`, `2`, `3`, `4`, `5`, `T`, `R`, `L`, `P`).

---

## 6. Fitur 5: Koleksi Custom Minimalist Coder SVG Icons

Seluruh ikon dirancang dengan standar kualitas tinggi pengembang:
- **Grid Standar:** `24x24` viewBox (tetap tajam sempurna pada ukuran 14px, 16px, 18px, 20px, dan 24px).
- **Atribut Visual:** `fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"`.
- **Lokasi Berkas:** Tersedia sebagai berkas mandiri di `ui/icons/*.svg` dan diekspor dalam `ui/icons/index.ts`.

### 6.1 Tabel Spesifikasi & Kode SVG

| No | Nama Ikon | Nama File SVG | Deskripsi Visual & Penggunaan |
|---|---|---|---|
| 1 | **Android Emulator** | `android-emulator.svg` | Siluet frame Android ramping dengan antena mini dan home pill. Digunakan pada device picker TitleBar, Devices panel, dan runner. |
| 2 | **iOS Simulator** | `ios-simulator.svg` | Siluet iPhone modern dengan bezel tipis dan Dynamic Island pill atas. Digunakan pada pemilih simulator iOS. |
| 3 | **Physical Device USB** | `device-usb.svg` | Smartphone dengan konektor kabel USB-C tertancap di sisi bawah. Digunakan untuk perangkat fisik Android/iPhone via kabel. |
| 4 | **Physical Device Wi-Fi** | `device-wifi.svg` | Smartphone dengan sinyal pancaran gelombang Wi-Fi di kanan atas. Digunakan untuk debugging nirkabel mDNS/TCP. |
| 5 | **Tool Windows** | `tool-windows.svg` | Layout 3-pane docking (rail kiri, canvas editor, dock bawah). Menggantikan ikon matahari di rail navigasi kiri. |
| 6 | **Toolchain Flutter** | `toolchain-flutter.svg` | Burung Flutter siluet 2-chevron geometris presisi. Digunakan di Petak Doctor, Welcome cards, dan run config. |
| 7 | **Toolchain Dart** | `toolchain-dart.svg` | Sayap panah layang Dart geometris tajam. Digunakan pada entrypoint selector dan Doctor. |
| 8 | **Toolchain Java / JDK** | `toolchain-java.svg` | Cangkir kopi developer minimalis dengan gelombang uap elegan. Digunakan pada diagnostik JDK di Doctor. |
| 9 | **Toolchain Android** | `toolchain-android.svg` | Kepala robot Bugdroid minimalis dengan 2 antena dan 2 mata. Digunakan pada grup konfigurasi Gradle dan Android SDK. |
| 10 | **Toolchain Xcode** | `toolchain-xcode.svg` | Palu rekayasa bersilang dengan penggaris blueprint arsitektur. Digunakan pada toolchain macOS Xcode/Swift. |
| 11 | **MR Approve** | `mr-approve.svg` | Perisai verifikasi dengan centang persetujuan kode. Digunakan pada tombol Approve di bar aksi MR. |
| 12 | **MR Merge** | `mr-merge.svg` | Titik simpul penggabungan cabang Git branch. Digunakan pada tombol aksi Merge MR. |
| 13 | **MR Rebase** | `mr-rebase.svg` | Rantai commit linier dengan panah sinkronisasi branch. Digunakan pada tombol aksi Rebase MR. |

### 6.2 Markup Lengkap SVG Siap Pakai

#### 1. Android Emulator (`ui/icons/android-emulator.svg`)
```xml
<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <rect x="5" y="4" width="14" height="17" rx="2.5"></rect>
  <line x1="8.5" y1="1.5" x2="10" y2="4"></line>
  <line x1="15.5" y1="1.5" x2="14" y2="4"></line>
  <line x1="5" y1="7.5" x2="19" y2="7.5"></line>
  <line x1="10" y1="18.5" x2="14" y2="18.5"></line>
</svg>
```

#### 2. iOS Simulator (`ui/icons/ios-simulator.svg`)
```xml
<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <rect x="5" y="2.5" width="14" height="19" rx="3.5"></rect>
  <rect x="10" y="4.5" width="4" height="1.5" rx="0.75" fill="currentColor" stroke="none"></rect>
  <line x1="9.5" y1="19" x2="14.5" y2="19"></line>
</svg>
```

#### 3. Real Device USB (`ui/icons/device-usb.svg`)
```xml
<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <rect x="6" y="2" width="12" height="15" rx="2.5"></rect>
  <line x1="10" y1="4.5" x2="14" y2="4.5"></line>
  <rect x="10" y="17" width="4" height="2.5" rx="0.5"></rect>
  <path d="M12 19.5v2.5"></path>
</svg>
```

#### 4. Real Device Wi-Fi (`ui/icons/device-wifi.svg`)
```xml
<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <rect x="4" y="5" width="11" height="16" rx="2.5"></rect>
  <line x1="8" y1="7.5" x2="11" y2="7.5"></line>
  <line x1="8" y1="18.5" x2="11" y2="18.5"></line>
  <path d="M16 4a5 5 0 0 1 5 5"></path>
  <path d="M16 7a2.5 2.5 0 0 1 1.8 1.8"></path>
  <circle cx="16" cy="10" r="0.75" fill="currentColor"></circle>
</svg>
```

#### 5. Tool Windows Rail (`ui/icons/tool-windows.svg`)
```xml
<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <rect x="3" y="3" width="18" height="18" rx="2"></rect>
  <line x1="8" y1="3" x2="8" y2="21"></line>
  <line x1="8" y1="15" x2="21" y2="15"></line>
</svg>
```

#### 6. Toolchain Flutter (`ui/icons/toolchain-flutter.svg`)
```xml
<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <path d="M13.5 2.5L4 12l2.8 2.8L19.5 2.5h-6z"></path>
  <path d="M13.5 13.5l-4.7 4.7L11.6 21l7.5-7.5h-5.6z"></path>
  <path d="M9.8 17.2l2.8-2.8 2.8 2.8-2.8 2.8-2.8-2.8z"></path>
</svg>
```

#### 7. Toolchain Dart (`ui/icons/toolchain-dart.svg`)
```xml
<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <path d="M4.5 13.5L13.5 4.5h6v6L10.5 19.5H4.5v-6z"></path>
  <line x1="8.5" y1="9.5" x2="13.5" y2="4.5"></line>
  <line x1="10.5" y1="15.5" x2="15.5" y2="10.5"></line>
</svg>
```

#### 8. Toolchain Java / JDK (`ui/icons/toolchain-java.svg`)
```xml
<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <path d="M4 9h12v7a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V9z"></path>
  <path d="M16 11h2a2 2 0 0 1 2 2v1a2 2 0 0 1-2 2h-2"></path>
  <line x1="3" y1="21" x2="19" y2="21"></line>
  <path d="M8 3c-.5 1 .5 2 0 3"></path>
  <path d="M12 3c-.5 1 .5 2 0 3"></path>
</svg>
```

#### 9. Toolchain Android (`ui/icons/toolchain-android.svg`)
```xml
<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <path d="M4 14a8 8 0 0 1 16 0H4z"></path>
  <line x1="7" y1="6" x2="8.5" y2="8.5"></line>
  <line x1="17" y1="6" x2="15.5" y2="8.5"></line>
  <circle cx="9" cy="11.5" r="1" fill="currentColor"></circle>
  <circle cx="15" cy="11.5" r="1" fill="currentColor"></circle>
  <line x1="4" y1="16.5" x2="20" y2="16.5"></line>
</svg>
```

#### 10. Toolchain Xcode (`ui/icons/toolchain-xcode.svg`)
```xml
<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <path d="M15 3l6 6-2 2-6-6 2-2z"></path>
  <path d="M13 5L4 14l2 2 9-9"></path>
  <path d="M3 21l3-1 1-3-3-3-1 3-1 3 1 1z"></path>
  <line x1="14" y1="16" x2="19" y2="21"></line>
  <line x1="19" y1="16" x2="14" y2="21"></line>
</svg>
```

#### 11. MR Action Approve (`ui/icons/mr-approve.svg`)
```xml
<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
  <path d="M9 12l2 2 4-4"></path>
</svg>
```

#### 12. MR Action Merge (`ui/icons/mr-merge.svg`)
```xml
<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <circle cx="6" cy="6" r="3"></circle>
  <circle cx="6" cy="18" r="3"></circle>
  <circle cx="18" cy="12" r="3"></circle>
  <line x1="6" y1="9" x2="6" y2="15"></line>
  <path d="M6 9a9 9 0 0 0 9 6h0"></path>
</svg>
```

#### 13. MR Action Rebase (`ui/icons/mr-rebase.svg`)
```xml
<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  <circle cx="6" cy="5" r="2.5"></circle>
  <circle cx="6" cy="12" r="2.5"></circle>
  <circle cx="6" cy="19" r="2.5"></circle>
  <line x1="6" y1="7.5" x2="6" y2="9.5"></line>
  <line x1="6" y1="14.5" x2="6" y2="16.5"></line>
  <path d="M13 9l3-3 3 3"></path>
  <path d="M16 6v10a2 2 0 0 1-2 2h-4"></path>
</svg>
```

---

## 7. Desain Sistem & Token Styling (CSS Variables)

Semua komponen baru wajib mematuhi token CSS yang sudah digunakan di Petak:

```css
:root {
  /* Latar Belakang (Surfaces) */
  --bg-deepest: #111215;      /* Rail kiri, TitleBar, StatusBar */
  --bg-canvas: #16171a;       /* Area kerja utama, Welcome Stage */
  --bg-surface: #1c1d22;      /* Kartu, form editor, background dialog */
  --bg-surface-hover: #23252b;/* State hover pada item list & kartu */
  --bg-surface-active: #2a2c35;/* State aktif/terpilih */

  /* Border & Garis Pembatas */
  --border-subtle: #26282d;   /* Garis pemisah antar panel & kartu */
  --border-strong: #363940;   /* Border input & button outline */
  --border-focus: #3574f0;    /* Fokus keyboard & seleksi aktif */

  /* Tipografi & Warna Teks */
  --text-primary: #e6e7ea;    /* Kontras > 7:1 terhadap canvas */
  --text-secondary: #8b8f98;  /* Kontras > 4.5:1 terhadap canvas */
  --text-muted: #5b5f68;      /* Placeholder & teks pelengkap */

  /* Aksen Warna Status (Semantic) */
  --accent-blue: #3574f0;     /* Tombol primer, fokus, runner */
  --accent-blue-hover: #4884f8;
  --accent-green: #7fc98f;    /* State Ready, Approve, Pipeline Sukses */
  --accent-green-bg: #1a261e;
  --accent-yellow: #e8b45a;   /* State Warning, Perlu Rebase */
  --accent-yellow-bg: #2e2717;
  --accent-red: #f07a74;      /* State Error, Conflict, Revoke */
  --accent-red-bg: #3d1a1c;
  --accent-purple: #c792ea;   /* Tag Git Branch & Pills */

  /* Corner Radius Scale */
  --radius-sm: 4px;           /* Badges & dropdown items */
  --radius-md: 6px;           /* Input fields & action buttons */
  --radius-lg: 10px;          /* Cards & popover menus */
  --radius-xl: 12px;          /* Modal dialogs */
}
```

---

## 8. Tabel Lokalisasi & Copywriting (ID & EN)

| Kunci / Konteks | Teks Bahasa Indonesia (ID) | Teks Bahasa Inggris (EN) |
|---|---|---|
| **Welcome Dashboard** | | |
| `welcome.title` | Petak Starting Point | Petak Starting Point |
| `welcome.hero_sub` | Native Flutter & Mobile Engineering IDE Ringan & Cepat | Fast, lightweight native Flutter & mobile engineering IDE |
| `welcome.act_open` | Buka Folder… | Open Folder… |
| `welcome.act_open_desc` | Buka workspace Flutter atau native dari disk | Open an existing Flutter, Android, or mobile workspace from disk |
| `welcome.act_new` | Buat Proyek Baru… | Create New Project… |
| `welcome.act_new_desc` | Panduan membuat Flutter app atau modul baru | Generate a clean Flutter app, Dart package, or native module |
| `welcome.act_clone` | Clone Repositori Git… | Clone Git Repository… |
| `welcome.act_clone_desc` | Clone repository dari GitLab Bank Jatim atau GitHub | Clone repository from Bank Jatim GitLab or GitHub |
| `welcome.recents_title` | Proyek Terakhir | Recent Projects |
| `welcome.search_placeholder` | Filter proyek terakhir… (↑↓ Enter, ⌘F) | Filter recent projects… (↑↓ Enter, ⌘F) |
| `welcome.empty_recents` | Belum ada riwayat proyek. Pilih Buka Folder untuk memulai! | No recent workspaces found. Click Open Folder to begin! |
| **Run Configurations** | | |
| `run_config.title` | Konfigurasi Run/Debug | Run/Debug Configurations |
| `run_config.edit_item` | Edit Konfigurasi… | Edit Configurations… |
| `run_config.name_label` | Nama Konfigurasi | Configuration Name |
| `run_config.entrypoint_label` | Target Entrypoint Dart | Dart Entrypoint Target |
| `run_config.args_label` | Argumen Eksekusi Tambahan | Additional Run Arguments |
| `run_config.flavor_label` | Build Flavor | Build Flavor |
| `run_config.valid_file` | File ditemukan di workspace | File found in workspace |
| `run_config.missing_file` | File tidak ditemukan di workspace | File not found in workspace |
| `run_config.apply` | Terapkan | Apply |
| `run_config.stored_notice` | Disimpan di .petak/run.json | Stored in .petak/run.json |
| **GitLab MR Actions** | | |
| `mr.create_title` | Buat Merge Request Baru | Create New Merge Request |
| `mr.source_branch` | Cabang Sumber | Source Branch |
| `mr.target_branch` | Cabang Target | Target Branch |
| `mr.title_input` | Judul Merge Request | Merge Request Title |
| `mr.desc_input` | Deskripsi (Markdown) | Description (Markdown) |
| `mr.del_source_chk` | Hapus branch sumber setelah di-merge | Delete source branch when merge request is accepted |
| `mr.squash_chk` | Squash commit saat merge | Squash commits when merge request is accepted |
| `mr.btn_create` | Buat Merge Request | Create Merge Request |
| `mr.btn_approve` | Setujui (Approve) | Approve |
| `mr.btn_approved` | Disetujui (Approved) | Approved |
| `mr.btn_revoke` | Batalkan Persetujuan | Revoke Approval |
| `mr.btn_merge` | Merge Sekarang | Merge |
| `mr.btn_mwps` | Merge saat Pipeline Lolos | Merge When Pipeline Succeeds |
| `mr.btn_rebase` | Rebase Cabang | Rebase Branch |
| `mr.tab_discussion` | Diskusi | Discussion |
| `mr.tab_commits` | Daftar Commit | Commits |
| `mr.tab_changes` | Perubahan Berkas | Changes |
| **Tool Windows Rail** | | |
| `rail.tool_windows` | Menu Panel (Tool Windows) | Tool Windows Menu |

---

## 9. Panduan Handoff & Acceptance Criteria untuk @senior2

### 9.1 Berkas yang Disentuh / Diimplementasikan oleh Senior2:
1. `ui/App.svelte`: Menyesuaikan routing `showDashboard = !currentFolderPath || isDashboardOpen` agar tidak me-render `<Rail />`, toolbar run TitleBar, StatusBar, dan DeviceMirror dock saat di dashboard.
2. `ui/shell/TitleBar.svelte`: Menambahkan tombol gear mini di sebelah `RunConfigPicker` untuk membuka dialog Edit Configurations.
3. `ui/features/run/RunConfigPicker.svelte`: Menambahkan item menu `Edit Configurations… (⌘⇧E)` pada dropdown.
4. `ui/features/run/RunConfigModal.svelte`: Komponen modal baru untuk dialog Run/Debug Configurations (2 kolom ala JetBrains).
5. `ui/features/mr/MrCreateModal.svelte`: Komponen modal baru untuk membuat MR GitLab.
6. `ui/features/mr/MrDetail.svelte`: Menambahkan tombol aksi `Approve`, `Merge`, dan `Rebase` di sub-header, serta 3 tab navigation (`Discussion`, `Commits`, `Changes`).
7. `ui/shell/Rail.svelte`: Mengganti tombol matahari dengan tombol `Tool Windows` dan menyambungkannya ke popover toggle panel.
8. `ui/icons/`: Memanfaatkan aset SVG dari `ui/icons/*.svg` dan `ui/icons/index.ts` untuk device picker, toolchain, dan toolbar.

### 9.2 Acceptance Criteria Verifikasi Desain:
- [x] Spesifikasi desain lengkap dan terstruktur rapi pada `docs/phase4/b23_design_specs.md`.
- [x] Seluruh 13 aset SVG valid (well-formed XML, atribut `viewBox="0 0 24 24"`, `stroke="currentColor"`, skalabel).
- [x] Aset SVG tersedia langsung di `ui/icons/*.svg` dan `ui/icons/index.ts`.
- [x] Seluruh alur kerja UI dirancang sesuai standar tema gelap JetBrains Petak IDE dan prinsip Ponytail.
