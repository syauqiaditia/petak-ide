# Petak Batch 23: Complete IDE Polish & Finishing (Welcome Standalone, Doctor Real-Scan, Search UX, Sync Diff, Run Config Dialog, GitLab MR Actions, Tool Windows Rail & Coder SVG Icons)

## Latar Belakang & 8 Permintaan Finishing UQi
Sebelum melangkah ke tahap Agentic Orchestrator, UQi meminta 8 penyempurnaan utama pada Petak IDE agar pengalaman coding mobile setara/melebihi Android Studio:

### 1. Standalone Welcome Dashboard (Halaman Bersih Tanpa Shell IDE)
- Saat aplikasi dibuka tanpa project (atau project ditutup), tampilkan HANYA Welcome Dashboard 2-kolom bersih ("Welcome to Xcode/Android Studio style").
- DILARANG menampilkan dock Mirror Device di kanan, toolbar run di atas, status bar di bawah, atau rail editor saat di dashboard.
- Baru masuk ke workspace IDE lengkap saat folder dibuka / project dipilih.

### 2. Petak Doctor Real Toolchain Scanner & Pindai Ulang
- Di `img_5228c7df13b5.png`, Flutter SDK, Dart SDK, JDK terdeteksi Missing padahal sudah terpasang.
- Tombol "Pindai Ulang" sebelumnya tidak meng-update deteksi secara live.
- Scanner Rust core & UI harus memeriksa standard paths macOS (`/opt/homebrew/bin`, `~/SDK/flutter/bin`, `~/.flutter`, `/Library/Java/JavaVirtualMachines`, dll) dan mengeksekusi shell probe jika PATH minimal GUI.
- Klik "Pindai Ulang" wajib memicu scanning IPC ulang dan langsung meng-update UI state indikator secara reaktif.

### 3. Search Everywhere UX (Nama File Menonjol, Path Sekunder)
- Di `img_8c35d46e1d9c.png`, hasil search Shift-Shift menampilkan full path panjang yang membingungkan.
- Ubah format item search ala JetBrains/VS Code:
  * Judul utama (teks besar/bold): **Nama file saja** (contoh: `main.dart`, `GoogleService-Info.plist`).
  * Subtitle / badge samping (teks muted abu-abu kecil): **Direktori induk / path relatif** (contoh: `lib/`, `ios/Runner/`).
  * Match highlighting fokus pada nama file.

### 4. Side-by-Side Diff Viewer: Sync Scroll & Alignment
- Di `img_c815dabea5b1.png` vs `img_06572948b7cd.png` (Android Studio):
  * Tambahkan sinkronisasi scroll horizontal dan vertikal antara panel kiri (original) dan panel kanan (modified). Saat panel kiri digeser, panel kanan ikut bergeser secara proporsional.
  * Line-by-line alignment: baris kosong pengisi (spacer) disisipkan pada penambahan/penghapusan baris agar baris yang cocok selalu sejajar horizontal.
  * Dukung horizontal scrolling dengan scrollbar agar kode yang panjang tidak terpotong.

### 5. Run/Debug Configurations Dialog ("Edit Configurations...")
- Sesuai `img_5b6cf8c2f695.png` (JetBrains Run/Debug Configurations dialog):
  * Tambahkan dialog modal "Edit Configurations..." yang dibuka dari gear / tombol di sebelah selector config run.
  * Kolom kiri: Daftar target run Flutter (`dev`, `prod debug`, `main_uat`, dll) dengan tombol `+` (Add), `-` (Remove), Copy.
  * Kolom kanan (form editor):
    - Name (contoh: `dev`)
    - Dart entrypoint (contoh: `lib/main_dev.dart` dengan picker file)
    - Additional run args (contoh: `--flavor dev`)
    - Build flavor (opsional)
  * Tombol OK / Cancel / Apply yang menyimpan langsung ke `.petak/run.json` dan memperbarui dropdown selector di TitleBar.

### 6. GitLab Merge Request: Create MR, Commits/Changes Diff, Approve, Merge & Rebase
- Pada panel Merge Request:
  * Tombol "Create Merge Request" (`+`):
    - Pilihan Source Branch & Target Branch
    - Input Title & Markdown Description
    - Pilihan Assignee & Reviewer
    - Checkbox "Delete source branch when merged"
  * Pada MR Details:
    - Tab Discussion/Overview, Tab Commits list, Tab Changes (file changes diff)
    - Tombol aksi: Approve, Merge, dan Rebase.

### 7. Rail Quick Menu: Ganti Tombol Theme dengan "Tool Windows"
- Di `img_b298d4de6d77.png`, ganti icon matahari (theme toggle) di bawah rail kiri dengan icon "Tool Windows" / panel drawer.
- Klik icon ini membuka menu popup cepat untuk toggle panel bawah (Terminal, Run, Logcat, Problems, Git, Devices).

### 8. Custom Minimalist Coder SVG Icons (Tugas Khusus Designer)
- Ganti icon-icon kasar/default dengan icon custom bergaya minimalis, elegan, dan bernuansa coder/developer:
  * Android Emulator (siluet robot/frame presisi)
  * iOS Simulator (siluet iPhone bezel tipis elegan)
  * Real Physical Device (kabel USB + phone, Wi-Fi phone)
  * Toolchain icons & rail action icons.

## Aturan Arsitektur & Peran Tim
- `designer`: Mendesain spesifikasi visual untuk:
  1. Welcome Dashboard standalone
  2. Dialog Edit Configurations (ala JetBrains)
  3. Form Create MR & aksi Approve/Merge/Rebase
  4. Koleksi SVG icons minimalis coder (Emulator, Simulator, Real Device USB/Wi-Fi, Tool Windows).
- `senior` (Rust core):
  1. Toolchain scanner path probe & re-scan IPC
  2. GitLab MR client endpoints (create MR, approve, merge, rebase)
- `senior2` (UI Svelte 5 / TS):
  1. Welcome Dashboard standalone routing
  2. Petak Doctor re-scan wiring
  3. Search Everywhere file-first formatter
  4. Side-by-side diff synchronized scrolling & spacer alignment
  5. Edit Configurations modal dialog & `.petak/run.json` persistence
  6. MR UI dialog & tabs
  7. Rail Tool Windows button & menu
  8. Implementasi icon SVG dari designer.
- `reviewer`: QA & verifikasi seluruh fitur, automated tests PASS.
- `techlead`: Verifikasi, build native Mac M2, dan deploy ke `/Applications/Petak.app`.

## Kriteria Selesai
1. Welcome screen tampil bersih tanpa frame IDE/dock mirror.
2. Petak Doctor mendeteksi toolchain dengan akurat dan tombol "Pindai Ulang" berfungsi live.
3. Search Everywhere menampilkan nama file sebagai teks utama dan path sebagai subtitle.
4. Diff view scroll tersinkronisasi horizontal & vertikal.
5. Modal Edit Configurations ala JetBrains berfungsi penuh menyimpan ke `run.json`.
6. GitLab MR mendukung Create, Commits, Changes diff, Approve, Merge, Rebase.
7. Icon bawah rail membuka menu Tool Windows.
8. Seluruh icon device & toolbar menggunakan SVG baru yang minimalis dan elegan.
9. 100% tests PASS (Rust & UI).
10. Build dan deploy Petak.app di Mac M2.
