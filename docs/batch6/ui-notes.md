# Petak Batch 6 (UI) - Summary of Changes

## Ringkasan Perubahan per Fitur

1. **BUG 1: AVD Start & DevicesPanel Status (`ui/features/run/DevicesPanel.svelte`, `runStore.svelte.ts`)**
   - Menghubungkan tombol Start AVD langsung ke `runStore.avdStart(avdName)`.
   - Mengelola lifecycle state `Booting`, `Running`, `Failed` dari event `emulator-status`.
   - Menambahkan unit test store method scanner untuk memastikan semua pemanggilan store valid di Svelte files.

2. **BUG 4: In-Memory Local Commit Checkbox (`ui/features/git/git.svelte.ts`, `CommitPanel.svelte`)**
   - State checkbox disimpan in-memory per-repo tanpa disk write / git refresh (<16ms, terbukti 1-3ms pada tes).
   - Tombol Commit memanggil command atomic `git_commit_paths`.

3. **Shift-Shift Everywhere (`ui/features/search/keymap.ts`, `tests/batch6_ui_logic.test.mjs`)**
   - Global double-shift detector di level window dengan threshold <= 350ms.
   - Mengabaikan Shift yang ditekan bersamaan dengan karakter huruf (mengetik kapital).
   - Dilengkapi unit test dengan fake timer virtual time.

4. **Title Bar Drag & Maximize (`ui/shell/TitleBar.svelte`, `titleBarLogic.ts`, `capabilities/default.json`)**
   - `data-tauri-drag-region` pada titlebar dengan filter elemen interaktif (button, input, popup, brand).
   - Double click title bar melakukan toggle maximize window (`appWindow.toggleMaximize()`).
   - Permissions diizinkan di capabilities Tauri (`core:window:allow-start-dragging`, `allow-toggle-maximize`).

5. **Code Folding (`ui/features/editor/folding.ts`, `Editor.svelte`)**
   - `foldGutter` + `petakFoldService` (delimiters `{`, `[`, `(`, heading Markdown `#`, dan indentasi).
   - Placeholder `{…}`, keybindings ⌥⌘- / ⌥⌘+ (fold/unfold block), ⌥⇧⌘- / ⌥⇧⌘+ (fold/unfold all).
   - State folding tersimpan per tab file di sesi aktif tanpa merusak AST atau menyebabkan lag pengetikan.

6. **In-File Find and Replace (`ui/features/editor/FindReplaceBar.svelte`, `searchLogic.ts`, `Editor.svelte`)**
   - Cmd-F (Find) dan Cmd-R (Replace) overlay di editor.
   - Pilihan Match Case (`Aa`), Whole Word, dan Regular Expression (`.*`).
   - Indikator kecocokan `n/m`, tombol Next/Prev, Replace One, Replace All.
   - Bekerja mulus baik di mode normal maupun Vim mode.

7. **Settings Modal & Quick Theme Rail (`ui/features/settings/`, `Rail.svelte`, `ToolchainsPanel.svelte`, `App.svelte`)**
   - Dialog Settings lengkap 9 kategori: General, Editor, Toolchains & SDK, Git, Accounts, Agents, Devices, Keymap, About.
   - Filter pencarian setting, keyboard shortcut `⌘,`.
   - Opsi `Reopen last project on launch` default OFF.
   - Rail bawah: Tombol gear membuka Settings; tombol matahari/bulan di atasnya untuk toggle tema light/dark instan.
   - Panel Toolchains diperbarui menjadi ringkasan status runtime dengan tombol langsung 'Open Settings'.

8. **Dashboard View (`ui/features/dashboard/DashboardView.svelte`, `App.svelte`, `TitleBar.svelte`)**
   - Tampilan Dashboard ringan (<150MB RAM idle) saat tidak ada folder terbuka atau melalui klik logo Petak / menu.
   - Daftar recent project dengan status pin, waktu relatif, status toolchain, dan aksi cepat.

9. **Device Mirror Picker & Clean Stop (`ui/features/mirror/`, `pickerLogic.ts`, `DevicePickerView.svelte`, `App.svelte`)**
   - Saat tombol Mirror ditekan, menampilkan Device Picker (daftar kartu device: Android emulator, Android fisik USB, iOS Simulator, iPhone USB).
   - Deduplikasi entri iPhone menjadi satu kartu tunggal (deteksi USB vs Wi-Fi).
   - Header mirror memiliki tombol 'Ganti device' saat sesi mirror aktif.
   - Penutupan panel mirror (tombol X, Esc, toggle Cmd-Shift-D, ganti project, atau tutup app) memanggil `mirrorStop` dan mematikan decoder/canvas secara tuntas.
   - Pesan status `needs_usb`, status izin Camera (macOS) dengan tombol langsung buka pengaturan dan tombol Coba lagi.

10. **Stash UI (`ui/features/git/StashModal.svelte`, `CommitPanel.svelte`)**
    - Klik kanan area kosong Changes memunculkan opsi Stash Changes…, Pop Latest Stash, dan View Stashes….
    - Dialog Stash mendukung pesan kustom, toggle untracked files (`-u`), serta inspeksi daftar stash dengan opsi Apply, Pop, dan Drop.

11. **Compare with Branch UI (`ui/features/git/CompareBranchModal.svelte`, `BranchPanel.svelte`, `FileTree.svelte`)**
    - Modal perbandingan branch lengkap dengan daftar file berubah di sebelah kiri dan Side-by-Side Diff di sebelah kanan.
    - Menampilkan ringkasan agregat `N files changed, +X −Y`.
    - Navigasi Next/Prev file dan dukungan scope path (file atau folder).

12. **Filter Panel Bawah (`ui/features/run/RunPanel.svelte`, `LogcatPanel.svelte`, `ProblemsPanel.svelte`, `BuildPanel.svelte`, `TerminalPanel.svelte`)**
    - Filter search per panel dengan opsi Case Sensitive (`Aa`) dan Regular Expression (`.*`).
    - Logcat: Min level, tag filter, app process filter, pause scroll, tombol clear, dan ring buffer 50k baris.
    - Problems: Filter severity (All / Errors / Warnings), pencarian file/pesan, navigasi next/prev problem.
    - Run & Build: Filter pencarian log/error dan navigasi antar kecocokan.
    - Terminal: Search overlay pencarian teks buffer terminal buffer xterm.
