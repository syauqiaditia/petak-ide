# Manual Test Checklist Petak Batch 5 (Mac)
- [ ] Buka project: status bar bersih tanpa error `api.lspRestart is not a function`
- [ ] Toolchains: install Kotlin LSP -> berhasil deteksi nested bin, status Ready & diagnostic muncul
- [ ] Mirror iPhone fisik: terdeteksi ios-physical USB, view-only tanpa error simctl/scrcpy
- [ ] Device dropdown: label 'Terhubung (USB/Wi-Fi)' atau 'Terkunci', tooltip tunnel/pairing, tombol Refresh jalan
- [ ] Start AVD emulator: start AVD langsung booting -> running, adb connect, auto-open mirror
- [ ] Run toolbar: aksi Restart Flutter Daemon, Restart connection, Hot Restart, dan Stop mereset state
- [ ] Bottom panel resize: drag border atas (min 120px, max 80%), double-click maximize/restore, simpan tinggi
- [ ] Commit panel: SATU daftar Changes, checkbox per file/grup, state konsisten, commit hanya yang tercentang
- [ ] File tree: tombol 'Open' di samping judul PROJECT hilang; 'Open Folder' tetap ada di recent/menu
- [ ] Settings > Accounts: form GitLab URL + PAT (password), tombol Test, Simpan (token dikosongkan), Hapus

# Server Verification Evidence
1. KLS Binary Layout: /mnt/storage/uqi-cache/lsp/server/bin/kotlin-language-server terdeteksi (support flat & nested).
2. KLS Diagnostics: MainActivity.kt (petak_native_sample) did_open -> LSP Status: ready, diagnostics: 0 passed.
3. AVD Detached Start: jatim_dev headless spawned via spawn_emulator_detached, terdeteksi online di adb, emu kill OK.
4. Emulator Log: ~/.local/share/Petak/logs/emulator.log merekam parameter avd, binary, dan PID.
5. Accounts & Keychain: Token tersimpan aman (file 0600 fallback di Linux), mock server /api/v4/user lulus (200 OK & 401).
6. Device Kind & Mirror: CoreDevice/00008xxx terklasifikasi ios-physical, error terstruktur ramah tanpa kata simctl/scrcpy.
7. Daemon Restart: Siklus start-stop-restart daemon flutter diverifikasi via fake daemon di flutter.rs.
8. Test Gates: cargo test -p petak-core lulus 213 unit + 10 suite integrasi; npm test lulus 109 tests.
