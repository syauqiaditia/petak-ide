# Petak: Native macOS System Menu Bar & Clean TitleBar Window + Dashboard V2

## 1. Masalah yang Dilaporkan UQi
UQi mengirim foto menu bar atas macOS (di samping logo Apple  dan nama Petak) dan menyampaikan:
"terus ada yang miss, maksudku file edit view dkk itu di sebelah system sini loh, bukan di dalam petaknya"

Dua masalah kritis yang terjadi:
1. **Menu Bar 12 Kategori Muncul di Dalam Jendela HTML, Bukan di Native macOS System Menu Bar**:
   - Di `ui/shell/TitleBar.svelte`, dibuat elemen DOM `#ide-menu-bar` di dalam jendela Petak (gaya Windows/Linux).
   - Di macOS, aplikasi desktop profesional (Xcode, VS Code, JetBrains) meletakkan menu bar `File`, `Edit`, `View`, `Navigate`, `Code`, `Refactor`, `Build`, `Run`, `Git`, `Tools`, `Window`, `Help` di **Native macOS System Menu Bar** di bagian paling atas layar monitor (di sebelah logo Apple  / `Petak`), BUKAN di dalam jendela webview.
   - Akibatnya, TitleBar jendela Petak menjadi sesak dan menu bar di atas macOS tetap kosong/minimal (` Petak File Edit Window`).
2. **TitleBar Jendela Petak Harus Bersih (Clean Mac Window)**:
   - Hapus elemen `#ide-menu-bar` dari dalam jendela HTML di `TitleBar.svelte`.
   - TitleBar jendela Petak murni menjadi Cockpit bar: traffic lights insets macOS di kiri, Run Config & Branch selector, Cockpit controls (Run, Debug, Hot Reload ⚡, Hot Restart ⟳, Stop ■), Search Everywhere `⇧⇧`, dan toggle panel.
3. **Halaman Welcome Dashboard (`DashboardView.svelte`) Masih Versi Lama v0.7.0**:
   - Perbarui `DashboardView.svelte` agar mengadopsi desain Welcome Dashboard V2 yang telah dibuat di prototype (hero banner Petak v0.8.0, 4 kartu aksi cepat, recent projects, live Toolchain Doctor card).

## 2. Rincian Teknis Implementasi

### A. Native macOS System Menu Bar di Tauri 2 (`crates/app/src/lib.rs`):
Bangun menu native 12 kategori menggunakan `tauri::menu::{MenuBuilder, SubmenuBuilder, MenuItemBuilder}`:
- **`Petak`**: About Petak, Settings (`⌘,`), Separator, Services, Separator, Hide Petak (`⌘H`), Hide Others (`⌥⌘H`), Show All, Separator, Quit Petak (`⌘Q`).
- **`File`**: New File (`⌘N`), Open Folder... (`⌘O`), Open Recent, Separator, Save (`⌘S`), Save All (`⌥⌘S`), Separator, Close Tab (`⌘W`), Close Window (`⇧⌘W`).
- **`Edit`**: Undo (`⌘Z`), Redo (`⇧⌘Z`), Separator, Cut (`⌘X`), Copy (`⌘C`), Paste (`⌘V`), Select All (`⌘A`), Separator, Find in File (`⌘F`), Replace (`⌘R`), Search in Project (`⇧⌘F`).
- **`View`**: Toggle File Tree (`⌘B`), Toggle Terminal (`⌘J`), Toggle AI Agents (`⌘6`), Toggle Device Mirror (`⇧⌘D`), Separator, Full Screen (`⌃⌘F`), Zen Mode (`⌘K Z`).
- **`Navigate`**: Search Everywhere (`⌘P`), Go to Symbol (`⌘⌥O`), Go to Line... (`⌘G`), Separator, Next Problem (`F2`), Previous Problem (`⇧F2`).
- **`Code`**: Format Document (`⌥⇧F`), Quick Fix / Code Action (`⌘.`), Organize Imports (`⌥⇧O`), AI Inline Completion (`Tab`).
- **`Refactor`**: Rename Symbol (`⇧F6`), Extract Widget (`⌥⌘W`), Extract Method (`⌥⌘M`), Move File (`F6`).
- **`Build`**: Flutter Build APK, Flutter Build iOS, Separator, Gradle Clean Build.
- **`Run`**: Start Debugging (`F5`), Run Without Debugging (`⌃F5`), Flutter Hot Reload (`⌘\`), Flutter Hot Restart (`⇧⌘\`), Stop (`⇧F5`).
- **`Git`**: Commit... (`⌘K`), Push... (`⇧⌘K`), Pull/Update (`⌘T`), Branches..., Separator, GitLab Merge Requests (`⌘5`).
- **`Tools`**: Toolchain Doctor, Scrcpy Device Manager, Kotlin LS Manager.
- **`Window`**: Minimize (`⌘M`), Zoom, Separator, Bring All to Front.
- **`Help`**: Documentation, Keyboard Shortcuts Reference (`⌘K ⌘S`), Release Notes, About Petak.

Wiring event: daftarkan listener `app.on_menu_event` untuk meneruskan event shortcut (seperti `open_folder`, `save_file`, `hot_reload`, `search_everywhere`, `toggle_agents`, `toggle_mirror`, `open_settings`) ke frontend webview via `window.emit()`.

### B. Bersihkan TitleBar HTML (`ui/shell/TitleBar.svelte`):
- Hapus blok DOM menu bar in-window `#ide-menu-bar` dan dropdown floating menu dari `TitleBar.svelte`.
- TitleBar jendela menjadi 38px ramping:
  * Kiri: Ruang kosong 80px untuk traffic lights macOS, tombol Project Folder / Repo.
  * Tengah: Cockpit controls (Branch selector, Run config target, Device selector, tombol Run/Debug/Reload/Restart/Stop).
  * Kanan: Search Everywhere `Search everywhere (⇧⇧)`, toggle AI Agents, toggle Mirror, toggle Settings.
- Update test `tests/batch26_v2_shell.test.mjs` agar mencerminkan arsitektur native menu bar + clean TitleBar cockpit.

### C. Update Welcome Dashboard V2 (`ui/features/dashboard/DashboardView.svelte`):
- Ubah teks hardcode `v0.7.0 (Beta)` menjadi `v0.8.0`.
- Perbarui visual styling mengikuti token Design System V2 4-layer depth.

### D. Verifikasi di Mac M2:
- Jalankan test Rust & JS (`cargo test -p petak-core`, `npm test`).
- Build release Tauri app di Mac: `npm run tauri -- build`.
- Pasang ke `/Applications/Petak.app`.
- Buka dan ambil screenshot layar Mac yang membuktikan Menu Bar native macOS aktif di atas monitor dan jendela Petak bersih tanpa menu ganda.

## 3. Pembagian Tugas
- `senior` (Rust core & app): Native macOS menu builder di `crates/app/src/lib.rs` + on_menu_event dispatcher.
- `senior2` (UI): TitleBar cleaning (hapus in-window menu bar) + DashboardView V2 update + penyesuaian test.
- `reviewer`: QA & test verification.
- `techlead`: Build release Mac M2, install ke `/Applications/Petak.app`, dan verifikasi screenshot visual asli.
