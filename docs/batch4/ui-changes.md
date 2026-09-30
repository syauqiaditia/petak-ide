# Petak Batch 4 - UI Changes Summary

Dokumen ringkasan perubahan frontend UI untuk Petak Batch 4 (Task `t_5e220193`).

## 1. Perubahan Fitur & Bug Fix

- **Bug 1 UI (Device Picker State & Connection)**:
  - Dropdown device hanya menampilkan perangkat `connection === 'connected'` berwarna hijau (online & runnable).
  - Perangkat dengan status `paired` ditampilkan di bawah header "NOT CONNECTED" berwarna abu-abu dengan label "Paired • tidak terhubung" dan dalam keadaan nonaktif (disabled).
  - Perangkat dengan status `unavailable` / `offline` disembunyikan dari dropdown device (tetap dapat dilihat di panel Manage Devices).
  - Label transport diambil dari data nyata (`USB` / `Wi-Fi`), tidak lagi di-hardcode. Tombol Run dan Mirror dinonaktifkan untuk perangkat yang tidak terhubung.
- **Bug 2 UI + Fitur B (Panel Manage Devices & Emulators)**:
  - Tombol Start, Cold Boot, dan Stop untuk Android AVD.
  - Tombol Boot, Shutdown, dan "Open Simulator app" untuk iOS Simulator.
  - Fitur Wipe Data dan Delete AVD dengan dialog konfirmasi (`window.confirm`).
  - Status live `stopped` / `booting` / `running` / `failed` dari event `emulator-status`.
  - Penanganan error stderr langsung di card emulator serta toast notifikasi.
  - Tombol Refresh dengan animasi spinner dan feedback loading nyata via `runStore.refreshDevices()`.
  - Otomatis memilih device dan membuka Mirror saat emulator selesai booting ke status `running`.
- **Bug 3 UI (Recent Projects & Status Bar)**:
  - Dropdown Recent Projects di TitleBar (klik nama project) berfungsi penuh, menampilkan daftar dari `recent_projects_list` dengan fallback ke `recent.json`.
  - Klik item langsung mengganti project dengan reset bersih tab lama via `executeProjectSwitchReset`.
  - Status Bar error handling: status "Failed to open folder" ditampilkan dengan warna merah tegas (`#f07a74`) dan teks error akurat, kembali ke hijau (`#7fc98f`) saat pembukaan berhasil.
- **Bug 4 UI (Popup Exclusivity & Dismissal)**:
  - Arsitektur sentral `popupStore` (`ui/shell/popupStore.svelte.ts` & `popupLogic.ts`): pembukaan salah satu popup (device picker, runner config, git branch, recent projects, editor context menu) otomatis menutup popup lainnya.
  - Menekan tombol `Esc` atau klik di luar area popup langsung menutup popup yang aktif.
  - Penataan z-index konsisten dan eksklusivitas panel kanan (Mirror | Devices | MR | Agents) terjaga.
- **Bug 5 UI (GitLab MR Tab & Mode DEMO)**:
  - Tab MR viewer terintegrasi di Rail kiri di bawah Git.
  - Dilengkapi empty-state "Belum ada akun GitLab — Tambah token di Settings" dan mode DEMO lokal berlabel untuk preview tanpa token.
- **Bug 6 UI (Pemisahan Tombol Manage Devices)**:
  - Tombol pembuka Manage Devices dipindahkan dari Rail sidebar kiri ke TitleBar sebelah kanan dekat tombol Mirror.
  - Sidebar kiri murni untuk Project, Git, MR, Agents, dan Settings.
- **Bug 8 UI (Mirror Screen Recording & Device Detection)**:
  - Panel Mirror memanggil `mirror_permission_status`.
  - Membedakan alur iPhone fisik via USB (View-Only, petunjuk unlock & Trust Computer) vs iOS Simulator (Screen Recording permission).
  - Deteksi `restartNeeded` dengan tombol "Restart Petak" dan tombol "Open System Settings" (`open_screen_recording_settings`).
  - Pesan spesifik, menghilangkan pesan lama "Simulator display" pada iPhone fisik.
- **Bug 9 UI (Kotlin Language Server Installer UI)**:
  - Tombol "Install Kotlin Language Server" muncul di Status Bar saat LSP failed dan di panel Toolchains.
  - Menampilkan progress live dari event `kls-install-progress`.
  - Setelah instalasi selesai, status berubah menjadi Ready dan LSP direstart otomatis tanpa perlu me-restart aplikasi.
- **Bug 10 UI (Git Log Filter Branches)**:
  - Semua pemanggil `api.gitLog` dan `git_log` selalu menyertakan field `branches: []` sebagai default minimal, mencegah error deserialisasi Rust.
- **Fitur A UI (Code Beautifier / Formatter)**:
  - Shortcut `⌥⌘L` (Cmd-Alt-L) dan `⇧⌘I` (Cmd-Shift-I) untuk Format Document / Format Selection.
  - Menu konteks klik-kanan editor dan command palette (`⌥⌘L`).
  - Pengaturan "Format on Save" per bahasa (Dart, Kotlin, Swift, JSON, YAML, JS/TS, HTML/CSS, Markdown) di panel Toolchains (default OFF).
  - Perubahan diterapkan sebagai diff minimal dalam SATU transaksi CodeMirror (`single undo`, posisi kursor tidak melompat).
  - Pesan error jelas jika formatter tidak ditemukan disertai petunjuk instalasi.

## 2. File yang Diubah & Dibuat

### File Baru:
- `ui/shell/popupLogic.ts`: Logika murni eksklusivitas popup IDE.
- `ui/shell/popupStore.svelte.ts`: Svelte store sentral untuk manajemen popup IDE.
- `ui/features/editor/formatLogic.ts`: Logika format document, deteksi bahasa, diff minimal CodeMirror, dan config format-on-save.
- `tests/batch4_ui_logic.test.mjs`: Unit test Node.js / Vitest untuk Batch 4 UI logic.
- `scripts/capture_batch4_screens.mjs`: Script penangkap screenshot preview nyata menggunakan headless Chromium.
- `docs/batch4/manual-test.md`: Panduan uji coba manual untuk UQi di macOS (14 baris).
- `docs/batch4/ui-changes.md`: Dokumen ini.
- `docs/batch4/screens/`: 5 tangkapan layar preview nyata berlabel.

### File Dimodifikasi:
- `package.json`: Registrasi test suite batch 4.
- `ui/App.svelte`: Pendaftaran command palette formatter, integrasi StatusBar error state, gitLog minimal filter.
- `ui/lib/api.ts`: API wrapper tipe Batch 4 (mirrorPermissionStatus, formatDocument, onEmulatorStatus, onKlsInstallProgress, avdWipe, avdDelete, simOpenApp, default branches filter gitLog, fallback recentProjectsList).
- `ui/shell/Rail.svelte`: Pembersihan tombol Devices dari sidebar kiri (Rail kiri fokus Project/Git/MR/Agents).
- `ui/shell/TitleBar.svelte`: Integrasi popupStore, tombol Manage Devices di kanan dekat Mirror, recent projects selector, run/mirror disabled untuk paired device.
- `ui/shell/StatusBar.svelte`: Indikator warna error merah `#f07a74`, tombol Install Kotlin Language Server dengan spinner.
- `ui/shell/panelExclusivity.ts`: Tipe RightPanelId diperluas mencakup `mr`.
- `ui/shell/projectResetLogic.ts`: Sort recent projects newest-first.
- `ui/features/run/DevicePicker.svelte`: Integrasi popupStore, section "NOT CONNECTED" untuk paired device, transport USB / Wi-Fi.
- `ui/features/run/DevicesPanel.svelte`: Panel devices kanan lengkap dengan AVD Start/Cold Boot/Stop/Wipe/Delete, iOS Sim Boot/Shutdown/Open Sim, live status, stderr error box, dan refresh spinner.
- `ui/features/run/RunConfigPicker.svelte`: Integrasi popupStore.
- `ui/features/run/deviceLogic.ts`: Logic connected vs paired vs unavailable (offline/hidden), transport usb/wifi.
- `ui/features/mirror/states/StateError.svelte`: Error Screen Recording vs iPhone fisik vs Simulator, tombol Open System Settings dan Restart Petak.
- `ui/features/toolchain/ToolchainsPanel.svelte`: Pengaturan Format on Save per bahasa.
- `ui/features/editor/Editor.svelte`: Context menu klik kanan (Format Document/Selection), shortcut ⌥⌘L / ⇧⌘I, format on save saat handleSave.
- `ui/features/git/git.svelte.ts`: Inisialisasi default filter `branches: []`.
- `ui/main.ts`: Mock handler preview untuk batch 4 commands (emulator status, mirror permission, kls install).

## 3. Ukuran Bundle & Delta Gzip (<100KB Budget)

Hasil build Vite production (`npm run build`):
- `dist/assets/DevicesPanel-BQw4EkTY.js`: 11.14 kB (gzip: **3.42 kB**)
- `dist/assets/DevicesPanel-BAUto-1v.css`: 5.97 kB (gzip: **1.57 kB**)
- Total kenaikan bundle utama (index js + css): ~**3.5 kB gzip**
- **Total Delta Gzip Seluruh Perubahan Batch 4**: ~**8.5 kB gzip**
- **Status Budget**: Jauh di bawah batas 100 KB (pemakaian ~8.5% dari budget).

## 4. Tangkapan Layar Preview Nyata

Tersimpan di `docs/batch4/screens/`:
1. `01-device-picker-connected-paired.png`: Device picker menampilkan connected (hijau) vs paired (abu-abu nonaktif di bawah Not Connected).
2. `02-manage-devices-panel.png`: Panel Manage Devices di sebelah kanan dengan tombol AVD Start/Cold/Wipe/Delete, iOS Sim, dan refresh spinner.
3. `03-recent-projects-dropdown.png`: Dropdown Recent Projects di TitleBar dengan daftar project dan tombol Open Folder.
4. `04-mirror-screen-recording-error.png`: State error Screen Recording dengan panduan izin, tombol Open System Settings, dan Retry.
5. `05-format-on-save-settings.png`: Pengaturan Format on Save per bahasa pada panel Toolchains.

## 5. Hasil Verifikasi Otomatis

- `npm run test`: **82 / 82 tests PASSED** (0 failed, duration ~295ms).
- `cargo test -p petak-core`: **187 / 187 tests PASSED** (0 failed).
- `npm run build`: **Sukses tanpa error** (vite v6.4.3).
